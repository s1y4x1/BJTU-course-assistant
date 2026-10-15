/* 扩展接口后台：共享操作配置、调用入口和 JavaScript 上下文桥。 */
(function initBjtuApiBackground(global) {
  'use strict';
  if (!global.BJTUCA) return;
  const META_OPERATIONS = Object.freeze(['api.operationList', 'api.getDocs']);
  const SETTINGS_KEYS = ['qwenEnabledOperations', 'qwenAlwaysAllowedOperations'];

  function withMetaOperations(values) {
    return [...new Set([...META_OPERATIONS, ...(Array.isArray(values) ? values.map(String).filter(Boolean) : [])])];
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEYS);
    return {
      enabledOperations: Array.isArray(stored.qwenEnabledOperations) ? stored.qwenEnabledOperations : null,
      alwaysAllowedOperations: withMetaOperations(stored.qwenAlwaysAllowedOperations)
    };
  }

  async function saveSettings(patch) {
    const next = {};
    if (patch.enabledOperations !== undefined) {
      next.qwenEnabledOperations = Array.isArray(patch.enabledOperations) ? patch.enabledOperations.map(String) : null;
    }
    if (patch.alwaysAllowedOperations !== undefined) {
      next.qwenAlwaysAllowedOperations = withMetaOperations(patch.alwaysAllowedOperations);
      if (patch.enabledOperations === undefined) {
        const current = await getSettings();
        if (Array.isArray(current.enabledOperations)) {
          next.qwenEnabledOperations = [...new Set([...current.enabledOperations, ...next.qwenAlwaysAllowedOperations])];
        }
      }
    }
    if (Object.keys(next).length) await chrome.storage.local.set(next);
    return getSettings();
  }

  // 页面执行只通过专用 Port 单播；发出请求后绝不切换页面或重试。
  const apiPagePorts = new Map();
  let apiPageConnectionSequence = 0;
  let apiPageRequestSequence = 0;
  const apiPageRequestPrefix = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function disconnectApiPage(port, error = '执行页面已关闭或连接已断开', code = 'PAGE_API_DISCONNECTED') {
    const entry = apiPagePorts.get(port);
    if (!entry) return;
    apiPagePorts.delete(port);
    for (const resolve of entry.pending.values()) resolve({ ok: false, error, code });
    entry.pending.clear();
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'bjtu-api-page') return;
    const url = String(port.sender?.url || '');
    if (!url.startsWith(chrome.runtime.getURL(''))) {
      port.disconnect();
      return;
    }
    const path = new URL(url).pathname;
    const entry = {
      priority: path === '/app/app.html' ? 2 : path === '/modules/qwen/chat.html' ? 1 : 0,
      sequence: ++apiPageConnectionSequence,
      pending: new Map()
    };
    apiPagePorts.set(port, entry);
    port.onMessage.addListener((message) => {
      if (message?.type !== 'result' || apiPagePorts.get(port) !== entry) return;
      const resolve = entry.pending.get(message.id);
      if (!resolve) return;
      entry.pending.delete(message.id);
      resolve(message.ok === true ? { ok: true, value: message.value } : {
        ok: false, error: String(message.error || '页面执行失败'), code: String(message.code || 'CODE_EXECUTION_FAILED')
      });
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      disconnectApiPage(port);
    });
  });

  function invokePage(fn, args = {}) {
    const selected = [...apiPagePorts.entries()].sort((a, b) =>
      b[1].priority - a[1].priority || b[1].sequence - a[1].sequence)[0];
    if (!selected) {
      throw Object.assign(new Error('扩展页面接口尚未连接'), { code: 'PAGE_API_UNAVAILABLE' });
    }
    const [port, entry] = selected;
    const id = `${apiPageRequestPrefix}-${++apiPageRequestSequence}`;
    return new Promise((resolve) => {
      entry.pending.set(id, resolve);
      try {
        // 不设置执行超时。发送失败也可能已产生副作用，必须返回结果而非抛出重试。
        port.postMessage({ type: 'execute', id, fn, args });
      } catch (error) {
        entry.pending.delete(id);
        resolve({ ok: false, error: String(error?.message || error), code: 'PAGE_API_SEND_FAILED' });
      }
    });
  }

  global.BjtuApiSettings = Object.freeze({ get: getSettings, save: saveSettings, withMetaOperations, invokePage });
  function backgroundBridgePathParts(path) {
    const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('桥接路径为空');
    if (['globalThis', 'self'].includes(parts[0])) parts.shift();
    if (!parts.length) throw new Error('不能直接访问整个后台全局对象');
    return parts;
  }

  function resolveBackgroundBridgePath(path) {
    const parts = backgroundBridgePathParts(path);
    let owner = global;
    for (let i = 0; i < parts.length - 1; i += 1) {
      owner = owner?.[parts[i]];
      if (owner == null) throw new Error(`后台桥接路径不存在：${parts.slice(0, i + 1).join('.')}`);
    }
    const key = parts.at(-1);
    return { owner, key, value: owner?.[key] };
  }

  function backgroundBridgeSerializable(value, seen = new WeakSet(), depth = 0) {
    if (value === undefined) return { __type: 'undefined' };
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value === 'symbol') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || '' };
    if (depth > 8) return '[深度受限]';
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => backgroundBridgeSerializable(item, seen, depth + 1));
    const output = {};
    for (const key of Object.keys(value)) {
      try { output[key] = backgroundBridgeSerializable(value[key], seen, depth + 1); } catch (error) {
        output[key] = `[读取失败：${String(error?.message || error)}]`;
      }
    }
    return output;
  }

  async function handleBackgroundJsBridge(action, payload) {
    if (action === 'roots') {
      return [...new Set([
        'chrome',
        ...Object.getOwnPropertyNames(global)
      ].filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(name))))];
    }
    const target = resolveBackgroundBridgePath(payload?.path);
    if (action === 'get') return backgroundBridgeSerializable(target.value);
    if (action === 'set') {
      target.owner[target.key] = payload?.value;
      return true;
    }
    if (action === 'call') {
      if (typeof target.value !== 'function') throw new Error(`后台方法不存在：${String(payload?.path || '')}`);
      const result = await target.value.apply(target.owner, Array.isArray(payload?.args) ? payload.args : []);
      return backgroundBridgeSerializable(result);
    }
    throw new Error(`未知 background 桥接操作：${String(action || '')}`);
  }


  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || '');
    if (!['BJTUCA_OPERATION_SETTINGS_GET', 'BJTUCA_OPERATION_SETTINGS_SET', 'BJTUCA_GET_DOCS',
      'BJTUCA_RUN_OPERATION', 'BJTUCA_EXECUTE_CODE', 'BJTUCA_JS_BACKGROUND_BRIDGE'].includes(type)) return false;
    if (!String(sender?.url || '').startsWith(chrome.runtime.getURL(''))) {
      sendResponse({ ok: false, code: 'FORBIDDEN', message: '仅允许扩展页面调用扩展接口' });
      return false;
    }
    void (async () => {
      if (type === 'BJTUCA_OPERATION_SETTINGS_GET' || type === 'BJTUCA_OPERATION_SETTINGS_SET') {
        const settings = type === 'BJTUCA_OPERATION_SETTINGS_SET' ? await saveSettings(message.payload || {}) : await getSettings();
        return { ok: true, ...settings, groups: await global.BJTUCA.groupsDetailed() };
      }
      if (type === 'BJTUCA_GET_DOCS') {
        const doc = global.BJTUCA.getDocs(String(message.payload?.name || ''));
        return doc ? { ok: true, ...doc } : { ok: false, message: '未找到操作说明' };
      }
      if (type === 'BJTUCA_JS_BACKGROUND_BRIDGE') {
        return { ok: true, value: await handleBackgroundJsBridge(String(message.payload?.action || ''), message.payload?.payload) };
      }
      if (type === 'BJTUCA_EXECUTE_CODE') {
        return global.BJTUCA.executeCode(message.payload?.mode, message.payload?.code);
      }
      return global.BJTUCA.run(String(message.payload?.name || ''), message.payload?.arguments || {});
    })().then(sendResponse).catch((error) => sendResponse({
      ok: false, code: String(error?.code || 'OPERATION_FAILED'), error: String(error?.message || error),
      message: String(error?.message || error)
    }));
    return true;
  });
})(globalThis);
