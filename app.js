const BASE = 'http://123.121.147.7:88';
const BASE_VE = `${BASE}/ve/`;
const VE_LOGIN_LINK_HTML = `<a href="${BASE_VE}" target="_blank" rel="noopener noreferrer" style="color:#1565c0; text-decoration:none; font-weight:600;">智慧课程平台</a>`;
const VE_LOGIN_REQUIRED_HTML = `如需查看${VE_LOGIN_LINK_HTML}作业，请前往登录`;
const YKT_LOGIN_LINK_HTML = '<a href="https://www.yuketang.cn/web" target="_blank" rel="noopener noreferrer" style="color:#5096f5; text-decoration:none; font-weight:600;">雨课堂</a>';
const YKT_LOGIN_REQUIRED_HTML = `如需查看${YKT_LOGIN_LINK_HTML}作业，请前往登录`;
const MRJZY_LOGIN_LINK_HTML = '<a href="https://zuoye.lulufind.com/" target="_blank" rel="noopener noreferrer" style="color:#29a9fc; text-decoration:none; font-weight:600;">每日交作业</a>';
const MRJZY_LOGIN_REQUIRED_HTML = `如需查看${MRJZY_LOGIN_LINK_HTML}作业，请前往登录`;
const JLGJ_LOGIN_LINK_HTML = '<a href="https://i.jielong.com/my-class" target="_blank" rel="noopener noreferrer" style="color:#ffd243; text-decoration:none; font-weight:600;">接龙管家</a>';
const JLGJ_LOGIN_REQUIRED_HTML = `如需查看${JLGJ_LOGIN_LINK_HTML}作业，请前往登录`;
const YKT_BASE = 'https://www.yuketang.cn';
const YKT_EXAM_BASE = 'https://examination.xuetangx.com';
const YKT_COURSE_LIST_API = `${YKT_BASE}/v2/api/web/courses/list?identity=2`;
const YKT_HEADERS = {
  'uv-id': '0',
  'xt-agent': 'web',
  xtbz: 'ykt',
  Accept: 'application/json, text/plain, */*'
};
const MRJZY_API_BASE = 'https://lulu.lulufind.com';
const MRJZY_WEB_BASE = 'https://zuoye.lulufind.com';
const MRJZY_WORK_LIST_API = `${MRJZY_API_BASE}/mrzy/mrzypc/findWorkNewVersion`;
const MRJZY_WORK_DETAIL_API = `${MRJZY_API_BASE}/mrzy/mrzypc/getWorkDetail`;
const JLGJ_API_BASE = 'https://i-api.jielong.com';
const JLGJ_WEB_BASE = 'https://i.jielong.com/my-class';
const JLGJ_GROUP_LIST_API = `${JLGJ_API_BASE}/api/UserGroup/UserGroupPages?pageIndex=1&pageSize=20`;
const JLGJ_LOGIN_ASSIST_URL = 'https://i.jielong.com/login?redirectTo=https://i.jielong.com/my-class';
const JLGJ_LOGIN_SUCCESS_URL_PREFIX = 'https://i.jielong.com/my-class';
const YKT_WECHAT_QR_LOGIN_URL = 'https://open.weixin.qq.com/connect/qrconnect?appid=wxda8c70bb118d342b&scope=snsapi_login&redirect_uri=https://www.yuketang.cn/api/v3/user/login/wechat-web-callback';
const YKT_WECHAT_LOGIN_SUCCESS_URL_PREFIX = 'https://www.yuketang.cn/authorize/wx-qrlogin?success=1';
const MRJZY_QR_GEN_API = 'https://api-prod.lulufind.com/api/v1/auth/genQrCode';
const MRJZY_QR_CHECK_API = 'https://api-prod.lulufind.com/api/v1/auth/checkQrCode';
const MRJZY_QR_SCAN_LINK_BASE = 'https://f.mrzuoye.com/pcscan/';
const PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS = 1000;
const DEFAULT_PLATFORM_SESSION_ID = 'D571D57D255EA0BECF299C45D4C0468A';
const AUXILIARY_LOGIN_ID = '8888';
const AUXILIARY_LOGIN_PASSWORD_MD5 = 'a8376785625a7dc956506a7a444b720c';

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
function parseVeJson(text) {
  const s = String(text || '{}').trim();
  return JSON.parse(s.startsWith('{}') ? s.slice(2) : s);
}

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
        <p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#334155;">这个页面是扩展的工作台，只能在浏览器扩展环境中使用。请先打开 <span style="font-weight:700;color:#0f172a;">about:extensions</span>，再点击“加载已解压的扩展程序”载入本目录。</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
          <a href="about:extensions" style="display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;">打开 about:extensions</a>
          <span style="color:#64748b;font-size:13px;">通过扩展入口打开时不会显示这条提示。</span>
        </div>
      </div>
    </div>`;
}

const extensionRuntimeId = typeof chrome !== 'undefined' && chrome?.runtime ? String(chrome.runtime.id || '').trim() : '';
if (location.protocol !== 'chrome-extension:' || !extensionRuntimeId) {
  renderDirectOpenNotice();
  throw new Error('Direct app.html open is not supported outside the extension runtime.');
}

const popupMode = new URLSearchParams(String(location.search || '')).get('popup') === '1';
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
window.coursewareCacheByCourseId = {}; // {courseId: {html: string, loaded: boolean}}
window.platformNeedLogin = { ve: false, ykt: false, mrjzy: false, jlgj: false };
window.platformLoginState = { ve: 'checking', ykt: 'checking', mrjzy: 'checking', jlgj: 'checking' }; // checking|offline|online
window.platformLoginChecked = { ve: false, ykt: false, mrjzy: false, jlgj: false };
window.platformInteractiveLoginPending = { ykt: false, mrjzy: false, jlgj: false };
const DEFAULT_PLATFORM_ENABLED = { jlgj: false, mrjzy: false, ve: true, ykt: false };
window.platformEnabled = { ...DEFAULT_PLATFORM_ENABLED };
window.platformLoadedOnce = { ve: false, ykt: false, mrjzy: false, jlgj: false };
window.platformLoadVersion = { ve: 0, ykt: 0, mrjzy: 0, jlgj: 0 };
window.currentVeCourseList = [];
window.homeworkScoreCacheByKey = {}; // {"upId|snId": string}
window.homeworkScorePendingByCourse = {}; // {courseId: boolean}
window.homeworkNoteAttachmentCacheByKey = {}; // {"noteId|courseId|teacherId": {loading,loaded,picList}}
window.homeworkAttachmentPendingByCourse = {}; // {courseId: boolean}
window.uploadedFileMetaById = {}; // {fileId: {fileNameNoExt,fileExtName,fileSize,visitName,pid,ftype}}
window.savedUploadedFiles = []; // [{id,fileName,fileSize,visitName,url,savedAt}]
window.saveUploadedFilesEnabled = true;
window.autoLoadCourseResourcesEnabled = true;
window.homeworkDetailExpandedByCourse = {}; // {courseId: {expandKey: boolean}}
window.courseShowOverdueById = {};
window.courseShowDoneById = {};
window.yktDetailCacheByKey = {}; // {detailKey: {state,title,exam_problems,problem_results,promise}}
window.externalPlatformLoadVersion = 0;
window.courseListLoadVersion = 0;
window.veTeacherMetaByCourseId = {}; // {courseId:{teacherId,loading,loaded,teachers:[]}}
window.veCourseTeachersMetaByCourseId = {}; // {courseId:{rows,loading,loaded,error,promise}}
window.veUserNameByTeacherId = {}; // {teacherId:{name:string|null,promise:Promise|null}} — 学生账号用 getUserInfo 解析教师姓名
window.resourceSpaceItems = []; // [{id,name,url,inputTime}]
window.resourceSpaceSelected = new Set();
window.coursewareItemsById = {}; // {resourceId: {id,name,url,extName,courseId}}
window.coursewareItemsByCourseId = {}; // {courseId: CoursewareItem[]}
window.homeworkAttachmentItemsById = {}; // {resourceId: {id,name,url,extName,courseId,sizeMbRaw,sizeMb}}
window.homeworkAttachmentItemsByCourseId = {}; // {courseId: HomeworkAttachmentItem[]}
window.resourceSpaceLoadVersion = 0;
window.currentAccountLoginName = ''; // loginName from getUserInfo
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
let yktLoginAssistRetryTimer = null;
let yktLoginAssistPollTimer = null;
let yktLoginAssistChecking = false;
let yktLoginAssistPopupWindowId = null;
let yktLoginAssistPopupTabId = null;
let yktLoginIframeLoadCount = 0;
let yktLoginIframeOpenedAt = 0;
let mrjzyLoginAssistPollTimer = null;
let mrjzyLoginAssistRetryTimer = null;
let mrjzyLoginAssistPolling = false;
let mrjzyLoginAssistCurrentCode = '';
let mrjzyLoginAssistCodeSerial = 0;
let jlgjLoginAssistRetryTimer = null;
let jlgjLoginAssistPollTimer = null;
let jlgjLoginAssistPopupWindowId = null;
let jlgjLoginAssistPopupTabId = null;

function normalizePlatformId(platform) {
  const p = String(platform || '').trim();
  if (p === 'mrjzy') return 'mrjzy';
  return ['ve', 'ykt', 'jlgj'].includes(p) ? p : 've';
}

function isPlatformEnabled(platform) {
  const p = normalizePlatformId(platform);
  return window.platformEnabled?.[p] === true;
}

function sanitizePlatformEnabled(raw, fallback = DEFAULT_PLATFORM_ENABLED) {
  const src = (raw && typeof raw === 'object') ? raw : null;
  return {
    jlgj: typeof src?.jlgj === 'boolean' ? src.jlgj : !!fallback.jlgj,
    mrjzy: typeof src?.mrjzy === 'boolean' ? src.mrjzy : !!fallback.mrjzy,
    ve: typeof src?.ve === 'boolean' ? src.ve : !!fallback.ve,
    ykt: typeof src?.ykt === 'boolean' ? src.ykt : !!fallback.ykt
  };
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
  if (!['ve', 'ykt', 'mrjzy', 'jlgj'].includes(p)) return;
  if (!window.platformEnabled?.[p]) return;

  window.platformEnabled[p] = false;
  window.platformLoadedOnce[p] = false;
  window.platformNeedLogin[p] = false;
  bumpPlatformLoadVersion(p);

  savePlatformEnabledToStorage().catch(() => {});
}

const AUTO_LOAD_COURSE_RESOURCES_KEY = 'autoLoadCourseResourcesEnabled';

async function loadAutoLoadCourseResourcesSetting() {
  try {
    const data = await chrome.storage.local.get([AUTO_LOAD_COURSE_RESOURCES_KEY]);
    window.autoLoadCourseResourcesEnabled = data[AUTO_LOAD_COURSE_RESOURCES_KEY] === undefined
      ? true
      : !!data[AUTO_LOAD_COURSE_RESOURCES_KEY];
  } catch {
    window.autoLoadCourseResourcesEnabled = true;
  }
}

function isAutoLoadCourseResourcesEnabled() {
  return window.autoLoadCourseResourcesEnabled !== false;
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
  if (!['ykt', 'mrjzy', 'jlgj'].includes(platform)) return;
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
  } else {
    setPlatformLoginState('jlgj', 'checking');
    scheduleJlgjLoad(veCourses, version).catch(() => renderJlgjNeedLoginMessage());
  }
}

async function triggerInitialPlatformLoads() {
  // Keep startup priority consistent across all enabled platforms.
  if (isPlatformEnabled('ykt')) triggerExternalPlatformLoad('ykt', false);
  if (isPlatformEnabled('mrjzy')) triggerExternalPlatformLoad('mrjzy', false);
  if (isPlatformEnabled('jlgj')) triggerExternalPlatformLoad('jlgj', false);
  if (isPlatformEnabled('ve')) {
    await loadCourses();
  } else {
    window.currentVeCourseList = [];
    renderCourseList([]);
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
  if (!platform || !['ve', 'ykt', 'mrjzy', 'jlgj'].includes(platform)) return;
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
      loadCourses().catch(() => {});
      const knownUserId = String(usernameInput.value || lastValidUsername || '').trim();
      if (knownUserId) {
        syncAccountInfoAndReloadVeCourses({
          userId: knownUserId,
          detectFromPortal: false,
          reloadCourses: false,
          reloadResourceSpace: true
        }).catch(() => {});
      }
    }
    return;
  }

  if (platform === 'ykt' || platform === 'mrjzy' || platform === 'jlgj') {
    window.platformInteractiveLoginPending[platform] = !!interactive;
  }

  clearPlatformData(platform);
  rerenderAllHomeworkAreas();
  triggerExternalPlatformLoad(platform, true);
  window.__headerQrUrl = '';
}

function applyPlatformEnabledSettingFromStorage(raw) {
  const next = sanitizePlatformEnabled(raw, window.platformEnabled || DEFAULT_PLATFORM_ENABLED);
  ['ve', 'ykt', 'mrjzy', 'jlgj'].forEach((platform) => {
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
      window.__headerQrUrl = '';
      window.__sectionQrCache = {};
    }

    if (changes.autoCaptcha) {
      const enabled = changes.autoCaptcha.newValue === undefined ? true : !!changes.autoCaptcha.newValue;
      showToast(enabled ? '已启用自动识别验证码' : '已关闭自动识别验证码，将改为手动输入', 'info', 1600);
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
        ? true
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
      showToast(`已绑定快速登录 username：${st.userId || st.quickUsername || ''}`, 'success', 1800);
      loadLoginAccountHistory().catch(() => {});
      if (isPlatformEnabled('ve')) {
        await loadAutoLoadCourseResourcesSetting().catch(() => {});
        window.platformLoadedOnce.ve = false;
        setPlatformLoginState('ve', 'checking');
        loadCourses().catch(() => {});
        loadResourceSpaceForCurrentAccount().catch(() => {});
      }
    })();
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
let loginAccountValidationCache = null; // { userId, ts, validation }
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
    if (cache && !cache.loaded) {
      cache.loaded = false;
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

async function resumeVeAfterAccountSwitchFailure() {
  resetAccountSwitchInterruption();
  if (!isPlatformEnabled('ve')) return;
  try {
    await loadCourses();
  } catch {
    // ignore
  }
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
      const resp = await chrome.runtime.sendMessage({
        type: 'GET_LATEST_RESPONSE_JSESSIONID',
        maxAgeMs
      });
      const rec = resp?.record || null;
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
  // Also set document.cookie in any open VE pages so page scripts detect session immediately
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*/ve/*', '*://*/*/ve/*'] });
    for (const t of tabs || []) {
      if (!t?.id) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: t.id },
          world: 'MAIN',
          func: (val) => {
            try {
              document.cookie = `JSESSIONID=${val}; path=/ve/`;
            } catch (e) {
              // ignore
            }
          },
          args: [jsid]
        });
      } catch (e) {
        // ignore per-tab failures
      }
    }
  } catch (e) {
    // ignore overall failures
  }
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
  doLoginFlow();
}

// -------------------- UI helpers --------------------
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

  // Click to dismiss
  toast.addEventListener('click', () => {
    if (!toast.isConnected) return;
    toast.style.animation = 'fadeOutUp 0.25s ease-in forwards';
    toast.addEventListener('animationend', () => toast.remove());
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
  toast.style.whiteSpace = 'pre-line';
  toast.textContent = '正在后台登录中…';
  const spinner = document.createElement('span');
  spinner.className = 'toast-spinner';
  toast.appendChild(spinner);
  container.appendChild(toast);

  // Click to dismiss sticky toast too
  toast.addEventListener('click', () => {
    if (!toast.isConnected) return;
    toast.style.animation = 'fadeOutUp 0.25s ease-in forwards';
    toast.addEventListener('animationend', () => toast.remove());
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

function renderFileSizeText(bytes, text = '') {
  const n = Math.max(0, Number(bytes) || 0);
  const label = text || formatSize(n);
  return `<span class="file-size-emphasis" style="${escapeHtml(buildFileSizeEmphasisStyle(n))}">${escapeHtml(label)}</span>`;
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
  const percent = Math.min(100, Math.round((totalUploaded / totalSize) * 100));
  totalServerBar.style.width = percent + '%';
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

async function fetchUserInfoRemote(userId = '') {
  try {
    const url = String(userId || '').trim()
      ? `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(userId)}`
      : `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo`;
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

// 通过工号 getUserInfo 解析教师真实姓名（学生账号下使用，覆盖同课教师列表的原始姓名）
// 缓存：window.veUserNameByTeacherId[worknumber] = { name: string|null, promise: Promise|null }
// - 成功结果会缓存（避免重复请求）
// - 失败结果不缓存（下次调用会自动重试）
// - 进行中的 promise 用于并发去重
async function resolveVeUserNameByWorknumber(worknumber) {
  const tid = String(worknumber || '').trim();
  if (!tid) return null;
  if (!window.veUserNameByTeacherId) window.veUserNameByTeacherId = {};
  const cache = window.veUserNameByTeacherId;
  const existing = cache[tid];
  if (existing && existing.name) return existing.name;
  if (existing && existing.promise) return existing.promise;
  const entry = existing || { name: null, promise: null };
  cache[tid] = entry;
  const infoUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(tid)}`;
  const promise = (async () => {
    try {
      const { text } = await fetchText(infoUrl, {
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
      });
      const data = parseVeJson(text);
      if (data && String(data.STATUS) === '0' && data.result) {
        const name = String(data.result.userName || '').trim();
        if (name) entry.name = name;
        return entry.name || null;
      }
      return null;
    } catch {
      // 失败不缓存，下次调用会重新尝试
      return null;
    } finally {
      entry.promise = null;
    }
  })();
  entry.promise = promise;
  return promise;
}

function setWelcomeMessage(info) {
  const loginMsgEl = document.getElementById('login-welcome-msg');
  const loginName = String(info?.loginName || '').trim();
  const displayName = loginName ? `${info?.roleName || ''}${info?.userName || ''}（${loginName}）` : `${info?.roleName || ''}${info?.userName || ''}`;
  const msg = info ? displayName : '';
  if (loginMsgEl) loginMsgEl.textContent = msg;
}

async function syncAccountInfoAndReloadVeCourses({
  userId = '',
  detectFromPortal = false,
  reloadCourses = true,
  reloadResourceSpace = true,
  expectedUserId = '',
  knownUserInfo = null
} = {}) {
  // 若要重载课程，先中止所有进行中的课件/回放请求
  if (reloadCourses) {
    prioritizeAccountSwitch();
  }
  let finalUser = String(userId || '').trim();
  if (!finalUser && detectFromPortal) {
    try {
      const detected = String(await detectUserIdFromPersonalCenter() || '').trim();
      if (detected) finalUser = detected;
    } catch {
      // ignore
    }
  }
  if (!finalUser) {
    finalUser = String(usernameInput.value || '').trim() || String(lastValidUsername || '').trim();
  }

  if (finalUser) {
    usernameInput.value = finalUser;
    await setLocal('username', finalUser);
    lastValidUsername = finalUser;
    isLoginSessionValid = true;
  }
  pendingUsernameChange = null;
  renderLoginAccountHistorySelect(finalUser);
  updateJsessionidState();
  const jsessionSyncPromise = syncJsessionidToUi().catch(() => {});
  resetAccountSwitchInterruption();

  const shouldFetchUserInfo = isPlatformEnabled('ve');
  const userInfoPromise = knownUserInfo
    ? Promise.resolve(knownUserInfo)
    : shouldFetchUserInfo
      ? fetchUserInfoRemote().catch(() => null)
      : Promise.resolve(null);
  const reloadPromises = [];

  if (reloadCourses && isPlatformEnabled('ve')) {
    window.__headerQrUrl = '';
    reloadPromises.push(loadCourses().catch(() => {}));
  }
  if (reloadResourceSpace) {
    reloadPromises.push(loadResourceSpaceForCurrentAccount().catch(() => {}));
  }

  const info = await userInfoPromise;
  const loginName = String(info?.loginName || '').trim();
  const detectedUser = String(info?.userId || info?.userID || info?.USERID || info?.stuId || info?.teacherId || '').trim();
  const displayId = loginName || detectedUser;
  const expected = String(expectedUserId || '').trim();
  const accountMismatch = !!(expected && displayId && displayId !== expected);

  if (displayId) {
    finalUser = displayId;
    usernameInput.value = finalUser;
    await setLocal('username', finalUser);
    lastValidUsername = finalUser;
    renderLoginAccountHistorySelect(finalUser);
  }

  const roleName = String(info?.roleName || '').trim();
  const teacherFlag = String(info?.isTeacher || '').trim();
  window.isTeacherAccount = !!(roleName.includes('教师') || roleName.includes('老师') || roleName.includes('助教') || teacherFlag === '1' || teacherFlag === 'true');
  window.currentAccountLoginName = String(info?.loginName || '').trim() || String(info?.userId || detectedUser || finalUser || '').trim();

  setWelcomeMessage(info);
  if (finalUser) {
    await rememberLoggedInAccount(finalUser, info);
  }

  await jsessionSyncPromise;
  await Promise.allSettled(reloadPromises);
  return { userId: finalUser, info, accountMismatch };
}

function startVeStartupAccountInfoLoad() {
  if (!isPlatformEnabled('ve')) return Promise.resolve(null);
  return syncAccountInfoAndReloadVeCourses({
    reloadCourses: false,
    reloadResourceSpace: false
  }).catch(() => null);
}

function normalizeLoginAccountHistoryList(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list
    .map((it) => {
      const userId = String(it?.userId || '').trim();
      if (!userId) return null;
      const userName = String(it?.userName || '').trim();
      const roleName = String(it?.roleName || '').trim();
      const loginName = String(it?.loginName || userId).trim();
      const passwordMd5 = String(it?.passwordMd5 || '').trim();
      const quickUsername = String(it?.quickUsername || it?.username || '').trim();
      const lastLoginAt = Number(it?.lastLoginAt || 0);
      return {
        userId,
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
    const selectedQuick = selectedRecord.quickUsername ? ' [免验证码]' : '';
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
      const quickSuffix = it.quickUsername ? ' [免验证码]' : '';
      // 展开列表显示 userName(loginName)
      opt.textContent = `${roleName}${userName}${loginSuffix}${quickSuffix}`;
      accountHistorySelect.appendChild(opt);
    });

  accountHistorySelect.value = selectedUserId;
  adjustAccountHistorySelectWidth();
  isSyncingAccountHistorySelect = false;
}

function adjustAccountHistorySelectWidth() {
  if (!(accountHistorySelect instanceof HTMLSelectElement)) return;
  const selectedText = String(accountHistorySelect.selectedOptions?.[0]?.text || accountHistorySelect.value || '').trim();
  const scaledChars = Math.ceil(selectedText.length * 1.6)+1;
  accountHistorySelect.style.width = `calc(${scaledChars}ch + 36px)`;
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
      const url = `${BASE_VE}back/rp/common/teachCalendar.shtml?method=queryCurrentXq`;
      const { text } = await fetchText(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
      const data = JSON.parse(text);
      const rawList = Array.isArray(data?.result) ? data.result : Array.isArray(data?.RESULT) ? data.RESULT : [];
      currentXqOptions = normalizeCurrentXqOptions(rawList);
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
      window.__headerQrUrl = '';
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
    loginAccountHistory = normalizeLoginAccountHistoryList(raw);
  } catch {
    loginAccountHistory = [];
  }
}

async function saveLoginAccountHistory() {
  loginAccountHistory = normalizeLoginAccountHistoryList(loginAccountHistory);
  await setLocal(LOGIN_ACCOUNT_HISTORY_KEY, loginAccountHistory);
}

async function rememberLoggedInAccount(userId, info = null) {
  const uid = String(userId || '').trim();
  if (!uid) return;
  const nextInfo = info && typeof info === 'object' ? info : {};
  const idx = loginAccountHistory.findIndex((it) => String(it?.userId || '').trim() === uid);
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

async function detectUserIdFromPersonalCenter() {
  try {
    const info = await fetchUserInfoRemote();
    return String(info?.loginName || info?.userId || info?.userID || info?.stuId || info?.teacherId || '').trim();
  } catch {
    return '';
  }
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

// -------------------- Login --------------------
function isCaptchaErrorMessage(msg = '') {
  return /验证码/i.test(String(msg || ''));
}

function isCredentialErrorMessage(msg = '') {
  const t = String(msg || '');
  if (!t || isCaptchaErrorMessage(t)) return false;
  if (isAccountLockedMessage(t)) return false;
  return /账号或密码/i.test(t);
}

function isAccountLockedMessage(msg = '') {
  return /锁定|错误次数过多/i.test(String(msg || ''));
}

function getDefaultPortalPasswordMd5(loginName) {
  const id = String(loginName || '').trim();
  if (id === AUXILIARY_LOGIN_ID) return AUXILIARY_LOGIN_PASSWORD_MD5;
  return md5(`Bjtu@${id}`);
}

function looksLikeLoginSuccess(html) {
  const t = String(html || '');
  return t.includes('跳转首页') || t.includes('top.location') || t.includes('退出登录') || t.includes('index.shtml?method=index&type=qxkt');
}

async function fetchPasswordMd5FromServer(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  const infoUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(uid)}`;
  const { text: infoText } = await fetchText(infoUrl, {
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
  });
  if ((infoText || '').includes('login-page') || isSessionEndedHtml(infoText)) return '';

  const studentUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=studentInfo&stuId=${encodeURIComponent(uid)}`;
  const teacherUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=personInfo&teacherId=${encodeURIComponent(uid)}`;
  const urls = (infoText || '').includes('学生') ? [studentUrl, teacherUrl] : [teacherUrl, studentUrl];
  for (const url of urls) {
    const { text } = await fetchText(url);
    if ((text || '').includes('login-page') || isSessionEndedHtml(text)) return '';
    const m = String(text || '').match(/(?:id|name)=["']oldpassword["'][^>]*value=["']([^"']+)["']/i)
      || String(text || '').match(/value=["']([^"']+)["'][^>]*(?:id|name)=["']oldpassword["']/i);
    if (m?.[1]) return String(m[1] || '').trim();
  }
  return '';
}

async function fetchPasswordMd5WithKnownInfo(userId, userInfoRawText) {
  const uid = String(userId || '').trim();
  if (!uid) return '';
  const isStudent = String(userInfoRawText || '').includes('学生');
  const studentUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=studentInfo&stuId=${encodeURIComponent(uid)}`;
  const teacherUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=personInfo&teacherId=${encodeURIComponent(uid)}`;
  const urls = isStudent ? [studentUrl, teacherUrl] : [teacherUrl, studentUrl];
  for (const url of urls) {
    const { text } = await fetchText(url);
    if ((text || '').includes('login-page') || isSessionEndedHtml(text)) return '';
    const m = String(text || '').match(/(?:id|name)=["']oldpassword["'][^>]*value=["']([^"']+)["']/i)
      || String(text || '').match(/value=["']([^"']+)["'][^>]*(?:id|name)=["']oldpassword["']/i);
    if (m?.[1]) return String(m[1] || '').trim();
  }
  return '';
}

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

async function validateAccountByGetUserInfo(userId, { signal } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, reason: 'empty-username', message: '请输入账号' };
  const infoUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(uid)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const externalAbortHandler = () => {
    try { controller.abort(); } catch { /* ignore */ }
  };
  if (signal instanceof AbortSignal) {
    if (signal.aborted) {
      try { controller.abort(); } catch { /* ignore */ }
    } else {
      signal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }
  try {
    const { res, text } = await fetchText(infoUrl, {
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' },
      signal: controller.signal
    });
    const htmlOrText = String(text || '');
    if (htmlOrText.includes('login-page') || isSessionEndedHtml(htmlOrText) || isLikelyLoginPageHtml(htmlOrText, res?.url)) {
      return { ok: false, reason: 'session-invalid', message: '未登录或会话已失效' };
    }
    const data = parseVeJson(htmlOrText);
    if (data && String(data.STATUS) === '4') {
      return { ok: false, reason: 'invalid-account', message: '该账号不存在' };
    }
    return { ok: true, info: data, status: data?.STATUS || '', rawText: htmlOrText };
  } catch (e) {
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '已取消' };
    return { ok: false, reason: 'network', message: '账号验证失败，请稍后重试' };
  } finally {
    clearTimeout(timeoutId);
    if (signal instanceof AbortSignal) {
      try { signal.removeEventListener('abort', externalAbortHandler); } catch { /* ignore */ }
    }
  }
}

async function validateUsernameBeforeLoginStart(userId, { signal } = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, status: 'empty', message: '请输入账号' };
  const knownAccount = findLoginAccountRecord(uid);
  if (knownAccount) {
    return { ok: true, status: 'needs-post-login', info: knownAccount };
  }
  const cachedValidation = loginAccountValidationCache
    && loginAccountValidationCache.userId === uid
    && Date.now() - Number(loginAccountValidationCache.ts || 0) < 10000
    ? loginAccountValidationCache.validation
    : null;
  const validation = cachedValidation || await validateAccountByGetUserInfo(uid, { signal });
  loginAccountValidationCache = { userId: uid, ts: Date.now(), validation };
  if (!validation.ok) {
    if (validation.reason === 'invalid-account') {
      return { ok: false, status: 'invalid', message: '该账号不存在' };
    }
    if (validation.reason === 'cancelled') {
      return { ok: false, status: 'cancelled', message: '已取消' };
    }
    if (validation.reason !== 'session-invalid') {
      return { ok: false, status: 'unknown', message: validation.message || '账号验证失败，请稍后重试' };
    }
  }
  const info = validation.info?.result || validation.info || null;
  return { ok: true, status: 'needs-post-login', info };
}

async function saveLoginAccountCredential(userId, passwordMd5 = '') {
  const uid = String(userId || '').trim();
  if (!uid) return;
  const idx = loginAccountHistory.findIndex((it) => String(it?.userId || '').trim() === uid || String(it?.loginName || '').trim() === uid);
  const prev = idx >= 0 ? loginAccountHistory[idx] : { userId: uid, loginName: uid };
  const record = {
    ...prev,
    userId: String(prev.userId || uid).trim(),
    loginName: String(prev.loginName || uid).trim(),
    passwordMd5: String(passwordMd5 || '').trim(),
    lastLoginAt: Date.now()
  };
  if (idx >= 0) loginAccountHistory.splice(idx, 1);
  loginAccountHistory.unshift(record);
  await saveLoginAccountHistory();
  renderLoginAccountHistorySelect(uid);
}

let veTessWorkerPromise = null;

async function getVeTessWorker() {
  if (veTessWorkerPromise) return veTessWorkerPromise;
  veTessWorkerPromise = (async () => {
    const T = globalThis.Tesseract;
    if (!T || typeof T.createWorker !== 'function') throw new Error('Tesseract 未加载');
    const options = {
      logger: () => {},
      workerBlobURL: false,
      workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('vendor/tesseract/tesseract-core-simd.wasm.js')
    };
    let worker;
    try {
      worker = await T.createWorker('eng', 1, options);
    } catch {
      worker = await T.createWorker('eng', 1, options);
    }
    if (worker.setParameters) {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7'
      });
    }
    return worker;
  })();
  return veTessWorkerPromise;
}

function preprocessCaptchaImageToCanvas(img) {
  const w = Math.max(1, img.naturalWidth || img.width || 1);
  const h = Math.max(1, img.naturalHeight || img.height || 1);
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const gray = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
    const v = gray < 160 ? 0 : 255;
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

async function loadImageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function fetchPortalCaptchaImageUrl({ signal } = {}) {
  const fetchController = new AbortController();
  const fetchTimeout = setTimeout(() => fetchController.abort(), 5000);
  const externalAbortHandler = () => {
    try { fetchController.abort(); } catch { /* ignore */ }
  };
  if (signal instanceof AbortSignal) {
    if (signal.aborted) {
      try { fetchController.abort(); } catch { /* ignore */ }
    } else {
      signal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }
  try {
    await enforceJsessionidBeforeLoginRequest();
    const res = await fetch(`${BASE_VE}GetImg?t=${Date.now()}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
      signal: fetchController.signal
    });
    const blob = await res.blob();
    return { blob, imageUrl: URL.createObjectURL(blob) };
  } finally {
    clearTimeout(fetchTimeout);
    if (signal instanceof AbortSignal) {
      try { signal.removeEventListener('abort', externalAbortHandler); } catch {}
    }
  }
}

