(function loadBjtuPlatformModules(global) {
  'use strict';
  const scripts = {
    ykt: ['modules/ykt/platform.js'],
    mrjzy: ['modules/mrjzy/md5.js', 'modules/mrjzy/platform.js'],
    jlgj: ['modules/jlgj/platform.js'],
    mooc: ['modules/mooc/platform.js'],
    xuetangx: ['modules/xuetangx/platform.js']
  };
  global.__bjtuPlatformModulesReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    for (const [id, paths] of Object.entries(scripts)) {
      if (!available[id]) continue;
      for (const path of paths) await global.BjtuModuleRegistry.loadScript(path);
    }
    return available;
  })();
})(globalThis);
