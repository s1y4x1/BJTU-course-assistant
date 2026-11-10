/* Transport contract: globalThis.BjtuChatroomTransport supplies state(),
 * action(name, args), subscribe(event => ...): unsubscribe. State uses the
 * chatroom domain schema; signal events are {type:'signal', peerId, payload}.
 * Transport owns identity and message persistence; BjtuChatroomLink owns RTC,
 * automatic online discovery and offline pairing. No local bridge needed.
 * RTC payload protocol below is independent of the transport implementation.
 */
(async () => {
  'use strict';
  const backgroundMode = globalThis.BjtuChatroomBackgroundMode;
  const background = backgroundMode?.enabled === true;
  if (globalThis.BjtuChatroomEngineLease && !await globalThis.BjtuChatroomEngineLease.acquire()) return;
  const $ = (id) => document.getElementById(id);
  const embedded = new URLSearchParams(location.search).get('embedded') === '1';
  let embeddedVisible = !embedded;
  document.body.classList.toggle('chatroom-embedded', embedded);
  if (embedded) document.addEventListener('pointerdown', () => {
    try { parent.BjtuFullscreenModuleWindows?.focus('chatroom'); } catch {}
  }, {capture:true});
  // Import only the shared controls, without the options page shell or scripts.
  const response = await fetch(new URL('options.html', location.href));
  if (!response.ok) throw new Error('无法加载聊天室联系人和设置。');
  const source = new DOMParser().parseFromString(await response.text(), 'text/html');
  const start = source.querySelector('[data-chatroom-sidebar-start]');
  const end = source.querySelector('[data-chatroom-sidebar-end]');
  if (!start || !end) throw new Error('聊天室联系人和设置模板缺失。');
  const fragment = document.createDocumentFragment();
  for (let control = start.nextSibling; control && control !== end; control = control.nextSibling) {
    fragment.append(document.importNode(control, true));
  }
  $('sidebar-host').replaceChildren(fragment);
  $('sidebar-host').removeAttribute('aria-busy');
  const LIMIT = { messages: 600, peers: 500, rooms: 100, requests: 100, sessions: 8, history: 32, memory: 128 * 1024 * 1024, chunk: 32 * 1024 };
  const PROTOCOL = 'bjtu-chatroom-rtc-v1';
  let state = { self: {}, peers: [], rooms: [], messages: [], requests: [], settings: {}, conversations: {} };
  let selected = 'public';
  let sidebar;
  let transport, unsubscribe, stopped = false, online = false, stateTimer, statePromise, stateDirty = false;
  let capture = null, sharingPending = false, memoryReserved = 0;
  const sessions = new Map(), transferHistory = [], drafts = new Map(), scrollPositions = new Map();
  const mediaMessages = new Map();
  const savedPreviews = new Map();
  const messageNodes = new Map();
  const pendingSignals = new Map(), closedSessions = new Map();
  let invitationHandoff;
  let pinToBottom = false;
  globalThis.BjtuChatroomEngineLease?.setCanYield(() => !invitationHandoff && !sessions.size && !pendingSignals.size && !statePromise && !stateTimer);
  const uiAbort = new AbortController();
  window.addEventListener('bjtu-chatroom-engine-rolechange',event => {
    if (!background || !event.detail?.draining || invitationHandoff) return;
    invitationHandoff = handoffInvitations([...sessions.values()].filter(s => !s.outgoing && !s.accepted && !s.accepting && s.type === 'file'))
      .catch(error => {
        report(error);
        for (const s of [...sessions.values()]) if (!s.outgoing && !s.accepted && !s.accepting) endSession(s,'无法交接邀请，请重新发送',true);
      }).finally(() => { invitationHandoff = null; });
  },{signal:uiAbort.signal});
  let lastToast = { text: '', at: 0 }, messageConversation = '';
  let membersSignature = '';
  const expandedMembers = new Set();
  let markingRead = false;
  let pendingTitle;
  const liveDrafts = new Map(), draftSessionId = crypto.randomUUID();
  let draftRevision = 0, sharedDraft = null, draftSendTimer, draftRenderTimer, draftStartedAt = Date.now();
  let sendInFlight = false;
  const textEncoder = new TextEncoder();
  const MESSAGE_FILE_LIMIT = 16 * 1024;
  function clearSharedDraft() {
    clearTimeout(draftSendTimer); draftSendTimer = null;
    const previous = sharedDraft; sharedDraft = null;
    if (previous && transport) void transport.action('draft', {conversationId:previous, text:'', draftId:draftSessionId, revision:++draftRevision}).catch(() => {});
  }
  function publishDraft() {
    clearTimeout(draftSendTimer); draftSendTimer = null;
    if (stopped || background || !online || !embeddedVisible || !$('share-draft').checked || !$('message').value.length || !selected || messageBytes() > MESSAGE_FILE_LIMIT) {clearSharedDraft(); return;}
    if (sharedDraft && sharedDraft !== selected) clearSharedDraft();
    sharedDraft = selected;
    void transport.action('draft', {conversationId:selected, text:$('message').value, draftId:draftSessionId, revision:++draftRevision}).catch(() => {});
  }
  function messageBytes() {
    return textEncoder.encode($('message').value).length;
  }
  function truncateMessageText(value) {
    let bytes = 0, end = 0;
    for (const char of value) {
      const size = textEncoder.encode(char).length;
      if (bytes + size > MESSAGE_FILE_LIMIT) break;
      bytes += size; end += char.length;
    }
    return value.slice(0, end);
  }
  let messageComposing = false, limitWarningShown = false;
  function enforceMessageLimit() {
    const input = $('message');
    if (textEncoder.encode(input.value).length <= MESSAGE_FILE_LIMIT) {
      limitWarningShown = false;
      return false;
    }
    const caret = input.selectionStart;
    input.value = truncateMessageText(input.value);
    const position = Math.min(caret, input.value.length);
    input.setSelectionRange(position, position);
    if (!limitWarningShown) {
      limitWarningShown = true;
      toast('单条消息不能超过 16 KiB，请使用「粘贴为文件」发送长文本。');
    }
    return true;
  }
  function updateSendButton() {
    const value = $('message').value;
    const size = textEncoder.encode(value).length;
    const counter = $('message-size');
    if (counter) {
      counter.textContent = `${size} B / 16 kB`;
      counter.classList.toggle('over-limit', size > MESSAGE_FILE_LIMIT);
    }
    $('send').disabled = !online || !selected || sendInFlight || !value.trim();
  }
  function updateDraftPreview() {
    if (!$('message').value.length) {draftStartedAt = Date.now(); clearSharedDraft();}
    updateSendButton();
    if (!draftRenderTimer) draftRenderTimer = setTimeout(() => {draftRenderTimer = null; if (!stopped) renderMessages();}, 30);
    if ($('share-draft').checked && !draftSendTimer && $('message').value.length) draftSendTimer = setTimeout(publishDraft, 160);
  }
  await BjtuMarkdown.ready;
  const markdown = BjtuMarkdown.createParser({preserveWhitespace:true});
  const draftHeartbeat = setInterval(() => {
    let removed = false;
    for (const [key,draft] of liveDrafts) if (draft.expiresAt <= Date.now()) {liveDrafts.delete(key); removed = true;}
    if (removed && !stopped) renderMessages();
    if (sharedDraft) publishDraft();
  }, 5000);
  BjtuMarkdown.bindCopy($('messages'), {onError: report});
  $('messages').addEventListener('scroll', () => {
    const list = $('messages');
    pinToBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 24;
  }, {passive:true});

  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    if (cls) el.className = cls;
    return el;
  }
  function button(text, callback, cls = 'secondary') {
    const el = node('button', text, cls);
    el.type = 'button';
    el.addEventListener('click', () => { Promise.resolve().then(callback).catch(report); });
    return el;
  }
  function listen(id, type, callback) {
    $(id).addEventListener(type, callback, { signal: uiAbort.signal });
  }
  function toast(text, ok = false) {
    if (stopped) return;
    const now = Date.now();
    text = String(text).slice(0, 240);
    if (text === lastToast.text && now - lastToast.at < 7000) return;
    lastToast = { text, at: now };
    globalThis.BjtuOptionsMessage?.show(text, ok);
  }
  function report(error) {
    if (error?.name !== 'AbortError') toast(error?.message || '操作未完成，请检查连接后重试。');
  }
  function nameOf(id) {
    if (id === state.self.id) return state.self.nickname || state.self.ip || '我';
    const peer = state.peers.find((p) => p.id === id);
    return peer?.remark || peer?.nickname || peer?.ip || String(id || '未知用户').slice(0, 80);
  }
  function safeName(value) { return String(value || '未命名文件').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/[. ]+$/, '').slice(0, 180) || '未命名文件'; }
  function uuid() { return crypto.randomUUID(); }
  function bytes(value) { return globalThis.BjtuFileSizeEmphasis?.formatBytes(value) || `${value} B`; }
  function currentRoom() { return state.rooms.find((r) => r.id === selected); }
  function recipients() {
    const ids = selected === 'public' ? state.peers.filter((p) => p.online).map((p) => p.id)
      : selected.startsWith('peer:') ? [selected.slice(5)] : (currentRoom()?.members || []);
    return [...new Set(ids)].filter((id) => id !== state.self.id && state.peers.some((p) => p.id === id && p.online && !p.blocked));
  }
  function screenRecipients() {
    return recipients().filter((id) => {
      const peer = state.peers.find((item) => item.id === id);
      return !!peer && !peer.background;
    });
  }
  function permitted(id) {
    const peer = state.peers.find((p) => p.id === id);
    const sharedGroup = state.rooms.some((room) => room.members?.includes(state.self.id) && room.members.includes(id));
    return !!peer && !peer.blocked && !peer.blockedByPeer && (!state.settings.requireFriend || peer.friend || sharedGroup);
  }
  function connectionStatus(ready) {
    online = ready;
    $('send').disabled = !ready;
    sidebar.setReady(ready);
    updateConversation();
    if (ready) void markConversationRead();
  }
  async function action(name, args = {}) {
    if (!transport || !online) throw new Error('连接引擎尚未就绪，请稍后重新连接。');
    if (name === 'scan') backgroundMode?.resumeReconnect?.();
    const result = await transport.action(name, args);
    if (result?.ok === false || result?.error) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || '操作被连接引擎拒绝。');
    return result;
  }
  async function mutate(name, args) {
    const result = await action(name, args);
    if (name === 'conversation-clear' || name === 'conversation-delete') clearLocalMedia(args.conversationId);
    scheduleState();
    return result;
  }
  function bounded(items, max) { return Array.isArray(items) ? items.slice(-max) : []; }
  function mergeState(value) {
    if (!value || typeof value !== 'object') return;
    const previousMessages = state.messages;
    const source = value.state || value;
    for (const key of ['self', 'settings', 'conversations']) if (source[key]) state[key] = { ...source[key] };
    for (const [key, max] of Object.entries({ peers: LIMIT.peers, rooms: LIMIT.rooms, messages: LIMIT.messages, requests: LIMIT.requests })) {
      if (Array.isArray(source[key])) state[key] = bounded(source[key], max);
    }
    const retained = new Set(state.messages.map(m => m.id));
    for (const message of previousMessages) if (!retained.has(message.id) && mediaMessages.has(message.id)) removeLocalMedia(mediaMessages.get(message.id));
    for (const s of [...sessions.values()]) if (!permitted(s.peerId)) endSession(s, '对方已被屏蔽或不符合好友策略', true);
    renderState();
  }
  function scheduleState() {
    if (stopped) return;
    stateDirty = true;
    if (stateTimer || statePromise) return;
    stateTimer = setTimeout(() => { stateTimer = null; refreshState().catch(report); }, 200);
  }
  async function refreshState() {
    if (statePromise) { stateDirty = true; return statePromise; }
    if (!transport || stopped) return;
    stateDirty = false;
    const owner = transport;
    statePromise = (async () => {
      const result = await owner.state();
      if (stopped || owner !== transport) return;
      if (result?.ok === false || result?.error) throw new Error('无法读取聊天室状态。');
      mergeState(result);
      connectionStatus(true);
    })();
    try { await statePromise; } finally { statePromise = null; if (stateDirty) scheduleState(); }
  }
  async function attachTransport() {
    if (stopped) return;
    const next = globalThis.BjtuChatroomTransport;
    if (!next || typeof next.action !== 'function' || typeof next.state !== 'function' || typeof next.subscribe !== 'function') {
      connectionStatus(false);
      toast('聊天室连接组件未加载，请重新打开聊天室。');
      return;
    }
    if (next !== transport) {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      for (const s of [...sessions.values()]) endSession(s, '连接引擎已切换');
      transport = next;
      await transport.ready;
      if (globalThis.BjtuChatroomLink && typeof transport.setLink === 'function') transport.setLink(globalThis.BjtuChatroomLink);
      const cleanup = transport.subscribe(onEvent);
      if (typeof cleanup === 'function') unsubscribe = cleanup;
    }
    try { await refreshState(); } catch (error) { connectionStatus(false); report(error); }
  }
  function onEvent(event) {
    if (stopped || !event) return;
    if (event.type === 'draft') {
      if (background) return;
      const key = event.peerId+':'+event.conversationId, previous = liveDrafts.get(key);
      if (!event.text.length) {
        if (previous?.draftId === event.draftId) liveDrafts.delete(key);
      } else if (!previous || previous.draftId === event.draftId || event.createdAt >= previous.createdAt) {
        liveDrafts.delete(key);
        liveDrafts.set(key,{id:'draft:'+key, draft:true, senderId:event.peerId, text:event.text, conversationId:event.conversationId,
          draftId:event.draftId, createdAt:event.createdAt, expiresAt:Date.now()+15000});
        while (liveDrafts.size > 100) liveDrafts.delete(liveDrafts.keys().next().value);
      }
      renderMessages();
    } else if (event.type === 'message-received') {
      const key = event.peerId+':'+event.conversationId, previous = liveDrafts.get(key);
      if (previous && previous.createdAt <= event.createdAt) liveDrafts.delete(key);
      renderMessages();
    } else if (event.type === 'signal') {
      // Serialize per peer: description must be applied before subsequent ICE.
      const key = String(event.peerId);
      const prev = pendingSignals.get(key);
      if (pendingSignals.size >= LIMIT.peers && !prev) return;
      if ((prev?.count || 0) >= 128) return;
      const entry = { count: (prev?.count || 0) + 1 };
      entry.promise = (prev?.promise || Promise.resolve()).then(() => handleSignal(key, event.payload)).catch(report).finally(() => {
        if (pendingSignals.get(key) === entry) pendingSignals.delete(key);
      });
      pendingSignals.set(key, entry);
    } else if (event.type === 'error') {
      toast('连接引擎报告错误，请检查连接状态。');
    } else if (event.type === 'disconnected') {
      connectionStatus(false);
      stopCapture();
      for (const s of [...sessions.values()]) endSession(s, '连接已断开');
    } else {
      if (event.state) mergeState(event.state);
      for (const s of [...sessions.values()]) {
        if (s.type === 'screen' && !state.peers.find(peer => peer.id === s.peerId)?.online) endSession(s, '对方已离线，共享已停止');
      }
      for (const [key,draft] of liveDrafts) {
        const p = state.peers.find(peer => peer.id === draft.senderId);
        const r = state.rooms.find(room => room.id === draft.conversationId);
        if (!p?.online || p.blocked || (draft.conversationId.startsWith('group:') && !r?.members.includes(draft.senderId))) liveDrafts.delete(key);
      }
      scheduleState();
    }
  }

  // Keyed region updates leave the composer, dialogs and unchanged cards alone.
  function reconcile(parent, cache, items, keyOf, build) {
    const keep = new Set();
    let previous = null;
    for (const item of items) {
      const key = keyOf(item), signature = JSON.stringify(item);
      keep.add(key);
      const old = cache.get(key);
      let el = old?.el;
      if (old?.signature !== signature) {
        el = build(item);
        if (old) old.el.replaceWith(el); else parent.append(el);
        cache.set(key, { signature, el });
      }
      const expected = previous ? previous.nextSibling : parent.firstChild;
      if (el !== expected) parent.insertBefore(el, expected);
      previous = el;
    }
    for (const [key, item] of cache) if (!keep.has(key)) { item.el.remove(); cache.delete(key); }
  }
  function renderState() {
    sidebar.render(); updateConversation(); renderMessages();
    void markConversationRead();
  }
  async function markConversationRead({interactive = false} = {}) {
    if (background) return;
    const view = state.conversations?.[selected];
    let focused = document.hasFocus();
    if (embedded) { try { focused ||= parent.document.hasFocus(); } catch {} }
    if (stopped || markingRead || !online || !view?.unread || document.visibilityState !== 'visible' ||
        (!focused && !interactive) || (embedded && !embeddedVisible)) return;
    markingRead = true;
    const conversationId = selected;
    try {
      const result = await action('conversation-read', {conversationId,lastMessageId:view.lastMessageId});
      if (state.conversations[conversationId]?.lastMessageId === result.lastMessageId) {
        state.conversations[conversationId].unread = result.unread;
        sidebar.render();
      }
    }
    catch(error) { report(error); }
    finally { markingRead = false; scheduleState(); }
  }
  function chooseConversation(id, {interactive = false} = {}) {
    if (id === selected) {
      if (interactive) { $('message').focus(); void markConversationRead({interactive:true}); }
      return;
    }
    clearSharedDraft(); $('share-draft').checked = false;
    drafts.set(selected, $('message').value);
    scrollPositions.set(selected, $('messages').scrollTop);
    while (drafts.size > 100) drafts.delete(drafts.keys().next().value);
    while (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value);
    selected = id;
    $('message').value = drafts.get(id) || '';
    draftStartedAt = Date.now();
    sidebar?.render();
    updateConversation(); renderMessages();
    $('message').focus();
    void markConversationRead({interactive});
  }
  function updateConversation() {
    const room = currentRoom(), peerId = selected.startsWith('peer:') ? selected.slice(5) : null;
    $('share-draft-label').textContent = peerId ? '允许对方实时观看' : '允许他人实时观看';
    $('share-draft').disabled = !online || !selected;
    const title = $('conversation-title');
    const displayName = !selected ? '' : peerId ? nameOf(peerId)
      : state.conversations?.[selected]?.remark || (selected === 'public' ? '公共群聊' : room?.name || '群聊已结束');
    if (title.dataset.conversationId !== selected || document.activeElement !== title) {
      title.value = pendingTitle?.id === selected ? pendingTitle.value : displayName;
      title.dataset.conversationId = selected; title.dataset.initialValue = title.value;
    }
    title.placeholder = '请选择会话'; title.disabled = !selected;
    const peer = state.peers.find(item => item.id === peerId);
    $('conversation-detail').hidden = !selected || !!peerId;
    $('block-peer').hidden = !peer; $('block-peer').textContent = peer?.blocked ? '取消拉黑' : '拉黑';
    $('delete-friend').hidden = !peer;
    $('delete-friend').textContent = peer?.friend ? '删除好友' : '加好友';
    $('mute-conversation').checked = state.conversations?.[selected]?.muted === true;
    $('mute-conversation').disabled = $('clear-history').disabled = !selected;
    updateSendButton();
    const ids = selected === 'public'
      ? [...(online ? [state.self.id] : []), ...state.peers.filter(p => p.online).map(p => p.id)]
      : peerId ? [] : room?.members || [];
    const members = [...new Set(ids)].filter(Boolean).map(id => ({id, name: nameOf(id), ip: state.peers.find(p => p.id === id)?.ip || '', online:id === state.self.id ? online : state.peers.some(p => p.id === id && p.online), background:state.peers.some(p => p.id === id && p.background)}));
    const signature = JSON.stringify([selected, members]);
    if (signature !== membersSignature) {
      membersSignature = signature;
      $('conversation-members').replaceChildren(...members.map(member => {
        const el = button(member.name, () => sidebar.editPerson(member.id), 'conversation-member');
        const dot = node('span', undefined, `conversation-online-dot${member.online ? ' online' + (member.background ? ' background' : '') : ''}`); dot.title = member.online ? member.background ? '后台在线' : '在线' : '离线'; el.prepend(dot);
        el.title = member.ip || member.name; el.dataset.peerId = member.id; return el;
      }));
      $('conversation-members').classList.toggle('expanded', expandedMembers.has(selected));
      requestAnimationFrame(updateMembersToggle);
    }
    $('invite-group').hidden = $('leave-group').hidden = !room;
    $('pick-file').disabled = $('paste-message-file').disabled = !online || !recipients().length;
    $('share-screen').hidden = !!capture;
    $('stop-screen').hidden = !capture;
    const screenTargets = screenRecipients();
    $('share-screen').disabled = !online || !screenTargets.length || !!capture || sharingPending;
    $('share-screen').title = !screenTargets.length && recipients().length
      ? '对方当前仅后台在线，无法共享屏幕。' : '共享屏幕';
  }
  function updateMembersToggle() {
    const row = $('conversation-members'), toggle = $('conversation-members-toggle'), expanded = expandedMembers.has(selected);
    toggle.hidden = !expanded && row.scrollWidth <= row.clientWidth + 1;
    toggle.textContent = expanded ? '收起成员' : '展开成员';
    toggle.setAttribute('aria-expanded', String(expanded));
  }
  function messageHeader(senderId, createdAt) {
    const date = new Date(createdAt);
    const el = node('div', undefined, 'muted message-author');
    const name = node('strong', nameOf(senderId), 'message-author-name');
    name.tabIndex = 0; name.setAttribute('role', 'button');
    name.title = senderId === state.self.id ? '修改昵称' : '修改备注及联系人操作';
    el.append(name, document.createTextNode(' · '), BjtuDateTime.set(node('span'), Number.isFinite(date.getTime()) ? date : ''));
    el.dataset.senderId = senderId;
    return el;
  }
  function setupMessageCollapse(content) {
    if (!content.isConnected || content.dataset.collapseReady) return;
    content.dataset.collapseReady = '1';
    const maxHeight = Math.max(160, Math.min(640, Math.floor(globalThis.innerHeight * 0.55)));
    if (content.scrollHeight <= maxHeight + 8) return;
    content.style.maxHeight = `${maxHeight}px`;
    content.classList.add('message-text-collapsed');
    const toggle = button('展开全文', () => {
      const collapsed = content.classList.toggle('message-text-collapsed');
      content.style.maxHeight = collapsed ? `${maxHeight}px` : '';
      toggle.textContent = collapsed ? '展开全文' : '收起';
    }, 'message-expand');
    content.after(toggle);
  }
  function renderMessages() {
    for (const [id, task] of savedPreviews) {
      if (task.conversationId !== selected || !state.messages.some(m => m.id === id)) {
        releaseResources(task); savedPreviews.delete(id);
      }
    }
    for (const message of mediaMessages.values()) {
      if (message.conversationId !== selected) for (const task of message.sessions.values()) releasePreview(task);
      else for (const task of message.sessions.values()) if (task.outgoing && task.previewSource && !message.preview) void previewFile(task, task.previewSource).catch(report);
      const header = message.card.querySelector(':scope > .message-author');
      if (header) {
        const name = header.querySelector('.message-author-name');
        if (name && name.textContent !== nameOf(message.senderId)) name.textContent = nameOf(message.senderId);
      }
    }
    const container = $('messages'), changed = messageConversation !== selected;
    const nearBottom = container.scrollHeight - container.clientHeight - container.scrollTop < 64;
    const oldTop = container.scrollTop, oldHeight = container.scrollHeight;
    const anchor = [...messageNodes.values()].find((v) => v.el.offsetTop >= container.offsetTop + oldTop);
    const anchorOffset = anchor ? anchor.el.getBoundingClientRect().top : 0;
    if (changed) { container.replaceChildren(); messageNodes.clear(); messageConversation = selected; }
    const items = [...state.messages.filter(message => !mediaMessages.has(message.id)).map(message => ({...message, displayName: nameOf(message.senderId)})), ...[...mediaMessages.values()].map(s => ({
      id: s.id, conversationId: s.conversationId, senderId: s.senderId, createdAt: s.createdAt, media: true
    })), ...liveDrafts.values(), ...($('draft-preview').checked && $('message').value.length ? [{id:'draft:self',draft:true,senderId:state.self.id,text:$('message').value,conversationId:selected,createdAt:draftStartedAt}] : [])]
      .filter((m) => m.conversationId === selected).sort((a,b) => Number(!!a.draft)-Number(!!b.draft) || a.createdAt-b.createdAt);
    container.querySelector('[data-empty-message]')?.remove();
    reconcile(container, messageNodes, items, (m) => m.id, (message) => {
      // Persisted media summaries survive reloads, but live cards do not.
      const liveMedia = mediaMessages.get(message.id);
      if (liveMedia) return liveMedia.card;
      const el = node('article', undefined, `message${message.senderId === state.self.id ? ' mine' : ''}`);
      el.dataset.messageId = message.id;
      if (message.draft) {
        el.classList.add('message-draft'); el.dataset.draft = 'true';
        el.append(node('div',message.senderId === state.self.id ? '预览 · 未发送' : '正在输入 · 未发送','message-draft-label'));
      }
      const content = node('div', undefined, 'message-text bjtu-markdown');
      if (message.system) {
        el.classList.remove('mine'); el.classList.add('system');
        content.textContent = message.text; el.append(content);
      } else {
        if (message.file) content.append(document.createTextNode(message.file.name + ' · '), styledBytes(message.file.size));
        else content.innerHTML = markdown.parse(String(message.text || '').slice(0, 16384));
        el.append(messageHeader(message.senderId, message.createdAt), content);
        if (!message.draft && !message.file) requestAnimationFrame(() => setupMessageCollapse(content));
      }
      if (message.file && message.fileHandleRef) {
        restoreSavedFilePreview(el, message);
      }
      if (message.senderId === state.self.id && message.delivery) {
        const deliveries = Object.entries(message.delivery);
        if (!message.conversationId.startsWith('peer:') && deliveries.length && deliveries.some(([, value]) => value.status !== 'delivered')) {
          const details = node('details', undefined, 'message-delivery-details');
          details.append(node('summary', `送达详情 · ${deliveries.filter(([, value]) => value.status === 'delivered').length}/${deliveries.length}`));
          const labels = {delivered:'已送达',sending:'等待送达确认',queued:'等待重试',rejected:'已拒绝',withdrawn:'已撤回'};
          for (const [peerId, value] of deliveries) {
            const peer = state.peers.find(item => item.id === peerId);
            details.append(node('div', `${peer?.remark || peer?.nickname || peer?.ip || peerId}：${labels[value.status] || value.status}${value.error ? ' · ' + value.error : ''}`));
          }
          el.append(details);
        }
        const status = {queued:'等待连接恢复后自动重试…',sending:'正在发送…',rejected:'发送被拒绝',withdrawn:'已取消未送达的发送'}[message.status];
        if (status) {
          const errors = [...new Set(Object.values(message.delivery).map(value => value.error).filter(Boolean))];
          el.append(node('div', [status,...errors].join(' · ').slice(0,500), `message-delivery-status${message.status === 'rejected' ? ' error' : ''}`));
        }
        if (['queued','sending','rejected'].includes(message.status)) {
          el.classList.add('has-delivery-actions');
          const actions = node('div', undefined, 'message-delivery-actions');
          for (const [name,label] of [['retry','重试'],['withdraw','撤回']]) {
            const control = button(label, async () => {
              control.disabled = true;
              try { await mutate(name,{messageId:message.id}); await refreshState(); }
              finally { control.disabled = false; }
            });
            control.disabled = name === 'retry' && message.status === 'sending'; actions.append(control);
          }
          el.append(actions);
        }
      }
      return el;
    });
    if (!items.length) { const empty = node('article', undefined, 'message system'); empty.dataset.emptyMessage = ''; empty.append(node('div', '还没有消息，打个招呼吧。', 'message-text bjtu-markdown')); container.append(empty); }
    if (changed) container.scrollTop = scrollPositions.get(selected) ?? container.scrollHeight;
    else if (nearBottom) container.scrollTop = container.scrollHeight;
    else if (anchor?.el.isConnected) container.scrollTop = oldTop + anchor.el.getBoundingClientRect().top - anchorOffset;
    else container.scrollTop = Math.max(0, oldTop + container.scrollHeight - oldHeight);
    pinToBottom = container.scrollHeight - container.clientHeight - container.scrollTop < 24;
  }
  function restoreSavedFilePreview(card, message) {
    if (background) return;
    let task = savedPreviews.get(message.id);
    if (task) {
      task.card = card;
      if (task.preview) card.append(task.preview);
      if (task.status) card.append(task.status);
      return;
    }
    task = {name:message.file.name, conversationId:message.conversationId, card,
      message:{id:message.id, fileHandleRef:message.fileHandleRef}, downloadPath:String(message.downloadPath || ''),
      chunks:[], status:node('p','正在读取文件…','muted saved-file-status')};
    savedPreviews.set(message.id, task); card.append(task.status);
    const load = async (requestPermission = false) => {
      task.status.replaceChildren(document.createTextNode('正在读取文件…'));
      try {
        const file = await globalThis.BjtuChatroomSettings.loadReceivedFile(message.fileHandleRef, requestPermission);
        if (savedPreviews.get(message.id) !== task || stopped || selected !== task.conversationId) return;
        await previewFile(task, file);
        task.status.remove(); task.status = null;
      } catch (error) {
        if (savedPreviews.get(message.id) !== task || stopped) return;
        task.status.textContent = error.message;
        if (error.code === 'FILE_PERMISSION_REQUIRED') {
          const authorize = node('a','授权读取文件'); authorize.href = '#';
          authorize.addEventListener('click',event => { event.preventDefault(); void load(true); });
          task.status.append(document.createTextNode(' '),authorize);
        }
      }
    };
    void load();
  }
  // Each file/screen has its own PC and unpredictable session id.
  async function handoffInvitations(tasks) {
    if (!tasks.length) return;
    await navigator.locks.request('bjtuca-chatroom-pending-invitations',async () => {
      const {chatroomPendingInvitations:stored = []} = await chrome.storage.local.get('chatroomPendingInvitations');
      const pending = new Map(stored.filter(item => Date.now()-item.createdAt < 120000).map(item => [item.peerId+':'+item.sid,item]));
      for (const s of tasks) if (!s.ended && !s.accepted && !s.accepting) pending.set(s.peerId+':'+s.id,{
        peerId:s.peerId,sid:s.id,messageId:s.messageId,name:s.name,size:s.size,conversationId:s.conversationId,createdAt:s.createdAt
      });
      await chrome.storage.local.set({chatroomPendingInvitations:[...pending.values()].slice(-LIMIT.sessions)});
    });
    for (const s of tasks) if (!s.ended && !s.accepted && !s.accepting) endSession(s,'等待在聊天室中接收');
  }
  async function restoreInvitations() {
    const pending = await navigator.locks.request('bjtuca-chatroom-pending-invitations',async () => {
      const {chatroomPendingInvitations:items = []} = await chrome.storage.local.get('chatroomPendingInvitations');
      if (items.length) await chrome.storage.local.set({chatroomPendingInvitations:[]});
      return items;
    });
    for (const item of pending.slice(-LIMIT.sessions)) {
      if (!/^[a-f0-9]{64}$/.test(item.peerId) || typeof item.sid !== 'string' || item.sid.length > 100 ||
          typeof item.messageId !== 'string' || item.messageId.length > 100 || !Number.isSafeInteger(item.size) || item.size < 0 ||
          !Number.isFinite(item.createdAt) || Date.now()-item.createdAt > 120000 || !permitted(item.peerId)) continue;
      const conversationId = item.conversationId === 'public' || state.rooms.some(room => room.id === item.conversationId && room.members.includes(item.peerId))
        ? item.conversationId : `peer:${item.peerId}`;
      const s = makeSession(item.sid,item.peerId,'file',false,{messageId:item.messageId,name:safeName(item.name),size:item.size,conversationId,createdAt:item.createdAt});
      touch(s,Math.max(1,120000-(Date.now()-item.createdAt))); showInvitation(s);
    }
  }
  function signal(s, kind, extra = {}) { return action('signal', { peerId: s.peerId, payload: { protocol: PROTOCOL, sid: s.id, kind, ...extra } }); }
  function touch(s, timeout = 120000) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => endSession(s, '等待超时，连接已释放', true), timeout);
  }
  function makeSession(id, peerId, type, outgoing, meta = {}) {
    if (sessions.has(id)) return sessions.get(id);
    if (sessions.size >= LIMIT.sessions) throw new Error('同时最多 8 个文件 / 屏幕会话，请先结束部分会话。');
    const s = { id, peerId, type, outgoing, status: 'invited', done: 0, chunks: [], candidates: [], chain: Promise.resolve(),
      messageId: id, createdAt: Date.now(), conversationId: outgoing ? selected : `peer:${peerId}`, senderId: outgoing ? state.self.id : peerId, ...meta };
    sessions.set(id, s); touch(s); return s;
  }
  function createMediaMessage(s) {
    if (s.message) return;
    const id = `${s.senderId}:${s.messageId}`;
    let message = mediaMessages.get(id);
    if (!message) {
      message = {id, senderId: s.senderId, createdAt: s.createdAt, conversationId: s.conversationId, type: s.type, sessions: new Map(), plannedCount: s.recipientsCount || 1};
      message.card = node('article', undefined, `message media-message${s.outgoing ? ' mine' : ''}`);
      message.card.append(messageHeader(s.senderId, s.createdAt));
      mediaMessages.set(id, message);
      message.mediaReady = mutate('media-message', {conversationId:s.conversationId,senderId:s.senderId,messageId:s.messageId,
        text:s.type === 'file' ? `[文件] ${s.name}` : '[屏幕共享]'}).catch(report);
      if (s.outgoing && s.type === 'file' && s.handle) {
        message.savedPromise = message.mediaReady.then(async () => {
          const ref = await globalThis.BjtuChatroomSettings.saveSentHandle(id, s.handle);
          await mutate('media-file-saved', {id, file:{name:s.name, size:s.size}, fileHandleRef:ref});
          message.file = {name:s.name, size:s.size}; message.fileHandleRef = ref;
        }).catch(report);
      }
    }
    if (message.type !== s.type || message.conversationId !== s.conversationId) throw new Error('传输消息不匹配。');
    s.message = message; s.card = message.card; message.sessions.set(s.id, s);
    renderMessages();
  }
  function styledBytes(value, suffix = '') {
    const span = node('span', bytes(value) + suffix, 'file-size-emphasis');
    span.dataset.fileSizeBytes = String(value); globalThis.BjtuFileSizeEmphasis?.applyBytes(span, value); return span;
  }
  function updateTransferSummary(message) {
    if (!message.progress) return;
    const items = [...message.sessions.values()];
    const total = items.reduce((n, s) => n + s.size, 0), done = items.reduce((n, s) => n + s.done, 0);
    const completed = items.filter(s => s.completed).length;
    const settled = items.every(s => s.completed || s.ended);
    message.progress.max = total || 1; message.progress.value = total ? done : completed === items.length ? 1 : 0;
    message.cancel.hidden = settled;
    if (message.conversationId.startsWith('peer:')) return;
    const parts = [document.createTextNode(`${settled ? (completed === items.length ? '传输完成' : '传输已结束') : '传输中'} · ${items.length} 个接收任务 · `),
      styledBytes(done), document.createTextNode(' / '), styledBytes(total), document.createTextNode(` · ${total ? Math.floor(done / total * 100) : completed === items.length ? 100 : 0}%`)];
    if (!settled) {
      const active = items.filter(s => !s.completed && !s.ended), rate = active.reduce((n, s) => n + (s.rate || 0), 0);
      const remaining = active.reduce((n, s) => n + s.size - s.done, 0), seconds = rate > 0 ? Math.ceil(remaining / rate) : null;
      parts.push(document.createTextNode(' · '), styledBytes(rate, '/s'), document.createTextNode(seconds === null ? ' · 剩余时间估算中…' : ` · 剩余 ${Math.floor(seconds / 60)}分${seconds % 60}秒`));
    }
    message.summary.replaceChildren(...parts);
    message.detailsSummary.textContent = `传输详情（${completed}/${items.length} 已完成）`;
    message.cancel.hidden = settled;
  }
  function renderTransfer(s) {
    createMediaMessage(s);
    const message = s.message;
    if (!message.progress) {
      const heading = node('div', s.name, 'transfer-heading');
      const size = node('span', bytes(s.size), 'file-size-emphasis');
      size.dataset.fileSizeBytes = String(s.size); globalThis.BjtuFileSizeEmphasis?.applyBytes(size, s.size);
      heading.append(document.createTextNode(' · '), size);
      message.progress = node('progress'); message.progress.className = 'transfer-total-progress';
      message.summary = node('p', undefined, 'muted');
      if (!message.conversationId.startsWith('peer:')) {
        message.details = node('details', undefined, 'transfer-details');
        message.detailsSummary = node('summary', '传输详情'); message.details.append(message.detailsSummary);
      }
      message.cancel = button('取消传输', () => { for (const task of [...message.sessions.values()]) endSession(task, '已取消', true); });
      message.actions = node('div',undefined,'actions transfer-actions'); message.actions.append(message.cancel);
      message.card.append(heading, message.progress, message.summary, message.actions);
      if (message.details) message.card.append(message.details);
    }
    if (!s.progress) {
      s.controls?.remove();
      if (!message.details) {
        s.progress = message.progress; s.info = message.summary;
        s.controls = message.actions;
      } else {
        const transfer = node('div', undefined, 'transfer');
        s.heading = node('strong'); s.sizeEl = node('span', undefined, 'file-size-emphasis');
        s.progress = node('progress'); s.progress.max = s.size || 1; s.progress.value = 0;
        s.info = node('p', undefined, 'muted'); s.controls = node('div', undefined, 'actions');
        s.cancelButton = button('取消', () => endSession(s, '已取消', true));
        s.controls.append(s.cancelButton); transfer.append(s.heading, document.createTextNode(' · '), s.sizeEl, s.progress, s.info, s.controls);
        message.details.append(transfer);
      }
    }
    if (s.heading) s.heading.textContent = `${s.outgoing ? '发送给' : '来自'} ${nameOf(s.peerId)} · ${s.name}`;
    if (s.sizeEl) {
      s.sizeEl.textContent = bytes(s.size); s.sizeEl.dataset.fileSizeBytes = String(s.size);
      globalThis.BjtuFileSizeEmphasis?.applyBytes(s.sizeEl, s.size);
    }
    updateTransfer(s);
    updateTransferSummary(message);
  }
  function updateTransfer(s, text) {
    if (!s.progress) return;
    const now = performance.now();
    if (!text && !s.ended && !s.completed && s.done < s.size && now - (s.lastRenderAt || 0) < 100) return;
    s.lastRenderAt = now; s.progress.value = s.done;
    if (s.startedAt && now - (s.rateAt || s.startedAt) >= 300) {
      s.rate = Math.max(0, (s.done - (s.rateBytes || 0)) * 1000 / (now - (s.rateAt || s.startedAt)));
      s.rateAt = now; s.rateBytes = s.done;
    }
    const parts = [document.createTextNode(`${text || (s.status === 'invited' ? '等待对方确认' : s.status)} · `), styledBytes(s.done), document.createTextNode(' / '), styledBytes(s.size)];
    if (s.size) parts.push(document.createTextNode(` · ${Math.floor(s.done / s.size * 100)}%`));
    if (s.startedAt && !s.completed && !s.ended && s.done < s.size) {
      parts.push(document.createTextNode(' · '), styledBytes(s.rate || 0, '/s'));
      const seconds = s.rate > 0 ? Math.ceil((s.size - s.done) / s.rate) : null;
      parts.push(document.createTextNode(seconds === null ? ' · 剩余时间估算中…' : ` · 剩余 ${Math.floor(seconds / 60)}分${seconds % 60}秒`));
    }
    s.info.replaceChildren(...parts);
    updateTransferSummary(s.message);
  }
  function showInvitation(s) {
    const card = node('article', undefined, 'request'), controls = node('div', undefined, 'actions');
    card.append(node('p', s.type === 'file' ? `${nameOf(s.peerId)} 希望发送文件「${s.name}」(${bytes(s.size)})` : `${nameOf(s.peerId)} 邀请你观看屏幕`));
    card.append(node('p', s.type === 'file' ? '同意后才传输。优先流式保存；不支持时内存接收总额上限 128 MiB，保存前不关闭页面。文件名不代表可信内容，请谨慎打开。' : '仅观看，不授予远程控制权限。对方可能不是好友，请先核对身份。', 'muted'));
    const accept = button(s.type === 'file' ? '选择保存位置并接收' : '同意观看', async () => {
      accept.disabled = true;
      try { await acceptInvitation(s); } catch (error) { report(error); if (!s.ended) endSession(s, '接收未开始', true); }
    });
    controls.append(accept, button('拒绝', () => endSession(s, '已拒绝', true)));
    card.append(controls); s.inviteCard = card;
    createMediaMessage(s); s.card.append(card);
    s.controls = node('div', undefined, 'actions'); s.card.append(s.controls);
  }
  async function acceptInvitation(s, automatic = false) {
    if (s.ended || s.accepted || s.accepting) return;
    s.accepting = true;
    // showSaveFilePicker is reached from this button's user activation, before
    // signalling/network awaits. Picker cancellation does not accept the file.
    if (s.type === 'file') {
      if (automatic) {
        try {
          Object.assign(s, await globalThis.BjtuChatroomSettings.createDownload(s.name));
          s.autoSaved = true;
        } catch(error) {
          s.accepting = false;
          if (background) {
            void backgroundMode.notifyInvitation({peerId:s.peerId,media:s.type,name:s.name,reason:error.message,sid:s.id}).catch(report);
            endSession(s,'后台无法自动保存，请打开聊天室接收',true); return;
          }
          if (!s.ended) { showInvitation(s); report(error); }
          return;
        }
        if (s.ended) { await discardPartialDownload(s); return; }
      } else if (typeof window.showSaveFilePicker === 'function') {
        let handle;
        try { handle = await window.showSaveFilePicker({ suggestedName: s.name }); }
        catch (error) {
          if (error.name === 'AbortError') throw error;
          throw new Error('无法打开流式保存对话框；未接收文件。可在支持文件系统访问的窗口重试。');
        }
        if (s.ended) return;
        const writer = await handle.createWritable();
        if (s.ended) { await writer.abort().catch(() => {}); return; }
        s.writer = writer; s.handle = handle;
      } else {
        if (s.size > LIMIT.memory || memoryReserved + s.size > LIMIT.memory) throw new Error('此浏览器只能内存接收，所有未保存文件合计不能超过 128 MiB。请先保存 / 释放文件或使用支持流式保存的窗口。');
        s.reserved = s.size; memoryReserved += s.reserved;
        toast('正在使用内存接收（合计上限 128 MiB）；完成后请点击保存。', true);
      }
      renderTransfer(s);
    }
    s.accepted = true; s.status = '等待直连'; s.inviteCard?.remove();
    if (s.type === 'screen') renderScreenMessage(s);
    createPC(s); await signal(s, 'accept'); touch(s);
  }
  async function pastedFileEntry(file) {
    if (!file.type.startsWith('text/markdown') && !file.type.startsWith('text/plain')) return {file, handle: null};
    try {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      const extension = file.type.startsWith('text/markdown') ? 'md' : 'txt';
      const name = `粘贴内容-${stamp}-${crypto.randomUUID().slice(0, 6)}.${extension}`;
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle('chatroom-outbox', {create: true});
      const handle = await directory.getFileHandle(name, {create: true});
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      return {file: await handle.getFile(), handle};
    } catch {
      return {file, handle: null};
    }
  }
  async function offerPastedContent() {
    const {files} = await globalThis.BjtuChatroomClipboard.read();
    if (!files.length) throw new Error('剪贴板中没有可发送的文件或文本。');
    await offerFiles(await Promise.all(files.map(pastedFileEntry)));
  }
  async function offerFiles(items) {
    const entries = items.map(item => item instanceof File ? {file: item, handle: null} : item);
    const conversationId = selected;
    const targets = recipients();
    if (!targets.length) throw new Error('请选择有在线成员的私聊或群聊。');
    if (entries.length * targets.length + sessions.size > LIMIT.sessions) throw new Error('一次发送最多支持 8 个接收会话，请减少文件或接收成员。');
    for (const {file, handle} of entries) {
      if (!(file instanceof File)) throw new Error('无法读取要发送的文件。');
      const messageId = uuid();
      const tasks = targets.map(peerId => makeSession(uuid(), peerId, 'file', true, {messageId, recipientsCount: targets.length, file, handle, name: safeName(file.name), size: file.size, conversationId}));
      tasks.forEach(renderTransfer);
      void previewFile(tasks[0], file).catch(report);
      for (const s of tasks) {
        try { await signal(s, 'invite', { media: 'file', name: s.name, size: s.size, conversationId, messageId }); }
        catch (error) { endSession(s, '邀请发送失败'); report(error); }
      }
    }
  }
  function createPC(s) {
    if (s.pc || s.ended) return s.pc;
    const pc = new RTCPeerConnection({ iceServers: [] }); s.pc = pc;
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !s.ended) signal(s, 'ice', { candidate: candidate.toJSON() }).catch(() => endSession(s, '信令发送失败'));
    };
    pc.onconnectionstatechange = () => {
      if (s.ended) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') endSession(s, s.completed ? (s.completionText || '对方已完整接收') : '直连失败或已关闭', !s.completed);
      else if (pc.connectionState === 'disconnected') touch(s, 15000);
      else if (pc.connectionState === 'connected') {
        if (s.type === 'screen') clearTimeout(s.timer); else touch(s);
      }
    };
    pc.ondatachannel = ({ channel }) => {
      if (s.type !== 'file' || s.outgoing || !s.accepted || s.channel || channel.label !== 'bjtu-file') { channel.close(); return; }
      bindChannel(s, channel);
    };
    pc.ontrack = ({ track, streams }) => {
      if (s.type !== 'screen' || s.outgoing || !s.accepted) { track.stop(); return; }
      const stream = streams[0] || s.remoteStream || new MediaStream();
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
      s.remoteStream = stream;
      showScreen(s, stream);
      track.onended = () => endSession(s, '共享已结束');
    };
    return pc;
  }
  async function startOffer(s) {
    const pc = createPC(s);
    if (s.type === 'file') bindChannel(s, pc.createDataChannel('bjtu-file', { ordered: true }));
    else {
      if (!capture || !capture.getVideoTracks().some((t) => t.readyState === 'live')) throw new Error('屏幕共享已经停止。');
      for (const track of capture.getTracks()) pc.addTrack(track, capture);
    }
    await pc.setLocalDescription(await pc.createOffer());
    if (!s.ended) await signal(s, 'offer', { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
  }
  async function handleSignal(peerId, payload) {
    if (stopped || !permitted(peerId) || !payload || payload.protocol !== PROTOCOL || typeof payload.sid !== 'string' || payload.sid.length > 80) return;
    const { sid, kind } = payload;
    let s = sessions.get(sid);
    if (s && s.peerId !== peerId) return;
    if (kind === 'invite') {
      if (s || closedSessions.has(sid) || !['file', 'screen'].includes(payload.media) || sessions.size >= LIMIT.sessions) return;
      if (typeof payload.messageId !== 'string' || !payload.messageId || payload.messageId.length > 80) return;
      if (mediaMessages.has(`${peerId}:${payload.messageId}`)) return;
      if (payload.media === 'file' && (!Number.isSafeInteger(payload.size) || payload.size < 0)) return;
      const conversationId = payload.conversationId === 'public' ? 'public'
        : state.rooms.some(room => room.id === payload.conversationId && room.members?.includes(peerId)) ? payload.conversationId : `peer:${peerId}`;
      s = makeSession(sid, peerId, payload.media, false, { messageId: payload.messageId, name: safeName(payload.name), size: payload.size || 0, conversationId });
      try {
        if (background) {
          if (globalThis.BjtuChatroomEngineLease?.draining) { endSession(s,'正在切换至前台，请重新发送',true); return; }
          if (s.type !== 'file' || !await backgroundMode.canReceiveFile(s.size)) {
            if (s.type === 'file') {
              s.waitingDecision = true; showInvitation(s);
              void backgroundMode.notifyInvitation({peerId,media:s.type,name:s.name,size:s.size,conversationId,sid,
                pending:true,reason:'文件超过自动接收限制，或未满足后台自动保存条件'}).catch(report);
            } else {
              endSession(s,'后台不接受屏幕共享，请打开聊天室处理',true);
              void backgroundMode.notifyInvitation({peerId,media:s.type,name:s.name,reason:'请打开聊天室观看',sid}).catch(report);
            }
            return;
          }
          await acceptInvitation(s,true); return;
        }
        if (s.type === 'screen') {
          await acceptInvitation(s);
        } else {
          const settings = await chrome.storage.local.get(globalThis.BjtuChatroomSettings.defaults);
          if (s.ended) return;
          if (settings.chatroomAutoSaveEnabled !== false && (settings.chatroomAutoSaveMaxBytes === null || s.size < settings.chatroomAutoSaveMaxBytes))
            await acceptInvitation(s, true);
          else showInvitation(s);
        }
      } catch(error) { endSession(s, error.message || '接收未开始', true); throw error; }
      return;
    }
    if (!s || s.ended) return;
    if (kind === 'cancel' || kind === 'reject') { endSession(s, '对方已取消 / 拒绝'); return; }
    try {
      if (kind === 'accept' && s.outgoing && !s.accepted) {
        s.accepted = true; s.status = '正在直连'; updateTransfer(s); await startOffer(s); touch(s);
      } else if (kind === 'offer' && !s.outgoing && s.accepted && !s.pc.remoteDescription) {
        if (payload.description?.type !== 'offer' || typeof payload.description.sdp !== 'string' || payload.description.sdp.length > 262144) throw new Error('无效的直连邀请。');
        await s.pc.setRemoteDescription(payload.description);
        await drainCandidates(s);
        await s.pc.setLocalDescription(await s.pc.createAnswer());
        await signal(s, 'answer', { description: { type: s.pc.localDescription.type, sdp: s.pc.localDescription.sdp } });
      } else if (kind === 'answer' && s.outgoing && s.accepted && s.pc && !s.pc.remoteDescription) {
        if (payload.description?.type !== 'answer' || typeof payload.description.sdp !== 'string' || payload.description.sdp.length > 262144) throw new Error('无效的直连应答。');
        await s.pc.setRemoteDescription(payload.description); await drainCandidates(s);
      } else if (kind === 'ice' && s.accepted && payload.candidate) {
        if (JSON.stringify(payload.candidate).length > 8192) return;
        if (s.pc?.remoteDescription) await s.pc.addIceCandidate(payload.candidate);
        else if (s.candidates.length < 64) s.candidates.push(payload.candidate);
      }
    } catch (error) { endSession(s, '直连协商失败', true); throw error; }
  }
  async function drainCandidates(s) {
    for (const candidate of s.candidates.splice(0)) { if (s.ended) break; await s.pc.addIceCandidate(candidate); }
  }

  // Receiver grants one bounded window at a time, after writes settle. This
  // supplements SCTP/backpressure so a slow disk cannot accumulate a file-sized
  // queue of pending write promises. A conforming sender never has >256 KiB
  // unacknowledged; oversized/malicious windows are closed immediately.
  function bindChannel(s, channel) {
    s.channel = channel; channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 64 * 1024;
    channel.onopen = () => {
      touch(s); s.status = '传输中'; s.startedAt = performance.now(); updateTransfer(s);
      if (!s.outgoing) { s.windowEnd = Math.min(s.size, 256 * 1024); channel.send(JSON.stringify({ type: 'credit', end: s.windowEnd })); }
      else sendFile(s).catch((error) => { if (!s.ended) { report(error); endSession(s, '发送失败', true); } });
    };
    channel.onmessage = ({ data }) => {
      if (s.ended) return;
      if (typeof data === 'string') {
        if (data.length > 1024) { endSession(s, '无效传输控制信息', true); return; }
        let control; try { control = JSON.parse(data); } catch { endSession(s, '无效传输控制信息', true); return; }
        if (s.outgoing) {
          if (control.type === 'credit' && Number.isSafeInteger(control.end) && control.end >= (s.credit || 0) && control.end <= s.size && control.end <= s.done + 256 * 1024) { s.credit = control.end; s.wake?.(); }
          else if (control.type === 'complete' && s.done === s.size && s.sentEnd) {
            channel.send(JSON.stringify({ type: 'complete-ack' }));
            s.completed = true; s.status = '对方已完整接收'; updateTransfer(s);
            clearTimeout(s.timer); s.timer = setTimeout(() => endSession(s, s.status), 1000);
          }
        } else if (control.type === 'complete-ack' && s.completed) {
          endSession(s, s.completionText);
        } else if (control.type === 'end' && !s.gotEnd) {
          s.gotEnd = true;
          s.chain = s.chain.then(() => finishReceive(s)).catch((error) => { report(error); endSession(s, '保存失败', true); });
        }
        return;
      }
      if (s.outgoing || !(data instanceof ArrayBuffer) || data.byteLength > LIMIT.chunk || data.byteLength === 0 || s.gotEnd || (s.queued || 0) + s.done + data.byteLength > s.windowEnd) {
        endSession(s, '接收到超出约定的文件数据', true); return;
      }
      s.queued = (s.queued || 0) + data.byteLength;
      s.chain = s.chain.then(async () => {
        if (s.ended) return;
        if (s.writer) await s.writer.write(data); else s.chunks.push(data);
        if (s.ended) return;
        s.done += data.byteLength; s.queued -= data.byteLength; touch(s); updateTransfer(s);
        if (s.done === s.windowEnd && s.done < s.size) {
          s.windowEnd = Math.min(s.size, s.done + 256 * 1024);
          channel.send(JSON.stringify({ type: 'credit', end: s.windowEnd }));
        }
      }).catch((error) => { report(error); endSession(s, '接收或写入失败', true); });
    };
    channel.onerror = () => endSession(s, s.completed ? (s.completionText || '对方已完整接收') : '文件通道错误', !s.completed);
    channel.onclose = () => { if (!s.ended) endSession(s, s.completed ? (s.completionText || '对方已完整接收') : '文件通道已关闭'); };
  }
  function waitUntil(s, predicate) {
    if (s.ended) return Promise.reject(new DOMException('已取消', 'AbortError'));
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const channel = s.channel;
      const cleanup = () => { channel.removeEventListener('bufferedamountlow', check); channel.removeEventListener('close', check); if (s.wake === check) s.wake = null; if (s.rejectWait === fail) s.rejectWait = null; };
      const fail = () => { cleanup(); reject(new DOMException('传输已取消', 'AbortError')); };
      const check = () => {
        if (s.ended || channel.readyState !== 'open') { fail(); return; }
        if (predicate()) { cleanup(); resolve(); }
      };
      s.wake = check; s.rejectWait = fail;
      channel.addEventListener('bufferedamountlow', check); channel.addEventListener('close', check); check();
    });
  }
  async function sendFile(s) {
    const channel = s.channel;
    while (!s.ended && s.done < s.size) {
      const end = Math.min(s.done + LIMIT.chunk, s.size);
      await waitUntil(s, () => channel.bufferedAmount <= 128 * 1024 && (s.credit || 0) >= end);
      const chunk = await s.file.slice(s.done, end).arrayBuffer();
      if (s.ended) return;
      channel.send(chunk); s.done = end; touch(s); updateTransfer(s);
    }
    if (s.ended) return;
    await waitUntil(s, () => channel.bufferedAmount <= channel.bufferedAmountLowThreshold);
    s.sentEnd = true; channel.send(JSON.stringify({ type: 'end' }));
    s.status = '等待对方写入确认'; updateTransfer(s); touch(s);
  }
  async function finishReceive(s) {
    if (s.ended) return;
    if (s.done !== s.size || s.queued) throw new Error('文件不完整，已取消保存。');
    let file;
    if (s.writer) {
      await s.writer.close(); s.writer = null; s.saved = true; if (s.ended) return;
      // A closed writer is the durability boundary. Never store file bytes in
      // extension storage; only the local IndexedDB handle and small metadata.
      let ref;
      try {
        const downloadPath = s.autoSaved ? String(s.savedPath || '') : '';
        ref = await globalThis.BjtuChatroomSettings.saveReceivedFile(s.message.id, s.handle, { downloadPath });
        const metadata = {id:s.message.id, file:{name:s.name, size:s.size}, fileHandleRef:ref, downloadPath};
        await mutate('media-file-saved', metadata);
        Object.assign(s.message, metadata);
      } catch (error) {
        if (ref) await globalThis.BjtuChatroomSettings.removeReceivedFile(ref).catch(report);
        report(new Error('文件已保存，但保存历史引用失败：' + error.message));
      }
      file = await s.handle.getFile().catch(error => { report(error); return null; });
    }
    else {
      const blob = new Blob(s.chunks, { type: previewType(s.name) || 'application/octet-stream' });
      file = blob;
      s.chunks.length = 0; s.url = URL.createObjectURL(blob);
      const save = button('保存文件', () => {
        const link = node('a'); link.href = s.url; link.download = s.name; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
        save.textContent = '再次保存';
      });
      const release = button('释放文件', () => {
        releaseResources(s); save.remove(); release.remove();
        updateTransfer(s, '文件已从内存释放');
      });
      s.controls.append(save, release);
    }
    s.completed = true;
    s.completionText = s.url ? '接收完成，请点击保存（关闭页面将丢失）'
      : s.savedPath ? `已自动保存到 ${s.savedPath}` : '已流式保存到所选位置';
    s.status = s.completionText; updateTransfer(s);
    void previewFile(s, file).catch(report);
    try { s.channel.send(JSON.stringify({ type: 'complete' })); } catch {}
    // Do not close immediately after send(): the completion frame may still be
    // queued in SCTP. Wait for its acknowledgement, with a bounded grace period.
    clearTimeout(s.timer); s.timer = setTimeout(() => endSession(s, s.completionText), 5000);
  }
  const PREVIEW_TYPES = {
    png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',avif:'image/avif',svg:'image/svg+xml',
    mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',m4a:'audio/mp4',flac:'audio/flac',
    mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',pdf:'application/pdf'
  };
  const TEXT_EXTENSIONS = new Set('txt md csv log json js mjs cjs ts tsx jsx css html htm xml svg yml yaml toml ini conf py ps1 sh bat c cpp h java rs go sql'.split(' '));
  function previewType(name) { return PREVIEW_TYPES[String(name).split('.').pop().toLowerCase()] || ''; }
  function appendFileActions(s, preview) {
    preview.append(s.openButton);
    if (s.outgoing || !String(s.downloadPath || s.message?.downloadPath || '').startsWith('downloads/')) return;
    s.deleteButton = button('删除', () => { void deleteReceivedFile(s); }, 'secondary file-delete');
    preview.append(s.deleteButton);
  }
  async function deleteReceivedFile(s) {
    if (!globalThis.confirm(`删除已保存的文件「${s.name}」？此操作无法撤销。`)) return;
    s.deleteButton.disabled = true;
    try {
      await globalThis.BjtuChatroomSettings.deleteReceivedFile(s.message.fileHandleRef);
      await mutate('media-file-deleted', {id:s.message.id});
      delete s.message.file;
      delete s.message.fileHandleRef;
      delete s.message.downloadPath;
      s.downloadPath = '';
      s.savedPath = '';
      s.autoSaved = false;
      s.saved = false;
      s.completionText = '文件已删除';
      releasePreview(s);
      updateTransfer(s, '文件已删除');
    } catch (error) {
      s.deleteButton.disabled = false;
      report(error);
    }
  }
  async function previewFile(s, file) {
    if (background) return;
    if (!file || !s.card || s.message.preview || stopped || s.conversationId !== selected) return;
    if (s.outgoing) s.previewSource = file;
    const ext = s.name.split('.').pop().toLowerCase(), type = previewType(s.name);
    const preview = node('div', undefined, 'file-preview'); s.preview = preview; s.message.preview = preview;
    if (type) {
      s.previewURL = URL.createObjectURL(file.slice(0, file.size, type));
      const media = node(type.startsWith('image/') ? 'img' : type.startsWith('audio/') ? 'audio' : type.startsWith('video/') ? 'video' : 'iframe');
      media.src = s.previewURL;
      if (media instanceof HTMLImageElement) { media.alt = s.name; media.loading = 'lazy'; }
      if (media instanceof HTMLMediaElement) { media.controls = true; media.preload = 'metadata'; }
      // PDF Blob has a fixed application/pdf MIME type. Chromium's native PDF
      // viewer cannot run in a sandboxed iframe (plugins are disabled there).
      if (media instanceof HTMLIFrameElement) { media.title = s.name; media.loading = 'lazy'; }
      preview.append(media);
      s.openButton = button('打开', () => {
        if (s.previewURL) globalThis.open(s.previewURL, '_blank', 'noopener,noreferrer');
      }, 'secondary file-open');
      appendFileActions(s, preview);
    } else if (TEXT_EXTENSIONS.has(ext)) {
      // Plain text is never interpreted as HTML or executable code.
      const max = 256 * 1024, text = await file.slice(0, max).text();
      if (!previewCurrent(s, preview)) return;
      if (ext === 'html' || ext === 'htm') {
        const frame = node('iframe', undefined, 'file-html-preview');
        frame.title = s.name;
        frame.setAttribute('sandbox', '');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.srcdoc = text;
        preview.append(frame);
      } else if (ext === 'md') {
        const content = node('div', undefined, 'message-text bjtu-markdown');
        content.innerHTML = markdown.parse(text); preview.append(content);
      } else preview.append(node('pre', text));
      if (file.size > max) preview.append(node('p', '仅预览前 256 KB，完整内容已保存在文件中。', 'muted'));
      s.previewURL = URL.createObjectURL(file);
      s.openButton = button('打开', () => {
        if (s.previewURL) globalThis.open(s.previewURL, '_blank', 'noopener,noreferrer');
      }, 'secondary file-open');
      appendFileActions(s, preview);
    } else {
      s.previewURL = URL.createObjectURL(file.slice(0, file.size, 'application/octet-stream'));
      s.openButton = button('打开', () => {
        const link = node('a'); link.href = s.previewURL; link.download = s.name; link.hidden = true;
        document.body.append(link); link.click(); link.remove();
      }, 'secondary file-open');
      appendFileActions(s, preview);
    }
    if (!previewCurrent(s, preview)) { if (s.preview === preview) releasePreview(s); return; }
    const nearBottom = $('messages').scrollHeight - $('messages').clientHeight - $('messages').scrollTop < 64;
    s.card.append(preview);
    const markdownPreview = preview.querySelector('.bjtu-markdown');
    if (markdownPreview) requestAnimationFrame(() => setupMessageCollapse(markdownPreview));
    if (pinToBottom) $('messages').scrollTop = $('messages').scrollHeight;
    else if (nearBottom) $('messages').scrollTop = $('messages').scrollHeight;
  }
  function previewCurrent(s, preview) {
    return !stopped && s.preview === preview && s.conversationId === selected &&
      (savedPreviews.get(s.message.id) === s || mediaMessages.get(s.message.id) === s.message);
  }
  async function discardPartialDownload(s) {
    if (s.writer) { const writer = s.writer; s.writer = null; await writer.abort().catch(() => {}); }
    if (s.autoSaved && !s.completed && !s.saved && s.downloads && s.filename) {
      await s.downloads.removeEntry(s.filename).catch(() => {});
    }
  }
  function releasePreview(s) {
    s.openButton?.remove(); s.openButton = null;
    s.deleteButton?.remove(); s.deleteButton = null;
    if (s.previewURL) { URL.revokeObjectURL(s.previewURL); s.previewURL = null; }
    if (s.message?.preview === s.preview) s.message.preview = null;
    s.preview?.remove(); s.preview = null;
  }
  function releaseResources(s) {
    s.previewSource = null;
    if (s.url) { URL.revokeObjectURL(s.url); s.url = null; }
    releasePreview(s);
    if (s.reserved) { memoryReserved -= s.reserved; s.reserved = 0; }
    s.chunks.length = 0;
  }
  function clearLocalMedia(conversationId) {
    for (const [id, task] of savedPreviews) if (task.conversationId === conversationId) { releaseResources(task); savedPreviews.delete(id); }
    for (const message of [...mediaMessages.values()]) {
      if (message.conversationId !== conversationId) continue;
      removeLocalMedia(message);
    }
  }
  function removeLocalMedia(message) {
    mediaMessages.delete(message.id);
    for (const task of message.sessions.values()) { endSession(task, '会话记录已清空', true); releaseResources(task); }
    message.card.remove();
    const index = transferHistory.indexOf(message); if (index >= 0) transferHistory.splice(index,1);
  }
  function archiveMediaMessage(message) {
    if (!message || message.archived || message.sessions.size < message.plannedCount ||
        [...message.sessions.values()].some(task => !task.ended)) return;
    message.archived = true; transferHistory.push(message);
    if (message.screenInfo) {
      message.screenInfo.textContent = '屏幕共享已结束'; message.screenStop.disabled = true;
    }
    while (transferHistory.length > LIMIT.history) {
      const old = transferHistory.shift();
      for (const task of old.sessions.values()) releaseResources(task);
      old.card.remove(); mediaMessages.delete(old.id);
    }
  }
  function endSession(s, reason = '已结束', notify = false) {
    if (!s || s.ended) return;
    if (notify && online) signal(s, 'cancel').catch(() => {});
    s.ended = true; s.status = reason; clearTimeout(s.timer);
    if (s.waitingDecision) backgroundMode?.closeInvitation(s.peerId,s.id);
    closedSessions.set(s.id, Date.now());
    while (closedSessions.size > 128) closedSessions.delete(closedSessions.keys().next().value);
    s.rejectWait?.(); s.wake = null; s.file = null; s.candidates.length = 0;
    s.inviteCard?.remove();
    if (s.video && (!s.outgoing || ![...s.message.sessions.values()].some(task => task !== s && !task.ended))) s.video.srcObject = null;
    s.remoteStream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    if (s.channel) { s.channel.onopen = s.channel.onmessage = s.channel.onclose = s.channel.onerror = null; s.channel.close(); }
    if (s.pc) { s.pc.onicecandidate = s.pc.onconnectionstatechange = s.pc.ontrack = s.pc.ondatachannel = null; s.pc.close(); }
    s.channel = s.pc = s.remoteStream = null;
    void discardPartialDownload(s);
    if (!s.completed) releaseResources(s);
    sessions.delete(s.id); updateTransfer(s, reason);
    if (s.card) {
      s.cancelButton?.remove();
      if (s.type === 'file' && !s.progress) s.card.append(node('p', `文件「${s.name}」 · ${reason}`, 'muted'));
      archiveMediaMessage(s.message);
    }
    if (s.type === 'screen' && s.outgoing && capture && !sharingPending && ![...sessions.values()].some((item) => item.type === 'screen' && item.outgoing)) stopCapture();
    renderMessages();
  }
  function renderScreenMessage(s) {
    createMediaMessage(s);
    const message = s.message;
    if (!message.screenCard) {
      message.screenCard = node('div', undefined, 'screen');
      message.screenInfo = node('p', s.outgoing ? '正在共享屏幕' : '正在连接屏幕…', 'muted');
      message.screenStop = button(s.outgoing ? '停止共享' : '停止观看', () => {
        for (const task of message.sessions.values()) endSession(task, '屏幕共享已停止', true);
      });
      message.screenCard.append(node('strong', s.outgoing ? '共享屏幕' : `${nameOf(s.peerId)} 的屏幕`), message.screenInfo, message.screenStop);
      message.card.append(message.screenCard);
    }
    s.screenCard = message.screenCard; s.screenInfo = message.screenInfo;
  }
  function showScreen(s, stream) {
    renderScreenMessage(s);
    if (!s.message.video) {
      const video = node('video'); video.autoplay = true; video.playsInline = true; video.controls = true;
      video.muted = s.outgoing; s.message.video = video;
      s.screenCard.insertBefore(video, s.screenInfo);
    }
    s.video = s.message.video;
    s.screenInfo.textContent = s.outgoing ? '正在共享你的屏幕' : '正在观看屏幕';
    s.video.srcObject = stream;
    s.video.play().catch(() => toast('请点击视频上的播放按钮开始观看。', true));
  }
  async function shareScreen() {
    if (capture || sharingPending) return;
    const conversationId = selected;
    const targets = screenRecipients();
    if (!targets.length) throw new Error(recipients().length
      ? '对方当前仅后台在线，无法共享屏幕。' : '请先选择有在线成员的私聊或群聊。');
    if (sessions.size + targets.length > LIMIT.sessions) throw new Error('屏幕接收成员过多，请先结束部分会话。');
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前浏览器不支持屏幕共享。');
    // Called synchronously by the click handler; never from transport events.
    sharingPending = true; updateConversation();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (stopped || !online || (embedded && !embeddedVisible)) { stream.getTracks().forEach((t) => t.stop()); return; }
      capture = stream; updateConversation();
      for (const track of stream.getTracks()) track.onended = stopCapture;
      const messageId = uuid();
      const tasks = targets.map(peerId => makeSession(uuid(), peerId, 'screen', true, {conversationId, messageId, recipientsCount: targets.length}));
      for (const task of tasks) showScreen(task, stream);
      for (const s of tasks) {
        if (!capture) break;
        try { await signal(s, 'invite', { media: 'screen', conversationId, messageId }); } catch (error) { endSession(s, '共享邀请失败'); report(error); }
      }
    } finally {
      sharingPending = false; updateConversation();
      if (capture && ![...sessions.values()].some((s) => s.type === 'screen' && s.outgoing)) stopCapture();
    }
  }
  function stopCapture() {
    const stream = capture; capture = null;
    stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    for (const s of [...sessions.values()]) if (s.type === 'screen' && s.outgoing) endSession(s, '屏幕共享已停止', true);
    $('stop-screen').hidden = true; updateConversation();
  }

  listen('conversation-title','change', () => {
    const input = $('conversation-title'), id = input.dataset.conversationId, value = input.value.trim();
    if (!id || value === input.dataset.initialValue) return;
    const pending = {id,value}; pendingTitle = pending;
    void mutate('conversation-remark',{conversationId:id,remark:value}).then(() => refreshState()).catch(report).finally(() => {
      if (pendingTitle === pending) pendingTitle = null;
      updateConversation();
    });
  });
  listen('conversation-title','keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { $('conversation-title').value = $('conversation-title').dataset.initialValue || ''; $('conversation-title').blur(); }
    else if (event.key === 'Enter') { event.preventDefault(); $('conversation-title').blur(); $('message').focus(); }
  });
  listen('block-peer','click', () => {
    const peerId = selected.slice(5), peer = state.peers.find(item => item.id === peerId);
    if (peer) void mutate('block',{peerId,blocked:!peer.blocked}).catch(report);
  });
  listen('delete-friend','click', () => {
    if (!selected.startsWith('peer:')) return;
    const peerId = selected.slice(5), peer = state.peers.find(item => item.id === peerId);
    void mutate(peer?.friend ? 'friend-delete' : 'friend-request', {peerId}).catch(report);
  });
  listen('clear-history','click', () => {
    const conversationId = selected;
    if (conversationId) sidebar.confirmClear(() => mutate('conversation-clear',{conversationId}));
  });
  listen('mute-conversation','change', () => { if (selected) void mutate('conversation-mute',{conversationId:selected,muted:$('mute-conversation').checked}).catch(report); });
  listen('conversation-members-toggle', 'click', () => {
    if (expandedMembers.has(selected)) expandedMembers.delete(selected); else expandedMembers.add(selected);
    $('conversation-members').classList.toggle('expanded', expandedMembers.has(selected)); updateMembersToggle();
  });
  const membersObserver = new ResizeObserver(updateMembersToggle);
  membersObserver.observe($('conversation-members'));
  const editMessageAuthor = event => {
    const header = event.target.closest?.('.message-author-name')?.closest('.message-author');
    if (header) { event.preventDefault(); sidebar.editPerson(header.dataset.senderId); }
  };
  listen('messages', 'click', editMessageAuthor);
  listen('messages', 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') editMessageAuthor(event); });
  async function disconnect() {
    backgroundMode?.pauseReconnect?.();
    await globalThis.BjtuChatroomLink?.close();
    stopCapture(); for (const s of [...sessions.values()]) endSession(s, '连接已断开');
    $('pair-input').value = '';
    $('pair-status').textContent = '已断开。可重新生成邀请或点击扫描。';
    scheduleState();
  }
  listen('message-form', 'submit', async (event) => {
    event.preventDefault(); const input = $('message'), text = input.value, conversationId = selected;
    if (!text.trim() || !online || !selected || sendInFlight) return;
    if (messageBytes() > MESSAGE_FILE_LIMIT) { enforceMessageLimit(); updateSendButton(); return; }
    const snapshot = text;
    sendInFlight = true; updateSendButton();
    clearSharedDraft();
    try {
      await mutate('send-message', { conversationId, text });
      if (selected === conversationId && input.value === snapshot) input.value = '';
      if (drafts.get(conversationId) === snapshot) drafts.delete(conversationId);
    } catch (error) { report(error); } finally { sendInFlight = false; updateSendButton(); updateDraftPreview(); }
  });
  listen('message','input', () => { if (!messageComposing) enforceMessageLimit(); updateDraftPreview(); });
  listen('message','compositionstart', () => { messageComposing = true; });
  listen('message','compositionend', () => { messageComposing = false; enforceMessageLimit(); updateDraftPreview(); });
  listen('draft-preview','change', () => {
    updateDraftPreview(); renderMessages(); void chrome.storage.local.set({chatroomDraftPreviewEnabled:$('draft-preview').checked});
  });
  listen('share-draft','change', () => {
    if ($('share-draft').checked) publishDraft(); else clearSharedDraft();
  });
  $('draft-preview').checked = (await chrome.storage.local.get('chatroomDraftPreviewEnabled')).chatroomDraftPreviewEnabled === true;
  let sendShortcut = 'enter';
  const updateSendShortcut = value => {
    sendShortcut = value === 'ctrl-enter' ? value : 'enter'; $('send-shortcut').value = sendShortcut;
    $('message').placeholder = sendShortcut === 'enter'
      ? '输入消息，Enter 发送，Ctrl+Enter / Shift+Enter 换行；支持 Markdown 语法'
      : '输入消息，Ctrl+Enter 发送，Enter / Shift+Enter 换行；支持 Markdown 语法';
  };
  updateSendShortcut((await chrome.storage.local.get('chatroomSendShortcut')).chatroomSendShortcut);
  listen('send-shortcut','change', () => { updateSendShortcut($('send-shortcut').value); void chrome.storage.local.set({chatroomSendShortcut:sendShortcut}); });
  listen('message', 'keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (!event.shiftKey && (sendShortcut === 'ctrl-enter' ? event.ctrlKey : !event.ctrlKey)) {
      event.preventDefault(); $('message-form').requestSubmit();
    } else if (event.ctrlKey) {
      event.preventDefault(); const input = $('message'); input.setRangeText('\n',input.selectionStart,input.selectionEnd,'end'); input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
  listen('invite-group', 'click', () => sidebar.groupEditor(true));
  listen('leave-group', 'click', () => sidebar.leaveGroup());
  listen('pick-file', 'click', () => {
    if (typeof window.showOpenFilePicker !== 'function') { $('file-picker').click(); return; }
    window.showOpenFilePicker({multiple: true}).then(async handles => {
      const entries = [];
      for (const handle of handles) entries.push({file: await handle.getFile(), handle});
      if (entries.length) await offerFiles(entries);
    }).catch(error => { if (error?.name !== 'AbortError') report(error); });
  });
  listen('file-picker', 'change', () => { const files = Array.from($('file-picker').files || []); $('file-picker').value = ''; if (files.length) offerFiles(files).catch(report); });
  listen('paste-message-file', 'click', () => { offerPastedContent().catch(report); });
  const composer = $('message-form');
  const hasDraggedFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  listen('message-form', 'dragenter', event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault(); composer.classList.add('is-dragover');
  });
  listen('message-form', 'dragover', event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; composer.classList.add('is-dragover');
  });
  listen('message-form', 'dragleave', event => {
    if (event.relatedTarget && composer.contains(event.relatedTarget)) return;
    composer.classList.remove('is-dragover');
  });
  listen('message-form', 'drop', event => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault(); composer.classList.remove('is-dragover');
    if (!online || !recipients().length) { toast('当前没有可发送的对象。'); return; }
    offerFiles(Array.from(event.dataTransfer.files)).catch(report);
  });
  listen('share-screen', 'click', () => { shareScreen().catch(report); });
  listen('stop-screen', 'click', stopCapture);
  if (embedded) window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === 'BJTU_CHATROOM_NAVIGATE') {
      const conversationId = String(event.data.conversationId || '');
      if (conversationId) { embeddedVisible = true; chooseConversation(conversationId, {interactive:true}); }
      return;
    }
    if (event.data?.type !== 'BJTU_CHATROOM_WINDOW_VISIBILITY') return;
    if (event.data.visible === false) { embeddedVisible = false; stopCapture(); clearSharedDraft(); }
    else if (event.data.visible === true) { embeddedVisible = true; scheduleState(); if (online) {void action('scan').catch(report); publishDraft();} void markConversationRead(); }
  }, { signal: uiAbort.signal });
  window.addEventListener('bjtu-chatroom-transport-ready', () => attachTransport().catch(report), { signal: uiAbort.signal });
  window.addEventListener('focus', () => { void markConversationRead(); }, {signal:uiAbort.signal});
  document.addEventListener('visibilitychange', () => { void markConversationRead(); }, {signal:uiAbort.signal});
  window.addEventListener('beforeunload', (event) => {
    if (background) return;
    if (sessions.size || memoryReserved || capture) { event.preventDefault(); event.returnValue = ''; }
  }, { signal: uiAbort.signal });
  window.addEventListener('pagehide', () => {
    clearSharedDraft(); clearInterval(draftHeartbeat); clearTimeout(draftRenderTimer); liveDrafts.clear();
    stopped = true; clearTimeout(stateTimer); uiAbort.abort(); membersObserver.disconnect();
    globalThis.BjtuChatroomLink?.close();
    try { unsubscribe?.(); } catch {}
    unsubscribe = null; stopCapture();
    for (const s of [...sessions.values()]) endSession(s, '页面已关闭');
    for (const message of transferHistory) for (const s of message.sessions.values()) releaseResources(s);
    for (const task of savedPreviews.values()) releaseResources(task);
    savedPreviews.clear();
    pendingSignals.clear(); closedSessions.clear(); drafts.clear(); scrollPositions.clear(); mediaMessages.clear();
    sidebar.destroy();
  }, { once: true });
  sidebar = globalThis.BjtuChatroomSidebar.mount({
    root: $('sidebar-host'),
    getState: () => state,
    getSelected: () => selected,
    mutate: async (name, args) => {
      const result = await mutate(name, args);
      await refreshState();
      return result;
    },
    onSelect: chooseConversation,
    onDisconnect: disconnect, report
  });
  await sidebar.ready;
  renderState(); connectionStatus(false);
  await attachTransport();
  backgroundMode?.setFileDecisionHandler(async ({peerId,sid,accept}) => {
    const s = sessions.get(sid);
    if (!s || s.peerId !== peerId || s.ended || !s.waitingDecision || s.accepting || s.accepted)
      return {ok:false,error:'文件邀请已失效，请让对方重新发送。'};
    if (!accept) { endSession(s,'已拒绝',true); return {ok:true}; }
    if (globalThis.BjtuChatroomEngineLease?.draining) return {ok:false,error:'邀请正在移交前台，请在聊天室内接收。',openChat:true,conversationId:s.conversationId};
    if (!await backgroundMode.canReceiveFile(s.size,true)) {
      await handoffInvitations([s]);
      return {ok:true,openChat:true,conversationId:s.conversationId};
    }
    try { await acceptInvitation(s,true); }
    catch (error) {
      endSession(s,error.message || '接收未开始',true);
      return {ok:false,error:error.message || '接收未开始',openChat:true,conversationId:s.conversationId};
    }
    return s.accepted ? {ok:true} : {ok:false,error:'后台保存失败，请打开聊天室后重新发送。',openChat:true,conversationId:s.conversationId};
  });
  if (!background) await restoreInvitations();
  backgroundMode?.markReady();
  if (embedded) parent.postMessage({type:'BJTU_CHATROOM_WINDOW_READY'},location.origin);
  const requestedConversation = new URLSearchParams(location.search).get('conversation');
  if (requestedConversation) chooseConversation(requestedConversation);
  const consumeNavigation = async navigation => {
    if (background) return;
    const tab = await chrome.tabs.getCurrent();
    if (navigation?.tabId === tab?.id) chooseConversation(navigation.conversationId);
  };
  const onNavigation = (changes,area) => {
    if (area==='local' && changes.chatroomDraftPreviewEnabled) {$('draft-preview').checked = changes.chatroomDraftPreviewEnabled.newValue === true; updateDraftPreview();}
    if (area==='local' && changes.chatroomSendShortcut) updateSendShortcut(changes.chatroomSendShortcut.newValue);
    if (area==='local' && changes.chatroomNavigation) void consumeNavigation(changes.chatroomNavigation.newValue).catch(report);
  };
  chrome.storage.onChanged.addListener(onNavigation);
  window.addEventListener('pagehide', () => chrome.storage.onChanged.removeListener(onNavigation), {once:true});
  if (online) await action('scan').catch(report);
})().catch(error => {
  globalThis.BjtuOptionsMessage?.show(error?.message || '聊天室初始化失败，请刷新重试。', false);
});
