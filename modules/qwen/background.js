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
                const notificationId = `${ASK_NOTIFICATION_PREFIX}${id}`;
                pendingAsk = { id, resolve, count, notificationId };
                pendingAskNotifications.set(notificationId, (action) => {
                  settlePendingAsk(action, count, true);
                });
                abortController.signal.addEventListener('abort', resolveAskOnAbort, { once: true });
                const safeMessage = String(payload?.message || '操作调用次数过多，是否继续？');
                port.postMessage({
                  type: 'ask',
                  id,
                  message: safeMessage,
                  mode: String(payload?.mode || 'iterate'),
                  count
                });
                try {
                  if (chrome?.notifications?.create) {
                    chrome.notifications.create(notificationId, {
                      type: 'basic',
                      iconUrl: chrome.runtime.getURL('icons/128.png'),
                      title: '千问助手',
                      message: safeMessage,
                      priority: 2,
                      requireInteraction: true,
                      buttons: [
                        { title: '继续' },
                        { title: '终止' }
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
                parentId: String(turnRef?.lastMessageId || '')
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

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const type = String(message?.type || '');
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