async function recognizePortalCaptchaInExtension({ signal } = {}) {
  const OVERALL_TIMEOUT_MS = 8000;
  const TESS_TIMEOUT_MS = 6000;
  const overallTimer = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('recognize-overall-timeout')), OVERALL_TIMEOUT_MS);
  });
  let imageUrl = null;
  const work = (async () => {
    const fetched = await fetchPortalCaptchaImageUrl({ signal });
    imageUrl = fetched.imageUrl;
    const img = await loadImageFromBlob(fetched.blob);
    const worker = await getVeTessWorker();
    const canvas = preprocessCaptchaImageToCanvas(img);
    const tessRace = Promise.race([
      worker.recognize(canvas),
      new Promise((_, reject) => setTimeout(() => reject(new Error('tess-timeout')), TESS_TIMEOUT_MS))
    ]);
    const { data } = await tessRace;
    return { code: String(data?.text || '').replace(/\D/g, '').slice(0, 4), imageUrl };
  })();
  try {
    return await Promise.race([work, overallTimer]);
  } catch {
    if (imageUrl) { try { URL.revokeObjectURL(imageUrl); } catch {} }
    return null;
  }
}



async function loginPostInExtension(username, passwordMd5, passcode, { signal } = {}) {
  await enforceJsessionidBeforeLoginRequest();
  const body = new URLSearchParams({
    login: 'main_2',
    qxkt_type: '',
    qxkt_url: '',
    username: String(username || ''),
    password: String(passwordMd5 || ''),
    passcode: String(passcode || '')
  });
  const { res, text } = await fetchText(`${BASE_VE}s.shtml`, {
    method: 'POST',
    omitSessionId: true,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Origin: BASE
    },
    body: body.toString(),
    signal
  });
  await syncJsessionidFromResponse(res);
  const alertMsg = parseAlertMsg(text);
  if (alertMsg && isCaptchaErrorMessage(alertMsg)) return { ok: false, reason: 'captcha', message: alertMsg };
  if (alertMsg && isAccountLockedMessage(alertMsg)) return { ok: false, reason: 'locked', message: alertMsg };
  if (alertMsg && isCredentialErrorMessage(alertMsg)) return { ok: false, reason: 'credential', message: alertMsg };
  if (looksLikeLoginSuccess(text)) return { ok: true };
  return { ok: false, reason: 'other', message: alertMsg || '登录失败' };
}

async function waitForManualCaptchaCode({ imageUrl = null, status = '请输入验证码', level = 'info', signal, allowEmptyAutoRetry = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      if (captchaModalInput instanceof HTMLInputElement) {
        try { captchaModalInput.removeEventListener('keydown', onKeyDown); } catch {}
        try { captchaModalInput.removeEventListener('input', onInput); } catch {}
      }
      if (captchaModalImg instanceof HTMLImageElement) {
        try { captchaModalImg.removeEventListener('click', refresh); } catch {}
      }
      if (signal instanceof AbortSignal) {
        try { signal.removeEventListener('abort', onAbort); } catch {}
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const submit = () => {
      const code = String(captchaModalInput?.value || '').replace(/\D/g, '').slice(0, 4);
      if (!code && allowEmptyAutoRetry) {
        finish({ action: 'auto-retry' });
        return;
      }
      if (!/^\d{4}$/.test(code)) {
        setCaptchaModalStatus(allowEmptyAutoRetry ? '请输入4位数字验证码，或留空回车继续自动识别' : '请输入4位数字验证码', 'warning');
        if (captchaModalInput instanceof HTMLInputElement) captchaModalInput.focus();
        return;
      }
      finish({ action: 'submit', code });
    };
    const refresh = () => finish({ action: 'refresh' });
    const cancel = () => finish({ action: 'cancel' });
    const onKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    const onInput = () => {
      if (!(captchaModalInput instanceof HTMLInputElement)) return;
      const code = String(captchaModalInput.value || '').replace(/\D/g, '').slice(0, 4);
      if (captchaModalInput.value !== code) captchaModalInput.value = code;
      if (code.length === 4) submit();
    };
    const onAbort = () => finish({ action: 'cancel' });
    if (captchaModalInput instanceof HTMLInputElement) {
      captchaModalInput.value = '';
      captchaModalInput.placeholder = '请输入4位验证码';
      captchaModalInput.addEventListener('keydown', onKeyDown);
      captchaModalInput.addEventListener('input', onInput);
    }
    if (captchaModalImg instanceof HTMLImageElement) {
      captchaModalImg.addEventListener('click', refresh);
    }
    if (signal instanceof AbortSignal) {
      if (signal.aborted) return finish({ action: 'cancel' });
      signal.addEventListener('abort', onAbort, { once: true });
    }
    showCaptchaModal({
      imageUrl,
      status,
      level,
      spinner: false,
      cancelHandler: cancel
    });
    if (captchaModalInput instanceof HTMLInputElement) {
      setTimeout(() => captchaModalInput.focus(), 0);
    }
  });
}

async function loginPostWithManualCaptchaInExtension(username, passwordMd5, { signal, allowEmptyAutoRetry = false } = {}) {
  let last = { ok: false, reason: 'captcha', message: '验证码错误' };
  try {
    for (let i = 0; i < 5; i++) {
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '已取消' };
      let fetched = null;
      let userCancelled = false;
      try {
        showCaptchaModal({
          imageUrl: null,
          status: '正在加载验证码…',
          level: 'info',
          spinner: true,
          cancelHandler: () => {
            userCancelled = true;
            hideCaptchaModal();
          }
        });
        fetched = await fetchPortalCaptchaImageUrl({ signal });
      } catch {
        if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '已取消' };
        return { ok: false, reason: 'captcha', message: '验证码加载失败' };
      }
      if (userCancelled) return { ok: false, reason: 'manual-captcha-cancelled', message: '登录失败' };
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '已取消' };
      const prompt = await waitForManualCaptchaCode({
        imageUrl: fetched.imageUrl,
        status: i === 0
          ? (allowEmptyAutoRetry ? '请输入验证码，或留空回车继续自动识别' : '请输入验证码后提交')
          : `验证码错误：${last.message || '请重新输入'}${allowEmptyAutoRetry ? '；可留空回车继续自动识别' : ''}`,
        level: i === 0 ? 'info' : 'warning',
        signal,
        allowEmptyAutoRetry
      });
      if (prompt.action === 'cancel') return { ok: false, reason: 'manual-captcha-cancelled', message: '登录失败' };
      if (prompt.action === 'refresh') continue;
      if (prompt.action === 'auto-retry') return { ok: false, reason: 'auto-retry', message: '继续自动识别' };
      showCaptchaModal({
        imageUrl: fetched.imageUrl,
        status: '正在提交登录…',
        level: 'info',
        spinner: true,
        cancelHandler: () => {
          userCancelled = true;
          hideCaptchaModal();
        }
      });
      last = await loginPostInExtension(username, passwordMd5, prompt.code, { signal });
      if (userCancelled) return { ok: false, reason: 'manual-captcha-cancelled', message: '登录失败' };
      if (last.ok || last.reason !== 'captcha') {
        hideCaptchaModal();
        return last;
      }
      showToast(last.message || '验证码错误', 'warning', 1600);
    }
    return last;
  } finally {
    hideCaptchaModal();
  }
}

async function loginPostWithCaptchaInExtension(username, passwordMd5, { signal } = {}) {
  const autoCaptcha = await getLocal('autoCaptcha', 'true');
  if (autoCaptcha !== 'true' && autoCaptcha !== true) {
    return loginPostWithManualCaptchaInExtension(username, passwordMd5, { signal });
  }
  let last = { ok: false, reason: 'captcha', message: '验证码识别失败' };
  let stopCaptchaAutoRetry = false;
  const cancelHandler = () => {
    stopCaptchaAutoRetry = true;
    last = { ok: false, reason: 'manual-captcha-cancelled', message: '登录失败' };
    hideCaptchaModal();
  };
  try {
    for (let i = 0; i < 3; i++) {
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '已取消' };
      if (stopCaptchaAutoRetry) return last;
      showCaptchaModal({
        imageUrl: null,
        status: `正在识别验证码 (${i + 1}/3)…`,
        level: 'info',
        spinner: false,
        cancelHandler
      });
      const result = await recognizePortalCaptchaInExtension({ signal });
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '已取消' };
      if (stopCaptchaAutoRetry) return last;
      const code = String(result?.code || '').trim();
      const imageUrl = result?.imageUrl || null;
      if (!/^\d{4}$/.test(code)) {
        last = { ok: false, reason: 'captcha', message: '验证码识别失败' };
        showCaptchaModal({
          imageUrl,
          status: `本轮识别失败 (${i + 1}/3)，正在重新识别…`,
          level: 'warning',
          spinner: false,
          cancelHandler
        });
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (stopCaptchaAutoRetry) return last;
        continue;
      }
      if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '已取消' };
      if (stopCaptchaAutoRetry) return last;
      if (captchaModalInput instanceof HTMLInputElement) {
        captchaModalInput.value = code;
      }
      showCaptchaModal({
        imageUrl,
        status: `正在提交登录…`,
        level: 'info',
        spinner: false,
        cancelHandler
      });
      last = await loginPostInExtension(username, passwordMd5, code, { signal });
      if (last.ok || last.reason !== 'captcha') {
        hideCaptchaModal();
        return last;
      }
      showToast(last.message || '验证码错误', 'warning', 1600);
      if (stopCaptchaAutoRetry) return last;
      if (i < 2) {
        showCaptchaModal({
          imageUrl,
          status: `验证码错误：${last.message || '请重试'}，正在重新识别 (${i + 2}/3)…`,
          level: 'warning',
          spinner: false,
          cancelHandler
        });
      } else {
        showCaptchaModal({
          imageUrl,
          status: `验证码连续错误，请手动输入验证码，或留空回车继续自动识别`,
          level: 'warning',
          spinner: false,
          cancelHandler
        });
        const manualResult = await loginPostWithManualCaptchaInExtension(username, passwordMd5, {
          signal,
          allowEmptyAutoRetry: true
        });
        if (manualResult?.reason === 'auto-retry') {
          i = -1;
          last = { ok: false, reason: 'captcha', message: '继续自动识别' };
          continue;
        }
        return manualResult;
      }
    }
    return last;
  } finally {
    hideCaptchaModal();
  }
}

async function loginGet(username, { signal } = {}) {
  const account = findLoginAccountRecord(username);
  const quickUsername = String(account?.quickUsername || '').trim();
  if (!quickUsername) {
    return { ok: false, reason: 'needs-post-login', message: '需要验证码登录' };
  }
  const url = `${BASE_VE}s.shtml?loginType=2&login=main_2&username=${encodeURIComponent(quickUsername)}`;
  const { res, text } = await fetchText(url, { method: 'GET', credentials: 'include', signal });
  await syncJsessionidFromResponse(res);
  if (text.includes('账号或密码错误')) {
    return { ok: false, reason: 'invalid-account', message: '绑定的快速登录 username 已失效' };
  }
  if (text.includes('index.shtml?method=index&type=qxkt')) {
    return { ok: true };
  }
  return { ok: false, reason: 'other', message: '登录失败' };
}



function hideLoginModal() {
  loginModal.style.display = 'none';
}

function showLoginModal() {
  if (loginModal) loginModal.style.display = 'flex';
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
        detectFromPortal: false,
        reloadCourses: false,
        reloadResourceSpace: true
      }).catch(() => {});
    }
  }
}

if (loginModal) {
  loginModal.addEventListener('mousedown', (e) => {
    if (e.target === loginModal) {
      dismissLoginModal();
    }
  });
}

const captchaModal = document.getElementById('captcha-modal');
const captchaModalImg = document.getElementById('captcha-modal-img');
const captchaModalStatus = document.getElementById('captcha-modal-status');
const captchaModalInput = document.getElementById('captcha-modal-input');
const captchaModalSpinner = document.getElementById('captcha-modal-spinner');
const captchaModalCancel = document.getElementById('captcha-modal-cancel');
let currentCaptchaImageUrl = null;
let captchaModalCancelHandler = null;

function setCaptchaModalStatus(text, level = 'info') {
  if (!(captchaModalStatus instanceof HTMLElement)) return;
  captchaModalStatus.classList.remove('is-error', 'is-warning');
  if (level === 'error') captchaModalStatus.classList.add('is-error');
  else if (level === 'warning') captchaModalStatus.classList.add('is-warning');
  captchaModalStatus.textContent = String(text || '');
}

function setCaptchaModalSpinner(visible) {
  if (!(captchaModalSpinner instanceof HTMLElement)) return;
  captchaModalSpinner.style.display = visible ? 'flex' : 'none';
}

function setCaptchaModalImage(imageUrl) {
  if (imageUrl && imageUrl === currentCaptchaImageUrl) {
    if (captchaModalImg instanceof HTMLImageElement) captchaModalImg.src = imageUrl;
    return;
  }
  if (currentCaptchaImageUrl) {
    try { URL.revokeObjectURL(currentCaptchaImageUrl); } catch {}
    currentCaptchaImageUrl = null;
  }
  if (imageUrl) {
    currentCaptchaImageUrl = imageUrl;
    if (captchaModalImg instanceof HTMLImageElement) captchaModalImg.src = imageUrl;
  } else {
    if (captchaModalImg instanceof HTMLImageElement) captchaModalImg.removeAttribute('src');
  }
}

function showCaptchaModal({
  imageUrl = null,
  status = '正在准备验证码…',
  level = 'info',
  spinner = false,
  cancelHandler = null
} = {}) {
  if (!(captchaModal instanceof HTMLElement)) return;
  setCaptchaModalImage(imageUrl);
  setCaptchaModalStatus(status, level);
  setCaptchaModalSpinner(spinner);
  // 绑定/解绑取消按钮；验证码图片点击由具体等待流程绑定为刷新。
  if (captchaModalCancel instanceof HTMLButtonElement) {
    if (captchaModalCancelHandler) {
      try { captchaModalCancel.removeEventListener('click', captchaModalCancelHandler); } catch {}
    }
    captchaModalCancelHandler = typeof cancelHandler === 'function' ? cancelHandler : null;
    if (captchaModalCancelHandler) {
      captchaModalCancel.addEventListener('click', captchaModalCancelHandler);
      captchaModalCancel.textContent = '取消';
      captchaModalCancel.style.display = '';
    } else {
      captchaModalCancel.style.display = 'none';
    }
  }
  captchaModal.style.display = 'flex';
}

function hideCaptchaModal() {
  if (!(captchaModal instanceof HTMLElement)) return;
  captchaModal.style.display = 'none';
  setCaptchaModalImage(null);
  setCaptchaModalSpinner(false);
  if (captchaModalCancel instanceof HTMLButtonElement && captchaModalCancelHandler) {
    try { captchaModalCancel.removeEventListener('click', captchaModalCancelHandler); } catch {}
    captchaModalCancelHandler = null;
  }
}

if (captchaModal instanceof HTMLElement) {
  captchaModal.addEventListener('mousedown', (e) => {
    if (e.target === captchaModal) {
      // 点遮罩等价于点取消
      if (captchaModalCancelHandler) {
        try { captchaModalCancelHandler(); } catch {}
      } else {
        hideCaptchaModal();
      }
    }
  });
}
const loginModalClose = document.getElementById('login-modal-close');
if (loginModalClose instanceof HTMLButtonElement) {
  loginModalClose.addEventListener('click', () => dismissLoginModal());
}

let portalLoginTabId = null;

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
  await doLoginFlow();
}

let lastPortalLoginTime = 0;
async function openPortalLoginForInvalidSession() {
  if (Date.now() - lastPortalLoginTime < 1200) return;
  lastPortalLoginTime = Date.now();
  const username = String(usernameInput.value || '').trim();
  const account = findLoginAccountRecord(username);
  const tabResp = await chrome.runtime.sendMessage({
    type: 'OPEN_PORTAL_LOGIN_TAB',
    payload: {
      username,
      passwordMd5: String(account?.passwordMd5 || '').trim()
    }
  });
  if (!tabResp?.ok) {
    showToast(tabResp?.error || '无法打开智慧课程平台登录页', 'error');
    return;
  }
  const synced = await waitAndSyncLoginFromPortal(tabResp.tabId, 180000, username);
  if (!synced) showToast('登录未完成或超时', 'warning');
}

async function routeLoginBySessionValidityForSwitch(targetUsername, _modalMessage) {
  jsessionidInput.value = '';
  isLoginSessionValid = true;
  usernameInput.value = targetUsername;
  await doLoginFlow();
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

async function waitAndSyncLoginFromPortal(tabIdToClose = null, maxWaitMs = 120000, expectedUserId = '') {
  const expected = String(expectedUserId || '').trim();
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const detected = await detectUserIdFromPersonalCenter();
      if (detected) {
        if (expected && String(detected) !== expected) {
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
        await syncJsessionidToUi();
        loginCancelRequested = false;
        await closePortalLoginTab();
        hideLoginModal();
        try {
          await syncAccountInfoAndReloadVeCourses({ userId: detected, detectFromPortal: false, reloadCourses: true, reloadResourceSpace: true });
        } catch {
          // ignore
        }
        showToast('登录成功', 'success', 1800);

        if (isPlatformEnabled('jlgj') || window.platformInteractiveLoginPending?.jlgj) {
          closeJlgjLoginAssistPopup(false);
          scheduleJlgjLoginAssistRecheck(180);
        }

        if (tabIdToClose) chrome.tabs.remove(tabIdToClose).catch(() => {});

        runPendingLoginCallbacks();

        if (isPlatformEnabled('ve')) {
          await loadCourses();
        }
        return true;
      }
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 100));
  }
  await closePortalLoginTab();
  if (tabIdToClose) chrome.tabs.remove(tabIdToClose).catch(() => {});
  return false;
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

  try {
    const synced = await syncAccountInfoAndReloadVeCourses({
      userId: finalUser,
      detectFromPortal: false,
      reloadCourses: true,
      reloadResourceSpace: true,
      expectedUserId: finalUser
    });
    if (synced?.accountMismatch) {
      showToast(`登录后检测到仍是账号 ${synced.userId}，未切换到 ${finalUser}`, 'error', 3500);
      isLoginSessionValid = false;
    }
  } catch {
    // ignore
  }
}

async function bootstrapSessionForGetPassword(excludeUserId, { signal } = {}) {
  const exclude = String(excludeUserId || '').trim();
  const candidates = normalizeLoginAccountHistoryList(loginAccountHistory);

  for (const account of candidates) {
    if (loginCancelRequested || signal?.aborted) return null;
    if (account.userId === exclude || account.loginName === exclude) continue;
    if (account.quickUsername) {
      const result = await loginGet(account.userId, { signal });
      if (result.ok) {
        showToast(`已通过 ${getAccountDisplayName(account.userId) || account.userId} 建立登录态`, 'info', 1500);
        return account;
      }
    }
  }

  for (const account of candidates) {
    if (loginCancelRequested || signal?.aborted) return null;
    if (account.userId === exclude || account.loginName === exclude) continue;
    if (account.passwordMd5) {
      const result = await loginPostWithCaptchaInExtension(account.userId, account.passwordMd5, { signal });
      if (result.ok) {
        showToast(`已通过 ${getAccountDisplayName(account.userId) || account.userId} 建立登录态`, 'info', 1500);
        return account;
      }
    }
  }

  if (candidates.length === 0) {
    const helperId = AUXILIARY_LOGIN_ID;
    const helperPw = AUXILIARY_LOGIN_PASSWORD_MD5;
    const result = await loginPostWithCaptchaInExtension(helperId, helperPw, { signal });
    if (result.ok) {
      showToast(`已通过辅助账号 ${helperId} 建立登录态`, 'info', 1500);
      return { userId: helperId };
    }
  }

  return null;
}

