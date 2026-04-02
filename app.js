// Native extension page implementing upload.html-like UI without Python backend.
// NOTE: Captcha OCR is not available in pure extension mode.

const PLATFORM_BASE_URL = 'http://123.121.147.7:88/';
const BASE = PLATFORM_BASE_URL.replace(/\/$/, '');
const BASE_VE = `${PLATFORM_BASE_URL}ve/`;
const VE_LOGIN_LINK_HTML = `<a href="${BASE_VE}" target="_blank" rel="noopener noreferrer" style="color:#0f766e; text-decoration:none; font-weight:600;">智慧课程平台</a>`;
const VE_LOGIN_REQUIRED_HTML = `如需查看${VE_LOGIN_LINK_HTML}作业，请前往登录`;
const YKT_BASE = 'https://www.yuketang.cn';
const YKT_EXAM_BASE = 'https://examination.xuetangx.com';
const YKT_COURSE_LIST_API = `${YKT_BASE}/v2/api/web/courses/list?identity=2`;
const YKT_HEADERS = {
  'uv-id': '0',
  'xt-agent': 'web',
  xtbz: 'ykt',
  Accept: 'application/json, text/plain, */*'
};
const MRZY_API_BASE = 'https://lulu.lulufind.com';
const MRZY_WEB_BASE = 'https://zuoye.lulufind.com';
const MRZY_WORK_LIST_API = `${MRZY_API_BASE}/mrzy/mrzypc/findWorkNewVersion`;
const MRZY_WORK_DETAIL_API = `${MRZY_API_BASE}/mrzy/mrzypc/getWorkDetail`;
const JLGJ_API_BASE = 'https://i-api.jielong.com';
const JLGJ_WEB_BASE = 'https://i.jielong.com/my-class';
const JLGJ_GROUP_LIST_API = `${JLGJ_API_BASE}/api/UserGroup/UserGroupPages`;
const XQ_CODE = '2025202602';
const DEFAULT_PLATFORM_SESSION_ID = 'D571D57D255EA0BECF299C45D4C0468A';

// Platform header `sessionId` is maintained at runtime (NOT saved in settings).
let runtimePlatformSessionId = DEFAULT_PLATFORM_SESSION_ID;

// DOM
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const usernameInput = document.getElementById('username-input');
const jsessionidInput = document.getElementById('jsessionid-input');
const totalServerBar = document.getElementById('total-server-bar');
const totalSizeInfoDiv = document.getElementById('total-size-info');
const totalPercentDiv = document.getElementById('total-percent');
const totalEtaDiv = document.getElementById('total-eta');
const copyAllBtn = document.getElementById('copy-all-btn');
const resourceSpaceSection = document.getElementById('resource-space-section');
const resourceSpaceStatus = document.getElementById('resource-space-status');
const resourceSpaceList = document.getElementById('resource-space-list');
const resourceCopySelectedBtn = document.getElementById('resource-copy-selected-btn');
const resourceDownloadSelectedBtn = document.getElementById('resource-download-selected-btn');
const resourceSpaceCount = document.getElementById('resource-space-count');
const resourceTotalBar = document.getElementById('resource-download-total-bar');
const resourceTotalSizeInfo = document.getElementById('resource-download-total-size');
const resourceTotalPercent = document.getElementById('resource-download-total-percent');
const resourceTotalSpeed = document.getElementById('resource-download-total-speed');
const resourceTotalEta = document.getElementById('resource-download-total-eta');
const courseListDiv = document.getElementById('course-list');
const courseLoadingStatus = document.getElementById('course-loading-status');
const rightColumn = document.getElementById('right-column');
const rightColumnResizer = document.getElementById('right-column-resizer');
const veStatusBtn = document.getElementById('ve-status-btn');
const yktStatusBtn = document.getElementById('ykt-status-btn');
const mrzyStatusBtn = document.getElementById('mrzy-status-btn');
const jlgjStatusBtn = document.getElementById('jlgj-status-btn');
const versionBtn = document.getElementById('version-btn');

// Login modal
const loginModal = document.getElementById('login-modal');
const loginModalTitle = document.getElementById('login-modal-title');
const captchaImg = document.getElementById('captcha-img');
const captchaInput = document.getElementById('captcha-input');
const loginBtn = document.getElementById('login-btn');
const cancelBtn = document.getElementById('cancel-btn');
const loginProgressText = document.getElementById('login-progress-text');
const captchaHistoryList = document.getElementById('captcha-history-list');
const auxContainer = document.getElementById('aux-login-container');
const auxCheckbox = document.getElementById('aux-login-checkbox');

if (usernameInput) {
  usernameInput.setAttribute('inputmode', 'numeric');
  usernameInput.setAttribute('pattern', '[0-9]*');
  usernameInput.addEventListener('input', () => {
    const normalized = String(usernameInput.value || '').replace(/\D/g, '');
    if (usernameInput.value !== normalized) usernameInput.value = normalized;
  });
}

// Upload state
const uploadQueue = [];
let activeUploads = 0;
let maxParallelUploads = 3;
let pendingLoginCallbacks = [];
let isLoginSessionValid = true;
window.filesData = {}; // {fileId: {size, uploaded}}
window.courseHomeworkData = {};
window.yktMatchedHomeworkByCourseId = {}; // {courseId: YktHomework[]}
window.yktMatchedCourseLinkByCourseId = {}; // {courseId: yktCourseUrl}
window.yktStandaloneCourses = []; // YktCourse[]
window.yktCourseGroupsSnapshot = []; // [{token,name,teacher_name,classroom_id,course_name,homeworks}]
window.yktHomeworkLoadingByCourse = {}; // {courseId: boolean}
window.mrzyMatchedHomeworkByCourseId = {}; // {courseId: MrzyHomework[]}
window.mrzyStandaloneCourses = []; // MrzyCourse[]
window.mrzyCourseGroupsSnapshot = []; // [{token,divClass,classNum,teacherName,homeworks}]
window.jlgjMatchedHomeworkByCourseId = {}; // {courseId: JlgjHomework[]}
window.jlgjStandaloneCourses = []; // JlgjCourse[]
window.jlgjCourseGroupsSnapshot = []; // [{token,name,groupId,homeworks}]
window.jlgjRequestHeaders = {}; // {authorization,xApiRequestPayload}
window.courseCardStateById = {}; // {courseId: {allHomeworkCount,pendingHomeworkCount,hasReplay}}
window.videoReplayCacheByCourseId = {}; // {courseId: {html: string, loaded: boolean}}
window.coursewareCacheByCourseId = {}; // {courseId: {html: string, loaded: boolean}}
window.platformNeedLogin = { ve: false, ykt: false, mrzy: false, jlgj: false };
window.platformLoginState = { ve: 'checking', ykt: 'checking', mrzy: 'checking', jlgj: 'checking' }; // checking|offline|online
window.platformLoginChecked = { ve: false, ykt: false, mrzy: false, jlgj: false };
const DEFAULT_PLATFORM_ENABLED = { ve: true, ykt: true, mrzy: true, jlgj: true };
window.platformEnabled = { ...DEFAULT_PLATFORM_ENABLED };
window.platformLoadedOnce = { ve: false, ykt: false, mrzy: false, jlgj: false };
window.platformLoadVersion = { ve: 0, ykt: 0, mrzy: 0, jlgj: 0 };
window.currentVeCourseList = [];
window.homeworkScoreCacheByKey = {}; // {"upId|snId": string}
window.homeworkScorePendingByCourse = {}; // {courseId: boolean}
window.homeworkNoteAttachmentCacheByKey = {}; // {"noteId|courseId|teacherId": {loading,loaded,picList}}
window.uploadedFileMetaById = {}; // {fileId: {fileNameNoExt,fileExtName,fileSize,visitName,pid,ftype}}
window.homeworkDetailExpandedByCourse = {}; // {courseId: {expandKey: boolean}}
window.courseShowAllById = {}; // {courseId: boolean}
window.yktDetailCacheByKey = {}; // {detailKey: {state,title,exam_problems,problem_results,promise}}
window.externalPlatformLoadVersion = 0;
window.courseListLoadVersion = 0;
window.veTeacherMetaByCourseId = {}; // {courseId:{teacherId,loading,loaded}}
window.veCourseTeachersMetaByCourseId = {}; // {courseId:{rows,loading,loaded,error,promise}}
window.resourceSpaceItems = []; // [{id,name,url,inputTime}]
window.resourceSpaceSelected = new Set();
window.coursewareItemsById = {}; // {resourceId: {id,name,url,extName,courseId}}
window.coursewareItemsByCourseId = {}; // {courseId: CoursewareItem[]}
window.homeworkAttachmentItemsById = {}; // {resourceId: {id,name,url,extName,courseId,sizeMbRaw,sizeMb}}
window.homeworkAttachmentItemsByCourseId = {}; // {courseId: HomeworkAttachmentItem[]}
window.resourceSpaceLoadVersion = 0;
window.resourceDownloadTasks = {}; // {resourceId: {active,loaded,total,speed,samples,lastUiTs,abortController,xhr,cancelled,chromeDownloadId}}
window.resourceDownloadBatch = {
  active: false,
  totalFiles: 0,
  totalBytes: 0,
  knownTotal: true,
  completedFiles: 0,
  completedBytes: 0
};
window.resourceDownloadQueue = []; // [{id,item,resolve,reject,cancelled,started,promise}]
window.resourceDownloadQueueById = {}; // {resourceId: queueEntry}
window.resourceDownloadQueueRunning = 0;

function isPlatformEnabled(platform) {
  const p = ['ve', 'ykt', 'mrzy', 'jlgj'].includes(String(platform || '').trim())
    ? String(platform || '').trim()
    : 've';
  return window.platformEnabled?.[p] !== false;
}

function sanitizePlatformEnabled(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    ve: src.ve !== false,
    ykt: src.ykt !== false,
    mrzy: src.mrzy !== false,
    jlgj: src.jlgj !== false
  };
}

async function loadPlatformEnabledFromStorage() {
  try {
    const localData = await chrome.storage.local.get(['platformEnabled']);
    const syncData = await chrome.storage.sync.get(['platformEnabled']);
    const saved = localData?.platformEnabled ?? syncData?.platformEnabled ?? null;
    window.platformEnabled = sanitizePlatformEnabled(saved);
  } catch {
    window.platformEnabled = { ...DEFAULT_PLATFORM_ENABLED };
  }
}

async function savePlatformEnabledToStorage() {
  const normalized = sanitizePlatformEnabled(window.platformEnabled);
  await chrome.storage.local.set({ platformEnabled: normalized });
  await chrome.storage.sync.set({ platformEnabled: normalized });
}

function bumpPlatformLoadVersion(platform) {
  const p = ['ve', 'ykt', 'mrzy', 'jlgj'].includes(String(platform || '').trim())
    ? String(platform || '').trim()
    : 've';
  const next = Number(window.platformLoadVersion?.[p] || 0) + 1;
  window.platformLoadVersion[p] = next;
  return next;
}

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

let versionButtonMode = 'loading';
let versionButtonDownloadUrl = '';
let versionButtonLatestVersion = '';
let versionButtonLatestBodyMarkdown = '';
let versionNoticeShownVersion = '';
let versionDownloadInProgress = false;
let versionDownloadMinimized = false;
let versionDownloadPhase = 'downloading';
const VERSION_DOWNLOAD_URL = 'https://codeload.github.com/s1y4x1/BJTU-course-assistant/zip/refs/heads/master';
const VERSION_LATEST_API_URL = 'https://api.github.com/repos/s1y4x1/BJTU-course-assistant/releases/latest';

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
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  lines.forEach((line) => {
    const raw = String(line || '');
    const trimmed = raw.trim();
    if (!trimmed) {
      closeList();
      out.push('<div style="height:6px;"></div>');
      return;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level} style="margin:0 0 8px; color:#0f172a; font-size:${Math.max(14, 22 - level * 2)}px;">${parseInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul style="margin:0 0 6px 18px; padding:0; color:#334155; line-height:1.6;">');
        inList = true;
      }
      out.push(`<li style="margin:2px 0;">${parseInlineMarkdown(bullet[1])}</li>`);
      return;
    }

    closeList();
    out.push(`<p style="margin:0 0 6px; color:#334155; line-height:1.6;">${parseInlineMarkdown(trimmed)}</p>`);
  });

  closeList();
  return out.join('');
}

function ensureVersionNoticeModal() {
  let modal = document.getElementById('version-notice-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'version-notice-modal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(15,23,42,0.45)';
  modal.style.display = 'none';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '10002';

  modal.innerHTML = `
    <div style="width:min(560px,92vw); max-height:min(78vh,740px); overflow:auto; background:#fff; border-radius:12px; padding:16px; box-shadow:0 20px 44px rgba(0,0,0,0.25); border:1px solid #e8edf5;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px;">
        <div id="version-notice-title" style="font-size:20px; font-weight:800; color:#0f172a;">发现新版本：v--</div>
        <button id="version-notice-close" class="btn" style="background:#64748b; padding:4px 10px; font-size:12px;">关闭</button>
      </div>
      <div id="version-notice-body" style="font-size:13px; color:#334155; margin-bottom:12px;"></div>
      <div style="display:block; width:100%;">
        <button id="version-notice-download" class="btn" style="background:#1e3a8a; width:100%; padding:8px 14px; font-size:13px;">下载更新</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#version-notice-close');
  if (closeBtn instanceof HTMLButtonElement) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  const downloadBtn = modal.querySelector('#version-notice-download');
  if (downloadBtn instanceof HTMLButtonElement) {
    downloadBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      startVersionDownloadWithFallback().catch(() => {
        versionDownloadInProgress = false;
        showToast('请检查网络连接后重试或联系开发者获取最新版本', 'error', 3200);
      });
    });
  }

  return modal;
}

function openVersionNoticeModal() {
  if (versionButtonMode !== 'outdated') return;
  const modal = ensureVersionNoticeModal();
  const titleEl = modal.querySelector('#version-notice-title');
  const bodyEl = modal.querySelector('#version-notice-body');
  if (titleEl instanceof HTMLElement) {
    titleEl.textContent = `发现新版本：${versionButtonLatestVersion || '--'}`;
  }
  if (bodyEl instanceof HTMLElement) {
    bodyEl.innerHTML = renderMarkdownBasic(versionButtonLatestBodyMarkdown);
  }
  modal.style.display = 'flex';
}

function ensureVersionDownloadModal() {
  let modal = document.getElementById('version-download-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'version-download-modal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.background = 'rgba(15,23,42,0.45)';
  modal.style.display = 'none';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '10001';

  modal.innerHTML = `
    <div style="width:min(560px,92vw);background:#fff;border-radius:12px;padding:16px 16px 14px;box-shadow:0 18px 42px rgba(0,0,0,0.25);border:1px solid #e8edf5;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;">
        <div id="version-download-title" style="font-size:18px;font-weight:700;color:#111827;">正在下载</div>
        <button id="version-download-minimize" class="btn" style="background:#64748b; padding:4px 10px; font-size:12px;">最小化</button>
      </div>
      <div id="version-download-body" style="font-size:13px;color:#334155;margin-bottom:8px;">请稍候，正在准备下载...</div>
      <div id="version-download-source" style="font-size:12px;color:#475569;margin-bottom:6px;word-break:break-all;">下载源：https://codeload.github.com/s1y4x1/BJTU-course-assistant/zip/refs/heads/master</div>
      <div id="version-download-meta" style="margin-bottom:4px;font-size:12px;color:#64748b;display:flex;gap:10px;flex-wrap:wrap;font-weight:700;">
        <span id="version-download-status">准备下载...</span>
        <span id="version-download-size">0 B / --</span>
        <span id="version-download-speed" style="color:#2196F3;">0 KB/s</span>
        <span id="version-download-eta">剩余: --</span>
      </div>
      <div class="progress-bar-container" style="margin-top:0;position:relative;">
        <div id="version-download-bar" class="progress-bar" style="position:absolute;top:0;left:0;z-index:2;width:0%;"></div>
      </div>
      <div id="version-download-actions" style="display:none; margin-top:10px;">
        <button id="version-download-retry" class="btn" style="background:#1e3a8a; width:100%; padding:8px 14px; font-size:13px;">重试下载</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

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
  modal.addEventListener('click', (e) => {
    if (e.target !== modal) return;
    if (versionDownloadPhase !== 'downloading') return;
    versionDownloadMinimized = true;
    modal.style.display = 'none';
    showToast('已最小化，后台静默下载中...', 'info', 1400);
  });
  return modal;
}

function setVersionDownloadRetryVisible(visible) {
  const actions = document.getElementById('version-download-actions');
  if (actions instanceof HTMLElement) {
    actions.style.display = visible ? 'block' : 'none';
  }
}

function setVersionDownloadProgressUi({
  visible = true,
  sourceUrl = VERSION_DOWNLOAD_URL,
  status = '下载中...',
  title = '正在下载',
  body = '请稍候，正在下载更新文件...',
  loaded = 0,
  total = 0,
  speed = 0,
  etaSec = null,
  percent = 0,
  phase = 'downloading'
} = {}) {
  const modal = ensureVersionDownloadModal();
  if (!modal) return;
  versionDownloadPhase = String(phase || 'downloading').trim() || 'downloading';
  const forceShow = phase !== 'downloading';
  const shouldShow = visible && (forceShow || !versionDownloadMinimized);
  modal.style.display = shouldShow ? 'flex' : 'none';
  if (forceShow) versionDownloadMinimized = false;
  setVersionDownloadRetryVisible(false);
  if (!visible) return;

  const titleEl = document.getElementById('version-download-title');
  const bodyEl = document.getElementById('version-download-body');
  const sourceEl = document.getElementById('version-download-source');
  const statusEl = document.getElementById('version-download-status');
  const sizeEl = document.getElementById('version-download-size');
  const speedEl = document.getElementById('version-download-speed');
  const etaEl = document.getElementById('version-download-eta');
  const barEl = document.getElementById('version-download-bar');
  const minBtn = document.getElementById('version-download-minimize');

  if (minBtn instanceof HTMLButtonElement) {
    minBtn.style.display = versionDownloadPhase === 'downloading' ? 'inline-block' : 'none';
  }

  if (titleEl) titleEl.textContent = String(title || '正在下载');
  if (bodyEl) bodyEl.textContent = String(body || '请稍候，正在下载更新文件...');
  if (sourceEl) sourceEl.textContent = `下载源：${String(sourceUrl || '').trim() || '--'}`;
  if (statusEl) statusEl.textContent = String(status || '下载中...');
  if (sizeEl) {
    const loadedSafe = Math.max(0, Number(loaded) || 0);
    const totalSafe = Math.max(0, Number(total) || 0);
    sizeEl.textContent = totalSafe > 0
      ? `${formatSize(loadedSafe)} / ${formatSize(totalSafe)}`
      : `${formatSize(loadedSafe)} / --`;
  }
  if (speedEl) speedEl.textContent = formatSpeed(Math.max(0, Number(speed) || 0));
  if (etaEl) {
    if (Number.isFinite(Number(etaSec)) && Number(etaSec) > 0) {
      etaEl.textContent = `剩余: ${formatEta(Number(etaSec))}`;
    } else if (Math.max(0, Number(total) || 0) > 0 && Math.max(0, Number(loaded) || 0) >= Math.max(0, Number(total) || 0)) {
      etaEl.textContent = '剩余: 0秒';
    } else {
      etaEl.textContent = '剩余: --';
    }
  }
  if (barEl) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    barEl.style.width = `${p}%`;
    barEl.textContent = `${Math.round(p)}%`;
  }
}

async function downloadVersionByUrlWithProgress(url, fileName) {
  const finalUrl = String(url || '').trim();
  if (!finalUrl) throw new Error('下载链接为空');

  setVersionDownloadProgressUi({
    visible: true,
    sourceUrl: finalUrl,
    status: '下载中...',
    title: '正在下载',
    body: '请稍候，正在下载更新文件...',
    loaded: 0,
    total: 0,
    speed: 0,
    etaSec: null,
    percent: 0,
    phase: 'downloading'
  });
  setVersionDownloadRetryVisible(false);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  let res;
  try {
    res = await fetch(finalUrl, {
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const total = Math.max(0, Number(res.headers.get('content-length') || 0));
  if (!res.body || !res.body.getReader) {
    const blob = await res.blob();
    const loaded = Number(blob.size || 0);
    setVersionDownloadProgressUi({
      visible: true,
      status: `${sourceLabel}下载完成，准备保存...`,
      loaded,
      total: total || loaded,
      speed: 0,
      etaSec: 0,
      percent: 100,
      phase: 'downloading'
    });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener noreferrer';
    a.click();
    setTimeout(() => {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
    }, 1500);
    return;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  const samples = [];
  let lastUiTs = 0;
  const UI_INTERVAL_MS = 180;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
    }

    const now = Date.now();
    if (now - lastUiTs < UI_INTERVAL_MS) continue;
    lastUiTs = now;
    const speed = pushAndCalcRecentSpeed(samples, loaded, now);
    const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
    const etaSec = total > 0 && speed > 0 ? (total - loaded) / speed : null;
    setVersionDownloadProgressUi({
      visible: true,
      sourceUrl: finalUrl,
      status: '下载中...',
      title: '正在下载',
      body: '请稍候，正在下载更新文件...',
      loaded,
      total,
      speed,
      etaSec,
      percent,
      phase: 'downloading'
    });
  }

  const blob = new Blob(chunks, { type: 'application/zip' });
  const finalLoaded = Number(blob.size || loaded || 0);
  const finalTotal = total > 0 ? total : finalLoaded;
  setVersionDownloadProgressUi({
    visible: true,
    sourceUrl: finalUrl,
    status: '下载完成，准备保存...',
    title: '正在下载',
    body: '文件已下载完成，正在保存...',
    loaded: finalLoaded,
    total: finalTotal,
    speed: 0,
    etaSec: 0,
    percent: 100,
    phase: 'downloading'
  });

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  a.rel = 'noopener noreferrer';
  a.click();
  setTimeout(() => {
    try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
  }, 1500);
}

function buildVersionDownloadFileName(versionText = '') {
  const normalized = normalizeVersionText(versionText).replace(/[^0-9.]/g, '');
  if (normalized) return `BJTU 课程助手 ${normalized}.zip`;
  return 'BJTU 课程助手.zip';
}

async function startVersionDownloadWithFallback() {
  if (versionDownloadInProgress) {
    return;
  }
  versionDownloadMinimized = false;

  setVersionDownloadProgressUi({
    visible: true,
    sourceUrl: versionButtonDownloadUrl || VERSION_DOWNLOAD_URL,
    status: '准备下载...',
    title: '正在下载',
    body: '请稍候，正在下载更新文件...',
    loaded: 0,
    total: 0,
    speed: 0,
    etaSec: null,
    percent: 0,
    phase: 'downloading'
  });

  versionDownloadInProgress = true;
  const fileName = buildVersionDownloadFileName(versionButtonLatestVersion);
  const primaryUrl = VERSION_DOWNLOAD_URL;

  try {
    await downloadVersionByUrlWithProgress(primaryUrl, fileName);
    setVersionDownloadProgressUi({
      visible: true,
      sourceUrl: primaryUrl,
      status: '已完成',
      title: '下载成功',
      body: '请前往解压覆盖扩展目录并重新加载扩展以完成更新。',
      loaded: 0,
      total: 0,
      speed: 0,
      etaSec: 0,
      percent: 100,
      phase: 'finished'
    });
  } catch (err) {
    setVersionDownloadProgressUi({
      visible: true,
      sourceUrl: primaryUrl,
      status: `下载失败：${String(err?.message || '未知错误')}`,
      title: '正在下载',
      body: '下载失败，请检查网络后重试。',
      loaded: 0,
      total: 0,
      speed: 0,
      etaSec: null,
      percent: 0,
      phase: 'failed'
    });
    setVersionDownloadRetryVisible(true);
    showToast('请检查网络连接后重试或联系开发者获取最新版本', 'error', 3200);
  }
  versionDownloadInProgress = false;
}

function setVersionButtonState(mode, { localVersion = '', latestVersion = '', downloadUrl = '', body = '' } = {}) {
  if (!versionBtn) return;
  versionButtonMode = String(mode || 'loading').trim();
  versionButtonDownloadUrl = String(downloadUrl || '').trim();
  versionButtonLatestVersion = String(latestVersion || '').trim();
  versionButtonLatestBodyMarkdown = String(body || '').trim();

  versionBtn.className = `version-btn ${versionButtonMode}`;
  versionBtn.disabled = !(versionButtonMode === 'failure' || versionButtonMode === 'outdated');

  if (versionButtonMode === 'loading') {
    versionBtn.innerHTML = '<span class="version-btn-spinner"></span><span>获取最新版本中...</span>';
    return;
  }
  if (versionButtonMode === 'failure') {
    versionBtn.innerHTML = `<span>当前版本：${escapeHtml(localVersion || '--')}</span>`;
    return;
  }
  if (versionButtonMode === 'latest') {
    versionBtn.innerHTML = `<span>已是最新版本：${escapeHtml(latestVersion || localVersion || '--')}</span>`;
    return;
  }
  if (versionButtonMode === 'outdated') {
    versionBtn.innerHTML = `<span class="version-btn-stack"><span>发现新版本：${escapeHtml(latestVersion || '--')}</span></span>`;
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

async function loadVersionInfo() {
  // Current version is sourced from manifest.json at runtime.
  const localVersion = String(chrome.runtime.getManifest().version || '').trim();
  setVersionButtonState('loading', { localVersion });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    let res;
    try {
      res = await fetch(VERSION_LATEST_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      let apiMessage = '';
      try {
        const failData = await res.json();
        apiMessage = String(failData?.message || '').trim();
      } catch {
        try {
          apiMessage = String(await res.text()).trim();
        } catch {
          apiMessage = '';
        }
      }
      throw new Error(apiMessage || `GitHub request failed (${res.status})`);
    }
    const data = await res.json();
    const latestTag = String(data?.tag_name || '').trim();
    if (!latestTag) throw new Error('Missing latest tag');

    const cmp = compareVersionText(latestTag, localVersion);
    if (cmp === 0) {
      setVersionButtonState('latest', { localVersion, latestVersion: latestTag });
      return;
    }
    if (cmp > 0) {
      setVersionButtonState('outdated', {
        localVersion,
        latestVersion: latestTag,
        downloadUrl: VERSION_DOWNLOAD_URL,
        body: String(data?.body || '').trim()
      });
      if (versionNoticeShownVersion !== latestTag) {
        versionNoticeShownVersion = latestTag;
        openVersionNoticeModal();
      }
      return;
    }
    setVersionButtonState('ahead', { localVersion, latestVersion: latestTag });
  } catch (err) {
    setVersionButtonState('failure', { localVersion });
    const msg = String(err?.message || '').trim();
    const base = '获取新版本失败：无法连接到 Github';
    const text = msg ? `${base}\n${msg}` : base;
    showToast(text, 'error', 2600);
  }
}

if (versionBtn) {
  versionBtn.addEventListener('click', () => {
    if (versionButtonMode === 'failure') {
      loadVersionInfo().catch(() => {});
      return;
    }
    if (versionButtonMode === 'outdated') {
      openVersionNoticeModal();
    }
  });
}

function clearPlatformData(platform) {
  if (platform === 'ykt') {
    window.yktMatchedHomeworkByCourseId = {};
    window.yktStandaloneCourses = [];
    window.yktMatchedCourseLinkByCourseId = {};
    window.yktCourseGroupsSnapshot = [];
    window.yktHomeworkLoadingByCourse = {};
    window.yktDetailCacheByKey = {};
    clearYktStandaloneCards();
  } else if (platform === 'mrzy') {
    window.mrzyMatchedHomeworkByCourseId = {};
    window.mrzyStandaloneCourses = [];
    window.mrzyCourseGroupsSnapshot = [];
    clearMrzyStandaloneCards();
  } else if (platform === 'jlgj') {
    window.jlgjMatchedHomeworkByCourseId = {};
    window.jlgjStandaloneCourses = [];
    window.jlgjCourseGroupsSnapshot = [];
    clearJlgjStandaloneCards();
  }
}

function triggerExternalPlatformLoad(platform, forceReload = false) {
  if (!['ykt', 'mrzy', 'jlgj'].includes(platform)) return;
  if (!isPlatformEnabled(platform)) return;
  if (!forceReload && window.platformLoadedOnce?.[platform]) return;

  const version = bumpPlatformLoadVersion(platform);
  const veCourses = Array.isArray(window.currentVeCourseList) ? window.currentVeCourseList : [];

  if (platform === 'ykt') {
    setPlatformLoginState('ykt', 'checking');
    scheduleYktLoad(veCourses, version).catch(() => renderYktNeedLoginMessage());
  } else if (platform === 'mrzy') {
    setPlatformLoginState('mrzy', 'checking');
    scheduleMrzyLoad(veCourses, version).catch(() => renderMrzyNeedLoginMessage());
  } else {
    setPlatformLoginState('jlgj', 'checking');
    scheduleJlgjLoad(veCourses, version).catch(() => renderJlgjNeedLoginMessage());
  }
}

function triggerInitialPlatformLoads() {
  if (isPlatformEnabled('ve')) {
    loadCourses();
  } else {
    window.currentVeCourseList = [];
    renderCourseList([]);
  }
  if (isPlatformEnabled('ykt')) triggerExternalPlatformLoad('ykt', false);
  if (isPlatformEnabled('mrzy')) triggerExternalPlatformLoad('mrzy', false);
  if (isPlatformEnabled('jlgj')) triggerExternalPlatformLoad('jlgj', false);
}

function rematchExternalByVeCourses() {
  const veCourses = Array.isArray(window.currentVeCourseList) ? window.currentVeCourseList : [];

  if (isPlatformEnabled('ykt') && Array.isArray(window.yktCourseGroupsSnapshot) && window.yktCourseGroupsSnapshot.length) {
    const yktStrictMap = collectVeFzIdTail10Map(veCourses);
    window.yktMatchedHomeworkByCourseId = {};
    window.yktMatchedCourseLinkByCourseId = {};
    window.yktStandaloneCourses = [];
    window.yktCourseGroupsSnapshot.forEach((g) => {
      const strictToken = String(g?.strictToken || g?.token || '').trim();
      const matched = strictToken ? yktStrictMap.get(strictToken) : null;
      if (matched?.courseId) {
        const cid = String(matched.courseId);
        if (!window.yktMatchedHomeworkByCourseId[cid]) window.yktMatchedHomeworkByCourseId[cid] = [];
        window.yktMatchedHomeworkByCourseId[cid].push(...(g?.homeworks || []));
        window.yktMatchedCourseLinkByCourseId[cid] = yktCourseLink(g?.classroom_id);
      } else {
        window.yktStandaloneCourses.push({
          name: g?.name || '',
          teacher_name: g?.teacher_name || '',
          classroom_id: g?.classroom_id,
          course_name: g?.course_name || g?.name || '雨课堂课程',
          homeworks: Array.isArray(g?.homeworks) ? g.homeworks : []
        });
      }
    });
  }

  if (isPlatformEnabled('mrzy') && Array.isArray(window.mrzyCourseGroupsSnapshot) && window.mrzyCourseGroupsSnapshot.length) {
    const mrzyMatchMap = collectCourseNameMatchMap(veCourses);
    window.mrzyMatchedHomeworkByCourseId = {};
    window.mrzyStandaloneCourses = [];
    window.mrzyCourseGroupsSnapshot.forEach((g) => {
      const matched = mrzyMatchMap.get(String(g?.token || ''));
      if (matched?.courseId) {
        const cid = String(matched.courseId);
        if (!window.mrzyMatchedHomeworkByCourseId[cid]) window.mrzyMatchedHomeworkByCourseId[cid] = [];
        window.mrzyMatchedHomeworkByCourseId[cid].push(...(g?.homeworks || []));
      } else {
        window.mrzyStandaloneCourses.push({
          divClass: g?.divClass || '每日交作业课程',
          classNum: g?.classNum,
          teacherName: g?.teacherName || '',
          homeworks: Array.isArray(g?.homeworks) ? g.homeworks : []
        });
      }
    });
  }

  if (isPlatformEnabled('jlgj') && Array.isArray(window.jlgjCourseGroupsSnapshot) && window.jlgjCourseGroupsSnapshot.length) {
    const jlgjMatchMap = collectCourseNameMatchMap(veCourses);
    window.jlgjMatchedHomeworkByCourseId = {};
    window.jlgjStandaloneCourses = [];
    window.jlgjCourseGroupsSnapshot.forEach((g) => {
      const matched = jlgjMatchMap.get(String(g?.token || ''));
      if (matched?.courseId) {
        const cid = String(matched.courseId);
        if (!window.jlgjMatchedHomeworkByCourseId[cid]) window.jlgjMatchedHomeworkByCourseId[cid] = [];
        window.jlgjMatchedHomeworkByCourseId[cid].push(...(g?.homeworks || []));
      } else {
        window.jlgjStandaloneCourses.push({
          name: g?.name || '接龙管家课程',
          groupId: g?.groupId,
          teacherName: g?.teacherName || '',
          homeworks: Array.isArray(g?.homeworks) ? g.homeworks : []
        });
      }
    });
  }
}

function rerenderAllHomeworkAreas() {
  Object.keys(window.courseHomeworkData || {}).forEach((cid) => {
    renderHomeworkList(cid);
  });
}

function isPlatformChecking(platform) {
  const p = ['ve', 'ykt', 'mrzy', 'jlgj'].includes(String(platform || '').trim())
    ? String(platform || '').trim()
    : 've';
  return isPlatformEnabled(p) && window.platformLoginState?.[p] === 'checking';
}

function togglePlatformSelection(platform) {
  if (!platform || !['ve', 'ykt', 'mrzy', 'jlgj'].includes(platform)) return;
  if (isPlatformChecking(platform)) {
    showToast('平台正在加载中，请稍后再试', 'warning', 1200);
    return;
  }

  const enabled = !isPlatformEnabled(platform);
  window.platformEnabled[platform] = enabled;
  savePlatformEnabledToStorage().catch(() => {});
  refreshPlatformLoginTip();

  if (!enabled) {
    window.platformLoadedOnce[platform] = false;
    if (platform === 've') {
      window.currentVeCourseList = [];
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
    } else {
      clearPlatformData(platform);
      rerenderAllHomeworkAreas();
    }
    return;
  }

  if (platform === 've') {
    window.platformLoadedOnce.ve = false;
    if (isPlatformEnabled('ve')) loadCourses();
    return;
  }

  clearPlatformData(platform);
  rerenderAllHomeworkAreas();
  triggerExternalPlatformLoad(platform, true);
}

function refreshUploadSelectVisibility() {
  const hasOpenSubmit = !!document.querySelector('.submit-panel[data-submit-panel="1"][style*="display: block"]');
  const wraps = document.querySelectorAll('.upload-select-wrap');
  wraps.forEach((wrap) => {
    const cb = wrap.querySelector('.submit-file-check');
    const fileId = String(cb?.dataset?.fileId || '').trim();
    const visible = hasOpenSubmit && !!window.uploadedFileMetaById[fileId];
    wrap.style.display = visible ? 'inline-flex' : 'none';
    if (!visible && cb) cb.checked = false;
  });
}

function setupRightColumnResizer() {
  if (!rightColumn || !rightColumnResizer) return;
  const STORAGE_KEY = 'courseHelperWidthPx';
  const BASE_MIN_W = 480;
  const BASE_MAX_W = 760;

  const isAdaptiveLayout = () => window.matchMedia('(max-width: 900px), (orientation: portrait)').matches;

  const getBounds = () => {
    const vw = Math.max(0, Number(window.innerWidth || 0));
    const minW = BASE_MIN_W;
    const maxByViewport = Math.max(minW + 20, vw - 48);
    const maxW = Math.max(minW, Math.min(BASE_MAX_W, maxByViewport));
    return { minW, maxW };
  };

  const applyResponsiveWidth = () => {
    if (isAdaptiveLayout()) {
      rightColumn.style.width = '';
      rightColumn.style.minWidth = '0';
      return;
    }
    rightColumn.style.minWidth = '';
    const { minW, maxW } = getBounds();
    let target = Math.round((minW + maxW) / 2);
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY) || 0);
      if (Number.isFinite(saved)) {
        target = saved;
      }
    } catch {
      // ignore
    }
    const clamped = Math.max(minW, Math.min(maxW, Math.round(target)));
    rightColumn.style.width = `${clamped}px`;
  };

  const syncResizerGeometry = () => {
    if (isAdaptiveLayout()) {
      rightColumnResizer.style.display = 'none';
      return;
    }
    rightColumnResizer.style.display = 'block';
    const rect = rightColumn.getBoundingClientRect();
    rightColumnResizer.style.left = `${Math.round(rect.left + 3)}px`;
    rightColumnResizer.style.top = `${Math.round(rect.top)}px`;
    rightColumnResizer.style.height = `${Math.max(0, Math.round(rect.height))}px`;
  };

  const scheduleResizerSync = () => {
    syncResizerGeometry();
    requestAnimationFrame(() => syncResizerGeometry());
    setTimeout(() => syncResizerGeometry(), 120);
  };

  applyResponsiveWidth();
  scheduleResizerSync();

  let dragging = false;

  const onMove = (e) => {
    if (!dragging || !rightColumn) return;
    const { minW, maxW } = getBounds();
    const vw = Math.max(0, window.innerWidth || 0);
    const w = vw - Number(e.clientX || 0) - 24;
    const clamped = Math.max(minW, Math.min(maxW, Math.round(w)));
    rightColumn.style.width = `${clamped}px`;
    scheduleResizerSync();
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    rightColumn.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    try {
      const { minW, maxW } = getBounds();
      const current = parseInt(String(rightColumn.style.width || '0').replace('px', ''), 10);
      if (Number.isFinite(current) && current >= minW && current <= maxW) {
        localStorage.setItem(STORAGE_KEY, String(current));
      }
    } catch {
      // ignore
    }
  };

  rightColumnResizer.addEventListener('mousedown', (e) => {
    if (isAdaptiveLayout()) return;
    e.preventDefault();
    dragging = true;
    rightColumn.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  window.addEventListener('resize', () => {
    if (dragging && isAdaptiveLayout()) {
      onUp();
    }
    applyResponsiveWidth();
    scheduleResizerSync();
  });

  window.addEventListener('scroll', scheduleResizerSync, true);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => scheduleResizerSync());
    ro.observe(rightColumn);
    if (courseListDiv) ro.observe(courseListDiv);
  }
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(() => scheduleResizerSync());
    if (courseListDiv) {
      mo.observe(courseListDiv, { childList: true, subtree: true });
    }
    if (loginModal) {
      mo.observe(loginModal, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
  }
}

// speed aggregation
window.activeSpeeds = {}; // {speedId: bytesPerSecond}
const RECENT_SPEED_WINDOW_MS = 5000;
const totalProgressSamples = []; // [{t, loaded}]
let totalRecentSpeedBps = 0;

let lastValidUsername = '';
let pendingUsernameChange = null; // { from: string, to: string } | null
let isLoginInProgress = false;
let loginCancelRequested = false;

function updateTotalSpeed() {
  let total = 0;
  Object.values(window.activeSpeeds).forEach(v => { total += v || 0; });
  if (Object.keys(window.activeSpeeds).length === 0) {
    total = 0;
  } else if (totalRecentSpeedBps > 0) {
    total = totalRecentSpeedBps;
  }
  const el = document.getElementById('total-speed');
  if (el) el.textContent = `总速度: ${formatSpeed(total)}`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0秒';
  const s = Math.max(1, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}小时${m}分`;
  if (m > 0) return `${m}分${sec}秒`;
  return `${sec}秒`;
}

function pushAndCalcRecentSpeed(samples, loaded, now = Date.now(), windowMs = RECENT_SPEED_WINDOW_MS) {
  samples.push({ t: now, loaded: Number(loaded) || 0 });
  const minT = now - windowMs;
  while (samples.length > 2 && samples[0].t < minT) samples.shift();
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = (last.t - first.t) / 1000;
  const db = Math.max(0, (last.loaded || 0) - (first.loaded || 0));
  if (dt <= 0 || db <= 0) return 0;
  return db / dt;
}

// -------------------- Storage helpers --------------------
async function getLocal(key, fallback = '') {
  const data = await chrome.storage.local.get([key]);
  return data[key] ?? fallback;
}
async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

function normalizePlatformSessionId(v) {
  const s = String(v || '').trim();
  // allow hex-like tokens; fallback handled by caller
  return s;
}

function maybeUpdatePlatformSessionIdFromResponse(res) {
  try {
    if (!res || !res.headers) return;
    const sid = normalizePlatformSessionId(res.headers.get('sessionId') || res.headers.get('sessionid') || '');
    if (sid && sid !== runtimePlatformSessionId) {
      runtimePlatformSessionId = sid;
    }
  } catch {
    // ignore
  }
}

async function getPlatformSessionId() {
  return runtimePlatformSessionId || DEFAULT_PLATFORM_SESSION_ID;
}

async function getAutoOcrCaptchaEnabled() {
  const { autoOcrCaptcha } = await chrome.storage.sync.get(['autoOcrCaptcha']);
  return autoOcrCaptcha !== false;
}

async function getCookieJsessionid() {
  // Prefer /ve/ cookie first: login/upload endpoints are under /ve/.
  const c2 = await chrome.cookies.get({ url: `${BASE}/ve/`, name: 'JSESSIONID' });
  if (c2?.value) return c2.value;

  const c1 = await chrome.cookies.get({ url: BASE, name: 'JSESSIONID' });
  if (c1?.value) return c1.value;

  const all = await chrome.cookies.getAll({ domain: '123.121.147.7', name: 'JSESSIONID' });
  if (!all?.length) return '';

  // Choose the most specific path first (e.g. /ve/ over /)
  all.sort((a, b) => (b.path || '').length - (a.path || '').length);
  return all[0]?.value || '';
}

function parseJsessionidFromSetCookieHeader(setCookieValue) {
  const raw = String(setCookieValue || '');
  if (!raw) return '';
  const m = raw.match(/(?:^|[,\s])JSESSIONID=([^;,\s]+)/i);
  return (m?.[1] || '').trim();
}

async function getLatestResponseJsessionid(maxAgeMs = 15000) {
  for (let i = 0; i < 10; i++) {
    try {
      const rec = await getLocal('latestResponseJsessionid', null);
      if (rec && typeof rec === 'object') {
        const value = String(rec.value || '').trim();
        const ts = Number(rec.ts || 0);
        const url = String(rec.url || '');
        const fromLoginEndpoint = /\/ve\/s\.shtml(?:[?#]|$)/i.test(url);
        if (value && ts && fromLoginEndpoint && (Date.now() - ts) <= maxAgeMs) {
          return value;
        }
      }
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 100));
  }
  return '';
}

async function removeCookieByDescriptor(cookie) {
  try {
    if (!cookie?.name) return;
    const host = String(cookie.domain || '').replace(/^\./, '');
    if (!host) return;
    const path = cookie.path || '/';
    const scheme = cookie.secure ? 'https' : 'http';
    const url = `${scheme}://${host}${path}`;
    await chrome.cookies.remove({
      url,
      name: cookie.name,
      storeId: cookie.storeId
    });
  } catch {
    // ignore
  }
}

async function reconcileJsessionidCookies(targetJsessionid) {
  const target = String(targetJsessionid || '').trim();
  if (!target) return;

  try {
    // Get ALL cookies for the domain, regardless of name
    const all = await chrome.cookies.getAll({ domain: '123.121.147.7' });
    for (const c of all || []) {
      // Remove ALL JSESSIONID cookies to ensure a clean slate
      if (String(c?.name || '').toUpperCase() === 'JSESSIONID') {
        await removeCookieByDescriptor(c);
      }
    }
  } catch {
    // ignore
  }

  // Now set the single correct session value
  await setCookieJsessionid(target);
}

async function syncJsessionidFromResponse(res) {
  let jsid = '';
  let source = '';

  // 1) Try response headers first (if accessible in this context).
  try {
    const h = res?.headers;
    if (h) {
      jsid = parseJsessionidFromSetCookieHeader(h.get('set-cookie') || h.get('Set-Cookie') || '');
      if (jsid) source = 'response-header';
    }
  } catch {
    // ignore
  }

  // 2) Extension background captures response Set-Cookie via webRequest.
  if (!jsid) {
    jsid = await getLatestResponseJsessionid(20000);
    if (jsid) source = 'bg-webRequest';
  }

  // 3) Fallback: cookie jar (when header capture is unavailable).
  if (!jsid) {
    jsid = await getCookieJsessionid();
    if (jsid) source = 'cookie-jar';
  }

  jsid = String(jsid || '').trim();
  if (!jsid) return '';

  // Keep cookie/local/UI in sync, and cleanup stale duplicated cookies.
  await reconcileJsessionidCookies(jsid);
  await setLocal('jsessionid', jsid);
  if (jsessionidInput) jsessionidInput.value = jsid;
  return jsid;
}

async function enforceJsessionidBeforeLoginRequest() {
  const preferred = String(await getLocal('jsessionid', '') || '').trim();
  if (!preferred) return '';
  await reconcileJsessionidCookies(preferred);
  return preferred;
}

async function syncJsessionidToUi() {
  const jsid = await getCookieJsessionid();
  // Do not overwrite manual input when username is empty (JSESSIONID mode)
  const canOverwrite = jsessionidInput.readOnly || !jsessionidInput.value.trim();
  if (jsid && canOverwrite) {
    jsessionidInput.value = jsid;
    await setLocal('jsessionid', jsid);
  }
  return jsid;
}

async function forceSyncJsessionidAfterLogin() {
  let jsid = '';
  for (let i = 0; i < 8; i++) {
    jsid = String(await getLatestResponseJsessionid(30000) || '').trim();
    if (jsid) break;
    jsid = String(await getCookieJsessionid() || '').trim();
    if (jsid) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!jsid) return '';
  await reconcileJsessionidCookies(jsid);
  await setLocal('jsessionid', jsid);
  if (jsessionidInput) jsessionidInput.value = jsid;
  return jsid;
}

async function setCookieJsessionid(value) {
  const v = String(value || '').trim();
  if (!v) return;
  try {
    await chrome.cookies.set({
      url: `${BASE}/ve/`,
      name: 'JSESSIONID',
      value: v,
      path: '/ve/' 
    });
  } catch {
    // ignore
  }
}

function updateJsessionidState() {
  const hasUser = !!usernameInput.value.trim();
  if (hasUser) {
    jsessionidInput.readOnly = true;
    jsessionidInput.style.backgroundColor = '#f0f0f0';
    jsessionidInput.placeholder = '自动获取';
  } else {
    jsessionidInput.readOnly = false;
    jsessionidInput.style.backgroundColor = '#fff';
    jsessionidInput.placeholder = '请输入 JSESSIONID';
  }
}

function promptLoginIfPossible(message) {
  const defaultNeedLoginMsg = VE_LOGIN_REQUIRED_HTML;
  // If username is empty, do not pop modal; direct user to platform login entry.
  if (!usernameInput.value.trim()) {
    showToast(message || defaultNeedLoginMsg, 'warning', 3500, true);
    return;
  }
  if (shouldUsePortalPageLogin()) {
    openPortalLoginForInvalidSession();
    return;
  }
  showLoginModal(message || '请输入验证码重新登录');
}

// -------------------- UI helpers --------------------
function showToast(message, type = 'success', duration = 3000, allowHtml = false) {
  const container = document.getElementById('toast-container');
  // clear existing info toasts
  container.querySelectorAll('.toast.info').forEach(el => el.remove());

  const text = String(message || '');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.style.whiteSpace = 'pre-line';
  if (allowHtml) {
    toast.innerHTML = text;
  } else {
    toast.textContent = text;
  }
  if (text.endsWith('...') || text.includes('...') || text.endsWith('…')) {
    const spinner = document.createElement('span');
    spinner.className = 'toast-spinner';
    toast.appendChild(spinner);
  }
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.style.animation = 'fadeOutUp 0.25s ease-in forwards';
      toast.addEventListener('animationend', () => toast.remove());
    }, duration);
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function buildHomeworkAttachmentKey(noteId, courseId, teacherId) {
  return `${String(noteId || '').trim()}|${String(courseId || '').trim()}|${String(teacherId || '').trim()}`;
}

