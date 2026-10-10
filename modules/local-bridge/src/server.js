import http from 'node:http';
import readline from 'node:readline';
import { randomUUID, randomInt, timingSafeEqual } from 'node:crypto';
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
import JSON5 from 'json5';
import { loadConfig, normalizePort, saveConfig, configPath } from './config.js';

async function main() {
const config = await loadConfig();
let pairingCode = '';
let pairingExpiresAt = 0;
const pairingAttempts = new Map();
function issuePairingCode() {
  pairingCode = String(randomInt(1000000)).padStart(6, '0');
  pairingExpiresAt = Date.now() + 5 * 60000;
  process.stdout.write(`扩展配对码：${pairingCode}（5 分钟内有效，仅可使用一次；输入 pair 生成新码）。\n`);
}
const commandArgIndex = process.argv.indexOf('-c');
const singleCommand = (commandArgIndex >= 0
  ? process.argv.slice(commandArgIndex + 1).join(' ')
  : String(process.env.BJTUCA_RUN_COMMAND || '')).trim();
if (commandArgIndex >= 0 && !singleCommand) throw new Error('-c 后必须提供命令');
let singleCommandStarted = false;
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
  const localAddress = String(extensionSocket?._socket?.localAddress || '127.0.0.1').replace(/^::ffff:/, '');
  const relayHost = localAddress.includes(':') ? `[${localAddress}]` : localAddress;
  const prepared = {
    ...args,
    fileName: String(args.fileName || path.basename(resolvedPath)).trim(),
    mimeType: String(args.mimeType || 'application/octet-stream').trim(),
    url: `http://${relayHost}:${activePort}/internal/file/${relayToken}`
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
  if (!match) throw new Error('请输入「模块.操作名」或「模块.操作名 键名:值」');
  let rawArgs = match[2].trim();
  if (rawArgs.startsWith('(') && rawArgs.endsWith(')')) rawArgs = rawArgs.slice(1, -1).trim();
  let args = {};
  if (rawArgs) {
    try { args = JSON5.parse(rawArgs.startsWith('{') || rawArgs.startsWith('[') ? rawArgs : `{${rawArgs}}`); }
    catch { throw new Error('参数格式错误；请使用 键名:值，多项以逗号分隔，字符串使用单引号或双引号'); }
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

async function runTerminalCommand(input, { request = sendExtensionRequest, call = callOperation } = {}) {
  const line = input.trim();
  if (line === 'help') {
    process.stdout.write('输入 pair 生成 6 位扩展配对码（5 分钟内有效，仅使用一次）。\n');
    process.stdout.write('获取操作列表：qwen.operationList\n获取操作说明：qwen.getDocs module:"ve", name:"courseList"\n按操作名查看说明：help ve.courseList ykt.assignments；也支持 help(ve.courseList)\n调用示例：ve.courseList\n          ve.uploadFile filePath:"C:\\\\path\\\\file.pdf"\n键名无需引号，可省略对象花括号；字符串支持单引号或双引号。也可写 ve.courseList({})；不会执行任意 JavaScript。\n');
  } else if (line === 'pair') {
    issuePairingCode();
  } else if (line === 'exit' || line === 'quit') {
    return true;
  } else if (line) {
    const helpOperations = parseTerminalHelpOperations(line);
    if (helpOperations) {
      const docs = [];
      for (const name of helpOperations) {
        const [module, operationName] = name.split('.');
        const doc = await request('getDocs', { module, name: operationName }, { printResult: false });
        docs.push(String(doc || `未找到操作说明：${name}`).trim());
      }
      process.stdout.write(`${docs.join('\n\n---\n\n')}\n`);
    } else {
      const { name, args } = parseTerminalOperation(line);
      const response = await call(name, args);
      if (response?.ok === false) {
        throw Object.assign(new Error(response.error || '扩展操作失败'), { bridgeLogged: true });
      }
    }
  }
  return false;
}

async function runSingleCommand() {
  if (singleCommandStarted) return;
  singleCommandStarted = true;
  let exitCode = 0;
  try { await runTerminalCommand(singleCommand); }
  catch (error) {
    exitCode = 1;
    if (!error?.bridgeLogged) process.stderr.write(`命令执行失败：${String(error?.message || error)}\n`);
  } finally {
    await shutdown();
    process.exitCode = exitCode;
  }
}

function startTerminal() {
  if (singleCommand) { void runSingleCommand(); return; }
  if (terminal || !process.stdin.isTTY) return;
  terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const colorEnabled = !('NO_COLOR' in process.env) && process.stdout.hasColors?.(2);
  const promptColor = process.stdout.hasColors?.(1 << 24) ? '\x1b[38;2;190;35;112m' : '\x1b[35m';
  terminal.setPrompt(colorEnabled ? `${promptColor}BJTUCA>\x1b[0m ` : 'BJTUCA> ');
  process.stdout.write('可输入操作名执行；参数使用单行 JSON。输入 help 查看示例，Ctrl+C 退出。\n');
  terminal.on('line', async (input) => {
    terminal.pause();
    try {
      if (await runTerminalCommand(input)) {
        await shutdown();
        process.exit(0);
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
wsServer.on('connection', (socket, req) => {
  let authenticated = false;
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (!authenticated) {
      let paired = false;
      if (message?.type === 'hello' && message.pairingCode !== undefined) {
        const address = String(req.socket.remoteAddress || '');
        const now = Date.now();
        for (const [ip, attempt] of pairingAttempts) if (attempt.until <= now) pairingAttempts.delete(ip);
        const attempt = pairingAttempts.get(address) || { count:0, until:now + 60000 };
        attempt.count++;
        pairingAttempts.set(address, attempt);
        paired = attempt.count <= 5 && now < pairingExpiresAt && pairingCode !== ''
          && String(message.pairingCode) === pairingCode;
        if (paired) { pairingCode = ''; pairingExpiresAt = 0; }
      }
      if (message?.type !== 'hello' || (!paired && !tokenMatches(message?.token))) {
        socket.close(1008, 'Unauthorized');
        return;
      }
      authenticated = true;
      if (extensionSocket && extensionSocket !== socket) {
        disconnectExtension(4002, 'Replaced', '浏览器扩展连接已被新连接替换');
      }
      extensionSocket = socket;
      extensionInfo = {
        authenticated: true,
        publicInfo: {
          extensionId: String(message?.extensionId || ''),
          version: String(message?.version || '')
        }
      };
      socket.send(JSON.stringify({ type: 'ready', port: activePort, allowLan:activeAllowLan, ...(paired ? { token:config.token } : {}) }));
      process.stdout.write(`浏览器扩展已连接（版本 ${extensionInfo.publicInfo.version || '未知'}）。\n`);
      startTerminal();
      return;
    }
    if (message?.type === '合一') return;
    if (message?.type === 'config-update') {
      void (async () => {
        try {
          const patch = message.patch || {};
          const port = patch.port === undefined ? config.port : normalizePort(patch.port, 0);
          if (!port) throw new Error('端口必须为 1 至 65535');
          const next = { ...config, port, allowLan:patch.allowLan === undefined ? config.allowLan : patch.allowLan === true };
          await saveConfig(next);
          socket.send(JSON.stringify({ type:'config-saved', id:message.id, ok:true, config:{port:next.port,allowLan:next.allowLan} }));
        } catch (error) {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'config-saved',id:message.id,ok:false,error:String(error.message || error) }));
        }
      })();
      return;
    }
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

async function askForAvailablePort(reader) {
  while (true) {
    const input = await new Promise((resolve, reject) => {
      const onClose = () => reject(new Error('端口输入已结束，Bridge 尚未启动'));
      if (reader.closed) { onClose(); return; }
      reader.once('close', onClose);
      reader.question('请输入新的监听端口（1 至 65535）：', (answer) => {
        reader.removeListener('close', onClose);
        resolve(answer.trim());
      });
    });
    const port = /^\d+$/.test(input) ? normalizePort(input, 0) : 0;
    if (port) return port;
    process.stderr.write('端口必须是 1 至 65535 的整数，请重新输入。\n');
  }
}

async function listen(port, allowLan = config.allowLan === true) {
  const listenHost = allowLan ? '0.0.0.0' : '127.0.0.1';
  let portReader = null;
  try {
    while (true) {
      httpServer = createHttpServer();
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            httpServer.removeListener('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            httpServer.removeListener('error', onError);
            resolve();
          };
          httpServer.once('error', onError);
          httpServer.once('listening', onListening);
          httpServer.listen(port, listenHost);
        });
        break;
      } catch (error) {
        if (error?.code !== 'EADDRINUSE') throw error;
        process.stderr.write(`端口 ${port} 已被占用。\n`);
        portReader ||= terminal || readline.createInterface({ input: process.stdin, output: process.stdout });
        port = await askForAvailablePort(portReader);
      }
    }
    activePort = port;
    activeAllowLan = allowLan;
    if (config.port !== port) {
      config.port = port;
      await saveConfig(config);
    }
    process.stdout.write(`BJTU Course Assistant Bridge: http://${listenHost}:${port}\n`);
    process.stdout.write(`局域网访问：${allowLan ? '允许' : '关闭'}\n`);
  } finally {
    if (portReader && portReader !== terminal) portReader.close();
    else if (portReader) terminal.prompt();
  }
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

if (singleCommand) {
  if (['help', 'exit', 'quit'].includes(singleCommand)) {
    await runTerminalCommand(singleCommand);
    return;
  }
  if (!parseTerminalHelpOperations(singleCommand)) parseTerminalOperation(singleCommand);
  const bridgeUrl = `http://127.0.0.1:${config.port}`;
  let health = await fetch(`${bridgeUrl}/health`, { headers: { Connection: 'close' } }).then((response) => response.json()).catch(() => null);
  if (health?.ok && typeof health.extensionConnected === 'boolean') {
    try {
      if (!health.extensionConnected) process.stdout.write('正在等待浏览器扩展连接…\n');
      while (!health.extensionConnected) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        health = await fetch(`${bridgeUrl}/health`, { headers: { Connection: 'close' } }).then((response) => response.json());
      }
      const request = async (action, payload = {}, { printResult = true } = {}) => {
        const route = { call: 'call', getDocs: 'get-docs', operationList: 'operation-list' }[action];
        const response = await fetch(`${bridgeUrl}/api/v1/${route}`, {
          method: action === 'operationList' ? 'GET' : 'POST',
          headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', Connection: 'close' },
          ...(action === 'operationList' ? {} : { body: JSON.stringify(payload) })
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
        if (printResult) process.stdout.write(`${jsonText(value)}\n`);
        return action === 'call' ? { ok: true, result: value } : value;
      };
      await runTerminalCommand(singleCommand, {
        request,
        call: (name, args) => request('call', { name, arguments: args })
      });
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`命令执行失败：${String(error?.message || error)}\n`);
      process.exitCode = 1;
    }
    return;
  }
}

await listen(config.port);
process.stdout.write(`配置文件：${configPath()}\n`);
issuePairingCode();
if (!singleCommand) startTerminal();

let configReloadTimer = null;
async function applyConfigFileChanges() {
  const next = await loadConfig({ persist: false, strict: true });
  const listenerChanged = next.port !== activePort || next.allowLan !== activeAllowLan;
  const tokenChanged = next.token !== config.token;
  config.port = next.port;
  config.token = next.token;
  config.allowLan = next.allowLan;
  config.host = next.host;
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
  if (extensionConnected()) extensionSocket.send(JSON.stringify({ type: '知行' }));
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
}

await main();
