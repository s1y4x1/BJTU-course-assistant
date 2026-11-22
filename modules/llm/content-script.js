/* 通义千问页面桥接：同步登录令牌。 */
(function initQwenLoginTokenBridge() {
  'use strict';
  if(globalThis.__bjtuQwenPageBridge)return;
  globalThis.__bjtuQwenPageBridge=true;
  chrome.runtime.onConnect.addListener(port=>{
    if(!port.name.startsWith('bjtu-qwen-fetch:')||port.sender?.id!==chrome.runtime.id)return;
    const id=port.name.slice('bjtu-qwen-fetch:'.length);
    const forward=event=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.source!=='BJTU_QWEN_PAGE_FETCH'||event.data.id!==id)return;
      if(['headers','chunk','end','error','token','context'].includes(event.data.type)){
        try{port.postMessage(event.data);}catch{}
      }
    };
    window.addEventListener('message',forward);
    port.onMessage.addListener(message=>{
      if(message.type==='init')port.postMessage({type:'ready'});
      if(message.type==='ack')window.postMessage({source:'BJTU_QWEN_PAGE_CONTROL',id,type:'ack',sequence:message.sequence},location.origin);
    });
    port.onDisconnect.addListener(()=>{
      window.removeEventListener('message',forward);
      window.postMessage({source:'BJTU_QWEN_PAGE_CONTROL',id,type:'cancel'},location.origin);
    });
  });

  const SESSION_KEY_CANDIDATES = ['token', 'access_token', 'qwen_token', 'jwt_token'];
  let lastSent = null;

  function readToken() {
    try{
      const state=JSON.parse(localStorage.getItem('qwen_access_token_state') || 'null');
      if(state?.token && Number(state.expiresAt)>Date.now())return String(state.token);
    }catch{}
    for (const key of SESSION_KEY_CANDIDATES) {
      const value = String(localStorage.getItem(key) || '').trim();
      if (value) return value;
    }
    return '';
  }

  function sendToBackground(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // 页面正在关闭时无需处理。
    }
  }

  function sendToken(token) {
    const value = String(token || '').trim();
    if (value === lastSent) return;
    lastSent = value;
    sendToBackground(value
      ? { type: 'QWEN_TOKEN_CAPTURED', payload: { token: value } }
      : { type: 'QWEN_TOKEN_CLEARED' });
  }

  function check() {
    sendToken(readToken());
  }

  check();
  window.addEventListener('pageshow', check);
  window.addEventListener('storage', check);
  setInterval(check, location.pathname.startsWith('/auth') ? 500 : 8000);
})();
