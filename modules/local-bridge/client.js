/* 本地程序桥接客户端：连接本机或局域网内的 BJTU Course Assistant Bridge。 */
(function initBJTUCALocalBridge(global) {
  'use strict';
  if (!global.BJTUCA || !global.BjtuApiSettings) return;

  const DEFAULT_PORT = 1896;
  const DEFAULT_RETRY_INTERVAL_MS = 500;
  const BRIDGE_CONFIG_PATH = 'modules/local-bridge/bridge.json';
  const RECONNECT_ALARM = 'bjtu-local-bridge-reconnect';
  const STORAGE_KEYS = Object.freeze({
    enabled: 'bjtuLocalBridgeEnabled',
    localPort: 'bjtuLocalBridgeListenPort',
    localToken: 'bjtuLocalBridgeLocalToken',
    remoteConfig: 'bjtuLocalBridgeRemoteConfig',
    allowLan: 'bjtuLocalBridgeAllowLan',
    autoRetry: 'bjtuLocalBridgeAutoRetry',
    retryIntervalMs: 'bjtuLocalBridgeRetryIntervalMs'
  });
  const META_OPERATIONS = new Set(['api.operationList', 'api.getDocs']);
  const APPROVAL_PREFIX = 'bjtu-local-bridge-approval:';
  const approvalRequests = new Map();
  const completedRequests = new Map();
  const inflightRequests = new Map();
  const requestControllers = new Map();
  let socket = null;
  let reconnectTimer = null;
  let connectPromise = null;
  let configWritePromise = null;
  let configRevision = 0;
  let lastConfigReadAt = 0;
  let connectionReplaced = false;
  let currentSettings = {
    enabled: true,
    port: DEFAULT_PORT,
    token: '',
    host: '127.0.0.1',
    allowLan: false,
    localPort: DEFAULT_PORT,
    localToken: '',
    remoteConfig: { host: '127.0.0.1', port: DEFAULT_PORT, token: '' },
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

  function normalizeHost(value) {
    const host = String(value || '127.0.0.1').trim();
    const parsed = new URL(`http://${host}`);
    if (parsed.port || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('请输入 Bridge 的 IP 地址或主机名，不含协议、端口或路径');
    }
    return parsed.hostname;
  }

  function isRemote() {
    return !['127.0.0.1', 'localhost', '[::1]'].includes(currentSettings.host);
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS)).catch(() => ({}));
    const remoteConfig = stored[STORAGE_KEYS.remoteConfig] || {};
    const host = normalizeHost(remoteConfig.host);
    const remote = !['127.0.0.1', 'localhost', '[::1]'].includes(host);
    const localPort = normalizePort(stored[STORAGE_KEYS.localPort]);
    const localToken = String(stored[STORAGE_KEYS.localToken] || '').trim();
    currentSettings = {
      enabled: stored[STORAGE_KEYS.enabled] !== false,
      port: remote ? normalizePort(remoteConfig.port) : localPort,
      token: remote ? String(remoteConfig.token || '').trim() : localToken,
      host,
      localPort,
      localToken,
      remoteConfig: { host, port: normalizePort(remoteConfig.port), token: String(remoteConfig.token || '').trim() },
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
      host: currentSettings.host,
      remote: isRemote(),
      allowLan: currentSettings.allowLan,
      localPort: currentSettings.localPort,
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

  function closeSocket(code = 1000, reason = 'Disabled') {
    clearReconnectTimer();
    for (const controller of requestControllers.values()) controller.abort();
    const current = socket;
    socket = null;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      try { current.close(code, reason); } catch {}
    }
  }

  function scheduleReconnect() {
    if (!currentSettings.autoRetry || connectionReplaced || reconnectTimer) return;
    const delay = normalizeRetryInterval(currentSettings.retryIntervalMs);
    // setTimeout provides the short retry; the alarm is a service-worker wake-up fallback.
    chrome.alarms.create(RECONNECT_ALARM, { when: Date.now() + Math.max(delay, 1000) });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  }

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== RECONNECT_ALARM || !currentSettings.autoRetry || connectionReplaced) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    void connect();
  });

  async function extensionVersion() {
    const manifestVersion = chrome.runtime.getManifest().version;
    const stored = await chrome.storage.local.get('appliedUpdateWithoutReload').catch(() => ({}));
    const applied = String(stored.appliedUpdateWithoutReload?.ver || '').replace(/^v/i, '');
    if (!/^\d+(?:\.\d+){0,3}$/.test(applied)) return manifestVersion;
    const appliedParts = applied.split('.').map(Number);
    const manifestParts = manifestVersion.split('.').map(Number);
    const difference = Array.from({ length: 4 }, (_, index) => (
      (appliedParts[index] || 0) - (manifestParts[index] || 0)
    )).find(value => value !== 0) || 0;
    return difference > 0 ? applied : manifestVersion;
  }

  async function helloMessage(authentication) {
    return { type: 'hello', extensionId: chrome.runtime.id, version: await extensionVersion(), ...authentication };
  }

  function connect() {
    if (connectPromise) return connectPromise;
    connectPromise = connectOnce().finally(() => { connectPromise = null; });
    return connectPromise;
  }

  async function connectOnce() {
    if (connectionReplaced) return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    if (configWritePromise) await configWritePromise;
    await loadSettings();
    try {
      const before = { ...currentSettings };
      if (Date.now() - lastConfigReadAt >= 10000) {
        lastConfigReadAt = Date.now();
        await syncBridgeConfigFromFile();
      }
      if (socket && (before.port !== currentSettings.port || before.token !== currentSettings.token || before.host !== currentSettings.host)) {
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
    if (isRemote() && !currentSettings.token) {
      setState('unconfigured', '请输入目标 Bridge 的 6 位配对码');
      scheduleReconnect();
      return;
    }
    setState('connecting');
    const connectionToken = currentSettings.token;
    const ws = new WebSocket(`ws://${currentSettings.host}:${currentSettings.port}/extension`);
    socket = ws;
    ws.addEventListener('open', async () => {
      const message = await helloMessage({ token: connectionToken });
      if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    });
    ws.addEventListener('message', (event) => {
      if (socket !== ws) return;
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message?.type === 'ready') {
        setState('connected');
        return;
      }
      if (message?.type === '知行') {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: '合一' }));
        return;
      }
      if (message?.type === 'request') void handleRequest(message, ws);
      if (message?.type === 'cancel') requestControllers.get(String(message.id || ''))?.abort();
    });
    ws.addEventListener('close', (event) => {
      if (socket !== ws) return;
      for (const controller of requestControllers.values()) controller.abort();
      socket = null;
      if (event.code === 4002) {
        connectionReplaced = true;
        clearReconnectTimer();
        setState('disconnected', 'Bridge 已连接另一个扩展，已暂停自动重连；如需接回，请重新配对');
        return;
      }
      const authorizationRevoked = event.code === 1008 || event.code === 4001;
      if (authorizationRevoked) {
        const seconds = normalizeRetryInterval(currentSettings.retryIntervalMs) / 1000;
        setState('unconfigured', `Bridge token 不匹配；将在 ${seconds} 秒后重试，或使用配对码重新连接`);
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

  async function operationApproval(name, description = '', signal) {
    signal?.throwIfAborted();
    if (META_OPERATIONS.has(name)) return true;
    const settings = await global.BjtuApiSettings.get();
    signal?.throwIfAborted();
    const alwaysAllowed = new Set(settings.alwaysAllowedOperations);
    if (alwaysAllowed.has(name)) return true;

    const approvalId = crypto.randomUUID();
    let cancelPage;
    const cancelled = new Promise((resolve) => {
      cancelPage = () => resolve(null);
      signal?.addEventListener('abort', cancelPage, { once: true });
    });
    let pageDecision;
    try {
      pageDecision = await Promise.race([cancelled, chrome.runtime.sendMessage({
        type: 'BJTUCA_LOCAL_APPROVAL_REQUEST',
        id: approvalId,
        name,
        message: `本地程序请求执行「${name}」，是否允许？${description ? `\n${description}` : ''}`
      }).catch(() => null)]);
    } finally {
      signal?.removeEventListener('abort', cancelPage);
      if (signal?.aborted) {
        void chrome.runtime.sendMessage({ type: 'BJTUCA_LOCAL_APPROVAL_RESOLVED', id: approvalId }).catch(() => {});
      }
    }
    signal?.throwIfAborted();
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
    const cancelNotification = () => {
      const pending = approvalRequests.get(notificationId);
      if (!pending) return;
      approvalRequests.delete(notificationId);
      chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
      pending.resolve(false);
    };
    return new Promise((resolve) => {
      approvalRequests.set(notificationId, { resolve, name });
      signal?.addEventListener('abort', cancelNotification, { once: true });
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/128.png'),
        title: '本地程序请求执行操作',
        message: `是否允许执行「${name}」？${description ? `\n${description}` : ''}`,
        requireInteraction: true,
        buttons: [{ title: '允许' }, { title: '拒绝' }]
      }, () => {
        if (signal?.aborted) chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
        if (!chrome.runtime.lastError) return;
        approvalRequests.delete(notificationId);
        resolve(false);
      });
    }).finally(() => signal?.removeEventListener('abort', cancelNotification));
  }

  async function rememberAlwaysAllowed(name) {
    const settings = await global.BjtuApiSettings.get();
    await global.BjtuApiSettings.save({ alwaysAllowedOperations: [...settings.alwaysAllowedOperations, name] });
  }

  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const pending = approvalRequests.get(notificationId);
    if (!pending) return;
    approvalRequests.delete(notificationId);
    chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    pending.resolve(buttonIndex === 0);
  });

  chrome.notifications.onClosed.addListener((notificationId) => {
    const pending = approvalRequests.get(notificationId);
    if (!pending) return;
    approvalRequests.delete(notificationId);
    pending.resolve(false);
  });

  async function executeRequest(action, payload, signal) {
    signal?.throwIfAborted();
    const api = global.BJTUCA;
    if (!api) {
      throw Object.assign(
        new Error('BJTUCA 操作注册表未就绪，请先安装「扩展接口」模块'),
        { code: 'MODULE_UNAVAILABLE' }
      );
    }
    if (action === 'operationList') {
      const response = await api.run('api.operationList', {});
      if (!response?.ok) throw Object.assign(new Error(response?.error || '操作列表获取失败'), { code: response?.code || '' });
      return response.result;
    }
    if (action === 'getDocs') {
      const response = await api.run('api.getDocs', payload || {});
      if (!response?.ok) throw Object.assign(new Error(response?.error || '操作说明获取失败'), { code: response?.code || '' });
      return response.result;
    }
    if (action === 'executeCode') {
      const mode = String(payload?.mode || 'app');
      const code = String(payload?.code || '');
      if (!['app', 'background', 'sandbox'].includes(mode) || !code.trim()) {
        throw Object.assign(new Error('代码或执行环境无效'), { code: 'INVALID_ARGUMENT' });
      }
      if (mode !== 'sandbox' && !await operationApproval(`code.${mode}`, code, signal)) {
        throw Object.assign(new Error('用户拒绝执行代码'), { code: 'USER_DENIED' });
      }
      signal?.throwIfAborted();
      return api.executeCode(mode, code);
    }
    if (action === 'call') {
      const name = String(payload?.name || '').trim();
      const args = payload?.arguments;
      if (!name) throw Object.assign(new Error('缺少操作名'), { code: 'INVALID_ARGUMENT' });
      if (args != null && (typeof args !== 'object' || Array.isArray(args))) {
        throw Object.assign(new TypeError('arguments 必须是对象'), { code: 'INVALID_ARGUMENTS' });
      }
      if (!api.get?.(name)) throw Object.assign(new Error(`未找到操作：${name}`), { code: 'OPERATION_NOT_FOUND' });
      if (!await operationApproval(name, '', signal)) {
        throw Object.assign(new Error(`用户拒绝执行操作「${name}」`), { code: 'USER_DENIED' });
      }
      signal?.throwIfAborted();
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
        error: '扩展未启用「允许本地程序调用扩展操作」',
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
    const controller = new AbortController();
    requestControllers.set(id, controller);
    const task = (async () => {
      try {
        return { ok: true, result: await executeRequest(String(message?.action || ''), message?.payload || {}, controller.signal) };
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
    requestControllers.delete(id);
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
    return {
      token: String(config?.token || '').trim(),
      port: normalizePort(config?.port),
      allowLan: config?.allowLan === true
    };
  }

  async function syncBridgeConfigFromFile() {
    if (configWritePromise) await configWritePromise;
    const revision = configRevision;
    const config = await readBridgeConfig();
    if (revision !== configRevision || configWritePromise) return config;
    await storeBridgeConfig(config);
    return config;
  }

  async function storeBridgeConfig(config) {
    const remoteConfig = currentSettings.remoteConfig;
    const remote = !['127.0.0.1', 'localhost', '[::1]'].includes(remoteConfig.host);
    const effective = {
      host: remoteConfig.host,
      port: remote ? remoteConfig.port : config.port,
      token: remote ? remoteConfig.token : config.token,
      localPort: config.port,
      localToken: config.token,
      allowLan: config.allowLan
    };
    currentSettings = { ...currentSettings, ...effective };
    await chrome.storage.local.set({
      [STORAGE_KEYS.localPort]: config.port,
      [STORAGE_KEYS.localToken]: config.token,
      [STORAGE_KEYS.allowLan]: config.allowLan
    });
  }

  async function readExtensionDirectoryHandle() {
    if (!global.BjtuUpdateFileSystem?.readDirectoryHandle) {
      throw new Error('更新组件未安装，无法读取扩展安装目录');
    }
    return global.BjtuUpdateFileSystem.readDirectoryHandle();
  }

  function writeBridgeConfig(patch) {
    configRevision++;
    const previous = configWritePromise;
    const task = (async () => {
      if (previous) await previous;
      return writeBridgeConfigOnce(patch);
    })();
    configWritePromise = task;
    void task.finally(() => { if (configWritePromise === task) configWritePromise = null; }).catch(() => {});
    return task;
  }

  async function writeBridgeConfigOnce(patch) {
    await loadSettings();
    const currentRemote = currentSettings.remoteConfig;
    const host = patch.host === undefined ? currentRemote.host : normalizeHost(patch.host);
    const remoteTarget = !['127.0.0.1', 'localhost', '[::1]'].includes(host);
    const hostChanged = host !== currentRemote.host;
    const remoteConfig = {
      host,
      port: remoteTarget && patch.port !== undefined ? normalizePort(patch.port)
        : hostChanged ? DEFAULT_PORT : currentRemote.port,
      token: patch.remoteToken !== undefined ? String(patch.remoteToken)
        : hostChanged && remoteTarget ? '' : currentRemote.token
    };
    const writesLocalConfig = patch.localPort !== undefined || patch.allowLan !== undefined
      || (!remoteTarget && patch.port !== undefined);
    if (writesLocalConfig) {
      const root = await readExtensionDirectoryHandle();
      if (!root || typeof root.queryPermission !== 'function'
          || await root.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('没有扩展安装目录写入权限，请先在「更新」中授权扩展目录');
      }
      let current;
      try { current = await readBridgeConfig(); }
      catch {
        current = { port: currentSettings.localPort, token: currentSettings.localToken,
          allowLan: currentSettings.allowLan };
      }
      const next = {
        port: patch.localPort !== undefined ? normalizePort(patch.localPort)
          : !remoteTarget && patch.port !== undefined ? normalizePort(patch.port) : current.port,
        token: current.token,
        allowLan: patch.allowLan === undefined ? current.allowLan : patch.allowLan === true
      };
      const bytes = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`);
      if (!global.BjtuUpdateFileSystem?.writeFile) throw new Error('扩展文件写入组件不可用');
      await global.BjtuUpdateFileSystem.writeFile(root, BRIDGE_CONFIG_PATH, bytes);
      lastConfigReadAt = Date.now();
      await storeBridgeConfig(next);
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.remoteConfig]: remoteConfig });
    await loadSettings();
    return currentSettings;
  }

  async function pairRemote(host, port, code) {
    const targetHost = normalizeHost(host);
    const targetPort = normalizePort(port);
    if (!/^\d{6}$/.test(String(code || ''))) throw new Error('配对码必须是 6 位数字');
    const ws = new WebSocket(`ws://${targetHost}:${targetPort}/extension`);
    try {
      const config = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('配对连接超时')); }, 15000);
        const finish = (fn, value) => { clearTimeout(timer); fn(value); };
        ws.addEventListener('open', async () => {
          const message = await helloMessage({ pairingCode: String(code) });
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
        });
        ws.addEventListener('message', (event) => {
          let message;
          try { message = JSON.parse(String(event.data)); } catch { return; }
          if (message.type === 'ready' && message.token) finish(resolve, message);
        });
        ws.addEventListener('error', () => finish(reject, new Error('无法连接 Bridge，请检查地址、端口、局域网访问及防火墙')));
        ws.addEventListener('close', () => finish(reject, new Error('配对码无效或已过期')));
      });
      closeSocket();
      await writeBridgeConfig({ host:targetHost, port:targetPort, remoteToken:config.token });
      connectionReplaced = false;
      await connect();
      return statusPayload();
    } finally { ws.close(); }
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = String(message?.type || '');
    if (type === 'BJTUCA_LOCAL_BRIDGE_STATUS') {
      sendResponse(statusPayload());
      return false;
    }
    if (type === 'BJTUCA_LOCAL_BRIDGE_PAIR') {
      void pairRemote(message.payload?.host, message.payload?.port, message.payload?.code).then(
        sendResponse, (error) => sendResponse({ok:false,error:String(error?.message || error)})
      );
      return true;
    }
    if (type === 'BJTUCA_LOCAL_BRIDGE_SETTINGS_SET') {
      const task = (async () => {
        const configPatch = Object.fromEntries(['host', 'port', 'localPort', 'allowLan']
          .filter((key) => message.payload?.[key] !== undefined)
          .map((key) => [key, message.payload[key]]));
        if (Object.keys(configPatch).length) {
          const before = { ...currentSettings };
          await writeBridgeConfig(configPatch);
          if (before.host !== currentSettings.host || before.port !== currentSettings.port
            || before.token !== currentSettings.token) {
            connectionReplaced = false;
            closeSocket();
            await connect();
          } else broadcastStatus();
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
    if (areaName === 'local' && changes.appliedUpdateWithoutReload) {
      const current = socket;
      void extensionVersion().then((version) => {
        if (socket === current && current?.readyState === WebSocket.OPEN) {
          current.send(JSON.stringify({ type: 'version', version }));
        }
      });
    }
    if (areaName !== 'local' || !Object.values(STORAGE_KEYS).some((key) => changes[key])) return;
    void (async () => {
      const before = { ...currentSettings };
      await loadSettings();
      const connectionConfigChanged = before.port !== currentSettings.port
        || before.host !== currentSettings.host
        || before.token !== currentSettings.token;
      if (connectionConfigChanged) {
        connectionReplaced = false;
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

  void chrome.storage.local.remove([
    'bjtuLocalBridgeHost', 'bjtuLocalBridgePort', 'bjtuLocalBridgeToken'
  ]).then(() => connect());
})(globalThis);
