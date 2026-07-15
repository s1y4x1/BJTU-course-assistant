const JLGJ_LOGIN_LINK_HTML = '<a href="https://i.jielong.com/my-class" target="_blank" rel="noopener noreferrer" style="color:#ffd243; text-decoration:none; font-weight:600;">接龙管家</a>';
const JLGJ_LOGIN_REQUIRED_HTML = `如需查看${JLGJ_LOGIN_LINK_HTML}作业，请前往登录`;
const JLGJ_API_BASE = 'https://i-api.jielong.com';
const JLGJ_WEB_BASE = 'https://i.jielong.com/my-class';
const JLGJ_GROUP_LIST_API = `${JLGJ_API_BASE}/api/UserGroup/UserGroupPages?pageIndex=1&pageSize=20`;
const JLGJ_LOGIN_ASSIST_URL = 'https://i.jielong.com/login?redirectTo=https://i.jielong.com/my-class';
const JLGJ_LOGIN_SUCCESS_URL_PREFIX = 'https://i.jielong.com/my-class';
const jlgjOwnedBackgroundTabIds = new Set();
let jlgjLoginAssistRetryTimer = null;
let jlgjLoginAssistPollTimer = null;
let jlgjLoginAssistPopupWindowId = null;
let jlgjLoginAssistPopupTabId = null;

// Platform-specific functions extracted from app.js. Shared helpers remain global.

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

function clearJlgjStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.jlgj-standalone-card');
  cards.forEach((n) => n.remove());
  updateCourseListEmptyPlaceholder();
}

