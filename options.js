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

const DEFAULT_PLATFORM_ENABLED = { jlgj: false, mrjzy: false, ve: true, ykt: false };

const DEFAULT_OPEN_MODE = 'popup';

const DEFAULT_SAVE_UPLOADS_ENABLED = true;
const DEFAULT_POPUP_CACHE_ENABLED = true;
const DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED = true;

function normalizePlatformEnabled(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    jlgj: typeof src.jlgj === 'boolean' ? src.jlgj : DEFAULT_PLATFORM_ENABLED.jlgj,
    mrjzy: typeof src.mrjzy === 'boolean' ? src.mrjzy : DEFAULT_PLATFORM_ENABLED.mrjzy,
    ve: typeof src.ve === 'boolean' ? src.ve : DEFAULT_PLATFORM_ENABLED.ve,
    ykt: typeof src.ykt === 'boolean' ? src.ykt : DEFAULT_PLATFORM_ENABLED.ykt
  };
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
  const { platformEnabled } = await chrome.storage.local.get(['platformEnabled']);
  try { await chrome.storage.sync.remove(['platformEnabled']); } catch {}
  const { openMode } = await chrome.storage.local.get(['openMode']);
  const { autoCaptcha } = await chrome.storage.local.get(['autoCaptcha']);
  const { autoLoadCourseResourcesEnabled } = await chrome.storage.local.get(['autoLoadCourseResourcesEnabled']);
  const { saveUploadedFilesEnabled } = await chrome.storage.local.get(['saveUploadedFilesEnabled']);
  const { linkQrEnabled } = await chrome.storage.local.get(['linkQrEnabled']);
  const { popupUseFullscreenCacheEnabled } = await chrome.storage.local.get(['popupUseFullscreenCacheEnabled']);
  const enabled = normalizePlatformEnabled(platformEnabled);

  document.getElementById('enableVe').checked = !!enabled.ve;
  document.getElementById('enableYkt').checked = !!enabled.ykt;
  document.getElementById('enableMrjzy').checked = !!enabled.mrjzy;
  document.getElementById('enableJlgj').checked = !!enabled.jlgj;
  const autoCaptchaVal = autoCaptcha === undefined ? true : !!autoCaptcha;
  document.getElementById('autoCaptcha').checked = autoCaptchaVal;
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
  const linkQrVal = linkQrEnabled === undefined ? true : !!linkQrEnabled;
  document.getElementById('linkQrEnabled').checked = linkQrVal;
  const popupCacheVal = popupUseFullscreenCacheEnabled === undefined
    ? DEFAULT_POPUP_CACHE_ENABLED
    : !!popupUseFullscreenCacheEnabled;
  document.getElementById('popupUseFullscreenCacheEnabled').checked = popupCacheVal;
  updatePopupCacheDisabled();

  // apply changes immediately when inputs change
  const applyPlatform = async () => {
    const pe = {
      ve: !!document.getElementById('enableVe').checked,
      ykt: !!document.getElementById('enableYkt').checked,
      mrjzy: !!document.getElementById('enableMrjzy').checked,
      jlgj: !!document.getElementById('enableJlgj').checked
    };
    await chrome.storage.local.set({ platformEnabled: pe });
    await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
    setMsg('已应用更改');
  };

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
      if (changes.openMode) applyOpenModeUi(changes.openMode.newValue);
      if (changes.autoCaptcha) applyBooleanUi('autoCaptcha', changes.autoCaptcha.newValue, true);
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
    });
  } catch {
    // ignore non-extension contexts
  }

  document.getElementById('enableVe').addEventListener('change', applyPlatform);
  document.getElementById('enableYkt').addEventListener('change', applyPlatform);
  document.getElementById('enableMrjzy').addEventListener('change', applyPlatform);
  document.getElementById('enableJlgj').addEventListener('change', applyPlatform);
  document.getElementById('openModePopup').addEventListener('change', applyOpenMode);
  document.getElementById('openModePage').addEventListener('change', applyOpenMode);

  document.getElementById('autoCaptcha').addEventListener('change', async () => {
    await chrome.storage.local.set({ autoCaptcha: !!document.getElementById('autoCaptcha').checked });
    setMsg('已应用更改');
  });

  document.getElementById('autoLoadCourseResourcesEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      autoLoadCourseResourcesEnabled: !!document.getElementById('autoLoadCourseResourcesEnabled').checked
    });
    setMsg('已应用更改');
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
        const resp = await chrome.runtime.sendMessage({ type: 'START_BIND_PORTAL_USERNAME' });
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

  // Reset: restore defaults. Platform display/load should only check VE.
  document.getElementById('resetBtn').addEventListener('click', async () => {
    const defaultPlatform = { jlgj: false, mrjzy: false, ve: true, ykt: false };
    await chrome.storage.local.set({ platformEnabled: defaultPlatform });
    await chrome.storage.sync.remove(['platformEnabled']);
    document.getElementById('enableVe').checked = true;
    document.getElementById('enableYkt').checked = false;
    document.getElementById('enableMrjzy').checked = false;
    document.getElementById('enableJlgj').checked = false;
    document.getElementById('autoCaptcha').checked = true;
    document.getElementById('autoLoadCourseResourcesEnabled').checked = true;
    document.getElementById('openModePopup').checked = true;
    document.getElementById('openModePage').checked = false;
    document.getElementById('saveUploadsEnabled').checked = true;
    document.getElementById('headerQrEnabled').checked = false;
    document.getElementById('headerQrEnabled').disabled = true;
    document.getElementById('linkQrEnabled').checked = true;
    document.getElementById('popupUseFullscreenCacheEnabled').checked = true;
    updatePopupCacheDisabled();
    await chrome.storage.local.set({ openMode: DEFAULT_OPEN_MODE });
    await chrome.storage.local.set({ autoCaptcha: true });
    await chrome.storage.local.set({ autoLoadCourseResourcesEnabled: DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED });
    await chrome.storage.local.set({ saveUploadedFilesEnabled: DEFAULT_SAVE_UPLOADS_ENABLED });
    await chrome.storage.local.set({ headerQrEnabled: false });
    await chrome.storage.local.set({ linkQrEnabled: true });
    await chrome.storage.local.set({ popupUseFullscreenCacheEnabled: DEFAULT_POPUP_CACHE_ENABLED });
    setMsg('已恢复默认配置');
  });
})();