async function doLoginFlow() {
  if (isLoginInProgress) return;
  const username = usernameInput.value.trim();
  if (!username) {
    showToast('请输入账号，或改为填写 JSESSIONID', 'warning');
    return;
  }
  loginFlowUsernameSet = true;
  usernameChangeVersion += 1;
  try { usernameChangeAbortController?.abort(); } catch { /* ignore */ }
  prioritizeAccountSwitch();
  const wasSwitchingAccount = !!pendingUsernameChange;
  const accountAtStart = findLoginAccountRecord(username);
  let restoredAfterLoginFailure = false;
  const restoreAfterLoginFailureIfNeeded = async () => {
    if (restoredAfterLoginFailure) return '';
    const fallback = await restoreLoginFallbackUsername(username);
    if (fallback) restoredAfterLoginFailure = true;
    return fallback;
  };
  const handleLoginFailureBeforeReturn = async (result, fallbackMessage = '登录失败', type = 'error') => {
    await restoreAfterLoginFailureIfNeeded();
    showToast(result?.message || fallbackMessage, type, 3000);
  };

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.style.opacity = '0.7';
    loginBtn.innerHTML = '登录中… <span class="spinner"></span>';
  }
  isLoginInProgress = true;
  loginCancelRequested = false;
  loginAbortController = new AbortController();
  const loginSignal = loginAbortController.signal;

  try {
    // Step 1: per RULES.md, only unknown accounts need getUserInfo(loginName) STATUS 4 check.
    let validation = { ok: true, info: null, status: '', rawText: '' };
    if (!accountAtStart) {
      showToast('正在验证账号…', 'info', 5000);
      const cachedValidation = loginAccountValidationCache
        && loginAccountValidationCache.userId === username
        && Date.now() - Number(loginAccountValidationCache.ts || 0) < 10000
        ? loginAccountValidationCache.validation
        : null;
      validation = cachedValidation || await validateAccountByGetUserInfo(username, { signal: loginSignal });
      loginAccountValidationCache = { userId: username, ts: Date.now(), validation };
      if (loginCancelRequested || loginSignal?.aborted) return;
      if (!validation.ok) {
        if (validation.reason === 'invalid-account') {
          await restoreLoginFallbackUsername(username);
          showToast(`账号${username}不存在，请检查后重试`, 'error', 3000);
          return;
        } else if (validation.reason === 'cancelled') {
          return;
        } else if (validation.reason !== 'session-invalid') {
          await restoreAfterLoginFailureIfNeeded();
          showToast(validation.message || '账号验证失败，请稍后重试', 'warning', 2500);
          return;
        }
      }
    }

    // Step 2+3: getUserInfo() (no params) -> session check
    let loginStatus = false;
    let currentSessionInfo = null;
    try {
      showToast('正在检查登录状态…', 'info', 0);
      currentSessionInfo = await fetchUserInfoRemote();
      loginStatus = currentSessionInfo && typeof currentSessionInfo === 'object';
    } catch {
      loginStatus = false;
    }

    const currentUser = currentSessionInfo && typeof currentSessionInfo === 'object'
      ? String(currentSessionInfo.loginName || currentSessionInfo.userId || '').trim()
      : '';

    if (loginStatus && currentUser === username) {
      showToast('当前已登录该账号', 'success', 2000);
      isLoginSessionValid = true;
      usernameInput.value = username;
      await syncAccountInfoAndReloadVeCourses({
        userId: username,
        detectFromPortal: false,
        reloadCourses: true,
        reloadResourceSpace: true,
        expectedUserId: username,
        knownUserInfo: currentSessionInfo
      });
      return;
    }

    // Step 4: Try login per RULES.md flow
    //   if quickUsername != "" → quick login (no login state needed)
    //   elif passwordMd5 != "" → password login (captcha retry 3x, password error → 获取密码)
    //   else → default password login (captcha retry, password error → 获取密码)
    const account = accountAtStart || findLoginAccountRecord(username);
    const quickUsername = String(account?.quickUsername || '').trim();
    let passwordMd5 = String(account?.passwordMd5 || '').trim();

    if (quickUsername) {
      showToast('正在通过免验证码登录…', 'info', 0);
      const quickResult = await loginGet(username, { signal: loginSignal });
      if (loginCancelRequested || loginSignal?.aborted) return;
      if (quickResult.ok) {
        await handleLoginSuccess(username);
        return;
      }
      if (quickResult.reason !== 'invalid-account') {
        await handleLoginFailureBeforeReturn(quickResult, '快速登录失败', 'warning');
        return;
      }
      showToast('快速登录已过期，尝试密码登录…', 'info', 0);
    }

    // Try password login (saved password or default password)
    const tryPasswordLogin = async (pw) => {
      const result = await loginPostWithCaptchaInExtension(username, pw, { signal: loginSignal });
      if (loginCancelRequested || loginSignal?.aborted) return null;
      if (result.ok) {
        await saveLoginAccountCredential(username, pw);
        await handleLoginSuccess(username);
        return { success: true };
      }
      if (result.reason === 'cancelled') return { cancelled: true };
      return result;
    };

    if (passwordMd5) {
      showToast('正在登录…', 'info', 0);
      const pwResult = await tryPasswordLogin(passwordMd5);
      if (pwResult === null || pwResult.success || pwResult.cancelled) return;
      if (pwResult.reason !== 'credential') {
        await handleLoginFailureBeforeReturn(pwResult, '登录失败');
        return;
      }
      // password error → 获取密码 (fall through)
    } else {
      // No saved password → try default password
      showToast('正在登录…', 'info', 0);
      const defaultPw = getDefaultPortalPasswordMd5(username);
      const defResult = await tryPasswordLogin(defaultPw);
      if (defResult === null || defResult.success || defResult.cancelled) return;
      if (defResult.reason !== 'credential') {
        await handleLoginFailureBeforeReturn(defResult, '登录失败');
        return;
      }
      // default password error → 获取密码 (fall through)
      passwordMd5 = defaultPw;
    }

    // Step 5: 获取密码 per RULES.md
    //   a) Ensure login state
    //   b) Read password from studentInfo/personInfo
    //   c) Save password → retry password login
    if (!loginStatus) {
      showToast('正在建立登录态…', 'info', 0);
      const bootstrapped = await bootstrapSessionForGetPassword(username, { signal: loginSignal });
      if (loginCancelRequested || loginSignal?.aborted) return;
      if (!bootstrapped) {
        await restoreAfterLoginFailureIfNeeded();
        showToast('无法建立登录态，请手动打开智慧课程平台登录后刷新，或填写 JSESSIONID', 'error', 4000);
        return;
      }
    }

    let fetchedPw = '';
    if (validation.rawText) {
      fetchedPw = await fetchPasswordMd5WithKnownInfo(username, validation.rawText).catch(() => '');
    }
    if (!fetchedPw) {
      fetchedPw = await fetchPasswordMd5FromServer(username).catch(() => '');
    }
    if (!fetchedPw) fetchedPw = getDefaultPortalPasswordMd5(username);
    passwordMd5 = fetchedPw;

    showToast('正在登录…', 'info', 0);
    const finalResult = await tryPasswordLogin(passwordMd5);
    if (finalResult === null || finalResult.success || finalResult.cancelled) return;
    if (finalResult.reason === 'credential') {
      await restoreAfterLoginFailureIfNeeded();
      showToast('账号或密码错误', 'error', 3000);
      return;
    }
    await handleLoginFailureBeforeReturn(finalResult, '登录失败');
  } catch (e) {
    if (loginCancelRequested || loginSignal?.aborted) return;
    console.error('Login error:', e);
    await restoreAfterLoginFailureIfNeeded();
    showToast('登录过程中出现异常', 'error');
  } finally {
    const switchModalClosed = !loginModal || loginModal.style.display === 'none';
    if (wasSwitchingAccount && pendingUsernameChange && switchModalClosed) {
      if (isPlatformEnabled('ve')) {
        try { await loadCourses(); } catch { /* ignore */ }
      }
      try { await loadResourceSpaceForCurrentAccount(); } catch { /* ignore */ }
    }
    isLoginInProgress = false;
    loginFlowUsernameSet = false;
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

function formatMrjzyDateTime(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

function formatResourceQueueFileWithSize(item, fallbackId = '') {
  const name = ensureResourceDownloadFileName(item, String(item?.url || '').trim()) || String(fallbackId || '未命名文件');
  const rawSize = getResourceItemSizeBytes(item);
  const sizeText = rawSize > 0
    ? formatSize(rawSize)
    : (String(item?.sizeMb || '').trim() || '未知大小');
  return `${name}（${sizeText}）`;
}

function refreshResourceQueueStatusText() {
  const stat = window.resourceDownloadQueueStatus || { totalFiles: 0, savedFiles: 0 };
  const totalFiles = Math.max(0, Number(stat.totalFiles) || 0);
  if (!totalFiles) {
    const activeCount = Object.values(window.resourceDownloadTasks || {}).filter((t) => !!t?.active).length;
    const queuedCount = (window.resourceDownloadQueue || []).filter((q) => q && !q.cancelled).length;
    if (!activeCount && !queuedCount) {
      const text = String(resourceSpaceStatus?.textContent || '').trim();
      if (/^\(\d+\+\d+\)\s*\/\s*\d+/.test(text)) {
        setResourceSpaceStatus('');
      }
    }
    return;
  }

  const activeIds = Object.entries(window.resourceDownloadTasks || {})
    .filter(([, task]) => !!task?.active)
    .map(([rid]) => String(rid || '').trim())
    .filter(Boolean);
  const downloadingCount = activeIds.length;
  const savedFiles = Math.max(0, Math.min(totalFiles, Number(stat.savedFiles) || 0));

  const names = activeIds.map((rid) => {
    const item = findSelectableDownloadItemById(rid)
      || window.resourceDownloadQueueById?.[rid]?.item
      || window.resourceDownloadTasks?.[rid]?.item
      || null;
    return formatResourceQueueFileWithSize(item, rid);
  });
  const nameText = names.length ? names.join('；') : '等待下载中';

  setResourceSpaceStatus(`(${savedFiles}+${downloadingCount}) / ${totalFiles} ${nameText}`, 'normal');

  const queuedCount = (window.resourceDownloadQueue || []).filter((q) => q && !q.cancelled).length;
  if (savedFiles >= totalFiles && downloadingCount === 0 && queuedCount === 0) {
    setResourceSpaceStatus(`(${savedFiles}+0) / ${totalFiles} 下载完成`, 'success');
    window.resourceDownloadQueueStatus = { totalFiles: 0, savedFiles: 0 };
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

function normalizeResourceSearchKeyword(v) {
  return String(v || '').trim();
}

function getResourceSpaceSelectableIds() {
  const list = Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : [];
  return list
    .map((it) => String(it?.id || '').trim())
    .filter((id) => id && !isResourceDownloadActive(id));
}

function refreshResourceSelectAllButton() {
  if (!(resourceSelectAllBtn instanceof HTMLButtonElement)) return;
  const ids = getResourceSpaceSelectableIds();
  resourceSelectAllBtn.textContent = '反选';
  if (!ids.length) {
    resourceSelectAllBtn.disabled = true;
    return;
  }
  resourceSelectAllBtn.disabled = false;
}

function invertResourceSpaceSelectionByVisibleItems() {
  const ids = getResourceSpaceSelectableIds();
  ids.forEach((id) => {
    if (window.resourceSpaceSelected.has(id)) window.resourceSpaceSelected.delete(id);
    else window.resourceSpaceSelected.add(id);
  });

  if (resourceSpaceList instanceof HTMLElement) {
    const cbs = resourceSpaceList.querySelectorAll('input[data-action="resource-check"][data-resource-id]');
    cbs.forEach((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      const id = String(el.dataset.resourceId || '').trim();
      if (!id || isResourceDownloadActive(id)) return;
      el.checked = window.resourceSpaceSelected.has(id);
    });
  }
  refreshResourceSelectAllButton();
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
  // Also search saved upload items
  const savedRows = document.querySelectorAll('.file-item[data-saved-upload-id]');
  for (const row of savedRows) {
    if (!(row instanceof HTMLElement)) continue;
    if (`saved_${String(row.dataset.savedUploadId || '').trim()}` === rid) return row;
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
    if (!entry || entry.cancelled) {
      if (entry) entry.settled = true;
      continue;
    }
    entry.started = true;
    window.resourceDownloadQueueRunning += 1;
    (async () => {
      try {
        await downloadResourceItemWithProgress(entry.item);
        entry.resolve();
      } catch (err) {
        entry.reject(err);
      } finally {
        entry.settled = true;
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
  if (existing?.promise && !existing.cancelled && !existing.settled) return existing.promise;
  if (existing?.settled || existing?.cancelled) delete window.resourceDownloadQueueById[id];

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
    settled: false,
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
    status: '排队等待…'
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
  const downloadBtn = row.querySelector('button.resource-download-btn') || row.querySelector('button.saved-upload-download');

  if (checkbox instanceof HTMLInputElement) {
    checkbox.disabled = !!downloading;
    if (downloading) {
      checkbox.checked = false;
      window.resourceSpaceSelected.delete(String(resourceId || '').trim());
    }
  }

  if (downloadBtn instanceof HTMLButtonElement) {
    if (downloading) {
      downloadBtn.dataset.prevAction = downloadBtn.dataset.action || 'download-saved-upload';
      const prevAction = String(downloadBtn.dataset.prevAction || '').trim();
      const isSavedUpload = prevAction === 'download-saved-upload'
        || downloadBtn.classList.contains('saved-upload-download')
        || row.hasAttribute('data-saved-upload-id');
      downloadBtn.dataset.action = isSavedUpload ? 'cancel-saved-upload' : 'resource-cancel-download';
      downloadBtn.textContent = '取消';
      downloadBtn.classList.add('is-cancel');
    } else {
      downloadBtn.dataset.action = downloadBtn.dataset.prevAction || 'download-saved-upload';
      downloadBtn.textContent = '下载';
      downloadBtn.classList.remove('is-cancel');
      downloadBtn.disabled = false;
    }
  }
}

function updateResourceDownloadTotals() {
  if (!resourceTotalBar || !resourceTotalSizeInfo || !resourceTotalPercent || !resourceTotalSpeed || !resourceTotalEta) return;
  const resourceProgressWrap = resourceTotalBar.closest('.progress-bar-container');
  const tasks = Object.values(window.resourceDownloadTasks || {}).filter((t) => t && t.active);
  const queuedEntries = (window.resourceDownloadQueue || []).filter((q) => q && !q.cancelled && !q.started);
  const batch = window.resourceDownloadBatch || {};
  const hasActiveOrQueued = !!tasks.length || !!batch.active || !!queuedEntries.length;

  const completedLoaded = Math.max(0, Number(window.resourceDownloadCompletedContribution?.loadedBytes) || 0);
  const completedTotal = Math.max(0, Number(window.resourceDownloadCompletedContribution?.totalBytes) || 0);

  if (hasActiveOrQueued && window.resourceDownloadQueueClearTimer) {
    clearTimeout(window.resourceDownloadQueueClearTimer);
    window.resourceDownloadQueueClearTimer = null;
  }

  if (!tasks.length && !batch.active && !queuedEntries.length && completedLoaded <= 0 && completedTotal <= 0) {
    if (resourceProgressWrap instanceof HTMLElement) resourceProgressWrap.style.display = 'none';
    resourceTotalBar.style.width = '0%';
    resourceTotalBar.textContent = '';
    resourceTotalSizeInfo.innerHTML = renderFileSizePair(0, 0);
    resourceTotalSizeInfo.style.cssText = '';
    resourceTotalPercent.textContent = '0%';
    resourceTotalPercent.style.display = 'none';
    resourceTotalSpeed.textContent = '总速度: 0 KB/s';
    resourceTotalEta.textContent = '';
    refreshResourceQueueStatusText();
    return;
  }

  const batchActive = !!batch.active;
  let totalLoaded = completedLoaded + (batchActive ? Math.max(0, Number(batch.completedBytes) || 0) : 0);
  let totalSize = completedTotal + (batchActive ? Math.max(0, Number(batch.totalBytes) || 0) : 0);
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
  if (resourceProgressWrap instanceof HTMLElement) resourceProgressWrap.style.display = totalSize > 0 ? '' : 'none';
  resourceTotalPercent.style.display = totalSize > 0 ? '' : 'none';
  resourceTotalBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  resourceTotalBar.textContent = '';
  resourceTotalSizeInfo.innerHTML = hasKnownTotal && totalSize > 0
    ? renderFileSizePair(totalLoaded, totalSize)
    : `${renderFileSizeText(totalLoaded)} <span class="file-size-separator">/</span> <span class="file-size-placeholder">--</span>`;
  resourceTotalSizeInfo.style.cssText = '';
  resourceTotalPercent.textContent = hasKnownTotal && totalSize > 0 ? `${percent}%` : '--';
  resourceTotalSpeed.textContent = `总速度: ${formatSpeed(totalSpeed)}`;

  if (hasKnownTotal && totalSize > totalLoaded && totalSpeed > 0) {
    resourceTotalEta.textContent = `总剩余: ${formatEta((totalSize - totalLoaded) / totalSpeed)}`;
  } else if (hasKnownTotal && totalSize > totalLoaded) {
    resourceTotalEta.textContent = '总剩余: 计算中…';
  } else if (tasks.length || batchActive || queuedEntries.length) {
    resourceTotalEta.textContent = hasKnownTotal ? '' : '总剩余: 计算中…';
  } else {
    resourceTotalEta.textContent = '';
  }

  refreshResourceQueueStatusText();
}

function addResourceDownloadCompletedContribution(loaded = 0, total = 0) {
  const loadedSafe = Math.max(0, Number(loaded) || 0);
  const totalSafe = Math.max(0, Number(total) || 0);
  if (!window.resourceDownloadCompletedContribution || typeof window.resourceDownloadCompletedContribution !== 'object') {
    window.resourceDownloadCompletedContribution = { loadedBytes: 0, totalBytes: 0 };
  }
  window.resourceDownloadCompletedContribution.loadedBytes = Math.max(0, Number(window.resourceDownloadCompletedContribution.loadedBytes) || 0) + loadedSafe;
  window.resourceDownloadCompletedContribution.totalBytes = Math.max(0, Number(window.resourceDownloadCompletedContribution.totalBytes) || 0) + Math.max(totalSafe, loadedSafe);
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
  bar.textContent = '';

  if (statusEl instanceof HTMLElement) statusEl.textContent = String(status || '');

  if (sizeEl instanceof HTMLElement) {
    const loadedSafe = Math.max(0, Number(loaded) || 0);
    const totalSafe = Math.max(0, Number(total) || 0);
    sizeEl.style.cssText = 'margin-left:6px;';
    if (totalSafe > 0) {
      sizeEl.innerHTML = `(${renderFileSizePair(loadedSafe, totalSafe)})`;
    } else if (loadedSafe > 0) {
      sizeEl.innerHTML = `(${renderFileSizeText(loadedSafe)})`;
    } else if (active) {
      sizeEl.textContent = '(未知大小)';
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
  let rawUrl = String(item?.url || '').trim();
  const fileName = ensureResourceDownloadFileName(item, rawUrl);
  const expectedBytes = getResourceItemSizeBytes(item);
  if (!id) throw new Error('资源链接无效');
  if (!rawUrl && item?.rpId) {
    const result = await fetchCoursewareRpUrl(item.rpId);
    rawUrl = String(result?.url || '').trim();
    if (rawUrl) item.url = rawUrl;
  }
  if (!rawUrl) throw new Error('资源链接无效');

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
    status: '下载中…'
  });

  const updateProgress = (loaded, total, status = '下载中…', force = false) => {
    const now = Date.now();
    const loadedSafe = Math.max(0, Number(loaded) || 0);
    const totalSafe = Math.max(0, Number(total) || 0);
    task.loaded = loadedSafe;
    if (totalSafe > 0) task.total = totalSafe;
    const effectiveTotal = task.total;

    const speed = pushAndCalcRecentSpeed(task.samples, loadedSafe, now);
    task.speed = speed;

    if (!force && now - task.lastUiTs < PROGRESS_INTERVAL_MS) return;
    task.lastUiTs = now;

    const percent = effectiveTotal > 0 ? Math.round((loadedSafe / effectiveTotal) * 100) : 0;
    const etaSec = (effectiveTotal > 0 && speed > 0) ? ((effectiveTotal - loadedSafe) / speed) : null;
    setResourceDownloadUi(id, {
      active: true,
      percent,
      loaded: loadedSafe,
      total: effectiveTotal,
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
    addResourceDownloadCompletedContribution(finalLoaded, finalTotal);
    finalizeSuccessUi(finalLoaded, finalTotal, '下载完成，准备保存…');

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
      updateProgress(Number(e.loaded || 0), Number(e.total || 0), '下载中…');
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
      updateProgress(loaded, total, '下载中…', true);
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
          updateProgress(loaded, total, '下载中…');
        }
      }
      blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
    } else {
      blob = await res.blob();
      loaded = blob.size;
      updateProgress(loaded, total || loaded, '下载中…', true);
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
      setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: task.speed, etaSec: null, status: 'Fetch失败，正在重试…' });
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
        setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: task.speed, etaSec: null, status: '页面下载失败，转浏览器下载…' });
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
    refreshResourceSelectAllButton();
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
  refreshResourceSelectAllButton();
  updateResourceDownloadTotals();
}

async function fetchResourceSpaceListRaw(rows = 10, searchName = '') {
  const url = `${BASE_VE}back/resourceSpace.shtml?method=resourceSpaceList`;
  const safeRows = String(Math.max(1, Number(rows) || 10));
  const encodedSearch = encodeURIComponent(encodeURIComponent(normalizeResourceSearchKeyword(searchName)));
  const body = `type=1&rows=${safeRows}&searchName=${encodedSearch}`;
  const { text, res } = await fetchText(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body
  });
  if (isLikelyLoginPageHtml(text, res?.url)) return { loginRequired: true, total: 0, result: [] };
  let data = null;
  try { data = parseVeJson(text); } catch { data = null; }
  if (!data || typeof data !== 'object') return { loginRequired: true, total: 0, result: [] };
  const total = Number(data.total || 0);
  const result = Array.isArray(data.result) ? data.result : [];
  return { loginRequired: false, total, result };
}

async function loadResourceSpaceForCurrentAccount(searchName = resourceSpaceSearchKeyword) {
  if (!resourceSpaceSection || !resourceSpaceList) return;
  const keyword = normalizeResourceSearchKeyword(searchName);
  resourceSpaceSearchKeyword = keyword;
  if (resourceSearchInput instanceof HTMLInputElement && resourceSearchInput.value !== keyword) {
    resourceSearchInput.value = keyword;
  }
  const loadVersion = ++window.resourceSpaceLoadVersion;
  const isStale = () => loadVersion !== window.resourceSpaceLoadVersion;

  setResourceSpaceStatus(keyword ? `资源空间加载中（搜索：${keyword}）…` : '资源空间加载中…');
  resourceSpaceList.innerHTML = '';
  window.resourceDownloadTasks = {};
  resetResourceDownloadBatch();
  updateResourceDownloadTotals();

  try {
    const firstRows = 10;
    let payload = await fetchResourceSpaceListRaw(firstRows, keyword);
    if (isStale()) return;

    if (payload.loginRequired) {
      window.resourceSpaceItems = [];
      window.resourceSpaceSelected = new Set();
      window.resourceDownloadTasks = {};
      resetResourceDownloadBatch();
      setResourceSpaceCount(0);
      setResourceSpaceStatus('未登录或登录已失效，请先登录智慧课程平台', 'warning');
      renderResourceSpaceList();
      handleLoginRequired(() => {
        loadResourceSpaceForCurrentAccount(searchName);
      }, null, '登录已失效，请输入账号登录');
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
      setResourceSpaceStatus(`已加载 ${normalized.length} 个资源文件，正在继续加载…`);
      renderResourceSpaceList();

      payload = await fetchResourceSpaceListRaw(payload.total, keyword);
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

async function fetchVeTeacherIdByCourse(courseId) {
  const courseIdPart = String(courseId || '').trim();
  if (!courseIdPart) return [];
  // POST: getAssistantForCourse，courseId 为课程 id（非 course_num）
  const url = `${BASE_VE}back/course/courseAssistantInfo.shtml?method=getAssistantForCourse`;
  const postBody = new URLSearchParams({ courseId: courseIdPart });
  try {
    const { text } = await fetchText(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString()
    });
    const data = JSON.parse(text);
    if (data?.result && Array.isArray(data.result) && data.result.length) {
      return data.result;
    }
  } catch {
    // ignore
  }
  return [];
}

function updateVeTeacherMetaUi(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const meta = window.veTeacherMetaByCourseId?.[cid] || {};
  const teachers = Array.isArray(meta.teachers) ? meta.teachers : [];

  document.querySelectorAll('.ve-teacher-pop').forEach((pop) => {
    if (!(pop instanceof HTMLElement)) return;
    if (String(pop.dataset.courseId || '').trim() !== cid) return;
    pop.innerHTML = renderVeTeacherMetaPopHtml(meta, teachers);
  });
}

function renderVeTeacherMetaPopHtml(meta, teachers) {
  if (meta.loading) {
    return '<div style="font-size:12px; color:#64748b;"><span class="spinner" style="width:10px;height:10px;border-width:1px;border-color:#2563eb;border-top-color:transparent;"></span> 正在获取教师信息…</div>';
  }
  if (!teachers.length) {
    return '<div style="font-size:12px; color:#64748b;">未查询到教师/助教信息</div>';
  }

  const rows = teachers.map((t) => {
    const userName = escapeHtml(String(t?.userName || '')).trim() || '-';
    const loginName = escapeHtml(String(t?.loginName || '')).trim() || '-';
    const userType = String(t?.userType || '').trim();
    const role = userType === '1' ? '任课教师' : (userType === '2' ? '助教' : '其他');
    const action = loginName !== '-' && loginName
      ? `<button type="button" class="ve-switch-teacher-btn" data-action="switch-teacher-account" data-teacher-id="${loginName}">切换至此账号</button>`
      : '<span style="font-size:11px;color:#999;">-</span>';
    return `<tr><td>${userName}</td><td>${loginName}</td><td>${role}</td><td>${action}</td></tr>`;
  }).join('');

  return `
    <table class="ve-course-teacher-table" style="font-size:12px;">
      <thead><tr><th>姓名</th><th>教职工号/助教号</th><th>角色</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function hydrateVeTeacherMeta(courseId, courseNum, fzId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const existing = window.veTeacherMetaByCourseId[cid] || {};
  if (existing.loading) return;
  if (existing.loaded && existing.teachers?.length) {
    updateVeTeacherMetaUi(cid);
    return;
  }
  window.veTeacherMetaByCourseId[cid] = { ...existing, loading: true };
  updateVeTeacherMetaUi(cid);
  try {
    const teachers = await fetchVeTeacherIdByCourse(cid);
    // teachers: [{userName,loginName,userType}] where userType "1"=任课教师 "2"=助教
    const firstTeacher = Array.isArray(teachers) ? teachers.find((t) => t.userType === '1') || teachers[0] : null;
    window.veTeacherMetaByCourseId[cid] = {
      teacherId: String(firstTeacher?.loginName || '').trim(),
      teachers,
      loading: false,
      loaded: true
    };
  } catch {
    window.veTeacherMetaByCourseId[cid] = { teacherId: '', teachers: [], loading: false, loaded: true };
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
  const rows = []; // [{teacherName,teacherId,roomName,xkhId,classNo}]
  const seen = new Set();
  const controllers = new Map();
  let stopAt = Number.POSITIVE_INFINITY;
  let nextClassNo = 1;
  const MAX_CLASS_NO = 99;
  const WORKERS = 6;

  const emitUpdate = (done = false) => {
    if (typeof onUpdate !== 'function') return;
    const sorted = rows
      .slice()
      .sort((a, b) => Number(a.classNo || 0) - Number(b.classNo || 0))
      .map((it) => ({
        teacherName: it.teacherName,
        teacherId: it.teacherId,
        roomName: it.roomName,
        xkhId: it.xkhId
      }));
    onUpdate(sorted, { done, error: false });
  };

  const markStop = (classNo) => {
    if (!Number.isFinite(Number(classNo))) return;
    const n = Number(classNo);
    if (n >= stopAt) return;
    stopAt = n;
    controllers.forEach((ctrl, key) => {
      if (Number(key) > stopAt) {
        try { ctrl.abort(); } catch { /* ignore */ }
      }
    });
  };

  const fetchOne = async (classNo) => {
    if (classNo > stopAt) return;
    const xkhId = `${prefix}${formatVeClassNumber(classNo)}`;
    const url = `${BASE_VE}back/course/courseInfo.shtml?method=queryRecordResourceForCourseList&courseId=${encodeURIComponent(courseIdPart)}&xkhId=${encodeURIComponent(xkhId)}`;
    const controller = new AbortController();
    controllers.set(classNo, controller);

    try {
      const { text, res } = await fetchText(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (isLikelyLoginPageHtml(text, res?.url)) {
        markStop(classNo);
        return;
      }

      let data = null;
      try {
        data = parseVeJson(text);
      } catch {
        markStop(classNo);
        return;
      }
      if (String(data?.STATUS) !== '0') {
        markStop(classNo);
        return;
      }

      const item = Array.isArray(data?.result) && data.result.length ? data.result[0] : null;
      const teacherName = String(item?.teacherName || '').trim();
      const teacherId = String(item?.teacherId || '').trim();
      const roomName = String(item?.roomName || '').trim();
      const hasContent = !!(teacherName || teacherId || roomName);
      if (!hasContent) {
        markStop(classNo);
        return;
      }

      const key = `${teacherId}__${teacherName}__${roomName}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ teacherName, teacherId, roomName, xkhId, classNo });
        emitUpdate(false);
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      markStop(classNo);
    } finally {
      controllers.delete(classNo);
    }
  };

  const worker = async () => {
    while (true) {
      const classNo = nextClassNo;
      nextClassNo += 1;
      if (classNo > MAX_CLASS_NO) return;
      if (classNo > stopAt) return;
      await fetchOne(classNo);
    }
  };

  const workerCount = Math.max(1, Math.min(WORKERS, MAX_CLASS_NO));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (typeof onUpdate === 'function') {
    emitUpdate(true);
  }
  return rows
    .slice()
    .sort((a, b) => Number(a.classNo || 0) - Number(b.classNo || 0))
    .map((it) => ({
      teacherName: it.teacherName,
      teacherId: it.teacherId,
      roomName: it.roomName,
      xkhId: it.xkhId
    }));
}

function renderVeCourseTeachersPopHtml(meta) {
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const tableHtml = rows.length
    ? (() => {
      const body = renderVeCourseTeacherRowsHtml(rows);
      return `
        <table class="ve-course-teacher-table">
          <thead><tr><th>xkhId</th><th>教师姓名</th><th>工号</th><th>教室</th><th>操作</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      `;
    })()
    : '';

  if (meta.loading) {
    if (tableHtml) {
      return `${tableHtml}<div class="ve-course-teacher-loading"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span><span>正在获取更多同课教师…</span></div>`;
    }
    return '<div class="ve-course-teacher-loading"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span><span>正在获取同课教师…</span></div>';
  }

  if (meta.error) {
    if (tableHtml) {
      return `${tableHtml}<div class="ve-course-teacher-loading warning">获取同课教师失败，已显示部分结果</div>`;
    }
    return '<div class="ve-course-teacher-loading warning">获取同课教师失败，请稍后重试</div>';
  }

  if (!tableHtml) {
    return '<div style="font-size:12px; color:#64748b;">未查询到同课其他教师<br>无法获取无回放课程</div>';
  }
  return tableHtml;
}

function renderVeCourseTeacherRowsHtml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((it) => {
    const xkhId = String(it?.xkhId || '');
    const xkhSuffix = xkhId.length >= 10 ? xkhId.slice(-10) : (xkhId || '-');
    const teacherName = escapeHtml(String(it?.teacherName || '')) || '-';
    const teacherId = escapeHtml(String(it?.teacherId || '')) || '-';
    const roomName = escapeHtml(String(it?.roomName || '')) || '-';
    const teacherIdRaw = String(it?.teacherId || '').trim();
    const action = teacherIdRaw
      ? `<button type="button" class="ve-switch-teacher-btn" data-action="switch-teacher-account" data-teacher-id="${escapeHtml(teacherIdRaw)}">切换至此账号</button>`
      : '<button type="button" class="ve-switch-teacher-btn" disabled style="opacity:.6;">切换至此账号</button>';
    return `<tr><td>${escapeHtml(xkhSuffix)}</td><td>${teacherName}</td><td>${teacherId}</td><td>${roomName}</td><td>${action}</td></tr>`;
  }).join('');
}

function updateVeCourseTeachersPopUi(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const meta = window.veCourseTeachersMetaByCourseId?.[cid] || { rows: [], loading: false, loaded: false, error: false };
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const rowsHash = rows.map((it) => `${String(it?.teacherId || '')}|${String(it?.teacherName || '')}|${String(it?.roomName || '')}|${String(it?.xkhId || '')}`).join('||');

  document.querySelectorAll('.ve-course-teacher-pop').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (String(el.dataset.courseId || '').trim() !== cid) return;

    let tableWrap = el.querySelector('.ve-course-teacher-table-wrap');
    let statusLine = el.querySelector('.ve-course-teacher-status-line');
    let statusSpinner = el.querySelector('.ve-course-teacher-status-spinner');
    let statusText = el.querySelector('.ve-course-teacher-status-text');
    if (!(tableWrap instanceof HTMLElement) || !(statusLine instanceof HTMLElement) || !(statusText instanceof HTMLElement)) {
      el.innerHTML = `
        <div class="ve-course-teacher-table-wrap"></div>
        <div class="ve-course-teacher-loading ve-course-teacher-status-line" style="display:none;">
          <span class="spinner ve-course-teacher-status-spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span>
          <span class="ve-course-teacher-status-text"></span>
        </div>
      `;
      tableWrap = el.querySelector('.ve-course-teacher-table-wrap');
      statusLine = el.querySelector('.ve-course-teacher-status-line');
      statusSpinner = el.querySelector('.ve-course-teacher-status-spinner');
      statusText = el.querySelector('.ve-course-teacher-status-text');
      el.dataset.rowsHash = '';
    }
    if (!(tableWrap instanceof HTMLElement) || !(statusLine instanceof HTMLElement) || !(statusText instanceof HTMLElement)) return;

    const prevHash = String(el.dataset.rowsHash || '');
    if (prevHash !== rowsHash) {
      if (!rows.length) {
        tableWrap.innerHTML = '';
      } else {
        const tbody = renderVeCourseTeacherRowsHtml(rows);
        tableWrap.innerHTML = `
          <table class="ve-course-teacher-table">
            <thead><tr><th>课程号</th><th>教师姓名</th><th>工号</th><th>教室</th><th>操作</th></tr></thead>
            <tbody>${tbody}</tbody>
          </table>
        `;
      }
      el.dataset.rowsHash = rowsHash;
    }

    statusLine.classList.remove('warning');
    statusLine.style.display = 'none';
    if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'inline-block';

    if (meta.loading) {
      statusLine.style.display = 'flex';
      statusText.textContent = rows.length ? '正在获取更多同课教师…' : '正在获取同课教师…';
      return;
    }
    if (meta.error) {
      statusLine.style.display = 'flex';
      statusLine.classList.add('warning');
      if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'none';
      statusText.textContent = rows.length ? '获取同课教师失败，已显示部分结果' : '获取同课教师失败，请稍后重试';
      return;
    }
    if (!rows.length) {
      statusLine.style.display = 'flex';
      if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'none';
      statusText.innerHTML = '未查询到同课其他教师<br>无法获取无回放课程';
    }
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
    hydrateVeUserNamesForCourseTeachers(cid).catch(() => {});
  })
    .then((rows) => {
      window.veCourseTeachersMetaByCourseId[cid] = { rows: Array.isArray(rows) ? rows : [], loading: false, loaded: true, error: false, promise: null };
      updateVeCourseTeachersPopUi(cid);
      hydrateVeUserNamesForCourseTeachers(cid).catch(() => {});
    })
    .catch(() => {
      window.veCourseTeachersMetaByCourseId[cid] = { rows: [], loading: false, loaded: true, error: true, promise: null };
      updateVeCourseTeachersPopUi(cid);
    });

  window.veCourseTeachersMetaByCourseId[cid] = { ...loadingMeta, promise: p };
  hydrateVeUserNamesForCourseTeachers(cid).catch(() => {});
  return p;
}

