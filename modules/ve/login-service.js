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

  async function decodeResponse(response, forcedEncoding = '') {
    return decodeBuffer(
      await response.arrayBuffer(),
      forcedEncoding || response.headers.get('content-type')
    );
  }

  function parseLoginResponse(text) {
    const source = String(text || '');
    const alerts = [...source.matchAll(/alert\s*\(\s*(['"])(.*?)\1\s*\)/gis)];
    const message = String(alerts.at(-1)?.[2] || '').trim();
    if (/<title[^>]*>\s*系统发生了未处理的异常\s*<\/title>/i.test(source)) {
      return { ok: false, reason: 'server-error', message: '智慧课程平台发生未处理的异常' };
    }
    if (/错误次数过多|锁定10分钟/i.test(message)) return { ok: false, reason: 'locked', message };
    if (/请输入正确的验证码/i.test(message)) return { ok: false, reason: 'captcha', message };
    if (/账号或密码错误/i.test(message)) return { ok: false, reason: 'credential', message };
    if (/默认密码[\s\S]*弱密码[\s\S]*重置密码/i.test(source)) {
      return { ok: false, reason: 'password-reset', message: '需要重置密码后重新登录' };
    }
    const executableSource = source.replace(/<!--[\s\S]*?-->/g, '');
    if (/location\.href\s*=\s*['"]http:\/\/123\.121\.147\.7:88\/ve\/back\/core\/main\/index\.shtml\?method=index&type=qxkt['"]/i.test(executableSource)) {
      return { ok: true };
    }
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
    return { ...parseLoginResponse(await decodeResponse(response, 'gbk')), httpStatus: response.status };
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

  async function rememberPlainPassword(loginName, password, userInfo = null) {
    const id = String(loginName || '').trim();
    const plain = String(password || '');
    if (!id || !plain) return null;
    await global.BjtuAccountStore.migrateLegacy();
    const current = await global.BjtuAccountStore.get(id);
    const record = await global.BjtuAccountStore.put({
      loginName: id,
      userName: String(userInfo?.userName || current?.userName || '').trim(),
      roleName: String(userInfo?.roleName || current?.roleName || '').trim(),
      password: plain,
      passwordMd5: String(current?.passwordMd5 || '').trim(),
      quickUsername: String(current?.quickUsername || '').trim()
    });
    await chrome.storage.local.set({ accountListRevision: Date.now() });
    return record;
  }

  function withCredentialEvents(result, events = []) {
    const merged = [
      ...(Array.isArray(result?.credentialEvents) ? result.credentialEvents : []),
      ...(Array.isArray(events) ? events : [])
    ];
    return merged.length ? { ...result, credentialEvents: merged } : result;
  }

  async function clearStoredCredential(loginName, field) {
    const id = String(loginName || '').trim();
    if (!id || !['password', 'quickUsername'].includes(field)) return false;
    await global.BjtuAccountStore.migrateLegacy();
    const current = await global.BjtuAccountStore.get(id);
    if (!String(current?.[field] || '')) return false;
    const updated = await global.BjtuAccountStore.clearCredentials(id, [field]);
    if (!updated) return false;
    await chrome.storage.local.set({ accountListRevision: Date.now() });
    return true;
  }

  async function completeSuccessfulLogin(result, fallbackLoginName, { recordHistory = true, passwordPlain = '' } = {}) {
    if (!result?.ok) return result;
    const userInfo = await fetchCurrentUserInfo();
    const loginName = String(userInfo?.loginName || fallbackLoginName || '').trim();
    if (passwordPlain && loginName) await rememberPlainPassword(loginName, passwordPlain, userInfo);
    if (recordHistory && loginName) await rememberLogin(loginName);
    return { ...result, userInfo: userInfo || null };
  }

  async function loginWithQuickUsername(quickUsername, options = {}) {
    const quick = String(quickUsername || '').trim();
    if (!quick) return { ok: false, reason: 'needs-password', message: '未找到可用极速登录名' };
    const result = await requestLogin(global.BjtuVeLoginUtils.buildQuickLoginUrl(quick));
    if (result?.httpStatus === 500 && result?.reason === 'server-error'
        && await clearStoredCredential(options.loginName, 'quickUsername')) {
      return withCredentialEvents(result, [{ type: 'quickUsername-cleared', loginName: String(options.loginName || '').trim() }]);
    }
    return completeSuccessfulLogin(result, options.loginName, options);
  }

  async function loginWithPassword(loginName, password, { passcode = '', recordHistory = true, passwordPlain = '' } = {}) {
    const id = String(loginName || '').trim();
    const encryptedPassword = String(password || '').trim();
    if (!id || !encryptedPassword) return { ok: false, reason: 'needs-password', message: '请手动输入密码' };

    let code = global.BjtuVeLoginUtils.normalizePasscode(passcode);
    let captchaErrorCount = 0;

    while (true) {
      if (!code) {
        const captcha = await global.BjtuVeLoginUtils.recognizeCaptcha();
        if (!captcha?.ok) {
          return {
            ok: false,
            reason: captcha?.reason === 'module-missing' ? 'captcha-module-missing' : 'captcha-required',
            message: captcha?.reason === 'module-missing'
              ? '本地验证码识别模块未安装，请输入验证码后继续登录。'
              : '验证码本地识别失败，请输入验证码后继续登录。'
          };
        }
        code = captcha.passcode;
      }

      const result = await requestLogin(global.BjtuVeLoginUtils.buildPasswordLoginUrl(id, encryptedPassword, code));
      if (result?.reason !== 'captcha') {
        const completed = await completeSuccessfulLogin(result, id, { recordHistory, passwordPlain });
        if (result?.reason === 'credential' && await clearStoredCredential(id, 'password')) {
          return withCredentialEvents(completed, [{ type: 'password-cleared', loginName: id }]);
        }
        return completed;
      }

      captchaErrorCount += 1;
      if (captchaErrorCount >= 3) {
        return {
          ok: false,
          reason: 'captcha-required',
          message: '连续 3 次验证码错误，请手动输入验证码后继续登录。'
        };
      }
      code = '';
    }
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
    const credentialEvents = [];

    if (!manualPassword && allowStoredCredentials && account?.quickUsername) {
      const quickResult = await loginWithQuickUsername(account.quickUsername, { loginName, recordHistory: true });
      if (Array.isArray(quickResult?.credentialEvents)) credentialEvents.push(...quickResult.credentialEvents);
      if (quickResult.ok || quickResult.reason === 'locked' || quickResult.reason === 'password-reset') return quickResult;
    }

    const storedPlainPassword = allowStoredCredentials ? String(account?.password || '') : '';
    const storedEncodedPassword = storedPlainPassword && typeof global.strEnc === 'function'
      ? global.strEnc(storedPlainPassword)
      : '';
    let defaultPassword = '';
    let defaultEncodedPassword = '';
    const storedPasswordMd5 = allowStoredCredentials ? String(account?.passwordMd5 || '').trim().toLowerCase() : '';
    if (!manualPassword && !storedEncodedPassword && storedPasswordMd5 && typeof global.md5 === 'function') {
      const candidate = 'Bjtu@' + loginName;
      if (String(global.md5(candidate) || '').toLowerCase() === storedPasswordMd5) {
        defaultPassword = candidate;
        defaultEncodedPassword = typeof global.strEnc === 'function' ? global.strEnc(candidate) : '';
      }
    }
    const password = manualPassword || storedEncodedPassword || defaultEncodedPassword;
    if (!password) {
      return withCredentialEvents({
        ok: false,
        reason: account ? 'needs-password' : 'account-not-found',
        message: account
          ? '账号或密码错误，请重新初始化账号列表或手动输入密码。'
          : '账号不在本地账号列表中，请重新初始化账号列表或手动输入密码。'
      }, credentialEvents);
    }
    const result = await loginWithPassword(loginName, password, {
      passcode: payload?.passcode,
      recordHistory: true,
      passwordPlain: passwordPlain || storedPlainPassword || defaultPassword
    });
    return withCredentialEvents(result, credentialEvents);
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

  async function recognizeCaptchaDataUrl(imageUrl) {
    const source = String(imageUrl || '');
    if (!source.startsWith('data:')) throw new Error('验证码图片格式无效');
    const response = await fetch(source);
    const image = await response.blob();
    const recognizer = global.BjtuCaptchaRecognizer;
    if (!recognizer?.recognize) {
      throw Object.assign(
        new Error('本地验证码识别模块未安装'),
        { code: 'captcha-module-missing' }
      );
    }
    const result = await recognizer.recognize(image);
    const passcode = global.BjtuVeLoginUtils.normalizePasscode(result?.passcode);
    if (!result?.ok || passcode.length !== 4) throw new Error('未能识别出 4 位数字');
    return passcode;
  }

  global.BjtuVeLoginService = {
    fetchCurrentUserInfo,
    login,
    loginWithPassword,
    loginWithQuickUsername,
    getCaptchaDataUrl,
    recognizeCaptchaDataUrl,
    parseLoginResponse
  };
})(globalThis);
