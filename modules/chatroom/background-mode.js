/* Loaded before transport.js. No Chrome API other than runtime is required. */
(() => {
  'use strict';
  const enabled = new URLSearchParams(location.search).get('background') === '1';
  const listeners = new Set();
  let reconnecting = false, reconnectTimer, paused = false;
  let reconnectSettings = {chatroomAutoReconnectEnabled:true,chatroomReconnectIntervalSeconds:5};
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
  }
  // MessageSender.documentId is absent for some extension/offscreen frames.
  // Discover an active renderer, then address it by an in-memory instance ID.
  // Synchronous filtering lets other renderers decline without holding the
  // response channel open; exactly the selected renderer executes the action.
  const engineId = crypto.randomUUID();
  let ready = false, fileDecisionHandler;
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (enabled && message?.type === 'BJTU_CHATROOM_FILE_DECISION' && message.engineId === engineId && fileDecisionHandler) {
      void Promise.resolve().then(() => fileDecisionHandler(message)).then(respond,
        error => respond({ok:false,error:error.message}));
      return true;
    }
    const lease = globalThis.BjtuChatroomEngineLease, transport = globalThis.BjtuChatroomTransport;
    if (!ready || !['background','foreground'].includes(lease?.role) || lease.draining || !transport) return false;
    if (message?.type === 'BJTU_CHATROOM_ENGINE_DISCOVER') {
      respond({engineId,discoveryStatus:globalThis.BjtuChatroomLink?.discoveryStatus || 'disconnected'}); return false;
    }
    if (message?.type !== 'BJTU_CHATROOM_ENGINE_ACTION' || message.engineId !== engineId) return false;
    if (message.name === 'close') pauseReconnect();
    if (message.name === 'scan') resumeReconnect();
    void transport.action(message.name,message.args).then(
      result => respond({ok:true,result:{...result,discoveryStatus:globalThis.BjtuChatroomLink?.discoveryStatus || 'disconnected'}}),error => respond({ok:false,error:error.message}));
    return true;
  });
  async function canReceiveFile(size, approved = false) {
    if (!enabled || globalThis.BjtuChatroomEngineLease?.draining) return false;
    if (!Number.isSafeInteger(size) || size < 0) return false;
    try {
      const settings = await chrome.storage.local.get({
        chatroomBackgroundEnabled:true,chatroomBackgroundReceiveFiles:true,
        chatroomAutoSaveEnabled:true,chatroomAutoSaveMaxBytes:100000000
      });
      if (settings.chatroomBackgroundEnabled === false) return false;
      if (!approved && (settings.chatroomBackgroundReceiveFiles === false ||
          settings.chatroomAutoSaveEnabled === false ||
          !(settings.chatroomAutoSaveMaxBytes === null || size < settings.chatroomAutoSaveMaxBytes))) return false;
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
  async function notifyInvitation({peerId,media,name,reason,sid,size,conversationId,pending = false} = {}) {
    if (!enabled) return;
    await chrome.runtime.sendMessage({type:'BJTU_CHATROOM_BACKGROUND_INVITATION',
      engineId,peerId,media,name,reason,sid,size,conversationId,pending}).catch(error => console.warn('[bjtu] background invitation:',error));
  }
  function closeInvitation(peerId,sid) {
    if (enabled) void chrome.runtime.sendMessage({type:'BJTU_CHATROOM_FILE_INVITATION_CLOSED',engineId,peerId,sid}).catch(() => {});
  }
  function publishStatus(detail) {
    void chrome.runtime.sendMessage({type:'BJTU_CHATROOM_ENGINE_STATUS',detail}).catch(() => {});
  }
  function eligible() {
    const lease = globalThis.BjtuChatroomEngineLease;
    return ready && !paused && reconnectSettings.chatroomAutoReconnectEnabled !== false && !reconnecting &&
      ['background','foreground'].includes(lease?.role) && !lease.draining &&
      globalThis.BjtuChatroomLink?.discoveryStatus === 'disconnected';
  }
  function scheduleReconnect(immediate = false) {
    clearTimeout(reconnectTimer);
    if (!eligible()) return;
    const seconds = Number(reconnectSettings.chatroomReconnectIntervalSeconds);
    reconnectTimer = setTimeout(async () => {
      if (!eligible()) return;
      reconnecting = true;
      try { await globalThis.BjtuChatroomTransport.action('scan'); }
      catch(error) { console.warn('[bjtu] chatroom reconnect:',error); }
      finally { reconnecting = false; scheduleReconnect(); }
    },immediate ? 0 : (Number.isFinite(seconds) && seconds >= .1 && seconds <= 60 ? seconds : 5)*1000);
  }
  function pauseReconnect() { paused = true; clearTimeout(reconnectTimer); }
  function resumeReconnect() { paused = false; scheduleReconnect(); }
  const onSettings = (changes,area) => {
    if (area !== 'local') return;
    let changed = false;
    for (const key of Object.keys(reconnectSettings)) if (changes[key]) {
      reconnectSettings[key] = changes[key].newValue; changed = true;
    }
    if (changed) scheduleReconnect();
  };
  chrome.storage.onChanged.addListener(onSettings);
  window.addEventListener('pagehide',() => {
    ready = false; clearTimeout(reconnectTimer); chrome.storage.onChanged.removeListener(onSettings);
  },{once:true});
  window.addEventListener('bjtu-chatroom-link-status',event => {
    if (!ready) return;
    publishStatus(event.detail);
    // Let the link's `opening` promise settle before deciding whether to retry.
    setTimeout(scheduleReconnect, 0);
  });
  window.addEventListener('bjtu-chatroom-engine-rolechange',() => scheduleReconnect(globalThis.BjtuChatroomEngineLease?.role === 'background'));
  globalThis.BjtuChatroomBackgroundMode = {enabled,canReceiveFile,notifyInvitation,markReady() {
    ready = true;
    publishStatus({type:globalThis.BjtuChatroomLink?.discoveryStatus === 'connected' ? 'discovery' : 'scan-closed'});
    void chrome.storage.local.get(reconnectSettings).then(settings => { reconnectSettings = settings; scheduleReconnect(true); });
  },pauseReconnect,resumeReconnect,closeInvitation,setFileDecisionHandler(fn) { fileDecisionHandler = fn; }};
})();
