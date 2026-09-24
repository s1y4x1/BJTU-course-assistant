import http from 'node:http';
import readline from 'node:readline';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { loadConfig, normalizePort, saveConfig, configPath } from './config.js';

const config = await loadConfig();
const requestedPortArg = process.argv.find((arg) => arg.startsWith('--port='));
if (requestedPortArg) {
  const requestedPort = normalizePort(requestedPortArg.slice('--port='.length), 0);
  if (!requestedPort) throw new RangeError('--port 必须是 1 至 65535 的整数');
  config.port = requestedPort;
  await saveConfig(config);
}
if (process.argv.includes('--show-token')) {
  process.stdout.write(`${config.token}\n`);
  process.exit(0);
}

let extensionSocket = null;
let extensionInfo = null;
let httpServer = null;
let activePort = config.port;
let activeAllowLan = config.allowLan === true;
let restartPromise = null;
let requestedListenerRestart = null;
let terminal = null;
const pendingExtensionCalls = new Map();
const transports = new Map();
const localFileRelays = new Map();

function tokenMatches(value) {
  const provided = Buffer.from(String(value || ''), 'utf8');
  const expected = Buffer.from(config.token, 'utf8');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function bridgeAllowedHosts() {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', hostname().toLowerCase()]);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const item of addresses || []) {
      const address = String(item?.address || '').trim();
      if (!address) continue;
      hosts.add(item.family === 'IPv6' || address.includes(':') ? `[${address}]` : address);
    }
  }
  return [...hosts];
}

function bearerToken(req) {
  const value = String(req.headers.authorization || '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function requireBearer(req, res, next) {
  if (tokenMatches(bearerToken(req))) return next();
  res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Bearer token 无效' });
}

function extensionConnected() {
  return extensionSocket?.readyState === WebSocket.OPEN && extensionInfo?.authenticated === true;
}

function operationArguments(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new TypeError('arguments 必须是对象'), { code: 'INVALID_ARGUMENTS' });
  }
  return value;
}

function sendExtensionRequest(action, payload = {}, { printResult = true } = {}) {
  if (!extensionConnected()) {
    throw Object.assign(new Error('浏览器扩展尚未连接本地 Bridge'), { code: 'EXTENSION_OFFLINE' });
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pendingExtensionCalls.set(id, { resolve, reject });
    extensionSocket.send(JSON.stringify({ type: 'request', id, action, payload }));
  }).then((value) => {
    const result = action === 'call' && value?.ok === true ? value.result : value;
    if (printResult) process.stdout.write(`${jsonText(result)}\n`);
    return value;
  }, (error) => {
    process.stderr.write(`${jsonText({
      ok: false,
      code: String(error?.code || 'BRIDGE_ERROR'),
      error: String(error?.message || error)
    })}\n`);
    if (error && typeof error === 'object') error.bridgeLogged = true;
    throw error;
  });
}

async function prepareOperationArguments(name, value) {
  const args = operationArguments(value);
  if (String(name || '').trim() !== 've.uploadFile' || !String(args?.filePath || '').trim()) return args;
  const resolvedPath = path.resolve(String(args.filePath));
  let info;
  try {
    info = await stat(resolvedPath);
  } catch (error) {
    throw Object.assign(new Error(`无法读取本地文件：${String(error?.message || error)}`), { code: 'INVALID_ARGUMENT' });
  }
  if (!info.isFile()) throw Object.assign(new Error('filePath 指向的路径不是文件'), { code: 'INVALID_ARGUMENT' });
  if (info.size > 1024 * 1024 * 1024) {
    throw Object.assign(new Error('文件超过 Bridge 允许的 1 GiB 上限'), { code: 'FILE_TOO_LARGE' });
  }
  const relayToken = randomUUID();
  const relayTimer = setTimeout(() => localFileRelays.delete(relayToken), 15 * 60 * 1000);
  relayTimer.unref?.();
  localFileRelays.set(relayToken, {
    filePath: resolvedPath,
    fileName: String(args.fileName || path.basename(resolvedPath)).trim(),
    mimeType: String(args.mimeType || 'application/octet-stream').trim(),
    fileSize: info.size,
    timer: relayTimer
  });
  const prepared = {
    ...args,
    fileName: String(args.fileName || path.basename(resolvedPath)).trim(),
    mimeType: String(args.mimeType || 'application/octet-stream').trim(),
    url: `http://127.0.0.1:${activePort}/internal/file/${relayToken}`
  };
  delete prepared.filePath;
  return prepared;
}

async function callOperation(name, args) {
  return sendExtensionRequest('call', {
    name,
    arguments: await prepareOperationArguments(name, args)
  });
}

