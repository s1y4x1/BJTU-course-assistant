// ============================================================
//  更新源检查与安装模块
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
let versionUpdateDirectoryHandle = null;
let versionUpdateDirectoryHandleLoaded = false;
let versionUpdateDirectoryHandleLoadPromise = null;
let versionPendingDirectoryUpdate = null;
let versionSupplementalReloadRequired = false;
let versionButtonLatestReload = true;
let versionButtonLatestForce = false;
let versionButtonLatestUpdate = null;
let versionNoticeSuppressedByDownload = false;
let versionLatestReleaseRequestPromise = null;
let versionInfoLoadPromise = null;
let versionQueuedRelease = null;
const VERSION_DOWNLOAD_URL = 'https://codeload.github.com/s1y4x1/BJTU-course-assistant/zip/refs/heads/main';
const VERSION_LATEST_URL = 'https://s1y4x1.github.io/release.json';
const VERSION_IGNORE_KEY = 'ignoredUpdateVersion';
const VERSION_UPDATE_NOTIFICATION_ID = 'bjtu-update-download-complete';
const VERSION_APPLIED_WITHOUT_RELOAD_KEY = 'appliedUpdateWithoutReload';
const VERSION_PENDING_RELOAD_KEY = 'pendingUpdateReload';
const VERSION_AUTO_RELOAD_HANDOFF_KEY = 'versionAutoReloadHandoff';
const VERSION_AUTO_RELOAD_COMPLETED_KEY = 'versionAutoReloadCompleted';
const VERSION_FULLSCREEN_REQUEST_KEY = 'fullscreenUpdateRequest';
const VERSION_FS_DB_NAME = 'bjtu-course-assistant-update-filesystem';
const VERSION_FS_DB_STORE = 'handles';
const VERSION_FS_DIRECTORY_KEY = 'update-directory';
const VERSION_MODULE_SELECTION_KEY = 'updateModuleSelection';
const VERSION_MODULE_KNOWN_IDS_KEY = 'updateModuleKnownIds';
const VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY = 'updateModuleKnownIdsInitialized';
const VERSION_REQUIRED_MODULE_IDS = new Set(['ve', 'updater']);
const VERSION_ROOT_COMPONENT_DIRECTORY_NAMES = Object.freeze({
  _locales: '_locales',
  app: 'app',
  cache: 'cache',
  core: 'core',
  icons: 'icons',
  options: 'options',
  popup: 'popup',
  qr: 'QR',
  ui: 'UI',
  uploads: 'uploads'
});
const VERSION_ROOT_COMPONENT_IDS = new Set(Object.keys(VERSION_ROOT_COMPONENT_DIRECTORY_NAMES));
const VERSION_IGNORED_ARCHIVE_DIRECTORIES = new Set(['.agents', '.git', '.github', '.mimocode']);
let versionButtonLatestClean = false;
let versionRefreshCountdownTimer = null;
let versionRefreshCountdownAction = null;
let versionUpdateFileTreeRows = new Map();

const VERSION_UPDATE_FILE_STATE = Object.freeze({
  pending: { symbol: '○', label: '等待覆盖' },
  extracting: { symbol: '◌', label: '正在解压' },
  writing: { symbol: '›', label: '正在写入' },
  done: { symbol: '✓', label: '已写入' },
  failed: { symbol: '×', label: '覆盖失败' }
});

function openVersionFileSystemDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VERSION_FS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VERSION_FS_DB_STORE)) db.createObjectStore(VERSION_FS_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开更新目录数据库'));
  });
}

async function readVersionUpdateDirectoryHandle() {
  if (versionUpdateDirectoryHandleLoaded) return versionUpdateDirectoryHandle;
  if (versionUpdateDirectoryHandleLoadPromise) return versionUpdateDirectoryHandleLoadPromise;
  versionUpdateDirectoryHandleLoadPromise = (async () => {
    try {
      const db = await openVersionFileSystemDatabase();
      versionUpdateDirectoryHandle = await new Promise((resolve, reject) => {
        const transaction = db.transaction(VERSION_FS_DB_STORE, 'readonly');
        const request = transaction.objectStore(VERSION_FS_DB_STORE).get(VERSION_FS_DIRECTORY_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('无法读取更新目录'));
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => db.close();
      });
    } catch {
      versionUpdateDirectoryHandle = null;
    } finally {
      versionUpdateDirectoryHandleLoaded = true;
      versionUpdateDirectoryHandleLoadPromise = null;
    }
    return versionUpdateDirectoryHandle;
  })();
  return versionUpdateDirectoryHandleLoadPromise;
}

async function storeVersionUpdateDirectoryHandle(handle) {
  const db = await openVersionFileSystemDatabase();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(VERSION_FS_DB_STORE, 'readwrite');
    const store = transaction.objectStore(VERSION_FS_DB_STORE);
    if (handle) store.put(handle, VERSION_FS_DIRECTORY_KEY);
    else store.delete(VERSION_FS_DIRECTORY_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('无法保存更新目录'));
    transaction.onabort = () => reject(transaction.error || new Error('保存更新目录已中止'));
  });
  db.close();
  versionUpdateDirectoryHandle = handle || null;
  versionUpdateDirectoryHandleLoaded = true;
}

async function getWritableVersionUpdateDirectory() {
  const handle = await readVersionUpdateDirectoryHandle();
  if (!handle || typeof handle.queryPermission !== 'function') return null;
  try {
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return null;
    await validateVersionUpdateDirectory(handle);
    return handle;
  } catch {
    await storeVersionUpdateDirectoryHandle(null).catch(() => {});
    return null;
  }
}

async function validateVersionUpdateDirectory(handle) {
  if (!handle || handle.kind !== 'directory') throw new Error('请选择扩展安装目录');
  try {
    const manifestHandle = await handle.getFileHandle('manifest.json');
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest.json 格式无效');
  } catch (error) {
    if (String(error?.message || '').includes('manifest.json')) throw error;
    throw new Error('所选目录中未找到有效的 manifest.json');
  }
  return handle;
}

