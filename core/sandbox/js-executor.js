(function initJsExecutorSandbox() {
  'use strict';

  const CHANNEL = 'bjtu-qwen-js-sandbox';
  const pendingBridgeCalls = new Map();
  const LOCAL_LANGUAGE_ROOTS = new Set([
    'undefined', 'NaN', 'Infinity',
    'Object', 'Function', 'Boolean', 'Symbol', 'Number', 'BigInt', 'Math', 'Date',
    'String', 'RegExp', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
    'Error', 'AggregateError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
    'TypeError', 'URIError', 'JSON', 'Intl', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
    'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'BigUint64Array',
    'Int8Array', 'Int16Array', 'Int32Array', 'BigInt64Array', 'Float32Array', 'Float64Array',
    'Atomics', 'WebAssembly', 'Reflect', 'Proxy', 'URL', 'URLSearchParams',
    'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal',
    'parseFloat', 'parseInt', 'isFinite', 'isNaN', 'decodeURI', 'decodeURIComponent',
    'encodeURI', 'encodeURIComponent', 'escape', 'unescape', 'structuredClone',
    'atob', 'btoa', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'
  ]);

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

  function remotePathProxy(executionId, path) {
    const callable = function remoteBridgeValue() {};
    return new Proxy(callable, {
      get(_target, property) {
        if (property === Symbol.toStringTag) return 'RemoteBridgeValue';
        if (property === 'then') {
          return (resolve, reject) => callBridge(executionId, 'get', { path }).then(resolve, reject);
        }
        if (typeof property === 'symbol') return undefined;
        return remotePathProxy(executionId, `${path}.${String(property)}`);
      },
      apply(_target, _thisArg, args) {
        return callBridge(executionId, 'call', { path, args });
      },
      set() {
        throw new Error('跨上下文属性不能直接赋值，请调用目标上下文中已有的设置函数');
      }
    });
  }

  function createDirectScope(mode, executionId, bindingRoots) {
    if (mode === 'sandbox') return Object.create(null);
    const roots = new Set((Array.isArray(bindingRoots) ? bindingRoots : [])
      .map((name) => String(name || '').trim())
      .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))
      .filter((name) => !LOCAL_LANGUAGE_ROOTS.has(name)));
    return new Proxy(Object.create(null), {
      has(_target, property) {
        return typeof property === 'string' && roots.has(property);
      },
      get(_target, property) {
        if (property === Symbol.unscopables) return undefined;
        if (typeof property !== 'string' || !roots.has(property)) return undefined;
        return remotePathProxy(executionId, property);
      }
    });
  }

  async function execute(source, mode, executionId, bindingRoots) {
    const code = String(source || '');
    if (!code.trim()) throw new Error('JavaScript 代码为空');
    const normalizedMode = ['sandbox', 'app', 'background'].includes(String(mode)) ? String(mode) : 'sandbox';
    const scope = createDirectScope(normalizedMode, executionId, bindingRoots);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let fn;
    try {
      fn = new AsyncFunction('scope', `with (scope) { return (\n${code}\n); }`);
    } catch {
      fn = new AsyncFunction('scope', `with (scope) { return (async () => {\n${code}\n})(); }`);
    }
    return serializable(await fn(scope));
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
    void execute(data.code, data.mode, id, data.bindingRoots).then((result) => {
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
