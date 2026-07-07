const FILE_BASE = 'http://123.121.147.7:8081';

const PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS = 1000;
const DEFAULT_PLATFORM_SESSION_ID = 'D571D57D255EA0BECF299C45D4C0468A';

// Platform header `sessionId` is maintained at runtime (NOT saved in settings).
let runtimePlatformSessionId = DEFAULT_PLATFORM_SESSION_ID;

// DOM
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const usernameInput = document.getElementById('username-input');
const accountHistorySelect = document.getElementById('account-history-select');
const xqSelect = document.getElementById('xq-select');
const jsessionidInput = document.getElementById('jsessionid-input');
const totalServerBar = document.getElementById('total-server-bar');
const totalSizeInfoDiv = document.getElementById('total-size-info');
const totalPercentDiv = document.getElementById('total-percent');
const totalEtaDiv = document.getElementById('total-eta');
const copyAllBtn = document.getElementById('copy-all-btn');


function cleanRpUrl(url, { keepG = false } = {}) {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);
    const id = params.get('id');
    const p = params.get('p');
    const g = keepG ? params.get('g') : null;
    const clean = new URL(u.origin + u.pathname);
    if (id) clean.searchParams.set('id', id);
    if (p) clean.searchParams.set('p', p);
    if (g) clean.searchParams.set('g', g);
    return clean.toString();
  } catch {
    return url;
  }
}

const resourceSpaceSection = document.getElementById('resource-space-section');
const resourceSpaceStatus = document.getElementById('resource-space-status');
const resourceSpaceList = document.getElementById('resource-space-list');
const resourceSearchInput = document.getElementById('resource-search-input');
const resourceSelectAllBtn = document.getElementById('resource-select-all-btn');
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
const mrjzyStatusBtn = document.getElementById('mrjzy-status-btn');
const jlgjStatusBtn = document.getElementById('jlgj-status-btn');
const moocStatusBtn = document.getElementById('mooc-status-btn');
const popupOpenFullscreenBtn = document.getElementById('popup-open-fullscreen');

// Login modal
const loginModal = document.getElementById('login-modal');
const loginBtn = document.getElementById('login-btn');
const cancelBtn = document.getElementById('cancel-btn');

