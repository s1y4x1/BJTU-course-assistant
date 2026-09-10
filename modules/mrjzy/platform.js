const MRJZY_API_BASE = 'https://lulu.lulufind.com';
const MRJZY_WEB_BASE = 'https://zuoye.lulufind.com';
const MRJZY_WORK_LIST_API = `${MRJZY_API_BASE}/mrzy/mrzypc/findWorkNewVersion`;
const MRJZY_WORK_DETAIL_API = `${MRJZY_API_BASE}/mrzy/mrzypc/getWorkDetail`;
const MRJZY_QR_GEN_API = 'https://api-prod.lulufind.com/api/v1/auth/genQrCode';
const MRJZY_QR_CHECK_API = 'https://api-prod.lulufind.com/api/v1/auth/checkQrCode';
const MRJZY_PASSWORD_LOGIN_API = 'https://api-prod.lulufind.com/api/v1/auth/smslogin';
const MRJZY_ALL_USERS_API = 'https://api-prod.lulufind.com/mrzy/v1/user/alluser';
const MRJZY_SWITCH_USER_API = 'https://api-prod.lulufind.com/mrzy/v1/user/switch_user';
const MRJZY_QR_SCAN_LINK_BASE = 'https://f.mrzuoye.com/pcscan/';
const MRJZY_HEADER_RULE_ID = 914306;
let mrjzyLoginAssistPollTimer = null;
let mrjzyLoginAssistRetryTimer = null;
let mrjzyLoginAssistPolling = false;
let mrjzyLoginAssistCurrentCode = '';
let mrjzyLoginAssistCodeSerial = 0;
let mrjzyPasswordLoginToken = '';
let mrjzyPasswordLoginPhone = '';
let mrjzyPasswordLoginBusy = false;
let mrjzyPasswordLoginSerial = 0;
let mrjzyActiveRuntimeCtx = null;
let mrjzyHeaderRulePromise = null;
let mrjzyAutoLoginPromise = null;
let mrjzyAutoLoginAttempted = false;
let mrjzyConfiguredClassSwitchSerial = 0;

// Platform-specific functions extracted from app.js. Shared helpers remain global.

function cancelMrjzyActiveLoad() {
  const runtimeCtx = mrjzyActiveRuntimeCtx;
  if (!runtimeCtx) return Promise.resolve();
  runtimeCtx.cancelled = true;
  return Promise.resolve();
}

function ensureMrjzyRequestHeaderRule() {
  if (mrjzyHeaderRulePromise) return mrjzyHeaderRulePromise;
  if (!chrome.declarativeNetRequest?.updateSessionRules) return Promise.resolve(false);
  mrjzyHeaderRulePromise = chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [MRJZY_HEADER_RULE_ID],
    addRules: [{
      id: MRJZY_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: MRJZY_WEB_BASE },
          { header: 'Referer', operation: 'set', value: `${MRJZY_WEB_BASE}/` }
        ]
      },
      condition: {
        regexFilter: '^https://lulu\\.lulufind\\.com/mrzy/mrzypc/(?:findWorkNewVersion|getWorkDetail)(?:\\?.*)?$',
        resourceTypes: ['xmlhttprequest'],
        requestMethods: ['post']
      }
    }]
  }).then(() => true).catch((error) => {
    mrjzyHeaderRulePromise = null;
    throw error;
  });
  return mrjzyHeaderRulePromise;
}

