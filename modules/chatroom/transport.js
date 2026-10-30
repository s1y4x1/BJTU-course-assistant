/* Browser-only signed protocol engine. No Bridge, discovery server or STUN/TURN.
 * Link contract (all public async methods await ready):
 * getPublicIdentity() -> {id, fingerprint, nickname, publicKey: P-256 public JWK}.
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
 * settings/remark/block/friend-request/friend-response/group-create/
 * group-invite/group-response/group-leave/send-message/signal.
 * subscribe(fn) -> unsubscribe; state() -> isolated domain snapshot.
 * Events: {type:'state',state}, {type:'signal',peerId,payload}, {type:'error',error}.
 * action resolves {ok:true,...} or {ok:false,error:string,...}; send results
 * include sent/failed counts (local persistence is not a remote delivery ACK).
 * History: <=600 messages AND <=2 MiB UTF-8 JSON. Seen packet IDs: <=2048.
 * requireFriend restricts private messages/signals, never public/group chat.
 * Domain mutations and state snapshots share a queue. Adapter I/O runs outside
 * that queue, so adapters may await peerOnline/handlePeerPacket safely.
 */
(() => {
  'use strict';
  const G = globalThis, KEY = 'chatroomState', PROTOCOL = 'bjtu-chatroom-v1';
  const MAX = { peers: 500, rooms: 100, requests: 100, messages: 600, historyBytes: 2 * 1024 * 1024, seen: 2048, packet: 262144, members: 100 };
  const encoder = new TextEncoder(), listeners = new Set(), keyCache = new Map();
  const domainTypes = new Set(['profile', 'message', 'signal', 'friend-request', 'friend-response', 'group-invite', 'group-response', 'group-invite-request', 'group-state', 'group-leave']);
  let data, privateKey, publicIdentity, link, queue = Promise.resolve();

  const copy = (v) => JSON.parse(JSON.stringify(v));
  const fail = (message) => { throw new Error(message); };
  const str = (v, max, empty = false) => {
    if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) fail('字段格式或长度不正确。');
    return v;
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
    return copy({ self: publicIdentity, settings: data.settings, peers: data.peers, rooms: data.rooms, requests: data.requests, messages: data.messages });
  }
  const storage = G.browser?.storage?.local || G.chrome?.storage?.local;
  async function save() { await storage.set({ [KEY]: data }); }
  function serial(fn) {
    const task = queue.then(() => ready).then(fn);
    queue = task.catch(() => {});
    return task;
  }
  async function commit(fn) {
    return serial(async () => {
      const before = copy(data), identityBefore = copy(publicIdentity), effects = [];
      try {
        const result = await fn(effects);
        await save();
        emit({ type: 'state', state: snapshot() });
        if (result?.event) emit(result.event);
        return { result, effects };
      } catch (error) { data = before; publicIdentity = identityBefore; throw error; }
    });
  }
  async function deliver(effects) {
    const results = await Promise.allSettled(effects.map(async ({ peerId, type, payload }) => {
      if (!link || typeof link.sendPeer !== 'function') fail('尚未连接点对点引擎。');
      const result = await link.sendPeer(peerId, await makePacket(type, payload));
      if (result === false || result?.ok === false || result?.error) fail('对方连接不可用。');
    }));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) emit({ type: 'error', error: failed[0].reason?.message || '部分数据未能送达。' });
    return { sent: results.length - failed.length, failed: failed.length };
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
    data.messages.push(message);
    if (data.messages.length > MAX.messages) data.messages.splice(0, data.messages.length - MAX.messages);
    trimHistory();
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
    token(value.id); str(value.name, 60); id(value.ownerId);
    if (!/^group:[A-Za-z0-9-]{1,80}$/.test(value.id)) fail('无效群标识。');
    if (!Number.isSafeInteger(value.version) || value.version < 1 || !Array.isArray(value.members) || value.members.length > MAX.members || new Set(value.members).size !== value.members.length) fail('无效群成员版本。');
    value.members.forEach(id);
    if (value.members.length && !value.members.includes(value.ownerId)) fail('缺少群主。');
    return { id: value.id, name: value.name, ownerId: value.ownerId, version: value.version, members: [...value.members] };
  }
  function groupBroadcast(effects, r, oldMembers = []) { fanout(effects, [...oldMembers, ...r.members], 'group-state', { room: r }); }
  function invite(effects, r, peerIds) {
    if (r.ownerId !== publicIdentity.id) fail('只有群主能签发群邀请。');
    if (!Array.isArray(peerIds) || !peerIds.length || peerIds.length > MAX.members) fail('请选择有效邀请成员。');
    for (const peerId of new Set(peerIds)) {
      id(peerId);
      if (r.members.includes(peerId)) continue;
      requirePeer(peerId, false);
      if (data.outgoing.some((x) => x.type === 'group' && x.to === peerId && x.roomId === r.id)) continue;
      const requestId = crypto.randomUUID();
      pushRequest({ id: requestId, type: 'group', to: peerId, roomId: r.id, createdAt: Date.now() }, true);
      enqueue(effects, peerId, 'group-invite', { requestId, room: r });
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
      data = { schema: 1, identity: { privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) }, settings: { nickname: '', requireFriend: false, invitePolicy: 'ask' }, peers: [], rooms: [], requests: [], outgoing: [], messages: [], seen: [] };
    }
    for (const [name, limit] of Object.entries({ peers: MAX.peers, rooms: MAX.rooms, requests: MAX.requests, outgoing: MAX.requests, messages: MAX.messages, seen: MAX.seen })) {
      if (!Array.isArray(data[name])) fail('聊天室存储数据损坏，未覆盖原数据。');
      data[name] = data[name].slice(-limit);
    }
    const needsNickname = !data.settings?.nickname;
    data.settings = { nickname: str(data.settings?.nickname || '设备', 40), requireFriend: data.settings?.requireFriend === true, invitePolicy: ['ask', 'allow', 'deny'].includes(data.settings?.invitePolicy) ? data.settings.invitePolicy : 'ask' };
    const pub = await crypto.subtle.importKey('jwk', data.identity.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const fingerprint = hex(await crypto.subtle.digest('SHA-256', await crypto.subtle.exportKey('raw', pub)));
    if (needsNickname) data.settings.nickname = '设备-' + fingerprint.slice(0, 6);
    publicIdentity = { id: fingerprint, fingerprint, nickname: data.settings.nickname, publicKey: data.identity.publicKey };
    await importIdentity(publicIdentity);
    const proof = encoder.encode('bjtu-chatroom-identity-check');
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, proof), proof)) fail('持久身份密钥不匹配。');
    data.peers.forEach((p) => { p.online = false; });
    trimHistory();
    await save();
  }
  const ready = initialize();
  // Attach a handler without changing the rejecting ready Promise exposed to callers.
  ready.catch((error) => emit({ type: 'error', error: error.message }));

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
    return commit(() => {
      if (identity.id === publicIdentity.id) fail('不能连接自身。');
      let p = peer(identity.id);
      if (!p) {
        if (data.peers.length >= MAX.peers) fail('联系人数量已达到上限。');
        p = { id: identity.id, friend: false, blocked: false, remark: '' };
        data.peers.push(p);
      }
      p.nickname = identity.nickname;
      p.publicKey = { kty: 'EC', crv: 'P-256', x: identity.publicKey.x, y: identity.publicKey.y, ext: true, key_ops: ['verify'] };
      p.fingerprint = identity.id;
      p.online = !p.blocked; p.lastSeen = Date.now();
      return { ok: !p.blocked, peerId: p.id };
    }).then(({ result }) => result);
  }
  async function peerOffline(peerId) {
    return commit(() => { const p = peer(peerId); if (p) p.online = false; return { ok: true }; }).then(({ result }) => result);
  }
  async function action(name, args = {}) {
    await ready;
    args = copy(args);
    const method = { scan: 'scan', connect: 'connect', 'pair-create': 'pairCreate', 'pair-accept': 'pairAccept', 'pair-complete': 'pairComplete', close: 'close' }[name];
    if (method) {
      if (!link || typeof link[method] !== 'function') fail('当前浏览器连接引擎不支持此操作。');
      return await link[method](args);
    }
    const { result, effects } = await commit((effects) => localAction(name, args, effects));
    const delivery = await deliver(effects);
    return { ...result, ...delivery, ok: delivery.failed === 0, ...(delivery.failed ? { error: delivery.sent ? '部分接收者未能送达，请检查连接。' : '数据未送达，请重新连接。' } : {}) };
  }
  function localAction(name, args, effects) {
    switch (name) {
      case 'settings': {
        if (args.nickname !== undefined) data.settings.nickname = str(args.nickname, 40).trim();
        if (args.requireFriend !== undefined) { if (typeof args.requireFriend !== 'boolean') fail('无效好友策略。'); data.settings.requireFriend = args.requireFriend; }
        if (args.invitePolicy !== undefined) { if (!['ask', 'allow', 'deny'].includes(args.invitePolicy)) fail('无效邀请策略。'); data.settings.invitePolicy = args.invitePolicy; }
        publicIdentity.nickname = data.settings.nickname;
        fanout(effects, data.peers.map((p) => p.id), 'profile', {});
        if (data.settings.invitePolicy === 'deny') data.requests = data.requests.filter((r) => r.type !== 'group');
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
        if (p.blocked) {
          data.requests = data.requests.filter((r) => r.from !== p.id);
          data.outgoing = data.outgoing.filter((r) => r.to !== p.id);
        }
        return {};
      }
      case 'friend-request': {
        const p = requirePeer(args.peerId, false);
        if (p.friend) return {};
        if (data.outgoing.some((r) => r.type === 'friend' && r.to === p.id)) return {};
        const requestId = crypto.randomUUID();
        pushRequest({ id: requestId, type: 'friend', to: p.id, createdAt: Date.now() }, true);
        enqueue(effects, p.id, name, { requestId }); return { requestId };
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
          if (args.allow) peer(request.from).friend = true;
        } else if (args.allow) {
          if (data.rooms.length >= MAX.rooms) fail('群聊数量已达到上限。');
          // Pending room lacks self membership until the owner confirms admission.
          if (!data.rooms.some((r) => r.id === request.room.id)) data.rooms.push(copy(request.room));
        }
        enqueue(effects, request.from, name, { requestId: request.id, allow: args.allow, ...(type === 'group' ? { roomId: request.room.id } : {}) });
        data.requests = data.requests.filter((r) => r.id !== request.id);
        if (args.blockSender) { peer(request.from).blocked = true; data.requests = data.requests.filter((r) => r.from !== request.from); }
        if (args.blockAll) { data.settings.invitePolicy = 'deny'; data.requests = data.requests.filter((r) => r.type !== 'group'); }
        return {};
      }
      case 'group-create': {
        if (data.rooms.length >= MAX.rooms) fail('群聊数量已达到上限。');
        const r = { id: 'group:' + crypto.randomUUID(), name: str(args.name, 60).trim(), ownerId: publicIdentity.id, version: 1, members: [publicIdentity.id] };
        data.rooms.push(r); invite(effects, r, args.peerIds); return { roomId: r.id };
      }
      case 'group-invite': {
        const r = room(args.roomId);
        if (r.ownerId === publicIdentity.id) invite(effects, r, args.peerIds);
        else {
          requirePeer(r.ownerId, false);
          if (!Array.isArray(args.peerIds) || !args.peerIds.length || args.peerIds.length > MAX.members) fail('无效邀请成员。');
          args.peerIds.forEach((p) => requirePeer(p, false));
          enqueue(effects, r.ownerId, 'group-invite-request', { roomId: r.id, peerIds: args.peerIds });
        }
        return {};
      }
      case 'group-leave': {
        const r = room(args.roomId);
        if (r.ownerId === publicIdentity.id) { const old = [...r.members]; r.members = []; r.version++; groupBroadcast(effects, r, old); }
        else if (allowed(r.ownerId, false) && peer(r.ownerId).online) enqueue(effects, r.ownerId, name, { roomId: r.id });
        data.rooms = data.rooms.filter((v) => v.id !== r.id);
        data.outgoing = data.outgoing.filter((v) => v.roomId !== r.id);
        data.requests = data.requests.filter((v) => v.room?.id !== r.id);
        return {};
      }
      case 'send-message': {
        const text = str(args.text, 8000).trim(), conversationId = token(args.conversationId);
        let targets;
        if (conversationId === 'public') targets = data.peers.filter((p) => p.online && allowed(p.id, false)).map((p) => p.id);
        else if (conversationId.startsWith('peer:')) targets = [requirePeer(conversationId.slice(5)).id];
        else targets = room(conversationId).members.filter((p) => p !== publicIdentity.id && allowed(p, false) && peer(p).online);
        const message = { id: crypto.randomUUID(), senderId: publicIdentity.id, conversationId, text, createdAt: Date.now() };
        for (const target of targets) enqueue(effects, target, 'message', { ...message, conversationId: conversationId.startsWith('peer:') ? 'peer:' + target : conversationId });
        history(message); return { messageId: message.id };
      }
      case 'signal':
        requirePeer(args.peerId, !sharedGroup(args.peerId)); enqueue(effects, args.peerId, name, { to: args.peerId, signal: args.payload }); return {};
      default: fail('不支持的聊天室操作：' + String(name).slice(0, 64));
    }
  }
  function receive(packet, effects) {
    const from = packet.from, payload = packet.payload;
    if (!allowed(from, false)) fail('接收策略拒绝此用户。');
    switch (packet.type) {
      case 'profile': peer(from).nickname = packet.identity.nickname; break;
      case 'message': {
        str(payload.text, 8000); token(payload.id); token(payload.conversationId);
        if (payload.senderId !== from || !Number.isSafeInteger(payload.createdAt) || Math.abs(payload.createdAt - packet.createdAt) > 60000) fail('消息身份或时间不匹配。');
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
        break;
      }
      case 'signal':
        if (!allowed(from) && !sharedGroup(from)) fail('直连信令需要先添加好友或加入同一群聊。');
        if (payload.to !== publicIdentity.id || !payload.signal || typeof payload.signal !== 'object' || encoder.encode(JSON.stringify(payload.signal)).length > 65536) fail('无效或非本人的信令。');
        return { type: 'signal', peerId: from, payload: payload.signal };
      case 'friend-request':
        token(payload.requestId);
        if (!peer(from).friend && !data.requests.some((r) => r.type === 'friend' && r.from === from)) pushRequest({ id: payload.requestId, from, type: 'friend', createdAt: packet.createdAt });
        break;
      case 'friend-response': {
        if (typeof payload.allow !== 'boolean') fail('无效好友回应。');
        const pending = data.outgoing.find((r) => r.type === 'friend' && r.id === payload.requestId && r.to === from);
        if (!pending) fail('不存在对应的好友请求。');
        if (payload.allow) peer(from).friend = true;
        data.outgoing = data.outgoing.filter((r) => r !== pending); break;
      }
      case 'group-invite': {
        token(payload.requestId); const r = validRoom(payload.room);
        if (r.ownerId !== from || !r.members.length || r.members.includes(publicIdentity.id)) fail('群邀请必须由群主签发。');
        if (data.rooms.some((v) => v.id === r.id) || data.requests.some((v) => v.type === 'group' && v.room.id === r.id)) break;
        const policy = data.settings.invitePolicy;
        if (policy === 'deny') enqueue(effects, from, 'group-response', { requestId: payload.requestId, roomId: r.id, allow: false });
        else if (policy === 'allow') {
          if (data.rooms.length >= MAX.rooms) fail('群聊数量已达到上限。');
          data.rooms.push(r); enqueue(effects, from, 'group-response', { requestId: payload.requestId, roomId: r.id, allow: true });
        } else pushRequest({ id: payload.requestId, from, type: 'group', room: r, createdAt: packet.createdAt });
        break;
      }
      case 'group-response': {
        if (typeof payload.allow !== 'boolean') fail('无效群邀请回应。');
        const pending = data.outgoing.find((v) => v.type === 'group' && v.id === payload.requestId && v.to === from && v.roomId === payload.roomId);
        if (!pending) fail('不存在对应的群邀请。');
        const r = room(pending.roomId);
        if (r.ownerId !== publicIdentity.id) fail('不是群主。');
        if (payload.allow && !r.members.includes(from)) {
          if (r.members.length >= MAX.members) fail('群成员数量已达到上限。');
          r.members.push(from); r.version++; groupBroadcast(effects, r);
        }
        data.outgoing = data.outgoing.filter((v) => v !== pending); break;
      }
      case 'group-invite-request': {
        const r = room(payload.roomId);
        if (r.ownerId !== publicIdentity.id || !r.members.includes(from)) fail('邀请申请人不是群成员。');
        invite(effects, r, payload.peerIds); break;
      }
      case 'group-state': {
        const r = validRoom(payload.room), old = data.rooms.find((v) => v.id === r.id);
        if (!old || old.ownerId !== from || r.ownerId !== from) fail('未经批准的群状态更新。');
        if (r.version <= old.version) break;
        data.rooms = data.rooms.filter((v) => v.id !== r.id);
        if (r.members.includes(publicIdentity.id)) data.rooms.push(r);
        break;
      }
      case 'group-leave': {
        const r = room(payload.roomId);
        if (r.ownerId !== publicIdentity.id || !r.members.includes(from) || from === r.ownerId) fail('无效退出请求。');
        r.members = r.members.filter((v) => v !== from); r.version++; groupBroadcast(effects, r); break;
      }
    }
    return null;
  }
  async function handlePeerPacket(peerId, value) {
    await ready;
    let packet;
    try { packet = typeof value === 'string' ? JSON.parse(value) : copy(value); } catch { return { ok: false, error: '无效协议包。' }; }
    if (!domainTypes.has(packet?.type) || packet.from !== peerId || !await verifyPacket(packet)) return { ok: false, error: '身份、签名或协议类型校验失败。' };
    try {
      const { result, effects } = await commit((effects) => {
        if (packet.from === publicIdentity.id) fail('拒绝自身回环协议包。');
        const seenId = packet.from + ':' + packet.id;
        if (data.seen.includes(seenId)) return { duplicate: true };
        const p = peer(peerId); if (!p) fail('请先完成经过认证的连接握手。');
        const event = receive(packet, effects);
        data.seen.push(seenId);
        if (data.seen.length > MAX.seen) data.seen.splice(0, data.seen.length - MAX.seen);
        p.lastSeen = Date.now();
        return { event };
      });
      const delivery = await deliver(effects);
      return { ok: true, duplicate: !!result.duplicate, ...delivery };
    } catch (error) { return { ok: false, error: error.message }; }
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
    getPublicIdentity: () => serial(() => copy(publicIdentity)),
    makePacket, verifyPacket
  });
  ready.then(() => { if (typeof G.dispatchEvent === 'function' && typeof G.Event === 'function') G.dispatchEvent(new Event('bjtu-chatroom-transport-ready')); }).catch(() => {});
})();