function renderDirectOpenNotice() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:linear-gradient(135deg,#f8fafc 0%,#eef2ff 55%,#e0f2fe 100%);font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <div style="max-width:720px;width:100%;background:#fff;border:1px solid #dbeafe;border-radius:20px;box-shadow:0 18px 45px rgba(15,23,42,0.12);padding:32px 28px;color:#0f172a;">
        <div style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;margin-bottom:12px;">BJTU 课程助手</div>
        <h1 style="margin:0 0 14px;font-size:28px;line-height:1.25;">请到 about:extensions 页面加载已解压的扩展，而非直接打开 app.html</h1>
        <p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#334155;">这个页面是扩展的工作台，只能在浏览器扩展环境中使用。请复制并在地址栏打开 <span style="font-weight:700;color:#0f172a;">about:extensions</span>，再点击“加载已解压的扩展程序”载入本目录。</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
          <button id="copy-extensions-page-url" type="button" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border:0;border-radius:10px;background:#2563eb;color:#fff;font:inherit;font-weight:700;cursor:pointer;">复制 about:extensions</button>
          <span id="copy-extensions-page-status" style="color:#64748b;font-size:13px;">复制后粘贴到浏览器地址栏打开。</span>
        </div>
      </div>
    </div>`;

  const copyButton = document.getElementById('copy-extensions-page-url');
  const copyStatus = document.getElementById('copy-extensions-page-status');
  copyButton?.addEventListener('click', async () => {
    const value = 'about:extensions';
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(textarea);
      textarea.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      textarea.remove();
    }
    if (copyStatus) {
      copyStatus.textContent = copied
        ? '已复制，请粘贴到浏览器地址栏打开。'
        : '复制失败，请手动在地址栏输入 about:extensions';
    }
  });
}

const extensionRuntimeId = typeof chrome !== 'undefined' && chrome?.runtime ? String(chrome.runtime.id || '').trim() : '';
if (location.protocol !== 'chrome-extension:' || !extensionRuntimeId) {
  renderDirectOpenNotice();
  throw new Error('Direct app.html open is not supported outside the extension runtime.');
}

const appSearchParams = new URLSearchParams(String(location.search || ''));
const popupMode = appSearchParams.get('popup') === '1';
const forceAccountListInitialization = appSearchParams.get('accountInit') === '1';
if (popupMode) {
  document.body.classList.add('popup-mode');
}

if (usernameInput) {
  usernameInput.addEventListener('input', () => {
    const value = String(usernameInput.value || '').trim();
    const current = String(lastValidUsername || '').trim();
    if (value && value !== current) {
      beginAccountSwitchInterruption();
    } else if (!value || value === current) {
      resetAccountSwitchInterruption();
    }
    updateJsessionidState();
  });
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (typeof doLoginFlow === 'function' && !isLoginInProgress) {
        doLoginFlow();
      }
    }
  });
}

// Upload state
const uploadQueue = [];
let activeUploads = 0;
let maxParallelUploads = 3;
const PARALLEL_LIMIT_KEY = 'parallelLimit';
let pendingLoginCallbacks = [];
let isLoginSessionValid = true;
window.filesData = {}; // {fileId: {size, uploaded}}
window.courseHomeworkData = {};
window.yktMatchedHomeworkByCourseId = {}; // {courseId: YktHomework[]}
window.yktMatchedCourseLinkByCourseId = {}; // {courseId: yktCourseUrl}
window.yktStandaloneCourses = []; // YktCourse[]
window.yktCourseGroupsSnapshot = []; // [{token,name,teacher_name,classroom_id,course_name,homeworks}]
window.yktHomeworkLoadingByCourse = {}; // {courseId: boolean}
window.mrjzyMatchedHomeworkByCourseId = {}; // {courseId: MrjzyHomework[]}
window.mrjzyStandaloneCourses = []; // MrjzyCourse[]
window.mrjzyCourseGroupsSnapshot = []; // [{token,divClass,classNum,teacherName,homeworks}]
window.jlgjMatchedHomeworkByCourseId = {}; // {courseId: JlgjHomework[]}
window.jlgjStandaloneCourses = []; // JlgjCourse[]
window.jlgjCourseGroupsSnapshot = []; // [{token,name,groupId,homeworks}]
window.jlgjRequestHeaders = {}; // {authorization,xApiRequestPayload}
window.courseCardStateById = {}; // {courseId: {allHomeworkCount,pendingHomeworkCount,hasReplay}}
window.videoReplayCacheByCourseId = {}; // {courseId: {html: string, loaded: boolean}}
window.veReplayScheduleByCourseId = {}; // {courseId: {list,promise,loaded,error}}
window.coursewareCacheByCourseId = {}; // {courseId: {html: string, loaded: boolean}}
window.platformNeedLogin = { ve: false, ykt: false, mrjzy: false, jlgj: false, mooc: false };
window.platformLoginState = { ve: 'checking', ykt: 'checking', mrjzy: 'checking', jlgj: 'checking', mooc: 'checking' }; // checking|offline|online
window.platformLoginChecked = { ve: false, ykt: false, mrjzy: false, jlgj: false, mooc: false };
window.platformInteractiveLoginPending = { ykt: false, mrjzy: false, jlgj: false, mooc: false };
const DEFAULT_PLATFORM_ENABLED = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false };
const DEFAULT_PLATFORM_VISIBLE = { jlgj: true, mooc: true, mrjzy: true, ve: true, ykt: true };
window.platformEnabled = { ...DEFAULT_PLATFORM_ENABLED };
window.platformVisible = { ...DEFAULT_PLATFORM_VISIBLE };
window.platformLoadedOnce = { ve: false, ykt: false, mrjzy: false, jlgj: false, mooc: false };
window.platformLoadVersion = { ve: 0, ykt: 0, mrjzy: 0, jlgj: 0, mooc: 0 };
window.currentVeCourseList = [];
window.homeworkScoreCacheByKey = {}; // {"upId|snId": string}
window.homeworkScorePendingByCourse = {}; // {courseId: boolean}
window.homeworkScoreForcePublishStateByCourse = {}; // {courseId:{running,progress,ids:[]}}
window.homeworkNoteAttachmentCacheByKey = {}; // {"noteId|courseId|teacherId": {loading,loaded,picList}}
window.homeworkAttachmentPendingByCourse = {}; // {courseId: boolean}
window.uploadedFileMetaById = {}; // {fileId: {fileNameNoExt,fileExtName,fileSize,visitName,pid,ftype}}
window.savedUploadedFiles = []; // [{id,fileName,fileSize,visitName,url,savedAt}]
window.saveUploadedFilesEnabled = true;
window.autoLoadCourseResourcesEnabled = false;
window.autoLoadAllHomeworkDetails = false;
window.jlgjDarkModeEnabled = true;
window.homeworkDetailExpandedByCourse = {}; // {courseId: {expandKey: boolean}}
window.courseShowOverdueById = {};
window.courseShowDoneById = {};
window.yktDetailCacheByKey = {}; // {detailKey: {state,title,exam_problems,problem_results,promise}}
window.externalPlatformLoadVersion = 0;
window.courseListLoadVersion = 0;
window.veTeacherMetaByCourseId = {}; // {courseId:{teacherId,loading,loaded,teachers:[]}}
window.veCourseTeachersMetaByCourseId = {}; // {courseId:{rows,loading,loaded,error,promise}}
window.veCourseTeachersCacheByPrefix = {}; // {courseNumberWithoutSequence:{rows}}
window.resourceSpaceItems = []; // [{id,name,url,inputTime}]
window.resourceSpaceSelected = new Set();
window.coursewareItemsById = {}; // {resourceId: {id,name,url,extName,courseId}}
window.coursewareItemsByCourseId = {}; // {courseId: CoursewareItem[]}
window.archiveItemsById = {}; // {resourceId: {id,name,url,extName,courseId}}
window.archiveItemsByCourseId = {}; // {courseId: ArchiveItem[]}
window.archiveCacheByCourseId = {}; // {courseId:{loaded,loading,items,html}}
window.homeworkAttachmentItemsById = {}; // {resourceId: {id,name,url,extName,courseId,sizeMbRaw,sizeMb}}
window.homeworkAttachmentItemsByCourseId = {}; // {courseId: HomeworkAttachmentItem[]}
window.resourceSpaceLoadVersion = 0;
window.currentAccountLoginName = '';
window.isTeacherAccount = false; // teacher role detected
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
window.resourceDownloadQueueStatus = { totalFiles: 0, savedFiles: 0 };
window.resourceDownloadCompletedContribution = { loadedBytes: 0, totalBytes: 0 };
window.resourceDownloadQueueClearTimer = null;
let resourceSpaceSearchKeyword = '';





















function normalizePlatformId(platform) {
  const p = String(platform || '').trim();
  if (p === 'mrjzy') return 'mrjzy';
  return ['ve', 'ykt', 'jlgj', 'mooc'].includes(p) ? p : 've';
}

function isPlatformEnabled(platform) {
  const p = normalizePlatformId(platform);
  return window.platformEnabled?.[p] === true;
}

function sanitizePlatformEnabled(raw, fallback = DEFAULT_PLATFORM_ENABLED) {
  const src = (raw && typeof raw === 'object') ? raw : null;
  return {
    jlgj: typeof src?.jlgj === 'boolean' ? src.jlgj : !!fallback.jlgj,
    mooc: typeof src?.mooc === 'boolean' ? src.mooc : !!fallback.mooc,
    mrjzy: typeof src?.mrjzy === 'boolean' ? src.mrjzy : !!fallback.mrjzy,
    ve: typeof src?.ve === 'boolean' ? src.ve : !!fallback.ve,
    ykt: typeof src?.ykt === 'boolean' ? src.ykt : !!fallback.ykt
  };
}

function sanitizePlatformVisible(raw, fallback = DEFAULT_PLATFORM_VISIBLE) {
  const src = (raw && typeof raw === 'object') ? raw : null;
  return Object.fromEntries(Object.keys(DEFAULT_PLATFORM_VISIBLE).map((key) => [
    key,
    typeof src?.[key] === 'boolean' ? src[key] : !!fallback[key]
  ]));
}

function applyPlatformVisibility() {
  const buttons = { ve: veStatusBtn, ykt: yktStatusBtn, mrjzy: mrjzyStatusBtn, jlgj: jlgjStatusBtn, mooc: moocStatusBtn };
  Object.entries(buttons).forEach(([key, button]) => {
    if (button) button.style.display = window.platformVisible?.[key] === false ? 'none' : '';
  });
}

async function loadPlatformEnabledFromStorage() {
  try {
    const localData = await chrome.storage.local.get(['platformEnabled']);
    const saved = localData?.platformEnabled ?? null;
    window.platformEnabled = sanitizePlatformEnabled(saved, DEFAULT_PLATFORM_ENABLED);
    chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
  } catch {
    window.platformEnabled = { ...DEFAULT_PLATFORM_ENABLED };
  }
}

async function savePlatformEnabledToStorage() {
  const normalized = sanitizePlatformEnabled(window.platformEnabled);
  await chrome.storage.local.set({ platformEnabled: normalized });
  await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
  scheduleFullscreenCourseCacheSave(200);
}

function disablePlatformAfterLoginFailure(platform) {
  const p = normalizePlatformId(platform);
  if (!['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].includes(p)) return;
  if (!window.platformEnabled?.[p]) return;

  window.platformEnabled[p] = false;
  window.platformLoadedOnce[p] = false;
  window.platformNeedLogin[p] = false;
  bumpPlatformLoadVersion(p);

  savePlatformEnabledToStorage().catch(() => {});
}

const AUTO_LOAD_COURSE_RESOURCES_KEY = 'autoLoadCourseResourcesEnabled';
const AUTO_LOAD_ALL_HOMEWORK_DETAILS_KEY = 'autoLoadAllHomeworkDetails';
const JLGJ_DARK_MODE_KEY = 'jlgjDarkModeEnabled';
const AUTO_LOAD_COURSE_RESOURCES_DEFAULT_OFF_STATE_KEY = 'autoLoadCourseResourcesDefaultOffState';

async function migrateAutoLoadCourseResourcesDefaultOff() {
  try {
    const data = await chrome.storage.local.get([
      AUTO_LOAD_COURSE_RESOURCES_KEY,
      AUTO_LOAD_COURSE_RESOURCES_DEFAULT_OFF_STATE_KEY
    ]);
    const storedState = String(data[AUTO_LOAD_COURSE_RESOURCES_DEFAULT_OFF_STATE_KEY] || '').trim();
    if (storedState === 'pending' || storedState === 'done') {
      return storedState === 'pending';
    }

    const shouldNotify = data[AUTO_LOAD_COURSE_RESOURCES_KEY] === true;
    const nextState = shouldNotify ? 'pending' : 'done';
    await chrome.storage.local.set({
      [AUTO_LOAD_COURSE_RESOURCES_KEY]: false,
      [AUTO_LOAD_COURSE_RESOURCES_DEFAULT_OFF_STATE_KEY]: nextState
    });
    return shouldNotify;
  } catch {
    return false;
  }
}

function showAutoLoadCourseResourcesDisabledNotice() {
  if (document.getElementById('auto-load-resources-disabled-notice')) return;
  const modal = document.createElement('div');
  modal.id = 'auto-load-resources-disabled-notice';
  modal.className = 'version-modal-mask';
  modal.style.zIndex = '10020';
  modal.innerHTML = `
    <div class="version-modal-card" role="alertdialog" aria-modal="true" aria-labelledby="auto-load-resources-disabled-title">
      <div id="auto-load-resources-disabled-title" class="version-download-title">选项已调整</div>
      <div class="version-download-body" style="margin-top:10px;line-height:1.65;">
        已为您关闭「自动获取课件/回放列表」选项以减少请求数，您可以在<a href="#" data-action="open-extension-options" style="color:#0369a1;font-weight:700;text-decoration:underline;">扩展选项</a>中重新开启
      </div>
      <button type="button" class="btn version-notice-download-btn" data-action="acknowledge" style="margin-top:12px;" disabled>我知道了（2 秒）</button>
    </div>`;
  document.body.appendChild(modal);
  modal.style.display = 'flex';
  const optionsLink = modal.querySelector('[data-action="open-extension-options"]');
  optionsLink?.addEventListener('click', (event) => {
    event.preventDefault();
    if (typeof popupMode !== 'undefined' && popupMode) {
      window.location.href = 'options.html?popup=1';
      return;
    }
    chrome.runtime.openOptionsPage?.();
  });
  const acknowledge = modal.querySelector('[data-action="acknowledge"]');
  acknowledge?.addEventListener('click', async () => {
    await chrome.storage.local.set({ [AUTO_LOAD_COURSE_RESOURCES_DEFAULT_OFF_STATE_KEY]: 'done' }).catch(() => {});
    modal.remove();
  });
  const unlockAt = Date.now() + 2000;
  const countdownTimer = setInterval(() => {
    if (!(acknowledge instanceof HTMLButtonElement) || !acknowledge.isConnected) {
      clearInterval(countdownTimer);
      return;
    }
    const seconds = Math.ceil((unlockAt - Date.now()) / 1000);
    if (seconds > 0) {
      acknowledge.textContent = `我知道了（${seconds} 秒）`;
      return;
    }
    clearInterval(countdownTimer);
    acknowledge.textContent = '我知道了';
    acknowledge.disabled = false;
  }, 100);
}

async function loadAutoLoadCourseResourcesSetting() {
  try {
    const data = await chrome.storage.local.get([AUTO_LOAD_COURSE_RESOURCES_KEY]);
    window.autoLoadCourseResourcesEnabled = data[AUTO_LOAD_COURSE_RESOURCES_KEY] === undefined
      ? false
      : !!data[AUTO_LOAD_COURSE_RESOURCES_KEY];
  } catch {
    window.autoLoadCourseResourcesEnabled = false;
  }
}

function isAutoLoadCourseResourcesEnabled() {
  return window.autoLoadCourseResourcesEnabled === true;
}

function bumpPlatformLoadVersion(platform) {
  const p = normalizePlatformId(platform);
  const next = Number(window.platformLoadVersion?.[p] || 0) + 1;
  window.platformLoadVersion[p] = next;
  return next;
}

// -- 更新检查功能已移至 update-checker.js --
// 当 update-checker.js 未加载时（Edge 商店版本），版本按钮自动隐藏。

function clearPlatformData(platform) {
  if (platform === 'ykt') {
    window.yktMatchedHomeworkByCourseId = {};
    window.yktStandaloneCourses = [];
    window.yktMatchedCourseLinkByCourseId = {};
    window.yktCourseGroupsSnapshot = [];
    window.yktHomeworkLoadingByCourse = {};
    window.yktDetailCacheByKey = {};
    clearYktStandaloneCards();
  } else if (platform === 'mrjzy') {
    window.mrjzyMatchedHomeworkByCourseId = {};
    window.mrjzyStandaloneCourses = [];
    window.mrjzyCourseGroupsSnapshot = [];
    clearMrjzyStandaloneCards();
  } else if (platform === 'jlgj') {
    window.jlgjMatchedHomeworkByCourseId = {};
    window.jlgjStandaloneCourses = [];
    window.jlgjCourseGroupsSnapshot = [];
    clearJlgjStandaloneCards();
  } else if (platform === 'mooc') {
    window.BjtuMoocPlatform?.clear();
  }
}

// Open options button in top inline controls
const openOptionsBtn = document.getElementById('open-options-btn');
if (openOptionsBtn) {
  openOptionsBtn.addEventListener('click', () => {
    if (typeof popupMode !== 'undefined' && popupMode) {
      // Navigate inside popup iframe instead of opening a new tab.
      try { window.location.href = 'options.html?popup=1'; return; } catch {}
    }
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
      try { chrome.runtime.openOptionsPage(); return; } catch {}
    }
    // fallback
    try { chrome.tabs.create({ url: chrome.runtime.getURL('options.html') }); } catch {}
  });
}

if (popupOpenFullscreenBtn) {
  popupOpenFullscreenBtn.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_APP' }, () => {
        if (chrome.runtime.lastError) {
          try { chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); } catch {}
        }
      });
    } catch {
      try { chrome.tabs.create({ url: chrome.runtime.getURL('app.html') }); } catch {}
    }
  });
}

function triggerExternalPlatformLoad(platform, forceReload = false) {
  platform = normalizePlatformId(platform);
  if (!['ykt', 'mrjzy', 'jlgj', 'mooc'].includes(platform)) return;
  if (!isPlatformEnabled(platform)) return;
  if (!forceReload && window.platformLoadedOnce?.[platform]) return;

  if (platform === 'jlgj') {
    clearPlatformData('jlgj');
    rerenderAllHomeworkAreas();
  }

  const version = bumpPlatformLoadVersion(platform);
  const veCourses = Array.isArray(window.currentVeCourseList) ? window.currentVeCourseList : [];

  if (platform === 'ykt') {
    setPlatformLoginState('ykt', 'checking');
    scheduleYktLoad(veCourses, version).catch(() => renderYktNeedLoginMessage());
  } else if (platform === 'mrjzy') {
    setPlatformLoginState('mrjzy', 'checking');
    scheduleMrjzyLoad(veCourses, version).catch(() => renderMrjzyNeedLoginMessage());
  } else if (platform === 'jlgj') {
    setPlatformLoginState('jlgj', 'checking');
    scheduleJlgjLoad(veCourses, version).catch(() => renderJlgjNeedLoginMessage());
  } else {
    setPlatformLoginState('mooc', 'checking');
    window.BjtuMoocPlatform?.load().catch(() => {});
  }
}

async function triggerInitialPlatformLoads() {
  // Keep startup priority consistent across all enabled platforms.
  if (isPlatformEnabled('ykt')) triggerExternalPlatformLoad('ykt', false);
  if (isPlatformEnabled('mrjzy')) triggerExternalPlatformLoad('mrjzy', false);
  if (isPlatformEnabled('jlgj')) triggerExternalPlatformLoad('jlgj', false);
  let veStartupResult = null;
  if (isPlatformEnabled('ve')) {
    veStartupResult = await reloadVePlatformFromSession({ reloadCourses: true, reloadResourceSpace: true });
  } else {
    window.currentVeCourseList = [];
    renderCourseList([]);
  }
  if (isPlatformEnabled('mooc')) triggerExternalPlatformLoad('mooc', false);
  return veStartupResult;
}

async function loadPlatformDetailSettings() {
  try {
    const data = await chrome.storage.local.get([AUTO_LOAD_ALL_HOMEWORK_DETAILS_KEY, JLGJ_DARK_MODE_KEY]);
    window.autoLoadAllHomeworkDetails = data[AUTO_LOAD_ALL_HOMEWORK_DETAILS_KEY] === true;
    window.jlgjDarkModeEnabled = data[JLGJ_DARK_MODE_KEY] !== false;
  } catch {
    window.autoLoadAllHomeworkDetails = false;
    window.jlgjDarkModeEnabled = true;
  }
}

function rematchExternalByVeCourses() {
  const veCourses = Array.isArray(window.currentVeCourseList) ? window.currentVeCourseList : [];

  if (isPlatformEnabled('ykt') && Array.isArray(window.yktCourseGroupsSnapshot) && window.yktCourseGroupsSnapshot.length) {
    const yktStrictMap = collectVeFzIdTail10Map(veCourses);
    window.yktMatchedHomeworkByCourseId = {};
    window.yktMatchedCourseLinkByCourseId = {};
    window.yktStandaloneCourses = [];
    window.yktCourseGroupsSnapshot.forEach((group) => {
      const strictToken = String(group?.strictToken || group?.token || '').trim();
      const matched = strictToken ? yktStrictMap.get(strictToken) : null;
      if (matched?.courseId) {
        const cid = String(matched.courseId);
        if (!window.yktMatchedHomeworkByCourseId[cid]) window.yktMatchedHomeworkByCourseId[cid] = [];
        window.yktMatchedHomeworkByCourseId[cid].push(...(group?.homeworks || []));
        window.yktMatchedCourseLinkByCourseId[cid] = yktCourseLink(group?.classroom_id);
      } else {
        window.yktStandaloneCourses.push({
          name: group?.name || '',
          teacher_name: group?.teacher_name || '',
          classroom_id: group?.classroom_id,
          course_name: group?.course_name || group?.name || '雨课堂课程',
          homeworks: Array.isArray(group?.homeworks) ? group.homeworks : []
        });
      }
    });
  }

  if (isPlatformEnabled('mrjzy') && Array.isArray(window.mrjzyCourseGroupsSnapshot) && window.mrjzyCourseGroupsSnapshot.length) {
    const mrjzyMatchMap = collectCourseNameMatchMap(veCourses);
    window.mrjzyMatchedHomeworkByCourseId = {};
    window.mrjzyStandaloneCourses = [];
    window.mrjzyCourseGroupsSnapshot.forEach((group) => {
      const matched = mrjzyMatchMap.get(String(group?.token || ''));
      if (matched?.courseId) {
        const cid = String(matched.courseId);
        if (!window.mrjzyMatchedHomeworkByCourseId[cid]) window.mrjzyMatchedHomeworkByCourseId[cid] = [];
        window.mrjzyMatchedHomeworkByCourseId[cid].push(...(group?.homeworks || []));
      } else {
        window.mrjzyStandaloneCourses.push({
          divClass: group?.divClass || '每日交作业课程',
          classNum: group?.classNum,
          teacherName: group?.teacherName || '',
          homeworks: Array.isArray(group?.homeworks) ? group.homeworks : []
        });
      }
    });
  }

  if (isPlatformEnabled('jlgj') && Array.isArray(window.jlgjCourseGroupsSnapshot) && window.jlgjCourseGroupsSnapshot.length) {
    const jlgjMatchMap = collectCourseNameMatchMap(veCourses);
    window.jlgjMatchedHomeworkByCourseId = {};
    window.jlgjStandaloneCourses = [];
    window.jlgjCourseGroupsSnapshot.forEach((group) => {
      const matched = jlgjMatchMap.get(String(group?.token || ''));
      if (matched?.courseId) {
        const cid = String(matched.courseId);
        if (!window.jlgjMatchedHomeworkByCourseId[cid]) window.jlgjMatchedHomeworkByCourseId[cid] = [];
        window.jlgjMatchedHomeworkByCourseId[cid].push(...(group?.homeworks || []));
      } else {
        window.jlgjStandaloneCourses.push({
          name: group?.name || '接龙管家课程',
          groupId: group?.groupId,
          teacherName: group?.teacherName || '',
          homeworks: Array.isArray(group?.homeworks) ? group.homeworks : []
        });
      }
    });
  }
}

function rerenderAllHomeworkAreas() {
  Object.keys(window.courseHomeworkData || {}).forEach((cid) => {
    renderHomeworkList(cid);
  });
  syncCourseActionLoadingSpinnerPhase();
}

function isPlatformChecking(platform) {
  const p = normalizePlatformId(platform);
  return isPlatformEnabled(p) && window.platformLoginState?.[p] === 'checking';
}

function togglePlatformSelection(platform, options = {}) {
  platform = normalizePlatformId(platform);
  if (!platform || !['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].includes(platform)) return;
  const interactive = options?.interactive !== false;
  const persist = options?.persist !== false;
  if (isPlatformChecking(platform)) {
    if (platform === 'ykt') {
      window.platformInteractiveLoginPending.ykt = false;
      closeYktLoginAssistPopup(true);
    }
    if (platform === 'mrjzy') {
      window.platformInteractiveLoginPending.mrjzy = false;
      closeMrjzyLoginAssistPopup(true);
    }
    if (platform === 'jlgj') {
      window.platformInteractiveLoginPending.jlgj = false;
      closeJlgjLoginAssistPopup(true);
    }
    if (platform === 'mooc') {
      window.platformInteractiveLoginPending.mooc = false;
      closeMoocLoginAssistPopup(true);
    }
    window.platformEnabled[platform] = false;
    window.platformLoadedOnce[platform] = false;
    bumpPlatformLoadVersion(platform);
    setPlatformLoginState(platform, 'offline');
    if (persist) savePlatformEnabledToStorage().catch(() => {});
    refreshPlatformLoginTip();

    if (platform === 've') {
      window.currentVeCourseList = [];
      window.courseListLoadVersion = Number(window.courseListLoadVersion || 0) + 1;
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
    } else {
      clearPlatformData(platform);
      rerenderAllHomeworkAreas();
    }
    return;
  }

  const enabled = !isPlatformEnabled(platform);
  window.platformEnabled[platform] = enabled;
  if (persist) savePlatformEnabledToStorage().catch(() => {});
  refreshPlatformLoginTip();

  if (!enabled) {
    if (platform === 'ykt') {
      window.platformInteractiveLoginPending.ykt = false;
      closeYktLoginAssistPopup(true);
    }
    if (platform === 'mrjzy') {
      window.platformInteractiveLoginPending.mrjzy = false;
      closeMrjzyLoginAssistPopup(true);
    }
    if (platform === 'jlgj') {
      window.platformInteractiveLoginPending.jlgj = false;
      closeJlgjLoginAssistPopup(true);
    }
    if (platform === 'mooc') {
      window.platformInteractiveLoginPending.mooc = false;
      closeMoocLoginAssistPopup(true);
    }
    window.platformLoadedOnce[platform] = false;
    if (platform === 've') {
      window.currentVeCourseList = [];
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
    } else {
      clearPlatformData(platform);
      rerenderAllHomeworkAreas();
    }
    return;
  }

  if (platform === 've') {
    window.platformLoadedOnce.ve = false;
    setPlatformLoginState('ve', 'checking');
    if (isPlatformEnabled('ve')) {
      void (async () => {
        await loadAutoLoadCourseResourcesSetting();
        await reloadVePlatformFromSession({ reloadCourses: true, reloadResourceSpace: true });
      })();
    }
    return;
  }

  if (platform === 'ykt' || platform === 'mrjzy' || platform === 'jlgj') {
    window.platformInteractiveLoginPending[platform] = !!interactive;
  }

  clearPlatformData(platform);
  rerenderAllHomeworkAreas();
  triggerExternalPlatformLoad(platform, true);
}

function applyPlatformEnabledSettingFromStorage(raw) {
  const next = sanitizePlatformEnabled(raw, window.platformEnabled || DEFAULT_PLATFORM_ENABLED);
  ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].forEach((platform) => {
    if (isPlatformEnabled(platform) !== !!next[platform]) {
      togglePlatformSelection(platform, { interactive: false, persist: false });
    }
  });
}

let optionsStorageLiveSyncReady = false;
function setupOptionsStorageLiveSync() {
  if (optionsStorageLiveSyncReady || !chrome?.storage?.onChanged) return;
  optionsStorageLiveSyncReady = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.platformEnabled) {
      applyPlatformEnabledSettingFromStorage(changes.platformEnabled.newValue);
    }
    if (changes.platformVisible) {
      window.platformVisible = sanitizePlatformVisible(changes.platformVisible.newValue, window.platformVisible);
      applyPlatformVisibility();
    }

    if (changes.saveUploadedFilesEnabled) {
      window.saveUploadedFilesEnabled = changes.saveUploadedFilesEnabled.newValue === undefined
        ? true
        : !!changes.saveUploadedFilesEnabled.newValue;
      const cb = document.getElementById('save-uploads-enabled');
      if (cb instanceof HTMLInputElement) cb.checked = !!window.saveUploadedFilesEnabled;
    }

    if (changes.popupUseFullscreenCacheEnabled) {
      window.popupUseFullscreenCacheEnabled = changes.popupUseFullscreenCacheEnabled.newValue === undefined
        ? true
        : !!changes.popupUseFullscreenCacheEnabled.newValue;
      if (window.popupUseFullscreenCacheEnabled) scheduleFullscreenCourseCacheSave(200);
    }

    if (changes[AUTO_LOAD_COURSE_RESOURCES_KEY]) {
      window.autoLoadCourseResourcesEnabled = changes[AUTO_LOAD_COURSE_RESOURCES_KEY].newValue === undefined
        ? false
        : !!changes[AUTO_LOAD_COURSE_RESOURCES_KEY].newValue;
      if (window.autoLoadCourseResourcesEnabled) {
        autoLoadCourseResourcesForRenderedCourses();
      }
    }
  });
}

let portalUsernameBindMessageListenerReady = false;
function setupPortalUsernameBindMessageListener() {
  if (portalUsernameBindMessageListenerReady || !chrome?.runtime?.onMessage) return;
  portalUsernameBindMessageListenerReady = true;
  chrome.runtime.onMessage.addListener((message) => {
    void (async () => {
      if (message?.type !== 'PORTAL_USERNAME_BIND_STATUS') return;
      const st = message.payload || {};
      if (st.status !== 'done') return;
      showToast(`已绑定极速登录 username：${st.userId || st.quickUsername || ''}`, 'success', 1800);
      if (isPlatformEnabled('ve')) {
        await loadAutoLoadCourseResourcesSetting().catch(() => {});
        window.platformLoadedOnce.ve = false;
        setPlatformLoginState('ve', 'checking');
        await loadLoginAccountHistory().catch(() => {});
        await reloadVePlatformFromSession({ reloadCourses: true, reloadResourceSpace: true });
      }
    })();
  });
}

let academicSystemMessageListenerReady = false;
function setupAcademicSystemMessageListener() {
  if (academicSystemMessageListenerReady || !chrome?.runtime?.onMessage) return;
  academicSystemMessageListenerReady = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'ACADEMIC_SYSTEM_STATUS') return;
    const status = message.payload || {};
    if (status.status === 'mis-login-done') showToast(`已通过 MIS 登录教务系统：${status.studentId || ''}${status.userName ? ` ${status.userName}` : ''}`, 'success', 2400);
  });
}

function refreshUploadSelectVisibility() {
  const wraps = document.querySelectorAll('.upload-select-wrap');
  wraps.forEach((wrap) => {
    wrap.style.display = 'inline-flex';
  });
}

function setupRightColumnResizer() {
  if (!rightColumn || !rightColumnResizer) return;
  const STORAGE_KEY = 'courseHelperWidthPx';
  const BASE_MIN_W = 480;
  const DEFAULT_W = 576;

  const isAdaptiveLayout = () => window.matchMedia('(max-width: 900px), (orientation: portrait)').matches;

  const getBounds = () => {
    const vw = Math.max(0, Number(window.innerWidth || 0));
    const minW = BASE_MIN_W;
    const maxW = Math.max(minW + 20, vw - 48);
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
    let target = DEFAULT_W;
    try {
      const savedValue = localStorage.getItem(STORAGE_KEY);
      const saved = Number(savedValue);
      if (savedValue !== null && Number.isFinite(saved) && saved > 0) {
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
    rightColumnResizer.style.left = `${Math.round(rect.left)}px`;
    rightColumnResizer.style.top = `${Math.round(rect.top)}px`;
    rightColumnResizer.style.height = `${Math.max(0, Math.round(rect.height))}px`;
  };

  const scheduleResizerSync = () => {
    syncResizerGeometry();
    requestAnimationFrame(() => syncResizerGeometry());
    setTimeout(() => syncResizerGeometry(), 120);
  };
  window.syncRightColumnResizer = scheduleResizerSync;

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
let loginAbortController = null;
const LOGIN_ACCOUNT_HISTORY_KEY = 'loginAccountHistory';
const CURRENT_XQ_CODE_KEY = 'selectedXqCode';
let currentXqOptions = []; // [{xqId,xqCode,xqName,currentFlag,beginDate,endDate}]
let currentXqCode = '';
let currentXqLoadPromise = null;
let loginAccountHistory = []; // [{userId,userName,roleName,lastLoginAt}]
let isSyncingAccountHistorySelect = false;
let highPrioritySwitchTarget = '';
let accountSwitchInterruptionArmed = false;
let usernameChangeVersion = 0;
let usernameChangeAbortController = null;

function prioritizeAccountSwitch() {
  window.courseListLoadVersion = Number(window.courseListLoadVersion || 0) + 1;
  window.resourceSpaceLoadVersion = Number(window.resourceSpaceLoadVersion || 0) + 1;
  bumpPlatformLoadVersion('ve');
  // 中止所有进行中的课件和回放获取请求
  abortAllCoursewareReplayFetches();
}

// 课件/回放请求的 AbortController 集合，用于账号/学期切换时立即中止
window.activeCoursewareAbortControllers = {}; // {courseId: AbortController}
window.activeReplayAbortControllers = {}; // {courseId: AbortController}
window.globalVeAbortController = new AbortController();

function abortAllCoursewareReplayFetches() {
  // 中止全局 AbortController，所有 VE 请求共享此信号
  if (window.globalVeAbortController) {
    try { window.globalVeAbortController.abort(); } catch { /* ignore */ }
  }
  window.globalVeAbortController = new AbortController();

  const cwControllers = window.activeCoursewareAbortControllers || {};
  Object.values(cwControllers).forEach((ctrl) => {
    try { ctrl.abort(); } catch { /* ignore */ }
  });
  window.activeCoursewareAbortControllers = {};

  const rpControllers = window.activeReplayAbortControllers || {};
  Object.values(rpControllers).forEach((ctrl) => {
    try { ctrl.abort(); } catch { /* ignore */ }
  });
  window.activeReplayAbortControllers = {};

  // 重置所有缓存中正在获取的标记
  Object.values(window.videoReplayCacheByCourseId || {}).forEach((cache) => {
    if (cache) {
      cache.linksFetching = false;
      cache.linksFetched = false;
    }
  });
  Object.values(window.coursewareCacheByCourseId || {}).forEach((cache) => {
    if (cache) {
      cache.rpLinksFetching = false;
      cache.rpLinksFetched = false;
      if (!cache.loaded) cache.loaded = false;
    }
  });

  // 清理课程级别的 loading 标记
  Object.keys(window.yktHomeworkLoadingByCourse || {}).forEach((k) => {
    window.yktHomeworkLoadingByCourse[k] = false;
  });
}

function beginAccountSwitchInterruption() {
  if (accountSwitchInterruptionArmed) return false;
  accountSwitchInterruptionArmed = true;
  prioritizeAccountSwitch();
  return true;
}

function resetAccountSwitchInterruption() {
  accountSwitchInterruptionArmed = false;
}



function updateTotalSpeed() {
  let total = 0;
  Object.values(window.activeSpeeds).forEach(v => { total += v || 0; });
  if (Object.keys(window.activeSpeeds).length === 0) {
    total = 0;
  } else if (totalRecentSpeedBps > 0) {
    total = totalRecentSpeedBps;
  }
  const el = document.getElementById('total-speed');
  setSpeedDisplay(el, total);
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

function promptLoginIfPossible(message) {
  const defaultNeedLoginMsg = VE_LOGIN_REQUIRED_HTML;
  // If username is empty, do not pop modal; direct user to platform login entry.
  if (!usernameInput.value.trim()) {
    showToast(message || defaultNeedLoginMsg, 'warning', 3500, true);
    return;
  }
  doLoginFlow();
}

// -------------------- UI helpers --------------------
function dismissToastAfterCopy(toast) {
  if (!(toast instanceof HTMLElement) || !toast.isConnected || toast.dataset.dismissing === '1') return;
  toast.dataset.dismissing = '1';
  const content = String(toast.textContent || '').trim();
  if (content) navigator.clipboard.writeText(content).catch(() => {});
  toast.style.animation = 'fadeOutUp 0.25s ease-in forwards';
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  setTimeout(() => toast.remove(), 300);
}

function showToast(message, type = 'success', duration = 3000, allowHtml = false, options = {}) {
  const container = document.getElementById('toast-container');
  const preserveInfoToasts = !!options?.preserveInfoToasts;
  if (!preserveInfoToasts) {
    // clear existing info toasts
    container.querySelectorAll('.toast.info:not([data-sticky="1"])').forEach(el => el.remove());
  }

  const text = String(message || '');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.title = '点击复制通知内容并关闭';
  toast.style.whiteSpace = 'pre-line';
  if (allowHtml) {
    toast.innerHTML = text;
  } else {
    toast.textContent = text;
  }
  if (type === 'info' && (text.endsWith('...') || text.includes('...') || text.endsWith('…'))) {
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

  // Click to copy the visible message and dismiss.
  toast.addEventListener('click', () => {
    dismissToastAfterCopy(toast);
  });
}

function showBackgroundPortalLoginPendingToast() {
  const container = document.getElementById('toast-container');
  if (!(container instanceof HTMLElement)) return;

  const existed = container.querySelector('.toast[data-sticky-toast="bg-login"]');
  if (existed instanceof HTMLElement) return;

  const toast = document.createElement('div');
  toast.className = 'toast info';
  toast.dataset.sticky = '1';
  toast.dataset.stickyToast = 'bg-login';
  toast.title = '点击复制通知内容并关闭';
  toast.style.whiteSpace = 'pre-line';
  toast.textContent = '正在后台登录中…';
  const spinner = document.createElement('span');
  spinner.className = 'toast-spinner';
  toast.appendChild(spinner);
  container.appendChild(toast);

  // Click to copy and dismiss sticky toast too.
  toast.addEventListener('click', () => {
    dismissToastAfterCopy(toast);
  });
}

function hideBackgroundPortalLoginPendingToast() {
  const container = document.getElementById('toast-container');
  if (!(container instanceof HTMLElement)) return;
  container.querySelectorAll('.toast[data-sticky-toast="bg-login"]').forEach((el) => {
    if (el instanceof HTMLElement) el.remove();
  });
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function buildFileSizeEmphasisStyle(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  return buildResourceSizeEmphasisStyle(n / (1024 * 1024));
}

function setSpeedDisplay(element, bytesPerSecond, text = null) {
  if (!(element instanceof HTMLElement)) return;
  const speed = Math.max(0, Number(bytesPerSecond) || 0);
  const label = text === null ? formatSpeed(speed) : String(text);
  element.textContent = label;
  if (!label) {
    delete element.dataset.speedBytes;
    element.style.removeProperty('font-size');
    element.style.removeProperty('font-weight');
    element.style.removeProperty('color');
    element.style.removeProperty('text-shadow');
    return;
  }
  element.dataset.speedBytes = String(speed);
  const emphasis = buildFileSizeEmphasisStyle(speed);
  const fontSize = emphasis.match(/font-size:([^;]+)/)?.[1]?.trim();
  const fontWeight = emphasis.match(/font-weight:([^;]+)/)?.[1]?.trim();
  const emphasisColor = emphasis.match(/color:([^;]+)/)?.[1]?.trim();
  const emphasisShadow = emphasis.match(/text-shadow:([^;]+)/)?.[1]?.trim();
  if (fontSize) element.style.fontSize = fontSize;
  if (fontWeight) element.style.fontWeight = fontWeight;
  if (emphasisColor) element.style.color = emphasisColor;
  element.style.textShadow = emphasisShadow || 'none';
}

window.addEventListener('bjtu-theme-change', () => {
  document.querySelectorAll('[data-speed-bytes]').forEach((element) => {
    if (element instanceof HTMLElement) {
      setSpeedDisplay(element, Number(element.dataset.speedBytes || 0), element.textContent || '');
    }
    if (changes[AUTO_LOAD_ALL_HOMEWORK_DETAILS_KEY]) {
      window.autoLoadAllHomeworkDetails = changes[AUTO_LOAD_ALL_HOMEWORK_DETAILS_KEY].newValue === true;
      if (window.autoLoadAllHomeworkDetails && isPlatformEnabled('ykt')) scheduleYktLoad(window.currentVeCourseList || []);
    }
    if (changes[JLGJ_DARK_MODE_KEY]) {
      window.jlgjDarkModeEnabled = changes[JLGJ_DARK_MODE_KEY].newValue !== false;
    }
  });
  document.querySelectorAll('[data-file-size-bytes], [data-file-size-mb]').forEach((element) => {
    if (!(element instanceof HTMLElement)) return;
    const style = element.dataset.fileSizeBytes !== undefined
      ? buildFileSizeEmphasisStyle(Number(element.dataset.fileSizeBytes || 0))
      : buildResourceSizeEmphasisStyle(Number(element.dataset.fileSizeMb || 0));
    applyEmphasisStyle(element, style);
  });
});

function applyEmphasisStyle(element, styleText) {
  if (!(element instanceof HTMLElement)) return;
  ['font-size', 'font-weight', 'color', 'text-shadow'].forEach((property) => {
    const pattern = new RegExp(`${property}:([^;]+)`);
    const value = String(styleText || '').match(pattern)?.[1]?.trim();
    if (value) element.style.setProperty(property, value);
  });
}

function renderFileSizeText(bytes, text = '') {
  const n = Math.max(0, Number(bytes) || 0);
  const label = text || formatSize(n);
  return `<span class="file-size-emphasis" data-file-size-bytes="${n}" style="${escapeHtml(buildFileSizeEmphasisStyle(n))}">${escapeHtml(label)}</span>`;
}

function renderFileSizePair(loaded, total) {
  const loadedSafe = Math.max(0, Number(loaded) || 0);
  const totalSafe = Math.max(0, Number(total) || 0);
  return `${renderFileSizeText(loadedSafe)} <span class="file-size-separator">/</span> ${renderFileSizeText(totalSafe)}`;
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
  return buildFileSizeEmphasisStyle(bytes);
}

function normalizeHomeworkAttachmentUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  const normalized = text.startsWith('/') ? text : `/${text}`;
  if (normalized.startsWith('/rp/')) return `${FILE_BASE}${normalized}`;
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
      fileNameNoExt: encodeURIComponent(String(meta.fileNameNoExt || '')),
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
    fz: String(hw?.is_fz ?? '0'),
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
  const totalProgressWrap = totalServerBar?.closest?.('.progress-bar-container');

  Object.values(window.filesData).forEach(d => {
    const size = Math.max(0, Number(d?.size || 0));
    const uploaded = Math.max(0, Number(d?.uploaded || 0));
    totalSize += size;
    totalUploaded += Math.min(uploaded, size);
  });

  totalRecentSpeedBps = pushAndCalcRecentSpeed(totalProgressSamples, totalUploaded);

  totalSizeInfoDiv.innerHTML = renderFileSizePair(totalUploaded, totalSize);
  totalSizeInfoDiv.style.cssText = '';
  if (!totalSize) {
    if (totalProgressWrap instanceof HTMLElement) totalProgressWrap.style.display = 'none';
    totalServerBar.style.width = '0%';
    totalServerBar.textContent = '';
    if (totalPercentDiv) totalPercentDiv.textContent = '0%';
    if (totalPercentDiv) totalPercentDiv.style.display = 'none';
    if (totalEtaDiv) totalEtaDiv.textContent = '';
    totalRecentSpeedBps = 0;
    totalProgressSamples.length = 0;
    updateTotalSpeed();
    return;
  }

  if (totalProgressWrap instanceof HTMLElement) totalProgressWrap.style.display = '';
  if (totalPercentDiv) totalPercentDiv.style.display = '';
  const exactPercent = Math.min(100, Math.max(0, (totalUploaded / totalSize) * 100));
  const percent = Math.round(exactPercent);
  totalServerBar.style.width = exactPercent + '%';
  totalServerBar.textContent = '';
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

let currentVeUserInfoPromise = null;









async function getLocalAccountInfo(userId = '') {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const catalog = await globalThis.BjtuAccountLogin?.getAccount?.(uid) || null;
  const history = findLoginAccountRecord(uid);
  const source = catalog || history;
  if (!source) return null;
  return {
    loginName: String(source.loginName || source.userId || uid).trim(),
    userId: uid,
    userName: String(source.userName || '').trim(),
    roleName: String(source.roleName || '').trim(),
    passwordMd5: String(source.password || source.passwordMd5 || '').trim(),
    quickUsername: String(source.quickUsername || history?.quickUsername || '').trim()
  };
}

function setWelcomeMessage(info) {
  const loginMsgEl = document.getElementById('login-welcome-msg');
  const loginName = String(info?.loginName || '').trim();
  const displayName = loginName ? `${info?.roleName || ''}${info?.userName || ''}（${loginName}）` : `${info?.roleName || ''}${info?.userName || ''}`;
  const msg = info ? displayName : '';
  if (loginMsgEl) loginMsgEl.textContent = msg;
}





function normalizeLoginAccountHistoryList(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list
    .map((it) => {
      const loginName = String(it?.loginName || it?.userId || '').trim();
      if (!loginName) return null;
      const userName = String(it?.userName || '').trim();
      const roleName = String(it?.roleName || '').trim();
      const passwordMd5 = String(it?.passwordMd5 || '').trim();
      const quickUsername = String(it?.quickUsername || it?.username || '').trim();
      const lastLoginAt = Number(it?.lastLoginAt || 0);
      return {
        userId: loginName,
        userName,
        roleName,
        loginName,
        passwordMd5,
        quickUsername,
        lastLoginAt: Number.isFinite(lastLoginAt) ? lastLoginAt : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));
}

function serializeLoginAccountHistoryList(rawList) {
  return normalizeLoginAccountHistoryList(rawList)
    .map((it) => ({
      loginName: String(it?.loginName || it?.userId || '').trim(),
      lastLoginAt: Number(it?.lastLoginAt || 0) || 0
    }))
    .filter((it) => it.loginName);
}

async function readAccountInfoFromIndexedDb(loginName) {
  try {
    return await globalThis.BjtuAccountLogin?.getAccount?.(loginName) || null;
  } catch {
    return null;
  }
}

async function enrichLoginAccountHistoryList(list) {
  const normalized = normalizeLoginAccountHistoryList(list);
  return Promise.all(normalized.map(async (record) => {
    const account = await readAccountInfoFromIndexedDb(record.loginName);
    return {
      ...record,
      userName: String(account?.userName || record.userName || '').trim(),
      roleName: String(account?.roleName || record.roleName || '').trim(),
      passwordMd5: String(account?.password || record.passwordMd5 || '').trim(),
      quickUsername: String(account?.quickUsername || record.quickUsername || '').trim()
    };
  }));
}

function renderLoginAccountHistorySelect(currentUserId = '') {
  if (!(accountHistorySelect instanceof HTMLSelectElement)) return;
  const current = String(currentUserId || usernameInput?.value || '').trim();
  isSyncingAccountHistorySelect = true;
  accountHistorySelect.innerHTML = '';

  const list = normalizeLoginAccountHistoryList(loginAccountHistory);
  if (!list.length) {
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '';
    accountHistorySelect.appendChild(emptyOpt);
    accountHistorySelect.value = '';
    isSyncingAccountHistorySelect = false;
    return;
  }

  let selectedUserId = current;
  if (!list.some((it) => it.userId === selectedUserId)) {
    selectedUserId = String(list[0]?.userId || '').trim();
  }

  const selectedRecord = list.find((it) => it.userId === selectedUserId) || list[0];
  if (selectedRecord) {
    const opt = document.createElement('option');
    opt.value = selectedRecord.userId;
    opt.hidden = true;
    const selectedName = String(selectedRecord.userName || selectedRecord.userId || '未知用户').trim();
    const selectedRole = String(selectedRecord.roleName || '').trim();
    const selectedQuick = selectedRecord.quickUsername ? ' [极速]' : '';
    // 选中项只显示 userName
    opt.textContent = `${selectedRole}${selectedName}${selectedQuick}`;
    accountHistorySelect.appendChild(opt);
  }

  list
    .filter((it) => it.userId !== selectedUserId)
    .forEach((it) => {
      const opt = document.createElement('option');
      opt.value = it.userId;
      const userName = String(it.userName || it.userId || '未知用户').trim();
      const roleName = String(it.roleName || '').trim();
      const loginName = String(it.loginName || '').trim();
      const loginSuffix = loginName ? ` (${loginName})` : '';
      const quickSuffix = it.quickUsername ? ' [极速]' : '';
      // 展开列表显示 userName(loginName)
      opt.textContent = `${roleName}${userName}${loginSuffix}${quickSuffix}`;
      accountHistorySelect.appendChild(opt);
    });

  accountHistorySelect.value = selectedUserId;
  adjustAccountHistorySelectWidth();
  isSyncingAccountHistorySelect = false;
}

const ACCOUNT_HISTORY_SELECT_EXTRA_PX = 20;

function adjustAccountHistorySelectWidth() {
  if (!(accountHistorySelect instanceof HTMLSelectElement)) return;
  const selectedText = String(accountHistorySelect.selectedOptions?.[0]?.text || accountHistorySelect.value || '').trim();
  if (!selectedText) {
    accountHistorySelect.style.width = '';
    return;
  }
  const cs = getComputedStyle(accountHistorySelect);
  const canvas = adjustAccountHistorySelectWidth._canvas || (adjustAccountHistorySelectWidth._canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.font = `${cs.fontStyle || 'normal'} ${cs.fontVariant || 'normal'} ${cs.fontWeight || '400'} ${cs.fontSize || '14px'} / ${cs.lineHeight || 'normal'} ${cs.fontFamily || 'sans-serif'}`;
  const textWidth = Math.ceil(ctx.measureText(selectedText).width);
  const borderPadding = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
    .reduce((sum, key) => sum + (parseFloat(cs[key]) || 0), 0);
  accountHistorySelect.style.width = `${Math.ceil(textWidth + borderPadding + ACCOUNT_HISTORY_SELECT_EXTRA_PX)}px`;
}

function normalizeCurrentXqOptions(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list
    .map((item) => {
      const xqCode = String(item?.xqCode || item?.xq_code || item?.XQ_CODE || item?.XQCODE || '').trim();
      if (!xqCode) return null;
      const xqName = String(item?.xqName || item?.CNAME || item?.xq_name || item?.name || xqCode).trim() || xqCode;
      const beginDate = String(item?.beginDate || item?.begin_date || '').trim();
      const endDate = String(item?.endDate || item?.end_date || '').trim();
      const currentFlag = Number(item?.currentFlag || item?.current_flag || 0);
      return {
        xqId: String(item?.xqId || item?.xq_id || '').trim(),
        xqCode,
        xqName,
        currentFlag: Number.isFinite(currentFlag) ? currentFlag : 0,
        beginDate,
        endDate
      };
    })
    .filter(Boolean);
}

function chooseCurrentXqCode(list, preferredCode = '') {
  const normalizedList = Array.isArray(list) ? list : [];
  const preferred = String(preferredCode || '').trim();
  if (preferred && normalizedList.some((item) => String(item?.xqCode || '').trim() === preferred)) {
    return preferred;
  }
  const current = normalizedList.find((item) => Number(item?.currentFlag || 0) === 2);
  if (current) return String(current.xqCode || '').trim();
  return String(normalizedList[0]?.xqCode || '').trim();
}

function adjustXqSelectWidth() {
  if (!(xqSelect instanceof HTMLSelectElement)) return;
  const selectedText = String(xqSelect.selectedOptions?.[0]?.text || xqSelect.value || '').trim();
  const scaledChars = Math.max(10, Math.ceil(selectedText.length * 1.25));
  xqSelect.style.width = `calc(${scaledChars}ch + 36px)`;
}

function renderCurrentXqSelect(list = currentXqOptions, preferredCode = currentXqCode) {
  if (!(xqSelect instanceof HTMLSelectElement)) return;
  const normalizedList = Array.isArray(list) ? list : [];
  xqSelect.innerHTML = '';

  if (!normalizedList.length) {
    const empty = document.createElement('option');
    empty.value = String(preferredCode || '').trim();
    empty.textContent = empty.value ? `已保存学期（${empty.value}）` : '暂无学期';
    empty.disabled = !empty.value;
    empty.selected = true;
    xqSelect.appendChild(empty);
    xqSelect.disabled = !empty.value;
    xqSelect.title = empty.value ? `已保存学期：${empty.value}` : '未获取到学期列表';
    adjustXqSelectWidth();
    return;
  }

  normalizedList.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = String(item.xqCode || '').trim();
    opt.textContent = String(item.xqName || item.xqCode || '').trim();
    opt.title = [item.xqName, item.xqCode, item.beginDate && `开始 ${item.beginDate}`, item.endDate && `结束 ${item.endDate}`].filter(Boolean).join(' · ');
    xqSelect.appendChild(opt);
  });

  const selected = chooseCurrentXqCode(normalizedList, preferredCode);
  xqSelect.disabled = false;
  xqSelect.value = selected;
  currentXqCode = selected;
  xqSelect.title = normalizedList.find((item) => String(item.xqCode || '').trim() === selected)?.title || normalizedList.find((item) => String(item.xqCode || '').trim() === selected)?.xqName || '学期选择';
  adjustXqSelectWidth();
}

function getCurrentXqCode() {
  const selectValue = xqSelect instanceof HTMLSelectElement ? String(xqSelect.value || '').trim() : '';
  return String(currentXqCode || selectValue || '').trim();
}

async function loadCurrentXqOptions(forceReload = false) {
  if (currentXqLoadPromise && !forceReload) return currentXqLoadPromise;
  const task = (async () => {
    let savedCode = '';
    try {
      savedCode = String(await getLocal(CURRENT_XQ_CODE_KEY, '') || '').trim();
    } catch {
      savedCode = '';
    }

    try {
      currentXqOptions = normalizeCurrentXqOptions(await globalThis.BjtuVeHomeworkCore.fetchTerms());
      currentXqCode = chooseCurrentXqCode(currentXqOptions, savedCode || currentXqCode);
      renderCurrentXqSelect(currentXqOptions, currentXqCode);
      if (currentXqCode) {
        await setLocal(CURRENT_XQ_CODE_KEY, currentXqCode);
      }
      return currentXqOptions;
    } catch {
      if (currentXqOptions.length) {
        currentXqCode = chooseCurrentXqCode(currentXqOptions, savedCode || currentXqCode);
        renderCurrentXqSelect(currentXqOptions, currentXqCode);
        return currentXqOptions;
      }

      currentXqCode = String(savedCode || '').trim();
      renderCurrentXqSelect([], currentXqCode);
      return currentXqOptions;
    } finally {
      currentXqLoadPromise = null;
    }
  })();
  currentXqLoadPromise = task;
  return task;
}

async function ensureCurrentXqCode() {
  const existing = getCurrentXqCode();
  if (existing) return existing;
  await loadCurrentXqOptions();
  return getCurrentXqCode();
}

if (xqSelect instanceof HTMLSelectElement) {
  xqSelect.addEventListener('change', async () => {
    const picked = String(xqSelect.value || '').trim();
    if (picked && picked !== currentXqCode) {
      prioritizeAccountSwitch();
    }
    currentXqCode = picked;
    try {
      await setLocal(CURRENT_XQ_CODE_KEY, picked);
    } catch {
      // ignore
    }
    adjustXqSelectWidth();
    if (isPlatformEnabled('ve')) {
      try {
        await loadCourses();
      } catch {
        // ignore
      }
    }
  });
}

function getAccountDisplayName(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  const hit = loginAccountHistory.find((it) => String(it?.userId || '').trim() === uid);
  if (!hit) return '';
  const userName = String(hit.userName || uid).trim();
  const roleName = String(hit.roleName || '').trim();
  return `${roleName}${userName}`;
}

function findLoginAccountRecord(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  return normalizeLoginAccountHistoryList(loginAccountHistory)
    .find((it) => it.userId === uid || it.loginName === uid) || null;
}

async function loadLoginAccountHistory() {
  try {
    const raw = await getLocal(LOGIN_ACCOUNT_HISTORY_KEY, []);
    loginAccountHistory = await enrichLoginAccountHistoryList(raw);
  } catch {
    loginAccountHistory = [];
  }
}

async function saveLoginAccountHistory() {
  loginAccountHistory = normalizeLoginAccountHistoryList(loginAccountHistory);
  await setLocal(LOGIN_ACCOUNT_HISTORY_KEY, serializeLoginAccountHistoryList(loginAccountHistory));
}

async function rememberLoggedInAccount(userId, info = null) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  const nextInfo = info && typeof info === 'object' ? info : {};
  const idx = loginAccountHistory.findIndex((it) => String(it?.loginName || it?.userId || '').trim() === uid);
  const prev = idx >= 0 ? loginAccountHistory[idx] : null;
  // loginName: 优先 API 返回的 loginName，其次用已有记录的 loginName，最后用 userId 初始化
  const loginName = String(nextInfo.loginName || prev?.loginName || uid).trim();
  const record = {
    userId: uid,
    loginName,
    userName: String(nextInfo.userName || prev?.userName || '').trim(),
    roleName: String(nextInfo.roleName || prev?.roleName || '').trim(),
    passwordMd5: String(nextInfo.passwordMd5 || prev?.passwordMd5 || '').trim(),
    quickUsername: String(nextInfo.quickUsername || nextInfo.username || prev?.quickUsername || '').trim(),
    lastLoginAt: Date.now()
  };
  if (idx >= 0) loginAccountHistory.splice(idx, 1);
  loginAccountHistory.unshift(record);
  if (record.loginName && (record.userName || record.roleName || record.passwordMd5)) {
    await globalThis.BjtuAccountStore?.put?.({
      loginName: record.loginName,
      userName: record.userName,
      roleName: record.roleName,
      password: record.passwordMd5,
      quickUsername: record.quickUsername
    });
  } else {
    await globalThis.BjtuAccountLogin?.updatePassword?.(uid, record.passwordMd5);
  }
  await saveLoginAccountHistory();
  renderLoginAccountHistorySelect(uid);
}

// -------------------- Network helpers --------------------
async function fetchText(url, options = {}) {
  const { signal: externalSignal, ...restOptions } = options || {};
  const controller = new AbortController();
  const externalAbortHandler = () => {
    try { controller.abort(); } catch { /* ignore */ }
  };
  if (externalSignal instanceof AbortSignal) {
    if (externalSignal.aborted) {
      try { controller.abort(); } catch { /* ignore */ }
    } else {
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }

  const omitSessionId = !!options.omitSessionId;
  const sid = omitSessionId ? '' : await getPlatformSessionId();
  const headers = {
    'Upgrade-Insecure-Requests': '1',
    ...(options.headers || {})
  };
  if (!omitSessionId) {
    headers.sessionId = sid;
  }

  let res;
  try {
    res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...restOptions,
      headers,
      signal: controller.signal
    });
  } finally {
    if (externalSignal instanceof AbortSignal) {
      try { externalSignal.removeEventListener('abort', externalAbortHandler); } catch { /* ignore */ }
    }
  }

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

function parseAlertMsg(html) {
  const arr = [...String(html || '').matchAll(/alert\((['"])(.*?)\1\)/g)];
  if (!arr.length) return '';
  return arr[arr.length - 1][2];
}

function isSessionEndedHtml(html) {
  const t = String(html || '');
  return /<title>会话结束<\/title>/i.test(t) && t.includes('会话结束,请退出系统') && t.includes('重新登录');
}

function isLikelyLoginPageHtml(html, resUrl = '') {
  const t = String(html || '');
  const u = String(resUrl || '');
  if (u.includes('/ve/s.shtml') || u.includes('/ve/Login_2.jsp') || u.includes('/ve/Timeout.jsp') || isSessionEndedHtml(t)) return true;
  return false;
}

async function loadSaveUploadsEnabledSetting() {
  try {
    const data = await chrome.storage.local.get(['saveUploadedFilesEnabled']);
    window.saveUploadedFilesEnabled = data.saveUploadedFilesEnabled === undefined
      ? true
      : !!data.saveUploadedFilesEnabled;
  } catch {
    window.saveUploadedFilesEnabled = true;
  }
  const input = document.getElementById('save-uploads-enabled');
  if (input instanceof HTMLInputElement) input.checked = !!window.saveUploadedFilesEnabled;
}

function applyExpandableAutoToggle(root = document) {
  root.querySelectorAll('.expandable-box').forEach((box) => {
    if (!(box instanceof HTMLElement)) return;
    // Hidden overdue/done groups cannot be measured reliably; they are measured after the group is expanded and rerendered.
    if (!box.getClientRects().length) return;
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
    box.classList.toggle('no-toggle', canFitInCollapsed);
    if (canFitInCollapsed) {
      box.classList.remove('expanded');
      box.dataset.expanded = '0';
    }
    body.style.maxHeight = prev;
    body.style.overflow = prevOverflow;
  });
}

async function loadPlatformVisibleFromStorage() {
  try {
    const data = await chrome.storage.local.get(['platformVisible']);
    window.platformVisible = sanitizePlatformVisible(data?.platformVisible, DEFAULT_PLATFORM_VISIBLE);
  } catch {
    window.platformVisible = { ...DEFAULT_PLATFORM_VISIBLE };
  }
  applyPlatformVisibility();
}



// -------------------- Login --------------------
function getLoginFallbackUsername(targetUsername = '') {
  const target = String(targetUsername || '').trim();
  const pendingFrom = String(pendingUsernameChange?.from || '').trim();
  if (pendingFrom && pendingFrom !== target) return pendingFrom;
  const last = String(lastValidUsername || '').trim();
  if (last && last !== target) return last;
  const newest = normalizeLoginAccountHistoryList(loginAccountHistory)[0] || null;
  const remembered = String(newest?.userId || newest?.loginName || '').trim();
  if (remembered && remembered !== target) return remembered;
  return '';
}

async function restoreLoginFallbackUsername(targetUsername = '') {
  const fallback = getLoginFallbackUsername(targetUsername);
  if (!fallback) return '';
  usernameInput.value = fallback;
  await setLocal('username', fallback);
  lastValidUsername = fallback;
  pendingUsernameChange = null;
  resetAccountSwitchInterruption();
  const localInfo = findLoginAccountRecord(fallback);
  setWelcomeMessage(localInfo || null);
  renderLoginAccountHistorySelect(fallback);
  updateJsessionidState();
  return fallback;
}

async function validateUsernameBeforeLoginStart(userId, { signal } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, status: 'empty', message: '请输入账号' };
  if (signal?.aborted) return { ok: false, status: 'cancelled', message: '已取消' };
  try {
    await globalThis.BjtuAccountLogin?.ensureInitialized?.({ showProgress: true });
  } catch {
    return { ok: false, status: 'unknown', message: '账号列表初始化失败' };
  }
  if (signal?.aborted) return { ok: false, status: 'cancelled', message: '已取消' };
  const info = await getLocalAccountInfo(uid);
  return { ok: true, status: 'needs-post-login', info, accountMissing: !info };
}

async function saveLoginAccountCredential(userId, passwordMd5 = '') {
  const uid = String(userId || '').trim();
  if (!uid) return;
  const idx = loginAccountHistory.findIndex((it) => String(it?.loginName || it?.userId || '').trim() === uid);
  const prev = idx >= 0 ? loginAccountHistory[idx] : { userId: uid, loginName: uid };
  const record = {
    ...prev,
    userId: uid,
    loginName: uid,
    passwordMd5: String(passwordMd5 || '').trim(),
    lastLoginAt: Date.now()
  };
  if (idx >= 0) loginAccountHistory.splice(idx, 1);
  loginAccountHistory.unshift(record);
  if (passwordMd5) {
    const account = await readAccountInfoFromIndexedDb(uid);
    await globalThis.BjtuAccountStore?.put?.({
      loginName: uid,
      userName: String(account?.userName || '').trim(),
      roleName: String(account?.roleName || '').trim(),
      password: String(passwordMd5 || '').trim(),
      quickUsername: String(account?.quickUsername || '').trim()
    });
  }
  await saveLoginAccountHistory();
  renderLoginAccountHistorySelect(uid);
}

async function loginPasswordGet(username, passwordMd5, { signal } = {}) {
  await enforceJsessionidBeforeLoginRequest();
  const result = await globalThis.BjtuAccountLogin.loginWithPassword(username, passwordMd5, { signal });
  if (result?.reason === 'password-reset') {
    const resetUrl = BASE_VE + 'CheckEmail.shtml?method=resetPassword&username=' + encodeURIComponent(String(username || '').trim());
    chrome.tabs.create({ url: resetUrl, active: true }).catch(() => {});
  }
  return result;
}

async function loginGet(username, { signal } = {}) {
  const account = await getLocalAccountInfo(username);
  const quickUsername = String(account?.quickUsername || '').trim();
  if (!quickUsername) {
    return { ok: false, reason: 'needs-password', message: '未绑定极速登录 username' };
  }
  const result = await globalThis.BjtuAccountLogin.loginWithQuickUsername(quickUsername, { signal });
  if (!result.ok && result.reason === 'credential') {
    return { ...result, reason: 'invalid-account', message: '绑定的极速登录 username 已失效' };
  }
  return result;
}



function hideLoginModal() {
  loginModal.style.display = 'none';
}

function dismissLoginModal({ abort = true } = {}) {
  hideLoginModal();
  if (abort) {
    try { loginAbortController?.abort(); } catch { /* ignore */ }
    loginAbortController = null;
    if (isLoginInProgress) loginCancelRequested = true;
  }
  if (pendingUsernameChange) {
    const backTo = String(pendingUsernameChange.from || '').trim();
    if (backTo) {
      syncAccountInfoAndReloadVeCourses({
        userId: backTo,
        reloadCourses: false,
        reloadResourceSpace: true
      }).catch(() => {});
    }
  }
}

if (loginModal) {
  loginModal.addEventListener('mousedown', (e) => {
    loginModal.dataset.mdownMask = e.target === loginModal ? '1' : '0';
  });
  loginModal.addEventListener('mouseup', (e) => {
    if (e.target === loginModal && loginModal.dataset.mdownMask === '1') {
      dismissLoginModal();
    }
    delete loginModal.dataset.mdownMask;
  });
}

const loginModalClose = document.getElementById('login-modal-close');
if (loginModalClose instanceof HTMLButtonElement) {
  loginModalClose.addEventListener('click', () => dismissLoginModal());
}

async function handleLoginSuccess(username) {
  if (!isPlatformEnabled('ve')) {
    window.platformEnabled.ve = true;
    savePlatformEnabledToStorage().catch(() => {});
  }
  window.platformLoadedOnce.ve = false;
  setPlatformLoginState('ve', 'checking');
  isLoginSessionValid = true;
  loginCancelRequested = false;
  hideLoginModal();
  void forceSyncJsessionidAfterLogin().catch(() => {});

  let finalUser = String(username || '').trim();
  usernameInput.value = finalUser;
  updateJsessionidState();

  runPendingLoginCallbacks();
  showToast('登录成功', 'success');

  await loadAutoLoadCourseResourcesSetting().catch(() => {});
  await reloadVePlatformFromSession({
    reloadCourses: true,
    reloadResourceSpace: true
  }).catch(() => {});
}

async function handleAlreadyLoggedIn(username, userInfo) {
  if (!isPlatformEnabled('ve')) {
    window.platformEnabled.ve = true;
    savePlatformEnabledToStorage().catch(() => {});
  }
  window.platformLoadedOnce.ve = false;
  setPlatformLoginState('ve', 'checking');
  isLoginSessionValid = true;
  loginCancelRequested = false;
  hideLoginModal();
  runPendingLoginCallbacks();
  showToast('已登录该账号', 'success', 1800);
  await loadAutoLoadCourseResourcesSetting().catch(() => {});
  await syncAccountInfoAndReloadVeCourses({
    userId: String(username || '').trim(),
    reloadCourses: true,
    reloadResourceSpace: true,
    knownUserInfo: userInfo || null
  }).catch(() => {});
}

async function doLoginFlow() {
  if (isLoginInProgress) return;
  const username = String(usernameInput.value || '').trim();
  if (!username) {
    showToast('请输入账号，或改为填写 JSESSIONID', 'warning');
    return;
  }

  loginFlowUsernameSet = true;
  usernameChangeVersion += 1;
  try { usernameChangeAbortController?.abort(); } catch {}
  prioritizeAccountSwitch();
  const wasSwitchingAccount = !!pendingUsernameChange;
  let restoredAfterFailure = false;
  const restoreAfterFailure = async () => {
    if (restoredAfterFailure) return;
    restoredAfterFailure = true;
    const fallback = await restoreLoginFallbackUsername(username);
    if (fallback) {
      await resumeVeAfterAccountSwitchFailure();
      await loadResourceSpaceForCurrentAccount().catch(() => {});
    }
  };

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.style.opacity = '0.7';
    loginBtn.innerHTML = '登录中… <span class="spinner"></span>';
  }
  isLoginInProgress = true;
  loginCancelRequested = false;
  loginAbortController = new AbortController();
  const signal = loginAbortController.signal;

  try {
    showToast('正在检查当前登录账号…', 'info', 0);
    const currentUser = await globalThis.BjtuAccountLogin.getCurrentUserInfo({ signal });
    if (signal.aborted || loginCancelRequested) return;
    if (String(currentUser?.loginName || '').trim() === username) {
      await handleAlreadyLoggedIn(username, currentUser);
      return;
    }

    showToast('正在读取账号列表…', 'info', 0);
    const initialInitializationResult = await globalThis.BjtuAccountLogin.ensureInitialized({ showProgress: true });
    if (signal.aborted || loginCancelRequested) return;
    let skipNextAutomaticLoginAttempt = initialInitializationResult?.skipped === true;

    let account = await getLocalAccountInfo(username);
    let manualPassword = '';
    let recoveryMessage = account
      ? '账号或密码错误，请重新初始化账号列表或手动输入密码。'
      : '账号不在本地账号列表中，请重新初始化账号列表或手动输入密码。';

    const indexedAccount = await readAccountInfoFromIndexedDb(username);
    const needsQuickUsername = !indexedAccount || !String(indexedAccount.password || '').trim();
    if (needsQuickUsername && !skipNextAutomaticLoginAttempt) {
      try {
        account = await globalThis.BjtuAccountLogin.ensureQuickUsernameForLogin(username, {
          currentUser,
          signal,
          onStatus: (message) => showToast(message, 'info', 0)
        });
        account = await getLocalAccountInfo(username) || account;
        recoveryMessage = '极速登录失败，请重新初始化账号列表或手动输入密码。';
      } catch (error) {
        if (signal.aborted || loginCancelRequested) return;
        recoveryMessage = `极速登录名获取失败：${String(error?.message || error)}`;
      }
    }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (signal.aborted || loginCancelRequested) return;

      const skipAutomaticLoginAttempt = skipNextAutomaticLoginAttempt;
      skipNextAutomaticLoginAttempt = false;

      if (!skipAutomaticLoginAttempt && !manualPassword && account?.quickUsername) {
        showToast('正在极速登录…', 'info', 0);
        const quickResult = await loginGet(username, { signal });
        if (signal.aborted || loginCancelRequested) return;
        if (quickResult.ok) {
          await handleLoginSuccess(username);
          return;
        }
        if (quickResult.reason === 'locked') {
          await restoreAfterFailure();
          showToast(quickResult.message || '账号已锁定，请稍后再试', 'error', 4000);
          return;
        }
      }

      const passwordMd5 = skipAutomaticLoginAttempt
        ? ''
        : String(manualPassword || account?.passwordMd5 || '').trim();
      manualPassword = '';
      if (passwordMd5) {
        showToast('正在登录…', 'info', 0);
        const result = await loginPasswordGet(username, passwordMd5, { signal });
        if (signal.aborted || loginCancelRequested) return;
        if (result.ok) {
          await saveLoginAccountCredential(username, passwordMd5);
          await handleLoginSuccess(username);
          return;
        }
        if (result.reason === 'locked' || result.reason === 'password-reset') {
          await restoreAfterFailure();
          showToast(result.message || '登录失败', 'error', 4000);
          return;
        }
        if (result.reason !== 'credential') {
          await restoreAfterFailure();
          showToast(result.message || '登录失败', 'error', 3000);
          return;
        }
        recoveryMessage = result.message || '账号或密码错误';
      }

      const recovery = await globalThis.BjtuAccountLogin.requestRecovery(username, recoveryMessage);
      if (signal.aborted || loginCancelRequested) return;
      if (recovery?.action === 'cancel') {
        await restoreAfterFailure();
        showToast('登录失败，已恢复原账号', 'warning', 2200);
        return;
      }
      if (recovery?.action === 'reinitialize') {
        try {
          const initializationResult = await globalThis.BjtuAccountLogin.initialize({ force: true, showProgress: true });
          if (initializationResult?.skipped === true) {
            skipNextAutomaticLoginAttempt = true;
            attempt -= 1;
            continue;
          }
          account = await getLocalAccountInfo(username);
          recoveryMessage = account
            ? '账号列表已更新，正在使用最新密码重试。'
            : '重新初始化后仍未找到该账号，可手动输入密码或取消。';
          if (account) {
            const currentAfterInitialize = await globalThis.BjtuAccountLogin.getCurrentUserInfo({ signal });
            if (String(currentAfterInitialize?.loginName || '').trim() === username) {
              await handleAlreadyLoggedIn(username, currentAfterInitialize);
              return;
            }
            attempt = -1;
            showToast('账号列表已更新，正在重新登录…', 'info', 0);
            continue;
          }
        } catch (error) {
          recoveryMessage = '账号列表初始化失败：' + String(error?.message || error);
        }
        continue;
      }
      if (recovery?.action === 'password' && recovery.password) {
        manualPassword = String(recovery.password).trim();
        continue;
      }
    }

    await restoreAfterFailure();
    showToast('登录尝试次数过多，已恢复原账号', 'error', 3000);
  } catch (error) {
    if (signal.aborted || loginCancelRequested) return;
    console.error('Login error:', error);
    await restoreAfterFailure();
    showToast('登录过程中出现异常：' + String(error?.message || error), 'error', 3500);
  } finally {
    const switchModalClosed = !loginModal || loginModal.style.display === 'none';
    if (wasSwitchingAccount && pendingUsernameChange && switchModalClosed) {
      if (isPlatformEnabled('ve')) {
        try { await loadCourses(); } catch {}
      }
      try { await loadResourceSpaceForCurrentAccount(); } catch {}
      window.syncRightColumnResizer?.();
    }
    isLoginInProgress = false;
    loginFlowUsernameSet = false;
    loginAbortController = null;
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



function todayEndDateTimeString() {
  const now = new Date();
  return formatMrjzyDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59));
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


































function isNativeHomeworkDone(hw) {
  const subStatus = String(hw?.subStatus ?? hw?.sub_status ?? '').trim();
  const subTime = String(hw?.subTime ?? hw?.sub_time ?? '').trim();
  return (subStatus && subStatus !== '未提交') || !!subTime;
}

function isNativeHomeworkPending(hw) {
  const deadline = hw?.end_time ?? hw?.endTime ?? '';
  return !isNativeHomeworkDone(hw) && !isDeadlinePassed(deadline);
}

function isNativeHomeworkOverdue(hw) {
  const deadline = hw?.end_time ?? hw?.endTime ?? '';
  return !isNativeHomeworkDone(hw) && isDeadlinePassed(deadline);
}







function ensureCourseCardState(courseId) {
  if (!window.courseCardStateById[courseId]) {
    window.courseCardStateById[courseId] = {
      allHomeworkCount: 0,
      pendingHomeworkCount: 0,
      pendingEarliestTs: 0,
      overdueHomeworkCount: 0,
      overdueEarliestTs: 0,
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
  if ((state?.overdueHomeworkCount || 0) > 0) return 1;
  if ((state?.allHomeworkCount || 0) > 0) return 2;
  const hasReplay = !!state?.hasReplay && !state?.replayListLoading;
  const hasCourseware = !!state?.hasCourseware && !state?.coursewareListLoading;
  if (hasReplay && hasCourseware) return 3;
  if (hasReplay) return 4;
  if (hasCourseware) return 5;
  return 9;
}

function sortCourseCards() {
  const cards = Array.from(courseListDiv.querySelectorAll('.file-item[data-course-rankable="1"]'));
  const sortedCards = cards.slice().sort((a, b) => {
    const ra = Number(a.dataset.rank || 7);
    const rb = Number(b.dataset.rank || 7);
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

    if (ra === 1 && rb === 1) {
      const ida = String(a.id || '').startsWith('course-') ? String(a.id).slice(7) : '';
      const idb = String(b.id || '').startsWith('course-') ? String(b.id).slice(7) : '';
      const tsa = Number(window.courseCardStateById?.[ida]?.overdueEarliestTs || 0);
      const tsb = Number(window.courseCardStateById?.[idb]?.overdueEarliestTs || 0);
      const va = tsa > 0 ? tsa : Number.MAX_SAFE_INTEGER;
      const vb = tsb > 0 ? tsb : Number.MAX_SAFE_INTEGER;
      if (va !== vb) return va - vb;
    }

    const oa = Number(a.dataset.order || 0);
    const ob = Number(b.dataset.order || 0);
    return oa - ob;
  });

  const unchanged = cards.length === sortedCards.length && cards.every((c, idx) => c === sortedCards[idx]);
  if (unchanged) return;
  sortedCards.forEach((c) => courseListDiv.appendChild(c));
  syncCourseActionLoadingSpinnerPhase();
}

function hasCourseActionButtonAnimationActive() {
  return !!courseListDiv.querySelector('button[data-action="videos"].replay-list-loading, button[data-action="videos"].replay-link-progress, button[data-action="courseware"].courseware-list-loading, button[data-action="courseware"].courseware-link-progress');
}

function sortCourseCardsWithGuard({ deferWhileActionAnimating = false } = {}) {
  if (deferWhileActionAnimating && hasCourseActionButtonAnimationActive()) {
    window.courseCardSortPending = true;
    return;
  }
  window.courseCardSortPending = false;
  sortCourseCards();
}

function flushPendingCourseCardSortIfIdle() {
  if (!window.courseCardSortPending) return;
  if (hasCourseActionButtonAnimationActive()) return;
  window.courseCardSortPending = false;
  sortCourseCards();
}

function updateCourseCardRank(courseId, { deferWhileActionAnimating = false } = {}) {
  const card = document.getElementById(`course-${courseId}`);
  if (!card) return;
  const state = ensureCourseCardState(courseId);
  card.dataset.rank = String(calcCourseRank(state));
  sortCourseCardsWithGuard({ deferWhileActionAnimating });
}

function isAnyExternalPlatformChecking() {
  return !!(
    isPlatformEnabled('ykt') && window.platformLoginState?.ykt === 'checking'
    || isPlatformEnabled('mrjzy') && window.platformLoginState?.mrjzy === 'checking'
    || isPlatformEnabled('jlgj') && window.platformLoginState?.jlgj === 'checking'
    || isPlatformEnabled('mooc') && window.platformLoginState?.mooc === 'checking'
  );
}

function suffixAfterDash(v) {
  const s = String(v || '').trim();
  const idx = s.indexOf('-');
  return (idx >= 0 ? s.slice(idx + 1) : s).trim();
}



















function completeExternalLoginAssist(platform, forceReload = true) {
  const p = normalizePlatformId(platform);
  if (!['ykt', 'mrjzy', 'jlgj', 'mooc'].includes(p)) return;
  if (!window.platformEnabled?.[p]) {
    window.platformEnabled[p] = true;
    savePlatformEnabledToStorage().catch(() => {});
  }
  window.platformInteractiveLoginPending[p] = false;
  setPlatformLoginState(p, 'checking');
  triggerExternalPlatformLoad(p, forceReload);
}

































































function showPlatformNeedLoginToast(platform) {
  const p = String(platform || '').trim();
  if (!['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].includes(p)) return;
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
    showToast(YKT_LOGIN_REQUIRED_HTML, 'warning', 3200, true);
    return;
  }
  if (p === 'mrjzy') {
    showToast(MRJZY_LOGIN_REQUIRED_HTML, 'warning', 3200, true);
    return;
  }
  showToast(p === 'mooc' ? MOOC_LOGIN_REQUIRED_HTML : JLGJ_LOGIN_REQUIRED_HTML, 'warning', 3200, true);
}

function setPlatformLoginState(platform, state) {
  const p = normalizePlatformId(platform);
  const prev = String(window.platformLoginState?.[p] || '').trim();
  const s = (state === 'online' || state === 'offline') ? state : 'checking';
  window.platformLoginState[p] = s;
  if (p === 'ykt' && s === 'online') {
    window.platformInteractiveLoginPending.ykt = false;
    closeYktLoginAssistPopup(false);
  }
  if (p === 'mrjzy' && s === 'online') {
    window.platformInteractiveLoginPending.mrjzy = false;
    closeMrjzyLoginAssistPopup(false);
  }
  if (p === 'jlgj' && s === 'online') {
    window.platformInteractiveLoginPending.jlgj = false;
    closeJlgjLoginAssistPopup(false);
  }
  if (p === 'mooc' && s === 'online') {
    window.platformInteractiveLoginPending.mooc = false;
    closeMoocLoginAssistPopup(false);
  }
  if (s === 'online' || s === 'offline') {
    window.platformLoginChecked[p] = true;
  }
  window.platformNeedLogin[p] = isPlatformEnabled(p) && s === 'offline';
  if (s === 'offline' && prev !== 'offline') {
    showPlatformNeedLoginToast(p);
  }
  if (s === 'offline') {
    disablePlatformAfterLoginFailure(p);
  }
  refreshPlatformLoginTip();
  if (!isAnyExternalPlatformChecking()) {
    flushPendingCourseCardSortIfIdle();
  }
}

function refreshPlatformLoginTip() {
  removeMrjzyLoginTip();

  const apply = (btn, state, label) => {
    if (!btn) return;
    btn.classList.remove('checking', 'offline', 'online', 'unselected-checked-online', 'unselected-checked-offline', 'unselected-checked-checking');
    const id = String(btn.id || '');
    const platform = id.includes('ve-status-btn')
      ? 've'
      : (id.includes('mrjzy-status-btn') ? 'mrjzy' : (id.includes('jlgj-status-btn') ? 'jlgj' : (id.includes('mooc-status-btn') ? 'mooc' : 'ykt')));
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
  apply(mrjzyStatusBtn, window.platformLoginState?.mrjzy || 'checking', '每日交作业');
  apply(jlgjStatusBtn, window.platformLoginState?.jlgj || 'checking', '接龙管家');
  apply(moocStatusBtn, window.platformLoginState?.mooc || 'checking', '中国大学MOOC');
  applyPlatformVisibility();

  // Login warnings are shown on offline-transition only (one platform at a time).
}





function shouldShowNoCoursePlaceholder() {
  if (!courseListDiv) return false;
  if (courseListDiv.querySelector('.file-item')) return false;

  const selected = ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].filter((p) => isPlatformEnabled(p));
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








































































function setCourseReplayState(courseId, hasReplay) {
  const state = ensureCourseCardState(courseId);
  state.hasReplay = !!hasReplay;
  state.replayListLoading = false;
  updateCourseCardRank(courseId);
  flushPendingCourseCardSortIfIdle();
}

function syncCoursewareButtonAvailability(btn, courseId) {
  if (!(btn instanceof HTMLElement)) return;
  const cache = window.coursewareCacheByCourseId?.[courseId];
  if (!cache?.loaded) return;
  btn.style.display = Array.isArray(cache.items) && cache.items.length ? '' : 'none';
}

function setCourseReplayLoading(courseId, isLoading) {
  const state = ensureCourseCardState(courseId);
  state.replayListLoading = !!isLoading;
  updateCourseCardRank(courseId);
  if (!state.replayListLoading) flushPendingCourseCardSortIfIdle();
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

function spinnerPhaseDelayStyle(periodMs = 1000) {
  const period = Math.max(1, Number(periodMs || 1000));
  return ` animation-delay:-${Date.now() % period}ms;`;
}

function syncCourseActionLoadingSpinnerPhase(scope = courseListDiv) {
  if (!(scope instanceof HTMLElement)) return;
  const delay = `-${Date.now() % 1000}ms`;
  scope.querySelectorAll('button[data-action="videos"].replay-list-loading .spinner, button[data-action="courseware"].courseware-list-loading .spinner, button[data-action="videos"].replay-link-progress .spinner, button[data-action="courseware"].courseware-link-progress .spinner').forEach((el) => {
    if (el instanceof HTMLElement) {
      el.style.animationDelay = delay;
    }
  });
}

function getCombinedAbortSignal(...signals) {
  const validSignals = signals.filter((signal) => signal instanceof AbortSignal);
  if (!validSignals.length) return undefined;
  if (validSignals.length === 1) return validSignals[0];
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(validSignals);
  }
  const controller = new AbortController();
  const abort = () => {
    try { controller.abort(); } catch { /* ignore */ }
  };
  validSignals.forEach((signal) => {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  return controller.signal;
}

function setCoursewareButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.dataset.coursewareLoading = '1';
    if (btn.classList.contains('courseware-list-loading')) {
      btn.disabled = true;
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'none';
      return;
    }
    btn.disabled = true;
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'none';
    btn.classList.add('courseware-list-loading');
    btn.innerHTML = `课件下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#1e3a8a; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;
    return;
  }

  delete btn.dataset.coursewareLoading;
  delete btn.dataset.coursewareLoadingCount;
  btn.disabled = false;
  btn.style.pointerEvents = 'auto';
  btn.classList.remove('courseware-list-loading');
  flushPendingCourseCardSortIfIdle();
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
  const archiveBtn = card.querySelector('button[data-action="archive"]');

  if (replayBtn && !replayBtn.classList.contains('replay-list-loading') && !replayBtn.classList.contains('replay-link-progress')) {
    replayBtn.textContent = activeView === 'replay' ? '收起' : '回放下载';
  }
  if (coursewareBtn && !coursewareBtn.classList.contains('courseware-list-loading') && !coursewareBtn.classList.contains('courseware-link-progress')) {
    coursewareBtn.textContent = activeView === 'courseware' ? '收起' : '课件下载';
  }
  if (archiveBtn && !archiveBtn.classList.contains('archive-list-loading') && !archiveBtn.classList.contains('archive-link-progress')) {
    archiveBtn.textContent = activeView === 'archive' ? '收起' : '归档下载';
  }
}

