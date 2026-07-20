(function loadBjtuUpdater(global) {
  'use strict';
  global.__bjtuUpdaterReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    if (!available.updater) return false;
    await global.BjtuModuleRegistry.loadScript('modules/updater/filesystem.js');
    await global.BjtuModuleRegistry.loadScript('modules/updater/vendor/marked.umd.js');
    await global.BjtuModuleRegistry.loadScript('modules/updater/checker.js');
    return true;
  })().catch((error) => {
    console.error('[bjtu] updater module failed to load:', error);
    const versionBtn = typeof document !== 'undefined' ? document.getElementById('version-btn') : null;
    if (versionBtn instanceof HTMLButtonElement) {
      versionBtn.className = 'version-btn failure';
      versionBtn.disabled = false;
      versionBtn.textContent = '更新组件加载失败';
    }
    return false;
  });
})(globalThis);