function stripFileExtension(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return raw;
  return raw.slice(0, dot);
}

function buildHomeworkAttachmentSizeStyle(bytes) {
  return buildResourceSizeEmphasisStyle((Number(bytes) || 0) / (1024 * 1024));
}

function normalizeHomeworkAttachmentUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  const normalized = text.startsWith('/') ? text : `/${text}`;
  return `${BASE}${normalized}`;
}

function triggerHomeworkAttachmentDownload(url, fileName) {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return;
  const safeName = sanitizeDownloadFileName(fileName || '作业附件');
  if (chrome?.downloads?.download) {
    chrome.downloads.download(
      { url: safeUrl, filename: safeName, conflictAction: 'uniquify', saveAs: false },
      () => {
        if (chrome.runtime?.lastError) {
          window.open(safeUrl, '_blank', 'noopener,noreferrer');
        }
      }
    );
    return;
  }
  window.open(safeUrl, '_blank', 'noopener,noreferrer');
}

function syncHomeworkAttachmentItemsIndex(courseId, items) {
  const cid = String(courseId || '').trim();
  const prevList = Array.isArray(window.homeworkAttachmentItemsByCourseId?.[cid])
    ? window.homeworkAttachmentItemsByCourseId[cid]
    : [];
  prevList.forEach((it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    delete window.homeworkAttachmentItemsById[id];
    window.resourceSpaceSelected.delete(id);
  });

  const nextList = Array.isArray(items) ? items : [];
  window.homeworkAttachmentItemsByCourseId[cid] = nextList;
  nextList.forEach((it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    window.homeworkAttachmentItemsById[id] = it;
  });
}

function registerHomeworkAttachmentItem(courseId, item) {
  const cid = String(courseId || '').trim();
  if (!cid || !item) return;
  const id = String(item.id || '').trim();
  if (!id) return;
  if (!Array.isArray(window.homeworkAttachmentItemsByCourseId[cid])) {
    window.homeworkAttachmentItemsByCourseId[cid] = [];
  }
  window.homeworkAttachmentItemsByCourseId[cid].push(item);
  window.homeworkAttachmentItemsById[id] = item;
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond) return '0 KB/s';
  if (bytesPerSecond < 1024 * 1024) return (bytesPerSecond / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSecond / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeHomeworkContent(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).replace(/\r\n/g, '\n');
  s = s.trim();
  if (!s) return '';

  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(s);
  if (looksHtml) {
    // Compact common block tags to avoid overly large paragraph gaps from source HTML defaults.
    s = s.replace(/<p\b([^>]*)>/gi, (m, attrs = '') => {
      if (/\bstyle\s*=\s*(["']).*?\1/i.test(attrs)) {
        return `<p${attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i, (all, q, st) => ` style=${q}${st};margin:0.2em 0;${q}`)}>`;
      }
      return `<p${attrs} style="margin:0.2em 0;">`;
    });
    s = s.replace(/<(ul|ol)\b([^>]*)>/gi, (m, tag, attrs = '') => {
      if (/\bstyle\s*=\s*(["']).*?\1/i.test(attrs)) {
        return `<${tag}${attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i, (all, q, st) => ` style=${q}${st};margin:0.2em 0;padding-left:1.15em;${q}`)}>`;
      }
      return `<${tag}${attrs} style="margin:0.2em 0;padding-left:1.15em;">`;
    });
    s = s.replace(/<li\b([^>]*)>/gi, (m, attrs = '') => {
      if (/\bstyle\s*=\s*(["']).*?\1/i.test(attrs)) {
        return `<li${attrs.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i, (all, q, st) => ` style=${q}${st};margin:0.08em 0;${q}`)}>`;
      }
      return `<li${attrs} style="margin:0.08em 0;">`;
    });
    return s;
  }

  s = s.replace(/(\n\s*){3,}/g, '\n\n');
  return escapeHtml(s).replace(/\n/g, '<br>');
}

function renderExpandableHtml(contentHtml, {
  emptyHtml = '<span style="color:#999;">无内容</span>',
  expandText = '点击查看作业详情',
  collapseText = '点击收起',
  hideWhenEmpty = false,
  baseBg = 'rgba(255,255,255,0.3)',
  flatDisplay = false,
  courseId = '',
  expandKey = '',
  expanded = false
} = {}) {
  const raw = String(contentHtml || '').trim();
  if (!raw) {
    if (hideWhenEmpty) return '';
    return `<div class="expandable-box" style="--expand-base:${baseBg};"><div class="expandable-body">${emptyHtml}</div></div>`;
  }
  const cid = escapeHtml(String(courseId || ''));
  const key = escapeHtml(String(expandKey || ''));
  const expandedNow = !!expanded;
  const modeClass = flatDisplay ? ' borderless' : '';
  return `
    <div class="expandable-box${modeClass}${expandedNow ? ' expanded' : ''}" data-expanded="${expandedNow ? '1' : '0'}" data-course-id="${cid}" data-expand-key="${key}" style="--expand-base:${baseBg};">
      <div class="expandable-body">${raw}</div>
      <div class="expandable-fade"></div>
      <div class="expandable-toggle" data-action="toggle-expand" data-open-text="${escapeHtml(expandText)}" data-close-text="${escapeHtml(collapseText)}">${escapeHtml(expandedNow ? collapseText : expandText)}</div>
    </div>
  `;
}

function getHomeworkExpandStateMap(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return null;
  if (!window.homeworkDetailExpandedByCourse[cid]) {
    window.homeworkDetailExpandedByCourse[cid] = {};
  }
  return window.homeworkDetailExpandedByCourse[cid];
}

function isHomeworkDetailExpanded(courseId, expandKey) {
  const map = getHomeworkExpandStateMap(courseId);
  const key = String(expandKey || '').trim();
  if (!map || !key) return false;
  return !!map[key];
}

function setHomeworkDetailExpanded(courseId, expandKey, expanded) {
  const map = getHomeworkExpandStateMap(courseId);
  const key = String(expandKey || '').trim();
  if (!map || !key) return;
  map[key] = !!expanded;
}

function buildHomeworkScoreKey(upId, snId) {
  return `${String(upId || '').trim()}|${String(snId || '').trim()}`;
}

function splitFileName(name) {
  const raw = String(name || '').trim();
  if (!raw) return { fileNameNoExt: '', fileExtName: '' };
  const idx = raw.lastIndexOf('.');
  if (idx <= 0 || idx === raw.length - 1) return { fileNameNoExt: raw, fileExtName: '' };
  return {
    fileNameNoExt: raw.slice(0, idx),
    fileExtName: raw.slice(idx + 1)
  };
}

function getSelectedUploadedFileList() {
  const checked = Array.from(document.querySelectorAll('.submit-file-check:checked'));
  const files = [];
  checked.forEach((cb) => {
    const fileId = String(cb?.dataset?.fileId || '').trim();
    const meta = window.uploadedFileMetaById[fileId];
    if (!meta || !meta.visitName) return;
    files.push({
      fileNameNoExt: meta.fileNameNoExt,
      fileExtName: meta.fileExtName,
      fileSize: String(meta.fileSize || ''),
      visitName: meta.visitName,
      pid: '',
      ftype: 'insert'
    });
  });
  return files;
}

async function submitNativeHomework(courseId, hw, content, fileList) {
  const upId = hw?.id ?? hw?.upId ?? hw?.upid ?? hw?.UPID ?? hw?.up_id ?? '';
  if (!upId) return { ok: false, message: '作业ID缺失，无法提交' };

  const body = new URLSearchParams({
    method: 'sendStuHomeWorks',
    content: encodeURIComponent(String(content || '')),
    groupName: '',
    groupId: '',
    courseId: String(courseId || ''),
    contentType: '0',
    fz: '0',
    jxrl_id: '',
    fileList: JSON.stringify(fileList || []),
    upId: String(upId),
    return_num: '0',
    isTeacher: '0'
  });

  const { text, res } = await fetchText(`${BASE_VE}back/course/courseWorkInfo.shtml`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: body.toString()
  });

  if (isLikelyLoginPageHtml(text, res?.url) || (res && res.redirected && String(res.url || '').includes('/ve/s.shtml'))) {
    return { ok: false, loginRequired: true, message: '登录状态失效' };
  }

  let data = null;
  try {
    data = JSON.parse(text || '{}');
  } catch {
    data = null;
  }

  if (String(data?.STATUS) === '0' || String(data?.flag || '').toLowerCase() === 'success') {
    return { ok: true, data };
  }
  return { ok: false, message: String(data?.ERRMSG || data?.message || '提交失败') };
}

function updateTotalProgress() {
  let totalSize = 0;
  let totalUploaded = 0;

  Object.values(window.filesData).forEach(d => {
    totalSize += d.size;
    totalUploaded += d.uploaded || 0;
  });

  totalRecentSpeedBps = pushAndCalcRecentSpeed(totalProgressSamples, totalUploaded);

  totalSizeInfoDiv.textContent = `${formatSize(totalUploaded)} / ${formatSize(totalSize)}`;
  if (!totalSize) {
    totalServerBar.style.width = '0%';
    if (totalPercentDiv) totalPercentDiv.textContent = '0%';
    if (totalEtaDiv) totalEtaDiv.textContent = '';
    totalRecentSpeedBps = 0;
    totalProgressSamples.length = 0;
    updateTotalSpeed();
    return;
  }

  const percent = Math.round((totalUploaded / totalSize) * 100);
  totalServerBar.style.width = percent + '%';
  if (totalPercentDiv) totalPercentDiv.textContent = `${percent}%`;

  const remaining = Math.max(0, totalSize - totalUploaded);
  if (totalEtaDiv) {
    if (remaining <= 0) {
      totalEtaDiv.textContent = '';
      totalRecentSpeedBps = 0;
      totalProgressSamples.length = 0;
    } else if (totalRecentSpeedBps > 0) {
      totalEtaDiv.textContent = `总剩余: ${formatEta(remaining / totalRecentSpeedBps)}`;
    } else {
      totalEtaDiv.textContent = '总剩余: --';
    }
  }
  updateTotalSpeed();
}

function convertVisitNameToUrl(visitName) {
  const raw = String(visitName || '').trim();
  if (!raw) return '';
  // Typical: W:\Root\rp\2026\02\21\xxx.jpg
  let path = raw.replace(/^W:\\Root\\?/i, '');
  path = path.replace(/\\/g, '/');
  if (!path.startsWith('/')) path = '/' + path;
  // Ensure no double slashes after host
  return `${BASE}${path}`.replace(/([^:]\/\/+)\/\/+?/g, '$1/');
}

async function fetchUserInfoRemote(userId) {
  if (!userId) return null;
  try {
    const url = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(userId)}`;
    const { text } = await fetchText(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
    const data = JSON.parse(text);
    if (String(data.STATUS) === '0' && data.result) {
      return data.result;
    }
    return null;
  } catch {
    return null;
  }
}

async function validateUserIdRemote(userId) {
  if (!userId) return { ok: false, status: 'empty', info: null };
  try {
    const url = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(userId)}`;
    const { text } = await fetchText(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
    const data = JSON.parse(text);
    if (String(data.STATUS) === '0' && data.result) return { ok: true, status: '0', info: data.result };
    if (String(data.STATUS) === '4') return { ok: false, status: '4', info: null };
    return { ok: false, status: String(data.STATUS ?? 'unknown'), info: null };
  } catch {
    // network / non-json
    return { ok: false, status: 'error', info: null };
  }
}

function setWelcomeMessage(info) {
  const msgEl = document.getElementById('welcome-msg');
  const loginMsgEl = document.getElementById('login-welcome-msg');
  if (!info) {
    if (msgEl) msgEl.textContent = '';
    if (loginMsgEl) loginMsgEl.textContent = '';
    return;
  }
  const msg = `欢迎您！${info.roleName || ''}${info.userName || ''}`;
  if (msgEl) msgEl.textContent = msg;
  if (loginMsgEl) loginMsgEl.textContent = msg;
}

// -------------------- Network helpers --------------------
async function fetchText(url, options = {}) {
  const omitSessionId = !!options.omitSessionId;
  const sid = omitSessionId ? '' : await getPlatformSessionId();
  const headers = {
    'Upgrade-Insecure-Requests': '1',
    ...(options.headers || {})
  };
  if (!omitSessionId) {
    headers.sessionId = sid;
  }

  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers
  });

  // auto-refresh runtime sessionId if server provides it
  maybeUpdatePlatformSessionIdFromResponse(res);

  const buf = await res.arrayBuffer();
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  let text = '';
  try {
    if (contentType.includes('gbk') || contentType.includes('gb2312')) {
      text = new TextDecoder('gbk').decode(buf);
    } else {
      text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) {
        const gbkText = new TextDecoder('gbk').decode(buf);
        if (gbkText && !gbkText.includes('�')) text = gbkText;
      }
    }
  } catch {
    text = new TextDecoder('utf-8').decode(buf);
  }

  return { res, text };
}

async function detectUserIdFromPersonalCenter() {
  const url = `${BASE_VE}back/personalCenter/personalCenter.shtml?method=toPersonalCenter`;
  const { res, text } = await fetchText(url, {
    omitSessionId: true,
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
  });

  if (isLikelyLoginPageHtml(text, res?.url)) return '';

  // <p><span>学号：</span> 24281272</p> OR <p><span>工号：</span> 7971</p>
  const m = String(text || '').match(/<span>\s*(学号|工号)\s*：\s*<\/span>\s*([0-9]{1,})\s*<\/p>/);
  if (m?.[2]) return m[2];

  const m2 = String(text || '').replace(/\s+/g, ' ').match(/(学号|工号)\s*：\s*([0-9]{1,})/);
  if (m2?.[2]) return m2[2];

  return '';
}

function parseAlertMsg(html) {
  const arr = [...String(html || '').matchAll(/alert\('([^']+)'\)/g)];
  if (!arr.length) return '';
  return arr[arr.length - 1][1];
}

function isLikelyLoginPageHtml(html, resUrl = '') {
  const t = String(html || '');
  const u = String(resUrl || '');
  if (u.includes('/ve/s.shtml')) return true;
  if (t.includes('login-page')) return true;
  // typical login form markers
  if (/name=["']username["']/i.test(t) && /name=["']passcode["']/i.test(t)) return true;
  if (t.includes('登录系统') && /passcode/i.test(t)) return true;
  return false;
}

function isSessionEndedHtml(html) {
  const t = String(html || '');
  return /<title>\s*会话结束\s*<\/title>/i.test(t)
    || /会话结束,?请退出系统/i.test(t)
    || /重新登录/i.test(t);
}

function isCaptchaErrorMessage(msg = '') {
  return /验证码|驗證碼|passcode|请输入正确的验证码|請輸入正確的驗證碼/i.test(msg);
}

function isAccountLockedMessage(msg = '') {
  return /账号锁定|帳號鎖定|锁定\d+分钟|鎖定\d+分鐘|密码输入错误次数过多|密碼輸入錯誤次數過多/i.test(String(msg || ''));
}

function looksLikeLoginSuccess(html) {
  const t = String(html || '');
  return t.includes('跳转首页') || t.includes('top.location') || t.includes('退出登录');
}

// -------------------- MD5 (internal, no external libs) --------------------
function md5cycle(x, k) {
  let [a, b, c, d] = x;
  function ff(a,b,c,d,x,s,t){a=a+((b&c)|(~b&d))+x+t;return((a<<s)|(a>>>(32-s)))+b}
  function gg(a,b,c,d,x,s,t){a=a+((b&d)|(c&~d))+x+t;return((a<<s)|(a>>>(32-s)))+b}
  function hh(a,b,c,d,x,s,t){a=a+(b^c^d)+x+t;return((a<<s)|(a>>>(32-s)))+b}
  function ii(a,b,c,d,x,s,t){a=a+(c^(b|~d))+x+t;return((a<<s)|(a>>>(32-s)))+b}
  a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
  a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
  a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
  a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
  a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
  a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
  a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
  a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
  a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
  a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
  a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
  a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
  a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
  a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
  a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
  a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
  x[0] = (a + x[0]) | 0; x[1] = (b + x[1]) | 0; x[2] = (c + x[2]) | 0; x[3] = (d + x[3]) | 0;
}
function md5blk(s){const md5blks=[];for(let i=0;i<64;i+=4){md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24)}return md5blks}
function md51(s){let n=s.length;let state=[1732584193,-271733879,-1732584194,271733878];let i;for(i=64;i<=n;i+=64){md5cycle(state,md5blk(s.substring(i-64,i)))}s=s.substring(i-64);const tail=new Array(16).fill(0);for(i=0;i<s.length;i++)tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);tail[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i++)tail[i]=0}tail[14]=n*8;md5cycle(state,tail);return state}
const hex_chr='0123456789abcdef'.split('');
function rhex(n){let s='';for(let j=0;j<4;j++)s+=hex_chr[(n>>(j*8+4))&0x0f]+hex_chr[(n>>(j*8))&0x0f];return s}
function md5(s){return md51(unescape(encodeURIComponent(s))).map(rhex).join('')}

// -------------------- Captcha --------------------
let lastCaptchaObjectUrl = '';
let autoOcrAttemptCount = 0;
let autoOcrAutoSubmitUsed = false;
let lastLoginFailedByCaptcha = false;

const MAX_CAPTCHA_ERROR_RETRIES = 3;
const MAX_AUTO_SUBMITS_PER_MODAL = 1 + MAX_CAPTCHA_ERROR_RETRIES;
let captchaErrorRetryCount = 0;

let captchaNonce = 0;
let tessWorkerPromise = null;
let tessOcrInProgress = false;
let tessInitErrorNotified = false;
let lastAutoOcrCaptchaText = '';
const captchaHistoryByNonce = new Map();

function setLoginProgress(message = '', tone = 'normal') {
  if (!loginProgressText) return;
  loginProgressText.textContent = message || '等待登录';
  if (tone === 'error') {
    loginProgressText.style.color = '#b91c1c';
    loginProgressText.style.background = '#fef2f2';
    loginProgressText.style.borderColor = '#fecaca';
  } else if (tone === 'warning') {
    loginProgressText.style.color = '#92400e';
    loginProgressText.style.background = '#fffbeb';
    loginProgressText.style.borderColor = '#fde68a';
  } else if (tone === 'success') {
    loginProgressText.style.color = '#166534';
    loginProgressText.style.background = '#f0fdf4';
    loginProgressText.style.borderColor = '#bbf7d0';
  } else {
    loginProgressText.style.color = '#0f766e';
    loginProgressText.style.background = '#ecfeff';
    loginProgressText.style.borderColor = '#a5f3fc';
  }
}

function resetCaptchaHistory() {
  captchaHistoryByNonce.clear();
  if (captchaHistoryList) captchaHistoryList.innerHTML = '';
}

function pushCaptchaHistory(blob, nonce) {
  if (!captchaHistoryList) return;
  const item = document.createElement('div');
  item.className = 'captcha-history-item';
  item.innerHTML = `
    <img alt="captcha-${nonce}">
    <div>
      <div>第 ${Math.max(1, captchaHistoryList.children.length + 1)} 次</div>
      <div class="ocr-result" style="color:#64748b;">识别中…</div>
    </div>
  `;
  captchaHistoryList.prepend(item);
  captchaHistoryByNonce.set(String(nonce), item);

  const img = item.querySelector('img');
  if (img) {
    const url = URL.createObjectURL(blob);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    img.onerror = () => URL.revokeObjectURL(url);
  }
}

function markCaptchaHistoryResult(nonce, text, confidence = null) {
  const item = captchaHistoryByNonce.get(String(nonce));
  if (!item) return;
  const resultEl = item.querySelector('.ocr-result');
  if (!resultEl) return;
  if (/^\d{4}$/.test(String(text || ''))) {
    const confText = Number.isFinite(confidence) ? `（${(confidence * 100).toFixed(0)}%）` : '';
    resultEl.textContent = `识别: ${text}${confText}`;
    resultEl.style.color = '#166534';
  } else {
    resultEl.textContent = '识别失败';
    resultEl.style.color = '#b45309';
  }
}

function preprocessCaptchaToCanvas(imgEl) {
  const w = Math.max(1, imgEl.naturalWidth || imgEl.width || 0);
  const h = Math.max(1, imgEl.naturalHeight || imgEl.height || 0);
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Simple contrast + binarize; Tesseract works better on high-contrast.
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const gray = (0.299 * r + 0.587 * g + 0.114 * b);
    const v = gray < 160 ? 0 : 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function ensureTesseractWorker() {
  if (tessWorkerPromise) return tessWorkerPromise;
  const T = window.Tesseract;
  if (!T || typeof T.createWorker !== 'function') {
    throw new Error('Tesseract 未加载');
  }

  const workerPath = chrome.runtime.getURL('vendor/tesseract/worker.min.js');
    const langPath = chrome.runtime.getURL('vendor/tesseract');

  tessWorkerPromise = (async () => {
    const createWithCore = async (corePath) => {
      const options = {
        logger: () => {},
        workerPath,
        langPath,
        corePath,
        // MV3 CSP: don't create blob workers
        workerBlobURL: false
      };

      // tesseract.js v5: createWorker(langs, oem, options)
      let w;
      try {
        w = await T.createWorker('eng', 1, options);
      } catch {
        // older signature fallback
        w = await T.createWorker(options);
        if (w.loadLanguage) await w.loadLanguage('eng');
        if (w.initialize) await w.initialize('eng');
      }

      if (w.setParameters) {
        await w.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: '7'
        });
      }
      return w;
    };

    // Keep only SIMD core to reduce extension size.
    return await createWithCore(chrome.runtime.getURL('vendor/tesseract/tesseract-core-simd.wasm.js'));
  })();

  return tessWorkerPromise;
}

async function ocrCaptchaWithTesseract(imgEl) {
  if (tessOcrInProgress) return { text: '', confidence: 0 };
  tessOcrInProgress = true;
  try {
    const worker = await ensureTesseractWorker();
    const canvas = preprocessCaptchaToCanvas(imgEl);
    const { data } = await worker.recognize(canvas);
    const digits = String(data?.text || '').replace(/\D/g, '');
    const text = digits.slice(0, 4);
    const confidence = Math.max(0, Math.min(1, (Number(data?.confidence ?? 0) / 100)));
    if (!/^\d{4}$/.test(text)) return { text: '', confidence };
    return { text, confidence };
  } catch (e) {
    if (!tessInitErrorNotified) {
      tessInitErrorNotified = true;
      showToast('OCR 初始化失败：' + (e?.message || String(e)), 'error', 4000);
    }
    return { text: '', confidence: 0 };
  } finally {
    tessOcrInProgress = false;
  }
}
async function refreshCaptcha() {
  try {
    lastAutoOcrCaptchaText = '';
    captchaNonce++;
    captchaImg.dataset.nonce = String(captchaNonce);
    setLoginProgress('验证码获取中…');
    const res = await fetch(`${BASE_VE}GetImg`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'image/*,*/*;q=0.8' }
    });
    maybeUpdatePlatformSessionIdFromResponse(res);
    if (!res.ok) {
      showToast(`验证码获取失败 HTTP ${res.status}`, 'error');
      return;
    }
    const blob = await res.blob();
    pushCaptchaHistory(blob, captchaNonce);
    if (lastCaptchaObjectUrl) URL.revokeObjectURL(lastCaptchaObjectUrl);
    lastCaptchaObjectUrl = URL.createObjectURL(blob);
    captchaImg.src = lastCaptchaObjectUrl;
    setLoginProgress('验证码已获取，等待识别…');
  } catch (e) {
    setLoginProgress('验证码获取失败', 'error');
    showToast('验证码获取失败: ' + e.message, 'error');
  }
}

