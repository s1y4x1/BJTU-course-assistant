(function loadBjtuAndroidWebViewBridge() {
  if (typeof window === 'undefined' || window.location?.protocol !== 'file:') return;
  const current = document.currentScript;
  if (!current) return;
  const bridgeUrl = new URL('../../android-app/android-webview.js', current.src).href;
  document.write(`<script src="${bridgeUrl.replace(/"/g, '&quot;')}"><\/script>`);
})();
