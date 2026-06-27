(async () => {
  try {
    if (!new URL(location.href).searchParams.get('tid')) return;
    const { injectMoocHelperEnabled } = await chrome.storage.local.get(['injectMoocHelperEnabled']);
    if (injectMoocHelperEnabled === false) return;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('MOOC.js');
    script.dataset.bjtuMoocHelper = '1';
    (document.head || document.documentElement).appendChild(script);
    script.addEventListener('load', () => script.remove(), { once: true });
  } catch {
    // Leave the host page untouched when extension storage is unavailable.
  }
})();