// -------------------- Password fetch (oldpassword) --------------------
async function fetchPasswordMd5FromServer(userId) {
  const infoUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(userId)}`;
  const { text: infoText } = await fetchText(infoUrl);
  if ((infoText || '').includes('login-page')) return null;

  const studentUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=studentInfo&stuId=${encodeURIComponent(userId)}`;
  const teacherUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=personInfo&teacherId=${encodeURIComponent(userId)}`;
  const urls = (infoText || '').includes('学生') ? [studentUrl, teacherUrl] : [teacherUrl, studentUrl];
  for (const u of urls) {
    const { text } = await fetchText(u);
    if (isSessionEndedHtml(text)) {
      forcePortalLoginInPage = true;
      await ensurePortalLoginTab(false);
      return null;
    }
    const m = String(text || '').match(/(?:id|name)=["']oldpassword["'][^>]*value=["']([^"']+)["']/i)
      || String(text || '').match(/value=["']([^"']+)["'][^>]*(?:id|name)=["']oldpassword["']/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

// -------------------- Login --------------------
function showLoginModal(message = '请输入验证码重新登录') {
  if (!usernameInput.value.trim()) {
    // Username empty: do not block with modal.
    showToast('账号为空：请直接填写 JSESSIONID', 'info', 2500);
    updateJsessionidState();
    jsessionidInput.focus();
    return;
  }
  const instruction = document.getElementById('login-instruction');
  if (instruction) instruction.textContent = message;
  if (loginModalTitle) {
    const msg = String(message || '');
    const isSwitchContext = !!pendingUsernameChange || /切换账号|有效登录状态|目标账号/.test(msg);
    loginModalTitle.textContent = isSwitchContext ? '切换账号' : '登录已失效';
  }
  loginModal.style.display = 'block';
  captchaInput.value = '';
  setLoginProgress('等待登录');
  resetCaptchaHistory();
  // reset OCR loop guards per modal show
  autoOcrAttemptCount = 0;
  autoOcrAutoSubmitUsed = false;
  lastLoginFailedByCaptcha = false;
  captchaErrorRetryCount = 0;
  refreshCaptcha();
  setTimeout(() => captchaInput.focus(), 50);
}

function hideLoginModal() {
  loginModal.style.display = 'none';
}

function isInitialLoginWithoutSwitching() {
  // User requirement: as long as this is NOT account switching,
  // login should be submitted on the opened /ve/ page.
  return !pendingUsernameChange;
}

function shouldUsePortalPageLogin() {
  // Keep login in extension context to avoid captcha/session mismatch.
  // Opening portal page can trigger a new captcha and invalidate extension-fetched code.
  return !!forcePortalLoginInPage;
}

let portalLoginTabId = null;
let forcePortalLoginInPage = false;
async function ensurePortalLoginTab(active = false) {
  try {
    if (portalLoginTabId) {
      const tab = await chrome.tabs.get(portalLoginTabId);
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { active });
        return tab;
      }
    }
  } catch {
    portalLoginTabId = null;
  }

  const tab = await chrome.tabs.create({ url: `${BASE_VE}`, active });
  portalLoginTabId = tab?.id || null;
  return tab;
}

async function closePortalLoginTab() {
  if (!portalLoginTabId) return;
  try {
    await chrome.tabs.remove(portalLoginTabId);
  } catch {
    // ignore
  }
  portalLoginTabId = null;
}

async function openPortalForInitialLogin() {
  await closePortalLoginTab();
  showLoginModal('登录已失效，请输入验证码登录');
}

let lastPortalLoginTime = 0;
async function openPortalLoginForInvalidSession() {
  if (Date.now() - lastPortalLoginTime < 5000) return;
  lastPortalLoginTime = Date.now();
  await closePortalLoginTab();
  showLoginModal('登录状态已失效：请在插件中输入验证码重新登录');
}

async function routeLoginBySessionValidityForSwitch(targetUsername, modalMessage) {
  jsessionidInput.value = '';
  isLoginSessionValid = true;

  let pwdMd5 = '';
  try {
    pwdMd5 = await getLocal(`pwd:${targetUsername}`, '');
    if (!pwdMd5) pwdMd5 = await fetchPasswordMd5FromServer(targetUsername);
  } catch {
    pwdMd5 = '';
  }

  if (pwdMd5) {
    await setLocal(`pwd:${targetUsername}`, pwdMd5);
    showLoginModal(modalMessage || '需要验证码完成账号切换');
    return;
  }

  showToast('切换账号需要重新校验，正在扩展页内处理', 'warning', 2200);
  showLoginModal(modalMessage || '需要验证码完成账号切换');
}

async function waitTabComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.status === 'complete') return true;
    } catch {
      return false;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

async function capturePortalCaptchaDataUrl(tabId) {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        const waitForImage = async (img, timeoutMs = 8000) => {
          if (!img) return false;
          if (img.complete && img.naturalWidth > 0) return true;
          return await new Promise((resolve) => {
            let done = false;
            const finish = (v) => {
              if (done) return;
              done = true;
              cleanup();
              resolve(v);
            };
            const cleanup = () => {
              img.removeEventListener('load', onLoad);
              img.removeEventListener('error', onError);
              clearTimeout(timer);
            };
            const onLoad = () => finish(true);
            const onError = () => finish(false);
            const timer = setTimeout(() => finish(false), timeoutMs);
            img.addEventListener('load', onLoad, { once: true });
            img.addEventListener('error', onError, { once: true });
          });
        };

        const passcodeInput = document.querySelector('input[name="passcode"], input#passcode');
        const form = passcodeInput?.closest('form');
        const root = form || document;
        let img = root.querySelector('img[src*="GetImg"], img[src*="getimg"], img[src*="checkcode"], img[id*="passcode" i], img[name*="passcode" i]');
        if (!img) {
          img = document.querySelector('img[src*="GetImg"], img[src*="getimg"], img[src*="checkcode"], img[id*="passcode" i], img[name*="passcode" i]');
        }
        if (!img) return { ok: false, reason: 'captcha-image-not-found' };

        const srcRaw = String(img.getAttribute('src') || img.src || '/ve/GetImg').trim();
        const noHash = srcRaw.split('#')[0];
        const sep = noHash.includes('?') ? '&' : '?';
        img.src = `${noHash}${sep}_ts=${Date.now()}_${Math.random().toString(16).slice(2)}`;

        const loaded = await waitForImage(img, 8000);
        if (!loaded) return { ok: false, reason: 'captcha-image-load-failed' };

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 120;
        canvas.height = img.naturalHeight || img.height || 40;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { ok: false, reason: 'captcha-canvas-failed' };
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return { ok: true, dataUrl: canvas.toDataURL('image/png') };
      }
    });
    return injected?.[0]?.result || { ok: false, reason: 'captcha-capture-empty' };
  } catch {
    return { ok: false, reason: 'captcha-capture-exception' };
  }
}

async function syncPortalCaptchaToExtension(dataUrl, recognizedText = '', confidence = null) {
  const src = String(dataUrl || '').trim();
  if (!src) return null;

  captchaNonce++;
  const nonce = String(captchaNonce);
  captchaImg.dataset.nonce = nonce;

  if (lastCaptchaObjectUrl && String(lastCaptchaObjectUrl).startsWith('blob:')) {
    try { URL.revokeObjectURL(lastCaptchaObjectUrl); } catch { /* ignore */ }
  }
  lastCaptchaObjectUrl = '';
  captchaImg.src = src;

  try {
    const blobRes = await fetch(src);
    const blob = await blobRes.blob();
    pushCaptchaHistory(blob, nonce);
    markCaptchaHistoryResult(nonce, recognizedText, confidence);
  } catch {
    // If conversion to blob fails, keep preview sync only.
  }

  if (/^\d{4}$/.test(String(recognizedText || ''))) {
    captchaInput.value = String(recognizedText);
    captchaInput.style.backgroundColor = '#e8f5e9';
    setTimeout(() => {
      captchaInput.style.backgroundColor = '';
    }, 350);
  }

  return nonce;
}

async function resolvePortalCaptchaPasscode(tabId, fallbackCode = '', autoOcrEnabled = true) {
  const fallback = String(fallbackCode || '').replace(/\D/g, '').slice(0, 4);
  const capture = await capturePortalCaptchaDataUrl(tabId);
  const dataUrl = String(capture?.dataUrl || '').trim();
  if (!dataUrl) return fallback;

  if (!autoOcrEnabled) {
    await syncPortalCaptchaToExtension(dataUrl, '', null);
    return fallback;
  }

  let recognized = '';
  let confidence = null;

  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('portal-captcha-timeout')), 5000);
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('portal-captcha-error'));
      };
      img.src = dataUrl;
    });
    const ocr = await ocrCaptchaWithTesseract(img);
    recognized = String(ocr?.text || '').trim();
    confidence = Number.isFinite(ocr?.confidence) ? Number(ocr.confidence) : null;
  } catch {
    recognized = '';
    confidence = null;
  }

  await syncPortalCaptchaToExtension(dataUrl, recognized, confidence);
  if (/^\d{4}$/.test(recognized)) return recognized;
  return fallback;
}

async function submitPortalLoginWithCaptchaRetries(username, passwordMd5, fallbackCode, autoOcrEnabled) {
  let lastResult = { ok: false, reason: 'other', message: '登录失败', tabId: null };
  for (let attempt = 0; attempt <= MAX_CAPTCHA_ERROR_RETRIES; attempt++) {
    if (loginCancelRequested) {
      return { ok: false, reason: 'cancelled', message: '已取消', tabId: null };
    }

    const portalTab = await ensurePortalLoginTab(false);
    if (!portalTab?.id) {
      return { ok: false, reason: 'other', message: '无法打开课程平台页面', tabId: null };
    }
    await waitTabComplete(portalTab.id, 15000);

    const passcode = await resolvePortalCaptchaPasscode(portalTab.id, fallbackCode, autoOcrEnabled);
    if (!/^\d{4}$/.test(passcode)) {
      showToast('验证码识别失败，请手动输入后重试', 'warning', 1800);
      return { ok: false, reason: 'captcha', message: '验证码识别失败', tabId: null };
    }

    setLoginProgress(`验证码已同步（第 ${attempt + 1} 次提交）`);
    lastResult = await openPortalAndSubmitLoginInPage(username, passwordMd5, passcode);
    if (lastResult.ok || lastResult.reason !== 'captcha') return lastResult;

    captchaErrorRetryCount++;
    if (captchaErrorRetryCount <= MAX_CAPTCHA_ERROR_RETRIES) {
      showToast(`验证码错误，自动重试 (${captchaErrorRetryCount}/${MAX_CAPTCHA_ERROR_RETRIES})`, 'warning', 1200);
      setLoginProgress(`验证码错误，重试 ${captchaErrorRetryCount}/${MAX_CAPTCHA_ERROR_RETRIES}`, 'warning');
      lastLoginFailedByCaptcha = false;
      continue;
    }

    showToast('验证码错误次数过多，请手动输入', 'warning', 2500);
    setLoginProgress('验证码重试已达上限，请手动输入', 'warning');
    lastLoginFailedByCaptcha = true;
    return lastResult;
  }
  return lastResult;
}

async function openPortalAndSubmitLoginInPage(username, passwordMd5, passcode) {
  let tab = null;
  try {
    tab = await ensurePortalLoginTab(false);
    if (!tab?.id) {
      return { ok: false, reason: 'other', message: '无法打开课程平台页面', tabId: null };
    }
    await waitTabComplete(tab.id, 15000);

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (u, p, c) => {
        const body = new URLSearchParams({
          login: 'main_2',
          qxkt_type: '',
          qxkt_url: '',
          username: String(u || ''),
          password: String(p || ''),
          passcode: String(c || '')
        }).toString();

        const decodeHtmlFromResponse = async (res) => {
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const ct = String(res.headers.get('content-type') || '').toLowerCase();

          const decodeBy = (enc) => {
            try {
              return new TextDecoder(enc).decode(bytes);
            } catch {
              return '';
            }
          };

          // First pass by response header.
          if (ct.includes('gbk') || ct.includes('gb2312') || ct.includes('gb18030')) {
            const t = decodeBy('gb18030') || decodeBy('gbk');
            if (t) return t;
          }
          if (ct.includes('utf-8') || ct.includes('utf8')) {
            const t = decodeBy('utf-8');
            if (t) return t;
          }

          // Fallback: decode as utf-8 first and inspect in-page meta charset.
          const utf8Text = decodeBy('utf-8');
          const head = String(utf8Text || '').slice(0, 2048).toLowerCase();
          const metaSuggestGbk = /charset\s*=\s*["']?\s*(gbk|gb2312|gb18030)\b/.test(head);
          if (metaSuggestGbk || utf8Text.includes('�')) {
            const gbkText = decodeBy('gb18030') || decodeBy('gbk');
            if (gbkText && !gbkText.includes('�')) return gbkText;
          }
          return utf8Text;
        };

        const res = await fetch('/ve/s.shtml', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          body
        });
        const text = await decodeHtmlFromResponse(res);
        return {
          status: res.status,
          url: String(res.url || ''),
          text
        };
      },
      args: [username, passwordMd5, passcode]
    });

    const result = injected?.[0]?.result;
    const text = String(result?.text || '');
    const alertMsg = parseAlertMsg(text);

    if (alertMsg && isCaptchaErrorMessage(alertMsg)) {
      return { ok: false, reason: 'captcha', message: alertMsg, tabId: null };
    }
    if (alertMsg && isAccountLockedMessage(alertMsg)) {
      return { ok: false, reason: 'locked', message: alertMsg, tabId: null };
    }
    if (looksLikeLoginSuccess(text) || /个人中心|退出登录|跳转首页|top\.location/i.test(text)) {
      return { ok: true, tabId: null };
    }
    return { ok: false, reason: 'other', message: alertMsg || '登录失败', tabId: null };
  } catch (e) {
    return { ok: false, reason: 'other', message: e?.message || '登录失败', tabId: null };
  }
}

async function waitAndSyncLoginFromPortal(tabIdToClose = null, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const detected = await detectUserIdFromPersonalCenter();
      if (detected) {
        const pendingPortalSwitch = await getLocal('portalPendingSwitchAfterAux', null);
        const switchTarget = String(pendingPortalSwitch?.targetUsername || '').trim();

        await syncJsessionidToUi();
        if (switchTarget && detected === '8888') {
          await setLocal('portalPendingSwitchAfterAux', null);
          await closePortalLoginTab();

          await setLocal('username', detected);
          lastValidUsername = detected;
          pendingUsernameChange = { from: detected, to: switchTarget };

          usernameInput.value = switchTarget;
          isLoginSessionValid = true;
          updateJsessionidState();
          try {
            setWelcomeMessage(await fetchUserInfoRemote(switchTarget));
          } catch {
            setWelcomeMessage(null);
          }

          hideLoginModal();
          showLoginModal('已用 8888 登录成功，正在扩展页切回目标账号');
          showToast('8888 登录成功，页面已自动关闭，正在切回目标账号', 'warning', 2600);
        } else {
          if (switchTarget && detected !== '8888') {
            await setLocal('portalPendingSwitchAfterAux', null);
          }
          await closePortalLoginTab();
          usernameInput.value = detected;
          await setLocal('username', detected);
          lastValidUsername = detected;
          pendingUsernameChange = null;
          isLoginSessionValid = true;
          updateJsessionidState();
          try {
            setWelcomeMessage(await fetchUserInfoRemote(detected));
          } catch {
            setWelcomeMessage(null);
          }
          hideLoginModal();
          showToast('检测到已在原页面登录成功', 'success', 1800);
        }
        
        if (tabIdToClose) chrome.tabs.remove(tabIdToClose).catch(() => {});

        if (!(switchTarget && detected === '8888') && isPlatformEnabled('ve')) {
          await loadCourses();
        }
        return true;
      }
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  await closePortalLoginTab();
  if (tabIdToClose) chrome.tabs.remove(tabIdToClose).catch(() => {});
  return false;
}

async function runPortalLoginFlow(username, code, autoOcrEnabled) {
  const defaultPwd = md5(`Bjtu@${username}`);
  let portalResult = await submitPortalLoginWithCaptchaRetries(username, defaultPwd, code, autoOcrEnabled);

  if (loginCancelRequested && !portalResult.ok) {
    setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
    showToast('已取消登录：失败后不再重试', 'warning', 1800);
    return;
  }

  if (!portalResult.ok && portalResult.reason !== 'captcha') {
    if (portalResult.reason === 'locked') {
      showToast(portalResult.message || '账号已临时锁定，请稍后再试', 'error', 4500);
      setLoginProgress(portalResult.message || '账号已临时锁定，请稍后再试', 'error');
      return;
    }
    await setLocal('portalPendingSwitchAfterAux', { targetUsername: username });
    const auxPwd = md5('Bjtu@8888');
    const auxRes = await submitPortalLoginWithCaptchaRetries('8888', auxPwd, code, autoOcrEnabled);

    if (loginCancelRequested && !auxRes.ok) {
      setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
      showToast('已取消登录：失败后不再重试', 'warning', 1800);
      return;
    }

    if (!auxRes.ok) {
      if (auxRes.reason === 'locked') {
        showToast(auxRes.message || '8888 账号已临时锁定，请稍后再试', 'error', 4500);
        setLoginProgress(auxRes.message || '8888 账号已临时锁定，请稍后再试', 'error');
        return;
      }
      if (auxRes.reason === 'captcha') {
        captchaInput.value = '';
        if (loginCancelRequested) {
          setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
          return;
        }
        return;
      }
      showToast('8888 登录失败: ' + (auxRes.message || '未知错误'), 'error');
      return;
    }

    const ok = await waitAndSyncLoginFromPortal(auxRes.tabId, 120000);
    if (!ok) {
      showToast('辅助账号登录后状态同步失败，请重试', 'error');
    }
    return;
  }

  if (!portalResult.ok) {
    if (portalResult.reason === 'locked') {
      showToast(portalResult.message || '账号已临时锁定，请稍后再试', 'error', 4500);
      setLoginProgress(portalResult.message || '账号已临时锁定，请稍后再试', 'error');
      return;
    }
    if (portalResult.reason === 'captcha') {
      captchaInput.value = '';
      if (loginCancelRequested) return;
      return;
    }
    showToast(portalResult.message || '登录失败', 'error');
    setLoginProgress(portalResult.message || '登录失败', 'error');
    if (loginCancelRequested) {
      setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
      return;
    }
    return;
  }

  const ok = await waitAndSyncLoginFromPortal(portalResult.tabId, 120000);
  if (!ok) {
    showToast('登录成功但状态同步失败，请重试', 'warning', 2000);
  }
}

async function loginPost(username, passwordMd5, passcode) {
  await setLocal('latestResponseJsessionid', null);
  await setLocal('latestSentLoginJsessionid', null);
  await enforceJsessionidBeforeLoginRequest();
  const body = new URLSearchParams({
    login: 'main_2',
    qxkt_type: '',
    qxkt_url: '',
    username,
    password: passwordMd5,
    passcode
  });
  const { res, text } = await fetchText(`${BASE_VE}s.shtml`, {
    method: 'POST',
    omitSessionId: true,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Origin': BASE
    },
    body: body.toString()
  });

  // Some gateway responses may still alert “验证码错误” while actually rotating/repairing JSESSIONID.
  // Always sync JSESSIONID from response headers/cookie after login POST.
  await syncJsessionidFromResponse(res);
  await forceSyncJsessionidAfterLogin();

  const alertMsg = parseAlertMsg(text);
  if (alertMsg && isCaptchaErrorMessage(alertMsg)) {
    return { ok: false, reason: 'captcha', message: alertMsg };
  }
  if (alertMsg && isAccountLockedMessage(alertMsg)) {
    return { ok: false, reason: 'locked', message: alertMsg };
  }
  if (looksLikeLoginSuccess(text)) {
    return { ok: true };
  }
  return { ok: false, reason: 'other', message: alertMsg || '登录失败' };
}

async function doLoginFlow() {
  if (isLoginInProgress) return;
  const username = usernameInput.value.trim();
  const code = captchaInput.value.trim();
  const wasSwitchingAccount = !!pendingUsernameChange;
  if (!username) {
    showToast('请输入账号，或改为填写 JSESSIONID', 'warning');
    return;
  }
  if (!code) {
    showToast('请输入验证码', 'warning');
    captchaInput.focus();
    return;
  }

  if (shouldUsePortalPageLogin()) {
    showToast('当前配置为原页面登录模式', 'info', 1200);
  }

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.style.opacity = '0.7';
    loginBtn.innerHTML = '登录中… <span class="spinner"></span>';
  }
  setLoginProgress('登录中…');
  showToast('正在登录...', 'info', 0);
  isLoginInProgress = true;
  loginCancelRequested = false;

  try {
    const autoOcrEnabled = await getAutoOcrCaptchaEnabled();
    const retryTip = (n) => autoOcrEnabled
      ? `验证码错误，自动重试 (${n}/${MAX_CAPTCHA_ERROR_RETRIES})`
      : '验证码错误，请重试';

    // Keep captcha generation and login submit in the same (extension) context.
    const isPortalFlow = shouldUsePortalPageLogin();

    if (isPortalFlow) {
      await runPortalLoginFlow(username, code, autoOcrEnabled);
      return;
    }

    // Determine strategy
    const forceAux = !!(auxCheckbox && auxCheckbox.checked);
    let pwdMd5 = await getLocal(`pwd:${username}`, '');
    if (!pwdMd5) pwdMd5 = await fetchPasswordMd5FromServer(username);

    if (shouldUsePortalPageLogin()) {
      await runPortalLoginFlow(username, code, autoOcrEnabled);
      return;
    }

    if (!pwdMd5) pwdMd5 = md5(`Bjtu@${username}`);

    let result = await loginPost(username, pwdMd5, code);
    if (loginCancelRequested && !result.ok) {
      setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
      showToast('已取消登录：失败后不再重试', 'warning', 1800);
      return;
    }
    if (!result.ok && result.reason !== 'captcha') {
      if (result.reason === 'locked') {
        showToast(result.message || '账号已临时锁定，请稍后再试', 'error', 4500);
        setLoginProgress(result.message || '账号已临时锁定，请稍后再试', 'error');
        return;
      }
      // fallback to aux
      if (forceAux || true) {
        const auxPwd = md5('Bjtu@8888');
        const auxRes = await loginPost('8888', auxPwd, code);
        if (loginCancelRequested && !auxRes.ok) {
          setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
          showToast('已取消登录：失败后不再重试', 'warning', 1800);
          return;
        }
        if (!auxRes.ok) {
          if (auxRes.reason === 'locked') {
            showToast(auxRes.message || '8888 账号已临时锁定，请稍后再试', 'error', 4500);
            setLoginProgress(auxRes.message || '8888 账号已临时锁定，请稍后再试', 'error');
            return;
          }
          if (auxRes.reason === 'captcha') {
            captchaInput.value = '';
            captchaErrorRetryCount++;
            if (captchaErrorRetryCount <= MAX_CAPTCHA_ERROR_RETRIES) {
              showToast(retryTip(captchaErrorRetryCount), 'warning', 1200);
              setLoginProgress(`验证码错误，重试 ${captchaErrorRetryCount}/${MAX_CAPTCHA_ERROR_RETRIES}`, 'warning');
              lastLoginFailedByCaptcha = false;
              autoOcrAutoSubmitUsed = false;
              if (loginCancelRequested) {
                setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
                return;
              }
              await refreshCaptcha();
              return;
            }
            showToast('验证码错误次数过多，请手动输入', 'warning', 2500);
            setLoginProgress('验证码重试已达上限，请手动输入', 'warning');
            lastLoginFailedByCaptcha = true;
            await refreshCaptcha();
            return;
          }
          showToast('辅助账号登录失败: ' + (auxRes.message || '未知错误'), 'error');
          await refreshCaptcha();
          return;
        }

        const foundPwd = await fetchPasswordMd5FromServer(username);
        if (foundPwd) {
          await setLocal(`pwd:${username}`, foundPwd);
          pwdMd5 = foundPwd;
          result = await loginPost(username, foundPwd, code);
        }
      }
    }

    if (!result.ok) {
      if (result.reason === 'locked') {
        showToast(result.message || '账号已临时锁定，请稍后再试', 'error', 4500);
        setLoginProgress(result.message || '账号已临时锁定，请稍后再试', 'error');
        return;
      }
      if (result.reason === 'captcha') {
        captchaInput.value = '';
        captchaErrorRetryCount++;
        if (captchaErrorRetryCount <= MAX_CAPTCHA_ERROR_RETRIES) {
          showToast(retryTip(captchaErrorRetryCount), 'warning', 1200);
          setLoginProgress(`验证码错误，重试 ${captchaErrorRetryCount}/${MAX_CAPTCHA_ERROR_RETRIES}`, 'warning');
          lastLoginFailedByCaptcha = false;
          autoOcrAutoSubmitUsed = false;
          if (loginCancelRequested) return;
          await refreshCaptcha();
          return;
        }
        showToast('验证码错误次数过多，请手动输入', 'warning', 2500);
        setLoginProgress('验证码重试已达上限，请手动输入', 'warning');
        lastLoginFailedByCaptcha = true;
      } else {
        showToast(result.message || '登录失败', 'error');
        setLoginProgress(result.message || '登录失败', 'error');
        lastLoginFailedByCaptcha = false;
      }
      if (loginCancelRequested) {
        setLoginProgress('已取消：本次登录失败后停止重试', 'warning');
        return;
      }
      await refreshCaptcha();
      return;
    }

    // Success
    isLoginSessionValid = true;
    setLoginProgress('登录成功，正在关闭页面…', 'success');
    hideLoginModal();
    showToast('登录成功', 'success');
    await forceSyncJsessionidAfterLogin();
    await syncJsessionidToUi();

    // Verify account identity after login (personalCenter -> 学号/工号)
    let finalUser = username;
    try {
      const detected = await detectUserIdFromPersonalCenter();
      if (detected && detected !== username) {
        finalUser = detected;
        showToast(`检测到当前账号为 ${detected}，已同步更新`, 'warning', 2500);
      }
    } catch {
      // ignore
    }

    const userBeforeLogin = String(lastValidUsername || '').trim();

    // Always sync UI to the final logged-in account (even if user clicked Cancel during “登录中...”).
    usernameInput.value = finalUser;
    updateJsessionidState();

    await setLocal('username', finalUser);
    lastValidUsername = finalUser;
    pendingUsernameChange = null;
    // refresh welcome text
    try {
      const info = await fetchUserInfoRemote(finalUser);
      setWelcomeMessage(info);
    } catch {}

    // run pending callbacks
    const cbs = pendingLoginCallbacks;
    pendingLoginCallbacks = [];
    cbs.forEach(fn => {
      try { fn(); } catch {}
    });

    // Account switching should trigger a VE course/homework refresh.
    // Retry-callback logins should not force an additional full reload.
    const shouldReloadCourses = wasSwitchingAccount || (cbs.length === 0 && userBeforeLogin === finalUser);
    if (shouldReloadCourses && isPlatformEnabled('ve')) {
      await loadCourses();
    }
    await loadResourceSpaceForCurrentAccount();

  } finally {
    forcePortalLoginInPage = false;
    isLoginInProgress = false;
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.style.opacity = '1';
      loginBtn.innerHTML = '登录';
    }
  }
}

// -------------------- Courses / Homework / Videos --------------------
function normalizeCourseNumToken(v) {
  return String(v || '').trim().toUpperCase();
}

function normalizeTail10Token(v) {
  const t = normalizeCourseNumToken(v).replace(/[^A-Z0-9]/g, '');
  return t.length > 10 ? t.slice(-10) : t;
}

function getVeCourseSeq10(course) {
  const fzId = course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '';
  const fromFzId = normalizeTail10Token(fzId);
  if (fromFzId) return fromFzId;
  const fallback = course?.course_num || course?.courseNum || course?.courseNo || course?.course_id || course?.courseId || course?.id || course?.cId || '';
  return normalizeTail10Token(fallback);
}

function collectVeFzIdTail10Map(courses) {
  const m = new Map();
  (courses || []).forEach((course) => {
    const courseId = course.id || course.cId || course.courseId || course.course_id;
    const fzId = course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '';
    const seq10 = normalizeTail10Token(fzId);
    if (courseId && seq10) {
      m.set(seq10, { courseId, fzId });
    }
  });
  return m;
}

function normalizeCourseNameToken(v) {
  return String(v || '')
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]【】{}<>《》:：·、,，.。!！?？'"`~_^\\/|-]/g, '')
    .trim()
    .toUpperCase();
}

function findCourseMatch(tokenMap, nameMap, token, nameToken) {
  const t = String(token || '').trim();
  const nt = String(nameToken || '').trim();
  if (t) {
    const direct = tokenMap.get(t);
    if (direct) return direct;
  }
  if (nt) {
    const directName = nameMap.get(nt);
    if (directName) return directName;
    for (const [k, v] of nameMap.entries()) {
      if (!k || k.length < 4 || nt.length < 4) continue;
      if (k.includes(nt) || nt.includes(k)) return v;
    }
  }
  return null;
}

function formatMrzyDateTime(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayEndDateTimeString() {
  const now = new Date();
  return formatMrzyDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59));
}

function parseDeadlineToTs(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? n * 1000 : n;
  }
  const s = String(v || '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? n * 1000 : n;
  }
  const normalized = s.replace(/\//g, '-').replace(/\./g, '-').replace('T', ' ');
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : 0;
}

function isDeadlinePassed(v) {
  const ts = parseDeadlineToTs(v);
  return !!(ts && ts < Date.now());
}

function sortHomeworkItemsByDeadline(items, pickDeadline) {
  const list = Array.isArray(items) ? items.slice() : [];
  return list
    .map((it, idx) => {
      const raw = pickDeadline ? pickDeadline(it) : '';
      const ts = parseDeadlineToTs(raw);
      return {
        it,
        idx,
        ts: ts > 0 ? ts : Number.MAX_SAFE_INTEGER
      };
    })
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return a.idx - b.idx;
    })
    .map((x) => x.it);
}

function setResourceSpaceStatus(text = '', tone = 'normal') {
  if (!resourceSpaceStatus) return;
  resourceSpaceStatus.textContent = String(text || '');
  if (tone === 'error') {
    resourceSpaceStatus.style.color = '#b91c1c';
  } else if (tone === 'success') {
    resourceSpaceStatus.style.color = '#166534';
  } else if (tone === 'warning') {
    resourceSpaceStatus.style.color = '#92400e';
  } else {
    resourceSpaceStatus.style.color = '#64748b';
  }
}

function setResourceSpaceCount(count = 0, mode = 'total') {
  if (!resourceSpaceCount) return;
  const n = Math.max(0, Number(count) || 0);
  if (String(mode) === 'loaded') {
    resourceSpaceCount.textContent = `已加载 ${n} 个资源文件`;
    return;
  }
  resourceSpaceCount.textContent = `共 ${n} 个资源文件`;
}

function normalizeResourceUrl(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${BASE}${raw}`;
  return `${BASE_VE}${raw}`;
}

function formatResourceSizeMb(rpSize) {
  const n = Number(rpSize);
  if (!Number.isFinite(n) || n < 0) return '未知';
  return `${n.toFixed(2)}MB`;
}

function buildResourceSizeEmphasisStyle(rpSize) {
  const mb = Number(rpSize);
  if (!Number.isFinite(mb) || mb <= 0) {
    return 'font-size:10px; font-weight:500; color:#94a3b8; text-shadow:none;';
  }

  // Log scale keeps very large files from exploding while preserving contrast.
  const ratio = Math.max(0, Math.min(1, Math.log10(mb + 1) / Math.log10(1024 + 1)));
  const fontPx = (10 + ratio * 6).toFixed(2); // 10px -> 16px
  const colorLight = Math.round(148 - ratio * 118); // lighter start -> deep end
  const g = Math.max(18, colorLight + 8);
  const b = Math.max(28, colorLight + 20);
  const weight = Math.round(500 + ratio * 320); // 500 -> 820
  // Keep low-end clean (no shadow), gradually add emphasis for larger files.
  const shadowBlur = Math.max(0, (ratio - 0.18) * 5).toFixed(2);
  const shadowAlpha = Math.max(0, (ratio - 0.2) * 0.35).toFixed(2);
  const shadow = shadowBlur === '0.00' ? 'none' : `0 1px ${shadowBlur}px rgba(15,23,42,${shadowAlpha})`;
  return `font-size:${fontPx}px; font-weight:${weight}; color:rgb(${colorLight},${g},${b}); text-shadow:${shadow};`;
}

function sanitizeDownloadFileName(name, fallback = 'download') {
  const src = String(name || '').trim();
  const cleaned = src
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function normalizeResourceExt(ext) {
  const raw = String(ext || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^\.+/, '')
    .replace(/[?#].*$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .trim();
}

function inferResourceExtFromUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const seg = String(u.pathname || '').split('/').pop() || '';
    const m = seg.match(/\.([a-zA-Z0-9_-]{1,16})$/);
    return normalizeResourceExt(m?.[1] || '');
  } catch {
    const m = String(url || '').match(/\.([a-zA-Z0-9_-]{1,16})(?:[?#]|$)/);
    return normalizeResourceExt(m?.[1] || '');
  }
}

function ensureResourceDownloadFileName(item, rawUrl) {
  const baseName = sanitizeDownloadFileName(item?.name || 'resource-file');
  const preferredExt = normalizeResourceExt(item?.extName || item?.rpPrix || '');
  const existingExt = normalizeResourceExt((String(baseName).match(/\.([a-zA-Z0-9_-]{1,16})$/)?.[1]) || '');
  const finalExt = preferredExt || existingExt || inferResourceExtFromUrl(rawUrl);
  if (!finalExt) return baseName;
  if (existingExt && existingExt.toLowerCase() === finalExt.toLowerCase()) return baseName;
  if (existingExt && preferredExt) {
    return baseName.replace(/\.[a-zA-Z0-9_-]{1,16}$/, `.${finalExt}`);
  }
  return `${baseName}.${finalExt}`;
}

function findResourceItemElementById(resourceId) {
  const rid = String(resourceId || '').trim();
  if (!rid) return null;
  const rows = document.querySelectorAll('.file-item[data-resource-id]');
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    if (String(row.dataset.resourceId || '').trim() === rid) return row;
  }
  return null;
}

function getSelectableDownloadItems() {
  const native = Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : [];
  const courseware = Object.values(window.coursewareItemsById || {});
  const attachments = Object.values(window.homeworkAttachmentItemsById || {});
  return [...native, ...courseware, ...attachments];
}

function findSelectableDownloadItemById(resourceId) {
  const rid = String(resourceId || '').trim();
  if (!rid) return null;
  const native = (window.resourceSpaceItems || []).find((x) => String(x?.id || '').trim() === rid);
  if (native) return native;
  return window.coursewareItemsById?.[rid] || window.homeworkAttachmentItemsById?.[rid] || null;
}

function getResourceItemSizeBytes(item) {
  const mb = Number(item?.sizeMbRaw ?? item?.rpSize ?? NaN);
  if (!Number.isFinite(mb) || mb < 0) return 0;
  return Math.round(mb * 1024 * 1024);
}

function resetResourceDownloadBatch() {
  window.resourceDownloadBatch = {
    active: false,
    totalFiles: 0,
    totalBytes: 0,
    knownTotal: true,
    completedFiles: 0,
    completedBytes: 0
  };
}

function processResourceDownloadQueue() {
  const limit = Math.max(1, Number(maxParallelUploads) || 1);
  while (window.resourceDownloadQueueRunning < limit && window.resourceDownloadQueue.length > 0) {
    const entry = window.resourceDownloadQueue.shift();
    if (!entry || entry.cancelled) continue;
    entry.started = true;
    window.resourceDownloadQueueRunning += 1;
    (async () => {
      try {
        await downloadResourceItemWithProgress(entry.item);
        entry.resolve();
      } catch (err) {
        entry.reject(err);
      } finally {
        window.resourceDownloadQueueRunning = Math.max(0, Number(window.resourceDownloadQueueRunning || 0) - 1);
        const rid = String(entry?.id || '').trim();
        if (rid && window.resourceDownloadQueueById[rid] === entry) {
          delete window.resourceDownloadQueueById[rid];
        }
        processResourceDownloadQueue();
      }
    })();
  }
}

function enqueueResourceDownload(item) {
  const id = String(item?.id || '').trim();
  if (!id) return Promise.reject(new Error('资源链接无效'));
  if (isResourceDownloadActive(id)) return Promise.reject(new Error('该文件正在下载中'));
  const expectedBytes = getResourceItemSizeBytes(item);

  const existing = window.resourceDownloadQueueById?.[id];
  if (existing?.promise) return existing.promise;

  let resolveRef;
  let rejectRef;
  const promise = new Promise((resolve, reject) => {
    resolveRef = resolve;
    rejectRef = reject;
  });

  const entry = {
    id,
    item,
    expectedBytes,
    resolve: resolveRef,
    reject: rejectRef,
    cancelled: false,
    started: false,
    promise
  };

  window.resourceDownloadQueue.push(entry);
  window.resourceDownloadQueueById[id] = entry;

  setResourceItemDownloadingState(id, true);
  setResourceDownloadUi(id, {
    active: true,
    percent: 0,
    loaded: 0,
    total: expectedBytes,
    speed: 0,
    etaSec: null,
    status: '排队等待...'
  });

  processResourceDownloadQueue();
  return promise;
}

function startResourceDownloadBatch(items) {
  const list = Array.isArray(items) ? items : [];
  let totalBytes = 0;
  let knownTotal = true;
  list.forEach((it) => {
    const b = getResourceItemSizeBytes(it);
    if (b > 0) totalBytes += b;
    else knownTotal = false;
  });
  window.resourceDownloadBatch = {
    active: true,
    totalFiles: list.length,
    totalBytes,
    knownTotal,
    completedFiles: 0,
    completedBytes: 0
  };
  updateResourceDownloadTotals();
}

function markResourceDownloadBatchDone(item, success = true) {
  const batch = window.resourceDownloadBatch;
  if (!batch || !batch.active) return;
  batch.completedFiles += 1;
  if (success) {
    const guess = getResourceItemSizeBytes(item);
    if (guess > 0) batch.completedBytes += guess;
  }
  updateResourceDownloadTotals();
}

function getResourceDownloadTask(resourceId) {
  const rid = String(resourceId || '').trim();
  if (!rid) return null;
  return window.resourceDownloadTasks?.[rid] || null;
}

function isResourceDownloadActive(resourceId) {
  return !!getResourceDownloadTask(resourceId)?.active;
}

function setResourceItemDownloadingState(resourceId, downloading) {
  const row = findResourceItemElementById(resourceId);
  if (!row) return;
  const checkbox = row.querySelector('input[data-action="resource-check"]');
  const downloadBtn = row.querySelector('button.resource-download-btn');

  if (checkbox instanceof HTMLInputElement) {
    checkbox.disabled = !!downloading;
    if (downloading) {
      checkbox.checked = false;
      window.resourceSpaceSelected.delete(String(resourceId || '').trim());
    }
  }

  if (downloadBtn instanceof HTMLButtonElement) {
    if (downloading) {
      downloadBtn.dataset.action = 'resource-cancel-download';
      downloadBtn.textContent = '取消';
      downloadBtn.classList.add('is-cancel');
    } else {
      downloadBtn.dataset.action = 'resource-download';
      downloadBtn.textContent = '下载';
      downloadBtn.classList.remove('is-cancel');
      downloadBtn.disabled = false;
    }
  }
}

function updateResourceDownloadTotals() {
  if (!resourceTotalBar || !resourceTotalSizeInfo || !resourceTotalPercent || !resourceTotalSpeed || !resourceTotalEta) return;
  const tasks = Object.values(window.resourceDownloadTasks || {}).filter((t) => t && t.active);
  const queuedEntries = (window.resourceDownloadQueue || []).filter((q) => q && !q.cancelled && !q.started);
  const batch = window.resourceDownloadBatch || {};
  if (!tasks.length && !batch.active && !queuedEntries.length) {
    resourceTotalBar.style.width = '0%';
    resourceTotalBar.textContent = '0%';
    resourceTotalSizeInfo.textContent = '0 B / 0 B';
    resourceTotalPercent.textContent = '0%';
    resourceTotalSpeed.textContent = '总速度: 0 KB/s';
    resourceTotalEta.textContent = '';
    return;
  }

  const batchActive = !!batch.active;
  let totalLoaded = batchActive ? Math.max(0, Number(batch.completedBytes) || 0) : 0;
  let totalSize = batchActive ? Math.max(0, Number(batch.totalBytes) || 0) : 0;
  let hasKnownTotal = batchActive ? (batch.knownTotal !== false) : true;
  let totalSpeed = 0;
  tasks.forEach((t) => {
    const loaded = Math.max(0, Number(t.loaded) || 0);
    const total = Math.max(0, Number(t.total) || 0);
    const speed = Math.max(0, Number(t.speed) || 0);
    totalLoaded += loaded;
    totalSpeed += speed;
    if (!batchActive) {
      if (total > 0) {
        totalSize += total;
      } else {
        hasKnownTotal = false;
      }
    }
  });

  if (!batchActive) {
    queuedEntries.forEach((q) => {
      const expected = Math.max(0, Number(q?.expectedBytes) || 0);
      if (expected > 0) {
        totalSize += expected;
      } else {
        hasKnownTotal = false;
      }
      // queued items contribute 0 speed by design
    });
  }

  const percent = hasKnownTotal && totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0;
  resourceTotalBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  resourceTotalBar.textContent = `${Math.max(0, Math.min(100, percent))}%`;
  resourceTotalSizeInfo.textContent = hasKnownTotal && totalSize > 0
    ? `${formatSize(totalLoaded)} / ${formatSize(totalSize)}`
    : `${formatSize(totalLoaded)} / --`;
  resourceTotalPercent.textContent = hasKnownTotal && totalSize > 0 ? `${percent}%` : '--';
  resourceTotalSpeed.textContent = `总速度: ${formatSpeed(totalSpeed)}`;

  if (hasKnownTotal && totalSize > totalLoaded && totalSpeed > 0) {
    resourceTotalEta.textContent = `总剩余: ${formatEta((totalSize - totalLoaded) / totalSpeed)}`;
  } else if (hasKnownTotal && totalSize > totalLoaded) {
    resourceTotalEta.textContent = '总剩余: 计算中...';
  } else if (tasks.length || batchActive || queuedEntries.length) {
    resourceTotalEta.textContent = hasKnownTotal ? '' : '总剩余: 计算中...';
  } else {
    resourceTotalEta.textContent = '';
  }
}

function cancelResourceDownload(resourceId) {
  const rid = String(resourceId || '').trim();
  const task = getResourceDownloadTask(rid);
  if (task && task.active) {
    task.cancelled = true;
    try { task.abortController?.abort(); } catch { /* ignore */ }
    try { task.xhr?.abort(); } catch { /* ignore */ }
    if (Number.isFinite(Number(task.chromeDownloadId)) && chrome?.downloads?.cancel) {
      try { chrome.downloads.cancel(Number(task.chromeDownloadId), () => {}); } catch { /* ignore */ }
    }
    return true;
  }

  const queued = window.resourceDownloadQueueById?.[rid];
  if (queued && !queued.started) {
    queued.cancelled = true;
    window.resourceDownloadQueue = (window.resourceDownloadQueue || []).filter((it) => it !== queued);
    delete window.resourceDownloadQueueById[rid];
    try { queued.reject(new Error('下载已取消')); } catch { /* ignore */ }
    setResourceDownloadUi(rid, {
      active: true,
      percent: 0,
      loaded: 0,
      total: 0,
      speed: 0,
      etaSec: null,
      status: '已取消'
    });
    setTimeout(() => {
      setResourceDownloadUi(rid, { active: false, percent: 0, loaded: 0, total: 0, speed: 0, etaSec: null, status: '' });
      setResourceItemDownloadingState(rid, false);
    }, 1200);
    return true;
  }
  return false;
}

function setResourceDownloadUi(resourceId, { active = false, percent = 0, loaded = 0, total = 0, speed = 0, etaSec = null, status = '' } = {}) {
  const row = findResourceItemElementById(resourceId);
  if (!row) return;
  const wrap = row.querySelector('.resource-download-progress');
  const bar = row.querySelector('.resource-download-progress .progress-bar');
  const statusEl = row.querySelector('.resource-dl-status');
  const sizeEl = row.querySelector('.resource-dl-size');
  const speedEl = row.querySelector('.resource-dl-speed');
  const etaEl = row.querySelector('.resource-dl-eta');
  if (!(wrap instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;

  wrap.style.display = active ? 'block' : 'none';

  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  bar.style.width = `${pct}%`;
  bar.textContent = `${pct}%`;

  if (statusEl instanceof HTMLElement) statusEl.textContent = String(status || '');

  if (sizeEl instanceof HTMLElement) {
    const loadedSafe = Math.max(0, Number(loaded) || 0);
    const totalSafe = Math.max(0, Number(total) || 0);
    if (totalSafe > 0) {
      sizeEl.textContent = `(${formatSize(loadedSafe)} / ${formatSize(totalSafe)})`;
    } else if (loadedSafe > 0) {
      sizeEl.textContent = `(${formatSize(loadedSafe)})`;
    } else {
      sizeEl.textContent = '';
    }
  }

  if (speedEl instanceof HTMLElement) {
    speedEl.textContent = active ? formatSpeed(Math.max(0, Number(speed) || 0)) : '';
  }
  if (etaEl instanceof HTMLElement) {
    if (active && Number.isFinite(Number(etaSec)) && Number(etaSec) > 0) {
      etaEl.textContent = `剩余: ${formatEta(Number(etaSec))}`;
    } else if (active && total > 0 && loaded >= total) {
      etaEl.textContent = '剩余: 0秒';
    } else if (active) {
      etaEl.textContent = '剩余: --';
    } else {
      etaEl.textContent = '';
    }
  }

  const task = getResourceDownloadTask(resourceId);
  if (task) {
    task.loaded = Math.max(0, Number(loaded) || 0);
    task.total = Math.max(0, Number(total) || 0);
    task.speed = Math.max(0, Number(speed) || 0);
  }
  updateResourceDownloadTotals();
}

async function downloadResourceItemWithProgress(item) {
  const id = String(item?.id || '').trim();
  const rawUrl = String(item?.url || '').trim();
  const fileName = ensureResourceDownloadFileName(item, rawUrl);
  const expectedBytes = getResourceItemSizeBytes(item);
  if (!id || !rawUrl) throw new Error('资源链接无效');

  if (isResourceDownloadActive(id)) {
    throw new Error('该文件正在下载中');
  }

  const url = (() => {
    try {
      return encodeURI(rawUrl);
    } catch {
      return rawUrl;
    }
  })();

  const PROGRESS_INTERVAL_MS = 180;
  const task = {
    active: true,
    loaded: 0,
    total: expectedBytes,
    speed: 0,
    samples: [],
    lastUiTs: 0,
    abortController: null,
    xhr: null,
    cancelled: false,
    chromeDownloadId: null
  };
  window.resourceDownloadTasks[id] = task;
  setResourceItemDownloadingState(id, true);
  setResourceDownloadUi(id, {
    active: true,
    percent: 0,
    loaded: 0,
    total: expectedBytes,
    speed: 0,
    etaSec: null,
    status: '下载中...'
  });

  const updateProgress = (loaded, total, status = '下载中...', force = false) => {
    const now = Date.now();
    const loadedSafe = Math.max(0, Number(loaded) || 0);
    const totalSafe = Math.max(0, Number(total) || 0);
    task.loaded = loadedSafe;
    task.total = totalSafe;

    const speed = pushAndCalcRecentSpeed(task.samples, loadedSafe, now);
    task.speed = speed;

    if (!force && now - task.lastUiTs < PROGRESS_INTERVAL_MS) return;
    task.lastUiTs = now;

    const percent = totalSafe > 0 ? Math.round((loadedSafe / totalSafe) * 100) : 0;
    const etaSec = (totalSafe > 0 && speed > 0) ? ((totalSafe - loadedSafe) / speed) : null;
    setResourceDownloadUi(id, {
      active: true,
      percent,
      loaded: loadedSafe,
      total: totalSafe,
      speed,
      etaSec,
      status
    });
  };

  const finalizeSuccessUi = (loaded, total, status = '已保存') => {
    setResourceDownloadUi(id, {
      active: true,
      percent: 100,
      loaded,
      total,
      speed: 0,
      etaSec: 0,
      status
    });
  };

  const finalizeCancelledUi = () => {
    setResourceDownloadUi(id, {
      active: true,
      percent: 0,
      loaded: 0,
      total: 0,
      speed: 0,
      etaSec: null,
      status: '已取消'
    });
  };

  const cleanup = () => {
    task.active = false;
    task.speed = 0;
    task.abortController = null;
    task.xhr = null;
    task.chromeDownloadId = null;
    setResourceItemDownloadingState(id, false);
    updateResourceDownloadTotals();
    setTimeout(() => {
      const latest = getResourceDownloadTask(id);
      if (latest && latest.active) return;
      setResourceDownloadUi(id, { active: false, percent: 0, loaded: 0, total: 0, speed: 0, etaSec: null, status: '' });
    }, 1800);
  };

  const saveBlobToFile = (blob, loaded = 0, total = 0) => {
    if (task.cancelled) throw new Error('下载已取消');
    const finalTotal = total > 0 ? total : (blob?.size || loaded);
    const finalLoaded = blob?.size || loaded;
    finalizeSuccessUi(finalLoaded, finalTotal, '下载完成，准备保存...');

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener noreferrer';
    a.click();
    setTimeout(() => {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
    }, 1500);

    finalizeSuccessUi(finalLoaded, finalTotal, '已保存');
  };

  const tryDownloadByXhr = () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    task.xhr = xhr;
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    xhr.onprogress = (e) => {
      updateProgress(Number(e.loaded || 0), Number(e.total || 0), '下载中...');
    };

    xhr.onload = () => {
      task.xhr = null;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`HTTP ${xhr.status}`));
        return;
      }
      const blob = xhr.response;
      if (!(blob instanceof Blob)) {
        reject(new Error('返回内容无效'));
        return;
      }
      const loaded = Number(blob.size || 0);
      const total = Number(xhr.getResponseHeader('content-length') || loaded || 0);
      updateProgress(loaded, total, '下载中...', true);
      resolve({ blob, loaded, total });
    };

    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.onabort = () => reject(new Error(task.cancelled ? '下载已取消' : '下载已中止'));
    xhr.send();
  });

  const fallbackToBrowserDirectDownload = () => {
    if (task.cancelled) throw new Error('下载已取消');
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
    finalizeSuccessUi(0, 0, '已转为浏览器下载');
  };

  const tryChromeDownloadsApi = () => new Promise((resolve, reject) => {
    if (!chrome?.downloads?.download) {
      reject(new Error('downloads-api-unavailable'));
      return;
    }
    chrome.downloads.download(
      {
        url,
        filename: fileName,
        conflictAction: 'uniquify',
        saveAs: false
      },
      (downloadId) => {
        const err = chrome.runtime?.lastError;
        if (err) {
          reject(new Error(String(err.message || 'downloads-api-failed')));
          return;
        }
        if (!Number.isFinite(Number(downloadId)) || Number(downloadId) <= 0) {
          reject(new Error('downloads-api-invalid-id'));
          return;
        }
        task.chromeDownloadId = Number(downloadId);
        resolve(downloadId);
      }
    );
  });

  try {
    task.abortController = new AbortController();
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: task.abortController.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length') || 0);
    let loaded = 0;
    let blob;

    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (task.cancelled) throw new Error('下载已取消');
          chunks.push(value);
          loaded += value.byteLength;
          updateProgress(loaded, total, '下载中...');
        }
      }
      blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
    } else {
      blob = await res.blob();
      loaded = blob.size;
      updateProgress(loaded, total || loaded, '下载中...', true);
    }

    saveBlobToFile(blob, loaded, total);
    cleanup();
  } catch (fetchErr) {
    if (task.cancelled || String(fetchErr?.name || '').toLowerCase() === 'aborterror') {
      finalizeCancelledUi();
      cleanup();
      throw new Error('下载已取消');
    }
    try {
      setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: task.speed, etaSec: null, status: 'Fetch失败，正在重试...' });
      const xhrResult = await tryDownloadByXhr();
      saveBlobToFile(xhrResult.blob, xhrResult.loaded, xhrResult.total);
      cleanup();
    } catch (xhrErr) {
      if (task.cancelled) {
        finalizeCancelledUi();
        cleanup();
        throw new Error('下载已取消');
      }
      try {
        setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: task.speed, etaSec: null, status: '页面下载失败，转浏览器下载...' });
        await tryChromeDownloadsApi();
        finalizeSuccessUi(0, 0, '已转为浏览器下载');
        cleanup();
      } catch {
        try {
          fallbackToBrowserDirectDownload();
          cleanup();
        } catch {
          setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: 0, etaSec: null, status: '下载失败' });
          cleanup();
          throw new Error(`下载失败: ${String(fetchErr?.message || fetchErr)}; ${String(xhrErr?.message || xhrErr)}`);
        }
      }
    }
  }
}

function renderResourceSpaceList() {
  if (!resourceSpaceList) return;
  const list = Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : [];
  if (!list.length) {
    resourceSpaceList.innerHTML = '<div style="font-size:12px; color:#999;">暂无资源文件</div>';
    return;
  }

  resourceSpaceList.innerHTML = list.map((it) => {
    const id = String(it.id || '').trim();
    const checked = window.resourceSpaceSelected.has(id) ? 'checked' : '';
    const name = String(it.name || '未命名文件').trim();
    const uploadTime = String(it.inputTime || '未知').trim();
    const sizeMb = String(it.sizeMb || '未知').trim();
    const sizeStyle = buildResourceSizeEmphasisStyle(it?.sizeMbRaw);
    const url = String(it.url || '').trim();
    return `
      <div class="file-item" data-resource-id="${escapeHtml(id)}">
        <div class="resource-row-main">
          <div class="resource-row-left">
            <input type="checkbox" data-action="resource-check" data-resource-id="${escapeHtml(id)}" ${checked} style="margin-top:2px;">
            <div style="min-width:0; flex:1;">
              <div class="resource-row-title">
                <span class="resource-name">${escapeHtml(name)}</span>
                <span class="resource-time-inline" style="${sizeStyle}">${escapeHtml(sizeMb)}</span>
                <span class="resource-time-inline">上传时间: ${escapeHtml(uploadTime)}</span>
              </div>
              <div class="resource-link-row">
                <a class="resource-url" href="${escapeHtml(url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
                <button class="btn resource-copy-btn" data-action="resource-copy" data-resource-id="${escapeHtml(id)}">复制</button>
                <button class="btn resource-download-btn" data-action="resource-download" data-resource-id="${escapeHtml(id)}">下载</button>
              </div>
            </div>
          </div>
        </div>
        <div class="resource-download-progress" style="display:none;">
          <div class="progress-bar-container"><div class="progress-bar">0%</div></div>
          <div class="resource-download-meta">
            <span class="resource-dl-status"></span>
            <span class="resource-dl-size"></span>
            <span class="resource-dl-speed"></span>
            <span class="resource-dl-eta"></span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  updateResourceDownloadTotals();
}

