(function loadBjtuUpdater(global) {
  'use strict';
  global.__bjtuUpdaterReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    if (!available.updater) return false;
    await global.BjtuModuleRegistry.loadStyle('UI/file-size-emphasis.css');
    await global.BjtuModuleRegistry.loadScript('UI/file-size-emphasis.js');
    await global.BjtuModuleRegistry.loadStyle('modules/updater/app.css');
    const markupResponse = await fetch(chrome.runtime.getURL('modules/updater/app.html'), {
      cache: 'no-store'
    });
    if (!markupResponse.ok) throw new Error(`无法加载更新模块界面：HTTP ${markupResponse.status}`);
    const holder = document.createElement('template');
    holder.innerHTML = await markupResponse.text();
    document.body.appendChild(holder.content.cloneNode(true));
    await global.BjtuModuleRegistry.loadScript('modules/updater/filesystem.js');
    await global.BjtuModuleRegistry.loadScript('core/vendor/marked.umd.js');
    await global.BjtuModuleRegistry.loadScript('modules/updater/checker.js');
    return true;
  })().catch((error) => {
    console.error('[bjtu] updater module failed to load:', error);
    const versionBtn = typeof document !== 'undefined' ? document.getElementById('version-btn') : null;
    if (versionBtn instanceof HTMLButtonElement) {
      versionBtn.style.display = '';
      versionBtn.className = 'version-btn failure';
      versionBtn.disabled = false;
      versionBtn.textContent = '更新组件加载失败';
    }
    return false;
  });
})(globalThis);