function syncArchiveItemsIndex(courseId, items) {
  const cid = String(courseId || '').trim();
  const previous = Array.isArray(window.archiveItemsByCourseId?.[cid]) ? window.archiveItemsByCourseId[cid] : [];
  previous.forEach((item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    delete window.archiveItemsById[id];
    window.resourceSpaceSelected.delete(id);
  });
  const next = Array.isArray(items) ? items : [];
  window.archiveItemsByCourseId[cid] = next;
  next.forEach((item) => {
    const id = String(item?.id || '').trim();
    if (id) window.archiveItemsById[id] = item;
  });
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

function syncCoursewareSelectAllButton(card) {
  if (!(card instanceof HTMLElement)) return;
  const btn = card.querySelector('button[data-action="courseware-select-all"]');
  if (!(btn instanceof HTMLButtonElement)) return;
  const scope = btn.closest('.result-area') || card;
  const ids = Array.from(scope.querySelectorAll('input[data-action="resource-check"][data-resource-id]'))
    .map((el) => (el instanceof HTMLInputElement ? String(el.dataset.resourceId || '').trim() : ''))
    .filter((id) => id && !isResourceDownloadActive(id));
  if (!ids.length) {
    btn.textContent = '反选';
    btn.disabled = true;
    return;
  }
  btn.textContent = '反选';
  btn.disabled = false;
}

function toggleCoursewareSelectionForCard(card) {
  if (!(card instanceof HTMLElement)) return;
  const btn = card.querySelector('button[data-action="courseware-select-all"]');
  const scope = (btn instanceof HTMLButtonElement ? (btn.closest('.result-area') || card) : card);
  const ids = Array.from(scope.querySelectorAll('input[data-action="resource-check"][data-resource-id]'))
    .map((el) => (el instanceof HTMLInputElement ? String(el.dataset.resourceId || '').trim() : ''))
    .filter((id) => id && !isResourceDownloadActive(id));
  if (!ids.length) return;

  ids.forEach((id) => {
    if (window.resourceSpaceSelected.has(id)) window.resourceSpaceSelected.delete(id);
    else window.resourceSpaceSelected.add(id);
  });

  const cbs = scope.querySelectorAll('input[data-action="resource-check"][data-resource-id]');
  cbs.forEach((el) => {
    if (!(el instanceof HTMLInputElement)) return;
    const id = String(el.dataset.resourceId || '').trim();
    if (!id || !ids.includes(id) || isResourceDownloadActive(id)) return;
    el.checked = window.resourceSpaceSelected.has(id);
  });

  syncCoursewareSelectAllButton(card);
  refreshResourceSelectAllButton();
}

function buildCoursewareListHtml(courseId, items, toolbarEndHtml = '') {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return '<div style="font-size:12px; color:#999;">暂无课件资源</div>';
  }

  const currentCourseId = String(courseId || '').trim();
  const selectAllToolbar = currentCourseId
    ? `<div class="courseware-toolbar"><button class="btn courseware-select-all-btn" data-action="courseware-select-all" data-course-id="${escapeHtml(currentCourseId)}" style="background:#000; color:#fff; padding:3px 8px; font-size:11px; line-height:1.2;">反选</button>${toolbarEndHtml}</div>`
    : '';

  const rowsHtml = list.map((item, index) => {
    const name = String(item?.name || `课件-${index + 1}`).trim();
    const fileName = ensureResourceDownloadFileName(item, item?.url || '');
    const url = String(item?.url || '').trim();
    const id = String(item?.id || '').trim();
    const rpId = String(item?.rpId || '').trim();
    const checked = window.resourceSpaceSelected.has(id) ? 'checked' : '';
    const sizeMb = String(item?.sizeMb || '').trim();
    const sizeStyle = buildResourceSizeEmphasisStyle(item?.sizeMbRaw ?? item?.rpSize);
    const displayUrl = cleanRpUrl(url);
    const hasUrl = !!url;
    const needsRpFetch = !hasUrl && !!rpId;
    const rpLinkContainerId = `courseware-rp-link-${id}`;
    return `
      <div class="file-item course-resource-file-item" data-resource-id="${escapeHtml(id)}" data-rp-id="${escapeHtml(rpId)}" style="margin-bottom:10px; padding:5px; border-left:3px solid #1e3a8a; background:#e8efff; border-radius:4px;">
        <div class="resource-row-title" style="margin-bottom:4px;">
          <input type="checkbox" data-action="resource-check" data-resource-id="${escapeHtml(id)}" ${checked} style="margin:0 4px 0 0;">
          <span class="resource-name">${escapeHtml(fileName || name)}</span>
          ${sizeMb ? `<span class="resource-time-inline file-size-emphasis" data-file-size-mb="${escapeHtml(String(Number(item?.sizeMbRaw ?? item?.rpSize) || 0))}" style="${sizeStyle}">${escapeHtml(sizeMb)}</span>` : ''}
        </div>
        <div class="resource-link-row">
          ${hasUrl
            ? `<a class="resource-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl)}</a>`
            : needsRpFetch
              ? `<span id="${escapeHtml(rpLinkContainerId)}" class="courseware-rp-link" style="color:#999;font-size:12px;"><span class="spinner" style="width: 10px; height: 10px; border-width: 1px; border-color: #1e3a8a; border-top-color: transparent;"></span> 获取链接中…</span>`
              : `<span class="resource-url" style="color:#999;">无下载链接</span>`
          }
          ${hasUrl ? `<button class="btn resource-copy-btn" data-action="resource-copy" data-resource-id="${escapeHtml(id)}">复制</button>` : ''}
          <button class="btn resource-download-btn" data-action="resource-download" data-resource-id="${escapeHtml(id)}">下载</button>
        </div>
        <div class="resource-download-progress" style="display:none;">
          <div class="progress-bar-container"><div class="progress-bar"></div></div>
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

  return `${selectAllToolbar}${rowsHtml}`;
}



function getCourseListLoadVersionSnapshot() {
  return Number(window.courseListLoadVersion || 0);
}

function isCourseListLoadStale(snapshotVersion) {
  return Number(snapshotVersion || 0) !== Number(window.courseListLoadVersion || 0);
}











function recomputeCourseHomeworkState(courseId) {
  const nativeList = (window.courseHomeworkData[courseId]?.list || []);
  const yktList = isPlatformEnabled('ykt') ? (window.yktMatchedHomeworkByCourseId[courseId] || []) : [];
  const mrjzyList = isPlatformEnabled('mrjzy') ? (window.mrjzyMatchedHomeworkByCourseId[courseId] || []) : [];
  const jlgjList = isPlatformEnabled('jlgj') ? (window.jlgjMatchedHomeworkByCourseId[courseId] || []) : [];
  const allHomeworkCount = nativeList.length + yktList.length + mrjzyList.length + jlgjList.length;
  const nativePendingList = nativeList.filter(isNativeHomeworkPending);
  const yktPendingList = yktList.filter(isYktHomeworkPending);
  const mrjzyPendingList = mrjzyList.filter(isMrjzyHomeworkPending);
  const jlgjPendingList = jlgjList.filter(isJlgjHomeworkPending);
  const nativeOverdueList = nativeList.filter(isNativeHomeworkOverdue);
  const yktOverdueList = yktList.filter(isYktHomeworkOverdue);
  const mrjzyOverdueList = mrjzyList.filter(isMrjzyHomeworkOverdue);
  const jlgjOverdueList = jlgjList.filter(isJlgjHomeworkOverdue);
  const nativePending = nativePendingList.length;
  const yktPending = yktPendingList.length;
  const mrjzyPending = mrjzyPendingList.length;
  const jlgjPending = jlgjPendingList.length;
  const pendingTs = [];
  nativePendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end_time ?? hw?.endTime ?? '')));
  yktPendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end)));
  mrjzyPendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end)));
  jlgjPendingList.forEach((hw) => pendingTs.push(parseDeadlineToTs(hw?.end)));
  const validPendingTs = pendingTs.filter((n) => Number.isFinite(n) && n > 0);
  const overdueTs = [];
  nativeOverdueList.forEach((hw) => overdueTs.push(parseDeadlineToTs(hw?.end_time ?? hw?.endTime ?? '')));
  yktOverdueList.forEach((hw) => overdueTs.push(parseDeadlineToTs(hw?.end)));
  mrjzyOverdueList.forEach((hw) => overdueTs.push(parseDeadlineToTs(hw?.end)));
  jlgjOverdueList.forEach((hw) => overdueTs.push(parseDeadlineToTs(hw?.end)));
  const validOverdueTs = overdueTs.filter((n) => Number.isFinite(n) && n > 0);
  const state = ensureCourseCardState(courseId);
  state.allHomeworkCount = allHomeworkCount;
  state.pendingHomeworkCount = nativePending + yktPending + mrjzyPending + jlgjPending;
  state.pendingEarliestTs = validPendingTs.length ? Math.min(...validPendingTs) : 0;
  state.overdueHomeworkCount = nativeOverdueList.length + yktOverdueList.length + mrjzyOverdueList.length + jlgjOverdueList.length;
  state.overdueEarliestTs = validOverdueTs.length ? Math.min(...validOverdueTs) : 0;
  const hasAnyHomework = state.allHomeworkCount > 0 || state.pendingHomeworkCount > 0 || state.overdueHomeworkCount > 0;
  updateCourseCardRank(courseId, { deferWhileActionAnimating: !hasAnyHomework });
}

