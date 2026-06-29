// ============================================================
//  update-checker.js — 独立更新源检查与安装模块
//  此文件仅供独立发布版本使用。
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
let versionButtonLatestZipballUrl = '';
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
let versionDownloadSelectedSource = 'zipball';
let versionDownloadSelectedUrl = '';
let versionDownloadFullExtraction = false;
let versionButtonLatestReload = true;
let versionButtonLatestForce = false;
let versionButtonLatestUpdate = null;
const VERSION_DOWNLOAD_URL = 'https://codeload.github.com/s1y4x1/BJTU-course-assistant/zip/refs/heads/master';
const VERSION_PRIMARY_LATEST_URL = 'https://raw.githubusercontent.com/s1y4x1/s1y4x1.github.io/refs/heads/main/release.json';
const VERSION_FALLBACK_LATEST_URL = 'https://s1y4x1.github.io/release.json';
const VERSION_IGNORE_KEY = 'ignoredUpdateVersion';
const VERSION_UPDATE_NOTIFICATION_ID = 'bjtu-update-download-complete';
const VERSION_APPLIED_WITHOUT_RELOAD_KEY = 'appliedUpdateWithoutReload';
const VERSION_PENDING_RELOAD_KEY = 'pendingUpdateReload';
const VERSION_FULLSCREEN_REQUEST_KEY = 'fullscreenUpdateRequest';
const versionDownloadFilenameRequests = new Map();
let versionRefreshCountdownTimer = null;

function handleVersionDownloadFilename(item, suggest) {
  const request = Array.from(versionDownloadFilenameRequests.values()).find((entry) => (
    entry.downloadId === item?.id || entry.url === String(item?.url || '')
  ));
  if (!request) return;
  suggest({ filename: request.path, conflictAction: 'overwrite' });
}

if (typeof chrome !== 'undefined' && chrome.downloads?.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener(handleVersionDownloadFilename);
}

function cancelVersionRefreshCountdown() {
  if (versionRefreshCountdownTimer) clearInterval(versionRefreshCountdownTimer);
  versionRefreshCountdownTimer = null;
}

function removeAutoUpdateQueryParameter() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('autoUpdate')) return;
    url.searchParams.delete('autoUpdate');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {}
}

function startVersionRefreshCountdown() {
  const button = document.getElementById('version-download-refresh');
  if (!(button instanceof HTMLButtonElement)) return;
  cancelVersionRefreshCountdown();
  const refreshAt = Date.now() + 2000;
  button.style.display = '';
  const update = () => {
    const seconds = Math.max(0, Math.ceil((refreshAt - Date.now()) / 1000));
    if (seconds > 0) {
      button.textContent = `刷新（${seconds} 秒）`;
      return;
    }
    cancelVersionRefreshCountdown();
    button.textContent = '刷新';
    removeAutoUpdateQueryParameter();
    location.reload();
  };
  update();
  versionRefreshCountdownTimer = setInterval(update, 100);
}

function isVersionDownloadingNow() {
  return !!versionDownloadInProgress && String(versionDownloadPhase || '').trim() === 'downloading';
}

function showUpdateDownloadCompleteNotification() {
  if (typeof chrome === 'undefined' || !chrome.notifications) return;
  chrome.notifications.create(VERSION_UPDATE_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: 'icons/512.png',
    title: 'BJTU 课程助手更新',
    message: '更新文件已覆盖解压到下载目录/BJTU-course-assistant/，请到「扩展管理」页面重新加载扩展。',
    buttons: [{ title: '打开扩展管理' }],
    requireInteraction: true
  }, () => void chrome.runtime.lastError);
}

function getVersionDownloadButtonLabel(mode, source) {
  const src = String(source || 'zipball').trim();
  if (mode === 'latest') return src === 'zipball' ? '下载修复包' : '下载尝鲜包';
  if (mode === 'ahead') return src === 'zipball' ? '下载正式版' : '下载开发版';
  return src === 'zipball' ? '下载更新' : '下载开发版';
}

function syncVersionNoticeDownloadButton(buttonText) {
  const btn = document.getElementById('version-notice-download');
  if (!(btn instanceof HTMLButtonElement)) return;
  const downloading = isVersionDownloadingNow();
  if (downloading) {
    btn.textContent = '后台下载中...';
  } else if (buttonText) {
    btn.textContent = buttonText;
  } else {
    const sourceSelect = document.getElementById('version-source-select');
    const source = sourceSelect instanceof HTMLSelectElement ? sourceSelect.value : 'zipball';
    btn.textContent = getVersionDownloadButtonLabel(versionButtonMode, source);
  }
}

function openVersionDownloadProgressModal() {
  const modal = ensureVersionDownloadModal();
  if (!modal) return;
  versionDownloadMinimized = false;
  modal.style.display = 'flex';
}

