/* Qwen 模块后台：存储设置、查询状态、执行操作、转发聊天。 */
(function initBjtuQwenBackground(global) {
  'use strict';

  const SETTINGS_KEYS = ['qwenEnabled', 'qwenModelId', 'qwenEnabledOperations', 'qwenThinkingEnabled', 'qwenMaxIterations', 'qwenAlwaysAllow'];

  async function getSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEYS).catch(() => ({}));
    return {
      enabled: stored.qwenEnabled !== false,
      modelId: String(stored.qwenModelId || ''),
      enabledOperations: Array.isArray(stored.qwenEnabledOperations)
        ? stored.qwenEnabledOperations
        : null,
      thinkingEnabled: stored.qwenThinkingEnabled === true,
      maxIterations: Number(stored.qwenMaxIterations) > 0 ? Number(stored.qwenMaxIterations) : 6,
      alwaysAllow: stored.qwenAlwaysAllow === true
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
    if (patch?.maxIterations !== undefined) {
      next.qwenMaxIterations = Math.max(1, Math.floor(Number(patch.maxIterations) || 6));
    }
    if (typeof patch?.alwaysAllow === 'boolean') next.qwenAlwaysAllow = patch.alwaysAllow;
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
      let pendingAsk = null;
      let pendingRetry = null;
      const loopSession = {};
      const resolveAskOnAbort = () => {
        if (pendingAsk) {
          const resolve = pendingAsk.resolve;
          pendingAsk = null;
          resolve?.({ action: 'stop' });
        }
      };
      const resolveRetryOnAbort = () => {
        if (pendingRetry) {
          const resolve = pendingRetry.resolve;
          pendingRetry = null;
          resolve?.('stop');
        }
      };
      port.onDisconnect.addListener(() => {
        activeChatPorts.delete(port);
        resolveAskOnAbort();
        resolveRetryOnAbort();
        abortController.abort();
      });
      port.onMessage.addListener((message) => {
        if (message?.type === 'retryDecision' && pendingRetry) {
          const resolve = pendingRetry.resolve;
          pendingRetry = null;
          resolve?.(String(message.action || 'stop'));
          return;
        }
        if (message?.type === 'askResponse' && pendingAsk?.id === message.id) {
          const resolve = pendingAsk.resolve;
          pendingAsk = null;
          resolve?.({
            action: String(message.action || 'stop'),
            count: Number(message.count) || 0
          });
          return;
        }
        if (message?.type === 'stop') {
          resolveAskOnAbort();
          resolveRetryOnAbort();
          abortController.abort();
          if (turnRef.chatId && turnRef.responseId) {
            void global.BjtuQwenClient?.stopGeneration?.({
              chatId: turnRef.chatId,
              responseId: turnRef.responseId
            });
          }
          return;
        }
        if (message?.type !== 'send') return;
        if (!String(message.text || '').trim() && String(message.chatId || '')) return;
        void (async () => {
          try {
            const settings = await getSettings();
            const client = global.BjtuQwenClient;
            const operations = global.BjtuQwenOperations;
            if (!settings.enabled) throw Object.assign(new Error('通义千问模块已禁用，请先在扩展选项中开启'), { code: 'DISABLED' });
            const modelId = settings.modelId || await resolveDefaultModel(client);
            const groups = await operations.groups();
            const result = await global.BjtuQwenAgent.runTurn({
              modelId,
              userText: String(message.text).trim(),
              chatId: String(message.chatId || ''),
              parentId: String(message.parentId || ''),
              parentIdExplicit: message.editParentGiven === true,
              enabledOps: settings.enabledOperations,
              groups,
              signal: abortController.signal,
              turnRef,
              thinking: settings.thinkingEnabled === true,
              maxIterations: settings.maxIterations,
              alwaysAllow: settings.alwaysAllow === true,
              sessionRef: loopSession,
              onRetryRequest: (info) => new Promise((resolve) => {
                pendingRetry = { resolve };
                const safeMessage = String(info?.message || '请求失败');
                port.postMessage({
                  type: 'retryRequest',
                  message: safeMessage,
                  code: String(info?.code || '')
                });
              }),
              askUser: (payload) => new Promise((resolve) => {
                const id = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                pendingAsk = { id, resolve };
                abortController.signal.addEventListener('abort', resolveAskOnAbort, { once: true });
                const safeMessage = String(payload?.message || '操作调用次数过多，是否继续？');
                port.postMessage({
                  type: 'ask',
                  id,
                  message: safeMessage,
                  mode: String(payload?.mode || 'iterate'),
                  count: Number(payload?.count) || 3
                });
                try {
                  if (chrome?.notifications?.create) {
                    chrome.notifications.create('qwen-ask-limit', {
                      type: 'basic',
                      iconUrl: chrome.runtime.getURL('icons/128.png'),
                      title: '千问助手',
                      message: safeMessage,
                      priority: 2
                    });
                  }
                } catch {
                  // 通知失败不影响主流程
                }
              }),
              onDelta: (text) => {
                if (port.disconnected) return;
                port.postMessage({ type: 'delta', text });
              },
              onEvent: (event) => {
                if (port.disconnected) return;
                if (event?.operation) port.postMessage({ type: 'operation', operation: event.operation });
                if (event?.operationResult) port.postMessage({ type: 'operationResult', result: event.operationResult });
                if (event?.thinking) port.postMessage({ type: 'thinking', text: event.thinking });
                if (event?.firstMessage) port.postMessage({ type: 'firstMessage' });
              }
            });
            if (port.disconnected) return;
            port.postMessage({
              type: 'done',
              text: result.text,
              chatId: result.chatId,
              responseId: String(result.responseId || ''),
              stoppedByLimit: result.stoppedByLimit === true
            });
          } catch (error) {
            if (port.disconnected) return;
            if (error?.name === 'AbortError' || abortController.signal.aborted) {
              port.postMessage({ type: 'stopped', parentId: String(turnRef?.lastMessageId || '') });
              return;
            }
            port.postMessage({
              type: 'error',
              message: String(error?.message || error),
              code: String(error?.code || ''),
              chatId: String(turnRef?.chatId || ''),
              parentId: String(turnRef?.lastMessageId || '')
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
          try {
            loggedIn = client ? await (message?.payload?.ensureLogin ? client.tryRefreshLogin() : client.isLoggedIn()) : false;
          } catch { loggedIn = false; }
          let modelName = '';
          if (settings.modelId) modelName = settings.modelId;
          sendResponse({ ok: true, ...settings, loggedIn, modelId: settings.modelId, modelName });
        })();
        return true;
      }
      if (type === 'QWEN_GET_CHAT_HISTORY') {
        void (async () => {
          const chatId = String(message?.payload?.chatId || '');
          const client = global.BjtuQwenClient;
          if (!chatId || !client?.fetchChatHistory) {
            sendResponse({ ok: false, message: '无会话或客户端未就绪' });
            return;
          }
          try {
            const messages = await client.fetchChatHistory(chatId);
            sendResponse({ ok: true, messages });
          } catch (error) {
            sendResponse({ ok: false, message: String(error?.message || error) });
          }
        })();
        return true;
      }
      if (type === 'QWEN_DELETE_CHAT') {
        void (async () => {
          const chatId = String(message?.payload?.chatId || '');
          const client = global.BjtuQwenClient;
          if (!chatId || !client?.deleteChat) {
            sendResponse({ ok: false, message: '无会话或客户端未就绪' });
            return;
          }
          try {
            await client.deleteChat(chatId);
            sendResponse({ ok: true });
          } catch (error) {
            sendResponse({ ok: false, message: String(error?.message || error) });
          }
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
          sendResponse({ ok: true, groups: await operations.groupsDetailed(), enabledOperations: settings.enabledOperations });
        })();
        return true;
      }
      if (type === 'QWEN_BUILD_SYSTEM_PROMPT') {
        const agent = global.BjtuQwenAgent;
        const operations = global.BjtuQwenOperations;
        if (!agent?.buildSystemPrompt) {
          sendResponse({ ok: false, message: '通义千问代理未就绪' });
          return false;
        }
        try {
          const qwenDocs = [
            operations?.docs?.('qwen.listOperations')?.doc,
            operations?.docs?.('qwen.getDoc')?.doc
          ].filter(Boolean).join('\n\n');
          sendResponse({ ok: true, text: agent.buildSystemPrompt({ qwenDocs }) });
        } catch (error) {
          sendResponse({ ok: false, message: String(error?.message || error) });
        }
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