function updateHomeworkToggleButton(courseId) {
  // Kept for compatibility with existing call sites.
  void courseId;
}

function setHomeworkVisibility(courseId, key, value) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const store = key === 'showOverdue' ? window.courseShowOverdueById : window.courseShowDoneById;
  const nextValue = typeof value === 'boolean' ? value : !store[cid];
  store[cid] = nextValue;

  const data = window.courseHomeworkData[cid];
  if (data) {
    data[key] = nextValue;
  }

  if (!toggleHomeworkGroupDom(cid, key, nextValue)) {
    renderHomeworkList(cid);
  }
}

function toggleHomeworkGroupDom(courseId, key, expanded) {
  const kind = key === 'showOverdue' ? 'overdue' : 'done';
  const area = document.getElementById(`homework-area-${courseId}`);
  if (!(area instanceof HTMLElement)) return false;
  const btn = area.querySelector(`.homework-toggle-btn[data-homework-toggle-kind="${kind}"]`);
  if (!(btn instanceof HTMLElement)) return false;

  const group = area.querySelector(`.homework-group[data-homework-group="${kind}"]`);
  if (!(group instanceof HTMLElement)) return false;

  const count = String(btn.dataset.count || '').trim();
  const collapsedText = String(btn.dataset.collapsedText || '').trim();
  const expandedText = String(btn.dataset.expandedText || '').trim();
  const label = btn.querySelector('.homework-toggle-label');
  if (label) label.textContent = `${expanded ? expandedText : collapsedText}${count ? ` (${count})` : ''}`;

  btn.classList.toggle('is-expanded', expanded);
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  btn.classList.remove('homework-toggle-btn--up', 'homework-toggle-btn--down');
  btn.classList.add(expanded ? 'homework-toggle-btn--up' : 'homework-toggle-btn--down');

  group.dataset.expanded = expanded ? '1' : '0';
  group.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  if (kind === 'done') syncForcePublishScoreButtonRow(courseId, expanded);
  animateHomeworkGroupVisibility(group, expanded);
  return true;
}

