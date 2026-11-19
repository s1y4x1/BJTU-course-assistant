(function recommendAndroidRuntime() {
  'use strict';
  const key = 'androidRuntimeRecommendationSeen';
  const params = new URLSearchParams(location.search);
  if (globalThis.BJTU_ANDROID_WEBVIEW || params.get('popup') === '1' || params.get('view') === 'sidepanel') return;
  async function run() {
    const stored = (await chrome.storage.local.get(key))[key];
    if (stored?.never) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let apk, version;
    try {
      const response = await fetch('https://s1y4x1.github.io/release.json', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const release = await response.json();
      apk = new URL(release.apk);
      version = String(release.ver || chrome.runtime.getManifest().version);
      if (stored?.version === version) return;
      if (apk.protocol !== 'https:' || apk.username || apk.password || !apk.pathname.toLowerCase().endsWith('.apk')) return;
    } catch { return; } finally { clearTimeout(timer); }
    // Do not cover account setup, directory authorization or an update confirmation.
    for (let tries = 0; tries < 60; tries++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (document.visibilityState !== 'visible' || [...document.querySelectorAll('.version-modal-mask')].some(node => getComputedStyle(node).display !== 'none')) continue;
      const latest = (await chrome.storage.local.get(key))[key];
      if (latest?.never || latest?.version === version) return;
      if (typeof buildQrImageUrl !== 'function') return;
      const modal = document.createElement('div'); modal.className = 'version-modal-mask android-recommendation';
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'android-recommendation-title');
      modal.innerHTML = '<div class="version-modal-card"><div class="version-modal-header"><strong id="android-recommendation-title">在 Android 上使用课程助手</strong></div><p>扫码下载 Android 运行层。首次启动将下载扩展代码，以后可在应用内更新。</p><img alt="Android APK 下载二维码"><p><a target="_blank" rel="noopener noreferrer">下载 Android APK</a></p><div class="android-recommendation-actions"><button type="button" class="btn android-recommendation-next">下次更新时再提醒</button><button type="button" class="btn android-recommendation-never">不再提醒</button><button type="button" class="btn android-recommendation-later">稍后再说</button></div></div>';
      modal.querySelector('img').src = buildQrImageUrl(apk.href, 132);
      modal.querySelector('a').href = apk.href;
      const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = event => { if (event.key === 'Escape') close(); };
      modal.addEventListener('click', event => { if (event.target === modal) close(); });
      modal.querySelector('.android-recommendation-next').addEventListener('click', async () => { await chrome.storage.local.set({ [key]: { version } }); close(); });
      modal.querySelector('.android-recommendation-never').addEventListener('click', async () => { await chrome.storage.local.set({ [key]: { never: true } }); close(); });
      modal.querySelector('.android-recommendation-later').addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(modal); modal.style.display = 'flex';
      modal.querySelector('button').focus();
      return;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void run().catch(() => {}); }, { once: true });
  else void run().catch(() => {});
})();
