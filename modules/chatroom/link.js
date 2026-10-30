/* Browser-only link adapter. No socket or RTC connection is opened on load.
 * LocalSend signaling reference (checked 2026-10-30):
 * https://github.com/localsend/web/blob/main/app/services/signaling.ts
 * https://github.com/localsend/web/blob/main/app/services/webrtc.ts
 * scan/connect/pairCreate/pairAccept/pairComplete/sendPeer/close return promises.
 * Pair methods return {code, sessionId}. setLink() is owned by transport/loader.
 * This uses LocalSend discovery/SDP envelopes, NOT its native file protocol.
 */
(() => {
  'use strict';
  const VERSION = 'bjtu-chatroom-link-v1', LABEL = 'bjtu-chatroom-control-v1';
  const MAX = 262144, MAX_LINKS = 16, TTL = 5 * 60 * 1000;
  const sessions = new Map(), discovered = new Map(), listeners = new Set();
  let socket = null, opening = null, ping, rotate, socketId = '', generation = 0;
  const engine = () => globalThis.BjtuChatroomTransport;
  function emit(type, detail = {}) {
    for (const fn of listeners) { try { fn({ type, ...detail }); } catch {} }
    globalThis.dispatchEvent?.(new CustomEvent('bjtu-chatroom-link-status', { detail: { type, ...detail } }));
  }
  function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64(s) { return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
  async function codec(s, compress) {
    const stream = new Blob([compress ? new TextEncoder().encode(s) : unb64(s)]).stream()
      .pipeThrough(compress ? new CompressionStream('deflate') : new DecompressionStream('deflate'));
    const reader = stream.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX) throw new Error('SDP 超出大小限制。'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return compress ? b64(bytes) : new TextDecoder().decode(bytes);
  }
  async function identity() { await engine().ready; return engine().getPublicIdentity(); }
  function drop(s) {
    if (!s || s.closed) return;
    s.closed = true; clearTimeout(s.timer); clearTimeout(s.disconnectTimer); s.cancelGather?.();
    s.channel?.close(); s.pc.close(); sessions.delete(s.id);
    if (s.peerId && ![...sessions.values()].some(x => x.peerId === s.peerId && x.authenticated)) {
      Promise.resolve(engine()?.peerOffline(s.peerId)).catch(() => {});
    }
    emit('peer-closed', { peerId: s.peerId });
  }
  function makeSession(id = crypto.randomUUID()) {
    if (sessions.size >= MAX_LINKS) throw new Error('直连数量已达上限，请先断开部分连接。');
    if (typeof RTCPeerConnection !== 'function') throw new Error('当前浏览器不支持 WebRTC。');
    const s = { id, pc: new RTCPeerConnection({ iceServers: [] }), closed: false, chain: Promise.resolve(), count: 0 };
    sessions.set(id, s); s.timer = setTimeout(() => drop(s), TTL);
    s.pc.onconnectionstatechange = () => {
      const status = s.pc.connectionState;
      if (status === 'failed' || status === 'closed') drop(s);
      if (status === 'disconnected') s.disconnectTimer ||= setTimeout(() => drop(s), 15000);
      if (status === 'connected') { clearTimeout(s.disconnectTimer); s.disconnectTimer = null; }
    };
    s.pc.ondatachannel = ({ channel }) => { if (s.channel || channel.label !== LABEL) channel.close(); else bind(s, channel); };
    return s;
  }
  async function gather(s) {
    if (s.pc.iceGatheringState === 'complete') return;
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); s.pc.removeEventListener('icegatheringstatechange', change); s.cancelGather = null; error ? reject(error) : resolve(); };
      const change = () => { if (s.pc.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(() => finish(new Error('ICE 候选收集超时，请重新生成配对信息。')), 20000);
      s.cancelGather = () => finish(new Error('配对已取消。'));
      s.pc.addEventListener('icegatheringstatechange', change); change();
    });
    if (s.closed) throw new Error('连接已关闭。');
  }
  function send(s, frame) {
    const data = JSON.stringify(frame);
    if (!s.channel || s.channel.readyState !== 'open') throw new Error('对方尚未直连。');
    if (data.length > MAX || new TextEncoder().encode(data).length > Math.min(s.pc.sctp?.maxMessageSize || 65536, MAX)) throw new Error('控制消息过大。');
    if (s.channel.bufferedAmount > 1024 * 1024) throw new Error('发送队列繁忙，请稍后重试。');
    s.channel.send(data);
  }
  function fingerprint(description) {
    const values = [...new Set((description?.sdp || '').split(/\r?\n/).filter(line => /^a=fingerprint:sha-256 (?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(line)).map(line => line.toUpperCase()))].sort();
    if (!values.length) throw new Error('直连缺少有效 DTLS 指纹。');
    return values.join('|');
  }
  function bind(s, channel) {
    s.channel = channel;
    channel.onopen = () => {
      s.localNonce = crypto.randomUUID();
      identity().then(info => send(s, { protocol: VERSION, type: 'hello', identity: info, nonce: s.localNonce })).catch(() => drop(s));
    };
    channel.onmessage = ({ data }) => {
      if (typeof data !== 'string' || data.length > MAX || s.count >= 64) { drop(s); return; }
      s.count++;
      s.chain = s.chain.then(async () => {
        if (s.closed) return;
        const frame = JSON.parse(data);
        if (frame.protocol !== VERSION) throw new Error('不支持的控制协议。');
        if (frame.type === 'hello' && !s.remoteIdentity) {
          if (typeof frame.identity?.id !== 'string' || typeof frame.nonce !== 'string' || frame.nonce.length > 80) throw new Error('无效身份。');
          if (s.expectedIdentity && frame.identity.id !== s.expectedIdentity.id) throw new Error('配对身份发生变化。');
          s.remoteIdentity = frame.identity; s.remoteNonce = frame.nonce;
          // Bind the identity proof to this DTLS channel, not only to a nonce.
          // Otherwise a malicious signaling relay could forward challenges
          // between two different RTC connections and impersonate both ends.
          const packet = await engine().makePacket('link-auth', { nonce: frame.nonce, sessionId: s.id,
            senderFingerprint: fingerprint(s.pc.localDescription), receiverFingerprint: fingerprint(s.pc.remoteDescription) });
          send(s, { protocol: VERSION, type: 'auth', packet });
        } else if (frame.type === 'auth' && s.remoteIdentity && !s.authenticated) {
          const valid = await engine().verifyPacket(frame.packet);
          if (!valid || frame.packet.type !== 'link-auth' || frame.packet.from !== s.remoteIdentity.id || frame.packet?.payload?.nonce !== s.localNonce || frame.packet?.payload?.sessionId !== s.id ||
              frame.packet.payload.senderFingerprint !== fingerprint(s.pc.remoteDescription) || frame.packet.payload.receiverFingerprint !== fingerprint(s.pc.localDescription)) throw new Error('身份验证失败。');
          s.peerId = s.remoteIdentity.id; s.authenticated = true; clearTimeout(s.timer);
          const result = await engine().peerOnline({ identity: frame.packet.identity, authenticated: true });
          if (result?.ok === false) throw new Error('对方已被屏蔽。');
          emit('peer-online', { peerId: s.peerId });
        } else if (frame.type === 'packet' && s.authenticated) {
          await engine().handlePeerPacket(s.peerId, frame.packet);
        } else throw new Error('无效或未认证的控制消息。');
      }).catch(() => drop(s)).finally(() => { s.count--; });
    };
    channel.onclose = channel.onerror = () => drop(s);
  }
  function parse(code, type) {
    if (typeof code !== 'string' || code.length > MAX) throw new Error('配对信息过大或格式错误。');
    let value; try { value = JSON.parse(code.trim()); } catch { throw new Error('请粘贴完整 JSON 配对信息。'); }
    if (value.protocol !== VERSION || value.type !== type || typeof value.sessionId !== 'string' || value.sessionId.length > 80 ||
        typeof value.identity?.id !== 'string' || typeof value.sdp !== 'string' || value.sdp.length > MAX ||
        !Number.isFinite(value.expires) || value.expires < Date.now() || value.expires > Date.now() + TTL + 30000) throw new Error('配对信息无效、已过期或类型不匹配。');
    return value;
  }
  async function envelope(s, type) {
    return { code: JSON.stringify({ protocol: VERSION, type, sessionId: s.id, identity: await identity(), expires: Date.now() + TTL, sdp: s.pc.localDescription.sdp }), sessionId: s.id };
  }
  async function pairCreate() {
    const s = makeSession();
    try { bind(s, s.pc.createDataChannel(LABEL, { ordered: true })); await s.pc.setLocalDescription(await s.pc.createOffer()); await gather(s); return await envelope(s, 'offer'); }
    catch (e) { drop(s); throw e; }
  }
  async function pairAccept(input) {
    const value = parse(typeof input === 'string' ? input : input?.code, 'offer');
    if (sessions.has(value.sessionId)) throw new Error('此邀请已处理，或来自本机。');
    const s = makeSession(value.sessionId); s.expectedIdentity = value.identity;
    try { await s.pc.setRemoteDescription({ type: 'offer', sdp: value.sdp }); await s.pc.setLocalDescription(await s.pc.createAnswer()); await gather(s); return await envelope(s, 'answer'); }
    catch (e) { drop(s); throw e; }
  }
  async function pairComplete(input) {
    const value = parse(typeof input === 'string' ? input : input?.code, 'answer'), s = sessions.get(value.sessionId);
    if (!s || s.closed || s.pc.remoteDescription) throw new Error('找不到待完成的邀请，请重新生成。');
    s.expectedIdentity = value.identity;
    try { await s.pc.setRemoteDescription({ type: 'answer', sdp: value.sdp }); return { sessionId: s.id }; } catch (e) { drop(s); throw e; }
  }
  async function publicInfo() {
    // LocalSend's timestamped, signed token; separate ephemeral signing key to
    // avoid publishing the persistent chat identity to the public directory.
    const salt = new Uint8Array(8); new DataView(salt.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 1000)), true);
    // Use the officially supported RSA-PSS token algorithm.
    const rsa = await crypto.subtle.generateKey({ name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const der = new Uint8Array(await crypto.subtle.exportKey('spki', rsa.publicKey)), input = new Uint8Array(der.length + 8); input.set(der); input.set(salt, der.length);
    const hash = await crypto.subtle.digest('SHA-256', input), sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, rsa.privateKey, hash);
    return { alias: 'BJTU Chatroom', version: '2.3', deviceModel: VERSION, deviceType: 'WEB', token: ['sha256', b64(new Uint8Array(hash)), b64(salt), 'rsa-pss', b64(new Uint8Array(sig))].join('.') };
  }
  function signalSend(message) { if (socket?.readyState !== 1) throw new Error('请先点击扫描设备，启用在线发现。'); socket.send(JSON.stringify(message)); }
  function remember(peer) {
    if (peer?.deviceModel !== VERSION || typeof peer.id !== 'string' || !peer.id || peer.id.length > 160 || discovered.size >= 500) return;
    discovered.set(peer.id, peer); emit('discovery', { peers: [...discovered.values()], deviceId: socketId });
  }
  async function onSignal(message) {
    if (message.type === 'HELLO') { socketId = message.client?.id || ''; for (const p of (message.peers || []).slice(0, 500)) remember(p); emit('scanning', { deviceId: socketId }); }
    else if (message.type === 'JOIN' || message.type === 'UPDATE') remember(message.peer);
    else if (message.type === 'LEFT') { discovered.delete(message.peerId); emit('discovery', { peers: [...discovered.values()], deviceId: socketId }); }
    else if (message.type === 'OFFER' && message.peer?.deviceModel === VERSION) {
      if (typeof message.sessionId !== 'string' || message.sessionId.length > 80 || sessions.has(message.sessionId)) return;
      const s = makeSession(message.sessionId); s.target = message.peer.id;
      try { await s.pc.setRemoteDescription({ type: 'offer', sdp: await codec(message.sdp, false) }); await s.pc.setLocalDescription(await s.pc.createAnswer()); await gather(s); signalSend({ type: 'ANSWER', target: s.target, sessionId: s.id, sdp: await codec(s.pc.localDescription.sdp, true) }); }
      catch (e) { drop(s); throw e; }
    } else if (message.type === 'ANSWER') {
      const s = sessions.get(message.sessionId);
      if (s && s.target === message.peer?.id && !s.pc.remoteDescription) {
        try { await s.pc.setRemoteDescription({ type: 'answer', sdp: await codec(message.sdp, false) }); } catch (e) { drop(s); throw e; }
      }
    } else if (message.type === 'ERROR') emit('error', { message: `信令服务器拒绝请求（${message.code}）。` });
  }
  async function scan() {
    if (socket?.readyState === 1) return { peers: [...discovered.values()], deviceId: socketId };
    if (opening) return opening;
    const epoch = generation;
    opening = (async () => {
      const stored = await globalThis.chrome?.storage?.local?.get('chatroomSignalingUrl');
      const url = new URL(stored?.chatroomSignalingUrl || 'wss://public.localsend.org/v1/ws');
      if (url.protocol !== 'wss:' || url.username || url.password || url.hash) throw new Error('信令地址必须是不含凭据的 wss URL。');
      const info = await publicInfo();
      if (epoch !== generation) throw new Error('发现已取消。');
      url.searchParams.set('d', b64(new TextEncoder().encode(JSON.stringify(info))));
      const ws = new WebSocket(url.href); socket = ws;
      await new Promise((resolve, reject) => {
        let settled = false;
        const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('在线发现连接失败；仍可使用离线配对。')); } };
        const timer = setTimeout(() => { fail(); ws.close(); }, 15000);
        ws.onopen = () => { settled = true; clearTimeout(timer); resolve(); };
        ws.onerror = fail;
        ws.onclose = () => { fail(); if (socket === ws) { clearInterval(ping); clearInterval(rotate); socket = null; socketId = ''; discovered.clear(); emit('scan-closed'); } };
        ws.onmessage = ({ data }) => { if (socket !== ws || typeof data !== 'string' || data.length > MAX) return; try { const m = JSON.parse(data); if (typeof m.sdp === 'string' && m.sdp.length > MAX) return; onSignal(m).catch(e => emit('error', { message: e.message })); } catch {} };
      });
      if (epoch !== generation || socket !== ws || ws.readyState !== 1) { ws.close(); throw new Error('发现已取消。'); }
      ping = setInterval(() => { if (ws.readyState === 1) ws.send(''); }, 120000);
      rotate = setInterval(() => { publicInfo().then(next => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'UPDATE', info: next })); }).catch(() => {}); }, 30 * 60 * 1000);
      emit('scanning', { deviceId: socketId });
      return { peers: [...discovered.values()], deviceId: socketId };
    })();
    try { return await opening; } finally { opening = null; }
  }
  async function connect(input) {
    const id = typeof input === 'string' ? input : input?.peerId;
    if (!id || id === socketId || !discovered.has(id)) throw new Error('请先扫描，并填写或选择对方的在线设备 ID。');
    const s = makeSession(); s.target = id;
    try { bind(s, s.pc.createDataChannel(LABEL, { ordered: true })); await s.pc.setLocalDescription(await s.pc.createOffer()); await gather(s); signalSend({ type: 'OFFER', target: id, sessionId: s.id, sdp: await codec(s.pc.localDescription.sdp, true) }); return { sessionId: s.id }; }
    catch (e) { drop(s); throw e; }
  }
  async function sendPeer(peerId, packet) {
    const s = [...sessions.values()].find(x => x.authenticated && x.peerId === peerId && !x.closed);
    if (!s) throw new Error('对方未连接，请先配对。');
    send(s, { protocol: VERSION, type: 'packet', packet });
  }
  async function close(input) {
    const peerId = typeof input === 'string' ? input : input?.peerId;
    if (!peerId) {
      generation++; clearInterval(ping); clearInterval(rotate);
      const old = socket; socket = null; old?.close(); discovered.clear(); socketId = ''; emit('scan-closed');
    }
    for (const s of [...sessions.values()]) if (!peerId || s.peerId === peerId || s.id === peerId) drop(s);
  }
  globalThis.BjtuChatroomLink = { scan, connect, pairCreate, pairAccept, pairComplete, sendPeer, close,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  globalThis.addEventListener?.('pagehide', () => { close(); listeners.clear(); }, { once: true });
})();
