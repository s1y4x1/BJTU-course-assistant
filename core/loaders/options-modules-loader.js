(function loadOptionsModules(global) {
  'use strict';

  const controllers = new Map();
  global.BjtuOptionsModules = {
    register(id, controller) {
      if (id && controller) controllers.set(String(id), controller);
    },
    async initAll(context) {
      await global.__bjtuOptionsModulesReady;
      await Promise.all([...controllers.values()].map((controller) => controller.init?.(context)));
    },
    async resetAll() {
      await Promise.all([...controllers.values()].map((controller) => controller.reset?.()));
    }
  };

  global.__bjtuOptionsModulesReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    const host = document.getElementById('options-module-slots');
    if (!(host instanceof HTMLElement)) return [];
    const loaded = [];
    for (const [id, definition] of Object.entries(global.BjtuModuleRegistry.definitions)) {
      const options = definition?.options;
      if (!available[id] || !options) continue;
      const response = await fetch(chrome.runtime.getURL(`modules/${id}/${options.fragment}`), {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`${definition.label}选项片段 HTTP ${response.status}`);
      const slot = document.createElement('div');
      slot.dataset.optionsModule = id;
      slot.dataset.optionsSection = `module:${id}`;
      slot.dataset.optionsLabel = definition.label || id;
      slot.classList.toggle('options-wide-card', options.wide === true);
      const source = await response.text();
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      const fragment = parsed.querySelector('[data-options-fragment]');
      slot.innerHTML = fragment ? fragment.outerHTML : source;
      slot.querySelectorAll('[data-module-options-link]').forEach((link) => {
        if (!(link instanceof HTMLAnchorElement)) return;
        link.href = chrome.runtime.getURL(`modules/${id}/${options.fragment}`);
      });
      host.before(slot);
      if (options.style) await global.BjtuModuleRegistry.loadStyle(`modules/${id}/${options.style}`);
      if (options.script) await global.BjtuModuleRegistry.loadScript(`modules/${id}/${options.script}`);
      loaded.push(id);
    }
    host.remove();
    return loaded;
  })().catch((error) => {
    console.warn('[bjtu] options modules unavailable:', String(error?.message || error));
    return [];
  });
})(globalThis);