function formatMrjzyDateTime(dt) {
  const numeric = typeof dt === 'number' || /^\d{10,13}$/.test(String(dt || '').trim()) ? Number(dt) : NaN;
  const d = dt instanceof Date ? dt : new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : dt);
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
  mrjzyPasswordLoginSerial += 1;
  mrjzyPasswordLoginToken = '';
  mrjzyPasswordLoginPhone = '';
  mrjzyPasswordLoginBusy = false;
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
        <div id="mrjzy-login-methods" class="mrjzy-login-methods">
          <div class="mrjzy-qr-login-section">
            <div id="mrjzy-login-assist-status" class="platform-qr-login-status">
              <span class="spinner mrjzy-inline-spinner"></span> 正在获取登录二维码…
            </div>
            <img id="mrjzy-login-assist-qr" class="platform-qr-login-image" alt="每日交作业微信登录二维码" title="点击刷新二维码" hidden />
            <div class="platform-qr-login-tip mrjzy-login-assist-hint">请使用微信扫码登录</div>
          </div>
          <div class="mrjzy-login-divider"><span>或使用账密登录</span></div>
          <form id="mrjzy-password-login-form" class="mrjzy-password-login-form">
            <input id="mrjzy-login-phone" class="mrjzy-login-input" type="tel" inputmode="tel" autocomplete="username" placeholder="手机号" required />
            <input id="mrjzy-login-password" class="mrjzy-login-input" type="password" autocomplete="current-password" placeholder="密码" required />
            <button id="mrjzy-password-login-btn" class="btn mrjzy-password-login-btn" type="submit">登录</button>
            <div id="mrjzy-password-login-status" class="mrjzy-password-login-status" aria-live="polite"></div>
          </form>
        </div>
        <div id="mrjzy-account-picker" class="mrjzy-account-picker" hidden>
          <div class="mrjzy-account-picker-title">请选择要登录的身份</div>
          <div id="mrjzy-account-list" class="mrjzy-account-list"></div>
          <button type="button" class="btn mrjzy-account-picker-back" data-action="mrjzy-account-picker-back">返回</button>
        </div>
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

  const passwordForm = mask.querySelector('#mrjzy-password-login-form');
  if (passwordForm instanceof HTMLFormElement) {
    passwordForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitMrjzyPasswordLogin(mask);
    });
  }
  mask.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === 'mrjzy-switch-account') {
      void switchMrjzyPasswordAccount(
        mask,
        String(target.dataset.openId || '').trim(),
        String(target.dataset.classId || '').trim(),
        target
      );
    } else if (target.dataset.action === 'mrjzy-account-picker-back') {
      showMrjzyLoginMethods(mask);
    }
  });

  return mask;
}

