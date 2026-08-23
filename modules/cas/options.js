(function initCasOptionsModule(global) {
  'use strict';

  const LOGIN_NAME_KEY = 'casLoginName';

  let initialized = false;
  let context = null;
  let setMessage = () => {};

  const element = (id) => document.getElementById(id);
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload })
    .catch((error) => ({ ok: false, message: String(error?.message || error) }));

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
        const result = await send('CAS_LOGIN_WITH_PASSWORD', { loginName, password });
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
    element('casAccountSelect')?.addEventListener('change', async (event) => {
      const select = event.currentTarget;
      const loginName = String(select.value || '').trim();
      if (!loginName) return;
      select.disabled = true;
      element('casLoginName').value = loginName;
      setMessage(`正在切换至 CAS 账号 ${loginName}…`);
      try {
        const result = await send('CAS_SWITCH_ACCOUNT', { loginName });
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
        setMessage(`已捕获并保存 CAS 账号 ${status.loginName || ''} 的登录密码`);
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
    });
  }

  async function init(options = {}) {
    if (initialized) return true;
    initialized = true;
    setMessage = typeof options.setMessage === 'function' ? options.setMessage : setMessage;
    bindEvents();
    bindMessages();
    await refreshContext();
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