async function fetchResourceSpaceListRaw(rows = 10) {
  const url = `${BASE_VE}back/resourceSpace.shtml?method=resourceSpaceList`;
  const body = new URLSearchParams({ type: '1', rows: String(Math.max(1, Number(rows) || 10)) });
  const { text, res } = await fetchText(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: body.toString()
  });
  if (isLikelyLoginPageHtml(text, res?.url)) return { loginRequired: true, total: 0, result: [] };
  let data = null;
  try { data = JSON.parse(String(text || '{}')); } catch { data = null; }
  if (!data || typeof data !== 'object') return { loginRequired: true, total: 0, result: [] };
  const total = Number(data.total || 0);
  const result = Array.isArray(data.result) ? data.result : [];
  return { loginRequired: false, total, result };
}

async function loadResourceSpaceForCurrentAccount() {
  if (!resourceSpaceSection || !resourceSpaceList) return;
  const loadVersion = ++window.resourceSpaceLoadVersion;
  const isStale = () => loadVersion !== window.resourceSpaceLoadVersion;

  setResourceSpaceStatus('资源空间加载中...');
  resourceSpaceList.innerHTML = '';
  window.resourceDownloadTasks = {};
  resetResourceDownloadBatch();
  updateResourceDownloadTotals();

  try {
    const firstRows = 10;
    let payload = await fetchResourceSpaceListRaw(firstRows);
    if (isStale()) return;

    if (payload.loginRequired) {
      window.resourceSpaceItems = [];
      window.resourceSpaceSelected = new Set();
      window.resourceDownloadTasks = {};
      resetResourceDownloadBatch();
      setResourceSpaceCount(0);
      setResourceSpaceStatus('未登录或登录已失效，请先登录智慧课程平台', 'warning');
      renderResourceSpaceList();
      return;
    }

    const normalizeResourceItems = (result) => (Array.isArray(result) ? result : []).map((it, idx) => {
      const rpId = String(it?.rpId || it?.id || `${idx}-${it?.rpName || ''}`).trim();
      return {
        id: rpId || String(idx),
        name: String(it?.rpName || it?.name || '未命名文件').trim(),
        extName: String(it?.extName || it?.rpPrix || '').trim(),
        url: normalizeResourceUrl(it?.resUrl || it?.downloadUrl || ''),
        inputTime: String(it?.inputTime || it?.createTime || '').trim(),
        sizeMb: formatResourceSizeMb(it?.rpSize),
        sizeMbRaw: Number(it?.rpSize)
      };
    }).filter((it) => !!it.url);

    let normalized = normalizeResourceItems(payload.result);

    if (payload.total > firstRows) {
      window.resourceSpaceItems = normalized;
      window.resourceSpaceSelected = new Set();
      window.resourceDownloadTasks = {};
      resetResourceDownloadBatch();
      setResourceSpaceCount(normalized.length, 'loaded');
      setResourceSpaceStatus(`已加载 ${normalized.length} 个资源文件，正在继续加载...`);
      renderResourceSpaceList();

      payload = await fetchResourceSpaceListRaw(payload.total);
      if (isStale()) return;
      normalized = normalizeResourceItems(payload.result);
    }

    window.resourceSpaceItems = normalized;
    window.resourceSpaceSelected = new Set();
    window.resourceDownloadTasks = {};
    resetResourceDownloadBatch();
    setResourceSpaceCount(normalized.length);
    setResourceSpaceStatus('');
    renderResourceSpaceList();
  } catch (err) {
    if (isStale()) return;
    window.resourceSpaceItems = [];
    window.resourceSpaceSelected = new Set();
    window.resourceDownloadTasks = {};
    resetResourceDownloadBatch();
    setResourceSpaceCount(0);
    setResourceSpaceStatus(`资源空间加载失败: ${String(err?.message || err)}`, 'error');
    renderResourceSpaceList();
  }
}

async function fetchVeTeacherIdByCourse(courseNum, fzId) {
  const courseIdPart = String(courseNum || '').trim();
  const xkhIdPart = String(fzId || '').trim();
  if (!courseIdPart || !xkhIdPart) return '';
  const url = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10434&courseId=${encodeURIComponent(courseIdPart)}&dataSource=1&xkhId=${encodeURIComponent(xkhIdPart)}&xqCode=${encodeURIComponent(XQ_CODE)}`;
  const { text, res } = await fetchText(url, { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
  if (isLikelyLoginPageHtml(text, res?.url)) return '';
  const m = String(text || '').match(/<input[^>]*id=["']teacherId["'][^>]*value=["']([^"']+)["']/i)
    || String(text || '').match(/<input[^>]*value=["']([^"']+)["'][^>]*id=["']teacherId["']/i);
  return String(m?.[1] || '').trim();
}

function updateVeTeacherMetaUi(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const meta = window.veTeacherMetaByCourseId?.[cid] || {};
  const teacherId = String(meta.teacherId || '').trim();
  const idText = teacherId || (meta.loading ? '加载中...' : '未获取');
  document.querySelectorAll('.ve-teacher-id').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (String(el.dataset.courseId || '').trim() !== cid) return;
    el.textContent = idText;
  });
  document.querySelectorAll('.ve-switch-teacher-btn').forEach((btn) => {
    if (!(btn instanceof HTMLButtonElement)) return;
    if (String(btn.dataset.courseId || '').trim() !== cid) return;
    btn.disabled = !teacherId;
    btn.style.opacity = teacherId ? '1' : '0.6';
    btn.dataset.teacherId = teacherId;
  });
}

async function hydrateVeTeacherMeta(courseId, courseNum, fzId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const existing = window.veTeacherMetaByCourseId[cid] || {};
  if (existing.loading) return;
  if (existing.loaded && existing.teacherId) {
    updateVeTeacherMetaUi(cid);
    return;
  }
  window.veTeacherMetaByCourseId[cid] = { ...existing, loading: true };
  updateVeTeacherMetaUi(cid);
  try {
    const teacherId = await fetchVeTeacherIdByCourse(courseNum, fzId);
    window.veTeacherMetaByCourseId[cid] = { teacherId, loading: false, loaded: true };
  } catch {
    window.veTeacherMetaByCourseId[cid] = { teacherId: '', loading: false, loaded: true };
  }
  updateVeTeacherMetaUi(cid);
}

function formatVeClassNumber(n) {
  const num = Math.max(1, Math.min(99, Number(n) || 1));
  return String(num).padStart(2, '0');
}

function buildVeXkhPrefix(courseNum, fzId) {
  const raw = String(fzId || '').trim();
  if (raw.length > 2) return raw.slice(0, -2);
  const seq = String(courseNum || '').trim();
  return `2025-2026-2-2${seq}`;
}

async function fetchVeCourseTeachersByCourseNum(courseNum, fzId, onUpdate = null) {
  const courseIdPart = String(courseNum || '').trim();
  if (!courseIdPart) return [];

  const prefix = buildVeXkhPrefix(courseIdPart, fzId);
  let classNo = 1;
  const rows = [];
  const seen = new Set();

  while (classNo <= 99) {
    const xkhId = `${prefix}${formatVeClassNumber(classNo)}`;
    const url = `${BASE_VE}back/course/courseInfo.shtml?method=queryRecordResourceForCourseList&courseId=${encodeURIComponent(courseIdPart)}&xkhId=${encodeURIComponent(xkhId)}`;
    let text = '';
    let res = null;
    try {
      ({ text, res } = await fetchText(url, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }));
    } catch {
      break;
    }
    if (isLikelyLoginPageHtml(text, res?.url)) break;

    let data = null;
    try {
      data = JSON.parse(String(text || '{}'));
    } catch {
      break;
    }
    if (String(data?.STATUS) !== '0') break;

    const item = Array.isArray(data?.result) && data.result.length ? data.result[0] : null;
    if (item) {
      const teacherName = String(item?.teacherName || '').trim();
      const teacherId = String(item?.teacherId || '').trim();
      const roomName = String(item?.roomName || '').trim();
      const key = `${teacherId}__${teacherName}__${roomName}`;
      if ((teacherName || teacherId || roomName) && !seen.has(key)) {
        seen.add(key);
        rows.push({ teacherName, teacherId, roomName, xkhId });
        if (typeof onUpdate === 'function') {
          onUpdate([...rows], { done: false, error: false });
        }
      }
    }
    classNo += 1;
  }
  if (typeof onUpdate === 'function') {
    onUpdate([...rows], { done: true, error: false });
  }
  return rows;
}

function renderVeCourseTeachersPopHtml(meta) {
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const tableHtml = rows.length
    ? (() => {
      const body = rows.map((it) => {
        const teacherName = escapeHtml(String(it?.teacherName || '')) || '-';
        const teacherId = escapeHtml(String(it?.teacherId || '')) || '-';
        const roomName = escapeHtml(String(it?.roomName || '')) || '-';
        const teacherIdRaw = String(it?.teacherId || '').trim();
        const action = teacherIdRaw
          ? `<button type="button" class="ve-switch-teacher-btn" data-action="switch-teacher-account" data-teacher-id="${escapeHtml(teacherIdRaw)}">切换至教师账号</button>`
          : '<button type="button" class="ve-switch-teacher-btn" disabled style="opacity:.6;">切换至教师账号</button>';
        return `<tr><td>${teacherName}</td><td>${teacherId}</td><td>${roomName}</td><td>${action}</td></tr>`;
      }).join('');

      return `
        <table class="ve-course-teacher-table">
          <thead><tr><th>教师姓名</th><th>工号</th><th>教室</th><th>操作</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      `;
    })()
    : '';

  if (meta.loading) {
    if (tableHtml) {
      return `${tableHtml}<div class="ve-course-teacher-loading"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span><span>正在获取更多同课教师...</span></div>`;
    }
    return '<div class="ve-course-teacher-loading"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span><span>正在获取同课教师...</span></div>';
  }

  if (meta.error) {
    if (tableHtml) {
      return `${tableHtml}<div class="ve-course-teacher-loading warning">获取同课教师失败，已显示部分结果</div>`;
    }
    return '<div class="ve-course-teacher-loading warning">获取同课教师失败，请稍后重试</div>';
  }

  if (!tableHtml) {
    return '<div style="font-size:12px; color:#64748b;">未查询到同课其他教师</div>';
  }
  return tableHtml;
}

function updateVeCourseTeachersPopUi(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const meta = window.veCourseTeachersMetaByCourseId?.[cid] || { rows: [], loading: false, loaded: false, error: false };
  document.querySelectorAll('.ve-course-teacher-pop').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (String(el.dataset.courseId || '').trim() !== cid) return;
    el.innerHTML = renderVeCourseTeachersPopHtml(meta);
  });
}

async function hydrateVeCourseTeachersMeta(courseId, courseNum, fzId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const existing = window.veCourseTeachersMetaByCourseId?.[cid] || {};
  if (existing.loading) {
    updateVeCourseTeachersPopUi(cid);
    return existing.promise || Promise.resolve();
  }
  if (existing.loaded) {
    updateVeCourseTeachersPopUi(cid);
    return Promise.resolve();
  }

  const loadingMeta = { ...existing, rows: Array.isArray(existing.rows) ? existing.rows : [], loading: true, loaded: false, error: false, promise: null };
  window.veCourseTeachersMetaByCourseId[cid] = loadingMeta;
  updateVeCourseTeachersPopUi(cid);

  const p = fetchVeCourseTeachersByCourseNum(courseNum, fzId, (rows, state) => {
    const latest = window.veCourseTeachersMetaByCourseId?.[cid] || {};
    window.veCourseTeachersMetaByCourseId[cid] = {
      ...latest,
      rows: Array.isArray(rows) ? rows : [],
      loading: state?.done !== true,
      loaded: state?.done === true,
      error: !!state?.error,
      promise: latest.promise || null
    };
    updateVeCourseTeachersPopUi(cid);
  })
    .then((rows) => {
      window.veCourseTeachersMetaByCourseId[cid] = { rows: Array.isArray(rows) ? rows : [], loading: false, loaded: true, error: false, promise: null };
      updateVeCourseTeachersPopUi(cid);
    })
    .catch(() => {
      window.veCourseTeachersMetaByCourseId[cid] = { rows: [], loading: false, loaded: true, error: true, promise: null };
      updateVeCourseTeachersPopUi(cid);
    });

  window.veCourseTeachersMetaByCourseId[cid] = { ...loadingMeta, promise: p };
  return p;
}

async function switchToTeacherAccount(teacherId) {
  const tid = String(teacherId || '').trim();
  if (!tid) {
    showToast('老师工号为空，无法切换', 'warning', 1600);
    return;
  }
  if (usernameInput.value.trim() === tid) {
    showToast('当前已是该教师账号', 'info', 1200);
    return;
  }
  usernameInput.value = tid;
  usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function isNativeHomeworkDone(hw) {
  const subStatus = String(hw?.subStatus ?? hw?.sub_status ?? '').trim();
  const subTime = String(hw?.subTime ?? hw?.sub_time ?? '').trim();
  return (subStatus && subStatus !== '未提交') || !!subTime;
}

function isNativeHomeworkPending(hw) {
  const deadline = hw?.end_time ?? hw?.endTime ?? '';
  return !isNativeHomeworkDone(hw) && !isDeadlinePassed(deadline);
}

function isYktHomeworkDone(hw) {
  const progress = Number(hw?.progress ?? 0);
  const problemCount = Number(hw?.problem_count ?? hw?.problemCount ?? 0);
  if (problemCount > 0) return progress >= problemCount;
  if (hw && hw.done !== null && hw.done !== undefined) return !!hw.done;
  if (hw && hw.unfinished !== null && hw.unfinished !== undefined) {
    return Number(hw.unfinished) === 0;
  }
  return false;
}

function isYktHomeworkPending(hw) {
  return !isYktHomeworkDone(hw) && !isDeadlinePassed(hw?.end);
}

function ensureCourseCardState(courseId) {
  if (!window.courseCardStateById[courseId]) {
    window.courseCardStateById[courseId] = {
      allHomeworkCount: 0,
      pendingHomeworkCount: 0,
      pendingEarliestTs: 0,
      hasReplay: false,
      replayListLoading: false,
      hasCourseware: false,
      coursewareListLoading: false
    };
  }
  return window.courseCardStateById[courseId];
}

function calcCourseRank(state) {
  if ((state?.pendingHomeworkCount || 0) > 0) return 0;
  if ((state?.allHomeworkCount || 0) > 0) return 1;

  // For no-homework courses: treat loading as "has" for grouping.
  const replayLike = !!state?.hasReplay || !!state?.replayListLoading;
  const coursewareLike = !!state?.hasCourseware || !!state?.coursewareListLoading;

  if (replayLike && coursewareLike) return 2; // 有回放且有课件
  if (replayLike && !coursewareLike) return 3; // 有回放无课件
  if (!replayLike && coursewareLike) return 4; // 有课件无回放
  return 5; // 无回放无课件
}

function sortCourseCards() {
  const cards = Array.from(courseListDiv.querySelectorAll('.file-item[data-course-rankable="1"]'));
  cards.sort((a, b) => {
    const ra = Number(a.dataset.rank || 3);
    const rb = Number(b.dataset.rank || 3);
    if (ra !== rb) return ra - rb;

    if (ra === 0 && rb === 0) {
      const ida = String(a.id || '').startsWith('course-') ? String(a.id).slice(7) : '';
      const idb = String(b.id || '').startsWith('course-') ? String(b.id).slice(7) : '';
      const tsa = Number(window.courseCardStateById?.[ida]?.pendingEarliestTs || 0);
      const tsb = Number(window.courseCardStateById?.[idb]?.pendingEarliestTs || 0);
      const va = tsa > 0 ? tsa : Number.MAX_SAFE_INTEGER;
      const vb = tsb > 0 ? tsb : Number.MAX_SAFE_INTEGER;
      if (va !== vb) return va - vb;
    }

    const oa = Number(a.dataset.order || 0);
    const ob = Number(b.dataset.order || 0);
    return oa - ob;
  });
  cards.forEach((c) => courseListDiv.appendChild(c));
}

function updateCourseCardRank(courseId) {
  const card = document.getElementById(`course-${courseId}`);
  if (!card) return;
  const state = ensureCourseCardState(courseId);
  card.dataset.rank = String(calcCourseRank(state));
  sortCourseCards();
}

function suffixAfterDash(v) {
  const s = String(v || '').trim();
  const idx = s.indexOf('-');
  return (idx >= 0 ? s.slice(idx + 1) : s).trim();
}

function formatYktDateTime(ts) {
  const n = parseDeadlineToTs(ts);
  if (!n) return '无';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '无';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getYktActivityDeadline(a) {
  return a?.end
    ?? a?.deadline
    ?? a?.end_time
    ?? a?.endTime
    ?? a?.exam_end_time
    ?? a?.examEndTime
    ?? a?.exam?.end
    ?? a?.exam?.end_time
    ?? '';
}

function yktCourseLink(classroomId) {
  return `${YKT_BASE}/v2/web/studentLog/${encodeURIComponent(String(classroomId || ''))}`;
}

function yktHomeworkLink(classroomId, coursewareId, id) {
  return `${YKT_BASE}/v2/web/studentCards/${encodeURIComponent(String(classroomId || ''))}/${encodeURIComponent(String(coursewareId || ''))}/${encodeURIComponent(String(id || ''))}`;
}

function yktExamLink(courseId, coursewareId) {
  return `${YKT_BASE}/v2/web/exam/${encodeURIComponent(String(courseId || ''))}/${encodeURIComponent(String(coursewareId || ''))}`;
}

function removeYktLoginSection() {
  const old = document.getElementById('ykt-extra-wrapper');
  if (old) old.remove();
}

function clearYktStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.ykt-standalone-card');
  cards.forEach((n) => n.remove());
  updateCourseListEmptyPlaceholder();
}

function ensureMrzyLoginTip() {
  return null;
}

function removeMrzyLoginTip() {
  // no-op: use toast messages instead of fixed top tip.
}

function showPlatformNeedLoginToast(platform) {
  const p = String(platform || '').trim();
  if (!['ve', 'ykt', 'mrzy', 'jlgj'].includes(p)) return;
  if (!window.__platformOfflineToastById) window.__platformOfflineToastById = {};
  const now = Date.now();
  const lastAt = Number(window.__platformOfflineToastById[p] || 0);
  if (now - lastAt < 6000) return;
  window.__platformOfflineToastById[p] = now;

  if (p === 've') {
    showToast(VE_LOGIN_REQUIRED_HTML, 'warning', 3200, true);
    return;
  }

  if (p === 'ykt') {
    showToast('如需查看<a href="https://www.yuketang.cn/web" target="_blank" rel="noopener noreferrer" style="color:#0f766e; text-decoration:none; font-weight:600;">雨课堂</a>作业，请前往登录', 'warning', 3200, true);
    return;
  }
  if (p === 'mrzy') {
    showToast('如需查看<a href="https://zuoye.lulufind.com/" target="_blank" rel="noopener noreferrer" style="color:#0f766e; text-decoration:none; font-weight:600;">每日交作业</a>作业，请前往登录', 'warning', 3200, true);
    return;
  }
  showToast('如需查看<a href="https://i.jielong.com/my-class" target="_blank" rel="noopener noreferrer" style="color:#0f766e; text-decoration:none; font-weight:600;">接龙管家</a>作业，请前往登录', 'warning', 3200, true);
}

function setPlatformLoginState(platform, state) {
  const p = ['ve', 'ykt', 'mrzy', 'jlgj'].includes(String(platform || '').trim())
    ? String(platform || '').trim()
    : 've';
  const prev = String(window.platformLoginState?.[p] || '').trim();
  const s = (state === 'online' || state === 'offline') ? state : 'checking';
  window.platformLoginState[p] = s;
  if (s === 'online' || s === 'offline') {
    window.platformLoginChecked[p] = true;
  }
  window.platformNeedLogin[p] = isPlatformEnabled(p) && s === 'offline';
  if (s === 'offline' && prev !== 'offline') {
    showPlatformNeedLoginToast(p);
  }
  refreshPlatformLoginTip();
}

function refreshPlatformLoginTip() {
  removeMrzyLoginTip();

  const apply = (btn, state, label) => {
    if (!btn) return;
    btn.classList.remove('checking', 'offline', 'online', 'unselected-checked-online', 'unselected-checked-offline', 'unselected-checked-checking');
    const id = String(btn.id || '');
    const platform = id.includes('ve-status-btn')
      ? 've'
      : (id.includes('mrzy-status-btn') ? 'mrzy' : (id.includes('jlgj-status-btn') ? 'jlgj' : 'ykt'));
    const enabled = isPlatformEnabled(platform);
    const treatAsUnselected = !enabled || state === 'offline';
    if (!treatAsUnselected) {
      btn.classList.add(state);
    } else if (window.platformLoginChecked?.[platform]) {
      const key = state === 'online' ? 'online' : (state === 'offline' ? 'offline' : 'checking');
      btn.classList.add(`unselected-checked-${key}`);
    }
    btn.classList.toggle('unselected', treatAsUnselected);
    const stateText = treatAsUnselected
      ? '未启用'
      : (state === 'online' ? '已登录' : (state === 'offline' ? '未登录' : '登录检查中'));
    btn.title = `${label}${stateText}`;
  };

  apply(veStatusBtn, window.platformLoginState?.ve || 'checking', '智慧课程平台');
  apply(yktStatusBtn, window.platformLoginState?.ykt || 'checking', '雨课堂');
  apply(mrzyStatusBtn, window.platformLoginState?.mrzy || 'checking', '每日交作业');
  apply(jlgjStatusBtn, window.platformLoginState?.jlgj || 'checking', '接龙管家');

  // Login warnings are shown on offline-transition only (one platform at a time).
}

function clearMrzyStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.mrzy-standalone-card');
  cards.forEach((n) => n.remove());
  updateCourseListEmptyPlaceholder();
}

function clearJlgjStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.jlgj-standalone-card');
  cards.forEach((n) => n.remove());
  updateCourseListEmptyPlaceholder();
}

function shouldShowNoCoursePlaceholder() {
  if (!courseListDiv) return false;
  if (courseListDiv.querySelector('.file-item')) return false;

  const selected = ['ve', 'ykt', 'mrzy', 'jlgj'].filter((p) => isPlatformEnabled(p));
  if (!selected.length) return true;

  const allOffline = selected.every((p) => (window.platformLoginState?.[p] || 'checking') === 'offline');
  if (allOffline) return true;

  const allSettled = selected.every((p) => {
    const state = window.platformLoginState?.[p] || 'checking';
    if (state === 'offline') return true;
    return !!window.platformLoadedOnce?.[p];
  });
  return allSettled;
}

function updateCourseListEmptyPlaceholder() {
  if (!courseListDiv) return;
  const existing = courseListDiv.querySelector('#course-list-empty-placeholder');
  const shouldShow = shouldShowNoCoursePlaceholder();
  if (shouldShow) {
    if (existing) return;
    const empty = document.createElement('div');
    empty.id = 'course-list-empty-placeholder';
    empty.style.color = '#666';
    empty.style.padding = '6px 0';
    empty.textContent = '暂无课程';
    courseListDiv.appendChild(empty);
    return;
  }
  if (existing) existing.remove();
}

function ensureYktSection() {
  return null;
}

function renderYktNeedLoginMessage() {
  removeYktLoginSection();
  window.platformEnabled.ykt = false;
  window.platformLoadedOnce.ykt = false;
  savePlatformEnabledToStorage().catch(() => {});
  clearPlatformData('ykt');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('ykt', 'offline');
}

function renderMrzyNeedLoginMessage() {
  window.platformEnabled.mrzy = false;
  window.platformLoadedOnce.mrzy = false;
  savePlatformEnabledToStorage().catch(() => {});
  clearPlatformData('mrzy');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('mrzy', 'offline');
}

function renderJlgjNeedLoginMessage() {
  window.platformEnabled.jlgj = false;
  window.platformLoadedOnce.jlgj = false;
  savePlatformEnabledToStorage().catch(() => {});
  clearPlatformData('jlgj');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('jlgj', 'offline');
}

async function getJlgjAuthHeaders() {
  const cachedAuth = String(window.jlgjRequestHeaders?.authorization || '').trim();
  const cachedPayload = String(window.jlgjRequestHeaders?.xApiRequestPayload || '').trim();
  const cachedMode = String(window.jlgjRequestHeaders?.xApiRequestMode || '').trim() || 'cors';
  const cachedTs = Number(window.jlgjRequestHeaders?.ts || 0);
  if (cachedAuth && cachedPayload) {
    return { authorization: cachedAuth, xApiRequestPayload: cachedPayload, xApiRequestMode: cachedMode, ts: cachedTs };
  }

  try {
    const data = await chrome.storage.local.get(['jlgjRequestHeaders']);
    const fromStorage = data?.jlgjRequestHeaders || {};
    const authorization = String(fromStorage?.authorization || '').trim();
    const xApiRequestPayload = String(fromStorage?.xApiRequestPayload || '').trim();
    const xApiRequestMode = String(fromStorage?.xApiRequestMode || '').trim() || 'cors';
    const ts = Number(fromStorage?.ts || 0);
    if (authorization && xApiRequestPayload) {
      window.jlgjRequestHeaders = { authorization, xApiRequestPayload, xApiRequestMode, ts };
      return { authorization, xApiRequestPayload, xApiRequestMode, ts };
    }
  } catch {
    // ignore
  }

  return { authorization: '', xApiRequestPayload: '', xApiRequestMode: 'cors', ts: 0 };
}

function extractJlgjData(payload) {
  if (payload && payload.Data !== undefined) return payload.Data;
  if (payload && payload.data !== undefined) return payload.data;
  return null;
}

function isJlgjUnauthorizedPayload(payload) {
  const type = String(payload?.Type ?? payload?.type ?? '').trim();
  const dataText = String(payload?.Data ?? payload?.data ?? '').trim();
  return type === '100000' || /请先授权登录小程序/i.test(dataText);
}

async function fetchJlgjJson(url) {
  const headers = { Accept: 'application/json, text/plain, */*' };
  const auth = await getJlgjAuthHeaders();
  if (auth.authorization) headers.authorization = auth.authorization;
  if (auth.xApiRequestPayload) headers['x-api-request-payload'] = auth.xApiRequestPayload;
  if (auth.xApiRequestMode) headers['x-api-request-mode'] = auth.xApiRequestMode;

  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers
  });
  const text = await res.text();
  try {
    const data = JSON.parse(String(text || '{}'));
    const unauthorized = Number(res.status || 0) === 401 || Number(res.status || 0) === 403 || isJlgjUnauthorizedPayload(data);
    return { ok: res.ok, status: Number(res.status || 0), data, unauthorized };
  } catch {
    return { ok: false, status: Number(res.status || 0), data: null, raw: text, unauthorized: Number(res.status || 0) === 401 || Number(res.status || 0) === 403 };
  }
}

async function openJlgjBackgroundTab() {
  const tab = await chrome.tabs.create({ url: 'https://i.jielong.com/my-class', active: false });
  return tab;
}

async function waitForJlgjAuthHeaders(timeoutMs = 5000, minTs = 0) {
  const start = Date.now();
  let last = await getJlgjAuthHeaders();
  if (last.authorization && last.xApiRequestPayload && last.ts >= minTs) return last;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 280));
    last = await getJlgjAuthHeaders();
    if (last.authorization && last.xApiRequestPayload && last.ts >= minTs) return last;
  }
  return last;
}

async function waitJlgjTabComplete(tabId, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.status === 'complete') return true;
    } catch {
      return false;
    }
    await new Promise((r) => setTimeout(r, 180));
  }
  return false;
}

async function fetchJlgjJsonFromPageContext(url, existingTabId = null) {
  const auth = await getJlgjAuthHeaders();

  let tab = null;
  const hasExistingTab = Number.isFinite(Number(existingTabId)) && Number(existingTabId) > 0;
  try {
    if (hasExistingTab) {
      tab = { id: Number(existingTabId) };
    } else {
      tab = await openJlgjBackgroundTab();
      if (!tab?.id) return { ok: false, status: 0, data: null, unauthorized: true, message: '无法打开接龙页面' };
      await waitJlgjTabComplete(tab.id, 12000);
    }

    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (reqUrl, reqHeaders) => {
        try {
          const res = await fetch(reqUrl, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: reqHeaders
          });
          const text = await res.text();
          let data = null;
          try { data = JSON.parse(String(text || '{}')); } catch { data = null; }
          return { ok: res.ok, status: Number(res.status || 0), text, data };
        } catch (e) {
          return { ok: false, status: 0, text: String(e?.message || e), data: null };
        }
      },
      args: [
        url,
        {
          Accept: 'application/json, text/plain, */*',
          ...(auth.authorization ? { authorization: auth.authorization } : {}),
          ...(auth.xApiRequestPayload ? { 'x-api-request-payload': auth.xApiRequestPayload } : {}),
          ...(auth.xApiRequestMode ? { 'x-api-request-mode': auth.xApiRequestMode } : {})
        }
      ]
    });

    const result = injected?.[0]?.result || { ok: false, status: 0, data: null };
    const unauthorized = Number(result.status || 0) === 401
      || Number(result.status || 0) === 403
      || isJlgjUnauthorizedPayload(result.data || {});
    return { ...result, unauthorized };
  } catch {
    return { ok: false, status: 0, data: null, unauthorized: true };
  } finally {
    if (!hasExistingTab && tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
    }
  }
}

async function waitAndFetchJlgjGroupListFromBrowser(timeoutMs = 30000) {
  const start = Date.now();
  let ownedTabId = null;
  let reloadedOwnedTab = false;

  const pickReadyTab = async () => {
    const tabs = await chrome.tabs.query({ url: ['https://i.jielong.com/*'] });
    const existing = (tabs || []).find((t) => Number.isFinite(Number(t?.id)) && t.status === 'complete');
    if (existing?.id) return existing;

    if (!ownedTabId) {
      const created = await openJlgjBackgroundTab();
      ownedTabId = Number(created?.id || 0) || null;
    }
    if (!ownedTabId) return null;

    try {
      const ready = await chrome.tabs.get(ownedTabId);
      return ready?.id ? ready : null;
    } catch {
      return null;
    }
  };

  try {
    while (Date.now() - start < timeoutMs) {
      try {
        const tab = await pickReadyTab();
        if (!tab?.id) {
          await new Promise((r) => setTimeout(r, 450));
          continue;
        }

        const tabUrl = String(tab?.url || '');
        if (/https:\/\/i\.jielong\.com\/login/i.test(tabUrl)) {
          if (ownedTabId && Number(tab.id) === Number(ownedTabId)) {
            try { await chrome.tabs.remove(ownedTabId); } catch { /* ignore */ }
            ownedTabId = null;
          }
          return { ok: false, status: 401, data: null, unauthorized: true, loginRedirect: true };
        }

        const stateRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            const data = globalThis.__bjtuJlgjData;
            return {
              hasData: !!data,
              isComplete: data ? data.complete : false,
              groupPagesOk: data && data.userGroupPages ? data.userGroupPages.ok : false,
              groupPagesStatus: data && data.userGroupPages ? data.userGroupPages.status : 0,
              dataSnap: data
            };
          }
        });

        const state = stateRes?.[0]?.result || {};

        if (ownedTabId && Number(tab.id) === Number(ownedTabId) && !reloadedOwnedTab && !state.hasData) {
          try {
            await chrome.tabs.reload(tab.id, { bypassCache: true });
            reloadedOwnedTab = true;
            await new Promise(r => setTimeout(r, 2000));
          } catch { }       
        }

        if (state.hasData && state.isComplete) {
          const snap = state.dataSnap;
          if (ownedTabId) {
            try { await chrome.tabs.remove(ownedTabId); } catch { /* ignore */ }
            ownedTabId = null;
          }
          return {
            ok: snap.userGroupPages.ok,
            status: snap.userGroupPages.status,
            unauthorized: snap.userGroupPages.status == 401,
            data: snap,
            __fullCapture: snap || {}
          };
        }
      } catch (e) {
         // ignore
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    if (ownedTabId) chrome.tabs.remove(ownedTabId).catch(()=>{}); return { ok: false, status: 0, data: null, unauthorized: false, timeout: true };
  } catch {
    return { ok: false, status: 0, data: null, unauthorized: true };
  }
}


async function fetchYktJson(url) {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: YKT_HEADERS,
    cache: 'no-store'
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { errcode: -1, errmsg: text || `HTTP ${res.status}` };
  }
}

async function fetchYktExamPaper(courseId, examId, sharedTabId = null) {
  const cid = String(courseId || '').trim();
  const eid = String(examId || '').trim();
  if (!eid) return null;

  const LOCK_MSG_RE = /同一时间只允许打开一份试卷|如需打开新的试卷，请在封面处跳转/;
  const MAX_ATTEMPTS = 4;

  const visitTransAndWaitRedirect = async () => {
    if (!cid) return false;
    const transUrl = `${YKT_BASE}/v2/web/trans/${encodeURIComponent(cid)}/${encodeURIComponent(eid)}`;
    const usingSharedTab = Number.isFinite(Number(sharedTabId)) && Number(sharedTabId) > 0;
    let tabId = usingSharedTab ? Number(sharedTabId) : null;
    try {
      if (usingSharedTab) {
        await chrome.tabs.update(tabId, { url: transUrl });
      } else {
        const tab = await chrome.tabs.create({ url: transUrl, active: false });
        tabId = tab?.id ?? null;
      }
      if (!tabId) return false;

      const start = Date.now();
      const timeoutMs = 8000;
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 180));
        const t = await chrome.tabs.get(tabId);
        const url = String(t?.url || '');
        if (url.includes('examination.xuetangx.com/')) {
          return true;
        }
        if (t?.status === 'complete' && url.includes('/v2/web/trans/')) {
          return false;
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      if (!usingSharedTab && tabId) {
        try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
      }
    }
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Always run in-order: trans page navigation -> show_paper.
    await visitTransAndWaitRedirect();

    try {
      const res = await fetch(`${YKT_EXAM_BASE}/exam_room/show_paper?exam_id=${encodeURIComponent(eid)}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' },
        cache: 'no-store'
      });
      if (Number(res.status) === 401 || Number(res.status) === 403) return null;

      const text = await res.text();
      const data = JSON.parse(String(text || '{}'));
      if (Number(data?.errcode) === 0) return data?.data || null;

      const errText = `${String(data?.errmsg || '')} ${String(data?.message || '')}`;
      if (!LOCK_MSG_RE.test(errText) || attempt >= MAX_ATTEMPTS) {
        return null;
      }
    } catch {
      if (attempt >= MAX_ATTEMPTS) return null;
    }

    await new Promise((r) => setTimeout(r, 240));
  }

  return null;
}

