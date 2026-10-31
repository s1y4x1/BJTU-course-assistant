(function(global) {
  'use strict';
  const defaults = { chatroomFullscreenButtonEnabled:true };
  const instances = new WeakMap();
  function render(root, values) {
    root.querySelector('#chatroomFullscreenButtonEnabled').checked = values.chatroomFullscreenButtonEnabled !== false;
  }
  async function init({setMessage = (text, ok) => global.BjtuOptionsMessage?.show(text, ok)} = {}) {
    const root = document.querySelector('.chatroom-options-card[data-options-fragment]');
    if (!root) return;
    if (instances.has(root)) return instances.get(root).ready;
    const entry = {ready:null,sidebar:null};
    instances.set(root,entry);
    entry.ready = (async () => {
      render(root,await chrome.storage.local.get(defaults));
      root.querySelector('#chatroomFullscreenButtonEnabled').addEventListener('change', event => {
        void chrome.storage.local.set({chatroomFullscreenButtonEnabled:event.target.checked}).catch(e => setMessage(e.message,false));
      });
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
        }
      };
      chrome.storage.onChanged.addListener(onStorage);
      global.addEventListener('pagehide', () => {
        chrome.storage.onChanged.removeListener(onStorage); entry.sidebar.destroy();
      }, {once:true});
      await entry.sidebar.ready;
    })();
    try { await entry.ready; } catch(error) { instances.delete(root); throw error; }
  }
  async function reset() {
    await chrome.storage.local.set({...defaults, ...global.BjtuChatroomSettings.defaults});
    const root = document.querySelector('.chatroom-options-card[data-options-fragment]');
    if (root) render(root,defaults);
  }
  global.BjtuChatroomOptions = {init,reset};
  global.BjtuOptionsModules?.register('chatroom',global.BjtuChatroomOptions);
})(globalThis);
