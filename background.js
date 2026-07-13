importScripts('modules/ve/vendor/main.min.js');
importScripts('modules/ve/login-utils.js');
importScripts('modules/ve/account-store.js');
importScripts('modules/ve/homework-core.js');

function tryImportModuleScripts(...paths) {
  try {
    importScripts(...paths);
    return true;
  } catch (error) {
    console.info('[bjtu] optional module unavailable:', paths[0], String(error?.message || error));
    return false;
  }
}

tryImportModuleScripts('modules/captcha/recognizer.js');
importScripts('modules/ve/login-service.js');
tryImportModuleScripts('modules/academic/system.js');
tryImportModuleScripts('modules/campusnet/background.js');
tryImportModuleScripts('modules/updater/filesystem.js', 'modules/updater/background.js');
tryImportModuleScripts('modules/jlgj/background.js');
tryImportModuleScripts('modules/mooc/background.js');
importScripts('modules/ve/background-homework.js');

const OPTIONAL_CONTENT_SCRIPTS = [
  { id: 'bjtu-mooc-inject', module: 'mooc', matches: ['https://www.icourse163.org/*'], js: ['modules/mooc/inject.js'], runAt: 'document_idle' },
  { id: 'bjtu-jlgj-theme', module: 'jlgj', matches: ['https://i.jielong.com/*'], js: ['modules/jlgj/theme.js'], runAt: 'document_start' },
  { id: 'bjtu-jlgj-capture', module: 'jlgj', matches: ['https://i.jielong.com/*'], js: ['modules/jlgj/capture.js'], runAt: 'document_start', world: 'MAIN' }
];

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
  for (const script of OPTIONAL_CONTENT_SCRIPTS) {
    if (await extensionFileExists(`modules/${script.module}/module.json`)
        && await extensionFileExists(script.js[0])) wanted.push(script);
  }
  const managed = OPTIONAL_CONTENT_SCRIPTS.map((script) => script.id);
  await chrome.scripting.unregisterContentScripts({ ids: managed }).catch(() => {});
  const registrations = wanted.map(({ module: _module, ...script }) => script);
  if (registrations.length) await chrome.scripting.registerContentScripts(registrations).catch((error) => {
    console.warn('[bjtu] optional content script registration failed:', error);
  });
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

const APP_URL = chrome.runtime.getURL('app.html');
const VERSION_AUTO_RELOAD_HANDOFF_KEY = 'versionAutoReloadHandoff';
const VERSION_AUTO_RELOAD_COMPLETED_KEY = 'versionAutoReloadCompleted';

async function restoreAppAfterAutomaticExtensionReload() {
  const stored = await chrome.storage.local.get([VERSION_AUTO_RELOAD_HANDOFF_KEY]).catch(() => ({}));
  const handoff = stored?.[VERSION_AUTO_RELOAD_HANDOFF_KEY];
  if (!handoff) return;
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
    await chrome.notifications.create(completionNotificationId, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'BJTU 课程助手已后台更新',
      message: `已更新到 ${String(handoff.name || handoff.ver || '新版本')} 并自动重新加载扩展。`,
      priority: 1
    }).catch(() => {});
  }
  if (handoff.reopenApp === false) return;
  const tabs = (await chrome.tabs.query({}).catch(() => []))
    .filter((tab) => String(tab?.url || '').startsWith(APP_URL));
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: APP_URL, active: true }).catch(() => null);
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
    return;
  }
  await chrome.tabs.create({ url: APP_URL, active: true }).catch(() => null);
}

void restoreAppAfterAutomaticExtensionReload();

