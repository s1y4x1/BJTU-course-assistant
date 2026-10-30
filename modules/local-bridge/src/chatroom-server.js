import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';

export const DEFAULT_CHATROOM_PORT = 1897;
export const CHATROOM_LIMITS = Object.freeze({
  maxConnections: 128, maxConnectionsPerIp: 16,
  maxPayload: 262144, maxBufferedBytes: 1048576,
  messagesPerWindow: 40, rateWindowMs: 10000,
  upgradesPerMinute: 60, maxSessions: 512, maxSessionsPerPeer: 16,
  sessionTtlMs: 300000, heartbeatMs: 30000
});

function publicInfo(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Invalid device info');
  const result = {};
  for (const [key, max] of Object.entries({ alias: 128, version: 32, deviceModel: 128, deviceType: 32, token: 1024 })) {
    if (typeof info[key] !== 'string' || !info[key].length || Buffer.byteLength(info[key]) > max) throw new Error(`Invalid ${key}`);
    result[key] = info[key];
  }
  // The directory is untrusted discovery metadata, never an identity authority.
  return result;
}

export function parseChatroomPort(args = []) {
  const values = args.filter(arg => arg.startsWith('--port='));
  if (!values.length && !args.includes('--port')) return DEFAULT_CHATROOM_PORT;
  const value = values[0]?.slice(7);
  if (values.length !== 1 || args.includes('--port') || !/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > 65535) {
    throw new RangeError('--port 必须是 1 至 65535 的整数，例如 --port=1897');
  }
  return Number(value);
}

/** Start a discovery/SDP-only LAN directory. Port 0 is supported for tests.
 * No process signal handlers or bridge configuration are touched here.
 * Returns { server, wss, port, host, close }, where close() is idempotent.
 */