function renderYktExamProblemsHtml(problemList, done) {
  const list = Array.isArray(problemList) ? problemList : [];
  if (!list.length) return '';
  const baseBg = done ? 'rgba(220,252,231,0.52)' : 'rgba(255,237,213,0.52)';
  const borderColor = done ? 'rgba(22,163,74,0.32)' : 'rgba(234,88,12,0.32)';
  const typeColor = done ? '#166534' : '#9a3412';
  const textColor = done ? '#14532d' : '#7c2d12';
  return list.map((p, i) => {
    const typeText = String(p?.TypeText || p?.Type || '题目类型').trim();
    const bodyHtml = normalizeHomeworkContent(String(p?.Body || '').trim()) || '<span style="color:#999;">无题目内容</span>';
    return `
      <div style="padding:4px 6px; border:1px solid ${borderColor}; border-radius:5px; margin-top:4px; background:${baseBg};">
        <div style="font-size:12px; color:${typeColor}; font-weight:bold; line-height:1.35;">${i + 1}. ${escapeHtml(typeText)}</div>
        <div style="font-size:12px; color:${textColor}; margin-top:2px; line-height:1.4;">${bodyHtml}</div>
      </div>
    `;
  }).join('');
}

async function fetchYktCardDetList(cardId, classroomId) {
  const cid = String(cardId || '').trim();
  const classId = String(classroomId || '').trim();
  if (!cid || !classId) return null;
  const url = `${YKT_BASE}/v2/api/web/cards/detlist/${encodeURIComponent(cid)}?classroom_id=${encodeURIComponent(classId)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...YKT_HEADERS
      },
      cache: 'no-store'
    });
    if (Number(res.status) === 401 || Number(res.status) === 403) return null;
    const text = await res.text();
    const data = JSON.parse(String(text || '{}'));
    if (Number(data?.errcode) !== 0) return null;
    return Array.isArray(data?.data?.problem_results) ? data.data.problem_results : [];
  } catch {
    return null;
  }
}

function extractYktProblemDetailHtml(problemItem) {
  const lines = [];
  const shapes = Array.isArray(problemItem?.slide?.Shapes) ? problemItem.slide.Shapes : [];
  shapes.forEach((shape) => {
    const paragraphs = Array.isArray(shape?.Paragraphs) ? shape.Paragraphs : [];
    paragraphs.forEach((p) => {
      const ls = Array.isArray(p?.Lines) ? p.Lines : [];
      ls.forEach((l) => {
        const html = String(l?.Html || '').trim();
        if (html) lines.push(html);
      });
    });
  });
  return lines.join('');
}

function renderYktCardProblemResultsHtml(problemResults, done) {
  const list = Array.isArray(problemResults) ? problemResults : [];
  if (!list.length) return '';
  const baseBg = done ? 'rgba(220,252,231,0.52)' : 'rgba(255,237,213,0.52)';
  const borderColor = done ? 'rgba(22,163,74,0.32)' : 'rgba(234,88,12,0.32)';
  const titleColor = done ? '#166534' : '#9a3412';
  const textColor = done ? '#14532d' : '#7c2d12';

  return list.map((it, idx) => {
    const detailRawHtml = extractYktProblemDetailHtml(it);
    const detailHtml = normalizeHomeworkContent(detailRawHtml) || '<span style="color:#999;">无作业详情</span>';
    return `
      <div style="padding:4px 6px; border:1px solid ${borderColor}; border-radius:5px; margin-top:4px; background:${baseBg};">
        <div style="font-size:12px; color:${titleColor}; font-weight:bold; line-height:1.35;">第${idx + 1}题</div>
        <div style="font-size:12px; color:${textColor}; margin-top:2px; line-height:1.4;">${detailHtml}</div>
      </div>
    `;
  }).join('');
}

function renderYktHomeworkItems(courseId, items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it, idx) => {
    const done = isYktHomeworkDone(it);
    const progress = Number(it?.progress ?? 0);
    const problemCount = Number(it?.problem_count ?? 0);
    const progressText = problemCount > 0 ? `${progress}/${problemCount}` : '';
    const hasScore = it?.score !== null && it?.score !== undefined && String(it.score) !== '';
    const totalScoreFromItem = Number(it?.total_score);
    const problemResults = Array.isArray(it?.problem_results) ? it.problem_results : [];
    const sumGot = problemResults.reduce((acc, pr) => {
      const v = Number(pr?.problem_result?.score);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
    const sumFull = problemResults.reduce((acc, pr) => {
      const v = Number(pr?.score);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
    const derivedHasScore = Number(it?.__actype) === 15 && problemResults.length > 0 && (sumFull > 0 || sumGot > 0);
    const scoreText = hasScore
      ? `${it.score}/${it?.total_score ?? ''}`
      : (derivedHasScore
          ? `${sumGot}/${sumFull > 0 ? sumFull : (Number.isFinite(totalScoreFromItem) ? totalScoreFromItem : '')}`
          : '');
    const bgColor = done ? '#e8f5e9' : '#fff3e0';
    const borderColor = done ? '#4caf50' : '#ff9800';
    const titleColor = done ? '#2e7d32' : '#e65100';
    const detailBtnColor = done ? '#2E7D32' : '#E65100';
    const actionText = done ? '去雨课堂查看' : '去雨课堂提交';
    const titleScoreBadge = scoreText ? `<span style="font-weight:bold; color:#E91E63; white-space:nowrap;">[${escapeHtml(scoreText)}]</span>` : '';
    const yktIdSeed = String(it?.id || it?.courseware_id || it?.classroom_id || idx).trim();
    const expandKey = `ykt:${yktIdSeed}`;
    const expanded = isHomeworkDetailExpanded(courseId, expandKey);
    const actype = Number(it?.__actype);
    const isExam = actype === 5;
    const isCard = actype === 15;
    const examDetail = isExam
      ? renderYktExamProblemsHtml(it?.exam_problems || [], done)
      : (isCard ? renderYktCardProblemResultsHtml(it?.problem_results || [], done) : '');
    let detailStatusHtml = '';
    if ((isExam || isCard) && !examDetail) {
      const state = String(it?.exam_detail_state || '').trim();
      if (state === 'loading') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;"></span>正在获取作业详情...</div>`;
      } else if (state === 'queued') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;"></span>正在排队等待...</div>`;
      } else if (state === 'failed') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:#b45309;">作业详情获取失败，可稍后重试</div>`;
      }
    }
    const detailExpandable = examDetail
      ? renderExpandableHtml(examDetail, {
          emptyHtml: '<span style="color:#999;">无题目内容</span>',
          expandText: '点击查看作业详情',
          collapseText: '点击收起作业详情',
          baseBg: done ? 'rgba(232,245,233,0.75)' : 'rgba(255,243,224,0.78)',
          flatDisplay: true,
          courseId,
          expandKey,
          expanded
        })
      : '';
    return `
    <div class="hw-card-item" data-homework-done="${done ? '1' : '0'}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
      <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
        <div>
          <div style="font-weight:bold; color:${titleColor};">${escapeHtml(it.title || '雨课堂作业')}</div>
          <div style="font-size:12px; color:#666;">截止: ${escapeHtml(formatYktDateTime(it.end))} ${done ? '(已提交)' : ''}</div>
          <div style="font-size:12px; color:#666;">${progressText ? `进度: ${escapeHtml(progressText)}` : ''}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${titleScoreBadge ? `<div style="font-size:12px; line-height:1;">${titleScoreBadge}</div>` : ''}
          <a class="btn" href="${it.link}" target="_blank" rel="noopener noreferrer" style="background:${detailBtnColor}; padding: 2px 6px; font-size: 12px; text-decoration:none; color:#fff;">${actionText}</a>
        </div>
      </div>
      ${detailExpandable ? `<div style="margin-top:6px; border-top:1px dashed ${borderColor}40; padding-top:6px;">${detailExpandable}</div>` : ''}
      ${detailStatusHtml}
    </div>
  `;
  }).join('');
}

function isJlgjHomeworkDone(hw) {
  return !!hw?.done;
}

function isJlgjHomeworkPending(hw) {
  return !isJlgjHomeworkDone(hw) && !isDeadlinePassed(hw?.end);
}

function renderJlgjHomeworkItems(items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it) => {
    const done = isJlgjHomeworkDone(it);
    const isLoadingMeta = !!it?.loadingMeta;
    const bgColor = done ? '#e8f5e9' : '#fff3e0';
    const borderColor = done ? '#4caf50' : '#ff9800';
    const titleColor = done ? '#2e7d32' : '#e65100';
    const detail = isLoadingMeta ? '' : normalizeHomeworkContent(String(it?.content || '').trim());
    const contentHtml = isLoadingMeta
      ? '正在加载详情…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : (detail || '<span style="color:#999;">无作业详情</span>');
    const link = String(it?.link || JLGJ_WEB_BASE);
    const actionText = done ? '去接龙管家查看' : '去接龙管家提交';
    const detailBtnColor = done ? '#2E7D32' : '#E65100';
    const endText = isLoadingMeta ? '正在加载……' : formatYktDateTime(it.end);
    const endSuffix = isLoadingMeta
      ? ' <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : '';
    return `
      <div class="hw-card-item" data-homework-done="${done ? '1' : '0'}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
          <div>
            <div style="font-weight:bold; color:${titleColor};">${escapeHtml(it.title || '接龙作业')}</div>
            <div style="font-size:12px; color:#666;">截止: ${escapeHtml(endText)}${endSuffix} ${done ? '(已提交)' : ''}</div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <a class="btn" href="${link}" target="_blank" rel="noopener noreferrer" style="background:${detailBtnColor}; padding: 2px 6px; font-size: 12px; text-decoration:none; color:#fff;">${actionText}</a>
          </div>
        </div>
        <div style="margin-top:6px; border-top:1px dashed ${borderColor}40; padding-top:6px; font-size:12px; color:#374151; line-height:1.45;">${contentHtml}</div>
      </div>
    `;
  }).join('');
}

function isMrzyHomeworkDone(hw) {
  return Number(hw?.submit || 0) > 0 || Number(hw?.isSubmit || 0) > 0 || !!hw?.done;
}

function isMrzyHomeworkPending(hw) {
  return !isMrzyHomeworkDone(hw) && !isDeadlinePassed(hw?.end);
}

function renderMrzyHomeworkItems(items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it) => {
    const done = isMrzyHomeworkDone(it);
    const bgColor = done ? '#e8f5e9' : '#fff3e0';
    const borderColor = done ? '#4caf50' : '#ff9800';
    const titleColor = done ? '#2e7d32' : '#e65100';
    const detailBtnColor = done ? '#2E7D32' : '#E65100';
    const actionText = done ? '去每日交作业查看' : '去每日交作业提交';
    const isLoadingMeta = !!it?.loadingMeta;
    const endText = isLoadingMeta ? '正在加载……' : String(it.end || '无');
    const endSuffix = isLoadingMeta
      ? ' <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : '';
    return `
      <div class="hw-card-item" data-homework-done="${done ? '1' : '0'}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
          <div>
            <div style="font-weight:bold; color:${titleColor};">${escapeHtml(it.title || '每日交作业')}</div>
            <div style="font-size:12px; color:#666;">截止: ${escapeHtml(endText)}${endSuffix} ${done ? '(已提交)' : ''}</div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <a class="btn" href="${it.link}" target="_blank" rel="noopener noreferrer" style="background:${detailBtnColor}; padding: 2px 6px; font-size: 12px; text-decoration:none; color:#fff;">${actionText}</a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderYktStandaloneCourses() {
  removeYktLoginSection();
  clearYktStandaloneCards();
  const courses = window.yktStandaloneCourses || [];
  if (!courses.length) {
    updateCourseListEmptyPlaceholder();
    return;
  }

  const baseOrder = Number(courseListDiv.dataset.orderBase || 100000);
  courses.forEach((c, idx) => {
    const courseId = `ykt-${String(c.classroom_id || idx)}`;
    const courseLink = yktCourseLink(c.classroom_id);
    const teacherName = String(c.teacher_name || '').trim();
    const subText = `${teacherName ? `${teacherName} · ` : ''}${String(c.name || '').trim()}`;
    const card = document.createElement('div');
    card.className = 'file-item ykt-standalone-card';
    card.style.backgroundColor = '#fff';
    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(baseOrder + idx);
    card.dataset.rank = '4';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${courseLink}" target="_blank" rel="noopener noreferrer" style="color:#0369a1; text-decoration:none; line-height:1.3;">${escapeHtml(c.course_name || c.name || '雨课堂课程')}</a></strong></div>
          <div style="font-size:12px; color:#666; line-height:1.35;">${escapeHtml(subText)}</div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#9C27B0; display:none;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
    `;
    courseListDiv.appendChild(card);

    if (!window.courseHomeworkData[courseId]) {
      window.courseHomeworkData[courseId] = { list: [], showAll: !!window.courseShowAllById[courseId] };
    }
    renderHomeworkList(courseId);

    window.courseHomeworkData[courseId] = { list: [], showAll: !!window.courseShowAllById[courseId] };
    window.yktMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
}

function renderMrzyStandaloneCourses() {
  clearMrzyStandaloneCards();
  const courses = window.mrzyStandaloneCourses || [];
  if (!courses.length) {
    updateCourseListEmptyPlaceholder();
    return;
  }

  const baseOrder = Number(courseListDiv.dataset.orderBase || 100000) + 50000;
  courses.forEach((c, idx) => {
    const courseId = `mrzy-${String(c.classNum || idx)}`;
    const loadingMeta = !!c.loadingMeta;
    const titleHtml = loadingMeta
      ? '正在加载…… <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:1px; border-color:#6366f1; border-top-color:transparent;"></span>'
      : escapeHtml(c.divClass || '每日交作业课程');
    const teacherHtml = loadingMeta
      ? '正在加载…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : escapeHtml(c.teacherName || '');
    const card = document.createElement('div');
    card.className = 'file-item mrzy-standalone-card';
    card.style.backgroundColor = '#fff';
    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(baseOrder + idx);
    card.dataset.rank = '4';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong>${titleHtml}</strong></div>
          <div style="font-size:13px; color:#666; line-height:1.35;">${teacherHtml}</div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#9C27B0; display:none;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
    `;
    courseListDiv.appendChild(card);

    window.courseHomeworkData[courseId] = { list: [], showAll: !!window.courseShowAllById[courseId] };
    window.yktMatchedHomeworkByCourseId[courseId] = [];
    window.mrzyMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
}

function renderJlgjStandaloneCourses() {
  clearJlgjStandaloneCards();
  const courses = window.jlgjStandaloneCourses || [];
  if (!courses.length) {
    updateCourseListEmptyPlaceholder();
    return;
  }

  const baseOrder = Number(courseListDiv.dataset.orderBase || 100000) + 80000;
  courses.forEach((c, idx) => {
    const courseId = `jlgj-${String(c.groupId || idx)}`;
    const loadingMeta = !!c.loadingMeta;
    const titleHtml = loadingMeta
      ? '正在加载…… <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:1px; border-color:#0f766e; border-top-color:transparent;"></span>'
      : escapeHtml(c.name || '接龙管家课程');
    const teacherHtml = loadingMeta
      ? '正在加载…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : escapeHtml(String(c.teacherName || ''));
    const card = document.createElement('div');
    card.className = 'file-item jlgj-standalone-card';
    card.style.backgroundColor = '#fff';
    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(baseOrder + idx);
    card.dataset.rank = '4';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${JLGJ_WEB_BASE}" target="_blank" rel="noopener noreferrer" style="color:#0f766e; text-decoration:none; line-height:1.3;">${titleHtml}</a></strong></div>
          <div style="font-size:12px; color:#666; line-height:1.35;">${teacherHtml}</div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#9C27B0; display:none;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
    `;
    courseListDiv.appendChild(card);

    window.courseHomeworkData[courseId] = { list: [], showAll: !!window.courseShowAllById[courseId] };
    window.yktMatchedHomeworkByCourseId[courseId] = [];
    window.mrzyMatchedHomeworkByCourseId[courseId] = [];
    window.jlgjMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
}

function setCourseReplayState(courseId, hasReplay) {
  const state = ensureCourseCardState(courseId);
  state.hasReplay = !!hasReplay;
  state.replayListLoading = false;
  updateCourseCardRank(courseId);
}

function setCourseReplayLoading(courseId, isLoading) {
  const state = ensureCourseCardState(courseId);
  state.replayListLoading = !!isLoading;
  updateCourseCardRank(courseId);
}

function setCourseCoursewareState(courseId, hasCourseware) {
  const state = ensureCourseCardState(courseId);
  state.hasCourseware = !!hasCourseware;
  state.coursewareListLoading = false;
  updateCourseCardRank(courseId);
}

function setCourseCoursewareLoading(courseId, isLoading) {
  const state = ensureCourseCardState(courseId);
  state.coursewareListLoading = !!isLoading;
  updateCourseCardRank(courseId);
}

function setCoursewareButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.style.pointerEvents = 'none';
    btn.classList.add('courseware-list-loading');
    btn.innerHTML = '课件下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#1e3a8a; border-top-color:transparent;"></span>';
    return;
  }
  btn.disabled = false;
  btn.style.pointerEvents = 'auto';
  btn.classList.remove('courseware-list-loading');
}

function isResultAreaOpen(resultArea) {
  if (!(resultArea instanceof HTMLElement)) return false;
  if (resultArea.dataset.animOpen === '1') return true;
  if (resultArea.style.display === 'none') return false;
  return !!resultArea.offsetHeight;
}

function toggleResultAreaAnimated(resultArea, shouldOpen, { immediate = false } = {}) {
  if (!(resultArea instanceof HTMLElement)) return;

  const transition = 'max-height 220ms ease, opacity 180ms ease';
  const clearTransitionHandlers = () => {
    if (resultArea.__resultAnimCleanup) {
      resultArea.__resultAnimCleanup();
      resultArea.__resultAnimCleanup = null;
    }
  };
  const finishNow = () => {
    clearTransitionHandlers();
    resultArea.style.transition = '';
    resultArea.style.maxHeight = '';
    resultArea.style.opacity = '';
    resultArea.style.overflow = '';
  };

  if (immediate) {
    finishNow();
    resultArea.style.display = shouldOpen ? 'block' : 'none';
    resultArea.dataset.animOpen = shouldOpen ? '1' : '0';
    return;
  }

  clearTransitionHandlers();
  resultArea.style.willChange = 'max-height, opacity';

  if (shouldOpen) {
    resultArea.style.display = 'block';
    resultArea.style.overflow = 'hidden';
    resultArea.style.opacity = '0';
    resultArea.style.maxHeight = '0px';
    // Force style flush so transition can run from collapsed state.
    void resultArea.offsetHeight;

    const targetHeight = Math.max(resultArea.scrollHeight, 1);
    resultArea.style.transition = transition;
    resultArea.style.opacity = '1';
    resultArea.style.maxHeight = `${targetHeight}px`;

    const onEnd = (ev) => {
      if (ev.target !== resultArea || ev.propertyName !== 'max-height') return;
      clearTransitionHandlers();
      resultArea.style.transition = '';
      resultArea.style.maxHeight = '';
      resultArea.style.opacity = '';
      resultArea.style.overflow = '';
      resultArea.style.willChange = '';
      resultArea.dataset.animOpen = '1';
    };
    resultArea.addEventListener('transitionend', onEnd);
    resultArea.__resultAnimCleanup = () => {
      resultArea.removeEventListener('transitionend', onEnd);
      resultArea.style.willChange = '';
    };
    return;
  }

  if (resultArea.style.display === 'none') {
    resultArea.dataset.animOpen = '0';
    return;
  }

  const currentHeight = Math.max(resultArea.scrollHeight, resultArea.offsetHeight, 1);
  resultArea.style.display = 'block';
  resultArea.style.overflow = 'hidden';
  resultArea.style.maxHeight = `${currentHeight}px`;
  resultArea.style.opacity = '1';
  // Force style flush so transition can run to collapsed state.
  void resultArea.offsetHeight;

  resultArea.style.transition = transition;
  resultArea.style.maxHeight = '0px';
  resultArea.style.opacity = '0';

  const onEnd = (ev) => {
    if (ev.target !== resultArea || ev.propertyName !== 'max-height') return;
    clearTransitionHandlers();
    resultArea.style.display = 'none';
    resultArea.style.transition = '';
    resultArea.style.maxHeight = '';
    resultArea.style.opacity = '';
    resultArea.style.overflow = '';
    resultArea.style.willChange = '';
    resultArea.dataset.animOpen = '0';
  };
  resultArea.addEventListener('transitionend', onEnd);
  resultArea.__resultAnimCleanup = () => {
    resultArea.removeEventListener('transitionend', onEnd);
    resultArea.style.willChange = '';
  };
}

function syncCourseActionButtonText(card, activeView = '') {
  if (!card) return;
  const replayBtn = card.querySelector('button[data-action="videos"]');
  const coursewareBtn = card.querySelector('button[data-action="courseware"]');

  if (replayBtn && !replayBtn.classList.contains('replay-list-loading')) {
    replayBtn.textContent = activeView === 'replay' ? '收起' : '回放下载';
  }
  if (coursewareBtn && !coursewareBtn.classList.contains('courseware-list-loading')) {
    coursewareBtn.textContent = activeView === 'courseware' ? '收起' : '课件下载';
  }
}

function syncCoursewareItemsIndex(courseId, items) {
  const cid = String(courseId || '').trim();
  const prevList = Array.isArray(window.coursewareItemsByCourseId?.[cid]) ? window.coursewareItemsByCourseId[cid] : [];
  prevList.forEach((it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    delete window.coursewareItemsById[id];
    window.resourceSpaceSelected.delete(id);
  });

  const nextList = Array.isArray(items) ? items : [];
  window.coursewareItemsByCourseId[cid] = nextList;
  nextList.forEach((it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    window.coursewareItemsById[id] = it;
  });
}

