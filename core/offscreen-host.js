(() => {
  'use strict';
  const paths = {
    captcha:'modules/captcha/offscreen.html', citel:'modules/citel/background.html',
    chatroom:'modules/chatroom/chat.html?background=1'
  };
  const frames = new Map(), loading = new Map();
  let chatWanted = false, retry;
  function remove(module) {
    frames.get(module)?.remove(); frames.delete(module); loading.delete(module);
  }
  async function ensure(module) {
    if (!Object.hasOwn(paths,module)) return Promise.reject(new Error('未知离屏模块。'));
    if (loading.has(module)) return loading.get(module);
    if (frames.has(module)) return Promise.resolve();
    if (module === 'chatroom') {
      const locks = await navigator.locks.query();
      if ([...locks.held,...locks.pending].some(lock => lock.name === 'bjtuca-chatroom-engine')) return;
      // Another ensure may have arrived during the lock query.
      if (loading.has(module)) return loading.get(module);
      if (frames.has(module) || !chatWanted) return;
    }
    const frame = document.createElement('iframe'); frame.hidden = true;
    frame.title = module; frame.src = chrome.runtime.getURL(paths[module]);
    // Explicit deny: a hidden renderer must never initiate capture or a picker.
    frame.allow = "camera 'none'; microphone 'none'; display-capture 'none'";
    frames.set(module,frame);
    const ready = new Promise((resolve,reject) => {
      const timeout = setTimeout(() => { remove(module); reject(new Error('离屏子任务加载超时。')); },15000);
      frame.onload = () => { clearTimeout(timeout); resolve(); };
      frame.onerror = () => { clearTimeout(timeout); remove(module); reject(new Error('离屏子任务加载失败。')); };
      document.body.append(frame);
    }).finally(() => loading.delete(module));
    loading.set(module,ready); return ready;
  }
  // Never close the shared document: another module may still be working.
  // Chat shutdown is requested in-frame and acknowledged only after draining.
  function stopChat() {
    frames.get('chatroom')?.contentWindow?.postMessage({type:'BJTU_CHATROOM_DRAIN'},location.origin);
  }
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (message?.type !== 'BJTU_OFFSCREEN_HOST' || sender.id !== chrome.runtime.id) return false;
    const {module,command} = message;
    if (!Object.hasOwn(paths,module)) { respond({ok:false,error:'未知离屏模块。'}); return false; }
    void (async () => {
      if (module === 'chatroom') {
        chatWanted = command === 'ensure'; clearInterval(retry);
        if (chatWanted) retry = setInterval(() => { void ensure('chatroom').catch(error => console.warn('[bjtu] offscreen retry:',error)); },2000);
      }
      if (command === 'release') { if (module === 'chatroom') stopChat(); else remove(module); }
      else if (command === 'reset') {
        if (module === 'chatroom') stopChat();
        else { remove(module); await ensure(module); }
      } else if (command === 'ensure') await ensure(module);
      else throw new Error('未知宿主操作。');
      respond({ok:true});
    })().catch(error => respond({ok:false,error:error.message}));
    return true;
  });
  window.addEventListener('message',event => {
    if (event.origin !== location.origin || event.source !== frames.get('chatroom')?.contentWindow) return;
    if (event.data?.type === 'BJTU_CHATROOM_ENGINE_RELEASED') {
      // Navigating first fires pagehide while the old engine still owns its
      // Web Lock. Its RTC/storage cleanup precedes the next owner's startup.
      const frame = frames.get('chatroom');
      frame.onload = () => remove('chatroom'); frame.src = 'about:blank';
    }
  });
})();
