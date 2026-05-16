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
