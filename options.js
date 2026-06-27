let msgHideTimer = null;
function setMsg(text, ok = true) {
  const msg = document.getElementById('msg');
  msg.textContent = text;
  msg.className = `${ok ? 'ok' : 'err'} show`;
  if (msgHideTimer) clearTimeout(msgHideTimer);
  msgHideTimer = setTimeout(() => {
    msg.classList.remove('show');
  }, ok ? 1800 : 3200);
}

const DEFAULT_PLATFORM_ENABLED = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false };
const DEFAULT_PLATFORM_VISIBLE = { jlgj: true, mooc: true, mrjzy: true, ve: true, ykt: true };

const DEFAULT_OPEN_MODE = 'popup';

const DEFAULT_SAVE_UPLOADS_ENABLED = true;
const DEFAULT_POPUP_CACHE_ENABLED = true;
const DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED = true;

function normalizePlatformEnabled(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    jlgj: typeof src.jlgj === 'boolean' ? src.jlgj : DEFAULT_PLATFORM_ENABLED.jlgj,
    mooc: typeof src.mooc === 'boolean' ? src.mooc : DEFAULT_PLATFORM_ENABLED.mooc,
    mrjzy: typeof src.mrjzy === 'boolean' ? src.mrjzy : DEFAULT_PLATFORM_ENABLED.mrjzy,
    ve: typeof src.ve === 'boolean' ? src.ve : DEFAULT_PLATFORM_ENABLED.ve,
    ykt: typeof src.ykt === 'boolean' ? src.ykt : DEFAULT_PLATFORM_ENABLED.ykt
  };
}

function normalizePlatformVisible(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return Object.fromEntries(Object.keys(DEFAULT_PLATFORM_VISIBLE).map((key) => [
    key,
    typeof src[key] === 'boolean' ? src[key] : DEFAULT_PLATFORM_VISIBLE[key]
  ]));
}

function goBackToApp() {
  // options.html is opened either as a top-level options page, or embedded inside the
  // popup iframe by app.html's ⚙️ button. Detect which one and route accordingly.
  const inPopup = new URLSearchParams(String(location.search || '')).get('popup') === '1';
  if (inPopup) {
    try { window.location.href = 'app.html?popup=1'; return; } catch {}
  }
  const appUrl = chrome.runtime.getURL('app.html');
  // Prefer reusing an existing app.html tab; otherwise navigate this page to app.html.
  try {
    chrome.tabs.query({ url: appUrl }, (tabs) => {
      if (chrome.runtime.lastError) {
        try { window.location.href = appUrl; } catch {}
        return;
      }
      if (Array.isArray(tabs) && tabs.length) {
        const t = tabs[0];
        try {
          chrome.tabs.update(t.id, { active: true }, () => {
            if (chrome.runtime.lastError) {
              try { window.location.href = appUrl; } catch {}
            } else {
              try { window.close(); } catch {}
            }
          });
        } catch {
          try { window.location.href = appUrl; } catch {}
        }
      } else {
        try { window.location.href = appUrl; } catch {}
      }
    });
  } catch {
    try { window.location.href = appUrl; } catch {}
  }
}

