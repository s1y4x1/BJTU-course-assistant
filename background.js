importScripts('md5.js');

importScripts('account-store.js');

const APP_URL = chrome.runtime.getURL('app.html');
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
    'portalUsernameBindStatus'
  ]).catch(() => {});
} catch {}

// 下载完成系统通知点击处理（持久上下文，弹窗关闭后仍有效）
const VERSION_UPDATE_NOTIFICATION_ID = 'bjtu-update-download-complete';
chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId !== VERSION_UPDATE_NOTIFICATION_ID) return;
  chrome.storage.local.get(['_VERSION_UPDATE_DOWNLOAD_ID'], (result) => {
    const id = result._VERSION_UPDATE_DOWNLOAD_ID;
    if (id) chrome.downloads.open(id, () => void chrome.runtime.lastError);
    chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
  });
});
chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
  if (notifId !== VERSION_UPDATE_NOTIFICATION_ID) return;
  if (buttonIndex === 0) {
    chrome.storage.local.get(['_VERSION_UPDATE_DOWNLOAD_ID'], (result) => {
      const id = result._VERSION_UPDATE_DOWNLOAD_ID;
      if (id) chrome.downloads.open(id, () => void chrome.runtime.lastError);
      chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
    });
  } else if (buttonIndex === 1) {
    chrome.tabs.create({ url: 'about:extensions' });
    chrome.notifications.clear(notifId, () => void chrome.runtime.lastError);
  }
});

function normalizePortalLoginAccountHistory(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list
    .map((it) => {
      const loginName = String(it?.loginName || it?.userId || '').trim();
      if (!loginName) return null;
      const lastLoginAt = Number(it?.lastLoginAt || 0);
      return {
        userId: loginName,
        loginName,
        lastLoginAt: Number.isFinite(lastLoginAt) ? lastLoginAt : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));
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
});

chrome.runtime.onInstalled.addListener(() => {
  refreshActionPopupFromStorage().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshActionPopupFromStorage().catch(() => {});
});

refreshActionPopupFromStorage().catch(() => {});

