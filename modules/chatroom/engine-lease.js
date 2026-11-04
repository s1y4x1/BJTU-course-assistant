/* Background is exclusive; existing foreground pages remain shared owners.
 * acquire() resolves only once transport/link have loaded under the lease.
 * setCanYield(fn) must be set by chat.js before attaching the media engine.
 * bjtu-chatroom-engine-rolechange detail: {role, background, draining}.
 */
(() => {
  'use strict';
  if (globalThis.BjtuChatroomEngineLease) return;
  const background = new URLSearchParams(location.search).get('background') === '1';
  const channel = new BroadcastChannel('bjtuca-chatroom-engine');
  const events = new EventTarget();
  const lockName = 'bjtuca-chatroom-engine';
  let role = 'waiting', draining = false, acquired, releaseLock, canYield;
  let stopped = false, poll, demand;
  function change(next) {
    role = next;
    events.dispatchEvent(new CustomEvent('rolechange',{detail:{role,background,draining}}));
    globalThis.dispatchEvent(new CustomEvent('bjtu-chatroom-engine-rolechange',{
      detail:{role,background,draining}
    }));
  }
  async function checkYield() {
    if (stopped || !background || !draining || !canYield) return;
    let idle = false;
    try { idle = canYield() === true; } catch { /* Fail closed while initializing. */ }
    if (idle) {
      stopped = true; clearInterval(poll);
      // Close control links and drain the transport's serialized writes while
      // still holding the exclusive lock. No new invitation can be accepted.
      try {
        await globalThis.BjtuChatroomLink?.close();
        await globalThis.BjtuChatroomTransport?.state();
      } catch(error) { console.warn('[bjtu] engine handoff cleanup:',error); }
      change('released');
      // The host unloads this frame; do not release the Web Lock before its
      // pagehide handler has stopped RTC and flushed outstanding domain writes.
      parent.postMessage({type:'BJTU_CHATROOM_ENGINE_RELEASED'},location.origin);
    }
  }
  function drain() {
    if (!background || draining) return;
    draining = true; change('draining');
    poll = setInterval(checkYield,250); checkYield();
  }
  channel.onmessage = event => { if (event.data?.type === 'foreground-waiting') drain(); };
  window.addEventListener('message',event => {
    if (event.origin === location.origin && event.source === parent && event.data?.type === 'BJTU_CHATROOM_DRAIN') drain();
  });
  async function script(file) {
    await new Promise((resolve,reject) => {
      const el = document.createElement('script'); el.src = chrome.runtime.getURL('modules/chatroom/'+file);
      el.onload = resolve; el.onerror = () => reject(new Error('聊天室引擎加载失败：'+file)); document.head.append(el);
    });
  }
  function acquire() {
    if (acquired) return acquired;
    acquired = new Promise((resolve,reject) => {
      if (!navigator.locks) { reject(new Error('当前浏览器不支持聊天室引擎租约。')); return; }
      if (!background) {
        const announce = () => {
          channel.postMessage({type:'foreground-waiting'});
          void chrome.runtime.sendMessage({type:'BJTU_CHATROOM_FOREGROUND_WAITING'}).catch(() => {});
        };
        announce(); demand = setInterval(announce,1000);
      }
      void navigator.locks.request(lockName,background ? {mode:'exclusive',ifAvailable:true} : {mode:'shared'},async lock => {
        if (!lock || stopped) {
          if (background) parent.postMessage({type:'BJTU_CHATROOM_ENGINE_RELEASED'},location.origin);
          resolve(false); return;
        }
        clearInterval(demand);
        const hold = new Promise(done => { releaseLock = done; });
        try {
          if (!globalThis.BjtuChatroomTransport) await script('transport.js');
          if (!globalThis.BjtuChatroomLink) await script('link.js');
          if (stopped) { releaseLock(); resolve(false); return; }
          if (!draining) change(background ? 'background' : 'foreground');
          resolve(true);
        } catch(error) {
          releaseLock();
          if (background) parent.postMessage({type:'BJTU_CHATROOM_ENGINE_RELEASED'},location.origin);
          reject(error); return;
        }
        await hold;
      }).catch(reject);
    });
    return acquired;
  }
  // Use a microtask so all synchronous pagehide cleanup runs before release.
  // Destruction also releases Web Locks even after a renderer crash.
  window.addEventListener('pagehide',() => {
    stopped = true; clearInterval(poll); clearInterval(demand); channel.close();
    queueMicrotask(() => {
      releaseLock?.();
      if (!background) void chrome.runtime.sendMessage({type:'BJTU_CHATROOM_FOREGROUND_RELEASED'}).catch(() => {});
    });
  },{once:true});
  globalThis.BjtuChatroomEngineLease = {
    acquire,setCanYield(fn) { canYield = fn; checkYield(); },
    async release() {
      if (background) { drain(); return; }
      if (!releaseLock) return;
      await globalThis.BjtuChatroomLink?.close();
      await globalThis.BjtuChatroomTransport?.state();
      releaseLock(); releaseLock = null; acquired = null; change('released');
      void chrome.runtime.sendMessage({type:'BJTU_CHATROOM_FOREGROUND_RELEASED'}).catch(() => {});
    },
    addEventListener:(...args) => events.addEventListener(...args),
    removeEventListener:(...args) => events.removeEventListener(...args),
    get role() { return role; },get draining() { return draining; }
  };
})();
