(function loadBjtuVeOptionsModule(global) {
  'use strict';

  global.__bjtuVeOptionsReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    if (!available.ve) return false;
    await global.BjtuModuleRegistry.loadScript('modules/ve/account-store.js');
    await global.BjtuModuleRegistry.loadScript('modules/ve/account-login.js');
    return true;
  })().catch((error) => {
    console.warn('[bjtu] VE options module unavailable:', String(error?.message || error));
    if (global.__bjtuAvailableModules) global.__bjtuAvailableModules.ve = false;
    return false;
  });
})(globalThis);