function syncForcePublishScoreButtonRow(courseId, expanded) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const area = document.getElementById(`homework-area-${cid}`);
  if (!(area instanceof HTMLElement)) return;
  area.querySelectorAll('.force-score-publish-row').forEach((el) => {
    if (el instanceof HTMLElement && String(el.dataset.courseId || '').trim() === cid) el.remove();
  });
  if (!expanded || window.isTeacherAccount) return;
  const html = renderForcePublishScoreButton(cid);
  if (!html) return;
  const doneRow = area.querySelector('.homework-toggle-row--done');
  if (!(doneRow instanceof HTMLElement)) return;
  const holder = document.createElement('div');
  holder.innerHTML = html.trim();
  const row = holder.firstElementChild;
  if (!(row instanceof HTMLElement)) return;
  row.dataset.courseId = cid;
  doneRow.insertAdjacentElement('afterend', row);
  updateForcePublishScoreButtonState(cid);
}

function animateHomeworkGroupVisibility(group, expanded) {
  if (!(group instanceof HTMLElement)) return;
  group.classList.remove('homework-group-animating');
  group.style.overflow = 'hidden';

  if (expanded) {
    group.classList.remove('is-hidden');
    group.style.maxHeight = '0px';
    group.style.opacity = '0';
    group.style.transform = 'translateY(-3px)';
    void group.offsetHeight;
    group.classList.add('homework-group-animating');
    requestAnimationFrame(() => {
      group.style.maxHeight = `${Math.max(1, group.scrollHeight)}px`;
      group.style.opacity = '1';
      group.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      group.classList.remove('homework-group-animating');
      group.style.maxHeight = '';
      group.style.opacity = '';
      group.style.transform = '';
      group.style.overflow = '';
    }, 230);
    return;
  }

  group.style.maxHeight = `${Math.max(1, group.scrollHeight)}px`;
  group.style.opacity = '1';
  group.style.transform = 'translateY(0)';
  void group.offsetHeight;
  group.classList.add('homework-group-animating');
  requestAnimationFrame(() => {
    group.style.maxHeight = '0px';
    group.style.opacity = '0';
    group.style.transform = 'translateY(-3px)';
  });
  setTimeout(() => {
    group.classList.add('is-hidden');
    group.classList.remove('homework-group-animating');
    group.style.maxHeight = '';
    group.style.opacity = '';
    group.style.transform = '';
    group.style.overflow = '';
  }, 230);
}

