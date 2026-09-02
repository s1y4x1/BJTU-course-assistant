const SYSTEM_NOTIFICATION_STATUS_KEY = 'systemNotificationStatus';
const SYSTEM_NOTIFICATION_TEST_ID = 'bjtu-system-notification-test';
const ACADEMIC_BB_NOTIFICATION_PREFIX = 'bjtu-academic-bb-availability:';
const BJTU_TAB_GROUP_TITLE = 'BJTU 课程助手';
const BJTU_TAB_GROUP_COLOR = 'blue';
const GROUP_EXTENSION_TABS_ENABLED_KEY = 'groupExtensionTabsEnabled';

let bjtuTabGroupingQueue = Promise.resolve();

async function groupBjtuExtensionOpenedTabNow(tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id) || id <= 0 || !chrome?.tabs?.group || !chrome?.tabGroups?.query) return null;
  try {
    const setting = await chrome.storage.local.get(GROUP_EXTENSION_TABS_ENABLED_KEY).catch(() => ({}));
    if (setting?.[GROUP_EXTENSION_TABS_ENABLED_KEY] !== true) return null;
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (!tab || !Number.isInteger(tab.windowId)) return null;

    const [groups, windowTabs] = await Promise.all([
      chrome.tabGroups.query({ windowId: tab.windowId }).catch(() => []),
      chrome.tabs.query({ windowId: tab.windowId }).catch(() => [])
    ]);
    const existing = groups.find((group) => group.title === BJTU_TAB_GROUP_TITLE);
    const extensionBase = chrome.runtime.getURL('');
    const tabIds = [id, ...windowTabs
      .filter((item) => item?.pinned !== true && String(item?.url || item?.pendingUrl || '').startsWith(extensionBase))
      .map((item) => Number(item.id))]
      .filter((value, index, values) => Number.isInteger(value) && value > 0 && values.indexOf(value) === index);

    const groupId = await chrome.tabs.group(existing
      ? { groupId: existing.id, tabIds }
      : { tabIds });
    if (!existing) {
      await chrome.tabGroups.update(groupId, {
        title: BJTU_TAB_GROUP_TITLE,
        color: BJTU_TAB_GROUP_COLOR
      });
    }
    return groupId;
  } catch (error) {
    console.info('[bjtu] tab grouping failed:', String(error?.message || error));
    return null;
  }
}

function groupBjtuExtensionOpenedTab(tabId) {
  const task = bjtuTabGroupingQueue.then(() => groupBjtuExtensionOpenedTabNow(tabId));
  bjtuTabGroupingQueue = task.catch(() => null);
  return task;
}

async function createBjtuGroupedTab(createProperties) {
  const tab = await chrome.tabs.create(createProperties);
  await groupBjtuExtensionOpenedTab(tab?.id);
  return tab;
}

globalThis.BjtuTabs = Object.freeze({
  create: createBjtuGroupedTab,
  group: groupBjtuExtensionOpenedTab
});

chrome.tabs.onCreated.addListener((tab) => {
  const createdUrl = String(tab?.pendingUrl || tab?.url || '');
  if (createdUrl.startsWith(chrome.runtime.getURL(''))) {
    void groupBjtuExtensionOpenedTab(tab.id);
    return;
  }
  if (!Number.isInteger(tab?.openerTabId)) return;
  chrome.tabs.get(tab.openerTabId).then((opener) => {
    if (String(opener?.url || '').startsWith(chrome.runtime.getURL(''))) {
      void groupBjtuExtensionOpenedTab(tab.id);
    }
  }).catch(() => {});
});

async function createBjtuSystemNotification(notificationId, options, source = 'background', replaceExisting = false) {
  const id = String(notificationId || '').trim();
  const requestedIconUrl = String(options?.iconUrl || '').trim();
  const payload = {
    ...(options && typeof options === 'object' ? options : {}),
    iconUrl: /^(?:data:|blob:|https?:|chrome-extension:)/i.test(requestedIconUrl)
      ? requestedIconUrl
      : chrome.runtime.getURL(String(requestedIconUrl || 'icons/128.png').replace(/^\/+/, ''))
  };
  const attemptedAt = Date.now();
  try {
    if (replaceExisting && id) await chrome.notifications.clear(id).catch(() => false);
    const createdId = await new Promise((resolve, reject) => {
      chrome.notifications.create(id || undefined, payload, (resultId) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || '创建系统通知失败'));
        else resolve(String(resultId || id));
      });
    });
    await chrome.storage.local.set({
      [SYSTEM_NOTIFICATION_STATUS_KEY]: {
        status: 'success',
        source: String(source || 'background'),
        notificationId: createdId,
        attemptedAt
      }
    }).catch(() => {});
    return createdId;
  } catch (error) {
    await chrome.storage.local.set({
      [SYSTEM_NOTIFICATION_STATUS_KEY]: {
        status: 'error',
        source: String(source || 'background'),
        notificationId: id,
        attemptedAt,
        error: String(error?.message || error || '创建系统通知失败')
      }
    }).catch(() => {});
    throw error;
  }
}

globalThis.BjtuSystemNotifications = Object.freeze({ create: createBjtuSystemNotification });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'GROUP_BJTU_OPENED_TAB') return undefined;
  const tabId = Number(message?.tabId ?? sender?.tab?.id);
  groupBjtuExtensionOpenedTab(tabId)
    .then((groupId) => sendResponse({ ok: groupId != null, groupId }))
    .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
  return true;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!['SYSTEM_NOTIFICATION_TEST', 'SYSTEM_NOTIFICATION_CREATE'].includes(message?.type)) return undefined;
  const isTest = message.type === 'SYSTEM_NOTIFICATION_TEST';
  const notificationId = isTest
    ? SYSTEM_NOTIFICATION_TEST_ID
    : String(message?.notificationId || '').trim();
  const options = isTest ? {
    type: 'basic',
    title: 'BJTU 课程助手通知测试',
    message: '系统通知创建成功。后续作业、成绩、更新等通知也会通过此通道发送。',
    priority: 2
  } : message?.options;
  if (!notificationId || !options || typeof options !== 'object') {
    sendResponse({ ok: false, message: '系统通知参数不完整' });
    return false;
  }
  createBjtuSystemNotification(
    notificationId,
    options,
    isTest ? 'test' : String(message?.source || 'extension-page'),
    isTest || message?.replaceExisting === true
  )
    .then((notificationId) => sendResponse({ ok: true, notificationId }))
    .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ACADEMIC_BB_COURSE_NOTIFICATION') return undefined;
  const tabId = Number(sender?.tab?.id);
  const key = String(message?.payload?.key || 'course').trim().slice(0, 160);
  const title = String(message?.payload?.title || 'BB酱查课余量').slice(0, 160);
  const notificationId = `${ACADEMIC_BB_NOTIFICATION_PREFIX}${Number.isInteger(tabId) ? tabId : 0}:${encodeURIComponent(key)}`;
  const options = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title,
    message: String(message?.payload?.text || '发现课程余量').slice(0, 500),
    priority: 2,
    requireInteraction: true
  };
  chrome.notifications.update(notificationId, options, (updated) => {
    const updateError = chrome.runtime.lastError;
    if (!updateError && updated) {
      sendResponse({ ok: true, notificationId });
      return;
    }
    chrome.notifications.create(notificationId, options, (createdId) => {
      const createError = chrome.runtime.lastError;
      sendResponse(createError
        ? { ok: false, message: String(createError.message || createError) }
        : { ok: true, notificationId: createdId || notificationId });
    });
  });
  return true;
});

// 工具栏固定状态查询
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_ACTION_PINNED_STATE') return undefined;
  (async () => {
    try {
      const settings = await chrome.action.getUserSettings();
      sendResponse({ ok: true, supported: true, pinned: settings?.isOnToolbar === true });
    } catch {
      sendResponse({ ok: true, supported: false, pinned: false });
    }
  })();
  return true;
});

// 卸载后打开讨论页
chrome.runtime.setUninstallURL('https://github.com/s1y4x1/BJTU-course-assistant/discussions/3').catch(() => {});

function tryImportModuleScripts(...paths) {
  try {
    importScripts(...paths);
    return true;
  } catch (error) {
    console.info('[bjtu] optional module unavailable:', paths[0], String(error?.message || error));
    return false;
  }
}

const veBackgroundReady = tryImportModuleScripts(
  '../modules/ve/vendor/main2.min.js',
  '../core/md5.js',
  '../modules/ve/login-utils.js',
  '../modules/ve/account-store.js',
  '../modules/ve/homework-core.js'
);
tryImportModuleScripts('../core/captcha-assets.js');
tryImportModuleScripts('../core/page-toast.js');
tryImportModuleScripts('../modules/captcha/mis-assets.js');
tryImportModuleScripts('../modules/captcha/recognizer.js');
if (veBackgroundReady) tryImportModuleScripts('../modules/ve/login-service.js');
tryImportModuleScripts('../modules/academic/score-statistics.js', '../modules/academic/system.js');
tryImportModuleScripts('../modules/cas/system.js');
tryImportModuleScripts('../modules/mail/system.js');
tryImportModuleScripts('../modules/campusnet/background.js');
tryImportModuleScripts('../modules/updater/filesystem.js', '../modules/updater/background.js');
tryImportModuleScripts('../modules/jlgj/background.js');
tryImportModuleScripts('../modules/mooc/background.js');
tryImportModuleScripts('../core/module-registry.js');
tryImportModuleScripts(
  '../modules/qwen/operations.js',
  '../modules/qwen/qwen-client.js',
  '../modules/qwen/agent.js',
  '../modules/qwen/background.js'
);
if (veBackgroundReady) tryImportModuleScripts('../modules/ve/background-homework.js');

