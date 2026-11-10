/* Foreground UI client for the always-on chatroom engine.
 *
 * When background reception is enabled, the offscreen page keeps the signed
 * transport and the peer links. This page must not acquire the engine lease:
 * it borrows state()/action()/subscribe() over a BroadcastChannel and keeps its
 * own RTCPeerConnection for files and screen sharing (the offscreen page cannot
 * call getDisplayMedia). The message protocol stays entirely in the background
 * transport, so closing this page never tears the connection down.
 *
 * Loaded before chat.js. Falls back to the existing local engine (lease +
 * transport.js + link.js) when the feature is disabled or the background engine
 * is not available, so the old behaviour remains reachable with one switch.
 */
(() => {
  'use strict';
  if (globalThis.BjtuChatroomEngineClient) return;
  const CHANNEL = 'bjtuca-chatroom-engine-client';
  const CLIENT_PREFIX = 'BJTUC_ENGINE_CLIENT_';
  const background = new URLSearchParams(location.search).get('background') === '1';
  let attached = false;

  function bypassed() {
    let until = 0;
    try { until = Number(sessionStorage.getItem('bjtuca-chatroom-engine-client-bypass') || 0); } catch {}
    if (until > Date.now()) return true;
    if (until) { try { sessionStorage.removeItem('bjtuca-chatroom-engine-client-bypass'); } catch {} }
    return false;
  }

  async function attach() {
    if (background || attached || bypassed()) return null;
    let settings;
    try {
      settings = await chrome.storage.local.get({
        chatroomBackgroundEnabled: true,
        chatroomForegroundProxyEnabled: true
      });
    } catch { return null; }
    if (settings.chatroomBackgroundEnabled === false || settings.chatroomForegroundProxyEnabled === false) return null;
    // The offscreen document may not exist yet (fresh profile or SW restart).
    // Ask the service worker to create it, then retry the handshake briefly.
    void chrome.runtime.sendMessage({type: 'BJTU_CHATROOM_ENSURE_BACKGROUND'}).catch(() => {});

    const clientId = crypto.randomUUID();
    const channel = new BroadcastChannel(CHANNEL);
    const listeners = new Set();
    const pending = new Map();
    let closing = false, degraded = false, mediaOwner = true, primary = false;
    let discoveryStatus = 'connecting', lastSeen = Date.now();
    let helloAttempts = 0, helloInterval, heartbeat, lossTimer;
    let helloResolve, helloReject;
    const hello = new Promise((resolve, reject) => { helloResolve = resolve; helloReject = reject; });

    const send = (message) => { try { channel.postMessage({...message, clientId}); } catch {} };
    function applyStatus(detail) {
      if (!detail || typeof detail !== 'object') return;
      if (detail.type === 'scan-start') discoveryStatus = 'connecting';
      else if (detail.type === 'discovery' || detail.type === 'scanning') discoveryStatus = 'connected';
      else if (detail.type === 'scan-closed') discoveryStatus = 'disconnected';
      try { window.dispatchEvent(new CustomEvent('bjtu-chatroom-link-status', {detail})); } catch {}
    }
    function rpc(method, name, args, timeout = 20000) {
      return new Promise((resolve, reject) => {
        if (closing || degraded) { reject(new Error('后台聊天室引擎已断开。')); return; }
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id); reject(new Error('后台聊天室引擎响应超时。'));
        }, timeout);
        pending.set(id, {resolve, reject, timer});
        send({type: `${CLIENT_PREFIX}RPC`, id, method, name, args});
      });
    }
    channel.onmessage = (event) => {
      const message = event.data;
      if (!message || message.clientId !== clientId) return;
      lastSeen = Date.now();
      switch (message.type) {
        case `${CLIENT_PREFIX}HELLO_OK`:
          clearInterval(helloInterval);
          helloResolve(message);
          break;
        case `${CLIENT_PREFIX}UNAVAILABLE`:
          // The offscreen page exists but is still acquiring the engine or is
          // handing off. Keep retrying until the handshake budget is spent.
          break;
        case `${CLIENT_PREFIX}RPC_RESULT`: {
          const task = pending.get(message.id);
          if (!task) return;
          pending.delete(message.id); clearTimeout(task.timer);
          if (message.ok) task.resolve(message.result);
          else task.reject(new Error(message.error || '后台聊天室引擎拒绝了操作。'));
          break;
        }
        case `${CLIENT_PREFIX}EVENT`:
          for (const listener of [...listeners]) {
            try { listener(message.event); } catch (error) { console.warn('[bjtu] chatroom client event:', error); }
          }
          break;
        case `${CLIENT_PREFIX}STATUS`:
          applyStatus(message.detail);
          break;
        case `${CLIENT_PREFIX}PROMOTED`:
          // Another chat window closed; this one now owns media invitations.
          primary = true; mediaOwner = true;
          window.dispatchEvent(new Event('bjtu-chatroom-transport-ready'));
          break;
        case `${CLIENT_PREFIX}PONG`:
          break;
        case `${CLIENT_PREFIX}DETACHED`:
          if (!closing) void degrade('后台聊天室引擎已卸载。');
          break;
        default:
          break;
      }
    };

    const helloMessage = () => send({type: `${CLIENT_PREFIX}HELLO`});
    helloMessage();
    helloInterval = setInterval(() => {
      if (helloAttempts >= 32) {
        clearInterval(helloInterval);
        helloReject(new Error('后台聊天室引擎未就绪。'));
        return;
      }
      helloAttempts++;
      helloMessage();
    }, 250);

    let reply;
    try { reply = await hello; } catch {
      clearInterval(helloInterval);
      try { channel.close(); } catch {}
      return null;
    }
    primary = reply.primary === true;
    mediaOwner = primary;
    if (reply.discoveryStatus) discoveryStatus = reply.discoveryStatus;

    // The foreground owns media RTC but never the transport. No setLink here:
    // chat.js checks for it before borrowing a local BjtuChatroomLink.
    globalThis.BjtuChatroomTransport = Object.freeze({
      ready: Promise.resolve(true),
      state: () => rpc('state'),
      async action(name, args) {
        try { return await rpc('action', name, args); }
        catch (error) { return {ok: false, error: error?.message || '聊天室操作失败。'}; }
      },
      subscribe(fn) {
        if (typeof fn !== 'function') throw new Error('订阅者必须是函数。');
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    });
    globalThis.BjtuChatroomLink = {
      get discoveryStatus() { return discoveryStatus; },
      async close() {
        // chat.js calls close() from its pagehide handler too; only an explicit
        // user disconnect (after pagehide has latched `closing`) closes the
        // shared background connection.
        if (closing || degraded) return;
        await rpc('action', 'close', {});
      },
      // Present so the shared sidebar keeps the offline pairing controls
      // enabled; the actual pairing actions travel through transport.action.
      pairCreate: async () => { throw new Error('配对操作请通过聊天室界面执行。'); },
      pairAccept: async () => { throw new Error('配对操作请通过聊天室界面执行。'); },
      pairComplete: async () => { throw new Error('配对操作请通过聊天室界面执行。'); }
    };
    attached = true;
    heartbeat = setInterval(() => {
      if (closing || degraded) return;
      send({type: `${CLIENT_PREFIX}PING`});
    }, 2000);
    lossTimer = setInterval(() => {
      if (closing || degraded) return;
      if (Date.now() - lastSeen > 8000) void degrade('后台聊天室引擎失去响应。');
    }, 2000);

    async function degrade(reason) {
      if (degraded) return;
      degraded = true; closing = true; mediaOwner = true;
      clearInterval(heartbeat); clearInterval(lossTimer);
      console.warn('[bjtu] chatroom client degraded:', reason);
      try { send({type: `${CLIENT_PREFIX}BYE`}); } catch {}
      try { channel.close(); } catch {}
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('后台聊天室引擎已断开。')); }
      pending.clear();
      // Drop the borrowed globals so the lease path can load the real ones.
      delete globalThis.BjtuChatroomTransport;
      delete globalThis.BjtuChatroomLink;
      const lease = globalThis.BjtuChatroomEngineLease;
      if (lease) {
        try {
          if (await lease.acquire()) {
            window.dispatchEvent(new Event('bjtu-chatroom-transport-ready'));
            return;
          }
        } catch (error) { console.warn('[bjtu] chatroom client fallback:', error); }
      }
      try { sessionStorage.setItem('bjtuca-chatroom-engine-client-bypass', String(Date.now() + 30000)); } catch {}
      location.reload();
    }

    window.addEventListener('pagehide', () => {
      closing = true;
      clearInterval(heartbeat); clearInterval(lossTimer);
      try { send({type: `${CLIENT_PREFIX}BYE`}); } catch {}
      try { channel.close(); } catch {}
    }, {once: true});

    return {
      get primary() { return primary; },
      get mediaOwner() { return mediaOwner; },
      get connected() { return !degraded && !closing; }
    };
  }

  globalThis.BjtuChatroomEngineClient = Object.freeze({attach});
})();
