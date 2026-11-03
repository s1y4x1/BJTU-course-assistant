(function(global) {
  'use strict';
  const prefix = 'bjtuca-chatroom-message:';
  const pending = new Map();
  function plain(text) { return String(text || '').replace(/```[\s\S]*?```/g,' [代码] ').replace(/[*_`>#]/g,'').replace(/\s+/g,' ').slice(0,180); }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.chatroomState?.newValue) return;
    const value = changes.chatroomState.newValue, old = changes.chatroomState.oldValue;
    const known = new Set((old?.messages || []).map(message => message.id));
    for (const message of value.messages || []) {
      if (known.has(message.id)) continue;
      const view = value.conversations?.[message.conversationId];
      if (!view?.unread || view.muted || view.lastOwn) continue;
      clearTimeout(pending.get(message.conversationId));
      pending.set(message.conversationId, setTimeout(() => {
        pending.delete(message.conversationId);
        void notify(message.conversationId, message.id).catch(error => console.warn('[bjtu] chatroom notification:',error));
      },400));
    }
  });
  async function notify(conversationId, messageId) {
    const stored = await chrome.storage.local.get(['chatroomState','chatroomNotifyNewMessages']);
    const state = stored.chatroomState, view = state?.conversations?.[conversationId];
    if (stored.chatroomNotifyNewMessages === false || !view?.unread || view.muted || view.hidden || view.lastOwn || view.lastMessageId !== messageId) return;
    const peer = state.peers?.find(peer => peer.id === view.lastSenderId);
    const title = conversationId === 'public' ? view.remark || '公共群聊' : conversationId.startsWith('peer:')
      ? peer?.remark || peer?.ip || peer?.nickname || '私聊' : view.remark || state.rooms?.find(room => room.id === conversationId)?.name || '群聊';
    const create = global.BjtuSystemNotifications?.create || ((id,options)=>chrome.notifications.create(id,options));
    await create(prefix+encodeURIComponent(conversationId), {
      type:'basic', iconUrl:chrome.runtime.getURL('icons/128.png'), title:`${title} · ${view.unread} 条新消息`, message:plain(view.lastText)
    },'chatroom-message',true);
  }
  chrome.notifications.onClicked.addListener(id => {
    if (!id.startsWith(prefix)) return;
    void (async () => {
      const conversationId = decodeURIComponent(id.slice(prefix.length));
      const url = chrome.runtime.getURL('modules/chatroom/chat.html');
      const existing = (await chrome.tabs.query({url:url+'*'}))[0];
      const tab = existing ? await chrome.tabs.update(existing.id,{active:true})
        : await (global.BjtuTabs || chrome.tabs).create({url:url+'?conversation='+encodeURIComponent(conversationId),active:true});
      await chrome.storage.local.set({chatroomNavigation:{conversationId,tabId:tab.id,at:Date.now()}});
      if (tab.windowId != null) {
        const win=await chrome.windows.get(tab.windowId);
        await chrome.windows.update(win.id,{focused:true,...(win.state==='minimized'?{state:'normal'}:{})});
      }
      await chrome.notifications.clear(id);
    })().catch(error => console.warn('[bjtu] open chatroom:',error));
  });
})(globalThis);