const OPTIONAL_CONTENT_SCRIPTS = [
  {
    id: 'bjtu-ve-login-response-detector',
    module: 've',
    matches: ['http://123.121.147.7:88/*'],
    js: ['modules/ve/login-response-detector.js'],
    runAt: 'document_start',
    allFrames: true
  },
  {
    id: 'bjtu-ve-login-network-observer',
    module: 've',
    matches: ['http://123.121.147.7:88/*'],
    js: ['modules/ve/login-network-observer-main.js'],
    runAt: 'document_start',
    world: 'MAIN',
    allFrames: true
  },
  {
    id: 'bjtu-ve-login-overlay',
    module: 've',
    matches: ['http://123.121.147.7:88/ve/*'],
    js: [
      'modules/ve/vendor/main2.min.js',
      'modules/ve/login-credentials-dialog.js',
      'modules/ve/login-overlay.js'
    ],
    runAt: 'document_idle'
  },
  { id: 'bjtu-mooc-inject', module: 'mooc', matches: ['https://www.icourse163.org/*'], js: ['modules/mooc/inject.js'], runAt: 'document_idle' },
  { id: 'bjtu-jlgj-theme', module: 'jlgj', matches: ['https://i.jielong.com/*'], js: ['modules/jlgj/theme.js'], runAt: 'document_start' },
  {
    id: 'bjtu-academic-assessment-satisfied',
    module: 'academic',
    enabledStorageKey: 'academicAssessmentExternalScriptEnabled',
    matches: ['https://aa.bjtu.edu.cn/teaching_assessment/stu*'],
    js: ['modules/academic/external/BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见.user.js'],
    runAt: 'document_start'
  },
{
    id: 'bjtu-academic-bb-course-availability',
    module: 'academic',
    enabledStorageKey: 'academicBbCourseAvailabilityExternalScriptEnabled',
    matches: ['https://aa.bjtu.edu.cn/course_selection/courseselecttask/selects/*'],
    js: ['modules/academic/external/BB酱帮你查课余量 (2026修复版).user.js'],
    runAt: 'document_start'
  },
  {
    id: 'bjtu-cas-captcha-login',
    module: 'captcha',
    matches: ['https://cas.bjtu.edu.cn/auth/login/*'],
    js: ['modules/captcha/cas-login.js'],
    runAt: 'document_idle'
  },
  {
    id: 'bjtu-qwen-page-bridge',
    module: 'qwen',
    matches: ['https://chat.qwen.ai/*'],
    js: ['modules/qwen/content-script.js'],
    runAt: 'document_idle'
  },
  {
    id: 'bjtu-mj-spider-man-easter-egg',
    module: 'MJ',
    enabledStorageKey: 'mjExternalScriptEnabled',
    matches: ['<all_urls>'],
    js: [
      'modules/MJ/media-replacer.js',
      'modules/MJ/external/MJ 蜘蛛侠网页彩蛋.user.js'
    ],
    runAt: 'document_end'
  }
];
const LEGACY_OPTIONAL_CONTENT_SCRIPT_IDS = new Set([
  'bjtu-jlgj-capture'
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'MIS_CAPTCHA_RECOGNIZE') return false;
  (async () => {
    try {
      if (!globalThis.BjtuCaptchaRecognizer?.recognizeMisCaptcha) {
        sendResponse({ ok: false, message: '验证码识别模块尚未就绪' });
        return;
      }
      const blob = await (await fetch(String(message.imageUrl || ''))).blob();
      const result = await globalThis.BjtuCaptchaRecognizer.recognizeMisCaptcha(blob);
      sendResponse(result);
    } catch (error) {
      sendResponse({ ok: false, message: String(error?.message || error) });
    }
  })();
  return true;
});

async function extensionFileExists(path) {
  try {
    return (await fetch(chrome.runtime.getURL(path), { cache: 'no-store' })).ok;
  } catch {
    return false;
  }
}

let optionalContentScriptSyncPromise = null;
async function doSyncOptionalContentScripts() {
  const wanted = [];
  const enabledKeys = OPTIONAL_CONTENT_SCRIPTS.map((script) => script.enabledStorageKey).filter(Boolean);
  const enabledState = enabledKeys.length ? await chrome.storage.local.get(enabledKeys) : {};
  for (const script of OPTIONAL_CONTENT_SCRIPTS) {
    if (script.enabledStorageKey && enabledState[script.enabledStorageKey] !== true) continue;
    const scriptFilesExist = (await Promise.all(script.js.map(extensionFileExists))).every(Boolean);
    if (await extensionFileExists(`modules/${script.module}/module.json`)
        && scriptFilesExist) wanted.push(script);
  }
  const managed = new Set([
    ...OPTIONAL_CONTENT_SCRIPTS.map((script) => script.id),
    ...LEGACY_OPTIONAL_CONTENT_SCRIPT_IDS
  ]);
  const registered = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
  const registeredManagedIds = registered
    .map((script) => String(script?.id || ''))
    .filter((id) => managed.has(id));
  if (registeredManagedIds.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registeredManagedIds });
  }
  const registrations = wanted.map(({ module: _module, enabledStorageKey: _enabledStorageKey, ...script }) => script);
  if (registrations.length) {
    try {
      await chrome.scripting.registerContentScripts(registrations);
    } catch (error) {
      console.warn('[bjtu] optional content script registration failed:', error);
      return { ok: false, message: String(error?.message || error) };
    }
  }
  return { ok: true, registeredIds: registrations.map((script) => script.id) };
}

function syncOptionalContentScripts() {
  if (!optionalContentScriptSyncPromise) {
    optionalContentScriptSyncPromise = doSyncOptionalContentScripts()
      .finally(() => { optionalContentScriptSyncPromise = null; });
  }
  return optionalContentScriptSyncPromise;
}

chrome.runtime.onInstalled.addListener(() => { void syncOptionalContentScripts(); });
chrome.runtime.onStartup.addListener(() => { void syncOptionalContentScripts(); });
void syncOptionalContentScripts();

const EXTENSION_INSTALLED_AT_KEY = 'extensionInstalledAt';
const EXTENSION_LAST_RELOADED_AT_KEY = 'extensionLastReloadedAt';
const EXTENSION_RUNTIME_SESSION_KEY = 'extensionRuntimeSessionMarker';

async function initializeExtensionRuntimeMetadata() {
  const now = Date.now();
  const [local, session] = await Promise.all([
    chrome.storage.local.get([EXTENSION_INSTALLED_AT_KEY]).catch(() => ({})),
    chrome.storage.session.get([EXTENSION_RUNTIME_SESSION_KEY]).catch(() => ({}))
  ]);
  const patch = {};
  if (!(Number(local?.[EXTENSION_INSTALLED_AT_KEY]) > 0)) patch[EXTENSION_INSTALLED_AT_KEY] = now;
  if (!session?.[EXTENSION_RUNTIME_SESSION_KEY]) {
    patch[EXTENSION_LAST_RELOADED_AT_KEY] = now;
    await chrome.storage.session.set({
      [EXTENSION_RUNTIME_SESSION_KEY]: `${now}:${crypto.randomUUID()}`
    }).catch(() => {});
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch).catch(() => {});
}

void initializeExtensionRuntimeMetadata();

const APP_URL = chrome.runtime.getURL('app/app.html');
const VERSION_AUTO_RELOAD_HANDOFF_KEY = 'versionAutoReloadHandoff';
const VERSION_AUTO_RELOAD_COMPLETED_KEY = 'versionAutoReloadCompleted';
const EXTENSION_RELOAD_RESTORE_ALARM = 'bjtu-extension-reload-restore';
const RELOAD_REOPEN_PATHS = new Set([
  'options/options.html',
  'modules/academic/options.html',
  'modules/MJ/options.html'
]);

function reloadTargetUrl(payload = {}) {
  const targetPath = String(payload?.targetPath || '').replace(/^\/+/, '');
  if (RELOAD_REOPEN_PATHS.has(targetPath)) return chrome.runtime.getURL(targetPath);
  const suffix = payload?.popup === true ? '?popup=1' : '';
  return `${APP_URL}${suffix}`;
}

async function getOpenAppTabs() {
  return (await chrome.tabs.query({}).catch(() => []))
    .filter((tab) => String(tab?.url || '').startsWith(APP_URL));
}

async function refreshOpenAppTabs() {
  const tabs = await getOpenAppTabs();
  await Promise.allSettled(tabs.map((tab) => chrome.tabs.reload(tab.id)));
  return tabs.length;
}

async function prepareAppRestoreAfterExtensionReload(payload = {}, sourceTabId = null) {
  const tabs = await getOpenAppTabs();
  const requestedSourceTabId = Number(sourceTabId || payload?.sourceTabId);
  const requestedOptionsPath = String(payload?.restoreOptionsPath || '').replace(/^\/+/, '');
  await chrome.storage.local.set({
    [VERSION_AUTO_RELOAD_HANDOFF_KEY]: {
      ...(payload && typeof payload === 'object' ? payload : {}),
      requestedAt: Date.now(),
      reopenApp: payload?.reopenApp === true || tabs.length > 0,
      appTabs: tabs.map((tab) => ({
        id: Number(tab?.id) || null,
        url: String(tab?.url || APP_URL)
      })).filter((tab) => Number.isInteger(tab.id) && tab.id > 0),
      restoreOptionsPath: RELOAD_REOPEN_PATHS.has(requestedOptionsPath) ? requestedOptionsPath : '',
      sourceTabId: Number.isInteger(requestedSourceTabId) && requestedSourceTabId > 0
        ? requestedSourceTabId
        : null
    }
  });
  return tabs.length;
}

