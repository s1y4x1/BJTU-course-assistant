(function initJsExecutorSandbox() {
  'use strict';

  const CHANNEL = 'bjtu-qwen-js-sandbox';
  const pendingBridgeCalls = new Map();
  const bridgeCallbacks = new Map();
  const deferredValues = new WeakMap();
  let activeCallbackLastError = null;
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

  function deserializeBridgeValue(value) {
    if (value && typeof value === 'object' && value.__type === 'undefined') return undefined;
    if (Array.isArray(value)) return value.map(deserializeBridgeValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deserializeBridgeValue(child)]));
  }

  function encodeBridgeValue(value, executionId, seen = new WeakSet()) {
    if (value === undefined) return { __type: 'undefined' };
    if (typeof value === 'function') {
      const callbackId = `callback-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      bridgeCallbacks.set(callbackId, { executionId, callback: value });
      return { __type: 'bridge-callback', callbackId };
    }
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'symbol') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => encodeBridgeValue(item, executionId, seen));
    return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, encodeBridgeValue(child, executionId, seen)]));
  }

  function callBridge(executionId, action, payload) {
    const requestId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return new Promise((resolve, reject) => {
      pendingBridgeCalls.set(requestId, { resolve, reject });
      parent.postMessage({
        channel: CHANNEL,
        type: 'bridge-call',
        executionId,
        requestId,
        action,
        payload: encodeBridgeValue(payload, executionId)
      }, '*');
    });
  }

  async function resolveDeferredDeep(value, seen = new WeakSet()) {
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
      if (deferredValues.has(value)) return resolveDeferredDeep(await deferredValues.get(value), seen);
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) return Promise.all(value.map((item) => resolveDeferredDeep(item, seen)));
    const output = {};
    for (const [key, child] of Object.entries(value)) output[key] = await resolveDeferredDeep(child, seen);
    return output;
  }

  function deferredValueProxy(valuePromise, ownerPromise = null) {
    const promise = Promise.resolve(valuePromise);
    const callable = function deferredBridgeValue() {};
    const proxy = new Proxy(callable, {
      get(_target, property) {
        if (property === Symbol.toStringTag) return 'DeferredBridgeValue';
        if (property === 'then') return promise.then.bind(promise);
        if (property === 'catch') return promise.catch.bind(promise);
        if (property === 'finally') return promise.finally.bind(promise);
        if (typeof property === 'symbol') return undefined;
        return deferredValueProxy(promise.then((value) => value?.[property]), promise);
      },
      apply(_target, _thisArg, args) {
        const next = Promise.all([
          promise,
          ownerPromise ? Promise.resolve(ownerPromise) : Promise.resolve(undefined),
          resolveDeferredDeep(args)
        ]).then(([fn, owner, resolvedArgs]) => {
          if (typeof fn !== 'function') throw new TypeError('异步结果不是可调用函数');
          return Reflect.apply(fn, owner, resolvedArgs);
        });
        return deferredValueProxy(next);
      }
    });
    deferredValues.set(proxy, promise);
    return proxy;
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
        const childPath = `${path}.${String(property)}`;
        if (childPath === 'chrome.runtime.lastError') return activeCallbackLastError;
        if (/(?:^|\.)(?:localStorage|sessionStorage)$/.test(path)
          && !['getItem', 'setItem', 'removeItem', 'clear', 'key'].includes(String(property))) {
          return deferredValueProxy(callBridge(executionId, 'get', { path: childPath }));
        }
        return remotePathProxy(executionId, childPath);
      },
      apply(_target, _thisArg, args) {
        return deferredValueProxy(resolveDeferredDeep(args)
          .then((resolvedArgs) => callBridge(executionId, 'call', { path, args: resolvedArgs })));
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
    try {
      return serializable(await resolveDeferredDeep(await fn(scope)));
    } finally {
      for (const [callbackId, entry] of bridgeCallbacks) {
        if (entry.executionId === executionId) bridgeCallbacks.delete(callbackId);
      }
    }
  }

  window.addEventListener('message', (event) => {
    const data = event?.data;
    if (data?.channel !== CHANNEL) return;
    if (data?.type === 'bridge-result') {
      const pending = pendingBridgeCalls.get(String(data.requestId || ''));
      if (!pending) return;
      pendingBridgeCalls.delete(String(data.requestId || ''));
      if (data.ok === true) pending.resolve(deserializeBridgeValue(data.result));
      else pending.reject(new Error(String(data.error || '上下文桥接调用失败')));
      return;
    }
    if (data?.type === 'bridge-callback') {
      const callbackId = String(data.callbackId || '');
      const entry = bridgeCallbacks.get(callbackId);
      if (!entry || entry.executionId !== String(data.executionId || '')) return;
      bridgeCallbacks.delete(callbackId);
      activeCallbackLastError = data.lastError && typeof data.lastError === 'object'
        ? data.lastError
        : null;
      try {
        entry.callback(...deserializeBridgeValue(Array.isArray(data.args) ? data.args : []));
      } finally {
        activeCallbackLastError = null;
      }
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
