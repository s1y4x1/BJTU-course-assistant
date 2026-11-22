(function loadBjtuQwenApp(global) {
  'use strict';
  global.__bjtuQwenAppReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    if (!await global.__bjtuApiReady || !available.llm) return false;
    await global.BjtuModuleRegistry.loadStyle('UI/file-size-emphasis.css');
    await global.BjtuModuleRegistry.loadStyle('UI/markdown.css');
    await global.BjtuModuleRegistry.loadScript('UI/file-size-emphasis.js');
    await global.BjtuModuleRegistry.loadStyle('modules/llm/app.css');
    await global.BjtuModuleRegistry.loadStyle('modules/api/operations-ui.css');
    const markupResponse = await fetch(chrome.runtime.getURL('modules/llm/app.html'), {
      cache: 'no-store'
    });
    if (!markupResponse.ok) throw new Error(`无法加载 Qwen 模块界面：HTTP ${markupResponse.status}`);
    const holder = document.createElement('template');
    holder.innerHTML = await markupResponse.text();
    document.body.appendChild(holder.content.cloneNode(true));
    if (new URLSearchParams(global.location?.search || '').get('popup') === '1') {
      const fab = document.getElementById('llm-chat-fab');
      if (fab instanceof HTMLElement) fab.style.display = 'none';
      const panel = document.getElementById('llm-chat-panel');
      if (panel instanceof HTMLElement) panel.hidden = true;
    }
    await global.BjtuModuleRegistry.loadScript('UI/marked.umd.js');
    await global.BjtuModuleRegistry.loadScript('UI/markdown.js');
    await global.BjtuMarkdown.ready;
    await global.BjtuModuleRegistry.loadScript('modules/api/operations-ui.js');
    await global.BjtuModuleRegistry.loadScript('modules/llm/local-model.js');
    await global.BjtuModuleRegistry.loadScript('modules/llm/app.js');
    await global.BjtuModuleRegistry.loadScript('modules/llm/proactive.js');
    await global.BjtuModuleRegistry.loadScript('modules/llm/proactive-app.js');
    return true;
  })().catch((error) => {
    console.error('[bjtu] qwen module failed to load:', error);
    return false;
  });
})(globalThis);