async function reloadExtensionAndOpenApp(payload = {}, sourceTabId = null) {
  const requestedSourceTabId = Number(sourceTabId || payload?.sourceTabId);
  await prepareAppRestoreAfterExtensionReload({
    ...(payload && typeof payload === 'object' ? payload : {}),
    reopenApp: payload?.reopenApp !== false
  }, requestedSourceTabId);
  chrome.alarms.create(EXTENSION_RELOAD_RESTORE_ALARM, { when: Date.now() + 1500 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  chrome.runtime.reload();
}

globalThis.BjtuForegroundAppPages = Object.freeze({
  refresh: refreshOpenAppTabs,
  prepareReload: prepareAppRestoreAfterExtensionReload
});

async function restoreAppAfterAutomaticExtensionReload() {
  const stored = await chrome.storage.local.get([VERSION_AUTO_RELOAD_HANDOFF_KEY]).catch(() => ({}));
  const handoff = stored?.[VERSION_AUTO_RELOAD_HANDOFF_KEY];
  if (!handoff) return;
  await chrome.alarms.clear(EXTENSION_RELOAD_RESTORE_ALARM).catch(() => false);
  await chrome.storage.local.set({
    [VERSION_AUTO_RELOAD_COMPLETED_KEY]: {
      ...handoff,
      completedAt: Date.now()
    }
  }).catch(() => {});
  await chrome.storage.local.remove([VERSION_AUTO_RELOAD_HANDOFF_KEY]).catch(() => {});
  if (handoff.background) {
    const localVersion = String(chrome.runtime.getManifest().version || '').replace(/^v/i, '');
    const targetVersion = String(handoff.ver || '').replace(/^v/i, '');
    if (localVersion && targetVersion && localVersion === targetVersion) {
      await chrome.storage.local.remove(['pendingUpdateReload']).catch(() => {});
    }
    await chrome.storage.local.set({
      backgroundAutoUpdateStatus: {
        status: 'complete',
        ver: String(handoff.ver || ''),
        name: String(handoff.name || handoff.ver || ''),
        fileCount: Number(handoff.fileCount || 0),
        checkedAt: Date.now(),
        reloaded: true
      }
    }).catch(() => {});
    const completionNotificationId = String(handoff.completionNotificationId || '').trim()
      || `bjtu-background-update-complete:${String(handoff.ver || 'unknown').replace(/^v/i, '')}`;
    await createBjtuSystemNotification(completionNotificationId, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'BJTU 课程助手已后台更新',
      message: `已更新到 ${String(handoff.name || handoff.ver || '新版本')} 并自动重新加载扩展。`,
      priority: 1
    }, 'background-update-complete', true).catch(() => {});
  }
  const restoreOptionsPath = String(handoff.restoreOptionsPath || '').replace(/^\/+/, '');
  const legacyTargetPath = String(handoff.targetPath || '').replace(/^\/+/, '');
  const validOptionsPath = RELOAD_REOPEN_PATHS.has(restoreOptionsPath)
    ? restoreOptionsPath
    : (!Object.prototype.hasOwnProperty.call(handoff, 'appTabs') && RELOAD_REOPEN_PATHS.has(legacyTargetPath)
      ? legacyTargetPath
      : '');
  const savedAppTabs = Array.isArray(handoff.appTabs) ? handoff.appTabs : [];
  const restoredAppTabs = [];

  if (handoff.reopenApp !== false) {
    for (const saved of savedAppTabs) {
      const tabId = Number(saved?.id);
      if (!Number.isInteger(tabId) || tabId <= 0) continue;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) continue;
      const savedUrl = String(saved?.url || '');
      const url = savedUrl.startsWith(APP_URL) ? savedUrl : APP_URL;
      const updated = await chrome.tabs.update(tabId, { url, active: false }).catch(() => null);
      if (updated) restoredAppTabs.push(updated);
    }
    if (!restoredAppTabs.length) {
      const existing = await getOpenAppTabs();
      if (existing.length) {
        const updated = await chrome.tabs.update(existing[0].id, { url: existing[0].url || APP_URL, active: false }).catch(() => null);
        if (updated) restoredAppTabs.push(updated);
      } else {
        const created = await globalThis.BjtuTabs.create({ url: APP_URL, active: !validOptionsPath }).catch(() => null);
        if (created) restoredAppTabs.push(created);
      }
    }
  }

  if (validOptionsPath) {
    const optionsUrl = chrome.runtime.getURL(validOptionsPath);
    const sourceTabId = Number(handoff.sourceTabId);
    let optionsTab = Number.isInteger(sourceTabId) && sourceTabId > 0
      ? await chrome.tabs.get(sourceTabId).catch(() => null)
      : null;
    if (optionsTab) {
      optionsTab = await chrome.tabs.update(sourceTabId, { url: optionsUrl, active: true }).catch(() => null);
    } else {
      const existing = (await chrome.tabs.query({}).catch(() => []))
        .find((tab) => String(tab?.url || '').startsWith(optionsUrl));
      optionsTab = existing
        ? await chrome.tabs.update(existing.id, { url: optionsUrl, active: true }).catch(() => null)
        : await globalThis.BjtuTabs.create({ url: optionsUrl, active: true }).catch(() => null);
    }
    if (optionsTab?.windowId) {
      await chrome.windows.update(optionsTab.windowId, { focused: true }).catch(() => null);
    }
    return;
  }

  if (restoredAppTabs.length) {
    const tab = restoredAppTabs[0];
    await chrome.tabs.update(tab.id, { active: true }).catch(() => null);
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
    return;
  }

  // Compatibility with handoffs written by an older extension version.
  if (handoff.reopenApp !== false) {
    await globalThis.BjtuTabs.create({ url: reloadTargetUrl(handoff), active: true }).catch(() => null);
  }
}

void restoreAppAfterAutomaticExtensionReload();

const portalUsernameBindByTab = new Map(); // tabId -> { ts, loginName }
const portalDetectedQuickUsernameByTab = new Map(); // tabId -> { quickUsername, ts } from a pending successful-response check
const portalQuickUsernameToastByTab = new Map(); // tabId -> quickUsername already toasted
const portalDetectedPasswordLoginByTab = new Map(); // tabId -> encrypted password login request
const portalPasswordRecordingTabs = new Set();
const portalQuickUsernameFinalizing = new Set(); // tabId -> avoid concurrent/double finalization
const LOGIN_ACCOUNT_HISTORY_KEY = 'loginAccountHistory';
let latestResponseJsessionid = null;

function notifyPortalUsernameBindStatus(status) {
  try {
    chrome.runtime.sendMessage({ type: 'PORTAL_USERNAME_BIND_STATUS', payload: status }, () => {
      // Receiving end may not exist; ignore.
      void chrome.runtime.lastError;
    });
  } catch {}
}

try {
  chrome.storage.local.remove([
    'latestResponseJsessionid',
    'latestSentLoginJsessionid',
    'portalUsernameBindStatus',
    'headerQrEnabled',
    '_VERSION_UPDATE_DOWNLOAD_ID'
  ]).catch(() => {});
} catch {}

// 下载完成系统通知点击处理（持久上下文，弹窗关闭后仍有效）
const VERSION_UPDATE_NOTIFICATION_ID = 'bjtu-update-download-complete';
const HOMEWORK_REMINDER_NOTIFICATION_PREFIX = 'bjtu-homework-reminder:';
const BACKGROUND_UPDATE_NOTIFICATION_PREFIX = 'bjtu-background-update-';
chrome.notifications.onClicked.addListener((notifId) => {
  const notificationId = String(notifId || '');
  if (notificationId.startsWith(ACADEMIC_BB_NOTIFICATION_PREFIX)) {
    const match = notificationId.slice(ACADEMIC_BB_NOTIFICATION_PREFIX.length).match(/^(\d+):(.*)$/);
    const tabId = Number(match?.[1]);
    const key = decodeURIComponent(match?.[2] || '');
    if (Number.isInteger(tabId) && tabId > 0) {
      chrome.tabs.update(tabId, { active: true }).then(async (tab) => {
        if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
        await chrome.tabs.sendMessage(tabId, {
          type: 'ACADEMIC_BB_NOTIFICATION_CLICKED',
          payload: { key }
        }).catch(() => null);
      }).catch(() => null);
    }
    chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    return;
  }
  if (notificationId.startsWith(HOMEWORK_REMINDER_NOTIFICATION_PREFIX)
    || notificationId.startsWith(BACKGROUND_UPDATE_NOTIFICATION_PREFIX)) {
    focusExistingAppTabOrOpen().catch(() => {});
    chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    return;
  }
  if (notifId !== VERSION_UPDATE_NOTIFICATION_ID) return;
  globalThis.BjtuTabs.create({ url: 'about:extensions' }).catch(() => {});
  chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
});

const HOMEWORK_REMINDER_ALARM = 'bjtu-homework-reminder-check';
const HOMEWORK_REMINDER_SNAPSHOT_KEY = 'homeworkReminderSnapshot';
const HOMEWORK_REMINDER_NOTIFIED_KEY = 'homeworkReminderNotified';
const HOMEWORK_REMINDER_OBSERVED_KEY = 'homeworkReminderObserved';