// 学生账号下，通过工号 getUserInfo 解析同课其他教师的真实 userName，覆盖原始教师姓名
async function hydrateVeUserNamesForCourseTeachers(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  // 仅学生账号触发：教师/助教账号下，原始教师姓名已经是权威，无需覆盖
  if (window.isTeacherAccount) return;
  const meta = window.veCourseTeachersMetaByCourseId?.[cid];
  if (!meta || !Array.isArray(meta.rows) || !meta.rows.length) return;
  const rows = meta.rows;
  if (!window.veUserNameByTeacherId) window.veUserNameByTeacherId = {};
  const cache = window.veUserNameByTeacherId;

  // 收集本课程涉及的所有工号
  const teacherIds = new Set();
  for (const row of rows) {
    const tid = String(row?.teacherId || '').trim();
    if (tid) teacherIds.add(tid);
  }
  if (!teacherIds.size) return;

  let redrawNeeded = false;
  const pending = [];
  for (const tid of teacherIds) {
    const entry = cache[tid] || { name: null, promise: null };
    cache[tid] = entry;
    // 已有解析结果：直接覆盖原始姓名
    if (entry.name) {
      for (const row of rows) {
        if (String(row?.teacherId || '').trim() === tid && String(row.teacherName || '').trim() !== entry.name) {
          row.teacherName = entry.name;
          redrawNeeded = true;
        }
      }
      continue;
    }
    // 正在请求中：让出，等待结果
    if (entry.promise) {
      pending.push(entry.promise.then((name) => {
        if (!name) return;
        for (const row of rows) {
          if (String(row?.teacherId || '').trim() === tid && String(row.teacherName || '').trim() !== name) {
            row.teacherName = name;
            redrawNeeded = true;
          }
        }
      }).catch(() => {}));
      continue;
    }
    // 发起新请求
    const p = resolveVeUserNameByWorknumber(tid).then((name) => {
      if (!name) return;
      for (const row of rows) {
        if (String(row?.teacherId || '').trim() === tid && String(row.teacherName || '').trim() !== name) {
          row.teacherName = name;
          redrawNeeded = true;
        }
      }
    }).catch(() => {});
    pending.push(p);
  }
  if (redrawNeeded) {
    updateVeCourseTeachersPopUi(cid);
  }
  if (pending.length) {
    Promise.all(pending).then(() => {
      // 最后再做一次重绘，确保所有并发结果都反映到 UI
      updateVeCourseTeachersPopUi(cid);
    }).catch(() => {});
  }
}

async function switchToTeacherAccount(teacherId) {
  const tid = String(teacherId || '').trim();
  if (!tid) {
    showToast('教师/助教账号为空，无法切换', 'warning', 1600);
    return;
  }
  if (usernameInput.value.trim() === tid) {
    showToast('当前已是该账号', 'info', 1200);
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

function isNativeHomeworkOverdue(hw) {
  const deadline = hw?.end_time ?? hw?.endTime ?? '';
  return !isNativeHomeworkDone(hw) && isDeadlinePassed(deadline);
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

function isYktHomeworkOverdue(hw) {
  return !isYktHomeworkDone(hw) && isDeadlinePassed(hw?.end);
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
  if (state?.hasReplay && state?.hasCourseware) return 3;
  if (state?.hasReplay) return 4;
  if (state?.hasCourseware) return 5;
  if (state?.replayListLoading && state?.coursewareListLoading) return 6;
  if (state?.replayListLoading) return 7;
  if (state?.coursewareListLoading) return 8;
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
  );
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

function ensureMrjzyLoginTip() {
  return null;
}

function removeMrjzyLoginTip() {
  // no-op: use toast messages instead of fixed top tip.
}

function completeExternalLoginAssist(platform, forceReload = true) {
  const p = normalizePlatformId(platform);
  if (!['ykt', 'mrjzy', 'jlgj'].includes(p)) return;
  if (!window.platformEnabled?.[p]) {
    window.platformEnabled[p] = true;
    savePlatformEnabledToStorage().catch(() => {});
  }
  window.platformInteractiveLoginPending[p] = false;
  setPlatformLoginState(p, 'checking');
  triggerExternalPlatformLoad(p, forceReload);
}

function scheduleYktLoginAssistRecheck(delayMs = 500) {
  if (yktLoginAssistRetryTimer) {
    clearTimeout(yktLoginAssistRetryTimer);
    yktLoginAssistRetryTimer = null;
  }
  yktLoginAssistRetryTimer = setTimeout(() => {
    yktLoginAssistRetryTimer = null;
    if (!window.platformInteractiveLoginPending?.ykt && !isPlatformEnabled('ykt')) return;
    completeExternalLoginAssist('ykt', true);
  }, Math.max(120, Number(delayMs) || 500));
}

function stopYktLoginAssistWatcher() {
  if (yktLoginAssistPollTimer) {
    clearInterval(yktLoginAssistPollTimer);
    yktLoginAssistPollTimer = null;
  }
  yktLoginAssistChecking = false;
}

function isYktLoginSuccessUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  return u.startsWith(YKT_WECHAT_LOGIN_SUCCESS_URL_PREFIX);
}

async function checkYktLoginAssistPopupUrl() {
  if (!window.platformInteractiveLoginPending?.ykt) return false;
  if (!yktLoginAssistPopupTabId) return false;
  try {
    const tab = await chrome.tabs.get(Number(yktLoginAssistPopupTabId));
    const currentUrl = String(tab?.url || '').trim();
    if (isYktLoginSuccessUrl(currentUrl)) {
      closeYktLoginAssistPopup(false);
      scheduleYktLoginAssistRecheck(250);
      return true;
    }
  } catch {
    // popup may be closed by user
    yktLoginAssistPopupWindowId = null;
    yktLoginAssistPopupTabId = null;
    window.platformInteractiveLoginPending.ykt = false;
    stopYktLoginAssistWatcher();
  }
  return false;
}

async function checkYktLoginAssistStatus() {
  if (yktLoginAssistChecking) return false;
  if (!isPlatformEnabled('ykt') && !window.platformInteractiveLoginPending?.ykt) return false;
  if (!window.platformInteractiveLoginPending?.ykt) return false;
  yktLoginAssistChecking = true;
  try {
    const resp = await fetchYktJson(YKT_COURSE_LIST_API);
    const ok = Number(resp?.errcode) === 0;
    if (ok) {
      closeYktLoginAssistPopup(false);
      scheduleYktLoginAssistRecheck(300);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    yktLoginAssistChecking = false;
  }
}

function startYktLoginAssistWatcher() {
  stopYktLoginAssistWatcher();
  yktLoginAssistPollTimer = setInterval(() => {
    void checkYktLoginAssistStatus();
    void checkYktLoginAssistPopupUrl();
  }, PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS);
  void checkYktLoginAssistStatus();
  void checkYktLoginAssistPopupUrl();
}

function closeYktLoginAssistPopup(cancelPending = false) {
  const mask = document.getElementById('ykt-login-assist-mask');
  if (mask instanceof HTMLElement) {
    mask.style.display = 'none';
  }
  if (yktLoginAssistPopupWindowId) {
    chrome.windows.remove(Number(yktLoginAssistPopupWindowId)).catch(() => {});
  }
  yktLoginAssistPopupWindowId = null;
  yktLoginAssistPopupTabId = null;
  stopYktLoginAssistWatcher();
  if (cancelPending) {
    window.platformInteractiveLoginPending.ykt = false;
  }
}

function ensureYktLoginAssistPopup() {
  let mask = document.getElementById('ykt-login-assist-mask');
  if (mask instanceof HTMLElement) return mask;

  mask = document.createElement('div');
  mask.id = 'ykt-login-assist-mask';
  mask.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:1200',
    'background:rgba(15,23,42,0.45)',
    'align-items:center',
    'justify-content:center',
    'padding:12px'
  ].join(';');
  mask.innerHTML = `
    <div style="width:min(360px, 92vw); max-height:min(88vh, 560px); background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 14px 36px rgba(15,23,42,0.3); display:flex; flex-direction:column;">
      <div style="height:44px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; border-bottom:1px solid #e5e7eb;">
        <div style="font-size:14px; font-weight:700; color:#0f172a;">登录雨课堂</div>
        <button type="button" data-action="close-ykt-login-assist" class="modal-close-btn" style="position:static; flex-shrink:0;" aria-label="关闭" title="关闭">×</button>
      </div>
      <div style="flex:1; padding:8px; background:#f8fafc;">
        <iframe id="ykt-login-assist-frame" title="登录雨课堂" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" style="width:100%; height:100%; border:0; border-radius:8px; background:#fff;"></iframe>
      </div>
    </div>
  `;
  document.body.appendChild(mask);

  const closeBtn = mask.querySelector('button[data-action="close-ykt-login-assist"]');
  if (closeBtn instanceof HTMLButtonElement) {
    closeBtn.addEventListener('click', () => closeYktLoginAssistPopup(true));
  }
  mask.addEventListener('click', (e) => {
    if (e.target === mask) closeYktLoginAssistPopup(true);
  });

  const frame = mask.querySelector('#ykt-login-assist-frame');
  if (frame instanceof HTMLIFrameElement) {
    frame.addEventListener('load', () => {
      if (mask.style.display === 'none') return;
      yktLoginIframeLoadCount += 1;
      void checkYktLoginAssistStatus();
    });
  }

  return mask;
}

function openYktLoginAssistPopup(force = false) {
  if (!force && !isPlatformEnabled('ykt')) return;
  window.platformInteractiveLoginPending.ykt = true;
  if (yktLoginAssistPopupWindowId && yktLoginAssistPopupTabId) {
    chrome.windows.update(Number(yktLoginAssistPopupWindowId), { focused: true }).catch(() => {});
    startYktLoginAssistWatcher();
    return;
  }
  const openPopup = async () => {
    const popupWidth = 360;
    const popupHeight = 520;
    let left;
    let top;
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (Number.isFinite(Number(currentWin?.left)) && Number.isFinite(Number(currentWin?.top)) && Number.isFinite(Number(currentWin?.width)) && Number.isFinite(Number(currentWin?.height))) {
        left = Math.max(0, Number(currentWin.left) + Math.round((Number(currentWin.width) - popupWidth) / 2));
        top = Math.max(0, Number(currentWin.top) + Math.round((Number(currentWin.height) - popupHeight) / 2));
      }
    } catch {
      left = undefined;
      top = undefined;
    }

    const created = await chrome.windows.create({
      url: YKT_WECHAT_QR_LOGIN_URL,
      type: 'popup',
      focused: true,
      width: popupWidth,
      height: popupHeight,
      left,
      top
    });
    yktLoginAssistPopupWindowId = Number(created?.id || 0) || null;
    const tab = Array.isArray(created?.tabs) && created.tabs.length ? created.tabs[0] : null;
    yktLoginAssistPopupTabId = Number(tab?.id || 0) || null;
    yktLoginIframeLoadCount = 0;
    yktLoginIframeOpenedAt = Date.now();
    startYktLoginAssistWatcher();
  };
  openPopup().catch(() => {
    showToast('打开雨课堂登录弹窗失败，请检查浏览器弹窗权限', 'error', 2200);
  });
}

function scheduleJlgjLoginAssistRecheck(delayMs = 500) {
  if (jlgjLoginAssistRetryTimer) {
    clearTimeout(jlgjLoginAssistRetryTimer);
    jlgjLoginAssistRetryTimer = null;
  }
  jlgjLoginAssistRetryTimer = setTimeout(() => {
    jlgjLoginAssistRetryTimer = null;
    if (!window.platformInteractiveLoginPending?.jlgj && !isPlatformEnabled('jlgj')) return;
    completeExternalLoginAssist('jlgj', true);
  }, Math.max(120, Number(delayMs) || 500));
}

function stopJlgjLoginAssistWatcher() {
  if (jlgjLoginAssistPollTimer) {
    clearInterval(jlgjLoginAssistPollTimer);
    jlgjLoginAssistPollTimer = null;
  }
}

function isJlgjLoginSuccessUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  return u.startsWith(JLGJ_LOGIN_SUCCESS_URL_PREFIX);
}

async function checkJlgjLoginAssistPopupUrl() {
  if (!window.platformInteractiveLoginPending?.jlgj) return false;
  if (!jlgjLoginAssistPopupTabId) return false;
  try {
    const tab = await chrome.tabs.get(Number(jlgjLoginAssistPopupTabId));
    const currentUrl = String(tab?.url || '').trim();
    if (isJlgjLoginSuccessUrl(currentUrl)) {
      closeJlgjLoginAssistPopup(false);
      stopJlgjLoginAssistWatcher();
      scheduleJlgjLoginAssistRecheck(180);
      return true;
    }
  } catch {
    jlgjLoginAssistPopupWindowId = null;
    jlgjLoginAssistPopupTabId = null;
    stopJlgjLoginAssistWatcher();
  }
  return false;
}

function startJlgjLoginAssistWatcher() {
  stopJlgjLoginAssistWatcher();
  jlgjLoginAssistPollTimer = setInterval(() => {
    void checkJlgjLoginAssistPopupUrl();
  }, PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS);
  void checkJlgjLoginAssistPopupUrl();
}

function closeJlgjLoginAssistPopup(cancelPending = false) {
  if (jlgjLoginAssistPopupWindowId) {
    chrome.windows.remove(Number(jlgjLoginAssistPopupWindowId)).catch(() => {});
  }
  jlgjLoginAssistPopupWindowId = null;
  jlgjLoginAssistPopupTabId = null;
  stopJlgjLoginAssistWatcher();
  if (cancelPending) {
    window.platformInteractiveLoginPending.jlgj = false;
  }
}

function openJlgjLoginAssistPopup(force = false) {
  if (!force && !isPlatformEnabled('jlgj')) return;
  window.platformInteractiveLoginPending.jlgj = true;
  if (jlgjLoginAssistPopupWindowId && jlgjLoginAssistPopupTabId) {
    chrome.windows.update(Number(jlgjLoginAssistPopupWindowId), { focused: true }).catch(() => {});
    startJlgjLoginAssistWatcher();
    return;
  }

  const openPopup = async () => {
    const screenW = Number(globalThis.screen?.availWidth || globalThis.screen?.width || 0);
    const screenH = Number(globalThis.screen?.availHeight || globalThis.screen?.height || 0);
    const popupWidth = Math.max(980, Math.min(1320, Math.round(screenW * 0.9) || 980));
    const popupHeight = Math.max(640, Math.min(860, Math.round(screenH * 0.82) || 760));
    let left;
    let top;
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (Number.isFinite(Number(currentWin?.left)) && Number.isFinite(Number(currentWin?.top)) && Number.isFinite(Number(currentWin?.width)) && Number.isFinite(Number(currentWin?.height))) {
        left = Math.max(0, Number(currentWin.left) + Math.round((Number(currentWin.width) - popupWidth) / 2));
        top = Math.max(0, Number(currentWin.top) + Math.round((Number(currentWin.height) - popupHeight) / 2));
      }
    } catch {
      left = undefined;
      top = undefined;
    }

    const created = await chrome.windows.create({
      url: JLGJ_LOGIN_ASSIST_URL,
      type: 'popup',
      focused: true,
      width: popupWidth,
      height: popupHeight,
      left,
      top
    });
    jlgjLoginAssistPopupWindowId = Number(created?.id || 0) || null;
    const tab = Array.isArray(created?.tabs) && created.tabs.length ? created.tabs[0] : null;
    jlgjLoginAssistPopupTabId = Number(tab?.id || 0) || null;
    startJlgjLoginAssistWatcher();
  };

  openPopup().catch(() => {
    showToast('打开接龙管家登录弹窗失败，请检查浏览器弹窗权限', 'error', 2200);
  });
}

function stopMrjzyLoginAssistPolling() {
  if (mrjzyLoginAssistPollTimer) {
    clearInterval(mrjzyLoginAssistPollTimer);
    mrjzyLoginAssistPollTimer = null;
  }
  mrjzyLoginAssistPolling = false;
}

function scheduleMrjzyLoginAssistRecheck(delayMs = 500) {
  if (mrjzyLoginAssistRetryTimer) {
    clearTimeout(mrjzyLoginAssistRetryTimer);
    mrjzyLoginAssistRetryTimer = null;
  }
  mrjzyLoginAssistRetryTimer = setTimeout(() => {
    mrjzyLoginAssistRetryTimer = null;
    if (!window.platformInteractiveLoginPending?.mrjzy && !isPlatformEnabled('mrjzy')) return;
    completeExternalLoginAssist('mrjzy', true);
  }, Math.max(120, Number(delayMs) || 500));
}

function closeMrjzyLoginAssistPopup(cancelPending = false) {
  const mask = document.getElementById('mrjzy-login-assist-mask');
  if (mask instanceof HTMLElement) {
    mask.style.display = 'none';
  }
  stopMrjzyLoginAssistPolling();
  if (cancelPending) {
    window.platformInteractiveLoginPending.mrjzy = false;
  }
}

function ensureMrjzyLoginAssistPopup() {
  let mask = document.getElementById('mrjzy-login-assist-mask');
  if (mask instanceof HTMLElement) return mask;

  mask = document.createElement('div');
  mask.id = 'mrjzy-login-assist-mask';
  mask.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:1200',
    'background:rgba(15,23,42,0.45)',
    'align-items:center',
    'justify-content:center',
    'padding:12px'
  ].join(';');
  mask.innerHTML = `
    <div style="width:min(360px, 92vw); max-height:min(88vh, 560px); background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 14px 36px rgba(15,23,42,0.3); display:flex; flex-direction:column;">
      <div style="height:44px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; border-bottom:1px solid #e5e7eb;">
        <div style="font-size:14px; font-weight:700; color:#0f172a;">登录每日交作业</div>
        <button type="button" data-action="close-mrjzy-login-assist" class="btn modal-close-btn" aria-label="关闭" title="关闭">×</button>
      </div>
      <div style="flex:1; padding:14px 14px 16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;">
        <img id="mrjzy-login-assist-qr" alt="登录二维码" title="点击刷新二维码" style="width:220px; height:220px; border:1px solid #e2e8f0; border-radius:8px; background:#fff; cursor:pointer;" />
        <div style="font-size:13px; color:#334155; text-align:center;">使用微信扫一扫登录</div>
        <div id="mrjzy-login-assist-status" style="min-height:18px; font-size:12px; color:#64748b; text-align:center;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(mask);

  const closeBtn = mask.querySelector('button[data-action="close-mrjzy-login-assist"]');
  if (closeBtn instanceof HTMLButtonElement) {
    closeBtn.addEventListener('click', () => closeMrjzyLoginAssistPopup(true));
  }
  mask.addEventListener('click', (e) => {
    if (e.target === mask) closeMrjzyLoginAssistPopup(true);
  });

  const qr = mask.querySelector('#mrjzy-login-assist-qr');
  if (qr instanceof HTMLImageElement) {
    qr.addEventListener('click', () => {
      void refreshMrjzyLoginAssistQrCode(true);
    });
  }

  return mask;
}

async function requestMrjzyLoginAssistQrCode() {
  const res = await fetch(MRJZY_QR_GEN_API, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const code = String(data?.data?.code || '').trim();
  if (!code) throw new Error(String(data?.msg || data?.message || '二维码生成失败'));
  return code;
}

async function checkMrjzyLoginAssistToken(code) {
  const qrCode = String(code || '').trim();
  if (!qrCode) return '';
  const res = await fetch(MRJZY_QR_CHECK_API, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code: qrCode })
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) return '';
  const token = data?.data?.token;
  if (token === null || token === undefined) return '';
  const tokenText = String(token).trim();
  return tokenText && tokenText.toLowerCase() !== 'null' ? tokenText : '';
}

async function persistMrjzyTeacherTokenCookie(token) {
  const v = String(token || '').trim();
  if (!v) return false;
  try {
    await chrome.cookies.set({
      url: 'https://zuoye.lulufind.com/',
      name: 'Teacher-Token',
      value: v,
      path: '/'
    });
    return true;
  } catch {
    return false;
  }
}

async function pollMrjzyLoginAssistToken() {
  if (mrjzyLoginAssistPolling) return;
  if (!isPlatformEnabled('mrjzy') && !window.platformInteractiveLoginPending?.mrjzy) return;
  if (!mrjzyLoginAssistCurrentCode) return;
  mrjzyLoginAssistPolling = true;
  try {
    const token = await checkMrjzyLoginAssistToken(mrjzyLoginAssistCurrentCode);
    if (token) {
      await persistMrjzyTeacherTokenCookie(token);
      closeMrjzyLoginAssistPopup(false);
      scheduleMrjzyLoginAssistRecheck(350);
    }
  } catch {
    // keep polling
  } finally {
    mrjzyLoginAssistPolling = false;
  }
}

function startMrjzyLoginAssistPolling() {
  stopMrjzyLoginAssistPolling();
  mrjzyLoginAssistPollTimer = setInterval(() => {
    void pollMrjzyLoginAssistToken();
  }, PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS);
  void pollMrjzyLoginAssistToken();
}

async function refreshMrjzyLoginAssistQrCode(fromUserClick = false) {
  const mask = ensureMrjzyLoginAssistPopup();
  const qrImg = mask.querySelector('#mrjzy-login-assist-qr');
  const statusEl = mask.querySelector('#mrjzy-login-assist-status');
  if (!(qrImg instanceof HTMLImageElement)) return;

  const serial = ++mrjzyLoginAssistCodeSerial;
  if (statusEl instanceof HTMLElement) {
    statusEl.textContent = '正在刷新二维码…';
  }
  try {
    const code = await requestMrjzyLoginAssistQrCode();
    if (serial !== mrjzyLoginAssistCodeSerial) return;
    mrjzyLoginAssistCurrentCode = code;
    const qrUrl = `${MRJZY_QR_SCAN_LINK_BASE}${code}`;
    qrImg.src = buildQrImageUrl(qrUrl, 220);
    if (statusEl instanceof HTMLElement) {
      statusEl.textContent = '';
    }
    startMrjzyLoginAssistPolling();
  } catch (e) {
    if (serial !== mrjzyLoginAssistCodeSerial) return;
    if (statusEl instanceof HTMLElement) {
      statusEl.textContent = `二维码获取失败：${String(e?.message || '未知错误')}`;
    }
  }
}

function openMrjzyLoginAssistPopup(force = false) {
  if (!force && !isPlatformEnabled('mrjzy')) return;
  window.platformInteractiveLoginPending.mrjzy = true;
  const mask = ensureMrjzyLoginAssistPopup();
  mask.style.display = 'flex';
  mrjzyLoginAssistCurrentCode = '';
  void refreshMrjzyLoginAssistQrCode(false);
}

function showPlatformNeedLoginToast(platform) {
  const p = String(platform || '').trim();
  if (!['ve', 'ykt', 'mrjzy', 'jlgj'].includes(p)) return;
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
  showToast(JLGJ_LOGIN_REQUIRED_HTML, 'warning', 3200, true);
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
      : (id.includes('mrjzy-status-btn') ? 'mrjzy' : (id.includes('jlgj-status-btn') ? 'jlgj' : 'ykt'));
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

  // Login warnings are shown on offline-transition only (one platform at a time).
}

function clearMrjzyStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.mrjzy-standalone-card');
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

  const selected = ['ve', 'ykt', 'mrjzy', 'jlgj'].filter((p) => isPlatformEnabled(p));
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
  const shouldOpenAssist = !!window.platformInteractiveLoginPending?.ykt;
  removeYktLoginSection();
  window.platformLoadedOnce.ykt = false;
  clearPlatformData('ykt');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('ykt', 'offline');

  if (shouldOpenAssist) {
    openYktLoginAssistPopup(true);
    return;
  }

  closeYktLoginAssistPopup(true);
  window.platformNeedLogin.ykt = false;
  refreshPlatformLoginTip();
}

function renderMrjzyNeedLoginMessage() {
  const shouldOpenAssist = !!window.platformInteractiveLoginPending?.mrjzy;
  window.platformLoadedOnce.mrjzy = false;
  clearPlatformData('mrjzy');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('mrjzy', 'offline');

  if (shouldOpenAssist) {
    openMrjzyLoginAssistPopup(true);
    return;
  }

  closeMrjzyLoginAssistPopup(true);
  window.platformNeedLogin.mrjzy = false;
  refreshPlatformLoginTip();
}

function renderJlgjNeedLoginMessage() {
  const shouldOpenAssist = !!window.platformInteractiveLoginPending?.jlgj;
  window.platformLoadedOnce.jlgj = false;
  clearPlatformData('jlgj');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('jlgj', 'offline');

  if (shouldOpenAssist) {
    openJlgjLoginAssistPopup(true);
    return;
  }

  closeJlgjLoginAssistPopup(true);
  window.platformNeedLogin.jlgj = false;
  refreshPlatformLoginTip();
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
  const tab = await chrome.tabs.create({ url: 'https://i.jielong.com/my-class#bjtu-bg', active: false });
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
    const tabs = await chrome.tabs.query({ url: ['https://i.jielong.com/*#bjtu-bg'] });
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
      ownedTabId = null;
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
          return {
            tabId: Number(tab.id || ownedTabId || 0) || null,
            ok: snap.userGroupPages.ok,
            status: snap.userGroupPages.status,
            unauthorized: snap.userGroupPages.status == 401,
            data: snap,
            __fullCapture: snap || {}
          };
        }

        if (state.hasData && !state.isComplete) {
          const snap = state.dataSnap || {};
          if (Array.isArray(snap.partialGroups) && snap.partialGroups.length) {
            return {
              tabId: Number(tab.id || ownedTabId || 0) || null,
              ok: Boolean(snap.userGroupPages && snap.userGroupPages.ok),
              status: Number(snap.userGroupPages ? snap.userGroupPages.status : 0),
              unauthorized: Number(snap.userGroupPages ? snap.userGroupPages.status : 0) === 401,
              data: snap,
              __fullCapture: snap || {},
              __partialCapture: true
            };
          }
        }
      } catch (e) {
         // ignore
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    if (ownedTabId) chrome.tabs.remove(ownedTabId).catch(()=>{}); return { tabId: ownedTabId, ok: false, status: 0, data: null, unauthorized: false, timeout: true };
  } catch {
    return { tabId: ownedTabId, ok: false, status: 0, data: null, unauthorized: true };
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
    const overdue = !done && isYktHomeworkOverdue(it);
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
    const bgColor = done ? '#e8f5e9' : (overdue ? '#ffebee' : '#fff3e0');
    const borderColor = done ? '#4caf50' : (overdue ? '#ef4444' : '#ff9800');
    const titleColor = done ? '#2e7d32' : (overdue ? '#b91c1c' : '#e65100');
    const detailBtnColor = done ? '#2E7D32' : (overdue ? '#b91c1c' : '#E65100');
    const actionText = done ? '去雨课堂查看' : '去雨课堂提交';
    const statusHtml = done ? '<span class="homework-status-done">(已提交)</span>' : (overdue ? '<span class="homework-status-overdue">(已逾期)</span>' : '');
    const titleScoreBadge = scoreText ? `<span style="font-weight:bold; color:#E91E63; white-space:nowrap;">[${escapeHtml(scoreText)}]</span>` : '';
    const deadline = it?.end || it?.deadline || '';
    const countdownSpan = (!done && !overdue && !Number(it?.__loading) && deadline) ? `<span class="deadline-countdown" data-deadline="${escapeHtml(String(deadline))}" style="margin-left:4px; font-weight:normal; color:#e65100"></span>` : '';
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
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;"></span>正在获取作业详情…</div>`;
      } else if (state === 'queued') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;"></span>正在排队等待…</div>`;
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
          <div style="font-size:12px; color:#666;">截止: <span style="font-weight:700; color:#000;">${escapeHtml(formatYktDateTime(it.end))}</span> ${statusHtml}${countdownSpan}</div>
          <div style="font-size:12px; color:#666;">${progressText ? `进度: ${escapeHtml(progressText)}` : ''}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${titleScoreBadge ? `<div style="font-size:12px; line-height:1;">${titleScoreBadge}</div>` : ''}
          <a class="btn" href="${it.link}" target="_blank" rel="noopener noreferrer" style="background:${detailBtnColor}; padding: 2px 6px; font-size: 12px; text-decoration:none; color:#fff;">${actionText}</a>
        </div>
      </div>
      ${detailExpandable ? `<div style="margin-top:3px; border-top:1px dashed ${borderColor}40; padding-top:0;">${detailExpandable}</div>` : ''}
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

function isJlgjHomeworkOverdue(hw) {
  return !isJlgjHomeworkDone(hw) && isDeadlinePassed(hw?.end);
}

