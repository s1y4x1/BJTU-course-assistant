(function loadBjtuQwenApp(global) {
  'use strict';
  global.__bjtuQwenAppReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    if (!available.qwen) return false;
    await global.BjtuModuleRegistry.loadStyle('UI/file-size-emphasis.css');
    await global.BjtuModuleRegistry.loadScript('UI/file-size-emphasis.js');
    await global.BjtuModuleRegistry.loadStyle('modules/qwen/app.css');
    await global.BjtuModuleRegistry.loadStyle('modules/qwen/operations-ui.css');
    const markupResponse = await fetch(chrome.runtime.getURL('modules/qwen/app.html'), {
      cache: 'no-store'
    });
    if (!markupResponse.ok) throw new Error(`无法加载 Qwen 模块界面：HTTP ${markupResponse.status}`);
    const holder = document.createElement('template');
    holder.innerHTML = await markupResponse.text();
    document.body.appendChild(holder.content.cloneNode(true));
    if (new URLSearchParams(global.location?.search || '').get('popup') === '1') {
      const fab = document.getElementById('qwen-chat-fab');
      if (fab instanceof HTMLElement) fab.style.display = 'none';
      const panel = document.getElementById('qwen-chat-panel');
      if (panel instanceof HTMLElement) panel.hidden = true;
    }
    await global.BjtuModuleRegistry.loadScript('core/vendor/marked.umd.js');
    await global.BjtuModuleRegistry.loadScript('modules/qwen/operations-ui.js');
    await global.BjtuModuleRegistry.loadScript('modules/qwen/app.js');
    return true;
  })().catch((error) => {
    console.error('[bjtu] qwen module failed to load:', error);
    return false;
  });
})(globalThis);