(async function init() {
  const { platformEnabled, platformVisible, injectMoocHelperEnabled } = await chrome.storage.local.get([
    'platformEnabled', 'platformVisible', 'injectMoocHelperEnabled'
  ]);
  try { await chrome.storage.sync.remove(['platformEnabled']); } catch {}
  const { openMode } = await chrome.storage.local.get(['openMode']);
  const { autoLoadCourseResourcesEnabled } = await chrome.storage.local.get(['autoLoadCourseResourcesEnabled']);
  const { saveUploadedFilesEnabled } = await chrome.storage.local.get(['saveUploadedFilesEnabled']);
  const { headerQrEnabled } = await chrome.storage.local.get(['headerQrEnabled']);
  const { linkQrEnabled } = await chrome.storage.local.get(['linkQrEnabled']);
  const { popupUseFullscreenCacheEnabled } = await chrome.storage.local.get(['popupUseFullscreenCacheEnabled']);
  const {
    injectPortalLoginOnLoginPage,
    injectPortalLoginOnTimeoutPage
  } = await chrome.storage.local.get([
    'injectPortalLoginOnLoginPage',
    'injectPortalLoginOnTimeoutPage'
  ]);
  const enabled = normalizePlatformEnabled(platformEnabled);
  const visible = normalizePlatformVisible(platformVisible);
  const effectiveEnabled = Object.fromEntries(Object.keys(DEFAULT_PLATFORM_ENABLED).map((key) => [
    key,
    !!enabled[key] && !!visible[key]
  ]));

  document.getElementById('enableVe').checked = !!effectiveEnabled.ve;
  document.getElementById('enableYkt').checked = !!effectiveEnabled.ykt;
  document.getElementById('enableMrjzy').checked = !!effectiveEnabled.mrjzy;
  document.getElementById('enableJlgj').checked = !!effectiveEnabled.jlgj;
  document.getElementById('enableMooc').checked = !!effectiveEnabled.mooc;
  Object.entries(visible).forEach(([key, value]) => {
    const id = 'show' + key.charAt(0).toUpperCase() + key.slice(1);
    document.getElementById(id).checked = !!value;
  });
  if (Object.keys(effectiveEnabled).some((key) => effectiveEnabled[key] !== enabled[key])) {
    await chrome.storage.local.set({ platformEnabled: effectiveEnabled });
  }
  document.getElementById('injectMoocHelperEnabled').checked = injectMoocHelperEnabled !== false;
  const autoLoadResourcesVal = autoLoadCourseResourcesEnabled === undefined
    ? DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED
    : !!autoLoadCourseResourcesEnabled;
  document.getElementById('autoLoadCourseResourcesEnabled').checked = autoLoadResourcesVal;
  const mode = String(openMode || DEFAULT_OPEN_MODE);
  document.getElementById('openModePopup').checked = mode === 'popup';
  document.getElementById('openModePage').checked = mode === 'page';
  const saveUploadsVal = saveUploadedFilesEnabled === undefined
    ? DEFAULT_SAVE_UPLOADS_ENABLED
    : !!saveUploadedFilesEnabled;
  document.getElementById('saveUploadsEnabled').checked = saveUploadsVal;
  document.getElementById('headerQrEnabled').checked = false;
  document.getElementById('headerQrEnabled').disabled = true;
  if (headerQrEnabled !== false) {
    await chrome.storage.local.set({ headerQrEnabled: false });
  }
  const linkQrVal = linkQrEnabled === undefined ? true : !!linkQrEnabled;
  document.getElementById('linkQrEnabled').checked = linkQrVal;
  const popupCacheVal = popupUseFullscreenCacheEnabled === undefined
    ? DEFAULT_POPUP_CACHE_ENABLED
    : !!popupUseFullscreenCacheEnabled;
  document.getElementById('popupUseFullscreenCacheEnabled').checked = popupCacheVal;
  document.getElementById('injectPortalLoginOnLoginPage').checked = injectPortalLoginOnLoginPage !== false;
  document.getElementById('injectPortalLoginOnTimeoutPage').checked = injectPortalLoginOnTimeoutPage !== false;
  updatePopupCacheDisabled();

  // apply changes immediately when inputs change
  const applyPlatform = async () => {
    const pe = {
      ve: !!document.getElementById('showVe').checked && !!document.getElementById('enableVe').checked,
      ykt: !!document.getElementById('showYkt').checked && !!document.getElementById('enableYkt').checked,
      mrjzy: !!document.getElementById('showMrjzy').checked && !!document.getElementById('enableMrjzy').checked,
      jlgj: !!document.getElementById('showJlgj').checked && !!document.getElementById('enableJlgj').checked,
      mooc: !!document.getElementById('showMooc').checked && !!document.getElementById('enableMooc').checked
    };
    await chrome.storage.local.set({ platformEnabled: pe });
    await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
    setMsg('已应用更改');
  };

  const updatePlatformDetailDisabled = () => {
    const visibleState = {};
    ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].forEach((key) => {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const shown = !!document.getElementById(`show${cap}`).checked;
      visibleState[key] = shown;
      const enableInput = document.getElementById(`enable${cap}`);
      if (!shown) enableInput.checked = false;
      enableInput.disabled = !shown;
      enableInput.closest('label')?.classList.toggle('is-disabled', !shown);
    });
    ['autoLoadCourseResourcesEnabled', 'linkQrEnabled'].forEach((id) => {
      const input = document.getElementById(id);
      input.disabled = !visibleState.ve;
      input.closest('label')?.classList.toggle('is-disabled', !visibleState.ve);
    });
  };

  const applyPlatformVisible = async () => {
    const value = {};
    const enabledValue = {};
    ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].forEach((key) => {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const shown = !!document.getElementById(`show${cap}`).checked;
      const enableInput = document.getElementById(`enable${cap}`);
      value[key] = shown;
      if (!shown) enableInput.checked = false;
      enabledValue[key] = shown && !!enableInput.checked;
    });
    await chrome.storage.local.set({ platformVisible: value, platformEnabled: enabledValue });
    await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
    updatePlatformDetailDisabled();
    setMsg('已应用更改');
  };
  updatePlatformDetailDisabled();

  const applyOpenMode = async () => {
    const v = document.getElementById('openModePage').checked ? 'page' : 'popup';
    await chrome.storage.local.set({ openMode: v });
    updatePopupCacheDisabled();
    setMsg('已应用更改');
  };

  function updatePopupCacheDisabled() {
    const disabled = document.getElementById('openModePage').checked;
    const container = document.getElementById('popupCacheContainer');
    const checkbox = document.getElementById('popupUseFullscreenCacheEnabled');
    container.classList.toggle('is-disabled', disabled);
    checkbox.disabled = disabled;
  }

  function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) el.checked = !!checked;
  }

  function applyPlatformUi(raw) {
    const enabled = normalizePlatformEnabled(raw);
    setChecked('enableVe', enabled.ve);
    setChecked('enableYkt', enabled.ykt);
    setChecked('enableMrjzy', enabled.mrjzy);
    setChecked('enableJlgj', enabled.jlgj);
    setChecked('enableMooc', enabled.mooc);
  }

  function applyPlatformVisibleUi(raw) {
    const visible = normalizePlatformVisible(raw);
    Object.entries(visible).forEach(([key, value]) => {
      setChecked('show' + key.charAt(0).toUpperCase() + key.slice(1), value);
    });
    updatePlatformDetailDisabled();
  }

  function applyOpenModeUi(raw) {
    const mode = String(raw || DEFAULT_OPEN_MODE);
    setChecked('openModePopup', mode !== 'page');
    setChecked('openModePage', mode === 'page');
    updatePopupCacheDisabled();
  }

  function applyBooleanUi(id, raw, fallback = true) {
    setChecked(id, raw === undefined ? fallback : !!raw);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.platformEnabled) applyPlatformUi(changes.platformEnabled.newValue);
      if (changes.platformVisible) applyPlatformVisibleUi(changes.platformVisible.newValue);
      if (changes.injectMoocHelperEnabled) applyBooleanUi('injectMoocHelperEnabled', changes.injectMoocHelperEnabled.newValue, true);
      if (changes.openMode) applyOpenModeUi(changes.openMode.newValue);
      if (changes.autoLoadCourseResourcesEnabled) applyBooleanUi('autoLoadCourseResourcesEnabled', changes.autoLoadCourseResourcesEnabled.newValue, DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED);
      if (changes.saveUploadedFilesEnabled) applyBooleanUi('saveUploadsEnabled', changes.saveUploadedFilesEnabled.newValue, DEFAULT_SAVE_UPLOADS_ENABLED);
      if (changes.headerQrEnabled) {
        const el = document.getElementById('headerQrEnabled');
        if (el instanceof HTMLInputElement) { el.checked = false; el.disabled = true; }
      }
      if (changes.linkQrEnabled) applyBooleanUi('linkQrEnabled', changes.linkQrEnabled.newValue, true);
      if (changes.popupUseFullscreenCacheEnabled) {
        applyBooleanUi('popupUseFullscreenCacheEnabled', changes.popupUseFullscreenCacheEnabled.newValue, DEFAULT_POPUP_CACHE_ENABLED);
      }
      if (changes.injectPortalLoginOnLoginPage) {
        applyBooleanUi('injectPortalLoginOnLoginPage', changes.injectPortalLoginOnLoginPage.newValue, true);
      }
      if (changes.injectPortalLoginOnTimeoutPage) {
        applyBooleanUi('injectPortalLoginOnTimeoutPage', changes.injectPortalLoginOnTimeoutPage.newValue, true);
      }
    });
  } catch {
    // ignore non-extension contexts
  }

  document.getElementById('enableVe').addEventListener('change', applyPlatform);
  document.getElementById('enableYkt').addEventListener('change', applyPlatform);
  document.getElementById('enableMrjzy').addEventListener('change', applyPlatform);
  document.getElementById('enableJlgj').addEventListener('change', applyPlatform);
  document.getElementById('enableMooc').addEventListener('change', applyPlatform);
  ['showVe', 'showYkt', 'showMrjzy', 'showJlgj', 'showMooc'].forEach((id) => {
    document.getElementById(id).addEventListener('change', applyPlatformVisible);
  });
  document.getElementById('injectMoocHelperEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({ injectMoocHelperEnabled: !!document.getElementById('injectMoocHelperEnabled').checked });
    setMsg('已应用更改');
  });
  document.getElementById('openModePopup').addEventListener('change', applyOpenMode);
  document.getElementById('openModePage').addEventListener('change', applyOpenMode);

  document.getElementById('autoLoadCourseResourcesEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      autoLoadCourseResourcesEnabled: !!document.getElementById('autoLoadCourseResourcesEnabled').checked
    });
    setMsg('已应用更改');
  });

  ['injectPortalLoginOnLoginPage', 'injectPortalLoginOnTimeoutPage'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      await chrome.storage.local.set({ [id]: !!document.getElementById(id).checked });
      setMsg('已应用更改');
    });
  });

  document.getElementById('saveUploadsEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      saveUploadedFilesEnabled: !!document.getElementById('saveUploadsEnabled').checked
    });
    setMsg('已应用更改');
  });

  (() => {
    const cb = document.getElementById('headerQrEnabled');
    const label = cb?.closest('label');
    if (label) {
      label.addEventListener('click', (e) => {
        e.preventDefault();
        cb.checked = false;
        setMsg('此功能所需条件已被智慧课程平台禁用', false);
        chrome.storage.local.set({ headerQrEnabled: false });
      });
    }
  })();

  document.getElementById('linkQrEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      linkQrEnabled: !!document.getElementById('linkQrEnabled').checked
    });
    setMsg('已应用更改');
  });

  document.getElementById('popupUseFullscreenCacheEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      popupUseFullscreenCacheEnabled: !!document.getElementById('popupUseFullscreenCacheEnabled').checked
    });
    setMsg('已应用更改');
  });

  // "BJTU 上传助手" link: navigate to app.html
  const backHome = document.getElementById('back-home');
  if (backHome) {
    const go = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      goBackToApp();
    };
    backHome.addEventListener('click', go);
    backHome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') go(e);
    });
  }

  const bindBtn = document.getElementById('bindPortalUsernameBtn');
  if (bindBtn) {
    bindBtn.addEventListener('click', async () => {
      bindBtn.disabled = true;
      const bindUrl = 'http://123.121.147.7:88/oauth/api/user/thirdLogin';
      try {
        const { username } = await chrome.storage.local.get(['username']);
        const resp = await chrome.runtime.sendMessage({
          type: 'START_BIND_PORTAL_USERNAME',
          payload: { loginName: String(username || '').trim() }
        });
        if (!resp?.ok) {
          await chrome.tabs.create({ url: bindUrl, active: true });
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
          return;
        }
        setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
      } catch (e) {
        try {
          await chrome.tabs.create({ url: bindUrl, active: true });
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
        } catch (err) {
          setMsg(String(err?.message || e?.message || e || '无法打开 MIS 绑定页面'), false);
          bindBtn.disabled = false;
        }
      }
    });
  }

  document.getElementById('exportBindDataBtn').addEventListener('click', async () => {
    const withQuick = await globalThis.BjtuAccountStore.getQuickAccounts();
    if (!withQuick.length) {
      setMsg('没有找到已绑定 MIS 的账号', false);
      return;
    }
    const lines = [];
    for (const acc of withQuick) {
      const loginName = String(acc.loginName || acc.userId || '').trim();
      const quickUsername = String(acc.quickUsername || '').trim();
      if (!loginName || !quickUsername) continue;
      try {
        lines.push(`${loginName}:${atob(quickUsername)}`);
      } catch { /* skip invalid base64 */ }
    }
    if (!lines.length) {
      setMsg('没有找到有效的绑定数据', false);
      return;
    }
    const encoded = btoa(lines.join('\n'));
    try {
      await navigator.clipboard.writeText(encoded);
    } catch {
      setMsg('复制到剪贴板失败', false);
      return;
    }
    document.getElementById('exportBindModal').style.display = 'flex';
  });

  document.getElementById('exportBindGithubBtn').addEventListener('click', () => {
    document.getElementById('exportBindModal').style.display = 'none';
    chrome.tabs.create({ url: 'https://github.com/s1y4x1/BJTU-course-assistant/discussions/2', active: true });
  });

  document.getElementById('exportBindWjxBtn').addEventListener('click', () => {
    document.getElementById('exportBindModal').style.display = 'none';
    chrome.tabs.create({ url: 'https://v.wjx.cn/vm/eW3zqxc.aspx', active: true });
  });

  document.getElementById('exportBindCloseBtn').addEventListener('click', () => {
    document.getElementById('exportBindModal').style.display = 'none';
  });

  document.getElementById('exportBindModal').addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.dataset.mdownMask = '1';
  });
  document.getElementById('exportBindModal').addEventListener('mouseup', (e) => {
    if (e.target === e.currentTarget && e.currentTarget.dataset.mdownMask === '1') {
      e.currentTarget.style.display = 'none';
    }
    e.currentTarget.dataset.mdownMask = '';
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'PORTAL_USERNAME_BIND_STATUS') return;
    const st = message.payload || {};
    if (st.status === 'done') {
      setMsg(`已绑定快速登录 username：${st.userId || st.quickUsername || ''}`);
      if (bindBtn) bindBtn.disabled = false;
    } else if (st.status === 'detected') {
      setMsg('已检测到新 username，正在匹配账号信息');
    } else if (st.status === 'error') {
      setMsg(`绑定失败：${st.error || '无法匹配账号信息'}`, false);
      if (bindBtn) bindBtn.disabled = false;
    }
  });

  const importAccountListBtn = document.getElementById('importAccountListBtn');
  const importAccountListFile = document.getElementById('importAccountListFile');
  const setAccountProgressTitle = (title) => {
    const el = document.querySelector('#account-init-modal .account-progress-title');
    if (el instanceof HTMLElement) el.textContent = String(title || '账号列表');
  };
  importAccountListBtn?.addEventListener('click', () => {
    importAccountListFile.value = '';
    importAccountListFile.click();
  });
  importAccountListFile?.addEventListener('change', async () => {
    const file = importAccountListFile.files?.[0];
    if (!file) return;
    importAccountListBtn.disabled = true;
    try {
      setAccountProgressTitle('导入登录账号列表');
      const count = await globalThis.BjtuAccountLogin.importAccountFile(await file.text(), { showProgress: true });
      setMsg('已导入 ' + count + ' 个账号');
    } catch (error) {
      setMsg('导入失败：' + String(error?.message || error), false);
    } finally {
      const progressModal = document.getElementById('account-init-modal');
      if (progressModal) progressModal.style.display = 'none';
      importAccountListBtn.disabled = false;
    }
  });
  const exportAccountListBtn = document.getElementById('exportAccountListBtn');
  exportAccountListBtn?.addEventListener('click', async () => {
    exportAccountListBtn.disabled = true;
    setAccountProgressTitle('导出登录账号列表');
    try {
      const payload = await globalThis.BjtuAccountLogin.exportAccountFile({ showProgress: true });
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bjtu-account-list-' + new Date().toISOString().slice(0, 10) + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg('已导出教职工 ' + Number(payload.summary?.teacher || 0)
        + ' 个、学生 ' + Number(payload.summary?.student || 0) + ' 个');
    } catch (error) {
      setMsg('导出失败：' + String(error?.message || error), false);
    } finally {
      const progressModal = document.getElementById('account-init-modal');
      if (progressModal) progressModal.style.display = 'none';
      exportAccountListBtn.disabled = false;
    }
  });

  // Reset: restore defaults. Platform display/load should only check VE.
  document.getElementById('resetBtn').addEventListener('click', async () => {
    const defaultPlatform = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false };
    await chrome.storage.local.set({
      platformEnabled: defaultPlatform,
      platformVisible: { ...DEFAULT_PLATFORM_VISIBLE },
      injectMoocHelperEnabled: true
    });
    await chrome.storage.sync.remove(['platformEnabled']);
    document.getElementById('enableVe').checked = true;
    document.getElementById('enableYkt').checked = false;
    document.getElementById('enableMrjzy').checked = false;
    document.getElementById('enableJlgj').checked = false;
    document.getElementById('enableMooc').checked = false;
    ['showVe', 'showYkt', 'showMrjzy', 'showJlgj', 'showMooc'].forEach((id) => {
      document.getElementById(id).checked = true;
    });
    document.getElementById('injectMoocHelperEnabled').checked = true;
    updatePlatformDetailDisabled();
    document.getElementById('autoLoadCourseResourcesEnabled').checked = true;
    document.getElementById('openModePopup').checked = true;
    document.getElementById('openModePage').checked = false;
    document.getElementById('saveUploadsEnabled').checked = true;
    document.getElementById('headerQrEnabled').checked = false;
    document.getElementById('headerQrEnabled').disabled = true;
    document.getElementById('linkQrEnabled').checked = true;
    document.getElementById('popupUseFullscreenCacheEnabled').checked = true;
    document.getElementById('injectPortalLoginOnLoginPage').checked = true;
    document.getElementById('injectPortalLoginOnTimeoutPage').checked = true;
    updatePopupCacheDisabled();
    await chrome.storage.local.set({ openMode: DEFAULT_OPEN_MODE });
    await chrome.storage.local.set({ autoLoadCourseResourcesEnabled: DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED });
    await chrome.storage.local.set({ saveUploadedFilesEnabled: DEFAULT_SAVE_UPLOADS_ENABLED });
    await chrome.storage.local.set({ headerQrEnabled: false });
    await chrome.storage.local.set({ linkQrEnabled: true });
    await chrome.storage.local.set({ popupUseFullscreenCacheEnabled: DEFAULT_POPUP_CACHE_ENABLED });
    await chrome.storage.local.set({
      injectPortalLoginOnLoginPage: true,
      injectPortalLoginOnTimeoutPage: true
    });
    setMsg('已恢复默认配置');
  });
})();
