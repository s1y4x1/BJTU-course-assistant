/* Local chat storage and document-side inference transport; no cloud fallback. */
(function(global) {
  'use strict';
  const key = id => {
    if (!String(id).startsWith('local-')) throw new Error('本地模型只能打开本地会话，请新建会话');
    return 'qwenLocalChat:' + id;
  };
  async function fetchChatHistory(id) { return (await chrome.storage.local.get(key(id)))[key(id)] || []; }
  function create(port) {
    const pending = new Map();
    port?.onMessage.addListener(message => {
      if (message?.type !== 'localModelResult') return;
      const request = pending.get(message.id);
      if (!request) return;
      if (message.delta) request.delta(String(message.delta));
      if (message.done) {
        if (message.error) request.reject(Object.assign(new Error(message.error),{name:message.name || 'Error'}));
        else request.resolve();
      }
    });
    port?.onDisconnect.addListener(() => {
      for (const request of pending.values()) request.reject(new DOMException('聊天页面已关闭','AbortError'));
      pending.clear();
    });
    return {
      isLoggedIn:async()=>true,
      fetchModels:async()=>[{id:'browser-local',name:'浏览器本地模型（Prompt API）'}],
      newChat:async()=>{const id='local-'+crypto.randomUUID(); await chrome.storage.local.set({[key(id)]:[]}); return id;},
      fetchChatHistory,
      deleteChat:async id=>chrome.storage.local.remove(key(id)),
      buildUserMessage:({content})=>({role:'user',content:String(content),id:crypto.randomUUID()}),
      async streamCompletions({chatId,messages,parentId,onEvent,signal}) {
        if (!port) throw new Error('本地推理需要打开聊天页面');
        signal?.throwIfAborted();
        let history = await fetchChatHistory(chatId);
        if (parentId) {
          const index = history.findIndex(item => item.id === parentId);
          if (index < 0) throw new Error('本地会话的父消息不存在，请重新打开会话');
          history = history.slice(0,index+1);
        } else history = [];
        const user = {...messages[0],id:crypto.randomUUID()}, responseId = crypto.randomUUID();
        let text = '';
        const id = crypto.randomUUID();
        const abort = () => {
          try { port.postMessage({type:'localModelCancel',id}); } catch {}
          pending.get(id)?.reject(signal.reason || new DOMException('生成中止','AbortError'));
        };
        try {
          onEvent?.({responseId,responseParentId:user.id});
          await new Promise((resolve,reject) => {
            pending.set(id,{resolve,reject,delta:delta=>{text+=delta;onEvent?.({text:delta});}});
            signal?.addEventListener('abort',abort,{once:true});
            if (signal?.aborted) { abort(); return; }
            port.postMessage({type:'localModelPrompt',id,history:history.map(({role,content})=>({role,content})),text:user.content});
          });
          signal?.throwIfAborted();
          await chrome.storage.local.set({[key(chatId)]:[...history,user,{role:'assistant',id:responseId,content:text}]});
          return {text,responseId,responseParentId:user.id};
        } finally { pending.delete(id); signal?.removeEventListener('abort',abort); }
      }
    };
  }
  global.BjtuQwenLocalClient = {create};
})(globalThis);