async function focusExistingAppTabOrOpen() {
  const tabs = (await chrome.tabs.query({}).catch(() => []))
    .filter((tab) => String(tab?.url || '').startsWith(APP_URL));
  if (tabs.length) {
    const tab = tabs[0];
    let popupPage = false;
    try {
      popupPage = new URL(String(tab.url || '')).searchParams.get('popup') === '1';
    } catch {
      popupPage = false;
    }
    await chrome.tabs.update(tab.id, popupPage
      ? { active: true, url: APP_URL }
      : { active: true }).catch(() => null);
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
    return tab.id;
  }
  const tab = await globalThis.BjtuTabs.create({ url: APP_URL, active: true });
  return tab?.id || null;
}

function normalizeHomeworkReminderMinutes(value) {
  const source = Array.isArray(value) ? value : [120];
  return [...new Set(source.map(Number)
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600)
    .map((minutes) => Math.round(minutes)))]
    .sort((a, b) => a - b);
}

function homeworkReminderHash(value) {
  let hash = 2166136261;
  for (const ch of String(value || '')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function formatReminderDuration(minutes) {
  const value = Number(minutes || 0);
  if (value % 1440 === 0) return `${value / 1440} 天`;
  if (value % 60 === 0) return `${value / 60} 小时`;
  return `${value} 分钟`;
}

function formatReminderDeadline(timestamp) {
  const date = new Date(Number(timestamp || 0));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function checkHomeworkDeadlineReminders() {
  const data = await chrome.storage.local.get([
    'homeworkReminderEnabled',
    'homeworkReminderMinutes',
    'homeworkBackgroundRefreshEnabled',
    HOMEWORK_REMINDER_SNAPSHOT_KEY,
    HOMEWORK_REMINDER_NOTIFIED_KEY,
    HOMEWORK_REMINDER_OBSERVED_KEY
  ]);
  if (data.homeworkReminderEnabled === false) {
    const active = await chrome.notifications.getAll().catch(() => ({}));
    await Promise.all(Object.keys(active || {})
      .filter((id) => id.startsWith(HOMEWORK_REMINDER_NOTIFICATION_PREFIX))
      .map((id) => chrome.notifications.clear(id).catch(() => false)));
    const keys = [HOMEWORK_REMINDER_NOTIFIED_KEY, HOMEWORK_REMINDER_OBSERVED_KEY];
    if (data.homeworkBackgroundRefreshEnabled !== true) keys.push(HOMEWORK_REMINDER_SNAPSHOT_KEY);
    await chrome.storage.local.remove(keys).catch(() => {});
    return;
  }
  const nodes = normalizeHomeworkReminderMinutes(data.homeworkReminderMinutes);
  if (!nodes.length) {
    const keys = [HOMEWORK_REMINDER_NOTIFIED_KEY, HOMEWORK_REMINDER_OBSERVED_KEY];
    if (data.homeworkBackgroundRefreshEnabled !== true) keys.push(HOMEWORK_REMINDER_SNAPSHOT_KEY);
    await chrome.storage.local.remove(keys).catch(() => {});
    return;
  }
  const snapshot = data[HOMEWORK_REMINDER_SNAPSHOT_KEY];
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const account = String(snapshot?.account || 'default');
  const notified = data[HOMEWORK_REMINDER_NOTIFIED_KEY] && typeof data[HOMEWORK_REMINDER_NOTIFIED_KEY] === 'object'
    ? { ...data[HOMEWORK_REMINDER_NOTIFIED_KEY] }
    : {};
  const observed = data[HOMEWORK_REMINDER_OBSERVED_KEY] && typeof data[HOMEWORK_REMINDER_OBSERVED_KEY] === 'object'
    ? { ...data[HOMEWORK_REMINDER_OBSERVED_KEY] }
    : {};
  const now = Date.now();

  for (const item of items) {
    const deadline = Number(item?.deadline || 0);
    const remainingMinutes = (deadline - now) / 60000;
    if (!deadline || remainingMinutes <= 0) continue;
    const taskKey = `${account}|${String(item?.key || '')}`;
    const observedDeadline = Number(observed[taskKey]?.deadline || 0);
    const previousRemaining = observedDeadline === deadline
      ? Number(observed[taskKey]?.remainingMinutes)
      : NaN;
    nodes.forEach((minutes) => {
      const notifiedKey = `${taskKey}|${minutes}`;
      const recordedDeadline = Number(notified[notifiedKey]?.deadline || 0);
      if (recordedDeadline && recordedDeadline !== deadline) delete notified[notifiedKey];
    });
    const eligible = nodes.filter((minutes) => remainingMinutes <= minutes);
    observed[taskKey] = { remainingMinutes, deadline, lastSeenAt: now };
    if (!eligible.length) continue;
    const pendingNodes = eligible.filter((minutes) => !notified[`${taskKey}|${minutes}`]);
    if (!pendingNodes.length) continue;
    const selectedNode = pendingNodes[0];
    const crossedNormally = Number.isFinite(previousRemaining) && previousRemaining > selectedNode;
    eligible.forEach((minutes) => {
      notified[`${taskKey}|${minutes}`] = { notifiedAt: now, deadline };
    });
    const notificationId = `${HOMEWORK_REMINDER_NOTIFICATION_PREFIX}${homeworkReminderHash(`${taskKey}|${selectedNode}`)}`;
    await createBjtuSystemNotification(notificationId, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: `${String(item?.courseName || '未知课程')}作业将在 ${formatReminderDuration(selectedNode)}${crossedNormally ? '后' : '内'}截止`,
      message: `${String(item?.platform || '课程平台')} · ${String(item?.courseName || '未知课程')}\n${String(item?.title || '未交作业')} · ${formatReminderDeadline(deadline)}`,
      priority: 2
    }, 'homework-deadline');
  }

  const oldest = now - 60 * 24 * 60 * 60 * 1000;
  Object.keys(notified).forEach((key) => {
    const entry = notified[key] || {};
    const deadline = Number(entry.deadline || 0);
    if ((deadline > 0 && deadline <= now) || Number(entry.notifiedAt || 0) < oldest) delete notified[key];
  });
  Object.keys(observed).forEach((key) => {
    const entry = observed[key] || {};
    const deadline = Number(entry.deadline || 0);
    if ((deadline > 0 && deadline <= now) || Number(entry.lastSeenAt || 0) < oldest) delete observed[key];
  });
  const futureSnapshotItems = items.filter((item) => Number(item?.deadline || 0) > now);
  await chrome.storage.local.set({
    [HOMEWORK_REMINDER_NOTIFIED_KEY]: notified,
    [HOMEWORK_REMINDER_OBSERVED_KEY]: observed,
    [HOMEWORK_REMINDER_SNAPSHOT_KEY]: {
      ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
      items: futureSnapshotItems
    }
  });
}

function ensureHomeworkReminderAlarm() {
  chrome.alarms.create(HOMEWORK_REMINDER_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

let homeworkReminderCheckPromise = null;
function scheduleHomeworkReminderCheck() {
  if (homeworkReminderCheckPromise) return homeworkReminderCheckPromise;
  homeworkReminderCheckPromise = checkHomeworkDeadlineReminders()
    .catch((error) => console.warn('[bjtu] homework reminder check failed:', error))
    .finally(() => { homeworkReminderCheckPromise = null; });
  return homeworkReminderCheckPromise;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === HOMEWORK_REMINDER_ALARM) scheduleHomeworkReminderCheck();
  if (alarm?.name === EXTENSION_RELOAD_RESTORE_ALARM) void restoreAppAfterAutomaticExtensionReload();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureHomeworkReminderAlarm();
  scheduleHomeworkReminderCheck();
});

chrome.runtime.onStartup.addListener(() => {
  ensureHomeworkReminderAlarm();
  scheduleHomeworkReminderCheck();
});

ensureHomeworkReminderAlarm();
chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
  if (notifId !== VERSION_UPDATE_NOTIFICATION_ID) return;
  if (buttonIndex === 0) {
    globalThis.BjtuTabs.create({ url: 'about:extensions' }).catch(() => {});
    chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
  }
});