export async function startChatroomServer({ port = DEFAULT_CHATROOM_PORT, host = '0.0.0.0', limits: overrides = {} } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid chatroom port');
  const limits = { ...CHATROOM_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Chatroom limits must be positive integers');
  }
  const peers = new Map(), sessions = new Map(), sockets = new Set(), ipCounts = new Map(), upgradeRates = new Map();
  let closing = false, closePromise, heartbeat;
  const server = http.createServer({ maxHeaderSize: 16384, headersTimeout: 10000, requestTimeout: 10000 }, (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
      res.end(JSON.stringify({ ok: true, service: 'bjtuca-chatroom', port: server.address().port }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
    res.end('Chatroom signaling: WebSocket /chatroom only\n');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayload, perMessageDeflate: false });
  const reject = (socket, status) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  function remove(peer) {
    if (!peers.delete(peer.id)) return;
    for (const [id, session] of sessions) {
      if (session.from === peer.id || session.to === peer.id) sessions.delete(id);
    }
    if (!closing) broadcast({ type: 'LEFT', peerId: peer.id });
  }
  function disconnect(peer, code, reason) {
    remove(peer);
    if (peer.ws.readyState === WebSocket.OPEN) peer.ws.close(code, reason);
    peer.closeTimer ||= setTimeout(() => peer.ws.terminate(), 1000);
    peer.closeTimer.unref();
  }
  function send(peer, message) {
    if (!peers.has(peer.id) || peer.ws.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(message);
    if (Buffer.byteLength(data) > limits.maxPayload || peer.ws.bufferedAmount + Buffer.byteLength(data) > limits.maxBufferedBytes) {
      disconnect(peer, 1008, 'Outbound queue limit');
      return;
    }
    peer.ws.send(data, error => { if (error) peer.ws.terminate(); });
  }
  function broadcast(message, except) {
    for (const peer of peers.values()) if (peer !== except) send(peer, message);
  }
  const fail = (peer, code) => send(peer, { type: 'ERROR', code });
  function pruneSessions(now = Date.now()) {
    for (const [id, session] of sessions) if (session.expires <= now) sessions.delete(id);
  }
  server.on('connection', socket => {
    const ip = socket.remoteAddress;
    if (closing || sockets.size >= limits.maxConnections || (ipCounts.get(ip) || 0) >= limits.maxConnectionsPerIp) {
      socket.destroy(); return;
    }
    sockets.add(socket); ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    socket.setTimeout(10000, () => socket.destroy());
    socket.on('error', () => {});
    socket.once('close', () => {
      sockets.delete(socket);
      const count = (ipCounts.get(ip) || 1) - 1;
      if (count) ipCounts.set(ip, count); else ipCounts.delete(ip);
    });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (req, socket, head) => {
    if (closing || !sockets.has(socket)) { socket.destroy(); return; }
    const now = Date.now(), ip = socket.remoteAddress;
    for (const [key, rate] of upgradeRates) if (rate.until <= now) upgradeRates.delete(key);
    let rate = upgradeRates.get(ip);
    if (!rate) {
      if (upgradeRates.size >= 1024) { reject(socket, '503 Service Unavailable'); return; }
      rate = { count: 0, until: now + 60000 }; upgradeRates.set(ip, rate);
    }
    if (++rate.count > limits.upgradesPerMinute) { reject(socket, '429 Too Many Requests'); return; }
    let info;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/chatroom') { reject(socket, '404 Not Found'); return; }
      const data = url.searchParams.get('d');
      // LocalSend clients may use standard btoa Base64 or unpadded base64url.
      // URLSearchParams decodes the escaped +, / and trailing padding first.
      if (!data || data.length > 8192 || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(data)) throw new Error('Invalid discovery data');
      info = publicInfo(JSON.parse(Buffer.from(data, 'base64url').toString('utf8')));
    } catch { reject(socket, '400 Bad Request'); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      socket.setTimeout(0);
      const peer = { id: randomUUID(), info, ws, alive: true, count: 0, windowStart: now };
      const describe = p => ({ ...p.info, id: p.id });
      const existing = [...peers.values()].map(describe);
      peers.set(peer.id, peer);
      ws.on('error', () => {
        remove(peer);
        peer.closeTimer ||= setTimeout(() => ws.terminate(), 1000);
        peer.closeTimer.unref();
      });
      ws.once('close', () => { clearTimeout(peer.closeTimer); remove(peer); });
      ws.on('pong', () => { peer.alive = true; });
      ws.on('message', (data, binary) => {
        if (!peers.has(peer.id) || closing) return;
        const time = Date.now();
        if (time - peer.windowStart >= limits.rateWindowMs) { peer.windowStart = time; peer.count = 0; }
        if (++peer.count > limits.messagesPerWindow) { disconnect(peer, 1008, 'Rate limit'); return; }
        if (binary) { disconnect(peer, 1003, 'Text signaling only'); return; }
        if (!data.length) return; // LocalSend keepalive
        let message;
        try {
          message = JSON.parse(data.toString());
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
        } catch { disconnect(peer, 1007, 'Invalid JSON'); return; }
        if (message.type === 'UPDATE') {
          try { peer.info = publicInfo(message.info); }
          catch { fail(peer, 'INVALID_INFO'); return; }
          broadcast({ type: 'UPDATE', peer: describe(peer) }, peer);
          return;
        }
        if (message.type !== 'OFFER' && message.type !== 'ANSWER') { fail(peer, 'INVALID_TYPE'); return; }
        // Construct a fresh envelope: client-supplied peer/from/id never reaches recipients.
        const { target, sessionId, sdp, type } = message;
        if (typeof target !== 'string' || target.length > 160 || typeof sessionId !== 'string' || !sessionId.length || sessionId.length > 80 ||
            typeof sdp !== 'string' || !sdp.length || !/^[A-Za-z0-9_-]+$/.test(sdp)) { fail(peer, 'INVALID_SIGNAL'); return; }
        const recipient = peers.get(target);
        if (!recipient || recipient === peer) { fail(peer, 'PEER_NOT_FOUND'); return; }
        pruneSessions(time);
        if (type === 'OFFER') {
          if (sessions.has(sessionId)) { fail(peer, 'SESSION_EXISTS'); return; }
          const involved = id => [...sessions.values()].filter(s => s.from === id || s.to === id).length;
          if (sessions.size >= limits.maxSessions || involved(peer.id) >= limits.maxSessionsPerPeer || involved(target) >= limits.maxSessionsPerPeer) {
            fail(peer, 'SESSION_LIMIT'); return;
          }
          sessions.set(sessionId, { from: peer.id, to: target, expires: time + limits.sessionTtlMs });
        } else {
          const session = sessions.get(sessionId);
          if (!session || session.to !== peer.id || session.from !== target) { fail(peer, 'INVALID_SESSION'); return; }
          sessions.delete(sessionId);
        }
        send(recipient, { type, peer: describe(peer), sessionId, sdp });
      });
      send(peer, { type: 'HELLO', client: describe(peer), peers: existing });
      if (peers.has(peer.id)) broadcast({ type: 'JOIN', peer: describe(peer) }, peer);
    });
  });
  function close() {
    if (closePromise) return closePromise;
    closing = true; clearInterval(heartbeat);
    closePromise = new Promise(resolve => {
      for (const peer of peers.values()) { clearTimeout(peer.closeTimer); peer.ws.terminate(); }
      peers.clear(); sessions.clear(); upgradeRates.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear(); ipCounts.clear();
      wss.close(() => server.close(() => resolve()));
    });
    return closePromise;
  }
  try {
    await new Promise((resolve, rejectListen) => {
      const onError = error => { server.off('listening', onListen); rejectListen(error); };
      const onListen = () => { server.off('error', onError); resolve(); };
      server.once('error', onError); server.once('listening', onListen);
      server.listen(port, host);
    });
  } catch (error) {
    await close();
    if (error.code === 'EADDRINUSE') error.message = `聊天室端口 ${port} 已被占用：请关闭占用进程，或使用 --chatroom --port=${port === 65535 ? 1897 : port + 1} 指定其他端口。`;
    else if (error.code === 'EACCES') error.message = `无权监听聊天室端口 ${port}：请使用 --chatroom --port=1897 或检查系统端口保留设置。`;
    throw error;
  }
  heartbeat = setInterval(() => {
    pruneSessions();
    for (const peer of peers.values()) {
      if (!peer.alive) { remove(peer); peer.ws.terminate(); continue; }
      peer.alive = false;
      if (peer.ws.readyState === WebSocket.OPEN) peer.ws.ping();
    }
    for (const [ip, rate] of upgradeRates) if (rate.until <= Date.now()) upgradeRates.delete(ip);
  }, limits.heartbeatMs);
  heartbeat.unref();
  return { server, wss, host, port: server.address().port, close };
}

export async function runChatroomServer(args = process.argv.slice(2)) {
  process.title = 'BJTUCA-chatroom';
  const service = await startChatroomServer({ port: parseChatroomPort(args) });
  const addresses = new Set(['127.0.0.1']);
  for (const entries of Object.values(networkInterfaces())) {
    for (const item of entries || []) if (item.family === 'IPv4' && !item.internal) addresses.add(item.address);
  }
  process.stdout.write(`聊天室 LAN 信令服务已启动（独立于 Bridge，无需扩展连接）\n${[...addresses].map(ip => `  ws://${ip}:${service.port}/chatroom`).join('\n')}\n仅用于可信局域网；不转发聊天或文件内容。按 Ctrl+C 关闭。\n`);
  const shutdown = () => {
    process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
    void service.close().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  return service;
}
