(async function() {
  'use strict';
  if (new URLSearchParams(location.search).get('view') === 'sidepanel' || new URLSearchParams(location.search).get('popup') === '1' || location.pathname.endsWith('/popup.html')) return;
  const available = await globalThis.BjtuModuleRegistry.ready;
  if (!available.chatroom) return;
  await globalThis.BjtuModuleRegistry.loadScript('modules/chatroom/launch.js');
  await globalThis.BjtuModuleRegistry.loadScript('modules/chatroom/conversations.js');
  const container = document.getElementById('fullscreen-module-buttons');
  if (!container) return;
  const button = document.createElement('button');
  button.id = 'chatroom-fullscreen-button';
  button.dataset.bound = '1';
  button.className = 'fullscreen-module-button floating-launcher-button';
  button.type = 'button';
  button.title = '局域网聊天室';
  button.setAttribute('aria-label','打开局域网聊天室');
  button.style.background = '#0f766e';
  button.style.color = '#fff';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 11a8 8 0 0 1-8 8H5l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 10h8M7 14h5"/></svg>';
  container.append(button);
  const unreadBadge = document.createElement('span');
  unreadBadge.className = 'fullscreen-module-unread-badge'; unreadBadge.hidden = true;
  button.append(unreadBadge);
  const {visibleConversations, unreadCount} = globalThis.BjtuChatroomConversations;
  const updateUnread = state => {
    const count = visibleConversations(state).reduce((total,{view}) => total + unreadCount(view), 0);
    unreadBadge.hidden = count === 0; unreadBadge.textContent = count > 99 ? '99+' : String(count);
    button.title = count ? `局域网聊天室 · ${count} 条未读消息` : '局域网聊天室';
  };
  let observedUnreadChange = false;
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local' || !changes.chatroomState) return;
    observedUnreadChange = true;
    updateUnread(changes.chatroomState.newValue);
  });
  const {chatroomState} = await chrome.storage.local.get('chatroomState');
  if (!observedUnreadChange) updateUnread(chatroomState);
  button.addEventListener('click', () => void globalThis.BjtuChatroomLauncher.open().catch(error => globalThis.showToast?.(error.message,'error')));
  button.hidden = (await chrome.storage.local.get('chatroomFullscreenButtonEnabled')).chatroomFullscreenButtonEnabled === false;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'BJTU_OPEN_CHATROOM') return;
    void (async () => {
      await globalThis.BjtuChatroomLauncher.open();
      const frame = document.querySelector('#chatroom-module-window iframe');
      const navigate = () => frame?.contentWindow?.postMessage({
        type: 'BJTU_CHATROOM_NAVIGATE',
        conversationId: message.conversationId || ''
      }, location.origin);
      if (frame?.contentDocument?.readyState === 'complete') navigate();
      else frame?.addEventListener('load', navigate, {once:true});
      sendResponse({ok:true});
    })().catch(error => sendResponse({ok:false, error:String(error?.message || error)}));
    return true;
  });
  globalThis.BjtuSyncFloatingLauncherContainer?.();
})().catch(console.error);
