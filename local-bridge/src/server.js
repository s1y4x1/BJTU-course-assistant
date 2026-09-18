import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { createPairingCode, loadConfig, normalizePort, saveConfig, configPath } from './config.js';

const config = await loadConfig();
const requestedPortArg = process.argv.find((arg) => arg.startsWith('--port='));
if (requestedPortArg) {
  config.port = normalizePort(requestedPortArg.slice('--port='.length));
  await saveConfig(config);
}
if (process.argv.includes('--show-token')) {
  process.stdout.write(`${config.token}\n`);
  process.exit(0);
}

let pairingCode = createPairingCode();
let extensionSocket = null;
let extensionInfo = null;
let httpServer = null;
let activePort = config.port;
let restartPromise = null;
const pendingExtensionCalls = new Map();
const transports = new Map();

function tokenMatches(value) {
  const provided = Buffer.from(String(value || ''), 'utf8');
  const expected = Buffer.from(config.token, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function bearerToken(req) {
  const value = String(req.headers.authorization || '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function requireBearer(req, res, next) {
  if (tokenMatches(bearerToken(req))) return next();
  res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Bearer Token 无效' });
}

function extensionConnected() {
  return extensionSocket?.readyState === WebSocket.OPEN && extensionInfo?.authenticated === true;
}

function sendExtensionRequest(action, payload = {}) {
  if (!extensionConnected()) {
    throw Object.assign(new Error('浏览器扩展尚未连接本地 Bridge'), { code: 'EXTENSION_OFFLINE' });
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pendingExtensionCalls.set(id, { resolve, reject });
    extensionSocket.send(JSON.stringify({ type: 'request', id, action, payload }));
  });
}

function rejectPendingExtensionCalls(message = '浏览器扩展连接已断开') {
  for (const { reject } of pendingExtensionCalls.values()) {
    reject(Object.assign(new Error(message), { code: 'EXTENSION_OFFLINE' }));
  }
  pendingExtensionCalls.clear();
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function mcpResult(value) {
  return {
    content: [{ type: 'text', text: jsonText(value) }],
    structuredContent: value && typeof value === 'object' && !Array.isArray(value) ? value : { value }
  };
}

function mcpError(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: jsonText({
      ok: false,
      code: String(error?.code || 'BRIDGE_ERROR'),
      error: String(error?.message || error)
    }) }]
  };
}

function createMcpServer() {
  const server = new McpServer({
    name: 'BJTU Course Assistant',
    version: '1.0.0'
  }, {
    instructions: '通过 BJTUCA_operation_list 查询可用操作，通过 BJTUCA_get_docs 阅读说明，再使用 BJTUCA_call 调用。浏览器扩展中的启用状态和用户批准规则始终生效。'
  });

  server.registerTool('BJTUCA_operation_list', {
    title: '列出 BJTU 课程助手操作',
    description: '列出当前浏览器扩展中已安装且允许调用的操作。',
    inputSchema: {}
  }, async () => {
    try {
      return mcpResult(await sendExtensionRequest('operationList'));
    } catch (error) {
      return mcpError(error);
    }
  });

  server.registerTool('BJTUCA_get_docs', {
    title: '获取 BJTU 课程助手操作说明',
    description: '按模块名和操作名获取操作说明；二者都可传字符串、字符串列表或省略。',
    inputSchema: {
      module: z.union([z.string(), z.array(z.string())]).optional(),
      name: z.union([z.string(), z.array(z.string())]).optional()
    }
  }, async (args) => {
    try {
      return mcpResult(await sendExtensionRequest('getDocs', args || {}));
    } catch (error) {
      return mcpError(error);
    }
  });

  server.registerTool('BJTUCA_call', {
    title: '调用 BJTU 课程助手操作',
    description: '调用一个已注册的扩展操作。是否允许执行由浏览器扩展决定。',
    inputSchema: {
      name: z.string().min(1),
      arguments: z.record(z.unknown()).optional()
    }
  }, async ({ name, arguments: args }) => {
    try {
      const response = await sendExtensionRequest('call', { name, arguments: args || {} });
      return response?.ok === false ? mcpError(Object.assign(new Error(response.error), { code: response.code })) : mcpResult(response);
    } catch (error) {
      return mcpError(error);
    }
  });
  return server;
}

const app = createMcpExpressApp({ host: '127.0.0.1' });
app.use('/mcp', requireBearer);
app.use('/api/v1', (req, res, next) => {
  if (req.path === '/pair') return next();
  return requireBearer(req, res, next);
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    port: activePort,
    extensionConnected: extensionConnected(),
    extension: extensionInfo?.publicInfo || null
  });
});

app.post('/api/v1/pair', (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code || code !== pairingCode) {
    res.status(403).json({ ok: false, code: 'PAIRING_CODE_INVALID', error: '配对码无效' });
    return;
  }
  pairingCode = createPairingCode();
  process.stdout.write(`新配对码：${pairingCode}\n`);
  res.json({ ok: true, token: config.token, port: activePort });
});

