/* Transport contract: globalThis.BjtuChatroomTransport supplies state(),
 * action(name, args), subscribe(event => ...): unsubscribe. State uses the
 * chatroom domain schema; signal events are {type:'signal', peerId, payload}.
 * Transport owns identity and message persistence; BjtuChatroomLink owns RTC,
 * automatic online discovery and offline pairing. No local bridge needed.
 * RTC payload protocol below is independent of the transport implementation.
 */
(async () => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const embedded = new URLSearchParams(location.search).get('embedded') === '1';
  let embeddedVisible = true;
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
  let state = { self: {}, peers: [], rooms: [], messages: [], requests: [], settings: {} };
  let selected = 'public';
  let transport, unsubscribe, stopped = false, online = false, stateTimer, statePromise, stateDirty = false;
  let capture = null, sharingPending = false, memoryReserved = 0;
  const sessions = new Map(), transferHistory = [], drafts = new Map(), scrollPositions = new Map();
  const mediaMessages = new Map();
  const messageNodes = new Map();
  const pendingSignals = new Map(), closedSessions = new Map();
  const uiAbort = new AbortController();
  let lastToast = { text: '', at: 0 }, messageConversation = '';
  const markdown = new marked.Marked({gfm: true, breaks: true, renderer: BjtuMarkdown.createRenderer()});
  BjtuMarkdown.bindCopy($('messages'), {onError: report});

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
    if (id === state.self.id) return state.self.nickname || '我';
    const peer = state.peers.find((p) => p.id === id);
    return peer?.remark || peer?.nickname || peer?.hostname || String(id || '未知用户').slice(0, 80);
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
  function permitted(id) {
    const peer = state.peers.find((p) => p.id === id);
    const sharedGroup = state.rooms.some((room) => room.members?.includes(state.self.id) && room.members.includes(id));
    return !!peer && !peer.blocked && (!state.settings.requireFriend || peer.friend || sharedGroup);
  }
  function connectionStatus(text, ready) {
    online = ready;
    $('send').disabled = !ready;
    sidebar.setReady(ready, text);
    updateConversation();
  }
  async function action(name, args = {}) {
    if (!transport || !online) throw new Error('连接引擎尚未就绪，请稍后重新连接。');
    const result = await transport.action(name, args);
    if (result?.ok === false || result?.error) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || '操作被连接引擎拒绝。');
    return result;
  }
  async function mutate(name, args) {
    const result = await action(name, args);
    scheduleState();
    return result;
  }
  function bounded(items, max) { return Array.isArray(items) ? items.slice(-max) : []; }
  function mergeState(value) {
    if (!value || typeof value !== 'object') return;
    const source = value.state || value;
    for (const key of ['self', 'settings']) if (source[key]) state[key] = { ...state[key], ...source[key] };
    for (const [key, max] of Object.entries({ peers: LIMIT.peers, rooms: LIMIT.rooms, messages: LIMIT.messages, requests: LIMIT.requests })) {
      if (Array.isArray(source[key])) state[key] = bounded(source[key], max);
    }
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
      connectionStatus('本机引擎就绪 · 扫描或离线配对后与对方直连；不使用 STUN / TURN。', true);
    })();
    try { await statePromise; } finally { statePromise = null; if (stateDirty) scheduleState(); }
  }
  async function attachTransport() {
    if (stopped) return;
    const next = globalThis.BjtuChatroomTransport;
    if (!next || typeof next.action !== 'function' || typeof next.state !== 'function' || typeof next.subscribe !== 'function') {
      connectionStatus('连接引擎尚未加载。无需安装本地程序；请等待引擎就绪或点击重新连接。', false);
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
    try { await refreshState(); } catch (error) { connectionStatus('连接暂不可用，请检查配对状态后重试。', false); report(error); }
  }
  function onEvent(event) {
    if (stopped || !event) return;
    if (event.type === 'signal') {
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
      connectionStatus('连接已断开。可重新配对或重试。', false);
      stopCapture();
      for (const s of [...sessions.values()]) endSession(s, '连接已断开');
    } else {
      if (event.state) mergeState(event.state);
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
  }
  function chooseConversation(id) {
    if (id === selected) return;
    drafts.set(selected, $('message').value);
    scrollPositions.set(selected, $('messages').scrollTop);
    while (drafts.size > 100) drafts.delete(drafts.keys().next().value);
    while (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value);
    selected = id;
    $('message').value = drafts.get(id) || '';
    updateConversation(); renderMessages();
    $('message').focus();
  }
  function updateConversation() {
    const room = currentRoom(), peerId = selected.startsWith('peer:') ? selected.slice(5) : null;
    $('conversation-title').textContent = selected === 'public' ? '公共群聊' : peerId ? nameOf(peerId) : room?.name || '群聊已结束';
    $('conversation-detail').textContent = selected === 'public' ? '所有在线用户' : peerId ? '私聊 · 屏幕自动接受，文件按设置接收' : `${room?.members?.length || 0} 位成员`;
    $('invite-group').hidden = $('leave-group').hidden = !room;
    $('pick-file').disabled = !online || !recipients().length;
    $('share-screen').disabled = !online || !recipients().length || !!capture || sharingPending;
  }
  function renderMessages() {
    const container = $('messages'), changed = messageConversation !== selected;
    const nearBottom = container.scrollHeight - container.clientHeight - container.scrollTop < 64;
    const oldTop = container.scrollTop, oldHeight = container.scrollHeight;
    const anchor = [...messageNodes.values()].find((v) => v.el.offsetTop >= container.offsetTop + oldTop);
    const anchorOffset = anchor ? anchor.el.getBoundingClientRect().top : 0;
    if (changed) { container.replaceChildren(); messageNodes.clear(); messageConversation = selected; }
    const items = [...state.messages, ...[...mediaMessages.values()].map(s => ({
      id: s.id, conversationId: s.conversationId, senderId: s.senderId, createdAt: s.createdAt, media: true
    }))].filter((m) => m.conversationId === selected).sort((a,b) => a.createdAt - b.createdAt);
    container.querySelector('.empty')?.remove();
    reconcile(container, messageNodes, items, (m) => m.id, (message) => {
      if (message.media) return mediaMessages.get(message.id).card;
      const el = node('article', undefined, `message${message.senderId === state.self.id ? ' mine' : ''}`);
      const date = new Date(message.createdAt);
      const content = node('div', undefined, 'message-text bjtu-markdown');
      content.innerHTML = markdown.parse(String(message.text || '').slice(0, 8000));
      el.append(node('div', `${nameOf(message.senderId)} · ${Number.isFinite(date.getTime()) ? date.toLocaleString() : ''}`, 'muted'), content);
      return el;
    });
    if (!items.length) container.append(node('p', '还没有消息，打个招呼吧。', 'empty'));
    if (changed) container.scrollTop = scrollPositions.get(selected) ?? container.scrollHeight;
    else if (nearBottom) container.scrollTop = container.scrollHeight;
    else if (anchor?.el.isConnected) container.scrollTop = oldTop + anchor.el.getBoundingClientRect().top - anchorOffset;
    else container.scrollTop = Math.max(0, oldTop + container.scrollHeight - oldHeight);
  }
  // Each file/screen has its own PC and unpredictable session id.
  function signal(s, kind, extra = {}) { return action('signal', { peerId: s.peerId, payload: { protocol: PROTOCOL, sid: s.id, kind, ...extra } }); }
  function touch(s, timeout = 120000) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => endSession(s, '等待超时，连接已释放', true), timeout);
  }
  function makeSession(id, peerId, type, outgoing, meta = {}) {
    if (sessions.has(id)) return sessions.get(id);
    if (sessions.size >= LIMIT.sessions) throw new Error('同时最多 8 个文件 / 屏幕会话，请先结束部分会话。');
    const s = { id, peerId, type, outgoing, status: 'invited', done: 0, chunks: [], candidates: [], chain: Promise.resolve(),
      createdAt: Date.now(), conversationId: outgoing ? selected : `peer:${peerId}`, senderId: outgoing ? state.self.id : peerId, ...meta };
    sessions.set(id, s); touch(s); return s;
  }
  function createMediaMessage(s) {
    if (s.card) return;
    s.card = node('article', undefined, `message media-message${s.outgoing ? ' mine' : ''}`);
    s.card.append(node('div', `${nameOf(s.senderId)} · ${new Date(s.createdAt).toLocaleString()}`, 'muted'));
    mediaMessages.set(s.id, s);
    renderMessages();
  }
  function renderTransfer(s) {
    createMediaMessage(s);
    if (!s.progress) {
      s.controls?.remove();
      const transfer = node('div', undefined, 'transfer');
      s.heading = node('strong'); s.sizeEl = node('span', undefined, 'file-size-emphasis');
      s.progress = node('progress'); s.progress.max = s.size || 1; s.progress.value = 0;
      s.info = node('p', undefined, 'muted'); s.controls = node('div', undefined, 'actions');
      s.cancelButton = button('取消', () => endSession(s, '已取消', true));
      s.controls.append(s.cancelButton); transfer.append(s.heading, document.createTextNode(' · '), s.sizeEl, s.progress, s.info, s.controls);
      s.card.append(transfer);
    }
    s.heading.textContent = `${s.outgoing ? '发送给' : '来自'} ${nameOf(s.peerId)} · ${s.name}`;
    s.sizeEl.textContent = bytes(s.size); s.sizeEl.dataset.fileSizeBytes = String(s.size);
    globalThis.BjtuFileSizeEmphasis?.applyBytes(s.sizeEl, s.size);
    updateTransfer(s);
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
    const styled = (value, suffix = '') => {
      const span = node('span', bytes(value) + suffix, 'file-size-emphasis');
      span.dataset.fileSizeBytes = String(value); globalThis.BjtuFileSizeEmphasis?.applyBytes(span, value); return span;
    };
    const parts = [document.createTextNode(`${text || (s.status === 'invited' ? '等待对方确认' : s.status)} · `), styled(s.done), document.createTextNode(' / '), styled(s.size)];
    if (s.size) parts.push(document.createTextNode(` · ${Math.floor(s.done / s.size * 100)}%`));
    if (s.startedAt && !s.completed && !s.ended && s.done < s.size) {
      parts.push(document.createTextNode(' · '), styled(s.rate || 0, '/s'));
      const seconds = s.rate > 0 ? Math.ceil((s.size - s.done) / s.rate) : null;
      parts.push(document.createTextNode(seconds === null ? ' · 剩余时间估算中…' : ` · 剩余 ${Math.floor(seconds / 60)}分${seconds % 60}秒`));
    }
    s.info.replaceChildren(...parts);
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
  async function offerFiles(files) {
    const conversationId = selected;
    const targets = recipients();
    if (!targets.length) throw new Error('请选择有在线成员的私聊或群聊。');
    if (files.length * targets.length + sessions.size > LIMIT.sessions) throw new Error('一次发送最多支持 8 个接收会话，请减少文件或接收成员。');
    for (const file of files) for (const peerId of targets) {
      const s = makeSession(uuid(), peerId, 'file', true, { file, name: safeName(file.name), size: file.size, conversationId });
      renderTransfer(s);
      try { await signal(s, 'invite', { media: 'file', name: s.name, size: s.size, conversationId }); }
      catch (error) { endSession(s, '邀请发送失败'); report(error); }
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
      if (payload.media === 'file' && (!Number.isSafeInteger(payload.size) || payload.size < 0)) return;
      const conversationId = payload.conversationId === 'public' ? 'public'
        : state.rooms.some(room => room.id === payload.conversationId && room.members?.includes(peerId)) ? payload.conversationId : `peer:${peerId}`;
      s = makeSession(sid, peerId, payload.media, false, { name: safeName(payload.name), size: payload.size || 0, conversationId });
      try {
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
            void previewFile(s, s.file).catch(report);
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
      await s.writer.close(); s.writer = null; if (s.ended) return;
      file = await s.handle.getFile();
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
  async function previewFile(s, file) {
    if (!file || !s.card || s.preview || stopped) return;
    const ext = s.name.split('.').pop().toLowerCase(), type = previewType(s.name);
    if (!type && !TEXT_EXTENSIONS.has(ext)) return;
    const preview = node('div', undefined, 'file-preview'); s.preview = preview;
    if (type) {
      s.previewURL = URL.createObjectURL(file.slice(0, file.size, type));
      const media = node(type.startsWith('image/') ? 'img' : type.startsWith('audio/') ? 'audio' : type.startsWith('video/') ? 'video' : 'iframe');
      media.src = s.previewURL;
      if (media instanceof HTMLImageElement) { media.alt = s.name; media.loading = 'lazy'; }
      if (media instanceof HTMLMediaElement) { media.controls = true; media.preload = 'metadata'; }
      if (media instanceof HTMLIFrameElement) { media.title = s.name; media.setAttribute('sandbox', ''); }
      preview.append(media);
      const open = node('a', '打开预览'); open.href = s.previewURL; open.target = '_blank'; open.rel = 'noopener noreferrer';
      preview.append(open);
    } else {
      // Plain text is never interpreted as HTML or executable code.
      const max = 256 * 1024, text = await file.slice(0, max).text();
      if (stopped || !mediaMessages.has(s.id)) return;
      preview.append(node('pre', text));
      if (file.size > max) preview.append(node('p', '仅预览前 256 KB，完整内容已保存在文件中。', 'muted'));
    }
    if (stopped || !mediaMessages.has(s.id)) return;
    const nearBottom = $('messages').scrollHeight - $('messages').clientHeight - $('messages').scrollTop < 64;
    s.card.append(preview);
    if (nearBottom) $('messages').scrollTop = $('messages').scrollHeight;
  }
  async function discardPartialDownload(s) {
    if (s.writer) { const writer = s.writer; s.writer = null; await writer.abort().catch(() => {}); }
    if (s.autoSaved && !s.completed && s.downloads && s.filename) {
      await s.downloads.removeEntry(s.filename).catch(() => {});
    }
  }
  function releaseResources(s) {
    if (s.url) { URL.revokeObjectURL(s.url); s.url = null; }
    if (s.previewURL) { URL.revokeObjectURL(s.previewURL); s.previewURL = null; }
    s.preview?.remove(); s.preview = null;
    if (s.reserved) { memoryReserved -= s.reserved; s.reserved = 0; }
    s.chunks.length = 0;
  }
  function endSession(s, reason = '已结束', notify = false) {
    if (!s || s.ended) return;
    if (notify && online) signal(s, 'cancel').catch(() => {});
    s.ended = true; s.status = reason; clearTimeout(s.timer);
    closedSessions.set(s.id, Date.now());
    while (closedSessions.size > 128) closedSessions.delete(closedSessions.keys().next().value);
    s.rejectWait?.(); s.wake = null; s.file = null; s.candidates.length = 0;
    s.inviteCard?.remove();
    if (s.video) s.video.srcObject = null;
    s.remoteStream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    if (s.channel) { s.channel.onopen = s.channel.onmessage = s.channel.onclose = s.channel.onerror = null; s.channel.close(); }
    if (s.pc) { s.pc.onicecandidate = s.pc.onconnectionstatechange = s.pc.ontrack = s.pc.ondatachannel = null; s.pc.close(); }
    s.channel = s.pc = s.remoteStream = null;
    void discardPartialDownload(s);
    if (!s.completed) releaseResources(s);
    sessions.delete(s.id); updateTransfer(s, reason);
    if (s.card) {
      s.cancelButton?.remove(); transferHistory.push(s);
      if (s.screenInfo) s.screenInfo.textContent = reason;
      else if (!s.progress) s.card.append(node('p', `文件「${s.name}」 · ${reason}`, 'muted'));
      if (s.type === 'screen') s.controls.firstElementChild.disabled = true;
      while (transferHistory.length > LIMIT.history) { const old = transferHistory.shift(); releaseResources(old); old.card.remove(); mediaMessages.delete(old.id); }
    }
    if (s.type === 'screen' && s.outgoing && capture && !sharingPending && ![...sessions.values()].some((item) => item.type === 'screen' && item.outgoing)) stopCapture();
    renderMessages();
  }
  function renderScreenMessage(s) {
    createMediaMessage(s);
    if (s.screenCard) return;
    s.screenCard = node('div', undefined, 'screen');
    s.screenInfo = node('p', s.outgoing ? '正在共享屏幕' : '正在连接屏幕…', 'muted');
    s.controls = node('div', undefined, 'actions');
    s.controls.append(button(s.outgoing ? '停止共享' : '停止观看', () => endSession(s, '屏幕共享已停止', true)));
    s.screenCard.append(node('strong', s.outgoing ? '共享屏幕' : `${nameOf(s.peerId)} 的屏幕`), s.screenInfo, s.controls);
    s.card.append(s.screenCard);
  }
  function showScreen(s, stream) {
    renderScreenMessage(s);
    if (!s.video) {
      s.video = node('video'); s.video.autoplay = true; s.video.playsInline = true; s.video.controls = true;
      s.video.muted = s.outgoing;
      s.screenCard.insertBefore(s.video, s.screenInfo);
    }
    s.screenInfo.textContent = s.outgoing ? '正在共享你的屏幕' : '正在观看屏幕';
    s.video.srcObject = stream;
    s.video.play().catch(() => toast('请点击视频上的播放按钮开始观看。', true));
  }
  async function shareScreen() {
    if (capture || sharingPending) return;
    const conversationId = selected;
    const targets = recipients();
    if (!targets.length) throw new Error('请先选择有在线成员的私聊或群聊。');
    if (sessions.size + targets.length > LIMIT.sessions) throw new Error('屏幕接收成员过多，请先结束部分会话。');
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('当前浏览器不支持屏幕共享。');
    // Called synchronously by the click handler; never from transport events.
    sharingPending = true; updateConversation();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (stopped || !online || (embedded && !embeddedVisible)) { stream.getTracks().forEach((t) => t.stop()); return; }
      capture = stream; $('stop-screen').hidden = false;
      for (const track of stream.getTracks()) track.onended = stopCapture;
      for (const peerId of targets) {
        if (!capture) break;
        const s = makeSession(uuid(), peerId, 'screen', true, {conversationId});
        showScreen(s, stream);
        try { await signal(s, 'invite', { media: 'screen', conversationId }); } catch (error) { endSession(s, '共享邀请失败'); report(error); }
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

  listen('retry', 'click', () => attachTransport().catch(report));
  async function disconnect() {
    await globalThis.BjtuChatroomLink?.close();
    stopCapture(); for (const s of [...sessions.values()]) endSession(s, '连接已断开');
    $('pair-output').value = ''; $('pair-input').value = '';
    $('pair-status').textContent = '已断开。可重新生成邀请或点击扫描。';
    scheduleState();
  }
  listen('disconnect', 'click', () => disconnect().catch(report));
  listen('message-form', 'submit', async (event) => {
    event.preventDefault(); const input = $('message'), text = input.value.trim(), conversationId = selected;
    if (!text || $('send').disabled) return;
    const snapshot = input.value; $('send').disabled = true;
    try {
      await mutate('send-message', { conversationId, text });
      if (selected === conversationId && input.value === snapshot) input.value = '';
      if (drafts.get(conversationId) === snapshot) drafts.delete(conversationId);
    } catch (error) { report(error); } finally { $('send').disabled = !online; }
  });
  listen('message', 'keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('message-form').requestSubmit(); } });
  listen('invite-group', 'click', () => sidebar.groupEditor(true));
  listen('leave-group', 'click', () => sidebar.leaveGroup());
  listen('pick-file', 'click', () => $('file-picker').click());
  listen('file-picker', 'change', () => { const files = Array.from($('file-picker').files || []); $('file-picker').value = ''; if (files.length) offerFiles(files).catch(report); });
  listen('share-screen', 'click', () => { shareScreen().catch(report); });
  listen('stop-screen', 'click', stopCapture);
  if (embedded) window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type !== 'BJTU_CHATROOM_WINDOW_VISIBILITY') return;
    if (event.data.visible === false) { embeddedVisible = false; stopCapture(); }
    else if (event.data.visible === true) { embeddedVisible = true; scheduleState(); if (online) void action('scan').catch(report); }
  }, { signal: uiAbort.signal });
  window.addEventListener('bjtu-chatroom-transport-ready', () => attachTransport().catch(report), { signal: uiAbort.signal });
  window.addEventListener('beforeunload', (event) => {
    if (sessions.size || memoryReserved || capture) { event.preventDefault(); event.returnValue = ''; }
  }, { signal: uiAbort.signal });
  window.addEventListener('pagehide', () => {
    stopped = true; clearTimeout(stateTimer); uiAbort.abort();
    globalThis.BjtuChatroomLink?.close();
    try { unsubscribe?.(); } catch {}
    unsubscribe = null; stopCapture();
    for (const s of [...sessions.values()]) endSession(s, '页面已关闭');
    for (const s of transferHistory) releaseResources(s);
    pendingSignals.clear(); closedSessions.clear(); drafts.clear(); scrollPositions.clear(); mediaMessages.clear();
    sidebar.destroy();
  }, { once: true });
  const sidebar = globalThis.BjtuChatroomSidebar.mount({
    root: $('sidebar-host'),
    getState: () => state,
    mutate: async (name, args) => {
      const result = await mutate(name, args);
      await refreshState();
      return result;
    },
    onSelect: chooseConversation,
    onDisconnect: disconnect, report
  });
  await sidebar.ready;
  renderState(); connectionStatus('正在等待聊天室连接引擎…', false);
  await attachTransport();
  if (online) await action('scan').catch(report);
})().catch(error => {
  globalThis.BjtuOptionsMessage?.show(error?.message || '聊天室初始化失败，请刷新重试。', false);
});
