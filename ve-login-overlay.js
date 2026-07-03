(async function initBjtuPortalLogin() {
  'use strict';
  if (document.getElementById('__bjtu_portal_login_host__')) return;

  const title = String(document.title || '').trim().toLowerCase();
  const bodyText = String(document.body?.textContent || '').replace(/\s+/g, '');
  const isLoginPage = title.includes('一体化智慧教学平台')
    && !!document.querySelector('input.loginBtn[type="submit"][value="登录"]');
  const isTimeoutPage = title.includes('会话结束')
    || (bodyText.includes('会话结束,请退出系统') && bodyText.includes('重新登录'));
  if (!isLoginPage && !isTimeoutPage) return;
  const injectionOptions = await chrome.storage.local.get([
    'injectPortalLoginOnLoginPage',
    'injectPortalLoginOnTimeoutPage',
    'themeMode'
  ]);
  if (isLoginPage && injectionOptions.injectPortalLoginOnLoginPage === false) return;
  if (isTimeoutPage && injectionOptions.injectPortalLoginOnTimeoutPage === false) return;

  const sendMessage = (message) => new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, message: chrome.runtime.lastError.message });
      else resolve(response || { ok: false });
    });
  });

  let template = '';
  let stylesheet = '';
  try {
    [template, stylesheet] = await Promise.all([
      fetch(chrome.runtime.getURL('ve-login-overlay.html')).then((response) => response.text()),
      fetch(chrome.runtime.getURL('ve-login-overlay.css')).then((response) => response.text())
    ]);
  } catch {
    return;
  }
  const host = document.createElement('div');
  host.id = '__bjtu_portal_login_host__';
  host.style.setProperty('all', 'initial', 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${stylesheet}</style>${template}`;
  const mask = shadow.querySelector('#__bjtu_portal_login_mask__');
  if (!(mask instanceof HTMLElement)) return;
  document.documentElement.appendChild(host);

  const status = mask.querySelector('#__bjtu_portal_status__');
  const username = mask.querySelector('#__bjtu_portal_username__');
  const nameInput = mask.querySelector('#__bjtu_portal_name__');
  const results = mask.querySelector('#__bjtu_portal_results__');
  const resultCount = mask.querySelector('#__bjtu_portal_result_count__');
  const historyList = mask.querySelector('#__bjtu_portal_history__');
  const manual = mask.querySelector('#__bjtu_portal_manual_password__');
  const plain = mask.querySelector('#__bjtu_portal_password_plain__');
  const md5Input = mask.querySelector('#__bjtu_portal_password_md5__');
  const recoveryMask = mask.querySelector('#__bjtu_portal_recovery_mask__');
  const recoveryMessage = mask.querySelector('#__bjtu_portal_recovery_message__');
  const recoveryChoice = mask.querySelector('#__bjtu_portal_recovery_choice__');
  const recoveryManual = mask.querySelector('#__bjtu_portal_recovery_manual__');
  const recoveryPlain = mask.querySelector('#__bjtu_portal_recovery_plain__');
  const recoveryMd5 = mask.querySelector('#__bjtu_portal_recovery_md5__');
  let searchTimer = null;
  let searchSerial = 0;
  let selectedLoginName = '';
  let loginRunning = false;

  const themeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
  let portalThemeMode = injectionOptions.themeMode === 'light' || injectionOptions.themeMode === 'dark'
    ? injectionOptions.themeMode
    : 'system';
  const applyPortalTheme = () => {
    const resolved = portalThemeMode === 'system' ? (themeMedia?.matches ? 'dark' : 'light') : portalThemeMode;
    mask.dataset.colorScheme = resolved;
  };
  const onPortalThemeStorageChanged = (changes, area) => {
    if (area !== 'local' || !changes.themeMode) return;
    const value = changes.themeMode.newValue;
    portalThemeMode = value === 'light' || value === 'dark' ? value : 'system';
    applyPortalTheme();
  };
  const onPortalSystemThemeChanged = () => {
    if (portalThemeMode === 'system') applyPortalTheme();
  };
  applyPortalTheme();
  chrome.storage.onChanged.addListener(onPortalThemeStorageChanged);
  if (typeof themeMedia?.addEventListener === 'function') themeMedia.addEventListener('change', onPortalSystemThemeChanged);
  else if (typeof themeMedia?.addListener === 'function') themeMedia.addListener(onPortalSystemThemeChanged);

  const close = () => {
    try { chrome.storage.onChanged.removeListener(onPortalThemeStorageChanged); } catch {}
    if (typeof themeMedia?.removeEventListener === 'function') themeMedia.removeEventListener('change', onPortalSystemThemeChanged);
    else if (typeof themeMedia?.removeListener === 'function') themeMedia.removeListener(onPortalSystemThemeChanged);
    host.remove();
  };
  const setStatus = (text, type = 'info') => {
    if (!(status instanceof HTMLElement)) return;
    status.textContent = String(text || '');
    status.dataset.statusType = type;
    const colors = type === 'error'
      ? ['#fee2e2', '#b91c1c', '#fecaca']
      : type === 'success' ? ['#dcfce7', '#15803d', '#bbf7d0'] : ['#eff6ff', '#1d4ed8', '#bfdbfe'];
    status.style.background = colors[0];
    status.style.color = colors[1];
    status.style.borderColor = colors[2];
  };
  const createEmpty = (text) => {
    const empty = document.createElement('div');
    empty.className = '__bjtu_portal_empty';
    empty.textContent = text;
    return empty;
  };
  const accountButton = (record, onClick) => {
    const loginName = String(record?.loginName || record?.userId || '').trim();
    if (!loginName) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = '__bjtu_portal_account';
    const id = document.createElement('span');
    id.className = '__bjtu_portal_account_id';
    id.textContent = loginName;
    const personName = document.createElement('span');
    personName.className = '__bjtu_portal_account_name';
    personName.textContent = String(record?.userName || '未记录姓名').trim();
    const role = document.createElement('span');
    role.className = '__bjtu_portal_account_role';
    role.textContent = String(record?.roleName || '').trim();
    button.append(id, role, personName);
    if (String(record?.quickUsername || '').trim()) {
      button.classList.add('__bjtu_portal_quick_account');
      const quick = document.createElement('span');
      quick.className = '__bjtu_portal_quick_icon';
      quick.textContent = '⚡';
      quick.title = '支持快速登录';
      button.appendChild(quick);
    }
    button.addEventListener('click', () => onClick(loginName));
    return button;
  };
  const renderAccounts = (container, records, emptyText) => {
    if (!(container instanceof HTMLElement)) return;
    container.innerHTML = '';
    const list = Array.isArray(records) ? records : [];
    if (!list.length) {
      container.appendChild(createEmpty(emptyText));
      return;
    }
    list.forEach((record) => {
      const button = accountButton(record, (loginName) => void submit(loginName));
      if (button) container.appendChild(button);
    });
  };

  mask.querySelector('#__bjtu_portal_close__')?.addEventListener('click', close);
  mask.addEventListener('mousedown', (event) => { mask.dataset.maskDown = event.target === mask ? '1' : '0'; });
  mask.addEventListener('mouseup', (event) => {
    if (event.target === mask && mask.dataset.maskDown === '1') close();
    delete mask.dataset.maskDown;
  });

  const context = await sendMessage({ type: 'PORTAL_LOGIN_CONTEXT' });
  const history = Array.isArray(context?.history) ? context.history : [];
  renderAccounts(historyList, history, '暂无登录历史');
  if (username instanceof HTMLInputElement) {
    const nativeUsername = document.querySelector('input[name="username"]');
    username.value = String(context?.username || nativeUsername?.value || '').trim();
    selectedLoginName = username.value;
  }
  setStatus(isTimeoutPage ? '会话已结束，请选择账号重新登录' : '请选择账号登录智慧课程平台');

  const searchAccounts = async (showAll = false) => {
    const loginName = String(username?.value || '').trim();
    const userName = String(nameInput?.value || '').trim();
    const serial = ++searchSerial;
    if (!loginName && !userName) {
      if (results instanceof HTMLElement) {
        results.innerHTML = '';
        results.appendChild(createEmpty('输入账号或姓名开始搜索'));
      }
      if (resultCount instanceof HTMLElement) resultCount.textContent = '';
      return;
    }
    if (results instanceof HTMLElement) {
      results.innerHTML = '';
      results.appendChild(createEmpty('正在搜索…'));
    }
    const response = await sendMessage({
      type: 'PORTAL_SEARCH_ACCOUNTS',
      payload: { loginName, userName, showAll }
    });
    if (serial !== searchSerial) return;
    const accounts = Array.isArray(response?.accounts) ? response.accounts : [];
    renderAccounts(results, accounts, response?.ok ? '未找到匹配账号' : '账号搜索失败');
    if (resultCount instanceof HTMLElement) {
      resultCount.innerHTML = '';
      if (response?.hasMore && !showAll) {
        resultCount.append(document.createTextNode('只显示前100个'));
        const viewAll = document.createElement('button');
        viewAll.type = 'button';
        viewAll.className = '__bjtu_portal_view_all';
        viewAll.textContent = '[查看全部]';
        viewAll.addEventListener('click', () => void searchAccounts(true));
        resultCount.appendChild(viewAll);
      } else if (accounts.length) {
        resultCount.textContent = accounts.length + ' 个结果';
      }
    }
  };
  const scheduleSearch = () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void searchAccounts(), 180);
  };
  username?.addEventListener('input', () => {
    selectedLoginName = String(username.value || '').trim();
    scheduleSearch();
  });
  nameInput?.addEventListener('input', scheduleSearch);
  if (String(username?.value || '').trim()) void searchAccounts();

  const showManualPassword = (loginName) => {
    selectedLoginName = String(loginName || '').trim();
    if (username instanceof HTMLInputElement) username.value = selectedLoginName;
    if (manual instanceof HTMLElement) manual.style.display = 'block';
    plain?.focus();
  };
  plain?.addEventListener('input', () => {
    if (md5Input instanceof HTMLInputElement && typeof strEnc === 'function') {
      md5Input.value = plain.value ? strEnc(plain.value) : '';
    }
  });
  md5Input?.addEventListener('input', () => {
    md5Input.value = String(md5Input.value || '').replace(/[^0-9a-f]/gi, '').slice(0, 256).toUpperCase();
  });
  mask.querySelector('#__bjtu_portal_default__')?.addEventListener('click', () => {
    const loginName = selectedLoginName || String(username?.value || '').trim();
    if (!(plain instanceof HTMLInputElement) || !loginName) return;
    plain.value = 'Bjtu@' + loginName;
    if (md5Input instanceof HTMLInputElement && typeof strEnc === 'function') md5Input.value = strEnc(plain.value);
  });

  function requestRecovery(loginName, message) {
    return new Promise((resolve) => {
      if (!(recoveryMask instanceof HTMLElement)) return resolve({ action: 'manual' });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        recoveryMask.style.display = 'none';
        resolve(value);
      };
      const onReinit = async () => {
        await sendMessage({ type: 'OPEN_APP', payload: { accountInit: true } });
        finish({ action: 'cancel' });
      };
      const onManual = () => {
        if (recoveryChoice instanceof HTMLElement) recoveryChoice.style.display = 'none';
        if (recoveryManual instanceof HTMLElement) recoveryManual.style.display = 'block';
        if (recoveryPlain instanceof HTMLInputElement) {
          recoveryPlain.value = '';
          recoveryPlain.focus();
        }
        if (recoveryMd5 instanceof HTMLInputElement) recoveryMd5.value = '';
      };
      const onDefault = () => {
        if (!(recoveryPlain instanceof HTMLInputElement)) return;
        recoveryPlain.value = 'Bjtu@' + String(loginName || '').trim();
        if (recoveryMd5 instanceof HTMLInputElement && typeof strEnc === 'function') recoveryMd5.value = strEnc(recoveryPlain.value);
        recoveryPlain.focus();
      };
      const onPlainInput = () => {
        if (!(recoveryPlain instanceof HTMLInputElement) || !(recoveryMd5 instanceof HTMLInputElement) || typeof strEnc !== 'function') return;
        recoveryMd5.value = recoveryPlain.value ? strEnc(recoveryPlain.value) : '';
      };
      const onMd5Input = () => {
        if (!(recoveryMd5 instanceof HTMLInputElement)) return;
        recoveryMd5.value = String(recoveryMd5.value || '').replace(/[^0-9a-f]/gi, '').slice(0, 256).toUpperCase();
      };
      const onSubmit = () => {
        const password = String(recoveryPlain?.value || '')
          ? (typeof strEnc === 'function' ? strEnc(String(recoveryPlain.value || '')) : '')
          : String(recoveryMd5?.value || '').trim();
        if (!/^(?:[0-9a-f]{16})+$/i.test(password)) {
          recoveryMd5?.focus();
          return;
        }
        finish({ action: 'password', password });
      };
      const onCancel = () => finish({ action: 'cancel' });
      const onKeyDown = (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onSubmit();
      };
      const onMaskDown = (event) => { recoveryMask.dataset.maskDown = event.target === recoveryMask ? '1' : '0'; };
      const onMaskUp = (event) => {
        if (event.target === recoveryMask && recoveryMask.dataset.maskDown === '1') onCancel();
        delete recoveryMask.dataset.maskDown;
      };
      const cleanup = () => {
        mask.querySelector('#__bjtu_portal_recovery_reinitialize__')?.removeEventListener('click', onReinit);
        mask.querySelector('#__bjtu_portal_recovery_manual_btn__')?.removeEventListener('click', onManual);
        mask.querySelector('#__bjtu_portal_recovery_cancel__')?.removeEventListener('click', onCancel);
        mask.querySelector('#__bjtu_portal_recovery_default__')?.removeEventListener('click', onDefault);
        mask.querySelector('#__bjtu_portal_recovery_submit__')?.removeEventListener('click', onSubmit);
        mask.querySelector('#__bjtu_portal_recovery_manual_cancel__')?.removeEventListener('click', onCancel);
        recoveryPlain?.removeEventListener('input', onPlainInput);
        recoveryMd5?.removeEventListener('input', onMd5Input);
        recoveryPlain?.removeEventListener('keydown', onKeyDown);
        recoveryMd5?.removeEventListener('keydown', onKeyDown);
        recoveryMask.removeEventListener('mousedown', onMaskDown);
        recoveryMask.removeEventListener('mouseup', onMaskUp);
      };

      if (recoveryMessage instanceof HTMLElement) recoveryMessage.textContent = String(message || '账号或密码错误');
      if (recoveryChoice instanceof HTMLElement) recoveryChoice.style.display = 'flex';
      if (recoveryManual instanceof HTMLElement) recoveryManual.style.display = 'none';
      mask.querySelector('#__bjtu_portal_recovery_reinitialize__')?.addEventListener('click', onReinit);
      mask.querySelector('#__bjtu_portal_recovery_manual_btn__')?.addEventListener('click', onManual);
      mask.querySelector('#__bjtu_portal_recovery_cancel__')?.addEventListener('click', onCancel);
      mask.querySelector('#__bjtu_portal_recovery_default__')?.addEventListener('click', onDefault);
      mask.querySelector('#__bjtu_portal_recovery_submit__')?.addEventListener('click', onSubmit);
      mask.querySelector('#__bjtu_portal_recovery_manual_cancel__')?.addEventListener('click', onCancel);
      recoveryPlain?.addEventListener('input', onPlainInput);
      recoveryMd5?.addEventListener('input', onMd5Input);
      recoveryPlain?.addEventListener('keydown', onKeyDown);
      recoveryMd5?.addEventListener('keydown', onKeyDown);
      recoveryMask.addEventListener('mousedown', onMaskDown);
      recoveryMask.addEventListener('mouseup', onMaskUp);
      recoveryMask.style.display = 'flex';
    });
  }

  async function submit(requestedLoginName = '') {
    if (loginRunning) return;
    const loginName = String(requestedLoginName || username?.value || '').trim();
    if (!loginName) {
      setStatus('请输入或选择账号', 'error');
      username?.focus();
      return;
    }
    if (requestedLoginName && selectedLoginName && loginName !== selectedLoginName) {
      if (plain instanceof HTMLInputElement) plain.value = '';
      if (md5Input instanceof HTMLInputElement) md5Input.value = '';
      if (manual instanceof HTMLElement) manual.style.display = 'none';
    }
    selectedLoginName = loginName;
    if (username instanceof HTMLInputElement) username.value = loginName;
    loginRunning = true;
    setStatus('正在检查登录状态…');
    const statusResponse = await sendMessage({
      type: 'PORTAL_CHECK_LOGIN_STATUS',
      payload: { loginName }
    });
    if (statusResponse?.alreadyLoggedIn) {
      loginRunning = false;
      setStatus('已登录该账号', 'success');
      setTimeout(() => {
        location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';
      }, 350);
      return;
    }
    setStatus('正在登录…');
    const response = await sendMessage({
      type: 'PORTAL_LOGIN_SUBMIT',
      payload: {
        loginName,
        passwordPlain: String(plain?.value || ''),
        passwordEncoded: String(md5Input?.value || '').trim(),
        skipCurrentCheck: true
      }
    });
    loginRunning = false;
    if (response?.ok) {
      setStatus(response.alreadyLoggedIn ? '已登录该账号' : '登录成功', 'success');
      setTimeout(() => {
        location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';
      }, 350);
      return;
    }
    if (response?.reason === 'credential' || response?.reason === 'account-not-found') {
      const recovery = await requestRecovery(loginName, response?.message || '账号或密码错误');
      if (recovery?.action === 'password' && recovery.password) {
        if (plain instanceof HTMLInputElement) plain.value = '';
        if (md5Input instanceof HTMLInputElement) md5Input.value = recovery.password;
        void submit(loginName);
        return;
      }
      setStatus('登录失败', 'error');
      return;
    }
    if (response?.reason === 'needs-password') {
      showManualPassword(loginName);
    }
    setStatus(response?.message || '登录失败', 'error');
  }

  [username, nameInput, plain, md5Input].forEach((element) => {
    element?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (element === nameInput) void searchAccounts();
      else void submit();
    });
  });
})();
