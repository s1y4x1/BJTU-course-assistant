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
