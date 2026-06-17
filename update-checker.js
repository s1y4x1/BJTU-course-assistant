// ============================================================
//  update-checker.js — GitHub Releases 更新检查模块
//  此文件仅供 GitHub Releases 发布使用。
//  Edge 扩展商店提交时不包含本文件。
// ============================================================

// 标记模块已加载
window.__updateCheckerLoaded = true;

// -- 版本比较工具函数 --

function normalizeVersionText(v) {
  return String(v || '').trim().replace(/^v/i, '');
}

function compareVersionText(a, b) {
  const pa = normalizeVersionText(a).split('.').map((x) => Number(x) || 0);
  const pb = normalizeVersionText(b).split('.').map((x) => Number(x) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

// -- 更新状态变量及常量 --

let versionButtonMode = 'loading';
let versionButtonDownloadUrl = '';
let versionButtonLocalVersion = '';
let versionButtonLatestVersion = '';
let versionButtonLatestDisplayVersion = '';
let versionButtonLatestPublishedAt = '';
let versionButtonLocalReleaseVersion = '';
let versionButtonLocalPublishedAt = '';
let versionButtonLatestBodyMarkdown = '';
let versionNoticeShownVersion = '';
let versionDownloadInProgress = false;
let versionDownloadMinimized = false;
let versionDownloadPhase = 'downloading';
let versionIgnoredTag = '';
let lastCompletedDownloadId = null;
const VERSION_DOWNLOAD_URL = 'https://codeload.github.com/s1y4x1/BJTU-course-assistant/zip/refs/heads/master';
const VERSION_RELEASES_API_URL = 'https://api.github.com/repos/s1y4x1/BJTU-course-assistant/releases?per_page=100';
const VERSION_IGNORE_KEY = 'ignoredUpdateVersion';
const VERSION_UPDATE_NOTIFICATION_ID = 'bjtu-update-download-complete';

function isVersionDownloadingNow() {
  return !!versionDownloadInProgress && String(versionDownloadPhase || '').trim() === 'downloading';
}

function showUpdateDownloadCompleteNotification(downloadId) {
  if (typeof chrome === 'undefined' || !chrome.notifications || !chrome.downloads) return;
  lastCompletedDownloadId = downloadId;
  chrome.notifications.create(VERSION_UPDATE_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: 'icons/512.png',
    title: 'BJTU 课程助手更新',
    message: '请打开下载目录，解压覆盖更新扩展目录并到「扩展管理」页面「重新加载」扩展以完成更新。',
    buttons: [{ title: '打开下载目录' }, { title: '打开扩展管理' }],
    requireInteraction: true
  }, () => void chrome.runtime.lastError);
}

function setupUpdateNotificationClickListener() {
  if (typeof chrome === 'undefined' || !chrome.notifications || !chrome.downloads) return;
  chrome.notifications.onClicked.addListener((notifId) => {
    if (notifId !== VERSION_UPDATE_NOTIFICATION_ID) return;
    if (lastCompletedDownloadId) {
      chrome.downloads.open(lastCompletedDownloadId, () => void chrome.runtime.lastError);
    }
    chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
  });
  chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
    if (notifId !== VERSION_UPDATE_NOTIFICATION_ID) return;
    if (buttonIndex === 0) {
      if (lastCompletedDownloadId) {
        chrome.downloads.open(lastCompletedDownloadId, () => void chrome.runtime.lastError);
      }
    } else if (buttonIndex === 1) {
      chrome.tabs.create({ url: 'about:extensions' });
    }
    chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
  });
}
setupUpdateNotificationClickListener();

function syncVersionNoticeDownloadButton(buttonText) {
  const btn = document.getElementById('version-notice-download');
  if (!(btn instanceof HTMLButtonElement)) return;
  const downloading = isVersionDownloadingNow();
  if (downloading) {
    btn.textContent = '后台下载中...';
  } else if (buttonText) {
    btn.textContent = buttonText;
  } else {
    btn.textContent = versionButtonMode === 'ahead' ? '下载正式版' : '下载更新';
  }
}

function openVersionDownloadProgressModal() {
  const modal = ensureVersionDownloadModal();
  if (!modal) return;
  versionDownloadMinimized = false;
  modal.style.display = 'flex';
}

