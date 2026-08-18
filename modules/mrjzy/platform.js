const MRJZY_API_BASE = 'https://lulu.lulufind.com';
const MRJZY_WEB_BASE = 'https://zuoye.lulufind.com';
const MRJZY_WORK_LIST_API = `${MRJZY_API_BASE}/mrzy/mrzypc/findWorkNewVersion`;
const MRJZY_WORK_DETAIL_API = `${MRJZY_API_BASE}/mrzy/mrzypc/getWorkDetail`;
const MRJZY_QR_GEN_API = 'https://api-prod.lulufind.com/api/v1/auth/genQrCode';
const MRJZY_QR_CHECK_API = 'https://api-prod.lulufind.com/api/v1/auth/checkQrCode';
const MRJZY_QR_SCAN_LINK_BASE = 'https://f.mrzuoye.com/pcscan/';
let mrjzyLoginAssistPollTimer = null;
let mrjzyLoginAssistRetryTimer = null;
let mrjzyLoginAssistPolling = false;
let mrjzyLoginAssistCurrentCode = '';
let mrjzyLoginAssistCodeSerial = 0;
let mrjzyActiveRuntimeCtx = null;

// Platform-specific functions extracted from app.js. Shared helpers remain global.

async function closeMrjzyOwnedRuntimeTab(runtimeCtx) {
  if (!runtimeCtx) return;
  if (runtimeCtx.closePromise) return runtimeCtx.closePromise;
  runtimeCtx.closePromise = (async () => {
    if (runtimeCtx.creatingTabPromise) {
      try { await runtimeCtx.creatingTabPromise; } catch { /* ignore */ }
    }
    if (runtimeCtx.createdTab && runtimeCtx.tabId) {
      try { await chrome.tabs.remove(Number(runtimeCtx.tabId)); } catch { /* ignore */ }
    }
    runtimeCtx.tabId = null;
    runtimeCtx.createdTab = false;
  })().finally(() => {
    runtimeCtx.closePromise = null;
  });
  return runtimeCtx.closePromise;
}

function cancelMrjzyActiveLoad() {
  const runtimeCtx = mrjzyActiveRuntimeCtx;
  if (!runtimeCtx) return Promise.resolve();
  runtimeCtx.cancelled = true;
  return closeMrjzyOwnedRuntimeTab(runtimeCtx);
}

function formatMrjzyDateTime(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function ensureMrjzyLoginTip() {
  return null;
}

function removeMrjzyLoginTip() {
  // no-op: use toast messages instead of fixed top tip.
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
    mask.classList.remove('show');
  }
  stopMrjzyLoginAssistPolling();
  if (cancelPending) {
    window.platformInteractiveLoginPending.mrjzy = false;
    if (String(window.platformLoginState?.mrjzy || '') === 'checking') {
      setPlatformLoginState('mrjzy', 'offline');
    }
  }
}

