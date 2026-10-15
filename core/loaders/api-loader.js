(function loadBjtuApiPage(global) {
  'use strict';
  global.__bjtuApiReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    if (!available.api) return false;
    await global.BjtuModuleRegistry.loadScript('modules/api/page.js');
    return true;
  })().catch((error) => {
    console.error('[bjtu] 扩展接口加载失败：', error);
    return false;
  });
})(globalThis);