window.toggleOverdueView = function(courseId) {
  setHomeworkVisibility(courseId, 'showOverdue');
};

window.toggleDoneView = function(courseId) {
  setHomeworkVisibility(courseId, 'showDone');
};

window.toggleHomeworkView = function(courseId) {
  window.toggleDoneView(courseId);
};







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






































































function renderHomeworkList(courseId) {
  const area = document.getElementById(`homework-area-${courseId}`);
  if (!area) return;
  const fallbackShowOverdue = !!window.courseShowOverdueById[courseId];
  const fallbackShowDone = !!window.courseShowDoneById[courseId];
  const data = window.courseHomeworkData[courseId] || { list: [], showOverdue: fallbackShowOverdue, showDone: fallbackShowDone };
  if (window.courseHomeworkData[courseId]) {
    window.courseHomeworkData[courseId].showOverdue = fallbackShowOverdue;
    window.courseHomeworkData[courseId].showDone = fallbackShowDone;
  }
  const list = data.list || [];
  updateAssessmentButtonVisibility(courseId);
  syncHomeworkAttachmentItemsIndex(courseId, []);

  const classify = (items, isDoneFn, isOverdueFn) => {
    const pending = [], overdue = [], done = [];
    items.forEach((hw) => {
      if (isDoneFn(hw)) done.push(hw);
      else if (isOverdueFn(hw)) overdue.push(hw);
      else pending.push(hw);
    });
    return { pending, overdue, done };
  };

  const nativeCls = classify(list, isNativeHomeworkDone, isNativeHomeworkOverdue);
  const yktItems = isPlatformEnabled('ykt') ? (window.yktMatchedHomeworkByCourseId[courseId] || []) : [];
  const yktCls = classify(yktItems, isYktHomeworkDone, isYktHomeworkOverdue);
  const mrjzyItems = isPlatformEnabled('mrjzy') ? (window.mrjzyMatchedHomeworkByCourseId[courseId] || []) : [];
  const mrjzyCls = classify(mrjzyItems, isMrjzyHomeworkDone, isMrjzyHomeworkOverdue);
  const jlgjItems = isPlatformEnabled('jlgj') ? (window.jlgjMatchedHomeworkByCourseId[courseId] || []) : [];
  const jlgjCls = classify(jlgjItems, isJlgjHomeworkDone, isJlgjHomeworkOverdue);

  const sortNativeGroup = (items) => sortHomeworkItemsByDeadline(items, (hw) => hw?.end_time ?? hw?.endTime ?? '');
  const sortExternalGroup = (items) => sortHomeworkItemsByDeadline(items, (hw) => hw?.end ?? hw?.endTime ?? '');
  const nativePendingItems = sortNativeGroup(nativeCls.pending);
  const nativeOverdueItems = sortNativeGroup(nativeCls.overdue);
  const nativeDoneItems = sortNativeGroup(nativeCls.done);
  const yktPendingItems = sortExternalGroup(yktCls.pending);
  const yktOverdueItems = sortExternalGroup(yktCls.overdue);
  const yktDoneItems = sortExternalGroup(yktCls.done);
  const mrjzyPendingItems = sortExternalGroup(mrjzyCls.pending);
  const mrjzyOverdueItems = sortExternalGroup(mrjzyCls.overdue);
  const mrjzyDoneItems = sortExternalGroup(mrjzyCls.done);
  const jlgjPendingItems = sortExternalGroup(jlgjCls.pending);
  const jlgjOverdueItems = sortExternalGroup(jlgjCls.overdue);
  const jlgjDoneItems = sortExternalGroup(jlgjCls.done);

  const isYktStandalone = String(courseId).startsWith('ykt-');
  const isMrjzyStandalone = String(courseId).startsWith('mrjzy-');
  const isJlgjStandalone = String(courseId).startsWith('jlgj-');
  const isExternalStandalone = isYktStandalone || isMrjzyStandalone || isJlgjStandalone;
  const yktLoading = !!window.yktHomeworkLoadingByCourse?.[courseId];
  const yktSyncing = isPlatformEnabled('ykt') && ((window.platformLoginState?.ykt || 'checking') === 'checking') && !window.platformLoadedOnce?.ykt;
  const mrjzySyncing = isPlatformEnabled('mrjzy') && ((window.platformLoginState?.mrjzy || 'checking') === 'checking') && !window.platformLoadedOnce?.mrjzy;
  const jlgjHasEarlyLoadingGroups = Array.isArray(window.jlgjCourseGroupsSnapshot) && window.jlgjCourseGroupsSnapshot.some((group) => !!group?.loadingMeta);
  const jlgjSyncing = isPlatformEnabled('jlgj') && (((window.platformLoginState?.jlgj || 'checking') === 'checking') && !window.platformLoadedOnce?.jlgj || jlgjHasEarlyLoadingGroups);

  const yktCourseLink = window.yktMatchedCourseLinkByCourseId[courseId] || '';
  const yktHeaderHtml = isYktStandalone ? '' : `<div style="font-size:12px;color:#0369a1; margin-bottom:4px;">${yktCourseLink ? `<a href="${yktCourseLink}" target="_blank" rel="noopener noreferrer" style="color:#0369a1; text-decoration:none;">雨课堂作业</a>` : '雨课堂作业'}</div>`;
  const yktWrapperStyle = isYktStandalone ? '' : 'margin-top:6px; padding-top:6px; border-top:1px dashed #b3e5fc;';
  const renderYktSection = (items) => yktItems.length && items.length ? `<div style="${yktWrapperStyle}">${yktHeaderHtml}${renderYktHomeworkItems(courseId, items)}</div>` : '';
  const mrjzyHeaderHtml = isMrjzyStandalone ? '' : '<div style="font-size:12px;color:#3730a3; margin-bottom:4px;">每日交作业</div>';
  const renderMrjzySection = (items) => mrjzyItems.length && items.length ? `<div>${mrjzyHeaderHtml}${renderMrjzyHomeworkItems(items)}</div>` : '';
  const jlgjHeaderHtml = isJlgjStandalone ? '' : '<div style="font-size:12px;color:#0f766e; margin-bottom:4px;">接龙管家</div>';
  const renderJlgjSection = (items) => jlgjItems.length && items.length ? `<div>${jlgjHeaderHtml}${renderJlgjHomeworkItems(items)}</div>` : '';

  const applyDoneEnterAnimation = () => {
    if (data.justExpanded) {
      const doneCards = area.querySelectorAll('.hw-card-item[data-homework-done="1"]');
      doneCards.forEach((el) => {
        el.classList.remove('hw-done-enter');
        void el.offsetWidth;
        el.classList.add('hw-done-enter');
        setTimeout(() => el.classList.remove('hw-done-enter'), 220);
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

  // 教师账号：VE 作业不计入 overdue/done 分类
  const isTeacherMode = !!window.isTeacherAccount;
  const nativeOverdueCount = isTeacherMode ? 0 : nativeCls.overdue.length;
  const nativeDoneCount = isTeacherMode ? 0 : nativeCls.done.length;
  const nativePendingCount = isTeacherMode ? list.length : nativeCls.pending.length;

  const totalOverdueCount = nativeOverdueCount + yktCls.overdue.length + mrjzyCls.overdue.length + jlgjCls.overdue.length;
  const totalDoneCount = nativeDoneCount + yktCls.done.length + mrjzyCls.done.length + jlgjCls.done.length;
  const totalPendingCount = nativePendingCount + yktCls.pending.length + mrjzyCls.pending.length + jlgjCls.pending.length;
  const totalHomeworkCount = list.length + yktItems.length + mrjzyItems.length + jlgjItems.length;

  const renderHomeworkToggle = (kind, action, isExpanded, count, collapsedText, expandedText, collapsedDirection, expandedDirection) => {
    const direction = isExpanded ? expandedDirection : collapsedDirection;
    const label = `${isExpanded ? expandedText : collapsedText} (${count})`;
    return `<button class="btn homework-toggle-btn ${isExpanded ? 'is-expanded' : ''} homework-toggle-btn--${direction}" data-action="${action}" data-course-id="${escapeHtml(String(courseId))}" data-homework-toggle-kind="${kind}" data-count="${escapeHtml(String(count))}" data-collapsed-text="${escapeHtml(collapsedText)}" data-expanded-text="${escapeHtml(expandedText)}" aria-expanded="${isExpanded ? 'true' : 'false'}"><span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span><span class="homework-toggle-label">${escapeHtml(label)}</span><span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span></button>`;
  };

  // 教师账号：doneToggleRow 始终使用原文案
  const isTeacherMode2 = !!window.isTeacherAccount;
  const doneToggleRowHtml = totalDoneCount > 0 ? `<div class="homework-toggle-row homework-toggle-row--done">${renderHomeworkToggle('done', 'toggle-done', data.showDone, totalDoneCount, '查看已交作业', '收起已交作业', 'down', 'up')}</div>` : '';
  const forcePublishScoreButtonHtml = (!isTeacherMode2 && data.showDone) ? renderForcePublishScoreButton(courseId) : '';

  const renderNativeHomeworkItems = (items) => (items || []).map((hw) => {
    const originalIdx = list.indexOf(hw);
    const idx = originalIdx >= 0 ? originalIdx : 0;
    const subStatus = hw.subStatus ?? hw.sub_status ?? '';
    const subTime = hw.subTime ?? hw.sub_time ?? '';
    const isDone = isNativeHomeworkDone(hw);
    const overdue = !isDone && isNativeHomeworkOverdue(hw);

    // 教师账号：统一蓝色背景，不区分三类；过时作业用紫色
    const isTeacherMode = !!window.isTeacherAccount;
    const bgColor = isTeacherMode
      ? (overdue ? '#ede9fe' : '#dbeafe')
      : (isDone ? '#e8f5e9' : (overdue ? '#ffebee' : '#fff3e0'));
    const borderColor = isTeacherMode
      ? (overdue ? '#a78bfa' : '#93c5fd')
      : (isDone ? '#4caf50' : (overdue ? '#ef4444' : '#ff9800'));
    const titleColor = isTeacherMode
      ? (overdue ? '#6d28d9' : '#1d4ed8')
      : (isDone ? '#2e7d32' : (overdue ? '#b91c1c' : '#e65100'));
    const detailBtnColor = isTeacherMode
      ? (overdue ? '#6d28d9' : '#1d4ed8')
      : (isDone ? '#2E7D32' : (overdue ? '#b91c1c' : '#E65100'));
    const title = hw.title || hw.workTitle || hw.courseNoteTitle || '作业';
    const homeworkTypeLabel = ({ 0: '作业', 1: '课程报告', 2: '实验' })[Number(hw.subType ?? hw.sub_type)] || '作业';
    const homeworkTypeBadge = `<span style="display:inline-block; margin-right:6px; padding:1px 4px; border:1px solid currentColor; border-radius:3px; font-size:10px; line-height:1.3; vertical-align:1px;">${homeworkTypeLabel}</span>`;
    const sub = hw.subStatus || (isDone ? '已提交' : '未提交');
    const time = hw.subTime || '';
    const deadline = hw.end_time || hw.endTime || '';
    const statusHtml = isTeacherMode ? '' : (isDone ? '<span class="homework-status-done">(已提交)</span>' : (overdue ? '<span class="homework-status-overdue">(已逾期)</span>' : ''));

    const obtainedScore = hw.lastScore ?? hw.oldScore ?? hw.old_score ?? hw.finalScore ?? hw.final_score ?? '';
    const fullScore = hw.score ?? hw.fullScore ?? hw.maxScore ?? hw.totalScore ?? '';
    const upId = hw.id ?? hw.upId ?? hw.upid ?? hw.UPID ?? hw.up_id ?? '';
    const snId = hw.snId ?? hw.snid ?? hw.SNID ?? hw.noteSnId ?? hw.note_sn_id ?? '';
    const scoreParam = String(fullScore ?? '').trim() || String(obtainedScore ?? '').trim();
    const scoreViewUrl = (upId && snId) ? `${BASE_VE}back/course/courseWorkInfo.shtml?method=piGaiDiv&upId=${encodeURIComponent(String(upId))}&id=${encodeURIComponent(String(snId))}&uLevel=1&score=${encodeURIComponent(scoreParam || '100')}` : '';
    const scoreKey = buildHomeworkScoreKey(upId, snId);
    const cachedScore = window.homeworkScoreCacheByKey[scoreKey];

    let scoreHtml = '';
    if (isTeacherMode) {
      const shownTotal = String(fullScore || '').trim();
      if (shownTotal) {
        scoreHtml = `<span style="font-weight:bold; color:#1d4ed8; margin-left:5px;">[总分 ${escapeHtml(shownTotal)}]</span>`;
      }
    } else if (cachedScore !== undefined && cachedScore !== null) {
      const totalStr = fullScore ? `/${fullScore}` : '';
      scoreHtml = `<span style="font-weight:bold; color:#E91E63; margin-left:5px;">[${escapeHtml(String(cachedScore))}${escapeHtml(totalStr)}]</span>`;
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
    const attachmentHtml = renderHomeworkAttachments(hw, borderColor, bgColor);
    const expandableBaseBg = isTeacherMode ? (overdue ? 'rgba(237,233,254,0.78)' : 'rgba(219,234,254,0.78)') : (isDone ? 'rgba(232,245,233,0.75)' : 'rgba(255,243,224,0.78)');
    const expandable = renderExpandableHtml(contentHtml, {
      emptyHtml: '<span style="color:#999;">无内容</span>',
      expandText: '点击查看作业详情',
      collapseText: '点击收起作业详情',
      hideWhenEmpty: true,
      baseBg: expandableBaseBg,
      flatDisplay: true,
      courseId,
      expandKey,
      expanded
    });
    const viewBtnColor = isTeacherMode ? '#1d4ed8' : (isDone ? '#2E7D32' : '#0ea5e9');
    const countdownSpan = (!isTeacherMode && !isDone && !overdue && deadline) ? `<span class="deadline-countdown" data-deadline="${escapeHtml(String(deadline))}" style="margin-left:4px; font-weight:normal; color:#e65100"></span>` : '';
    const submitCount = hw.submitCount ?? hw.submit_count ?? hw.subCount ?? '';
    const allCount = hw.allCount ?? hw.all_count ?? hw.totalCount ?? '';
    const submitCountHtml = submitCount !== '' || allCount !== ''
      ? `<span style="margin-left:10px; white-space:nowrap;">提交人数: <span style="font-weight:700; color:#111827;">${escapeHtml(String(submitCount || 0))}/${escapeHtml(String(allCount || 0))}</span></span>`
      : '';

    // 教师账号：作业ID（用于批量下载）
    const homeworkId = String(hw.snId || hw.noteId || hw.courseNoteId || hw.id || hw.upId || '').trim();
    const batchDownloadUrl = homeworkId ? `http://123.121.147.7:88/ve/back/coursePlatform/homeWork.shtml?method=batchDownloadWorks&id=${encodeURIComponent(homeworkId)}` : '';

    // 按钮区域：教师账号显示"下载已交作业包"，否则显示"提交"
    const actionButtonsHtml = isTeacherMode
      ? `<div style="display:flex; align-items:center; gap:6px;">
          ${scoreViewUrl ? `<a class="btn" href="${scoreViewUrl}" target="_blank" rel="noopener noreferrer" style="background:${viewBtnColor}; padding: 2px 8px; font-size: 12px; text-decoration:none; color:#fff;">查看</a>` : ''}
          ${batchDownloadUrl ? `<a class="btn" href="${batchDownloadUrl}" target="_blank" rel="noopener noreferrer" style="background:${detailBtnColor}; padding: 2px 8px; font-size: 12px; text-decoration:none; color:#fff;">下载已交作业包</a>` : '<span style="font-size:12px; color:#999;">无作业包</span>'}
        </div>`
      : `<div style="display:flex; align-items:center; gap:6px;">
          ${scoreViewUrl ? `<a class="btn" href="${scoreViewUrl}" target="_blank" rel="noopener noreferrer" style="background:${viewBtnColor}; padding: 2px 8px; font-size: 12px; text-decoration:none; color:#fff;">查看</a>` : ''}
          <button class="btn" data-action="open-submit" data-course-id="${escapeHtml(String(courseId))}" data-hw-index="${idx}" style="background:${detailBtnColor}; padding: 2px 8px; font-size: 12px;">提交</button>
        </div>`;

    // 提交面板（仅非教师账号显示）
    const submitPanelHtml = isTeacherMode ? '' : `
        <div class="submit-panel" data-submit-panel="1" style="display:none;">
          <textarea data-submit-content="1" placeholder="请输入作业内容（可为空）"></textarea>
          <div class="hint">可勾选左侧上传成功文件一并提交；不勾选则仅提交文本内容。</div>
          <div class="actions">
            <button class="btn confirm-submit-btn" style="background:#2563eb; padding:4px 10px; font-size:12px;" data-action="confirm-submit" data-course-id="${escapeHtml(String(courseId))}" data-hw-index="${idx}">确定</button>
            <button class="btn cancel-submit-btn" style="background:#64748b; padding:4px 10px; font-size:12px;" data-action="cancel-submit">取消</button>
          </div>
        </div>`;

    return `
      <div class="hw-card-item" data-homework-done="${isTeacherMode ? '0' : (isDone ? '1' : '0')}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
          <div>
            <div style="font-weight:bold; color:${titleColor};">${homeworkTypeBadge}${escapeHtml(title)}</div>
            <div style="font-size:12px; color:#666; display:flex; align-items:center; gap:0; flex-wrap:wrap;">截止: <span style="font-weight:700; color:#000; margin-left:3px;">${escapeHtml(deadline || '无')}</span> ${statusHtml}${countdownSpan}${submitCountHtml}</div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            ${scoreHtml ? `<div style="font-size:12px;">${scoreHtml}</div>` : ''}
            ${actionButtonsHtml}
          </div>
        </div>

  ${attachmentHtml}
        ${expandable ? `<div style="margin-top:3px; border-top:1px dashed ${borderColor}40; padding-top:0;">${expandable}</div>` : ''}

        ${submitPanelHtml}
      </div>
    `;
  }).join('');

  const renderHomeworkGroup = (kind) => {
    // 教师账号：VE 作业不分类，直接合并在 teacher group
    if (window.isTeacherAccount) {
      // 外部分类保持不变
      if (kind === 'overdue') {
        return `${renderYktSection(yktOverdueItems)}${renderMrjzySection(mrjzyOverdueItems)}${renderJlgjSection(jlgjOverdueItems)}`;
      }
      if (kind === 'done') {
        return `${renderYktSection(yktDoneItems)}${renderMrjzySection(mrjzyDoneItems)}${renderJlgjSection(jlgjDoneItems)}`;
      }
      return `${renderYktSection(yktPendingItems)}${renderMrjzySection(mrjzyPendingItems)}${renderJlgjSection(jlgjPendingItems)}`;
    }
    if (kind === 'overdue') {
      return `${renderNativeHomeworkItems(nativeOverdueItems)}${renderYktSection(yktOverdueItems)}${renderMrjzySection(mrjzyOverdueItems)}${renderJlgjSection(jlgjOverdueItems)}`;
    }
    if (kind === 'done') {
      return `${renderNativeHomeworkItems(nativeDoneItems)}${renderYktSection(yktDoneItems)}${renderMrjzySection(mrjzyDoneItems)}${renderJlgjSection(jlgjDoneItems)}`;
    }
    return `${renderNativeHomeworkItems(nativePendingItems)}${renderYktSection(yktPendingItems)}${renderMrjzySection(mrjzyPendingItems)}${renderJlgjSection(jlgjPendingItems)}`;
  };

  // 教师账号：VE 作业按过时/非过时分为两组
  const teacherNonOverdueItems = window.isTeacherAccount ? list.filter((hw) => !isNativeHomeworkOverdue(hw)) : [];
  const teacherOverdueItems = window.isTeacherAccount ? list.filter((hw) => isNativeHomeworkOverdue(hw)) : [];
  const teacherNonOverdueHtml = window.isTeacherAccount ? renderNativeHomeworkItems(teacherNonOverdueItems) : '';
  const teacherOverdueHtmlRaw = window.isTeacherAccount ? renderNativeHomeworkItems(teacherOverdueItems) : '';

  const overdueHtml = renderHomeworkGroup('overdue');
  const pendingHtml = renderHomeworkGroup('pending');
  const doneHtml = renderHomeworkGroup('done');

  // 教师模式：将 VE 过时作业合并到 overdue 组中，使用统一折叠切换
  const mergedOverdueHtml = window.isTeacherAccount
    ? `${teacherOverdueHtmlRaw}${overdueHtml}`
    : overdueHtml;

  const overdueCollapsedText = isTeacherMode2 ? '查看过时作业' : '查看逾期作业';
  const overdueExpandedText = isTeacherMode2 ? '收起过时作业' : '收起逾期作业';
  const mergedOverdueCount = window.isTeacherAccount
    ? teacherOverdueItems.length + (totalOverdueCount - nativeOverdueCount)
    : totalOverdueCount;
  const mergedOverdueToggleRowHtml = mergedOverdueCount > 0
    ? `<div class="homework-toggle-row homework-toggle-row--overdue">${renderHomeworkToggle('overdue', 'toggle-overdue', data.showOverdue, mergedOverdueCount, overdueCollapsedText, overdueExpandedText, 'down', 'up')}</div>`
    : '';

  const loadingText = isYktStandalone ? '正在同步雨课堂作业…' : (isMrjzyStandalone ? '正在同步每日交作业…' : '正在获取作业…');
  const standaloneSyncing = isYktStandalone ? (yktLoading || yktSyncing) : (isMrjzyStandalone ? mrjzySyncing : jlgjSyncing);
  const loadingHtml = isExternalStandalone && standaloneSyncing ? `<div class="spinner" style="border-color:#2196F3; border-top-color:transparent; display:inline-block;"></div> ${loadingText}` : '';
  const emptyExternalTip = isExternalStandalone && totalHomeworkCount === 0 && !standaloneSyncing ? '<span style="color:#999;">没有作业数据</span>' : '';
  const noPendingTip = !isTeacherMode2 && totalHomeworkCount > 0 && totalPendingCount === 0
    ? `<div class="homework-empty-tip" style="color:#4CAF50; margin-top:2px;">${totalOverdueCount > 0 ? '✓ 没有作业待交' : '✓ 所有作业已交'}</div>`
    : '';
  const noRelatedTip = !isTeacherMode2 && !pendingHtml && totalHomeworkCount > 0 && !noPendingTip ? '<span class="homework-empty-tip" style="color:#999;">无未交作业</span>' : '';
  const noDataTip = !isExternalStandalone && totalHomeworkCount === 0 ? '<span style="color:#999;">没有作业数据</span>' : '';

  // 教师账号：VE 非过时作业始终可见（蓝色）
  const teacherNonOverdueSectionHtml = (window.isTeacherAccount && teacherNonOverdueHtml)
    ? `<div class="homework-group homework-group--pending" data-homework-group="teacher-active">${teacherNonOverdueHtml}</div>`
    : '';

  area.innerHTML = `${loadingHtml}${emptyExternalTip}${noDataTip}${mergedOverdueToggleRowHtml}${mergedOverdueHtml ? `<div class="homework-group homework-group--overdue ${data.showOverdue ? '' : 'is-hidden'}" data-homework-group="overdue" data-expanded="${data.showOverdue ? '1' : '0'}" aria-hidden="${data.showOverdue ? 'false' : 'true'}">${mergedOverdueHtml}</div>` : ''}${teacherNonOverdueSectionHtml}${pendingHtml ? `<div class="homework-group homework-group--pending" data-homework-group="pending">${pendingHtml}</div>` : ''}${noPendingTip || noRelatedTip}${doneToggleRowHtml}${forcePublishScoreButtonHtml}${doneHtml ? `<div class="homework-group homework-group--done ${data.showDone ? '' : 'is-hidden'}" data-homework-group="done" data-expanded="${data.showDone ? '1' : '0'}" aria-hidden="${data.showDone ? 'false' : 'true'}">${doneHtml}</div>` : ''}`;
  applyExpandableAutoToggle();
  applyDoneEnterAnimation();
  refreshUploadSelectVisibility();
  setTimeout(() => typeof updateAllCountdowns === 'function' && updateAllCountdowns(), 0);
}






// Videos (best-effort implementation)
async function fetchVideoLinkInternal(containerId, videoId, courseNum, fzId, teacherId, { signal = null, onLinkExpired = null } = {}) {
  const getLinksDiv = () => document.getElementById(containerId);
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  if (!getLinksDiv()) return false;

  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: String(videoId) });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480&courseId=${encodeURIComponent(courseNum)}&dataSource=1&cId=122618&xkhId=${encodeURIComponent(fzId)}&xqCode=${encodeURIComponent(getCurrentXqCode())}&teacherId=${encodeURIComponent(teacherId)}`;

    const { text, res } = await fetchText(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString(),
      signal: getCombinedAbortSignal(window.globalVeAbortController?.signal, signal)
    });

    if (isLikelyLoginPageHtml(text, res?.url)) {
      if (typeof onLinkExpired === 'function') onLinkExpired();
      const linksDiv = getLinksDiv();
      if (linksDiv) linksDiv.innerHTML = '<span class="error" style="color:#f44336;">[登录已失效，正在重启]</span>';
      await restartVePlatformForLoginExpired('回放下载链接登录已失效，正在重启智慧课程平台…');
      return 'LOGIN_REQUIRED';
    }

    if (isStale()) return false;

    const detailData = parseVeJson(text);

    if (detailData.flag === false || (String(detailData.STATUS) === '1' && String(detailData.ERRMSG || '').includes('不合法'))) {
      const linksDiv = getLinksDiv();
      if (!linksDiv) return false;
      if (isStale()) return false;

      if (typeof onLinkExpired === 'function') onLinkExpired();
      linksDiv.innerHTML = '<span class="error" style="color:#f44336;">[登录已失效，正在重启]</span>';
      await restartVePlatformForLoginExpired('回放下载链接登录已失效，正在重启智慧课程平台…');
      return 'LOGIN_REQUIRED';
    }

    // New/alt format: {flag:true, html:"<a...>"}
    const html = (detailData.html || '').trim();
    if (html && (detailData.flag === true || String(detailData.STATUS) === '0')) {
      const linksDiv = getLinksDiv();
      if (!linksDiv) return false;
      if (isStale()) return false;
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
    if (isStale()) return false;
    if (typeof onLinkExpired === 'function') onLinkExpired();
    linksDiv.style.color = '#9C27B0';
    linksDiv.style.fontWeight = 'bold';
    linksDiv.innerHTML = '<span class="error" style="color:#f44336;">[链接获取失败，正在重启]</span>';
    await restartVePlatformForLoginExpired('回放下载链接获取失败，正在重启智慧课程平台…');
    return 'LOGIN_REQUIRED';
  } catch (e) {
    const linksDiv = getLinksDiv();
    if (e?.name === 'AbortError') return false;
    if (String(e?.message || e) === 'LOGIN_REQUIRED') return 'LOGIN_REQUIRED';
    if (typeof onLinkExpired === 'function') onLinkExpired();
    if (linksDiv) linksDiv.innerHTML = '<span class="error" style="color:#f44336;">[链接获取失败，正在重启]</span>';
    await restartVePlatformForLoginExpired('回放下载链接获取失败，正在重启智慧课程平台…');
    return 'LOGIN_REQUIRED';
  }
}

window.__fetchVideoDetail = async function(rpId, courseId, xkhId, teacherId, btnEl) {
  const container = btnEl.closest('div');
  const span = container.querySelector('.video-link');
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  span.textContent = '获取中…';
  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: rpId });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480&courseId=${encodeURIComponent(courseId)}&dataSource=1&cId=122618&xkhId=${encodeURIComponent(xkhId)}&xqCode=${encodeURIComponent(getCurrentXqCode())}&teacherId=${encodeURIComponent(teacherId)}`;
    const { text, res } = await fetchText(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString()
    });

    if (isStale()) return;

    if (isLikelyLoginPageHtml(text, res?.url)) {
      span.innerHTML = '<span class="error" style="color:#f44336;">[登录已失效，正在重启]</span>';
      await restartVePlatformForLoginExpired('回放下载链接登录已失效，正在重启智慧课程平台…');
      return;
    }

    const data = JSON.parse(text);
    if (data?.flag === false || (data?.STATUS === '1' && String(data?.ERRMSG || '').includes('不合法'))) {
      if (isStale()) return;
      span.innerHTML = '<span class="error" style="color:#f44336;">[登录已失效，正在重启]</span>';
      await restartVePlatformForLoginExpired('回放下载链接登录已失效，正在重启智慧课程平台…');
      return;
    }
    const html = data?.html || '';
    if (!html) {
      if (isStale()) return;
      span.textContent = '未返回链接';
      return;
    }
    // Best-effort: find first http(s) link
    const m = html.match(/https?:\/\/[^\s"']+/);
    if (m?.[0]) {
      if (isStale()) return;
      span.innerHTML = `<a class="url-link" href="${m[0]}" target="_blank">${m[0]}</a>`;
    } else {
      if (isStale()) return;
      span.textContent = '已返回 HTML（未解析出直链）';
    }
  } catch (e) {
    if (isStale()) return;
    span.textContent = 'Err: ' + e.message;
  }
};


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

if (resourceSelectAllBtn) {
  resourceSelectAllBtn.addEventListener('click', () => {
    const ids = getResourceSpaceSelectableIds();
    if (!ids.length) {
      showToast('当前资源空间无可选文件', 'warning', 1200);
      return;
    }
    invertResourceSpaceSelectionByVisibleItems();
  });
}

if (resourceSearchInput instanceof HTMLInputElement) {
  const submitSearch = () => {
    const keyword = normalizeResourceSearchKeyword(resourceSearchInput.value);
    if (keyword === resourceSpaceSearchKeyword) return;
    loadResourceSpaceForCurrentAccount(keyword).catch(() => {});
  };
  resourceSearchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submitSearch();
  });
  resourceSearchInput.addEventListener('blur', () => {
    submitSearch();
  });
}

if (resourceDownloadSelectedBtn) {
  resourceDownloadSelectedBtn.addEventListener('click', () => {
    const selected = getSelectableDownloadItems().filter((it) => {
      const rid = String(it.id || '').trim();
      return window.resourceSpaceSelected.has(rid) && !isResourceDownloadActive(rid);
    });
    if (!selected.length) {
      showToast('请先选择文件', 'warning', 1200);
      return;
    }

    const hasActiveOrQueued = Object.values(window.resourceDownloadTasks || {}).some((t) => !!t?.active)
      || (window.resourceDownloadQueue || []).some((q) => q && !q.cancelled);
    if (!hasActiveOrQueued) {
      window.resourceDownloadCompletedContribution = { loadedBytes: 0, totalBytes: 0 };
      window.resourceDownloadQueueStatus = { totalFiles: 0, savedFiles: 0 };
    }

    let queuedCount = 0;
    selected.forEach((item, idx) => {
      const rid = String(item?.id || '').trim();
      if (!rid) return;
      queuedCount++;
      setResourceSpaceStatus(`下载队列 ${Math.min(selected.length, idx + 1)}/${selected.length}: ${String(item?.name || '未命名文件')}`);
      enqueueResourceDownload(item).then(() => {
        window.resourceDownloadQueueStatus.savedFiles = Math.max(0, Number(window.resourceDownloadQueueStatus?.savedFiles || 0) + 1);
        refreshResourceQueueStatusText();
      }).catch((err) => {
        const msg = String(err?.message || err || '');
        if (msg.includes('下载已取消')) {
          showToast(`已取消: ${String(item?.name || '未命名文件')}`, 'info', 1200);
          refreshResourceQueueStatusText();
          return;
        }
        showToast(`下载失败: ${String(item?.name || '未命名文件')} (${msg})`, 'error', 2200);
        refreshResourceQueueStatusText();
      });
      window.resourceSpaceSelected.delete(rid);
    });

    refreshResourceSelectAllButton();
    if (queuedCount > 0) {
      const prevTotal = Math.max(0, Number(window.resourceDownloadQueueStatus?.totalFiles || 0));
      window.resourceDownloadQueueStatus.totalFiles = prevTotal + queuedCount;
      refreshResourceQueueStatusText();
      showToast(`已加入队列 ${queuedCount} 个文件`, 'success', 1200);
    }
  });
}

if (loginBtn) loginBtn.addEventListener('click', doLoginFlow);
if (cancelBtn) cancelBtn.addEventListener('click', () => dismissLoginModal());

// Delegated handlers (extension CSP blocks inline onclick)
courseListDiv.addEventListener('mouseover', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const wrap = t.closest('.ve-course-num-wrap');
  if ((wrap instanceof HTMLElement)) {
    const from = e.relatedTarget;
    if (from instanceof Node && wrap.contains(from)) return;
    const courseId = String(wrap.dataset.courseId || '').trim();
    const courseNum = String(wrap.dataset.courseNum || '').trim();
    const fzId = String(wrap.dataset.fzId || '').trim();
    if (!courseId || !courseNum) return;
    hydrateVeCourseTeachersMeta(courseId, courseNum, fzId).catch(() => {});
    return;
  }
  // 教师姓名悬停
  const teacherWrap = t.closest('.ve-teacher-wrap');
  if ((teacherWrap instanceof HTMLElement)) {
    const from = e.relatedTarget;
    if (from instanceof Node && teacherWrap.contains(from)) return;
    const courseId = String(teacherWrap.dataset.courseId || '').trim();
    if (!courseId) return;
    const card = teacherWrap.closest('.file-item');
    const courseNumWrap = card?.querySelector('.ve-course-num-wrap');
    const courseNum = String(courseNumWrap?.dataset?.courseNum || '').trim();
    if (!courseNum) return;
    hydrateVeTeacherMeta(courseId, courseNum, '').catch(() => {});
    return;
  }
});

