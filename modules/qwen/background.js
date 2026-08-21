/* Qwen 模块后台：存储设置、查询状态、执行操作、转发聊天。 */
(function initBjtuQwenBackground(global) {
  'use strict';

  const SETTINGS_KEYS = ['qwenEnabled', 'qwenModelId', 'qwenEnabledOperations', 'qwenThinkingEnabled', 'qwenMaxIterations', 'qwenAlwaysAllow'];
  const LOGIN_TAB_ID_KEY = 'qwenLoginTabId';
  const WAF_NOTIFICATION_ID = 'bjtu-qwen-waf-verification';
  const WAF_TAB_STATE_KEY = 'qwenWafTabState';
  const ASK_NOTIFICATION_PREFIX = 'bjtu-qwen-ask-limit:';
  const pendingAskNotifications = new Map();
  let qwenLoginCompletionPromise = null;

  async function broadcastWafVerified() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'QWEN_WAF_VERIFIED_BROADCAST' });
        if (response?.ok === true) return true;
      } catch {
        // app.html 可能仍在加载，稍后重试。
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  async function beginWafRefreshFlow(tab) {
    const tabId = Number(tab?.id);
    if (!Number.isInteger(tabId)) return;
    await chrome.storage.session.set({
      [WAF_TAB_STATE_KEY]: {
        tabId,
        phase: 'waiting-auto-refresh',
        startedAt: Date.now()
      }
    }).catch(() => {});
    await chrome.tabs.reload(tabId).catch(() => {});
  }

  async function findOpenQwenAppTab(excludeTabId = null) {
    const appUrl = chrome.runtime.getURL('app/app.html');
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs
      .filter((tab) => {
        const url = String(tab?.url || tab?.pendingUrl || '');
        return Number(tab?.id) !== Number(excludeTabId)
          && url.startsWith(appUrl)
          && !/[?&]popup=1(?:&|$)/.test(url);
      })
      .sort((left, right) => Number(right?.active === true) - Number(left?.active === true)
        || Number(right?.lastAccessed || 0) - Number(left?.lastAccessed || 0))[0] || null;
  }

  async function handleWafPageLoaded(sender, payload) {
    const tabId = Number(sender?.tab?.id);
    if (!Number.isInteger(tabId)) return { ok: false };
    const stored = await chrome.storage.session.get(WAF_TAB_STATE_KEY).catch(() => ({}));
    const state = stored?.[WAF_TAB_STATE_KEY];
    if (Number(state?.tabId) !== tabId) return { ok: false };
    const navigationType = String(payload?.navigationType || '');
    if (navigationType !== 'reload') return { ok: true, waiting: true };
    if (state?.phase === 'waiting-auto-refresh') {
      await chrome.storage.session.set({
        [WAF_TAB_STATE_KEY]: { ...state, phase: 'waiting-user-refresh', autoRefreshedAt: Date.now() }
      }).catch(() => {});
      return { ok: true, autoRefreshObserved: true };
    }
    if (state?.phase === 'waiting-user-refresh') {
      await chrome.storage.session.remove(WAF_TAB_STATE_KEY).catch(() => {});
      const appUrl = chrome.runtime.getURL('app/app.html');
      const existingAppTab = await findOpenQwenAppTab(tabId);
      let reused = false;
      let appTab = existingAppTab
        ? await chrome.tabs.update(existingAppTab.id, {
          active: true,
          autoDiscardable: false
        }).catch(() => null)
        : null;
      if (appTab) reused = true;
      else {
        appTab = await chrome.tabs.update(tabId, {
          url: appUrl,
          active: true,
          autoDiscardable: false
        }).catch(() => null);
      }
      if (Number.isInteger(appTab?.windowId)) {
        await chrome.windows.update(appTab.windowId, { focused: true }).catch(() => null);
      }
      void broadcastWafVerified();
      return { ok: true, returnedToApp: true, reused };
    }
    return { ok: true };
  }

  if (typeof chrome === 'object' && chrome?.notifications?.onButtonClicked) {
    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      const id = String(notificationId || '');
      if (!id.startsWith(ASK_NOTIFICATION_PREFIX)) return;
      const handler = pendingAskNotifications.get(id);
      if (!handler) return;
      handler(buttonIndex === 0 ? 'continue' : 'stop');
    });
  }

  async function broadcastTokenCaptured() {
    try {
      await chrome.runtime.sendMessage({ type: 'QWEN_TOKEN_CAPTURED_BROADCAST' });
    } catch {
      // app 页面可能尚未打开
    }
  }

  async function focusQwenAppPage() {
    const appUrl = chrome.runtime.getURL('app/app.html');
    const appTab = await findOpenQwenAppTab();
    const tab = appTab
      ? await chrome.tabs.update(appTab.id, { active: true }).catch(() => appTab)
      : await global.BjtuTabs.create({ url: appUrl, active: true }).catch(() => null);
    if (Number.isInteger(tab?.windowId)) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => null);
  }

  async function completeQwenLogin(token) {
    const value = String(token || '').trim();
    if (!value) return;
    if (qwenLoginCompletionPromise) return qwenLoginCompletionPromise;
    qwenLoginCompletionPromise = (async () => {
      const tokenState = await chrome.storage.session.get('qwenToken').catch(() => ({}));
      const tokenChanged = String(tokenState?.qwenToken || '') !== value;
      await global.BjtuQwenClient?.captureToken?.(value);
      if (tokenChanged) await broadcastTokenCaptured();
      const stored = await chrome.storage.session.get(LOGIN_TAB_ID_KEY).catch(() => ({}));
      const loginTabId = Number(stored?.[LOGIN_TAB_ID_KEY]);
      if (!Number.isInteger(loginTabId)) return;
      const loginTab = await chrome.tabs.get(loginTabId).catch(() => null);
      await chrome.storage.session.remove(LOGIN_TAB_ID_KEY).catch(() => {});
      if (loginTab && String(loginTab.url || loginTab.pendingUrl || '').startsWith('https://chat.qwen.ai/')) {
        await chrome.tabs.update(loginTabId, { autoDiscardable: false }).catch(() => null);
      }
      await focusQwenAppPage();
    })().finally(() => {
      qwenLoginCompletionPromise = null;
    });
    return qwenLoginCompletionPromise;
  }

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
      let stopRequested = false;
      const loopSession = {};
      const settlePendingAsk = (action = 'stop', count = 0, notifyPage = false) => {
        if (!pendingAsk) return;
        const current = pendingAsk;
        pendingAsk = null;
        if (current.notificationId) {
          pendingAskNotifications.delete(current.notificationId);
          chrome.notifications.clear(current.notificationId, () => void chrome.runtime.lastError);
        }
        current.resolve?.({
          action: String(action || 'stop'),
          count: Number(count) || Number(current.count) || 1
        });
        if (notifyPage && !port.disconnected) {
          port.postMessage({ type: 'askResolved', id: current.id });
        }
      };
      const resolveAskOnAbort = () => {
        settlePendingAsk('stop');
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
        if (message?.type === 'retryDecision') {
          const retryId = String(message?.retryId || '');
          if (!pendingRetry || (retryId && retryId !== pendingRetry.id)) {
            if (!port.disconnected) port.postMessage({ type: 'retryRejected', retryId });
            return;
          }
          const retryChatId = String(message?.chatId || pendingRetry.chatId || turnRef.chatId || '');
          if (retryChatId) turnRef.chatId = retryChatId;
          const resolve = pendingRetry.resolve;
          pendingRetry = null;
          if (!port.disconnected) port.postMessage({ type: 'retryAccepted', retryId });
          resolve?.(String(message.action || 'stop'));
          return;
        }
        if (message?.type === 'askResponse' && pendingAsk?.id === message.id) {
          settlePendingAsk(message.action, message.count);
          return;
        }
        if (message?.type === 'stop') {
          if (stopRequested) return;
          stopRequested = true;
          resolveAskOnAbort();
          resolveRetryOnAbort();
          void (async () => {
            // response_id 由流首个 response.created/delta 事件给出。若用户点得
            // 很早，短暂等待该事件，否则无法构造千问要求的停止请求。
            const deadline = Date.now() + 1200;
            while (turnRef.chatId && !turnRef.responseId && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            if (turnRef.chatId && turnRef.responseId) {
              void global.BjtuQwenClient?.stopGeneration?.({
                chatId: turnRef.chatId,
                responseId: turnRef.responseId
              });
            }
            abortController.abort(new DOMException('生成中止', 'AbortError'));
          })();
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
                const retryChatId = String(info?.chatId || turnRef.chatId || '');
                const retryId = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                pendingRetry = { id: retryId, resolve, chatId: retryChatId };
                const safeMessage = String(info?.message || '请求失败');
                port.postMessage({
                  type: 'retryRequest',
                  retryId,
                  message: safeMessage,
                  code: String(info?.code || ''),
                  chatId: retryChatId,
                  afterOperationResult: info?.afterOperationResult === true,
                  operationResult: info?.afterOperationResult === true ? info.operationResult : undefined
                });
              }),
              askUser: (payload) => new Promise((resolve) => {
                const id = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const count = Number(payload?.count) || 3;
                const mode = String(payload?.mode || 'iterate');
                const notificationId = `${ASK_NOTIFICATION_PREFIX}${id}`;
                pendingAsk = { id, resolve, count, mode, notificationId };
                pendingAskNotifications.set(notificationId, (action) => {
                  settlePendingAsk(action, count, true);
                });
                abortController.signal.addEventListener('abort', resolveAskOnAbort, { once: true });
                const safeMessage = String(payload?.message || '操作调用次数过多，是否继续？');
                port.postMessage({
                  type: 'ask',
                  id,
                  message: safeMessage,
                  mode,
                  count
                });
                try {
                  if (chrome?.notifications?.create) {
                    chrome.notifications.create(notificationId, {
                      type: 'basic',
                      iconUrl: chrome.runtime.getURL('icons/128.png'),
                      title: mode === 'operation-permission' ? '千问请求执行 JavaScript' : '千问助手',
                      message: safeMessage,
                      priority: 2,
                      requireInteraction: true,
                      buttons: [
                        { title: mode === 'operation-permission' ? '允许一次' : '继续' },
                        { title: mode === 'operation-permission' ? '拒绝' : '终止' }
                      ]
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
              port.postMessage({
                type: 'stopped',
                chatId: String(turnRef?.chatId || ''),
                parentId: String(turnRef?.retryParentId || ''),
                retryText: String(turnRef?.retryText || ''),
                retryParentId: String(turnRef?.retryParentId || '')
              });
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

  function backgroundBridgePathParts(path) {
    const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('桥接路径为空');
    if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw new Error('桥接路径包含不允许访问的属性');
    }
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

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const type = String(message?.type || '');
      if (type === 'QWEN_JS_BACKGROUND_BRIDGE') {
        const senderUrl = String(sender?.url || '');
        if (!senderUrl.startsWith(chrome.runtime.getURL('app/app.html'))) {
          sendResponse({ ok: false, message: '只允许 app.html 调用后台 JavaScript 桥接' });
          return false;
        }
        void handleBackgroundJsBridge(
          String(message?.payload?.action || ''),
          message?.payload?.payload
        ).then((value) => {
          sendResponse({ ok: true, value });
        }).catch((error) => {
          sendResponse({ ok: false, message: String(error?.message || error) });
        });
        return true;
      }
      if (type === 'QWEN_WAF_PAGE_LOADED') {
        void handleWafPageLoaded(sender, message?.payload).then(sendResponse).catch((error) => {
          sendResponse({ ok: false, message: String(error?.message || error) });
        });
        return true;
      }
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
            sendResponse({ ok: false, code: error?.code || '', message: String(error?.message || error) });
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
        if (token && global.BjtuQwenClient?.captureToken) void completeQwenLogin(token);
        return false;
      }
      if (type === 'QWEN_TOKEN_CLEARED') {
        void chrome.storage.session.remove('qwenToken').catch(() => {});
        return false;
      }
      if (type === 'QWEN_OPEN_LOGIN') {
        void (async () => {
          try {
            const client = global.BjtuQwenClient;
            if (!client) throw new Error('通义千问客户端未就绪');
            const auth = message?.payload?.auth === true;
            let notificationPromise = Promise.resolve();
            if (!auth && typeof global.BjtuSystemNotifications?.create === 'function') {
              notificationPromise = global.BjtuSystemNotifications.create(WAF_NOTIFICATION_ID, {
                type: 'basic',
                iconUrl: 'icons/128.png',
                title: '通义千问触发风控校验',
                message: '请在页面上完成验证。扩展会先自动刷新一次；验证完成后将自动刷新页面并返回对话中，可以手动重试。',
                priority: 2,
                requireInteraction: true
              }, 'qwen-waf-verification', true).catch(() => {});
            }
            const [tab] = await Promise.all([client.openLoginPage({ auth }), notificationPromise]);
            if (!auth) await beginWafRefreshFlow(tab);
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
      if (type === 'BJTU_RUN_OPERATION' || type === 'QWEN_RUN_OPERATION') {
        const operations = global.BjtuQwenOperations;
        const name = String(message?.payload?.name || '');
        if (!operations) {
          sendResponse({ ok: false, error: '通义千问操作注册表未就绪', code: 'MODULE_UNAVAILABLE' });
          return false;
        }
        const senderUrl = String(sender?.url || sender?.tab?.url || '');
        const directAppInvocation = type === 'BJTU_RUN_OPERATION'
          && senderUrl.startsWith(chrome.runtime.getURL('app/app.html'));
        void operations.run(name, message?.payload?.arguments || {}, directAppInvocation ? {
          // DevTools/app 页面中的显式调用本身即为用户授权；千问代理调用仍走逐次授权弹窗。
          authorize: async () => 'allow'
        } : {}).then(sendResponse);
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

  if (typeof chrome === 'object' && chrome?.cookies?.onChanged) {
    chrome.cookies.onChanged.addListener((changeInfo) => {
      const cookie = changeInfo?.cookie;
      if (String(cookie?.name || '') !== 'token') return;
      const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
      if (domain !== 'chat.qwen.ai' && !domain.endsWith('.qwen.ai')) return;
      if (changeInfo?.removed || !String(cookie?.value || '').trim()) {
        void chrome.storage.session.remove('qwenToken').catch(() => {});
        return;
      }
      void completeQwenLogin(cookie.value);
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