function parseInlineMarkdown(text) {
  let html = escapeHtml(String(text || ''));
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0f766e; text-decoration:none;">$1</a>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9; border:1px solid #e2e8f0; border-radius:4px; padding:0 4px;">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

function renderMarkdownBasic(markdownText) {
  const src = String(markdownText || '').replace(/\r\n/g, '\n');
  if (!src.trim()) {
    return '<p style="margin:0; color:#475569; line-height:1.6;">此版本暂无更新说明。</p>';
  }

  const lines = src.split('\n');
  const out = [];
  const listStack = [];
  const listUlStyle = 'margin:0 0 6px 18px; padding:0; color:#334155; line-height:1.6;';

  const closeAllLists = () => {
    while (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      if (top.liOpen) {
        out.push('</li>');
      }
      out.push('</ul>');
      listStack.pop();
    }
  };

  const closeListsToDepth = (depth) => {
    while (listStack.length > depth) {
      const top = listStack[listStack.length - 1];
      if (top.liOpen) {
        out.push('</li>');
      }
      out.push('</ul>');
      listStack.pop();
    }
  };

  lines.forEach((line) => {
    const raw = String(line || '');
    const trimmed = raw.trim();
    if (!trimmed) {
      closeAllLists();
      out.push('<div style="height:6px;"></div>');
      return;
    }

    const releaseHeader = trimmed.match(/^@@release\|(.+)\|(.+)$/);
    if (releaseHeader) {
      closeAllLists();
      const versionText = parseInlineMarkdown(releaseHeader[1]);
      const timeText = parseInlineMarkdown(releaseHeader[2]);
      out.push(`<div style="display:flex; align-items:baseline; gap:8px; margin:0 0 6px; color:#0f172a; line-height:1.25;"><span style="font-size:16px; font-weight:700;">${versionText}</span><span style="font-size:12px; font-weight:500; color:#64748b;">${timeText}</span></div>`);
      return;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeAllLists();
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level} style="margin:0 0 8px; color:#0f172a; font-size:${Math.max(14, 22 - level * 2)}px;">${parseInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeAllLists();
      out.push('<hr style="border:0; border-top:1px solid #e2e8f0; margin:10px 0;">');
      return;
    }

    const bullet = raw.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      const indent = String(bullet[1] || '').replace(/\t/g, '  ');
      const level = Math.max(1, Math.floor(indent.length / 2) + 1);

      closeListsToDepth(level);

      while (listStack.length < level) {
        out.push(`<ul style="${listUlStyle}">`);
        listStack.push({ liOpen: false });
      }

      const current = listStack[level - 1];
      if (current.liOpen) {
        out.push('</li>');
      }
      out.push(`<li style="margin:2px 0;">${parseInlineMarkdown(bullet[2])}`);
      current.liOpen = true;
      return;
    }

    if (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      if (top.liOpen) {
        out.push(`<p style="margin:4px 0 0; color:#334155; line-height:1.6; white-space:pre-wrap;">${parseInlineMarkdown(raw)}</p>`);
        return;
      }
    }
    closeAllLists();
    out.push(`<p style="margin:0 0 6px; color:#334155; line-height:1.6;">${parseInlineMarkdown(trimmed)}</p>`);
  });

  closeAllLists();
  return out.join('');
}

function ensureVersionNoticeModal() {
  const modal = document.getElementById('version-notice-modal');
  if (!(modal instanceof HTMLElement)) return null;
  if (modal.dataset.bound === '1') return modal;
  modal.dataset.bound = '1';

  const closeBtn = modal.querySelector('#version-notice-close');
  if (closeBtn instanceof HTMLButtonElement) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  modal.addEventListener('mousedown', (e) => {
    modal.dataset.mdownMask = e.target === modal ? '1' : '0';
  });
  modal.addEventListener('mouseup', (e) => {
    if (e.target === modal && modal.dataset.mdownMask === '1') {
      modal.style.display = 'none';
    }
    delete modal.dataset.mdownMask;
  });

  const downloadBtn = modal.querySelector('#version-notice-download');
  if (downloadBtn instanceof HTMLButtonElement) {
    downloadBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      if (typeof popupMode !== 'undefined' && popupMode) {
        startVersionDownloadWithFallback().catch(() => {
          versionDownloadInProgress = false;
          syncVersionNoticeDownloadButton();
          showToast('请检查网络连接后重试或联系开发者获取最新版本', 'error', 3200);
        });
        return;
      }
      if (isVersionDownloadingNow()) {
        openVersionDownloadProgressModal();
        return;
      }
      startVersionDownloadWithFallback().catch(() => {
        versionDownloadInProgress = false;
        syncVersionNoticeDownloadButton();
        showToast('请检查网络连接后重试或联系开发者获取最新版本', 'error', 3200);
      });
    });
  }

  const ignoreBtn = modal.querySelector('#version-notice-ignore');
  if (ignoreBtn instanceof HTMLButtonElement) {
    ignoreBtn.addEventListener('click', async () => {
      const tag = String(versionButtonLatestVersion || '').trim();
      if (!tag) {
        modal.style.display = 'none';
        return;
      }
      versionIgnoredTag = tag;
      await setLocal(VERSION_IGNORE_KEY, tag);
      modal.style.display = 'none';
      showToast(`已忽略 ${tag} 的更新提示`, 'info', 1600);
    });
  }

  return modal;
}

