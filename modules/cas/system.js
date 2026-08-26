(function (global) {
  'use strict';

  const LOGIN_URL = 'https://cas.bjtu.edu.cn/auth/login/';
  const PROFILE_URL = 'https://cas.bjtu.edu.cn/profile/';
  const MIS_SLOGOUT_URL = 'https://mis.bjtu.edu.cn/auth/slogout/';
  const ACCOUNTS_KEY = 'casAccounts';
  const LOGIN_NAME_KEY = 'casLoginName';
  const SWITCH_MIS_LOGOUT_KEY = 'casSwitchMisLogoutEnabled';
  const STATUS_TYPE = 'CAS_SYSTEM_STATUS';
  const MANUAL_CAPTCHA_TTL_MS = 5 * 60 * 1000;
  const MANUAL_CAPTCHA_SESSION_PREFIX = 'casManualCaptcha:';
  const LOGIN_HEADER_RULE_ID = 914303;

  const pendingCredentialsByTab = new Map();
  const pendingManualCaptchas = new Map();
  let accountWritePromise = Promise.resolve();

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function decodeHtmlEntities(value) {
    const named = {
      amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"'
    };
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const token = String(entity || '').toLowerCase();
      if (token.startsWith('#x')) return String.fromCodePoint(parseInt(token.slice(2), 16));
      if (token.startsWith('#')) return String.fromCodePoint(parseInt(token.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(named, token) ? named[token] : match;
    });
  }

  function textFromHtml(value) {
    return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
      .replace(/[\t ]+/g, ' ').replace(/\r/g, '').trim();
  }

  async function broadcastStatus(payload) {
    const status = { ...payload, ts: Date.now() };
    try {
      chrome.runtime.sendMessage({ type: STATUS_TYPE, payload: status }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // No extension page may be open.
    }
  }

  async function showCasPageToast(tabId, message) {
    if (!tabId) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (content) => {
        const id = '__bjtu_cas_login_toast__';
        document.getElementById(id)?.remove();
        const toast = document.createElement('div');
        toast.id = id;
        toast.textContent = content;
        toast.style.cssText = [
          'position:fixed', 'left:50%', 'top:18px', 'transform:translateX(-50%)',
          'z-index:2147483647', 'background:#16a34a', 'color:#fff',
          'font:600 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
          'padding:10px 14px', 'border-radius:8px', 'box-shadow:0 10px 30px rgba(0,0,0,.22)'
        ].join(';');
        document.documentElement.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
      },
      args: [String(message || '')]
    }).catch(() => {});
  }

  async function getCasAccounts() {
    const stored = await chrome.storage.local.get([ACCOUNTS_KEY]);
    const rawAccounts = stored?.[ACCOUNTS_KEY] && typeof stored[ACCOUNTS_KEY] === 'object'
      ? stored[ACCOUNTS_KEY]
      : {};
    const accounts = {};
    for (const [loginName, source] of Object.entries(rawAccounts)) {
      const id = String(loginName || '').trim();
      if (!id) continue;
      accounts[id] = {
        loginName: id,
        userName: String(source?.userName || ''),
        password: String(source?.password || ''),
        updatedAt: Number(source?.updatedAt || 0),
        lastLoginAt: Number(source?.lastLoginAt || 0)
      };
    }
    return accounts;
  }

  async function saveCasAccount(loginName, patch = {}) {
    const id = String(loginName || '').trim();
    if (!id) throw new Error('账号为空');
    const write = accountWritePromise.then(async () => {
      const accounts = await getCasAccounts();
      const current = accounts[id]
        || { loginName: id, userName: '', password: '', updatedAt: 0, lastLoginAt: 0 };
      accounts[id] = {
        ...current,
        ...patch,
        loginName: id,
        userName: patch.userName === undefined ? String(current.userName || '') : String(patch.userName || ''),
        password: patch.password === undefined ? String(current.password || '') : String(patch.password || ''),
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts, [LOGIN_NAME_KEY]: id });
      return accounts[id];
    });
    accountWritePromise = write.catch(() => {});
    return write;
  }

  async function clearCasCookies() {
    const cookies = await chrome.cookies.getAll({ domain: 'cas.bjtu.edu.cn' }).catch(() => []);
    await Promise.all((cookies || []).map((cookie) => {
      const host = String(cookie.domain || 'cas.bjtu.edu.cn').replace(/^\./, '');
      const path = String(cookie.path || '/');
      return chrome.cookies.remove({
        url: `https://${host}${path}`,
        name: cookie.name,
        storeId: cookie.storeId
      }).catch(() => null);
    }));
  }

  // 解析 /profile/ 页中 table.table-bordered.table-hover 的 th/td 键值对。
  function parseProfilePage(html) {
    const source = String(html || '');
    const table = [...source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
      .find((match) => /\bclass\s*=\s*["'][^"']*\btable-bordered\b[^"']*["']/i.test(match[1]));
    const pairs = {};
    for (const match of String(table?.[2] || source).matchAll(
      /<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi
    )) {
      const key = textFromHtml(match[1]);
      if (key && !(key in pairs)) pairs[key] = textFromHtml(match[2]);
    }
    return {
      userName: String(pairs['姓名'] || '').trim(),
      email: String(pairs['电子邮箱'] || '').trim()
    };
  }

  async function fetchCasProfile() {
    const response = await fetch(PROFILE_URL, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`CAS 个人信息页 HTTP ${response.status}`);
    const html = await response.text();
    try {
      if (/^\/auth\/login(?:\/|$)/i.test(new URL(response.url, PROFILE_URL).pathname)) return null;
    } catch {
      // Fall through to parsing the returned page.
    }
    const profile = parseProfilePage(html);
    return profile.userName ? profile : null;
  }

  function htmlAttribute(tag, name) {
    const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
      .exec(String(tag || ''));
    return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
  }

  function inputValueFromHtml(html, name) {
    for (const match of String(html || '').matchAll(/<input\b[^>]*>/gi)) {
      if (htmlAttribute(match[0], 'name') === name) return htmlAttribute(match[0], 'value');
    }
    return '';
  }

  function captchaImageSrcFromHtml(html) {
    const source = String(html || '');
    const container = /<[^>]+class\s*=\s*["'][^"']*\byzm\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/i.exec(source)?.[0] || '';
    const imageTag = /<img\b[^>]*>/i.exec(container)?.[0]
      || [...source.matchAll(/<img\b[^>]*>/gi)]
        .map((match) => match[0])
        .find((tag) => htmlAttribute(tag, 'alt').toLowerCase() === 'captcha')
      || '';
    return htmlAttribute(imageTag, 'src');
  }

  async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
  }

  async function installLoginHeaderRule() {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [LOGIN_HEADER_RULE_ID],
      addRules: [{
        id: LOGIN_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: 'https://cas.bjtu.edu.cn' },
            { header: 'Referer', operation: 'set', value: LOGIN_URL }
          ]
        },
        condition: {
          regexFilter: '^https://cas\\.bjtu\\.edu\\.cn/auth/login/?(?:\\?.*)?$',
          resourceTypes: ['xmlhttprequest'],
          requestMethods: ['post']
        }
      }]
    });
  }

  async function removeLoginHeaderRule() {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [LOGIN_HEADER_RULE_ID]
    }).catch(() => {});
  }

  // 第一步：GET 登录页，响应标头中的 Set-Cookie 会更新 csrftoken，
  // 页面中的 csrfmiddlewaretoken 与 captcha_0 / 验证码图片随之刷新。
  async function readLoginPage() {
    const response = await fetch(LOGIN_URL, {
      credentials: 'include', cache: 'no-store', redirect: 'follow'
    });
    if (!response.ok) return { ok: false, message: `CAS 登录页 HTTP ${response.status}` };
    const html = await response.text();
    let csrf = inputValueFromHtml(html, 'csrfmiddlewaretoken');
    if (!csrf) {
      const cookie = await chrome.cookies.get({ url: LOGIN_URL, name: 'csrftoken' }).catch(() => null);
      csrf = String(cookie?.value || '');
      try { csrf = decodeURIComponent(csrf); } catch { /* keep raw value */ }
    }
    const captchaKey = inputValueFromHtml(html, 'captcha_0');
    const captchaImageSrc = captchaImageSrcFromHtml(html);
    if (!csrf) return { ok: false, message: 'CAS 登录页中未找到 CSRF Token' };
    if (!captchaKey || !captchaImageSrc) return { ok: false, message: 'CAS 登录页中未找到验证码' };
    const captchaImageUrl = new URL(captchaImageSrc, response.url || LOGIN_URL).href;
    let captchaImageDataUrl = '';
    try {
      const imageResponse = await fetch(captchaImageUrl, {
        credentials: 'include', cache: 'no-store'
      });
      if (imageResponse.ok) captchaImageDataUrl = await blobToDataUrl(await imageResponse.blob());
    } catch {
      // 仍返回原始图片地址，由选项页尝试直接显示。
    }
    return { ok: true, csrf, captchaKey, captchaImageUrl, captchaImageDataUrl };
  }

  async function recognizeCasCaptcha(imageUrl) {
    if (!global.BjtuCaptchaRecognizer?.recognizeMisCaptcha) {
      throw Object.assign(new Error('本地验证码识别模块尚未就绪'), { code: 'captcha-module-missing' });
    }
    try {
      const response = await fetch(String(imageUrl || ''), {
        credentials: 'include', cache: 'no-store'
      });
      if (!response.ok) throw new Error(`验证码图片 HTTP ${response.status}`);
      const blob = await response.blob();
      const result = await global.BjtuCaptchaRecognizer.recognizeMisCaptcha(blob);
      const answer = Number(result?.answer);
      if (!Number.isFinite(answer)) throw new Error('识别结果为空');
      return answer;
    } catch (error) {
      throw Object.assign(
        new Error(`CAS 验证码识别失败：${String(error?.message || error)}`),
        { code: String(error?.code || '') }
      );
    }
  }

  // 第二步：POST urlencoded 表单。302（fetch 跟随重定向）即登录成功；
  // 返回 200 且页面包含 p.tishi（用户密码不正确 / 认证码错误）即登录失败。
  async function submitCasLogin(payload) {
    const body = new URLSearchParams({
      csrfmiddlewaretoken: payload.csrf,
      loginname: payload.loginName,
      password: payload.password,
      captcha_0: payload.captchaKey,
      captcha_1: String(payload.captchaAnswer)
    });
    await installLoginHeaderRule();
    let response;
    try {
      response = await fetch(LOGIN_URL, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow'
      });
    } finally {
      await removeLoginHeaderRule();
    }
    const html = await response.text();
    let redirected = response.redirected === true;
    try {
      redirected = redirected
        || !/^\/auth\/login\/?(?:[?#]|$)/i.test(new URL(response.url, LOGIN_URL).pathname);
    } catch {
      // Keep the Response.redirected verdict.
    }
    if (redirected) return { ok: true };
    const tishi = [...html.matchAll(/<p\b[^>]*class\s*=\s*["'][^"']*\btishi\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => textFromHtml(match[1]))
      .filter(Boolean).join(' ');
    return { ok: false, message: tishi || `CAS 登录失败（HTTP ${response.status}）` };
  }

  // 勾选「切换 CAS 账号时同时切换 MIS」时，登录 CAS 前 GET slogout 退出 MIS，
  // 避免切换账号后仍残留旧账号的 MIS 会话。
  async function logoutMisIfEnabled() {
    try {
      const stored = await chrome.storage.local.get([SWITCH_MIS_LOGOUT_KEY]);
      if (stored?.[SWITCH_MIS_LOGOUT_KEY] !== true) return;
      await fetch(MIS_SLOGOUT_URL, {
        credentials: 'include', cache: 'no-store', redirect: 'follow'
      });
    } catch {
      // MIS 登出失败不阻塞 CAS 登录
    }
  }

  function needsManualCaptcha(error) {
    const code = String(error?.code || '').toLowerCase();
    return code === 'captcha-module-missing'
      || code === 'mis-captcha-disabled'
      || code.includes('captcha-resources-missing')
      || code.includes('captcha-module-missing');
  }

  async function recordCasLoginResult(loginName, password, result) {
    const id = String(loginName || '').trim();
    if (result?.ok) {
      const profile = await fetchCasProfile().catch(() => null);
      await saveCasAccount(id, {
        password: String(password ?? ''),
        lastLoginAt: Date.now(),
        ...(profile?.userName ? { userName: profile.userName } : {})
      });
      await broadcastStatus({
        status: 'login-done',
        loginName: id,
        userName: profile?.userName || ''
      });
    } else {
      await broadcastStatus({ status: 'login-error', loginName: id, error: result?.message });
    }
    return result;
  }

  function manualCaptchaResponse(challenge, message = '') {
    return {
      ok: false,
      code: 'CAPTCHA_INPUT_REQUIRED',
      message: message || '请查看验证码图片并输入结果',
      challengeId: challenge.id,
      captchaImage: String(challenge.page?.captchaImageDataUrl || challenge.page?.captchaImageUrl || '')
    };
  }

  function manualCaptchaStorageKey(challengeId) {
    return `${MANUAL_CAPTCHA_SESSION_PREFIX}${String(challengeId || '')}`;
  }

  function scheduleManualCaptchaExpiry(challenge) {
    clearTimeout(challenge.timer);
    const remaining = Math.max(0, Number(challenge.expiresAt || 0) - Date.now());
    challenge.timer = setTimeout(() => { void discardManualCaptcha(challenge.id); }, remaining);
    return challenge;
  }

  async function persistManualCaptcha(challenge) {
    const { timer: _timer, ...stored } = challenge;
    await chrome.storage.session.set({ [manualCaptchaStorageKey(challenge.id)]: stored });
  }

  async function getManualCaptcha(challengeId) {
    const id = String(challengeId || '');
    const current = pendingManualCaptchas.get(id);
    if (current) return current;
    const key = manualCaptchaStorageKey(id);
    const stored = await chrome.storage.session.get([key]).catch(() => ({}));
    const challenge = stored?.[key];
    if (!challenge || String(challenge.id || '') !== id) return null;
    if (Number(challenge.expiresAt || 0) <= Date.now()) {
      await chrome.storage.session.remove(key).catch(() => {});
      return null;
    }
    challenge.timer = null;
    pendingManualCaptchas.set(id, scheduleManualCaptchaExpiry(challenge));
    return challenge;
  }

  async function discardManualCaptcha(challengeId) {
    const id = String(challengeId || '');
    const key = manualCaptchaStorageKey(id);
    let challenge = pendingManualCaptchas.get(id);
    if (!challenge) {
      const stored = await chrome.storage.session.get([key]).catch(() => ({}));
      challenge = stored?.[key] || null;
    }
    await chrome.storage.session.remove(key).catch(() => {});
    if (!challenge) return false;
    pendingManualCaptchas.delete(id);
    clearTimeout(challenge.timer);
    return true;
  }

  async function keepManualCaptcha({ page, loginName, password }, message) {
    const id = crypto.randomUUID();
    const challenge = {
      id,
      page,
      loginName,
      password,
      expiresAt: Date.now() + MANUAL_CAPTCHA_TTL_MS,
      timer: null
    };
    pendingManualCaptchas.set(id, scheduleManualCaptchaExpiry(challenge));
    await persistManualCaptcha(challenge);
    return manualCaptchaResponse(challenge, message);
  }

  async function submitManualCaptcha(challengeId, captchaAnswer) {
    const id = String(challengeId || '');
    const challenge = await getManualCaptcha(id);
    if (!challenge) {
      return { ok: false, code: 'CAPTCHA_CHALLENGE_EXPIRED', message: '验证码已过期，请重新登录' };
    }
    const answer = String(captchaAnswer ?? '').trim();
    if (!answer) return manualCaptchaResponse(challenge, '请输入验证码');
    let result;
    try {
      result = await submitCasLogin({
        csrf: challenge.page.csrf,
        captchaKey: challenge.page.captchaKey,
        captchaAnswer: answer,
        loginName: challenge.loginName,
        password: challenge.password
      });
      if (!result.ok && /认证码/.test(String(result.message || ''))) {
        const page = await readLoginPage();
        if (!page.ok) {
          await discardManualCaptcha(id);
          return page;
        }
        challenge.page = page;
        await persistManualCaptcha(challenge);
        return manualCaptchaResponse(challenge, result.message || '验证码错误，请重新输入');
      }
      await discardManualCaptcha(id);
      return recordCasLoginResult(challenge.loginName, challenge.password, result);
    } catch (error) {
      await discardManualCaptcha(id);
      throw error;
    }
  }

  async function loginWithPassword(loginName, password, { allowManualCaptcha = false } = {}) {
    const id = String(loginName || '').trim();
    const secret = String(password ?? '');
    if (!id) throw new Error('请输入账号（学号）');
    if (!secret) throw new Error('请输入密码');
    await clearCasCookies();
    await logoutMisIfEnabled();
    let lastResult = { ok: false, message: 'CAS 未返回登录结果' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const page = await readLoginPage();
      if (!page.ok) return page;
      let captchaAnswer;
      try {
        captchaAnswer = await recognizeCasCaptcha(page.captchaImageUrl);
      } catch (error) {
        if (allowManualCaptcha && needsManualCaptcha(error)) {
          return keepManualCaptcha({ page, loginName: id, password: secret }, String(error?.message || error));
        }
        return { ok: false, message: String(error?.message || error) };
      }
      lastResult = await submitCasLogin({
        csrf: page.csrf,
        captchaKey: page.captchaKey,
        captchaAnswer,
        loginName: id,
        password: secret
      });
      if (lastResult.ok || !/认证码/.test(String(lastResult.message || ''))) break;
      await wait(300);
    }
    return recordCasLoginResult(id, secret, lastResult);
  }

  async function loginSavedCasAccount(loginName, options = {}) {
    const id = String(loginName || '').trim();
    const account = (await getCasAccounts())[id];
    if (!account) throw new Error('未保存此 CAS 账号');
    if (!account.password) throw new Error('此账号没有已保存的密码');
    return loginWithPassword(id, account.password, options);
  }

  // 打开选项页时若尚未登录且存在已保存密码的账号，
  // 使用其中最近一次登录的账号自动登录。
  async function autoLoginSavedCasAccount(options = {}) {
    const profile = await fetchCasProfile().catch(() => null);
    if (profile) return { ok: true, skipped: true };
    const accounts = await getCasAccounts();
    const candidates = Object.values(accounts)
      .filter((account) => account.password)
      .sort((a, b) => Number(b.lastLoginAt || b.updatedAt || 0) - Number(a.lastLoginAt || a.updatedAt || 0));
    const target = candidates[0];
    if (!target) return { ok: false, code: 'no-saved-account', message: '没有已保存密码的账号' };
    const result = await loginWithPassword(target.loginName, target.password, options);
    return result.ok ? { ok: true, loginName: target.loginName, auto: true } : result;
  }

  async function buildCasContext() {
    const stored = await chrome.storage.local.get([LOGIN_NAME_KEY, 'username']);
    const accounts = await getCasAccounts();
    const loginName = String(stored?.[LOGIN_NAME_KEY] || stored?.username || '').trim();
    const summaries = Object.values(accounts)
      .map((account) => ({
        loginName: account.loginName,
        userName: String(account.userName || ''),
        hasPassword: !!account.password,
        updatedAt: Number(account.updatedAt || 0),
        lastLoginAt: Number(account.lastLoginAt || 0)
      }))
      .sort((a, b) => Number(b.lastLoginAt || b.updatedAt || 0) - Number(a.lastLoginAt || a.updatedAt || 0));
    return { ok: true, loginName, accounts: summaries };
  }

  function extractLoginCredentials(details) {
    if (String(details?.method || '').toUpperCase() !== 'POST' || details?.type !== 'main_frame') return null;
    try {
      const url = new URL(String(details?.url || ''));
      if (url.hostname !== 'cas.bjtu.edu.cn' || !/^\/auth\/login\/?$/i.test(url.pathname)) return null;
    } catch {
      return null;
    }
    const formData = details?.requestBody?.formData || {};
    let loginName = String(formData.loginname?.[0] || '').trim();
    let password = String(formData.password?.[0] || '');
    if ((!loginName || !password) && details?.requestBody?.raw?.[0]?.bytes) {
      try {
        const params = new URLSearchParams(new TextDecoder().decode(details.requestBody.raw[0].bytes));
        loginName = loginName || String(params.get('loginname') || '').trim();
        password = password || String(params.get('password') || '');
      } catch {
        // Ignore an unsupported request-body encoding.
      }
    }
    return loginName && password ? { loginName, password, capturedAt: Date.now() } : null;
  }

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'CAS_LOGIN_WITH_PASSWORD') {
        loginWithPassword(message?.payload?.loginName, message?.payload?.password, {
          allowManualCaptcha: message?.payload?.allowManualCaptcha === true
        })
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'CAS_SWITCH_ACCOUNT') {
        loginSavedCasAccount(message?.payload?.loginName, {
          allowManualCaptcha: message?.payload?.allowManualCaptcha === true
        })
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'CAS_SUBMIT_CAPTCHA') {
        submitManualCaptcha(message?.payload?.challengeId, message?.payload?.captchaAnswer)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'CAS_CANCEL_CAPTCHA') {
        discardManualCaptcha(message?.payload?.challengeId)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'CAS_AUTO_LOGIN') {
        autoLoginSavedCasAccount({
          allowManualCaptcha: message?.payload?.allowManualCaptcha === true
        })
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'CAS_GET_CONTEXT') {
        buildCasContext()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      return false;
    });

    // 监测用户自行提交的 CAS 登录表单（含 /auth/login/?next=… 等带参数变体）：
    // 提交后仍停留在登录页视为失败并丢弃；离开登录页（跳转到任意站点）
    // 即视为成功，保存捕获到的账密；账号与密码均未变化时不重复 toast。
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status !== 'complete') return;
      const pending = pendingCredentialsByTab.get(tabId);
      if (!pending) return;
      pendingCredentialsByTab.delete(tabId);
      let parsed = null;
      try { parsed = new URL(String(changeInfo?.url || tab?.url || '')); } catch { parsed = null; }
      const stillOnLoginPage = parsed?.hostname === 'cas.bjtu.edu.cn'
        && /^\/auth\/login(?:\/|$)/i.test(parsed.pathname);
      if (!parsed || stillOnLoginPage) return;
      void (async () => {
        const accounts = await getCasAccounts();
        const prior = accounts[pending.loginName];
        const unchanged = !!prior && prior.password === pending.password;
        const profile = await fetchCasProfile().catch(() => null);
        await saveCasAccount(pending.loginName, {
          password: pending.password,
          lastLoginAt: Date.now(),
          ...(profile?.userName ? { userName: profile.userName } : {})
        });
        await broadcastStatus({
          status: 'credentials-saved',
          loginName: pending.loginName,
          userName: profile?.userName || '',
          unchanged,
          silent: true
        });
        if (!unchanged) {
          await showCasPageToast(
            tabId,
            `统一身份认证登录成功，已保存账号 ${pending.loginName} 的登录密码`
          );
        }
      })().catch(() => {});
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      pendingCredentialsByTab.delete(tabId);
    });

    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        const credentials = extractLoginCredentials(details);
        if (credentials && Number(details?.tabId ?? -1) >= 0) {
          pendingCredentialsByTab.set(Number(details.tabId), credentials);
        }
      },
      { urls: ['https://cas.bjtu.edu.cn/auth/login*'] },
      ['requestBody']
    );
  }

  global.BjtuCasSystemInternals = {
    getContext: () => buildCasContext(),
    loginWithPassword: (args) => loginWithPassword(args?.loginName, args?.password),
    loginSavedAccount: (args) => loginSavedCasAccount(args?.loginName),
    autoLoginSavedAccount: () => autoLoginSavedCasAccount(),
    fetchProfile: () => fetchCasProfile(),
    extractLoginCredentials,
    parseProfilePage
  };
})(globalThis);