function renderJlgjHomeworkItems(items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it) => {
    const done = isJlgjHomeworkDone(it);
    const overdue = !done && isJlgjHomeworkOverdue(it);
    const isLoadingMeta = !!it?.loadingMeta;
    const bgColor = done ? '#e8f5e9' : (overdue ? '#ffebee' : '#fff3e0');
    const borderColor = done ? '#4caf50' : (overdue ? '#ef4444' : '#ff9800');
    const titleColor = done ? '#2e7d32' : (overdue ? '#b91c1c' : '#e65100');
    const detail = isLoadingMeta ? '' : normalizeHomeworkContent(String(it?.content || '').trim());
    const contentHtml = isLoadingMeta
      ? '正在加载详情…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : (detail || '<span style="color:#999;">无作业详情</span>');
    const link = String(it?.link || JLGJ_WEB_BASE);
    const actionText = done ? '去接龙管家查看' : '去接龙管家提交';
    const detailBtnColor = done ? '#2E7D32' : (overdue ? '#b91c1c' : '#E65100');
    const statusHtml = done ? '<span class="homework-status-done">(已提交)</span>' : (overdue ? '<span class="homework-status-overdue">(已逾期)</span>' : '');
    const deadline = it?.end || it?.deadline || '';
    const endText = isLoadingMeta ? '正在加载……' : formatYktDateTime(it.end);
    const endSuffix = isLoadingMeta
      ? ' <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : '';
    const countdownSpan = (!done && !overdue && !isLoadingMeta && deadline) ? `<span class="deadline-countdown" data-deadline="${escapeHtml(String(deadline))}" style="margin-left:4px; font-weight:normal; color:#e65100"></span>` : '';
    return `
      <div class="hw-card-item" data-homework-done="${done ? '1' : '0'}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
          <div>
            <div style="font-weight:bold; color:${titleColor};">${escapeHtml(it.title || '接龙作业')}</div>
            <div style="font-size:12px; color:#666;">截止: <span style="font-weight:700; color:#000;">${escapeHtml(endText)}</span>${endSuffix} ${statusHtml}${countdownSpan}</div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
            <a class="btn" href="${link}" target="_blank" rel="noopener noreferrer" style="background:${detailBtnColor}; padding: 2px 6px; font-size: 12px; text-decoration:none; color:#fff;">${actionText}</a>
          </div>
        </div>
        <div style="margin-top:3px; border-top:1px dashed ${borderColor}40; padding-top:0; font-size:12px; color:#374151; line-height:1.45;">${contentHtml}</div>
      </div>
    `;
  }).join('');
}

function isMrjzyHomeworkDone(hw) {
  return Number(hw?.submit || 0) > 0 || Number(hw?.isSubmit || 0) > 0 || !!hw?.done;
}

function isMrjzyHomeworkPending(hw) {
  return !isMrjzyHomeworkDone(hw) && !isDeadlinePassed(hw?.end);
}

function isMrjzyHomeworkOverdue(hw) {
  return !isMrjzyHomeworkDone(hw) && isDeadlinePassed(hw?.end);
}

function renderMrjzyHomeworkItems(items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it) => {
    const done = isMrjzyHomeworkDone(it);
    const overdue = !done && isMrjzyHomeworkOverdue(it);
    const bgColor = done ? '#e8f5e9' : (overdue ? '#ffebee' : '#fff3e0');
    const borderColor = done ? '#4caf50' : (overdue ? '#ef4444' : '#ff9800');
    const titleColor = done ? '#2e7d32' : (overdue ? '#b91c1c' : '#e65100');
    const detailBtnColor = done ? '#2E7D32' : (overdue ? '#b91c1c' : '#E65100');
    const actionText = done ? '去每日交作业查看' : '去每日交作业提交';
    const statusHtml = done ? '<span class="homework-status-done">(已提交)</span>' : (overdue ? '<span class="homework-status-overdue">(已逾期)</span>' : '');
    const isLoadingMeta = !!it?.loadingMeta;
    const deadline = it?.end || it?.deadline || '';
    const endText = isLoadingMeta ? '正在加载……' : String(it.end || '无');
    const endSuffix = isLoadingMeta
      ? ' <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : '';
    const countdownSpan = (!done && !overdue && !isLoadingMeta && deadline) ? `<span class="deadline-countdown" data-deadline="${escapeHtml(String(deadline))}" style="margin-left:4px; font-weight:normal; color:#e65100"></span>` : '';
    return `
      <div class="hw-card-item" data-homework-done="${done ? '1' : '0'}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
          <div>
            <div style="font-weight:bold; color:${titleColor};">${escapeHtml(it.title || '每日交作业')}</div>
            <div style="font-size:12px; color:#666;">截止: <span style="font-weight:700; color:#000;">${escapeHtml(endText)}</span>${endSuffix} ${statusHtml}${countdownSpan}</div>
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
    card.dataset.courseId = String(courseId || '');
    card.dataset.courseRankable = '1';
    card.dataset.order = String(baseOrder + idx);
    card.dataset.rank = '7';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${courseLink}" target="_blank" rel="noopener noreferrer" style="color:#5096f5; text-decoration:none; line-height:1.3;">${escapeHtml(c.course_name || c.name || '雨课堂课程')}</a></strong></div>
          <div style="font-size:12px; color:#666; line-height:1.35;">${escapeHtml(subText)}</div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#9C27B0; display:none;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
        <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
    `;
    courseListDiv.appendChild(card);

    if (!window.courseHomeworkData[courseId]) {
      window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    }
    renderHomeworkList(courseId);

    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    window.yktMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
}

function renderMrjzyStandaloneCourses() {
  clearMrjzyStandaloneCards();
  const courses = window.mrjzyStandaloneCourses || [];
  if (!courses.length) {
    updateCourseListEmptyPlaceholder();
    return;
  }

  const baseOrder = Number(courseListDiv.dataset.orderBase || 100000) + 50000;
  courses.forEach((c, idx) => {
    const courseId = `mrjzy-${String(c.classNum || idx)}`;
    const loadingMeta = !!c.loadingMeta;
    const titleHtml = loadingMeta
      ? '正在加载…… <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:1px; border-color:#6366f1; border-top-color:transparent;"></span>'
      : `<a href="${MRJZY_WEB_BASE}/" target="_blank" rel="noopener noreferrer" style="color:#29a9fc; text-decoration:none;">${escapeHtml(c.divClass || '每日交作业课程')}</a>`;
    const teacherHtml = loadingMeta
      ? '正在加载…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : escapeHtml(c.teacherName || '');
    const card = document.createElement('div');
    card.className = 'file-item mrjzy-standalone-card';
    card.style.backgroundColor = '#fff';
    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(baseOrder + idx);
    card.dataset.rank = '7';
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
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
        <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
    `;
    courseListDiv.appendChild(card);

    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    window.yktMatchedHomeworkByCourseId[courseId] = [];
    window.mrjzyMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

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
    const titleHtml = escapeHtml(c.name || '接龙管家课程');
    const teacherHtml = loadingMeta
      ? '正在加载…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : escapeHtml(String(c.teacherName || ''));
    const card = document.createElement('div');
    card.className = 'file-item jlgj-standalone-card';
    card.style.backgroundColor = '#fff';
    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(baseOrder + idx);
    card.dataset.rank = '7';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${JLGJ_WEB_BASE}" target="_blank" rel="noopener noreferrer" style="color:#ffd243; text-decoration:none; line-height:1.3;">${titleHtml}</a></strong></div>
          <div style="font-size:12px; color:#666; line-height:1.35;">${teacherHtml}</div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#9C27B0; display:none;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
        <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;">
          ${loadingMeta && !(c.homeworks || []).length ? '<div class="spinner" style="border-color:#2196F3; border-top-color:transparent; display:inline-block;"></div> 正在获取作业…' : ''}
        </div>
    `;
    courseListDiv.appendChild(card);

    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    window.yktMatchedHomeworkByCourseId[courseId] = [];
    window.mrjzyMatchedHomeworkByCourseId[courseId] = [];
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
  flushPendingCourseCardSortIfIdle();
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
  scope.querySelectorAll('button[data-action="videos"].replay-list-loading .spinner, button[data-action="courseware"].courseware-list-loading .spinner').forEach((el) => {
    if (el instanceof HTMLElement) {
      el.style.animationDelay = delay;
    }
  });
}

function setCoursewareButtonLoading(btn, isLoading) {
  if (!btn) return;
  const currentCountRaw = Number(btn.dataset.coursewareLoadingCount || 0);
  const currentCount = Number.isFinite(currentCountRaw) ? Math.max(0, currentCountRaw) : 0;
  if (isLoading) {
    const nextCount = currentCount + 1;
    btn.dataset.coursewareLoadingCount = String(nextCount);
    if (btn.classList.contains('courseware-list-loading')) {
      btn.disabled = true;
      btn.style.pointerEvents = 'none';
      return;
    }
    btn.disabled = true;
    btn.style.pointerEvents = 'none';
    btn.classList.add('courseware-list-loading');
    btn.innerHTML = `课件下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#1e3a8a; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;
    return;
  }

  const nextCount = Math.max(0, currentCount - 1);
  btn.dataset.coursewareLoadingCount = String(nextCount);
  if (nextCount > 0) {
    btn.disabled = true;
    btn.style.pointerEvents = 'none';
    return;
  }

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

function buildCoursewareListHtml(courseId, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return '<div style="font-size:12px; color:#999;">暂无课件资源</div>';
  }

  const currentCourseId = String(courseId || '').trim();
  const selectAllToolbar = currentCourseId
    ? `<div class="courseware-toolbar"><button class="btn courseware-select-all-btn" data-action="courseware-select-all" data-course-id="${escapeHtml(currentCourseId)}" style="background:#000; color:#fff; padding:3px 8px; font-size:11px; line-height:1.2;">反选</button></div>`
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
      <div class="file-item" data-resource-id="${escapeHtml(id)}" data-rp-id="${escapeHtml(rpId)}" style="margin-bottom:10px; padding:5px; border-left:3px solid #1e3a8a; background:#e8efff; border-radius:4px;">
        <div class="resource-row-title" style="margin-bottom:4px;">
          <input type="checkbox" data-action="resource-check" data-resource-id="${escapeHtml(id)}" ${checked} style="margin:0 4px 0 0;">
          <span class="resource-name">${escapeHtml(fileName || name)}</span>
          ${sizeMb ? `<span class="resource-time-inline" style="${sizeStyle}">${escapeHtml(sizeMb)}</span>` : ''}
        </div>
        <div class="resource-link-row">
          ${hasUrl
            ? `<a class="resource-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl)}</a>`
            : needsRpFetch
              ? `<span id="${escapeHtml(rpLinkContainerId)}" class="courseware-rp-link" style="color:#999;font-size:12px;">获取链接中…</span>`
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

async function fetchCoursewareItems(courseNum, fzId, externalAbortController = null) {
  const courseIdPart = String(courseNum || '').trim();
  const xkhIdPart = String(fzId || '').trim();
  if (!courseIdPart || !xkhIdPart) return { loginRequired: false, items: [] };

  // 注册 AbortController 以便账号/学期切换时中止
  if (externalAbortController instanceof AbortController) {
    window.activeCoursewareAbortControllers[courseIdPart] = externalAbortController;
  }
  // 合并全局 VE 中止信号
  const globalSignal = window.globalVeAbortController?.signal;
  const localSignal = externalAbortController instanceof AbortController ? externalAbortController.signal : undefined;
  const signal = globalSignal || localSignal;

  const buildCoursewareUrl = (useQuestionMark = true) => {
    const sep = useQuestionMark ? '?' : '&';
    return `${BASE_VE}back/coursePlatform/courseResource.shtml${sep}method=stuQueryUploadResourceForCourseList&courseId=${encodeURIComponent(courseIdPart)}&cId=${encodeURIComponent(courseIdPart)}&xkhId=${encodeURIComponent(xkhIdPart)}&xqCode=${encodeURIComponent(getCurrentXqCode())}&docType=1`;
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
      },
      signal
    }));
  } catch (e) {
    if (signal?.aborted) return { loginRequired: false, items: [], aborted: true };
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
      },
      signal
    }));
  }

  const isLoginRedirect = isLikelyLoginPageHtml(text, res?.url);
  const alertMsg = parseAlertMsg(text);
  const hasLoginKeywords = alertMsg?.includes('登录') || alertMsg?.includes('不合法') || String(text).includes('不合法') || String(text).includes('无权');

  if (isLoginRedirect || hasLoginKeywords) {
    const currentUser = await detectUserIdFromPersonalCenter();
    if (currentUser && lastValidUsername && currentUser !== lastValidUsername) {
      return { loginRequired: true, accountSwitched: currentUser, items: [] };
    }
    return { loginRequired: true, items: [] };
  }

  let data = null;
  try { data = parseVeJson(text); } catch { data = null; }
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
    const rpId = String(item?.rpId || '').trim();
    return {
      id: `cw-${rpId || `${courseIdPart}-${xkhIdPart}-${index}`}`,
      name,
      extName,
      url: urlNorm,
      rpId,
      courseId: String(courseIdPart || '').trim(),
      sizeMb: formatResourceSizeMb(sizeMbRaw),
      sizeMbRaw
    };
  });

  return { loginRequired: false, items };
}

function getCourseListLoadVersionSnapshot() {
  return Number(window.courseListLoadVersion || 0);
}

function isCourseListLoadStale(snapshotVersion) {
  return Number(snapshotVersion || 0) !== Number(window.courseListLoadVersion || 0);
}

async function loadCoursewareList(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const shouldRender = () => String(card.dataset.resultView || '').trim() === 'courseware';
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion) || (window.activeCoursewareAbortControllers[courseNum]?.signal?.aborted);

  setCoursewareButtonLoading(btn, true);
  setCourseCoursewareLoading(courseIdInt, true);
  toggleResultAreaAnimated(resultArea, true);
  card.dataset.resultView = 'courseware';
  resultArea.innerHTML = '<div class="spinner" style="border-color:#1e3a8a; border-top-color:transparent; display:inline-block;"></div> <span style="color:#666;">正在获取课件…</span>';
  syncCourseActionButtonText(card, 'courseware');

  const cwAbortController = new AbortController();

  try {
    const payload = await fetchCoursewareItems(courseNum, fzId, cwAbortController);
    if (isStale() || payload.aborted) {
      setCourseCoursewareLoading(courseIdInt, false);
      delete window.activeCoursewareAbortControllers[courseNum];
      return;
    }
    delete window.activeCoursewareAbortControllers[courseNum];
    if (payload.loginRequired) {
      setCourseCoursewareLoading(courseIdInt, false);
      if (payload.accountSwitched) {
        showToast('检测到当前账号已变更为 ' + payload.accountSwitched + '，正在切换并重新加载', 'info', 3000);
        try {
          await syncAccountInfoAndReloadVeCourses({ userId: payload.accountSwitched, reloadCourses: true, reloadResourceSpace: true });
        } catch { /* ignore */ }
        return;
      }
      if (shouldRender()) {
        resultArea.innerHTML = '<span class="error" style="cursor:pointer; color:blue;">[登录已失效]</span>';
        const sp = resultArea.querySelector('span');
        if (sp) sp.addEventListener('click', () => handleLoginRequired(() => {
          loadCoursewareList(btn, courseIdInt, courseNum, fzId);
        }, null, '登录已失效，请稍后重试或重新登录'));
      }
      handleLoginRequired(() => {
        loadCoursewareList(btn, courseIdInt, courseNum, fzId);
      }, null, '登录已失效，请稍后重试或重新登录');
      return;
    }

    const html = buildCoursewareListHtml(courseIdInt, payload.items);
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
    startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
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
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  setCoursewareButtonLoading(btn, true);
  setCourseCoursewareLoading(courseIdInt, true);

  try {
    const payload = await fetchCoursewareItems(courseNum, fzId);
    if (isStale()) {
      setCourseCoursewareLoading(courseIdInt, false);
      return;
    }
    if (payload.loginRequired) {
      setCourseCoursewareLoading(courseIdInt, false);
      if (payload.accountSwitched) {
        showToast('检测到当前账号已变更为 ' + payload.accountSwitched + '，正在切换并重新加载', 'info', 3000);
        // 使用统一流程完成账号切换同步
        try {
          await syncAccountInfoAndReloadVeCourses({ userId: payload.accountSwitched, reloadCourses: true, reloadResourceSpace: true });
        } catch { /* ignore */ }
        return;
      }
      return;
    }

    const html = buildCoursewareListHtml(courseIdInt, payload.items);
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
  const replayCache = window.videoReplayCacheByCourseId?.[courseIdInt];
  const replayShadowArea = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);

  const moveVisibleReplayToShadowIfNeeded = () => {
    if (currentView !== 'replay') return;
    if (!replayCache?.linksFetching) return;
    if (!(replayShadowArea instanceof HTMLElement)) return;
    if (replayShadowArea.firstChild) return;
    if (!resultArea.firstChild) return;
    const frag = document.createDocumentFragment();
    while (resultArea.firstChild) {
      frag.appendChild(resultArea.firstChild);
    }
    replayShadowArea.appendChild(frag);
  };

  if (isOpen && currentView === 'courseware') {
    toggleResultAreaAnimated(resultArea, false);
    card.dataset.resultView = '';
    syncCourseActionButtonText(card, '');
    return;
  }

  if (cache?.loaded && cache?.html) {
    // If replay links are still resolving, preserve live replay DOM in shadow before replacing visible area.
    moveVisibleReplayToShadowIfNeeded();
    syncCoursewareItemsIndex(courseIdInt, cache.items || []);
    resultArea.innerHTML = cache.html;
    toggleResultAreaAnimated(resultArea, true);
    card.dataset.resultView = 'courseware';
    syncCourseActionButtonText(card, 'courseware');
    startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
    return;
  }

  // Ensure replay live DOM is not lost while loading when switching views.
  moveVisibleReplayToShadowIfNeeded();
  autoLoadCourseware(btn, courseIdInt, courseNum, fzId).then(() => {
    const latestCache = window.coursewareCacheByCourseId?.[courseIdInt];
    if (!latestCache?.loaded || !latestCache?.html) return;
    if (!Array.isArray(latestCache.items) || !latestCache.items.length) return;
    syncCoursewareItemsIndex(courseIdInt, latestCache.items || []);
    resultArea.innerHTML = latestCache.html;
    toggleResultAreaAnimated(resultArea, true);
    card.dataset.resultView = 'courseware';
    syncCourseActionButtonText(card, 'courseware');
    startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
  }).catch(() => {
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  });
}

async function fetchCoursewareRpUrl(rpId) {
  if (!rpId) return { url: '' };
  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: String(rpId) });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480`;

    const { text } = await fetchText(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString(),
      signal: window.globalVeAbortController?.signal
    });

    const data = parseVeJson(text);
    if (data.flag === true || String(data.STATUS) === '0') {
      return { url: String(data.rpUrl || data.html || '').trim() };
    }
    if (data.flag === false) {
      return { url: '', loginExpired: true };
    }
    return { url: '' };
  } catch {
    return { url: '' };
  }
}

async function startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  const cache = window.coursewareCacheByCourseId?.[courseIdInt];
  const items = Array.isArray(cache?.items) ? cache.items : [];
  const rpItems = items.filter((it) => !it.url && it.rpId);
  if (!rpItems.length || cache?.rpLinksFetched || cache?.rpLinksFetching) return;

  if (isStale()) {
    if (cache) cache.rpLinksFetching = false;
    return;
  }

  if (!cache) return;
  cache.rpLinksFetching = true;

  btn.classList.add('courseware-link-progress');
  btn.style.setProperty('--courseware-progress', '0%');

  const totalLinks = rpItems.length;
  let doneLinks = 0;
  const onOneLinkDone = () => {
    doneLinks += 1;
    const p = Math.max(0, Math.min(100, Math.round((doneLinks / totalLinks) * 100)));
    btn.style.setProperty('--courseware-progress', `${p}%`);
    if (doneLinks >= totalLinks) {
      btn.classList.remove('courseware-link-progress');
      btn.style.removeProperty('--courseware-progress');
    }
  };

  let loginHandled = false;

  await Promise.allSettled(rpItems.map(async (item) => {
    const result = await fetchCoursewareRpUrl(item.rpId).finally(onOneLinkDone);
    if (isStale()) return;
    const rpUrl = String(result?.url || '').trim();
    if (rpUrl) {
      item.url = rpUrl;
      const displayUrl = cleanRpUrl(rpUrl);
      const linkContainer = resultArea.querySelector(`[id="courseware-rp-link-${item.id.replace(/["\\]/g, '')}"]`);
      const linkRow = linkContainer?.closest('.resource-link-row');
      if (linkContainer) {
        linkContainer.outerHTML = `<a class="resource-url" href="${escapeHtml(rpUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl)}</a>`;
      }
      if (linkRow && !linkRow.querySelector(`button.resource-copy-btn`)) {
        const downloadBtn = linkRow.querySelector(`button.resource-download-btn`);
        const newCopyBtn = document.createElement('button');
        newCopyBtn.className = 'btn resource-copy-btn';
        newCopyBtn.dataset.action = 'resource-copy';
        newCopyBtn.dataset.resourceId = item.id;
        newCopyBtn.textContent = '复制';
        if (downloadBtn) {
          linkRow.insertBefore(newCopyBtn, downloadBtn);
        } else {
          linkRow.appendChild(newCopyBtn);
        }
      }
    } else if (result?.loginExpired) {
      const linkContainer = resultArea.querySelector(`[id="courseware-rp-link-${item.id.replace(/["\\]/g, '')}"]`);
      if (linkContainer) {
        linkContainer.innerHTML = '<span style="color:#f44336;">Err</span>';
      }
      if (!loginHandled) {
        loginHandled = true;
        if (linkContainer) {
          linkContainer.innerHTML = '<span class="error" style="cursor:pointer; color:blue;">[登录已失效]</span>';
          const sp = linkContainer.querySelector('span');
          if (sp) sp.addEventListener('click', () => handleLoginRequired(() => {
            startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
          }, null, '登录已失效，请稍后重试或重新登录'));
        }
        handleLoginRequired(() => {
          startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
        }, null, '登录已失效，请稍后重试或重新登录');
      }
    }
  }));

  cache.rpLinksFetched = true;
  cache.rpLinksFetching = false;
  const currentView = String(card.dataset.resultView || '').trim();
  if (currentView === 'courseware') {
    const newHtml = buildCoursewareListHtml(courseIdInt, items);
    cache.html = newHtml;
    resultArea.innerHTML = newHtml;
  }
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
  animateHomeworkGroupVisibility(group, expanded);
  return true;
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