function ensureMrjzyLoginAssistPopup() {
  let mask = document.getElementById('mrjzy-login-assist-mask');
  if (mask instanceof HTMLElement) return mask;

  mask = document.createElement('div');
  mask.id = 'mrjzy-login-assist-mask';
  mask.className = 'version-modal-mask platform-qr-login-mask mrjzy-login-assist-mask';
  mask.innerHTML = `
    <div class="version-modal-card platform-qr-login-card mrjzy-login-assist-card">
      <div class="version-modal-header">
        <div class="platform-qr-login-title mrjzy-login-assist-title">登录每日交作业</div>
        <button type="button" data-action="close-mrjzy-login-assist" class="btn version-close-btn" aria-label="关闭" title="关闭">×</button>
      </div>
      <div class="platform-qr-login-body mrjzy-login-assist-body">
        <div id="mrjzy-login-assist-status" class="platform-qr-login-status">
          <span class="spinner mrjzy-inline-spinner"></span> 正在获取登录二维码…
        </div>
        <img id="mrjzy-login-assist-qr" class="platform-qr-login-image" alt="每日交作业微信登录二维码" title="点击刷新二维码" hidden />
        <div class="platform-qr-login-tip mrjzy-login-assist-hint">请使用微信扫码登录</div>
      </div>
    </div>
  `;
  document.body.appendChild(mask);

  const closeBtn = mask.querySelector('button[data-action="close-mrjzy-login-assist"]');
  if (closeBtn instanceof HTMLButtonElement) {
    closeBtn.addEventListener('click', () => closeMrjzyLoginAssistPopup(true));
  }
  mask.addEventListener('pointerdown', (e) => {
    mask.dataset.pointerStartedOnMask = e.target === mask ? '1' : '0';
  });
  mask.addEventListener('pointerup', (e) => {
    if (e.target === mask && mask.dataset.pointerStartedOnMask === '1') {
      closeMrjzyLoginAssistPopup(true);
    }
    delete mask.dataset.pointerStartedOnMask;
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
  qrImg.hidden = true;
  if (statusEl instanceof HTMLElement) {
    statusEl.innerHTML = '<span class="spinner mrjzy-inline-spinner"></span> 正在获取登录二维码…';
  }
  try {
    const code = await requestMrjzyLoginAssistQrCode();
    if (serial !== mrjzyLoginAssistCodeSerial) return;
    mrjzyLoginAssistCurrentCode = code;
    const qrUrl = `${MRJZY_QR_SCAN_LINK_BASE}${code}`;
    applyQrImageToElement(qrImg, qrUrl, 260);
    qrImg.hidden = false;
    if (statusEl instanceof HTMLElement) {
      statusEl.textContent = '等待扫码确认…';
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
  mask.classList.add('show');
  mrjzyLoginAssistCurrentCode = '';
  void refreshMrjzyLoginAssistQrCode(false);
}

function clearMrjzyStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.mrjzy-standalone-card');
  cards.forEach((n) => n.remove());
  updateCourseListEmptyPlaceholder();
}

function renderMrjzyNeedLoginMessage() {
  const shouldOpenAssist = !!window.platformInteractiveLoginPending?.mrjzy;
  window.platformLoadedOnce.mrjzy = false;
  clearPlatformData('mrjzy');
  rerenderAllHomeworkAreas();

  if (shouldOpenAssist) {
    // 二维码登录弹窗将打开：保持 checking，等弹窗关闭后再给出登录结果。
    setPlatformLoginState('mrjzy', 'checking');
    openMrjzyLoginAssistPopup(true);
    return;
  }

  setPlatformLoginState('mrjzy', 'offline');
  closeMrjzyLoginAssistPopup(true);
  window.platformNeedLogin.mrjzy = false;
  refreshPlatformLoginTip();
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
    const palette = globalThis.BjtuHomeworkUi.homeworkPalette({ done, overdue });
    const actionText = globalThis.BjtuHomeworkUi.actionLabel('mrjzy', done ? 'view' : 'submit');
    const isLoadingMeta = !!it?.loadingMeta;
    const deadline = it?.end || it?.deadline || '';
    const endText = isLoadingMeta ? '正在加载……' : String(it.end || '无');
    const endSuffix = isLoadingMeta
      ? ` <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>`
      : '';
    return globalThis.BjtuHomeworkUi.renderHomeworkCard({
      done,
      background: palette.background,
      border: palette.border,
      titleHtml: globalThis.BjtuHomeworkUi.titleHtml({ title: it.title || '每日交作业', color: palette.foreground, href: it.link, escape: escapeHtml }),
      metaHtml: globalThis.BjtuHomeworkUi.deadlineMetaHtml({ deadline, formatted: endText, done, overdue, loading: isLoadingMeta, suffixHtml: endSuffix, escape: escapeHtml }),
      actionsHtml: globalThis.BjtuHomeworkUi.renderActionLink({ href: it.link, label: actionText, color: palette.action, escape: escapeHtml })
    });
  }).join('');
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
      ? `正在加载…… <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:1px; border-color:#6366f1; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>`
      : `<a href="${MRJZY_WEB_BASE}/" target="_blank" rel="noopener noreferrer" style="color:#29a9fc; text-decoration:none;">${escapeHtml(c.divClass || '每日交作业课程')}</a>`;
    const teacherHtml = loadingMeta
      ? `正在加载…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>`
      : escapeHtml(c.teacherName || '');
    const card = globalThis.BjtuCourseCardUi.createCourseCard({
      courseId,
      className: 'mrjzy-standalone-card',
      order: baseOrder + idx,
      titleHtml,
      metaHtml: `<div style="font-size:13px;color:#666;line-height:1.35;">${teacherHtml}</div>`,
      actionsHtml: '<button class="btn" style="background:#9C27B0;display:none;" data-action="videos">回放下载</button>'
    });
    courseListDiv.appendChild(card);

    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    window.mrjzyMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
}

async function postMrjzyForm(url, paramsObj, runtimeCtx = null) {
  const MRJZY_SIGN_SALT = 'IF75D4U19LKLDAZSMPN5ATQLGBFEJL4VIL2STVDBNJJTO6LNOGB265CR40I4AL13';
  const throwIfCancelled = () => {
    if (runtimeCtx?.cancelled) {
      throw Object.assign(new Error('每日交作业加载已取消'), { code: 'cancelled' });
    }
  };
  throwIfCancelled();

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
              const existingTabs = await chrome.tabs.query({ url: ['https://zuoye.lulufind.com/*'] }).catch(() => []);
              const reusableTab = (existingTabs || []).find((item) => item?.id && item.status === 'complete');
              if (reusableTab?.id) {
                ctx.tabId = Number(reusableTab.id);
                ctx.createdTab = false;
                return ctx.tabId;
              }
const t = await chrome.tabs.create({ url: 'https://zuoye.lulufind.com/', active: false });
              void groupBjtuOpenedTab(t?.id);
              ctx.tabId = Number(t?.id || 0) || null;
              ctx.createdTab = true;
              if (ctx.cancelled) {
                if (ctx.tabId) {
                  try { await chrome.tabs.remove(Number(ctx.tabId)); } catch { /* ignore */ }
                }
                ctx.tabId = null;
                ctx.createdTab = false;
                throw Object.assign(new Error('每日交作业加载已取消'), { code: 'cancelled' });
              }
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
            void groupBjtuOpenedTab(tab?.id);
            created = true;
          }
        }
      }
      if (!tab?.id) throw new Error('NO_TAB');
      throwIfCancelled();
      await waitTabReady(tab.id, 15000);
      throwIfCancelled();

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
    } catch (error) {
      if (runtimeCtx?.cancelled || error?.code === 'cancelled') throw error;
      // fallback to direct fetch below
    }
  }

  throwIfCancelled();
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
    } catch (error) {
      if (runtimeCtx?.cancelled || error?.code === 'cancelled') throw error;
      // fallback to direct response below
    }
  }
  return { res, data, text };
}