app.get('/api/v1/operation-list', async (_req, res) => {
  try {
    res.json(await sendExtensionRequest('operationList'));
  } catch (error) {
    res.status(503).json({ ok: false, code: error.code || 'BRIDGE_ERROR', error: String(error.message || error) });
  }
});

app.post('/api/v1/get-docs', async (req, res) => {
  try {
    res.json(await sendExtensionRequest('getDocs', req.body || {}));
  } catch (error) {
    res.status(503).json({ ok: false, code: error.code || 'BRIDGE_ERROR', error: String(error.message || error) });
  }
});

app.post('/api/v1/call', async (req, res) => {
  try {
    res.json(await sendExtensionRequest('call', {
      name: String(req.body?.name || ''),
      arguments: req.body?.arguments || {}
    }));
  } catch (error) {
    res.status(503).json({ ok: false, code: error.code || 'BRIDGE_ERROR', error: String(error.message || error) });
  }
});

app.post('/api/v1/config/port', async (req, res) => {
  const port = normalizePort(req.body?.port, 0);
  if (!port) {
    res.status(400).json({ ok: false, code: 'INVALID_PORT', error: '端口必须是 1024 至 65535 的整数' });
    return;
  }
  if (port === activePort) {
    res.json({ ok: true, port, changed: false });
    return;
  }
  config.port = port;
  await saveConfig(config);
  res.json({ ok: true, port, changed: true });
  setTimeout(() => void restartOnPort(port), 100);
});

app.all('/mcp', async (req, res) => {
  try {
    const sessionId = String(req.headers['mcp-session-id'] || '');
    let transport = sessionId ? transports.get(sessionId) : null;
    if (!transport && req.method === 'POST' && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => transports.set(id, transport),
        onsessionclosed: (id) => transports.delete(id)
      });
      const server = createMcpServer();
      await server.connect(transport);
    }
    if (!transport) {
      res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: '无效或缺失的 MCP 会话' } });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String(error?.message || error) } });
    }
  }
});

const wsServer = new WebSocketServer({ noServer: true });
wsServer.on('connection', (socket) => {
  let authenticated = false;
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (!authenticated) {
      if (message?.type !== 'hello' || !tokenMatches(message?.token)) {
        socket.close(1008, 'Unauthorized');
        return;
      }
      authenticated = true;
      if (extensionSocket && extensionSocket !== socket) extensionSocket.close(1012, 'Replaced');
      extensionSocket = socket;
      extensionInfo = {
        authenticated: true,
        publicInfo: {
          extensionId: String(message?.extensionId || ''),
          version: String(message?.version || '')
        }
      };
      socket.send(JSON.stringify({ type: 'ready', port: activePort }));
      return;
    }
    if (message?.type === 'pong') return;
    if (message?.type === 'response') {
      const pending = pendingExtensionCalls.get(String(message.id || ''));
      if (!pending) return;
      pendingExtensionCalls.delete(String(message.id));
      if (message.ok === false) {
        pending.reject(Object.assign(new Error(String(message.error || '扩展操作失败')), { code: String(message.code || '') }));
      } else {
        pending.resolve(message.result);
      }
    }
  });
  socket.on('close', () => {
    if (extensionSocket !== socket) return;
    extensionSocket = null;
    extensionInfo = null;
    rejectPendingExtensionCalls();
  });
});

function createHttpServer() {
  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname !== '/extension') {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(req, socket, head, (webSocket) => wsServer.emit('connection', webSocket, req));
  });
  return server;
}

async function listen(port) {
  httpServer = createHttpServer();
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', resolve);
  });
  activePort = port;
  process.stdout.write(`BJTU Course Assistant Bridge: http://127.0.0.1:${port}\n`);
  process.stdout.write(`配对码：${pairingCode}\n`);
  process.stdout.write(`配置文件：${configPath()}\n`);
}

async function restartOnPort(port) {
  if (restartPromise) return restartPromise;
  restartPromise = (async () => {
    rejectPendingExtensionCalls('Bridge 正在切换端口');
    if (extensionSocket) extensionSocket.close(1012, 'Port changed');
    await new Promise((resolve) => httpServer?.close(() => resolve()));
    await listen(port);
  })().finally(() => { restartPromise = null; });
  return restartPromise;
}

await listen(config.port);

const heartbeat = setInterval(() => {
  if (extensionConnected()) extensionSocket.send(JSON.stringify({ type: 'ping' }));
}, 20_000);

async function shutdown() {
  clearInterval(heartbeat);
  rejectPendingExtensionCalls('Bridge 已关闭');
  if (extensionSocket) extensionSocket.close(1001, 'Bridge shutdown');
  for (const transport of transports.values()) await transport.close().catch(() => {});
  await new Promise((resolve) => httpServer?.close(() => resolve()));
}

process.on('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
