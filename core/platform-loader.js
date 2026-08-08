(function loadBjtuPlatformModules(global) {
  'use strict';
  const scripts = {
    ykt: ['modules/ykt/platform.js'],
    mrjzy: ['core/md5.js', 'modules/mrjzy/platform.js'],
    jlgj: ['modules/jlgj/platform.js'],
    mooc: ['modules/mooc/platform.js'],
    xuetangx: ['modules/xuetangx/platform.js']
  };
  global.__bjtuPlatformModulesReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    for (const [id, paths] of Object.entries(scripts)) {
      if (!available[id]) continue;
      const styles = global.BjtuModuleRegistry.definitions[id]?.styles || [];
      for (const path of styles) {
        await global.BjtuModuleRegistry.loadStyle(`modules/${id}/${path}`);
      }
      for (const path of paths) await global.BjtuModuleRegistry.loadScript(path);
    }
    return available;
  })();
})(globalThis);
