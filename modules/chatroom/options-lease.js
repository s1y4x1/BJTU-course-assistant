/* Options retain their existing local engine, but networking must not bypass
 * the foreground/background lease. No second media receiver is installed. */
(() => {
  'use strict';
  const link = globalThis.BjtuChatroomLink;
  if (!link || link.__bjtuLeased) return;
  const transport = globalThis.BjtuChatroomTransport;
  // Do not turn a settings fragment into a control-only foreground owner when
  // background reception is enabled. Domain reads still use synced local state.
  globalThis.BjtuChatroomTransport = Object.freeze({...transport,
    async action(name,args) {
      const stored = await chrome.storage.local.get({chatroomBackgroundEnabled:true});
      if (stored.chatroomBackgroundEnabled !== false) {
        const reply = await chrome.runtime.sendMessage({type:'BJTU_CHATROOM_OPTIONS_ACTION',name,args});
        return reply?.result || {ok:false,error:reply?.error || '后台正在交接，请在聊天室中操作。'};
      }
      return transport.action(name,args);
    }
  });
  for (const name of ['scan','connect','pairCreate','pairAccept','pairComplete','sendPeer']) {
    const original = link[name];
    link[name] = async function(...args) {
      if (!await globalThis.BjtuChatroomEngineLease.acquire()) throw new Error('聊天室引擎未取得前台租约。');
      return original.apply(link,args);
    };
  }
  link.__bjtuLeased = true;
  let proxyEnabled = true;
  let remoteDiscoveryStatus = 'disconnected';
  const ownStatus = Object.getOwnPropertyDescriptor(link,'discoveryStatus').get;
  Object.defineProperty(link,'discoveryStatus',{configurable:true,get() {
    return proxyEnabled ? remoteDiscoveryStatus : ownStatus.call(link);
  }});
  function remoteStatus(detail) {
    if (!proxyEnabled || !detail) return;
    if (detail.type === 'scan-start') remoteDiscoveryStatus = 'connecting';
    else if (['discovery','scanning'].includes(detail.type)) remoteDiscoveryStatus = 'connected';
    else if (detail.type === 'scan-closed') remoteDiscoveryStatus = 'disconnected';
    window.dispatchEvent(new CustomEvent('bjtu-chatroom-link-status',{detail}));
  }
  const onStatus = (message,sender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'BJTU_CHATROOM_ENGINE_STATUS') remoteStatus(message.detail);
    return false;
  };
  chrome.runtime.onMessage.addListener(onStatus);
  void chrome.storage.local.get({chatroomBackgroundEnabled:true}).then(async stored => {
    proxyEnabled = stored.chatroomBackgroundEnabled !== false;
    if (!proxyEnabled) return;
    const result = await chrome.runtime.sendMessage({type:'BJTU_CHATROOM_OPTIONS_STATUS'});
    remoteStatus({type:result?.discoveryStatus === 'connected' ? 'discovery' : result?.discoveryStatus === 'connecting' ? 'scan-start' : 'scan-closed'});
  }).catch(error => console.warn('[bjtu] options connection status:',error));
  const observer = new MutationObserver(() => {
    if (!document.querySelector('.chatroom-options-card[data-options-fragment]'))
      void globalThis.BjtuChatroomEngineLease.release().catch(error => console.warn('[bjtu] options lease cleanup:',error));
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  const changed = (changes,area) => {
    if (area === 'local' && changes.chatroomBackgroundEnabled) proxyEnabled = changes.chatroomBackgroundEnabled.newValue !== false;
    if (area === 'local' && changes.chatroomBackgroundEnabled?.newValue !== false && changes.chatroomBackgroundEnabled)
      void globalThis.BjtuChatroomEngineLease.release().catch(error => console.warn('[bjtu] options lease handoff:',error));
  };
  chrome.storage.onChanged.addListener(changed);
  window.addEventListener('pagehide',() => { observer.disconnect(); chrome.storage.onChanged.removeListener(changed); chrome.runtime.onMessage.removeListener(onStatus); },{once:true});
})();
