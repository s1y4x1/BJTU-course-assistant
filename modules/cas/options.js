(function initCasOptionsModule(global) {
  'use strict';

  const LOGIN_NAME_KEY = 'casLoginName';
  const SWITCH_MIS_LOGOUT_KEY = 'casSwitchMisLogoutEnabled';

  let initialized = false;
  let context = null;
  let setMessage = () => {};

  const element = (id) => document.getElementById(id);
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload })
    .catch((error) => ({ ok: false, message: String(error?.message || error) }));

  function promptCaptcha(result) {
    const modal = element('casCaptchaModal');
    const image = element('casCaptchaImage');
    const input = element('casCaptchaAnswer');
    const message = element('casCaptchaMessage');
    const submit = element('casCaptchaSubmit');
    const cancel = element('casCaptchaCancel');
    if (!(modal instanceof HTMLElement)
        || !(image instanceof HTMLImageElement)
        || !(input instanceof HTMLInputElement)
        || !(submit instanceof HTMLButtonElement)
        || !(cancel instanceof HTMLButtonElement)) {
      return Promise.resolve(null);
    }
    image.src = String(result?.captchaImage || '');
    input.value = '';
    if (message instanceof HTMLElement) {
      message.textContent = String(result?.message || '请输入图片中的验证码');
    }
    modal.hidden = false;
    return new Promise((resolve) => {
      const finish = (value) => {
        submit.removeEventListener('click', onSubmit);
        cancel.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKeydown);
        modal.hidden = true;
        resolve(value);
      };
      const onSubmit = () => {
        const answer = input.value.trim();
        if (!answer) {
          input.focus();
          return;
        }
        finish(answer);
      };
      const onCancel = () => finish(null);
      const onKeydown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onSubmit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      };
      submit.addEventListener('click', onSubmit);
      cancel.addEventListener('click', onCancel);
      input.addEventListener('keydown', onKeydown);
      setTimeout(() => input.focus(), 0);
    });
  }

  async function completeCaptchaChallenge(initialResult) {
    let result = initialResult;
    while (result?.code === 'CAPTCHA_INPUT_REQUIRED') {
      const challengeId = String(result?.challengeId || '');
      const answer = await promptCaptcha(result);
      if (answer === null) {
        await send('CAS_CANCEL_CAPTCHA', { challengeId });
        throw new Error('已取消输入验证码');
      }
      result = await send('CAS_SUBMIT_CAPTCHA', { challengeId, captchaAnswer: answer });
    }
    return result;
  }

  function renderAccounts(value) {
    const select = element('casAccountSelect');
    if (!(select instanceof HTMLSelectElement)) return;
    const accounts = Array.isArray(value?.accounts) ? value.accounts : [];
    const selected = String(value?.loginName || '');
    select.replaceChildren();
    if (!accounts.length) {
      select.append(new Option('暂无已保存账号', ''));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    for (const account of accounts) {
      const id = String(account?.loginName || '');
      const option = new Option([id, account?.userName].filter(Boolean).join(' '), id);
      option.disabled = !account?.hasPassword && id !== selected;
      select.append(option);
    }
    select.value = accounts.some((account) => String(account?.loginName) === selected)
      ? selected
      : String(accounts[0]?.loginName || '');
  }

  async function refreshContext() {
    const result = await send('CAS_GET_CONTEXT');
    if (result?.ok) context = result;
    const input = element('casLoginName');
    if (input instanceof HTMLInputElement && document.activeElement !== input) {
      input.value = String(context?.loginName || '');
    }
    renderAccounts(context);
    return context;
  }

  function bindEvents() {
    element('casLoginBtn')?.addEventListener('click', async () => {
      const button = element('casLoginBtn');
      const loginName = String(element('casLoginName')?.value || '').trim();
      const password = String(element('casPassword')?.value || '');
      if (!loginName || !password) return setMessage('请输入账号（学号）和密码', false);
      button.disabled = true;
      try {
        setMessage(`正在登录 CAS（${loginName}），正在识别验证码…`);
        const result = await completeCaptchaChallenge(await send('CAS_LOGIN_WITH_PASSWORD', {
          loginName,
          password,
          allowManualCaptcha: true
        }));
        if (!result?.ok) throw new Error(result?.message || '登录失败');
        element('casPassword').value = '';
        await refreshContext();
        setMessage(`CAS 账号 ${loginName} 登录成功`);
      } catch (error) {
        setMessage(`CAS 登录失败：${String(error?.message || error)}`, false);
      } finally {
        button.disabled = false;
      }
    });
    element('casPassword')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        element('casLoginBtn')?.click();
      }
    });
    element('casLoginName')?.addEventListener('change', (event) => {
      chrome.storage.local.set({ [LOGIN_NAME_KEY]: String(event.currentTarget.value || '').trim() });
    });
    element(SWITCH_MIS_LOGOUT_KEY)?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      await chrome.storage.local.set({ [SWITCH_MIS_LOGOUT_KEY]: enabled });
      setMessage(enabled
        ? '切换 CAS 账号时会先退出 MIS 登录'
        : '切换 CAS 账号时不再额外退出 MIS 登录');
    });
    element('casAccountSelect')?.addEventListener('change', async (event) => {
      const select = event.currentTarget;
      const loginName = String(select.value || '').trim();
      if (!loginName) return;
      select.disabled = true;
      element('casLoginName').value = loginName;
      setMessage(`正在切换至 CAS 账号 ${loginName}…`);
      try {
        const result = await completeCaptchaChallenge(await send('CAS_SWITCH_ACCOUNT', {
          loginName,
          allowManualCaptcha: true
        }));
        if (!result?.ok) {
          setMessage(`切换 CAS 账号失败：${result?.message || '未知错误'}`, false);
          await refreshContext();
          return;
        }
        await refreshContext();
        setMessage(`已切换至 CAS 账号 ${loginName}`);
      } catch (error) {
        setMessage(`切换 CAS 账号失败：${String(error?.message || error)}`, false);
        await refreshContext();
      } finally {
        select.disabled = false;
      }
    });
  }

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'CAS_SYSTEM_STATUS') return;
      const status = message.payload || {};
      if (status.status === 'credentials-saved') {
        refreshContext();
        if (status.unchanged !== true) {
          setMessage(`已捕获并保存 CAS 账号 ${status.loginName || ''} 的登录密码`);
        }
      } else if (status.status === 'login-done' || status.status === 'login-error') {
        refreshContext();
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.casAccounts) void refreshContext();
      if (changes[LOGIN_NAME_KEY] && document.activeElement !== element('casLoginName')) {
        element('casLoginName').value = String(changes[LOGIN_NAME_KEY].newValue || '');
      }
      if (changes[SWITCH_MIS_LOGOUT_KEY]) {
        const checkbox = element(SWITCH_MIS_LOGOUT_KEY);
        if (checkbox instanceof HTMLInputElement) {
          checkbox.checked = changes[SWITCH_MIS_LOGOUT_KEY].newValue !== false;
        }
      }
    });
  }

  async function autoLoginIfPossible() {
    try {
      const result = await completeCaptchaChallenge(await send('CAS_AUTO_LOGIN', {
        allowManualCaptcha: true
      }));
      if (result?.ok) {
        await refreshContext();
      } else if (result?.ok === false && result.code !== 'no-saved-account') {
        setMessage(`统一身份认证自动登录失败：${result?.message || '未知错误'}`, false);
      }
    } catch (error) {
      setMessage(`统一身份认证自动登录失败：${String(error?.message || error)}`, false);
    }
  }

  async function init(options = {}) {
    if (initialized) return true;
    initialized = true;
    setMessage = typeof options.setMessage === 'function' ? options.setMessage : setMessage;
    const stored = await chrome.storage.local.get([SWITCH_MIS_LOGOUT_KEY]);
    const misCheckbox = element(SWITCH_MIS_LOGOUT_KEY);
    if (misCheckbox instanceof HTMLInputElement) {
      misCheckbox.checked = stored[SWITCH_MIS_LOGOUT_KEY] !== false;
    }
    bindEvents();
    bindMessages();
    await refreshContext();
    void autoLoginIfPossible();
    return true;
  }

  async function reset() {
    await chrome.storage.local.remove([LOGIN_NAME_KEY]);
    if (!initialized) return;
    element('casLoginName').value = '';
    element('casPassword').value = '';
    await refreshContext();
  }

  global.BjtuCasOptions = { init, reset };
  global.BjtuOptionsModules?.register('cas', global.BjtuCasOptions);
})(globalThis);