function openVersionNoticeModal(overrideMode) {
  const mode = String(overrideMode || versionButtonMode || '').trim();
  if (mode !== 'outdated' && mode !== 'latest' && mode !== 'ahead') return;
  const modal = ensureVersionNoticeModal();
  if (!modal) return;
  const titleEl = modal.querySelector('#version-notice-title');
  const bodyEl = modal.querySelector('#version-notice-body');
  const downloadBtn = modal.querySelector('#version-notice-download');
  const ignoreBtn = modal.querySelector('#version-notice-ignore');
  if (titleEl instanceof HTMLElement) {
    const versionLabel = escapeHtml(String(versionButtonLatestDisplayVersion || versionButtonLatestVersion || '').trim() || '--');
    const publishedText = escapeHtml(formatReleasePublishedAt(versionButtonLatestPublishedAt));
    const timeHtml = publishedText ? `<span class="version-notice-title-time">${publishedText}</span>` : '';
    if (mode === 'latest') {
      titleEl.innerHTML = `<span class="version-notice-title-main">已是最新版本：${versionLabel}</span>${timeHtml}`;
    } else if (mode === 'ahead') {
      const localLabel = escapeHtml(String(versionButtonLocalReleaseVersion || versionButtonLocalVersion || '').trim() || '--');
      const localPublishedText = escapeHtml(formatReleasePublishedAt(versionButtonLocalPublishedAt));
      const localTimeHtml = localPublishedText ? `<span class="version-notice-title-time">${localPublishedText}</span>` : '';
      titleEl.innerHTML = `<span class="version-notice-title-main">当前为开发预览版本：${localLabel}</span>${localTimeHtml}`;
    } else {
      titleEl.innerHTML = `<span class="version-notice-title-main">发现新版本：${versionLabel}</span>${timeHtml}`;
    }
  }
  if (bodyEl instanceof HTMLElement) {
    bodyEl.innerHTML = renderMarkdownBasic(versionButtonLatestBodyMarkdown);
  }
  if (downloadBtn instanceof HTMLButtonElement) {
    if (mode === 'outdated' || mode === 'ahead') {
      downloadBtn.style.display = 'block';
    } else {
      downloadBtn.style.display = 'none';
    }
  }
  if (ignoreBtn instanceof HTMLButtonElement) {
    if (mode === 'outdated') {
      const ignored = String(versionIgnoredTag || '').trim();
      const latest = String(versionButtonLatestVersion || '').trim();
      if (ignored && latest && ignored === latest) {
        ignoreBtn.style.display = 'none';
      } else {
        ignoreBtn.style.display = 'flex';
      }
    } else {
      ignoreBtn.style.display = 'none';
    }
  }
  modal.style.display = 'flex';
  syncVersionNoticeDownloadButton();
}