function buildCoursewareListHtml(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return '<div style="font-size:12px; color:#999;">暂无课件资源</div>';
  }

  return list.map((item, index) => {
    const name = String(item?.name || `课件-${index + 1}`).trim();
    const fileName = ensureResourceDownloadFileName(item, item?.url || '');
    const url = String(item?.url || '').trim();
    const id = String(item?.id || '').trim();
    const checked = window.resourceSpaceSelected.has(id) ? 'checked' : '';
    const sizeMb = String(item?.sizeMb || '').trim();
    const sizeStyle = buildResourceSizeEmphasisStyle(item?.sizeMbRaw ?? item?.rpSize);
    return `
      <div class="file-item" data-resource-id="${escapeHtml(id)}" style="margin-bottom:10px; padding:5px; border-left:3px solid #4CAF50; background:#f8fff9; border-radius:4px;">
        <div class="resource-row-title" style="margin-bottom:4px;">
          <input type="checkbox" data-action="resource-check" data-resource-id="${escapeHtml(id)}" ${checked} style="margin:0 4px 0 0;">
          <span class="resource-name">${escapeHtml(fileName || name)}</span>
          ${sizeMb ? `<span class="resource-time-inline" style="${sizeStyle}">${escapeHtml(sizeMb)}</span>` : ''}
        </div>
        <div class="resource-link-row">
          <a class="resource-url" href="${escapeHtml(url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(url || '')}</a>
          <button class="btn resource-copy-btn" data-action="resource-copy" data-resource-id="${escapeHtml(id)}">复制</button>
          <button class="btn resource-download-btn" data-action="resource-download" data-resource-id="${escapeHtml(id)}">下载</button>
        </div>
        <div class="resource-download-progress" style="display:none;">
          <div class="progress-bar-container"><div class="progress-bar">0%</div></div>
          <div class="resource-download-meta">
            <span class="resource-dl-status"></span>
            <span class="resource-dl-size"></span>
            <span class="resource-dl-speed"></span>
            <span class="resource-dl-eta"></span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function fetchCoursewareItems(courseNum, fzId) {
  const courseIdPart = String(courseNum || '').trim();
  const xkhIdPart = String(fzId || '').trim();
  if (!courseIdPart || !xkhIdPart) return { loginRequired: false, items: [] };

  const buildCoursewareUrl = (useQuestionMark = true) => {
    const sep = useQuestionMark ? '?' : '&';
    return `${BASE_VE}back/coursePlatform/courseResource.shtml${sep}method=stuQueryUploadResourceForCourseList&courseId=${encodeURIComponent(courseIdPart)}&cId=${encodeURIComponent(courseIdPart)}&xkhId=${encodeURIComponent(xkhIdPart)}&xqCode=${encodeURIComponent(XQ_CODE)}&docType=1`;
  };

  let text = '';
  let res = null;
  try {
    ({ text, res } = await fetchText(buildCoursewareUrl(true), {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    }));
  } catch (e) {
    // Keep existing behavior for non-HTTP errors.
    throw e;
  }

  if (Number(res?.status || 0) === 404) {
    ({ text, res } = await fetchText(buildCoursewareUrl(false), {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    }));
  }

  if (isLikelyLoginPageHtml(text, res?.url)) return { loginRequired: true, items: [] };

  let data = null;
  try { data = JSON.parse(String(text || '{}')); } catch { data = null; }
  if (!data || typeof data !== 'object') return { loginRequired: false, items: [] };

  const response = (data?.response && typeof data.response === 'object') ? data.response : data;
  const list = Array.isArray(response?.resList) ? response.resList : [];

  const items = list.map((item, index) => {
    const rpName = String(item?.rpName || `课件-${index + 1}`).trim();
    const extName = normalizeResourceExt(String(item?.extName || '').trim());
    const urlRaw = String(item?.res_url || item?.resUrl || '').trim();
    const urlNorm = normalizeResourceUrl(urlRaw);
    const sizeMbRaw = Number(item?.rpSize);
    const name = extName && !/\.[a-zA-Z0-9_-]{1,16}$/.test(rpName) ? `${rpName}.${extName}` : rpName;
    return {
      id: `cw-${String(item?.rpId || `${courseIdPart}-${xkhIdPart}-${index}`).trim()}`,
      name,
      extName,
      url: urlNorm,
      courseId: String(courseIdPart || '').trim(),
      sizeMb: formatResourceSizeMb(sizeMbRaw),
      sizeMbRaw
    };
  }).filter((it) => !!it.url);

  return { loginRequired: false, items };
}

async function loadCoursewareList(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const shouldRender = () => String(card.dataset.resultView || '').trim() === 'courseware';

  setCoursewareButtonLoading(btn, true);
  setCourseCoursewareLoading(courseIdInt, true);
  toggleResultAreaAnimated(resultArea, true);
  card.dataset.resultView = 'courseware';
  resultArea.innerHTML = '<div class="spinner" style="border-color:#1e3a8a; border-top-color:transparent; display:inline-block;"></div> <span style="color:#666;">正在获取课件...</span>';
  syncCourseActionButtonText(card, 'courseware');

  try {
    const payload = await fetchCoursewareItems(courseNum, fzId);
    if (payload.loginRequired) {
      setCourseCoursewareLoading(courseIdInt, false);
      if (shouldRender()) {
        resultArea.innerHTML = '<span class="error" style="cursor:pointer; color:blue;">[登录已失效]</span>';
        const sp = resultArea.querySelector('span');
        if (sp) sp.addEventListener('click', () => promptLoginIfPossible('登录已失效，请稍后重试或重新登录'));
      }
      promptLoginIfPossible('登录已失效，请稍后重试或重新登录');
      return;
    }

    const html = buildCoursewareListHtml(payload.items);
    syncCoursewareItemsIndex(courseIdInt, payload.items);
    window.coursewareCacheByCourseId[courseIdInt] = {
      html,
      items: payload.items,
      loaded: true
    };
    if (!payload.items.length) {
      btn.style.display = 'none';
      setCourseCoursewareState(courseIdInt, false);
      if (shouldRender()) {
        toggleResultAreaAnimated(resultArea, false);
        card.dataset.resultView = '';
      }
      return;
    }

    btn.style.display = '';
    setCourseCoursewareState(courseIdInt, true);
    if (shouldRender()) {
      resultArea.innerHTML = html;
    }
  } catch (e) {
    setCourseCoursewareLoading(courseIdInt, false);
    if (shouldRender()) {
      resultArea.innerHTML = `<span class="error">课件加载失败: ${escapeHtml(String(e?.message || e))}</span>`;
    }
  } finally {
    setCoursewareButtonLoading(btn, false);
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  }
}

async function autoLoadCourseware(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  if (!btn || !card) return;
  setCoursewareButtonLoading(btn, true);
  setCourseCoursewareLoading(courseIdInt, true);

  try {
    const payload = await fetchCoursewareItems(courseNum, fzId);
    if (payload.loginRequired) {
      setCourseCoursewareLoading(courseIdInt, false);
      return;
    }

    const html = buildCoursewareListHtml(payload.items);
    syncCoursewareItemsIndex(courseIdInt, payload.items);
    window.coursewareCacheByCourseId[courseIdInt] = {
      html,
      items: payload.items,
      loaded: true
    };

    if (!payload.items.length) {
      btn.style.display = 'none';
      setCourseCoursewareState(courseIdInt, false);
      return;
    }

    btn.style.display = '';
    setCourseCoursewareState(courseIdInt, true);
  } catch {
    setCourseCoursewareLoading(courseIdInt, false);
  } finally {
    setCoursewareButtonLoading(btn, false);
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  }
}

function toggleCoursewareFromCache(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;

  const currentView = String(card.dataset.resultView || '').trim();
  const isOpen = isResultAreaOpen(resultArea);
  const cache = window.coursewareCacheByCourseId[courseIdInt];

  if (isOpen && currentView === 'courseware') {
    toggleResultAreaAnimated(resultArea, false);
    card.dataset.resultView = '';
    syncCourseActionButtonText(card, '');
    return;
  }

  if (cache?.loaded && cache?.html) {
    syncCoursewareItemsIndex(courseIdInt, cache.items || []);
    resultArea.innerHTML = cache.html;
    toggleResultAreaAnimated(resultArea, true);
    card.dataset.resultView = 'courseware';
    syncCourseActionButtonText(card, 'courseware');
    return;
  }

  loadCoursewareList(btn, courseIdInt, courseNum, fzId).catch(() => {
    syncCourseActionButtonText(card, 'courseware');
  });
}

function recomputeCourseHomeworkState(courseId) {
  const nativeList = (window.courseHomeworkData[courseId]?.list || []);
  const yktList = isPlatformEnabled('ykt') ? (window.yktMatchedHomeworkByCourseId[courseId] || []) : [];
  const mrzyList = isPlatformEnabled('mrzy') ? (window.mrzyMatchedHomeworkByCourseId[courseId] || []) : [];
  const jlgjList = isPlatformEnabled('jlgj') ? (window.jlgjMatchedHomeworkByCourseId[courseId] || []) : [];
  const allHomeworkCount = nativeList.length + yktList.length + mrzyList.length + jlgjList.length;
  const nativePendingList = nativeList.filter(isNativeHomeworkPending);
  const yktPendingList = yktList.filter(isYktHomeworkPending);
  const mrzyPendingList = mrzyList.filter(isMrzyHomeworkPending);
  const jlgjPendingList = jlgjList.filter(isJlgjHomeworkPending);
  const nativePending = nativePendingList.length;
  const yktPending = yktPendingList.length;
  const mrzyPending = mrzyPendingList.length;
  const jlgjPending = jlgjPendingList.length;
  const pendingTs = [];
  nativePendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end_time ?? hw?.endTime ?? '')));
  yktPendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end)));
  mrzyPendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end)));
  jlgjPendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end)));
  const validPendingTs = pendingTs.filter((n) => Number.isFinite(n) && n > 0);
  const state = ensureCourseCardState(courseId);
  state.allHomeworkCount = allHomeworkCount;
  state.pendingHomeworkCount = nativePending + yktPending + mrzyPending + jlgjPending;
  state.pendingEarliestTs = validPendingTs.length ? Math.min(...validPendingTs) : 0;
  updateCourseCardRank(courseId);
}

function updateHomeworkToggleButton(courseId) {
  // Kept for compatibility with existing call sites.
  void courseId;
}

async function autoLoadVideoLinks(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const currentView = String(card.dataset.resultView || '').trim();
  const shouldTouchVisibleArea = !currentView || currentView === 'replay';

  const ensureReplayShadowArea = () => {
    let shadow = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);
    if (shadow instanceof HTMLElement) return shadow;
    shadow = document.createElement('div');
    shadow.className = 'replay-shadow-area';
    shadow.dataset.courseId = String(courseIdInt);
    shadow.style.display = 'none';
    card.appendChild(shadow);
    return shadow;
  };
  const replayShadowArea = ensureReplayShadowArea();

  btn.disabled = true;
  btn.style.opacity = '1';
  btn.style.pointerEvents = 'none';
  btn.classList.remove('replay-link-progress');
  btn.classList.add('replay-list-loading');
  btn.style.setProperty('--replay-progress', '0%');
  btn.innerHTML = '回放下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#9c27b0; border-top-color:transparent;"></span>';

  if (shouldTouchVisibleArea) {
    toggleResultAreaAnimated(resultArea, false, { immediate: true });
  }
  setCourseReplayLoading(courseIdInt, true);

  try {
    const calUrl = `${BASE_VE}back/rp/common/teachCalendar.shtml?method=toDisplyTeachCourses&courseId=${encodeURIComponent(courseIdInt)}`;
    const { text: calText } = await fetchText(calUrl, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
    const data = JSON.parse(calText);
    if (String(data.STATUS) !== '0') {
      btn.classList.remove('replay-list-loading');
      btn.style.display = 'none';
      if (shouldTouchVisibleArea) toggleResultAreaAnimated(resultArea, false, { immediate: true });
      setCourseReplayState(courseIdInt, false);
      return;
    }

    const list = (data.courseSchedList || []).filter((it) => !!it.videoId);
    if (!list.length) {
      btn.classList.remove('replay-list-loading');
      btn.style.display = 'none';
      if (shouldTouchVisibleArea) toggleResultAreaAnimated(resultArea, false, { immediate: true });
      setCourseReplayState(courseIdInt, false);
      return;
    }

    const replayListHtml = list.map((item, index) => {
      const title = `${item.classRoom || ''} ${item.courseBetween || '未知时间'}`;
      const contentText = String(item.content || '').trim();
      const detailHtml = renderExpandableHtml(
        escapeHtml(contentText),
        { hideWhenEmpty: true, expandText: '点击查看回放详情', collapseText: '点击收起回放详情', baseBg: 'rgba(243,229,245,0.42)' }
      );
      const linkContainerId = `video-link-${courseIdInt}-${index}`;
      return `
        <div style="margin-bottom: 10px; padding: 5px; background: #e1bee733; border-radius: 4px; border-left: 3px solid #9C27B0;">
          <div style="font-weight: bold; color: #4a148c; font-size: 15px;">${title}</div>
          <div style="margin-top: 5px;">
            ${detailHtml}
            <div id="${linkContainerId}" class="video-links" style="font-size: 12px; color: #9C27B0; margin-top: 5px; font-weight: bold; word-break: break-all;">
              <span class="spinner" style="width: 10px; height: 10px; border-width: 1px; border-color: #9C27B0; border-top-color: transparent;"></span> 获取中...
            </div>
          </div>
        </div>
      `;
    }).join('');

    window.videoReplayCacheByCourseId[courseIdInt] = {
      html: replayListHtml,
      list,
      loaded: true,
      linksFetched: false,
      linksFetching: false
    };
    // Keep replay list DOM in hidden shadow area so background parsing/updating won't override current visible view.
    replayShadowArea.innerHTML = replayListHtml;
    if (shouldTouchVisibleArea && currentView === 'replay') {
      resultArea.innerHTML = replayListHtml;
    }

    // List is ready: allow users to open/close replay panel immediately.
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    btn.classList.remove('replay-list-loading');
    btn.classList.remove('replay-link-progress');
    btn.style.removeProperty('--replay-progress');
    btn.textContent = '回放下载';
    setCourseReplayState(courseIdInt, true);

    // Start resolving each replay link automatically after list is ready.
    startReplayLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId).catch(() => {});
  } catch {
    btn.classList.remove('replay-list-loading');
    btn.classList.remove('replay-link-progress');
    btn.style.removeProperty('--replay-progress');
    btn.style.display = 'none';
    if (shouldTouchVisibleArea) toggleResultAreaAnimated(resultArea, false, { immediate: true });
    setCourseReplayState(courseIdInt, false);
  }
}

async function startReplayLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const cache = window.videoReplayCacheByCourseId?.[courseIdInt];
  const list = Array.isArray(cache?.list) ? cache.list : [];
  if (!cache || !list.length || cache.linksFetched || cache.linksFetching) return;

  cache.linksFetching = true;
  btn.classList.add('replay-link-progress');
  btn.style.setProperty('--replay-progress', '0%');

  const shadowArea = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);
  const shadowHasContent = (shadowArea instanceof HTMLElement) && !!String(shadowArea.innerHTML || '').trim();
  const workingArea = shadowHasContent ? shadowArea : resultArea;

  const totalLinks = list.length;
  let doneLinks = 0;
  const onOneLinkDone = () => {
    doneLinks += 1;
    const p = Math.max(0, Math.min(100, Math.round((doneLinks / totalLinks) * 100)));
    btn.style.setProperty('--replay-progress', `${p}%`);
    if (doneLinks >= totalLinks) {
      btn.classList.remove('replay-link-progress');
      btn.style.removeProperty('--replay-progress');
    }
  };

  await Promise.allSettled(list.map((item, index) => {
    const linkContainerId = `video-link-${courseIdInt}-${index}`;
    return fetchVideoLinkInternal(linkContainerId, item.videoId, courseNum, fzId, item.teacherId || '')
      .finally(onOneLinkDone);
  }));

  cache.linksFetching = false;
  cache.linksFetched = true;
  const visibleHtml = String(resultArea.innerHTML || '').trim();
  const shadowHtml = (shadowArea instanceof HTMLElement) ? String(shadowArea.innerHTML || '').trim() : '';
  const workingHtml = String(workingArea.innerHTML || '').trim();
  // Prefer visible replay html when user has already opened replay during link fetching.
  const finalHtml = visibleHtml || shadowHtml || workingHtml || String(cache.html || '');
  cache.html = finalHtml;

  const currentView = String(card.dataset.resultView || '').trim();
  if (currentView === 'replay' && finalHtml) {
    resultArea.innerHTML = cache.html;
    toggleResultAreaAnimated(resultArea, true, { immediate: true });
  }
}

function toggleReplayFromCache(btn, courseIdInt) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const cache = window.videoReplayCacheByCourseId[courseIdInt];
  const currentView = String(card.dataset.resultView || '').trim();
  const isOpen = isResultAreaOpen(resultArea);
  const shadowArea = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);

  if (isOpen && currentView === 'replay') {
    toggleResultAreaAnimated(resultArea, false);
    card.dataset.resultView = '';
    syncCourseActionButtonText(card, '');
    return;
  }

  if (!cache?.html) {
    if (btn.disabled) return;
    return;
  }

  if (cache?.linksFetching) {
    const shadowHtml = (shadowArea instanceof HTMLElement) ? String(shadowArea.innerHTML || '') : '';
    if (shadowHtml.trim()) {
      resultArea.innerHTML = shadowHtml;
      // Move live link containers to visible area so in-flight callbacks continue updating visible list.
      if (shadowArea instanceof HTMLElement) shadowArea.innerHTML = '';
    } else if (cache?.html) {
      resultArea.innerHTML = cache.html;
    }
  } else if (cache?.html) {
    resultArea.innerHTML = cache.html;
  }
  toggleResultAreaAnimated(resultArea, true);
  card.dataset.resultView = 'replay';
  syncCourseActionButtonText(card, 'replay');

  const courseNum = String(btn.dataset.courseNum || '').trim();
  const fzId = String(btn.dataset.fzId || '').trim();
  startReplayLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId).catch(() => {});
}

function collectCourseMatchMap(courses) {
  const m = new Map();
  (courses || []).forEach((course) => {
    const courseId = course.id || course.cId || course.courseId || course.course_id;
    const fzId = course.fz_id || course.fzId || course.xkhId || course.xkh_id || '';
    const seq10 = getVeCourseSeq10(course);
    const meta = { courseId, fzId };
    const tokenSources = [
      seq10,
      fzId,
      course.course_num,
      course.courseNum,
      course.courseNo,
      course.course_id,
      course.courseId,
      course.id,
      course.cId
    ];
    tokenSources.forEach((src) => {
      const token = normalizeTail10Token(src);
      if (token) m.set(token, meta);
    });
  });
  return m;
}

function collectCourseNameMap(courses) {
  const m = new Map();
  (courses || []).forEach((course) => {
    const courseId = course.id || course.cId || course.courseId || course.course_id;
    const fzId = course.fz_id || course.fzId || course.xkhId || course.xkh_id || '';
    const courseName = course.name || course.NAME || course.courseName || course.title || '';
    const token = normalizeCourseNameToken(courseName);
    if (token && courseId) m.set(token, { courseId, fzId, courseName });
  });
  return m;
}

async function loadYktCoursesAndHomework(courses, loadVersion = 0) {
  const isStale = () => !!(loadVersion && loadVersion !== (window.platformLoadVersion?.ykt || 0));
  if (isStale()) return;
  if (!isPlatformEnabled('ykt')) {
    clearPlatformData('ykt');
    window.yktHomeworkLoadingByCourse = {};
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('ykt', 'checking');
  ensureYktSection();
  const strictMatchMap = collectVeFzIdTail10Map(courses);

  let listResp;
  try {
    listResp = await fetchYktJson(YKT_COURSE_LIST_API);
  } catch {
    if (isStale()) return;
    renderYktNeedLoginMessage();
    return;
  }

  if (isStale()) return;
  if (Number(listResp?.errcode) !== 0) {
    window.platformLoadedOnce.ykt = true;
    renderYktNeedLoginMessage();
    return;
  }

  window.yktMatchedHomeworkByCourseId = {};
  window.yktStandaloneCourses = [];
  window.yktMatchedCourseLinkByCourseId = {};
  window.yktCourseGroupsSnapshot = [];
  window.yktHomeworkLoadingByCourse = {};

  setPlatformLoginState('ykt', 'online');
  window.platformLoadedOnce.ykt = true;
  removeYktLoginSection();

  const yktCourses = listResp?.data?.list || [];
  const entries = [];
  const boundCourseIds = new Set();

  for (const item of yktCourses) {
    const classroomId = item?.classroom_id;
    if (!classroomId) continue;
    const name = String(item?.name || '');
    const courseName = String(item?.course?.name || item?.name || '').trim();
    const strictToken = normalizeTail10Token(item?.university_course_series_id || '');
    const matched = strictToken ? strictMatchMap.get(strictToken) : null;
    const boundCourseId = matched?.courseId ? String(matched.courseId) : '';

    const entry = {
      item,
      classroomId: String(classroomId),
      boundCourseId,
      name,
      courseName,
      strictToken,
      homeworks: []
    };
    entries.push(entry);

    window.yktCourseGroupsSnapshot.push({
      token: strictToken || '',
      strictToken,
      name,
      teacher_name: item?.teacher?.name || '',
      classroom_id: item?.classroom_id,
      course_name: courseName || '雨课堂课程',
      homeworks: []
    });

    if (boundCourseId) {
      if (!window.yktMatchedHomeworkByCourseId[boundCourseId]) window.yktMatchedHomeworkByCourseId[boundCourseId] = [];
      window.yktMatchedCourseLinkByCourseId[boundCourseId] = yktCourseLink(item?.classroom_id);
      window.yktHomeworkLoadingByCourse[boundCourseId] = true;
      boundCourseIds.add(boundCourseId);
    } else {
      const sid = `ykt-${String(classroomId)}`;
      window.yktHomeworkLoadingByCourse[sid] = true;
      window.yktStandaloneCourses.push({
        name,
        teacher_name: item?.teacher?.name || '',
        classroom_id: item?.classroom_id,
        course_name: item?.course?.name || item?.name || '雨课堂课程',
        homeworks: []
      });
    }
  }

  boundCourseIds.forEach((cid) => renderHomeworkList(cid));
  renderYktStandaloneCourses();
  const detailQueue = [];
  let yktExamSharedTabId = null;

  const getCurrentBoundCourseId = (entry) => {
    const veCourses = Array.isArray(window.currentVeCourseList) ? window.currentVeCourseList : [];
    const strictMap = collectVeFzIdTail10Map(veCourses);
    const tk = String(entry?.strictToken || '').trim();
    const m = tk ? strictMap.get(tk) : null;
    return m?.courseId ? String(m.courseId) : '';
  };

  const rerenderEntryCard = (entry) => {
    if (isStale()) return;
    const boundCourseId = getCurrentBoundCourseId(entry);
    if (boundCourseId) {
      renderHomeworkList(boundCourseId);
    } else {
      renderHomeworkList(`ykt-${entry.classroomId}`);
    }
  };

  const courseTasks = entries.map(async (entry, idx) => {
    if (isStale()) return;
    const actypes = [15, 5];
    const urls = actypes.map((actype) => `${YKT_BASE}/v2/api/web/logs/learn/${encodeURIComponent(String(entry.classroomId))}?actype=${actype}&page=0&offset=100`);
    const logSettled = await Promise.allSettled(urls.map((u) => fetchYktJson(u)));
    if (isStale()) return;

    const acts = [];
    logSettled.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const lr = r.value;
      if (Number(lr?.errcode) === 0 && Array.isArray(lr?.data?.activities)) {
        acts.push(...lr.data.activities.map((a) => ({ ...a, __actype: actypes[i] })));
      }
    });

    const homeworksRaw = acts.map((a) => {
      const isExam = Number(a?.__actype) === 5;
      const isCard = Number(a?.__actype) === 15;
      const examId = a?.courseware_id ?? a?.exam_id ?? a?.examId ?? a?.id ?? '';
      const detailKey = isExam
        ? `5:${String(a?.course_id || entry.classroomId)}:${String(examId || '')}`
        : (isCard ? `15:${String(entry.classroomId)}:${String(a?.courseware_id || '')}` : '');
      const cache = detailKey ? window.yktDetailCacheByKey[detailKey] : null;
      const hw = {
        title: a?.title || '雨课堂作业',
        end: getYktActivityDeadline(a),
        type: a?.type,
        done: (a?.view && a?.view?.done) !== undefined ? !!(a?.view && a?.view?.done) : undefined,
        unfinished: a?.unfinished,
        progress: a?.progress,
        problem_count: a?.problem_count,
        score: a?.score,
        total_score: a?.total_score,
        link: isExam
          ? yktExamLink(a?.course_id || entry.classroomId, a?.courseware_id)
          : yktHomeworkLink(entry.classroomId, a?.courseware_id, a?.id),
        courseware_id: a?.courseware_id,
        id: a?.id,
        exam_id: examId,
        __actype: a?.__actype,
        exam_problems: Array.isArray(cache?.exam_problems) ? cache.exam_problems : [],
        problem_results: Array.isArray(cache?.problem_results) ? cache.problem_results : [],
        exam_detail_state: cache?.state === 'done' ? 'done' : (cache?.state === 'failed' ? 'failed' : ''),
        detail_cache_key: detailKey,
        course_id: a?.course_id || entry.classroomId,
        classroom_id: entry.classroomId
      };
      return hw;
    });

    const seen = new Set();
    const homeworks = homeworksRaw.filter((h) => {
      const key = `${h.classroom_id}-${h.courseware_id}-${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    entry.homeworks = homeworks;
    const snap = window.yktCourseGroupsSnapshot[idx];
    if (snap) snap.homeworks = homeworks;

    window.yktHomeworkLoadingByCourse[`ykt-${entry.classroomId}`] = false;
    if (entry.boundCourseId) window.yktHomeworkLoadingByCourse[entry.boundCourseId] = false;
    const currentBound = getCurrentBoundCourseId(entry);
    if (currentBound) window.yktHomeworkLoadingByCourse[currentBound] = false;

    rematchExternalByVeCourses();
    rerenderAllHomeworkAreas();
    renderYktStandaloneCourses();
    if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
    if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();

    let queuedChanged = false;
    homeworks.forEach((hw) => {
      const actype = Number(hw?.__actype);
      if (actype !== 5 && actype !== 15) return;
      if (actype === 5 && !String(hw?.exam_id || '').trim()) return;
      if (actype === 15 && !String(hw?.courseware_id || '').trim()) return;
      if (!hw.exam_detail_state) {
        hw.exam_detail_state = 'queued';
        queuedChanged = true;
      }
      detailQueue.push({ entry, hw });
    });
    if (queuedChanged) rerenderEntryCard(entry);
  });

  await Promise.allSettled(courseTasks);

  for (const task of detailQueue) {
    if (isStale()) {
      if (yktExamSharedTabId) {
        try { await chrome.tabs.remove(yktExamSharedTabId); } catch { /* ignore */ }
        yktExamSharedTabId = null;
      }
      return;
    }
    const { entry, hw } = task;
    const actype = Number(hw?.__actype);
    const detailKey = String(hw?.detail_cache_key || '').trim();
    const cache = detailKey ? window.yktDetailCacheByKey[detailKey] : null;

    if (cache?.state === 'done') {
      if (cache.title) hw.title = cache.title;
      hw.exam_problems = Array.isArray(cache.exam_problems) ? cache.exam_problems : [];
      hw.problem_results = Array.isArray(cache.problem_results) ? cache.problem_results : [];
      hw.exam_detail_state = 'done';
      rerenderEntryCard(entry);
      continue;
    }

    if (cache?.state === 'loading' && cache?.promise) {
      hw.exam_detail_state = 'loading';
      await cache.promise.catch(() => {});
      const latest = window.yktDetailCacheByKey[detailKey] || {};
      if (latest.title) hw.title = latest.title;
      hw.exam_problems = Array.isArray(latest.exam_problems) ? latest.exam_problems : [];
      hw.problem_results = Array.isArray(latest.problem_results) ? latest.problem_results : [];
      hw.exam_detail_state = latest.state === 'done' ? 'done' : 'failed';
      rerenderEntryCard(entry);
      continue;
    }

    hw.exam_detail_state = 'loading';
    rerenderEntryCard(entry);

    try {
      if (detailKey) {
        window.yktDetailCacheByKey[detailKey] = {
          ...(window.yktDetailCacheByKey[detailKey] || {}),
          state: 'loading',
          title: hw.title,
          exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : [],
          problem_results: Array.isArray(hw.problem_results) ? hw.problem_results : []
        };
      }

      if (actype === 5) {
        if (!yktExamSharedTabId) {
          const t = await chrome.tabs.create({ url: `${YKT_BASE}/web`, active: false });
          yktExamSharedTabId = Number(t?.id || 0) || null;
        }
        const p = fetchYktExamPaper(hw?.course_id || entry.classroomId, hw?.exam_id || '', yktExamSharedTabId);
        if (detailKey) window.yktDetailCacheByKey[detailKey].promise = p;
        const examPaper = await p;
        if (examPaper?.title) hw.title = examPaper.title;
        hw.exam_problems = Array.isArray(examPaper?.problems) ? examPaper.problems : [];
      } else {
        const p = fetchYktCardDetList(hw?.courseware_id || '', entry.classroomId);
        if (detailKey) window.yktDetailCacheByKey[detailKey].promise = p;
        const problemResults = await p;
        hw.problem_results = Array.isArray(problemResults) ? problemResults : [];
      }

      hw.exam_detail_state = 'done';
      if (detailKey) {
        window.yktDetailCacheByKey[detailKey] = {
          ...(window.yktDetailCacheByKey[detailKey] || {}),
          state: 'done',
          title: hw.title,
          exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : [],
          problem_results: Array.isArray(hw.problem_results) ? hw.problem_results : [],
          promise: null
        };
      }
    } catch {
      hw.exam_detail_state = 'failed';
      if (detailKey) {
        window.yktDetailCacheByKey[detailKey] = {
          ...(window.yktDetailCacheByKey[detailKey] || {}),
          state: 'failed',
          promise: null
        };
      }
    }

    rerenderEntryCard(entry);
  }

  if (yktExamSharedTabId) {
    try { await chrome.tabs.remove(yktExamSharedTabId); } catch { /* ignore */ }
  }
}

async function postMrzyForm(url, paramsObj, runtimeCtx = null) {
  const MRZY_SIGN_SALT = 'IF75D4U19LKLDAZSMPN5ATQLGBFEJL4VIL2STVDBNJJTO6LNOGB265CR40I4AL13';

  const waitTabReady = async (tabId, timeoutMs = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const t = await chrome.tabs.get(tabId);
        if (t?.status === 'complete') return true;
      } catch {
        return false;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  const normalizeMrzyParams = (obj) => {
    const out = {};
    Object.keys(obj || {}).forEach((k) => {
      const v = obj[k];
      if (v === undefined) return;
      out[k] = String(v);
    });
    return out;
  };

  const toBodyRaw = (obj) => Object.entries(obj || {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(String(k))}=${encodeURIComponent(String(v ?? ''))}`)
    .join('&');

  const toBase64Utf8 = (s) => {
    try {
      return btoa(unescape(encodeURIComponent(String(s || ''))));
    } catch {
      return btoa(String(s || ''));
    }
  };

  const buildMrzySign = (obj) => {
    const normalized = normalizeMrzyParams(obj || {});
    const payload = JSON.stringify(normalized || {});
    return md5(`${toBase64Utf8(payload)}${MRZY_SIGN_SALT}`);
  };

  const postFromZuoyePageContext = async (bodyRaw, extSign, extToken, ctx = null) => {
    let tab = null;
    let created = false;
    try {
      if (ctx?.tabId) {
        try {
          const existingTab = await chrome.tabs.get(Number(ctx.tabId));
          if (existingTab?.id) tab = existingTab;
        } catch {
          ctx.tabId = null;
        }
      }

      if (!tab) {
        if (ctx) {
          tab = await chrome.tabs.create({ url: 'https://zuoye.lulufind.com/', active: false });
          created = true;
          ctx.tabId = Number(tab?.id || 0) || null;
          ctx.createdTab = true;
        } else {
          const exists = await chrome.tabs.query({ url: ['https://zuoye.lulufind.com/*'] });
          if (exists && exists.length > 0) {
            tab = exists[0];
          } else {
            tab = await chrome.tabs.create({ url: 'https://zuoye.lulufind.com/', active: false });
            created = true;
          }
        }
      }
      if (!tab?.id) throw new Error('NO_TAB');
      await waitTabReady(tab.id, 15000);

      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (reqUrl, bodyText, signFromExt, tokenFromExt) => {
          const readCookie = (name) => {
            const n = String(name || '').toLowerCase();
            const parts = String(document.cookie || '').split(';').map((x) => x.trim()).filter(Boolean);
            for (const p of parts) {
              const idx = p.indexOf('=');
              if (idx <= 0) continue;
              const k = p.slice(0, idx).trim().toLowerCase();
              if (k === n) return decodeURIComponent(p.slice(idx + 1));
            }
            return '';
          };

          const readStorage = (k) => {
            try {
              return String(localStorage.getItem(k) || sessionStorage.getItem(k) || '').trim();
            } catch {
              return '';
            }
          };

          const sign = String(
            signFromExt
            || readCookie('Sign')
            || readStorage('Sign')
            || ''
          ).trim();
          const token = String(
            tokenFromExt
            || readCookie('Teacher-Token')
            || readCookie('Token')
            || readStorage('Teacher-Token')
            || readStorage('Token')
            || readStorage('token')
            || ''
          ).trim();

          const headers = {
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/x-www-form-urlencoded',
            Pragma: 'no-cache'
          };
          if (sign) headers.sign = sign;
          if (token) headers.token = token;

          const res = await fetch(reqUrl, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers,
            body: String(bodyText || '')
          });
          const text = await res.text();
          let data = null;
          try { data = JSON.parse(text); } catch { data = null; }
          return { status: res.status, text, data, signPresent: !!sign, tokenPresent: !!token };
        },
        args: [url, bodyRaw, extSign || '', extToken || '']
      });

      const result = injected?.[0]?.result || null;
      if (!result) throw new Error('INJECT_EMPTY');
      return {
        res: { status: Number(result.status || 0) },
        data: result.data,
        text: result.text
      };
    } finally {
      if (!ctx && created && tab?.id) {
        try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
      }
    }
  };

  const getCookieValueLoose = async (domain, names) => {
    try {
      const all = await chrome.cookies.getAll({ domain });
      if (!all || !all.length) return '';
      all.sort((a, b) => (b.path || '').length - (a.path || '').length);
      const nameSet = new Set((names || []).map((n) => String(n || '').toLowerCase()));
      const hit = all.find((c) => nameSet.has(String(c?.name || '').toLowerCase()));
      return String(hit?.value || '').trim();
    } catch {
      return '';
    }
  };

  const sign = buildMrzySign(paramsObj || {});
  const token = await getCookieValueLoose('lulu.lulufind.com', ['Teacher-Token', 'Token'])
    || await getCookieValueLoose('zuoye.lulufind.com', ['Teacher-Token', 'Token']);

  const normalizedParams = normalizeMrzyParams(paramsObj || {});
  const bodyRaw = toBodyRaw(normalizedParams);
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://zuoye.lulufind.com',
    Pragma: 'no-cache',
    Referer: 'https://zuoye.lulufind.com/'
  };
  if (sign) headers.sign = sign;
  if (token) headers.token = token;

  if (runtimeCtx?.preferPageContext) {
    try {
      return await postFromZuoyePageContext(bodyRaw, sign, token, runtimeCtx);
    } catch {
      // fallback to direct fetch below
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    referrer: 'https://zuoye.lulufind.com/',
    referrerPolicy: 'strict-origin-when-cross-origin',
    headers,
    body: bodyRaw
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }

  if (Number(res.status) === 401 || Number(res.status) === 403) {
    try {
      return await postFromZuoyePageContext(bodyRaw, sign, token, runtimeCtx);
    } catch {
      // fallback to direct response below
    }
  }
  return { res, data, text };
}

function collectCourseNameMatchMap(courses) {
  const m = new Map();
  (courses || []).forEach((course) => {
    const courseId = course.id || course.cId || course.courseId || course.course_id;
    const courseName = course.name || course.NAME || course.courseName || course.title || '';
    const token = normalizeCourseNameToken(courseName);
    if (token && courseId) m.set(token, { courseId, courseName });
  });
  return m;
}

async function loadMrzyCoursesAndHomework(courses, loadVersion = 0) {
  const shouldAbort = () => !!(loadVersion && loadVersion !== (window.platformLoadVersion?.mrzy || 0)) || !isPlatformEnabled('mrzy');
  if (shouldAbort()) return;
  if (!isPlatformEnabled('mrzy')) {
    clearPlatformData('mrzy');
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('mrzy', 'checking');
  const mrzyRuntimeCtx = { tabId: null, createdTab: false, preferPageContext: true };
  const closeMrzyRuntimeTab = async () => {
    if (mrzyRuntimeCtx?.createdTab && mrzyRuntimeCtx?.tabId) {
      try { await chrome.tabs.remove(Number(mrzyRuntimeCtx.tabId)); } catch { /* ignore */ }
      mrzyRuntimeCtx.tabId = null;
    }
  };

  const pickMrzyCourseName = (w) => {
    const v = String(w?.divClass || w?.className || w?.courseName || w?.course_name || w?.workClass || '').trim();
    return v || '每日交作业课程';
  };
  const pickMrzyTeacherName = (w) => String(w?.teacherName || w?.teacher_name || w?.teacherRealName || w?.userRealName || w?.teacher || '').trim();
  const pickMrzyDeadline = (w) => String(w?.workRemark || w?.endTime || w?.end || w?.deadline || '').trim();
  const pickMrzyTitle = (w) => String(w?.workDetail || w?.title || '').trim() || `作业 ${w?.workId || ''}`;

  const matchMap = collectCourseNameMatchMap(courses);
  const endTime = todayEndDateTimeString();
  const listResp = await postMrzyForm(MRZY_WORK_LIST_API, {
    start: 0,
    num: 12,
    beginTime: '1990-01-01 00:00:00',
    endTime,
    limit: 1
  }, mrzyRuntimeCtx);
  if (shouldAbort()) return;

  if (listResp.res.status === 401 || listResp.res.status === 403) {
    window.platformLoadedOnce.mrzy = true;
    await closeMrzyRuntimeTab();
    renderMrzyNeedLoginMessage();
    return;
  }
  if (!listResp.data || Number(listResp.data.code) !== 200) {
    window.platformLoadedOnce.mrzy = true;
    await closeMrzyRuntimeTab();
    renderMrzyNeedLoginMessage();
    return;
  }

  window.mrzyMatchedHomeworkByCourseId = {};
  window.mrzyStandaloneCourses = [];
  window.mrzyCourseGroupsSnapshot = [];

  setPlatformLoginState('mrzy', 'online');
  window.platformLoadedOnce.mrzy = true;
  const works = Array.isArray(listResp.data.data) ? listResp.data.data : [];
  if (!works.length) {
    await closeMrzyRuntimeTab();
    renderMrzyStandaloneCourses();
    return;
  }

  // First paint: render homework titles immediately with loading placeholders.
  const groupedLoading = new Map();
  works.forEach((w) => {
    const realDivClass = pickMrzyCourseName(w);
    const key = String(realDivClass || w.classNum || `work-${w.workId}`).trim();
    if (!groupedLoading.has(key)) {
      groupedLoading.set(key, {
        divClass: '正在加载……',
        classNum: w.classNum,
        teacherName: '正在加载……',
        realDivClass,
        homeworks: []
      });
    }
    const g = groupedLoading.get(key);
    g.homeworks.push({
      workId: w.workId,
      title: pickMrzyTitle(w),
      end: '正在加载……',
      submit: Number(w.submit || 0),
      isSubmit: Number(w.isSubmit || 0),
      done: Number(w.submit || 0) > 0,
      loadingMeta: true,
      link: `${MRZY_WEB_BASE}/#/studentsSubmitWork?id=${encodeURIComponent(String(w.workId || ''))}`
    });
  });

  groupedLoading.forEach((courseGroup) => {
    const token = normalizeCourseNameToken(courseGroup.realDivClass || '');
    const matched = token ? matchMap.get(token) : null;
    if (matched?.courseId) {
      if (!window.mrzyMatchedHomeworkByCourseId[matched.courseId]) {
        window.mrzyMatchedHomeworkByCourseId[matched.courseId] = [];
      }
      window.mrzyMatchedHomeworkByCourseId[matched.courseId].push(...courseGroup.homeworks);
    } else {
      window.mrzyStandaloneCourses.push({
        divClass: courseGroup.divClass,
        classNum: courseGroup.classNum,
        teacherName: courseGroup.teacherName,
        loadingMeta: true,
        homeworks: courseGroup.homeworks
      });
    }
  });

  Object.keys(window.mrzyMatchedHomeworkByCourseId).forEach((courseId) => {
    renderHomeworkList(courseId);
  });
  renderMrzyStandaloneCourses();

  const detailSettled = await Promise.allSettled(works.map(async (w) => {
    const dr = await postMrzyForm(MRZY_WORK_DETAIL_API, { workId: w.workId }, mrzyRuntimeCtx);
    const teacherName = dr?.data?.data?.teacher?.userRealName || '';
    return { workId: w.workId, teacherName };
  }));
  if (shouldAbort()) return;
  const teacherByWorkId = new Map();
  detailSettled.forEach((r) => {
    if (r.status === 'fulfilled') teacherByWorkId.set(r.value.workId, r.value.teacherName || '');
  });

  const grouped = new Map();
  works.forEach((w) => {
    const key = pickMrzyCourseName(w);
    if (!grouped.has(key)) {
      grouped.set(key, {
        divClass: key,
        classNum: w.classNum,
        teacherName: '',
        homeworks: []
      });
    }
    const g = grouped.get(key);
    const teacherName = String(teacherByWorkId.get(w.workId) || pickMrzyTeacherName(w) || '').trim();
    if (!g.teacherName && teacherName) g.teacherName = teacherName;
    g.homeworks.push({
      workId: w.workId,
      title: pickMrzyTitle(w),
      end: pickMrzyDeadline(w),
      submit: Number(w.submit || 0),
      isSubmit: Number(w.isSubmit || 0),
      done: Number(w.submit || 0) > 0,
      loadingMeta: false,
      link: `${MRZY_WEB_BASE}/#/studentsSubmitWork?id=${encodeURIComponent(String(w.workId || ''))}`
    });
  });

  // Replace first-stage placeholder data with hydrated data instead of appending.
  window.mrzyMatchedHomeworkByCourseId = {};
  window.mrzyStandaloneCourses = [];
  window.mrzyCourseGroupsSnapshot = [];

  grouped.forEach((courseGroup) => {
    const token = normalizeCourseNameToken(courseGroup.divClass);
    window.mrzyCourseGroupsSnapshot.push({
      token,
      divClass: courseGroup.divClass,
      classNum: courseGroup.classNum,
      teacherName: courseGroup.teacherName,
      homeworks: courseGroup.homeworks
    });
    const matched = matchMap.get(token);
    if (matched?.courseId) {
      if (!window.mrzyMatchedHomeworkByCourseId[matched.courseId]) {
        window.mrzyMatchedHomeworkByCourseId[matched.courseId] = [];
      }
      window.mrzyMatchedHomeworkByCourseId[matched.courseId].push(...courseGroup.homeworks);
    } else {
      window.mrzyStandaloneCourses.push(courseGroup);
    }
  });

  Object.keys(window.mrzyMatchedHomeworkByCourseId).forEach((courseId) => {
    renderHomeworkList(courseId);
  });
  renderMrzyStandaloneCourses();

  await closeMrzyRuntimeTab();
}

async function loadJlgjCoursesAndHomework(courses = []) {
  const loadVersion = bumpPlatformLoadVersion('jlgj');
  const isStale = () => !!(loadVersion && loadVersion !== (window.platformLoadVersion?.jlgj || 0));
  if (isStale()) return;
  if (!isPlatformEnabled('jlgj')) {
    clearPlatformData('jlgj');
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('jlgj', 'checking');

  let bgTab = null;
  try {
    const matchMap = collectCourseNameMatchMap(courses);

    const pickArr = (payload) => {
      const data = extractJlgjData(payload);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.Data)) return data.Data;
      return [];
    };

    const ensureBgTabAndAuth = async () => {
      if (bgTab?.id) return { ok: true, unauthorized: false };
      bgTab = await openJlgjBackgroundTab();
      if (!bgTab?.id) return { ok: false, unauthorized: false };
      await waitJlgjTabComplete(bgTab.id, 12000);
      try {
        const tabNow = await chrome.tabs.get(bgTab.id);
        const urlNow = String(tabNow?.url || '');
        if (/https:\/\/i\.jielong\.com\/login/i.test(urlNow)) {
          try { await chrome.tabs.remove(bgTab.id); } catch { /* ignore */ }
          bgTab = null;
          return { ok: false, unauthorized: true };
        }
      } catch {
        return { ok: false, unauthorized: false };
      }
      await waitForJlgjAuthHeaders(8000);
      return { ok: true, unauthorized: false };
    };

    const doFetch = async (u) => {
      if (bgTab?.id) return fetchJlgjJsonFromPageContext(u, bgTab.id);
      return fetchJlgjJson(u);
    };

    let listResp = await waitAndFetchJlgjGroupListFromBrowser(30000);
    if (isStale()) return;

    if (listResp?.unauthorized) {
      window.platformLoadedOnce.jlgj = true;
      renderJlgjNeedLoginMessage();
      return;
    }

    let captureData = listResp?.__fullCapture || null;
    let groups = pickArr(captureData?.userGroupPages?.data || null);

    // Capture path may intermittently miss data; fallback to direct API fetch.
    if ((!listResp?.ok || !groups.length) && !listResp?.unauthorized) {
      const ready = await ensureBgTabAndAuth();
      if (ready?.unauthorized) {
        window.platformLoadedOnce.jlgj = true;
        renderJlgjNeedLoginMessage();
        return;
      }
      if (ready?.ok) {
        const directListResp = await doFetch(JLGJ_GROUP_LIST_API);
        if (isStale()) return;
        if (directListResp?.unauthorized) {
          window.platformLoadedOnce.jlgj = true;
          renderJlgjNeedLoginMessage();
          return;
        }
        if (directListResp?.ok) {
          listResp = directListResp;
          captureData = null;
          groups = pickArr(directListResp.data);
        }
      }
    }

    if (!listResp?.ok && !groups.length) {
      window.platformLoadedOnce.jlgj = true;
      setPlatformLoginState('jlgj', 'online');
      clearPlatformData('jlgj');
      rerenderAllHomeworkAreas();
      return;
    }

    window.jlgjMatchedHomeworkByCourseId = {};
    window.jlgjStandaloneCourses = [];
    window.jlgjCourseGroupsSnapshot = [];

    setPlatformLoginState('jlgj', 'online');
    window.platformLoadedOnce.jlgj = true;

    const rebuildJlgjRender = () => {
      window.jlgjMatchedHomeworkByCourseId = {};
      window.jlgjStandaloneCourses = [];
      for (const cg of (window.jlgjCourseGroupsSnapshot || [])) {
        const matched = matchMap.get(String(cg?.token || ''));
        if (matched?.courseId) {
          const cid = String(matched.courseId);
          if (!window.jlgjMatchedHomeworkByCourseId[cid]) window.jlgjMatchedHomeworkByCourseId[cid] = [];
          window.jlgjMatchedHomeworkByCourseId[cid].push(...(Array.isArray(cg.homeworks) ? cg.homeworks : []));
        } else {
          window.jlgjStandaloneCourses.push({
            name: cg.name,
            groupId: cg.groupId,
            teacherName: cg.teacherName,
            loadingMeta: !!cg.loadingMeta,
            homeworks: Array.isArray(cg.homeworks) ? cg.homeworks : []
          });
        }
      }
      (courses || []).forEach((course) => {
        const cid = String(course?.id || course?.cId || course?.courseId || course?.course_id || '').trim();
        if (cid) renderHomeworkList(cid);
      });
      Object.keys(window.jlgjMatchedHomeworkByCourseId).forEach((courseId) => {
        renderHomeworkList(courseId);
      });
      renderJlgjStandaloneCourses();
    };

    for (const g of groups) {
      if (isStale()) return;
      const groupId = String(g?.Id || '').trim();
      const name = String(g?.Name || '接龙管家课程').trim();
      if (!groupId) continue;

      let threads = [];
      if (captureData) {
        const threadsObj = captureData.threads[groupId];
        if (threadsObj?.ok && threadsObj?.data) {
          threads = pickArr(threadsObj.data);
        }
      }
      if (!threads.length) {
        const threadUrl = `${JLGJ_API_BASE}/api/Thread/GroupThreads?pageIndex=1&pageSize=20&groupId=${encodeURIComponent(groupId)}&groupListType=0`;
        const threadsResp = await doFetch(threadUrl);
        if (isStale()) return;
        if (threadsResp?.unauthorized) continue;
        if (threadsResp?.ok) {
          threads = pickArr(threadsResp.data);
        }
      }
      if (!threads.length) continue;

      const teacherSet = new Set();
      const homeworks = threads.map((t) => {
        const threadId = String(t?.ThreadStrId || '').trim();
        const teacherName0 = String(t?.Author || '').trim();
        if (teacherName0) teacherSet.add(teacherName0);
        const isAttend0 = t?.IsAttend;
        const done0 = isAttend0 === true || isAttend0 === 1 || isAttend0 === '1' || String(isAttend0 || '').toLowerCase() === 'true';
        return {
          threadId,
          title: String(t?.Subject || t?.GroupName || '接龙作业').trim(),
          end: '',
          content: '',
          done: done0,
          link: `https://i.jielong.com/h/${threadId}`,
          loadingMeta: true
        };
      });

      const courseGroup = {
        token: normalizeCourseNameToken(name),
        name,
        groupId,
        teacherName: Array.from(teacherSet).join(' / '),
        loadingMeta: true,
        homeworks
      };
      window.jlgjCourseGroupsSnapshot.push(courseGroup);
      rebuildJlgjRender();

      for (let i = 0; i < threads.length; i++) {
        if (isStale()) return;
        const t = threads[i];
        const threadId = String(t?.ThreadStrId || '').trim();
        if (!threadId) {
          if (homeworks[i]) homeworks[i].loadingMeta = false;
          rebuildJlgjRender();
          continue;
        }

        let detail = null;
        if (captureData) {
          const detailObj = captureData.details[threadId];
          if (detailObj?.ok && detailObj?.data) {
            const detailPayload = detailObj.data;
            detail = detailPayload?.Data?.Data || detailPayload?.Data || null;
          }
        }
        if (!detail) {
          const detailUrl = `${JLGJ_API_BASE}/api/Homework/HomeworkDetail?threadId=${encodeURIComponent(threadId)}`;
          const detailResp = await doFetch(detailUrl);
          if (isStale()) return;
          if (detailResp?.unauthorized) {
            if (homeworks[i]) homeworks[i].loadingMeta = false;
            rebuildJlgjRender();
            continue;
          }
          if (detailResp?.ok) {
            const detailPayload = detailResp.data;
            detail = detailPayload?.Data?.Data || detailPayload?.Data || null;
          }
        }
        if (!detail) {
          if (homeworks[i]) homeworks[i].loadingMeta = false;
          rebuildJlgjRender();
          continue;
        }

        const homework = detail?.Homework || {};
        const threadData = detail?.Thread || {};
        
        const body = Array.isArray(threadData?.ThreadBody) ? threadData.ThreadBody : [];
        const content = body
          .map((item) => String(item?.Text?.Content || '').trim())
          .filter(Boolean)
          .join('\n');
          
        const teacherName = String(t?.Author || '').trim();
        if (teacherName) teacherSet.add(teacherName);
        const isAttend = t?.IsAttend;
        const done = isAttend === true || isAttend === 1 || isAttend === '1' || String(isAttend || '').toLowerCase() === 'true';

        homeworks[i] = {
          threadId,
          title: String(t?.Subject || t?.GroupName || '接龙作业').trim(),
          end: homework?.EndTime || '',
          content,
          done,
          link: `https://i.jielong.com/h/${threadId}`,
          loadingMeta: false
        };
        courseGroup.teacherName = Array.from(teacherSet).join(' / ');
        rebuildJlgjRender();
      }

      courseGroup.loadingMeta = false;
      rebuildJlgjRender();
    }
  } finally {
    if (bgTab?.id) {
      try { await chrome.tabs.remove(bgTab.id); } catch { /* ignore */ }
    }
  }
}