async function handoffUpdateToFullscreen(url, source, fullExtraction = false) {
  await setLocal(VERSION_FULLSCREEN_REQUEST_KEY, {
    url: String(url || '').trim(),
    source: String(source || 'zipball').trim(),
    fullExtraction: fullExtraction === true,
    requestedAt: Date.now()
  });
  await chrome.runtime.sendMessage({ type: 'OPEN_APP', payload: { autoUpdate: true } });
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

    const releaseHeader = trimmed.match(/^@@release\|([^|]+)\|(.*)$/);
    if (releaseHeader) {
      closeAllLists();
      const versionText = parseInlineMarkdown(releaseHeader[1]);
      const timeText = parseInlineMarkdown(releaseHeader[2]);
      const timeHtml = timeText ? `<span style="font-size:12px; font-weight:500; color:#64748b;">${timeText}</span>` : '';
      out.push(`<div style="display:flex; align-items:baseline; gap:8px; margin:0 0 6px; color:#0f172a; line-height:1.25;"><span style="font-size:16px; font-weight:700;">${versionText}</span>${timeHtml}</div>`);
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

  const sourceSelect = modal.querySelector('#version-source-select');
  if (sourceSelect instanceof HTMLSelectElement) {
    sourceSelect.addEventListener('change', () => syncVersionNoticeDownloadButton());
  }
  const downloadBtn = modal.querySelector('#version-notice-download');
  if (downloadBtn instanceof HTMLButtonElement) {
    downloadBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      const selectedSource = sourceSelect instanceof HTMLSelectElement ? sourceSelect.value : 'zipball';
      const selectedUrl = selectedSource === 'zipball' && versionButtonLatestZipballUrl
        ? versionButtonLatestZipballUrl : VERSION_DOWNLOAD_URL;
      const fullExtraction = versionButtonMode === 'latest' && selectedSource === 'zipball';
      if (typeof popupMode !== 'undefined' && popupMode) {
        handoffUpdateToFullscreen(selectedUrl, selectedSource, fullExtraction)
          .catch(() => showToast('无法打开全屏更新页面', 'error', 2600));
        return;
      }
      if (isVersionDownloadingNow()) {
        openVersionDownloadProgressModal();
        return;
      }
      startVersionDownloadWithFallback(selectedUrl, selectedSource, fullExtraction).catch(() => {
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
    downloadBtn.style.display = 'block';
  }
  const sourceSelect = modal.querySelector('#version-source-select');
  if (sourceSelect instanceof HTMLSelectElement) {
    const isLatest = mode === 'latest';
    const optZipball = sourceSelect.querySelector('option[value="zipball"]');
    const optMaster = sourceSelect.querySelector('option[value="master"]');
    if (optZipball instanceof HTMLOptionElement) {
      optZipball.textContent = isLatest ? '修复' : '正式版';
    }
    if (optMaster instanceof HTMLOptionElement) {
      optMaster.textContent = isLatest ? '尝鲜' : '开发版';
    }
    sourceSelect.value = 'zipball';
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
      startVersionDownloadWithFallback(
        versionDownloadSelectedUrl,
        versionDownloadSelectedSource,
        versionDownloadFullExtraction
      ).catch(() => {
        versionDownloadInProgress = false;
        showToast('请检查网络连接后重试或联系开发者获取最新版本', 'error', 3200);
      });
    });
  }
  const openExtensionsBtn = document.getElementById('version-download-open-extensions');
  if (openExtensionsBtn instanceof HTMLButtonElement) {
    openExtensionsBtn.addEventListener('click', () => chrome.tabs.create({ url: 'about:extensions' }));
  }
  const closeDownloadBtn = document.getElementById('version-download-close');
  if (closeDownloadBtn instanceof HTMLButtonElement) {
    closeDownloadBtn.addEventListener('click', () => {
      if (modal.dataset.locked === '1') return;
      cancelVersionRefreshCountdown();
      modal.style.display = 'none';
    });
  }
  const refreshBtn = document.getElementById('version-download-refresh');
  if (refreshBtn instanceof HTMLButtonElement) {
    refreshBtn.addEventListener('click', () => {
      cancelVersionRefreshCountdown();
      removeAutoUpdateQueryParameter();
      location.reload();
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
      if (modal.dataset.locked !== '1') {
        if (versionDownloadPhase === 'finished' || versionDownloadPhase === 'failed') {
          cancelVersionRefreshCountdown();
          modal.style.display = 'none';
        } else if (versionDownloadPhase === 'downloading') {
          versionDownloadMinimized = true;
          modal.style.display = 'none';
          showToast('已最小化，后台静默下载中...', 'info', 1400);
        }
      }
    }
    delete modal.dataset.mdownMask;
  });
  return modal;
}

function setVersionDownloadRetryVisible(visible) {
  const actions = document.getElementById('version-download-actions');
  if (actions instanceof HTMLElement) {
    actions.style.display = visible ? 'flex' : 'none';
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
  const openExtensionsBtn = document.getElementById('version-download-open-extensions');
  const refreshBtn = document.getElementById('version-download-refresh');
  const closeBtn = document.getElementById('version-download-close');

  if (phase === 'downloading' || phase === 'failed') modal.dataset.locked = '0';

  if (minBtn instanceof HTMLButtonElement) {
    minBtn.style.display = versionDownloadPhase === 'downloading' ? 'inline-block' : 'none';
  }
  if (phase !== 'finished') {
    if (openExtensionsBtn instanceof HTMLElement) openExtensionsBtn.style.display = 'none';
    if (refreshBtn instanceof HTMLElement) refreshBtn.style.display = 'none';
    if (closeBtn instanceof HTMLElement) closeBtn.style.display = 'none';
  }
  if (phase === 'failed' && closeBtn instanceof HTMLElement) closeBtn.style.display = '';
  if (phase === 'finished' || phase === 'failed') setVersionDownloadBar({ visible: false });

  if (titleEl) titleEl.textContent = String(title || '正在下载');
  if (bodyEl) bodyEl.innerHTML = renderVersionDownloadBodyHtml(body || '请稍候，正在下载更新文件...');
  if (statusEl) statusEl.textContent = phase === 'finished' ? '' : String(status || '下载中...');
}

function setVersionDownloadBar({ visible = true, percent = 0, indeterminate = false } = {}) {
  const container = document.getElementById('version-download-progress');
  const bar = document.getElementById('version-download-progress-bar');
  if (!(container instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
  container.style.display = visible ? '' : 'none';
  container.classList.toggle('indeterminate', visible && indeterminate);
  if (!visible) return;
  if (indeterminate) {
    container.removeAttribute('aria-valuenow');
    return;
  }
  const normalizedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  bar.style.width = `${normalizedPercent}%`;
  container.setAttribute('aria-valuenow', String(Math.round(normalizedPercent)));
}

function setVersionDownloadReleaseNotes(markdownText = '') {
  const container = document.getElementById('version-download-release-notes');
  const body = document.getElementById('version-download-release-notes-body');
  if (!(container instanceof HTMLElement) || !(body instanceof HTMLElement)) return;
  const notes = String(markdownText || '').trim();
  container.style.display = notes ? '' : 'none';
  body.innerHTML = notes ? renderMarkdownBasic(notes) : '';
}

function setVersionDownloadCompletionUi({ reloadRequired, fileCount, displayVersion } = {}) {
  const modal = ensureVersionDownloadModal();
  if (!modal) return;
  const writtenFileCount = Math.max(0, Number(fileCount) || 0);
  const reloadBody = writtenFileCount > 0
    ? `已覆盖写入 ${writtenFileCount} 个文件。必须到「扩展管理」页面**重新加载**扩展。`
    : '必须到「扩展管理」页面**重新加载**扩展。';
  modal.dataset.locked = reloadRequired && versionButtonLatestForce ? '1' : '0';
  setVersionDownloadProgressUi({
    visible: true,
    status: '已完成',
    title: reloadRequired ? '更新文件已覆盖解压' : '更新已完成，刷新页面生效',
    body: reloadRequired
      ? reloadBody
      : `已更新到 ${String(displayVersion || versionButtonLatestDisplayVersion || versionButtonLatestVersion)}，刷新页面后生效。`,
    phase: 'finished'
  });
  const retryBtn = document.getElementById('version-download-retry');
  const openExtensionsBtn = document.getElementById('version-download-open-extensions');
  const refreshBtn = document.getElementById('version-download-refresh');
  const closeBtn = document.getElementById('version-download-close');
  const actions = document.getElementById('version-download-actions');
  if (retryBtn instanceof HTMLElement) retryBtn.style.display = 'none';
  if (openExtensionsBtn instanceof HTMLElement) openExtensionsBtn.style.display = reloadRequired ? '' : 'none';
  if (refreshBtn instanceof HTMLElement) refreshBtn.style.display = reloadRequired ? 'none' : '';
  if (closeBtn instanceof HTMLElement) closeBtn.style.display = reloadRequired ? 'none' : '';
  if (actions instanceof HTMLElement) actions.style.display = 'flex';
  if (reloadRequired) cancelVersionRefreshCountdown();
  else startVersionRefreshCountdown();
}

function parseUpdateSourceTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(raw)) {
    return raw.replace(/\s+/, 'T') + '+08:00';
  }
  return raw;
}

function formatDownloadBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findZipEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('更新压缩包结构无效');
}

function parseZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocdOffset = findZipEndOfCentralDirectory(bytes);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('暂不支持 ZIP64 更新包');
  }

  const decoder = new TextDecoder('utf-8');
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('更新压缩包目录损坏');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (flags & 0x1) throw new Error('更新压缩包已加密，无法解压');
    const nameStart = offset + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, '/');
    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error('更新压缩包文件记录损坏');
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.byteLength) throw new Error('更新压缩包文件数据不完整');
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      compressed: bytes.slice(dataOffset, dataOffset + compressedSize),
      directory: name.endsWith('/')
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateZipEntry(entry) {
  if (entry.method === 0) return entry.compressed;
  if (entry.method !== 8) throw new Error(`不支持的 ZIP 压缩方式：${entry.method}`);
  if (typeof DecompressionStream !== 'function') throw new Error('当前浏览器不支持 ZIP 解压');
  const stream = new Blob([entry.compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (entry.uncompressedSize !== bytes.byteLength) throw new Error(`文件解压长度不符：${entry.name}`);
  return bytes;
}

function getZipCommonRoot(entries) {
  const names = entries.map((entry) => String(entry.name || '')).filter(Boolean);
  if (!names.length) return '';
  const first = names[0].split('/')[0];
  return first && names.every((name) => name === first || name.startsWith(first + '/')) ? first + '/' : '';
}

function normalizeUpdateEntryPath(name, commonRoot) {
  let value = String(name || '').replace(/\\/g, '/');
  if (commonRoot && value.startsWith(commonRoot)) value = value.slice(commonRoot.length);
  const parts = value.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) return '';
  return parts.join('/');
}

function searchChromeDownloads(query) {
  return new Promise((resolve) => {
    chrome.downloads.search(query, (items) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(Array.isArray(items) ? items : []);
    });
  });
}

