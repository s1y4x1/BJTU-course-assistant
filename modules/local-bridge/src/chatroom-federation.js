import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';

const PROTOCOL = 'bjtuca-chatroom-lan-v1';
const validId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const normalizeIP = ip => String(ip || '').replace(/^::ffff:/, '');
const privateIP = ip => /^(?:10\.|192\.168\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip);

// A one-hop full mesh: only locally attached devices are advertised. Remote
// directories are never re-advertised, so neither discovery nor SDP can loop.
export function createChatroomFederation({ id, port, listPeers, onPeers, onSignal, validatePeer,
  maxPayload = 262144, maxBufferedBytes = 1048576, onWarning = () => {},
  discoveryPort = 1898, group = '239.189.6.1', intervalMs = 5000 } = {}) {
  const directory = new Map(), links = new Map(), routes = new Map();
  const interfaces = Object.values(networkInterfaces()).flat().filter(entry => entry.family === 'IPv4' && !entry.internal && privateIP(entry.address));
  const udp = createSocket({type:'udp4', reuseAddr:true});
  const wss = new WebSocketServer({noServer:true, maxPayload, perMessageDeflate:false});
  let stopped = false, bound = false, timer;
  function send(link, message) {
    if (link.ws.readyState !== WebSocket.OPEN) return false;
    const data = JSON.stringify(message);
    if (Buffer.byteLength(data) > maxPayload || link.ws.bufferedAmount + Buffer.byteLength(data) > maxBufferedBytes) {
      link.ws.terminate(); return false;
    }
    link.ws.send(data, error => { if (error) link.ws.terminate(); });
    return true;
  }
  function snapshot(link) { return send(link, {type:'DIRECTORY', protocol:PROTOCOL, serverId:id, peers:listPeers()}); }
  function remove(link) {
    if (links.get(link.id) !== link) return;
    links.delete(link.id);
    const removed = [];
    for (const [peerId, route] of routes) if (route.link === link) { routes.delete(peerId); removed.push(peerId); }
    if (removed.length) onPeers([], removed);
  }
  function attach(ws, remoteId) {
    if (stopped || links.has(remoteId)) { ws.terminate(); return; }
    const link = {id:remoteId, ws, alive:true, count:0, window:Date.now()};
    links.set(remoteId, link);
    ws.on('error', () => { remove(link); ws.terminate(); });
    ws.once('close', () => remove(link));
    ws.on('pong', () => { link.alive = true; });
    ws.on('message', (data, binary) => {
      if (stopped || links.get(remoteId) !== link) return;
      if (Date.now() - link.window >= 10000) { link.count = 0; link.window = Date.now(); }
      if (binary || ++link.count > 1024) { ws.terminate(); return; }
      try {
        const message = JSON.parse(data.toString());
        if (message.protocol !== PROTOCOL || message.serverId !== remoteId) throw new Error('Invalid server');
        if (message.type === 'DIRECTORY') {
          if (!Array.isArray(message.peers) || message.peers.length > 128) throw new Error('Directory limit');
          const next = new Map();
          for (const value of message.peers) {
            if (typeof value.id !== 'string' || !value.id.startsWith(remoteId + ':') || value.id.length > 160 || next.has(value.id)) throw new Error('Invalid device');
            const peer = {...validatePeer(value), id:value.id, ip:normalizeIP(value.ip)};
            if (!privateIP(peer.ip)) throw new Error('Invalid device address');
            next.set(peer.id, peer);
          }
          if (routes.size - [...routes.values()].filter(route => route.link === link).length + next.size > 2048) throw new Error('Federation directory limit');
          const removed = [], changed = [];
          for (const [peerId, route] of routes) if (route.link === link && !next.has(peerId)) { routes.delete(peerId); removed.push(peerId); }
          for (const [peerId, peer] of next) {
            if (JSON.stringify(routes.get(peerId)?.peer) !== JSON.stringify(peer)) changed.push(peer);
            routes.set(peerId, {peer, link});
          }
          onPeers(changed, removed);
        } else if (message.type === 'SIGNAL') {
          const route = routes.get(message.from);
          if (route?.link !== link || typeof message.target !== 'string') throw new Error('Invalid route');
          onSignal(route.peer, {type:message.signal?.type, sessionId:message.signal?.sessionId, sdp:message.signal?.sdp, target:message.target});
        } else throw new Error('Invalid packet');
      } catch { ws.terminate(); }
    });
    if (ws.readyState === WebSocket.OPEN) snapshot(link);
    else ws.once('open', () => snapshot(link));
  }
  function connect(remote) {
    if (stopped || id > remote.id || links.has(remote.id)) return;
    const ws = new WebSocket(`ws://${remote.ip}:${remote.port}/chatroom/servers?id=${id}`, {
      maxPayload, perMessageDeflate:false, handshakeTimeout:5000,
      headers:{'X-BJTUCA-Server':PROTOCOL}
    });
    attach(ws, remote.id);
  }
  function announce(type = 'ANNOUNCE', address = group) {
    if (!bound || stopped) return;
    const packet = Buffer.from(JSON.stringify({protocol:PROTOCOL, type, id, port}));
    if (address === group && interfaces.length) {
      for (const entry of interfaces) {
        try { udp.setMulticastInterface(entry.address); udp.send(packet, discoveryPort, address, () => {}); } catch {}
      }
    } else udp.send(packet, discoveryPort, address, () => {});
  }
  udp.on('message', (data, source) => {
    if (stopped || data.length > 512 || !privateIP(source.address)) return;
    try {
      const value = JSON.parse(data.toString());
      if (value.protocol !== PROTOCOL || !validId(value.id) || value.id === id || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return;
      if (value.type === 'BYE') {
        const remote = directory.get(value.id);
        if (remote?.ip === source.address && remote.port === value.port) { directory.delete(value.id); links.get(value.id)?.ws.terminate(); }
        return;
      }
      if (value.type !== 'ANNOUNCE' || (!directory.has(value.id) && directory.size >= 32)) return;
      const previous = directory.get(value.id);
      const remote = {id:value.id, port:value.port, ip:source.address, seen:Date.now()};
      directory.set(remote.id, remote);
      if (!previous) announce('ANNOUNCE', source.address);
      connect(remote);
    } catch {}
  });
  udp.on('error', error => onWarning(`局域网组播发现不可用：${error.message}`));
  udp.bind(discoveryPort, '0.0.0.0', () => {
    if (stopped) { udp.close(); return; }
    bound = true;
    udp.setMulticastTTL(1); udp.setMulticastLoopback(true);
    let memberships = 0;
    for (const entry of interfaces) {
      try { udp.addMembership(group, entry.address); memberships++; } catch {}
    }
    if (!memberships) { try { udp.addMembership(group); } catch (error) { onWarning(`无法加入组播：${error.message}`); } }
    announce();
  });
  timer = setInterval(() => {
    announce();
    for (const [remoteId, remote] of directory) {
      if (Date.now() - remote.seen > intervalMs * 4) { directory.delete(remoteId); links.get(remoteId)?.ws.terminate(); }
      else connect(remote);
    }
    for (const link of links.values()) {
      if (link.ws.readyState !== WebSocket.OPEN) continue;
      if (!link.alive) { link.ws.terminate(); continue; }
      link.alive = false; link.ws.ping();
    }
  }, intervalMs);
  timer.unref(); udp.unref();
  return {
    publish() { for (const link of links.values()) if (link.ws.readyState === WebSocket.OPEN) snapshot(link); },
    forward(target, signal) {
      const route = routes.get(target);
      return !!route && send(route.link, {protocol:PROTOCOL, serverId:id, type:'SIGNAL', from:signal.peer.id, target,
        signal:{type:signal.type, sdp:signal.sdp, sessionId:signal.sessionId}});
    },
    upgrade(req, socket, head) {
      const remoteId = new URL(req.url, 'http://localhost').searchParams.get('id');
      const remote = directory.get(remoteId);
      if (stopped || req.headers.origin || req.headers['x-bjtuca-server'] !== PROTOCOL || !remote || remoteId > id ||
          remote.ip !== normalizeIP(socket.remoteAddress) || links.has(remoteId)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => attach(ws, remoteId));
    },
    async close() {
      if (stopped) return;
      announce('BYE'); stopped = true; clearInterval(timer);
      for (const link of links.values()) link.ws.terminate();
      links.clear(); routes.clear(); directory.clear();
      try { udp.close(); } catch {}
      await new Promise(resolve => wss.close(resolve));
    }
  };
}
