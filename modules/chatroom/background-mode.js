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
  // Foreground chat pages borrow this engine over BroadcastChannel instead of
  // taking the engine lease. They keep their own RTCPeerConnection for files
  // and screens; the signed transport, discovery and peer links stay here.
  const clientChannel = enabled ? new BroadcastChannel('bjtuca-chatroom-engine-client') : null;
  const clients = new Map();
  let forwarding = false;
  function clientEligible() {
    const lease = globalThis.BjtuChatroomEngineLease;
    return enabled && ready && !!globalThis.BjtuChatroomTransport &&
      lease?.role === 'background' && !lease.draining;
  }
  function pruneClients() {
    const now = Date.now();
    for (const [id, entry] of clients) if (now - entry.lastSeen > 8000) removeClient(id);
  }
  function removeClient(id) {
    const entry = clients.get(id);
    if (!entry) return;
    clients.delete(id);
    if (entry.primary) {
      const next = clients.entries().next().value;
      if (next) {
        next[1].primary = true;
        replyClient({type: 'BJTUC_ENGINE_CLIENT_PROMOTED', clientId: next[0]});
      }
    }
    syncForegroundPresence();
  }
  function replyClient(message) { try { clientChannel.postMessage(message); } catch {} }
  // The transport identity lives here even while a page is open. Flip its
  // presence flag so peers see "online" instead of "background online", and
  // restore it once the last foreground client detaches.
  let presenceAttached = null, presenceTimer = 0, presenceRefreshAt = 0;
  function syncForegroundPresence(force = false) {
    if (!ready || !globalThis.BjtuChatroomTransport) return;
    const attached = clients.size > 0;
    if (!force && presenceAttached === attached) return;
    presenceAttached = attached;
    presenceRefreshAt = Date.now();
    void globalThis.BjtuChatroomTransport.action('set-background', { background: !attached, force })
      .catch(error => { presenceAttached = null; console.warn('[bjtu] chatroom presence:', error); });
  }
  function forward(event) {
    if (!clients.size) return;
    const payload = event?.type === 'error' ? {type: 'error', message: String(event.message || event.error?.message || '')} : event;
    for (const [id, entry] of clients) {
      if (payload?.type === 'signal' && !entry.primary) continue;
      replyClient({type: 'BJTUC_ENGINE_CLIENT_EVENT', clientId: id, event: payload});
    }
  }
  function ensureForwarding() {
    if (forwarding || !enabled) return;
    const transport = globalThis.BjtuChatroomTransport;
    if (!transport || typeof transport.subscribe !== 'function') return;
    forwarding = true;
    transport.subscribe(forward);
  }
  if (clientChannel) clientChannel.onmessage = (event) => {
    const message = event.data;
    if (!message || typeof message.clientId !== 'string' || message.clientId.length > 80) return;
    const clientId = message.clientId;
    if (message.type === 'BJTUC_ENGINE_CLIENT_HELLO') {
      pruneClients();
      if (!clientEligible()) {
        replyClient({type: 'BJTUC_ENGINE_CLIENT_UNAVAILABLE', clientId, reason: '后台聊天室引擎尚未就绪。'});
        return;
      }
      let entry = clients.get(clientId);
      if (!entry) {
        // A throttled tab may re-register after being pruned; restore its media
        // role only when nobody else has been promoted in the meantime.
        const hasPrimary = [...clients.values()].some(client => client.primary);
        entry = {lastSeen: Date.now(), primary: clients.size === 0 || (!hasPrimary && message.primary === true)};
        clients.set(clientId, entry);
      }
      entry.lastSeen = Date.now();
      ensureForwarding();
      replyClient({type: 'BJTUC_ENGINE_CLIENT_HELLO_OK', clientId, engineId,
        discoveryStatus: globalThis.BjtuChatroomLink?.discoveryStatus || 'disconnected', primary: entry.primary});
      syncForegroundPresence();
      return;
    }
    const entry = clients.get(clientId);
    if (!entry) return;
    entry.lastSeen = Date.now();
    if (message.type === 'BJTUC_ENGINE_CLIENT_PING') {
      replyClient({type: 'BJTUC_ENGINE_CLIENT_PONG', clientId});
      return;
    }
    if (message.type === 'BJTUC_ENGINE_CLIENT_BYE') { removeClient(clientId); return; }
    if (message.type !== 'BJTUC_ENGINE_CLIENT_RPC') return;
    if (!clientEligible()) {
      replyClient({type: 'BJTUC_ENGINE_CLIENT_RPC_RESULT', clientId, id: message.id, ok: false, error: '后台聊天室引擎已断开。'});
      return;
    }
    const transport = globalThis.BjtuChatroomTransport;
    if (message.name === 'close') pauseReconnect();
    if (message.name === 'scan') resumeReconnect();
    const job = message.method === 'state' ? transport.state() : transport.action(message.name, message.args);
    void Promise.resolve(job).then(result => {
      replyClient({type: 'BJTUC_ENGINE_CLIENT_RPC_RESULT', clientId, id: message.id, ok: true, result});
    }, error => {
      replyClient({type: 'BJTUC_ENGINE_CLIENT_RPC_RESULT', clientId, id: message.id, ok: false, error: error?.message || '聊天室操作失败。'});
    });
  };
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
    if (!enabled) return;
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
    ready = false; clearTimeout(reconnectTimer); clearInterval(presenceTimer); chrome.storage.onChanged.removeListener(onSettings);
    if (clientChannel) {
      for (const id of clients.keys()) replyClient({type:'BJTUC_ENGINE_CLIENT_DETACHED',clientId:id,reason:'后台页面已卸载。'});
      clients.clear();
      try { clientChannel.close(); } catch {}
    }
  },{once:true});
  window.addEventListener('bjtu-chatroom-link-status',event => {
    if (!ready) return;
    for (const id of clients.keys()) replyClient({type:'BJTUC_ENGINE_CLIENT_STATUS',clientId:id,detail:event.detail});
    publishStatus(event.detail);
    // Let the link's `opening` promise settle before deciding whether to retry.
    setTimeout(scheduleReconnect, 0);
  });
  window.addEventListener('bjtu-chatroom-engine-rolechange',() => scheduleReconnect(globalThis.BjtuChatroomEngineLease?.role === 'background'));
  globalThis.BjtuChatroomBackgroundMode = {enabled,canReceiveFile,notifyInvitation,markReady() {
    ready = true;
    presenceAttached = null;
    clearInterval(presenceTimer);
    presenceTimer = setInterval(() => {
      pruneClients();
      // Handshake packets can be built just before the foreground attaches;
      // re-send the profile periodically until the session settles.
      const refresh = clients.size > 0 && Date.now() - presenceRefreshAt >= 5000;
      syncForegroundPresence(refresh);
    }, 3000);
    ensureForwarding();
    publishStatus({type:globalThis.BjtuChatroomLink?.discoveryStatus === 'connected' ? 'discovery' : 'scan-closed'});
    void chrome.storage.local.get(reconnectSettings).then(settings => { reconnectSettings = settings; scheduleReconnect(true); });
  },pauseReconnect,resumeReconnect,closeInvitation,setFileDecisionHandler(fn) { fileDecisionHandler = fn; },
    // chat.js uses this to hand media invitations to an attached foreground
    // page instead of accepting them here.
    get foregroundAttached() { pruneClients(); return clients.size > 0; }};
})();