function ensureVersionDownloadModal() {
  const modal = document.getElementById('version-download-modal');
  if (!(modal instanceof HTMLElement)) return null;
  if (modal.dataset.bound === '1') return modal;
  modal.dataset.bound = '1';

  const retryBtn = document.getElementById('version-download-retry');
  if (retryBtn instanceof HTMLButtonElement) {
    retryBtn.addEventListener('click', () => {
      startVersionDownloadWithFallback().catch(() => {
        versionDownloadInProgress = false;
        showToast('请检查网络连接后重试或联系开发者获取最新版本', 'error', 3200);
      });
    });
  }
  const minBtn = document.getElementById('version-download-minimize');
  if (minBtn instanceof HTMLButtonElement) {
    minBtn.addEventListener('click', () => {
      if (versionDownloadPhase !== 'downloading') return;
      versionDownloadMinimized = true;
      modal.style.display = 'none';
      showToast('已最小化，后台静默下载中...', 'info', 1400);
    });
  }
  modal.addEventListener('mousedown', (e) => {
    modal.dataset.mdownMask = e.target === modal ? '1' : '0';
  });
  modal.addEventListener('mouseup', (e) => {
    if (e.target === modal && modal.dataset.mdownMask === '1') {
      if (versionDownloadPhase !== 'downloading') return;
      versionDownloadMinimized = true;
      modal.style.display = 'none';
      showToast('已最小化，后台静默下载中...', 'info', 1400);
    }
    delete modal.dataset.mdownMask;
  });
  return modal;
}

function setVersionDownloadRetryVisible(visible) {
  const actions = document.getElementById('version-download-actions');
  if (actions instanceof HTMLElement) {
    actions.style.display = visible ? 'block' : 'none';
  }
}

function renderVersionDownloadBodyHtml(bodyText) {
  const safe = escapeHtml(String(bodyText || ''));
  const linkLabel = 'about:extensions';
  const linkHtml = '<a href="about:extensions" target="_blank" rel="noopener noreferrer" style="color:#0f766e; font-weight:700; text-decoration:underline;">about:extensions</a>';
  let html = safe.replaceAll(escapeHtml(linkLabel), linkHtml);
  const boldLabel = '**重新加载**';
  html = html.replaceAll(escapeHtml(boldLabel), '<b>重新加载</b>');
  return html;
}

function setVersionDownloadProgressUi({
  visible = true,
  status = '下载中...',
  title = '正在下载',
  body = '请稍候，正在下载更新文件...',
  phase = 'downloading'
} = {}) {
  const modal = ensureVersionDownloadModal();
  if (!modal) return;
  versionDownloadPhase = String(phase || 'downloading').trim() || 'downloading';
  syncVersionNoticeDownloadButton();
  const forceShow = phase !== 'downloading';
  const shouldShow = visible && (forceShow || !versionDownloadMinimized);
  modal.style.display = shouldShow ? 'flex' : 'none';
  if (forceShow) versionDownloadMinimized = false;
  setVersionDownloadRetryVisible(false);
  if (!visible) return;

  const titleEl = document.getElementById('version-download-title');
  const bodyEl = document.getElementById('version-download-body');
  const statusEl = document.getElementById('version-download-status');
  const minBtn = document.getElementById('version-download-minimize');

  if (minBtn instanceof HTMLButtonElement) {
    minBtn.style.display = versionDownloadPhase === 'downloading' ? 'inline-block' : 'none';
  }

  if (titleEl) titleEl.textContent = String(title || '正在下载');
  if (bodyEl) bodyEl.innerHTML = renderVersionDownloadBodyHtml(body || '请稍候，正在下载更新文件...');
  if (statusEl) statusEl.textContent = phase === 'finished' ? '' : String(status || '下载中...');
}

async function downloadVersionByUrlWithProgress(url, fileName) {
  const finalUrl = String(url || '').trim();
  if (!finalUrl) throw new Error('下载链接为空');

  // 使用 chrome.downloads API 绕过 CORS 限制
  if (typeof chrome === 'undefined' || !chrome.downloads) {
    throw new Error('downloads API 不可用');
  }

  return new Promise((resolve, reject) => {
    let resolved = false;
    let downloadId = null;

    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(onChanged);
        if (!resolved) {
          resolved = true;
          showUpdateDownloadCompleteNotification(downloadId);
          setVersionDownloadProgressUi({
            visible: true,
            status: '已完成',
            title: '下载成功',
            body: '请打开下载目录，解压覆盖更新扩展目录并到「扩展管理」页面**重新加载**扩展以完成更新。',
            phase: 'finished'
          });
          resolve();
        }
      } else if (delta.state?.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChanged);
        if (!resolved) {
          resolved = true;
          reject(new Error('下载中断'));
        }
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);

    chrome.downloads.download({
      url: finalUrl,
      filename: fileName,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (id) => {
      if (chrome.runtime.lastError) {
        chrome.downloads.onChanged.removeListener(onChanged);
        if (!resolved) {
          resolved = true;
          reject(new Error(chrome.runtime.lastError.message || '下载启动失败'));
        }
        return;
      }
      downloadId = id;

      // 下载已启动，关闭弹窗，后台静默等待
      const modal = document.getElementById('version-download-modal');
      if (modal) modal.style.display = 'none';
      versionDownloadMinimized = true;
      showToast('浏览器后台下载中…', 'info', 2000);

      // 兜底超时：2 分钟后若未完成则视为失败
      setTimeout(() => {
        if (!resolved) {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolved = true;
          reject(new Error('下载超时'));
        }
      }, 120000);
    });
  });
}