function renderJlgjNeedLoginMessage() {
  const shouldOpenAssist = !!window.platformInteractiveLoginPending?.jlgj;
  window.platformLoadedOnce.jlgj = false;
  clearPlatformData('jlgj');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('jlgj', 'offline');

  if (shouldOpenAssist) {
    chrome.tabs.query({ url: ['https://i.jielong.com/login*'] }).then((tabs) => {
      const tab = (tabs || []).find((item) => Number(item?.id || 0) > 0);
      if (tab?.id) void showJlgjQrFrameInBackgroundTab(tab.id);
    }).catch(() => {});
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
  const existingTabs = await chrome.tabs.query({ url: ['https://i.jielong.com/*'] }).catch(() => []);
  const reusableTab = (existingTabs || []).find((tab) =>
    tab?.id && tab.status === 'complete' && !/\/login(?:[?#]|$)/i.test(String(tab.url || ''))
  );
  if (reusableTab?.id) return reusableTab;
  const tab = await chrome.tabs.create({ url: 'https://i.jielong.com/my-class#bjtu-bg', active: false });
  if (tab?.id) jlgjOwnedBackgroundTabIds.add(Number(tab.id));
  return tab;
}

async function closeJlgjBackgroundTabAndReturnToApp(tabId) {
  const id = Number(tabId || 0);
  if (!id || !jlgjOwnedBackgroundTabIds.has(id)) return;
  try {
    const tab = await chrome.tabs.get(id);
    if (tab?.active) {
      await chrome.runtime.sendMessage({ type: 'OPEN_APP' }).catch(() => null);
    }
  } catch {
    // The login tab may already have been closed by the user.
  }
  try { await chrome.tabs.remove(id); } catch { /* ignore */ }
  jlgjOwnedBackgroundTabIds.delete(id);
}

async function showJlgjQrFrameInBackgroundTab(tabId) {
  const id = Number(tabId || 0);
  if (!id) return null;
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: id },
      world: 'MAIN',
      func: async (darkMode) => {
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          const frame = Array.from(document.querySelectorAll('iframe')).find((item) =>
            /^https:\/\/(?:lp\.)?open\.weixin\.qq\.com\/connect\/(?:l\/)?qrconnect(?:[/?#]|$)/i.test(String(item.src || ''))
          );
          if (frame) {
            if (darkMode) {
              let style = document.getElementById('__bjtu_jlgj_dark_style__');
              if (!style) {
                style = document.createElement('style');
                style.id = '__bjtu_jlgj_dark_style__';
                (document.head || document.documentElement).appendChild(style);
              }
              style.textContent = `
                iframe[src*="open.weixin.qq.com/connect/"][src*="qrconnect"] { color-scheme:light !important; }
              `;
              document.querySelectorAll('.toggle, .toggle *').forEach((node) => {
                if (node instanceof HTMLElement && node.style.getPropertyPriority('background-color') === 'important') {
                  node.style.removeProperty('background-color');
                }
              });
              const applyDark = (root) => {
                const nodes = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [];
                nodes.forEach((node) => {
                  if (!(node instanceof HTMLElement) || node instanceof HTMLIFrameElement) return;
                  if (node.matches('.toggle, .toggle *')) return;
                  const parse = (value) => {
                    const match = String(value || '').match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
                    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
                  };
                  const neutral = (parts) => parts && Math.max(parts[0], parts[1], parts[2]) - Math.min(parts[0], parts[1], parts[2]) <= 18;
                  const computed = getComputedStyle(node);
                  const background = parse(computed.backgroundColor);
                  const foreground = parse(computed.color);
                  if (computed.backgroundImage === 'none' && neutral(background) && background[3] > 0.15 && (background[0] + background[1] + background[2]) / 3 >= 235) {
                    if (!node.hasAttribute('data-bjtu-jlgj-login-bg')) {
                      node.dataset.bjtuJlgjLoginBg = node.style.getPropertyValue('background');
                      node.dataset.bjtuJlgjLoginBgPriority = node.style.getPropertyPriority('background');
                    }
                    node.style.setProperty('background', '#0f172a none', 'important');
                  }
                  if (neutral(foreground) && foreground[3] > 0.15 && (foreground[0] + foreground[1] + foreground[2]) / 3 <= 128) {
                    if (!node.hasAttribute('data-bjtu-jlgj-login-color')) {
                      node.dataset.bjtuJlgjLoginColor = node.style.getPropertyValue('color');
                      node.dataset.bjtuJlgjLoginColorPriority = node.style.getPropertyPriority('color');
                    }
                    const light = foreground.slice(0, 3).map((value) => Math.min(255, Math.max(0, Math.round(256 - value))));
                    node.style.setProperty('color', `rgb(${light.join(', ')})`, 'important');
                  }
                });
              };
              applyDark(document.documentElement);
              if (globalThis.__bjtuJlgjDarkObserverVersion !== 3) {
                try { globalThis.__bjtuJlgjDarkObserver?.disconnect(); } catch { /* ignore */ }
                globalThis.__bjtuJlgjDarkObserver = new MutationObserver((records) => records.forEach((record) =>
                  record.addedNodes.forEach((node) => { if (node instanceof Element) applyDark(node); })
                ));
                globalThis.__bjtuJlgjDarkObserver.observe(document.documentElement, { childList:true, subtree:true });
                globalThis.__bjtuJlgjDarkObserverVersion = 3;
              }
            }
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return false;
      },
      args: [window.jlgjDarkModeEnabled !== false && document.documentElement.dataset.colorScheme === 'dark']
    });
    if (result?.[0]?.result !== true) return null;
  } catch {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(id);
    await chrome.tabs.update(id, { active: true });
    if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return { tabId: id, windowId: tab?.windowId || null };
  } catch {
    return null;
  }
}

async function showJlgjLoginSuccessNotice(tabId) {
  const id = Number(tabId || 0);
  if (!id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      world: 'MAIN',
      func: (darkMode) => {
        if (darkMode) {
          let style = document.getElementById('__bjtu_jlgj_dark_style__');
          if (!style) {
            style = document.createElement('style');
            style.id = '__bjtu_jlgj_dark_style__';
            (document.head || document.documentElement).appendChild(style);
          }
          style.textContent = `
            iframe[src*="open.weixin.qq.com/connect/"][src*="qrconnect"] { color-scheme:light !important; }
          `;
          document.querySelectorAll('.toggle, .toggle *').forEach((node) => {
            if (node instanceof HTMLElement && node.style.getPropertyPriority('background-color') === 'important') {
              node.style.removeProperty('background-color');
            }
          });
          const applyDark = (root) => {
            const nodes = root instanceof Element ? [root, ...root.querySelectorAll('*')] : [];
            nodes.forEach((node) => {
              if (!(node instanceof HTMLElement) || node instanceof HTMLIFrameElement) return;
              if (node.matches('.toggle, .toggle *')) return;
              const parse = (value) => {
                const match = String(value || '').match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
                return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
              };
              const neutral = (parts) => parts && Math.max(parts[0], parts[1], parts[2]) - Math.min(parts[0], parts[1], parts[2]) <= 18;
              const computed = getComputedStyle(node);
              const background = parse(computed.backgroundColor);
              const foreground = parse(computed.color);
              if (computed.backgroundImage === 'none' && neutral(background) && background[3] > 0.15 && (background[0] + background[1] + background[2]) / 3 >= 235) {
                if (!node.hasAttribute('data-bjtu-jlgj-login-bg')) {
                  node.dataset.bjtuJlgjLoginBg = node.style.getPropertyValue('background');
                  node.dataset.bjtuJlgjLoginBgPriority = node.style.getPropertyPriority('background');
                }
                node.style.setProperty('background', '#0f172a none', 'important');
              }
              if (neutral(foreground) && foreground[3] > 0.15 && (foreground[0] + foreground[1] + foreground[2]) / 3 <= 128) {
                if (!node.hasAttribute('data-bjtu-jlgj-login-color')) {
                  node.dataset.bjtuJlgjLoginColor = node.style.getPropertyValue('color');
                  node.dataset.bjtuJlgjLoginColorPriority = node.style.getPropertyPriority('color');
                }
                const light = foreground.slice(0, 3).map((value) => Math.min(255, Math.max(0, Math.round(256 - value))));
                node.style.setProperty('color', `rgb(${light.join(', ')})`, 'important');
              }
            });
          };
          applyDark(document.documentElement);
          if (globalThis.__bjtuJlgjDarkObserverVersion !== 3) {
            try { globalThis.__bjtuJlgjDarkObserver?.disconnect(); } catch { /* ignore */ }
            globalThis.__bjtuJlgjDarkObserver = new MutationObserver((records) => records.forEach((record) =>
              record.addedNodes.forEach((node) => { if (node instanceof Element) applyDark(node); })
            ));
            globalThis.__bjtuJlgjDarkObserver.observe(document.documentElement, { childList:true, subtree:true });
            globalThis.__bjtuJlgjDarkObserverVersion = 3;
          }
        }
        let toast = document.getElementById('__bjtu_jlgj_loading_toast__');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = '__bjtu_jlgj_loading_toast__';
          toast.textContent = '登录成功，请不要关闭此页面，作业数据读取完成后将自动关闭。';
          Object.assign(toast.style, {
            position: 'fixed', top: '18px', left: '50%', transform: 'translateX(-50%)',
            zIndex: '2147483647', maxWidth: 'calc(100vw - 32px)', padding: '10px 16px',
            borderRadius: '6px', boxShadow: '0 8px 24px rgba(0,0,0,.28)', fontSize: '14px',
            lineHeight: '1.45', textAlign: 'center', pointerEvents: 'none'
          });
          document.documentElement.appendChild(toast);
        }
        toast.style.setProperty('background', darkMode ? '#102a43' : '#eff6ff', 'important');
        toast.style.setProperty('color', darkMode ? '#93c5fd' : '#1e3a8a', 'important');
        toast.style.setProperty('border', `1px solid ${darkMode ? '#1d4ed8' : '#93c5fd'}`, 'important');
      },
      args: [window.jlgjDarkModeEnabled !== false && document.documentElement.dataset.colorScheme === 'dark']
    });
  } catch { /* page may still be navigating */ }
}

