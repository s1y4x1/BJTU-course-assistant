/* Shared sidebar. Static markup lives only in options.html.
 * Dependencies: transport.js -> link.js -> sidebar.js. Each page owns its Link.
 * mount({root,getState?,mutate?,onSelect?,onDisconnect?,report?}) returns
 * {ready,render,setReady,groupEditor,leaveGroup,destroy}. Without host callbacks,
 * the controller subscribes to this page's transport; it never borrows other RTC.
 */
(function(global) {
  'use strict';
  const instances = new WeakMap();
  function mount({root, getState, mutate: hostMutate, onSelect, onDisconnect, report: hostReport} = {}) {
    if (!root) throw new Error('缺少聊天室 sidebar 容器。');
    if (instances.has(root)) return instances.get(root);
    const $ = id => root.querySelector('#' + id);
    const uiAbort = new AbortController();
    const peerNodes = new Map(), roomNodes = new Map(), requestNodes = new Map(), dirty = new Map();
    let state = {self:{},settings:{},peers:[],rooms:[],requests:[]}, selected = 'public';
    let online = false, pairingBusy = false, destroyed = false, transport, unsubscribe;
    let refreshPromise, refreshAgain = false, nicknameTimer, saveQueue = Promise.resolve(), revision = 0, settings;
    function node(tag, text, cls) {
      const el = document.createElement(tag);
      if (text !== undefined) el.textContent = String(text);
      if (cls) el.className = cls;
      return el;
    }
    function toast(text, ok = false) {
      if (destroyed) return;
      if (hostReport && !ok) hostReport(new Error(text));
      else global.BjtuOptionsMessage?.show(String(text).slice(0,240), ok);
    }
    function report(error) { if (error?.name !== 'AbortError') toast(error?.message || '操作未完成，请重试。'); }
    function button(text, callback, cls = 'secondary') {
      const el = node('button', text, cls); el.type = 'button';
      el.addEventListener('click', () => { Promise.resolve().then(callback).catch(report); }, {signal:uiAbort.signal});
      return el;
    }
    function listen(id, type, callback) { $(id).addEventListener(type, callback, {signal:uiAbort.signal}); }
    function nameOf(id) {
      if (id === state.self.id) return state.self.nickname || '我';
      const peer = state.peers.find(p => p.id === id);
      return peer?.remark || peer?.nickname || peer?.hostname || String(id || '未知用户').slice(0,80);
    }
    async function action(name, args = {}) {
      if (!online) throw new Error('当前页连接引擎尚未就绪，请重试。');
      if (hostMutate) return hostMutate(name, args);
      const result = await transport.action(name, args);
      if (result?.ok === false || result?.error) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || '操作失败。');
      return result;
    }
    async function mutate(name, args) {
      const result = await action(name, args);
      if (!getState) await refresh();
      return result;
    }
    function scheduleState() { if (!getState) refresh().catch(report); }
    function setReady(ready, text) {
      online = ready;
      $('sidebar-engine-status').textContent = text || (ready ? '当前页连接引擎已就绪。' : '等待当前页连接引擎。');
      for (const id of ['scan','create-group','nickname','require-friend','invite-policy']) $(id).disabled = !ready;
      for (const id of ['pair-create','pair-accept','pair-complete']) $(id).disabled = !ready || pairingBusy || typeof global.BjtuChatroomLink?.pairCreate !== 'function';
      if (ready && $('pair-status').textContent === '等待连接引擎。') $('pair-status').textContent = '引擎已就绪。可生成邀请，或接收对方邀请。';
    }
    async function refresh() {
      if (destroyed || !transport) return;
      if (refreshPromise) { refreshAgain = true; return refreshPromise; }
      refreshPromise = (async () => {
        do {
          refreshAgain = false;
          const value = await transport.state();
          if (destroyed) return;
          if (value?.ok === false || value?.error) throw new Error('无法读取聊天室状态。');
          const source = value.state || value;
          state = {...state,...source};
          render(); setReady(true);
        } while (refreshAgain && !destroyed);
      })();
      try { await refreshPromise; } finally { refreshPromise = null; }
    }
    async function attachTransport() {
      if (getState || destroyed) return;
      const next = global.BjtuChatroomTransport;
      if (!next?.state || !next?.action || !next?.subscribe) { setReady(false, '当前页连接引擎未加载，请重试。'); return; }
      await next.ready;
      if (destroyed) return;
      if (next !== transport) {
        unsubscribe?.(); transport = next;
        if (global.BjtuChatroomLink && typeof next.setLink === 'function') next.setLink(global.BjtuChatroomLink);
        unsubscribe = next.subscribe(event => {
          if (event.type === 'disconnected') setReady(false, '连接已断开，请在当前页重新配对。');
          else if (event.type !== 'signal') scheduleState();
        });
      }
      await refresh();
    }
    function chooseConversation(id) { selected = id; onSelect?.(id); render(); }
    function leaveGroup() {
      const roomId = selected;
      openEditor('退出群聊', fields => {
        fields.append(node('p', '确定退出当前群聊？'));
        return async () => { await mutate('group-leave', {roomId}); if (selected === roomId) chooseConversation('public'); };
      });
    }
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
  function render() {
    if (destroyed) return;
    state = getState ? getState() : state;
    reconcile($('conversations'), roomNodes, [{ id: 'public', name: '公共群聊' }, ...state.rooms], (r) => r.id, (room) => {
      const el = button(room.name || '未命名群聊', () => chooseConversation(room.id), 'conversation-link');
      el.dataset.conversation = room.id;
      return el;
    });
    reconcile($('peers'), peerNodes, state.peers, (p) => p.id, (peer) => {
      const el = node('article', undefined, 'peer');
      const title = node('strong', nameOf(peer.id));
      const status = node('p', `${peer.online ? '在线' : '离线'}${peer.friend ? ' · 好友' : ''}${peer.blocked ? ' · 已屏蔽' : ''}`, 'muted');
      const actions = node('div', undefined, 'actions');
      actions.append(button('私聊', () => chooseConversation(`peer:${peer.id}`)), button('备注', () => editText('用户备注', '备注', peer.remark || '', (remark) => mutate('remark', { peerId: peer.id, remark }), 80)), button(peer.blocked ? '取消拉黑' : '拉黑', async () => {
        await mutate('block', { peerId: peer.id, blocked: !peer.blocked });
      }));
      if (!peer.friend && !peer.blocked) actions.append(button('加好友', async () => { await mutate('friend-request', { peerId: peer.id }); toast('好友请求已发送。', true); }));
      el.append(title, status, node('p', `身份 ID / 指纹：${peer.id}`, 'muted'), actions);
      return el;
    });
    reconcile($('requests'), requestNodes, state.requests, (r) => r.id, (request) => {
      const el = node('article', undefined, 'request'), actions = node('div', undefined, 'actions');
      const from = typeof request.from === 'object' ? request.from.id : request.from;
      el.append(node('p', request.type === 'friend' ? `${nameOf(from)} 请求添加好友` : `${nameOf(from)} 邀请你加入 ${request.room?.name || request.room || '群聊'}`));
      const respond = (allow, extra = {}) => mutate(request.type === 'friend' ? 'friend-response' : 'group-response', { requestId: request.id, allow, ...extra });
      actions.append(button('接受', () => respond(true)), button('拒绝', () => respond(false)));
      if (request.type === 'group') actions.append(button('拒绝且永不接受此人', () => respond(false, { blockSender: true })), button('拒绝全部邀请', () => respond(false, { blockAll: true })));
      else actions.append(button('拒绝并拉黑', async () => { await respond(false); await mutate('block', { peerId: from, blocked: true }); }));
      el.append(actions);
      return el;
    });
    for (const [id, value] of Object.entries({
      nickname: state.settings.nickname || state.self.nickname || '',
      'require-friend': !!state.settings.requireFriend,
      'invite-policy': state.settings.invitePolicy || 'ask'
    })) {
      if (dirty.has(id)) continue;
      if ($(id).type === 'checkbox') $(id).checked = value;
      else $(id).value = value;
    }
    $('self-info').textContent = [state.self.nickname, state.self.id ? `身份 ID ${state.self.id}` : '', state.self.fingerprint ? `身份指纹 ${state.self.fingerprint}` : ''].filter(Boolean).join(' · ');
    if (selected !== 'public' && !selected.startsWith('peer:') && !state.rooms.some(r => r.id === selected)) chooseConversation('public');
    $('request-count').textContent = String(state.requests.length);
    $('sidebar-invite-group').hidden = $('sidebar-leave-group').hidden = !state.rooms.some(r => r.id === selected);
    for (const el of $('conversations').querySelectorAll('[data-conversation]')) {
      if (el.dataset.conversation === selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
  }
  function editText(title, labelText, initial, submit, maxLength = 80) {
    openEditor(title, (fields) => {
      const label = node('label', labelText), input = node('input');
      input.value = initial; input.maxLength = maxLength;
      label.append(input); fields.append(label);
      return () => submit(input.value.trim());
    });
  }
  let editorSubmit = null;
  function openEditor(title, build) {
    if ($('editor').open) return;
    $('editor-title').textContent = title;
    $('editor-fields').replaceChildren();
    editorSubmit = build($('editor-fields'));
    $('editor').showModal();
  }
  function groupEditor(invite = false) {
    const roomId = selected;
    openEditor(invite ? '邀请成员' : '新建群聊', (fields) => {
      const input = node('input'); input.placeholder = '群聊名称'; input.maxLength = 60; input.required = !invite;
      if (!invite) { const label = node('label', '群聊名称'); label.append(input); fields.append(label); }
      const boxes = [];
      const room = state.rooms.find((r) => r.id === roomId);
      for (const peer of state.peers.filter((p) => !p.blocked && p.online && (!invite || !room?.members?.includes(p.id)))) {
        const label = node('label', undefined, 'check'), box = node('input'); box.type = 'checkbox'; box.value = peer.id;
        boxes.push(box); label.append(box, document.createTextNode(nameOf(peer.id))); fields.append(label);
      }
      fields.append(node('p', '对方可能需要确认后才会加入。', 'muted'));
      return async () => {
        const peerIds = boxes.filter((b) => b.checked).map((b) => b.value);
        if (!peerIds.length) throw new Error('请选择至少一位成员。');
        await mutate(invite ? 'group-invite' : 'group-create', invite ? { roomId, peerIds } : { name: input.value.trim(), peerIds });
      };
    });
  }


    async function disconnect() {
      if (onDisconnect) await onDisconnect();
      else await global.BjtuChatroomLink?.close();
      $('pair-output').value = ''; $('pair-input').value = '';
      $('pair-status').textContent = '已断开。可重新生成邀请或点击刷新发现。';
      scheduleState();
    }
  listen('scan', 'click', async () => {
    $('scan').disabled = true; $('discovery-status').textContent = '正在连接在线信令服务…';
    try { await action('scan'); } catch (error) { $('discovery-status').textContent = error.message; report(error); }
    finally { $('scan').disabled = !online; }
  });
  window.addEventListener('bjtu-chatroom-link-status', ({ detail }) => {
    if (destroyed || !detail) return;
    if (detail.type === 'scanning' || detail.type === 'discovery') {
      $('discovery-status').textContent = detail.deviceId ? `在线发现已启用 · 本机临时设备 ID：${detail.deviceId}` : '在线发现已连接，等待服务器分配设备 ID…';
      $('stop-scan').hidden = false;
      if (detail.peers) {
        $('discovered-peers').replaceChildren(...detail.peers.map(peer => {
          const el = node('article', undefined, 'peer');
          el.append(node('p', `设备 ${peer.id}`), button('连接', () => mutate('connect', { peerId: peer.id })));
          return el;
        }));
      }
    } else if (detail.type === 'scan-closed') {
      $('discovery-status').textContent = '在线发现已停止。'; $('stop-scan').hidden = true; $('discovered-peers').replaceChildren();
    } else if (detail.type === 'peer-online') { $('pair-status').textContent = '身份验证完成，已建立直连。'; scheduleState(); }
    else if (detail.type === 'error') report(new Error(detail.message));
  }, { signal: uiAbort.signal });
  listen('connect-form', 'submit', (event) => {
    event.preventDefault();
    const peerId = $('device-id').value.trim();
    if (!peerId) return;
    mutate('connect', { peerId }).then(() => toast('连接请求已发送。', true)).catch(report);
  });
  listen('pair-copy', 'click', () => { if ($('pair-output').value) navigator.clipboard.writeText($('pair-output').value).then(() => toast('连接信息已复制，仅分享给可信的人。', true)).catch(() => toast('无法访问剪贴板，请手动选择并复制。')); });
  async function pair(name) {
    if (pairingBusy) return;
    pairingBusy = true;
    for (const id of ['pair-create', 'pair-accept', 'pair-complete']) $(id).disabled = true;
    $('pair-status').textContent = '正在收集本地候选 / 处理配对，请稍候…';
    if (name !== 'pair-complete') $('pair-output').value = '';
    try {
      const result = await mutate(name, { code: $('pair-input').value.trim() });
      if (typeof result?.code === 'string') $('pair-output').value = result.code;
      $('pair-status').textContent = name === 'pair-create' ? '请复制本机邀请发给对方，收到应答后粘贴并提交。' : name === 'pair-accept' ? '请复制本机应答发回邀请方，等待对方提交。' : '应答已提交，等待直连和身份验证。';
    } catch (error) { $('pair-status').textContent = error.message; report(error); }
    finally { pairingBusy = false; for (const id of ['pair-create', 'pair-accept', 'pair-complete']) $(id).disabled = !online; }
  }
  listen('pair-create', 'click', () => pair('pair-create'));
  listen('pair-accept', 'click', () => pair('pair-accept'));
  listen('pair-complete', 'click', () => pair('pair-complete'));

    function settingsValue(id) {
      return id === 'nickname' ? $('nickname').value.trim() : id === 'require-friend' ? $('require-friend').checked : $('invite-policy').value;
    }
    function saveSetting(id) {
      const version = dirty.get(id);
      if (!version) return;
      const value = settingsValue(id), key = {nickname:'nickname','require-friend':'requireFriend','invite-policy':'invitePolicy'}[id];
      if (id === 'nickname' && !value) { $('settings-status').textContent = '昵称不能为空，尚未保存。'; return; }
      $('settings-status').textContent = '正在自动保存…';
      saveQueue = saveQueue.catch(() => {}).then(async () => {
        if (dirty.get(id) !== version) return;
        await mutate('settings', {[key]:value});
        if (dirty.get(id) === version) dirty.delete(id);
        if (!destroyed) {
          $('settings-status').textContent = dirty.size ? '还有更改待保存。' : '已自动保存。';
          render();
        }
      }).catch(error => {
        if (!destroyed) $('settings-status').textContent = '保存失败，请修改或再次离开输入框重试。';
        report(error);
      });
    }
    listen('nickname','input', () => {
      dirty.set('nickname', ++revision); clearTimeout(nicknameTimer);
      $('settings-status').textContent = '昵称待自动保存…';
      nicknameTimer = setTimeout(() => saveSetting('nickname'), 350);
    });
    for (const type of ['change','blur']) listen('nickname',type, () => { clearTimeout(nicknameTimer); saveSetting('nickname'); });
    for (const id of ['require-friend','invite-policy']) listen(id,'change', () => { dirty.set(id,++revision); saveSetting(id); });
    listen('settings-form','submit',event => { event.preventDefault(); clearTimeout(nicknameTimer); for (const id of dirty.keys()) saveSetting(id); });
    listen('create-group','click', () => groupEditor(false));
    listen('sidebar-invite-group','click', () => groupEditor(true));
    listen('sidebar-leave-group','click', leaveGroup);
    listen('stop-scan','click', () => disconnect().catch(report));
    listen('sidebar-retry','click', () => {
      if (getState) global.dispatchEvent(new Event('bjtu-chatroom-transport-ready'));
      else attachTransport().catch(report);
    });
    listen('editor-cancel','click', () => $('editor').close());
    listen('editor','close', () => { editorSubmit = null; $('editor-fields').replaceChildren(); });
    listen('editor-form','submit', async event => {
      event.preventDefault();
      const submit = $('editor-form').querySelector('[type="submit"]'); submit.disabled = true;
      try { await editorSubmit?.(); $('editor').close(); } catch(error) { report(error); } finally { submit.disabled = false; }
    });
    global.addEventListener('bjtu-chatroom-transport-ready', () => attachTransport().catch(report), {signal:uiAbort.signal});
    function destroy() {
      if (destroyed) return;
      clearTimeout(nicknameTimer);
      for (const id of dirty.keys()) saveSetting(id);
      destroyed = true; uiAbort.abort(); unsubscribe?.();
      settings?.destroy();
      if ($('editor').open) $('editor').close();
      instances.delete(root);
    }
    global.addEventListener('pagehide', destroy, {once:true,signal:uiAbort.signal});
    setReady(false); render();
    const controller = {ready:Promise.resolve(),render,setReady,groupEditor,leaveGroup,destroy};
    instances.set(root,controller);
    controller.ready = (async () => {
      settings = await global.BjtuChatroomSettings.mount(root, report);
      if (destroyed) { settings.destroy(); return; }
      global.BjtuOptionTips?.setup();
      if (!getState) await attachTransport().catch(error => { setReady(false, '连接引擎不可用，请重试。'); report(error); });
    })();
    return controller;
  }
  global.BjtuChatroomSidebar = {mount};
})(globalThis);