function buildVersionDownloadFileName(versionText = '') {
  const normalized = normalizeVersionText(versionText).replace(/[^0-9.]/g, '');
  if (normalized) return `BJTU 课程助手 ${normalized}.zip`;
  return 'BJTU 课程助手.zip';
}

async function startVersionDownloadWithFallback() {
  if (versionDownloadInProgress) {
    openVersionDownloadProgressModal();
    return;
  }
  versionDownloadMinimized = false;

  versionDownloadInProgress = true;
  syncVersionNoticeDownloadButton();
  showToast('已发送下载请求，浏览器正在连接…', 'info', 2000);
  const fileName = buildVersionDownloadFileName(versionButtonLatestVersion);
  const primaryUrl = VERSION_DOWNLOAD_URL;

  try {
    await downloadVersionByUrlWithProgress(primaryUrl, fileName);
    // 成功 UI 已在 downloadVersionByUrlWithProgress 内部处理
  } catch (err) {
    setVersionDownloadProgressUi({
      visible: true,
      status: `下载失败：${String(err?.message || '未知错误')}`,
      title: '下载失败',
      body: '下载失败，请检查网络后重试。',
      phase: 'failed'
    });
    setVersionDownloadRetryVisible(true);
    showToast('请检查网络连接后重试或联系开发者获取最新版本', 'error', 3200);
  }
  versionDownloadInProgress = false;
  syncVersionNoticeDownloadButton();
}

function setVersionButtonState(mode, { localVersion = '', latestVersion = '', latestDisplayVersion = '', latestPublishedAt = '', downloadUrl = '', body = '' } = {}) {
  const versionBtn = document.getElementById('version-btn');
  if (!versionBtn) return;
  versionButtonMode = String(mode || 'loading').trim();
  versionButtonDownloadUrl = String(downloadUrl || '').trim();
  versionButtonLocalVersion = String(localVersion || '').trim();
  versionButtonLatestVersion = String(latestVersion || '').trim();
  versionButtonLatestDisplayVersion = String(latestDisplayVersion || latestVersion || '').trim();
  versionButtonLatestPublishedAt = String(latestPublishedAt || '').trim();
  versionButtonLatestBodyMarkdown = String(body || '').trim();

  versionBtn.className = `version-btn ${versionButtonMode}`;
  versionBtn.disabled = !(versionButtonMode === 'failure' || versionButtonMode === 'outdated' || versionButtonMode === 'latest' || versionButtonMode === 'ahead');

  if (versionButtonMode === 'loading') {
    versionBtn.innerHTML = '<span class="version-btn-spinner"></span><span>获取最新版本中...</span>';
    return;
  }
  if (versionButtonMode === 'failure') {
    versionBtn.innerHTML = `<span>当前版本：${escapeHtml(localVersion || '--')}</span>`;
    return;
  }
  if (versionButtonMode === 'latest') {
    versionBtn.innerHTML = `<span>已是最新版本：${escapeHtml(versionButtonLatestDisplayVersion || latestVersion || localVersion || '--')}</span>`;
    return;
  }
  if (versionButtonMode === 'outdated') {
    versionBtn.innerHTML = `<span class="version-btn-stack"><span>发现新版本：${escapeHtml(versionButtonLatestDisplayVersion || latestVersion || '--')}</span></span>`;
    return;
  }
  if (versionButtonMode === 'ahead') {
    versionBtn.innerHTML = `<span>开发版本：${escapeHtml(localVersion || '--')}</span>`;
    return;
  }
  versionBtn.innerHTML = `<span>当前版本：${escapeHtml(localVersion || '--')}</span>`;
}

