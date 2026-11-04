/* Loaded before transport.js. No Chrome API other than runtime is required. */
(() => {
  'use strict';
  const enabled = new URLSearchParams(location.search).get('background') === '1';
  const listeners = new Set();
  let reconnecting = false, reconnectTimer;
  if (enabled) {
    const call = async (method,value) => {
      const reply = await chrome.runtime.sendMessage({type:'BJTU_OFFSCREEN_STORAGE',method,value});
      if (!reply?.ok) throw new Error(reply?.error || '后台存储代理不可用。');
      return reply.value;
    };
    chrome.storage = {local:{get:value => call('get',value),set:value => call('set',value)},
      onChanged:{addListener:fn => listeners.add(fn),removeListener:fn => listeners.delete(fn),hasListener:fn => listeners.has(fn)}};
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type !== 'BJTU_OFFSCREEN_STORAGE_CHANGED') return false;
      for (const fn of [...listeners]) { try { fn(message.changes,message.area); } catch(error) { console.warn('[bjtu] background storage listener:',error); } }
      return false;
    });
    window.addEventListener('pagehide',() => listeners.clear(),{once:true});
    // Bridge may start later or restart. Never overlap scans, retry a live
    // socket, or create a connection while handing the engine to foreground.
    reconnectTimer = setInterval(() => {
      const lease = globalThis.BjtuChatroomEngineLease, link = globalThis.BjtuChatroomLink;
      if (reconnecting || lease?.role !== 'background' || lease.draining || link?.discoveryStatus !== 'disconnected') return;
      reconnecting = true;
      void Promise.resolve().then(() => globalThis.BjtuChatroomTransport.action('scan'))
        .catch(error => console.warn('[bjtu] background reconnect:',error))
        .finally(() => { reconnecting = false; });
    },30000);
    window.addEventListener('pagehide',() => clearInterval(reconnectTimer),{once:true});
  }
  // MessageSender.documentId is absent for some extension/offscreen frames.
  // Discover an active renderer, then address it by an in-memory instance ID.
  // Synchronous filtering lets other renderers decline without holding the
  // response channel open; exactly the selected renderer executes the action.
  const engineId = crypto.randomUUID();
  let ready = false;
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    const lease = globalThis.BjtuChatroomEngineLease, transport = globalThis.BjtuChatroomTransport;
    if (!ready || !['background','foreground'].includes(lease?.role) || lease.draining || !transport) return false;
    if (message?.type === 'BJTU_CHATROOM_ENGINE_DISCOVER') { respond({engineId}); return false; }
    if (message?.type !== 'BJTU_CHATROOM_ENGINE_ACTION' || message.engineId !== engineId) return false;
    void transport.action(message.name,message.args).then(
      result => respond({ok:true,result}),error => respond({ok:false,error:error.message}));
    return true;
  });
  async function canReceiveFile(size) {
    if (!enabled || globalThis.BjtuChatroomEngineLease?.draining) return false;
    if (!Number.isSafeInteger(size) || size < 0) return false;
    try {
      const settings = await chrome.storage.local.get({
        chatroomBackgroundEnabled:true,chatroomBackgroundReceiveFiles:true,
        chatroomAutoSaveEnabled:true,chatroomAutoSaveMaxBytes:100000000
      });
      if (settings.chatroomBackgroundEnabled === false || settings.chatroomBackgroundReceiveFiles === false ||
          settings.chatroomAutoSaveEnabled === false ||
          !(settings.chatroomAutoSaveMaxBytes === null || size < settings.chatroomAutoSaveMaxBytes)) return false;
      // This only queries an already persisted grant. No requestPermission and
      // no picker, including when the saved handle is absent or revoked.
      const root = await directory();
      return !!root && await root.queryPermission({mode:'readwrite'}) === 'granted' &&
        !globalThis.BjtuChatroomEngineLease?.draining;
    } catch { return false; }
  }
  async function directory() {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('BJTUCA-FileSystem',1);
      request.onupgradeneeded = () => request.transaction.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve,reject) => {
        const request = db.transaction('handles').objectStore('handles').get('update-directory');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  async function notifyInvitation({peerId,media,name,reason,sid} = {}) {
    if (!enabled) return;
    await chrome.runtime.sendMessage({type:'BJTU_CHATROOM_BACKGROUND_INVITATION',
      peerId,media,name,reason,sid}).catch(error => console.warn('[bjtu] background invitation:',error));
  }
  globalThis.BjtuChatroomBackgroundMode = {enabled,canReceiveFile,notifyInvitation,markReady() { ready = true; }};
})();