function normalizePortalLoginAccountHistory(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list
    .map((it) => {
      const storedLoginName = String(it?.loginName || it?.userId || '').trim();
      const loginName = storedLoginName.toLowerCase() === 'admin' ? 'JyDadmin' : storedLoginName;
      if (!loginName) return null;
      const lastLoginAt = Number(it?.lastLoginAt || 0);
      return {
        userId: loginName,
        loginName,
        lastLoginAt: Number.isFinite(lastLoginAt) ? lastLoginAt : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0))
    .filter((item, index, rows) => rows.findIndex((candidate) => (
      candidate.loginName.toLowerCase() === item.loginName.toLowerCase()
    )) === index);
}

function serializePortalLoginAccountHistory(rawList) {
  return normalizePortalLoginAccountHistory(rawList)
    .map((record) => ({
      loginName: String(record?.loginName || record?.userId || '').trim(),
      lastLoginAt: Number(record?.lastLoginAt || 0) || 0
    }))
    .filter((record) => record.loginName);
}

async function getPortalLoginAccountHistory() {
  try {
    const raw = await chrome.storage.local.get(LOGIN_ACCOUNT_HISTORY_KEY);
    return normalizePortalLoginAccountHistory(raw?.[LOGIN_ACCOUNT_HISTORY_KEY]);
  } catch {
    return [];
  }
}

async function getEnrichedPortalLoginAccountHistory() {
  const history = await getPortalLoginAccountHistory();
  return Promise.all(history.map(async (record) => {
    const account = await globalThis.BjtuAccountStore.get(record.loginName).catch(() => null);
    return {
      ...record,
      userName: String(account?.userName || '').trim(),
      roleName: String(account?.roleName || '').trim(),
      quickUsername: String(account?.quickUsername || '').trim()
    };
  }));
}

async function savePortalLoginAccountRecord(userId, patch = {}) {
  const loginName = String(patch?.loginName || userId || '').trim();
  if (!loginName) return null;
  const list = await getPortalLoginAccountHistory();
  const idx = list.findIndex((it) => String(it?.loginName || it?.userId || '').trim() === loginName);
  const record = {
    userId: loginName,
    loginName,
    lastLoginAt: Date.now()
  };
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(record);
  await chrome.storage.local.set({ [LOGIN_ACCOUNT_HISTORY_KEY]: serializePortalLoginAccountHistory(list) });
  return record;
}

// Manage action popup according to openMode ('popup' or 'page')
let currentOpenMode = '';
async function refreshActionPopupFromStorage() {
  try {
    const r = await chrome.storage.local.get('openMode');
    const mode = String(r.openMode || 'popup');
    currentOpenMode = mode;
    if (mode === 'page') {
      try { await chrome.action.setPopup({ popup: '' }); } catch (e) {}
    } else {
      try { await chrome.action.setPopup({ popup: 'popup/popup.html' }); } catch (e) {}
    }
  } catch (e) {
    // ignore
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.openMode) {
    refreshActionPopupFromStorage().catch(() => {});
  }
  if (changes.homeworkReminderSnapshot || changes.homeworkReminderEnabled || changes.homeworkReminderMinutes) {
    scheduleHomeworkReminderCheck();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  refreshActionPopupFromStorage().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshActionPopupFromStorage().catch(() => {});
});

refreshActionPopupFromStorage().catch(() => {});

async function activateMjModuleAndOpenOptions() {
  await chrome.storage.local.set({
    mjModuleActivated: true,
    mjAutoInstallPending: true
  });
  const mjOptionsUrl = chrome.runtime.getURL('modules/MJ/options.html');
  const allTabs = await chrome.tabs.query({}).catch(() => []);
  const existing = allTabs.find((tab) => String(tab?.url || tab?.pendingUrl || '').startsWith(mjOptionsUrl));
  if (existing) {
    await chrome.tabs.reload(existing.id).catch(() => null);
    await chrome.tabs.update(existing.id, { active: true }).catch(() => null);
    if (Number.isInteger(existing.windowId)) {
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => null);
    }
  } else {
    await chrome.windows.create({
      url: mjOptionsUrl,
      type: 'popup',
      focused: true,
      width: 720,
      height: 600
    });
  }
  const mainOptionsUrl = chrome.runtime.getURL('options/options.html');
  const mainOptionsTabs = allTabs.filter((tab) => String(tab?.url || tab?.pendingUrl || '').startsWith(mainOptionsUrl));
  await Promise.all(mainOptionsTabs.map((tab) => chrome.tabs.reload(tab.id).catch(() => null)));
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ACTIVATE_MJ_MODULE') {
    activateMjModuleAndOpenOptions()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'PORTAL_LOGIN_CONTEXT') {
    (async () => {
      const stored = await chrome.storage.local.get(['username']);
      const mergedHistory = await getEnrichedPortalLoginAccountHistory();
      sendResponse({
        ok: true,
        username: String(stored?.username || '').trim(),
        history: mergedHistory
      });
    })().catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'PORTAL_SEARCH_ACCOUNTS') {
    const showAll = message?.payload?.showAll === true;
    Promise.all([
      globalThis.BjtuAccountStore.search({
        loginName: message?.payload?.loginName,
        userName: message?.payload?.userName,
        limit: showAll ? 200000 : 100
      }),
      getEnrichedPortalLoginAccountHistory()
    ])
      .then(([searchResult, history]) => {
        const accounts = Array.isArray(searchResult?.accounts) ? searchResult.accounts : [];
        const historyById = new Map(history.map((record) => [
          String(record?.loginName || record?.userId || '').trim(),
          record
        ]));
        sendResponse({
          ok: true,
          hasMore: !!searchResult?.hasMore,
          accounts: accounts.map((account) => ({
            loginName: String(account?.loginName || '').trim(),
            userName: String(account?.userName || '').trim(),
            roleName: String(account?.roleName || '').trim(),
            quickUsername: String(
              account?.quickUsername
              || historyById.get(String(account?.loginName || '').trim())?.quickUsername
              || ''
            ).trim()
          }))
        });
      })
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error), accounts: [] }));
    return true;
  }

  if (message?.type === 'VE_LOGIN_GET_CAPTCHA') {
    globalThis.BjtuVeLoginService.getCaptchaDataUrl()
      .then((imageUrl) => sendResponse({ ok: true, imageUrl }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'CAPTCHA_RECOGNIZER_STATUS') {
    sendResponse({
      ok: true,
      ready: typeof globalThis.BjtuCaptchaRecognizer?.recognize === 'function'
    });
    return false;
  }
  if (message?.type === 'VE_LOGIN_RECOGNIZE_CAPTCHA') {
    globalThis.BjtuVeLoginService.recognizeCaptchaDataUrl(message?.payload?.imageUrl)
      .then((passcode) => sendResponse({ ok: true, passcode }))
      .catch((error) => sendResponse({
        ok: false,
        code: String(error?.code || ''),
        message: String(error?.message || error)
      }));
    return true;
  }
  if (message?.type === 'VE_LOGIN_REQUEST') {
    globalThis.BjtuVeLoginService.login(message?.payload)
      .then(async (result) => {
        await showPortalCredentialEventsToast(sender, result);
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, reason: 'network', message: String(error?.message || '登录失败') }));
    return true;
  }

  if (message?.type === 'VE_LOGIN_CHECK_STATUS') {
    (async () => {
      const loginName = String(message?.payload?.loginName || '').trim();
      const currentUser = await globalThis.BjtuVeLoginService.fetchCurrentUserInfo();
      sendResponse({
        ok: true,
        loggedIn: !!currentUser,
        alreadyLoggedIn: !!loginName && String(currentUser?.loginName || '').trim() === loginName,
        userInfo: currentUser || null
      });
    })().catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'VE_LOGIN_WITH_PASSWORD') {
    globalThis.BjtuVeLoginService.loginWithPassword(
      message?.payload?.loginName,
      message?.payload?.password,
      {
        passcode: message?.payload?.passcode,
        passwordPlain: message?.payload?.passwordPlain,
        recordHistory: message?.payload?.recordHistory !== false
      }
    )
      .then(async (result) => {
        await showPortalCredentialEventsToast(sender, result);
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, reason: 'network', message: String(error?.message || '登录失败') }));
    return true;
  }

  if (message?.type === 'VE_LOGIN_WITH_QUICK_USERNAME') {
    globalThis.BjtuVeLoginService.loginWithQuickUsername(message?.payload?.quickUsername, {
      loginName: message?.payload?.loginName,
      recordHistory: message?.payload?.recordHistory !== false
    })
      .then(async (result) => {
        await showPortalCredentialEventsToast(sender, result);
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, reason: 'network', message: String(error?.message || '登录失败') }));
    return true;
  }

  if (message?.type === 'OPEN_APP') {
    (async () => {
      try {
        const targetParams = new URLSearchParams();
        if (message?.payload?.accountInit) targetParams.set('accountInit', '1');
        if (message?.payload?.autoUpdate) targetParams.set('autoUpdate', message.payload.autoUpdate === 2 ? '2' : '1');
        const targetUrl = targetParams.size
          ? chrome.runtime.getURL(`app/app.html?${targetParams.toString()}`)
          : APP_URL;
        const stored = await chrome.storage.local.get(['preferExistingFullscreenPage']).catch(() => ({}));
        const preferExisting = message?.payload?.preferExistingForReturn === true
          || stored.preferExistingFullscreenPage !== false;
        const tabs = preferExisting
          ? (await chrome.tabs.query({})).filter((tab) => String(tab?.url || '').startsWith(APP_URL))
          : [];
        if (tabs.length) {
          const t = tabs[0];
          const shouldNavigate = targetParams.size > 0 && String(t.url || '') !== targetUrl;
          try {
            await chrome.tabs.update(t.id, shouldNavigate ? { active: true, url: targetUrl } : { active: true });
          } catch (e) {}
          try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
          sendResponse({ ok: true, reused: true, tabId: t.id });
          return;
        }
        const newTab = await globalThis.BjtuTabs.create({ url: targetUrl });
        sendResponse({ ok: true, reused: false, tabId: newTab?.id || null });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }

  if (message?.type === 'REFRESH_OPEN_APP_PAGES') {
    refreshOpenAppTabs()
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'SYNC_OPTIONAL_CONTENT_SCRIPTS') {
    syncOptionalContentScripts()
      .then((result) => sendResponse(result?.ok === false ? result : { ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'PREPARE_APP_RESTORE_AFTER_RELOAD') {
    prepareAppRestoreAfterExtensionReload(message?.payload, sender?.tab?.id)
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'RELOAD_EXTENSION_AND_OPEN_APP') {
    void reloadExtensionAndOpenApp(message?.payload, sender?.tab?.id)
      .catch((error) => console.warn('[bjtu] captcha reload handoff failed:', error));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'GET_LATEST_RESPONSE_JSESSIONID') {
    const maxAgeMs = Math.max(0, Number(message?.maxAgeMs || 15000));
    const rec = latestResponseJsessionid;
    const ok = !!(rec?.value && rec?.ts && (Date.now() - Number(rec.ts || 0)) <= maxAgeMs);
    sendResponse({ ok, record: ok ? rec : null });
    return false;
  }

  if (message?.type === 'START_BIND_PORTAL_USERNAME') {
    const requestedLoginName = String(message?.payload?.loginName || '').trim();
    globalThis.BjtuTabs.create({ url: 'http://123.121.147.7:88/oauth/api/user/thirdLogin', active: true }).then(async (tab) => {
      const tabId = tab?.id || null;
      if (tabId) {
        const stored = requestedLoginName ? null : await chrome.storage.local.get(['username']);
        const loginName = requestedLoginName || String(stored?.username || '').trim();
        portalUsernameBindByTab.set(tabId, { ts: Date.now(), loginName });
        notifyPortalUsernameBindStatus({ status: 'started', tabId, ts: Date.now() });
      }
      sendResponse({ ok: true, tabId });
    }).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  portalUsernameBindByTab.delete(tabId);
  portalDetectedQuickUsernameByTab.delete(tabId);
  portalQuickUsernameToastByTab.delete(tabId);
  portalDetectedPasswordLoginByTab.delete(tabId);
  portalPasswordRecordingTabs.delete(tabId);
  portalQuickUsernameFinalizing.delete(tabId);
});

function isPortalLoginResponseSuccess(source, activeSuccessScript = false) {
  const html = String(source || '');
  const executableHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  return activeSuccessScript === true
    || /location\.href\s*=\s*['"]http:\/\/123\.121\.147\.7:88\/ve\/back\/core\/main\/index\.shtml\?method=index&type=qxkt['"]/i.test(executableHtml);
}

function getPortalRequestBodyValue(requestBody, name) {
  const key = String(name || '');
  const formValue = requestBody?.formData?.[key];
  if (Array.isArray(formValue)) return String(formValue[0] || '').trim();
  if (formValue !== undefined && formValue !== null) return String(formValue).trim();
  return '';
}

function decodePortalRequestBody(raw) {
  try {
    const chunks = (Array.isArray(raw) ? raw : []).map((part) => {
      const bytes = part?.bytes;
      if (!bytes) return new Uint8Array();
      return bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
    });
    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    if (!size) return '';
    const array = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => {
      array.set(chunk, offset);
      offset += chunk.byteLength;
    });
    const utf8 = new TextDecoder('utf-8').decode(array);
    if (!utf8.includes('\uFFFD')) return utf8;
    return new TextDecoder('gbk').decode(array);
  } catch {
    return '';
  }
}

function decodePortalLoginName(value) {
  const raw = String(value || '').trim();
  if (!/^[0-9a-f]+$/i.test(raw) || raw.length % 16 !== 0) return raw;
  try {
    const decoded = typeof globalThis.strDec === 'function'
      ? String(globalThis.strDec(raw) || '').trim()
      : '';
    return decoded && decoded.length <= 128 && /^[\p{L}\p{N}_.@-]+$/u.test(decoded) ? decoded : raw;
  } catch {
    return raw;
  }
}

function extractPortalPostLogin(details) {
  if (String(details?.method || '').toUpperCase() !== 'POST') return null;
  let url;
  try {
    url = new URL(String(details?.url || ''));
  } catch {
    return null;
  }
  if (!/123\.121\.147\.7:88$/i.test(url.host) || !/^\/ve\/s\.shtml$/i.test(url.pathname)) return null;

  let body = details?.requestBody;
  let loginName = getPortalRequestBodyValue(body, 'username');
  let encryptedPassword = getPortalRequestBodyValue(body, 'password');
  if (!loginName || !encryptedPassword) {
    const rawText = decodePortalRequestBody(body?.raw);
    if (rawText) {
      try {
        const params = new URLSearchParams(rawText);
        loginName = loginName || String(params.get('username') || '').trim();
        encryptedPassword = encryptedPassword || String(params.get('password') || '').trim();
      } catch {
        // Ignore non-form request bodies.
      }
    }
  }
  if (!loginName || !encryptedPassword) return null;
  return { loginName: decodePortalLoginName(loginName), encryptedPassword, method: 'POST', ts: Date.now() };
}

function extractPortalQuickUsername(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/123\.121\.147\.7:88$/i.test(u.host)) return '';
    if (!/\/ve\/s\.shtml$/i.test(u.pathname)) return '';
    if (u.searchParams.get('loginType') !== '2') return '';
    if (u.searchParams.get('login') !== 'main_2') return '';
    return String(u.searchParams.get('username') || '').trim();
  } catch {
    return '';
  }
}

function extractPortalPasswordLogin(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/123\.121\.147\.7:88$/i.test(u.host)) return null;
    if (!/\/ve\/s\.shtml$/i.test(u.pathname)) return null;
    if (u.searchParams.get('login') !== 'main_2' || u.searchParams.get('loginType') === '2') return null;
    const loginName = decodePortalLoginName(u.searchParams.get('username'));
    const encryptedPassword = String(u.searchParams.get('password') || '').trim();
    if (!loginName || !encryptedPassword) return null;
    return { loginName, encryptedPassword, ts: Date.now() };
  } catch {
    return null;
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const tabId = Number(details?.tabId);
    if (!(tabId >= 0)) return;
    const method = String(details?.method || '').toUpperCase();
    const postLogin = extractPortalPostLogin(details);
    if (postLogin) {
      portalDetectedPasswordLoginByTab.set(tabId, { ...postLogin, requestId: String(details?.requestId || '') });
      console.info('[bjtu] captured VE POST login request', { tabId, type: details?.type });
      return;
    }
    const passwordLogin = method === 'GET' ? extractPortalPasswordLogin(details?.url) : null;
    if (passwordLogin) {
      portalDetectedPasswordLoginByTab.set(tabId, { ...passwordLogin, requestId: String(details?.requestId || '') });
      console.info('[bjtu] captured VE GET password login request', { tabId, type: details?.type });
    }
    const quickUsername = extractPortalQuickUsername(details?.url);
    if (!quickUsername) return;
    portalDetectedQuickUsernameByTab.set(tabId, {
      quickUsername,
      requestId: String(details?.requestId || ''),
      ts: Date.now()
    });
    console.info('[bjtu] captured VE GET quick login request', { tabId, type: details?.type });
    const bindState = portalUsernameBindByTab.get(tabId);
    if (!bindState) return;
    portalUsernameBindByTab.set(tabId, { ...bindState, quickUsername, ts: Date.now() });
    notifyPortalUsernameBindStatus({ status: 'detected', tabId, quickUsername, ts: Date.now() });
  },
{
    urls: ['http://123.121.147.7:88/ve/s.shtml*']
  },
  ['requestBody']
);

// Fallback: the in-page response detector may occasionally miss a login navigation
// (the tab can be mid-redirect, scripts paused, etc.), which previously left the bind
// stuck at "已检测到新 username" and never closed the page. webRequest.onCompleted
// runs for the same GET quick-login request regardless of page script timing, so we
// finalize the binding directly using the username captured from the URL.
//
// webRequest cannot read the response body, so instead of trusting the response
// blindly we confirm the login actually succeeded by waiting for the tab to reach
// the authenticated platform page. The failure page (e.g. GBK encoded
// alert('账号或密码错误!') based script redirecting to /ve) never navigates to an
// authenticated page, so a failed quick login is never recorded.
chrome.webRequest.onCompleted.addListener(
  (details) => {
    try {
      const tabId = Number(details?.tabId);
      if (!(tabId >= 0)) return;
      if (String(details?.method || 'GET').toUpperCase() !== 'GET') return;
      const quickUsername = extractPortalQuickUsername(details?.url);
      if (!quickUsername) return;
      const quickState = portalDetectedQuickUsernameByTab.get(tabId) || null;
      if (!quickState) return;
      if (String(quickState.quickUsername || '').trim() !== quickUsername) return;
      if (Date.now() - Number(quickState.ts || 0) > 30000) return;
      // A 500 GET login response means the quick login failed (e.g. invalid /
      // stale quick username). Never record it — otherwise the fallback would
      // bind a dead username and bind the wrong account.
      if (Number(quickState.statusCode || 0) === 500) return;
      portalDetectedQuickUsernameByTab.delete(tabId);
      void waitForPortalLoginLandingPage(tabId)
        .then((outcome) => {
          if (outcome === 'authenticated') {
            return finalizePortalQuickUsernameBind(tabId, quickUsername);
          }
          console.warn('[bjtu] skipped VE quickUsername fallback recording because the login did not succeed', { tabId, outcome });
          // Do not leave a bind in the "已检测到新 username，正在匹配账号信息" state
          // forever: report the failure so the options page re-enables the bind button.
          if (portalUsernameBindByTab.has(tabId)) {
            notifyPortalUsernameBindStatus({
              status: 'error',
              tabId,
              quickUsername: String(quickUsername || '').trim(),
              error: '绑定失败：登录未成功，请重新尝试',
              ts: Date.now()
            });
          }
          return undefined;
        })
        .catch(() => {});
    } catch {
      // ignore
    }
  },
  { urls: ['http://123.121.147.7:88/ve/s.shtml*'] },
  []
);

async function waitForPortalLoginLandingPage(tabId, timeoutMs = 4000) {
  const startAt = Date.now();
  while (Date.now() - startAt < Number(timeoutMs || 0)) {
    let url = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      url = String(tab?.url || '');
    } catch {
      return 'unknown';
    }
    if (isPortalAuthenticatedPageUrl(url)) return 'authenticated';
    if (isPortalLoginFailurePageUrl(url)) return 'failed';
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return 'unknown';
}

async function getPortalCurrentUserInfoFromTab(tabId, expectedLoginName = '') {
  if (!(Number(tabId) >= 0)) return null;
  const expected = String(expectedLoginName || '').trim();
  const matchesExpected = (userInfo) => {
    const loginName = String(userInfo?.loginName || '').trim();
    return !!loginName && (!expected || loginName === expected);
  };

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const directUser = await globalThis.BjtuVeLoginService.fetchCurrentUserInfo().catch(() => null);
    if (matchesExpected(directUser)) {
      console.info('[bjtu] resolved VE current user', { tabId, source: 'background', attempt: attempt + 1 });
      return directUser;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async () => {
        try {
          const res = await fetch('/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo', {
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
          });
          if (!res.ok) return null;
          const buffer = await res.arrayBuffer();
          const utf8 = new TextDecoder('utf-8').decode(buffer);
          const source = String(utf8.includes('\uFFFD') ? new TextDecoder('gbk').decode(buffer) : utf8).trim();
          const data = JSON.parse(source.startsWith('{}') && source.length > 2 ? source.slice(2) : source);
          return String(data?.STATUS) === '0' && data?.result?.loginName ? data.result : null;
        } catch {
          return null;
        }
      }
    }).catch(() => []);
    const tabUser = Array.isArray(results) && results[0] ? results[0].result || null : null;
    if (matchesExpected(tabUser)) {
      console.info('[bjtu] resolved VE current user', { tabId, source: 'tab', attempt: attempt + 1 });
      return tabUser;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.warn('[bjtu] unable to resolve VE current user after successful login response', {
    tabId,
    expectedAccount: !!expected
  });
  return null;
}

async function fetchBoundPortalAccountInfo(tabId, quickUsername) {
  const quick = String(quickUsername || '').trim();
  if (!quick) return null;
  await globalThis.BjtuAccountStore.migrateLegacy();
  // Do NOT gate on the previously-selected login name: the quick-login GET
  // belongs to whatever account the MIS session actually logged in as. Resolving
  // the CURRENT user once is enough and avoids retrying getUserInfo in a loop
  // (which previously left the bind page open forever when the accounts differed).
  const currentUser = await getPortalCurrentUserInfoFromTab(tabId);
  const loginName = String(currentUser?.loginName || '').trim();
  if (!loginName) return null;

  const stored = await chrome.storage.local.get([LOGIN_ACCOUNT_HISTORY_KEY]);
  const history = normalizePortalLoginAccountHistory(stored?.[LOGIN_ACCOUNT_HISTORY_KEY]);
  const prev = history.find((item) => item.userId === loginName || item.loginName === loginName) || null;
  const account = await globalThis.BjtuAccountStore.get(loginName) || prev || {
    loginName,
    userName: String(currentUser?.userName || '').trim(),
    roleName: String(currentUser?.roleName || '').trim(),
    password: '',
    passwordMd5: ''
  };
  const previousQuickUsername = String(account.quickUsername || prev?.quickUsername || '').trim();
  await globalThis.BjtuAccountStore.put({
    loginName,
    roleName: String(currentUser?.roleName || account.roleName || '').trim(),
    userName: String(currentUser?.userName || account.userName || '').trim(),
    password: String(account.password || ''),
    passwordMd5: String(account.passwordMd5 || '').trim(),
    quickUsername: quick
  });

  const record = await savePortalLoginAccountRecord(loginName, {
    loginName,
    userName: String(currentUser?.userName || account.userName || '').trim(),
    roleName: String(currentUser?.roleName || account.roleName || '').trim(),
    passwordMd5: String(account.passwordMd5 || '').trim(),
    quickUsername: quick
  });
  return record ? {
    ...record,
    quickUsernameChanged: previousQuickUsername !== quick
  } : null;
}

function credentialEventsToastMessage(result) {
  const types = new Set((Array.isArray(result?.credentialEvents) ? result.credentialEvents : [])
    .map((event) => String(event?.type || '')));
  if (types.has('quickUsername-cleared') && types.has('password-cleared')) {
    return '极速登录凭据和保存的密码均已失效，已从本地账号中清除';
  }
  if (types.has('quickUsername-cleared')) return '极速登录凭据已失效，已清除该账号的 quickUsername';
  if (types.has('password-cleared')) return '保存的密码已失效，已清除该账号的 password';
  return '';
}

async function showPortalCredentialEventsToast(sender, result) {
  const message = credentialEventsToastMessage(result);
  const tabId = Number(sender?.tab?.id);
  if (!message || !(tabId >= 0) || !/^http:\/\/123\.121\.147\.7:88\/ve(?:\/|$)/i.test(String(sender?.tab?.url || ''))) return;
  await showPortalPageToast(tabId, message, 'warning');
}

async function showPortalPageToast(tabId, message, tone = 'success') {
  const toneClass = tone === 'warning' ? 'warning' : tone === 'error' ? 'error' : 'success';
  if (toneClass === 'success') {
    // Wait for the login navigation to settle on the authenticated platform page
    // (coursePlatform.shtml / index.shtml), so the toast is not lost mid-redirect.
    const startAt = Date.now();
    while (Date.now() - startAt < 4000) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (isPortalAuthenticatedPageUrl(tab?.url)) break;
        if (isPortalLoginFailurePageUrl(tab?.url)) break;
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  try {
    await globalThis.BjtuPageToast?.show(tabId, message, toneClass);
  } catch {
    // The tab may be mid-navigation; ignore.
  }
}

async function showPortalQuickUsernameBoundToast(tabId) {
  return showPortalPageToast(tabId, '已为您成功绑定智慧课程平台快速登录');
}

async function finalizePortalQuickUsernameBind(tabId, quickUsername) {
  if (portalQuickUsernameFinalizing.has(tabId)) return;
  portalQuickUsernameFinalizing.add(tabId);
  try {
    const bindState = portalUsernameBindByTab.get(tabId) || null;
    const record = await fetchBoundPortalAccountInfo(tabId, quickUsername);
    if (record) console.info('[bjtu] stored VE quickUsername in IndexedDB', { tabId });
    else console.warn('[bjtu] skipped VE quickUsername recording because current user was unavailable', { tabId });
    notifyPortalUsernameBindStatus({
      status: record ? 'done' : 'detected',
      tabId,
      quickUsername,
      userId: String(record?.userId || '').trim(),
      ts: Date.now()
    });
    if (record && bindState) {
      portalUsernameBindByTab.delete(tabId);
      portalQuickUsernameToastByTab.set(tabId, quickUsername);
      await showPortalQuickUsernameBoundToast(tabId);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try { await chrome.tabs.remove(tabId); } catch {}
      return;
    }
    if (record) {
      portalQuickUsernameToastByTab.set(tabId, quickUsername);
      await showPortalQuickUsernameBoundToast(tabId);
    }
  } catch (error) {
    console.warn('[bjtu] failed to store VE quickUsername in IndexedDB', {
      tabId,
      error: String(error?.message || error)
    });
    notifyPortalUsernameBindStatus({
      status: 'error',
      tabId,
      quickUsername,
      error: String(error?.message || error),
      ts: Date.now()
    });
  } finally {
    portalQuickUsernameFinalizing.delete(tabId);
  }
}

function isPortalAuthenticatedPageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /123\.121\.147\.7:88$/i.test(url.host) && /^\/ve\/back\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function isPortalLoginFailurePageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/123\.121\.147\.7:88$/i.test(url.host)) return false;
    return /^\/ve\/?$/i.test(url.pathname)
      || /^\/ve\/(?:Login_2|Timeout)\.jsp$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function recordPortalPasswordLogin(tabId, state) {
  const requestedLoginName = String(state?.loginName || '').trim();
  const currentUser = await getPortalCurrentUserInfoFromTab(tabId, requestedLoginName);
  const loginName = String(currentUser?.loginName || '').trim();
  if (!loginName || loginName !== requestedLoginName) {
    console.warn('[bjtu] skipped VE password recording because current account did not match', {
      tabId,
      hasCurrentUser: !!loginName
    });
    return false;
  }
  await globalThis.BjtuAccountStore.migrateLegacy();
  const current = await globalThis.BjtuAccountStore.get(loginName);
  const encryptedPassword = String(state?.encryptedPassword || '').trim();
  const password = typeof globalThis.strDec === 'function'
    ? globalThis.strDec(encryptedPassword)
    : '';
  const reasonablePassword = !!password && password.length <= 256 && (
    /^[\x20-\x7e]+$/.test(password)
    || (/[\x21-\x7e]/.test(password) && /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u.test(password))
  );
  if (!reasonablePassword) {
    console.warn('[bjtu] skipped VE password recording because payload decryption failed', {
      tabId,
      encryptedLength: encryptedPassword.length
    });
    return false;
  }
  await globalThis.BjtuAccountStore.put({
    loginName,
    userName: String(currentUser?.userName || current?.userName || '').trim(),
    roleName: String(currentUser?.roleName || current?.roleName || '').trim(),
    password,
    passwordMd5: String(current?.passwordMd5 || '').trim(),
    quickUsername: String(current?.quickUsername || '').trim()
  });
  await savePortalLoginAccountRecord(loginName);
  await chrome.storage.local.set({ accountListRevision: Date.now() });
  console.info('[bjtu] stored VE password in IndexedDB', { tabId });
  await showPortalPageToast(tabId, '已记录该智慧课程平台账号密码');
  return true;
}

async function processPortalLoginResponse(tabId, responsePayload) {
  const responseHtml = typeof responsePayload === 'string'
    ? responsePayload
    : String(responsePayload?.html || '');
  const activeSuccessScript = responsePayload?.activeSuccessScript === true;
  const quickState = portalDetectedQuickUsernameByTab.get(tabId) || null;
  const passwordState = portalDetectedPasswordLoginByTab.get(tabId) || null;
  const quickUsername = quickState && Date.now() - Number(quickState.ts || 0) <= 30000
    ? String(quickState.quickUsername || '').trim()
    : '';
  const passwordLogin = passwordState && Date.now() - Number(passwordState.ts || 0) <= 30000
    ? passwordState
    : null;
  if (quickState && Date.now() - Number(quickState.ts || 0) > 30000) {
    portalDetectedQuickUsernameByTab.delete(tabId);
  }
  if (passwordState && !passwordLogin) portalDetectedPasswordLoginByTab.delete(tabId);
  if (!quickUsername && !passwordLogin) return;

  const loginResponseSuccess = isPortalLoginResponseSuccess(responseHtml, activeSuccessScript);
  console.info('[bjtu] observed VE login response', {
    tabId,
    loginKind: quickUsername ? 'quick' : 'password',
    success: loginResponseSuccess
  });

  // A successful getUserInfo call is not enough: an old session can make it
  // succeed after the actual login response reported a credential error.
if (!loginResponseSuccess) {
    const events = [];
    const source = String(responseHtml || '');
    if (quickUsername && (Number(quickState?.statusCode || 0) === 500
        || /账号或密码错误/i.test(source))) {
      // A quick login that fails (server error or credential error) means the
      // stored quickUsername is dead — drop it so the extension does not keep
      // trying it (and falls back to the password login).
      const preferredLoginName = String(portalUsernameBindByTab.get(tabId)?.loginName || '').trim();
      const account = preferredLoginName
        ? await globalThis.BjtuAccountStore.get(preferredLoginName)
        : await globalThis.BjtuAccountStore.getByQuickUsername(quickUsername);
      if (account && String(account.quickUsername || '').trim() === quickUsername) {
        await globalThis.BjtuAccountStore.clearCredentials(account.loginName, ['quickUsername']);
        events.push({ type: 'quickUsername-cleared', loginName: account.loginName });
      }
    }
    if (passwordLogin && /账号或密码错误/i.test(source)) {
      const account = await globalThis.BjtuAccountStore.get(passwordLogin.loginName);
      if (String(account?.password || '')) {
        await globalThis.BjtuAccountStore.clearCredentials(passwordLogin.loginName, ['password']);
        events.push({ type: 'password-cleared', loginName: passwordLogin.loginName });
      }
    }
    if (events.length) {
      await chrome.storage.local.set({ accountListRevision: Date.now() });
      await showPortalPageToast(tabId, credentialEventsToastMessage({ credentialEvents: events }), 'warning');
    }
    // Do not leave a bind in the "已检测到新 username，正在匹配账号信息" state forever:
    // report the failure so the options page re-enables the bind button.
    if (portalUsernameBindByTab.has(tabId) && quickUsername) {
      notifyPortalUsernameBindStatus({
        status: 'error',
        tabId,
        quickUsername: String(quickUsername || '').trim(),
        error: '绑定失败：登录未成功，请重新尝试',
        ts: Date.now()
      });
    }
    portalDetectedQuickUsernameByTab.delete(tabId);
    portalDetectedPasswordLoginByTab.delete(tabId);
    return;
  }

portalDetectedQuickUsernameByTab.delete(tabId);
  portalDetectedPasswordLoginByTab.delete(tabId);

  if (quickUsername) {
    await finalizePortalQuickUsernameBind(tabId, quickUsername);
  }

  if (passwordLogin && !portalPasswordRecordingTabs.has(tabId)) {
    portalPasswordRecordingTabs.add(tabId);
    try {
      const recorded = await recordPortalPasswordLogin(tabId, passwordLogin);
      if (!recorded) console.warn('[bjtu] VE password login succeeded but password was not recorded', { tabId });
    } catch (error) {
      console.warn('[bjtu] failed to store VE password in IndexedDB', {
        tabId,
        error: String(error?.message || error)
      });
      // The portal login itself has already succeeded; local recording is best effort.
    } finally {
      portalPasswordRecordingTabs.delete(tabId);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'PORTAL_LOGIN_RESPONSE') return undefined;
  const tabId = Number(sender?.tab?.id);
  if (!(tabId >= 0)) return false;
  processPortalLoginResponse(tabId, message?.payload).catch(() => {});
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port?.name !== 'bjtu-ve-login-response') return;
  const tabId = Number(port?.sender?.tab?.id);
  if (!(tabId >= 0)) return;
  port.onMessage.addListener((payload) => {
    processPortalLoginResponse(tabId, payload).catch(() => {});
  });
});