async function hasJlgjQrFrame(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId: Number(tabId) },
      world: 'MAIN',
      func: () => Array.from(document.querySelectorAll('iframe')).some((item) =>
        /^https:\/\/(?:lp\.)?open\.weixin\.qq\.com\/connect\/(?:l\/)?qrconnect(?:[/?#]|$)/i.test(String(item.src || ''))
      )
    });
    return result?.[0]?.result === true;
  } catch {
    return false;
  }
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

async function waitAndFetchJlgjGroupListFromBrowser(timeoutMs = 30000, shouldAbort = null) {
  const start = Date.now();
  let ownedTabId = null;
  let ownedTabCreated = false;
  let reloadedOwnedTab = false;
  let loginPending = false;
  let loginPopupPrepared = false;
  let loginSuccessDetected = false;
  let loginPageClosedUnauthenticated = false;

  const pickReadyTab = async () => {
    if (typeof shouldAbort === 'function' && shouldAbort()) return null;
    const tabs = await chrome.tabs.query({ url: ['https://i.jielong.com/*#bjtu-bg'] });
    const existing = (tabs || []).find((t) => Number.isFinite(Number(t?.id)) && t.status === 'complete');
    if (existing?.id) return existing;

    if (!ownedTabId) {
      if (typeof shouldAbort === 'function' && shouldAbort()) return null;
      const created = await openJlgjBackgroundTab();
      ownedTabId = Number(created?.id || 0) || null;
      ownedTabCreated = !!(ownedTabId && jlgjOwnedBackgroundTabIds.has(ownedTabId));
    }
    if (!ownedTabId) return null;

    try {
      const ready = await chrome.tabs.get(ownedTabId);
      return ready?.id ? ready : null;
    } catch {
      if (loginPending && !loginSuccessDetected) {
        loginPageClosedUnauthenticated = true;
        return null;
      }
      ownedTabId = null;
      return null;
    }
  };

  try {
    while (Date.now() - start < (loginPending ? 30 * 60 * 1000 : timeoutMs)) {
      if (typeof shouldAbort === 'function' && shouldAbort()) {
        return { tabId: ownedTabId, ok: false, aborted: true };
      }
      try {
        const tab = await pickReadyTab();
        if (!tab?.id) {
          if (loginPageClosedUnauthenticated) {
            return {
              tabId: null,
              ok: false,
              unauthorized: true,
              loginPageClosedUnauthenticated: true
            };
          }
          await new Promise((r) => setTimeout(r, 450));
          continue;
        }

        const qrFrameVisible = await hasJlgjQrFrame(tab.id);
        if (qrFrameVisible) {
          loginPending = true;
          if (!loginPopupPrepared) {
            loginPopupPrepared = !!(await showJlgjQrFrameInBackgroundTab(tab.id));
          }
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        const tabUrl = String(tab?.url || '');
        if (/https:\/\/i\.jielong\.com\/login/i.test(tabUrl)) {
          loginPending = true;
          if (!loginPopupPrepared) {
            loginPopupPrepared = !!(await showJlgjQrFrameInBackgroundTab(tab.id));
          }
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        if (loginPending) {
          loginSuccessDetected = true;
          await showJlgjLoginSuccessNotice(tab.id);
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

        if (ownedTabCreated && ownedTabId && Number(tab.id) === Number(ownedTabId) && !reloadedOwnedTab && !state.hasData) {
          try {
            await chrome.tabs.reload(tab.id, { bypassCache: true });
            reloadedOwnedTab = true;
            await new Promise(r => setTimeout(r, 2000));
          } catch { }       
        }

        if (state.hasData && state.isComplete) {
          const snap = state.dataSnap;
          if (Number(snap?.userGroupPages?.status || 0) === 401) {
            loginPending = true;
            if (!loginPopupPrepared) {
              loginPopupPrepared = !!(await showJlgjQrFrameInBackgroundTab(tab.id));
            }
            await new Promise((r) => setTimeout(r, 600));
            continue;
          }
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
    return {
      tabId: ownedTabId,
      ok: false,
      status: loginPending ? 401 : 0,
      data: null,
      unauthorized: loginPending,
      loginRedirect: loginPending,
      keepOpen: loginPending,
      timeout: true
    };
  } catch {
    return { tabId: ownedTabId, ok: false, status: 0, data: null, unauthorized: true };
  }
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

function formatJlgjDateTime(value) {
  const timestamp = parseDeadlineToTs(value);
  if (!timestamp) return '无';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '无';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderJlgjHomeworkItems(items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it) => {
    const done = isJlgjHomeworkDone(it);
    const overdue = !done && isJlgjHomeworkOverdue(it);
    const isLoadingMeta = !!it?.loadingMeta;
    const palette = globalThis.BjtuHomeworkUi.homeworkPalette({ done, overdue });
    const detail = isLoadingMeta ? '' : normalizeHomeworkContent(String(it?.content || '').trim());
    const contentHtml = isLoadingMeta
      ? '正在加载详情…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : (detail || `<span style="color:#999;">${globalThis.BjtuHomeworkUi.text.detailEmpty}</span>`);
    const expandableContentHtml = renderExpandableHtml(contentHtml, globalThis.BjtuHomeworkUi.detailOptions({
      baseBg: 'rgba(255,255,255,0.3)',
      flatDisplay: true
    }));
    const link = String(it?.link || JLGJ_WEB_BASE);
    const actionText = globalThis.BjtuHomeworkUi.actionLabel('jlgj', done ? 'view' : 'submit');
    const statusHtml = globalThis.BjtuHomeworkUi.statusHtml({ done, overdue });
    const deadline = it?.end || it?.deadline || '';
    const endText = isLoadingMeta ? '正在加载……' : formatJlgjDateTime(it.end);
    const endSuffix = isLoadingMeta
      ? ' <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;"></span>'
      : '';
    const countdownSpan = (!done && !overdue && !isLoadingMeta && deadline) ? `<span class="deadline-countdown" data-deadline="${escapeHtml(String(deadline))}" style="margin-left:4px; font-weight:normal; color:#e65100"></span>` : '';
    return globalThis.BjtuHomeworkUi.renderHomeworkCard({
      done,
      background: palette.background,
      border: palette.border,
      titleHtml: `<div style="font-weight:bold;color:${palette.foreground};">${escapeHtml(it.title || '接龙作业')}</div>`,
      metaHtml: `<div style="font-size:12px;color:#666;">截止: <span style="font-weight:700;color:#000;">${escapeHtml(endText)}</span>${endSuffix} ${statusHtml}${countdownSpan}</div>`,
      actionsHtml: globalThis.BjtuHomeworkUi.renderActionLink({ href: link, label: actionText, color: palette.action, escape: escapeHtml }),
      detailHtml: `<div style="margin-top:3px;border-top:1px dashed ${palette.border}40;padding-top:0;font-size:12px;color:#374151;line-height:1.45;">${expandableContentHtml}</div>`
    });
  }).join('');
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
    const card = globalThis.BjtuCourseCardUi.createCourseCard({
      courseId,
      className: 'jlgj-standalone-card',
      order: baseOrder + idx,
      titleHtml: `<a href="${JLGJ_WEB_BASE}" target="_blank" rel="noopener noreferrer" style="color:#ffd243;text-decoration:none;line-height:1.3;">${titleHtml}</a>`,
      metaHtml: `<div style="font-size:12px;color:#666;line-height:1.35;">${teacherHtml}</div>`,
      actionsHtml: '<button class="btn" style="background:#9C27B0;display:none;" data-action="videos">回放下载</button>',
      contentHtml: loadingMeta && !(c.homeworks || []).length
        ? '<div class="spinner" style="border-color:#2196F3;border-top-color:transparent;display:inline-block;"></div> 正在获取作业…'
        : ''
    });
    courseListDiv.appendChild(card);

    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    window.jlgjMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
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
  let keepBgTabOpen = false;
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
    const matchMap = new Map();

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

    let listResp = await waitAndFetchJlgjGroupListFromBrowser(
      30000,
      () => isStale() || !isPlatformEnabled('jlgj')
    );
    if (listResp?.tabId && Number.isFinite(Number(listResp.tabId))) {
      bgTab = { id: Number(listResp.tabId) };
    }
    if (listResp?.loginPageClosedUnauthenticated) {
      if (isPlatformEnabled('jlgj')) {
        togglePlatformSelection('jlgj', { interactive: false, persist: true });
      }
      return;
    }
    if (isStale() || !isPlatformEnabled('jlgj') || listResp?.aborted) return;

    keepBgTabOpen = !!listResp?.keepOpen;

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
    if (bgTab?.id && !keepBgTabOpen) {
      await closeJlgjBackgroundTabAndReturnToApp(bgTab.id);
    }
  }
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