async function requestMrjzyAccountApi(url, { method = 'GET', body = null, token = '' } = {}) {
  const headers = { Accept: 'application/json, text/plain, */*' };
  const tokenText = String(token || '').trim();
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (tokenText) {
    headers.token = tokenText;
    headers.Authorization = `Bearer ${tokenText}`;
  }
  const res = await fetch(url, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers,
    ...(body !== null ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) throw new Error(String(data?.desc || data?.message || `HTTP ${res.status}`));
  if (Number(data?.code) !== 200) {
    throw new Error(String(data?.desc || data?.message || `登录失败（${String(data?.code || '未知错误')}）`));
  }
  return data;
}

async function tryMrjzyConfiguredAutoLogin() {
  if (mrjzyAutoLoginPromise) return mrjzyAutoLoginPromise;
  mrjzyAutoLoginPromise = (async () => {
    const settings = await chrome.storage.local.get(['mrjzyAutoLoginEnabled', 'mrjzyAutoLoginAccount', 'mrjzyAutoLoginClass']);
    if (settings.mrjzyAutoLoginEnabled !== true
      || !String(settings.mrjzyAutoLoginAccount || '').trim()
      || !String(settings.mrjzyAutoLoginClass || '').trim()) return false;
    const response = await chrome.runtime.sendMessage({
      type: 'MRJZY_GET_SAVED_CREDENTIAL',
      loginName: String(settings.mrjzyAutoLoginAccount).trim()
    });
    const phone = String(response?.account?.phone || '').trim();
    const password = String(response?.account?.password || '');
    if (!response?.ok || !phone || !password) return false;
    const loginData = await requestMrjzyAccountApi(MRJZY_PASSWORD_LOGIN_API, {
      method: 'POST', body: { phone, password }
    });
    const accounts = Array.isArray(loginData?.data?.accounts) ? loginData.data.accounts : [];
    const loginAccount = accounts.find((account) => String(account?.token || '').trim()) || null;
    const token = String(loginAccount?.token || '').trim();
    if (!token) return false;
    const usersData = await requestMrjzyAccountApi(MRJZY_ALL_USERS_API, { token });
    const users = Array.isArray(usersData?.data?.users) ? usersData.data.users : [];
    chrome.runtime.sendMessage({
      type: 'MRJZY_PASSWORD_LOGIN_SUCCESS',
      payload: {
        phone,
        password,
        userName: String(loginAccount?.user?.userRealName || ''),
        identities: users
      }
    }).catch(() => {});
    const configuredClass = String(settings.mrjzyAutoLoginClass || '').split('\u001f');
    const preferredOpenId = String(configuredClass[0] || response?.account?.selectedOpenId || '').trim();
    const preferredClassId = String(configuredClass[1] || response?.account?.selectedClassId || '').trim();
    const user = users.find((item) => preferredOpenId && String(item?.openId || '').trim() === preferredOpenId);
    if (!user) return false;
    const switched = await requestMrjzyAccountApi(MRJZY_SWITCH_USER_API, {
      method: 'POST', token, body: { openId: String(user.openId).trim() }
    });
    const teacherToken = String(switched?.data?.token || '').trim();
    if (!teacherToken || !await persistMrjzyTeacherTokenCookie(teacherToken)) return false;
    chrome.runtime.sendMessage({
      type: 'MRJZY_SELECTED_IDENTITY',
      payload: { phone, openId: String(user.openId).trim(), classId: preferredClassId }
    }).catch(() => {});
    return true;
  })().finally(() => { mrjzyAutoLoginPromise = null; });
  return mrjzyAutoLoginPromise;
}

async function switchMrjzyConfiguredAutoLoginClass(expectedClass = '') {
  const serial = ++mrjzyConfiguredClassSwitchSerial;
  if (mrjzyActiveRuntimeCtx) {
    mrjzyActiveRuntimeCtx.cancelled = true;
    mrjzyActiveRuntimeCtx.controller?.abort();
  }
  if (mrjzyAutoLoginPromise) await mrjzyAutoLoginPromise.catch(() => false);
  if (serial !== mrjzyConfiguredClassSwitchSerial) return { ok: false, stale: true };
  const settings = await chrome.storage.local.get(['mrjzyAutoLoginEnabled', 'mrjzyAutoLoginClass']);
  if (settings.mrjzyAutoLoginEnabled !== true
    || String(settings.mrjzyAutoLoginClass || '') !== String(expectedClass || '')) {
    return { ok: false, stale: true };
  }
  mrjzyAutoLoginAttempted = false;
  const ok = await tryMrjzyConfiguredAutoLogin();
  if (serial !== mrjzyConfiguredClassSwitchSerial) return { ok: false, stale: true };
  if (ok) mrjzyAutoLoginAttempted = true;
  return { ok: !!ok, stale: false };
}

globalThis.BjtuMrjzySwitchConfiguredClass = switchMrjzyConfiguredAutoLoginClass;

function setMrjzyPasswordLoginBusy(mask, busy, status = '') {
  mrjzyPasswordLoginBusy = !!busy;
  const submit = mask?.querySelector('#mrjzy-password-login-btn');
  const phone = mask?.querySelector('#mrjzy-login-phone');
  const password = mask?.querySelector('#mrjzy-login-password');
  const statusEl = mask?.querySelector('#mrjzy-password-login-status');
  if (submit instanceof HTMLButtonElement) {
    submit.disabled = !!busy;
    submit.innerHTML = busy ? '<span class="spinner mrjzy-inline-spinner"></span> 登录中…' : '登录';
  }
  if (phone instanceof HTMLInputElement) phone.disabled = !!busy;
  if (password instanceof HTMLInputElement) password.disabled = !!busy;
  if (statusEl instanceof HTMLElement) statusEl.textContent = String(status || '');
}

function showMrjzyLoginMethods(mask) {
  const methods = mask?.querySelector('#mrjzy-login-methods');
  const picker = mask?.querySelector('#mrjzy-account-picker');
  if (methods instanceof HTMLElement) methods.hidden = false;
  if (picker instanceof HTMLElement) picker.hidden = true;
  mrjzyPasswordLoginToken = '';
  mrjzyPasswordLoginPhone = '';
  setMrjzyPasswordLoginBusy(mask, false, '');
  if (mrjzyLoginAssistCurrentCode) startMrjzyLoginAssistPolling();
}

function renderMrjzyAccountPicker(mask, users) {
  const methods = mask?.querySelector('#mrjzy-login-methods');
  const picker = mask?.querySelector('#mrjzy-account-picker');
  const list = mask?.querySelector('#mrjzy-account-list');
  if (!(picker instanceof HTMLElement) || !(list instanceof HTMLElement)) return;
  if (methods instanceof HTMLElement) methods.hidden = true;
  picker.hidden = false;
  const choices = users.flatMap((user) => {
    const openId = String(user?.openId || '').trim();
    const realName = String(user?.userRealName || '未命名用户').trim();
    const schoolName = String(user?.school?.schoolName || '未设置学校').trim();
    const groups = Array.isArray(user?.groups) && user.groups.length ? user.groups : [null];
    return groups.map((group) => ({
      openId,
      classId: String(group?.classId || '').trim(),
      realName,
      schoolName,
      className: String(group?.divClass || '未设置班级').trim()
    }));
  });
  list.innerHTML = choices.map((choice) => {
    return `<button type="button" class="mrjzy-account-choice" data-action="mrjzy-switch-account" data-open-id="${escapeHtml(choice.openId)}" data-class-id="${escapeHtml(choice.classId)}">
      <span class="mrjzy-account-choice-name">${escapeHtml(choice.realName)}</span>
      <span class="mrjzy-account-choice-school">${escapeHtml(choice.schoolName)}</span>
      <span class="mrjzy-account-choice-groups">${escapeHtml(choice.className)}</span>
    </button>`;
  }).join('');
}

async function submitMrjzyPasswordLogin(mask) {
  if (mrjzyPasswordLoginBusy) return;
  const phoneInput = mask?.querySelector('#mrjzy-login-phone');
  const passwordInput = mask?.querySelector('#mrjzy-login-password');
  if (!(phoneInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) return;
  const phone = phoneInput.value.trim();
  const password = passwordInput.value;
  if (!phone || !password) {
    setMrjzyPasswordLoginBusy(mask, false, '请输入手机号和密码');
    return;
  }

  stopMrjzyLoginAssistPolling();
  const serial = ++mrjzyPasswordLoginSerial;
  setMrjzyPasswordLoginBusy(mask, true, '正在验证账号…');
  try {
    const loginData = await requestMrjzyAccountApi(MRJZY_PASSWORD_LOGIN_API, {
      method: 'POST',
      body: { phone, password }
    });
    if (serial !== mrjzyPasswordLoginSerial) return;
    const accounts = Array.isArray(loginData?.data?.accounts) ? loginData.data.accounts : [];
    const loginAccount = accounts.find((account) => String(account?.token || '').trim()) || null;
    const token = String(loginAccount?.token || '').trim();
    if (!token) throw new Error('登录成功，但未返回账号 Token');
    const usersData = await requestMrjzyAccountApi(MRJZY_ALL_USERS_API, { token });
    if (serial !== mrjzyPasswordLoginSerial) return;
    const users = Array.isArray(usersData?.data?.users) ? usersData.data.users.filter((user) => String(user?.openId || '').trim()) : [];
    if (!users.length) throw new Error('未获取到可登录的身份');
    chrome.runtime.sendMessage({
      type: 'MRJZY_PASSWORD_LOGIN_SUCCESS',
      payload: {
        phone,
        password,
        userName: String(loginAccount?.user?.userRealName || ''),
        identities: users
      }
    }).catch(() => {});
    mrjzyPasswordLoginToken = token;
    mrjzyPasswordLoginPhone = phone;
    passwordInput.value = '';
    setMrjzyPasswordLoginBusy(mask, false, '');
    renderMrjzyAccountPicker(mask, users);
  } catch (error) {
    if (serial !== mrjzyPasswordLoginSerial) return;
    setMrjzyPasswordLoginBusy(mask, false, String(error?.message || error || '登录失败'));
    if (mrjzyLoginAssistCurrentCode) startMrjzyLoginAssistPolling();
  }
}

async function switchMrjzyPasswordAccount(mask, openId, classId, target) {
  if (mrjzyPasswordLoginBusy || !openId || !mrjzyPasswordLoginToken) return;
  mrjzyPasswordLoginBusy = true;
  const serial = ++mrjzyPasswordLoginSerial;
  const buttons = mask?.querySelectorAll('.mrjzy-account-choice, .mrjzy-account-picker-back') || [];
  buttons.forEach((button) => { if (button instanceof HTMLButtonElement) button.disabled = true; });
  const originalHtml = target instanceof HTMLButtonElement ? target.innerHTML : '';
  if (target instanceof HTMLButtonElement) {
    target.innerHTML = `${originalHtml}<span class="mrjzy-account-choice-loading"><span class="spinner mrjzy-inline-spinner"></span> 正在切换…</span>`;
  }
  try {
    const data = await requestMrjzyAccountApi(MRJZY_SWITCH_USER_API, {
      method: 'POST',
      token: mrjzyPasswordLoginToken,
      body: { openId }
    });
    if (serial !== mrjzyPasswordLoginSerial) return;
    const token = String(data?.data?.token || '').trim();
    if (!token) throw new Error('切换身份成功，但未返回账号 Token');
    if (!await persistMrjzyTeacherTokenCookie(token)) throw new Error('保存登录凭据失败');
    chrome.runtime.sendMessage({
      type: 'MRJZY_SELECTED_IDENTITY',
      payload: { phone: mrjzyPasswordLoginPhone, openId, classId }
    }).catch(() => {});
    mrjzyPasswordLoginToken = '';
    mrjzyPasswordLoginPhone = '';
    mrjzyPasswordLoginBusy = false;
    showToast('每日交作业登录成功', 'success', 1800);
    closeMrjzyLoginAssistPopup(false);
    scheduleMrjzyLoginAssistRecheck(350);
  } catch (error) {
    if (serial !== mrjzyPasswordLoginSerial) return;
    mrjzyPasswordLoginBusy = false;
    buttons.forEach((button) => { if (button instanceof HTMLButtonElement) button.disabled = false; });
    if (target instanceof HTMLButtonElement) target.innerHTML = originalHtml;
    showToast(`每日交作业登录失败：${String(error?.message || error)}`, 'error', 2600);
  }
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
  showMrjzyLoginMethods(mask);
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
      metaHtml: globalThis.BjtuHomeworkUi.deadlineMetaHtml({
        deadline,
        formatted: endText,
        startTime: it?.start || '',
        startFormatted: isLoadingMeta ? '' : (formatMrjzyDateTime(it?.start) || String(it?.start || '')),
        done,
        overdue,
        loading: isLoadingMeta,
        suffixHtml: endSuffix,
        escape: escapeHtml
      }),
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
  await ensureMrjzyRequestHeaderRule();

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
    Pragma: 'no-cache'
  };
  if (sign) headers.sign = sign;
  if (token) headers.token = token;

  throwIfCancelled();
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers,
    body: bodyRaw,
    signal: runtimeCtx?.controller?.signal
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }

  return { res, data, text };
}

