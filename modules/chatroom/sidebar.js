/* Shared sidebar. Static markup lives only in options.html.
 * Dependencies: transport.js -> link.js -> sidebar.js. Each page owns its Link.
 * mount({root,getState?,getSelected?,mutate?,onSelect?,onDisconnect?,report?}) returns
 * {ready,render,setReady,groupEditor,leaveGroup,destroy}. Without host callbacks,
 * the controller subscribes to this page's transport; it never borrows other RTC.
 */
(function(global) {
  'use strict';
  const instances = new WeakMap();
  function bindHold(element, {onConfirm,signal} = {}) {
    let hold;
    element.classList.add('hold-confirm');
    if (!element.querySelector('.hold-confirm-progress')) {
      const progress = document.createElement('span'); progress.className = 'hold-confirm-progress';
      progress.setAttribute('aria-hidden','true'); element.append(progress);
    }
    function cancel() {
      if (!hold) return;
      cancelAnimationFrame(hold.frame); hold = null;
      element.style.removeProperty('--hold-confirm-progress');
      global.removeEventListener('pointerup',cancel); global.removeEventListener('pointercancel',cancel);
      signal?.removeEventListener('abort',cancel);
    }
    element.addEventListener('pointerdown',event => {
      if (event.button !== 0 || element.disabled) return;
      cancel(); hold = {start:performance.now(),x:event.clientX,y:event.clientY};
      global.addEventListener('pointerup',cancel); global.addEventListener('pointercancel',cancel);
      signal?.addEventListener('abort',cancel,{once:true});
      const tick = now => {
        if (!hold) return;
        if (!element.isConnected || element.disabled) { cancel(); return; }
        const progress = Math.min(1,(now-hold.start)/2000);
        element.style.setProperty('--hold-confirm-progress',String(progress));
        if (progress < 1) hold.frame = requestAnimationFrame(tick);
        else { element.suppressClickUntil = now+800; cancel(); onConfirm(); }
      };
      hold.frame = requestAnimationFrame(tick);
    },{signal});
    element.addEventListener('pointermove',event => { if (hold && Math.hypot(event.clientX-hold.x,event.clientY-hold.y)>8) cancel(); },{signal});
    element.addEventListener('pointerleave',cancel,{signal});
    element.addEventListener('contextmenu',event => event.preventDefault(),{signal});
    return {cancel};
  }
  function mount({root, getState, getSelected, mutate: hostMutate, onSelect, onDisconnect, report: hostReport} = {}) {
    if (!root) throw new Error('缺少聊天室 sidebar 容器。');
    if (instances.has(root)) return instances.get(root);
    const $ = id => root.querySelector('#' + id);
    const uiAbort = new AbortController();
    const roomNodes = new Map(), requestNodes = new Map(), dirty = new Map();
    let state = {self:{},settings:{},peers:[],rooms:[],requests:[],messages:[],conversations:{}}, selected = 'public';
    let online = false, pairingBusy = false, destroyed = false, transport, unsubscribe;
    let refreshPromise, refreshAgain = false, saveQueue = Promise.resolve(), revision = 0, settings;
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
      if (id === state.self.id) return state.self.nickname || state.self.ip || '我';
      const peer = state.peers.find(p => p.id === id);
      return peer?.remark || peer?.nickname || peer?.ip || String(id || '未知用户').slice(0,80);
    }
    function deviceText(device) {
      if (!device) return '';
      return [device.os, device.browser].filter(Boolean).join(' · ');
    }
    function appendAccounts(container, info) {
      if (!info?.ve && !info?.mis) return false;
      if (info.ve) container.append(node('p', `智慧课程平台${info.veRecent ? '（最近登录）' : ''}：${info.ve}`, 'editor-info'));
      if (info.mis) container.append(node('p', `MIS：${info.mis}`, 'editor-info'));
      return true;
    }
    async function loadSelfAccounts(container) {
      const stored = await global.chrome.storage.local.get([
        'username', 'popupFullscreenCourseCache', 'loginAccountHistory', 'casLoginName', 'academicSystemStudentId'
      ]);
      if (!$('editor').open || !container.isConnected) return;
      const clean = value => typeof value === 'string' ? value.trim() : '';
      const latest = (Array.isArray(stored.loginAccountHistory) ? stored.loginAccountHistory : [])
        .reduce((best, entry) => Number(entry?.lastLoginAt) > Number(best?.lastLoginAt || 0) ? entry : best, null);
      const ve = clean(stored.username) || clean(stored.popupFullscreenCourseCache?.currentAccountLoginName);
      const mis = clean(stored.casLoginName) || clean(stored.academicSystemStudentId);
      const previousVe = !ve && (clean(latest?.loginName) || clean(latest?.userId));
      container.replaceChildren();
      appendAccounts(container, {ve, mis});
      if (previousVe) container.append(node('p', `智慧课程平台（最近登录）：${previousVe}`, 'editor-info'));
      if (!container.childElementCount) container.textContent = '未找到本机账号记录';
      const version = global.chrome.runtime.getManifest?.()?.version;
      if (version) container.append(node('p', `扩展版本：${version}`, 'editor-info'));
    }
    function updateEditorAccounts(container) {
      const id = container.dataset.peerId;
      const peer = state.peers.find(peer => peer.id === id);
      const info = peer?.accounts;
      const signature = JSON.stringify([info, peer?.version]);
      if (container.dataset.accounts === signature) return;
      container.dataset.accounts = signature;
      container.replaceChildren();
      if (!appendAccounts(container, info)) container.textContent = '对方未共享账号信息';
      if (peer?.version) container.append(node('p', `扩展版本：${peer.version}`, 'editor-info'));
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
    function setReady(ready) {
      online = ready;
      for (const id of ['scan','create-group','nickname','require-friend','invite-policy-stranger','invite-policy-friend']) $(id).disabled = !ready;
      for (const id of ['pair-create','pair-accept','pair-complete']) $(id).disabled = !ready || pairingBusy || typeof global.BjtuChatroomLink?.pairCreate !== 'function';
      if (ready && $('pair-status').textContent === '等待连接引擎。') $('pair-status').textContent = '引擎已就绪。可生成邀请，或接收对方邀请。';
    }
    function setLanScanProgress(done, total, found) {
      const label = $('chatroomLanScanProgress');
      if (!label) return;
      if (done == null) { label.hidden = true; return; }
      const bar = $('chatroomLanScanBar'), text = $('chatroomLanScanText'), percent = $('chatroomLanScanPercent');
      const maximum = Math.max(1, Number(total) || 203);
      const value = found ? maximum : Math.min(maximum, Math.max(0, Number(done) || 0));
      label.hidden = false;
      if (bar) { bar.max = maximum; bar.value = value; }
      if (text) text.textContent = found ? '已找到服务器，正在连接…' : `正在扫描局域网 ${value}/${maximum}`;
      if (percent) percent.textContent = `${Math.round(value / maximum * 100)}%`;
    }
    function setServerStatus(status, deviceId) {
      const label = $('chatroomSignalingStatus');
      label.dataset.state = status;
      label.textContent = {connected:'已连接',connecting:'连接中…',disconnected:'未连接'}[status];
      if (status !== 'connecting') setLanScanProgress(null);
      $('chatroomStartServer').hidden = status === 'connected';
      $('chatroomServerActions').hidden = status !== 'connected';
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
      if (!next?.state || !next?.action || !next?.subscribe) { setReady(false); return; }
      await next.ready;
      if (destroyed) return;
      if (next !== transport) {
        unsubscribe?.(); transport = next;
        if (global.BjtuChatroomLink && typeof next.setLink === 'function') next.setLink(global.BjtuChatroomLink);
        unsubscribe = next.subscribe(event => {
          if (event.type === 'disconnected') setReady(false);
          else if (event.type !== 'signal') scheduleState();
        });
      }
      await refresh();
    }
    function chooseConversation(id) {
      selected = id;
      try { onSelect?.(id,{interactive:true}); } finally { render(); }
    }
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
    if (getSelected) selected = getSelected();
    const editorAccounts = $('editor-fields').querySelector('.editor-accounts');
    if ($('editor').open && editorAccounts?.dataset.peerId) updateEditorAccounts(editorAccounts);
    const {visibleConversations, unreadCount} = global.BjtuChatroomConversations;
    const entries = visibleConversations(state).map(entry => {
      const isPublic = entry.id === 'public';
      const members = isPublic ? [state.self.id, ...state.peers.filter(peer => peer.online && !peer.blocked).map(peer => peer.id)].filter(Boolean) : entry.members;
      const name = entry.kind === 'private' ? nameOf(entry.peerId) : entry.view.remark || (isPublic ? '公共群聊' : entry.name);
      return {...entry, name, members,
        onlineCount: members?.filter(id => id === state.self.id || state.peers.some(peer => peer.id === id && peer.online)).length || 0};
    }).sort((a,b) => (b.view.lastAt || 0) - (a.view.lastAt || 0));
    reconcile($('conversations'), roomNodes, entries, r => r.id, entry => {
      const el = node('div', undefined, 'conversation-entry');
      const link = button('', () => { if (performance.now() >= (link.suppressClickUntil || 0)) chooseConversation(entry.id); }, 'conversation-link');
      link.dataset.conversation = entry.id;
      link.title = '长按 2 秒删除会话及本地记录';
      const avatar = node('span', entry.kind === 'group' ? '👥' : '👤', 'conversation-avatar');
      avatar.setAttribute('aria-hidden', 'true');
      if (entry.kind === 'private') {
        const dot = node('span',undefined,`conversation-online-dot${entry.online ? ' online' + (entry.background ? ' background' : '') : ''}`);
        dot.title = entry.online ? entry.background ? '后台在线' : '在线' : '离线'; avatar.append(dot);
      }
      else avatar.append(node('span', `${entry.onlineCount}/${entry.members?.length || 0}`, 'conversation-group-count'));
      const content = node('span', undefined, 'conversation-preview'), name = node('span', entry.name, 'conversation-name');
      name.title = '修改备注';
      name.addEventListener('click', event => {
        event.stopPropagation();
        if (performance.now() < (link.suppressClickUntil || 0)) return;
        if (entry.kind === 'private') editPerson(entry.peerId);
        else editText('修改群聊备注','备注',entry.view.remark || '',remark => mutate('conversation-remark',{conversationId:entry.id,remark}),80);
      }, {signal:uiAbort.signal});
      const summary = String(entry.view.lastText || '').replace(/```[\s\S]*?```/g,' [代码] ').replace(/[*_`>#]/g,'').replace(/\s+/g,' ').slice(0,160);
      content.append(name, node('span', summary, 'muted conversation-kind'));
      link.append(avatar, content);
      if (entry.view.muted) link.append(node('span', '🔕', 'conversation-muted-icon'));
      const unread = unreadCount(entry.view);
      if (unread) link.append(node('span', unread > 99 ? '99+' : unread, 'conversation-unread-badge'));
      bindHold(link,{signal:uiAbort.signal,onConfirm:() => mutate('conversation-delete',{conversationId:entry.id}).catch(report)});
      el.append(link);
      return el;
    });
    if (!entries.some(entry => entry.id === selected)) {
      selected = entries[0]?.id || ''; onSelect?.(selected);
    }
    reconcile($('requests'), requestNodes, state.requests, (r) => r.id, (request) => {
      const el = node('article', undefined, 'request'), actions = node('div', undefined, 'actions');
      const from = typeof request.from === 'object' ? request.from.id : request.from;
      el.append(node('p', request.type === 'friend' ? `「${nameOf(from)}」请求添加好友` : `「${nameOf(from)}」邀请你加入「${request.room?.name || request.room || '群聊'}」`));
      const respond = (allow, extra = {}) => mutate(request.type === 'friend' ? 'friend-response' : 'group-response', { requestId: request.id, allow, ...extra });
      actions.append(button('接受', () => respond(true)), button('拒绝', () => respond(false)));
      if (request.type === 'group') actions.append(button('拒绝且永不接受此人', () => respond(false, { blockSender: true })), button('拒绝全部邀请', () => respond(false, { blockAll: true })));
      else actions.append(button('拒绝并拉黑', async () => { await respond(false); await mutate('block', { peerId: from, blocked: true }); }));
      el.append(actions);
      return el;
    });
    for (const [id, value] of Object.entries({
      nickname: state.settings.nickname ?? '',
      'require-friend': !!state.settings.requireFriend,
      'invite-policy-stranger': state.settings.invitePolicyStranger || 'ask',
      'invite-policy-friend': state.settings.invitePolicyFriend || 'ask'
    })) {
      if (dirty.has(id)) continue;
      if ($(id).type === 'checkbox') $(id).checked = value;
      else $(id).value = value;
    }
    $('nickname').placeholder = state.self.ip || state.self.nickname || '默认使用本机 IP';
    $('request-count').textContent = String(state.requests.length);
    for (const el of $('conversations').querySelectorAll('[data-conversation]')) {
      if (el.dataset.conversation === selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
  }
  function editText(title, labelText, initial, submit, maxLength = 80, placeholder = '') {
    openEditor(title, (fields) => {
      const label = node('label', labelText), input = node('input');
      input.value = initial; input.maxLength = maxLength;
      input.placeholder = placeholder;
      label.append(input); fields.append(label);
      return value => submit(value.trim());
    }, {autoSave:true});
  }
  function editSelf() {
    openEditor('个人信息', fields => {
      if (state.self.ip) fields.append(node('p', state.self.ip, 'editor-ip'));
      const device = deviceText(state.self.device);
      if (device) fields.append(node('p', `设备：${device}`, 'editor-info'));
      const accounts = node('div', undefined, 'editor-accounts');
      accounts.textContent = '正在读取本机账号…';
      fields.append(accounts);
      void loadSelfAccounts(accounts).catch(() => { accounts.textContent = '无法读取本机账号'; });
      const label = node('label', '昵称（留空恢复默认 IP）'), input = node('input');
      input.value = state.settings.nickname || ''; input.maxLength = 40;
      input.placeholder = state.self.ip || state.self.nickname || '默认使用本机 IP';
      label.append(input); fields.append(label);
      return value => mutate('settings', {nickname: value.trim()});
    }, {autoSave:true});
  }
  function editPerson(peerId) {
    if (peerId === state.self.id) {
      editSelf();
      return;
    }
    const peer = state.peers.find(item => item.id === peerId);
    if (!peer) return;
    openEditor(peer.remark || peer.nickname || peer.ip || peer.id, fields => {
      const meta = node('div', undefined, 'editor-personal');
      if (peer.ip) meta.append(node('p', peer.ip, 'editor-ip'));
      const device = deviceText(peer.device);
      if (device) meta.append(node('p', `设备：${device}`, 'editor-info'));
      if (meta.childElementCount) fields.append(meta);
      const accounts = node('div', undefined, 'editor-accounts');
      accounts.dataset.peerId = peer.id;
      updateEditorAccounts(accounts); fields.append(accounts);
      const label = node('label', '备注'), input = node('input');
      input.value = peer.remark || ''; input.maxLength = 80;
      input.placeholder = peer.nickname || peer.ip || peer.id;
      label.append(input); fields.append(label);
      const actions = node('div', undefined, 'actions');
      if (!peer.friend && !peer.blocked) actions.append(button('加好友', async () => {
        await mutate('friend-request', {peerId}); $('editor').close(); chooseConversation(`peer:${peerId}`);
      }));
      if (!peer.blockedByPeer && !peer.friendRequiredByPeer) actions.append(button('私聊', async () => {
        await mutate('conversation-open', {peerId});
        $('editor').close(); chooseConversation(`peer:${peerId}`);
      }));
      if (actions.childElementCount) fields.append(actions);
      return value => mutate('remark', {peerId, remark: value.trim()});
    }, {autoSave:true});
  }
  let editorSubmit = null, editorAutoSave = false;
  function openEditor(title, build, {autoSave = false} = {}) {
    if ($('editor').open) return;
    $('editor-title').textContent = title;
    $('editor-fields').replaceChildren();
    editorSubmit = build($('editor-fields'));
    editorAutoSave = autoSave;
    $('editor-cancel').parentElement.hidden = autoSave;
    if (autoSave) {
      const submit = editorSubmit;
      const input = $('editor-fields').querySelector('input');
      let saved = input?.value, queue = Promise.resolve();
      editorSubmit = () => {
        const value = input?.value;
        queue = queue.catch(() => {}).then(async () => {
          if (value === saved) return;
          // Capture each committed value, rather than a later keystroke.
          await submit(value); saved = value;
        });
        return queue;
      };
      input?.addEventListener('blur', () => editorSubmit?.().catch(report), {signal:uiAbort.signal});
    }
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
    }, {autoSave:false});
  }


    async function disconnect() {
      if (onDisconnect) await onDisconnect();
      else await mutate('close');
      $('pair-input').value = '';
      $('pair-status').textContent = '已断开。可重新生成邀请或点击刷新发现。';
      scheduleState();
    }
  async function scan() {
    $('scan').disabled = true;
    try {
      const result = await action('scan', {force:true});
      if (!destroyed) setServerStatus(result?.discoveryStatus || global.BjtuChatroomLink?.discoveryStatus || 'connected', result?.deviceId);
    } catch (error) {
      if (!destroyed) { setServerStatus(global.BjtuChatroomLink?.discoveryStatus || 'disconnected'); report(error); }
    }
    finally { $('scan').disabled = !online; }
  }
  listen('scan', 'click', scan);
  window.addEventListener('bjtu-chatroom-link-status', ({ detail }) => {
    if (destroyed || !detail) return;
    if (detail.type === 'scan-start') {
      setServerStatus('connecting');
    } else if (detail.type === 'lan-scan-progress') {
      setServerStatus('connecting');
      setLanScanProgress(detail.done, detail.total, detail.found === true);
    } else if (detail.type === 'lan-scan-end') {
      setLanScanProgress(null);
    } else if (detail.type === 'scanning' || detail.type === 'discovery') {
      setServerStatus('connected', detail.deviceId);
    } else if (detail.type === 'scan-closed') {
      setServerStatus('disconnected');
    } else if (detail.type === 'peer-online') { $('pair-status').textContent = '身份验证完成，已建立直连。'; scheduleState(); }
    else if (detail.type === 'error') report(new Error(detail.message));
  }, { signal: uiAbort.signal });
  async function pair(name) {
    if (pairingBusy) return;
    pairingBusy = true;
    for (const id of ['pair-create', 'pair-accept', 'pair-complete']) $(id).disabled = true;
    $('pair-status').textContent = '正在收集本地候选 / 处理配对，请稍候…';
    try {
      const result = await mutate(name, { code: $('pair-input').value.trim() });
      if (typeof result?.code === 'string') await navigator.clipboard.writeText(result.code);
      $('pair-status').textContent = name === 'pair-create' ? '邀请已复制，请发给对方；收到应答后粘贴并提交。' : name === 'pair-accept' ? '应答已复制，请发回邀请方并等待对方提交。' : '应答已提交，等待直连和身份验证。';
    } catch (error) { $('pair-status').textContent = error.message; report(error); }
    finally { pairingBusy = false; for (const id of ['pair-create', 'pair-accept', 'pair-complete']) $(id).disabled = !online; }
  }
  listen('pair-create', 'click', () => pair('pair-create'));
  listen('pair-accept', 'click', () => pair('pair-accept'));
  listen('pair-complete', 'click', () => pair('pair-complete'));

    function settingsValue(id) {
      if (id === 'nickname') return $('nickname').value.trim();
      if (id === 'require-friend') return $('require-friend').checked;
      return $(id).value;
    }
    function saveSetting(id) {
      const version = dirty.get(id);
      if (!version) return;
      const value = settingsValue(id), key = {nickname:'nickname','require-friend':'requireFriend','invite-policy-stranger':'invitePolicyStranger','invite-policy-friend':'invitePolicyFriend'}[id];
      saveQueue = saveQueue.catch(() => {}).then(async () => {
        if (dirty.get(id) !== version) return;
        await mutate('settings', {[key]:value});
        if (dirty.get(id) === version) dirty.delete(id);
        if (!destroyed) {
          render();
        }
      }).catch(error => {
        report(error);
      });
    }
    listen('nickname','input', () => {
      dirty.set('nickname', ++revision);
    });
    listen('nickname','blur', () => saveSetting('nickname'));
    listen('nickname','keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault(); saveSetting('nickname');
    });
    for (const id of ['require-friend','invite-policy-stranger','invite-policy-friend']) listen(id,'change', () => { dirty.set(id,++revision); saveSetting(id); });
    listen('settings-form','submit',event => { event.preventDefault(); for (const id of dirty.keys()) saveSetting(id); });
    listen('create-group','click', () => groupEditor(false));
    listen('disconnect','click', () => disconnect().catch(report));
    listen('chatroomSignalingUrl','keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      $('chatroomSignalingUrl').blur();
      if (!$('chatroomSignalingUrl').checkValidity()) return;
      Promise.resolve(settings?.flush?.()).then(scan).catch(report);
    });
    $('nickname').required = false;
    let backdropPressed = false;
    function onBackdrop(event) {
      if (event.target !== $('editor')) return false;
      const rect = $('editor').getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    }
    listen('editor','pointerdown', event => { backdropPressed = onBackdrop(event); });
    listen('editor','click', event => {
      if (backdropPressed && onBackdrop(event)) $('editor').close();
      backdropPressed = false;
    });
    listen('editor-cancel','click', () => $('editor').close());
    listen('editor','close', () => { if (editorAutoSave) void editorSubmit?.().catch(report); editorSubmit = null; $('editor-fields').replaceChildren(); });
    listen('editor-form','submit', async event => {
      event.preventDefault();
      const submit = $('editor-form').querySelector('[type="submit"]'); submit.disabled = true;
      try { await editorSubmit?.(); if (!editorAutoSave) $('editor').close(); } catch(error) { report(error); } finally { submit.disabled = false; }
    });
    global.addEventListener('bjtu-chatroom-transport-ready', () => attachTransport().catch(report), {signal:uiAbort.signal});
    function destroy() {
      if (destroyed) return;
      for (const id of dirty.keys()) saveSetting(id);
      destroyed = true; uiAbort.abort(); unsubscribe?.();
      settings?.destroy();
      if ($('editor').open) $('editor').close();
      instances.delete(root);
    }
    global.addEventListener('pagehide', destroy, {once:true,signal:uiAbort.signal});
    setReady(false); render();
    setServerStatus(global.BjtuChatroomLink?.discoveryStatus || 'disconnected');
    const confirmClear = submit => openEditor('清空记录', fields => {
      fields.append(node('p', '确定清空当前会话的本地记录并停止文件传输？')); return submit;
    });
    const controller = {ready:Promise.resolve(),render,setReady,groupEditor,leaveGroup,editPerson,confirmClear,destroy};
    instances.set(root,controller);
    controller.ready = (async () => {
      settings = await global.BjtuChatroomSettings.mount(root, report);
      if (destroyed) { settings.destroy(); return; }
      global.BjtuOptionTips?.setup();
      if (!getState) await attachTransport().catch(error => { setReady(false); report(error); });
    })();
    return controller;
  }
  global.BjtuChatroomSidebar = {mount,bindHold};
})(globalThis);
