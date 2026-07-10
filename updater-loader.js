(function loadBjtuUpdater(global) {
  'use strict';
  global.__bjtuUpdaterReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    if (!available.updater) return false;
    await global.BjtuModuleRegistry.loadScript('modules/updater/filesystem.js');
    await global.BjtuModuleRegistry.loadScript('modules/updater/checker.js');
    return true;
  })().catch(() => false);
})(globalThis);
