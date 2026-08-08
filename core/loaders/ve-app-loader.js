(function loadBjtuVeAppModule(global) {
  'use strict';

  const scripts = [
    'modules/ve/vendor/main.min.js',
    'modules/ve/login-utils.js',
    'modules/ve/login-credentials-dialog.js',
    'modules/ve/account-store.js',
    'modules/ve/account-login.js',
    'modules/ve/homework-core.js',
    'modules/ve/platform.js',
    'modules/ve/session.js',
    'modules/ve/resource-download.js'
  ];

  global.__bjtuVeAppReady = (async () => {
    if (new URLSearchParams(global.location?.search || '').get('autoUpdate') === '1') return false;
    const available = await global.BjtuModuleRegistry.ready;
    if (!available.ve) return false;
    for (const path of global.BjtuModuleRegistry.definitions.ve?.styles || []) {
      await global.BjtuModuleRegistry.loadStyle(`modules/ve/${path}`);
    }
    for (const path of scripts) await global.BjtuModuleRegistry.loadScript(path);
    if (available.captcha) {
      await global.BjtuModuleRegistry.loadScript('modules/captcha/recognizer.js');
    }
    return true;
  })().catch((error) => {
    console.warn('[bjtu] VE module unavailable:', String(error?.message || error));
    if (global.__bjtuAvailableModules) global.__bjtuAvailableModules.ve = false;
    return false;
  });

  global.__bjtuVeAppReady.then((loaded) => {
    if (loaded) return;
    const defineFallback = (name, implementation) => {
      if (typeof global[name] !== 'function') global[name] = implementation;
    };
    defineFallback('renderCourseList', () => global.updateCourseListEmptyPlaceholder?.());
    defineFallback('updateResourceDownloadTotals', () => {});
    defineFallback('updateJsessionidState', () => {});
    defineFallback('syncJsessionidToUi', async () => {});
    defineFallback('loadResourceSpaceForCurrentAccount', async () => null);
    defineFallback('reloadVePlatformFromSession', async () => null);
    defineFallback('updateAssessmentButtonVisibility', () => {});
    defineFallback('bindCourseCardActionButtons', () => {});
    defineFallback('renderForcePublishScoreButton', () => '');
    defineFallback('updateArchiveButtonVisibility', () => {});
    defineFallback('buildResourceSizeEmphasisStyle', () => '');
  });
})(globalThis);
