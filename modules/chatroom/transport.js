/* Browser-only signed protocol engine. No Bridge, discovery server or STUN/TURN.
 * Link contract (all public async methods await ready):
 * getPublicIdentity() -> {id, fingerprint, nickname, publicKey: P-256 public JWK, background}.
 * makePacket(type, payload) -> {protocol, id, type, from, identity, createdAt,
 *   payload, signature}; from === identity.id. signature is base64url ECDSA
 *   SHA-256 over UTF-8 canonical JSON of every field except signature.
 * verifyPacket(packet, expectedIdentity?) -> boolean, PURE w.r.t. domain state:
 * never consumes replay IDs. Optional expectedIdentity pins the signing peer
 * (public identity object or id string); REQUIRED when authenticating a hello.
 * Identity id/fingerprint = lowercase hex SHA-256 of exported raw P-256 key.
 * Control handshake/pairing may use any type via makePacket/verifyPacket;
 * only domain packet types are consumed by handlePeerPacket(peerId, packet).
 * peerOnline(identity OR {identity, ...metadata}), peerOffline(id).
 * setLink({scan, connect, pairCreate, pairAccept, pairComplete, sendPeer, close});
 * sendPeer(peerId, signedPacket); other adapter methods receive action args.
 * action names: scan/connect/pair-create/pair-accept/pair-complete/close,
 * settings/remark/block/friend-request/friend-response/friend-delete/conversation-read/
 * conversation-mute/conversation-clear/conversation-delete/media-message/group-create/
 * group-invite/group-response/group-leave/send-message/signal.
 * subscribe(fn) -> unsubscribe; state() -> isolated domain snapshot.
 * Events: {type:'state',state}, {type:'signal',peerId,payload}, {type:'error',error}.
 * action resolves {ok:true,...} or {ok:false,error:string,...}; send results
 * include sent/failed counts (local persistence is not a remote delivery ACK).
 * Text outbox: message.status = local/queued/sending/delivered/rejected/withdrawn;
 * delivery[peerId] = {status, attempts, errorCode, error, nextRetryAt}.
 * retry/withdraw actions take {messageId}; withdraw only cancels local retries.
 * Signed message-result {messageId,status:accepted|rejected,code?} proves remote
 * acceptance or permanent refusal; each retry re-signs with the same message ID.
 * peer-policy {blocked,friendRequired} and friend-delete create read-only system
 * messages {system:true,code,senderId,conversationId,text,id,createdAt}.
 * Empty identity.nickname means use connection IP; self.ip is local metadata,
 * never a signed nickname. setLocalIP(ip) updates that metadata and emits state.
 * History: <=600 messages AND <=2 MiB UTF-8 JSON. Seen packet IDs: <=2048.
 * requireFriend restricts private messages/signals, never public/group chat.
 * Domain mutations and state snapshots share a queue. Adapter I/O runs outside
 * that queue, so adapters may await peerOnline/handlePeerPacket safely.
 */