const portalUsernameBindByTab = new Map(); // tabId -> { ts, loginName }
const portalDetectedQuickUsernameByTab = new Map(); // tabId -> quickUsername seen during ordinary MIS redirects
const portalQuickUsernameToastByTab = new Map(); // tabId -> quickUsername already toasted
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
  if (notificationId.startsWith(HOMEWORK_REMINDER_NOTIFICATION_PREFIX)
    || notificationId.startsWith(BACKGROUND_UPDATE_NOTIFICATION_PREFIX)) {
    focusExistingAppTabOrOpen().catch(() => {});
    chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    return;
  }
  if (notifId !== VERSION_UPDATE_NOTIFICATION_ID) return;
  chrome.tabs.create({ url: 'about:extensions' });
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
  const tab = await chrome.tabs.create({ url: APP_URL, active: true });
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
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: `${String(item?.courseName || '未知课程')}作业将在 ${formatReminderDuration(selectedNode)}${crossedNormally ? '后' : '内'}截止`,
      message: `${String(item?.platform || '课程平台')} · ${String(item?.courseName || '未知课程')}\n${String(item?.title || '未交作业')} · ${formatReminderDeadline(deadline)}`,
      priority: 2
    });
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
    .catch(() => {})
    .finally(() => { homeworkReminderCheckPromise = null; });
  return homeworkReminderCheckPromise;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === HOMEWORK_REMINDER_ALARM) scheduleHomeworkReminderCheck();
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
    chrome.tabs.create({ url: 'about:extensions' });
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
      passwordMd5: String(account?.password || '').trim(),
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
      try { await chrome.action.setPopup({ popup: 'popup.html' }); } catch (e) {}
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
            ...account,
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
  if (message?.type === 'VE_LOGIN_RECOGNIZE_CAPTCHA') {
    globalThis.BjtuVeLoginService.recognizeCaptchaDataUrl(message?.payload?.imageUrl)
      .then((passcode) => sendResponse({ ok: true, passcode }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'VE_LOGIN_REQUEST') {
    globalThis.BjtuVeLoginService.login(message?.payload)
      .then((result) => sendResponse(result))
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
      { passcode: message?.payload?.passcode, recordHistory: message?.payload?.recordHistory !== false }
    )
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, reason: 'network', message: String(error?.message || '登录失败') }));
    return true;
  }

  if (message?.type === 'VE_LOGIN_WITH_QUICK_USERNAME') {
    globalThis.BjtuVeLoginService.loginWithQuickUsername(message?.payload?.quickUsername, {
      loginName: message?.payload?.loginName,
      recordHistory: message?.payload?.recordHistory !== false
    })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, reason: 'network', message: String(error?.message || '登录失败') }));
    return true;
  }

  if (message?.type === 'OPEN_APP') {
    (async () => {
      try {
        const targetParams = new URLSearchParams();
        if (message?.payload?.accountInit) targetParams.set('accountInit', '1');
        if (message?.payload?.autoUpdate) targetParams.set('autoUpdate', '1');
        const targetUrl = targetParams.size
          ? chrome.runtime.getURL(`app.html?${targetParams.toString()}`)
          : APP_URL;
        const tabs = (await chrome.tabs.query({})).filter((tab) => String(tab?.url || '').startsWith(APP_URL));
        if (Array.isArray(tabs) && tabs.length) {
          const t = tabs[0];
          const shouldNavigate = targetParams.size > 0 && String(t.url || '') !== targetUrl;
          try {
            await chrome.tabs.update(t.id, shouldNavigate ? { active: true, url: targetUrl } : { active: true });
          } catch (e) {}
          try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
          sendResponse({ ok: true, reused: true, tabId: t.id });
          return;
        }
        const newTab = await chrome.tabs.create({ url: targetUrl });
        sendResponse({ ok: true, reused: false, tabId: newTab?.id || null });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
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
    chrome.tabs.create({ url: 'http://123.121.147.7:88/oauth/api/user/thirdLogin', active: true }, async (tab) => {
      const err = chrome.runtime.lastError;
      if (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
        return;
      }
      const tabId = tab?.id || null;
      if (tabId) {
        const stored = requestedLoginName ? null : await chrome.storage.local.get(['username']);
        const loginName = requestedLoginName || String(stored?.username || '').trim();
        portalUsernameBindByTab.set(tabId, { ts: Date.now(), loginName });
        notifyPortalUsernameBindStatus({ status: 'started', tabId, ts: Date.now() });
      }
      sendResponse({ ok: true, tabId });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  portalUsernameBindByTab.delete(tabId);
  portalDetectedQuickUsernameByTab.delete(tabId);
  portalQuickUsernameToastByTab.delete(tabId);
});

function extractPortalQuickUsername(url) {
  try {
    const u = new URL(String(url || ''));
    if (!/123\.121\.147\.7:88$/i.test(u.host)) return '';
    if (!/\/ve\/s\.shtml$/i.test(u.pathname)) return '';
    if (u.searchParams.get('login') !== 'main_2') return '';
    return String(u.searchParams.get('username') || '').trim();
  } catch {
    return '';
  }
}

function isEncodedPortalQuickUsername(value) {
  const raw = String(value || '').trim();
  if (!raw || /^\d+$/.test(raw)) return false;
  try {
    const decoded = atob(raw);
    return /^[0-9a-f]{32}$/i.test(decoded);
  } catch {
    return /^[A-Za-z0-9+/]{20,}={0,2}$/.test(raw);
  }
}

async function getPortalCurrentUserInfoFromTab(tabId) {
  if (!tabId) return null;
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: async () => {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        try {
          const res = await fetch('/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo', {
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
          });
          const source = String(await res.text() || '').trim();
          const data = JSON.parse(source.startsWith('{}') && source.length > 2 ? source.slice(2) : source);
          if (String(data?.STATUS) === '0' && data?.result?.loginName) return data.result;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return null;
    }
  }).catch(() => []);
  return Array.isArray(results) && results[0] ? results[0].result || null : null;
}

async function fetchBoundPortalAccountInfo(tabId, quickUsername, _preferredLoginName = '') {
  const quick = String(quickUsername || '').trim();
  if (!quick) return null;
  const currentUser = await getPortalCurrentUserInfoFromTab(tabId);
  const loginName = String(currentUser?.loginName || '').trim();
  if (!loginName) return null;

  await globalThis.BjtuAccountStore.migrateLegacy();
  const stored = await chrome.storage.local.get([LOGIN_ACCOUNT_HISTORY_KEY]);
  const history = normalizePortalLoginAccountHistory(stored?.[LOGIN_ACCOUNT_HISTORY_KEY]);
  const prev = history.find((item) => item.userId === loginName || item.loginName === loginName) || null;
  const account = await globalThis.BjtuAccountStore.get(loginName) || prev || {
    loginName,
    userName: String(currentUser?.userName || '').trim(),
    roleName: String(currentUser?.roleName || '').trim(),
    password: ''
  };
  const previousQuickUsername = String(account.quickUsername || prev?.quickUsername || '').trim();
  await globalThis.BjtuAccountStore.put({
    loginName,
    roleName: String(currentUser?.roleName || account.roleName || '').trim(),
    userName: String(currentUser?.userName || account.userName || '').trim(),
    password: String(account.password || account.passwordMd5 || '').trim(),
    quickUsername: quick
  });

  const record = await savePortalLoginAccountRecord(loginName, {
    loginName,
    userName: String(currentUser?.userName || account.userName || '').trim(),
    roleName: String(currentUser?.roleName || account.roleName || '').trim(),
    passwordMd5: String(account.password || account.passwordMd5 || '').trim(),
    quickUsername: quick
  });
  return record ? {
    ...record,
    quickUsernameChanged: previousQuickUsername !== quick
  } : null;
}

async function showPortalQuickUsernameBoundToast(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: (message) => {
        const id = '__bjtu_quick_username_bind_toast__';
        const old = document.getElementById(id);
        if (old) old.remove();
        const toast = document.createElement('div');
        toast.id = id;
        toast.textContent = message;
        toast.style.cssText = [
          'position:fixed',
          'top:18px',
          'left:50%',
          'transform:translateX(-50%)',
          'z-index:2147483647',
          'background:#16a34a',
          'color:#fff',
          'font-size:14px',
          'font-weight:600',
          'line-height:1.5',
          'padding:10px 14px',
          'border-radius:8px',
          'box-shadow:0 10px 30px rgba(0,0,0,.22)',
          'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
        ].join(';');
        document.documentElement.appendChild(toast);
        setTimeout(() => {
          toast.style.transition = 'opacity .25s ease, transform .25s ease';
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(-50%) translateY(-8px)';
          setTimeout(() => toast.remove(), 280);
        }, 3600);
      },
      args: ['已为您成功绑定智慧课程平台快速登录']
    });
  } catch {
    // ignore
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = String(changeInfo?.url || tab?.url || '');

  let quickUsername = extractPortalQuickUsername(url);
  if (quickUsername) {
    portalDetectedQuickUsernameByTab.set(tabId, quickUsername);
  } else {
    quickUsername = String(portalDetectedQuickUsernameByTab.get(tabId) || '').trim();
  }
  const bindState = portalUsernameBindByTab.get(tabId) || null;
  if (quickUsername && portalUsernameBindByTab.has(tabId)) {
    portalUsernameBindByTab.set(tabId, { ...(bindState || {}), quickUsername, ts: Date.now() });
    notifyPortalUsernameBindStatus({ status: 'detected', tabId, quickUsername, ts: Date.now() });
  } else if (!quickUsername && bindState?.quickUsername) {
    quickUsername = String(bindState.quickUsername || '').trim();
  }

  if (changeInfo.status === 'complete' && quickUsername && portalUsernameBindByTab.has(tabId)) {
      try {
        const record = await fetchBoundPortalAccountInfo(tabId, quickUsername, bindState?.loginName);
        notifyPortalUsernameBindStatus({
          status: record ? 'done' : 'detected',
          tabId,
          quickUsername,
          userId: String(record?.userId || '').trim(),
          ts: Date.now()
        });
        if (record) {
          portalUsernameBindByTab.delete(tabId);
          try { await chrome.tabs.remove(tabId); } catch {}
          return;
        }
      } catch (e) {
        notifyPortalUsernameBindStatus({
          status: 'error',
          tabId,
          quickUsername,
          error: String(e?.message || e),
          ts: Date.now()
        });
      }
  }

  if (changeInfo.status === 'complete' && quickUsername && isEncodedPortalQuickUsername(quickUsername) && !portalUsernameBindByTab.has(tabId)) {
    const toastedQuick = String(portalQuickUsernameToastByTab.get(tabId) || '').trim();
    if (toastedQuick !== quickUsername) {
      try {
        const record = await fetchBoundPortalAccountInfo(tabId, quickUsername);
        if (record?.quickUsernameChanged) {
          portalQuickUsernameToastByTab.set(tabId, quickUsername);
          await showPortalQuickUsernameBoundToast(tabId);
        }
      } catch {
        // Ordinary portal navigation should not be interrupted by best-effort binding.
      }
    }
  }

});

chrome.action.onClicked.addListener(async () => {
  try {
    const mode = currentOpenMode || (await chrome.storage.local.get('openMode')).openMode || 'popup';
    if (mode === 'page') {
      try {
        const tabs = await chrome.tabs.query({ url: APP_URL });
        if (Array.isArray(tabs) && tabs.length) {
          const t = tabs[0];
          try { await chrome.tabs.update(t.id, { active: true }); } catch (e) {}
          try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
          return;
        }
      } catch (e) {}
      chrome.tabs.create({ url: APP_URL });
      return;
    }
    // In popup mode if popup is unset, fall back to opening the app page
    try {
      if (chrome.action.getPopup) {
        const popup = await chrome.action.getPopup({});
        if (!popup) {
          chrome.tabs.create({ url: APP_URL });
        }
      }
    } catch (e) {
      // ignore
    }
  } catch (e) {
    try { chrome.tabs.create({ url: APP_URL }); } catch (e2) {}
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