async function autoLoadVideoLinks(btn, courseIdInt, courseNum, fzId, xqCode) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const currentView = String(card.dataset.resultView || '').trim();
  const shouldTouchVisibleArea = !currentView || currentView === 'replay';
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);

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
  btn.innerHTML = `回放下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#9c27b0; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;

  if (shouldTouchVisibleArea) {
    toggleResultAreaAnimated(resultArea, false, { immediate: true });
  }
  setCourseReplayLoading(courseIdInt, true);

  try {
    const calUrl = `${BASE_VE}back/course/courseInfo.shtml?method=queryRecordResourceForCourseList&calendarId=&courseId=${encodeURIComponent(courseNum || '')}&xkhId=${encodeURIComponent(fzId || '')}&xqCode=${encodeURIComponent(xqCode || getCurrentXqCode())}`;
    const { text: calText } = await fetchText(calUrl, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01'
      }
    });
    if (isStale()) {
      btn.classList.remove('replay-list-loading');
      btn.classList.remove('replay-link-progress');
      btn.style.removeProperty('--replay-progress');
      setCourseReplayLoading(courseIdInt, false);
      return;
    }
    const data = parseVeJson(calText);
    if (String(data.STATUS) !== '0') {
      btn.classList.remove('replay-list-loading');
      btn.style.display = 'none';
      if (shouldTouchVisibleArea) toggleResultAreaAnimated(resultArea, false, { immediate: true });
      setCourseReplayState(courseIdInt, false);
      return;
    }

    const list = (data.result || []).filter((it) => !!it.rpId);
    if (!list.length) {
      btn.classList.remove('replay-list-loading');
      btn.style.display = 'none';
      if (shouldTouchVisibleArea) toggleResultAreaAnimated(resultArea, false, { immediate: true });
      setCourseReplayState(courseIdInt, false);
      return;
    }

    const replayListHtml = `
      <div class="replay-loading-indicator" style="margin-bottom: 10px; padding: 5px; color: #888; font-size: 12px; display: flex; align-items: center; gap: 6px;">
        <span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#9C27B0; border-top-color:transparent;"></span> 加载详情中…
      </div>
    ` + list.map((item, index) => {
      const rpId = String(item.rpId || '');
      const title = `${item.roomName || ''} ${item.rpName || '未知时间'}`;
      const linkContainerId = `video-link-${courseIdInt}-${index}`;
      return `
        <div style="margin-bottom: 10px; padding: 5px; background: #e1bee733; border-radius: 4px; border-left: 3px solid #9C27B0;" data-rp-id="${rpId}">
          <div style="font-weight: bold; color: #4a148c; font-size: 15px;">${title}</div>
          <div style="margin-top: 5px;">
            <div class="replay-content-area" data-rp-id="${rpId}"></div>
            <div id="${linkContainerId}" class="video-links" style="font-size: 12px; color: #9C27B0; margin-top: 5px; font-weight: bold; word-break: break-all;">
              <span class="spinner" style="width: 10px; height: 10px; border-width: 1px; border-color: #9C27B0; border-top-color: transparent;"></span> 获取中…
            </div>
          </div>
        </div>
      `;
    }).join('');

    window.videoReplayCacheByCourseId[courseIdInt] = {
      html: replayListHtml,
      list,
      loaded: true,
      contentLoaded: false,
      contentMap: {},
      linksFetched: false,
      linksFetching: false
    };
    if (isStale()) {
      btn.classList.remove('replay-list-loading');
      btn.classList.remove('replay-link-progress');
      btn.style.removeProperty('--replay-progress');
      setCourseReplayLoading(courseIdInt, false);
      return;
    }
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
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  const cache = window.videoReplayCacheByCourseId?.[courseIdInt];
  const list = Array.isArray(cache?.list) ? cache.list : [];
  if (!cache || !list.length || cache.linksFetched || cache.linksFetching) {
    flushPendingCourseCardSortIfIdle();
    return;
  }

  if (isStale()) {
    cache.linksFetching = false;
    setCourseReplayLoading(courseIdInt, false);
    flushPendingCourseCardSortIfIdle();
    return;
  }

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
    return fetchVideoLinkInternal(linkContainerId, item.rpId, courseNum, fzId, item.teacherId || '')
      .finally(onOneLinkDone);
  }));

  if (isStale()) {
    cache.linksFetching = false;
    setCourseReplayLoading(courseIdInt, false);
    btn.classList.remove('replay-link-progress');
    btn.style.removeProperty('--replay-progress');
    flushPendingCourseCardSortIfIdle();
    return;
  }

  cache.linksFetching = false;
  cache.linksFetched = true;
  const currentView = String(card.dataset.resultView || '').trim();
  const visibleHtml = String(resultArea.innerHTML || '').trim();
  const shadowHtml = (shadowArea instanceof HTMLElement) ? String(shadowArea.innerHTML || '').trim() : '';
  const workingHtml = String(workingArea.innerHTML || '').trim();
  // Only prefer visible area when replay view is active; otherwise visible area may be courseware content.
  const visibleReplayHtml = currentView === 'replay' ? visibleHtml : '';
  const finalHtml = visibleReplayHtml || shadowHtml || workingHtml || String(cache.html || '');
  cache.html = finalHtml;

  if (currentView === 'replay' && finalHtml) {
    resultArea.innerHTML = cache.html;
    toggleResultAreaAnimated(resultArea, true, { immediate: true });
  }
  flushPendingCourseCardSortIfIdle();
}

async function lazyLoadReplayContent(courseIdInt) {
  const cache = window.videoReplayCacheByCourseId?.[courseIdInt];
  if (!cache) return;

  const card = document.getElementById(`course-${courseIdInt}`)?.closest('.file-item');
  const scope = card instanceof HTMLElement ? card : document;

  if (cache.contentLoaded && cache.contentMap) {
    // Re-apply cached content to DOM (for re-expand)
    Object.entries(cache.contentMap).forEach(([videoId, detailHtml]) => {
      const els = scope.querySelectorAll(`.replay-content-area[data-rp-id="${videoId}"]`);
      els.forEach((el) => {
        if (el instanceof HTMLElement) el.innerHTML = detailHtml;
      });
    });
    const indicator = scope.querySelector('.replay-loading-indicator');
    if (indicator instanceof HTMLElement) indicator.style.display = 'none';
    return;
  }

  try {
    const calUrl = `${BASE_VE}back/rp/common/teachCalendar.shtml?method=toDisplyTeachCourses&courseId=${encodeURIComponent(courseIdInt)}`;
    const { text: calText } = await fetchText(calUrl, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
    const data = JSON.parse(calText);
    if (String(data.STATUS) !== '0') return;

    cache.contentMap = {};
    const oldList = data.courseSchedList || [];
    oldList.forEach((oldItem) => {
      const videoId = String(oldItem.videoId || '').trim();
      if (!videoId) return;
      const contentText = String(oldItem.content || '').trim();
      const detailHtml = contentText
        ? renderExpandableHtml(
            escapeHtml(contentText),
            { hideWhenEmpty: true, expandText: '点击查看回放详情', collapseText: '点击收起回放详情', baseBg: 'rgba(243,229,245,0.42)' }
          )
        : '';
      cache.contentMap[videoId] = detailHtml;
      const els = scope.querySelectorAll(`.replay-content-area[data-rp-id="${videoId}"]`);
      els.forEach((el) => {
        if (el instanceof HTMLElement) {
          el.innerHTML = detailHtml;
          // 回放详情不超过3行则不折叠
          const box = el.querySelector('.expandable-box');
          if (box instanceof HTMLElement) {
            const body = box.querySelector('.expandable-body');
            if (body instanceof HTMLElement) {
              // 临时设为 collapsed 高度来测量
              const prevMaxH = body.style.maxHeight;
              body.style.maxHeight = '';
              if (body.scrollHeight <= body.clientHeight + 2) {
                box.classList.add('no-toggle');
                box.classList.remove('expanded');
                box.dataset.expanded = '0';
              }
              body.style.maxHeight = prevMaxH;
            }
          }
        }
      });
    });

    cache.contentLoaded = true;
    const indicator = scope.querySelector('.replay-loading-indicator');
    if (indicator instanceof HTMLElement) indicator.style.display = 'none';
  } catch {
    cache.contentLoaded = false;
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
  const moveShadowNodesToVisible = () => {
    if (!(shadowArea instanceof HTMLElement)) return false;
    if (!shadowArea.firstChild) return false;
    const frag = document.createDocumentFragment();
    while (shadowArea.firstChild) {
      frag.appendChild(shadowArea.firstChild);
    }
    resultArea.innerHTML = '';
    resultArea.appendChild(frag);
    return true;
  };

  if (isOpen && currentView === 'replay') {
    toggleResultAreaAnimated(resultArea, false);
    card.dataset.resultView = '';
    syncCourseActionButtonText(card, '');
    return;
  }

  if (!cache?.html) {
    if (btn.disabled) return;
    const courseNum = String(btn.dataset.courseNum || courseIdInt || '').trim();
    const fzId = String(btn.dataset.fzId || '').trim();
    const xqCode = String(btn.dataset.xqCode || getCurrentXqCode() || '').trim();
    autoLoadVideoLinks(btn, courseIdInt, courseNum, fzId, xqCode).then(() => {
      const latestCache = window.videoReplayCacheByCourseId?.[courseIdInt];
      if (latestCache?.html && String(card.dataset.resultView || '').trim() !== 'replay') {
        toggleReplayFromCache(btn, courseIdInt);
      }
    }).catch(() => {});
    return;
  }

  if (cache?.linksFetching) {
    const shadowHtml = (shadowArea instanceof HTMLElement) ? String(shadowArea.innerHTML || '') : '';
    if (shadowHtml.trim()) {
      // Move live DOM nodes to avoid race windows where late updates are written into shadow then lost.
      moveShadowNodesToVisible();
    } else if (cache?.html) {
      resultArea.innerHTML = cache.html;
    }
  } else if (!cache?.linksFetched && moveShadowNodesToVisible()) {
    // If list is ready but link fetching just started, prefer moving shadow nodes to avoid duplicate IDs.
  } else if (cache?.html) {
    resultArea.innerHTML = cache.html;
  }
  toggleResultAreaAnimated(resultArea, true);
  card.dataset.resultView = 'replay';
  syncCourseActionButtonText(card, 'replay');

  const courseNum = String(btn.dataset.courseNum || '').trim();
  const fzId = String(btn.dataset.fzId || '').trim();
  startReplayLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId).catch(() => {});
  lazyLoadReplayContent(courseIdInt).catch(() => {});
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
    if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
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

async function postMrjzyForm(url, paramsObj, runtimeCtx = null) {
  const MRJZY_SIGN_SALT = 'IF75D4U19LKLDAZSMPN5ATQLGBFEJL4VIL2STVDBNJJTO6LNOGB265CR40I4AL13';

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

  const normalizeMrjzyParams = (obj) => {
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

  const buildMrjzySign = (obj) => {
    const normalized = normalizeMrjzyParams(obj || {});
    const payload = JSON.stringify(normalized || {});
    return md5(`${toBase64Utf8(payload)}${MRJZY_SIGN_SALT}`);
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
          // Ensure only one concurrent creator opens a tab for this ctx.
          if (ctx.creatingTabPromise) {
            try { await ctx.creatingTabPromise; } catch { /* ignore */ }
            try {
              const existingTab = ctx.tabId ? await chrome.tabs.get(Number(ctx.tabId)) : null;
              if (existingTab?.id) tab = existingTab;
            } catch {
              tab = null;
            }
          }

          if (!tab) {
            // create and record on ctx so subsequent callers reuse the same tab
            ctx.creatingTabPromise = (async () => {
              const t = await chrome.tabs.create({ url: 'https://zuoye.lulufind.com/', active: false });
              ctx.tabId = Number(t?.id || 0) || null;
              ctx.createdTab = true;
              return ctx.tabId;
            })();
            try {
              const newTabId = await ctx.creatingTabPromise;
              if (newTabId) {
                try { tab = await chrome.tabs.get(Number(newTabId)); } catch { tab = null; }
              }
            } finally {
              ctx.creatingTabPromise = null;
            }
            created = !!tab?.id;
          }
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

  const sign = buildMrjzySign(paramsObj || {});
  const token = await getCookieValueLoose('lulu.lulufind.com', ['Teacher-Token', 'Token'])
    || await getCookieValueLoose('zuoye.lulufind.com', ['Teacher-Token', 'Token']);

  const normalizedParams = normalizeMrjzyParams(paramsObj || {});
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

async function loadMrjzyCoursesAndHomework(courses, loadVersion = 0) {
  const shouldAbort = () => !!(loadVersion && loadVersion !== (window.platformLoadVersion?.mrjzy || 0)) || !isPlatformEnabled('mrjzy');
  if (shouldAbort()) return;
  if (!isPlatformEnabled('mrjzy')) {
    clearPlatformData('mrjzy');
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('mrjzy', 'checking');
  const mrjzyRuntimeCtx = { tabId: null, createdTab: false, preferPageContext: true };
  const closeMrjzyRuntimeTab = async () => {
    if (mrjzyRuntimeCtx?.createdTab && mrjzyRuntimeCtx?.tabId) {
      try { await chrome.tabs.remove(Number(mrjzyRuntimeCtx.tabId)); } catch { /* ignore */ }
      mrjzyRuntimeCtx.tabId = null;
    }
  };

  const pickMrjzyCourseName = (w) => {
    const v = String(w?.divClass || w?.className || w?.courseName || w?.course_name || w?.workClass || '').trim();
    return v || '每日交作业课程';
  };
  const pickMrjzyTeacherName = (w) => String(w?.teacherName || w?.teacher_name || w?.teacherRealName || w?.userRealName || w?.teacher || '').trim();
  const pickMrjzyDeadline = (w) => String(w?.workRemark || w?.endTime || w?.end || w?.deadline || '').trim();
  const pickMrjzyTitle = (w) => String(w?.workDetail || w?.title || '').trim() || `作业 ${w?.workId || ''}`;

  const matchMap = collectCourseNameMatchMap(courses);
  const endTime = todayEndDateTimeString();
  const listResp = await postMrjzyForm(MRJZY_WORK_LIST_API, {
    start: 0,
    num: 12,
    beginTime: '1990-01-01 00:00:00',
    endTime,
    limit: 1
  }, mrjzyRuntimeCtx);
  if (shouldAbort()) return;

  if (listResp.res.status === 401 || listResp.res.status === 403) {
    window.platformLoadedOnce.mrjzy = true;
    await closeMrjzyRuntimeTab();
    renderMrjzyNeedLoginMessage();
    return;
  }
  if (!listResp.data || Number(listResp.data.code) !== 200) {
    window.platformLoadedOnce.mrjzy = true;
    await closeMrjzyRuntimeTab();
    renderMrjzyNeedLoginMessage();
    return;
  }

  window.mrjzyMatchedHomeworkByCourseId = {};
  window.mrjzyStandaloneCourses = [];
  window.mrjzyCourseGroupsSnapshot = [];

  setPlatformLoginState('mrjzy', 'online');
  window.platformLoadedOnce.mrjzy = true;
  const works = Array.isArray(listResp.data.data) ? listResp.data.data : [];
  if (!works.length) {
    await closeMrjzyRuntimeTab();
    renderMrjzyStandaloneCourses();
    return;
  }

  // First paint: render homework titles immediately with loading placeholders.
  const groupedLoading = new Map();
  works.forEach((w) => {
    const realDivClass = pickMrjzyCourseName(w);
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
      title: pickMrjzyTitle(w),
      end: '正在加载……',
      submit: Number(w.submit || 0),
      isSubmit: Number(w.isSubmit || 0),
      done: Number(w.submit || 0) > 0,
      loadingMeta: true,
      link: `${MRJZY_WEB_BASE}/#/studentsSubmitWork?id=${encodeURIComponent(String(w.workId || ''))}`
    });
  });

  groupedLoading.forEach((courseGroup) => {
    const token = normalizeCourseNameToken(courseGroup.realDivClass || '');
    const matched = token ? matchMap.get(token) : null;
    if (matched?.courseId) {
      if (!window.mrjzyMatchedHomeworkByCourseId[matched.courseId]) {
        window.mrjzyMatchedHomeworkByCourseId[matched.courseId] = [];
      }
      window.mrjzyMatchedHomeworkByCourseId[matched.courseId].push(...courseGroup.homeworks);
    } else {
      window.mrjzyStandaloneCourses.push({
        divClass: courseGroup.divClass,
        classNum: courseGroup.classNum,
        teacherName: courseGroup.teacherName,
        loadingMeta: true,
        homeworks: courseGroup.homeworks
      });
    }
  });

  Object.keys(window.mrjzyMatchedHomeworkByCourseId).forEach((courseId) => {
    renderHomeworkList(courseId);
  });
  renderMrjzyStandaloneCourses();

  const detailSettled = await Promise.allSettled(works.map(async (w) => {
    const dr = await postMrjzyForm(MRJZY_WORK_DETAIL_API, { workId: w.workId }, mrjzyRuntimeCtx);
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
    const key = pickMrjzyCourseName(w);
    if (!grouped.has(key)) {
      grouped.set(key, {
        divClass: key,
        classNum: w.classNum,
        teacherName: '',
        homeworks: []
      });
    }
    const g = grouped.get(key);
    const teacherName = String(teacherByWorkId.get(w.workId) || pickMrjzyTeacherName(w) || '').trim();
    if (!g.teacherName && teacherName) g.teacherName = teacherName;
    g.homeworks.push({
      workId: w.workId,
      title: pickMrjzyTitle(w),
      end: pickMrjzyDeadline(w),
      submit: Number(w.submit || 0),
      isSubmit: Number(w.isSubmit || 0),
      done: Number(w.submit || 0) > 0,
      loadingMeta: false,
      link: `${MRJZY_WEB_BASE}/#/studentsSubmitWork?id=${encodeURIComponent(String(w.workId || ''))}`
    });
  });

  // Replace first-stage placeholder data with hydrated data instead of appending.
  window.mrjzyMatchedHomeworkByCourseId = {};
  window.mrjzyStandaloneCourses = [];
  window.mrjzyCourseGroupsSnapshot = [];

  grouped.forEach((courseGroup) => {
    const token = normalizeCourseNameToken(courseGroup.divClass);
    window.mrjzyCourseGroupsSnapshot.push({
      token,
      divClass: courseGroup.divClass,
      classNum: courseGroup.classNum,
      teacherName: courseGroup.teacherName,
      homeworks: courseGroup.homeworks
    });
    const matched = matchMap.get(token);
    if (matched?.courseId) {
      if (!window.mrjzyMatchedHomeworkByCourseId[matched.courseId]) {
        window.mrjzyMatchedHomeworkByCourseId[matched.courseId] = [];
      }
      window.mrjzyMatchedHomeworkByCourseId[matched.courseId].push(...courseGroup.homeworks);
    } else {
      window.mrjzyStandaloneCourses.push(courseGroup);
    }
  });

  Object.keys(window.mrjzyMatchedHomeworkByCourseId).forEach((courseId) => {
    renderHomeworkList(courseId);
  });
  renderMrjzyStandaloneCourses();

  await closeMrjzyRuntimeTab();
}