function pickReleaseDownloadUrl(releaseData) {
  return VERSION_DOWNLOAD_URL;
}

function getReleaseTagVersion(releaseData) {
  return String(releaseData?.tag_name || '').trim();
}

function getReleaseDisplayVersion(releaseData) {
  const releaseName = String(releaseData?.name || '').trim();
  return releaseName || getReleaseTagVersion(releaseData);
}

function pickLatestStableRelease(releases = []) {
  const list = Array.isArray(releases) ? releases : [];
  return list.find((r) => !r?.draft && !r?.prerelease && getReleaseTagVersion(r))
    || list.find((r) => !r?.draft && getReleaseTagVersion(r))
    || null;
}

function buildAggregatedReleaseNotes(releases = [], localVersion = '', latestVersion = '') {
  const list = Array.isArray(releases) ? releases : [];
  const items = list.filter((r) => {
    if (!r || r.draft) return false;
    const tag = getReleaseTagVersion(r);
    if (!tag) return false;
    return compareVersionText(tag, localVersion) > 0 && compareVersionText(tag, latestVersion) <= 0;
  });
  if (!items.length) return '';
  return items.map((r, idx) => {
    const versionLabel = getReleaseDisplayVersion(r);
    const body = String(r.body || '').trim() || '此版本暂无更新说明。';
    const publishedText = formatReleasePublishedAt(r?.published_at);
    return idx === 0 ? `${body}` : `@@release|${versionLabel}|${publishedText}\n${body}`;
  }).join('\n\n---\n\n');
}

function buildAllReleaseNotes(releases = [], latestVersion = '', suppressLatest = false) {
  const list = Array.isArray(releases) ? releases : [];
  const items = list.filter((r) => !r?.draft && getReleaseTagVersion(r));
  if (!items.length) return '';
  return items.map((r) => {
    const tag = getReleaseTagVersion(r);
    const versionLabel = getReleaseDisplayVersion(r);
    const body = String(r.body || '').trim() || '此版本暂无更新说明。';
    const publishedText = formatReleasePublishedAt(r?.published_at);
    if (suppressLatest && compareVersionText(tag, latestVersion) === 0) {
      return body;
    }
    return `@@release|${versionLabel}|${publishedText}\n${body}`;
  }).join('\n\n---\n\n');
}

function formatReleasePublishedAt(publishedAt) {
  const rawText = String(publishedAt || '').trim();
  if (!rawText) return '';
  const publishedDate = new Date(rawText);
  if (Number.isNaN(publishedDate.getTime())) return '';

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(publishedDate);
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const absoluteText = `${lookup.year || '0000'}-${lookup.month || '00'}-${lookup.day || '00'} ${lookup.hour || '00'}:${lookup.minute || '00'}:${lookup.second || '00'}`;

  const diffMs = Date.now() - publishedDate.getTime();
  if (diffMs < 0) {
    return absoluteText;
  }

  const diffSec = Math.floor(diffMs / 1000);
  let relativeText = '';
  if (diffSec <= 60) {
    relativeText = `${diffSec}秒前`;
  } else if (diffSec <= 60 * 60) {
    relativeText = `${Math.floor(diffSec / 60)}分钟前`;
  } else if (diffSec <= 24 * 60 * 60) {
    const hours = Math.floor(diffSec / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);
    relativeText = hours > 0 ? `${hours}小时${minutes}分钟前` : `${minutes}分钟前`;
  } else if (diffSec <= 7 * 24 * 60 * 60) {
    const days = Math.floor(diffSec / 86400);
    const hours = Math.floor((diffSec % 86400) / 3600);
    relativeText = hours > 0 ? `${days}天${hours}小时前` : `${days}天前`;
  }

  return relativeText ? `${absoluteText}（${relativeText}）` : absoluteText;
}

