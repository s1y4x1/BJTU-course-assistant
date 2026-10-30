(function(global) {
  'use strict';
  if (global.BjtuChatroomLauncher) return;
  let opening;
  async function open() {
    if (location.pathname.endsWith('/app/app.html')) {
      if (!global.BjtuFullscreenModuleWindows) {
        await new Promise(resolve => global.addEventListener('bjtu-fullscreen-module-windows-ready', resolve, {once:true}));
      }
      return global.BjtuFullscreenModuleWindows.open('chatroom');
    }
    if (opening) return opening;
    opening = (async () => {
      const url = chrome.runtime.getURL('modules/chatroom/chat.html');
      const existing = (await chrome.tabs.query({url}))[0];
      const tab = existing ? await chrome.tabs.update(existing.id,{active:true}) : await chrome.tabs.create({url,active:true});
      if (tab.windowId != null) {
        const win = await chrome.windows.get(tab.windowId);
        await chrome.windows.update(tab.windowId,{focused:true,...(win.state === 'minimized' ? {state:'normal'} : {})});
      }
      await chrome.runtime.sendMessage({type:'GROUP_BJTU_OPENED_TAB',tabId:tab.id}).catch(() => {});
      return tab;
    })();
    try { return await opening; } finally { opening = null; }
  }
  global.BjtuChatroomLauncher = {open};
})(globalThis);
