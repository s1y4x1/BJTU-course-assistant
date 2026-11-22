/* Prompt API runs in a document, never in the extension service worker. */
(function(global) {
  'use strict';
  const requests = new WeakMap();
  function settingsUrl() { return /Edg\//.test(global.navigator?.userAgent || '') ? 'edge://flags' : 'chrome://flags'; }
  function api() {
    if (typeof global.LanguageModel?.create !== 'function') {
      throw Object.assign(new Error(`当前扩展页面未启用 Prompt API。微软演示页可通过仅限该网站的来源试用启用，不代表扩展也已启用。请在 ${settingsUrl()} 中搜索「Prompt API」，设为 Enabled 并重启浏览器后重试。`),{code:'PROMPT_API_NOT_EXPOSED'});
    }
    return global.LanguageModel;
  }
  async function availability() { return await api().availability(); }
  async function prepare(onProgress) {
    const model = api();
    if (await model.availability() === 'unavailable') throw new Error('浏览器本地模型不可用，请检查设备、浏览器设置及可用磁盘空间');
    const session = await model.create({monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => {
        const total = Number(event.total) || 1;
        onProgress?.(Math.min(1, Math.max(0, (Number(event.loaded) || 0) / total)));
      });
    }});
    session.destroy();
  }
  function handlePort(port, message) {
    if (message?.type !== 'localModelPrompt' && message?.type !== 'localModelCancel') return false;
    let active = requests.get(port);
    if (!active) {
      active = new Map(); requests.set(port, active);
      port.onDisconnect.addListener(() => {
        for (const controller of active.values()) controller.abort();
        active.clear();
      });
    }
    if (message.type === 'localModelCancel') { active.get(message.id)?.abort(); return true; }
    const controller = new AbortController(); active.set(message.id, controller);
    const post = data => { try { port.postMessage({type:'localModelResult',id:message.id,...data}); } catch {} };
    void (async () => {
      let session;
      try {
        if (await availability() !== 'available') throw new Error('本地模型尚未就绪，请先在AI 助手选项中点击「准备本地模型」');
        controller.signal.throwIfAborted();
        session = await api().create({initialPrompts:message.history || [],signal:controller.signal});
        controller.signal.throwIfAborted();
        const stream = session.promptStreaming(String(message.text || ''),{signal:controller.signal});
        for await (const chunk of stream) {
          controller.signal.throwIfAborted();
          post({delta:String(chunk)});
        }
        post({done:true});
      } catch (error) { post({done:true,error:String(error?.message || error),name:error?.name}); }
      finally { session?.destroy(); active.delete(message.id); }
    })();
    return true;
  }
  global.BjtuQwenLocalModel = {availability,prepare,handlePort,settingsUrl};
})(globalThis);