async function loadMrjzyCoursesAndHomework(courses, loadVersion = 0) {
  const mrjzyRuntimeCtx = {
    cancelled: false,
    controller: new AbortController()
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
  const finishMrjzyRuntime = async () => {
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
    await finishMrjzyRuntime();
    return;
  }

  if (listResp.res.status === 401 || listResp.res.status === 403) {
    if (!mrjzyAutoLoginAttempted) {
      mrjzyAutoLoginAttempted = true;
      if (await tryMrjzyConfiguredAutoLogin().catch(() => false)) {
        scheduleMrjzyLoginAssistRecheck(350);
        await finishMrjzyRuntime();
        return;
      }
    }
    window.platformLoadedOnce.mrjzy = true;
    await finishMrjzyRuntime();
    renderMrjzyNeedLoginMessage();
    return;
  }
  if (!listResp.data || Number(listResp.data.code) !== 200) {
    window.platformLoadedOnce.mrjzy = true;
    await finishMrjzyRuntime();
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
    setPlatformContentLoadProgress('mrjzy', 0, 0);
    await finishMrjzyRuntime();
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
      start: '',
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
    await finishMrjzyRuntime();
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
      start: w?.workTime ?? '',
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

  await finishMrjzyRuntime();
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

async function mrjzyPageCourseList() {
  if (window.__mrjzyLoadSerialPromise && typeof window.__mrjzyLoadSerialPromise.then === 'function') {
    await window.__mrjzyLoadSerialPromise.catch(() => {});
  }
  const snap = mrjzyPageSnapshot();
  const loginState = String(window.platformLoginState?.mrjzy || 'checking');
  return {
    loaded: snap.length > 0,
    loginState,
    loggedIn: loginState === 'online',
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
  const loginState = String(window.platformLoginState?.mrjzy || 'checking');
  if (loginState !== 'online') return { ok: false, code: 'LOGIN_REQUIRED', loggedIn: false, message: '每日交作业未登录，请先调用 mrjzy.login' };
  if (window.__mrjzyLoadSerialPromise && typeof window.__mrjzyLoadSerialPromise.then === 'function') {
    await window.__mrjzyLoadSerialPromise.catch(() => {});
  }
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
    return globalThis.getEnabledPlatformLoginResult(platform);
  } else if (typeof togglePlatformSelection === 'function') {
    try { togglePlatformSelection(platform, { interactive: true }); } catch {}
  }
  return await waitForPlatformLoginResult(platform, Number(args?.timeoutMs) || 120000);
}

globalThis.BjtuMrjzyPageApi = Object.freeze({
  courseList: () => mrjzyPageCourseList(),
  homework_of_: (args) => mrjzyPageHomeworkOf(String(args?.classNum || args?.courseId || '').trim()),
  status: () => mrjzyPageLoginStatus(),
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
