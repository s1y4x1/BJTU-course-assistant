/* Prompt API runs in a document, never in the extension service worker. */
(function(global) {
  'use strict';
  const requests = new WeakMap();
  function api() {
    if (!global.LanguageModel?.create) throw new Error('当前浏览器未提供 Prompt API，请检查浏览器版本、Prompt API 开关及设备支持情况');
    return global.LanguageModel;
  }
  async function availability() { return await api().availability(); }
  async function prepare(onProgress) {
    const model = api();
    if (await model.availability() === 'unavailable') throw new Error('浏览器本地模型不可用，请检查设备、浏览器设置及可用磁盘空间');
    const session = await model.create({monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => onProgress?.(Math.min(1, Math.max(0, Number(event.loaded) || 0))));
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
        if (await availability() !== 'available') throw new Error('本地模型尚未就绪，请先在千问助手选项中点击「准备本地模型」');
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
  global.BjtuQwenLocalModel = {availability,prepare,handlePort};
})(globalThis);
