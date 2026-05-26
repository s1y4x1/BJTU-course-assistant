importScripts('portal-login-retry.js');

const APP_URL = chrome.runtime.getURL('app.html');
const portalLoginCtxByTab = new Map(); // tabId -> { username, fromExtension }
const portalHandledByTab = new Map(); // tabId -> { url, ts }
const LOGIN_ACCOUNT_HISTORY_KEY = 'loginAccountHistory';

function normalizePortalLoginAccountHistory(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list
    .map((it) => {
      const userId = String(it?.userId || '').trim();
      if (!userId) return null;
      const lastLoginAt = Number(it?.lastLoginAt || 0);
      return {
        userId,
        userName: String(it?.userName || '').trim(),
        roleName: String(it?.roleName || '').trim(),
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
          fromExtension: true
        });
      }
      sendResponse({ ok: true, tabId });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  portalLoginCtxByTab.delete(tabId);
  portalHandledByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = String(tab?.url || '');
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
  return /\/ve\/s\.shtml(?:[?#]|$)/i.test(url);
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
      await chrome.storage.local.set({
        latestResponseJsessionid: {
          value: found,
          ts: Date.now(),
          url: details?.url || ''
        }
      });
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
      if (!isLoginResponse(details)) return;
      const headers = details?.requestHeaders || [];
      let sent = '';
      for (const h of headers) {
        if (!h || !h.name) continue;
        if (String(h.name).toLowerCase() !== 'cookie') continue;
        sent = extractJsessionidFromCookieHeader(h.value || '');
        if (sent) break;
      }
      if (!sent) return;
      await chrome.storage.local.set({
        latestSentLoginJsessionid: {
          value: sent,
          ts: Date.now(),
          url: details?.url || ''
        }
      });
    } catch {
      // ignore
    }
  },
  { urls: ['http://123.121.147.7:88/*'] },
  ['requestHeaders', 'extraHeaders']
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
