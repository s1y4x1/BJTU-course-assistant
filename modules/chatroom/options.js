(function(global) {
  'use strict';
  const defaults = { chatroomFullscreenButtonEnabled:true, chatroomSignalingUrl:'wss://public.localsend.org/v1/ws' };
  const instances = new WeakMap();
  function render(root, values) {
    root.querySelector('#chatroomFullscreenButtonEnabled').checked = values.chatroomFullscreenButtonEnabled !== false;
    root.querySelector('#chatroomSignalingUrl').value = values.chatroomSignalingUrl || defaults.chatroomSignalingUrl;
  }
  async function init({setMessage = (text, ok) => global.BjtuOptionsMessage?.show(text, ok)} = {}) {
    const root = document.querySelector('.chatroom-options-card[data-options-fragment]');
    if (!root) return;
    if (instances.has(root)) return instances.get(root).ready;
    const entry = {ready:null,sidebar:null};
    instances.set(root,entry);
    entry.ready = (async () => {
      render(root,await chrome.storage.local.get(defaults));
      const urlInput = root.querySelector('#chatroomSignalingUrl');
      let urlTimer, urlRevision = 0, urlDirty = false, urlQueue = Promise.resolve();
      root.querySelector('#chatroomFullscreenButtonEnabled').addEventListener('change', event => {
        void chrome.storage.local.set({chatroomFullscreenButtonEnabled:event.target.checked}).catch(e => setMessage(e.message,false));
      });
      function saveUrl(notify = false) {
        clearTimeout(urlTimer);
        if (!urlDirty) return;
        const version = urlRevision;
        let url;
        try {
          url = new URL(urlInput.value.trim() || defaults.chatroomSignalingUrl);
          if (!['ws:','wss:'].includes(url.protocol) || url.username || url.password || url.hash)
            throw new Error('请填写不含账号密码或片段的 ws:// 或 wss:// 地址');
          urlInput.setCustomValidity('');
        } catch(error) {
          urlInput.setCustomValidity(error.message);
          if (notify) setMessage(error.message,false);
          return;
        }
        urlQueue = urlQueue.catch(() => {}).then(async () => {
          if (version !== urlRevision) return;
          await chrome.storage.local.set({chatroomSignalingUrl:url.href});
          if (version === urlRevision) { urlDirty = false; urlInput.value = url.href; }
        }).catch(e => setMessage(e.message,false));
      }
      urlInput.addEventListener('input', () => {
        urlDirty = true; urlRevision++; urlInput.setCustomValidity('');
        clearTimeout(urlTimer); urlTimer = setTimeout(() => saveUrl(),450);
      });
      for (const type of ['change','blur']) urlInput.addEventListener(type, () => saveUrl(true));
      root.querySelector('#chatroomOpen').addEventListener('click', async event => {
        event.preventDefault();
        try {
          if (!global.BjtuChatroomLauncher) await global.BjtuModuleRegistry.loadScript('modules/chatroom/launch.js');
          await global.BjtuChatroomLauncher.open();
        } catch(e) { setMessage(e.message,false); }
      });
      // Registry supplies these scripts for dynamic fragments; standalone HTML
      // includes the same dependencies directly, in the same order.
      if (!global.BjtuChatroomSidebar) throw new Error('聊天室 sidebar.js 未加载，请检查模块依赖。');
      entry.sidebar = global.BjtuChatroomSidebar.mount({
        root,
        report:error => setMessage(error.message,false)
      });
      global.BjtuOptionTips?.setup();
      const onStorage = (changes, area) => {
        if (area !== 'local') return;
        if (!root.isConnected) { chrome.storage.onChanged.removeListener(onStorage); entry.sidebar.destroy(); return; }
        for (const key of Object.keys(defaults)) if (changes[key]) {
          const el = root.querySelector('#' + key);
          if (el.type === 'checkbox') el.checked = changes[key].newValue !== false;
          else if (!urlDirty && document.activeElement !== el) el.value = changes[key].newValue || defaults[key];
        }
      };
      chrome.storage.onChanged.addListener(onStorage);
      global.addEventListener('pagehide', () => {
        saveUrl(); chrome.storage.onChanged.removeListener(onStorage); entry.sidebar.destroy();
      }, {once:true});
      await entry.sidebar.ready;
    })();
    try { await entry.ready; } catch(error) { instances.delete(root); throw error; }
  }
  async function reset() {
    await chrome.storage.local.set(defaults);
    const root = document.querySelector('.chatroom-options-card[data-options-fragment]');
    if (root) render(root,defaults);
  }
  global.BjtuChatroomOptions = {init,reset};
  global.BjtuOptionsModules?.register('chatroom',global.BjtuChatroomOptions);
})(globalThis);
