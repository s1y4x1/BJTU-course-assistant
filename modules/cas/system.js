(function (global) {
  'use strict';

  const LOGIN_URL = 'https://cas.bjtu.edu.cn/auth/login/';
  const PROFILE_URL = 'https://cas.bjtu.edu.cn/profile/';
  const ACCOUNTS_KEY = 'casAccounts';
  const LOGIN_NAME_KEY = 'casLoginName';
  const STATUS_TYPE = 'CAS_SYSTEM_STATUS';

  const pendingCredentialsByTab = new Map();
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

  async function ensureCasOriginTab() {
    const tabs = await chrome.tabs.query({ url: ['https://cas.bjtu.edu.cn/*'] }).catch(() => []);
    const reusable = tabs.find((tab) => tab?.id && tab.status === 'complete');
    if (reusable) return { tab: reusable, temporary: false };
    const tab = await globalThis.BjtuTabs.create({ url: LOGIN_URL, active: false });
    if (!tab?.id) throw new Error('无法打开 CAS 登录页');
    const loaded = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(null, new Error('CAS 登录页加载超时')), 20000);
      const finish = (result, error) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        if (error) reject(error); else resolve(result);
      };
      const onUpdated = (updatedId, changeInfo, updatedTab) => {
        if (updatedId === tab.id && changeInfo.status === 'complete') finish(updatedTab);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
    return { tab: loaded || tab, temporary: true };
  }

  // 第一步：GET 登录页，响应标头中的 Set-Cookie 会更新 csrftoken，
  // 页面中的 csrfmiddlewaretoken 与 captcha_0 / 验证码图片随之刷新。
  async function readLoginPage(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (loginUrl) => {
        const response = await fetch(loginUrl, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return { ok: false, message: `CAS 登录页 HTTP ${response.status}` };
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let csrf = doc.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';
        if (!csrf) {
          const cookie = document.cookie.split(';').map((item) => item.trim())
            .find((item) => item.startsWith('csrftoken='));
          if (cookie) {
            csrf = cookie.slice('csrftoken='.length);
            try { csrf = decodeURIComponent(csrf); } catch { /* keep raw value */ }
          }
        }
        const captchaInput = doc.querySelector('input[name="captcha_0"]');
        const captchaImage = doc.querySelector('.yzm img') || doc.querySelector('img[alt="captcha"]');
        if (!csrf) return { ok: false, message: 'CAS 登录页中未找到 CSRF Token' };
        if (!captchaInput?.value || !captchaImage?.getAttribute('src')) {
          return { ok: false, message: 'CAS 登录页中未找到验证码' };
        }
        return {
          ok: true,
          csrf,
          captchaKey: String(captchaInput.value),
          captchaImageUrl: new URL(captchaImage.getAttribute('src'), response.url || location.href).href
        };
      },
      args: [LOGIN_URL]
    });
    return results?.[0]?.result || { ok: false, message: '无法读取 CAS 登录页' };
  }

  async function recognizeCasCaptcha(imageUrl) {
    if (!global.BjtuCaptchaRecognizer?.recognizeMisCaptcha) {
      throw new Error('本地验证码识别模块尚未就绪');
    }
    try {
      const response = await fetch(String(imageUrl || ''), { cache: 'no-store' });
      if (!response.ok) throw new Error(`验证码图片 HTTP ${response.status}`);
      const blob = await response.blob();
      const result = await global.BjtuCaptchaRecognizer.recognizeMisCaptcha(blob);
      const answer = Number(result?.answer);
      if (!Number.isFinite(answer)) throw new Error('识别结果为空');
      return answer;
    } catch (error) {
      throw new Error(`CAS 验证码识别失败：${String(error?.message || error)}`);
    }
  }

  // 第二步：POST urlencoded 表单。302（fetch 跟随重定向）即登录成功；
  // 返回 200 且页面包含 p.tishi（用户密码不正确 / 认证码错误）即登录失败。
  async function submitCasLogin(tabId, payload) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (loginUrl, data) => {
        const body = new URLSearchParams({
          csrfmiddlewaretoken: data.csrf,
          loginname: data.loginName,
          password: data.password,
          captcha_0: data.captchaKey,
          captcha_1: String(data.captchaAnswer)
        });
        const response = await fetch(loginUrl, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow'
        });
        const html = await response.text();
        let redirected = response.redirected === true;
        try {
          redirected = redirected
            || !/^\/auth\/login\/?(?:[?#]|$)/i.test(new URL(response.url, loginUrl).pathname);
        } catch {
          // Keep the Response.redirected verdict.
        }
        if (redirected) return { ok: true };
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const tishi = [...doc.querySelectorAll('p.tishi')]
          .map((element) => String(element.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean).join(' ');
        return { ok: false, message: tishi || `CAS 登录失败（HTTP ${response.status}）` };
      },
      args: [LOGIN_URL, payload]
    });
    return results?.[0]?.result || { ok: false, message: 'CAS 未返回登录结果' };
  }

  async function loginWithPassword(loginName, password) {
    const id = String(loginName || '').trim();
    const secret = String(password ?? '');
    if (!id) throw new Error('请输入账号（学号）');
    if (!secret) throw new Error('请输入密码');
    await clearCasCookies();
    const { tab, temporary } = await ensureCasOriginTab();
    try {
      let lastResult = { ok: false, message: 'CAS 未返回登录结果' };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const page = await readLoginPage(tab.id);
        if (!page.ok) return page;
        let captchaAnswer;
        try {
          captchaAnswer = await recognizeCasCaptcha(page.captchaImageUrl);
        } catch (error) {
          return { ok: false, message: String(error?.message || error) };
        }
        lastResult = await submitCasLogin(tab.id, {
          csrf: page.csrf,
          captchaKey: page.captchaKey,
          captchaAnswer,
          loginName: id,
          password: secret
        });
        if (lastResult.ok || !/认证码/.test(String(lastResult.message || ''))) break;
        await wait(300);
      }
      if (lastResult.ok) {
        const profile = await fetchCasProfile().catch(() => null);
        await saveCasAccount(id, {
          password: secret,
          lastLoginAt: Date.now(),
          ...(profile?.userName ? { userName: profile.userName } : {})
        });
        await broadcastStatus({
          status: 'login-done',
          loginName: id,
          userName: profile?.userName || ''
        });
      } else {
        await broadcastStatus({ status: 'login-error', loginName: id, error: lastResult.message });
      }
      return lastResult;
    } finally {
      if (temporary && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  async function loginSavedCasAccount(loginName) {
    const id = String(loginName || '').trim();
    const account = (await getCasAccounts())[id];
    if (!account) throw new Error('未保存此 CAS 账号');
    if (!account.password) throw new Error('此账号没有已保存的密码');
    return loginWithPassword(id, account.password);
  }

  // 打开选项页时若尚未登录且存在已保存密码的账号，
  // 使用其中最近一次登录的账号自动登录。
  async function autoLoginSavedCasAccount() {
    const profile = await fetchCasProfile().catch(() => null);
    if (profile) return { ok: true, skipped: true };
    const accounts = await getCasAccounts();
    const candidates = Object.values(accounts)
      .filter((account) => account.password)
      .sort((a, b) => Number(b.lastLoginAt || b.updatedAt || 0) - Number(a.lastLoginAt || a.updatedAt || 0));
    const target = candidates[0];
    if (!target) return { ok: false, code: 'no-saved-account', message: '没有已保存密码的账号' };
    const result = await loginWithPassword(target.loginName, target.password);
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
        loginWithPassword(message?.payload?.loginName, message?.payload?.password)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'CAS_SWITCH_ACCOUNT') {
        loginSavedCasAccount(message?.payload?.loginName)
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'CAS_AUTO_LOGIN') {
        autoLoginSavedCasAccount()
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