async function loadJlgjCoursesAndHomework(courses = [], loadVersion = 0) {
  const activeVersion = loadVersion || bumpPlatformLoadVersion('jlgj');
  const isStale = () => !!(activeVersion && activeVersion !== (window.platformLoadVersion?.jlgj || 0));
  if (isStale()) return;
  if (!isPlatformEnabled('jlgj')) {
    clearPlatformData('jlgj');
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('jlgj', 'checking');

  let bgTab = null;
  // Cleanup orphaned background tabs from previous popup sessions
  try {
    const tabs = await chrome.tabs.query({ url: ['https://i.jielong.com/*'] });
    for (const t of tabs) {
      if (t.active === false && t.id && t.url && t.url.includes('#bjtu-bg')) {
        try { await chrome.tabs.remove(t.id); } catch { /* ignore */ }
      }
    }
  } catch {
    // ignore
  }

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
      if (!bgTab?.id) {
        const ready = await ensureBgTabAndAuth();
        if (!ready?.ok || !bgTab?.id) {
          return { ok: false, status: 0, data: null, unauthorized: true };
        }
      }
      return fetchJlgjJsonFromPageContext(u, bgTab.id);
    };

    let listResp = await waitAndFetchJlgjGroupListFromBrowser(30000);
    if (isStale()) return;

    if (listResp?.tabId && Number.isFinite(Number(listResp.tabId))) {
      bgTab = { id: Number(listResp.tabId) };
    }

    if (listResp?.unauthorized) {
      window.platformLoadedOnce.jlgj = true;
      renderJlgjNeedLoginMessage();
      return;
    }

    let captureData = listResp?.__fullCapture || null;
    let groups = pickArr(captureData?.userGroupPages?.data || null);
    if (!groups.length && Array.isArray(captureData?.partialGroups) && captureData.partialGroups.length) {
      groups = captureData.partialGroups;
    }

    const placeholderGroups = groups.map((group) => {
      const groupId = String(group?.Id || '').trim();
      const name = String(group?.Name || '接龙管家课程').trim();
      return {
        token: normalizeCourseNameToken(name),
        name,
        groupId,
        teacherName: '',
        loadingMeta: true,
        homeworks: [],
        __early: !!listResp && !!listResp.__partialCapture
      };
    }).filter((group) => group.groupId || group.name);

    const rebuildJlgjRender = () => {
      window.jlgjMatchedHomeworkByCourseId = {};
      window.jlgjStandaloneCourses = [];
      for (const cg of (window.jlgjCourseGroupsSnapshot || [])) {
        // If this group is an early partial-capture placeholder, show it immediately
        // instead of matching to VE courses. This ensures course names are visible
        // in the popup as soon as they are captured.
        if (cg && cg.__early) {
          window.jlgjStandaloneCourses.push({
            name: cg.name,
            groupId: cg.groupId,
            teacherName: cg.teacherName,
            loadingMeta: !!cg.loadingMeta,
            homeworks: Array.isArray(cg.homeworks) ? cg.homeworks : []
          });
          continue;
        }
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

    if (placeholderGroups.length) {
      window.jlgjMatchedHomeworkByCourseId = {};
      window.jlgjStandaloneCourses = [];
      window.jlgjCourseGroupsSnapshot = placeholderGroups;
      setPlatformLoginState('jlgj', 'online');
      window.platformLoadedOnce.jlgj = true;
      rebuildJlgjRender();
    }

    if (listResp?.__partialCapture && listResp?.tabId && groups.length) {
      const captureTabId = Number(listResp.tabId);
      const waitForCompleteCapture = async (tabId, timeoutMs = 20000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (isStale()) return null;
          try {
            const stateRes = await chrome.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              func: () => {
                const data = globalThis.__bjtuJlgjData;
                return {
                  hasData: !!data,
                  isComplete: data ? data.complete : false,
                  dataSnap: data || null
                };
              }
            });
            const state = stateRes?.[0]?.result || {};
            if (state.hasData && state.isComplete) return state.dataSnap || null;
          } catch {
            return null;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        return null;
      };

      const completeCapture = await waitForCompleteCapture(captureTabId, 20000);
      if (isStale()) return;
      if (completeCapture?.userGroupPages?.ok) {
        captureData = completeCapture;
        groups = pickArr(completeCapture.userGroupPages?.data || null);
      }
    }

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

    if (!placeholderGroups.length) {
      window.jlgjMatchedHomeworkByCourseId = {};
      window.jlgjStandaloneCourses = [];
      window.jlgjCourseGroupsSnapshot = [];
    }

    for (const group of groups) {
      if (isStale()) return;
      const groupId = String(group?.Id || '').trim();
      const name = String(group?.Name || '接龙管家课程').trim();
      if (!groupId) continue;

      let courseGroup = window.jlgjCourseGroupsSnapshot.find((item) => String(item?.groupId || '') === groupId);
      if (!courseGroup) {
        courseGroup = {
          token: normalizeCourseNameToken(name),
          name,
          groupId,
          teacherName: '',
          loadingMeta: true,
          homeworks: []
        };
        window.jlgjCourseGroupsSnapshot.push(courseGroup);
        rebuildJlgjRender();
      }

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
      if (!threads.length) {
        courseGroup.loadingMeta = false;
        rebuildJlgjRender();
        continue;
      }

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

      courseGroup.teacherName = Array.from(teacherSet).join(' / ');
      courseGroup.loadingMeta = true;
      courseGroup.homeworks = homeworks;
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
  try { console.debug && console.debug('loadCourses entry', Date.now()); } catch (e) {}
  try { console.debug && console.debug(new Error('loadCourses stack').stack); } catch (e) {}
  // 立即中止所有进行中的课件/回放请求
  abortAllCoursewareReplayFetches();
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
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    const url = `${BASE_VE}back/coursePlatform/course.shtml?method=getCourseList&pagesize=100&page=1&xqCode=${encodeURIComponent(await ensureCurrentXqCode())}`;
    const { text } = await fetchText(url, {
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });

    let data;
    try { data = JSON.parse(text); } catch {
      // probably redirected / html
      isLoginSessionValid = false;
      setPlatformLoginState('ve', 'offline');
      if (usernameInput.value.trim()) {
        handleLoginRequired(() => {
          loadCourses();
        }, null, '请输入账号登录');
      }
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    if (String(data.STATUS) !== '0') {
      const msg = data.ERRMSG || data.message || '课程接口返回异常';
      if (String(msg).includes('不合法') || String(msg).includes('登录')) {
        isLoginSessionValid = false;
        setPlatformLoginState('ve', 'offline');
        if (usernameInput.value.trim()) {
          handleLoginRequired(() => {
            loadCourses();
          }, null, '请输入账号登录');
        }
        renderCourseList([]);
        rematchExternalByVeCourses();
        rerenderAllHomeworkAreas();
        if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
        if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
        if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
        return;
      }
      setPlatformLoginState('ve', 'offline');
      showToast('课程加载失败: ' + msg, 'error');
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
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
    if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
    if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
  } catch (e) {
    setPlatformLoginState('ve', 'offline');
    const errMsg = String(e?.message || '');
    const likelyLoginInvalid = /Failed to fetch/i.test(errMsg);
    if (likelyLoginInvalid) {
      isLoginSessionValid = false;
      if (usernameInput.value.trim()) {
        handleLoginRequired(() => {
          loadCourses();
        }, null, '请输入账号登录');
      }
    } else {
      showToast('课程加载失败: ' + errMsg, 'error');
    }
    renderCourseList([]);
    rematchExternalByVeCourses();
    rerenderAllHomeworkAreas();
    if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
    if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
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

function scheduleMrjzyLoad(courses, loadVersion = 0) {
  if (!isPlatformEnabled('mrjzy')) return Promise.resolve();
  const list = Array.isArray(courses) ? courses : [];
  if (!window.__mrjzyLoadSerialPromise) window.__mrjzyLoadSerialPromise = Promise.resolve();
  window.__mrjzyLoadSerialPromise = window.__mrjzyLoadSerialPromise
    .catch(() => {})
    .then(() => loadMrjzyCoursesAndHomework(list, loadVersion));
  return window.__mrjzyLoadSerialPromise;
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

function bindCourseCardActionButtons(root = courseListDiv) {
  if (!(root instanceof HTMLElement)) return;
  const cards = root.classList.contains('file-item')
    ? [root]
    : Array.from(root.querySelectorAll('.file-item'));
  cards.forEach((card) => {
    if (!(card instanceof HTMLElement)) return;
    let courseId = String(card.dataset.courseId || '').trim();
    if (!courseId) {
      const id = String(card.id || '').trim();
      courseId = id.startsWith('course-') ? id.slice('course-'.length) : '';
    }
    if (!courseId) return;

    const meta = card.querySelector('.ve-course-num-wrap');
    const courseNumRaw = String(
      card.querySelector('button[data-action="courseware"]')?.dataset?.courseNum ||
      card.querySelector('button[data-action="videos"]')?.dataset?.courseNum ||
      meta?.dataset?.courseNum ||
      courseId
    ).trim();
    const fzId = String(
      card.querySelector('button[data-action="courseware"]')?.dataset?.fzId ||
      card.querySelector('button[data-action="videos"]')?.dataset?.fzId ||
      meta?.dataset?.fzId ||
      ''
    ).trim();

    const btnCourseware = card.querySelector('button[data-action="courseware"]');
    if (btnCourseware instanceof HTMLElement && btnCourseware.__courseActionBound !== true) {
      btnCourseware.dataset.courseNum = courseNumRaw;
      btnCourseware.dataset.fzId = fzId;
      btnCourseware.__courseActionBound = true;
      btnCourseware.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleCoursewareFromCache(btnCourseware, courseId, courseNumRaw, fzId);
      });
    }

    const btnVideos = card.querySelector('button[data-action="videos"]');
    if (btnVideos instanceof HTMLElement && btnVideos.__courseActionBound !== true) {
      btnVideos.dataset.courseNum = courseNumRaw;
      btnVideos.dataset.fzId = fzId;
      btnVideos.__courseActionBound = true;
      btnVideos.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleReplayFromCache(btnVideos, courseId);
      });
    }
  });
}

function autoLoadCourseResourcesForCard(card) {
  if (!isAutoLoadCourseResourcesEnabled()) return;
  if (!(card instanceof HTMLElement)) return;
  let courseId = String(card.dataset.courseId || '').trim();
  if (!courseId) {
    const id = String(card.id || '').trim();
    courseId = id.startsWith('course-') ? id.slice('course-'.length) : '';
  }
  if (!courseId || /^(ykt|mrjzy|jlgj)-/.test(courseId)) return;

  const meta = card.querySelector('.ve-course-num-wrap');
  const btnCourseware = card.querySelector('button[data-action="courseware"]');
  const btnVideos = card.querySelector('button[data-action="videos"]');
  const courseNumRaw = String(btnCourseware?.dataset?.courseNum || btnVideos?.dataset?.courseNum || meta?.dataset?.courseNum || courseId).trim();
  const fzId = String(btnCourseware?.dataset?.fzId || btnVideos?.dataset?.fzId || meta?.dataset?.fzId || '').trim();
  const xqCode = String(btnVideos?.dataset?.xqCode || getCurrentXqCode() || '').trim();

  if (btnCourseware instanceof HTMLElement && !window.coursewareCacheByCourseId?.[courseId]?.loaded) {
    autoLoadCourseware(btnCourseware, courseId, courseNumRaw, fzId).catch(() => {});
  }
  if (btnVideos instanceof HTMLElement && !window.videoReplayCacheByCourseId?.[courseId]?.loaded) {
    autoLoadVideoLinks(btnVideos, courseId, courseNumRaw, fzId, xqCode).catch(() => {});
  }
}

function autoLoadCourseResourcesForRenderedCourses() {
  if (!isAutoLoadCourseResourcesEnabled() || !courseListDiv) return;
  courseListDiv.querySelectorAll('.file-item[id^="course-"]').forEach((card) => {
    autoLoadCourseResourcesForCard(card);
  });
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
    const xqCode = course.xq_code || course.xqCode || getCurrentXqCode();
    const courseName = course.name || course.NAME || course.courseName || course.title || '未知课程';
    const teacherName = course.teacher_name || course.teacherName || '';
    const teacherLabel = String(teacherName || '').trim() || '教师';
    const coursePlatformUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10460&courseId=${encodeURIComponent(courseNumRaw || '')}&cId=${encodeURIComponent(courseId || '')}&xknId=${encodeURIComponent(fzId || '')}&xkhId=${encodeURIComponent(fzId || '')}&xqCode=${encodeURIComponent(xqCode || getCurrentXqCode())}`;

    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(courses.indexOf(course));
    card.dataset.rank = '7';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${coursePlatformUrl}" target="_blank" rel="noopener noreferrer" style="color:#1565c0; text-decoration:none;">${escapeHtml(courseName)}</a></strong></div>
          <div style="font-size:12px; color:#666; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="ve-teacher-wrap" data-course-id="${escapeHtml(String(courseId || ''))}">
              <span class="ve-teacher-name">${escapeHtml(teacherLabel)}</span>
              <span class="ve-teacher-pop" data-course-id="${escapeHtml(String(courseId || ''))}">
                <div style="font-size:12px; color:#64748b;">悬停加载教师信息…</div>
              </span>
            </span>
            <span>·</span>
            <span class="ve-course-num-wrap" data-course-id="${escapeHtml(String(courseId || ''))}" data-course-num="${escapeHtml(String(courseNumRaw || ''))}" data-fz-id="${escapeHtml(String(fzId || ''))}">
              <span class="ve-course-num-text">${escapeHtml(String(courseNum || ''))}</span>
              <span class="ve-course-teacher-pop" data-course-id="${escapeHtml(String(courseId || ''))}"><div style="font-size:12px; color:#64748b;">悬停加载同课教师…</div></span>
            </span>
          </div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#1e3a8a;" data-action="courseware">课件下载</button>
          <button class="btn" style="background:#9C27B0;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
        <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
    `;
    courseListDiv.appendChild(card);

    // bind actions
    const btnCourseware = card.querySelector('button[data-action="courseware"]');
    const btnVideos = card.querySelector('button[data-action="videos"]');
    if (btnCourseware) {
      btnCourseware.dataset.courseNum = String(courseNumRaw || '');
      btnCourseware.dataset.fzId = String(fzId || '');
      btnCourseware.__courseActionBound = true;
      btnCourseware.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleCoursewareFromCache(btnCourseware, courseId, courseNumRaw, fzId);
      });
      if (isAutoLoadCourseResourcesEnabled()) {
        setCoursewareButtonLoading(btnCourseware, true);
      }
    }
    if (btnVideos) {
      btnVideos.dataset.courseNum = String(courseNumRaw || '');
      btnVideos.dataset.fzId = String(fzId || '');
      btnVideos.dataset.xqCode = String(xqCode || '');
      btnVideos.__courseActionBound = true;
      btnVideos.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleReplayFromCache(btnVideos, courseId);
      });
      if (isAutoLoadCourseResourcesEnabled()) {
        // Show replay-loading animation immediately after card renders.
        btnVideos.disabled = true;
        btnVideos.style.opacity = '1';
        btnVideos.style.pointerEvents = 'none';
        btnVideos.classList.remove('replay-link-progress');
        btnVideos.classList.add('replay-list-loading');
        btnVideos.style.setProperty('--replay-progress', '0%');
        btnVideos.innerHTML = `回放下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#9c27b0; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;
      }
    }

    hydrateVeTeacherMeta(courseId, courseNumRaw, fzId).catch(() => {});

    // Prioritize homework fetching before replay link prefetch.
  updateCourseListEmptyPlaceholder();
    const hwPromise = checkHomework(courseId);
    if (btnCourseware) {
      hwPromise.finally(() => {
        // Balance the initial preloading spinner before entering actual auto-load phase.
        setCoursewareButtonLoading(btnCourseware, false);
        if (isAutoLoadCourseResourcesEnabled()) {
          autoLoadCourseware(btnCourseware, courseId, courseNumRaw, fzId).catch(() => {});
        }
      });
    }
    if (btnVideos) {
      hwPromise.finally(() => {
        if (isAutoLoadCourseResourcesEnabled()) {
          autoLoadVideoLinks(btnVideos, courseId, courseNumRaw, fzId, xqCode);
        }
      });
    }
  });

}

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
  if (!courseNum) return '';

  await hydrateVeTeacherMeta(cid, courseNum, '');
  teacherId = String(window.veTeacherMetaByCourseId?.[cid]?.teacherId || '').trim();
  return teacherId;
}

function renderHomeworkAttachments(hw, borderColor = '#ff9800', backgroundColor = '') {
  const key = String(hw?.__attachmentKey || '').trim();
  if (!key) return '';
  const cache = window.homeworkNoteAttachmentCacheByKey?.[key] || null;
  const list = Array.isArray(cache?.picList) ? cache.picList : [];
  if (!list.length) return '';

  const courseId = String(hw?.__courseId || '').trim();
  const normalizedBorderColor = String(borderColor || '').toLowerCase();
  const isTeacherMode = !!window.isTeacherAccount;
  const softBg = backgroundColor || (isTeacherMode
    ? (normalizedBorderColor.includes('a78bfa') ? 'rgba(237,233,254,0.72)' : 'rgba(219,234,254,0.72)')
    : (normalizedBorderColor.includes('4caf50')
      ? 'rgba(232,245,233,0.72)'
      : (normalizedBorderColor.includes('ef4444') || normalizedBorderColor.includes('b91c1c') || normalizedBorderColor.includes('f44336')
        ? 'rgba(254,242,242,0.78)'
        : 'rgba(255,243,224,0.72)')));

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
  }).filter(Boolean).join('');

  if (!rows) return '';
  return `<div style="margin-top:6px;">${rows}</div>`;
}

async function prefetchHomeworkAttachments(courseId, list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) {
    window.homeworkAttachmentPendingByCourse[courseId] = false;
    return;
  }

  window.homeworkAttachmentPendingByCourse[courseId] = true;
  try {
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
  } finally {
    window.homeworkAttachmentPendingByCourse[courseId] = false;
  }
}

async function checkHomework(courseId) {
  const area = document.getElementById(`homework-area-${courseId}`);
  if (!area) return;
  const hasMatchedExternal = ((window.yktMatchedHomeworkByCourseId?.[courseId] || []).length > 0)
    || ((window.mrjzyMatchedHomeworkByCourseId?.[courseId] || []).length > 0)
    || ((window.jlgjMatchedHomeworkByCourseId?.[courseId] || []).length > 0);
  if (!hasMatchedExternal && !String(area.innerHTML || '').trim()) {
    area.innerHTML = '<div class="spinner" style="border-color:#2196F3; border-top-color:transparent; display:inline-block;"></div> 正在获取作业…';
  }
  try {
    const subTypes = [0, 1, 2];
    const mergedList = [];
    const seenKeys = new Set();
    const getHwKey = (hw) => {
      const key = String(
        hw?.id ?? hw?.noteId ?? hw?.courseNoteId ??
        hw?.upId ?? hw?.UPID ?? hw?.snId ?? hw?.noteSnId ??
        hw?.workId ?? hw?.homeworkId ?? ''
      ).trim();
      return key;
    };
    for (const subType of subTypes) {
      const url = `${BASE_VE}back/coursePlatform/homeWork.shtml?method=getHomeWorkList&cId=${encodeURIComponent(courseId)}&subType=${subType}&page=1&pagesize=10`;
      try {
        const { text } = await fetchText(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
        const data = JSON.parse(text);
        if (String(data.STATUS) !== '0') continue;
        const list = data.courseNoteList || data.list || [];
        list.forEach((hw) => {
          const key = getHwKey(hw);
          if (key) {
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
          }
          mergedList.push(hw);
        });
      } catch {
        // continue with other subTypes
      }
    }
    const list = mergedList;
    window.courseHomeworkData[courseId] = { list, showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    renderHomeworkList(courseId);
    // Concurrently fetch scores and attachments, wait for scores to complete before returning
    const attachmentPrefetchPromise = prefetchHomeworkAttachments(courseId, list);
    await prefetchCourseScores(courseId);
    // After scores are fetched, courseware/replay can load; attachments continue in background
    attachmentPrefetchPromise.finally(() => {
      recomputeCourseHomeworkState(courseId);
    }).catch(() => {});
  } catch (e) {
    console.error(`[VE] fetch error for ${courseId}: ${e.message}`);
    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    renderHomeworkList(courseId);
  }
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
    const sub = hw.subStatus || (isDone ? '已提交' : '未提交');
    const time = hw.subTime || '';
    const deadline = hw.end_time || hw.endTime || '';
    const statusHtml = isTeacherMode ? '' : (isDone ? '<span class="homework-status-done">(已提交)</span>' : (overdue ? '<span class="homework-status-overdue">(已逾期)</span>' : ''));

    const scoreStatus = hw.lastScore ?? hw.last_score ?? hw.scoreStatus ?? hw.score_status ?? hw.lastScoreText ?? hw.last_score_text ?? '';
    const obtainedScore = hw.lastScore ?? hw.oldScore ?? hw.old_score ?? hw.finalScore ?? hw.final_score ?? '';
    const fullScore = hw.score ?? hw.fullScore ?? hw.maxScore ?? hw.totalScore ?? '';
    const upId = hw.id ?? hw.upId ?? hw.upid ?? hw.UPID ?? hw.up_id ?? '';
    const snId = hw.snId ?? hw.snid ?? hw.SNID ?? hw.noteSnId ?? hw.note_sn_id ?? '';
    const scoreParam = String(fullScore ?? '').trim() || String(obtainedScore ?? '').trim();
    const scoreViewUrl = (upId && snId) ? `${BASE_VE}back/course/courseWorkInfo.shtml?method=piGaiDiv&upId=${encodeURIComponent(String(upId))}&id=${encodeURIComponent(String(snId))}&uLevel=1&score=${encodeURIComponent(scoreParam || '100')}` : '';
    const scoreKey = buildHomeworkScoreKey(upId, snId);
    const cachedScore = window.homeworkScoreCacheByKey[scoreKey];

    let scoreHtml = '';
    const pendingText = `${String(scoreStatus || '').trim()} ${String(obtainedScore || '').trim()}`;
    const isPendingScore = isDone && /暂未公布/.test(pendingText) && upId && snId;
    if (cachedScore !== undefined && cachedScore !== null) {
      const totalStr = fullScore ? `/${fullScore}` : '';
      scoreHtml = `<span style="font-weight:bold; color:#E91E63; margin-left:5px;">[${escapeHtml(String(cachedScore))}${escapeHtml(totalStr)}]</span>`;
    } else if (isPendingScore) {
      scoreHtml = `<span class="async-score" data-pending="1" data-upid="${String(upId)}" data-snid="${String(snId)}" data-full="${String(fullScore || '')}" style="font-weight:bold; color:#E91E63; margin-left:5px;">[正在查询…]</span>`;
    } else if (isDone && !isTeacherMode) {
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
            <div style="font-weight:bold; color:${titleColor};">${title}</div>
            <div style="font-size:12px; color:#666;">截止: <span style="font-weight:700; color:#000;">${escapeHtml(deadline || '无')}</span> ${statusHtml}${countdownSpan}</div>
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
    ? `<div class="homework-empty-tip" style="color:#4CAF50; margin-top:2px;">${totalOverdueCount > 0 ? '✓ 无待交作业' : '✓ 所有作业已提交'}</div>`
    : '';
  const noRelatedTip = !isTeacherMode2 && !pendingHtml && totalHomeworkCount > 0 && !noPendingTip ? '<span class="homework-empty-tip" style="color:#999;">无未交作业</span>' : '';
  const noDataTip = !isExternalStandalone && totalHomeworkCount === 0 ? '<span style="color:#999;">没有作业数据</span>' : '';

  // 教师账号：VE 非过时作业始终可见（蓝色）
  const teacherNonOverdueSectionHtml = (window.isTeacherAccount && teacherNonOverdueHtml)
    ? `<div class="homework-group homework-group--pending" data-homework-group="teacher-active">${teacherNonOverdueHtml}</div>`
    : '';

  area.innerHTML = `${loadingHtml}${emptyExternalTip}${noDataTip}${mergedOverdueToggleRowHtml}${mergedOverdueHtml ? `<div class="homework-group homework-group--overdue ${data.showOverdue ? '' : 'is-hidden'}" data-homework-group="overdue" data-expanded="${data.showOverdue ? '1' : '0'}" aria-hidden="${data.showOverdue ? 'false' : 'true'}">${mergedOverdueHtml}</div>` : ''}${teacherNonOverdueSectionHtml}${pendingHtml ? `<div class="homework-group homework-group--pending" data-homework-group="pending">${pendingHtml}</div>` : ''}${noPendingTip || noRelatedTip}${doneToggleRowHtml}${doneHtml ? `<div class="homework-group homework-group--done ${data.showDone ? '' : 'is-hidden'}" data-homework-group="done" data-expanded="${data.showDone ? '1' : '0'}" aria-hidden="${data.showDone ? 'false' : 'true'}">${doneHtml}</div>` : ''}`;
  applyExpandableAutoToggle();
  applyDoneEnterAnimation();
  refreshUploadSelectVisibility();
  setTimeout(() => typeof updateAllCountdowns === 'function' && updateAllCountdowns(), 0);
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
  const results = await Promise.allSettled(
    tasks.map(async (t) => {
      const score = await fetchHomeworkScore(t.upId, t.snId);
      return { key: t.key, score };
    })
  );
  window.homeworkScorePendingByCourse[courseId] = false;

  let hasLoginRequired = false;
  results.forEach((result) => {
    if (result.status === 'rejected') {
      const err = result.reason;
      if (String(err && err.message) === 'LOGIN_REQUIRED') {
        hasLoginRequired = true;
      }
      return;
    }
    const { key, score } = result.value;
    if (score === null || score === undefined || score === '') {
      window.homeworkScoreCacheByKey[key] = '未批改';
    } else {
      window.homeworkScoreCacheByKey[key] = String(score);
    }
  });

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
  resultArea.innerHTML = '<div class="spinner" style="border-color:#9C27B0; border-top-color:transparent; display:inline-block;"></div> <span style="color:#666;">正在获取大纲…</span>';
  btn.textContent = '收起';

  const xqCode = String(btn.dataset.xqCode || getCurrentXqCode());

  try {
    const calUrl = `${BASE_VE}back/course/courseInfo.shtml?method=queryRecordResourceForCourseList&calendarId=&courseId=${encodeURIComponent(courseNum || '')}&xkhId=${encodeURIComponent(fzId || '')}&xqCode=${encodeURIComponent(xqCode || '')}`;
    const { text: calText } = await fetchText(calUrl, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01'
      },
      signal: window.globalVeAbortController?.signal
    });
    const data = parseVeJson(calText);

    if (String(data.STATUS) === '0') {
      const list = data.result || [];
      if (!list.length) {
        resultArea.innerHTML = '暂无课程安排';
        return;
      }

      resultArea.innerHTML = `
        <div class="replay-loading-indicator" style="margin-bottom: 10px; padding: 5px; color: #888; font-size: 12px; display: flex; align-items: center; gap: 6px;">
          <span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#9C27B0; border-top-color:transparent;"></span> 加载详情中…
        </div>
      ` + list.map((item, index) => {
        const rpId = String(item.rpId || '');
        const title = `${item.roomName || ''} ${item.rpName || '未知时间'}`;
        const linkContainerId = `video-link-${courseIdInt}-${index}`;
        return `
          <div style="margin-bottom: 10px; padding: 5px; background: #e1bee733; border-radius: 4px; border-left: 3px solid #9C27B0;" data-rp-id="${rpId}">
            <div style="font-weight: bold; color: #4a148c; font-size: 15px;">${title}</div>
            <div style="margin-top: 5px;">
              <div class="replay-content-area" data-rp-id="${rpId}"></div>
              <div id="${linkContainerId}" class="video-links" style="font-size: 12px; color: #9C27B0; margin-top: 5px; font-weight: bold; word-break: break-all;">
                ${rpId ? '<span class="spinner" style="width: 10px; height: 10px; border-width: 1px; border-color: #9C27B0; border-top-color: transparent;"></span> 获取中…' : '<span style="color: #999; font-weight: normal;">无回放</span>'}
              </div>
            </div>
          </div>
        `;
      }).join('');

      list.forEach((item, index) => {
        if (item.rpId) {
          const linkContainerId = `video-link-${courseIdInt}-${index}`;
          fetchVideoLinkInternal(linkContainerId, item.rpId, courseNum, fzId, item.teacherId || '');
        }
      });

      if (!window.videoReplayCacheByCourseId[courseIdInt]) {
        window.videoReplayCacheByCourseId[courseIdInt] = { contentLoaded: false, contentMap: {} };
      }
      lazyLoadReplayContent(courseIdInt).catch(() => {});
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
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  if (!getLinksDiv()) return false;

  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: String(videoId) });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480&courseId=${encodeURIComponent(courseNum)}&dataSource=1&cId=122618&xkhId=${encodeURIComponent(fzId)}&xqCode=${encodeURIComponent(getCurrentXqCode())}&teacherId=${encodeURIComponent(teacherId)}`;

    const { text } = await fetchText(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString(),
      signal: window.globalVeAbortController?.signal
    });

    if (isStale()) return false;

    const detailData = parseVeJson(text);

    if (detailData.flag === false || (String(detailData.STATUS) === '1' && String(detailData.ERRMSG || '').includes('不合法'))) {
      const linksDiv = getLinksDiv();
      if (!linksDiv) return false;
      if (isStale()) return false;

      linksDiv.innerHTML = '<span class="error" style="cursor:pointer; color:blue;">[登录已失效]</span>';
      const sp = linksDiv.querySelector('span');
      if (sp) sp.addEventListener('click', () => handleLoginRequired(() => {
        fetchVideoLinkInternal(containerId, videoId, courseNum, fzId, teacherId);
      }, null, '登录已失效，请稍后重试或重新登录'));
      handleLoginRequired(() => {
        fetchVideoLinkInternal(containerId, videoId, courseNum, fzId, teacherId);
      }, null, '登录已失效，请稍后重试或重新登录');
      return false;
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
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  span.textContent = '获取中…';
  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: rpId });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480&courseId=${encodeURIComponent(courseId)}&dataSource=1&cId=122618&xkhId=${encodeURIComponent(xkhId)}&xqCode=${encodeURIComponent(getCurrentXqCode())}&teacherId=${encodeURIComponent(teacherId)}`;
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

    if (isStale()) return;

    const data = JSON.parse(text);
    if (data?.flag === false || (data?.STATUS === '1' && String(data?.ERRMSG || '').includes('不合法'))) {
      if (isStale()) return;
      span.innerHTML = '<span class="error" style="cursor:pointer; color:blue;">[登录已失效]</span>';
      span.onclick = () => handleLoginRequired(() => {
        window.__fetchVideoDetail(rpId, courseId, xkhId, teacherId, btnEl);
      }, null, VE_LOGIN_REQUIRED_HTML);
      handleLoginRequired(() => {
        window.__fetchVideoDetail(rpId, courseId, xkhId, teacherId, btnEl);
      }, null, '登录已失效，请稍后重试或重新登录');
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

// -------------------- Upload --------------------
function processQueue() {
  while (activeUploads < maxParallelUploads && uploadQueue.length > 0) {
    const task = uploadQueue.shift();
    activeUploads++;
    task();
  }
}

function runPendingLoginCallbacks() {
  const cbs = pendingLoginCallbacks;
  pendingLoginCallbacks = [];
  cbs.forEach(fn => {
    try { fn(); } catch {}
  });
  return cbs.length;
}

function handleLoginRequired(retryCallback, cancelCallback, message) {
  if (retryCallback) {
    pendingLoginCallbacks.push(retryCallback);
  }
  promptLoginIfPossible(message || '请输入账号登录');
  if (cancelCallback) {
    // store cancel? keep simple: ignore
  }
}

function normalizeUploadDuplicateName(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

function isSameUploadFileSize(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.max(0, Math.round(na)) === Math.max(0, Math.round(nb));
}

function isApproxSameUploadFileSize(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na < 0 || nb < 0) return false;
  const diff = Math.abs(na - nb);
  return diff <= Math.max(64 * 1024, Math.max(na, nb) * 0.01);
}

function buildUploadMetaFromKnownFile(file, known) {
  const nameParts = splitFileName(file?.name || known?.fileName || known?.name || '');
  return {
    fileNameNoExt: String(nameParts.fileNameNoExt || safeDecodeUploadNamePart(known?.fileNameNoExt) || '').trim(),
    fileExtName: String(nameParts.fileExtName || known?.fileExtName || '').trim(),
    fileSize: Number(known?.fileSize || file?.size || 0),
    visitName: String(known?.visitName || '').trim(),
    pid: '',
    ftype: 'insert',
    fileName: String(file?.name || known?.fileName || known?.name || '').trim(),
    url: String(known?.url || '').trim()
  };
}

function safeDecodeUploadNamePart(v) {
  const raw = String(v || '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function findAlreadyUploadedFile(file) {
  const fileName = normalizeUploadDuplicateName(file?.name || '');
  const fileSize = Number(file?.size || 0);
  if (!fileName) return null;

  const savedList = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const saved = savedList.find((it) => (
    normalizeUploadDuplicateName(it?.fileName) === fileName &&
    isSameUploadFileSize(it?.fileSize, fileSize) &&
    String(it?.visitName || '').trim() &&
    String(it?.url || '').trim()
  ));
  if (saved) {
    return {
      source: '本地记录',
      fileName: String(saved.fileName || file?.name || '').trim(),
      fileSize: Number(saved.fileSize || fileSize || 0),
      visitName: String(saved.visitName || '').trim(),
      url: String(saved.url || '').trim()
    };
  }

  const current = Object.values(window.uploadedFileMetaById || {}).find((meta) => {
    if (!meta?.visitName) return false;
    const metaName = normalizeUploadDuplicateName(
      meta.fileName || `${safeDecodeUploadNamePart(meta.fileNameNoExt)}${meta.fileExtName ? '.' + meta.fileExtName : ''}`
    );
    return metaName === fileName && isSameUploadFileSize(meta.fileSize, fileSize);
  });
  if (current) {
    return {
      source: '本页已上传',
      ...buildUploadMetaFromKnownFile(file, current)
    };
  }

  const resource = (Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : []).find((it) => (
    normalizeUploadDuplicateName(it?.name) === fileName &&
    isApproxSameUploadFileSize(getResourceItemSizeBytes(it), fileSize) &&
    String(it?.url || '').trim()
  ));
  if (resource) {
    return {
      source: '资源空间',
      fileName: String(resource.name || file?.name || '').trim(),
      fileSize,
      visitName: '',
      url: String(resource.url || '').trim()
    };
  }

  return null;
}

function promptDuplicateUploadConfirmation(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return Promise.resolve(new Set());
  const modal = document.getElementById('upload-duplicate-modal');
  const listEl = document.getElementById('upload-duplicate-list');
  const invertBtn = document.getElementById('upload-duplicate-invert');
  const cancelBtn = document.getElementById('upload-duplicate-cancel');
  const confirmBtn = document.getElementById('upload-duplicate-confirm');
  if (!(modal instanceof HTMLElement) || !(listEl instanceof HTMLElement) || !(confirmBtn instanceof HTMLButtonElement)) {
    return Promise.resolve(new Set());
  }

  listEl.innerHTML = list.map((entry, idx) => {
    const file = entry?.file;
    const known = entry?.known || {};
    const name = String(file?.name || known.fileName || '(未命名)').trim();
    const sizeBytes = Number(file?.size || known.fileSize || 0);
    return `
      <label class="upload-duplicate-row">
        <input type="checkbox" data-duplicate-index="${idx}">
        <span class="upload-duplicate-fileline">
          <span class="upload-duplicate-name">${escapeHtml(name)}</span>
          <span class="upload-duplicate-size">${renderFileSizeText(sizeBytes)}</span>
        </span>
      </label>
    `;
  }).join('');

  return new Promise((resolve) => {
    const cleanup = () => {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      if (invertBtn instanceof HTMLButtonElement) invertBtn.removeEventListener('click', onInvert);
      if (cancelBtn instanceof HTMLButtonElement) cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('mousedown', onMaskMouseDown);
    };
    const onInvert = () => {
      listEl.querySelectorAll('input[type="checkbox"][data-duplicate-index]').forEach((el) => {
        if (el instanceof HTMLInputElement) el.checked = !el.checked;
      });
    };
    const onConfirm = () => {
      const selected = new Set();
      listEl.querySelectorAll('input[type="checkbox"][data-duplicate-index]:checked').forEach((el) => {
        if (el instanceof HTMLInputElement) selected.add(Number(el.dataset.duplicateIndex));
      });
      cleanup();
      resolve(selected);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onMaskMouseDown = (e) => {
      if (e.target === modal) onCancel();
    };
    if (invertBtn instanceof HTMLButtonElement) invertBtn.addEventListener('click', onInvert);
    if (cancelBtn instanceof HTMLButtonElement) cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('mousedown', onMaskMouseDown);
    modal.style.display = 'flex';
  });
}

function renderAlreadyUploadedFile(file, fileId, known) {
  const url = String(known?.url || '').trim();
  if (!url) return false;
  const hasVisitName = !!String(known?.visitName || '').trim();
  if (!window.filesData) window.filesData = {};
  window.filesData[fileId] = { size: Number(file?.size || 0), uploaded: Number(file?.size || 0) };
  if (hasVisitName) {
    window.uploadedFileMetaById[fileId] = buildUploadMetaFromKnownFile(file, known);
  }

  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.uploadFileId = fileId;
  item.dataset.duplicateUpload = '1';
  const source = escapeHtml(String(known?.source || '已上传').trim());
  const safeName = escapeHtml(String(file?.name || known?.fileName || '(未命名)').trim());
  const safeUrl = escapeHtml(url);
  const sizeBytes = Number(file?.size || known?.fileSize || 0);
  const checkboxHtml = hasVisitName
    ? `<label class="upload-select-wrap"><input type="checkbox" class="submit-file-check" data-file-id="${escapeHtml(fileId)}"> 作为作业附件</label>`
    : '<span class="upload-select-wrap" style="display:none;"></span>';
  item.innerHTML = `
    <div class="upload-file-head-row" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
      <div>
        ${checkboxHtml}
        <strong>${safeName}</strong>
        <span class="inline-status" style="font-size:12px; margin-left:8px; color:#2e7d32;">${source}</span>
        <span class="size-progress" style="margin-left:5px;">(${renderFileSizeText(sizeBytes)})</span>
      </div>
      <div></div>
    </div>
    <div class="upload-link-row">
      <a class="url-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>
      <button type="button" class="btn duplicate-upload-copy" style="padding:2px 8px; font-size:12px; white-space:nowrap;">复制</button>
    </div>
  `;
  const copyBtn = item.querySelector('.duplicate-upload-copy');
  if (copyBtn instanceof HTMLButtonElement) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = '已复制';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      });
    });
  }
  fileList.prepend(item);
  refreshUploadSelectVisibility();
  updateTotalProgress();
  return true;
}

function enqueueUploadFile(file) {
  const fileId = Math.random().toString(36).slice(2);
  window.filesData[fileId] = { size: file.size, uploaded: 0 };
  uploadFile(file, fileId);
  return fileId;
}

function uploadFile(file, fileId) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.uploadFileId = fileId;
  item.innerHTML = `
    <div class="upload-file-head-row" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
      <div>
        <label class="upload-select-wrap">
          <input type="checkbox" class="submit-file-check" data-file-id="${fileId}">
          作为作业附件
        </label>
        <strong>${file.name}</strong>
        <span class="inline-status" style="font-size:12px; margin-left:8px; color:#6b7280;">排队中…</span>
        <span class="size-progress" style="margin-left:5px;">(${renderFileSizePair(0, file.size)})</span>
        <span class="speed-display" style="font-size:12px; color:#666; margin-left:10px;"></span>
        <span class="eta-display" style="font-size:12px; color:#6b7280; margin-left:10px;"></span>
      </div>
      <div>
        <button class="btn retry-btn" style="padding:2px 8px; font-size:12px; background-color:#2196F3; display:none; margin-right:5px;">重试</button>
        <button class="btn cancel-btn" style="padding:2px 8px; font-size:12px; background-color:#f44336;">取消</button>
      </div>
    </div>
    <div class="progress-bar-container"><div class="progress-bar" style="width:0%"></div></div>
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
  let autoRetryQueuedByLogin = false;

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

  const queueAutoRetryAfterLogin = () => {
    if (autoRetryQueuedByLogin) return;
    autoRetryQueuedByLogin = true;
    handleLoginRequired(() => {
      autoRetryQueuedByLogin = false;
      if (cancelRequested) return;
      retryBtn.style.display = 'none';
      cancelBtn.style.display = 'inline-block';
      setInlineStatus('登录恢复，自动重试中…', 'warning');
      if (etaDisplay) etaDisplay.textContent = '';
      isRunning = false;
      xhrRef = null;
      if (!window.filesData[fileId]) {
        window.filesData[fileId] = { size: file.size, uploaded: 0 };
        updateTotalProgress();
      }
      uploadQueue.push(performUpload);
      processQueue();
    }, null, '登录已失效，请输入账号登录');
  };

  retryBtn.onclick = () => {
    autoRetryQueuedByLogin = false;
    retryBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-block';
    setInlineStatus('准备重试…', 'warning');
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

  cancelBtn.onclick = () => {
    autoRetryQueuedByLogin = false;
    if (!isRunning) {
      cancelRequested = true;
      const idx = uploadQueue.indexOf(performUpload);
      if (idx >= 0) uploadQueue.splice(idx, 1);
      doCancelUiAndAccounting();
      return;
    }

    cancelRequested = true;
    if (xhrRef) {
      try { xhrRef.abort(); } catch {}
    }
  };

  const performUpload = async () => {
    cancelRequested = false;
    isRunning = true;
    const manualJsessionMode = !usernameInput.value.trim();
    const jsid = (jsessionidInput.value.trim() || await getLocal('jsessionid', '')).trim();
    if (manualJsessionMode && !jsid) {
      setInlineStatus('等待登录…', 'warning');
      if (etaDisplay) etaDisplay.textContent = '';
      queueAutoRetryAfterLogin();
      showRetry();
      isRunning = false;
      xhrRef = null;
      activeUploads--; processQueue();
      return;
    }

    setInlineStatus('上传中…', 'normal');
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
        const fileSize = Math.max(0, Number(file.size || 0));
        const visibleLoaded = fileSize > 0
          ? Math.min(fileSize, Math.max(0, Number(e.loaded || 0)))
          : Math.max(0, Number(e.loaded || 0));
        const percent = fileSize > 0
          ? Math.min(100, Math.round((visibleLoaded / fileSize) * 100))
          : Math.min(100, Math.round((e.loaded / e.total) * 100));
        progressBar.style.width = percent + '%';
        progressBar.textContent = '';
        sizeProgressDisplay.innerHTML = `(${renderFileSizePair(visibleLoaded, fileSize)})`;

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
          const remainingBytes = fileSize > 0 ? Math.max(0, fileSize - visibleLoaded) : Math.max(0, e.total - e.loaded);
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
          window.filesData[fileId].uploaded = visibleLoaded;
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
            progressBar.style.width = '100%';
            progressBar.textContent = '';
            sizeProgressDisplay.innerHTML = `(${renderFileSizePair(file.size, file.size)})`;
            setInlineStatus('上传完成', 'success');

            addSavedUpload(file, data, convertedUrl);

            const nameParts = splitFileName(file.name);
            window.uploadedFileMetaById[fileId] = {
              fileNameNoExt: String(data.fileNameNoExt || encodeURIComponent(nameParts.fileNameNoExt || '') || '').trim(),
              fileExtName: String(data.fileExtName || nameParts.fileExtName || '').trim(),
              fileSize: Number(data.fileSize || file.size || 0),
              visitName: String(data.visitName || '').trim(),
              pid: '',
              ftype: 'insert',
              fileName: String(file.name || '').trim(),
              url: convertedUrl
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
              a.className = 'url-link';
              a.href = convertedUrl;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              a.textContent = convertedUrl;
              a.style.color = '#4CAF50';
              a.style.fontWeight = '700';
              a.style.textDecoration = 'none';
              const btn = document.createElement('button');
              btn.className = 'btn';
              btn.style.padding = '2px 8px';
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
              queueAutoRetryAfterLogin();
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
const parallelLimitInput = document.getElementById('parallel-limit');

function adjustParallelLimitWidth() {
  if (!(parallelLimitInput instanceof HTMLInputElement)) return;
  const text = String(parallelLimitInput.value || parallelLimitInput.placeholder || '');
  const digits = Math.max(1, text.length);
  parallelLimitInput.style.width = `${digits + 3}ch`;
}

if (parallelLimitInput instanceof HTMLInputElement) {
  adjustParallelLimitWidth();
  parallelLimitInput.addEventListener('input', () => {
    adjustParallelLimitWidth();
  });
  parallelLimitInput.addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    if (v > 0) {
      maxParallelUploads = v;
      setLocal(PARALLEL_LIMIT_KEY, String(v)).catch(() => {});
      processQueue();
      processResourceDownloadQueue();
    } else {
      parallelLimitInput.value = String(Math.max(1, Number(maxParallelUploads) || 1));
    }
    adjustParallelLimitWidth();
  });
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover', 'dragover-invalid', 'dragover-text');
  const dt = e.dataTransfer;
  if (!dt) return;
  const types = Array.from(dt.types || []);
  if (types.includes('Files')) {
    dropZone.classList.add('dragover');
  } else if (types.includes('text/plain') || types.includes('text/html')) {
    dropZone.classList.add('dragover-text');
  } else {
    dropZone.classList.add('dragover-invalid');
  }
});
dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover', 'dragover-invalid', 'dragover-text');
});
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover', 'dragover-invalid', 'dragover-text');

  const dt = e.dataTransfer;
  const types = Array.from(dt?.types || []);
  if (types.includes('Files')) {
    const files = await clipboardDataToFiles(dt);
    if (files.length) {
      processFilesForUpload(files);
    } else {
      showToast('未找到可上传的文件', 'warning', 1800);
    }
    return;
  }

  const textFiles = await convertTextDropToFiles(dt);
  processFilesForUpload(textFiles);
});

fileInput.addEventListener('change', handleFiles);

if (dropZone instanceof HTMLElement) {
  dropZone.tabIndex = 0;
}

function cloneFileWithPath(file, relativePath = '') {
  const name = String(relativePath || file?.webkitRelativePath || file?.name || 'pasted-file').replace(/^[/\\]+/, '');
  if (!name || name === file.name) return file;
  return new File([file], name, { type: file.type || '', lastModified: file.lastModified || Date.now() });
}

function readFileEntry(entry, basePath = '') {
  return new Promise((resolve) => {
    try {
      entry.file((file) => {
        const rel = `${basePath || ''}${file.name || entry.name || 'file'}`;
        resolve([cloneFileWithPath(file, rel)]);
      }, () => resolve([]));
    } catch {
      resolve([]);
    }
  });
}