function removeChromeDownloadFile(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.removeFile(downloadId, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function eraseChromeDownloadRecord(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.erase({ id: downloadId }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function isSameUpdateDownloadPath(filename, relativePath) {
  const normalizedFilename = String(filename || '').replace(/\\/g, '/').toLowerCase();
  const normalizedRelativePath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  return normalizedFilename.endsWith(`/bjtu-course-assistant/${normalizedRelativePath}`);
}

async function clearInterruptedUpdateDownloadRecords(relativePath) {
  const interrupted = await searchChromeDownloads({ state: 'interrupted' });
  const matches = interrupted.filter((item) => Number.isInteger(item?.id)
    && isSameUpdateDownloadPath(item?.filename, relativePath));
  for (const item of matches) {
    await removeChromeDownloadFile(item.id);
    await eraseChromeDownloadRecord(item.id);
  }
}

async function downloadBlobToUpdatePath(bytes, relativePath) {
  await clearInterruptedUpdateDownloadRecords(relativePath);
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const downloadPath = `BJTU-course-assistant/${relativePath}`;
    let downloadId = null;
    let timeoutId = null;
    let keepHintTimer = null;
    let interruptedCheckTimer = null;
    let settled = false;
    const startedAt = Date.now();
    const expectedBytes = Number(bytes?.byteLength) || 0;
    const isJavaScriptFile = /\.js$/i.test(String(relativePath || ''));
    const showKeepHint = () => {
      if (!isJavaScriptFile) return;
      setVersionDownloadProgressUi({
        visible: true,
        status: `等待保留：${relativePath}`,
        title: '正在覆盖解压',
        body: '浏览器可能拦截 JavaScript 文件。请在浏览器下载弹窗中点击“保留”，然后继续等待。',
        phase: 'extracting'
      });
    };
    const cleanup = () => {
      chrome.downloads.onChanged.removeListener(onChanged);
      versionDownloadFilenameRequests.delete(blobUrl);
      if (timeoutId) clearTimeout(timeoutId);
      if (keepHintTimer) clearTimeout(keepHintTimer);
      if (interruptedCheckTimer) clearTimeout(interruptedCheckTimer);
      URL.revokeObjectURL(blobUrl);
    };
    const finish = (error = null, completedId = downloadId) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(completedId);
    };
    const reconcileInterruptedDownload = async (delta) => {
      const currentItems = await searchChromeDownloads({ id: downloadId });
      const current = currentItems[0] || null;
      if (current?.state === 'complete') {
        finish(null, current.id);
        return;
      }
      const recentItems = await searchChromeDownloads({ orderBy: ['-startTime'], limit: 20 });
      const replacement = recentItems.find((item) => {
        const startTime = Date.parse(String(item?.startTime || ''));
        const received = Number(item?.bytesReceived) || 0;
        return item?.state === 'complete'
          && Number.isFinite(startTime) && startTime >= startedAt - 1000
          && isSameUpdateDownloadPath(item?.filename, relativePath)
          && (expectedBytes === 0 || received >= expectedBytes);
      });
      if (replacement) {
        finish(null, replacement.id);
        return;
      }
      const reason = String(current?.error || delta?.error?.current || '').trim();
      finish(new Error(`覆盖文件失败：${relativePath}${reason ? `（${reason}）` : ''}`));
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (isJavaScriptFile && delta.danger?.current && delta.danger.current !== 'safe') showKeepHint();
      if (!delta.state?.current) return;
      if (delta.state.current === 'complete') {
        finish(null, downloadId);
      } else if (delta.state.current === 'interrupted') {
        if (interruptedCheckTimer) return;
        interruptedCheckTimer = setTimeout(() => {
          reconcileInterruptedDownload(delta).catch(() => {
            finish(new Error(`覆盖文件失败：${relativePath}`));
          });
        }, 800);
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    const filenameRequest = { url: blobUrl, path: downloadPath, downloadId: null };
    versionDownloadFilenameRequests.set(blobUrl, filenameRequest);
    chrome.downloads.download({
      url: blobUrl,
      filename: downloadPath,
      saveAs: false,
      conflictAction: 'overwrite'
    }, (id) => {
      const error = chrome.runtime.lastError;
      if (error || !Number.isInteger(id)) {
        finish(new Error(error?.message || `无法写入文件：${relativePath}`));
        return;
      }
      downloadId = id;
      filenameRequest.downloadId = id;
      if (isJavaScriptFile) keepHintTimer = setTimeout(showKeepHint, 2500);
      timeoutId = setTimeout(() => {
        finish(new Error(`写入文件超时：${relativePath}`));
      }, 120000);
    });
  });
}

async function fetchUpdateArchiveWithProgress(url) {
  const controller = new AbortController();
  let idleTimer = null;
  const startedAt = Date.now();
  setVersionDownloadBar({ visible: true, indeterminate: true });
  const resetIdleTimeout = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort('timeout'), 30000);
  };
  resetIdleTimeout();
  const connectingTimer = setInterval(() => {
    const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    setVersionDownloadProgressUi({
      visible: true,
      status: `正在连接下载源… ${seconds} 秒`,
      title: '正在下载更新压缩包',
      body: '正在等待更新服务器响应，连续 30 秒无响应将自动停止。',
      phase: 'downloading'
    });
  }, 1000);
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    clearInterval(connectingTimer);
    if (!response.ok) throw new Error(`下载更新压缩包失败（HTTP ${response.status}）`);
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    setVersionDownloadBar({ visible: true, percent: 0, indeterminate: total <= 0 });
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      setVersionDownloadBar({ visible: true, percent: 100 });
      setVersionDownloadProgressUi({ visible: true, status: `100% · ${formatDownloadBytes(bytes.byteLength)}`, title: '正在下载更新压缩包', body: '更新压缩包下载完成，正在准备覆盖解压。', phase: 'downloading' });
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      resetIdleTimeout();
      chunks.push(value);
      received += value.byteLength;
      const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
      setVersionDownloadBar({ visible: true, percent, indeterminate: total <= 0 });
      setVersionDownloadProgressUi({
        visible: true,
        status: total > 0
          ? `${percent}% · ${formatDownloadBytes(received)} / ${formatDownloadBytes(total)}`
          : `已下载 ${formatDownloadBytes(received)}`,
        title: '正在下载更新压缩包',
        body: '正在下载更新文件，下载完成后将自动覆盖解压。',
        phase: 'downloading'
      });
    }
    setVersionDownloadBar({ visible: true, percent: 100 });
    const bytes = new Uint8Array(received);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('连接更新源超时（连续 30 秒无响应）');
    throw error;
  } finally {
    clearInterval(connectingTimer);
    if (idleTimer) clearTimeout(idleTimer);
  }
}

