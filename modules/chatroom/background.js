(function(global) {
  'use strict';
  if (!global.BjtuOffscreenManager) importScripts(chrome.runtime.getURL('core/offscreen-manager.js'));
  const prefix = 'bjtuca-chatroom-message:';
  const requestPrefix = 'bjtuca-chatroom-request:';
  const filePrefix = 'bjtuca-chatroom-file:';
  const alarm = 'bjtuca-chatroom-background';
  const pending = new Map();
  let reconcilePromise;
  const report = error => console.warn('[bjtu] chatroom background:',error);
  function reconcile() {
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      const settings = await chrome.storage.local.get({chatroomBackgroundEnabled:true});
      if (settings.chatroomBackgroundEnabled !== false) {
        await chrome.alarms.create(alarm,{periodInMinutes:1});
        await global.BjtuOffscreenManager.ensure('chatroom');
      } else {
        await chrome.alarms.clear(alarm);
        const contexts = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
        if (contexts.some(context => context.documentUrl === global.BjtuOffscreenManager.url))
          await global.BjtuOffscreenManager.release('chatroom');
      }
    })().finally(() => { reconcilePromise = null; });
    return reconcilePromise;
  }
  chrome.alarms.onAlarm.addListener(event => { if (event.name === alarm) void reconcile().catch(report); });
  chrome.runtime.onStartup.addListener(() => { void reconcile().catch(report); });
  chrome.runtime.onInstalled.addListener(() => { void reconcile().catch(report); });
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'BJTU_CHATROOM_OPTIONS_STATUS') {
      void chrome.runtime.sendMessage({type:'BJTU_CHATROOM_ENGINE_DISCOVER'}).then(
        result => respond(result),() => respond({discoveryStatus:'disconnected'}));
      return true;
    }
    if (message?.type === 'BJTU_CHATROOM_OPTIONS_ACTION') {
      const actions = new Set(['settings','remark','conversation-remark','block','friend-request','friend-response','friend-delete',
        'conversation-mute','conversation-clear','conversation-delete','group-create','group-invite','group-response','group-leave',
        'scan','connect','pair-create','pair-accept','pair-complete','close']);
      if (!actions.has(message.name)) { respond({ok:false,error:'不支持的选项页操作。'}); return false; }
      void (async () => {
        const stored = await chrome.storage.local.get({chatroomBackgroundEnabled:true});
        if (stored.chatroomBackgroundEnabled === false) throw new Error('后台接收已关闭，请重试。');
        await global.BjtuOffscreenManager.ensure('chatroom');
        let reply;
        for (let attempt=0;attempt<20;attempt++) {
          const target = await chrome.runtime.sendMessage({type:'BJTU_CHATROOM_ENGINE_DISCOVER'}).catch(() => null);
          if (target?.engineId) reply = await chrome.runtime.sendMessage({type:'BJTU_CHATROOM_ENGINE_ACTION',
            engineId:target.engineId,name:message.name,args:message.args}).catch(() => null);
          if (reply?.ok) { respond(reply); return; }
          await new Promise(resolve => setTimeout(resolve,100));
        }
        throw new Error(reply?.error || '后台引擎尚未就绪，请打开聊天室。');
      })().catch(error => respond({ok:false,error:error.message}));
      return true;
    }
    if (message?.type === 'BJTU_CHATROOM_FOREGROUND_WAITING') {
      void global.BjtuOffscreenManager.release('chatroom').catch(report);
      return false;
    }
    if (message?.type === 'BJTU_CHATROOM_FOREGROUND_RELEASED') {
      void reconcile().catch(report); return false;
    }
    if (message?.type === 'BJTU_CHATROOM_FILE_INVITATION_CLOSED') {
      const chatUrl = chrome.runtime.getURL('modules/chatroom/chat.html');
      if (sender.url?.split('?')[0] !== chatUrl) return false;
      const id = fileNotificationId(message);
      void takeFileNotification(id).then(() => chrome.notifications.clear(id)).catch(report);
      return false;
    }
    if (message?.type !== 'BJTU_CHATROOM_BACKGROUND_INVITATION') return false;
    const chatUrl = chrome.runtime.getURL('modules/chatroom/chat.html');
    if (sender.url?.split('?')[0] !== chatUrl || new URL(sender.url).searchParams.get('background') !== '1') return false;
    void (message.pending && message.media === 'file' ? notifyFileInvitation(message) : notifyRejectedMedia(message))
      .then(() => respond({ok:true}),error => { report(error); respond({ok:false,error:error.message}); });
    return true;
  });
  // Also run after a service-worker restart; do not rely on a visible page.
  void reconcile().catch(report);
  function plain(text) { return String(text || '').replace(/```[\s\S]*?```/g,' [代码] ').replace(/[*_`>#]/g,'').replace(/\s+/g,' ').slice(0,180); }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.chatroomBackgroundEnabled) {
      // Serialize a second pass if a change arrives during initial creation.
      void (reconcilePromise || Promise.resolve()).catch(() => {}).then(reconcile).catch(report);
    }
    if (area !== 'local' || !changes.chatroomState?.newValue) return;
    const value = changes.chatroomState.newValue, old = changes.chatroomState.oldValue;
    const known = new Set((old?.messages || []).map(message => message.id));
    const knownRequests = new Set((old?.requests || []).map(request => request.id));
    for (const request of value.requests || []) {
      if (knownRequests.has(request.id)) continue;
      void notifyRequest(request.id).catch(report);
    }
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
  async function requestNotification(id, title, message) {
    const settings = await chrome.storage.local.get('chatroomNotifyNewMessages');
    if (settings.chatroomNotifyNewMessages === false) return false;
    const create = global.BjtuSystemNotifications?.create || ((id,options) => chrome.notifications.create(id,options));
    await create(requestPrefix+id,{type:'basic',iconUrl:chrome.runtime.getURL('icons/128.png'),
      title,message:plain(message)},'chatroom-request',true);
    return true;
  }
  function fileNotificationId({engineId,peerId,sid}) {
    return filePrefix + encodeURIComponent([engineId,peerId,sid].join(':'));
  }
  let fileNotificationsQueue = Promise.resolve();
  function editFileNotifications(edit) {
    const job = fileNotificationsQueue.then(async () => {
      const {chatroomFileNotifications:stored = {}} = await chrome.storage.session.get('chatroomFileNotifications');
      const entries = Object.fromEntries(Object.entries(stored).filter(([,value]) => Date.now()-value.createdAt < 120000));
      const result = edit(entries);
      await chrome.storage.session.set({chatroomFileNotifications:entries}); return result;
    });
    fileNotificationsQueue = job.catch(report); return job;
  }
  function takeFileNotification(id) {
    return editFileNotifications(entries => { const value = entries[id]; delete entries[id]; return value; });
  }
  async function notifyFileInvitation(message) {
    const {engineId,peerId,sid,size,name,conversationId} = message;
    if (typeof engineId !== 'string' || engineId.length > 100 || !/^[a-f0-9]{64}$/.test(peerId) ||
        typeof sid !== 'string' || sid.length > 100 || !Number.isSafeInteger(size) || size < 0) return;
    const settings = await chrome.storage.local.get(['chatroomNotifyNewMessages','chatroomState']);
    if (settings.chatroomNotifyNewMessages === false) return;
    const peer = settings.chatroomState?.peers?.find(item => item.id === peerId);
    const who = peer?.remark || peer?.nickname || peer?.ip || '对方';
    const id = fileNotificationId(message);
    await editFileNotifications(entries => { entries[id] = {engineId,peerId,sid,conversationId,createdAt:Date.now()}; });
    const create = global.BjtuSystemNotifications?.create || ((id,options) => chrome.notifications.create(id,options));
    await create(id,{type:'basic',iconUrl:chrome.runtime.getURL('icons/128.png'),title:'聊天室 · 文件接收确认',
      message:`${who} 希望发送「${String(name || '未命名文件').slice(0,120)}」（${size.toLocaleString()} B）。未满足自动接收条件，请选择接收或拒绝。`,
      buttons:[{title:'接收'},{title:'拒绝'}]},'chatroom-file',true);
  }
  chrome.notifications.onButtonClicked.addListener((id,index) => {
    if (!id.startsWith(filePrefix) || ![0,1].includes(index)) return;
    void (async () => {
      const invitation = await takeFileNotification(id);
      await chrome.notifications.clear(id);
      if (!invitation) return;
      const result = await chrome.runtime.sendMessage({type:'BJTU_CHATROOM_FILE_DECISION',...invitation,accept:index === 0})
        .catch(() => ({ok:false,error:'文件邀请已失效，请让对方重新发送。',openChat:index === 0}));
      if (result?.openChat) await openConversation(result.conversationId || invitation.conversationId);
      if (result?.ok === false) await requestNotification(encodeURIComponent(id),'聊天室 · 文件接收未开始',result.error || '请打开聊天室后重试。');
    })().catch(report);
  });
  async function notifyRequest(id) {
    const {chatroomState:state} = await chrome.storage.local.get('chatroomState');
    const request = state?.requests?.find(item => item.id === id);
    if (!request || !['friend','group'].includes(request.type)) return;
    const peer = state.peers?.find(item => item.id === request.from);
    if (peer?.blocked) return;
    const who = peer?.remark || peer?.nickname || peer?.ip || '对方';
    await requestNotification(encodeURIComponent('request:'+id), '聊天室 · 邀请与确认',
      request.type === 'friend' ? `${who} 请求添加好友。打开聊天室确认。` : `${who} 邀请你加入「${request.room?.name || '群聊'}」。打开聊天室确认。`);
  }
  const rejectedMedia = new Set();
  async function notifyRejectedMedia(message) {
    const {peerId,media,name,reason,sid} = message;
    if (typeof peerId !== 'string' || peerId.length > 100 || !['file','screen'].includes(media)) return;
    const key = [peerId,media,String(sid || name || '').slice(0,180)].join(':');
    if (rejectedMedia.has(key)) return;
    rejectedMedia.add(key);
    while (rejectedMedia.size > 200) rejectedMedia.delete(rejectedMedia.values().next().value);
    await requestNotification(encodeURIComponent('media:'+key),'聊天室 · 后台邀请已拒绝',
      `${media === 'screen' ? '屏幕共享' : '文件「'+String(name || '未命名文件').slice(0,100)+'」'}：${String(reason || '后台无法接收').slice(0,100)}。打开聊天室后请对方重新发送。`);
  }
  async function notify(conversationId, messageId) {
    const stored = await chrome.storage.local.get(['chatroomState','chatroomNotifyNewMessages']);
    const state = stored.chatroomState, view = state?.conversations?.[conversationId];
    if (stored.chatroomNotifyNewMessages === false || !view?.unread || view.muted || view.hidden || view.lastOwn || view.lastMessageId !== messageId) return;
    const peer = state.peers?.find(peer => peer.id === view.lastSenderId);
    const title = conversationId === 'public' ? view.remark || '公共群聊' : conversationId.startsWith('peer:')
      ? peer?.remark || peer?.nickname || peer?.ip || '私聊' : view.remark || state.rooms?.find(room => room.id === conversationId)?.name || '群聊';
    const create = global.BjtuSystemNotifications?.create || ((id,options)=>chrome.notifications.create(id,options));
    await create(prefix+encodeURIComponent(conversationId), {
      type:'basic', iconUrl:chrome.runtime.getURL('icons/128.png'), title:`${title} · ${view.unread} 条新消息`, message:plain(view.lastText)
    },'chatroom-message',true);
  }
  async function focusTab(tab) {
    if (tab?.windowId == null) return;
    const win = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(win.id, {focused:true, ...(win.state === 'minimized' ? {state:'normal'} : {})});
  }
  async function createChatTab(conversationId) {
    const url = chrome.runtime.getURL('modules/chatroom/chat.html');
    const tab = await (global.BjtuTabs || chrome.tabs).create({
      url: url + (conversationId ? '?conversation=' + encodeURIComponent(conversationId) : ''),
      active: true
    });
    if (conversationId) await chrome.storage.local.set({chatroomNavigation:{conversationId,tabId:tab.id,at:Date.now()}});
    await focusTab(tab);
    return tab;
  }
  async function openConversation(conversationId) {
      const url = chrome.runtime.getURL('modules/chatroom/chat.html');
      const existing = (await chrome.tabs.query({url:url+'*'}))[0];
      if (existing) {
        const tab = await chrome.tabs.update(existing.id,{active:true});
        if (conversationId) await chrome.storage.local.set({chatroomNavigation:{conversationId,tabId:tab.id,at:Date.now()}});
        await focusTab(tab);
        return;
      }
      const fullscreenEnabled = (await chrome.storage.local.get('chatroomFullscreenButtonEnabled')).chatroomFullscreenButtonEnabled !== false;
      const appUrl = chrome.runtime.getURL('app/app.html');
      const appTab = fullscreenEnabled ? (await chrome.tabs.query({url:appUrl + '*'}))[0] : null;
      if (appTab) {
        try {
          await chrome.tabs.sendMessage(appTab.id, {type:'BJTU_OPEN_CHATROOM', conversationId});
          await chrome.tabs.update(appTab.id, {active:true});
          await focusTab(appTab);
          return;
        } catch {}
      }
      await createChatTab(conversationId);
  }
  chrome.notifications.onClicked.addListener(id => {
    const isRequest = id.startsWith(requestPrefix);
    const isFile = id.startsWith(filePrefix);
    if (!id.startsWith(prefix) && !isRequest && !isFile) return;
    void (async () => {
      const stored = isFile ? await chrome.storage.session.get('chatroomFileNotifications') : null;
      const conversationId = isFile ? stored?.chatroomFileNotifications?.[id]?.conversationId : isRequest ? null : decodeURIComponent(id.slice(prefix.length));
      await openConversation(conversationId);
      await chrome.notifications.clear(id);
    })().catch(error => console.warn('[bjtu] open chatroom:',error));
  });
})(globalThis);
