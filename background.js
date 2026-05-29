importScripts('portal-login-retry.js');

const APP_URL = chrome.runtime.getURL('app.html');
const portalLoginCtxByTab = new Map(); // tabId -> { username, passcode, passwordMd5, autoCode, fromExtension }
const portalUsernameBindByTab = new Map(); // tabId -> { ts }
const portalHandledByTab = new Map(); // tabId -> { url, ts }
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

async function ensureTesseractInjected(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!globalThis.Tesseract
    });
    if (res?.[0]?.result) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['vendor/tesseract/tesseract.min.js']
    });
  } catch (e) {}
}

// Manage action popup according to openMode ('popup' or 'page')
let currentOpenMode = 'popup';
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

function isPortalLoginUrl(url) {
  const u = String(url || '');
  // 所有 VE 页面均注入检测脚本，由注入脚本判断是否需要弹出登录框
  return /^http:\/\/123\.121\.147\.7:88\//i.test(u);
}

function shouldSkipRecent(tabId, url) {
  const rec = portalHandledByTab.get(tabId);
  if (!rec) return false;
  const same = rec.url === url;
  const recent = (Date.now() - rec.ts) < 4000;
  if (!same || !recent) return false;
  return !portalLoginCtxByTab.has(tabId);
}

async function injectPortalAutoLogin(tabId, ctx = null) {
  try {
    await ensureTesseractInjected(tabId);
  } catch {
    // fallback to non-tesseract OCR path
  }

  const enrichedCtx = ctx && typeof ctx === 'object' ? { ...ctx } : {};
  if (!Array.isArray(enrichedCtx.accountHistory)) {
    enrichedCtx.accountHistory = await getPortalLoginAccountHistory();
  }

  return new Promise((resolve) => {
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: portalLoginAutoLoginInjected,
      args: [enrichedCtx]
    }, (results) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message || String(err) });
        return;
      }
      const result = Array.isArray(results) && results[0] ? results[0].result : null;
      if (!result || result.ok !== true) {
        resolve({ ok: false, error: result?.reason || 'inject-failed' });
        return;
      }
      resolve({ ok: true, meta: result });
    });
  });
}

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

  if (message?.type === 'OPEN_PORTAL_LOGIN_TAB') {
    const payload = message?.payload || {};
    chrome.tabs.create({ url: 'http://123.121.147.7:88/ve/', active: true }, (tab) => {
      const err = chrome.runtime.lastError;
      if (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
        return;
      }
      const tabId = tab?.id || null;
      if (tabId) {
        portalLoginCtxByTab.set(tabId, {
          username: String(payload.username || ''),
          passcode: String(payload.passcode || ''),
          passwordMd5: String(payload.passwordMd5 || ''),
          autoCode: String(payload.autoCode || ''),
          fromExtension: true
        });
      }
      sendResponse({ ok: true, tabId });
    });
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
    chrome.tabs.create({ url: 'http://123.121.147.7:88/oauth/api/user/thirdLogin', active: true }, async (tab) => {
      const err = chrome.runtime.lastError;
      if (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
        return;
      }
      const tabId = tab?.id || null;
      if (tabId) {
        portalUsernameBindByTab.set(tabId, { ts: Date.now() });
        notifyPortalUsernameBindStatus({ status: 'started', tabId, ts: Date.now() });
      }
      sendResponse({ ok: true, tabId });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  portalLoginCtxByTab.delete(tabId);
  portalHandledByTab.delete(tabId);
  portalUsernameBindByTab.delete(tabId);
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

async function fetchBoundPortalAccountInfo(tabId, quickUsername) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: async () => {
      const parseJson = (text) => {
        const s = String(text || '{}').trim();
        return JSON.parse(s.startsWith('{}') ? s.slice(2) : s);
      };
      for (let i = 0; i < 25; i++) {
        try {
          const res = await fetch('/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo', {
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
          });
          const text = await res.text();
          if (!String(text || '').includes('login-page')) {
            const data = parseJson(text);
            if (String(data?.STATUS) === '0' && data?.result) return data.result;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 300));
      }
      return null;
    }
  });
  const info = Array.isArray(results) && results[0] ? results[0].result : null;
  const loginName = String(info?.loginName || info?.userId || info?.userID || info?.stuId || info?.teacherId || '').trim();
  if (!loginName) return null;
  return await savePortalLoginAccountRecord(loginName, {
    loginName,
    userName: String(info?.userName || '').trim(),
    roleName: String(info?.roleName || '').trim(),
    quickUsername
  });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = String(changeInfo?.url || tab?.url || '');

  let quickUsername = extractPortalQuickUsername(url);
  const bindState = portalUsernameBindByTab.get(tabId) || null;
  if (quickUsername && (portalUsernameBindByTab.has(tabId) || isEncodedPortalQuickUsername(quickUsername))) {
    portalUsernameBindByTab.set(tabId, { ...(bindState || {}), quickUsername, ts: Date.now() });
    notifyPortalUsernameBindStatus({ status: 'detected', tabId, quickUsername, ts: Date.now() });
  } else if (!quickUsername && bindState?.quickUsername) {
    quickUsername = String(bindState.quickUsername || '').trim();
  }

  if (changeInfo.status === 'complete' && quickUsername && (portalUsernameBindByTab.has(tabId) || isEncodedPortalQuickUsername(quickUsername))) {
      try {
        const record = await fetchBoundPortalAccountInfo(tabId, quickUsername);
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

  if (changeInfo.status !== 'complete') return;
  if (!isPortalLoginUrl(url)) return;
  if (shouldSkipRecent(tabId, url)) return;

  const ctx = portalLoginCtxByTab.get(tabId) || null;
  portalHandledByTab.set(tabId, { url, ts: Date.now() });
  const r = await injectPortalAutoLogin(tabId, ctx);
  if (!r.ok && r.error === 'back-to-input') {
    await injectPortalAutoLogin(tabId, ctx);
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
  return method === 'POST' && /\/ve\/s\.shtml(?:[?#]|$)/i.test(url);
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