async function loadCourses() {
  const courseLoadVersion = bumpPlatformLoadVersion('ve');
  window.courseListLoadVersion = courseLoadVersion;
  window.homeworkNoteAttachmentCacheByKey = {};
  window.homeworkAttachmentItemsById = {};
  window.homeworkAttachmentItemsByCourseId = {};

  if (courseLoadingStatus) courseLoadingStatus.style.display = 'none';
  setPlatformLoginState('ve', isPlatformEnabled('ve') ? 'checking' : 'checking');
  try {
    if (!isPlatformEnabled('ve')) {
      window.currentVeCourseList = [];
      window.platformLoadedOnce.ve = false;
      if (courseLoadVersion !== window.courseListLoadVersion) return;
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    const url = `${BASE_VE}back/coursePlatform/course.shtml?method=getCourseList&pagesize=100&page=1&xqCode=${encodeURIComponent(XQ_CODE)}`;
    const { text } = await fetchText(url, {
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });

    let data;
    try { data = JSON.parse(text); } catch {
      // probably redirected / html
      isLoginSessionValid = false;
      setPlatformLoginState('ve', 'offline');
      if (usernameInput.value.trim()) {
        promptLoginIfPossible('请输入验证码重新登录');
      }
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    if (String(data.STATUS) !== '0') {
      const msg = data.ERRMSG || data.message || '课程接口返回异常';
      if (String(msg).includes('不合法') || String(msg).includes('登录')) {
        isLoginSessionValid = false;
        setPlatformLoginState('ve', 'offline');
        if (usernameInput.value.trim()) {
          promptLoginIfPossible('请输入验证码重新登录');
        }
        renderCourseList([]);
        rematchExternalByVeCourses();
        rerenderAllHomeworkAreas();
        if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
        if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
        if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
        return;
      }
      setPlatformLoginState('ve', 'offline');
      showToast('课程加载失败: ' + msg, 'error');
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    const list = data.courseList || [];
    window.currentVeCourseList = Array.isArray(list) ? list : [];
    window.platformLoadedOnce.ve = true;
    setPlatformLoginState('ve', 'online');
    if (courseLoadVersion !== window.courseListLoadVersion) return;
    rematchExternalByVeCourses();
    renderCourseList(list);
    rerenderAllHomeworkAreas();
    if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
    if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
    if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
  } catch (e) {
    setPlatformLoginState('ve', 'offline');
    showToast('课程加载失败: ' + e.message, 'error');
    renderCourseList([]);
    rematchExternalByVeCourses();
    rerenderAllHomeworkAreas();
    if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
    if (isPlatformEnabled('mrzy')) renderMrzyStandaloneCourses();
    if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
  } finally {
    if (courseLoadVersion === window.courseListLoadVersion && courseLoadingStatus) courseLoadingStatus.style.display = 'none';
  }
}

function scheduleYktLoad(courses, loadVersion = 0) {
  if (!isPlatformEnabled('ykt')) return Promise.resolve();
  const list = Array.isArray(courses) ? courses : [];
  if (!window.__yktLoadSerialPromise) window.__yktLoadSerialPromise = Promise.resolve();
  window.__yktLoadSerialPromise = window.__yktLoadSerialPromise
    .catch(() => {})
    .then(() => loadYktCoursesAndHomework(list, loadVersion));
  return window.__yktLoadSerialPromise;
}

function scheduleMrzyLoad(courses, loadVersion = 0) {
  if (!isPlatformEnabled('mrzy')) return Promise.resolve();
  const list = Array.isArray(courses) ? courses : [];
  if (!window.__mrzyLoadSerialPromise) window.__mrzyLoadSerialPromise = Promise.resolve();
  window.__mrzyLoadSerialPromise = window.__mrzyLoadSerialPromise
    .catch(() => {})
    .then(() => loadMrzyCoursesAndHomework(list, loadVersion));
  return window.__mrzyLoadSerialPromise;
}

function scheduleJlgjLoad(courses, loadVersion = 0) {
  if (!isPlatformEnabled('jlgj')) return Promise.resolve();
  const list = Array.isArray(courses) ? courses : [];
  if (!window.__jlgjLoadSerialPromise) window.__jlgjLoadSerialPromise = Promise.resolve();
  window.__jlgjLoadSerialPromise = window.__jlgjLoadSerialPromise
    .catch(() => {})
    .then(() => loadJlgjCoursesAndHomework(list, loadVersion));
  return window.__jlgjLoadSerialPromise;
}

function renderCourseList(courses) {
  courseListDiv.innerHTML = '';
  if (!courses || !courses.length) {
    updateCourseListEmptyPlaceholder();
    return;
  }

  courses.forEach(course => {
    const card = document.createElement('div');
    card.className = 'file-item';
    card.style.backgroundColor = '#fff';
    const courseId = course.id || course.cId || course.courseId || course.course_id;
    const courseNumRaw = course.course_num || course.courseNum || course.courseNo || course.course_id || courseId;
    const courseNum = getVeCourseSeq10(course) || String(courseNumRaw || '');
    const fzId = course.fz_id || course.fzId || course.xkhId || course.xkh_id || '';
    const xqCode = course.xq_code || course.xqCode || XQ_CODE;
    const courseName = course.name || course.NAME || course.courseName || course.title || '未知课程';
    const teacherName = course.teacher_name || course.teacherName || '';
    const teacherLabel = String(teacherName || '').trim() || '教师';
    const coursePlatformUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10460&courseId=${encodeURIComponent(courseNumRaw || '')}&cId=${encodeURIComponent(courseId || '')}&xknId=${encodeURIComponent(fzId || '')}&xkhId=${encodeURIComponent(fzId || '')}&xqCode=${encodeURIComponent(xqCode || XQ_CODE)}`;

    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(courses.indexOf(course));
    card.dataset.rank = '4';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${coursePlatformUrl}" target="_blank" rel="noopener noreferrer" style="color:#1565c0; text-decoration:none;">${escapeHtml(courseName)}</a></strong></div>
          <div style="font-size:12px; color:#666; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="ve-teacher-wrap" data-course-id="${escapeHtml(String(courseId || ''))}">
              <span class="ve-teacher-name">${escapeHtml(teacherLabel)}</span>
              <span class="ve-teacher-pop">
                <div style="font-size:12px; color:#374151;">工号 <span class="ve-teacher-id" data-course-id="${escapeHtml(String(courseId || ''))}">加载中...</span></div>
                <button type="button" class="ve-switch-teacher-btn" data-action="switch-teacher-account" data-course-id="${escapeHtml(String(courseId || ''))}">切换至教师账号</button>
              </span>
            </span>
            <span>·</span>
            <span class="ve-course-num-wrap" data-course-id="${escapeHtml(String(courseId || ''))}" data-course-num="${escapeHtml(String(courseNumRaw || ''))}" data-fz-id="${escapeHtml(String(fzId || ''))}">
              <span class="ve-course-num-text">${escapeHtml(String(courseNum || ''))}</span>
              <span class="ve-course-teacher-pop" data-course-id="${escapeHtml(String(courseId || ''))}"><div style="font-size:12px; color:#64748b;">悬停加载同课教师...</div></span>
            </span>
          </div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#1e3a8a;" data-action="courseware">课件下载</button>
          <button class="btn" style="background:#9C27B0;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
    `;
    courseListDiv.appendChild(card);

    // bind actions
    const btnCourseware = card.querySelector('button[data-action="courseware"]');
    const btnVideos = card.querySelector('button[data-action="videos"]');
    if (btnCourseware) {
      btnCourseware.addEventListener('click', () => toggleCoursewareFromCache(btnCourseware, courseId, courseNumRaw, fzId));
      setCoursewareButtonLoading(btnCourseware, true);
    }
    if (btnVideos) {
      btnVideos.dataset.courseNum = String(courseNum || '');
      btnVideos.dataset.fzId = String(fzId || '');
      btnVideos.addEventListener('click', () => toggleReplayFromCache(btnVideos, courseId));
      // Show replay-loading animation immediately after card renders.
      btnVideos.disabled = true;
      btnVideos.style.opacity = '1';
      btnVideos.style.pointerEvents = 'none';
      btnVideos.classList.remove('replay-link-progress');
      btnVideos.classList.add('replay-list-loading');
      btnVideos.style.setProperty('--replay-progress', '0%');
      btnVideos.innerHTML = '回放下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#9c27b0; border-top-color:transparent;"></span>';
    }

    hydrateVeTeacherMeta(courseId, courseNumRaw, fzId).catch(() => {});

    // Prioritize homework fetching before replay link prefetch.
  updateCourseListEmptyPlaceholder();
    const hwPromise = checkHomework(courseId);
    if (btnCourseware) {
      hwPromise.finally(() => {
        autoLoadCourseware(btnCourseware, courseId, courseNumRaw, fzId).catch(() => {});
      });
    }
    if (btnVideos) {
      hwPromise.finally(() => {
        autoLoadVideoLinks(btnVideos, courseId, courseNum, fzId);
      });
    }
  });

}

window.toggleHomeworkView = function(courseId) {
  const data = window.courseHomeworkData[courseId];
  if (!data) return;
  if (!window.homeworkToggleAnimatingByCourse) window.homeworkToggleAnimatingByCourse = {};
  if (window.homeworkToggleAnimatingByCourse[courseId]) return;

  if (!data.showAll) {
    data.showAll = true;
    window.courseShowAllById[courseId] = true;
    data.justExpanded = true;
    data.justCollapsed = false;
    renderHomeworkList(courseId);
    return;
  }

  const area = document.getElementById(`homework-area-${courseId}`);
  const doneCards = area ? Array.from(area.querySelectorAll('.hw-card-item[data-homework-done="1"]')) : [];
  if (!doneCards.length) {
    data.showAll = false;
    window.courseShowAllById[courseId] = false;
    data.justCollapsed = true;
    data.justExpanded = false;
    renderHomeworkList(courseId);
    return;
  }

  window.homeworkToggleAnimatingByCourse[courseId] = true;
  doneCards.forEach((el) => el.classList.add('hw-done-leave'));
  setTimeout(() => {
    data.showAll = false;
    window.courseShowAllById[courseId] = false;
    data.justCollapsed = true;
    data.justExpanded = false;
    renderHomeworkList(courseId);
    window.homeworkToggleAnimatingByCourse[courseId] = false;
  }, 180);
};

function getHomeworkTeacherId(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return '';
  const cached = String(window.veTeacherMetaByCourseId?.[cid]?.teacherId || '').trim();
  if (cached) return cached;
  const list = Array.isArray(window.currentVeCourseList) ? window.currentVeCourseList : [];
  const found = list.find((it) => String(it?.id || it?.cId || it?.courseId || it?.course_id || '').trim() === cid) || null;
  return String(found?.teacher_id || found?.teacherId || found?.teacherid || '').trim();
}

async function ensureHomeworkTeacherId(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return '';
  let teacherId = getHomeworkTeacherId(cid);
  if (teacherId) return teacherId;

  const card = document.getElementById(`course-${cid}`);
  const wrap = card?.querySelector('.ve-course-num-wrap');
  const courseNum = String(wrap?.dataset?.courseNum || '').trim();
  const fzId = String(wrap?.dataset?.fzId || '').trim();
  if (!courseNum) return '';

  teacherId = await fetchVeTeacherIdByCourse(courseNum, fzId);
  if (teacherId) {
    window.veTeacherMetaByCourseId[cid] = { teacherId, loading: false, loaded: true };
    updateVeTeacherMetaUi(cid);
  }
  return teacherId;
}

function renderHomeworkAttachments(hw, borderColor = '#ff9800') {
  const key = String(hw?.__attachmentKey || '').trim();
  if (!key) return '';
  const cache = window.homeworkNoteAttachmentCacheByKey?.[key] || null;
  const list = Array.isArray(cache?.picList) ? cache.picList : [];
  if (!list.length) return '';

  const courseId = String(hw?.__courseId || '').trim();
  const softBg = String(borderColor || '').toLowerCase().includes('4caf50')
    ? 'rgba(232,245,233,0.72)'
    : 'rgba(255,243,224,0.72)';

  const rows = list.map((it, idx) => {
    const fileNameNoExt = String(it?.fileNameNoExt || '').trim() || `附件${idx + 1}`;
    const sizeBytes = Math.max(0, Number(it?.sizeBytes || 0) || 0);
    const sizeText = formatSize(sizeBytes);
    const sizeStyle = buildHomeworkAttachmentSizeStyle(sizeBytes);
    const url = String(it?.url || '').trim();
    if (!url) return '';
    const resourceId = `hwatt-${encodeURIComponent(key)}-${idx}`;
    const checked = window.resourceSpaceSelected.has(resourceId) ? 'checked' : '';
    const item = {
      id: resourceId,
      name: fileNameNoExt,
      extName: '',
      url,
      courseId,
      sizeMbRaw: sizeBytes / (1024 * 1024),
      sizeMb: sizeText
    };
    registerHomeworkAttachmentItem(courseId, item);
    return `
      <div class="file-item" data-resource-id="${escapeHtml(resourceId)}" style="padding:6px 8px; border:1px solid ${borderColor}; border-radius:6px; background:${softBg}; margin-top:6px;">
        <div class="resource-row-title" style="margin-bottom:4px; cursor:pointer;">
          <input type="checkbox" data-action="resource-check" data-resource-id="${escapeHtml(resourceId)}" ${checked} style="margin:0 4px 0 0;">
          <span style="color:#111827; font-weight:700;">${escapeHtml(fileNameNoExt)}</span>
          <span style="${sizeStyle}">${escapeHtml(sizeText)}</span>
        </div>
        <div class="resource-link-row">
          <a class="resource-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
          <div style="display:flex; align-items:center; gap:6px; margin-left:auto;">
            <button class="btn resource-copy-btn" data-action="resource-copy" data-resource-id="${escapeHtml(resourceId)}">复制</button>
            <button class="btn resource-download-btn" data-action="resource-download" data-resource-id="${escapeHtml(resourceId)}">下载</button>
          </div>
        </div>
        <div class="resource-download-progress" style="display:none;">
          <div class="progress-bar-container"><div class="progress-bar">0%</div></div>
          <div class="resource-download-meta">
            <span class="resource-dl-status"></span>
            <span class="resource-dl-size"></span>
            <span class="resource-dl-speed"></span>
            <span class="resource-dl-eta"></span>
          </div>
        </div>
      </div>
    `;
  }).filter(Boolean).join('');

  if (!rows) return '';
  return `<div style="margin-top:6px;">${rows}</div>`;
}

async function prefetchHomeworkAttachments(courseId, list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return;

  const teacherId = await ensureHomeworkTeacherId(courseId);
  if (!teacherId) return;
  let changed = false;

  await Promise.all(items.map(async (hw) => {
    const noteId = String(hw?.id ?? hw?.noteId ?? hw?.courseNoteId ?? '').trim();
    const noteCourseId = String(hw?.course_id ?? hw?.courseId ?? hw?.cId ?? courseId).trim();
    const noteTeacherId = String(hw?.teacher_id ?? hw?.teacherId ?? teacherId).trim();
    if (!noteId || !noteCourseId || !noteTeacherId) return;

    const key = buildHomeworkAttachmentKey(noteId, noteCourseId, noteTeacherId);
    hw.__attachmentKey = key;

    const cached = window.homeworkNoteAttachmentCacheByKey[key];
    if (cached?.loading || cached?.loaded) return;
    window.homeworkNoteAttachmentCacheByKey[key] = { loading: true, loaded: false, picList: [] };

    const detailUrl = `${BASE_VE}back/coursePlatform/homeWork.shtml?method=queryStudentCourseNote&id=${encodeURIComponent(noteId)}&courseId=${encodeURIComponent(noteCourseId)}&teacherId=${encodeURIComponent(noteTeacherId)}`;
    try {
      const { text } = await fetchText(detailUrl, {
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
      });
      let detailData = null;
      try { detailData = JSON.parse(String(text || '{}')); } catch { detailData = null; }
      const picListRaw = Array.isArray(detailData?.picList) ? detailData.picList : [];
      const picList = picListRaw.map((it) => {
        const fileNameRaw = String(it?.file_name || it?.name || '').trim();
        const fileNameNoExt = stripFileExtension(fileNameRaw) || fileNameRaw || '附件';
        const sizeBytes = Math.max(0, Number(it?.pic_size || 0) || 0);
        const url = normalizeHomeworkAttachmentUrl(it?.url || '');
        return { fileName: fileNameRaw || fileNameNoExt, fileNameNoExt, sizeBytes, url };
      }).filter((it) => !!it.url);
      window.homeworkNoteAttachmentCacheByKey[key] = { loading: false, loaded: true, picList };
      if (picList.length > 0) changed = true;
    } catch {
      window.homeworkNoteAttachmentCacheByKey[key] = { loading: false, loaded: true, picList: [] };
    }
  }));

  if (changed) renderHomeworkList(courseId);
}

async function checkHomework(courseId) {
  const area = document.getElementById(`homework-area-${courseId}`);
  if (!area) return;
  const hasMatchedExternal = ((window.yktMatchedHomeworkByCourseId?.[courseId] || []).length > 0)
    || ((window.mrzyMatchedHomeworkByCourseId?.[courseId] || []).length > 0)
    || ((window.jlgjMatchedHomeworkByCourseId?.[courseId] || []).length > 0);
  if (!hasMatchedExternal && !String(area.innerHTML || '').trim()) {
    area.innerHTML = '<div class="spinner" style="border-color:#2196F3; border-top-color:transparent; display:inline-block;"></div> 正在获取作业...';
  }
  try {
    const url = `${BASE_VE}back/coursePlatform/homeWork.shtml?method=getHomeWorkList&cId=${encodeURIComponent(courseId)}&subType=0&page=1&pagesize=10`;
    const { text } = await fetchText(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
    const data = JSON.parse(text);
    if (String(data.STATUS) !== '0') {
      window.courseHomeworkData[courseId] = { list: [], showAll: !!window.courseShowAllById[courseId] };
      renderHomeworkList(courseId);
      return;
    }
    const list = data.courseNoteList || data.list || [];
    window.courseHomeworkData[courseId] = { list, showAll: !!window.courseShowAllById[courseId] };
    renderHomeworkList(courseId);
    await prefetchHomeworkAttachments(courseId, list);
    prefetchCourseScores(courseId);
    recomputeCourseHomeworkState(courseId);
  } catch (e) {
    console.error(`[VE] fetch error for ${courseId}: ${e.message}`);
    window.courseHomeworkData[courseId] = { list: [], showAll: !!window.courseShowAllById[courseId] };
    renderHomeworkList(courseId);
  }
}

function renderHomeworkList(courseId) {
  const area = document.getElementById(`homework-area-${courseId}`);
  const fallbackShowAll = !!window.courseShowAllById[courseId];
  const data = window.courseHomeworkData[courseId] || { list: [], showAll: fallbackShowAll };
  if (window.courseHomeworkData[courseId]) {
    window.courseHomeworkData[courseId].showAll = !!window.courseHomeworkData[courseId].showAll || fallbackShowAll;
  }
  if (!area) return;
  const list = data.list || [];
  syncHomeworkAttachmentItemsIndex(courseId, []);
  let displayList = data.showAll ? list : list.filter(isNativeHomeworkPending);
  const yktItems = isPlatformEnabled('ykt') ? (window.yktMatchedHomeworkByCourseId[courseId] || []) : [];
  const yktLoading = !!window.yktHomeworkLoadingByCourse?.[courseId];
  const yktSyncing = isPlatformEnabled('ykt')
    && ((window.platformLoginState?.ykt || 'checking') === 'checking')
    && !window.platformLoadedOnce?.ykt;
  let yktDisplayItems = data.showAll ? yktItems : yktItems.filter(isYktHomeworkPending);
  const mrzyItems = isPlatformEnabled('mrzy') ? (window.mrzyMatchedHomeworkByCourseId[courseId] || []) : [];
  const mrzySyncing = isPlatformEnabled('mrzy')
    && ((window.platformLoginState?.mrzy || 'checking') === 'checking')
    && !window.platformLoadedOnce?.mrzy;
  let mrzyDisplayItems = data.showAll ? mrzyItems : mrzyItems.filter(isMrzyHomeworkPending);
  const jlgjItems = isPlatformEnabled('jlgj') ? (window.jlgjMatchedHomeworkByCourseId[courseId] || []) : [];
  const jlgjSyncing = isPlatformEnabled('jlgj')
    && ((window.platformLoginState?.jlgj || 'checking') === 'checking')
    && !window.platformLoadedOnce?.jlgj;
  let jlgjDisplayItems = data.showAll ? jlgjItems : jlgjItems.filter(isJlgjHomeworkPending);

  if (!data.showAll) {
    displayList = sortHomeworkItemsByDeadline(displayList, (hw) => hw?.end_time ?? hw?.endTime ?? '');
    yktDisplayItems = sortHomeworkItemsByDeadline(yktDisplayItems, (hw) => hw?.end ?? hw?.endTime ?? '');
    mrzyDisplayItems = sortHomeworkItemsByDeadline(mrzyDisplayItems, (hw) => hw?.end ?? hw?.endTime ?? '');
    jlgjDisplayItems = sortHomeworkItemsByDeadline(jlgjDisplayItems, (hw) => hw?.end ?? hw?.endTime ?? '');
  }
  const isYktStandalone = String(courseId).startsWith('ykt-');
  const isMrzyStandalone = String(courseId).startsWith('mrzy-');
  const isJlgjStandalone = String(courseId).startsWith('jlgj-');
  const isExternalStandalone = isYktStandalone || isMrzyStandalone || isJlgjStandalone;

  const hasSubmittedHomework = list.some(isNativeHomeworkDone)
    || yktItems.some(isYktHomeworkDone)
    || mrzyItems.some(isMrzyHomeworkDone)
    || jlgjItems.some(isJlgjHomeworkDone);

  const yktCourseLink = window.yktMatchedCourseLinkByCourseId[courseId] || '';
  const yktHeaderHtml = isYktStandalone
    ? ''
    : `<div style="font-size:12px;color:#0369a1; margin-bottom:4px;">${yktCourseLink ? `<a href="${yktCourseLink}" target="_blank" rel="noopener noreferrer" style="color:#0369a1; text-decoration:none;">雨课堂作业</a>` : '雨课堂作业'}</div>`;
  const yktWrapperStyle = isYktStandalone
    ? ''
    : 'margin-top:6px; padding-top:6px; border-top:1px dashed #b3e5fc;';
  const yktHtml = yktItems.length && yktDisplayItems.length
    ? `<div style="${yktWrapperStyle}">${yktHeaderHtml}${renderYktHomeworkItems(courseId, yktDisplayItems)}</div>`
    : '';
  const mrzyHeaderHtml = isMrzyStandalone ? '' : '<div style="font-size:12px;color:#3730a3; margin-bottom:4px;">每日交作业</div>';
  const mrzyHtml = mrzyItems.length && mrzyDisplayItems.length
    ? `<div>${mrzyHeaderHtml}${renderMrzyHomeworkItems(mrzyDisplayItems)}</div>`
    : '';
  const jlgjHeaderHtml = isJlgjStandalone ? '' : '<div style="font-size:12px;color:#0f766e; margin-bottom:4px;">接龙管家</div>';
  const jlgjHtml = jlgjItems.length && jlgjDisplayItems.length
    ? `<div>${jlgjHeaderHtml}${renderJlgjHomeworkItems(jlgjDisplayItems)}</div>`
    : '';

  const applyDoneEnterAnimation = () => {
    if (data.justExpanded) {
      const doneCards = area.querySelectorAll('.hw-card-item[data-homework-done="1"]');
      doneCards.forEach((el) => {
        el.classList.remove('hw-done-enter');
        // Reflow to ensure re-adding class triggers animation only for this render.
        void el.offsetWidth;
        el.classList.add('hw-done-enter');
        setTimeout(() => {
          el.classList.remove('hw-done-enter');
        }, 220);
      });
    }
    data.justExpanded = false;
    data.justCollapsed = false;
  };

  const applyExpandableAutoToggle = () => {
    const boxes = area.querySelectorAll('.expandable-box');
    boxes.forEach((box) => {
      if (!(box instanceof HTMLElement)) return;
      const body = box.querySelector('.expandable-body');
      if (!(body instanceof HTMLElement)) return;
      const collapsedLimit = body.style.maxHeight || 'calc(1.5em * 3 + 2px)';
      const prev = body.style.maxHeight;
      const prevOverflow = body.style.overflow;
      if (box.classList.contains('expanded')) {
        body.style.maxHeight = collapsedLimit;
        body.style.overflow = 'auto';
      }
      const canFitInCollapsed = body.scrollHeight <= body.clientHeight + 2;
      if (canFitInCollapsed) {
        box.classList.add('no-toggle');
        box.classList.remove('expanded');
        box.dataset.expanded = '0';
      } else {
        box.classList.remove('no-toggle');
      }
      body.style.maxHeight = prev;
      body.style.overflow = prevOverflow;
    });
  };

  recomputeCourseHomeworkState(courseId);

  const totalHomeworkCount = list.length + yktItems.length + mrzyItems.length + jlgjItems.length;
  const currentDisplayCount = displayList.length + yktDisplayItems.length + mrzyDisplayItems.length + jlgjDisplayItems.length;
  const hasHiddenHomework = totalHomeworkCount > currentDisplayCount;
  const toggleRowHtml = totalHomeworkCount > 0 && (data.showAll || hasHiddenHomework)
    ? `<div class="homework-toggle-row"><button class="homework-toggle-btn" data-action="toggle-homework" data-course-id="${escapeHtml(String(courseId))}">${data.showAll ? '收起' : '查看全部作业'}</button></div>`
    : '';

  if (!displayList.length) {
    if (isExternalStandalone) {
      const loadingText = isYktStandalone
        ? '正在同步雨课堂作业...'
        : (isMrzyStandalone ? '正在同步每日交作业...' : '正在同步接龙管家作业...');
      const standaloneSyncing = isYktStandalone
        ? (yktLoading || yktSyncing)
        : (isMrzyStandalone ? mrzySyncing : jlgjSyncing);
      const loadingHtml = standaloneSyncing
        ? `<div style="font-size:12px; color:#64748b; margin-top:4px;">${loadingText}</div>`
        : '';
      const hasAnyExternalHomework = totalHomeworkCount > 0;
      const allExternalSubmittedTip = (!data.showAll && hasAnyExternalHomework && currentDisplayCount === 0)
        ? '<div style="color:#4CAF50; margin-top:2px;">✓ 全部作业已提交</div>'
        : '';
      const emptyExternalTip = (!hasAnyExternalHomework && !standaloneSyncing)
        ? '<span style="color:#999;">没有作业数据</span>'
        : '';
      area.innerHTML = `${loadingHtml}${allExternalSubmittedTip}${emptyExternalTip}${yktHtml}${mrzyHtml}${jlgjHtml}${toggleRowHtml}`;
      applyExpandableAutoToggle();
      applyDoneEnterAnimation();
      refreshUploadSelectVisibility();
      return;
    }
    const native = totalHomeworkCount === 0
      ? '<span style="color:#999;">没有作业数据</span>'
      : (data.showAll ? '<span style="color:#999;">暂无任何作业</span>' : '<span style="color:#4CAF50;">✓ 全部作业已提交</span>');
    const extHtml = `${yktDisplayItems.length ? yktHtml : ''}${mrzyDisplayItems.length ? mrzyHtml : ''}${jlgjDisplayItems.length ? jlgjHtml : ''}`;
    if (extHtml) {
      area.innerHTML = `${native}${extHtml}${toggleRowHtml}`;
      applyExpandableAutoToggle();
      applyDoneEnterAnimation();
      refreshUploadSelectVisibility();
      return;
    }
    area.innerHTML = `${native}${toggleRowHtml}`;
    applyExpandableAutoToggle();
    applyDoneEnterAnimation();
    refreshUploadSelectVisibility();
    return;
  }

  const nativeHtml = displayList.map((hw, idx) => {
    const subStatus = hw.subStatus ?? hw.sub_status ?? '';
    const subTime = hw.subTime ?? hw.sub_time ?? '';
    const isDone = isNativeHomeworkDone(hw);
    const bgColor = isDone ? '#e8f5e9' : '#fff3e0';
    const borderColor = isDone ? '#4caf50' : '#ff9800';
    const titleColor = isDone ? '#2e7d32' : '#e65100';
    const detailBtnColor = isDone ? '#2E7D32' : '#E65100';
    const title = hw.title || hw.workTitle || hw.courseNoteTitle || '作业';
    const sub = hw.subStatus || (isDone ? '已提交' : '未提交');
    const time = hw.subTime || '';

    // Score fields: on this platform, `hw.score` is usually full score, NOT obtained score.
    // Obtained score is typically `hw.lastScore` (or `oldScore` from detail page).
    const scoreStatus = hw.lastScore ?? hw.last_score ?? hw.scoreStatus ?? hw.score_status ?? hw.lastScoreText ?? hw.last_score_text ?? '';
    const obtainedScore = hw.lastScore ?? hw.oldScore ?? hw.old_score ?? hw.finalScore ?? hw.final_score ?? '';
    const fullScore = hw.score ?? hw.fullScore ?? hw.maxScore ?? hw.totalScore ?? '';

    // ids for async score fetch
    // IMPORTANT: Align with upload.html: upId == hw.id, snId == hw.snId
    const upId = hw.id ?? hw.upId ?? hw.upid ?? hw.UPID ?? hw.up_id ?? '';
    const snId = hw.snId ?? hw.snid ?? hw.SNID ?? hw.noteSnId ?? hw.note_sn_id ?? '';
    const scoreViewUrl = (upId && snId)
      ? `${BASE_VE}back/course/courseWorkInfo.shtml?method=piGaiDiv&upId=${encodeURIComponent(String(upId))}&id=${encodeURIComponent(String(snId))}&uLevel=1`
      : '';
    const scoreKey = buildHomeworkScoreKey(upId, snId);
    const cachedScore = window.homeworkScoreCacheByKey[scoreKey];

    let scoreHtml = '';
    const pendingText = `${String(scoreStatus || '').trim()} ${String(obtainedScore || '').trim()}`;
    const isPendingScore = isDone && /暂未公布/.test(pendingText) && upId && snId;
    if (cachedScore !== undefined && cachedScore !== null) {
      const totalStr = fullScore ? `/${fullScore}` : '';
      scoreHtml = `<span style="font-weight:bold; color:#E91E63; margin-left:5px;">[${escapeHtml(String(cachedScore))}${escapeHtml(totalStr)}]</span>`;
    } else if (isPendingScore) {
      scoreHtml = `<span class="async-score" data-pending="1" data-upid="${String(upId)}" data-snid="${String(snId)}" data-full="${String(fullScore || '')}" style="font-weight:bold; color:#E91E63; margin-left:5px;">[正在查询...]</span>`;
    } else if (isDone) {
      const shown = String(obtainedScore || '').trim();
      if (shown) {
        const totalStr = fullScore ? `/${fullScore}` : '';
        scoreHtml = `<span style="font-weight:bold; color:#E91E63; margin-left:5px;">[${escapeHtml(shown)}${escapeHtml(totalStr)}]</span>`;
      }
    }

    const rawContent = hw.content || hw.content_clean || hw.workContent || '';
    const contentHtml = normalizeHomeworkContent(rawContent);
    hw.__courseId = String(courseId || '').trim();
    const nativeKeySeed = String(upId || snId || hw.id || hw.upId || hw.noteId || hw.courseNoteId || '').trim();
    const expandKey = `native:${nativeKeySeed || `idx-${idx}`}`;
    const expanded = isHomeworkDetailExpanded(courseId, expandKey);
    const attachmentHtml = renderHomeworkAttachments(hw, borderColor);
    const expandable = renderExpandableHtml(contentHtml, {
      emptyHtml: '<span style="color:#999;">无内容</span>',
      expandText: '点击查看作业详情',
      collapseText: '点击收起作业详情',
      hideWhenEmpty: true,
      baseBg: isDone ? 'rgba(232,245,233,0.75)' : 'rgba(255,243,224,0.78)',
      flatDisplay: true,
      courseId,
      expandKey,
      expanded
    });
    const viewBtnColor = isDone ? '#2E7D32' : '#0ea5e9';

    return `
      <div class="hw-card-item" data-homework-done="${isDone ? '1' : '0'}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
          <div>
            <div style="font-weight:bold; color:${titleColor};">${title}</div>
            <div style="font-size:12px; color:#666;">截止: ${hw.end_time || hw.endTime || '无'} ${isDone ? '(已提交)' : ''}</div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            ${scoreHtml ? `<div style="font-size:12px;">${scoreHtml}</div>` : ''}
            <div style="display:flex; align-items:center; gap:6px;">
              ${scoreViewUrl ? `<a class="btn" href="${scoreViewUrl}" target="_blank" rel="noopener noreferrer" style="background:${viewBtnColor}; padding: 2px 8px; font-size: 12px; text-decoration:none; color:#fff;">查看</a>` : ''}
              <button class="btn" data-action="open-submit" data-course-id="${escapeHtml(String(courseId))}" data-hw-index="${idx}" style="background:${detailBtnColor}; padding: 2px 8px; font-size: 12px;">提交</button>
            </div>
          </div>
        </div>

  ${attachmentHtml}
        ${expandable ? `<div style="margin-top:6px; border-top:1px dashed ${borderColor}40; padding-top:6px;">${expandable}</div>` : ''}

        <div class="submit-panel" data-submit-panel="1" style="display:none;">
          <textarea data-submit-content="1" placeholder="请输入作业内容（可为空）"></textarea>
          <div class="hint">可勾选左侧上传成功文件一并提交；不勾选则仅提交文本内容。</div>
          <div class="actions">
            <button class="btn cancel-submit-btn" style="background:#64748b; padding:4px 10px; font-size:12px;" data-action="cancel-submit">取消</button>
            <button class="btn confirm-submit-btn" style="background:#2563eb; padding:4px 10px; font-size:12px;" data-action="confirm-submit" data-course-id="${escapeHtml(String(courseId))}" data-hw-index="${idx}">确定</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const extHtml = `${yktDisplayItems.length ? yktHtml : ''}${mrzyDisplayItems.length ? mrzyHtml : ''}${jlgjDisplayItems.length ? jlgjHtml : ''}`;
  area.innerHTML = `<div>${nativeHtml}${extHtml}</div>${toggleRowHtml}`;
  applyExpandableAutoToggle();
  applyDoneEnterAnimation();
  refreshUploadSelectVisibility();
}

async function fetchHomeworkScore(upId, snId) {
  if (!upId || !snId) return null;
  const url = `${BASE_VE}back/course/courseWorkInfo.shtml?method=piGaiDiv&upId=${encodeURIComponent(upId)}&id=${encodeURIComponent(snId)}&uLevel=1`;
  const { text, res } = await fetchText(url, {
    headers: {
      Accept: 'text/html, */*; q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE_VE}back/course/courseWorkInfo.shtml`
    }
  });

  // login invalid / redirected html (avoid false positives)
  if (isLikelyLoginPageHtml(text, res?.url) || (res && res.redirected && String(res.url || '').includes('/ve/s.shtml'))) {
    throw new Error('LOGIN_REQUIRED');
  }

  // match oldScore similarly to python implementation
  const m1 = String(text || '').match(/(?:id|name)=["']oldScore["'][^>]*value=["']([^"']*)["']/i);
  if (m1?.[1] !== undefined) return m1[1];
  const m2 = String(text || '').match(/value=["']([^"']*)["'][^>]*(?:id|name)=["']oldScore["']/i);
  if (m2?.[1] !== undefined) return m2[1];
  return null;
}

async function prefetchCourseScores(courseId) {
  if (window.homeworkScorePendingByCourse[courseId]) return;
  const nativeList = window.courseHomeworkData[courseId]?.list || [];
  const tasks = [];
  nativeList.forEach((hw) => {
    const isDone = isNativeHomeworkDone(hw);
    if (!isDone) return;
    const upId = hw.id ?? hw.upId ?? hw.upid ?? hw.UPID ?? hw.up_id ?? '';
    const snId = hw.snId ?? hw.snid ?? hw.SNID ?? hw.noteSnId ?? hw.note_sn_id ?? '';
    if (!upId || !snId) return;

    const scoreStatus = hw.lastScore ?? hw.last_score ?? hw.scoreStatus ?? hw.score_status ?? hw.lastScoreText ?? hw.last_score_text ?? '';
    const obtainedScore = hw.lastScore ?? hw.oldScore ?? hw.old_score ?? hw.finalScore ?? hw.final_score ?? '';
    const pendingText = `${String(scoreStatus || '').trim()} ${String(obtainedScore || '').trim()}`;
    if (!/暂未公布/.test(pendingText)) return;

    const key = buildHomeworkScoreKey(upId, snId);
    if (window.homeworkScoreCacheByKey[key] !== undefined) return;
    tasks.push({ key, upId, snId });
  });

  if (!tasks.length) return;

  window.homeworkScorePendingByCourse[courseId] = true;
  let hasLoginRequired = false;
  for (const t of tasks) {
    try {
      const score = await fetchHomeworkScore(t.upId, t.snId);
      if (score === null || score === undefined || score === '') {
        window.homeworkScoreCacheByKey[t.key] = '未批改';
      } else {
        window.homeworkScoreCacheByKey[t.key] = String(score);
      }
    } catch (e) {
      if (String(e && e.message) === 'LOGIN_REQUIRED') {
        hasLoginRequired = true;
        break;
      }
    }
  }
  window.homeworkScorePendingByCourse[courseId] = false;

  if (hasLoginRequired) {
    handleLoginRequired(() => prefetchCourseScores(courseId), null, VE_LOGIN_REQUIRED_HTML);
    return;
  }
  renderHomeworkList(courseId);
}

// Videos (best-effort implementation)
window.getVideoLinks = async function(btn, courseIdInt, courseNum, fzId) {
  const card = btn.closest('.file-item');
  const resultArea = card.querySelector('.result-area');
  if (!resultArea) return;

  if (isResultAreaOpen(resultArea)) {
    toggleResultAreaAnimated(resultArea, false);
    resultArea.innerHTML = '';
    btn.textContent = '回放下载';
    return;
  }

  toggleResultAreaAnimated(resultArea, true);
  resultArea.innerHTML = '<div class="spinner" style="border-color:#9C27B0; border-top-color:transparent; display:inline-block;"></div> <span style="color:#666;">正在获取大纲...</span>';
  btn.textContent = '收起';

  try {
    // Step 1: get teaching calendar list (same as original upload.html)
    const calUrl = `${BASE_VE}back/rp/common/teachCalendar.shtml?method=toDisplyTeachCourses&courseId=${encodeURIComponent(courseIdInt)}`;
    const { text: calText } = await fetchText(calUrl, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
    const data = JSON.parse(calText);

    if (String(data.STATUS) === '0') {
      const list = data.courseSchedList || [];
      if (!list.length) {
        resultArea.innerHTML = '暂无课程安排';
        return;
      }

      resultArea.innerHTML = list.map((item, index) => {
        const title = `${item.classRoom || ''} ${item.courseBetween || '未知时间'}`;
        const contentText = String(item.content || '').trim();
        const detailHtml = renderExpandableHtml(
          escapeHtml(contentText),
          { hideWhenEmpty: true, expandText: '点击查看回放详情', collapseText: '点击收起回放详情', baseBg: 'rgba(243,229,245,0.42)' }
        );
        const videoId = item.videoId;
        const linkContainerId = `video-link-${courseIdInt}-${index}`;
        return `
          <div style="margin-bottom: 10px; padding: 5px; background: #e1bee733; border-radius: 4px; border-left: 3px solid #9C27B0;">
            <div style="font-weight: bold; color: #4a148c; font-size: 15px;">${title}</div>
            <div style="margin-top: 5px;">
              ${detailHtml}
              <div id="${linkContainerId}" class="video-links" style="font-size: 12px; color: #9C27B0; margin-top: 5px; font-weight: bold; word-break: break-all;">
                ${videoId ? '<span class="spinner" style="width: 10px; height: 10px; border-width: 1px; border-color: #9C27B0; border-top-color: transparent;"></span> 获取中...' : '<span style="color: #999; font-weight: normal;">无回放</span>'}
              </div>
            </div>
          </div>
        `;
      }).join('');

      // trigger download url fetch for each video
      list.forEach((item, index) => {
        if (item.videoId) {
          const linkContainerId = `video-link-${courseIdInt}-${index}`;
          fetchVideoLinkInternal(linkContainerId, item.videoId, courseNum, fzId, item.teacherId || '');
        }
      });
      return;
    }

    if (String(data.STATUS) === '2') {
      resultArea.innerHTML = `<span style="color: #999;">${data.message || '没有当学期课表信息'}</span>`;
      return;
    }

    resultArea.innerHTML = `<span class="error">${data.message || '获取失败'}</span>`;
  } catch (e) {
    resultArea.innerHTML = `<span class="error">请求出错: ${e.message}</span>`;
  }
};

async function fetchVideoLinkInternal(containerId, videoId, courseNum, fzId, teacherId) {
  const getLinksDiv = () => document.getElementById(containerId);
  if (!getLinksDiv()) return false;

  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: String(videoId) });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480&courseId=${encodeURIComponent(courseNum)}&dataSource=1&cId=122618&xkhId=${encodeURIComponent(fzId)}&xqCode=${encodeURIComponent(XQ_CODE)}&teacherId=${encodeURIComponent(teacherId)}`;

    const { text } = await fetchText(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString()
    });

    const detailData = JSON.parse(text);

    if (detailData.flag === false || (String(detailData.STATUS) === '1' && String(detailData.ERRMSG || '').includes('不合法'))) {
      const linksDiv = getLinksDiv();
      if (!linksDiv) return false;
      linksDiv.innerHTML = '<span class="error" style="cursor:pointer; color:blue;">[登录已失效]</span>';
      const sp = linksDiv.querySelector('span');
      if (sp) sp.addEventListener('click', () => promptLoginIfPossible('登录已失效，请稍后重试或重新登录'));
      promptLoginIfPossible('登录已失效，请稍后重试或重新登录');
      return false;
    }

    // New/alt format: {flag:true, html:"<a...>"}
    const html = (detailData.html || '').trim();
    if (html && (detailData.flag === true || String(detailData.STATUS) === '0')) {
      const linksDiv = getLinksDiv();
      if (!linksDiv) return false;
      linksDiv.style.color = '#9C27B0';
      linksDiv.style.fontWeight = 'bold';
      linksDiv.innerHTML = html;

      // style anchors
      const aTags = linksDiv.querySelectorAll('a');
      aTags.forEach(a => {
        a.style.color = '#7B1FA2';
        a.style.textDecoration = 'none';
        a.style.fontWeight = 'bold';
        a.target = '_blank';
        a.style.fontSize = '14px';
        a.style.marginRight = '20px';
        a.style.float = 'none';
        a.style.display = 'inline-block';
      });
      return true;
    }

    const linksDiv = getLinksDiv();
    if (!linksDiv) return false;
    linksDiv.style.color = '#9C27B0';
    linksDiv.style.fontWeight = 'bold';
    linksDiv.innerHTML = `<span style="color:#999; font-weight: normal;">${detailData.message || detailData.ERRMSG || '无数据'}</span>`;
    return false;
  } catch (e) {
    const linksDiv = getLinksDiv();
    if (linksDiv) linksDiv.innerHTML = '<span style="color: #f44336;">Err</span>';
    return false;
  }
}

window.__fetchVideoDetail = async function(rpId, courseId, xkhId, teacherId, btnEl) {
  const container = btnEl.closest('div');
  const span = container.querySelector('.video-link');
  span.textContent = '获取中...';
  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: rpId });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480&courseId=${encodeURIComponent(courseId)}&dataSource=1&cId=122618&xkhId=${encodeURIComponent(xkhId)}&xqCode=${encodeURIComponent(XQ_CODE)}&teacherId=${encodeURIComponent(teacherId)}`;
    const { text } = await fetchText(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString()
    });

    const data = JSON.parse(text);
    if (data?.flag === false || (data?.STATUS === '1' && String(data?.ERRMSG || '').includes('不合法'))) {
      span.innerHTML = '<span class="error" style="cursor:pointer; color:blue;">[登录已失效]</span>';
      span.onclick = () => promptLoginIfPossible(VE_LOGIN_REQUIRED_HTML);
      promptLoginIfPossible('登录已失效，请稍后重试或重新登录');
      return;
    }
    const html = data?.html || '';
    if (!html) {
      span.textContent = '未返回链接';
      return;
    }
    // Best-effort: find first http(s) link
    const m = html.match(/https?:\/\/[^\s"']+/);
    if (m?.[0]) {
      span.innerHTML = `<a class="url-link" href="${m[0]}" target="_blank">${m[0]}</a>`;
    } else {
      span.textContent = '已返回 HTML（未解析出直链）';
    }
  } catch (e) {
    span.textContent = 'Err: ' + e.message;
  }
};

// -------------------- Upload --------------------
function processQueue() {
  while (activeUploads < maxParallelUploads && uploadQueue.length > 0) {
    const task = uploadQueue.shift();
    activeUploads++;
    task();
  }
}

function handleLoginRequired(retryCallback, cancelCallback, message) {
  if (retryCallback) {
    pendingLoginCallbacks.push(retryCallback);
  }
  promptLoginIfPossible(message || '请输入验证码重新登录');
  if (cancelCallback) {
    // store cancel? keep simple: ignore
  }
}

function uploadFile(file, fileId) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = `
    <div class="upload-file-head-row" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
      <div>
        <label class="upload-select-wrap">
          <input type="checkbox" class="submit-file-check" data-file-id="${fileId}">
          作为作业附件
        </label>
        <strong>${file.name}</strong>
        <span class="inline-status" style="font-size:12px; margin-left:8px; color:#6b7280;">排队中...</span>
        <span class="size-progress" style="font-size:12px; color:#666; margin-left:5px;">(${formatSize(0)} / ${formatSize(file.size)})</span>
        <span class="speed-display" style="font-size:12px; color:#666; margin-left:10px;"></span>
        <span class="eta-display" style="font-size:12px; color:#6b7280; margin-left:10px;"></span>
      </div>
      <div>
        <button class="btn retry-btn" style="padding:2px 8px; font-size:12px; background-color:#2196F3; display:none; margin-right:5px;">重试</button>
        <button class="btn cancel-btn" style="padding:2px 8px; font-size:12px; background-color:#f44336;">取消</button>
      </div>
    </div>
    <div class="progress-bar-container"><div class="progress-bar" style="width:0%">0%</div></div>
  `;
  fileList.prepend(item);

  const progressBar = item.querySelector('.progress-bar');
  const inlineStatus = item.querySelector('.inline-status');
  const cancelBtn = item.querySelector('.cancel-btn');
  const retryBtn = item.querySelector('.retry-btn');
  const speedDisplay = item.querySelector('.speed-display');
  const etaDisplay = item.querySelector('.eta-display');
  const sizeProgressDisplay = item.querySelector('.size-progress');
  const uploadSelectWrap = item.querySelector('.upload-select-wrap');

  let isRunning = false;
  let cancelRequested = false;
  let xhrRef = null;

  const showRetry = () => {
    cancelBtn.style.display = 'none';
    retryBtn.style.display = 'inline-block';
  };

  const setInlineStatus = (text = '', tone = 'normal') => {
    if (!inlineStatus) return;
    inlineStatus.textContent = String(text || '');
    if (!text) {
      inlineStatus.style.color = '#6b7280';
      return;
    }
    if (tone === 'error') {
      inlineStatus.style.color = '#c62828';
    } else if (tone === 'warning') {
      inlineStatus.style.color = '#b45309';
    } else if (tone === 'success') {
      inlineStatus.style.color = '#2e7d32';
    } else {
      inlineStatus.style.color = '#6b7280';
    }
  };

  const doCancelUiAndAccounting = (statusText = '已取消') => {
    setInlineStatus(statusText, 'warning');
    if (etaDisplay) etaDisplay.textContent = '';
    speedDisplay.textContent = '';
    progressBar.style.backgroundColor = '#999';
    showRetry();
    // remove from aggregated speed
    delete window.activeSpeeds[fileId];
    updateTotalSpeed();
    // cancelled files should not count in total progress
    if (window.filesData[fileId]) {
      delete window.filesData[fileId];
      updateTotalProgress();
    }
  };

  retryBtn.onclick = () => {
    retryBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-block';
    setInlineStatus('准备重试...', 'warning');
    if (etaDisplay) etaDisplay.textContent = '';
    cancelRequested = false;
    isRunning = false;
    xhrRef = null;
    if (!window.filesData[fileId]) {
      window.filesData[fileId] = { size: file.size, uploaded: 0 };
      updateTotalProgress();
    }
    uploadQueue.push(performUpload);
    processQueue();
  };

  // Single cancel handler that works for both queued and uploading states
  cancelBtn.onclick = () => {
    if (!isRunning) {
      const idx = uploadQueue.indexOf(performUpload);
      if (idx >= 0) uploadQueue.splice(idx, 1);
      doCancelUiAndAccounting();
      return;
    }

    cancelRequested = true;
    if (xhrRef) {
      try { xhrRef.abort(); } catch {}
    }
    // UI + accounting will be finalized in onabort/onerror/onload handlers
  };

  const performUpload = async () => {
    cancelRequested = false;
    isRunning = true;
    const manualJsessionMode = !usernameInput.value.trim();
    const jsid = (jsessionidInput.value.trim() || await getLocal('jsessionid', '')).trim();
    if (manualJsessionMode && !jsid) {
      setInlineStatus('等待登录...', 'warning');
      if (etaDisplay) etaDisplay.textContent = '';
      handleLoginRequired(performUpload, null, '登录已失效，请输入验证码重新登录');
      showRetry();
      isRunning = false;
      xhrRef = null;
      activeUploads--; processQueue();
      return;
    }

    setInlineStatus('上传中...', 'normal');
    progressBar.style.backgroundColor = '#4CAF50';

    const fd = new FormData();
    fd.append('file', file);

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef = xhr;
      const start = Date.now();
      let lastLoaded = 0;
      let lastTime = start;
      const progressSamples = [];
      const speedId = fileId;
      window.activeSpeeds[speedId] = 0;
      updateTotalSpeed();

      const uploadUrl = manualJsessionMode
        ? `${BASE}/ve/back/rp/common/rpUpload.shtml;jsessionid=${encodeURIComponent(jsid)}`
        : `${BASE}/ve/back/rp/common/rpUpload.shtml`;
      xhr.open('POST', uploadUrl, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Upgrade-Insecure-Requests', '1');

      xhr.onabort = () => {
        doCancelUiAndAccounting();
        xhrRef = null;
        resolve();
      };

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = percent + '%';
        progressBar.textContent = percent + '%';
        sizeProgressDisplay.textContent = `(${formatSize(e.loaded)} / ${formatSize(file.size)})`;

        // speed: update on every progress event so very fast uploads still show non-zero throughput.
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        const elapsed = Math.max((now - start) / 1000, 0.001);
        const db = Math.max(0, e.loaded - lastLoaded);
        let spd = 0;
        if (dt > 0.04) {
          spd = db / dt;
        } else {
          // fallback to average speed when progress callbacks are too dense or upload is near-instant
          spd = e.loaded / elapsed;
        }
        const smoothed = pushAndCalcRecentSpeed(progressSamples, e.loaded, now);
        const speedForEta = smoothed > 0 ? smoothed : spd;
        if (Number.isFinite(speedForEta) && speedForEta >= 0) {
          speedDisplay.textContent = formatSpeed(speedForEta);
          window.activeSpeeds[speedId] = speedForEta;
          const remainingBytes = Math.max(0, e.total - e.loaded);
          if (etaDisplay) {
            etaDisplay.textContent = remainingBytes > 0 && speedForEta > 0
              ? `剩余: ${formatEta(remainingBytes / speedForEta)}`
              : '剩余: 0秒';
          }
          updateTotalSpeed();
        }
        lastLoaded = e.loaded;
        lastTime = now;

        if (window.filesData[fileId]) {
          window.filesData[fileId].uploaded = e.loaded;
          updateTotalProgress();
        }
      };

      xhr.onload = async () => {
        xhrRef = null;
        speedDisplay.textContent = '';
        if (etaDisplay) etaDisplay.textContent = '';
        delete window.activeSpeeds[speedId];
        updateTotalSpeed();
        if (xhr.status !== 200) {
          setInlineStatus(`上传失败 HTTP ${xhr.status}`, 'error');
          progressBar.style.backgroundColor = '#f44336';
          showRetry();
          resolve();
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (data.visitName) {
            const convertedUrl = convertVisitNameToUrl(data.visitName);
            setInlineStatus('上传完成', 'success');

            const nameParts = splitFileName(file.name);
            window.uploadedFileMetaById[fileId] = {
              fileNameNoExt: String(data.fileNameNoExt || encodeURIComponent(nameParts.fileNameNoExt || '') || '').trim(),
              fileExtName: String(data.fileExtName || nameParts.fileExtName || '').trim(),
              fileSize: Number(data.fileSize || file.size || 0),
              visitName: String(data.visitName || '').trim(),
              pid: '',
              ftype: 'insert'
            };
            if (uploadSelectWrap instanceof HTMLElement) {
              uploadSelectWrap.style.display = 'none';
            }
            refreshUploadSelectVisibility();

            // Hide progress bar container and render link + copy button at the same position
            const pc = item.querySelector('.progress-bar-container');
            if (pc) {
              const row = document.createElement('div');
              row.className = 'upload-link-row';
              const a = document.createElement('a');
              a.href = convertedUrl;
              a.target = '_blank';
              a.textContent = convertedUrl;
              const btn = document.createElement('button');
              btn.className = 'btn';
              btn.style.padding = '5px 10px';
              btn.style.fontSize = '12px';
              btn.style.whiteSpace = 'nowrap';
              btn.textContent = '复制';
              btn.addEventListener('click', () => {
                navigator.clipboard.writeText(convertedUrl).then(() => {
                  const original = btn.textContent;
                  btn.textContent = '已复制';
                  setTimeout(() => btn.textContent = original, 1500);
                });
              });
              row.appendChild(a);
              row.appendChild(btn);
              pc.replaceWith(row);
            }

            if (window.filesData[fileId]) {
              window.filesData[fileId].uploaded = file.size;
              updateTotalProgress();
            }
            cancelBtn.style.display = 'none';
          } else {
            const msg = data.ERRMSG || '未知错误';
            setInlineStatus(`上传失败: ${msg}`, 'error');
            progressBar.style.backgroundColor = '#f44336';
            if (String(msg).includes('不合法') || String(msg).includes('登录')) {
              isLoginSessionValid = false;
              handleLoginRequired(performUpload, null, '登录已失效，请输入验证码重新登录');
            }
            showRetry();
          }
        } catch {
          const raw = String(xhr.responseText || '').trim();
          // Server sometimes returns plain text, e.g. “上传文件类型不支持,请更换文件！”
          const msg = raw ? escapeHtml(raw).slice(0, 300) : '返回非 JSON';
          setInlineStatus(`上传失败: ${msg}`, 'error');
          progressBar.style.backgroundColor = '#f44336';
          showRetry();
        }
        resolve();
      };

      xhr.onerror = () => {
        xhrRef = null;
        // If user already requested cancel, treat as cancel
        if (cancelRequested) {
          doCancelUiAndAccounting();
          resolve();
          return;
        }
        speedDisplay.textContent = '';
        if (etaDisplay) etaDisplay.textContent = '';
        delete window.activeSpeeds[speedId];
        updateTotalSpeed();
        setInlineStatus('网络请求失败', 'error');
        progressBar.style.backgroundColor = '#f44336';
        showRetry();
        resolve();
      };

      if (cancelRequested) {
        try { xhr.abort(); } catch {}
        return;
      }

      xhr.send(fd);
    });

    isRunning = false;
    xhrRef = null;
    activeUploads--; processQueue();
  };

  uploadQueue.push(performUpload);
  processQueue();
}

// -------------------- Events --------------------
document.getElementById('parallel-limit').addEventListener('change', (e) => {
  const v = parseInt(e.target.value, 10);
  if (v > 0) {
    maxParallelUploads = v;
    processQueue();
    processResourceDownloadQueue();
  }
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFiles(e);
});

fileInput.addEventListener('change', handleFiles);

fileList.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const row = t.closest('.upload-file-head-row');
  if (!(row instanceof HTMLElement)) return;
  if (t.closest('button,a,input,textarea,select,label')) return;
  const cb = row.querySelector('input.submit-file-check');
  if (!(cb instanceof HTMLInputElement)) return;
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});

function handleFiles(e) {
  const files = e.target.files || e.dataTransfer.files;
  if (!files || !files.length) return;

  if (!isLoginSessionValid) {
    const filesList = Array.from(files);
    handleLoginRequired(() => {
      filesList.forEach(f => {
        const fileId = Math.random().toString(36).slice(2);
        window.filesData[fileId] = { size: f.size, uploaded: 0 };
        uploadFile(f, fileId);
      });
      updateTotalProgress();
    });
    return;
  }

  Array.from(files).forEach(f => {
    const fileId = Math.random().toString(36).slice(2);
    window.filesData[fileId] = { size: f.size, uploaded: 0 };
    uploadFile(f, fileId);
  });
  updateTotalProgress();
}

copyAllBtn.addEventListener('click', () => {
  const items = Array.from(document.querySelectorAll('#file-list .file-item')).reverse();
  let textToCopy = '';
  items.forEach(item => {
    const linkEl = item.querySelector('.url-link');
    if (linkEl) {
      const name = item.querySelector('strong')?.textContent || '';
      const link = linkEl.href;
      textToCopy += `${name}\n${link}\n\n`;
    }
  });
  textToCopy = textToCopy.trim();
  if (!textToCopy) {
    showToast('没有可复制的链接', 'warning');
    return;
  }
  navigator.clipboard.writeText(textToCopy).then(() => {
    const original = copyAllBtn.textContent;
    copyAllBtn.textContent = '已复制全部';
    setTimeout(() => copyAllBtn.textContent = original, 1500);
  });
});

if (resourceCopySelectedBtn) {
  resourceCopySelectedBtn.addEventListener('click', () => {
    const selected = getSelectableDownloadItems().filter((it) => window.resourceSpaceSelected.has(String(it.id || '')));
    if (!selected.length) {
      showToast('请先选择文件', 'warning', 1200);
      return;
    }
    let text = '';
    if (selected.length === 1) {
      text = String(selected[0]?.url || '').trim();
    } else {
      text = selected
        .map((it) => {
          const name = String(it?.name || '未命名文件').trim();
          const link = String(it?.url || '').trim();
          if (!link) return '';
          return `${name}\n${link}`;
        })
        .filter(Boolean)
        .join('\n\n');
    }
    if (!text) {
      showToast('选中项没有可复制链接', 'warning', 1200);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制选中链接', 'success', 1200);
    });
  });
}

if (resourceDownloadSelectedBtn) {
  resourceDownloadSelectedBtn.addEventListener('click', async () => {
    const selected = getSelectableDownloadItems().filter((it) => {
      const rid = String(it.id || '').trim();
      return window.resourceSpaceSelected.has(rid) && !isResourceDownloadActive(rid);
    });
    if (!selected.length) {
      showToast('请先选择文件', 'warning', 1200);
      return;
    }
    if (resourceDownloadSelectedBtn instanceof HTMLButtonElement) {
      resourceDownloadSelectedBtn.disabled = true;
    }
    startResourceDownloadBatch(selected);
    let successCount = 0;
    let failCount = 0;
    let cancelCount = 0;
    setResourceSpaceStatus(`已加入下载队列: ${selected.length} 个文件（并行 ${Math.max(1, Number(maxParallelUploads) || 1)}）`);

    await Promise.all(selected.map(async (item, idx) => {
      setResourceSpaceStatus(`下载队列 ${Math.min(selected.length, idx + 1)}/${selected.length}: ${String(item?.name || '未命名文件')}`);
      try {
        await enqueueResourceDownload(item);
        successCount++;
        markResourceDownloadBatchDone(item, true);
      } catch (err) {
        const msg = String(err?.message || err || '');
        if (msg.includes('下载已取消')) {
          cancelCount++;
          showToast(`已取消: ${String(item?.name || '未命名文件')}`, 'info', 1200);
        } else {
          failCount++;
          showToast(`下载失败: ${String(item?.name || '未命名文件')} (${msg})`, 'error', 2200);
        }
        markResourceDownloadBatchDone(item, false);
      }
    }));

    resetResourceDownloadBatch();
    updateResourceDownloadTotals();
    if (resourceDownloadSelectedBtn instanceof HTMLButtonElement) {
      resourceDownloadSelectedBtn.disabled = false;
    }
    if (successCount === selected.length) {
      setResourceSpaceStatus(`共 ${selected.length} 个文件，已完成批量下载`, 'success');
      showToast(`已完成 ${successCount} 个文件下载`, 'success', 1500);
    } else {
      const summary = `下载完成 ${successCount}/${selected.length}，失败 ${failCount}，取消 ${cancelCount}`;
      setResourceSpaceStatus(summary, 'warning');
      showToast(summary, 'warning', 2000);
    }
  });
}

captchaImg.addEventListener('click', () => {
  if (isLoginInProgress) return;
  refreshCaptcha();
});
captchaImg.addEventListener('load', async () => {
  try {
    const enabled = await getAutoOcrCaptchaEnabled();
    if (!enabled) return;
    // only when modal is visible
    if (!loginModal || loginModal.style.display === 'none') return;
    if (!captchaImg.naturalWidth) return;

    const nonce = captchaImg.dataset.nonce || '';

    const { text, confidence } = await ocrCaptchaWithTesseract(captchaImg);
    // captcha might have been refreshed while OCR was running
    if ((captchaImg.dataset.nonce || '') !== nonce) return;
    if (!text) {
      markCaptchaHistoryResult(nonce, '', confidence);
      setLoginProgress('验证码识别失败，正在刷新…', 'warning');
      if (!isLoginInProgress) {
        autoOcrAutoSubmitUsed = false;
        await refreshCaptcha();
      }
      return;
    }

    lastAutoOcrCaptchaText = text;
    markCaptchaHistoryResult(nonce, text, confidence);

    captchaInput.value = text;
    captchaInput.style.backgroundColor = '#e8f5e9';
    setTimeout(() => captchaInput.style.backgroundColor = '', 400);
    setLoginProgress(`识别验证码: ${text}`);
    showToast(`验证码识别: ${text}（置信度 ${(confidence * 100).toFixed(0)}%）`, 'info', 1200);

    // Auto-submit: allow retry when captcha is wrong (bounded by MAX_AUTO_SUBMITS_PER_MODAL).
    const canAutoSubmit = !isLoginInProgress && !autoOcrAutoSubmitUsed && autoOcrAttemptCount < MAX_AUTO_SUBMITS_PER_MODAL;
    if (canAutoSubmit) {
      autoOcrAutoSubmitUsed = true;
      autoOcrAttemptCount++;
      setTimeout(() => {
        if (captchaInput.value.trim() === text) doLoginFlow();
      }, 120);
    }
  } catch {
    // ignore
  }
});
captchaInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  if (e.target.value.length === 4) {
    doLoginFlow();
  }
});
if (loginBtn) loginBtn.addEventListener('click', doLoginFlow);
captchaInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doLoginFlow();
});
cancelBtn.addEventListener('click', () => {
  loginModal.style.display = 'none';

  if (isLoginInProgress) {
    loginCancelRequested = true;
  }

  // Only on explicit cancel: revert pending username change
  if (pendingUsernameChange) {
    const backTo = pendingUsernameChange.from || '';
    pendingUsernameChange = null;
    usernameInput.value = backTo;
    lastValidUsername = backTo;
    setLocal('username', backTo);
    (async () => {
      try {
        setWelcomeMessage(backTo ? await fetchUserInfoRemote(backTo) : null);
      } catch {
        setWelcomeMessage(null);
      }
    })();
    showToast('登录未成功，已回退原账号', 'warning');
  }
});

