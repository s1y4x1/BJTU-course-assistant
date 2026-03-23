
function setMsg(text, ok = true) {
  const msg = document.getElementById('msg');
  msg.textContent = text;
  msg.className = ok ? 'ok' : 'err';
}

const DEFAULT_PLATFORM_ENABLED = { ve: true, ykt: true, mrzy: true, jlgj: true };

function normalizePlatformEnabled(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return {
    ve: src.ve !== false,
    ykt: src.ykt !== false,
    mrzy: src.mrzy !== false,
    jlgj: src.jlgj !== false
  };
}

(async function init() {
  const { autoOcrCaptcha } = await chrome.storage.sync.get(['autoOcrCaptcha']);
  const { platformEnabled } = await chrome.storage.local.get(['platformEnabled']);
  const enabled = normalizePlatformEnabled(platformEnabled || DEFAULT_PLATFORM_ENABLED);
  document.getElementById('autoOcrCaptcha').checked = autoOcrCaptcha !== false;
  document.getElementById('enableVe').checked = !!enabled.ve;
  document.getElementById('enableYkt').checked = !!enabled.ykt;
  document.getElementById('enableMrzy').checked = !!enabled.mrzy;
  document.getElementById('enableJlgj').checked = !!enabled.jlgj;
})();

document.getElementById('saveBtn').addEventListener('click', async () => {
  const autoOcrCaptcha = !!document.getElementById('autoOcrCaptcha').checked;
  const platformEnabled = {
    ve: !!document.getElementById('enableVe').checked,
    ykt: !!document.getElementById('enableYkt').checked,
    mrzy: !!document.getElementById('enableMrzy').checked,
    jlgj: !!document.getElementById('enableJlgj').checked
  };

  await chrome.storage.sync.set({ autoOcrCaptcha });
  await chrome.storage.local.set({ platformEnabled });
  await chrome.storage.sync.set({ platformEnabled });

  setMsg('保存成功');
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  await chrome.storage.sync.remove(['autoOcrCaptcha']);
  await chrome.storage.local.remove(['platformEnabled']);
  await chrome.storage.sync.remove(['platformEnabled']);
  document.getElementById('autoOcrCaptcha').checked = true;
  document.getElementById('enableVe').checked = true;
  document.getElementById('enableYkt').checked = true;
  document.getElementById('enableMrzy').checked = true;
  document.getElementById('enableJlgj').checked = true;
  setMsg('已恢复默认配置');
});
