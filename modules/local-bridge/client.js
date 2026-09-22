/* 本地程序桥接客户端：连接 127.0.0.1 上的 BJTU Course Assistant Bridge。 */
(function initBJTUCALocalBridge(global) {
  'use strict';

  const DEFAULT_PORT = 1896;
  const STORAGE_KEYS = Object.freeze({
    enabled: 'bjtuLocalBridgeEnabled',
    port: 'bjtuLocalBridgePort',
    token: 'bjtuLocalBridgeToken',
    allowLan: 'bjtuLocalBridgeAllowLan'
  });
  const META_OPERATIONS = new Set(['qwen.operationList', 'qwen.getDocs']);
  const APPROVAL_PREFIX = 'bjtu-local-bridge-approval:';
  const approvalRequests = new Map();
  const completedRequests = new Map();
  const inflightRequests = new Map();
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let heartbeatTimer = null;
  let currentSettings = { enabled: false, port: DEFAULT_PORT, token: '', allowLan: false };
  let connectionState = 'disconnected';
  let lastError = '';

  function normalizePort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS)).catch(() => ({}));
    currentSettings = {
      enabled: stored[STORAGE_KEYS.enabled] === true,
      port: normalizePort(stored[STORAGE_KEYS.port]),
      token: String(stored[STORAGE_KEYS.token] || '').trim(),
      allowLan: stored[STORAGE_KEYS.allowLan] === true
    };
    return currentSettings;
  }

  function statusPayload() {
    return {
      ok: true,
      enabled: currentSettings.enabled,
      port: currentSettings.port,
      allowLan: currentSettings.allowLan,
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
    if (reconnectTimer) return;
    const delay = Math.min(30_000, 500 * (2 ** Math.min(reconnectAttempt, 6)));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  async function connect() {
    await loadSettings();
    if (!currentSettings.token) {
      try {
        const config = await readBridgeConfig();
        currentSettings = { ...currentSettings, ...config };
        await chrome.storage.local.set({
          [STORAGE_KEYS.port]: config.port,
          [STORAGE_KEYS.token]: config.token,
          [STORAGE_KEYS.allowLan]: config.allowLan
        });
      } catch (error) {
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
        reconnectAttempt = 0;
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
      if (socket === ws) setState('disconnected', '无法连接本地 Bridge');
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

  async function updateSettings(patch) {
    const next = {};
    if (typeof patch?.enabled === 'boolean') next[STORAGE_KEYS.enabled] = patch.enabled;
    if (patch?.port !== undefined) next[STORAGE_KEYS.port] = normalizePort(patch.port);
    if (typeof patch?.allowLan === 'boolean') next[STORAGE_KEYS.allowLan] = patch.allowLan;
    if (!Object.keys(next).length) {
      await loadSettings();
      return statusPayload();
    }
    if (patch?.enabled === false) {
      for (const pending of approvalRequests.values()) pending.resolve(false);
      approvalRequests.clear();
    }
    await chrome.storage.local.set(next);
    closeSocket(1000, 'Settings changed');
    await connect();
    return statusPayload();
  }

  async function changePort(port) {
    const nextPort = normalizePort(port);
    const oldPort = currentSettings.port;
    if (currentSettings.token && nextPort !== oldPort) {
      const response = await fetch(`http://127.0.0.1:${oldPort}/api/v1/config/port`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSettings.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ port: nextPort })
      }).catch(() => null);
      if (response && !response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(String(data?.error || 'Bridge 端口修改失败'));
      }
    }
    return updateSettings({ port: nextPort });
  }

  async function changeAllowLan(allowLan) {
    const nextAllowLan = allowLan === true;
    if (currentSettings.token && nextAllowLan !== currentSettings.allowLan) {
      const response = await fetch(`http://127.0.0.1:${currentSettings.port}/api/v1/config/network`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentSettings.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ allowLan: nextAllowLan })
      }).catch(() => null);
      if (!response) throw new Error('无法连接本地 Bridge');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(String(data?.error || 'Bridge 局域网访问设置修改失败'));
      }
    }
    return updateSettings({ allowLan: nextAllowLan });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = String(message?.type || '');
    if (type === 'BJTUCA_LOCAL_BRIDGE_STATUS') {
      void loadSettings().then(() => sendResponse(statusPayload()));
      return true;
    }
    if (type === 'BJTUCA_LOCAL_BRIDGE_SETTINGS_SET') {
      const task = (async () => {
        if (message?.payload?.port !== undefined) await changePort(message.payload.port);
        if (typeof message?.payload?.allowLan === 'boolean') {
          await changeAllowLan(message.payload.allowLan);
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
      if (before.enabled === currentSettings.enabled
        && before.port === currentSettings.port
        && before.token === currentSettings.token
        && before.allowLan === currentSettings.allowLan) return;
      closeSocket(1000, 'Settings changed');
      await connect();
    })();
  });

  global.BJTUCALocalBridge = Object.freeze({
    status: () => statusPayload(),
    connect
  });

  void connect();
})(globalThis);