async function loadMrjzyCoursesAndHomework(courses, loadVersion = 0) {
  const mrjzyRuntimeCtx = {
    tabId: null,
    createdTab: false,
    creatingTabPromise: null,
    closePromise: null,
    cancelled: false,
    preferPageContext: true
  };
  mrjzyActiveRuntimeCtx = mrjzyRuntimeCtx;
  const shouldAbort = () => mrjzyRuntimeCtx.cancelled
    || !!(loadVersion && loadVersion !== (window.platformLoadVersion?.mrjzy || 0))
    || !isPlatformEnabled('mrjzy');
  if (shouldAbort()) {
    if (mrjzyActiveRuntimeCtx === mrjzyRuntimeCtx) mrjzyActiveRuntimeCtx = null;
    return;
  }
  if (!isPlatformEnabled('mrjzy')) {
    clearPlatformData('mrjzy');
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('mrjzy', 'checking');
  const closeMrjzyRuntimeTab = async () => {
    await closeMrjzyOwnedRuntimeTab(mrjzyRuntimeCtx);
    if (mrjzyActiveRuntimeCtx === mrjzyRuntimeCtx) mrjzyActiveRuntimeCtx = null;
  };

  const pickMrjzyCourseName = (w) => {
    const v = String(w?.divClass || w?.className || w?.courseName || w?.course_name || w?.workClass || '').trim();
    return v || '每日交作业课程';
  };
  const pickMrjzyTeacherName = (w) => String(w?.teacherName || w?.teacher_name || w?.teacherRealName || w?.userRealName || w?.teacher || '').trim();
  const pickMrjzyDeadline = (w) => String(w?.workRemark || w?.endTime || w?.end || w?.deadline || '').trim();
  const pickMrjzyTitle = (w) => String(w?.workDetail || w?.title || '').trim() || `作业 ${w?.workId || ''}`;

  const matchMap = new Map();
  const endTime = todayEndDateTimeString();
  const listResp = await postMrjzyForm(MRJZY_WORK_LIST_API, {
    start: 0,
    num: 12,
    beginTime: '1990-01-01 00:00:00',
    endTime,
    limit: 1
  }, mrjzyRuntimeCtx);
  if (shouldAbort()) {
    await closeMrjzyRuntimeTab();
    return;
  }

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

  let completedDetailLoads = 0;
  setPlatformContentLoadProgress('mrjzy', 0, works.length);
  const detailTasks = works.map(async (w) => {
    const dr = await postMrjzyForm(MRJZY_WORK_DETAIL_API, { workId: w.workId }, mrjzyRuntimeCtx);
    const teacherName = dr?.data?.data?.teacher?.userRealName || '';
    return { workId: w.workId, teacherName };
  });
  const detailSettled = await Promise.allSettled(detailTasks.map((task) => task.finally(() => {
    if (shouldAbort()) return;
    completedDetailLoads += 1;
    setPlatformContentLoadProgress('mrjzy', completedDetailLoads, works.length);
  })));
  if (shouldAbort()) {
    await closeMrjzyRuntimeTab();
    return;
  }
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

function scheduleMrjzyLoad(courses, loadVersion = 0) {
  if (!isPlatformEnabled('mrjzy')) return Promise.resolve();
  const list = Array.isArray(courses) ? courses : [];
  if (!window.__mrjzyLoadSerialPromise) window.__mrjzyLoadSerialPromise = Promise.resolve();
  window.__mrjzyLoadSerialPromise = window.__mrjzyLoadSerialPromise
    .catch(() => {})
    .then(() => loadMrjzyCoursesAndHomework(list, loadVersion));
  return window.__mrjzyLoadSerialPromise;
}

/* ================= qwen 页面桥（service worker 经 app 页面调用） ================= */

function mrjzyPageSnapshot() {
  return Array.isArray(window.mrjzyCourseGroupsSnapshot) ? window.mrjzyCourseGroupsSnapshot : [];
}

async function ensureMrjzyLoaded() {
  if (mrjzyPageSnapshot().length) return;
  try {
    await scheduleMrjzyLoad([], Date.now());
  } catch {
    /* 忽略触发失败，交由读取方判断 loaded */
  }
}

async function mrjzyPageCourseList() {
  await ensureMrjzyLoaded();
  const snap = mrjzyPageSnapshot();
  return {
    loaded: snap.length > 0,
    loginState: String(window.platformLoginState?.mrjzy || 'checking'),
    courses: snap.map((group) => ({
      classNum: String(group?.classNum || ''),
      divClass: String(group?.divClass || ''),
      teacherName: String(group?.teacherName || ''),
      homeworkCount: Array.isArray(group?.homeworks) ? group.homeworks.length : 0
    }))
  };
}

async function mrjzyPageHomeworkOf(classNum) {
  const key = String(classNum || '').trim();
  if (!key) return { ok: false, message: '缺少参数 classNum，请先调用 mrjzy.courseList 获取班级号' };
  await ensureMrjzyLoaded();
  const group = mrjzyPageSnapshot().find((g) => {
    const a = String(g?.classNum || '').trim();
    const b = String(g?.divClass || '').trim();
    return a === key || b === key;
  }) || null;
  if (!group) return { ok: false, message: `班级号无效：${key} 不在每日交作业课程列表中，请先调用 mrjzy.courseList 获取有效班级号` };
  return {
    ok: true,
    classNum: String(group?.classNum || ''),
    divClass: String(group?.divClass || ''),
    teacherName: String(group?.teacherName || ''),
    homework: (Array.isArray(group?.homeworks) ? group.homeworks : []).map((hw) => ({
      workId: hw?.workId,
      title: hw?.title,
      end: hw?.end,
      submit: Number(hw?.submit || 0),
      isSubmit: Number(hw?.isSubmit || 0),
      done: !!hw?.done,
      link: hw?.link
    }))
  };
}

async function mrjzyPageLoginStatus() {
  const state = String(window.platformLoginState?.mrjzy || 'checking');
  return { loginState: state, loggedIn: state === 'online', snapshotLoaded: mrjzyPageSnapshot().length > 0 };
}

async function mrjzyPageLogin(args = {}) {
  const platform = 'mrjzy';
  const enabled = typeof isPlatformEnabled === 'function' ? isPlatformEnabled(platform) : true;
  if (enabled) {
    if (typeof triggerExternalPlatformLoad === 'function') {
      try { triggerExternalPlatformLoad(platform, true); } catch {}
    }
  } else if (typeof togglePlatformSelection === 'function') {
    try { togglePlatformSelection(platform, { interactive: true }); } catch {}
  }
  return await waitForPlatformLoginResult(platform, Number(args?.timeoutMs) || 120000);
}

globalThis.BjtuMrjzyPageApi = Object.freeze({
  courseList: () => mrjzyPageCourseList(),
  homework_of_: (args) => mrjzyPageHomeworkOf(String(args?.classNum || args?.courseId || '').trim()),
  loginStatus: () => mrjzyPageLoginStatus(),
  login: (args) => mrjzyPageLogin(args)
});

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'PAGE_API' || message?.payload?.module !== 'mrjzy') return false;
    const api = globalThis.BjtuMrjzyPageApi;
    const fn = api && typeof api[String(message.payload?.fn || '')] === 'function' ? api[String(message.payload.fn)] : null;
    if (!fn) {
      sendResponse({ ok: false, error: 'MRJZY 页面接口不存在' });
      return true;
    }
    Promise.resolve(fn(message.payload?.args || {})).then(
      (value) => sendResponse({ ok: true, value }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error), code: String(error?.code || '') })
    );
    return true;
  });
}
