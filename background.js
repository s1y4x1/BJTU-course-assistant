importScripts('portal-login-retry.js');

const APP_URL = chrome.runtime.getURL('app.html');
const portalLoginCtxByTab = new Map(); // tabId -> { username, passcode, passwordMd5, autoCode, fromExtension }
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

function isPortalLoginUrl(url) {
  const u = String(url || '');
  return /^http:\/\/123\.121\.147\.7:88\/ve\/?(?:[#?].*)?$/i.test(u)
    || /^http:\/\/123\.121\.147\.7:88\/ve\/Login_2\.jsp(?:[#?].*)?$/i.test(u);
}

function shouldSkipRecent(tabId, url) {
  const rec = portalHandledByTab.get(tabId);
  if (!rec) return false;
  const same = rec.url === url;
  const recent = (Date.now() - rec.ts) < 4000;
  return same && recent;
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
    chrome.tabs.create({ url: APP_URL });
    try {
      sendResponse({ ok: true });
    } catch {}
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
    return;
  }
  if (r.ok && r.meta?.pendingSwitch?.targetUsername) {
    await chrome.storage.local.set({
      portalPendingSwitchAfterAux: {
        targetUsername: String(r.meta.pendingSwitch.targetUsername || '').trim(),
        ts: Date.now(),
        tabId
      }
    });
  }
});

chrome.action.onClicked.addListener(async () => {
  chrome.tabs.create({ url: APP_URL });
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
      // Only track Set-Cookie from login POST response.
      // Other endpoints (captcha/image/home) may rotate JSESSIONID and pollute our login session selection.
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