function getVersionUpdateDirectoryDisplayName() {
  return String(versionUpdateDirectoryHandle?.name || '').trim() || '所选扩展安装目录';
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

function startVersionRefreshCountdown({ reloadExtension = false, onReloadError = null } = {}) {
  const button = document.getElementById('version-download-refresh');
  if (!(button instanceof HTMLButtonElement)) return;
  cancelVersionRefreshCountdown();
  const refreshAt = Date.now() + 2000;
  const actionLabel = reloadExtension ? '重新加载' : '刷新';
  versionRefreshCountdownAction = () => {
    cancelVersionRefreshCountdown();
    button.textContent = actionLabel;
    removeAutoUpdateQueryParameter();
    if (!reloadExtension) {
      location.reload();
      return;
    }
    try {
      chrome.runtime.reload();
    } catch (error) {
      if (typeof onReloadError === 'function') onReloadError(error);
    }
  };
  button.style.display = '';
  const update = () => {
    const seconds = Math.max(0, Math.ceil((refreshAt - Date.now()) / 1000));
    if (seconds > 0) {
      button.textContent = `${actionLabel}（${seconds} 秒）`;
      return;
    }
    versionRefreshCountdownAction?.();
  };
  update();
  versionRefreshCountdownTimer = setInterval(update, 100);
}

function isVersionDownloadingNow() {
  return !!versionDownloadInProgress && String(versionDownloadPhase || '').trim() === 'downloading';
}

function showUpdateDownloadCompleteNotification() {
  if (typeof chrome === 'undefined' || !chrome.notifications) return;
  chrome.runtime.sendMessage({
    type: 'SYSTEM_NOTIFICATION_CREATE',
    notificationId: VERSION_UPDATE_NOTIFICATION_ID,
    source: 'foreground-update-complete',
    replaceExisting: true,
    options: {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'BJTU 课程助手更新',
      message: `更新文件已直接覆盖写入 ${getVersionUpdateDirectoryDisplayName()} 目录，请到「扩展管理」页面重新加载扩展。`,
      buttons: [{ title: '打开扩展管理' }],
      requireInteraction: true
    }
  }).catch(() => {});
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
  const channel = String(source || '').trim() === 'main' ? 2 : 1;
  await chrome.runtime.sendMessage({ type: 'OPEN_APP', payload: { autoUpdate: channel } });
}

let versionMarkdownParser = null;

function normalizeVersionMarkdownUrl(rawUrl, allowedProtocols) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return allowedProtocols.has(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function getVersionMarkdownParser() {
  if (versionMarkdownParser) return versionMarkdownParser;
  const markedApi = globalThis.marked;
  if (!markedApi?.Marked || !markedApi?.Renderer) return null;

  const renderer = new markedApi.Renderer();
  const defaultTableRenderer = renderer.table;
  renderer.html = ({ text }) => escapeHtml(String(text || ''));
  renderer.link = function renderSafeLink({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens || []);
    const safeHref = normalizeVersionMarkdownUrl(href, new Set(['http:', 'https:', 'mailto:']));
    if (!safeHref) return text;
    const titleAttribute = title ? ` title="${escapeHtml(String(title))}"` : '';
    return `<a href="${escapeHtml(safeHref)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${text}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    const safeSrc = normalizeVersionMarkdownUrl(href, new Set(['http:', 'https:']));
    if (!safeSrc) return escapeHtml(String(text || ''));
    const titleAttribute = title ? ` title="${escapeHtml(String(title))}"` : '';
    return `<img class="version-markdown-image" src="${escapeHtml(safeSrc)}" alt="${escapeHtml(String(text || ''))}"${titleAttribute} loading="lazy">`;
  };
  renderer.codespan = ({ text }) => `<code class="version-markdown-inline-code">${escapeHtml(String(text || ''))}</code>`;
  renderer.code = ({ text, lang }) => {
    const language = String(lang || '').trim().split(/\s+/)[0];
    const languageAttribute = language ? ` data-language="${escapeHtml(language)}"` : '';
    return `<pre class="version-markdown-codeblock"${languageAttribute}><code>${escapeHtml(String(text || ''))}</code></pre>`;
  };
  renderer.blockquote = function renderBlockquote({ tokens }) {
    return `<blockquote class="version-markdown-blockquote">${this.parser.parse(tokens || [])}</blockquote>`;
  };
  renderer.space = ({ raw }) => {
    const newlineCount = (String(raw || '').match(/\n/g) || []).length;
    const extraBlankLines = Math.max(0, newlineCount - 2);
    return extraBlankLines
      ? `<div class="version-markdown-extra-blank-lines" style="--version-markdown-extra-blank-lines:${extraBlankLines}" aria-hidden="true"></div>`
      : '';
  };
  renderer.table = function renderTable(token) {
    return `<div class="version-markdown-table-wrap">${defaultTableRenderer.call(this, token)}</div>`;
  };

  versionMarkdownParser = new markedApi.Marked({
    gfm: true,
    breaks: true,
    pedantic: false,
    renderer
  });
  versionMarkdownParser.use({
    extensions: [{
      name: 'bjtuReleaseHeader',
      level: 'block',
      start(source) {
        const index = String(source || '').search(/^@@release\|/m);
        return index >= 0 ? index : undefined;
      },
      tokenizer(source) {
        const match = /^@@release\|([^|\n]+)\|([^\n]*)(?:\n|$)/.exec(source);
        if (!match) return undefined;
        return {
          type: 'bjtuReleaseHeader',
          raw: match[0],
          version: String(match[1] || '').trim(),
          time: String(match[2] || '').trim()
        };
      },
      renderer(token) {
        const timeHtml = token.time
          ? `<span class="version-markdown-release-time">${escapeHtml(token.time)}</span>`
          : '';
        return `<div class="version-markdown-release"><span class="version-markdown-release-name">${escapeHtml(token.version)}</span>${timeHtml}</div>`;
      }
    }]
  });
  return versionMarkdownParser;
}

function renderMarkdownBasic(markdownText) {
  const source = String(markdownText || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '<p class="version-markdown-empty">此版本暂无更新说明。</p>';
  const parser = getVersionMarkdownParser();
  if (!parser) return `<p class="version-markdown-empty">${escapeHtml(source)}</p>`;
  try {
    return parser.parse(source, { async: false });
  } catch (error) {
    console.warn('[bjtu] release markdown render failed:', error);
    return `<p class="version-markdown-empty">${escapeHtml(source)}</p>`;
  }
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
      if (versionButtonLatestForce) {
        ignoreBtn.style.display = 'none';
        return;
      }
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
    const optMaster = sourceSelect.querySelector('option[value="main"]');
    if (optZipball instanceof HTMLOptionElement) {
      optZipball.textContent = isLatest ? '修复' : '正式版';
    }
    if (optMaster instanceof HTMLOptionElement) {
      optMaster.textContent = isLatest ? '尝鲜' : '开发版';
    }
    sourceSelect.value = 'zipball';
  }
  if (ignoreBtn instanceof HTMLButtonElement) {
    if (mode === 'outdated' && !versionButtonLatestForce) {
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

function suppressVersionNoticeForDownload() {
  versionNoticeSuppressedByDownload = true;
  const modal = document.getElementById('version-notice-modal');
  if (modal instanceof HTMLElement) modal.style.display = 'none';
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
      ).catch((error) => {
        versionDownloadInProgress = false;
        showToast(`重试更新失败：${String(error?.message || error || '未知错误')}`, 'error', 3200);
      });
    });
  }
  const openExtensionsBtn = document.getElementById('version-download-open-extensions');
  if (openExtensionsBtn instanceof HTMLButtonElement) {
    openExtensionsBtn.addEventListener('click', async () => {
      const tab = await chrome.tabs.create({ url: 'about:extensions' });
      await chrome.runtime.sendMessage({ type: 'GROUP_BJTU_OPENED_TAB', tabId: tab?.id }).catch(() => null);
    });
  }
  const closeDownloadBtn = document.getElementById('version-download-close');
  if (closeDownloadBtn instanceof HTMLButtonElement) {
    closeDownloadBtn.addEventListener('click', () => {
      if (modal.dataset.locked === '1') return;
      if (versionDownloadPhase === 'directory') versionPendingDirectoryUpdate = null;
      cancelVersionRefreshCountdown();
      modal.style.display = 'none';
    });
  }
  const refreshBtn = document.getElementById('version-download-refresh');
  if (refreshBtn instanceof HTMLButtonElement) {
    refreshBtn.addEventListener('click', () => {
      if (typeof versionRefreshCountdownAction === 'function') {
        versionRefreshCountdownAction();
        return;
      }
      removeAutoUpdateQueryParameter();
      location.reload();
    });
  }
  const selectDirectoryBtn = document.getElementById('version-download-select-directory');
  if (selectDirectoryBtn instanceof HTMLButtonElement) {
    selectDirectoryBtn.addEventListener('click', () => {
      selectVersionUpdateDirectoryAndResume().catch((error) => {
        showToast(`无法使用更新目录：${String(error?.message || error)}`, 'error', 3200);
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
      if (modal.dataset.locked !== '1') {
        if (versionDownloadPhase === 'finished' || versionDownloadPhase === 'failed') {
          cancelVersionRefreshCountdown();
          modal.style.display = 'none';
        } else if (versionDownloadPhase === 'directory') {
          versionPendingDirectoryUpdate = null;
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
  const retryButton = document.getElementById('version-download-retry');
  if (retryButton instanceof HTMLElement) retryButton.style.display = visible ? '' : 'none';
  if (actions instanceof HTMLElement) {
    actions.style.display = visible ? 'flex' : 'none';
  }
}

function renderVersionDownloadBodyHtml(bodyText) {
  const safe = escapeHtml(String(bodyText || ''));
  const linkLabel = 'about:extensions';
  const linkHtml = '<span style="color:#0f766e; font-weight:700;">about:extensions</span>';
  let html = safe.replaceAll(escapeHtml(linkLabel), linkHtml);
  const boldLabel = '**重新加载**';
  html = html.replaceAll(escapeHtml(boldLabel), '<b>重新加载</b>');
  return html.replace(/\r?\n/g, '<br>');
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
  const selectDirectoryBtn = document.getElementById('version-download-select-directory');

  if (phase === 'downloading' || phase === 'failed') modal.dataset.locked = '0';

  if (minBtn instanceof HTMLButtonElement) {
    minBtn.style.display = versionDownloadPhase === 'downloading' ? 'inline-block' : 'none';
  }
  if (phase !== 'finished') {
    if (openExtensionsBtn instanceof HTMLElement) openExtensionsBtn.style.display = 'none';
    if (refreshBtn instanceof HTMLElement) refreshBtn.style.display = 'none';
    if (closeBtn instanceof HTMLElement) closeBtn.style.display = 'none';
  }
  if (phase !== 'directory' && selectDirectoryBtn instanceof HTMLElement) selectDirectoryBtn.style.display = 'none';
  if (phase === 'failed' && closeBtn instanceof HTMLElement) closeBtn.style.display = '';
  if (phase === 'finished' || phase === 'failed' || phase === 'directory') setVersionDownloadBar({ visible: false });

  if (titleEl) titleEl.textContent = String(title || '正在下载');
  if (bodyEl) bodyEl.innerHTML = renderVersionDownloadBodyHtml(body || '请稍候，正在下载更新文件...');
  if (statusEl) {
    statusEl.replaceChildren();
    delete statusEl.dataset.transfer;
    delete statusEl.dataset.loaded;
    delete statusEl.dataset.total;
    delete statusEl.dataset.speed;
    delete statusEl.dataset.eta;
    delete statusEl.dataset.percent;
    const message = phase === 'finished' ? '' : String(status || '下载中...');
    if (message) {
      const messageEl = document.createElement('span');
      messageEl.className = 'version-download-status-message';
      messageEl.textContent = message;
      statusEl.appendChild(messageEl);
    }
  }
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

function showVersionUpdateDirectoryRequired(downloadUrl, source, fullExtraction) {
  suppressVersionNoticeForDownload();
  versionPendingDirectoryUpdate = { downloadUrl, source, fullExtraction };
  setVersionDownloadProgressUi({
    visible: true,
    status: '请勿选择包含其他文件的文件夹',
    title: '选择扩展更新目录',
    body: '请选择专门用于 BJTU 课程助手的扩展安装目录。不要选择「下载」「桌面」等根目录，也不要选择包含个人文件或其他项目的文件夹；全量更新可能清空所选目录。扩展只会写入更新包中的代码与资源，不会在该目录保存 ZIP、缓存、配置、标记或临时文件。',
    phase: 'directory'
  });
  const modal = document.getElementById('version-download-modal');
  const selectButton = document.getElementById('version-download-select-directory');
  const closeButton = document.getElementById('version-download-close');
  const actions = document.getElementById('version-download-actions');
  const locked = versionButtonLatestForce === true;
  if (modal instanceof HTMLElement) modal.dataset.locked = locked ? '1' : '0';
  if (selectButton instanceof HTMLElement) selectButton.style.display = '';
  if (closeButton instanceof HTMLElement) closeButton.style.display = locked ? 'none' : '';
  if (actions instanceof HTMLElement) actions.style.display = 'flex';
}

async function selectVersionUpdateDirectoryAndResume() {
  const selectButton = document.getElementById('version-download-select-directory');
  if (selectButton instanceof HTMLButtonElement) selectButton.disabled = true;
  try {
    let handle = await readVersionUpdateDirectoryHandle();
    if (handle && typeof handle.requestPermission === 'function') {
      const permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        await storeVersionUpdateDirectoryHandle(null);
        showToast('目录授权未通过，请再次点击并重新选择目录', 'error', 2600);
        return;
      }
    } else {
      if (typeof window.showDirectoryPicker !== 'function') {
        throw new Error('当前浏览器不支持目录写入 API');
      }
      handle = await window.showDirectoryPicker({
        id: 'bjtu-update-dir',
        mode: 'readwrite'
      });
    }
    try {
      await validateVersionUpdateDirectory(handle);
    } catch (error) {
      await storeVersionUpdateDirectoryHandle(null).catch(() => {});
      throw error;
    }
    await storeVersionUpdateDirectoryHandle(handle);
    const pending = versionPendingDirectoryUpdate;
    versionPendingDirectoryUpdate = null;
    if (pending) {
      await startVersionDownloadWithFallback(pending.downloadUrl, pending.source, pending.fullExtraction);
    }
  } catch (error) {
    if (error?.name !== 'AbortError') throw error;
  } finally {
    if (selectButton instanceof HTMLButtonElement) selectButton.disabled = false;
  }
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

function showVersionReloadMismatchUi(localVersion, sourceVersion) {
  const modal = ensureVersionDownloadModal();
  if (!modal) return;
  modal.dataset.locked = '0';
  setVersionDownloadReleaseNotes('');
  setVersionDownloadProgressUi({
    visible: true,
    status: '',
    title: '已重新加载扩展',
    body: `当前本地扩展版本号为：${normalizeVersionText(localVersion)}，更新源中为：${normalizeVersionText(sourceVersion)}。请稍后重新更新，或联系开发者询问详情。`,
    phase: 'finished'
  });
  const retryBtn = document.getElementById('version-download-retry');
  const openExtensionsBtn = document.getElementById('version-download-open-extensions');
  const refreshBtn = document.getElementById('version-download-refresh');
  const closeBtn = document.getElementById('version-download-close');
  const actions = document.getElementById('version-download-actions');
  if (retryBtn instanceof HTMLElement) retryBtn.style.display = 'none';
  if (openExtensionsBtn instanceof HTMLElement) openExtensionsBtn.style.display = 'none';
  if (refreshBtn instanceof HTMLElement) refreshBtn.style.display = 'none';
  if (closeBtn instanceof HTMLElement) closeBtn.style.display = '';
  if (actions instanceof HTMLElement) actions.style.display = 'flex';
  cancelVersionRefreshCountdown();
}

async function scheduleAutomaticExtensionReload({ fileCount, displayVersion } = {}) {
  const writtenFileCount = Math.max(0, Number(fileCount) || 0);
  await setLocal(VERSION_AUTO_RELOAD_HANDOFF_KEY, {
    ver: versionButtonLatestVersion,
    name: String(displayVersion || versionButtonLatestDisplayVersion || versionButtonLatestVersion),
    fileCount: writtenFileCount,
    requestedAt: Date.now()
  });
  removeAutoUpdateQueryParameter();
  const modal = ensureVersionDownloadModal();
  if (modal) modal.dataset.locked = '1';
  setVersionDownloadProgressUi({
    visible: true,
    status: '将在 2 秒后重新加载扩展…',
    title: '更新文件已覆盖解压',
    body: writtenFileCount > 0
      ? `已覆盖写入 ${writtenFileCount} 个文件。`
      : '更新文件已写入。',
    phase: 'finished'
  });
  const actions = document.getElementById('version-download-actions');
  const retryBtn = document.getElementById('version-download-retry');
  const openExtensionsBtn = document.getElementById('version-download-open-extensions');
  const refreshBtn = document.getElementById('version-download-refresh');
  const closeBtn = document.getElementById('version-download-close');
  if (actions instanceof HTMLElement) actions.style.display = 'flex';
  if (retryBtn instanceof HTMLElement) retryBtn.style.display = 'none';
  if (openExtensionsBtn instanceof HTMLElement) openExtensionsBtn.style.display = 'none';
  if (refreshBtn instanceof HTMLElement) refreshBtn.style.display = '';
  if (closeBtn instanceof HTMLElement) closeBtn.style.display = 'none';
  startVersionRefreshCountdown({
    reloadExtension: true,
    onReloadError: (error) => {
      setLocal(VERSION_AUTO_RELOAD_HANDOFF_KEY, null).catch(() => {});
      setVersionDownloadCompletionUi({ reloadRequired: true, fileCount: writtenFileCount, displayVersion });
      showUpdateDownloadCompleteNotification();
      showToast(`自动重新加载扩展失败：${String(error?.message || error || '未知错误')}`, 'error', 4000);
    }
  });
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

function buildVersionDownloadEmphasisStyle(bytes) {
  return globalThis.BjtuFileSizeEmphasis.buildBytesStyle(bytes);
}

function formatVersionDownloadEta(seconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes} 分 ${remainder} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

function setVersionDownloadTransferStatus({ loaded = 0, total = 0, speed = 0, eta = null, percent = null } = {}) {
  const statusEl = document.getElementById('version-download-status');
  if (!(statusEl instanceof HTMLElement)) return;
  const loadedBytes = Math.max(0, Number(loaded) || 0);
  const totalBytes = Math.max(0, Number(total) || 0);
  const speedBytes = Math.max(0, Number(speed) || 0);
  const etaSeconds = totalBytes > 0 && Number.isFinite(Number(eta)) && Number(eta) >= 0 ? Number(eta) : null;
  const explicitPercent = percent !== null && percent !== undefined && Number.isFinite(Number(percent))
    ? Number(percent)
    : null;
  const progressPercent = explicitPercent !== null
    ? Math.max(0, Math.min(100, explicitPercent))
    : (totalBytes > 0 ? Math.min(100, loadedBytes / totalBytes * 100) : null);
  const sizePart = totalBytes > 0
    ? `<span class="version-download-size-pair"><span style="${buildVersionDownloadEmphasisStyle(loadedBytes)}">${escapeHtml(formatDownloadBytes(loadedBytes))}</span><span class="version-download-status-separator">/</span><span style="${buildVersionDownloadEmphasisStyle(totalBytes)}">${escapeHtml(formatDownloadBytes(totalBytes))}</span></span>`
    : `<span style="${buildVersionDownloadEmphasisStyle(loadedBytes)}">${escapeHtml(formatDownloadBytes(loadedBytes))}</span>`;
  const percentPart = progressPercent !== null
    ? `<span class="version-download-percent">${Math.round(progressPercent)}%</span>`
    : '';
  const speedPart = `<span style="${buildVersionDownloadEmphasisStyle(speedBytes)}">${escapeHtml(formatDownloadBytes(speedBytes))}/s</span>`;
  const etaText = etaSeconds !== null
    ? `剩余: ${formatVersionDownloadEta(etaSeconds)}`
    : '剩余: 计算中…';
  statusEl.innerHTML = `${sizePart}${percentPart}${speedPart}<span class="version-download-eta">${escapeHtml(etaText)}</span>`;
  statusEl.dataset.transfer = '1';
  statusEl.dataset.loaded = String(loadedBytes);
  statusEl.dataset.total = String(totalBytes);
  statusEl.dataset.speed = String(speedBytes);
  statusEl.dataset.eta = etaSeconds === null ? '' : String(etaSeconds);
  statusEl.dataset.percent = explicitPercent === null ? '' : String(explicitPercent);
}

function resetVersionUpdateFileTree() {
  versionUpdateFileTreeRows = new Map();
  const wrapper = document.getElementById('version-update-files');
  const summary = document.getElementById('version-update-file-summary');
  const tree = document.getElementById('version-update-file-tree');
  if (wrapper instanceof HTMLElement) wrapper.style.display = 'none';
  if (summary instanceof HTMLElement) {
    summary.textContent = '';
  }
  if (tree instanceof HTMLElement) {
    tree.replaceChildren();
  }
}

function createVersionUpdateTreeRow(name, { directory = false, size = 0 } = {}) {
  const row = document.createElement('div');
  row.className = 'version-update-tree-row';
  const state = document.createElement('span');
  state.className = 'version-update-tree-state';
  state.textContent = directory ? '▾' : VERSION_UPDATE_FILE_STATE.pending.symbol;
  const label = document.createElement('span');
  label.className = 'version-update-tree-name';
  label.textContent = name;
  row.append(state, label);
  if (!directory) {
    const stateLabel = document.createElement('span');
    stateLabel.className = 'version-update-tree-state-label';
    stateLabel.textContent = VERSION_UPDATE_FILE_STATE.pending.label;
    const sizeEl = document.createElement('span');
    sizeEl.className = 'version-update-tree-size';
    sizeEl.textContent = formatDownloadBytes(size);
    row.append(stateLabel, sizeEl);
  }
  return row;
}

function renderVersionUpdateFileTree(files) {
  const wrapper = document.getElementById('version-update-files');
  const tree = document.getElementById('version-update-file-tree');
  const summary = document.getElementById('version-update-file-summary');
  if (!(wrapper instanceof HTMLElement) || !(tree instanceof HTMLElement) || !(summary instanceof HTMLElement)) return;
  versionUpdateFileTreeRows = new Map();
  tree.replaceChildren();
  const rootList = document.createElement('ul');
  tree.appendChild(rootList);
  const directories = new Map([['', rootList]]);

  files.forEach((item) => {
    const path = String(item?.path || '').replace(/\\/g, '/');
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) return;
    let parentPath = '';
    let parentList = rootList;
    parts.slice(0, -1).forEach((part) => {
      const directoryPath = parentPath ? `${parentPath}/${part}` : part;
      let childList = directories.get(directoryPath);
      if (!childList) {
        const directoryItem = document.createElement('li');
        directoryItem.className = 'version-update-tree-directory';
        directoryItem.appendChild(createVersionUpdateTreeRow(part, { directory: true }));
        childList = document.createElement('ul');
        directoryItem.appendChild(childList);
        parentList.appendChild(directoryItem);
        directories.set(directoryPath, childList);
      }
      parentPath = directoryPath;
      parentList = childList;
    });

    const fileItem = document.createElement('li');
    fileItem.className = 'version-update-tree-file';
    fileItem.dataset.state = 'pending';
    fileItem.title = VERSION_UPDATE_FILE_STATE.pending.label;
    fileItem.appendChild(createVersionUpdateTreeRow(parts.at(-1), {
      size: Math.max(0, Number(item?.entry?.uncompressedSize) || 0)
    }));
    parentList.appendChild(fileItem);
    versionUpdateFileTreeRows.set(path, fileItem);
  });

  summary.textContent = `已完成 0 / ${files.length}`;
  wrapper.style.display = '';
}

function setVersionUpdateFileState(path, state) {
  const normalizedPath = String(path || '').replace(/\\/g, '/');
  const row = versionUpdateFileTreeRows.get(normalizedPath);
  const config = VERSION_UPDATE_FILE_STATE[state] || VERSION_UPDATE_FILE_STATE.pending;
  if (!(row instanceof HTMLElement)) return;
  row.dataset.state = state;
  row.title = config.label;
  const stateEl = row.querySelector(':scope > .version-update-tree-row > .version-update-tree-state');
  if (stateEl instanceof HTMLElement) {
    stateEl.textContent = config.symbol;
    stateEl.title = config.label;
  }
  const stateLabel = row.querySelector(':scope > .version-update-tree-row > .version-update-tree-state-label');
  if (stateLabel instanceof HTMLElement) stateLabel.textContent = config.label;
}

function setVersionUpdateFileSummary({ completed = 0, total = 0, path = '', state = '' } = {}) {
  const summary = document.getElementById('version-update-file-summary');
  if (!(summary instanceof HTMLElement)) return;
  const config = VERSION_UPDATE_FILE_STATE[state];
  const current = path && config ? ` · ${config.label}：${path}` : '';
  summary.textContent = `已完成 ${completed} / ${total}${current}`;
}

window.addEventListener('bjtu-theme-change', () => {
  const statusEl = document.getElementById('version-download-status');
  if (!(statusEl instanceof HTMLElement) || statusEl.dataset.transfer !== '1') return;
  setVersionDownloadTransferStatus({
    loaded: Number(statusEl.dataset.loaded || 0),
    total: Number(statusEl.dataset.total || 0),
    speed: Number(statusEl.dataset.speed || 0),
    eta: statusEl.dataset.eta === '' ? null : Number(statusEl.dataset.eta),
    percent: statusEl.dataset.percent === '' ? null : Number(statusEl.dataset.percent)
  });
});

async function readShortPlainTextResponse(response, maxBytes = 2048) {
  const contentType = String(response?.headers?.get?.('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType && contentType !== 'text/plain') return '';

  const declaredSize = Number(response?.headers?.get?.('content-length') || 0);
  if (declaredSize > maxBytes) return '';

  try {
    if (!response?.body?.getReader) {
      const text = String(await response.text()).trim();
      if (new TextEncoder().encode(text).byteLength > maxBytes) return '';
      return text.includes('\0') ? '' : text;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => {});
        return '';
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    const text = new TextDecoder('utf-8').decode(bytes).trim();
    return text.includes('\0') ? '' : text;
  } catch {
    return '';
  }
}

function markVersionUpdateError(error, stage) {
  const normalized = error instanceof Error ? error : new Error(String(error || '未知错误'));
  if (!normalized.updateStage) normalized.updateStage = String(stage || 'unknown');
  return normalized;
}

function getVersionUpdateFailurePresentation(error) {
  const stage = String(error?.updateStage || '').trim();
  if (stage === 'network') {
    return {
      title: '下载更新包失败',
      body: '无法连接下载源或下载过程中网络中断，请检查网络连接后重试。',
      toast: '下载更新包失败，请检查网络连接后重试'
    };
  }
  if (stage === 'source') {
    const responseText = String(error?.sourceResponseText || '').trim();
    return {
      title: '下载更新包失败',
      body: responseText
        ? `下载源返回异常响应：\n${responseText}`
        : '下载源返回异常响应，请稍后重试或联系开发者检查下载源。',
      toast: '下载源返回异常响应，请稍后重试'
    };
  }
  if (stage === 'archive') {
    return {
      title: '解析更新包失败',
      body: '下载的更新包不完整、已损坏或格式不受支持，请重新下载。',
      toast: '更新包解析失败，请重新下载'
    };
  }
  if (stage === 'directory') {
    return {
      title: '覆盖更新文件失败',
      body: '无法写入所选扩展安装目录，请检查目录权限后重试。',
      toast: '无法写入更新目录，请检查目录权限后重试'
    };
  }
  if (stage === 'directory-state') {
    return {
      title: '更新目录已变更',
      body: '更新期间目录或文件被其他程序修改。已停止写入并废弃旧目录授权，请重新选择扩展安装目录后重试。',
      toast: '更新目录已变更，请重新选择安装目录'
    };
  }
  return {
    title: '更新失败',
    body: '更新过程中发生未知错误，请根据错误详情检查后重试。',
    toast: '更新失败，请查看错误详情后重试'
  };
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

async function writeBytesToVersionUpdateDirectory(bytes, relativePath) {
  const root = versionUpdateDirectoryHandle;
  return globalThis.BjtuUpdateFileSystem.writeFile(root, relativePath, bytes);
}

async function fetchUpdateArchiveWithProgress(url) {
  const controller = new AbortController();
  let idleTimer = null;
  const startedAt = Date.now();
  resetVersionUpdateFileTree();
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
    if (!response.ok) {
      const error = new Error(`下载更新压缩包失败（HTTP ${response.status}）`);
      error.sourceResponseText = await readShortPlainTextResponse(response);
      throw markVersionUpdateError(error, 'source');
    }
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    setVersionDownloadBar({ visible: true, percent: 0, indeterminate: total <= 0 });
    setVersionDownloadTransferStatus({ loaded: 0, total, speed: 0, eta: null });
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
      const speed = bytes.byteLength / elapsedSeconds;
      setVersionDownloadBar({ visible: true, percent: 100 });
      setVersionDownloadProgressUi({ visible: true, status: `100% · ${formatDownloadBytes(bytes.byteLength)}`, title: '正在下载更新压缩包', body: '更新压缩包下载完成，正在准备覆盖解压。', phase: 'downloading' });
      setVersionDownloadTransferStatus({ loaded: bytes.byteLength, total: total || bytes.byteLength, speed, eta: 0 });
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    let sampledAt = performance.now();
    let sampledBytes = 0;
    let smoothedSpeed = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      resetIdleTimeout();
      chunks.push(value);
      received += value.byteLength;
      const now = performance.now();
      const sampleDurationMs = now - sampledAt;
      if (sampleDurationMs >= 200) {
        const instantaneousSpeed = Math.max(0, (received - sampledBytes) * 1000 / sampleDurationMs);
        smoothedSpeed = smoothedSpeed > 0
          ? (smoothedSpeed * 0.72 + instantaneousSpeed * 0.28)
          : instantaneousSpeed;
        sampledAt = now;
        sampledBytes = received;
      } else if (smoothedSpeed <= 0) {
        smoothedSpeed = received / Math.max(0.001, (Date.now() - startedAt) / 1000);
      }
      const exactPercent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
      const percent = Math.floor(exactPercent);
      setVersionDownloadBar({ visible: true, percent: exactPercent, indeterminate: total <= 0 });
      setVersionDownloadProgressUi({
        visible: true,
        status: total > 0
          ? `${percent}% · ${formatDownloadBytes(received)} / ${formatDownloadBytes(total)}`
          : `已下载 ${formatDownloadBytes(received)}`,
        title: '正在下载更新压缩包',
        body: '正在下载更新文件，下载完成后将自动覆盖解压。',
        phase: 'downloading'
      });
      setVersionDownloadTransferStatus({
        loaded: received,
        total,
        speed: smoothedSpeed,
        eta: total > received
          ? (smoothedSpeed > 0 ? (total - received) / smoothedSpeed : null)
          : (total > 0 ? 0 : null)
      });
    }
    setVersionDownloadBar({ visible: true, percent: 100 });
    const bytes = new Uint8Array(received);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    setVersionDownloadTransferStatus({
      loaded: received,
      total: total || received,
      speed: smoothedSpeed,
      eta: 0
    });
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) {
      throw markVersionUpdateError(new Error('连接更新源超时（连续 30 秒无响应）'), 'network');
    }
    if (error?.updateStage) throw error;
    throw markVersionUpdateError(error, 'network');
  } finally {
    clearInterval(connectingTimer);
    if (idleTimer) clearTimeout(idleTimer);
  }
}

async function clearVersionUpdateDirectory() {
  const root = versionUpdateDirectoryHandle;
  if (!root) throw new Error('尚未授权更新目录');
  try {
    await validateVersionUpdateDirectory(root);
  } catch (error) {
    throw markVersionUpdateError(error, 'directory');
  }
  setVersionDownloadProgressUi({
    visible: true,
    status: '正在删除旧文件…',
    title: '正在重建更新目录',
    body: `正在删除 ${getVersionUpdateDirectoryDisplayName()} 目录中的旧文件。`,
    phase: 'extracting'
  });
  const names = [];
  try {
    for await (const [name] of root.entries()) names.push(name);
    for (const name of names) {
      try {
        await globalThis.BjtuUpdateFileSystem.removeEntry(root, name, { recursive: true });
      } catch (error) {
        throw new Error(`无法删除更新目录中的“${name}”：${String(error?.message || error)}`);
      }
    }
    const remaining = [];
    for await (const [name] of root.entries()) remaining.push(name);
    if (remaining.length) {
      throw new Error(`更新目录未完全清空，仍有：${remaining.join('、')}`);
    }
  } catch (error) {
    throw markVersionUpdateError(error, 'directory');
  }
  return names.length;
}

function normalizeVersionUpdateScopes(updateRule) {
  if (!Array.isArray(updateRule) || updateRule.length === 0) return null;
  if (updateRule.length === 1 && updateRule[0] === true) return null;
  const scopes = new Set(updateRule
    .filter((value) => typeof value === 'string')
    .map((value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase())
    .filter(Boolean));
  return scopes.size ? scopes : null;
}

function versionUpdateAppliesToSelection(updateRule, selectedModules, knownModules) {
  const scopes = normalizeVersionUpdateScopes(updateRule);
  if (!scopes || scopes.has('main') || [...VERSION_REQUIRED_MODULE_IDS].some((id) => scopes.has(id))) return true;
  if ([...scopes].some((id) => VERSION_ROOT_COMPONENT_IDS.has(id))) return true;
  for (const id of selectedModules || []) {
    if (scopes.has(String(id || '').toLowerCase())) return true;
  }
  for (const id of scopes) {
    if (!knownModules?.has(id)) return true;
  }
  return false;
}

function getVersionArchiveComponent(path) {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) {
    return parts[0].toLowerCase() === 'manifest.json'
      ? { id: 'manifest', module: false, manifest: true }
      : null;
  }
  const first = parts[0].toLowerCase();
  if (VERSION_IGNORED_ARCHIVE_DIRECTORIES.has(first)) return null;
  if (first === 'modules') {
    const id = String(parts[1] || '').toLowerCase();
    return id ? { id, module: true, manifest: false } : null;
  }
  return { id: first, module: false, manifest: false };
}

function selectUpdateArchiveFiles(files, updateRule) {
  const scopes = normalizeVersionUpdateScopes(updateRule);
  return files.filter((item) => {
    const component = getVersionArchiveComponent(item.path);
    if (!component) return false;
    if (!component.module && !component.manifest && !VERSION_ROOT_COMPONENT_IDS.has(component.id)) return false;
    if (!scopes || component.manifest) return true;
    if (component.module) return scopes.has(component.id);
    return scopes.has('main') || scopes.has(component.id);
  });
}

function getArchiveModuleIds(files) {
  return [...new Set((files || []).map((item) => {
    const match = String(item?.path || '').match(/^modules\/([^/]+)\//i);
    return match ? String(match[1] || '').toLowerCase() : '';
  }).filter((id) => id && id !== 've'))];
}

async function getLocalOptionalModuleIds(root = null, { strict = false } = {}) {
  const directory = root || versionUpdateDirectoryHandle || await readVersionUpdateDirectoryHandle();
  if (!directory) {
    if (strict) throw new Error('无法读取扩展安装目录中的 modules 目录');
    return [];
  }
  let modulesDirectory;
  try {
    modulesDirectory = await directory.getDirectoryHandle('modules');
  } catch (error) {
    if (strict) throw new Error(`无法读取扩展安装目录中的 modules 目录：${String(error?.message || error)}`);
    return [];
  }
  const ids = [];
  try {
    for await (const [name, handle] of modulesDirectory.entries()) {
      const id = String(name || '').toLowerCase();
      if (handle?.kind === 'directory' && id && !VERSION_REQUIRED_MODULE_IDS.has(id)) ids.push(id);
    }
  } catch (error) {
    if (strict) throw new Error(`无法枚举扩展安装目录中的模块：${String(error?.message || error)}`);
    return [];
  }
  return ids;
}

function getModuleDisplayName(id, archiveLabels = {}) {
  const key = String(id || '').toLowerCase();
  return String(
    archiveLabels[key]
    || globalThis.BjtuModuleRegistry?.definitions?.[key]?.label
    || globalThis.BjtuModuleRegistry?.definitions?.[key]?.name
    || key
  );
}

async function getArchiveModuleLabels(files) {
  const labels = {};
  const moduleJsonFiles = (files || []).filter((item) => /(^|\/)modules\/[^/]+\/module\.json$/i.test(String(item?.path || '')));
  for (const item of moduleJsonFiles) {
    const match = String(item.path || '').match(/^modules\/([^/]+)\/module\.json$/i);
    const id = String(match?.[1] || '').toLowerCase();
    if (!id || id === 've') continue;
    try {
      const bytes = await inflateZipEntry(item.entry);
      const data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      const name = String(data?.name || data?.label || '').trim();
      if (name) labels[id] = name;
    } catch {
      // Broken module metadata should not hide the module itself.
    }
  }
  return labels;
}

function getArchiveModuleSize(files, moduleId) {
  const prefix = `modules/${String(moduleId || '').toLowerCase()}/`;
  return (files || []).reduce((total, item) => {
    if (!String(item?.path || '').toLowerCase().startsWith(prefix)) return total;
    return total + Math.max(0, Number(item?.entry?.uncompressedSize || 0));
  }, 0);
}

function buildModuleSizeStyle(bytes) {
  return globalThis.BjtuFileSizeEmphasis.buildBytesStyle(bytes);
}

async function rememberUpdateModuleIds(moduleIds, { markInitialized = false } = {}) {
  const stored = await chrome.storage.local.get([
    VERSION_MODULE_KNOWN_IDS_KEY,
    VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY
  ]).catch(() => ({}));
  const previous = stored?.[VERSION_MODULE_KNOWN_IDS_KEY];
  const known = new Set(Array.isArray(previous) ? previous : []);
  for (const id of await getLocalOptionalModuleIds()) known.add(id);
  for (const id of (moduleIds || [])) {
    const normalized = String(id || '').toLowerCase();
    if (normalized && !VERSION_REQUIRED_MODULE_IDS.has(normalized)) known.add(normalized);
  }
  await chrome.storage.local.set({
    [VERSION_MODULE_KNOWN_IDS_KEY]: [...known],
    [VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY]: markInitialized
      || stored?.[VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY] === true
  });
}

function appendUpdateModuleChoice(list, { id, name, moduleSize, checked, disabled }) {
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:7px;margin:0;padding:7px 8px;border:1px solid #dbe2ea;border-radius:6px;';
  if (disabled) label.style.opacity = '0.78';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = id;
  checkbox.checked = !!checked;
  checkbox.disabled = !!disabled;
  checkbox.style.width = 'auto';
  const nameEl = document.createElement('span');
  nameEl.textContent = name;
  const size = document.createElement('span');
  size.className = 'file-size-emphasis update-module-size';
  size.dataset.fileSizeBytes = String(moduleSize);
  size.style.cssText = buildModuleSizeStyle(moduleSize);
  size.textContent = formatDownloadBytes(moduleSize);
  label.append(checkbox, nameEl, size);
  list.appendChild(label);
}

async function chooseUpdateModules(archiveFiles) {
  const packaged = getArchiveModuleIds(archiveFiles);
  const archiveLabels = await getArchiveModuleLabels(archiveFiles);
  const localIds = await getLocalOptionalModuleIds(versionUpdateDirectoryHandle, { strict: true });
  const localIdSet = new Set(localIds);
  const candidates = [...new Set([
    ...localIds,
    ...packaged
  ].filter((id) => !VERSION_REQUIRED_MODULE_IDS.has(id)))];
  if (!candidates.length) return new Set();
  const stored = await chrome.storage.local.get([
    VERSION_MODULE_KNOWN_IDS_KEY,
    VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY
  ]).catch(() => ({}));
  const previousKnown = stored?.[VERSION_MODULE_KNOWN_IDS_KEY];
  const knownIdsInitialized = stored?.[VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY] === true;
  const locallyKnownIds = new Set(knownIdsInitialized && Array.isArray(previousKnown) ? previousKnown : packaged);
  localIds.forEach((id) => locallyKnownIds.add(id));
  const archiveNewModuleIds = new Set(packaged.filter((id) => !locallyKnownIds.has(id)));
  const initial = new Set(candidates.filter((id) => (
    localIdSet.has(id) || archiveNewModuleIds.has(id)
  )));

  return new Promise((resolve) => {
    setVersionDownloadProgressUi({
      visible: true,
      status: '请选择要保留的模块',
      title: '选择更新模块',
      body: '确认后将开始覆盖解压。',
      phase: 'extracting'
    });
    const template = document.getElementById('version-module-selection-template');
    if (!(template instanceof HTMLTemplateElement)) {
      resolve(new Set());
      return;
    }
    const fragment = template.content.cloneNode(true);
    const mask = fragment.firstElementChild;
    if (!(mask instanceof HTMLElement)) {
      resolve(new Set());
      return;
    }
    document.body.appendChild(mask);
    const list = mask.querySelector('[data-module-list]');
    appendUpdateModuleChoice(list, {
      id: 've',
      name: '智慧课程平台',
      moduleSize: getArchiveModuleSize(archiveFiles, 've'),
      checked: true,
      disabled: true
    });
    appendUpdateModuleChoice(list, {
      id: 'updater',
      name: getModuleDisplayName('updater', archiveLabels),
      moduleSize: getArchiveModuleSize(archiveFiles, 'updater'),
      checked: true,
      disabled: true
    });
    candidates.forEach((id) => {
      appendUpdateModuleChoice(list, {
        id,
        name: getModuleDisplayName(id, archiveLabels),
        moduleSize: getArchiveModuleSize(archiveFiles, id),
        checked: initial.has(id),
        disabled: false
      });
    });
    const confirmButton = mask.querySelector('[data-confirm]');
    let autoConfirmTimer = null;
    let confirmInProgress = false;
    const cancelAutoConfirm = () => {
      if (autoConfirmTimer) {
        clearInterval(autoConfirmTimer);
        autoConfirmTimer = null;
      }
      if (confirmButton instanceof HTMLButtonElement && confirmButton.isConnected) {
        confirmButton.textContent = '确定';
      }
    };
    const confirmSelection = async () => {
      if (confirmInProgress) return;
      confirmInProgress = true;
      cancelAutoConfirm();
      const selected = new Set([...list.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value));
      await chrome.storage.local.set({
        [VERSION_MODULE_SELECTION_KEY]: [...selected].filter((id) => !VERSION_REQUIRED_MODULE_IDS.has(id))
      }).catch(() => {});
      mask.remove();
      resolve(selected);
    };
    mask.querySelector('[data-invert]').addEventListener('click', () => {
      list.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((checkbox) => { checkbox.checked = !checkbox.checked; });
      cancelAutoConfirm();
    });
    list.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.matches('input[type="checkbox"]:not(:disabled)')) {
        cancelAutoConfirm();
      }
    });
    confirmButton.addEventListener('click', confirmSelection);
    document.body.appendChild(mask);
    const autoConfirmAt = Date.now() + 3000;
    autoConfirmTimer = setInterval(() => {
      if (!mask.isConnected) {
        cancelAutoConfirm();
        return;
      }
      const remainingMs = autoConfirmAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(autoConfirmTimer);
        autoConfirmTimer = null;
        void confirmSelection();
        return;
      }
      confirmButton.textContent = `确定（${Math.ceil(remainingMs / 1000)} 秒）`;
    }, 100);
  });
}

async function requestModuleManagementDirectory() {
  let handle = versionUpdateDirectoryHandleLoaded ? versionUpdateDirectoryHandle : await readVersionUpdateDirectoryHandle();
  if (handle && typeof handle.requestPermission === 'function') {
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('未获得扩展安装目录写入权限，请重新点击后再试');
    await validateVersionUpdateDirectory(handle);
    versionUpdateDirectoryHandle = handle;
    return handle;
  }
  if (typeof window.showDirectoryPicker !== 'function') throw new Error('当前浏览器不支持目录写入 API');
  handle = await window.showDirectoryPicker({ id: 'bjtu-update-dir', mode: 'readwrite' });
  await validateVersionUpdateDirectory(handle);
  await storeVersionUpdateDirectoryHandle(handle);
  versionUpdateDirectoryHandle = handle;
  return handle;
}

async function directoryFileExists(root, relativePath, expectedSize = 0) {
  if (!root) return false;
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) return false;
  try {
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part);
    }
    const fileHandle = await directory.getFileHandle(parts.at(-1));
    const file = await fileHandle.getFile();
    return expectedSize > 0 ? file.size === expectedSize : file.size > 0;
  } catch {
    return false;
  }
}

async function removeDirectoryFile(root, relativePath) {
  if (!root) throw new Error('尚未授权更新目录');
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`扩展文件路径无效：${relativePath}`);
  }
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part);
  }
  await globalThis.BjtuUpdateFileSystem.removeEntry(directory, parts.at(-1), { recursive: false });
}

async function readDirectoryFile(root, relativePath) {
  if (!root) throw new Error('尚未授权更新目录');
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`扩展文件路径无效：${relativePath}`);
  }
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part);
  }
  return (await directory.getFileHandle(parts.at(-1))).getFile();
}

async function captchaCoreExistsInDirectory(root = null) {
  const assets = globalThis.BjtuCaptchaAssets;
  if (!assets) return false;
  const directory = root || await getWritableVersionUpdateDirectory();
  if (!directory) return false;
  return directoryFileExists(directory, assets.CORE_RELATIVE_PATH, assets.CORE_SIZE);
}

async function prepareCaptchaAssets({
  interactive = true,
  modelReady = false,
  root = null,
  onProgress = null
} = {}) {
  const assets = globalThis.BjtuCaptchaAssets;
  if (!assets) throw new Error('验证码资源管理器未加载');
  if (!modelReady) await assets.ensureModel({ onProgress });

  let directory = root;
  if (!directory) {
    directory = interactive
      ? await requestModuleManagementDirectory()
      : await getWritableVersionUpdateDirectory();
  }
  if (!directory) {
    const coreReady = await assets.extensionCoreExists();
    return {
      modelReady: true,
      coreReady,
      corePending: !coreReady,
      written: 0
    };
  }
  if (await directoryFileExists(directory, assets.CORE_RELATIVE_PATH, assets.CORE_SIZE)) {
    return { modelReady: true, coreReady: true, corePending: false, written: 0 };
  }
  const coreBytes = await assets.downloadCore({ onProgress });
  onProgress?.({ phase: 'write', path: assets.CORE_RELATIVE_PATH, completed: 0, total: 1 });
  await globalThis.BjtuUpdateFileSystem.writeFile(directory, assets.CORE_RELATIVE_PATH, coreBytes);
  versionSupplementalReloadRequired = true;
  onProgress?.({ phase: 'write', path: assets.CORE_RELATIVE_PATH, completed: 1, total: 1 });
  return { modelReady: true, coreReady: true, corePending: false, written: 1 };
}

async function fetchModuleArchive(onProgress) {
  onProgress?.({ phase: 'download', loaded: 0, total: 0 });
  const release = await fetchLatestReleaseFromUrl(VERSION_LATEST_URL);
  const response = await fetch(pickReleaseDownloadUrl(release), { cache: 'no-store' });
  if (!response.ok) throw new Error(`模块下载失败 (${response.status})`);
  const total = Math.max(0, Number(response.headers.get('content-length') || 0));
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ phase: 'download', loaded: bytes.byteLength, total: total || bytes.byteLength });
    return { bytes, release };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ phase: 'download', loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  return { bytes, release };
}

async function applyModuleSelection({ selected = [], installed = [], onProgress = null } = {}) {
  const selectedSet = new Set(selected.map((id) => String(id || '').toLowerCase()));
  const installedSet = new Set(installed.map((id) => String(id || '').toLowerCase()));
  selectedSet.add('updater');
  const additions = [...selectedSet].filter((id) => id !== 'updater' && !installedSet.has(id));
  const removals = [...installedSet].filter((id) => !VERSION_REQUIRED_MODULE_IDS.has(id) && !selectedSet.has(id));
  if (!additions.length && !removals.length) {
    return { added: [], removed: [], written: 0, reload: false };
  }

  await requestModuleManagementDirectory();
  let archiveFiles = [];
  if (additions.length) {
    const archive = await fetchModuleArchive(onProgress);
    const bytes = archive.bytes;
    const entries = parseZipEntries(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const root = getZipCommonRoot(entries);
    archiveFiles = entries.filter((entry) => !entry.directory)
      .map((entry) => ({ entry, path: normalizeUpdateEntryPath(entry.name, root) }))
      .filter((item) => item.path && additions.some((id) => item.path.toLowerCase().startsWith(`modules/${id}/`)));
    for (const id of additions) {
      if (!archiveFiles.some((item) => item.path.toLowerCase().startsWith(`modules/${id}/`))) {
        throw new Error(`更新包中未找到 ${getModuleDisplayName(id)} 模块`);
      }
    }
  }
  if (removals.includes('captcha')) {
    if (chrome.offscreen?.closeDocument) {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
    const assets = globalThis.BjtuCaptchaAssets;
    if (!assets?.deleteDatabases) throw new Error('验证码资源管理器未加载，无法清理识别模型数据库');
    await assets.deleteDatabases();
  }

  let written = 0;
  await globalThis.BjtuUpdateFileSystem.withInstallLock(async () => {
    let modulesDirectory;
    try {
      modulesDirectory = await versionUpdateDirectoryHandle.getDirectoryHandle('modules', { create: true });
    } catch (error) {
      throw markVersionUpdateError(error, 'directory');
    }
    for (const id of additions) {
      await globalThis.BjtuUpdateFileSystem.removeEntry(modulesDirectory, id, { recursive: true }).catch((error) => {
        if (error?.name !== 'NotFoundError') throw error;
      });
    }
    const totalWrites = archiveFiles.length;
    for (const item of archiveFiles) {
      const inflated = await inflateZipEntry(item.entry);
      await writeBytesToVersionUpdateDirectory(inflated, item.path);
      written += 1;
      onProgress?.({ phase: 'write', completed: written, total: totalWrites, path: item.path });
    }
    const orderedRemovals = removals.sort((a, b) => (a === 'updater' ? 1 : 0) - (b === 'updater' ? 1 : 0));
    for (const id of orderedRemovals) {
      await globalThis.BjtuUpdateFileSystem.removeEntry(modulesDirectory, id, { recursive: true }).catch((error) => {
        if (error?.name !== 'NotFoundError') throw error;
      });
    }
  });
  await chrome.storage.local.set({ [VERSION_MODULE_SELECTION_KEY]: [...selectedSet].filter((id) => !VERSION_REQUIRED_MODULE_IDS.has(id)) });
  await rememberUpdateModuleIds([...installedSet, ...selectedSet]);
  return {
    added: additions,
    removed: removals,
    written,
    reload: true
  };
}

globalThis.BjtuUpdaterModuleManager = Object.freeze({
  prepare: () => readVersionUpdateDirectoryHandle(),
  requestDirectory: requestModuleManagementDirectory,
  managedFileExists: async (relativePath, root = null) => {
    const directory = root || await getWritableVersionUpdateDirectory();
    return directoryFileExists(directory, relativePath);
  },
  managedFileSize: async (relativePath, root = null) => {
    const directory = root || await getWritableVersionUpdateDirectory();
    if (!directory) return 0;
    try {
      const file = await readDirectoryFile(directory, relativePath);
      return Math.max(0, Number(file?.size) || 0);
    } catch {
      return 0;
    }
  },
  writeManagedFile: (root, relativePath, bytes) => globalThis.BjtuUpdateFileSystem.writeFile(root, relativePath, bytes),
  readManagedFile: readDirectoryFile,
  removeManagedFile: removeDirectoryFile,
  applyModuleSelection,
  prepareCaptchaAssets,
  captchaCoreExistsInDirectory
});

function filterFilesByModules(files, selectedModules) {
  return files.filter((item) => {
    const match = String(item?.path || '').match(/^modules\/([^/]+)\//i);
    if (!match || VERSION_REQUIRED_MODULE_IDS.has(match[1].toLowerCase())) return true;
    const id = match[1].toLowerCase();
    return selectedModules.has(id);
  });
}

async function removeUnselectedModuleDirectories(selectedModules) {
  const root = versionUpdateDirectoryHandle;
  let modulesDirectory;
  try {
    modulesDirectory = await root.getDirectoryHandle('modules');
  } catch {
    return;
  }
  for (const id of await getLocalOptionalModuleIds(root)) {
    if (selectedModules.has(id)) continue;
    await globalThis.BjtuUpdateFileSystem.removeEntry(modulesDirectory, id, { recursive: true }).catch((error) => {
      if (error?.name !== 'NotFoundError') throw error;
    });
  }
}

async function cleanVersionUpdateScopes(updateRule, selectedModules) {
  const root = versionUpdateDirectoryHandle;
  const scopes = normalizeVersionUpdateScopes(updateRule);
  if (!scopes) {
    await clearVersionUpdateDirectory();
    return;
  }
  if (scopes.has('main')) {
    const names = [];
    for await (const [name] of root.entries()) {
      if (name !== 'modules' && name !== 'manifest.json') names.push(name);
    }
    for (const name of names) {
      await globalThis.BjtuUpdateFileSystem.removeEntry(root, name, { recursive: true }).catch((error) => {
        if (error?.name !== 'NotFoundError') throw error;
      });
    }
  }
  for (const id of scopes) {
    if (!VERSION_ROOT_COMPONENT_IDS.has(id)) continue;
    const directoryName = VERSION_ROOT_COMPONENT_DIRECTORY_NAMES[id] || id;
    for (const candidate of new Set([directoryName, id])) {
      await globalThis.BjtuUpdateFileSystem.removeEntry(root, candidate, { recursive: true }).catch((error) => {
        if (error?.name !== 'NotFoundError') throw error;
      });
    }
  }
  let modulesDirectory;
  try {
    modulesDirectory = await root.getDirectoryHandle('modules');
  } catch {
    return;
  }
  for (const id of scopes) {
    if (!scopes.has(id)) continue;
    if (!VERSION_REQUIRED_MODULE_IDS.has(id) && !selectedModules.has(id)) continue;
    await globalThis.BjtuUpdateFileSystem.removeEntry(modulesDirectory, id, { recursive: true }).catch((error) => {
      if (error?.name !== 'NotFoundError') throw error;
    });
  }
}

async function extractUpdateArchiveToDirectory(archiveBytes, updateRule = null, cleanUpdate = false) {
  setVersionDownloadBar({ visible: true, percent: 0 });
  setVersionDownloadProgressUi({
    visible: true,
    status: '正在解析更新压缩包…',
    title: '正在覆盖解压',
    body: `正在将更新文件直接覆盖到 ${getVersionUpdateDirectoryDisplayName()} 目录。`,
    phase: 'extracting'
  });
  const bytes = archiveBytes instanceof Uint8Array ? archiveBytes : new Uint8Array(archiveBytes || 0);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let entries;
  try {
    entries = parseZipEntries(arrayBuffer);
  } catch (error) {
    throw markVersionUpdateError(error, 'archive');
  }
  const commonRoot = getZipCommonRoot(entries);
  const archiveFiles = entries
    .filter((entry) => !entry.directory)
    .map((entry) => ({ entry, path: normalizeUpdateEntryPath(entry.name, commonRoot) }))
    .filter((item) => item.path);
  const packagedModuleIds = getArchiveModuleIds(archiveFiles);
  const selectedModules = await chooseUpdateModules(archiveFiles);
  VERSION_REQUIRED_MODULE_IDS.forEach((id) => selectedModules.add(id));
  if (cleanUpdate) await cleanVersionUpdateScopes(updateRule, selectedModules);
  else await removeUnselectedModuleDirectories(selectedModules);
  const selectedArchiveFiles = selectUpdateArchiveFiles(archiveFiles, updateRule);
  if (!selectedArchiveFiles.length) throw markVersionUpdateError(new Error('更新压缩包中没有可写入文件'), 'archive');
  const files = filterFilesByModules(selectedArchiveFiles, selectedModules);
  if (!files.length) {
    await rememberUpdateModuleIds(packagedModuleIds, { markInitialized: true });
    return 0;
  }

  renderVersionUpdateFileTree(files);
  let completedCount = 0;
  let completedBytes = 0;
  const totalBytes = files.reduce((total, item) => (
    total + Math.max(0, Number(item?.entry?.uncompressedSize) || 0)
  ), 0);
  const writeStartedAt = performance.now();
  setVersionDownloadProgressUi({
    visible: true,
    status: '正在准备覆盖文件…',
    title: '正在覆盖解压',
    body: `正在将更新文件直接覆盖到 ${getVersionUpdateDirectoryDisplayName()} 目录。`,
    phase: 'extracting'
  });
  setVersionDownloadTransferStatus({ loaded: 0, total: totalBytes, speed: 0, eta: null, percent: 0 });
  const results = await Promise.allSettled(files.map(async (item) => {
    setVersionUpdateFileState(item.path, 'extracting');
    setVersionUpdateFileSummary({
      completed: completedCount,
      total: files.length,
      path: item.path,
      state: 'extracting'
    });
    let inflated;
    try {
      inflated = await inflateZipEntry(item.entry);
    } catch (error) {
      setVersionUpdateFileState(item.path, 'failed');
      setVersionUpdateFileSummary({
        completed: completedCount,
        total: files.length,
        path: item.path,
        state: 'failed'
      });
      throw markVersionUpdateError(error, 'archive');
    }
    setVersionUpdateFileState(item.path, 'writing');
    setVersionUpdateFileSummary({
      completed: completedCount,
      total: files.length,
      path: item.path,
      state: 'writing'
    });
    try {
      await writeBytesToVersionUpdateDirectory(inflated, item.path);
    } catch (error) {
      setVersionUpdateFileState(item.path, 'failed');
      setVersionUpdateFileSummary({
        completed: completedCount,
        total: files.length,
        path: item.path,
        state: 'failed'
      });
      throw markVersionUpdateError(error, 'directory');
    }
    completedCount += 1;
    completedBytes += inflated.byteLength;
    setVersionUpdateFileState(item.path, 'done');
    const elapsedSeconds = Math.max(0.001, (performance.now() - writeStartedAt) / 1000);
    const speed = completedBytes / elapsedSeconds;
    const exactPercent = (completedCount / files.length) * 100;
    setVersionDownloadBar({ visible: true, percent: exactPercent });
    setVersionDownloadProgressUi({
      visible: true,
      status: '正在覆盖更新文件…',
      title: '正在覆盖解压',
      body: `正在将更新文件直接覆盖到 ${getVersionUpdateDirectoryDisplayName()} 目录。`,
      phase: 'extracting'
    });
    setVersionDownloadTransferStatus({
      loaded: completedBytes,
      total: totalBytes,
      speed,
      eta: completedCount < files.length
        ? elapsedSeconds * (files.length - completedCount) / completedCount
        : 0,
      percent: exactPercent
    });
    setVersionUpdateFileSummary({
      completed: completedCount,
      total: files.length,
      path: item.path,
      state: 'done'
    });
  }));
  const failedResult = results.find((result) => result.status === 'rejected');
  if (failedResult) throw failedResult.reason;
  await rememberUpdateModuleIds(packagedModuleIds, { markInitialized: true });
  return files.length;
}

async function downloadVersionByUrlWithProgress(url) {
  const finalUrl = String(url || '').trim();
  if (!finalUrl) throw new Error('下载链接为空');
  if (!versionUpdateDirectoryHandle) throw new Error('尚未授权更新目录');

  versionSupplementalReloadRequired = false;
  const archiveBytes = await fetchUpdateArchiveWithProgress(finalUrl);
  const updateRule = versionDownloadFullExtraction
    ? null
    : versionButtonLatestUpdate;
  const fileCount = await globalThis.BjtuUpdateFileSystem.withInstallLock(() => (
    extractUpdateArchiveToDirectory(archiveBytes, updateRule, !versionDownloadFullExtraction && versionButtonLatestClean)
  ));
  const reloadRequired = versionButtonLatestReload || versionSupplementalReloadRequired;
  const forcedUpdate = versionButtonLatestForce;
  const appliedRecord = {
    ver: versionButtonLatestVersion,
    name: versionButtonLatestDisplayVersion,
    reload: reloadRequired,
    force: forcedUpdate,
    fileCount,
    appliedAt: Date.now(),
    autoReloadRequestedAt: reloadRequired ? Date.now() : 0
  };
  if (reloadRequired) {
    await setLocal(VERSION_PENDING_RELOAD_KEY, appliedRecord);
    suppressVersionNoticeForDownload();
    await scheduleAutomaticExtensionReload({
      fileCount,
      displayVersion: versionButtonLatestDisplayVersion
    });
    return;
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
      update: versionButtonLatestUpdate,
      clean: versionButtonLatestClean
    });
  }
  setVersionDownloadCompletionUi({ reloadRequired, fileCount, displayVersion: versionButtonLatestDisplayVersion });
  suppressVersionNoticeForDownload();
}

async function startVersionDownloadWithFallback(downloadUrl, source = '', fullExtraction = false) {
  suppressVersionNoticeForDownload();
  if (versionDownloadInProgress) {
    openVersionDownloadProgressModal();
    return;
  }
  setVersionDownloadReleaseNotes(versionButtonLatestBodyMarkdown || '暂无更新说明。');
  const writableDirectory = await getWritableVersionUpdateDirectory();
  if (!writableDirectory) {
    showVersionUpdateDirectoryRequired(downloadUrl, source, fullExtraction);
    return;
  }
  versionUpdateDirectoryHandle = writableDirectory;
  versionDownloadMinimized = false;

  versionDownloadInProgress = true;
  syncVersionNoticeDownloadButton();
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
    || (primaryUrl === VERSION_DOWNLOAD_URL ? 'main' : 'zipball');
  versionDownloadSelectedSource = selectedSource;
  versionDownloadSelectedUrl = primaryUrl;
  // 开发版来自 main 分支完整仓库，不能继续套用正式版发布记录的局部 updateRule。
  versionDownloadFullExtraction = selectedSource === 'main' || fullExtraction === true;
  try {
    await downloadVersionByUrlWithProgress(primaryUrl);
    // 成功 UI 已在 downloadVersionByUrlWithProgress 内部处理
  } catch (err) {
    let displayError = err;
    if (globalThis.BjtuUpdateFileSystem.isInvalidStateError(err)) {
      await storeVersionUpdateDirectoryHandle(null).catch(() => {});
      displayError = markVersionUpdateError(
        new Error('更新目录的磁盘状态已变更，需要重新选择扩展安装目录'),
        'directory-state'
      );
    }
    const errorMessage = String(displayError?.message || '未知错误');
    const failure = getVersionUpdateFailurePresentation(displayError);
    setVersionDownloadProgressUi({
      visible: true,
      status: `更新失败：${errorMessage}`,
      title: failure.title,
      body: failure.body,
      phase: 'failed'
    });
    setVersionDownloadRetryVisible(true);
    showToast(failure.toast, 'error', 3200);
  }
  versionDownloadInProgress = false;
  syncVersionNoticeDownloadButton();
}

function setVersionButtonState(mode, { localVersion = '', latestVersion = '', latestDisplayVersion = '', latestPublishedAt = '', downloadUrl = '', body = '', zipballUrl = '', reload = true, force = false, update = null, clean = false } = {}) {
  const versionBtn = document.getElementById('version-btn');
  if (!versionBtn) return;
  versionBtn.style.display = '';
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
  versionButtonLatestClean = clean === true;

  versionBtn.className = `version-btn ${versionButtonMode}`;
  versionBtn.disabled = !(versionButtonMode === 'failure' || versionButtonMode === 'outdated' || versionButtonMode === 'latest' || versionButtonMode === 'ahead');

  if (versionButtonMode === 'loading') {
    versionBtn.innerHTML = '<span class="version-btn-spinner"></span><span>获取最新版本中...</span>';
    return;
  }
  if (versionButtonMode === 'failure') {
    versionBtn.innerHTML = `<span>当前版本：${escapeHtml(localVersion || '--')}</span>`;
    versionBtn.querySelectorAll('.version-btn-spinner').forEach((spinner) => spinner.remove());
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
  let releaseInfo;
  try {
    releaseInfo = JSON.parse(String(await response.text()).replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('更新源 JSON 解析失败');
  }
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
    update: Array.isArray(releaseInfo?.update) ? releaseInfo.update : null,
    clean: releaseInfo?.clean === true
  };
}

async function fetchFallbackLatestRelease() {
  if (versionLatestReleaseRequestPromise) return versionLatestReleaseRequestPromise;
  versionLatestReleaseRequestPromise = fetchLatestReleaseFromUrl(VERSION_LATEST_URL)
    .finally(() => { versionLatestReleaseRequestPromise = null; });
  return versionLatestReleaseRequestPromise;
}

function queueHigherVersionRelease(release) {
  const tag = getReleaseTagVersion(release);
  if (!tag || compareVersionText(tag, versionButtonLatestVersion) <= 0) return;
  if (!versionQueuedRelease || compareVersionText(tag, getReleaseTagVersion(versionQueuedRelease)) > 0) {
    versionQueuedRelease = release;
  }
  if (!versionInfoLoadPromise) loadVersionInfo().catch(() => {});
}

async function loadVersionInfoInternal(releaseOverride = null) {
  const isPopupPage = typeof popupMode !== 'undefined' && popupMode;
  const autoUpdateParam = !isPopupPage ? (() => {
    try {
      return new URL(location.href).searchParams.get('autoUpdate');
    } catch {
      return '';
    }
  })() : '';
  const autoUpdateRequested = autoUpdateParam === '1' || autoUpdateParam === '2';
  const autoUpdateChannel = autoUpdateParam === '2' ? 2 : 1;
  let fullscreenUpdateRequest = null;
  if (autoUpdateRequested) {
    fullscreenUpdateRequest = await getLocal(VERSION_FULLSCREEN_REQUEST_KEY, null);
    await setLocal(VERSION_FULLSCREEN_REQUEST_KEY, null);
    removeAutoUpdateQueryParameter();
  }
  const manifestVersion = String(chrome.runtime.getManifest().version || '').trim();
  let appliedWithoutReload = await getLocal(VERSION_APPLIED_WITHOUT_RELOAD_KEY, null);
  let pendingReload = await getLocal(VERSION_PENDING_RELOAD_KEY, null);
  let completedAutoReload = await getLocal(VERSION_AUTO_RELOAD_COMPLETED_KEY, null);
  if (appliedWithoutReload?.ver && compareVersionText(manifestVersion, appliedWithoutReload.ver) >= 0) {
    appliedWithoutReload = null;
    await setLocal(VERSION_APPLIED_WITHOUT_RELOAD_KEY, null);
  }
  if (pendingReload?.ver && compareVersionText(manifestVersion, pendingReload.ver) >= 0) {
    pendingReload = null;
    await setLocal(VERSION_PENDING_RELOAD_KEY, null);
    completedAutoReload = null;
    await setLocal(VERSION_AUTO_RELOAD_COMPLETED_KEY, null);
  }
  const localVersion = appliedWithoutReload?.ver && compareVersionText(appliedWithoutReload.ver, manifestVersion) > 0
    ? String(appliedWithoutReload.ver)
    : manifestVersion;
  versionIgnoredTag = String(await getLocal(VERSION_IGNORE_KEY, '') || '').trim();
  setVersionButtonState('loading', { localVersion });

  try {
    const releases = [releaseOverride || await fetchFallbackLatestRelease()];
    const latestRelease = pickLatestStableRelease(releases);
    const latestTag = getReleaseTagVersion(latestRelease);
    const latestDisplayVersion = getReleaseDisplayVersion(latestRelease) || latestTag;
    const latestReload = latestRelease?.reload !== false;
    const latestForce = latestRelease?.force === true;
    const latestUpdate = Array.isArray(latestRelease?.update) ? latestRelease.update : null;
    const latestClean = latestRelease?.clean === true;
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
        update: latestUpdate,
        clean: latestClean
      });
      const requestedAt = Number(fullscreenUpdateRequest?.requestedAt) || 0;
      const requestIsFresh = autoUpdateRequested && requestedAt > 0 && Date.now() - requestedAt < 5 * 60 * 1000;
      if (requestIsFresh) {
        await startVersionDownloadWithFallback(
          String(fullscreenUpdateRequest?.url || '').trim() || (autoUpdateChannel === 2 ? VERSION_DOWNLOAD_URL : pickReleaseDownloadUrl(latestRelease)),
          String(fullscreenUpdateRequest?.source || '').trim() || (autoUpdateChannel === 2 ? 'main' : 'zipball'),
          fullscreenUpdateRequest?.fullExtraction === true
        );
      }
      return;
    }
    if (cmp > 0) {
      const localModuleIds = await getLocalOptionalModuleIds();
      const selectedModules = new Set(localModuleIds);
      const storedKnownModules = await chrome.storage.local.get([
        VERSION_MODULE_KNOWN_IDS_KEY,
        VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY
      ]).catch(() => ({}));
      const previousKnown = storedKnownModules?.[VERSION_MODULE_KNOWN_IDS_KEY];
      const knownIdsInitialized = storedKnownModules?.[VERSION_MODULE_KNOWN_IDS_INITIALIZED_KEY] === true;
      const knownModules = new Set(knownIdsInitialized && Array.isArray(previousKnown) ? previousKnown : []);
      localModuleIds.forEach((id) => knownModules.add(id));
      if (!knownIdsInitialized) {
        for (const id of normalizeVersionUpdateScopes(latestUpdate) || []) knownModules.add(id);
      }
      VERSION_REQUIRED_MODULE_IDS.forEach((id) => selectedModules.add(id));
      if (!versionUpdateAppliesToSelection(latestUpdate, selectedModules, knownModules)) {
        const skippedRecord = {
          ver: latestTag,
          name: latestDisplayVersion,
          reload: false,
          force: latestForce,
          fileCount: 0,
          skippedByModuleSelection: true,
          appliedAt: Date.now()
        };
        await setLocal(VERSION_APPLIED_WITHOUT_RELOAD_KEY, skippedRecord);
        await setLocal(VERSION_PENDING_RELOAD_KEY, null);
        versionButtonLocalVersion = latestTag;
        setVersionButtonState('latest', {
          localVersion: latestTag,
          latestVersion: latestTag,
          latestDisplayVersion,
          latestPublishedAt: latestRelease?.published_at || '',
          zipballUrl: latestRelease?.zipball_url || '',
          body: buildAllReleaseNotes(releases, latestTag, true),
          reload: false,
          force: latestForce,
          update: latestUpdate,
          clean: latestClean
        });
        return;
      }
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
        update: latestUpdate,
        clean: latestClean
      });
      const pendingSameReload = latestReload
        && normalizeVersionText(pendingReload?.ver) === normalizeVersionText(latestTag);
      if (pendingSameReload) {
        setVersionDownloadReleaseNotes(versionButtonLatestBodyMarkdown || '暂无更新说明。');
        const lastAutoReloadAt = Number(pendingReload?.autoReloadRequestedAt) || 0;
        const completedReloadAt = Number(completedAutoReload?.completedAt) || 0;
        const completedSameReload = normalizeVersionText(completedAutoReload?.ver) === normalizeVersionText(latestTag)
          && completedReloadAt >= lastAutoReloadAt;
        const legacyReloadRecentlyRequested = !completedReloadAt
          && lastAutoReloadAt > 0
          && Date.now() - lastAutoReloadAt < 5 * 60 * 1000;
        if (completedSameReload || legacyReloadRecentlyRequested) {
          if (normalizeVersionText(manifestVersion) !== normalizeVersionText(latestTag)) {
            showVersionReloadMismatchUi(manifestVersion, latestTag);
          }
          return;
        }
        if (isPopupPage) {
          await handoffUpdateToFullscreen(pickReleaseDownloadUrl(latestRelease), 'zipball');
          return;
        }
        if (Date.now() - lastAutoReloadAt >= 60 * 1000) {
          pendingReload = { ...pendingReload, autoReloadRequestedAt: Date.now() };
          await setLocal(VERSION_PENDING_RELOAD_KEY, pendingReload);
          await scheduleAutomaticExtensionReload({
            fileCount: Number(pendingReload?.fileCount) > 0 ? Number(pendingReload.fileCount) : 0,
            displayVersion: latestDisplayVersion
          });
          return;
        }
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
          requestedUrl || (autoUpdateChannel === 2 ? VERSION_DOWNLOAD_URL : pickReleaseDownloadUrl(latestRelease)),
          requestedSource || (autoUpdateChannel === 2 ? 'main' : 'zipball'),
          requestIsFresh && fullscreenUpdateRequest?.fullExtraction === true
        );
        return;
      }
      const ignoredSameVersion = normalizeVersionText(versionIgnoredTag) === normalizeVersionText(latestTag);
      if (!versionNoticeSuppressedByDownload && !ignoredSameVersion && versionNoticeShownVersion !== latestTag) {
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
    if (autoUpdateRequested) {
      const requestedAt = Number(fullscreenUpdateRequest?.requestedAt) || 0;
      const requestIsFresh = requestedAt > 0 && Date.now() - requestedAt < 5 * 60 * 1000;
      const requestedUrl = requestIsFresh ? String(fullscreenUpdateRequest?.url || '').trim() : '';
      const requestedSource = requestIsFresh ? String(fullscreenUpdateRequest?.source || '').trim() : '';
      await startVersionDownloadWithFallback(
        requestedUrl || (autoUpdateChannel === 2 ? VERSION_DOWNLOAD_URL : pickReleaseDownloadUrl(latestRelease)),
        requestedSource || (autoUpdateChannel === 2 ? 'main' : 'zipball'),
        requestIsFresh && fullscreenUpdateRequest?.fullExtraction === true
      );
      return;
    }
  } catch (err) {
    setVersionButtonState('failure', { localVersion });
    const msg = String(err?.message || '').trim();
    const base = '检查更新失败：无法连接更新源';
    const text = msg ? `${base}\n${msg}` : base;
    showToast(text, 'error', 2600, false, { preserveInfoToasts: true });
  }
}

async function loadVersionInfo(releaseOverride = null) {
  if (releaseOverride) queueHigherVersionRelease(releaseOverride);
  if (versionInfoLoadPromise) return versionInfoLoadPromise;

  const queued = versionQueuedRelease;
  versionQueuedRelease = null;
  versionInfoLoadPromise = loadVersionInfoInternal(queued || releaseOverride)
    .finally(() => { versionInfoLoadPromise = null; });
  await versionInfoLoadPromise;

  if (versionQueuedRelease
      && compareVersionText(getReleaseTagVersion(versionQueuedRelease), versionButtonLatestVersion) > 0) {
    return loadVersionInfo();
  }
  versionQueuedRelease = null;
  return null;
}

// -- 注册版本按钮点击事件 --

function setupVersionButton() {
  const versionBtn = document.getElementById('version-btn');
  if (!versionBtn) return;

  // 确保版本按钮区域可见
  const versionInfoEl = document.getElementById('version-info');
  if (versionInfoEl) versionInfoEl.style.display = '';
  versionBtn.style.display = '';

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
