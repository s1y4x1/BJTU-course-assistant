(function(global) {
  'use strict';
  const defaults = { chatroomFullscreenButtonEnabled:true, chatroomSignalingUrl:'wss://public.localsend.org/v1/ws' };
  let initialized = false;
  function render(values) {
    document.getElementById('chatroomFullscreenButtonEnabled').checked = values.chatroomFullscreenButtonEnabled !== false;
    document.getElementById('chatroomSignalingUrl').value = values.chatroomSignalingUrl || defaults.chatroomSignalingUrl;
  }
  async function init({setMessage}) {
    if (initialized) return;
    initialized = true;
    render(await chrome.storage.local.get(defaults));
    document.getElementById('chatroomFullscreenButtonEnabled').addEventListener('change', (event) => {
      void chrome.storage.local.set({chatroomFullscreenButtonEnabled:event.target.checked}).catch(e => setMessage(e.message,false));
    });
    document.getElementById('chatroomSignalingUrl').addEventListener('change', async (event) => {
      try {
        const url = new URL(event.target.value.trim() || defaults.chatroomSignalingUrl);
        if (url.protocol !== 'wss:' || url.username || url.password) throw new Error('请填写不含账号密码的 wss:// 地址');
        await chrome.storage.local.set({chatroomSignalingUrl:url.href});
      } catch (e) { setMessage(e.message,false); }
    });
    document.getElementById('chatroomOpen').addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        if (!global.BjtuChatroomLauncher) await global.BjtuModuleRegistry.loadScript('modules/chatroom/launch.js');
        await global.BjtuChatroomLauncher.open();
      } catch(e) { setMessage(e.message,false); }
    });
    chrome.storage.onChanged.addListener((changes,area) => {
      if (area !== 'local') return;
      for (const key of Object.keys(defaults)) if (changes[key]) {
        const el = document.getElementById(key);
        if (el.type === 'checkbox') el.checked = changes[key].newValue !== false;
        else if (document.activeElement !== el) el.value = changes[key].newValue || defaults[key];
      }
    });
  }
  async function reset() { await chrome.storage.local.set(defaults); if(initialized) render(defaults); }
  global.BjtuChatroomOptions = {init,reset};
  global.BjtuOptionsModules?.register('chatroom',global.BjtuChatroomOptions);
})(globalThis);
