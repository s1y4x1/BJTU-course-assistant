(function initJsExecutorSandbox() {
  'use strict';

  const CHANNEL = 'bjtu-qwen-js-sandbox';
  const pendingBridgeCalls = new Map();

  function serializable(value, seen = new WeakSet(), depth = 0) {
    if (value === undefined) return { __type: 'undefined' };
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value === 'symbol') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || '' };
    if (depth > 8) return '[深度受限]';
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => serializable(item, seen, depth + 1));
    const output = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') continue;
      try { output[key] = serializable(value[key], seen, depth + 1); } catch (error) {
        output[key] = `[读取失败：${String(error?.message || error)}]`;
      }
    }
    return output;
  }

  function callBridge(executionId, action, payload) {
    const requestId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingBridgeCalls.delete(requestId);
        reject(new Error('上下文桥接调用超时'));
      }, 30000);
      pendingBridgeCalls.set(requestId, { resolve, reject, timer });
      parent.postMessage({
        channel: CHANNEL,
        type: 'bridge-call',
        executionId,
        requestId,
        action,
        payload: serializable(payload)
      }, '*');
    });
  }

  function createContext(mode, executionId) {
    const context = Object.freeze({
      mode,
      get: (path) => callBridge(executionId, 'get', { path }),
      set: (path, value) => callBridge(executionId, 'set', { path, value }),
      call: (path, ...args) => callBridge(executionId, 'call', { path, args }),
      dom: mode === 'app' ? Object.freeze({
        query: (selector) => callBridge(executionId, 'dom.query', { selector }),
        queryAll: (selector) => callBridge(executionId, 'dom.queryAll', { selector }),
        get: (selector, property) => callBridge(executionId, 'dom.get', { selector, property }),
        set: (selector, property, value) => callBridge(executionId, 'dom.set', { selector, property, value }),
        call: (selector, method, ...args) => callBridge(executionId, 'dom.call', { selector, method, args })
      }) : undefined
    });
    return context;
  }

  async function execute(source, mode, executionId) {
    const code = String(source || '');
    if (!code.trim()) throw new Error('JavaScript 代码为空');
    const normalizedMode = ['sandbox', 'app', 'background'].includes(String(mode)) ? String(mode) : 'sandbox';
    const context = normalizedMode === 'sandbox' ? Object.freeze({ mode: 'sandbox' }) : createContext(normalizedMode, executionId);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let fn;
    try {
      fn = new AsyncFunction('context', 'app', 'background', `"use strict"; return (\n${code}\n);`);
    } catch {
      fn = new AsyncFunction('context', 'app', 'background', `"use strict";\n${code}`);
    }
    return serializable(await fn(
      context,
      normalizedMode === 'app' ? context : undefined,
      normalizedMode === 'background' ? context : undefined
    ));
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (data?.channel !== CHANNEL) return;
    if (data?.type === 'bridge-result') {
      const pending = pendingBridgeCalls.get(String(data.requestId || ''));
      if (!pending) return;
      pendingBridgeCalls.delete(String(data.requestId || ''));
      clearTimeout(pending.timer);
      if (data.ok === true) pending.resolve(data.result);
      else pending.reject(new Error(String(data.error || '上下文桥接调用失败')));
      return;
    }
    if (data?.type !== 'execute') return;
    const id = String(data.id || '');
    void execute(data.code, data.mode, id).then((result) => {
      event.source?.postMessage({ channel: CHANNEL, type: 'result', id, ok: true, result }, '*');
    }).catch((error) => {
      event.source?.postMessage({
        channel: CHANNEL,
        type: 'result',
        id,
        ok: false,
        error: String(error?.stack || error?.message || error)
      }, '*');
    });
  });
})();