courseListDiv.addEventListener('click', async (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const actionEl = t.closest('[data-action]');
  if (!(actionEl instanceof HTMLElement)) return;
  const action = String(actionEl.dataset.action || '').trim();

  if (action === 'courseware' || action === 'videos') {
    const card = actionEl.closest('.file-item[id^="course-"]');
    if (!(card instanceof HTMLElement)) return;
    const rawId = String(card.dataset.courseId || card.id.replace(/^course-/, '') || '').trim();
    if (!rawId) return;
    const meta = card.querySelector('.ve-course-num-wrap');
    const courseNum = String(actionEl.dataset.courseNum || meta?.dataset?.courseNum || rawId).trim();
    const fzId = String(actionEl.dataset.fzId || meta?.dataset?.fzId || '').trim();
    e.preventDefault();
    e.stopPropagation();
    if (action === 'courseware') {
      toggleCoursewareFromCache(actionEl, rawId, courseNum, fzId);
    } else {
      actionEl.dataset.courseNum = courseNum;
      actionEl.dataset.fzId = fzId;
      toggleReplayFromCache(actionEl, rawId);
    }
    return;
  }

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

  if (action === 'toggle-overdue') {
    const courseId = String(actionEl.dataset.courseId || '').trim();
    if (!courseId) return;
    if (!window.courseShowOverdueById?.[courseId]) void loadDeferredYktHomeworkDetails(courseId, 'overdue');
    window.toggleOverdueView(courseId);
    return;
  }
  if (action === 'toggle-done') {
    const courseId = String(actionEl.dataset.courseId || '').trim();
    if (!courseId) return;
    if (!window.courseShowDoneById?.[courseId]) void loadDeferredYktHomeworkDetails(courseId, 'done');
    window.toggleDoneView(courseId);
    return;
  }
  if (action === 'force-publish-scores') {
    const courseId = String(actionEl.dataset.courseId || '').trim();
    if (!courseId) return;
    e.preventDefault();
    e.stopPropagation();
    await forcePublishScoresThenRestore(courseId, actionEl instanceof HTMLButtonElement ? actionEl : null);
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

    const data = window.courseHomeworkData[courseId] || { list: [] };
    const hw = (data.list || [])[idx];
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
    btn.textContent = '提交中…';
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
      hw.subTime = formatMrjzyDateTime(new Date());
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
    const rawTarget = e.target;
    const t = rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement;
    if (!(t instanceof HTMLElement)) return;

    const titleRow = t.closest('.resource-row-title');
    if (titleRow instanceof HTMLElement && !t.closest('a,button,input,textarea,select,label')) {
      const rowScope = titleRow.closest('.file-item') || titleRow;
      const cb = rowScope.querySelector('input[data-action="resource-check"][data-resource-id]');
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
      navigator.clipboard.writeText(cleanRpUrl(String(item.url || ''), { keepG: true })).then(() => {
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
        if (!item.url && item.rpId) {
          const result = await fetchCoursewareRpUrl(item.rpId);
          const rpUrl = String(result?.url || '').trim();
          if (rpUrl) {
            item.url = rpUrl;
          } else if (result?.loginExpired) {
            await restartVePlatformForLoginExpired('课件下载链接获取失败，正在重启智慧课程平台…');
            showToast('获取下载链接失败', 'error', 1800);
            return;
          } else {
            showToast('获取下载链接失败', 'error', 1800);
            return;
          }
        }
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
      refreshResourceSelectAllButton();
      return;
    }
    if (t.checked) window.resourceSpaceSelected.add(id);
    else window.resourceSpaceSelected.delete(id);
    refreshResourceSelectAllButton();
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
  if (action === 'archive-batch-download') {
    e.preventDefault();
    e.stopPropagation();
    downloadCourseArchive(String(t.dataset.courseId || '').trim());
    return;
  }
  if (action === 'courseware-select-all') {
    const card = t.closest('[id^="course-"]');
    toggleCoursewareSelectionForCard(card);
    return;
  }
  if (!['resource-check', 'resource-copy', 'resource-download', 'resource-cancel-download'].includes(action)) return;
  const id = String(t.dataset.resourceId || '').trim();
  if (!id) return;
  const item = findSelectableDownloadItemById(id);
  if (!item) return;

  if (action === 'resource-check' && t instanceof HTMLInputElement) {
    if (t.checked) window.resourceSpaceSelected.add(id);
    else window.resourceSpaceSelected.delete(id);
    const card = t.closest('[id^="course-"]');
    syncCoursewareSelectAllButton(card);
    refreshResourceSelectAllButton();
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
    const card = t.closest('[id^="course-"]');
    syncCoursewareSelectAllButton(card);
    refreshResourceSelectAllButton();
    return;
  }
  if (t.checked) window.resourceSpaceSelected.add(id);
  else window.resourceSpaceSelected.delete(id);
  const card = t.closest('[id^="course-"]');
  syncCoursewareSelectAllButton(card);
  refreshResourceSelectAllButton();
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

let initialUsernameSet = true;
let loginFlowUsernameSet = false;
usernameInput.addEventListener('change', async () => {
  if (initialUsernameSet) { initialUsernameSet = false; return; }
  if (loginFlowUsernameSet || isLoginInProgress) return;

  const username = String(usernameInput.value || '').trim();
  usernameChangeVersion += 1;
  try { usernameChangeAbortController?.abort(); } catch {}
  usernameChangeAbortController = new AbortController();

  if (!username) {
    await setLocal('username', '');
    setWelcomeMessage(null);
    renderLoginAccountHistorySelect('');
    lastValidUsername = '';
    pendingUsernameChange = null;
    resetAccountSwitchInterruption();
    isLoginSessionValid = false;
    updateJsessionidState();
    showToast('账号已清空：可直接填写 JSESSIONID', 'info', 2500);
    await loadResourceSpaceForCurrentAccount();
    return;
  }

  if (username !== String(lastValidUsername || '').trim()) {
    pendingUsernameChange = lastValidUsername ? { from: lastValidUsername, to: username } : null;
    if (!accountSwitchInterruptionArmed) prioritizeAccountSwitch();
  }
  highPrioritySwitchTarget = '';
  await doLoginFlow();
});

if (accountHistorySelect instanceof HTMLSelectElement) {
  accountHistorySelect.addEventListener('change', () => {
    if (isSyncingAccountHistorySelect) return;
    adjustAccountHistorySelectWidth();
    const picked = String(accountHistorySelect.value || '').trim();
    if (!picked) return;
    const current = String(usernameInput.value || '').trim();
    if (picked === current) return;
    highPrioritySwitchTarget = picked;
    usernameInput.value = picked;
    usernameInput.dispatchEvent(new Event('change'));
  });
}

  jsessionidInput.addEventListener('change', async () => {
    if (jsessionidInput.readOnly) return;
    const v = jsessionidInput.value.trim();
    if (!v) return;
    await setLocal('jsessionid', v);
    await reconcileJsessionidCookies(v);
    isLoginSessionValid = true;
    showToast('已保存 JSESSIONID，正在验证…', 'info', 1500);
    if (isPlatformEnabled('ve')) {
      await reloadVePlatformFromSession({ reloadCourses: true, reloadResourceSpace: true });
    } else {
      await loadResourceSpaceForCurrentAccount();
    }
  });


// -------------------- Init --------------------
(async function init() {
  setupRightColumnResizer();
  updateTotalProgress();
  updateResourceDownloadTotals();
  await loadPlatformEnabledFromStorage();
  await loadPlatformVisibleFromStorage();
  window.BjtuMoocPlatform?.init({
    courseList: courseListDiv,
    escape: escapeHtml,
    toast: showToast,
    setState: (state) => setPlatformLoginState('mooc', state),
    setLoaded: (loaded) => { window.platformLoadedOnce.mooc = !!loaded; },
    updateEmpty: updateCourseListEmptyPlaceholder,
    scheduleCache: () => scheduleFullscreenCourseCacheSave(200),
    normalizeHtml: normalizeHomeworkContent,
    renderExpandable: renderExpandableHtml,
    isDetailExpanded: isHomeworkDetailExpanded,
    applyExpandableAutoToggle,
    updateCountdowns: updateAllCountdowns,
    animateHomeworkGroupVisibility,
    sortCourseCards: () => sortCourseCardsWithGuard(),
    loginRequired: () => openMoocLoginAssistPopup(true)
  });
  await loadPopupCacheEnabledSetting();
  const showAutoLoadResourcesDisabledNotice = await migrateAutoLoadCourseResourcesDefaultOff();
  await loadAutoLoadCourseResourcesSetting();
  await loadPlatformDetailSettings();
  await loadSaveUploadsEnabledSetting();
  setupOptionsStorageLiveSync();
  document.documentElement.classList.remove('app-options-loading');
  if (showAutoLoadResourcesDisabledNotice) showAutoLoadCourseResourcesDisabledNotice();
  setupPortalUsernameBindMessageListener();
  setupAcademicSystemMessageListener();
  const restoredPopupCache = await restorePopupFullscreenCacheIfNeeded();
  if (popupMode && !restoredPopupCache) {
    window.platformEnabled = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false };
  }
  if (popupMode || !window.__updateCheckerLoaded) {
    const versionInfoEl = document.getElementById('version-info');
    if (versionInfoEl) versionInfoEl.style.display = 'none';
  }
  refreshPlatformLoginTip();

  if (restoredPopupCache) {
    await loadLoginAccountHistory();
    if (isPlatformEnabled('ve')) {
      const currentUser = await globalThis.BjtuAccountLogin?.getCurrentUserInfo?.().catch(() => null);
      if (currentUser) {
        await globalThis.BjtuAccountLogin?.ensureCurrentAccountStored?.(currentUser).catch(() => null);
      }
    }
    await loadSavedUploadsFromStorage();
    setupSavedUploadsUi();
    lastValidUsername = (await getLocal('username', '')).trim();
    usernameInput.value = lastValidUsername;
    const savedParallelLimit = parseInt(await getLocal(PARALLEL_LIMIT_KEY, String(maxParallelUploads)), 10);
    if (savedParallelLimit > 0) {
      maxParallelUploads = savedParallelLimit;
      if (parallelLimitInput instanceof HTMLInputElement) {
        parallelLimitInput.value = String(savedParallelLimit);
      }
    }
    globalThis.adjustParallelLimitWidth?.();
    renderLoginAccountHistorySelect(lastValidUsername);
    updateJsessionidState();
    setWelcomeMessage(null);
    refreshUploadSelectVisibility();
    bindCourseCardActionButtons(courseListDiv);
    // popup 缓存恢复分支会提前结束 init；这里必须解除启动期保护，
    // 否则用户第一次手动切换账号会被误判为程序赋值而被忽略。
    initialUsernameSet = false;
    return;
  }

  setupFullscreenCourseCacheObserver();

  await loadLoginAccountHistory();
  try {
    if (forceAccountListInitialization) {
      await globalThis.BjtuAccountLogin?.initialize?.({ force: true, showProgress: true });
    } else {
      await globalThis.BjtuAccountLogin?.ensureInitialized?.({ showProgress: true });
    }
  } catch (error) {
    showToast('账号列表初始化失败：' + String(error?.message || error), 'error', 4000);
  }

  // VE startup owns both course and resource-space loading so account synchronization
  // cannot invalidate an independent resource request and leave its loading UI stale.
  const startupPlatformLoadPromise = triggerInitialPlatformLoads();

  await loadCurrentXqOptions().catch(() => {});

  // 本地保存已上传文件：加载并绑定 UI
  await loadSavedUploadsFromStorage();
  setupSavedUploadsUi();

  // 不默认使用本地保存账号。
  lastValidUsername = (await getLocal('username', '')).trim();
  let welcomeInfoUserId = '';
  let welcomeInfo = null;
  usernameInput.value = lastValidUsername;
  const savedParallelLimit = parseInt(await getLocal(PARALLEL_LIMIT_KEY, String(maxParallelUploads)), 10);
  if (savedParallelLimit > 0) {
    maxParallelUploads = savedParallelLimit;
    if (parallelLimitInput instanceof HTMLInputElement) {
      parallelLimitInput.value = String(savedParallelLimit);
    }
  }
  globalThis.adjustParallelLimitWidth?.();
  const settled = await Promise.allSettled([startupPlatformLoadPromise]);
  const startupAccountInfo = (settled[0] && settled[0].status === 'fulfilled') ? settled[0].value : null;
  if (startupAccountInfo?.info) {
    setWelcomeMessage(startupAccountInfo.info);
  } else {
    setWelcomeMessage(null);
  }
  renderLoginAccountHistorySelect(lastValidUsername);
  updateJsessionidState();
  scheduleFullscreenCourseCacheSave(1200);

  await syncJsessionidToUi();

  // Mark session as valid if we have a saved username; avoids unnecessary login prompts
  if (lastValidUsername) isLoginSessionValid = true;

  // 确保 init 完成后的首次账号切换不会被 initialUsernameSet 拦截
  initialUsernameSet = false;

  // startupPlatformLoadPromise already includes VE resource-space loading.
})();
