(function (global) {
  'use strict';

  const HISTORY_KEY = 'loginAccountHistory';

  function decodeBuffer(buffer, contentType = '') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('gbk') || type.includes('gb2312')) return new TextDecoder('gbk').decode(buffer);
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    if (!utf8.includes('\uFFFD')) return utf8;
    const gbk = new TextDecoder('gbk').decode(buffer);
    return gbk.includes('\uFFFD') ? utf8 : gbk;
  }

  async function decodeResponse(response) {
    return decodeBuffer(await response.arrayBuffer(), response.headers.get('content-type'));
  }

  function parseLoginResponse(text) {
    const source = String(text || '');
    const alerts = [...source.matchAll(/alert\s*\(\s*(['"])(.*?)\1\s*\)/gis)];
    const message = String(alerts.at(-1)?.[2] || '').trim();
    if (/错误次数过多|锁定10分钟/i.test(message)) return { ok: false, reason: 'locked', message };
    if (/请输入正确的验证码/i.test(message)) return { ok: false, reason: 'captcha', message };
    if (/账号或密码错误/i.test(message)) return { ok: false, reason: 'credential', message };
    if (/默认密码[\s\S]*弱密码[\s\S]*重置密码/i.test(source)) {
      return { ok: false, reason: 'password-reset', message: '需要重置密码后重新登录' };
    }
    if (/index\.shtml\?method=index&type=qxkt/i.test(source)) return { ok: true };
    return { ok: false, reason: 'other', message: message || '登录失败' };
  }

  async function fetchCurrentUserInfo() {
    try {
      return await global.BjtuVeHomeworkCore.fetchCurrentUserInfo();
    } catch {
      return null;
    }
  }

  async function requestLogin(url) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    return parseLoginResponse(await decodeResponse(response));
  }

  async function rememberLogin(loginName) {
    const id = String(loginName || '').trim();
    if (!id) return;
    const stored = await chrome.storage.local.get(HISTORY_KEY).catch(() => ({}));
    const source = Array.isArray(stored?.[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    const records = source
      .map((item) => ({
        loginName: String(item?.loginName || item?.userId || '').trim(),
        lastLoginAt: Number(item?.lastLoginAt || 0) || 0
      }))
      .filter((item) => item.loginName && item.loginName !== id);
    records.unshift({ loginName: id, lastLoginAt: Date.now() });
    await chrome.storage.local.set({ [HISTORY_KEY]: records });
  }

  async function completeSuccessfulLogin(result, fallbackLoginName, { recordHistory = true } = {}) {
    if (!result?.ok) return result;
    const userInfo = await fetchCurrentUserInfo();
    const loginName = String(userInfo?.loginName || fallbackLoginName || '').trim();
    if (recordHistory && loginName) await rememberLogin(loginName);
    return { ...result, userInfo: userInfo || null };
  }

  async function loginWithQuickUsername(quickUsername, options = {}) {
    const quick = String(quickUsername || '').trim();
    if (!quick) return { ok: false, reason: 'needs-password', message: '未找到可用极速登录名' };
    const result = await requestLogin(global.BjtuVeLoginUtils.buildQuickLoginUrl(quick));
    return completeSuccessfulLogin(result, options.loginName, options);
  }

  async function loginWithPassword(loginName, password, { passcode = '', recordHistory = true } = {}) {
    const id = String(loginName || '').trim();
    const encryptedPassword = String(password || '').trim();
    if (!id || !encryptedPassword) return { ok: false, reason: 'needs-password', message: '请手动输入密码' };

    let code = global.BjtuVeLoginUtils.normalizePasscode(passcode);
    if (!code) {
      const captcha = await global.BjtuVeLoginUtils.recognizeCaptcha();
      if (!captcha?.ok) {
        return {
          ok: false,
          reason: 'captcha-required',
          message: captcha?.reason === 'quota-exhausted'
            ? '免费验证码识别次数已用尽，请输入验证码后继续登录。'
            : '验证码识别失败，请输入验证码后继续登录。'
        };
      }
      code = captcha.passcode;
    }

    const result = await requestLogin(global.BjtuVeLoginUtils.buildPasswordLoginUrl(id, encryptedPassword, code));
    return completeSuccessfulLogin(result, id, { recordHistory });
  }

  async function login(payload = {}) {
    const loginName = String(payload?.loginName || '').trim();
    if (!loginName) return { ok: false, reason: 'empty', message: '请输入账号' };

    if (payload?.skipCurrentCheck !== true) {
      const currentUser = await fetchCurrentUserInfo();
      if (String(currentUser?.loginName || '').trim() === loginName) {
        return { ok: true, alreadyLoggedIn: true, userInfo: currentUser };
      }
    }

    await global.BjtuAccountStore.migrateLegacy();
    const account = await global.BjtuAccountStore.get(loginName);
    const passwordPlain = String(payload?.passwordPlain || '');
    const directPassword = String(payload?.passwordEncoded || payload?.password || '').trim();
    const manualPassword = passwordPlain
      ? (typeof global.strEnc === 'function' ? global.strEnc(passwordPlain) : '')
      : (/^(?:[0-9a-f]{16})+$/i.test(directPassword) ? directPassword : '');
    const allowStoredCredentials = payload?.allowStoredCredentials !== false;

    if (!manualPassword && allowStoredCredentials && account?.quickUsername) {
      const quickResult = await loginWithQuickUsername(account.quickUsername, { loginName, recordHistory: true });
      if (quickResult.ok || quickResult.reason === 'locked' || quickResult.reason === 'password-reset') return quickResult;
    }

    const password = manualPassword || (allowStoredCredentials ? String(account?.password || account?.passwordMd5 || '').trim() : '');
    if (!password) {
      return {
        ok: false,
        reason: account ? 'needs-password' : 'account-not-found',
        message: account
          ? '账号或密码错误，请重新初始化账号列表或手动输入密码。'
          : '账号不在本地账号列表中，请重新初始化账号列表或手动输入密码。'
      };
    }
    return loginWithPassword(loginName, password, {
      passcode: payload?.passcode,
      recordHistory: true
    });
  }

  async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return 'data:' + (blob.type || 'image/jpeg') + ';base64,' + btoa(binary);
  }

  async function getCaptchaDataUrl() {
    return blobToDataUrl(await global.BjtuVeLoginUtils.getCaptchaImage());
  }

  global.BjtuVeLoginService = {
    fetchCurrentUserInfo,
    login,
    loginWithPassword,
    loginWithQuickUsername,
    getCaptchaDataUrl,
    parseLoginResponse
  };
})(globalThis);
