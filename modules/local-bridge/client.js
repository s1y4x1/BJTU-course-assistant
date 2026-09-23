/* 本地程序桥接客户端：连接 127.0.0.1 上的 BJTU Course Assistant Bridge。 */
(function initBJTUCALocalBridge(global) {
  'use strict';

  const DEFAULT_PORT = 1896;
  const DEFAULT_RETRY_INTERVAL_MS = 500;
  const BRIDGE_CONFIG_PATH = 'modules/local-bridge/bridge.json';
  const RECONNECT_ALARM = 'bjtu-local-bridge-reconnect';
  const STORAGE_KEYS = Object.freeze({
    enabled: 'bjtuLocalBridgeEnabled',
    port: 'bjtuLocalBridgePort',
    token: 'bjtuLocalBridgeToken',
    allowLan: 'bjtuLocalBridgeAllowLan',
    autoRetry: 'bjtuLocalBridgeAutoRetry',
    retryIntervalMs: 'bjtuLocalBridgeRetryIntervalMs'
  });
  const META_OPERATIONS = new Set(['qwen.operationList', 'qwen.getDocs']);
  const APPROVAL_PREFIX = 'bjtu-local-bridge-approval:';
  const approvalRequests = new Map();
  const completedRequests = new Map();
  const inflightRequests = new Map();
  let socket = null;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let currentSettings = {
    enabled: false,
    port: DEFAULT_PORT,
    token: '',
    allowLan: false,
    autoRetry: true,
    retryIntervalMs: DEFAULT_RETRY_INTERVAL_MS
  };
  let connectionState = 'disconnected';
  let lastError = '';

  function normalizePort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
  }

  function normalizeRetryInterval(value) {
    const interval = Number(value);
    return Number.isFinite(interval) && interval >= 100 && interval <= 60000
      ? Math.round(interval)
      : DEFAULT_RETRY_INTERVAL_MS;
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS)).catch(() => ({}));
    currentSettings = {
      enabled: stored[STORAGE_KEYS.enabled] === true,
      port: normalizePort(stored[STORAGE_KEYS.port]),
      token: String(stored[STORAGE_KEYS.token] || '').trim(),
      allowLan: stored[STORAGE_KEYS.allowLan] === true,
      autoRetry: stored[STORAGE_KEYS.autoRetry] !== false,
      retryIntervalMs: normalizeRetryInterval(stored[STORAGE_KEYS.retryIntervalMs])
    };
    return currentSettings;
  }

  function statusPayload() {
    return {
      ok: true,
      enabled: currentSettings.enabled,
      port: currentSettings.port,
      allowLan: currentSettings.allowLan,
      autoRetry: currentSettings.autoRetry,
      retryIntervalMs: currentSettings.retryIntervalMs,
      configured: Boolean(currentSettings.token),
      state: connectionState,
      connected: connectionState === 'connected',
      message: lastError
    };
  }

  function broadcastStatus() {
    void chrome.runtime.sendMessage({
      type: 'BJTUCA_LOCAL_BRIDGE_STATUS_CHANGED',
      payload: statusPayload()
    }).catch(() => {});
  }

  function setState(state, message = '') {
    connectionState = state;
    lastError = String(message || '');
    void global.BjtuActionBridgeIndicator?.setConnected(state === 'connected' && currentSettings.enabled);
    broadcastStatus();
  }

  function clearReconnectTimer() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    void chrome.alarms.clear(RECONNECT_ALARM);
  }

  function clearHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function closeSocket(code = 1000, reason = 'Disabled') {
    clearReconnectTimer();
    clearHeartbeat();
    const current = socket;
    socket = null;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      try { current.close(code, reason); } catch {}
    }
  }

  function scheduleReconnect() {
    if (!currentSettings.autoRetry || reconnectTimer) return;
    const delay = normalizeRetryInterval(currentSettings.retryIntervalMs);
    // setTimeout provides the short retry; the alarm is a service-worker wake-up fallback.
    chrome.alarms.create(RECONNECT_ALARM, { when: Date.now() + Math.max(delay, 1000) });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== RECONNECT_ALARM || !currentSettings.autoRetry) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    void connect();
  });

  async function connect() {
    await loadSettings();
    try {
      const before = { ...currentSettings };
      await syncBridgeConfigFromFile();
      if (socket && (before.port !== currentSettings.port || before.token !== currentSettings.token)) {
        closeSocket(1000, 'Bridge config changed');
      }
    } catch (error) {
      if (!currentSettings.token) {
        closeSocket();
        setState('unconfigured', String(error?.message || error));
        scheduleReconnect();
        return;
      }
    }
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    clearReconnectTimer();
    setState('connecting');
    const connectionToken = currentSettings.token;
    const ws = new WebSocket(`ws://127.0.0.1:${currentSettings.port}/extension`);
    socket = ws;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        token: connectionToken,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version
      }));
    });
    ws.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message?.type === 'ready') {
        setState('connected');
        clearHeartbeat();
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
        }, 20_000);
        return;
      }
      if (message?.type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (message?.type === 'request') void handleRequest(message, ws);
    });
    ws.addEventListener('close', (event) => {
      if (socket !== ws) return;
      socket = null;
      clearHeartbeat();
      const authorizationRevoked = event.code === 1008 || event.code === 4001;
      if (authorizationRevoked) {
        currentSettings.token = '';
        setState('unconfigured', 'Bridge 授权已失效，正在重新读取 bridge.json');
        if (event.code === 1008 || event.code === 4001) {
          void chrome.storage.local.get(STORAGE_KEYS.token).then((stored) => {
            if (String(stored?.[STORAGE_KEYS.token] || '').trim() !== connectionToken) return;
            return chrome.storage.local.remove(STORAGE_KEYS.token);
          }).catch(() => {});
        }
        scheduleReconnect();
        return;
      }
      setState('disconnected', '本地 Bridge 未连接');
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      if (socket !== ws) return;
      setState('disconnected', '无法连接本地 Bridge');
    });
  }

  function sendResponse(ws, id, response) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'response', id, ...response }));
  }

  async function operationApproval(name) {
    if (META_OPERATIONS.has(name)) return true;
    const stored = await chrome.storage.local.get('qwenAlwaysAllowedOperations').catch(() => ({}));
    const alwaysAllowed = new Set((Array.isArray(stored?.qwenAlwaysAllowedOperations)
      ? stored.qwenAlwaysAllowedOperations : []).map(String));
    if (alwaysAllowed.has(name)) return true;

    const approvalId = crypto.randomUUID();
    const pageDecision = await chrome.runtime.sendMessage({
      type: 'BJTUCA_LOCAL_APPROVAL_REQUEST',
      id: approvalId,
      name,
      message: `本地程序请求执行「${name}」，是否允许？`
    }).catch(() => null);
    if (pageDecision?.handled === true) {
      void chrome.runtime.sendMessage({
        type: 'BJTUCA_LOCAL_APPROVAL_RESOLVED',
        id: approvalId
      }).catch(() => {});
      if (pageDecision.decision === 'always') {
        await rememberAlwaysAllowed(name);
        return true;
      }
      return pageDecision.decision === 'allow';
    }

    const notificationId = `${APPROVAL_PREFIX}${crypto.randomUUID()}`;
    return new Promise((resolve) => {
      approvalRequests.set(notificationId, { resolve, name });
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/128.png'),
        title: '本地程序请求执行操作',
        message: `是否允许执行「${name}」？`,
        requireInteraction: true,
        buttons: [{ title: '允许一次' }, { title: '始终允许' }]
      }, () => {
        if (!chrome.runtime.lastError) return;
        approvalRequests.delete(notificationId);
        resolve(false);
      });
    });
  }

  async function rememberAlwaysAllowed(name) {
    const stored = await chrome.storage.local.get('qwenAlwaysAllowedOperations').catch(() => ({}));
    const next = [...new Set([
      ...(Array.isArray(stored?.qwenAlwaysAllowedOperations) ? stored.qwenAlwaysAllowedOperations : []),
      name
    ].map(String).filter(Boolean))];
    await chrome.storage.local.set({ qwenAlwaysAllowedOperations: next });
  }

  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const pending = approvalRequests.get(notificationId);
    if (!pending) return;
    approvalRequests.delete(notificationId);
    chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    void (async () => {
      if (buttonIndex === 1) {
        await rememberAlwaysAllowed(pending.name);
      }
      pending.resolve(buttonIndex === 0 || buttonIndex === 1);
    })();
  });

  chrome.notifications.onClosed.addListener((notificationId) => {
    const pending = approvalRequests.get(notificationId);
    if (!pending) return;
    approvalRequests.delete(notificationId);
    pending.resolve(false);
  });

  async function executeRequest(action, payload) {
    const api = global.BJTUCA;
    if (!api) {
      throw Object.assign(
        new Error('BJTUCA 操作注册表未就绪，请先安装「通义千问」模块以注册操作表'),
        { code: 'MODULE_UNAVAILABLE' }
      );
    }
    if (action === 'operationList') {
      const response = await api.run('qwen.operationList', {});
      if (!response?.ok) throw Object.assign(new Error(response?.error || '操作列表获取失败'), { code: response?.code || '' });
      return response.result;
    }
    if (action === 'getDocs') {
      const response = await api.run('qwen.getDocs', payload || {});
      if (!response?.ok) throw Object.assign(new Error(response?.error || '操作说明获取失败'), { code: response?.code || '' });
      return response.result;
    }
    if (action === 'call') {
      const name = String(payload?.name || '').trim();
      const args = payload?.arguments;
      if (!name) throw Object.assign(new Error('缺少操作名'), { code: 'INVALID_ARGUMENT' });
      if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
        throw Object.assign(new TypeError('arguments 必须是对象'), { code: 'INVALID_ARGUMENTS' });
      }
      if (!api.get?.(name)) throw Object.assign(new Error(`未找到操作：${name}`), { code: 'OPERATION_NOT_FOUND' });
      if (!await operationApproval(name)) {
        throw Object.assign(new Error(`用户拒绝执行操作「${name}」`), { code: 'USER_DENIED' });
      }
      return api.run(name, args || {});
    }
    throw Object.assign(new Error(`未知 Bridge 请求：${action}`), { code: 'UNKNOWN_ACTION' });
  }

  async function handleRequest(message, ws) {
    const id = String(message?.id || '');
    if (!id) return;
    if (!currentSettings.enabled) {
      sendResponse(ws, id, {
        ok: false,
        error: '扩展未启用“允许本地程序调用扩展操作”',
        code: 'BRIDGE_DISABLED'
      });
      return;
    }
    if (completedRequests.has(id)) {
      sendResponse(ws, id, completedRequests.get(id));
      return;
    }
    if (inflightRequests.has(id)) {
      sendResponse(ws, id, await inflightRequests.get(id));
      return;
    }
    const task = (async () => {
      try {
        return { ok: true, result: await executeRequest(String(message?.action || ''), message?.payload || {}) };
      } catch (error) {
        return {
          ok: false,
          error: String(error?.message || error),
          code: String(error?.code || 'BRIDGE_OPERATION_FAILED')
        };
      }
    })();
    inflightRequests.set(id, task);
    const response = await task;
    inflightRequests.delete(id);
    completedRequests.set(id, response);
    while (completedRequests.size > 100) completedRequests.delete(completedRequests.keys().next().value);
    sendResponse(ws, id, response);
  }

  async function readBridgeConfig() {
    const configUrl = `${chrome.runtime.getURL('modules/local-bridge/bridge.json')}?t=${Date.now()}`;
    const response = await fetch(configUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('无法读取 modules/local-bridge/bridge.json，请先启动 Bridge');
    }
    const config = await response.json().catch(() => null);
    const token = String(config?.token || '').trim();
    if (!token) throw new Error('bridge.json 中没有有效的 Bearer Token');
    return {
      token,
      port: normalizePort(config?.port),
      allowLan: config?.allowLan === true
    };
  }

  async function syncBridgeConfigFromFile() {
    const config = await readBridgeConfig();
    currentSettings = { ...currentSettings, ...config };
    await chrome.storage.local.set({
      [STORAGE_KEYS.port]: config.port,
      [STORAGE_KEYS.token]: config.token,
      [STORAGE_KEYS.allowLan]: config.allowLan
    });
    return config;
  }

  async function readExtensionDirectoryHandle() {
    if (!global.BjtuUpdateFileSystem?.readDirectoryHandle) {
      throw new Error('更新组件未安装，无法读取扩展安装目录');
    }
    return global.BjtuUpdateFileSystem.readDirectoryHandle();
  }

  async function writeBridgeConfig(patch) {
    const root = await readExtensionDirectoryHandle();
    if (!root || typeof root.queryPermission !== 'function'
        || await root.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('没有扩展安装目录写入权限，请先在“更新”中授权扩展目录');
    }
    const current = await readBridgeConfig();
    const next = {
      port: patch?.port === undefined ? current.port : normalizePort(patch.port),
      token: current.token,
      allowLan: patch?.allowLan === undefined ? current.allowLan : patch.allowLan === true
    };
    const bytes = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`);
    if (!global.BjtuUpdateFileSystem?.writeFile) throw new Error('扩展文件写入组件不可用');
    await global.BjtuUpdateFileSystem.writeFile(root, BRIDGE_CONFIG_PATH, bytes);
    currentSettings = { ...currentSettings, ...next };
    await chrome.storage.local.set({
      [STORAGE_KEYS.port]: next.port,
      [STORAGE_KEYS.token]: next.token,
      [STORAGE_KEYS.allowLan]: next.allowLan
    });
    return next;
  }

  async function updateSettings(patch) {
    const next = {};
    if (typeof patch?.enabled === 'boolean') next[STORAGE_KEYS.enabled] = patch.enabled;
    if (typeof patch?.autoRetry === 'boolean') next[STORAGE_KEYS.autoRetry] = patch.autoRetry;
    if (patch?.retryIntervalMs !== undefined) {
      next[STORAGE_KEYS.retryIntervalMs] = normalizeRetryInterval(patch.retryIntervalMs);
    }
    if (!Object.keys(next).length) {
      await loadSettings();
      return statusPayload();
    }
    if (patch?.enabled === false) {
      for (const pending of approvalRequests.values()) pending.resolve(false);
      approvalRequests.clear();
    }
    await chrome.storage.local.set(next);
    await loadSettings();
    if (!currentSettings.autoRetry) clearReconnectTimer();
    else if (!socket || socket.readyState === WebSocket.CLOSED) scheduleReconnect();
    void global.BjtuActionBridgeIndicator?.setConnected(
      connectionState === 'connected' && currentSettings.enabled
    );
    broadcastStatus();
    return statusPayload();
  }

  async function changePort(port) {
    const nextPort = normalizePort(port);
    if (nextPort !== currentSettings.port) {
      await writeBridgeConfig({ port: nextPort });
    }
    return statusPayload();
  }

  async function changeAllowLan(allowLan) {
    const nextAllowLan = allowLan === true;
    if (nextAllowLan !== currentSettings.allowLan) {
      await writeBridgeConfig({ allowLan: nextAllowLan });
    }
    return statusPayload();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = String(message?.type || '');
    if (type === 'BJTUCA_LOCAL_BRIDGE_STATUS') {
      void connect().then(
        () => sendResponse(statusPayload()),
        (error) => sendResponse({ ...statusPayload(), ok: false, error: String(error?.message || error) })
      );
      return true;
    }
    if (type === 'BJTUCA_LOCAL_BRIDGE_SETTINGS_SET') {
      const task = (async () => {
        if (message?.payload?.port !== undefined) await changePort(message.payload.port);
        if (typeof message?.payload?.allowLan === 'boolean') {
          await changeAllowLan(message.payload.allowLan);
        }
        if (typeof message?.payload?.autoRetry === 'boolean'
            || message?.payload?.retryIntervalMs !== undefined) {
          await updateSettings({
            ...(typeof message.payload.autoRetry === 'boolean' ? { autoRetry: message.payload.autoRetry } : {}),
            ...(message.payload.retryIntervalMs !== undefined
              ? { retryIntervalMs: message.payload.retryIntervalMs }
              : {})
          });
        }
        if (typeof message?.payload?.enabled === 'boolean') {
          await updateSettings({ enabled: message.payload.enabled });
        }
        return statusPayload();
      })();
      void task.then(
        (value) => sendResponse({ ok: true, ...value }),
        (error) => sendResponse({ ok: false, error: String(error?.message || error) })
      );
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !Object.values(STORAGE_KEYS).some((key) => changes[key])) return;
    void (async () => {
      const before = { ...currentSettings };
      await loadSettings();
      const connectionConfigChanged = before.port !== currentSettings.port
        || before.token !== currentSettings.token
        || before.allowLan !== currentSettings.allowLan;
      if (connectionConfigChanged) {
        closeSocket(1000, 'Bridge config changed');
        await connect();
        return;
      }
      if (!currentSettings.autoRetry) clearReconnectTimer();
      else if (!socket || socket.readyState === WebSocket.CLOSED) scheduleReconnect();
      void global.BjtuActionBridgeIndicator?.setConnected(
        connectionState === 'connected' && currentSettings.enabled
      );
      broadcastStatus();
    })();
  });

  global.BJTUCALocalBridge = Object.freeze({
    status: () => statusPayload(),
    connect
  });

  void connect();
})(globalThis);
