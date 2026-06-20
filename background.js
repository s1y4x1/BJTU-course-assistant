importScripts('md5.js');

const APP_URL = chrome.runtime.getURL('app.html');
const portalUsernameBindByTab = new Map(); // tabId -> { ts, loginName }
const portalDetectedQuickUsernameByTab = new Map(); // tabId -> quickUsername seen during ordinary MIS redirects
const portalQuickUsernameToastByTab = new Map(); // tabId -> quickUsername already toasted
const LOGIN_ACCOUNT_HISTORY_KEY = 'loginAccountHistory';
const ACCOUNT_LIST_KEY = 'accountList';
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
      const userId = String(it?.userId || '').trim();
      if (!userId) return null;
      const lastLoginAt = Number(it?.lastLoginAt || 0);
      return {
        userId,
        loginName: String(it?.loginName || userId).trim(),
        userName: String(it?.userName || '').trim(),
        roleName: String(it?.roleName || '').trim(),
        passwordMd5: String(it?.passwordMd5 || '').trim(),
        quickUsername: String(it?.quickUsername || it?.username || '').trim(),
        lastLoginAt: Number.isFinite(lastLoginAt) ? lastLoginAt : 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));
}

async function getPortalLoginAccountHistory() {
  try {
    const raw = await chrome.storage.local.get(LOGIN_ACCOUNT_HISTORY_KEY);
    return normalizePortalLoginAccountHistory(raw?.[LOGIN_ACCOUNT_HISTORY_KEY]);
  } catch {
    return [];
  }
}

async function savePortalLoginAccountRecord(userId, patch = {}) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const list = await getPortalLoginAccountHistory();
  const idx = list.findIndex((it) => String(it?.userId || '').trim() === uid);
  const prev = idx >= 0 ? list[idx] : {};
  const record = {
    ...prev,
    userId: uid,
    loginName: String(patch.loginName || prev.loginName || uid).trim(),
    userName: String(patch.userName || prev.userName || '').trim(),
    roleName: String(patch.roleName || prev.roleName || '').trim(),
    passwordMd5: String(patch.passwordMd5 || prev.passwordMd5 || '').trim(),
    quickUsername: String(patch.quickUsername || patch.username || prev.quickUsername || '').trim(),
    lastLoginAt: Date.now()
  };
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(record);
  await chrome.storage.local.set({ [LOGIN_ACCOUNT_HISTORY_KEY]: normalizePortalLoginAccountHistory(list) });
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'OPEN_APP') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: APP_URL });
        if (Array.isArray(tabs) && tabs.length) {
          const t = tabs[0];
          try { await chrome.tabs.update(t.id, { active: true }); } catch (e) {}
          try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
          sendResponse({ ok: true, reused: true, tabId: t.id });
          return;
        }
        const newTab = await chrome.tabs.create({ url: APP_URL });
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

async function fetchBoundPortalAccountInfo(_tabId, quickUsername, preferredLoginName = '') {
  const quick = String(quickUsername || '').trim();
  if (!quick) return null;
  const stored = await chrome.storage.local.get([ACCOUNT_LIST_KEY, LOGIN_ACCOUNT_HISTORY_KEY, 'username']);
  const loginName = String(preferredLoginName || stored?.username || '').trim();
  const list = stored?.[ACCOUNT_LIST_KEY] && typeof stored[ACCOUNT_LIST_KEY] === 'object'
    ? stored[ACCOUNT_LIST_KEY]
    : {};
  const history = normalizePortalLoginAccountHistory(stored?.[LOGIN_ACCOUNT_HISTORY_KEY]);
  const prev = history.find((item) => item.userId === loginName || item.loginName === loginName) || null;
  const account = list[loginName] || prev;
  if (!loginName || !account) return null;
  const previousQuickUsername = String(account.quickUsername || prev?.quickUsername || '').trim();
  list[loginName] = {
    roleName: String(account.roleName || '').trim(),
    userName: String(account.userName || '').trim(),
    password: String(account.password || account.passwordMd5 || '').trim(),
    quickUsername: quick
  };
  await chrome.storage.local.set({ [ACCOUNT_LIST_KEY]: list });

  const record = await savePortalLoginAccountRecord(loginName, {
    loginName,
    userName: String(account.userName || '').trim(),
    roleName: String(account.roleName || '').trim(),
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
      args: ['已为您成功绑定智慧课程平台免验证码快速登录']
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