(() => {
  'use strict';
  const G = globalThis, KEY = 'chatroomState', PROTOCOL = 'bjtu-chatroom-v1';
  const passiveOptions = !!G.location && !G.location.pathname.endsWith('/modules/chatroom/chat.html');
  const MAX = { peers: 500, rooms: 100, requests: 100, messages: 600, historyBytes: 2 * 1024 * 1024, seen: 2048, packet: 262144, members: 100 };
  const encoder = new TextEncoder(), listeners = new Set(), keyCache = new Map();
  const domainTypes = new Set(['profile', 'message', 'message-result', 'peer-policy', 'signal', 'friend-request', 'friend-response', 'friend-delete', 'group-invite', 'group-response', 'group-state', 'group-leave', 'group-event','draft']);
  const draftClocks = new Map();
  let data, privateKey, publicIdentity, link, queue = Promise.resolve();
  let retryTimer, flushing = false, disposed = false;
  let localIP = '';
  const ACK_TIMEOUT = 10000;
  const rejectionText = { BLOCKED: '对方已将你拉黑，无法发送私聊。', FRIEND_REQUIRED: '对方已删除好友或要求好友验证，请重新添加好友。', LOCAL_BLOCKED: '你已屏蔽对方，请先取消屏蔽。', INVALID_MESSAGE: '对方拒绝了无效消息。' };

  const copy = (v) => JSON.parse(JSON.stringify(v));
  function detectDevice() {
    const ua = String(G.navigator?.userAgent || '');
    const os = /Windows NT 10\.0/.test(ua) ? 'Windows 10/11'
      : /Windows NT/.test(ua) ? 'Windows'
      : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Mac OS X/.test(ua) ? 'macOS'
      : /Linux/.test(ua) ? 'Linux' : '未知系统';
    const browser = /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari' : '未知浏览器';
    const platform = String(G.navigator?.userAgentData?.platform || G.navigator?.platform || '').slice(0, 40);
    return { os, browser, platform };
  }
  function publicDevice(value) {
    const source = value?.device;
    if (!source || typeof source !== 'object') return null;
    const clean = (text, max) => typeof text === 'string' ? text.slice(0, max) : '';
    const device = { os: clean(source.os, 40), browser: clean(source.browser, 40), platform: clean(source.platform, 40) };
    return device.os || device.browser || device.platform ? device : null;
  }
  async function readLocalAccounts() {
    const store = G.browser?.storage?.local || G.chrome?.storage?.local;
    if (!store) return null;
    try {
      const stored = await store.get(['popupFullscreenCourseCache', 'academicSystemStudentId', 'username']);
      const cache = stored?.popupFullscreenCourseCache || {};
      const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
      const accounts = {
        ve: clean(cache.currentAccountLoginName, 80),
        mis: clean(stored?.academicSystemStudentId || stored?.username, 80)
      };
      return accounts.ve || accounts.mis ? accounts : null;
    } catch { return null; }
  }
  function publicAccounts(value) {
    const source = value?.accounts;
    if (!source || typeof source !== 'object') return null;
    const clean = (text, max) => typeof text === 'string' ? text.slice(0, max) : '';
    const accounts = { ve: clean(source.ve, 80), mis: clean(source.mis, 80) };
    return accounts.ve || accounts.mis ? accounts : null;
  }
  const fail = (message) => { throw new Error(message); };
  const str = (v, max, empty = false) => {
    if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) fail('字段格式或长度不正确。');
    return v;
  };
  const MAX_MESSAGE_BYTES = 16 * 1024;
  const messageText = (v, empty = false) => {
    const value = str(v, MAX_MESSAGE_BYTES, empty);
    if (encoder.encode(value).length > MAX_MESSAGE_BYTES) fail('字段格式或长度不正确。');
    return value;
  };
  const id = (v) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('无效身份。'); return v; };
  const token = (v) => str(v, 100);
  function canonical(v) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && Object.getPrototypeOf(v) === Object.prototype) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    fail('仅支持 JSON 数据。');
  }
  function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64(s) {
    str(s, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(s)) fail('签名格式不正确。');
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  }
  const hex = (bytes) => [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('');
  async function importIdentity(identity) {
    if (!identity || typeof identity !== 'object') fail('缺少公钥身份。');
    id(identity.id);
    str(identity.nickname, 40, true);
    const jwk = identity.publicKey;
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || jwk.d !== undefined) fail('无效公开密钥。');
    const cacheId = identity.id + ':' + jwk.x + ':' + jwk.y;
    if (keyCache.has(cacheId)) return keyCache.get(cacheId);
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const fingerprint = hex(await crypto.subtle.digest('SHA-256', await crypto.subtle.exportKey('raw', key)));
    if (identity.id !== fingerprint || (identity.fingerprint !== undefined && identity.fingerprint !== fingerprint)) fail('公钥与身份指纹不匹配。');
    keyCache.set(cacheId, key);
    while (keyCache.size > MAX.peers) keyCache.delete(keyCache.keys().next().value);
    return key;
  }
  function emit(event) {
    for (const fn of [...listeners]) { try { fn(copy(event)); } catch { /* Subscriber cannot break protocol. */ } }
  }
  function snapshot() {
    return copy({ self: {...publicIdentity, ip: localIP}, settings: data.settings, peers: data.peers, rooms: data.rooms, requests: data.requests, messages: data.messages, conversations: data.conversations || {} });
  }
  const storage = G.browser?.storage?.local || G.chrome?.storage?.local;
  const storageEvents = (G.browser || G.chrome)?.storage?.onChanged;
  let lastSaved = '';
  function locked(fn) {
    return G.navigator?.locks ? G.navigator.locks.request('bjtuca-chatroom-state', fn) : fn();
  }
  function applyStored(value) {
    if (!value || value.schema !== 1 || value.identity?.publicKey?.x !== data.identity.publicKey.x
        || value.identity?.publicKey?.y !== data.identity.publicKey.y) fail('聊天室身份存储已更改，请重新打开聊天室。');
    data = copy(value);
    publicIdentity.nickname = data.settings.nickname;
  }
  async function save() {
    lastSaved = JSON.stringify(data);
    await storage.set({ [KEY]: data });
  }
  function linkedPeers() {
    return data.peers.filter(p => !p.blocked && p.online && link && (!link.isConnected || link.isConnected(p.id))).map(p => p.id);
  }
  function serial(fn) {
    const task = queue.then(() => ready).then(fn);
    queue = task.catch(() => {});
    return task;
  }
  async function evictFileHandles(previous) {
    const keep = new Set(data.messages.map(m => m.fileHandleRef));
    const removed = [...new Set(previous.map(m => m.fileHandleRef).filter(key =>
      typeof key === 'string' && key.startsWith('chatroom-file:') && !keep.has(key)))];
    if (!removed.length) return;
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('BJTUCA-FileSystem', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('handles');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const privateNames = [];
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite'), store = tx.objectStore('handles');
        for (const key of removed) {
          const read = store.get(key);
          read.onsuccess = () => {
            if (read.result?.privateName) privateNames.push(read.result.privateName);
            store.delete(key);
          };
        }
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
      if (privateNames.length) {
        const inbox = await (await navigator.storage.getDirectory()).getDirectoryHandle('chatroom-inbox');
        await Promise.all(privateNames.map(name => inbox.removeEntry(name).catch(error => {
          if (error?.name !== 'NotFoundError') throw error;
        })));
      }
    } catch (error) { emit({type:'error', error:'清理本地文件引用失败：' + (error?.message || '存储不可用')}); }
    finally { db?.close(); }
  }
  async function commit(fn) {
    return serial(() => locked(async () => {
      const stored = (await storage.get(KEY))[KEY];
      if (stored) applyStored(stored);
      const before = copy(data), identityBefore = copy(publicIdentity), effects = [];
      try {
        const result = await fn(effects);
        await save();
        await evictFileHandles(before.messages);
        emit({ type: 'state', state: snapshot() });
        if (result?.event) emit(result.event);
        return { result, effects };
      } catch (error) { data = before; publicIdentity = identityBefore; throw error; }
    }));
  }
  async function deliver(effects) {
    const results = await Promise.allSettled(effects.map(async ({ peerId, type, payload }) => {
      if (type === 'message') {
        const active = await serial(() => data.messages.some(m => m.id === payload.id && m.delivery?.[peerId]?.status === 'sending'));
        if (!active) return false;
      }
      try {
        if (!link || typeof link.sendPeer !== 'function') fail('尚未连接点对点引擎。');
        const result = await link.sendPeer(peerId, await makePacket(type, payload));
        if (result === false || result?.ok === false || result?.error) fail('对方连接不可用。');
      } catch (error) {
        if (type !== 'message') throw error;
        await commit(() => {
          const m = data.messages.find(m => m.id === payload.id), d = m?.delivery?.[peerId];
          if (d?.status === 'sending') {
            Object.assign(d, { status: 'queued', errorCode: 'CONNECTION', error: error.message, nextRetryAt: Date.now() + retryDelay(d.attempts) });
            messageStatus(m);
          }
        });
        return false;
      }
    }));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) emit({ type: 'error', error: failed[0].reason?.message || '部分数据未能送达。' });
    const sent = results.filter(r => r.status === 'fulfilled' && r.value !== false).length;
    return { sent, failed: results.length - sent };
  }
  const retryDelay = attempts => Math.min(60000, 1000 * 2 ** Math.min(attempts, 6));
  function messageStatus(m) {
    const statuses = Object.values(m.delivery).map(d => d.status);
    m.status = !statuses.length ? 'local' : statuses.includes('sending') ? 'sending' : statuses.includes('queued') ? 'queued'
      : statuses.includes('rejected') ? 'rejected' : statuses.includes('withdrawn') ? 'withdrawn' : 'delivered';
  }
  function privateDenial(p) {
    return p.blockedByPeer ? 'BLOCKED' : p.friendRequiredByPeer ? 'FRIEND_REQUIRED' : '';
  }
  function systemMessage(peerId, code, text) {
    history({ id: crypto.randomUUID(), senderId: peerId, conversationId: 'peer:' + peerId,
      system: true, code, text: text || rejectionText[code] || '对方已取消拉黑。', createdAt: Date.now() });
  }
  function publicPresenceMessage(p, joined) {
    const name = p.remark || p.nickname || p.ip || p.id;
    history({ id: crypto.randomUUID(), senderId: p.id, conversationId: 'public', system: true,
      code: joined ? 'PUBLIC_ONLINE' : 'PUBLIC_OFFLINE',
      text: `${name} ${joined ? '进入了公共群聊' : '离开了公共群聊'}`, createdAt: Date.now() });
  }
  function queueMessage(m, effects, force = false, onlyPeer) {
    for (const [peerId, d] of Object.entries(m.delivery || {})) {
      if (onlyPeer && onlyPeer !== peerId) continue;
      if (d.status !== 'queued' || (!force && d.nextRetryAt > Date.now())) continue;
      const p = peer(peerId), code = !p ? 'INVALID_MESSAGE' : m.conversationId.startsWith('peer:') ? privateDenial(p) : p.blockedByPeer ? 'BLOCKED' : '';
      if (code) { Object.assign(d, { status: 'rejected', errorCode: code, error: rejectionText[code], nextRetryAt: 0 }); continue; }
      if (!p.online || !link || (link.isConnected && !link.isConnected(peerId))) continue;
      Object.assign(d, {status: 'sending', attempts: d.attempts + 1, errorCode: '', error: '', nextRetryAt: Date.now() + ACK_TIMEOUT});
      enqueue(effects, peerId, 'message', {id: m.id, senderId: m.senderId, conversationId: m.conversationId.startsWith('peer:') ? 'peer:' + peerId : m.conversationId, text: m.text, createdAt: m.createdAt});
    }
    messageStatus(m);
  }
  async function flushOutbox(onlyPeer) {
    if (flushing || disposed) return;
    flushing = true;
    try {
      const pending = await serial(() => data.messages.some(m => Object.entries(m.delivery || {}).some(([peerId, d]) => {
        if (onlyPeer && onlyPeer !== peerId) return false;
        if (d.status === 'sending') return d.nextRetryAt <= Date.now();
        const p = peer(peerId);
        return d.status === 'queued' && (onlyPeer || d.nextRetryAt <= Date.now()) && p?.online && link && (!link.isConnected || link.isConnected(peerId));
      })));
      if (!pending) return;
      const {effects} = await commit(effects => {
        for (const m of data.messages) {
          if (!m.delivery) continue;
          for (const [peerId, d] of Object.entries(m.delivery)) {
            if (onlyPeer && peerId !== onlyPeer) continue;
            if (d.status === 'sending' && d.nextRetryAt <= Date.now()) Object.assign(d, {
              status: 'queued', errorCode: 'ACK_TIMEOUT', error: '未收到对方确认，等待重试。', nextRetryAt: Date.now() + retryDelay(d.attempts)
            });
          }
          queueMessage(m, effects, !!onlyPeer, onlyPeer);
        }
      });
      await deliver(effects);
    } catch (error) { emit({type:'error', error:error.message}); }
    finally { flushing = false; }
  }
  function peer(peerId) { return data.peers.find((p) => p.id === id(peerId)); }
  function allowed(peerId, friendPolicy = true) {
    const p = peer(peerId);
    return !!p && !p.blocked && (!friendPolicy || !data.settings.requireFriend || p.friend);
  }
  function requirePeer(peerId, friendPolicy = true) {
    const p = peer(peerId);
    if (!allowed(peerId, friendPolicy)) fail('对方已被屏蔽或不符合好友策略。');
    if (!p.online) fail('对方不在线，请重新配对。');
    return p;
  }
  function sharedGroup(peerId) { return data.rooms.some((r) => r.members.includes(publicIdentity.id) && r.members.includes(peerId)); }
  function room(roomId) {
    const r = data.rooms.find((r) => r.id === token(roomId));
    if (!r || !r.members.includes(publicIdentity.id)) fail('你不是该群成员。');
    return r;
  }
  function pushRequest(r, outgoing = false) {
    const list = outgoing ? data.outgoing : data.requests;
    if (list.some((x) => x.id === r.id)) return;
    if (list.length >= MAX.requests) fail('待处理请求过多，请先处理现有请求。');
    list.push(r);
  }
  function enqueue(effects, peerId, type, payload) { effects.push({ peerId, type, payload: copy(payload) }); }
  function fanout(effects, ids, type, payload) {
    for (const target of new Set(ids)) if (target !== publicIdentity.id && allowed(target, false) && peer(target).online) enqueue(effects, target, type, payload);
  }
  function history(message) {
    const view = conversationView(message.conversationId);
    view.hidden = false; view.lastText = message.text; view.lastMessageId = message.id;
    view.lastAt = Date.now(); view.lastSenderId = message.senderId;
    view.lastOwn = message.senderId === publicIdentity.id;
    if (message.senderId !== publicIdentity.id) view.unread = Math.min(999999, view.unread + 1);
    data.messages.push(message);
    if (data.messages.length > MAX.messages) data.messages.splice(0, data.messages.length - MAX.messages);
    trimHistory();
  }
  function conversationView(conversationId) {
    data.conversations ||= {};
    if (!Object.hasOwn(data.conversations, conversationId)) Object.defineProperty(data.conversations, conversationId, {
      enumerable: true, configurable: true, writable: true, value: {unread: 0, muted: false, hidden: false}
    });
    return data.conversations[conversationId];
  }
  function trimHistory() {
    let bytes = 0, start = data.messages.length;
    while (start > 0) {
      const size = encoder.encode(JSON.stringify(data.messages[start - 1])).length;
      if (bytes + size > MAX.historyBytes) break;
      bytes += size; start--;
    }
    if (start) data.messages.splice(0, start);
  }
  function validRoom(value) {
    if (!value || typeof value !== 'object') fail('无效群信息。');
    token(value.id); str(value.name, 60);
    if (!/^group:[A-Za-z0-9-]{1,80}$/.test(value.id)) fail('无效群标识。');
    if (!Number.isSafeInteger(value.version) || value.version < 1 || !Array.isArray(value.members) || value.members.length > MAX.members || new Set(value.members).size !== value.members.length) fail('无效群成员版本。');
    value.members.forEach(id);
    const memberStates = value.memberStates || Object.fromEntries(value.members.map(member => [member, {version:value.version, actor:member, present:true}]));
    if (!memberStates || typeof memberStates !== 'object' || Array.isArray(memberStates) || Object.keys(memberStates).length > MAX.peers) fail('群成员状态过多。');
    for (const [member, state] of Object.entries(memberStates)) {
      id(member); id(state.actor);
      if (!Number.isSafeInteger(state.version) || state.version < 1 || typeof state.present !== 'boolean') fail('无效成员状态。');
    }
    const members = Object.keys(memberStates).filter(member => memberStates[member].present);
    if (members.length > MAX.members || members.length !== value.members.length || members.some(member => !value.members.includes(member))) fail('群成员状态不一致。');
    return {id:value.id, name:value.name, version:Math.max(value.version, ...Object.values(memberStates).map(state => state.version)), members, memberStates:copy(memberStates)};
  }
  function setMember(r, member, present) {
    // Independent membership clocks preserve departures during concurrent joins.
    if (present && !r.members.includes(member) && r.members.length >= MAX.members) fail('群成员数量已达到上限。');
    r.memberStates ||= Object.fromEntries(r.members.map(member => [member, {version:r.version, actor:member, present:true}]));
    if (!r.memberStates[member] && Object.keys(r.memberStates).length >= MAX.peers) fail('群成员历史已达上限。');
    r.memberStates[member] = {version:++r.version, actor:publicIdentity.id, present};
    r.members = Object.keys(r.memberStates).filter(key => r.memberStates[key].present);
  }
  function removeMember(effects, r, member) {
    if (!r.members.includes(member)) return;
    const oldMembers = [...r.members]; setMember(r, member, false);
    data.outgoing = data.outgoing.filter(request => request.roomId !== r.id || request.to !== member);
    for (const message of data.messages) if (message.conversationId === r.id && message.delivery?.[member] && message.delivery[member].status !== 'delivered') {
      Object.assign(message.delivery[member], {status:'withdrawn', error:'', errorCode:'', nextRetryAt:0}); messageStatus(message);
    }
    groupBroadcast(effects, r, oldMembers);
  }
  function groupEvent(r, actor, requestId, target, targetName, actorName) {
    const eventId = `${actor}:invite:${requestId}`;
    if (data.messages.some(message => message.id === eventId)) return;
    const name = who => who === publicIdentity.id ? (publicIdentity.nickname || localIP || '我') : peer(who)?.remark || peer(who)?.nickname || peer(who)?.ip || who;
    history({id:eventId, senderId:actor, conversationId:r.id, system:true, code:'GROUP_INVITE',
      text:`「${actorName || name(actor)}」邀请「${targetName || name(target)}」加入群聊。`, createdAt:Date.now()});
  }
  function groupBroadcast(effects, r, oldMembers = []) { fanout(effects, [...oldMembers, ...r.members], 'group-state', { room: r }); }
  function announceJoin(effects, r, inviter, requestId, target) {
    // The invitee is the authority for "I joined": broadcast the updated member
    // list first so every recipient knows the new member before the event arrives.
    groupBroadcast(effects, r);
    const inviterPeer = peer(inviter);
    const targetPeer = peer(target);
    const event = {
      roomId: r.id,
      requestId,
      actor: inviter,
      target,
      targetName: targetPeer?.remark || targetPeer?.nickname || targetPeer?.ip || target,
      actorName: inviterPeer?.nickname || inviterPeer?.ip || inviter
    };
    groupEvent(r, inviter, requestId, target, event.targetName, event.actorName);
    fanout(effects, r.members, 'group-event', event);
  }
  function joinRoom(value) {
    const r = validRoom(value);
    if (!data.rooms.some(room => room.id === r.id) && data.rooms.length >= MAX.rooms) fail('群聊数量已达到上限。');
    setMember(r, publicIdentity.id, true);
    data.rooms = data.rooms.filter(room => room.id !== r.id); data.rooms.push(r);
    data.departedRooms = data.departedRooms.filter(room => room.roomId !== r.id);
  }
  function invite(effects, r, peerIds) {
    if (!Array.isArray(peerIds) || !peerIds.length || peerIds.length > MAX.members) fail('请选择有效邀请成员。');
    for (const peerId of new Set(peerIds)) {
      id(peerId);
      if (r.members.includes(peerId)) continue;
      requirePeer(peerId, false);
      if (data.outgoing.some((x) => x.type === 'group' && x.to === peerId && x.roomId === r.id)) continue;
      const requestId = crypto.randomUUID();
      pushRequest({ id: requestId, type: 'group', to: peerId, roomId: r.id, createdAt: Date.now() }, true);
      const event = {roomId:r.id, requestId, target:peerId, targetName:peer(peerId)?.nickname || peer(peerId)?.ip || peerId, actorName:publicIdentity.nickname || localIP || '我'};
      enqueue(effects, peerId, 'group-invite', { requestId, room: r, event });
    }
  }
  async function initialize() {
    if (!storage || !crypto?.subtle) fail('需要浏览器扩展本地存储和 Web Crypto。');
    const stored = (await storage.get(KEY))[KEY];
    if (stored && stored.schema !== 1) fail('聊天室存储版本不兼容，未覆盖现有身份。');
    if (stored) {
      data = copy(stored);
      if (!data.identity?.privateKey || !data.identity?.publicKey) fail('身份存储不完整，未重置原身份。');
      privateKey = await crypto.subtle.importKey('jwk', data.identity.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    } else {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      privateKey = pair.privateKey;
      data = { schema: 1, identity: { privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) }, settings: { nickname: '', requireFriend: false, invitePolicyStranger: 'ask', invitePolicyFriend: 'ask' }, peers: [], rooms: [], requests: [], outgoing: [], messages: [], seen: [] };
    }
    const previousMessages = Array.isArray(data.messages) ? data.messages.slice() : [];
    for (const [name, limit] of Object.entries({ peers: MAX.peers, rooms: MAX.rooms, requests: MAX.requests, outgoing: MAX.requests, messages: MAX.messages, seen: MAX.seen })) {
      if (!Array.isArray(data[name])) fail('聊天室存储数据损坏，未覆盖原数据。');
      data[name] = data[name].slice(-limit);
    }
    data.rooms = data.rooms.map(validRoom);
    data.departedRooms ||= [];
    const validInvitePolicy = (value, fallback) => ['ask', 'allow', 'deny'].includes(value) ? value : fallback;
    data.settings = {
      nickname: str(data.settings?.nickname || '', 40, true),
      requireFriend: data.settings?.requireFriend === true,
      invitePolicyStranger: validInvitePolicy(data.settings?.invitePolicyStranger, 'ask'),
      invitePolicyFriend: validInvitePolicy(data.settings?.invitePolicyFriend, 'ask')
    };
    const pub = await crypto.subtle.importKey('jwk', data.identity.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const fingerprint = hex(await crypto.subtle.digest('SHA-256', await crypto.subtle.exportKey('raw', pub)));
    if (data.settings.nickname === '设备-' + fingerprint.slice(0, 6)) data.settings.nickname = '';
    publicIdentity = { id: fingerprint, fingerprint, nickname: data.settings.nickname, publicKey: data.identity.publicKey,
      background: G.BjtuChatroomBackgroundMode?.enabled === true, device: detectDevice(), accounts: await readLocalAccounts() };
    await importIdentity(publicIdentity);
    const proof = encoder.encode('bjtu-chatroom-identity-check');
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, proof), proof)) fail('持久身份密钥不匹配。');
    if (!passiveOptions) data.peers.forEach((p) => { p.online = false; });
    data.receipts ||= [];
    for (const m of data.messages) if (!passiveOptions && m.delivery) {
      for (const d of Object.values(m.delivery)) if (d.status === 'sending') { d.status = 'queued'; d.nextRetryAt = 0; }
      messageStatus(m);
    }
    trimHistory();
    if (!stored || !passiveOptions) {
      await save();
      await evictFileHandles(previousMessages);
    }
  }
  function refreshAccounts() {
    return serial(async () => {
      const accounts = await readLocalAccounts();
      if (accounts) publicIdentity.accounts = accounts;
      else delete publicIdentity.accounts;
      return accounts;
    });
  }
  const ready = locked(initialize);
  ready.then(() => { if (!passiveOptions) { retryTimer = setInterval(() => void flushOutbox(), 1000); retryTimer.unref?.(); } }).catch(() => {});
  // Attach a handler without changing the rejecting ready Promise exposed to callers.
  ready.catch((error) => emit({ type: 'error', error: error.message }));
  const onStorageChanged = (changes, area) => {
    if (area !== 'local' || !changes[KEY]?.newValue || JSON.stringify(changes[KEY].newValue) === lastSaved) return;
    void serial(async () => {
      const nickname = publicIdentity.nickname;
      applyStored((await storage.get(KEY))[KEY]);
      emit({ type: 'state', state: snapshot() });
      return nickname !== publicIdentity.nickname;
    }).then(changed => {
      if (!changed || passiveOptions) return;
      return deliver(linkedPeers().map(peerId => ({peerId, type:'profile', payload:{}})));
    }).catch(error => emit({ type: 'error', error: error.message }));
  };
  storageEvents?.addListener(onStorageChanged);
  G.addEventListener?.('pagehide', () => { disposed = true; clearInterval(retryTimer); storageEvents?.removeListener(onStorageChanged); }, {once:true});

  async function makePacket(type, payload = {}) {
    await ready;
    str(type, 64);
    const identity = await serial(() => copy(publicIdentity));
    const packet = { protocol: PROTOCOL, id: crypto.randomUUID(), type, from: identity.id, identity, createdAt: Date.now(), payload: copy(payload) };
    const bytes = encoder.encode(canonical(packet));
    if (bytes.length > MAX.packet - 200) fail('协议包过大。');
    packet.signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes));
    return packet;
  }
  async function verifyPacket(value, expectedIdentity) {
    try {
      await ready;
      const encoded = typeof value === 'string' ? value : JSON.stringify(value);
      if (typeof encoded !== 'string' || encoder.encode(encoded).length > MAX.packet) return false;
      const packet = JSON.parse(encoded);
      if (packet.protocol !== PROTOCOL || packet.from !== packet.identity?.id || !packet.payload || typeof packet.payload !== 'object') return false;
      if (expectedIdentity !== undefined && packet.from !== (typeof expectedIdentity === 'string' ? expectedIdentity : expectedIdentity?.id)) return false;
      if (Object.keys(packet).sort().join(',') !== 'createdAt,from,id,identity,payload,protocol,signature,type') return false;
      token(packet.id); str(packet.type, 64);
      if (!Number.isSafeInteger(packet.createdAt) || Math.abs(Date.now() - packet.createdAt) > 10 * 60 * 1000) return false;
      const key = await importIdentity(packet.identity), signature = unb64(packet.signature);
      delete packet.signature;
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, encoder.encode(canonical(packet)));
    } catch { return false; }
  }
  async function peerOnline(value) {
    await ready;
    const identity = copy(value?.identity || value);
    await importIdentity(identity);
    return commit((effects) => {
      if (identity.id === publicIdentity.id) fail('不能连接自身。');
      let p = peer(identity.id);
      if (!p) {
        if (data.peers.length >= MAX.peers) fail('联系人数量已达到上限。');
        p = { id: identity.id, friend: false, blocked: false, remark: '' };
        data.peers.push(p);
      }
      p.nickname = identity.nickname;
      p.background = identity.background === true;
      const device = publicDevice(identity);
      if (device) p.device = device; else delete p.device;
      const accounts = publicAccounts(identity);
      if (accounts) p.accounts = accounts; else delete p.accounts;
      if (typeof value?.ip === 'string') p.ip = str(value.ip, 64, true);
      p.publicKey = { kty: 'EC', crv: 'P-256', x: identity.publicKey.x, y: identity.publicKey.y, ext: true, key_ops: ['verify'] };
      p.fingerprint = identity.id;
      const wasOnline = p.online === true;
      p.online = true; p.lastSeen = Date.now();
      if (!wasOnline) publicPresenceMessage(p, true);
      p.reconnectable = value.reconnectable === true;
      for (const r of data.rooms) if (r.members.includes(p.id)) groupBroadcast(effects, r);
      for (const departed of data.departedRooms) if (departed.pending.includes(p.id)) {
        enqueue(effects, p.id, 'group-leave', {roomId:departed.roomId});
        departed.pending = departed.pending.filter(member => member !== p.id);
      }
      data.departedRooms = data.departedRooms.filter(item => item.pending.length);
      enqueue(effects, p.id, 'peer-policy', {blocked: !!p.blocked, friendRequired: data.settings.requireFriend && !p.friend});
      if (p.pendingFriendDelete && p.online) {
        enqueue(effects, p.id, 'friend-delete', {friendRequired:data.settings.requireFriend}); p.pendingFriendDelete = false;
      }
      return { ok: true, peerId: p.id };
    }).then(async ({ result, effects }) => { await deliver(effects); await flushOutbox(result.peerId); return result; });
  }
  async function peerOffline(peerId) {
    return commit(effects => {
      const p = peer(peerId);
      const wasOnline = p?.online === true;
      if (p) p.online = false;
      if (p && wasOnline) publicPresenceMessage(p, false);
      if (p && !p.reconnectable) for (const r of data.rooms) removeMember(effects, r, peerId);
      return {ok:true};
    }).then(async ({result, effects}) => {await deliver(effects); return result;});
  }
  async function action(name, args = {}) {
    await ready;
    args = copy(args);
    if (name === 'draft') {
      const text = messageText(args.text, true), conversationId = token(args.conversationId), draftId = token(args.draftId);
      if (!Number.isSafeInteger(args.revision) || args.revision < 1) fail('无效草稿版本。');
      const targets = await serial(() => {
        if (conversationId.startsWith('peer:')) {
          const p = peer(conversationId.slice(5));
          if (!p || privateDenial(p)) return [];
          return p.online && (!text || !p.background) ? [p.id] : [];
        }
        const members = conversationId === 'public' ? data.peers.map(p => p.id) : room(conversationId).members;
        return members.filter(member => member !== publicIdentity.id && peer(member)?.online && !peer(member).blockedByPeer && (!text || !peer(member).background));
      });
      const result = await deliver(targets.map(peerId => ({peerId,type:'draft',payload:{text,conversationId:conversationId.startsWith('peer:') ? 'peer:' + peerId : conversationId,draftId,revision:args.revision}})));
      return {ok:true, ...result};
    }
    const method = { scan: 'scan', connect: 'connect', 'pair-create': 'pairCreate', 'pair-accept': 'pairAccept', 'pair-complete': 'pairComplete', close: 'close' }[name];
    if (method) {
      if (!link || typeof link[method] !== 'function') fail('当前浏览器连接引擎不支持此操作。');
      return await link[method](args);
    }
    const { result, effects } = await commit((effects) => localAction(name, args, effects));
    const delivery = await deliver(effects);
    if (result?.messageId) {
      const message = await serial(() => data.messages.find(m => m.id === result.messageId));
      return {...result, ...delivery, ok: true, status: message?.status};
    }
    return { ...result, ...delivery, ok: delivery.failed === 0, ...(delivery.failed ? { error: delivery.sent ? '部分接收者未能送达，请检查连接。' : '数据未送达，请重新连接。' } : {}) };
  }
  function localAction(name, args, effects) {
    switch (name) {
      case 'set-background': {
        const background = args.background === true;
        const changed = publicIdentity.background !== background;
        publicIdentity.background = background;
        // A peer may have captured the old identity in a handshake that was
        // still in flight. Refresh the profile periodically while a
        // foreground client is attached so the flag cannot stay stale.
        if (changed || args.force === true) {
          for (const peerId of linkedPeers()) effects.push({peerId, type:'profile', payload:{}});
        }
        return {};
      }
      case 'conversation-read': {
        const view = conversationView(token(args.conversationId));
        if (view.lastMessageId === args.lastMessageId) view.unread = 0;
        return {unread:view.unread,lastMessageId:view.lastMessageId};
      }
      case 'conversation-remark': {
        const conversationId = token(args.conversationId), remark = str(args.remark,80,true).trim();
        if (conversationId.startsWith('peer:')) {
          const p = peer(conversationId.slice(5)); if (!p) fail('联系人不存在。');
          p.remark = remark;
        } else conversationView(conversationId).remark = remark;
        return {};
      }
      case 'conversation-mute': {
        if (typeof args.muted !== 'boolean') fail('无效免打扰状态。');
        conversationView(token(args.conversationId)).muted = args.muted; return {};
      }
      case 'conversation-clear':
      case 'conversation-delete': {
        const id = token(args.conversationId), view = conversationView(id);
        data.messages = data.messages.filter(message => message.conversationId !== id);
        Object.assign(view, {unread: 0, lastText: '', lastAt: 0, lastMessageId: '', lastSenderId: ''});
        if (name === 'conversation-delete') view.hidden = true;
        return {};
      }
      case 'media-message': {
        const conversationId = token(args.conversationId), senderId = id(args.senderId);
        if (senderId !== publicIdentity.id && !peer(senderId)) fail('未知媒体消息发送者。');
        const messageId = senderId + ':' + token(args.messageId);
        if (!data.messages.some(message => message.id === messageId)) history({
          id: messageId, senderId, conversationId, text: str(args.text, 240), createdAt: Date.now(), media: true
        });
        return {};
      }
      case 'media-file-saved': {
        const message = data.messages.find(m => m.id === str(args.id, 201));
        if (!message?.media) fail('接收文件记录已清除或无效。');
        const name = str(args.file?.name, 180), size = args.file?.size;
        if (!Number.isSafeInteger(size) || size < 0 || args.fileHandleRef !== 'chatroom-file:' + message.id) fail('无效本地文件记录。');
        message.file = {name, size}; message.fileHandleRef = args.fileHandleRef;
        const downloadPath = str(args.downloadPath || '', 240);
        if (/^downloads\/[^/]+$/i.test(downloadPath)) message.downloadPath = downloadPath;
        else delete message.downloadPath;
        if (args.privateFile === true && !message.downloadPath) message.privateFile = true;
        else delete message.privateFile;
        trimHistory();
        if (!data.messages.includes(message)) fail('文件记录超出历史记录上限。');
        return {};
      }
      case 'media-file-deleted': {
        const message = data.messages.find(m => m.id === str(args.id, 201));
        if (!message?.media) fail('接收文件记录已清除或无效。');
        delete message.file;
        delete message.fileHandleRef;
        delete message.downloadPath;
        delete message.privateFile;
        return {};
      }
      case 'settings': {
        if (args.nickname !== undefined) data.settings.nickname = str(args.nickname, 40, true).trim();
        if (args.requireFriend !== undefined) { if (typeof args.requireFriend !== 'boolean') fail('无效好友策略。'); data.settings.requireFriend = args.requireFriend; }
        for (const key of ['invitePolicyStranger', 'invitePolicyFriend']) {
          if (args[key] === undefined) continue;
          if (!['ask', 'allow', 'deny'].includes(args[key])) fail('无效邀请策略。');
          data.settings[key] = args[key];
        }
        publicIdentity.nickname = data.settings.nickname;
        fanout(effects, linkedPeers(), 'profile', {});
        for (const p of data.peers.filter(p => p.online)) enqueue(effects, p.id, 'peer-policy', {blocked: !!p.blocked, friendRequired: data.settings.requireFriend && !p.friend});
        if (data.settings.invitePolicyStranger === 'deny') {
          data.requests = data.requests.filter((r) => r.type !== 'group' || peer(r.from)?.friend === true);
        }
        if (data.settings.invitePolicyFriend === 'deny') {
          data.requests = data.requests.filter((r) => r.type !== 'group' || peer(r.from)?.friend !== true);
        }
        return {};
      }
      case 'remark': {
        const p = peer(args.peerId); if (!p) fail('联系人不存在。');
        p.remark = str(args.remark, 80, true); return {};
      }
      case 'block': {
        const p = peer(args.peerId); if (!p) fail('联系人不存在。');
        if (typeof args.blocked !== 'boolean') fail('无效拉黑状态。');
        p.blocked = args.blocked;
        if (typeof link?.isConnected === 'function') p.online = link.isConnected(p.id);
        if (p.online) enqueue(effects, p.id, 'peer-policy', {blocked: p.blocked, friendRequired: data.settings.requireFriend && !p.friend});
        if (p.blocked) {
          data.requests = data.requests.filter((r) => r.from !== p.id);
          data.outgoing = data.outgoing.filter((r) => r.to !== p.id);
        }
        return {};
      }
      case 'friend-request': {
        const p = requirePeer(args.peerId, false);
        if (p.friend) return {};
        const incoming = data.requests.find((r) => r.type === 'friend' && r.from === p.id);
        if (incoming) {
          p.friend = true; p.friendRequiredByPeer = false;
          data.requests = data.requests.filter((r) => r !== incoming);
          data.outgoing = data.outgoing.filter((r) => r.type !== 'friend' || r.to !== p.id);
          enqueue(effects, p.id, 'friend-response', { requestId: incoming.id, allow: true });
          enqueue(effects, p.id, 'peer-policy', { blocked: !!p.blocked, friendRequired: false });
          systemMessage(p.id, 'FRIEND_ACCEPTED_LOCAL', '你已同意好友申请，现在已成为好友。');
          return { requestId: incoming.id, accepted: true };
        }
        if (data.outgoing.some((r) => r.type === 'friend' && r.to === p.id)) return {};
        const requestId = crypto.randomUUID();
        pushRequest({ id: requestId, type: 'friend', to: p.id, createdAt: Date.now() }, true);
        systemMessage(p.id, 'FRIEND_REQUEST_SENT', '你已发送好友申请，等待对方确认。');
        enqueue(effects, p.id, name, { requestId }); return { requestId };
      }
      case 'friend-delete': {
        const p = peer(args.peerId); if (!p) fail('联系人不存在。');
        p.friend = false;
        data.outgoing = data.outgoing.filter(request => request.type !== 'friend' || request.to !== p.id);
        data.requests = data.requests.filter(request => request.type !== 'friend' || request.from !== p.id);
        if (p.online) enqueue(effects, p.id, 'friend-delete', {friendRequired:data.settings.requireFriend}); else p.pendingFriendDelete = true;
        return {};
      }
      case 'friend-response':
      case 'group-response': {
        const type = name === 'friend-response' ? 'friend' : 'group';
        const request = data.requests.find((r) => r.id === token(args.requestId) && r.type === type);
        if (!request) fail('请求不存在或已处理。');
        if (typeof args.allow !== 'boolean') fail('无效请求决定。');
        if (args.allow && (args.blockSender || args.blockAll)) fail('不能同时接受并屏蔽邀请。');
        if (args.allow) requirePeer(request.from, false);
        if (type === 'friend') {
          if (args.allow) {
            const p = peer(request.from); p.friend = true; p.friendRequiredByPeer = false;
            enqueue(effects, p.id, 'peer-policy', {blocked: !!p.blocked, friendRequired: false});
          }
          systemMessage(request.from, args.allow ? 'FRIEND_ACCEPTED_LOCAL' : 'FRIEND_REJECTED_LOCAL', args.allow ? '你已同意好友申请，现在已成为好友。' : '你已拒绝好友申请。');
        } else if (args.allow) {
          joinRoom(request.room);
        }
        enqueue(effects, request.from, name, { requestId: request.id, allow: args.allow, ...(type === 'group' ? { roomId: request.room.id } : {}) });
        if (type === 'group' && args.allow) announceJoin(effects, request.room, request.from, request.id, publicIdentity.id);
        data.requests = data.requests.filter((r) => r.id !== request.id);
        if (args.blockSender) {
          const p = peer(request.from); p.blocked = true;
          enqueue(effects, p.id, 'peer-policy', {blocked:true, friendRequired:data.settings.requireFriend && !p.friend});
          data.requests = data.requests.filter((r) => r.from !== request.from);
        }
        if (args.blockAll) { data.settings.invitePolicyStranger = 'deny'; data.settings.invitePolicyFriend = 'deny'; data.requests = data.requests.filter((r) => r.type !== 'group'); }
        return {};
      }
      case 'group-create': {
        if (data.rooms.length >= MAX.rooms) fail('群聊数量已达到上限。');
        const r = validRoom({id:'group:' + crypto.randomUUID(), name:str(args.name, 60).trim(), version:1, members:[publicIdentity.id]});
        data.rooms.push(r); invite(effects, r, args.peerIds); return { roomId: r.id };
      }
      case 'group-invite': {
        const r = room(args.roomId);
        invite(effects, r, args.peerIds);
        return {};
      }
      case 'group-leave': {
        const r = room(args.roomId);
        fanout(effects, r.members, 'group-leave', {roomId:r.id});
        const pending = r.members.filter(member => member !== publicIdentity.id && !peer(member)?.online);
        if (pending.length) data.departedRooms = [...data.departedRooms.filter(item => item.roomId !== r.id), {roomId:r.id, pending}].slice(-MAX.rooms);
        data.rooms = data.rooms.filter((v) => v.id !== r.id);
        data.outgoing = data.outgoing.filter((v) => v.roomId !== r.id);
        data.requests = data.requests.filter((v) => v.room?.id !== r.id);
        if (data.conversations) delete data.conversations[r.id];
        return {};
      }
      case 'send-message': {
        const text = messageText(args.text), conversationId = token(args.conversationId);
        let targets;
        if (conversationId === 'public') targets = data.peers.filter((p) => p.online && p.id !== publicIdentity.id && !p.blockedByPeer).map((p) => p.id);
        else if (conversationId.startsWith('peer:')) {
          const p = peer(conversationId.slice(5)); if (!p) fail('联系人不存在。');
          const code = privateDenial(p); if (code) fail(rejectionText[code]);
          targets = [p.id];
        }
        else targets = room(conversationId).members.filter((p) => p !== publicIdentity.id && peer(p) && !peer(p).blockedByPeer);
        const message = { id: crypto.randomUUID(), senderId: publicIdentity.id, conversationId, text, createdAt: Date.now(), delivery: {} };
        for (const target of targets) message.delivery[target] = { status: 'queued', attempts: 0, errorCode: '', error: '', nextRetryAt: 0 };
        queueMessage(message, effects);
        history(message); return { messageId: message.id };
      }
      case 'retry':
      case 'withdraw': {
        const m = data.messages.find(m => m.id === token(args.messageId) && m.senderId === publicIdentity.id && m.delivery && !m.media && !m.system);
        if (!m) fail('找不到可重试的文本消息。');
        if (['delivered', 'withdrawn', 'local'].includes(m.status)) fail('消息已确认、仅本地保存或已取消重试。');
        for (const d of Object.values(m.delivery)) {
          if (['delivered', 'withdrawn'].includes(d.status)) continue;
          Object.assign(d, {status: name === 'withdraw' ? 'withdrawn' : 'queued', nextRetryAt: 0});
        }
        queueMessage(m, effects, true);
        return {messageId: m.id};
      }
      case 'signal':
        requirePeer(args.peerId, !sharedGroup(args.peerId)); enqueue(effects, args.peerId, name, { to: args.peerId, signal: args.payload }); return {};
      default: fail('不支持的聊天室操作：' + String(name).slice(0, 64));
    }
  }
  function receive(packet, effects) {
    const from = packet.from, payload = packet.payload;
    if (packet.type === 'message-result') {
      token(payload.messageId);
      if (!['accepted', 'rejected'].includes(payload.status)) fail('无效消息回执。');
      if (payload.status === 'rejected' && !['BLOCKED', 'FRIEND_REQUIRED', 'INVALID_MESSAGE','NOT_MEMBER'].includes(payload.code)) fail('无效拒绝原因。');
      const m = data.messages.find(m => m.senderId === publicIdentity.id && m.id === payload.messageId), d = m?.delivery?.[from];
      if (!d || d.status === 'delivered') return null;
      // A late accepted ACK is still proof of delivery after local cancellation.
      if (d.status === 'withdrawn' && payload.status !== 'accepted') return null;
      Object.assign(d, {status: payload.status === 'accepted' ? 'delivered' : 'rejected', errorCode: payload.code || '', error: rejectionText[payload.code] || '', nextRetryAt: 0});
      if (payload.status === 'rejected' && m.conversationId.startsWith('group:') && ['INVALID_MESSAGE','NOT_MEMBER'].includes(payload.code)) {
        const r = data.rooms.find(room => room.id === m.conversationId);
        if (r) removeMember(effects, r, from);
      }
      if (payload.status === 'rejected' && m.conversationId.startsWith('peer:')) {
        const p = peer(from);
        if (payload.code === 'BLOCKED' && !p.blockedByPeer) { p.blockedByPeer = true; systemMessage(from, 'BLOCKED'); }
        if (payload.code === 'FRIEND_REQUIRED' && !p.friendRequiredByPeer) { p.friendRequiredByPeer = true; p.friend = false; systemMessage(from, 'FRIEND_REQUIRED'); }
      }
      messageStatus(m);
      return null;
    }
    if (packet.type === 'peer-policy' || packet.type === 'friend-delete') {
      const p = peer(from);
      if (packet.type === 'peer-policy' && (typeof payload.blocked !== 'boolean' || typeof payload.friendRequired !== 'boolean')) fail('无效联系人策略。');
      const blocked = packet.type === 'peer-policy' ? payload.blocked : !!p.blockedByPeer;
      if (typeof payload.friendRequired !== 'boolean') fail('无效好友联系策略。');
      const friendRequired = payload.friendRequired;
      if (blocked !== !!p.blockedByPeer) systemMessage(from, blocked ? 'BLOCKED' : 'UNBLOCKED');
      if (packet.type === 'friend-delete') systemMessage(from, 'FRIEND_DELETED', '对方已删除好友。');
      else if (friendRequired && !p.friendRequiredByPeer) systemMessage(from, 'FRIEND_REQUIRED');
      p.blockedByPeer = blocked; p.friendRequiredByPeer = friendRequired;
      if (friendRequired) p.friend = false;
      if (packet.type === 'friend-delete') p.friend = false;
      for (const m of data.messages) {
        const d = m.delivery?.[from];
        if (!d || !['queued', 'sending'].includes(d.status) || !m.conversationId.startsWith('peer:')) continue;
        const code = blocked ? 'BLOCKED' : friendRequired ? 'FRIEND_REQUIRED' : '';
        if (code) { Object.assign(d, {status:'rejected', errorCode:code, error:rejectionText[code], nextRetryAt:0}); messageStatus(m); }
      }
      return null;
    }
    if (packet.type === 'message') {
      messageText(payload.text); token(payload.id); token(payload.conversationId);
      if (payload.senderId !== from || !Number.isSafeInteger(payload.createdAt) || payload.createdAt < 0 || payload.createdAt > packet.createdAt + 60000) fail('消息身份或时间不匹配。');
      const receiptId = from + ':' + payload.id;
      data.receipts ||= [];
      if (data.receipts.includes(receiptId) || data.messages.some(m => m.id === receiptId)) {
        enqueue(effects, from, 'message-result', {messageId:payload.id, status:'accepted'}); return null;
      }
      const privateMessage = payload.conversationId.startsWith('peer:');
      if (payload.conversationId.startsWith('group:')) {
        const r = data.rooms.find(room => room.id === payload.conversationId);
        if (!r?.members.includes(publicIdentity.id) || !r.members.includes(from)) {
          enqueue(effects, from, 'message-result', {messageId:payload.id, status:'rejected', code:'NOT_MEMBER'}); return null;
        }
      }
      const code = peer(from).blocked ? 'BLOCKED' : privateMessage && !allowed(from) ? 'FRIEND_REQUIRED' : '';
      if (code) { enqueue(effects, from, 'message-result', {messageId:payload.id, status:'rejected', code}); return null; }
    }
    if (!allowed(from, false)) fail('接收策略拒绝此用户。');
    switch (packet.type) {
      case 'friend-delete': peer(from).friend = false; break;
      case 'profile': {
        peer(from).nickname = packet.identity.nickname;
        peer(from).background = packet.identity.background === true;
        const accounts = publicAccounts(packet.identity);
        if (accounts) peer(from).accounts = accounts; else delete peer(from).accounts;
        break;
      }
      case 'message': {
        messageText(payload.text); token(payload.id); token(payload.conversationId);
        if (payload.senderId !== from || !Number.isSafeInteger(payload.createdAt) || payload.createdAt > packet.createdAt + 60000) fail('消息身份或时间不匹配。');
        let conversationId = payload.conversationId;
        if (conversationId.startsWith('peer:')) {
          if (!allowed(from)) fail('私聊需要先添加好友。');
          if (conversationId !== 'peer:' + publicIdentity.id) fail('私聊接收者不匹配。');
          conversationId = 'peer:' + from;
        } else if (conversationId !== 'public') {
          const r = room(conversationId); if (!r.members.includes(from)) fail('发送者不是群成员。');
        }
        // The UI keys by message.id alone: namespace untrusted sender IDs so a
        // peer cannot replace another sender's rendered message via a collision.
        const messageId = from + ':' + payload.id;
        if (!data.messages.some((m) => m.id === messageId)) history({ id: messageId, senderId: from, conversationId, text: payload.text, createdAt: payload.createdAt });
        data.receipts.push(messageId); data.receipts = data.receipts.slice(-MAX.seen);
        enqueue(effects, from, 'message-result', {messageId:payload.id, status:'accepted'});
        return {type:'message-received', peerId:from, conversationId, createdAt:payload.createdAt};
      }
      case 'signal':
        if (!allowed(from) && !sharedGroup(from)) fail('直连信令需要先添加好友或加入同一群聊。');
        if (payload.to !== publicIdentity.id || !payload.signal || typeof payload.signal !== 'object' || encoder.encode(JSON.stringify(payload.signal)).length > 65536) fail('无效或非本人的信令。');
        return { type: 'signal', peerId: from, payload: payload.signal };
      case 'friend-request':
        token(payload.requestId);
        if (!peer(from).friend && !data.requests.some((r) => r.type === 'friend' && r.from === from)) {
          pushRequest({ id: payload.requestId, from, type: 'friend', createdAt: packet.createdAt });
          systemMessage(from, 'FRIEND_REQUEST_RECEIVED', '对方向你发送了好友申请，请在「邀请与确认」中处理。');
        }
        break;
      case 'friend-response': {
        if (typeof payload.allow !== 'boolean') fail('无效好友回应。');
        const pending = data.outgoing.find((r) => r.type === 'friend' && r.id === payload.requestId && r.to === from);
        if (!pending) fail('不存在对应的好友请求。');
        if (payload.allow) { peer(from).friend = true; peer(from).friendRequiredByPeer = false; }
        systemMessage(from, payload.allow ? 'FRIEND_ACCEPTED_REMOTE' : 'FRIEND_REJECTED_REMOTE', payload.allow ? '对方已同意你的好友申请，现在已成为好友。' : '对方已拒绝你的好友申请。');
        data.outgoing = data.outgoing.filter((r) => r !== pending); break;
      }
      case 'group-invite': {
        token(payload.requestId); const r = validRoom(payload.room);
        if (!r.members.includes(from) || r.members.includes(publicIdentity.id)) fail('群邀请必须由现有成员签发。');
        if (data.requests.some((v) => v.type === 'group' && v.room.id === r.id)) break;
        const policy = peer(from)?.friend ? data.settings.invitePolicyFriend : data.settings.invitePolicyStranger;
        if (policy === 'deny') enqueue(effects, from, 'group-response', { requestId: payload.requestId, roomId: r.id, allow: false });
        else if (policy === 'allow') {
          joinRoom(r);
          enqueue(effects, from, 'group-response', { requestId: payload.requestId, roomId: r.id, allow: true });
          announceJoin(effects, r, from, payload.requestId, publicIdentity.id);
        } else pushRequest({ id: payload.requestId, from, type: 'group', room: r, createdAt: packet.createdAt });
        break;
      }
      case 'group-response': {
        if (typeof payload.allow !== 'boolean') fail('无效群邀请回应。');
        const pending = data.outgoing.find((v) => v.type === 'group' && v.id === payload.requestId && v.to === from && v.roomId === payload.roomId);
        if (!pending) fail('不存在对应的群邀请。');
        const r = room(pending.roomId);
        if (payload.allow && !r.members.includes(from)) {
          if (r.members.length >= MAX.members) fail('群成员数量已达到上限。');
          setMember(r, from, true); groupBroadcast(effects, r);
        }
        data.outgoing = data.outgoing.filter((v) => v !== pending); break;
      }
      case 'group-event': {
        const r = room(payload.roomId);
        const actor = id(payload.actor);
        const target = id(payload.target);
        if (!r.members.includes(actor) || !r.members.includes(from) || target !== from) fail('群邀请事件无效。');
        token(payload.requestId); str(payload.targetName, 80); str(payload.actorName,80);
        groupEvent(r, actor, payload.requestId, target, payload.targetName, payload.actorName); break;
      }
      case 'group-state': {
        const r = validRoom(payload.room), old = data.rooms.find((v) => v.id === r.id);
        if (!old) break;
        if (!old.members.includes(from)) fail('未经批准的群状态更新。');
        let changed = false;
        for (const [member, state] of Object.entries(r.memberStates)) {
          const previous = old.memberStates[member];
          if (!previous || state.version > previous.version || (state.version === previous.version && state.actor > previous.actor)) {old.memberStates[member] = state; changed = true;}
        }
        if (Object.keys(old.memberStates).length > MAX.peers) fail('群成员历史已达上限。');
        old.version = Math.max(old.version, r.version);
        old.members = Object.keys(old.memberStates).filter(member => old.memberStates[member].present);
        if (old.members.length > MAX.members) fail('群成员数量已达到上限。');
        if (!old.members.includes(publicIdentity.id)) data.rooms = data.rooms.filter(room => room !== old);
        else if (changed) groupBroadcast(effects, old);
        break;
      }
      case 'group-leave': {
        const r = data.rooms.find(room => room.id === payload.roomId);
        if (r) removeMember(effects, r, from); break;
      }
    }
    return null;
  }
  async function handlePeerPacket(peerId, value) {
    await ready;
    let packet;
    try { packet = typeof value === 'string' ? JSON.parse(value) : copy(value); } catch { return { ok: false, error: '无效协议包。' }; }
    if (!domainTypes.has(packet?.type) || packet.from !== peerId || !await verifyPacket(packet)) return { ok: false, error: '身份、签名或协议类型校验失败。' };
    if (packet.type === 'draft') {
      try {
        const event = await serial(() => {
          const payload = packet.payload, p = peer(peerId);
          messageText(payload.text,true); token(payload.draftId); token(payload.conversationId);
          if (!p || p.blocked || !Number.isSafeInteger(payload.revision) || payload.revision < 1 || Date.now()-packet.createdAt > 20000) return null;
          let conversationId = payload.conversationId;
          if (conversationId.startsWith('peer:')) {
            if (conversationId !== 'peer:'+publicIdentity.id || !allowed(peerId)) return null;
            conversationId = 'peer:'+peerId;
          } else if (conversationId !== 'public') {
            const r = data.rooms.find(room => room.id === conversationId);
            if (!r?.members.includes(publicIdentity.id) || !r.members.includes(peerId)) return null;
          }
          const key = peerId+':'+payload.draftId, previous = draftClocks.get(key);
          if (previous?.revision >= payload.revision) return null;
          draftClocks.delete(key); draftClocks.set(key,{revision:payload.revision,at:Date.now()});
          for (const [oldKey,clock] of draftClocks) if (Date.now()-clock.at > 60000 || draftClocks.size > MAX.peers) draftClocks.delete(oldKey);
          return {type:'draft',peerId,conversationId,text:payload.text,draftId:payload.draftId,revision:payload.revision,createdAt:packet.createdAt};
        });
        if (event) emit(event);
        return {ok:true};
      } catch (error) {return {ok:false,error:error.message};}
    }
    try {
      const { result, effects } = await commit((effects) => {
        if (packet.from === publicIdentity.id) fail('拒绝自身回环协议包。');
        const seenId = packet.from + ':' + packet.id;
        if (data.seen.includes(seenId) && packet.type !== 'message') return { duplicate: true };
        const p = peer(peerId); if (!p) fail('请先完成经过认证的连接握手。');
        const event = receive(packet, effects);
        data.seen.push(seenId);
        if (data.seen.length > MAX.seen) data.seen.splice(0, data.seen.length - MAX.seen);
        p.lastSeen = Date.now();
        return { event };
      });
      const delivery = await deliver(effects);
      return { ok: true, duplicate: !!result.duplicate, ...delivery };
    } catch (error) {
      if (packet.type === 'message' && typeof packet.payload?.id === 'string' && packet.payload.id.length <= 100) {
        await deliver([{peerId, type:'message-result', payload:{messageId:packet.payload.id, status:'rejected', code:'INVALID_MESSAGE'}}]);
      }
      return { ok: false, error: error.message };
    }
  }
  G.BjtuChatroomTransport = Object.freeze({
    ready,
    state: () => serial(() => snapshot()),
    async action(name, args) {
      try { return await action(name, args); }
      catch (error) { return { ok: false, error: error?.message || '聊天室操作失败。' }; }
    },
    subscribe(fn) { if (typeof fn !== 'function') fail('订阅者必须是函数。'); listeners.add(fn); return () => listeners.delete(fn); },
    setLink(adapter) { if (!adapter || typeof adapter.sendPeer !== 'function') fail('连接 adapter 必须提供 sendPeer。'); link = adapter; return ready; },
    peerOnline, peerOffline, handlePeerPacket,
    refreshAccounts,
    getPublicIdentity: () => serial(() => copy(publicIdentity)),
    setLocalIP(ip) { return serial(() => { localIP = str(ip, 64, true); emit({type:'state', state:snapshot()}); return {ok:true}; }); },
    makePacket, verifyPacket
  });
  ready.then(() => { if (typeof G.dispatchEvent === 'function' && typeof G.Event === 'function') G.dispatchEvent(new Event('bjtu-chatroom-transport-ready')); }).catch(() => {});
})();