chrome.action.onClicked.addListener(async () => {
  try {
    const mode = currentOpenMode || (await chrome.storage.local.get('openMode')).openMode || 'popup';
    if (mode === 'page') {
      const stored = await chrome.storage.local.get(['preferExistingFullscreenPage']).catch(() => ({}));
      const preferExisting = stored.preferExistingFullscreenPage !== false;
      if (preferExisting) try {
        const tabs = (await chrome.tabs.query({})).filter((tab) => String(tab?.url || '').startsWith(APP_URL));
        if (Array.isArray(tabs) && tabs.length) {
          const t = tabs[0];
          try { await chrome.tabs.update(t.id, { active: true }); } catch (e) {}
          try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
          return;
        }
      } catch (e) {}
      globalThis.BjtuTabs.create({ url: APP_URL }).catch(() => {});
      return;
    }
    // In popup mode if popup is unset, fall back to opening the app page
    try {
      if (chrome.action.getPopup) {
        const popup = await chrome.action.getPopup({});
        if (!popup) {
          globalThis.BjtuTabs.create({ url: APP_URL }).catch(() => {});
        }
      }
    } catch (e) {
      // ignore
    }
  } catch (e) {
    try { globalThis.BjtuTabs.create({ url: APP_URL }).catch(() => {}); } catch (e2) {}
  }
});

