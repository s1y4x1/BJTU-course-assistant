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
    const autoUpdateParam = new URLSearchParams(global.location?.search || '').get('autoUpdate');
    if (autoUpdateParam === '1' || autoUpdateParam === '2') return false;
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
    defineFallback('setResourceSpaceStatus', (text = '', tone = 'normal') => {
      if (!resourceSpaceStatus) return;
      resourceSpaceStatus.textContent = String(text || '');
      if (tone === 'error') resourceSpaceStatus.style.color = '#b91c1c';
      else if (tone === 'success') resourceSpaceStatus.style.color = '#166534';
      else if (tone === 'warning') resourceSpaceStatus.style.color = '#92400e';
      else resourceSpaceStatus.style.color = '#64748b';
    });
    defineFallback('updateAssessmentButtonVisibility', () => {});
    defineFallback('bindCourseCardActionButtons', () => {});
    defineFallback('renderForcePublishScoreButton', () => '');
    defineFallback('updateArchiveButtonVisibility', () => {});
    defineFallback('buildResourceSizeEmphasisStyle', () => '');
  });
})(globalThis);
