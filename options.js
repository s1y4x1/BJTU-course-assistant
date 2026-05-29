function setMsg(text, ok = true) {
  const msg = document.getElementById('msg');
  msg.textContent = text;
  msg.className = ok ? 'ok' : 'err';
}

const DEFAULT_PLATFORM_ENABLED = { jlgj: false, mrzy: false, ve: true, ykt: false };

const DEFAULT_OPEN_MODE = 'popup';

function normalizePlatformEnabled(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    jlgj: typeof src.jlgj === 'boolean' ? src.jlgj : DEFAULT_PLATFORM_ENABLED.jlgj,
    mrzy: typeof src.mrzy === 'boolean' ? src.mrzy : DEFAULT_PLATFORM_ENABLED.mrzy,
    ve: typeof src.ve === 'boolean' ? src.ve : DEFAULT_PLATFORM_ENABLED.ve,
    ykt: typeof src.ykt === 'boolean' ? src.ykt : DEFAULT_PLATFORM_ENABLED.ykt
  };
}

(async function init() {
  const { platformEnabled } = await chrome.storage.local.get(['platformEnabled']);
  const { openMode } = await chrome.storage.local.get(['openMode']);
  const enabled = normalizePlatformEnabled(platformEnabled);

  document.getElementById('enableVe').checked = !!enabled.ve;
  document.getElementById('enableYkt').checked = !!enabled.ykt;
  document.getElementById('enableMrzy').checked = !!enabled.mrzy;
  document.getElementById('enableJlgj').checked = !!enabled.jlgj;
  const mode = String(openMode || DEFAULT_OPEN_MODE);
  document.getElementById('openModePopup').checked = mode === 'popup';
  document.getElementById('openModePage').checked = mode === 'page';

  // apply changes immediately when inputs change
  const applyPlatform = async () => {
    const pe = {
      ve: !!document.getElementById('enableVe').checked,
      ykt: !!document.getElementById('enableYkt').checked,
      mrzy: !!document.getElementById('enableMrzy').checked,
      jlgj: !!document.getElementById('enableJlgj').checked
    };
    await chrome.storage.local.set({ platformEnabled: pe });
    await chrome.storage.sync.set({ platformEnabled: pe }).catch(() => {});
    setMsg('已应用更改');
  };

  const applyOpenMode = async () => {
    const v = document.getElementById('openModePage').checked ? 'page' : 'popup';
    await chrome.storage.local.set({ openMode: v });
    setMsg('已应用更改');
  };

  document.getElementById('enableVe').addEventListener('change', applyPlatform);
  document.getElementById('enableYkt').addEventListener('change', applyPlatform);
  document.getElementById('enableMrzy').addEventListener('change', applyPlatform);
  document.getElementById('enableJlgj').addEventListener('change', applyPlatform);
  document.getElementById('openModePopup').addEventListener('change', applyOpenMode);
  document.getElementById('openModePage').addEventListener('change', applyOpenMode);

  const bindBtn = document.getElementById('bindPortalUsernameBtn');
  if (bindBtn) {
    bindBtn.addEventListener('click', async () => {
      bindBtn.disabled = true;
      const bindUrl = 'http://123.121.147.7:88/oauth/api/user/thirdLogin';
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'START_BIND_PORTAL_USERNAME' });
        if (!resp?.ok) {
          await chrome.tabs.create({ url: bindUrl, active: true });
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录/授权');
          return;
        }
        setMsg('已打开 MIS 绑定页面，请在新标签页完成登录/授权');
      } catch (e) {
        try {
          await chrome.tabs.create({ url: bindUrl, active: true });
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录/授权');
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
    const defaultPlatform = { jlgj: false, mrzy: false, ve: true, ykt: false };
    await chrome.storage.local.set({ platformEnabled: defaultPlatform });
    await chrome.storage.sync.remove(['platformEnabled']);
    document.getElementById('enableVe').checked = true;
    document.getElementById('enableYkt').checked = false;
    document.getElementById('enableMrzy').checked = false;
    document.getElementById('enableJlgj').checked = false;
    document.getElementById('openModePopup').checked = true;
    document.getElementById('openModePage').checked = false;
    await chrome.storage.local.set({ openMode: DEFAULT_OPEN_MODE });
    setMsg('已恢复默认配置');
  });
})();