async function loadVersionInfo() {
  const localVersion = String(chrome.runtime.getManifest().version || '').trim();
  versionIgnoredTag = String(await getLocal(VERSION_IGNORE_KEY, '') || '').trim();
  setVersionButtonState('loading', { localVersion });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    let releasesRes;
    try {
      releasesRes = await fetch(VERSION_RELEASES_API_URL, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!releasesRes.ok) {
      let apiMessage = '';
      try {
        const failData = await releasesRes.json();
        apiMessage = String(failData?.message || '').trim();
      } catch {
        try {
          apiMessage = String(await releasesRes.text()).trim();
        } catch {
          apiMessage = '';
        }
      }
      throw new Error(apiMessage || `GitHub request failed (${releasesRes.status})`);
    }

    const releases = await releasesRes.json();
    if (!Array.isArray(releases) || !releases.length) {
      throw new Error('Missing releases');
    }
    const latestRelease = pickLatestStableRelease(releases);
    const latestTag = getReleaseTagVersion(latestRelease);
    const latestDisplayVersion = getReleaseDisplayVersion(latestRelease) || latestTag;
    if (!latestTag) throw new Error('Missing latest tag');

    const cmp = compareVersionText(latestTag, localVersion);
    if (cmp === 0) {
      const historyBody = buildAllReleaseNotes(releases, latestTag, true);
      setVersionButtonState('latest', {
        localVersion,
        latestVersion: latestTag,
        latestDisplayVersion,
        latestPublishedAt: latestRelease?.published_at || '',
        body: historyBody
      });
      return;
    }
    if (cmp > 0) {
      const mergedBody = buildAggregatedReleaseNotes(releases, localVersion, latestTag)
        || String(latestRelease?.body || '').trim();
      setVersionButtonState('outdated', {
        localVersion,
        latestVersion: latestTag,
        latestDisplayVersion,
        latestPublishedAt: latestRelease?.published_at || '',
        downloadUrl: pickReleaseDownloadUrl(latestRelease),
        body: mergedBody
      });
      const ignoredSameVersion = normalizeVersionText(versionIgnoredTag) === normalizeVersionText(latestTag);
      if (!ignoredSameVersion && versionNoticeShownVersion !== latestTag) {
        versionNoticeShownVersion = latestTag;
        openVersionNoticeModal();
      }
      return;
    }
    if (versionIgnoredTag) {
      versionIgnoredTag = '';
      await setLocal(VERSION_IGNORE_KEY, '');
    }
    const localRelease = (Array.isArray(releases) ? releases : []).find((r) => {
      if (r?.draft) return false;
      const tag = getReleaseTagVersion(r);
      return tag && compareVersionText(tag, localVersion) === 0;
    });
    versionButtonLocalReleaseVersion = localRelease ? getReleaseDisplayVersion(localRelease) : localVersion;
    versionButtonLocalPublishedAt = localRelease?.published_at || '';
    const aheadBody = buildAllReleaseNotes(releases, latestTag);
    setVersionButtonState('ahead', { localVersion, latestVersion: latestTag, latestDisplayVersion, latestPublishedAt: latestRelease?.published_at || '', body: aheadBody });
  } catch (err) {
    setVersionButtonState('failure', { localVersion });
    const msg = String(err?.message || '').trim();
    const base = '检查更新失败：无法连接到 Github';
    const text = msg ? `${base}\n${msg}` : base;
    showToast(text, 'error', 2600, false, { preserveInfoToasts: true });
  }
}

// -- 注册版本按钮点击事件 --

function setupVersionButton() {
  const versionBtn = document.getElementById('version-btn');
  if (!versionBtn) return;

  // 确保版本按钮区域可见
  const versionInfoEl = document.getElementById('version-info');
  if (versionInfoEl) versionInfoEl.style.display = '';

  versionBtn.addEventListener('click', async () => {
    if (versionButtonMode === 'failure') {
      loadVersionInfo().catch(() => {});
      return;
    }
    if (versionButtonMode === 'latest') {
      await loadVersionInfo().catch(() => {});
      if (versionButtonMode === 'latest' || versionButtonMode === 'outdated') {
        openVersionNoticeModal();
      }
      return;
    }
    if (versionButtonMode === 'outdated') {
      openVersionNoticeModal();
      return;
    }
    if (versionButtonMode === 'ahead') {
      openVersionNoticeModal('ahead');
    }
  });

  // 启动更新检查
  loadVersionInfo().catch(() => {});
}

// 在 app.js 加载完成后再初始化版本按钮
// app.js 的 IIFE 同步执行完毕后，所有工具函数（escapeHtml, showToast 等）才可用
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupVersionButton);
} else {
  // DOM 已就绪，但需确保 app.js 同步代码执行完毕，故延迟一微任务
  Promise.resolve().then(setupVersionButton);
}