async function readDirectoryEntry(entry, basePath = '') {
  const dirPath = `${basePath || ''}${entry.name || 'folder'}/`;
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await new Promise((resolve) => {
      try { reader.readEntries(resolve, () => resolve([])); } catch { resolve([]); }
    });
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => readEntryFiles(child, dirPath)));
  return nested.flat();
}

async function readEntryFiles(entry, basePath = '') {
  if (!entry) return [];
  if (entry.isFile) return readFileEntry(entry, basePath);
  if (entry.isDirectory) return readDirectoryEntry(entry, basePath);
  return [];
}

async function clipboardDataToFiles(dt) {
  if (!dt) return [];
  const items = Array.from(dt.items || []);
  const files = [];
  for (const item of items) {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) {
      files.push(...await readEntryFiles(entry));
      continue;
    }
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!files.length && dt.files?.length) files.push(...Array.from(dt.files));
  return files;
}

async function handleClipboardUploadPaste(e) {
  const active = document.activeElement;
  if (active && (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active.isContentEditable
  )) return;
  const files = await clipboardDataToFiles(e.clipboardData);
  if (!files.length) return;
  e.preventDefault();
  processFilesForUpload(files);
}

document.addEventListener('paste', (e) => {
  handleClipboardUploadPaste(e).catch((err) => {
    showToast(`粘贴失败：${String(err?.message || err)}`, 'error', 3000);
  });
});

const pasteFileBtn = document.getElementById('paste-file-btn');
if (pasteFileBtn) {
  pasteFileBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (!isLoginSessionValid) {
        showToast('登录状态已失效，请重新登录', 'warning');
        return;
      }
      const items = await navigator.clipboard.read();
      if (!items || !items.length) {
        showToast('剪贴板中没有可粘贴的内容', 'info', 2000);
        return;
      }
      const files = [];
      let textCount = 0;
      for (const item of items) {
        let handled = false;
        const allTypes = item.types || [];
        for (const type of allTypes) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const ext = type.split('/')[1] || 'png';
            files.push(new File([blob], `pasted-image.${ext}`, { type }));
            handled = true;
            break;
          }
        }
        if (handled) continue;
        // Try text types
        const textBlob = await item.getType('text/plain').catch(() => null);
        const htmlBlob = await item.getType('text/html').catch(() => null);
        if (textBlob || htmlBlob) {
          let addedText = false;
          let content = '';
          if (htmlBlob) {
            content = await htmlBlob.text();
            if (content.trim()) {
              files.push(new File([new Blob([content], { type: 'text/html' })], 'pasted-content.html', { type: 'text/html' }));
              addedText = true;
            }
          } else if (textBlob) {
            content = await textBlob.text();
            if (content.trim()) {
              files.push(new File([new Blob([content], { type: 'text/plain' })], 'pasted-content.txt', { type: 'text/plain' }));
              addedText = true;
            }
          }
          if (addedText) textCount++;
          handled = true;
        }
        if (handled) continue;
        // Fallback: try any non-text type as a file
        for (const type of allTypes) {
          if (type.startsWith('text/')) continue;
          try {
            const blob = await item.getType(type);
            const ext = type.includes('/') ? type.split('/')[1].split(';')[0] : 'bin';
            files.push(new File([blob], `pasted-file.${ext || 'bin'}`, { type }));
            break;
          } catch {}
        }
      }
      if (!files.length) {
        showToast('若从资源管理器复制文件或文件夹，请在页面按 Ctrl+V 粘贴', 'info', 3000);
        return;
      }
      const nonTextCount = files.length - textCount;
      if (textCount > 0 && nonTextCount === 0) {
        showToast(`已将剪贴板文本转为 ${files.length} 个文件并开始上传`, 'info', 3000);
      } else if (textCount > 0) {
        showToast(`已粘贴 ${nonTextCount} 个文件，${textCount} 个文本已转为文件`, 'info', 3000);
      }
      processFilesForUpload(files);
    } catch (err) {
      if (String(err?.message || err).includes('clipboard-read')) {
        showToast('没有剪贴板读取权限，请授予后重试', 'error', 3000);
      } else {
        showToast(`粘贴失败：${String(err?.message || err)}`, 'error', 3000);
      }
    }
  });
}

fileList.addEventListener('click', (e) => {
  const rawTarget = e.target;
  const t = rawTarget instanceof Element
    ? rawTarget
    : (rawTarget && rawTarget.nodeType === Node.TEXT_NODE ? rawTarget.parentElement : null);
  if (!(t instanceof Element)) return;
  const row = t.closest('.upload-file-head-row');
  if (!(row instanceof HTMLElement)) return;
  if (t.closest('button,a,input,textarea,select,label')) return;
  const cb = row.querySelector('input.submit-file-check');
  if (!(cb instanceof HTMLInputElement)) return;
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});

async function processFilesForUpload(files) {
  if (!files || !files.length) return;
  const filesList = Array.from(files).filter(Boolean);
  if (!filesList.length) return;

  const pendingFiles = [];
  const duplicateEntries = [];
  filesList.forEach((f) => {
    const known = findAlreadyUploadedFile(f);
    if (known) {
      duplicateEntries.push({ file: f, known });
      return;
    }
    pendingFiles.push(f);
  });

  let skippedDuplicateCount = 0;
  if (duplicateEntries.length > 0) {
    const selectedDuplicateIndexes = await promptDuplicateUploadConfirmation(duplicateEntries);
    if (selectedDuplicateIndexes instanceof Set) {
      duplicateEntries.forEach((entry, idx) => {
        if (selectedDuplicateIndexes.has(idx)) {
          pendingFiles.push(entry.file);
          return;
        }
        const fileId = Math.random().toString(36).slice(2);
        if (renderAlreadyUploadedFile(entry.file, fileId, entry.known)) skippedDuplicateCount++;
      });
    }
  }

  if (skippedDuplicateCount > 0) {
    showToast(`已复用 ${skippedDuplicateCount} 个已上传文件`, 'info', 1800);
  }
  if (!pendingFiles.length) {
    updateTotalProgress();
    return;
  }

  if (!isLoginSessionValid) {
    handleLoginRequired(() => {
      pendingFiles.forEach(enqueueUploadFile);
      updateTotalProgress();
    });
    return;
  }

  pendingFiles.forEach(enqueueUploadFile);
  updateTotalProgress();
}

function handleFiles(e) {
  const files = e.target.files || e.dataTransfer.files;
  processFilesForUpload(files);
}

async function convertTextDropToFiles(dt) {
  if (!dt) return [];
  const types = Array.from(dt.types || []);
  const files = [];

  if (types.includes('text/html')) {
    const html = dt.getData('text/html');
    if (html) {
      files.push(new File([new Blob([html], { type: 'text/html' })], 'pasted-content.html', { type: 'text/html' }));
      return files;
    }
  }

  if (types.includes('text/plain')) {
    const text = dt.getData('text/plain');
    if (text) {
      files.push(new File([new Blob([text], { type: 'text/plain' })], 'pasted-content.txt', { type: 'text/plain' }));
      return files;
    }
  }

  return files;
}

copyAllBtn.addEventListener('click', () => {
  let textToCopy = '';
  const appendChecked = (container) => {
    container.querySelectorAll('input.submit-file-check:checked').forEach(cb => {
      const item = cb.closest('.file-item');
      if (!item) return;
      const linkEl = item.querySelector('.url-link');
      if (!linkEl) return;
      const name = item.querySelector('strong')?.textContent || '';
      textToCopy += `${name}\n${linkEl.href}\n\n`;
    });
  };
  appendChecked(document.querySelector('#file-list'));
  const savedList = document.querySelector('.saved-uploads-list');
  if (savedList) appendChecked(savedList);
  textToCopy = textToCopy.trim();
  if (!textToCopy) {
    showToast('请先选择文件', 'warning', 1200);
    return;
  }
  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast('已复制选中链接', 'success', 1200);
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
    window.toggleOverdueView(courseId);
    return;
  }
  if (action === 'toggle-done') {
    const courseId = String(actionEl.dataset.courseId || '').trim();
    if (!courseId) return;
    window.toggleDoneView(courseId);
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
            handleLoginRequired(() => {
              const btn = document.querySelector(`button[data-action="resource-download"][data-resource-id="${CSS.escape(item.id)}"]`);
              if (btn) btn.click();
            }, null, '登录已失效，请稍后重试或重新登录');
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
  // Skip programmatic value sets during startup or login flow to avoid duplicate loads
  if (initialUsernameSet) { initialUsernameSet = false; return; }
  if (loginFlowUsernameSet) return;
  const u = usernameInput.value.trim();
  usernameChangeVersion += 1;
  const changeVersion = usernameChangeVersion;
  try { usernameChangeAbortController?.abort(); } catch { /* ignore */ }
  usernameChangeAbortController = new AbortController();
  const changeSignal = usernameChangeAbortController.signal;
  const isCurrentUsernameChange = () => changeVersion === usernameChangeVersion && usernameInput.value.trim() === u;
  const isManualSwitch = !!u && !!lastValidUsername && u !== String(lastValidUsername || '').trim();
  const isHighPrioritySwitch = !!u && String(highPrioritySwitchTarget || '').trim() === u;
  if (!isHighPrioritySwitch && highPrioritySwitchTarget && String(highPrioritySwitchTarget).trim() !== u) {
    highPrioritySwitchTarget = '';
  }
  if (isHighPrioritySwitch || isManualSwitch) {
    highPrioritySwitchTarget = '';
    if (!accountSwitchInterruptionArmed) {
      prioritizeAccountSwitch();
    }
    // show logging toast before sending GET to /ve/s.shtml
    showToast('正在检查账号…', 'info', 0);
    const validResult = await validateUsernameBeforeLoginStart(u, { signal: changeSignal });
    if (!isCurrentUsernameChange()) return;
    if (!validResult.ok && validResult.status === 'cancelled') return;
    if (!validResult.ok && validResult.status === 'invalid') {
      showToast('该账号不存在，已恢复原账号', 'error');
      await restoreLoginFallbackUsername(u);
      pendingUsernameChange = null;
      resetAccountSwitchInterruption();
      return;
    }
    if (!validResult.ok) {
      showToast('无法验证账号有效性，请稍后重试', 'warning');
      await restoreLoginFallbackUsername(u);
      pendingUsernameChange = null;
      resetAccountSwitchInterruption();
      return;
    }
    if (validResult.status === 'needs-post-login') {
      pendingUsernameChange = lastValidUsername ? { from: lastValidUsername, to: u } : null;
      await routeLoginBySessionValidityForSwitch(u, '需要验证码登录');
      return;
    }
    pendingUsernameChange = lastValidUsername ? { from: lastValidUsername, to: u } : null;
    isLoginSessionValid = true;
    setWelcomeMessage(validResult.ok ? validResult.info : null);
    renderLoginAccountHistorySelect(u);
    // Directly complete post-login synchronization (no extra s.shtml)
    try {
      lastValidUsername = u;
      await setLocal('username', u);
      await syncJsessionidToUi().catch(() => {});
      runPendingLoginCallbacks();
      // reload courses and resource space asynchronously but start now
      (async () => {
        try { await syncAccountInfoAndReloadVeCourses({ userId: u, detectFromPortal: false, reloadCourses: true, reloadResourceSpace: true }); } catch {}
      })();
      showToast('登录成功', 'success', 1500);
    } catch (e) {
      // fallback to normal route if any step fails
      try { await routeLoginBySessionValidityForSwitch(u, '已检测到有效登录状态：将在扩展页内切换账号', validResult.ok ? validResult.info : null); } catch {}
    }
    return;
  }
  const isFirstLogin = !lastValidUsername;
  if (isFirstLogin) showToast('正在检查账号…', 'info', 0);
  updateJsessionidState();
  if (!u) {
    // treat as cleared
    await setLocal('username', '');
    setWelcomeMessage(null);
    renderLoginAccountHistorySelect('');
    lastValidUsername = '';
    pendingUsernameChange = null;
    resetAccountSwitchInterruption();
    // keep jsessionid for manual mode; do not force modal
    isLoginSessionValid = false;
    showToast('账号已清空：可直接填写 JSESSIONID', 'info', 2500);
    await loadResourceSpaceForCurrentAccount();
    return;
  }

  // Validate userId first; if invalid -> revert to last valid
  const result = await validateUsernameBeforeLoginStart(u, { signal: changeSignal });
  if (!isCurrentUsernameChange()) return;
  if (!result.ok && result.status === 'cancelled') return;
  if (!result.ok) {
    // "invalid" means the account does not exist. Other failures may be due to session/network.
    if (result.status === 'invalid') {
      showToast('该账号不存在，已恢复原账号', 'error');
      await restoreLoginFallbackUsername(u);
      pendingUsernameChange = null;
      resetAccountSwitchInterruption();
      return;
    }
    showToast('无法验证账号有效性，请稍后重试', 'warning');
    await restoreLoginFallbackUsername(u);
    pendingUsernameChange = null;
    resetAccountSwitchInterruption();
    return;
  } else {
    // valid
    pendingUsernameChange = isFirstLogin ? null : { from: lastValidUsername, to: u };
    setWelcomeMessage(result.info);
  }

  if (result.status === 'needs-post-login') {
    isLoginSessionValid = true;
    await doLoginFlow();
    return;
  }

  try {
    // For first login, skip redundant detectUserIdFromPersonalCenter
    const detected = isFirstLogin ? u : await detectUserIdFromPersonalCenter();
    if (detected === u) {
      isLoginSessionValid = true;
      lastValidUsername = u;
      await setLocal('username', u);
      pendingUsernameChange = null;
      resetAccountSwitchInterruption();
      await syncJsessionidToUi();
      let info = result.ok ? result.info : null;
      if (!info) {
        try {
          info = await fetchUserInfoRemote(u);
        } catch {
          info = null;
        }
      }
      setWelcomeMessage(info);
      await rememberLoggedInAccount(u, info);
      renderLoginAccountHistorySelect(u);
      showToast('登录成功', 'success', 1500);
      if (isPlatformEnabled('ve')) loadCourses();
      await loadResourceSpaceForCurrentAccount();
    } else if (detected) {
      // Existing valid login session: switch account inside extension flow only.
      pendingUsernameChange = { from: detected, to: u };
      isLoginSessionValid = true;
      await routeLoginBySessionValidityForSwitch(u, '已检测到有效登录状态：将在扩展页内切换账号', result.ok ? result.info : null);
    } else {
      if (isFirstLogin) {
        isLoginSessionValid = true;
        await doLoginFlow();
      } else {
        isLoginSessionValid = true;
        await doLoginFlow();
      }
    }
  } catch (err) {
    isLoginSessionValid = true;
    await doLoginFlow();
  }
});

if (accountHistorySelect instanceof HTMLSelectElement) {
  accountHistorySelect.addEventListener('change', () => {
    if (isSyncingAccountHistorySelect) return;
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
    if (isPlatformEnabled('ve')) loadCourses();
    await loadResourceSpaceForCurrentAccount();
  });

// -------------------- Saved Uploads (本地保存本次上传过的文件) --------------------
const SAVED_UPLOADS_KEY = 'savedUploadedFiles';
const SAVE_UPLOADS_ENABLED_KEY = 'saveUploadedFilesEnabled';

async function loadSavedUploadsFromStorage() {
  try {
    const raw = await chrome.storage.local.get([SAVED_UPLOADS_KEY, SAVE_UPLOADS_ENABLED_KEY]);
    const list = raw?.[SAVED_UPLOADS_KEY];
    window.savedUploadedFiles = Array.isArray(list) ? list.filter((it) => it && it.url && it.visitName) : [];
    if (typeof raw?.[SAVE_UPLOADS_ENABLED_KEY] === 'boolean') {
      window.saveUploadedFilesEnabled = raw[SAVE_UPLOADS_ENABLED_KEY];
    }
  } catch {
    window.savedUploadedFiles = [];
  }
}

async function persistSavedUploads() {
  try {
    await chrome.storage.local.set({ [SAVED_UPLOADS_KEY]: window.savedUploadedFiles });
  } catch {
    // ignore quota / IO errors
  }
}

async function persistSaveUploadsEnabled() {
  try {
    await chrome.storage.local.set({ [SAVE_UPLOADS_ENABLED_KEY]: !!window.saveUploadedFilesEnabled });
  } catch {
    // ignore
  }
}

async function addSavedUpload(file, serverData, convertedUrl) {
  if (!window.saveUploadedFilesEnabled) return;
  const visitName = String(serverData?.visitName || '').trim();
  const url = String(convertedUrl || '').trim();
  if (!visitName || !url) return;
  const fileName = String(file?.name || '').trim() || '(未命名)';
  const fileSize = Number(file?.size || 0);
  const entry = {
    id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    fileSize,
    visitName,
    url,
    savedAt: Date.now()
  };
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const existingIdx = list.findIndex((it) => it && it.visitName === visitName);
  if (existingIdx >= 0) {
    list[existingIdx] = entry;
  } else {
    list.unshift(entry);
  }
  window.savedUploadedFiles = list;
  await persistSavedUploads();
}

async function removeSavedUpload(id) {
  const target = String(id || '').trim();
  if (!target) return;
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  window.savedUploadedFiles = list.filter((it) => it && it.id !== target);
  // Clean up the synthesized meta entry so the checkbox can no longer find the file.
  if (window.uploadedFileMetaById) {
    delete window.uploadedFileMetaById[`saved_${target}`];
  }
  await persistSavedUploads();
  renderSavedUploadsSection();
}

function formatSavedUploadSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderSavedUploadsSection() {
  const section = document.getElementById('saved-uploads-section');
  if (!(section instanceof HTMLElement)) return;
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const count = list.length;
  if (count === 0) {
    section.innerHTML = '';
    section.dataset.expanded = '0';
    return;
  }
  const expanded = section.dataset.expanded === '1';
  const collapsedText = '查看全部已上传文件';
  const expandedText = '收起全部已上传文件';
  const toggleLabel = `${expanded ? expandedText : collapsedText} (${count})`;
  const direction = expanded ? 'up' : 'down';

  // Register synthesized metas so saved files can be selected as homework attachments.
  if (!window.uploadedFileMetaById) window.uploadedFileMetaById = {};
  for (const it of list) {
    if (!it || !it.id || !it.visitName || !it.url) continue;
    const synthId = `saved_${it.id}`;
    const nameParts = splitFileName(it.fileName || '');
    window.uploadedFileMetaById[synthId] = {
      fileNameNoExt: String(nameParts?.fileNameNoExt || ''),
      fileExtName: String(nameParts?.fileExtName || ''),
      fileSize: String(Number(it.fileSize || 0) || 0),
      visitName: String(it.visitName || ''),
      pid: '',
      ftype: 'insert'
    };
  }

  const cardsHtml = list.map((it) => {
    const entryId = String(it.id || '').trim();
    if (!entryId) return '';
    const synthFileId = `saved_${entryId}`;
    const name = escapeHtml(it.fileName || '(未命名)');
    const sizeBytes = Number(it.fileSize || 0);
    const size = renderFileSizeText(sizeBytes, formatSavedUploadSize(sizeBytes));
    const url = String(it.url || '').trim();
    const safeUrl = escapeHtml(url);
    const safeHref = escapeHtml(url);
    const safeEntryId = escapeHtml(entryId);
    const safeSynthFileId = escapeHtml(synthFileId);
    const timeText = it.savedAt ? new Date(it.savedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    const timeHtml = timeText ? ` <span class="resource-time-inline">上传时间: ${escapeHtml(timeText)}</span>` : '';
    return `
      <div class="file-item" data-saved-upload-id="${safeEntryId}" data-resource-id="${safeSynthFileId}">
        <div class="upload-file-head-row" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
          <div class="saved-upload-main">
            <label class="upload-select-wrap">
              <input type="checkbox" class="submit-file-check" data-file-id="${safeSynthFileId}">
              作为作业附件
            </label>
            <strong class="saved-upload-name">${name}</strong>
            <span class="inline-status" style="font-size:12px; margin-left:8px; color:#2e7d32;">已上传</span>
            <span class="size-progress" style="margin-left:5px;">${size}</span>${timeHtml}
          </div>
          <div class="saved-upload-actions">
            <button type="button" class="btn saved-upload-delete" data-action="delete-saved-upload" data-saved-upload-id="${safeEntryId}" style="padding:2px 8px; font-size:12px; background-color:#f44336;">删除</button>
          </div>
        </div>
        <div class="upload-link-row">
          <a class="url-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>
          <button type="button" class="btn saved-upload-copy" data-action="copy-saved-upload" data-saved-upload-id="${safeEntryId}" style="padding:2px 8px; font-size:12px; white-space:nowrap;">复制</button>
          <button type="button" class="btn saved-upload-download" data-action="download-saved-upload" data-saved-upload-id="${safeEntryId}" data-url="${safeHref}" data-filename="${escapeHtml(it.fileName || '')}" style="padding:2px 8px; font-size:12px; white-space:nowrap; background:#1e3a8a;">下载</button>
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

  section.innerHTML = `
    <div class="homework-toggle-row homework-toggle-row--saved-uploads">
      <button class="btn homework-toggle-btn ${expanded ? 'is-expanded' : ''} homework-toggle-btn--${direction}" data-action="toggle-saved-uploads" data-collapsed-text="${escapeHtml(collapsedText)}" data-expanded-text="${escapeHtml(expandedText)}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
        <span class="homework-toggle-label">${escapeHtml(toggleLabel)}</span>
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
      </button>
    </div>
    <div class="saved-uploads-list homework-group ${expanded ? '' : 'is-hidden'} homework-group-animating">${cardsHtml}</div>
  `;
  if (typeof refreshUploadSelectVisibility === 'function') {
    refreshUploadSelectVisibility();
  }
}

function setupSavedUploadsUi() {
  const cb = document.getElementById('save-uploads-enabled');
  if (cb instanceof HTMLInputElement) {
    cb.checked = !!window.saveUploadedFilesEnabled;
    cb.addEventListener('change', () => {
      window.saveUploadedFilesEnabled = !!cb.checked;
      persistSaveUploadsEnabled();
    });
  }
  const invertBtn = document.getElementById('invert-save-uploads-btn');
  if (invertBtn) {
    invertBtn.addEventListener('click', () => {
      document.querySelectorAll('#file-list .file-item input.submit-file-check').forEach(cb => { cb.checked = !cb.checked; });
      document.querySelectorAll('.saved-uploads-list:not(.is-hidden) .file-item input.submit-file-check').forEach(cb => { cb.checked = !cb.checked; });
    });
  }
  const section = document.getElementById('saved-uploads-section');
  if (section instanceof HTMLElement) {
    section.addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      // Handle action buttons first
      const actionEl = t.closest('[data-action]');
      if (actionEl instanceof HTMLElement) {
        const action = String(actionEl.dataset.action || '').trim();
        if (action === 'toggle-saved-uploads') {
          const expanded = section.dataset.expanded === '1';
          const nextExpanded = expanded ? '0' : '1';
          section.dataset.expanded = nextExpanded;
          const list = section.querySelector('.saved-uploads-list');
          if (list) {
            if (nextExpanded === '1') list.classList.remove('is-hidden');
            else list.classList.add('is-hidden');
          }
          const btn = actionEl;
          const isExpanded = nextExpanded === '1';
          btn.classList.toggle('is-expanded', isExpanded);
          btn.classList.toggle('homework-toggle-btn--up', isExpanded);
          btn.classList.toggle('homework-toggle-btn--down', !isExpanded);
          btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
          return;
        }
        if (action === 'delete-saved-upload') {
          const id = String(actionEl.dataset.savedUploadId || '').trim();
          if (id) removeSavedUpload(id);
          return;
        }
        if (action === 'copy-saved-upload') {
          const id = String(actionEl.dataset.savedUploadId || '').trim();
          const entry = (window.savedUploadedFiles || []).find((it) => it && it.id === id);
          if (entry && entry.url) {
            navigator.clipboard.writeText(entry.url).then(() => {
              const original = actionEl.textContent;
              actionEl.textContent = '已复制';
              setTimeout(() => { actionEl.textContent = original; }, 1500);
            }).catch(() => {
              if (typeof showToast === 'function') {
                showToast('复制失败，请手动复制链接', 'error', 2000);
              }
            });
          }
          return;
        }
        if (action === 'cancel-saved-upload') {
          const id = `saved_${String(actionEl.dataset.savedUploadId || '').trim()}`;
          if (id) cancelResourceDownload(id);
          return;
        }
        if (action === 'download-saved-upload') {
          const url = String(actionEl.dataset.url || '').trim();
          const filename = String(actionEl.dataset.filename || '').trim() || '下载';
          const entryId = String(actionEl.dataset.savedUploadId || '').trim();
          if (url) {
            try {
              await enqueueResourceDownload({
                id: `saved_${entryId}`,
                name: filename,
                url: url,
                extName: filename.includes('.') ? filename.split('.').pop() : '',
                sizeMb: '-',
                sizeMbRaw: 0,
                inputTime: ''
              });
            } catch (e) {
              showToast(`下载失败：${String(e?.message || e)}`, 'error', 2000);
            }
          }
          return;
        }
        return;
      }

      // Click on a head row (not on button/link/input) toggles the checkbox
      const row = t.closest('.upload-file-head-row');
      if (!(row instanceof HTMLElement)) return;
      if (t.closest('button,a,input,textarea,select,label')) return;
      const cb = row.querySelector('input.submit-file-check');
      if (!(cb instanceof HTMLInputElement)) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  renderSavedUploadsSection();
}

// -------------------- Init --------------------
(async function init() {
  setupRightColumnResizer();
  updateTotalProgress();
  updateResourceDownloadTotals();
  await loadPlatformEnabledFromStorage();
  await loadPopupCacheEnabledSetting();
  await loadAutoLoadCourseResourcesSetting();
  setupOptionsStorageLiveSync();
  setupPortalUsernameBindMessageListener();
  const restoredPopupCache = await restorePopupFullscreenCacheIfNeeded();
  if (popupMode && !restoredPopupCache) {
    window.platformEnabled = { jlgj: false, mrjzy: false, ve: true, ykt: false };
  }
  if (popupMode || !window.__updateCheckerLoaded) {
    const versionInfoEl = document.getElementById('version-info');
    if (versionInfoEl) versionInfoEl.style.display = 'none';
  }
  refreshPlatformLoginTip();

  if (restoredPopupCache) {
    await loadLoginAccountHistory();
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
    adjustParallelLimitWidth();
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

  // VE enabled startup must always dispatch these 3 requests concurrently:
  // getUserInfo + getCourseList + resourceSpaceList.
  const startupPlatformLoadPromise = triggerInitialPlatformLoads();
  const startupResourceSpacePromise = loadResourceSpaceForCurrentAccount().catch(() => {});

  await loadLoginAccountHistory();
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
  adjustParallelLimitWidth();
  // start getUserInfo after we've loaded the saved username so the call mirrors
  // the re-enable flow (which reads current username before calling getUserInfo).
  const veStartupAccountInfoPromise = startVeStartupAccountInfoLoad();
  const settled = await Promise.allSettled([veStartupAccountInfoPromise, startupPlatformLoadPromise, startupResourceSpacePromise]);
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

  // startupPlatformLoadPromise and startupResourceSpacePromise already awaited above via `settled`
})();

const SEVEN_SEGMENT_MAP = {
  0: 'abcdef',
  1: 'bc',
  2: 'abged',
  3: 'abgcd',
  4: 'fgbc',
  5: 'afgcd',
  6: 'afgcde',
  7: 'abc',
  8: 'abcdefg',
  9: 'abfgcd'
};

function renderSevenSegmentChar(ch) {
  if (ch === ':') return '<span class="seven-seg-colon" aria-hidden="true"></span>';
  const active = SEVEN_SEGMENT_MAP[ch] || '';
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  return `<span class="seven-seg-digit" aria-hidden="true">${segments.map((seg) => `<span class="seg seg-${seg}${active.includes(seg) ? ' on' : ''}"></span>`).join('')}</span>`;
}

function renderSevenSegmentTime(text) {
  const value = String(text || '');
  return `<span class="deadline-countdown-label">剩</span><span class="seven-seg-display" role="img" aria-label="${escapeHtml(value)}">${value.split('').map(renderSevenSegmentChar).join('')}</span>`;
}

function updateAllCountdowns() {
  document.querySelectorAll('.deadline-countdown').forEach((span) => {
    const d = span.dataset.deadline;
    if (!d) return;
    const ts = parseDeadlineToTs(d);
    if (!ts) return;
    const now = Date.now();
    const diff = ts - now;
    if (diff <= 0) {
      if (span.innerHTML !== '') {
        span.innerHTML = '';
        span.style.fontFamily = 'inherit';
        span.style.fontSize = 'inherit';
      }
      span.style.display = 'none';
      return;
    }
    span.style.display = '';
    const dDays = Math.floor(diff / 86400000);
    const dHours = Math.floor(diff / 3600000) % 24;
    const dMins = Math.floor(diff / 60000) % 60;
    const dSecs = Math.floor(diff / 1000) % 60;

    const pad = (n) => String(n).padStart(2, '0');
    // Format dd:hh:mm:ss
    const s = `${pad(dDays)}:${pad(dHours)}:${pad(dMins)}:${pad(dSecs)}`;

    const newHtml = renderSevenSegmentTime(s);
    if (span.innerHTML !== newHtml) {
      span.innerHTML = newHtml;
    }
  });
}
setInterval(updateAllCountdowns, 1000);

// setupCourseHeaderQr moved to course-qr.js
