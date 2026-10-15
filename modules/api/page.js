/* 扩展页面 JavaScript 执行桥与控制台操作接口；不依赖聊天模块。 */
(function initBjtuApiPage(global) {
  'use strict';

  if (global.BjtuApiPage) return;

  let apiPagePort = null;
  let apiPageReconnectTimer = null;
  let apiPageClosing = false;

  function scheduleApiPageReconnect() {
    if (apiPageClosing || apiPageReconnectTimer !== null) return;
    apiPageReconnectTimer = setTimeout(() => {
      apiPageReconnectTimer = null;
      connectApiPagePort();
    }, 1000);
  }

  function connectApiPagePort() {
    if (apiPageClosing || apiPagePort) return;
    try {
      const port = chrome.runtime.connect({ name: 'bjtu-api-page' });
      apiPagePort = port;
      // 同一连接内的重复请求只处理一次，不重新执行有副作用的代码。
      const acceptedRequests = new Set();
      port.onMessage.addListener((message) => {
        if (message?.type !== 'execute' || !message.id || acceptedRequests.has(message.id)) return;
        acceptedRequests.add(message.id);
        void Promise.resolve().then(() => {
          if (message.fn !== 'executeJs') {
            throw Object.assign(new Error(`未知页面操作：${String(message.fn || '')}`), { code: 'PAGE_API_UNKNOWN_FUNCTION' });
          }
          return executeCode(message.args?.code, message.args?.mode);
        }).then((value) => ({ ok: true, value }), (error) => ({
          ok: false, error: String(error?.message || error), code: String(error?.code || 'CODE_EXECUTION_FAILED')
        })).then((response) => {
          try { port.postMessage({ type: 'result', id: message.id, ...response }); } catch {
            // 断开由后台结束请求；这里不能重连后再次执行或重发执行请求。
          }
        });
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (apiPagePort !== port) return;
        apiPagePort = null;
        scheduleApiPageReconnect();
      });
    } catch {
      apiPagePort = null;
      scheduleApiPageReconnect();
    }
  }

  global.addEventListener('pagehide', () => {
    apiPageClosing = true;
    clearTimeout(apiPageReconnectTimer);
    apiPageReconnectTimer = null;
    const port = apiPagePort;
    apiPagePort = null;
    port?.disconnect();
  });
  global.addEventListener('pageshow', () => {
    // 从页面缓存返回时恢复路由，但绝不恢复或重放旧连接的执行请求。
    apiPageClosing = false;
    connectApiPagePort();
  });
  // 必须先连接，再公开控制台代理；收到请求后 executeCode 会等待命名空间就绪。
  connectApiPagePort();

  function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { ok: false, message: String(error.message || '通信失败') } : (response || {}));
      });
    });
  }

  const JS_SANDBOX_CHANNEL = 'bjtu-api-js-sandbox';
  let jsSandboxFramePromise = null;

  function ensureJsSandboxFrame() {
    if (jsSandboxFramePromise) return jsSandboxFramePromise;
    jsSandboxFramePromise = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.setAttribute('aria-hidden', 'true');
      frame.src = chrome.runtime.getURL('core/sandbox/js-executor.html');
      const timer = setTimeout(() => {
        frame.remove();
        jsSandboxFramePromise = null;
        reject(new Error('JavaScript 沙箱加载超时'));
      }, 10000);
      frame.addEventListener('load', () => {
        clearTimeout(timer);
        resolve(frame);
      }, { once: true });
      frame.addEventListener('error', () => {
        clearTimeout(timer);
        frame.remove();
        jsSandboxFramePromise = null;
        reject(new Error('JavaScript 沙箱加载失败'));
      }, { once: true });
      (document.body || document.documentElement).appendChild(frame);
    });
    return jsSandboxFramePromise;
  }

  function jsBridgePathParts(path) {
    const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('桥接路径为空');
    if (['window', 'globalThis', 'self'].includes(parts[0])) parts.shift();
    if (!parts.length) throw new Error('不能直接访问整个页面全局对象');
    return parts;
  }

  function resolveJsBridgePath(root, path) {
    const parts = jsBridgePathParts(path);
    let owner = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      owner = owner?.[parts[i]];
      if (owner == null) throw new Error(`桥接路径不存在：${parts.slice(0, i + 1).join('.')}`);
    }
    const key = parts.at(-1);
    return { owner, key, value: owner?.[key] };
  }

  function jsBridgeSerializable(value, seen = new WeakSet(), depth = 0) {
    if (value === undefined) return { __type: 'undefined' };
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value === 'symbol') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || '' };
    if (value instanceof Element) {
      return {
        tagName: value.tagName.toLowerCase(),
        id: value.id || '',
        className: typeof value.className === 'string' ? value.className : '',
        textContent: String(value.textContent || '').slice(0, 10000),
        attributes: Object.fromEntries(Array.from(value.attributes || []).map((item) => [item.name, item.value]))
      };
    }
    if (depth > 8) return '[深度受限]';
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => jsBridgeSerializable(item, seen, depth + 1));
    const output = {};
    for (const key of Object.keys(value)) {
      try { output[key] = jsBridgeSerializable(value[key], seen, depth + 1); } catch (error) {
        output[key] = `[读取失败：${String(error?.message || error)}]`;
      }
    }
    return output;
  }

  function reviveJsBridgeCallbacks(value, executionId, frame, seen = new WeakMap()) {
    if (!value || typeof value !== 'object') return value;
    if (value.__type === 'undefined') return undefined;
    if (value.__type === 'bridge-callback' && value.callbackId) {
      const callbackId = String(value.callbackId);
      return (...args) => {
        const runtimeError = chrome?.runtime?.lastError;
        frame.contentWindow?.postMessage({
          channel: JS_SANDBOX_CHANNEL,
          type: 'bridge-callback',
          executionId,
          callbackId,
          args: jsBridgeSerializable(args),
          lastError: runtimeError ? { message: String(runtimeError.message || runtimeError) } : null
        }, '*');
      };
    }
    if (seen.has(value)) return seen.get(value);
    const output = Array.isArray(value) ? [] : {};
    seen.set(value, output);
    for (const [key, child] of Object.entries(value)) {
      output[key] = reviveJsBridgeCallbacks(child, executionId, frame, seen);
    }
    return output;
  }

  function requireJsBridgeElement(selector) {
    const element = document.querySelector(String(selector || ''));
    if (!(element instanceof Element)) throw new Error(`未找到元素：${String(selector || '')}`);
    return element;
  }

  async function handleAppJsBridge(action, payload) {
    if (action === 'roots') {
      return [...new Set([
        'document',
        ...Object.getOwnPropertyNames(global)
      ].filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(name))))];
    }
    if (action === 'dom.query') return jsBridgeSerializable(document.querySelector(String(payload?.selector || '')));
    if (action === 'dom.queryAll') {
      return jsBridgeSerializable(Array.from(document.querySelectorAll(String(payload?.selector || ''))));
    }
    if (action.startsWith('dom.')) {
      const element = requireJsBridgeElement(payload?.selector);
      if (action === 'dom.get') return jsBridgeSerializable(resolveJsBridgePath(element, payload?.property).value);
      if (action === 'dom.set') {
        const target = resolveJsBridgePath(element, payload?.property);
        target.owner[target.key] = payload?.value;
        return true;
      }
      if (action === 'dom.call') {
        const target = resolveJsBridgePath(element, payload?.method);
        if (typeof target.value !== 'function') throw new Error(`DOM 方法不存在：${String(payload?.method || '')}`);
        return jsBridgeSerializable(await target.value.apply(target.owner, Array.isArray(payload?.args) ? payload.args : []));
      }
    }
    const target = resolveJsBridgePath(global, payload?.path);
    if (action === 'get') return jsBridgeSerializable(target.value);
    if (action === 'set') {
      target.owner[target.key] = payload?.value;
      return true;
    }
    if (action === 'call') {
      if (typeof target.value !== 'function') throw new Error(`页面方法不存在：${String(payload?.path || '')}`);
      return jsBridgeSerializable(await target.value.apply(target.owner, Array.isArray(payload?.args) ? payload.args : []));
    }
    throw new Error(`未知 app 桥接操作：${String(action || '')}`);
  }

  async function handleJsBridge(mode, action, payload) {
    if (mode === 'app') return handleAppJsBridge(action, payload);
    if (mode === 'background') {
      const response = await send('BJTUCA_JS_BACKGROUND_BRIDGE', { action, payload });
      if (!response?.ok) throw new Error(String(response?.message || '后台桥接调用失败'));
      return response.value;
    }
    throw new Error('sandbox 模式不能调用上下文桥接');
  }

  async function executeCode(code, mode = 'sandbox') {
    await consoleNamespacesReady;
    const frame = await ensureJsSandboxFrame();
    const id = `js-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const normalizedMode = ['sandbox', 'app', 'background'].includes(String(mode)) ? String(mode) : 'sandbox';
    let bindingRoots = [];
    if (normalizedMode === 'app') {
      bindingRoots = await handleAppJsBridge('roots', {});
    } else if (normalizedMode === 'background') {
      const response = await send('BJTUCA_JS_BACKGROUND_BRIDGE', { action: 'roots', payload: {} });
      if (!response?.ok) throw new Error(String(response?.message || '无法读取后台可用命名空间'));
      bindingRoots = Array.isArray(response.value) ? response.value : [];
    }
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = event?.data;
        if (event.source !== frame.contentWindow || data?.channel !== JS_SANDBOX_CHANNEL) return;
        if (data?.type === 'bridge-call' && String(data.executionId || '') === id) {
          const bridgePayload = normalizedMode === 'app'
            ? reviveJsBridgeCallbacks(data.payload, id, frame)
            : data.payload;
          void handleJsBridge(normalizedMode, String(data.action || ''), bridgePayload).then((result) => {
            frame.contentWindow?.postMessage({
              channel: JS_SANDBOX_CHANNEL,
              type: 'bridge-result',
              requestId: String(data.requestId || ''),
              ok: true,
              result: jsBridgeSerializable(result)
            }, '*');
          }).catch((error) => {
            frame.contentWindow?.postMessage({
              channel: JS_SANDBOX_CHANNEL,
              type: 'bridge-result',
              requestId: String(data.requestId || ''),
              ok: false,
              error: String(error?.message || error)
            }, '*');
          });
          return;
        }
        if (data?.type !== 'result' || String(data.id || '') !== id) return;
        global.removeEventListener('message', onMessage);
        if (data.ok === true) resolve(data.result);
        else reject(new Error(String(data.error || 'JavaScript 执行失败')));
      };
      global.addEventListener('message', onMessage);
      frame.contentWindow?.postMessage({
        channel: JS_SANDBOX_CHANNEL,
        type: 'execute',
        id,
        code: String(code || ''),
        mode: normalizedMode,
        bindingRoots
      }, '*');
    });
  }

  // run 保留后台操作响应；命名空间方法仅返回 result，失败时抛出带 code 的错误。
  function runOperation(name, args = {}) {
    return send('BJTUCA_RUN_OPERATION', { name, arguments: args });
  }

  async function invokeOperation(name, args = {}) {
    const response = await runOperation(name, args);
    if (response?.ok === true) return response.result;
    const error = new Error(response?.error || response?.message || `操作失败：${name}`);
    error.code = String(response?.code || '');
    throw error;
  }

  async function operationGroups() {
    const response = await send('BJTUCA_OPERATION_SETTINGS_GET');
    if (!response?.ok || !Array.isArray(response.groups)) {
      throw new Error(response?.error || response?.message || '无法读取操作分组');
    }
    return response.groups;
  }

  global.BJTUCA = Object.freeze({
    run: runOperation,
    operationList: (args = {}) => invokeOperation('api.operationList', args),
    getDocs: (args = {}) => invokeOperation('api.getDocs', args),
    groups: operationGroups,
    executeCode: (mode, code) => executeCode(code, mode)
  });

  function installConsoleOperation(operationName) {
    const parts = String(operationName || '').trim().split('.');
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part)
      || ['__proto__', 'prototype', 'constructor'].includes(part))) return;
    const [moduleName, methodName] = parts;
    let namespace = global[moduleName];
    if (!namespace || (typeof namespace !== 'object' && typeof namespace !== 'function')) {
      namespace = {};
      Object.defineProperty(global, moduleName, {
        value: namespace, configurable: true, enumerable: true, writable: false
      });
    }
    if (Object.prototype.hasOwnProperty.call(namespace, methodName)) return;
    Object.defineProperty(namespace, methodName, {
      value: (args = {}) => {
        const promise = invokeOperation(operationName, args);
        promise.then(
          (result) => console.log(`[${operationName}]`, result),
          (error) => console.error(`[${operationName}]`, error)
        );
        return promise;
      },
      configurable: true, enumerable: true, writable: false
    });
  }

  async function installConsoleOperationNamespaces() {
    for (const group of await operationGroups()) {
      for (const entry of Array.isArray(group?.operations) ? group.operations : []) {
        installConsoleOperation(String(entry?.name || entry || ''));
      }
    }
  }

  installConsoleOperation('api.operationList');
  installConsoleOperation('api.getDocs');
  const consoleNamespacesReady = (async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await installConsoleOperationNamespaces();
        return true;
      } catch (error) {
        if (attempt === 4) {
          console.warn('[bjtu] 无法安装控制台操作命名空间：', error);
          return false;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    return false;
  })();

  global.BjtuApiPage = Object.freeze({
    executeCode,
    serializeValue: jsBridgeSerializable,
    ready: consoleNamespacesReady
  });

})(globalThis);