function parsePortalLoginResponse(text) {
  const source = String(text || '');
  const alerts = [...source.matchAll(/alert\s*\(\s*(['"])(.*?)\1\s*\)/gis)];
  const message = String(alerts.at(-1)?.[2] || '').trim();
  if (/错误次数过多|锁定10分钟/i.test(message)) return { ok: false, reason: 'locked', message };
  if (/账号或密码错误/i.test(message)) return { ok: false, reason: 'credential', message };
  if (/默认密码[\s\S]*弱密码[\s\S]*重置密码/i.test(source)) {
    return { ok: false, reason: 'password-reset', message: '需要重置密码后重新登录' };
  }
  if (/index\.shtml\?method=index&type=qxkt/i.test(source)) return { ok: true };
  return { ok: false, reason: 'other', message: message || '登录失败' };
}

function decodePortalResponseBuffer(buf, contentType = '') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('gbk') || type.includes('gb2312')) {
    return new TextDecoder('gbk').decode(buf);
  }
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  const gbk = new TextDecoder('gbk').decode(buf);
  return gbk && !gbk.includes('�') ? gbk : utf8;
}

async function decodePortalResponse(res) {
  return decodePortalResponseBuffer(await res.arrayBuffer(), res.headers.get('content-type'));
}

async function getPortalCurrentUserInfo() {
  try {
    const res = await fetch('http://123.121.147.7:88/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo', {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });
    const source = String(await res.text() || '').trim();
    const data = JSON.parse(source.startsWith('{}') && source.length > 2 ? source.slice(2) : source);
    return String(data?.STATUS) === '0' && data?.result ? data.result : null;
  } catch {
    return null;
  }
}

async function requestPortalLogin(url) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  return parsePortalLoginResponse(await decodePortalResponse(res));
}

async function performPortalPageLogin(payload = {}) {
  const loginName = String(payload?.loginName || '').trim();
  if (!loginName) return { ok: false, reason: 'empty', message: '请输入账号' };
  if (!payload?.skipCurrentCheck) {
    const currentUser = await getPortalCurrentUserInfo();
    if (String(currentUser?.loginName || '').trim() === loginName) {
      return { ok: true, alreadyLoggedIn: true, userInfo: currentUser };
    }
  }

  await globalThis.BjtuAccountStore.migrateLegacy();
  const account = await globalThis.BjtuAccountStore.get(loginName);
  const history = await getEnrichedPortalLoginAccountHistory();
  const historyRecord = history.find((item) => item.loginName === loginName || item.userId === loginName) || null;
  const source = account || historyRecord;
  const plain = String(payload?.passwordPlain || '');
  const directMd5 = String(payload?.passwordMd5 || '').trim().toLowerCase();
  const manualPassword = plain
    ? globalThis.md5(plain)
    : (/^[0-9a-f]{32}$/.test(directMd5) ? directMd5 : '');

  if (!manualPassword) {
    const quickUsername = String(source?.quickUsername || '').trim();
    if (quickUsername) {
      const quickUrl = 'http://123.121.147.7:88/ve/s.shtml?loginType=2&login=main_2&goLogin=1&username=' + encodeURIComponent(quickUsername);
      const quickResult = await requestPortalLogin(quickUrl);
      if (quickResult.ok) return quickResult;
      if (quickResult.reason === 'locked' || quickResult.reason === 'password-reset') return quickResult;
    }
  }

  const password = manualPassword || String(source?.password || source?.passwordMd5 || '').trim();
  if (!password) {
    return {
      ok: false,
      reason: source ? 'needs-password' : 'account-not-found',
      message: source ? '未找到可用密码，请手动输入' : '账号不在本地账号列表中，请手动输入密码'
    };
  }
  const passwordUrl = 'http://123.121.147.7:88/ve/s.shtml?login=main_2&goLogin=1&username='
    + encodeURIComponent(loginName) + '&password=' + encodeURIComponent(password);
  const result = await requestPortalLogin(passwordUrl);
  if (!result.ok) return result;

  const userInfo = await getPortalCurrentUserInfo();
  const finalLoginName = String(userInfo?.loginName || loginName).trim();
  const finalAccount = finalLoginName === loginName ? account : await globalThis.BjtuAccountStore.get(finalLoginName);
  const finalHistory = finalLoginName === loginName
    ? historyRecord
    : history.find((item) => item.loginName === finalLoginName || item.userId === finalLoginName) || null;
  const finalSource = finalAccount || finalHistory || source || {};
  await globalThis.BjtuAccountStore.put({
    loginName: finalLoginName,
    userName: String(userInfo?.userName || finalSource?.userName || '').trim(),
    roleName: String(userInfo?.roleName || finalSource?.roleName || '').trim(),
    password,
    quickUsername: String(finalSource?.quickUsername || '').trim()
  });
  await savePortalLoginAccountRecord(finalLoginName, {
    loginName: finalLoginName,
    userName: String(userInfo?.userName || finalSource?.userName || '').trim(),
    roleName: String(userInfo?.roleName || finalSource?.roleName || '').trim(),
    passwordMd5: password,
    quickUsername: String(finalSource?.quickUsername || '').trim()
  });
  return { ...result, userInfo };
}

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

  if (message?.type === 'PORTAL_LOGIN_SUBMIT') {
    performPortalPageLogin(message?.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, reason: 'network', message: String(error?.message || '登录失败') }));
    return true;
  }

  if (message?.type === 'PORTAL_CHECK_LOGIN_STATUS') {
    (async () => {
      const loginName = String(message?.payload?.loginName || '').trim();
      const currentUser = await getPortalCurrentUserInfo();
      sendResponse({
        ok: true,
        loggedIn: !!currentUser,
        alreadyLoggedIn: !!loginName && String(currentUser?.loginName || '').trim() === loginName,
        userInfo: currentUser || null
      });
    })().catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'OPEN_APP') {
    (async () => {
      try {
        const targetUrl = message?.payload?.accountInit
          ? chrome.runtime.getURL('app.html?accountInit=1')
          : APP_URL;
        const tabs = (await chrome.tabs.query({})).filter((tab) => String(tab?.url || '').startsWith(APP_URL));
        if (Array.isArray(tabs) && tabs.length) {
          const t = tabs[0];
          try { await chrome.tabs.update(t.id, { active: true, url: targetUrl }); } catch (e) {}
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

chrome.webRequest.onBeforeSendHeaders.addListener(
  async (details) => {
    try {
      const headers = details?.requestHeaders || [];
      const authorization = findHeaderValue(headers, 'authorization');
      const xApiRequestPayload = findHeaderValue(headers, 'x-api-request-payload');
      const xApiRequestMode = findHeaderValue(headers, 'x-api-request-mode') || 'cors';
      if (!authorization || !xApiRequestPayload) return;
      await chrome.storage.local.set({
        jlgjRequestHeaders: {
          authorization,
          xApiRequestPayload,
          xApiRequestMode,
          ts: Date.now(),
          url: details?.url || ''
        }
      });
    } catch {
      // ignore
    }
  },
  { urls: ['https://i-api.jielong.com/*'] },
  ['requestHeaders', 'extraHeaders']
);