// Delegated handlers (extension CSP blocks inline onclick)
courseListDiv.addEventListener('mouseover', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const wrap = t.closest('.ve-course-num-wrap');
  if (!(wrap instanceof HTMLElement)) return;
  const from = e.relatedTarget;
  if (from instanceof Node && wrap.contains(from)) return;
  const courseId = String(wrap.dataset.courseId || '').trim();
  const courseNum = String(wrap.dataset.courseNum || '').trim();
  const fzId = String(wrap.dataset.fzId || '').trim();
  if (!courseId || !courseNum) return;
  hydrateVeCourseTeachersMeta(courseId, courseNum, fzId).catch(() => {});
});

courseListDiv.addEventListener('click', async (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const actionEl = t.closest('[data-action]');
  if (!(actionEl instanceof HTMLElement)) return;
  const action = String(actionEl.dataset.action || '').trim();

  if (action === 'toggle-expand') {
    const box = actionEl.closest('.expandable-box');
    if (!box) return;
    const openText = actionEl.dataset.openText || '点击展开详情';
    const closeText = actionEl.dataset.closeText || '点击收起';
    const body = box.querySelector('.expandable-body');
    const isExpanded = box.classList.contains('expanded');

    if (body instanceof HTMLElement) {
      if (!isExpanded) {
        const from = body.getBoundingClientRect().height;
        body.style.overflow = 'hidden';
        body.style.maxHeight = `${Math.max(0, from)}px`;
        box.classList.add('expanded');
        const to = Math.max(from + 1, body.scrollHeight);
        requestAnimationFrame(() => {
          body.style.maxHeight = `${to}px`;
        });
        setTimeout(() => {
          // Clear inline limits so expanded CSS state fully controls overflow behavior.
          body.style.maxHeight = '';
          body.style.overflow = '';
          body.style.overflowX = '';
          body.style.overflowY = '';
        }, 220);
      } else {
        const collapsed = body.getBoundingClientRect().height;
        body.style.overflow = 'hidden';
        body.style.maxHeight = `${Math.max(0, collapsed)}px`;
        box.classList.remove('expanded');
        requestAnimationFrame(() => {
          body.style.maxHeight = 'calc(1.5em * 3 + 2px)';
        });
        setTimeout(() => {
          body.style.maxHeight = '';
          body.style.overflowX = '';
          body.style.overflowY = '';
          body.style.overflow = '';
        }, 220);
      }
    } else {
      box.classList.toggle('expanded');
    }

    const expandedNow = box.classList.contains('expanded');
    actionEl.textContent = expandedNow ? closeText : openText;
    box.dataset.expanded = expandedNow ? '1' : '0';
    const courseId = String(box.dataset.courseId || '').trim();
    const expandKey = String(box.dataset.expandKey || '').trim();
    setHomeworkDetailExpanded(courseId, expandKey, expandedNow);
    return;
  }

  if (action === 'toggle-homework') {
    const courseId = String(actionEl.dataset.courseId || '').trim();
    if (!courseId) return;
    window.toggleHomeworkView(courseId);
    return;
  }

  if (action === 'switch-teacher-account') {
    const courseId = String(actionEl.dataset.courseId || '').trim();
    const teacherId = String(actionEl.dataset.teacherId || window.veTeacherMetaByCourseId?.[courseId]?.teacherId || '').trim();
    await switchToTeacherAccount(teacherId);
    return;
  }

  if (action === 'open-submit') {
    courseListDiv.querySelectorAll('.submit-panel[data-submit-panel="1"]').forEach((p) => {
      if (p instanceof HTMLElement) p.style.display = 'none';
    });
    const block = actionEl.closest('.hw-card-item');
    if (!block) return;
    const panel = block.querySelector('.submit-panel[data-submit-panel="1"]');
    if (!panel) return;
    panel.style.display = 'block';
    refreshUploadSelectVisibility();
    const textarea = panel.querySelector('textarea[data-submit-content="1"]');
    if (textarea instanceof HTMLTextAreaElement) textarea.focus();
    return;
  }

  if (action === 'cancel-submit') {
    const panel = actionEl.closest('.submit-panel[data-submit-panel="1"]');
    if (!panel) return;
    panel.style.display = 'none';
    refreshUploadSelectVisibility();
    return;
  }

  if (action === 'confirm-submit') {
    const courseId = String(actionEl.dataset.courseId || '').trim();
    const idx = Number(actionEl.dataset.hwIndex || -1);
    if (!courseId || idx < 0) return;

    const data = window.courseHomeworkData[courseId] || { list: [], showAll: false };
    const nativeList = data.showAll ? (data.list || []) : (data.list || []).filter(isNativeHomeworkPending);
    const hw = nativeList[idx];
    if (!hw) {
      showToast('未找到作业数据，请刷新后重试', 'warning', 1800);
      return;
    }

    const panel = t.closest('.submit-panel[data-submit-panel="1"]');
    if (!panel) return;
    const textarea = panel.querySelector('textarea[data-submit-content="1"]');
    const content = textarea instanceof HTMLTextAreaElement ? textarea.value : '';
    const fileList = getSelectedUploadedFileList();

    const btn = actionEl;
    const oldText = btn.textContent;
    btn.textContent = '提交中...';
    btn.setAttribute('disabled', 'disabled');
    try {
      const res = await submitNativeHomework(courseId, hw, content, fileList);
      if (res.loginRequired) {
        handleLoginRequired(() => {
          btn.removeAttribute('disabled');
          btn.textContent = oldText || '确定';
        }, null, VE_LOGIN_REQUIRED_HTML);
        return;
      }
      if (!res.ok) {
        showToast(res.message || '提交失败', 'error', 2500);
        refreshUploadSelectVisibility();
        return;
      }

      hw.subStatus = '已提交';
      hw.subTime = formatMrzyDateTime(new Date());
      showToast('作业提交成功', 'success', 1600);
      renderHomeworkList(courseId);
      recomputeCourseHomeworkState(courseId);
      await checkHomework(courseId);
      refreshUploadSelectVisibility();
    } catch (err) {
      showToast(`提交失败: ${String(err?.message || err)}`, 'error', 2500);
    } finally {
      btn.removeAttribute('disabled');
      btn.textContent = oldText || '确定';
      refreshUploadSelectVisibility();
    }
  }
});

if (resourceSpaceList) {
  resourceSpaceList.addEventListener('click', async (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const titleRow = t.closest('.resource-row-title');
    if (titleRow instanceof HTMLElement && !t.closest('a,button,input,textarea,select,label')) {
      const cb = titleRow.querySelector('input[data-action="resource-check"][data-resource-id]');
      if (cb instanceof HTMLInputElement) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    const action = String(t.dataset.action || '').trim();
    const id = String(t.dataset.resourceId || '').trim();
    if (!action || !id) return;
    const item = findSelectableDownloadItemById(id);
    if (!item) return;

    if (action === 'resource-check' && t instanceof HTMLInputElement) {
      if (t.checked) window.resourceSpaceSelected.add(id);
      else window.resourceSpaceSelected.delete(id);
      return;
    }

    if (action === 'resource-copy') {
      navigator.clipboard.writeText(String(item.url || '')).then(() => {
        showToast('链接已复制', 'success', 1200);
      });
      return;
    }

    if (action === 'resource-cancel-download') {
      const cancelled = cancelResourceDownload(id);
      if (cancelled) {
        showToast('已取消下载', 'info', 1000);
      }
      return;
    }

    if (action === 'resource-download') {
      try {
        await enqueueResourceDownload(item);
        showToast('下载完成', 'success', 1200);
      } catch (err) {
        const msg = String(err?.message || err || '');
        if (msg.includes('下载已取消')) {
          showToast('下载已取消', 'info', 1000);
        } else {
          showToast(`下载失败: ${msg}`, 'error', 1800);
        }
      }
      return;
    }
  });

  resourceSpaceList.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (String(t.dataset.action || '') !== 'resource-check') return;
    const id = String(t.dataset.resourceId || '').trim();
    if (!id) return;
    if (isResourceDownloadActive(id)) {
      t.checked = false;
      return;
    }
    if (t.checked) window.resourceSpaceSelected.add(id);
    else window.resourceSpaceSelected.delete(id);
  });
}

courseListDiv.addEventListener('click', async (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;

  const titleRow = t.closest('.resource-row-title');
  if (titleRow instanceof HTMLElement && !t.closest('a,button,input,textarea,select,label')) {
    const cb = titleRow.querySelector('input[data-action="resource-check"][data-resource-id]');
    if (cb instanceof HTMLInputElement) {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }

  const action = String(t.dataset.action || '').trim();
  if (!['resource-check', 'resource-copy', 'resource-download', 'resource-cancel-download'].includes(action)) return;
  const id = String(t.dataset.resourceId || '').trim();
  if (!id) return;
  const item = findSelectableDownloadItemById(id);
  if (!item) return;

  if (action === 'resource-check' && t instanceof HTMLInputElement) {
    if (t.checked) window.resourceSpaceSelected.add(id);
    else window.resourceSpaceSelected.delete(id);
    return;
  }

  if (action === 'resource-copy') {
    navigator.clipboard.writeText(String(item.url || '')).then(() => {
      showToast('链接已复制', 'success', 1200);
    });
    return;
  }

  if (action === 'resource-cancel-download') {
    const cancelled = cancelResourceDownload(id);
    if (cancelled) showToast('已取消下载', 'info', 1000);
    return;
  }

  if (action === 'resource-download') {
    try {
      await enqueueResourceDownload(item);
      showToast('下载完成', 'success', 1200);
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('下载已取消')) showToast('下载已取消', 'info', 1000);
      else showToast(`下载失败: ${msg}`, 'error', 1800);
    }
  }
});

courseListDiv.addEventListener('change', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (String(t.dataset.action || '') !== 'resource-check') return;
  const id = String(t.dataset.resourceId || '').trim();
  if (!id) return;
  if (isResourceDownloadActive(id)) {
    t.checked = false;
    return;
  }
  if (t.checked) window.resourceSpaceSelected.add(id);
  else window.resourceSpaceSelected.delete(id);
});

courseListDiv.addEventListener('wheel', (e) => {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const body = target.closest('.expandable-body');
  if (!(body instanceof HTMLElement)) return;
  const box = body.closest('.expandable-box');
  if (!(box instanceof HTMLElement)) return;
  if (box.classList.contains('expanded')) return;

  // Keep horizontal wheel/trackpad gestures untouched.
  if (e.shiftKey) return;
  const deltaX = Number(e.deltaX || 0);
  const deltaY = Number(e.deltaY || 0);
  if (!deltaY || Math.abs(deltaX) > Math.abs(deltaY)) return;

  const maxScroll = body.scrollHeight - body.clientHeight;
  if (maxScroll <= 0) return;

  const atTop = body.scrollTop <= 0;
  const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
  if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
    // Let page scroll continue naturally when inner area reaches the edge.
    return;
  }

  e.preventDefault();
  const step = Math.max(8, Math.min(18, Math.abs(deltaY) * 0.18));
  body.scrollTop += deltaY > 0 ? step : -step;
}, { passive: false });

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.dataset.action !== 'toggle-platform') return;
  e.preventDefault();
  e.stopPropagation();
  const platform = String(t.dataset.platform || '').trim();
  togglePlatformSelection(platform);
});

usernameInput.addEventListener('change', async () => {
  const u = usernameInput.value.trim();
  const isFirstLogin = !lastValidUsername;
  updateJsessionidState();
  if (!u) {
    // treat as cleared
    await setLocal('username', '');
    setWelcomeMessage(null);
    lastValidUsername = '';
    pendingUsernameChange = null;
    // keep jsessionid for manual mode; do not force modal
    isLoginSessionValid = false;
    showToast('账号已清空：可直接填写 JSESSIONID', 'info', 2500);
    await loadResourceSpaceForCurrentAccount();
    return;
  }

  // Validate userId first; if invalid -> revert to last valid
  const result = await validateUserIdRemote(u);
  if (!result.ok) {
    // Only STATUS=4 means the account does not exist. Other failures may be due to session/network.
    if (result.status === '4') {
      showToast('该账号不存在，已恢复原账号', 'error');
      usernameInput.value = lastValidUsername;
      setWelcomeMessage(lastValidUsername ? await fetchUserInfoRemote(lastValidUsername) : null);
      return;
    }
    showToast('无法验证账号有效性，将继续尝试登录', 'warning');
    pendingUsernameChange = isFirstLogin ? null : { from: lastValidUsername, to: u };
    setWelcomeMessage(null);
  } else {
    // valid
    pendingUsernameChange = isFirstLogin ? null : { from: lastValidUsername, to: u };
    setWelcomeMessage(result.info);
  }

  try {
    const detected = await detectUserIdFromPersonalCenter();
    if (detected === u) {
      isLoginSessionValid = true;
      lastValidUsername = u;
      await setLocal('username', u);
      pendingUsernameChange = null;
      await syncJsessionidToUi();
      showToast('该账号登录处于有效状态', 'success');
      if (isPlatformEnabled('ve')) loadCourses();
      await loadResourceSpaceForCurrentAccount();
    } else if (detected) {
      // Existing valid login session: switch account inside extension flow only.
      pendingUsernameChange = { from: detected, to: u };
      isLoginSessionValid = true;
      await routeLoginBySessionValidityForSwitch(u, '已检测到有效登录状态：将在扩展页内切换账号');
    } else {
      if (isFirstLogin) {
        isLoginSessionValid = false;
        await openPortalLoginForInvalidSession();
      } else {
        isLoginSessionValid = false;
        await openPortalLoginForInvalidSession();
      }
    }
  } catch (err) {
    isLoginSessionValid = false;
    await openPortalLoginForInvalidSession();
  }
});

  jsessionidInput.addEventListener('change', async () => {
    if (jsessionidInput.readOnly) return;
    const v = jsessionidInput.value.trim();
    if (!v) return;
    await setLocal('jsessionid', v);
    await reconcileJsessionidCookies(v);
    isLoginSessionValid = true;
    showToast('已保存 JSESSIONID，正在验证...', 'info', 1500);
    if (isPlatformEnabled('ve')) loadCourses();
    await loadResourceSpaceForCurrentAccount();
  });

// -------------------- Init --------------------
(async function init() {
  setupRightColumnResizer();
  await loadPlatformEnabledFromStorage();
  // Run update check in background to avoid blocking other startup requests.
  loadVersionInfo().catch(() => {});
  refreshPlatformLoginTip();

  // 不默认使用本地保存账号。
  lastValidUsername = (await getLocal('username', '')).trim();
  let welcomeInfoUserId = '';
  let welcomeInfo = null;
  usernameInput.value = lastValidUsername;
  if (lastValidUsername) {
    try {
      welcomeInfo = await fetchUserInfoRemote(lastValidUsername);
      welcomeInfoUserId = lastValidUsername;
      setWelcomeMessage(welcomeInfo);
    } catch {
      setWelcomeMessage(null);
    }
  } else {
    setWelcomeMessage(null);
  }
  updateJsessionidState();

  await syncJsessionidToUi();

  // 若当前已登录（Cookie 有效），从“个人中心”页面提取学号/工号作为账号
  try {
    const detected = await detectUserIdFromPersonalCenter();
    if (detected) {
      usernameInput.value = detected;
      lastValidUsername = detected;
      await setLocal('username', detected);
      updateJsessionidState();
      if (welcomeInfoUserId === detected && welcomeInfo) {
        setWelcomeMessage(welcomeInfo);
      } else {
        try {
          setWelcomeMessage(await fetchUserInfoRemote(detected));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  // If no session, show login modal
  const jsid = jsessionidInput.value.trim();
  if (!jsid) {
    // Username empty -> allow manual JSESSIONID; do not popup modal.
    if (usernameInput.value.trim()) showLoginModal('登录已失效，请输入验证码');
  }

  triggerInitialPlatformLoads();
  await loadResourceSpaceForCurrentAccount();
})();