function parseTerminalOperation(line) {
  const match = /^([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)([\s\S]*)$/.exec(line.trim());
  if (!match) throw new Error('请输入「模块.操作名」或「模块.操作名 {JSON 参数}」');
  let rawArgs = match[2].trim();
  if (rawArgs.startsWith('(') && rawArgs.endsWith(')')) rawArgs = rawArgs.slice(1, -1).trim();
  let args = {};
  if (rawArgs) {
    try { args = JSON.parse(rawArgs); }
    catch { throw new Error('参数必须是合法的 JSON 对象；字符串和键名均需使用双引号'); }
  }
  return { name: match[1], args: operationArguments(args) };
}

function parseTerminalHelpOperations(line) {
  const match = /^help(?:\s+([\s\S]+)|\(([\s\S]*)\))$/i.exec(line);
  if (!match) return null;
  const names = [...new Set(String(match[1] ?? match[2] ?? '').trim().split(/[\s,]+/).filter(Boolean))];
  if (!names.length || names.some((name) => !/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(name))) {
    throw new Error('请输入操作名，如 help ve.courseList ykt.assignments 或 help(ve.courseList)');
  }
  return names;
}

function startTerminal() {
  if (terminal || !process.stdin.isTTY) return;
  terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const colorEnabled = !('NO_COLOR' in process.env) && process.stdout.hasColors?.(2);
  const promptColor = process.stdout.hasColors?.(1 << 24) ? '\x1b[38;2;190;35;112m' : '\x1b[35m';
  terminal.setPrompt(colorEnabled ? `${promptColor}BJTUCA>\x1b[0m ` : 'BJTUCA> ');
  process.stdout.write('可输入操作名执行；参数使用单行 JSON。输入 help 查看示例，Ctrl+C 退出。\n');
  terminal.on('line', async (input) => {
    terminal.pause();
    const line = input.trim();
    try {
      if (line === 'help') {
        process.stdout.write('获取操作列表：qwen.operationList\n获取操作说明：qwen.getDocs {"module":"ve","name":"courseList"}\n按操作名查看说明：help ve.courseList ykt.assignments；也支持 help(ve.courseList)\n调用示例：ve.courseList\n          ve.uploadFile {"filePath":"C:\\\\path\\\\file.pdf"}\n也可写 ve.courseList({})；不会执行任意 JavaScript。\n');
      } else if (line === 'exit' || line === 'quit') {
        await shutdown();
        process.exit(0);
      } else if (line) {
        const helpOperations = parseTerminalHelpOperations(line);
        if (helpOperations) {
          for (const name of helpOperations) {
            const [module, operationName] = name.split('.');
            const doc = await sendExtensionRequest('getDocs', { module, name: operationName }, { printResult: false });
            process.stdout.write(`${String(doc || `未找到操作说明：${name}`)}\n`);
          }
        } else {
          const { name, args } = parseTerminalOperation(line);
          await callOperation(name, args);
        }
      }
    } catch (error) {
      if (!error?.bridgeLogged) process.stderr.write(`命令执行失败：${String(error?.message || error)}\n`);
    } finally {
      terminal.resume();
      terminal.prompt();
    }
  });
  terminal.on('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  terminal.prompt();
}

function rejectPendingExtensionCalls(message = '浏览器扩展连接已断开') {
  for (const { reject } of pendingExtensionCalls.values()) {
    reject(Object.assign(new Error(message), { code: 'EXTENSION_OFFLINE' }));
  }
  pendingExtensionCalls.clear();
}

function clearLocalFileRelays() {
  for (const relay of localFileRelays.values()) clearTimeout(relay.timer);
  localFileRelays.clear();
}

function disconnectExtension(code = 1001, reason = 'Disconnected', message = '浏览器扩展连接已断开') {
  const current = extensionSocket;
  extensionSocket = null;
  extensionInfo = null;
  rejectPendingExtensionCalls(message);
  if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
    current.close(code, reason);
  }
}

async function closeMcpTransports() {
  const activeTransports = [...transports.values()];
  transports.clear();
  await Promise.allSettled(activeTransports.map((transport) => transport.close()));
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
      const response = await callOperation(name, args);
      return response?.ok === false
        ? mcpError(Object.assign(new Error(response.error), { code: response.code }))
        : mcpResult(response?.result);
    } catch (error) {
      return mcpError(error);
    }
  });
  return server;
}

const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: bridgeAllowedHosts() });
app.use('/mcp', requireBearer);
app.use('/api/v1', (req, res, next) => {
  if (req.method === 'GET' && req.path === '/operation-list') return next();
  return requireBearer(req, res, next);
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    port: activePort,
    allowLan: activeAllowLan,
    extensionConnected: extensionConnected(),
    extension: extensionInfo?.publicInfo || null
  });
});