function extractJsessionidFromSetCookie(value) {
  const raw = String(value || '');
  if (!raw) return '';
  const m = raw.match(/(?:^|[,\s])JSESSIONID=([^;,\s]+)/i);
  return (m?.[1] || '').trim();
}

function isLoginResponse(details) {
  const url = String(details?.url || '');
  const method = String(details?.method || '').toUpperCase();
  return (method === 'GET' || method === 'POST') && /\/ve\/s\.shtml(?:[?#]|$)/i.test(url);
}

function extractJsessionidFromCookieHeader(value) {
  const raw = String(value || '');
  if (!raw) return '';
  const m = raw.match(/(?:^|;\s*)JSESSIONID=([^;\s]+)/i);
  return (m?.[1] || '').trim();
}

function findHeaderValue(headers, name) {
  const target = String(name || '').toLowerCase();
  const h = (headers || []).find((it) => String(it?.name || '').toLowerCase() === target);
  return String(h?.value || '').trim();
}

chrome.webRequest.onHeadersReceived.addListener(
  async (details) => {
    try {
      // Only track Set-Cookie from login response.
      // Other endpoints may rotate JSESSIONID and pollute our login session selection.
      if (!isLoginResponse(details)) return;

      const tabId = Number(details?.tabId);
      const requestId = String(details?.requestId || '');
      if (tabId >= 0 && requestId) {
        const quickState = portalDetectedQuickUsernameByTab.get(tabId);
        if (quickState?.requestId === requestId) {
          portalDetectedQuickUsernameByTab.set(tabId, { ...quickState, statusCode: Number(details?.statusCode || 0) });
        }
        const passwordState = portalDetectedPasswordLoginByTab.get(tabId);
        if (passwordState?.requestId === requestId) {
          portalDetectedPasswordLoginByTab.set(tabId, { ...passwordState, statusCode: Number(details?.statusCode || 0) });
        }
      }

      const headers = details?.responseHeaders || [];
      let found = '';
      for (const h of headers) {
        if (!h || !h.name) continue;
        if (String(h.name).toLowerCase() !== 'set-cookie') continue;
        const v = h.value || (h.binaryValue ? String.fromCharCode(...h.binaryValue) : '');
        const jsid = extractJsessionidFromSetCookie(v);
        if (jsid) {
          found = jsid;
          // Keep the first JSESSIONID from login response.
          // Server may return multiple JSESSIONID values; the first one is the one
          // sent with higher priority in subsequent Cookie header ordering.
          break;
        }
      }
      if (!found) return;
      latestResponseJsessionid = {
        value: found,
        ts: Date.now(),
        url: details?.url || ''
      };
    } catch {
      // ignore
    }
  },
  { urls: ['http://123.121.147.7:88/*'] },
  ['responseHeaders', 'extraHeaders']
);