function searchDownloads(query) {
  return new Promise((resolve) => {
    chrome.downloads.search(query, (items) => {
      void chrome.runtime.lastError;
      resolve(Array.isArray(items) ? items : []);
    });
  });
}

function removeDownloadedFile(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.removeFile(downloadId, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function deleteTrackedUpdateDirectoryFiles() {
  setVersionDownloadProgressUi({
    visible: true,
    status: '正在删除旧文件…',
    title: '正在重建更新目录',
    body: '正在删除浏览器下载记录中可追踪的 BJTU-course-assistant/ 文件。',
    phase: 'extracting'
  });
  const items = await searchDownloads({ query: ['BJTU-course-assistant'] });
  const tracked = items.filter((item) => {
    const filename = String(item?.filename || '').replace(/\\/g, '/').toLowerCase();
    return Number.isInteger(item?.id) && /(^|\/)bjtu-course-assistant\//.test(filename);
  });
  await Promise.all(tracked.map((item) => removeDownloadedFile(item.id)));
  return tracked.length;
}

function selectUpdateArchiveFiles(files, updateRule) {
  if (!Array.isArray(updateRule) || updateRule.length === 0) return files;
  if (updateRule.length === 1 && updateRule[0] === true) return files;
  const requested = new Set(updateRule
    .filter((value) => typeof value === 'string')
    .map((value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase())
    .filter(Boolean));
  if (!requested.size) return files;
  return files.filter((item) => {
    const path = String(item.path || '').toLowerCase();
    const basename = path.split('/').at(-1) || '';
    return requested.has(path) || requested.has(basename);
  });
}

async function extractUpdateArchiveToDownloads(archiveBytes, updateRule = null) {
  setVersionDownloadBar({ visible: true, percent: 0 });
  setVersionDownloadProgressUi({
    visible: true,
    status: '正在解析更新压缩包…',
    title: '正在覆盖解压',
    body: '正在将更新文件覆盖到下载目录/BJTU-course-assistant/。',
    phase: 'extracting'
  });
  const bytes = archiveBytes instanceof Uint8Array ? archiveBytes : new Uint8Array(archiveBytes || 0);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const entries = parseZipEntries(arrayBuffer);
  const commonRoot = getZipCommonRoot(entries);
  const archiveFiles = entries
    .filter((entry) => !entry.directory)
    .map((entry) => ({ entry, path: normalizeUpdateEntryPath(entry.name, commonRoot) }))
    .filter((item) => item.path);
  const resetDirectory = Array.isArray(updateRule) && updateRule.length === 1 && updateRule[0] === true;
  if (resetDirectory) await deleteTrackedUpdateDirectoryFiles();
  const files = selectUpdateArchiveFiles(archiveFiles, updateRule);
  if (!files.length) throw new Error('更新压缩包中没有可写入文件');

  const nonJavaScriptFiles = files.filter((item) => !/\.js$/i.test(String(item.path || '')));
  const javaScriptFiles = files.filter((item) => /\.js$/i.test(String(item.path || '')));
  let completedCount = 0;

  if (nonJavaScriptFiles.length) {
    setVersionDownloadProgressUi({
      visible: true,
      status: `正在并行覆盖：0 / ${nonJavaScriptFiles.length}`,
      title: '正在覆盖解压',
      body: '正在将更新文件覆盖到下载目录/BJTU-course-assistant/。',
      phase: 'extracting'
    });
    const results = await Promise.allSettled(nonJavaScriptFiles.map(async (item) => {
      await downloadBlobToUpdatePath(await inflateZipEntry(item.entry), item.path);
      completedCount += 1;
      setVersionDownloadBar({ visible: true, percent: (completedCount / files.length) * 100 });
      setVersionDownloadProgressUi({
        visible: true,
        status: `正在并行覆盖：${completedCount} / ${nonJavaScriptFiles.length} · ${item.path}`,
        title: '正在覆盖解压',
        body: '正在将更新文件覆盖到下载目录/BJTU-course-assistant/。',
        phase: 'extracting'
      });
    }));
    const failedResult = results.find((result) => result.status === 'rejected');
    if (failedResult) throw failedResult.reason;
  }

  for (let index = 0; index < javaScriptFiles.length; index += 1) {
    const item = javaScriptFiles[index];
    setVersionDownloadProgressUi({
      visible: true,
      status: `正在覆盖 JavaScript：${index + 1} / ${javaScriptFiles.length} · ${item.path}`,
      title: '正在覆盖解压',
      body: '正在串行覆盖 JavaScript 文件；如浏览器拦截，请点击“保留”。',
      phase: 'extracting'
    });
    await downloadBlobToUpdatePath(await inflateZipEntry(item.entry), item.path);
    completedCount += 1;
    setVersionDownloadBar({ visible: true, percent: (completedCount / files.length) * 100 });
  }
  return files.length;
}

async function downloadVersionByUrlWithProgress(url) {
  const finalUrl = String(url || '').trim();
  if (!finalUrl) throw new Error('下载链接为空');
  if (typeof chrome === 'undefined' || !chrome.downloads) throw new Error('downloads API 不可用');

  const archiveBytes = await fetchUpdateArchiveWithProgress(finalUrl);
  const updateRule = versionDownloadFullExtraction ? null : versionButtonLatestUpdate;
  const fileCount = await extractUpdateArchiveToDownloads(archiveBytes, updateRule);
  const reloadRequired = versionButtonLatestReload;
  const forcedUpdate = versionButtonLatestForce;
  const appliedRecord = {
    ver: versionButtonLatestVersion,
    name: versionButtonLatestDisplayVersion,
    reload: reloadRequired,
    force: forcedUpdate,
    fileCount,
    appliedAt: Date.now()
  };
  if (reloadRequired) {
    await setLocal(VERSION_PENDING_RELOAD_KEY, appliedRecord);
  } else {
    await setLocal(VERSION_APPLIED_WITHOUT_RELOAD_KEY, appliedRecord);
    await setLocal(VERSION_PENDING_RELOAD_KEY, null);
    versionButtonLocalVersion = versionButtonLatestVersion;
    setVersionButtonState('latest', {
      localVersion: versionButtonLatestVersion,
      latestVersion: versionButtonLatestVersion,
      latestDisplayVersion: versionButtonLatestDisplayVersion,
      latestPublishedAt: versionButtonLatestPublishedAt,
      body: versionButtonLatestBodyMarkdown,
      zipballUrl: versionButtonLatestZipballUrl,
      reload: false,
      force: forcedUpdate,
      update: versionButtonLatestUpdate
    });
  }
  setVersionDownloadCompletionUi({ reloadRequired, fileCount, displayVersion: versionButtonLatestDisplayVersion });
  if (reloadRequired) showUpdateDownloadCompleteNotification();
}

async function startVersionDownloadWithFallback(downloadUrl, source = '', fullExtraction = false) {
  if (versionDownloadInProgress) {
    openVersionDownloadProgressModal();
    return;
  }
  versionDownloadMinimized = false;

  versionDownloadInProgress = true;
  syncVersionNoticeDownloadButton();
  setVersionDownloadReleaseNotes(
    versionButtonLatestForce ? (versionButtonLatestBodyMarkdown || '暂无更新说明。') : ''
  );
  setVersionDownloadBar({ visible: true, indeterminate: true });
  setVersionDownloadProgressUi({
    visible: true,
    status: '正在连接下载源…',
    title: '正在下载更新压缩包',
    body: '正在下载更新文件，下载完成后将自动覆盖解压。',
    phase: 'downloading'
  });
  const primaryUrl = String(downloadUrl || versionButtonDownloadUrl || VERSION_DOWNLOAD_URL).trim() || VERSION_DOWNLOAD_URL;
  const selectedSource = String(source || versionDownloadSelectedSource || '').trim()
    || (primaryUrl === VERSION_DOWNLOAD_URL ? 'master' : 'zipball');
  versionDownloadSelectedSource = selectedSource;
  versionDownloadSelectedUrl = primaryUrl;
  versionDownloadFullExtraction = fullExtraction === true;
  try {
    await downloadVersionByUrlWithProgress(primaryUrl);
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

function setVersionButtonState(mode, { localVersion = '', latestVersion = '', latestDisplayVersion = '', latestPublishedAt = '', downloadUrl = '', body = '', zipballUrl = '', reload = true, force = false, update = null } = {}) {
  const versionBtn = document.getElementById('version-btn');
  if (!versionBtn) return;
  versionButtonMode = String(mode || 'loading').trim();
  versionButtonDownloadUrl = String(downloadUrl || '').trim();
  versionButtonLatestZipballUrl = String(zipballUrl || '').trim();
  versionButtonLocalVersion = String(localVersion || '').trim();
  versionButtonLatestVersion = String(latestVersion || '').trim();
  versionButtonLatestDisplayVersion = String(latestDisplayVersion || latestVersion || '').trim();
  versionButtonLatestPublishedAt = String(latestPublishedAt || '').trim();
  versionButtonLatestBodyMarkdown = String(body || '').trim();
  versionButtonLatestReload = reload !== false;
  versionButtonLatestForce = force === true;
  versionButtonLatestUpdate = Array.isArray(update) ? [...update] : null;

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
  return String(releaseData?.zipball_url || VERSION_DOWNLOAD_URL).trim() || VERSION_DOWNLOAD_URL;
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

async function fetchLatestReleaseFromUrl(sourceUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6500);
  let response;
  try {
    response = await fetch(sourceUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) throw new Error(`更新源请求失败 (${response.status})`);
  const releaseInfo = await response.json();
  const tag = String(releaseInfo?.ver || '').trim();
  const rawUrl = String(releaseInfo?.url || '').trim();
  if (!tag || !rawUrl) throw new Error('更新源缺少版本号或下载地址');
  let url;
  try {
    url = new URL(rawUrl).href;
  } catch {
    throw new Error('更新源下载地址无效');
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('更新源下载地址协议无效');
  return {
    tag_name: tag,
    name: String(releaseInfo?.name || tag).trim() || tag,
    body: String(releaseInfo?.desc || '').trim(),
    zipball_url: url,
    draft: false,
    prerelease: false,
    published_at: parseUpdateSourceTime(releaseInfo?.time),
    reload: releaseInfo?.reload !== false,
    force: releaseInfo?.force === true,
    update: Array.isArray(releaseInfo?.update) ? releaseInfo.update : null
  };
}

async function fetchFallbackLatestRelease() {
  const sourceUrls = [VERSION_PRIMARY_LATEST_URL, VERSION_FALLBACK_LATEST_URL];
  let lastError = null;
  for (const sourceUrl of sourceUrls) {
    try {
      return await fetchLatestReleaseFromUrl(sourceUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('所有更新源均不可用');
}

async function loadVersionInfo() {
  const isPopupPage = typeof popupMode !== 'undefined' && popupMode;
  const autoUpdateRequested = !isPopupPage && (() => {
    try {
      return new URL(location.href).searchParams.get('autoUpdate') === '1';
    } catch {
      return false;
    }
  })();
  let fullscreenUpdateRequest = null;
  if (autoUpdateRequested) {
    fullscreenUpdateRequest = await getLocal(VERSION_FULLSCREEN_REQUEST_KEY, null);
    await setLocal(VERSION_FULLSCREEN_REQUEST_KEY, null);
    removeAutoUpdateQueryParameter();
  }
  const manifestVersion = String(chrome.runtime.getManifest().version || '').trim();
  let appliedWithoutReload = await getLocal(VERSION_APPLIED_WITHOUT_RELOAD_KEY, null);
  let pendingReload = await getLocal(VERSION_PENDING_RELOAD_KEY, null);
  if (appliedWithoutReload?.ver && compareVersionText(manifestVersion, appliedWithoutReload.ver) >= 0) {
    appliedWithoutReload = null;
    await setLocal(VERSION_APPLIED_WITHOUT_RELOAD_KEY, null);
  }
  if (pendingReload?.ver && compareVersionText(manifestVersion, pendingReload.ver) >= 0) {
    pendingReload = null;
    await setLocal(VERSION_PENDING_RELOAD_KEY, null);
  }
  const localVersion = appliedWithoutReload?.ver && compareVersionText(appliedWithoutReload.ver, manifestVersion) > 0
    ? String(appliedWithoutReload.ver)
    : manifestVersion;
  versionIgnoredTag = String(await getLocal(VERSION_IGNORE_KEY, '') || '').trim();
  setVersionButtonState('loading', { localVersion });

  try {
    const releases = [await fetchFallbackLatestRelease()];
    const latestRelease = pickLatestStableRelease(releases);
    const latestTag = getReleaseTagVersion(latestRelease);
    const latestDisplayVersion = getReleaseDisplayVersion(latestRelease) || latestTag;
    const latestReload = latestRelease?.reload !== false;
    const latestForce = latestRelease?.force === true;
    const latestUpdate = Array.isArray(latestRelease?.update) ? latestRelease.update : null;
    if (!latestTag) throw new Error('Missing latest tag');

    const cmp = compareVersionText(latestTag, localVersion);
    if (cmp === 0) {
      const historyBody = buildAllReleaseNotes(releases, latestTag, true);
      setVersionButtonState('latest', {
        localVersion,
        latestVersion: latestTag,
        latestDisplayVersion,
        latestPublishedAt: latestRelease?.published_at || '',
        zipballUrl: latestRelease?.zipball_url || '',
        body: historyBody,
        reload: latestReload,
        force: latestForce,
        update: latestUpdate
      });
      const requestedAt = Number(fullscreenUpdateRequest?.requestedAt) || 0;
      const requestIsFresh = autoUpdateRequested && requestedAt > 0 && Date.now() - requestedAt < 5 * 60 * 1000;
      if (requestIsFresh) {
        await startVersionDownloadWithFallback(
          String(fullscreenUpdateRequest?.url || '').trim() || pickReleaseDownloadUrl(latestRelease),
          String(fullscreenUpdateRequest?.source || '').trim() || 'zipball',
          fullscreenUpdateRequest?.fullExtraction === true
        );
      }
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
        zipballUrl: latestRelease?.zipball_url || '',
        body: mergedBody,
        reload: latestReload,
        force: latestForce,
        update: latestUpdate
      });
      const pendingSameForcedReload = latestReload && latestForce
        && normalizeVersionText(pendingReload?.ver) === normalizeVersionText(latestTag);
      if (pendingSameForcedReload) {
        if (isPopupPage) {
          await handoffUpdateToFullscreen(pickReleaseDownloadUrl(latestRelease), 'zipball');
          return;
        }
        setVersionDownloadReleaseNotes(versionButtonLatestBodyMarkdown || '暂无更新说明。');
        setVersionDownloadCompletionUi({
          reloadRequired: true,
          fileCount: Number(pendingReload?.fileCount) > 0 ? Number(pendingReload.fileCount) : null,
          displayVersion: latestDisplayVersion
        });
        showUpdateDownloadCompleteNotification();
        return;
      }
      if (latestForce) {
        if (isPopupPage) {
          await handoffUpdateToFullscreen(pickReleaseDownloadUrl(latestRelease), 'zipball');
          return;
        }
        versionNoticeShownVersion = latestTag;
        const requestedAt = Number(fullscreenUpdateRequest?.requestedAt) || 0;
        const requestIsFresh = autoUpdateRequested && requestedAt > 0 && Date.now() - requestedAt < 5 * 60 * 1000;
        const requestedUrl = requestIsFresh ? String(fullscreenUpdateRequest?.url || '').trim() : '';
        const requestedSource = requestIsFresh ? String(fullscreenUpdateRequest?.source || '').trim() : '';
        await startVersionDownloadWithFallback(
          requestedUrl || pickReleaseDownloadUrl(latestRelease),
          requestedSource || 'zipball',
          requestIsFresh && fullscreenUpdateRequest?.fullExtraction === true
        );
        return;
      }
      if (autoUpdateRequested) {
        const requestedAt = Number(fullscreenUpdateRequest?.requestedAt) || 0;
        const requestIsFresh = requestedAt > 0 && Date.now() - requestedAt < 5 * 60 * 1000;
        const requestedUrl = requestIsFresh ? String(fullscreenUpdateRequest?.url || '').trim() : '';
        const requestedSource = requestIsFresh ? String(fullscreenUpdateRequest?.source || '').trim() : '';
        await startVersionDownloadWithFallback(
          requestedUrl || pickReleaseDownloadUrl(latestRelease),
          requestedSource || 'zipball',
          requestIsFresh && fullscreenUpdateRequest?.fullExtraction === true
        );
        return;
      }
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
    setVersionButtonState('ahead', { localVersion, latestVersion: latestTag, latestDisplayVersion, latestPublishedAt: latestRelease?.published_at || '', zipballUrl: latestRelease?.zipball_url || '', body: aheadBody, reload: latestReload, force: latestForce, update: latestUpdate });
  } catch (err) {
    setVersionButtonState('failure', { localVersion });
    const msg = String(err?.message || '').trim();
    const base = '检查更新失败：无法连接更新源';
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