app.get('/internal/file/:token', (req, res) => {
  const token = String(req.params?.token || '').trim();
  const relay = localFileRelays.get(token);
  if (!relay) {
    res.status(404).type('text/plain').send('文件中继不存在或已失效');
    return;
  }

  localFileRelays.delete(token);
  clearTimeout(relay.timer);
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': relay.mimeType || 'application/octet-stream',
    'Content-Length': String(relay.fileSize),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(relay.fileName)}`
  });

  const stream = createReadStream(relay.filePath);
  stream.on('error', (error) => {
    if (!res.headersSent) {
      res.status(500).type('text/plain').send(`读取本地文件失败：${String(error?.message || error)}`);
      return;
    }
    res.destroy(error);
  });
  stream.pipe(res);
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
    const name = String(req.body?.name || '').trim();
    const response = await callOperation(name, req.body?.arguments);
    if (response?.ok === false) {
      res.status(400).json({
        ok: false,
        code: response.code || 'OPERATION_FAILED',
        error: String(response.error || '扩展操作失败')
      });
      return;
    }
    res.json(response?.result ?? null);
  } catch (error) {
    const invalid = ['INVALID_ARGUMENT', 'INVALID_ARGUMENTS', 'FILE_TOO_LARGE'].includes(String(error?.code || ''));
    res.status(invalid ? 400 : 503).json({ ok: false, code: error.code || 'BRIDGE_ERROR', error: String(error.message || error) });
  }
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
      if (extensionSocket && extensionSocket !== socket) {
        disconnectExtension(1012, 'Replaced', '浏览器扩展连接已被新连接替换');
      }
      extensionSocket = socket;
      extensionInfo = {
        authenticated: true,
        publicInfo: {
          extensionId: String(message?.extensionId || ''),
          version: String(message?.version || '')
        }
      };
      socket.send(JSON.stringify({ type: 'ready', port: activePort }));
      process.stdout.write(`浏览器扩展已连接（版本 ${extensionInfo.publicInfo.version || '未知'}）。\n`);
      startTerminal();
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
    process.stdout.write('浏览器扩展已断开连接。\n');
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

async function listen(port, allowLan = config.allowLan === true) {
  httpServer = createHttpServer();
  const listenHost = allowLan ? '0.0.0.0' : '127.0.0.1';
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, listenHost, resolve);
  });
  activePort = port;
  activeAllowLan = allowLan;
  process.stdout.write(`BJTU Course Assistant Bridge: http://${allowLan ? '0.0.0.0' : '127.0.0.1'}:${port}\n`);
  process.stdout.write(`局域网访问：${allowLan ? '允许' : '关闭'}\n`);
}

async function restartListener(port, allowLan = config.allowLan === true) {
  requestedListenerRestart = { port, allowLan };
  if (restartPromise) return restartPromise;
  restartPromise = (async () => {
    while (requestedListenerRestart) {
      const target = requestedListenerRestart;
      requestedListenerRestart = null;
      clearLocalFileRelays();
      disconnectExtension(1012, 'Listener changed', 'Bridge 正在重新监听');
      await closeMcpTransports();
      await new Promise((resolve) => httpServer?.close(() => resolve()));
      await listen(target.port, target.allowLan);
    }
  })().finally(() => { restartPromise = null; });
  return restartPromise;
}

await listen(config.port);
process.stdout.write(`配置文件：${configPath()}\n`);

let configReloadTimer = null;
async function applyConfigFileChanges() {
  const next = await loadConfig({ persist: false, strict: true });
  const listenerChanged = next.port !== activePort || next.allowLan !== activeAllowLan;
  const tokenChanged = next.token !== config.token;
  config.port = next.port;
  config.token = next.token;
  config.allowLan = next.allowLan;
  if (tokenChanged) {
    clearLocalFileRelays();
    disconnectExtension(4001, 'Authorization changed', 'Bridge 授权配置已更改');
    await closeMcpTransports();
  }
  if (listenerChanged) await restartListener(config.port, config.allowLan);
}

const configWatcher = watch(path.dirname(configPath()), (_eventType, filename) => {
  if (String(filename || '') !== path.basename(configPath())) return;
  if (configReloadTimer) clearTimeout(configReloadTimer);
  configReloadTimer = setTimeout(() => {
    configReloadTimer = null;
    void applyConfigFileChanges().catch((error) => {
      process.stderr.write(`重新读取 bridge.json 失败：${String(error?.message || error)}\n`);
    });
  }, 100);
});
configWatcher.on('error', (error) => {
  process.stderr.write(`监听 bridge.json 失败：${String(error?.message || error)}\n`);
});

const heartbeat = setInterval(() => {
  if (extensionConnected()) extensionSocket.send(JSON.stringify({ type: 'ping' }));
}, 20_000);

async function shutdown() {
  clearInterval(heartbeat);
  if (configReloadTimer) clearTimeout(configReloadTimer);
  configWatcher.close();
  clearLocalFileRelays();
  disconnectExtension(1001, 'Bridge shutdown', 'Bridge 已关闭');
  await closeMcpTransports();
  await new Promise((resolve) => httpServer?.close(() => resolve()));
}

process.on('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
