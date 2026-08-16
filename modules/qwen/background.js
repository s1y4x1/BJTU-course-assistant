/* Qwen 模块后台：存储设置、查询状态、执行操作、转发聊天。 */
(function initBjtuQwenBackground(global) {
  'use strict';

  const SETTINGS_KEYS = ['qwenEnabled', 'qwenModelId', 'qwenEnabledOperations', 'qwenThinkingEnabled'];

  async function getSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEYS).catch(() => ({}));
    return {
      enabled: stored.qwenEnabled !== false,
      modelId: String(stored.qwenModelId || ''),
      enabledOperations: Array.isArray(stored.qwenEnabledOperations)
        ? stored.qwenEnabledOperations
        : null,
      thinkingEnabled: stored.qwenThinkingEnabled === true
    };
  }

  async function saveSettings(patch) {
    const next = {};
    if (typeof patch?.enabled === 'boolean') next.qwenEnabled = patch.enabled;
    if (patch?.modelId !== undefined) next.qwenModelId = String(patch.modelId || '');
    if (patch?.enabledOperations !== undefined) {
      next.qwenEnabledOperations = Array.isArray(patch.enabledOperations)
        ? patch.enabledOperations
        : null;
    }
    if (typeof patch?.thinkingEnabled === 'boolean') next.qwenThinkingEnabled = patch.thinkingEnabled;
    if (Object.keys(next).length) await chrome.storage.local.set(next);
    return getSettings();
  }

  const activeChatPorts = new Set();

  if (typeof chrome === 'object' && chrome?.runtime?.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
      if (String(port.name || '') !== 'bjtu-qwen-chat') return;
      activeChatPorts.add(port);
      const abortController = new AbortController();
      const turnRef = {};
      port.onDisconnect.addListener(() => {
        activeChatPorts.delete(port);
        abortController.abort();
      });
      port.onMessage.addListener((message) => {
        if (message?.type === 'stop') {
          abortController.abort();
          if (turnRef.chatId && turnRef.responseId) {
            void global.BjtuQwenClient?.stopGeneration?.({
              chatId: turnRef.chatId,
              responseId: turnRef.responseId
            });
          }
          return;
        }
        if (message?.type !== 'send' || !String(message.text || '').trim()) return;
        void (async () => {
          try {
            const settings = await getSettings();
            const client = global.BjtuQwenClient;
            const operations = global.BjtuQwenOperations;
            if (!settings.enabled) throw Object.assign(new Error('通义千问模块已禁用，请先在扩展选项中开启'), { code: 'DISABLED' });
            const modelId = settings.modelId || await resolveDefaultModel(client);
            const groups = operations.groups();
            const result = await global.BjtuQwenAgent.runTurn({
              modelId,
              userText: String(message.text).trim(),
              chatId: String(message.chatId || ''),
              enabledOps: settings.enabledOperations,
              groups,
              signal: abortController.signal,
              turnRef,
              thinking: settings.thinkingEnabled === true,
              onDelta: (text) => {
                if (port.disconnected) return;
                port.postMessage({ type: 'delta', text });
              },
              onEvent: (event) => {
                if (port.disconnected) return;
                if (event?.operation) port.postMessage({ type: 'operation', operation: event.operation });
                if (event?.operationResult) port.postMessage({ type: 'operationResult', result: event.operationResult });
                if (event?.thinking) port.postMessage({ type: 'thinking', text: event.thinking });
              }
            });
            if (port.disconnected) return;
            port.postMessage({ type: 'done', text: result.text, chatId: result.chatId });
          } catch (error) {
            if (port.disconnected) return;
            if (error?.name === 'AbortError' || abortController.signal.aborted) {
              port.postMessage({ type: 'stopped' });
              return;
            }
            port.postMessage({
              type: 'error',
              message: String(error?.message || error),
              code: String(error?.code || '')
            });
          }
        })();
      });
    });
  }

  async function resolveDefaultModel(client) {
    const models = await client.fetchModels();
    return String(models[0]?.id || '');
  }

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const type = String(message?.type || '');
      if (type === 'QWEN_GET_STATUS') {
        void (async () => {
          const settings = await getSettings();
          const client = global.BjtuQwenClient;
          let loggedIn = false;
          try { loggedIn = client ? await client.isLoggedIn() : false; } catch { loggedIn = false; }
          let modelName = '';
          if (settings.modelId) modelName = settings.modelId;
          sendResponse({ ok: true, ...settings, loggedIn, modelId: settings.modelId, modelName });
        })();
        return true;
      }
      if (type === 'QWEN_TOKEN_CAPTURED') {
        const token = String(message?.payload?.token || '');
        if (token && global.BjtuQwenClient?.captureToken) {
          void global.BjtuQwenClient.captureToken(token).then(() => {
            try {
              chrome.runtime.sendMessage({ type: 'QWEN_TOKEN_CAPTURED_BROADCAST' }, () => {
                void chrome?.runtime?.lastError;
              });
            } catch {
              // 忽略
            }
          });
        }
        return false;
      }
      if (type === 'QWEN_OPEN_LOGIN') {
        void (async () => {
          try {
            const client = global.BjtuQwenClient;
            if (!client) throw new Error('通义千问客户端未就绪');
            await client.openLoginPage();
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, message: String(error?.message || error) });
          }
        })();
        return true;
      }
      if (type === 'QWEN_LIST_MODELS') {
        void (async () => {
          try {
            const client = global.BjtuQwenClient;
            if (!client) throw new Error('通义千问客户端未就绪');
            const models = await client.fetchModels();
            sendResponse({ ok: true, models });
          } catch (error) {
            sendResponse({ ok: false, message: String(error?.message || error), code: String(error?.code || '') });
          }
        })();
        return true;
      }
      if (type === 'QWEN_LIST_OPERATIONS') {
        const operations = global.BjtuQwenOperations;
        if (!operations) {
          sendResponse({ ok: false, message: '通义千问操作注册表未就绪' });
          return false;
        }
        void (async () => {
          const settings = await getSettings();
          sendResponse({ ok: true, groups: operations.groups(), enabledOperations: settings.enabledOperations });
        })();
        return true;
      }
      if (type === 'QWEN_OPERATION_DOCS') {
        const operations = global.BjtuQwenOperations;
        const name = String(message?.payload?.name || '');
        const doc = operations ? operations.docs(name) : null;
        sendResponse(doc ? { ok: true, ...doc } : { ok: false, message: `未找到操作：${name}` });
        return false;
      }
      if (type === 'QWEN_RUN_OPERATION') {
        const operations = global.BjtuQwenOperations;
        const name = String(message?.payload?.name || '');
        if (!operations) {
          sendResponse({ ok: false, error: '通义千问操作注册表未就绪', code: 'MODULE_UNAVAILABLE' });
          return false;
        }
        void operations.run(name, message?.payload?.arguments || {}).then(sendResponse);
        return true;
      }
      if (type === 'QWEN_SETTINGS_GET') {
        void getSettings().then((settings) => sendResponse({ ok: true, ...settings }));
        return true;
      }
      if (type === 'QWEN_SETTINGS_SET') {
        void saveSettings(message?.payload || {}).then((settings) => sendResponse({ ok: true, ...settings }));
        return true;
      }
      return false;
    });
  }

  // 捕获 chat.qwen.ai 页面自身 API 请求中 baxia 动态生成的反爬标头（bx-ua /
  // bx-umidtoken），存入 session 存储供扩展请求复用，降低触发风控（WAF punish）的概率。
  if (typeof chrome === 'object' && chrome?.webRequest?.onBeforeSendHeaders) {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        try {
          const headers = details?.requestHeaders || [];
          const pick = (name) => {
            const lower = name.toLowerCase();
            const item = headers.find((h) => String(h?.name || '').toLowerCase() === lower);
            return String(item?.value || '');
          };
          const bxUa = pick('bx-ua');
          if (!bxUa) return;
          void chrome.storage.session.set({
            qwenAntiBotHeaders: {
              bxUa,
              bxUmidtoken: pick('bx-umidtoken'),
              capturedAt: Date.now()
            }
          }).catch(() => {});
        } catch {
          // 忽略捕获失败
        }
      },
      { urls: ['https://chat.qwen.ai/api/*'] },
      ['requestHeaders']
    );
  }
})(globalThis);
