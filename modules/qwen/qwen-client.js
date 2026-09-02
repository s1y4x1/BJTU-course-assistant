/* 通义千问聊天客户端：读取登录令牌，并由扩展后台直接发送 API 与流式请求。
 * chat.qwen.ai 页面只用于登录及登录状态同步，不再承担普通 API 请求。 */
(function initBjtuQwenClient(global) {
  'use strict';

  const CHAT_BASE = 'https://chat.qwen.ai';
  const AUTH_URL = `${CHAT_BASE}/auth`;
  const DIRECT_REQUEST_HEADER_RULE_ID = 914305;
  const LOGIN_TAB_ID_KEY = 'qwenLoginTabId';
  let openLoginPagePromise = null;
  let loginCheckPromise = null;
  let directRequestHeadersPromise = null;
  let qwenPageOperationQueue = Promise.resolve();

  function queueQwenPageOperation(operation) {
    const task = qwenPageOperationQueue.then(operation);
    qwenPageOperationQueue = task.catch(() => null);
    return task;
  }

  function notLoggedInError() {
    return Object.assign(new Error('尚未登录通义千问，请先打开 https://chat.qwen.ai/ 登录'), { code: 'NOT_LOGGED_IN' });
  }

  function unparsableError() {
    return Object.assign(new Error('通义千问 API 返回了无法解析的内容（可能被 WAF 拦截），请刷新 chat.qwen.ai 页面后重试'), { code: 'WAF_CHALLENGE' });
  }

  function wafPunishError(validationUrl = '') {
    return Object.assign(new Error('通义千问触发风控校验，请在弹出的小窗口中完成验证'), {
      code: 'WAF_PUNISH',
      validationUrl: String(validationUrl || '')
    });
  }

  function wafBusyError(validationUrl = '') {
    return Object.assign(new Error('通义千问触发风控校验，请在弹出的小窗口中完成验证'), {
      code: 'WAF_BUSY',
      validationUrl: String(validationUrl || '')
    });
  }

  function networkError(responseId = '') {
    return Object.assign(
      new Error('与 chat.qwen.ai 的生成连接已中断，正在由扩展后台恢复请求'),
      { code: 'NETWORK_ERROR', responseId: String(responseId || '') }
    );
  }

  function requestEndedError(responseId = '', message = 'The request is ended!') {
    return Object.assign(
      new Error(String(message || 'The request is ended!')),
      { code: 'REQUEST_ENDED', responseId: String(responseId || '') }
    );
  }

  function isRequestFinishedMessage(message) {
    return /^The request is (?:ended|finished)!$/i.test(String(message || '').trim());
  }

  function rateLimitMessage(num) {
    const hours = Math.max(0, Math.ceil(Number(num) || 0));
    return hours
      ? `已达通义千问今日用量上限，请等待约 ${hours} 小时后再试。`
      : '已达通义千问今日用量上限，请稍后再试。';
  }

  function rateLimitError(num, message = '') {
    return Object.assign(
      new Error(String(message || '').trim() || rateLimitMessage(num)),
      { code: 'RATE_LIMITED' }
    );
  }

  function extractRateLimitNum(text) {
    try {
      return Number(JSON.parse(String(text || ''))?.data?.num) || 0;
    } catch {
      return 0;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function getCookies() {
    if (typeof chrome !== 'object' || !chrome?.cookies?.getAll) return [];
    try {
      return await chrome.cookies.getAll({ url: `${CHAT_BASE}/` });
    } catch {
      return [];
    }
  }

  async function getStoredToken() {
    if (typeof chrome !== 'object') return '';
    try {
      const data = await chrome?.storage?.session?.get?.('qwenToken') || {};
      const stored = String(data?.qwenToken || '').trim();
      if (stored) return stored;
      const tokenCookie = (await getCookies()).find((cookie) => String(cookie?.name || '') === 'token');
      const cookieToken = String(tokenCookie?.value || '').trim();
      if (cookieToken) await chrome?.storage?.session?.set?.({ qwenToken: cookieToken });
      return cookieToken;
    } catch {
      return '';
    }
  }

  async function captureToken(token) {
    const value = String(token || '').trim();
    if (!value) return;
    if (typeof chrome !== 'object' || !chrome?.storage?.session) return;
    try {
      await chrome.storage.session.set({ qwenToken: value });
    } catch {
      // 忽略
    }
  }

  async function isLoggedIn() {
    return !!await getStoredToken();
  }

  async function openLoginPage() {
    if (openLoginPagePromise) return openLoginPagePromise;
    openLoginPagePromise = queueQwenPageOperation(async () => {
      const stored = await chrome.storage.session.get(LOGIN_TAB_ID_KEY).catch(() => ({}));
      const storedTabId = Number(stored?.[LOGIN_TAB_ID_KEY]);
      const existingLoginTab = Number.isInteger(storedTabId)
        ? await chrome.tabs.get(storedTabId).catch(() => null)
        : null;
      if (existingLoginTab && String(existingLoginTab.url || existingLoginTab.pendingUrl || '').startsWith(CHAT_BASE)) {
        const loginTab = await chrome.tabs.update(existingLoginTab.id, {
          url: AUTH_URL,
          active: true,
          autoDiscardable: false
        }).catch(() => existingLoginTab);
        if (Number.isInteger(existingLoginTab.windowId)) {
          await chrome.windows.update(existingLoginTab.windowId, { focused: true }).catch(() => null);
        }
        return { tab: loginTab, created: false };
      }
      await chrome.storage.session.remove(LOGIN_TAB_ID_KEY).catch(() => {});
      const reusable = await findChatTab();
      if (reusable) {
        await chrome.storage.session.set({ [LOGIN_TAB_ID_KEY]: reusable.id }).catch(() => {});
        const loginTab = await chrome.tabs.update(reusable.id, {
          url: AUTH_URL,
          active: true,
          autoDiscardable: false
        }).catch(() => reusable);
        if (Number.isInteger(reusable.windowId)) await chrome.windows.update(reusable.windowId, { focused: true }).catch(() => null);
        return { tab: loginTab, created: false };
      }

      let tab = await global.BjtuTabs.create({ url: 'about:blank', active: true });
      if (Number.isInteger(tab?.id)) {
        await chrome.storage.session.set({ [LOGIN_TAB_ID_KEY]: tab.id }).catch(() => {});
        tab = await chrome.tabs.update(tab.id, {
          url: AUTH_URL,
          active: true,
          autoDiscardable: false
        }).catch(() => tab);
      }
      await keepChatTabResident(tab?.id);
      return { tab, created: true };
    }).finally(() => {
      openLoginPagePromise = null;
    });
    return openLoginPagePromise;
  }

  async function findChatTab() {
    if (typeof chrome !== 'object' || !chrome?.tabs?.query) return null;
    try {
      const tabs = await chrome.tabs.query({ url: `${CHAT_BASE}/*` });
      return tabs.find((tab) => tab.id != null) || null;
    } catch {
      return null;
    }
  }

  // 登录检查直接由扩展后台请求 /api/v1/auths/，不创建临时网页。
  async function tryRefreshLogin() {
    if (loginCheckPromise) return loginCheckPromise;
    loginCheckPromise = (async () => {
      await ensureDirectRequestHeaders();
      const token = await getStoredToken();
      let response;
      try {
        response = await fetch(`${CHAT_BASE}/api/v1/auths/`, {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain, */*',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(await buildBrowserHeadersWithAntiBot())
          },
          credentials: 'include'
        });
      } catch (error) {
        throw Object.assign(new Error(`通义千问登录状态检查失败：${String(error?.message || error)}`), {
          code: 'LOGIN_CHECK_FAILED'
        });
      }
      let data = null;
      try {
        data = JSON.parse(await response.text());
      } catch {
        throw Object.assign(new Error('通义千问登录状态接口返回了无法解析的内容'), {
          code: 'LOGIN_CHECK_FAILED'
        });
      }
      if (response.status === 401 || String(data?.detail || '') === '401 Unauthorized') {
        await chrome.storage.session.remove('qwenToken').catch(() => {});
        return false;
      }
      const authenticated = response.ok && !!String(data?.id || '').trim() && !!String(data?.token || '').trim();
      if (authenticated) await captureToken(data.token);
      if (authenticated) return true;
      throw Object.assign(new Error(`通义千问登录状态检查失败：HTTP ${response.status}`), {
        code: 'LOGIN_CHECK_FAILED'
      });
    })().finally(() => {
      loginCheckPromise = null;
    });
    return loginCheckPromise;
  }

  async function keepChatTabResident(tabId) {
    const id = Number(tabId);
    if (!Number.isInteger(id)) return null;
    return chrome.tabs.update(id, { autoDiscardable: false }).catch(() => null);
  }


  function buildBrowserHeaders() {
    return {
      'x-ap': 'cn-hongkong',
      Version: '0.2.86',
      'X-Request-Id': (globalThis.crypto?.randomUUID?.() || `req-${Date.now()}`),
      source: 'web',
      'bx-v': '2.5.37'
    };
  }

  function ensureDirectRequestHeaders() {
    if (directRequestHeadersPromise) return directRequestHeadersPromise;
    directRequestHeadersPromise = (async () => {
      if (!chrome?.declarativeNetRequest?.updateSessionRules) return;
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [DIRECT_REQUEST_HEADER_RULE_ID],
        addRules: [{
          id: DIRECT_REQUEST_HEADER_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: CHAT_BASE },
              { header: 'Referer', operation: 'set', value: `${CHAT_BASE}/c/new-chat` }
            ]
          },
          condition: {
            urlFilter: '||chat.qwen.ai/api/',
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['xmlhttprequest']
          }
        }]
      });
    })().catch((error) => {
      directRequestHeadersPromise = null;
      throw error;
    });
    return directRequestHeadersPromise;
  }

  async function buildBrowserHeadersWithAntiBot() {
    const base = buildBrowserHeaders();
    let antiBot = {};
    try {
      const data = await chrome?.storage?.session?.get?.('qwenAntiBotHeaders') || {};
      const h = data?.qwenAntiBotHeaders || {};
      if (h.bxUa && h.capturedAt && (Date.now() - h.capturedAt <= 120000)) {
        antiBot = { 'bx-ua': h.bxUa };
        if (h.bxUmidtoken) antiBot['bx-umidtoken'] = h.bxUmidtoken;
      }
    } catch {
      // 忽略
    }
    return { ...base, ...antiBot };
  }

  function detectApiErrorText(text) {
    const t = String(text || '').trim();
    if (!t) return '';
    if (t.startsWith('<')) return 'WAF_CHALLENGE';
    try {
      const obj = JSON.parse(t);
      const ret0 = String((Array.isArray(obj?.ret) ? obj.ret[0] : '') || '');
      const dataUrl = String(obj?.data?.url || '');
      if (obj?.success === false && obj?.data != null && typeof obj.data === 'object') {
        const apiCode = String(obj.data.code || '');
        const details = String(obj.data.details || obj.data.message || '');
        if (apiCode === 'Unauthorized' || apiCode === '401' || apiCode === 'AuthenticationFailed' || apiCode === 'TokenExpired') {
          return 'NOT_LOGGED_IN';
        }
        if (apiCode === 'RateLimited') return 'RATE_LIMITED';
        if (apiCode === 'Not_Found') return 'CHAT_NOT_FOUND';
        if (details) return 'API_ERROR';
      }
      const ret1 = String((Array.isArray(obj?.ret) ? obj.ret[1] : '') || '');
      if (ret0.startsWith('FAIL_SYS_USER_VALIDATE') && ret1.includes('被挤爆')) {
        return 'WAF_BUSY';
      }
      if (ret0.startsWith('FAIL_SYS_USER_VALIDATE') || ret0.includes('RGV587') || dataUrl.includes('/_____tmd_____/punish')) {
        return 'WAF_PUNISH';
      }
      return '';
    } catch {
      return 'WAF_CHALLENGE';
    }
  }

  function extractWafValidationUrl(text) {
    try {
      const value = String(JSON.parse(String(text || ''))?.data?.url || '').trim();
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.hostname === 'chat.qwen.ai' ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function extractApiDetails(text) {
    try {
      const obj = JSON.parse(String(text || ''));
      return String(obj?.data?.details || obj?.data?.message || '');
    } catch {
      return '';
    }
  }

  function parseJsonOrThrow(text) {
    if (!text) return null;
    const kind = detectApiErrorText(text);
    if (kind === 'RATE_LIMITED') throw rateLimitError(extractRateLimitNum(text));
    if (kind === 'NOT_LOGGED_IN') throw notLoggedInError();
    if (kind === 'CHAT_NOT_FOUND') throw Object.assign(new Error(extractApiDetails(text) || '会话不存在或已被删除'), { code: 'CHAT_NOT_FOUND' });
    if (kind === 'API_ERROR') throw new Error(extractApiDetails(text) || '通义千问返回了错误');
    if (kind === 'WAF_BUSY') throw wafBusyError(extractWafValidationUrl(text));
    if (kind === 'WAF_PUNISH') throw wafPunishError(extractWafValidationUrl(text));
    if (kind === 'WAF_CHALLENGE') throw unparsableError();
    try {
      return JSON.parse(text);
    } catch {
      throw unparsableError();
    }
  }

  async function requestJsonDirect(url, options = {}) {
    await ensureDirectRequestHeaders();
    const token = await getStoredToken();
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(await buildBrowserHeadersWithAntiBot()),
        ...(options.headers || {})
      },
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
    if (response.status === 401 || response.status === 403) throw notLoggedInError();
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      if (detectApiErrorText(raw) === 'RATE_LIMITED') {
        throw rateLimitError(extractRateLimitNum(raw), rateLimitMessage(extractRateLimitNum(raw)));
      }
      throw new Error(`通义千问 API 请求失败：HTTP ${response.status}`);
    }
    const text = await response.text();
    return parseJsonOrThrow(text);
  }

  async function requestJson(url, options = {}) {
    return requestJsonDirect(url, options);
  }

  async function fetchModels() {
    // 从扩展 Service Worker 直接请求模型列表。
    const data = await requestJsonDirect(`${CHAT_BASE}/api/v2/models/`);
    const list = Array.isArray(data?.data?.data) ? data.data.data : [];
    return list.map((item) => ({
      id: String(item?.id || ''),
      name: String(item?.name || item?.id || ''),
      description: String(item?.info?.meta?.description || '')
    })).filter((item) => item.id);
  }

  async function fetchChatHistoryData(chatId) {
    const effectiveChatId = String(chatId || '');
    if (!effectiveChatId) return [];
    const data = await requestJson(`${CHAT_BASE}/api/v2/chats/${encodeURIComponent(effectiveChatId)}`);
    return Array.isArray(data?.data?.chat?.messages) ? data.data.chat.messages : [];
  }

  async function fetchChatHistory(chatId) {
    const effectiveChatId = String(chatId || '');
    return fetchChatHistoryData(effectiveChatId);
  }

  async function resumeChatHistory(chatId, responseId, { onEvent = null, signal = null } = {}) {
    const effectiveChatId = String(chatId || '');
    const effectiveResponseId = String(responseId || '');
    if (!effectiveChatId || !effectiveResponseId) return { ended: true, messages: [] };
    let ended = false;
    try {
      await resumeInterruptedCompletion({
        chatId: effectiveChatId,
        modelId: '',
        messages: [],
        parentId: '',
        onEvent,
        signal
      }, effectiveResponseId);
    } catch (error) {
      if (error?.code !== 'REQUEST_ENDED') throw error;
      ended = true;
    }
    return { ended, messages: await fetchChatHistoryData(effectiveChatId) };
  }

  async function deleteChat(chatId) {
    const effectiveChatId = String(chatId || '');
    if (!effectiveChatId) return;
    await requestJson(`${CHAT_BASE}/api/v2/chats/${encodeURIComponent(effectiveChatId)}`, { method: 'DELETE' });
  }

  async function newChat(modelId) {
    if (!await isLoggedIn()) throw notLoggedInError();
    const timestamp = Date.now();
    const data = await requestJson(`${CHAT_BASE}/api/v2/chats/new`, {
      method: 'POST',
      body: {
        title: 'New Chat',
        chatId: '',
        models: [String(modelId || '')],
        project_id: '',
        timestamp,
        chat_type: 't2t',
        chat_mode: 'normal'
      }
    });
    const chatId = String(data?.data?.id || '');
    if (!chatId) throw new Error('新建会话失败：未返回会话 ID');
    return chatId;
  }

  function buildUserMessage({ modelId, content, timestamp, thinking = false }) {
    return {
      id: null,
      fid: (globalThis.crypto?.randomUUID?.() || `fid-${Date.now()}`),
      parentId: null,
      childrenIds: [],
      role: 'user',
      content: String(content || ''),
      user_action: 'chat',
      files: [],
      timestamp: Math.floor((timestamp || Date.now()) / 1000),
      models: [String(modelId || '')],
      model: '',
      chat_type: 't2t',
      feature_config: {
        thinking_enabled: thinking === true,
        output_schema: 'phase',
        research_mode: 'normal',
        auto_thinking: false,
        thinking_mode: 'Auto',
        auto_search: false
      },
      extra: { meta: { subChatType: 't2t' } },
      sub_chat_type: 't2t',
      parent_id: null
    };
  }

  async function streamCompletionsDirect({ chatId, modelId, messages, onEvent, signal, parentId, resumeResponseId = '' }) {
    if (!await isLoggedIn()) throw notLoggedInError();
    await ensureDirectRequestHeaders();
    const resumeId = String(resumeResponseId || '');
    const url = `${CHAT_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}${resumeId ? `&response_id=${encodeURIComponent(resumeId)}` : ''}`;
    const token = await getStoredToken();
    const parent = String(parentId || '');
    let response;
    try {
      response = await fetch(url, {
        method: resumeId ? 'GET' : 'POST',
        headers: {
          Accept: 'text/event-stream',
          ...(resumeId ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(await buildBrowserHeadersWithAntiBot())
        },
        credentials: 'include',
        body: resumeId ? undefined : JSON.stringify({
          stream: true,
          version: '2.1',
          incremental_output: true,
          chatId,
          parentId: parent,
          chat_id: chatId,
          chat_mode: 'normal',
          model: String(modelId || ''),
          parent_id: parent || null,
          messages,
          timestamp: Date.now()
        }),
        signal
      });
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      throw networkError(resumeId);
    }
    if (response.status === 401 || response.status === 403) throw notLoggedInError();
    if (!response.ok) {
      const text = await response.text();
      const errKind = detectApiErrorText(text);
      if (errKind === 'NOT_LOGGED_IN') throw notLoggedInError();
      if (errKind === 'RATE_LIMITED') throw rateLimitError(extractRateLimitNum(text));
      if (errKind === 'API_ERROR') throw new Error(extractApiDetails(text) || `通义千问 API 请求失败：HTTP ${response.status}`);
      if (errKind === 'WAF_BUSY') throw wafBusyError(extractWafValidationUrl(text));
      if (errKind === 'WAF_PUNISH') throw wafPunishError(extractWafValidationUrl(text));
      if (errKind === 'WAF_CHALLENGE') throw unparsableError();
      throw new Error(`通义千问 API 请求失败：HTTP ${response.status}`);
    }
    const contentType = String(response.headers.get('content-type') || '');
    if (!response.body?.getReader || !contentType.includes('event-stream')) {
      const text = await response.text();
      const kind = detectApiErrorText(text);
      if (kind === 'NOT_LOGGED_IN') throw notLoggedInError();
      if (kind === 'API_ERROR') throw new Error(extractApiDetails(text) || '通义千问返回了错误');
      if (kind === 'WAF_BUSY') throw wafBusyError(extractWafValidationUrl(text));
      if (kind === 'WAF_PUNISH') throw wafPunishError(extractWafValidationUrl(text));
      if (kind || text.trim()) throw unparsableError();
      return { text: '', responseId: '', responseParentId: '' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawText = '';
      let sawDataLine = false;
      let responseId = '';
      let responseParentId = '';
      let fullText = '';
      let targetResponseId = '';
      let sawAlternateResponse = false;

      const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        sawDataLine = true;
        let payload;
        try {
          payload = JSON.parse(line.slice(5).trim());
        } catch {
          return;
        }
        const payloadText = JSON.stringify(payload);
        const payloadErrorKind = detectApiErrorText(payloadText);
        if (payloadErrorKind === 'WAF_BUSY') {
          throw wafBusyError(extractWafValidationUrl(payloadText));
        }
        if (payloadErrorKind === 'WAF_PUNISH') {
          throw wafPunishError(extractWafValidationUrl(payloadText));
        }
        const incomingResponseId = String(payload?.response_id || payload?.['response.created']?.response_id || '');
        if (incomingResponseId && incomingResponseId !== responseId) {
          responseId = incomingResponseId;
          onEvent?.({ responseId });
        }
        const created = payload?.['response.created'];
        if (created) {
          const idx = String(created.response_index ?? '');
          const rid = String(created.response_id || '');
          if (idx === '0') {
            targetResponseId = rid;
          } else if (rid && !targetResponseId) {
            sawAlternateResponse = true;
          }
        }
        const createdParentId = String(payload?.['response.created']?.response?.parent_id
          || payload?.['response.created']?.response?.parentId
          || payload?.['response.created']?.parent_id
          || '');
        if (createdParentId && createdParentId !== responseParentId) {
          responseParentId = createdParentId;
          onEvent?.({ responseParentId });
        }
        if (payload?.error) {
          const message = typeof payload.error === 'string'
            ? payload.error
            : String(payload.error.details || payload.error.message || '通义千问返回了错误');
          if (isRequestFinishedMessage(message)) {
            throw requestEndedError(payload?.response_id || responseId, message);
          }
          throw new Error(message);
        }
      const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
      if (choice?.response_id && String(choice.response_id) !== responseId) {
        responseId = String(choice.response_id);
        onEvent?.({ responseId });
      }
      const delta = choice?.delta;
      if (!delta) {
        onEvent?.({ meta: payload });
        return;
      }
      // 千问可能一次返回多条 response（response_index 0/1），只需读取 index==0 对应的回复。
      if (targetResponseId && responseId && responseId !== targetResponseId) return;
      if (!targetResponseId && sawAlternateResponse) return;
      const content = String(delta.content || '');
      const status = String(delta.status || '');
      const phase = String(delta.phase || '');
      const functionCall = delta.function_call;
      if (functionCall && typeof functionCall === 'object') {
        const rawFunctionId = String(delta.function_id || functionCall.function_id || functionCall.id || '');
        onEvent?.({
          functionCall: {
            id: rawFunctionId.match(/call_[\w-]+$/)?.[0] || rawFunctionId,
            name: String(functionCall.name || delta.name || ''),
            arguments: String(functionCall.arguments || '')
          },
          responseId
        });
      }
      const extra = delta.extra;
      let hasFunctionResult = false;
      let functionResult;
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        if (Object.prototype.hasOwnProperty.call(extra, 'tool_result')) {
          hasFunctionResult = true;
          functionResult = extra.tool_result;
        } else if (status === 'finished' && (delta.role === 'function' || functionCall)) {
          const ignored = new Set(['display_position', 'function_id', 'code_interpreter_info']);
          const entries = Object.entries(extra).filter(([key]) => !ignored.has(key));
          if (entries.length) {
            hasFunctionResult = true;
            functionResult = Object.fromEntries(entries);
          }
        }
      }
      if (hasFunctionResult) {
        const rawFunctionId = String(delta.function_id || extra.function_id || '');
        onEvent?.({
          functionResult: {
            id: rawFunctionId.match(/call_[\w-]+$/)?.[0] || rawFunctionId,
            name: String(delta.name || delta.function_call?.name || ''),
            result: functionResult
          },
          responseId
        });
      }
      if (phase === 'answer' && status === 'finished') {
        onEvent?.({ finished: true, responseId });
        return;
      }
      if (content) {
        if (phase === 'think') {
          onEvent?.({ thinking: content, responseId });
        } else if (phase === 'answer') {
          fullText += content;
          onEvent?.({ text: content, responseId });
        }
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawText += chunk;
        buffer += chunk;
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) handleLine(line);
        }
      }
      if (buffer.trim()) handleLine(buffer.trim());
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted || error?.code === 'REQUEST_ENDED') throw error;
      if (error?.code) throw error;
      throw networkError(responseId || resumeId);
    }
    if (!sawDataLine && rawText.trim()) {
      const kind = detectApiErrorText(rawText);
      if (kind === 'WAF_BUSY') throw wafBusyError(extractWafValidationUrl(rawText));
      if (kind === 'WAF_PUNISH') throw wafPunishError(extractWafValidationUrl(rawText));
      if (kind) throw unparsableError();
    }
    return { text: fullText, responseId, responseParentId };
  }

  async function resumeInterruptedCompletion(options, responseId) {
    const targetResponseId = String(responseId || '');
    if (!targetResponseId) throw networkError();
    options.onEvent?.({ streamRestart: true, responseId: targetResponseId });
    while (!options.signal?.aborted) {
      try {
        return await streamCompletionsDirect({ ...options, resumeResponseId: targetResponseId });
      } catch (error) {
        if (error?.name === 'AbortError' || options.signal?.aborted || error?.code === 'REQUEST_ENDED') throw error;
        if (error?.code !== 'NETWORK_ERROR') throw error;
        await sleep(1000);
      }
    }
    throw options.signal?.reason || new DOMException('生成中止', 'AbortError');
  }

  async function retryInterruptedCompletion(options, { resetRendered = false } = {}) {
    let shouldReset = resetRendered === true;
    while (!options.signal?.aborted) {
      try {
        if (shouldReset) {
          options.onEvent?.({ streamRestart: true, responseId: '' });
          shouldReset = false;
        }
        return await streamCompletionsDirect(options);
      } catch (error) {
        if (error?.name === 'AbortError' || options.signal?.aborted) throw error;
        if (error?.code === 'NETWORK_ERROR' && error?.responseId) {
          return resumeInterruptedCompletion(options, error.responseId);
        }
        if (error?.code !== 'NETWORK_ERROR') throw error;
        await sleep(1000);
      }
    }
    throw options.signal?.reason || new DOMException('生成中止', 'AbortError');
  }

  async function streamCompletions(options) {
    let receivedAny = false;
    let responseId = '';
    const wrappedOptions = {
      ...options,
      onEvent: (event) => {
        if (event?.responseId) responseId = String(event.responseId);
        if (event?.text || event?.thinking || event?.functionCall || event?.functionResult) receivedAny = true;
        options.onEvent?.(event);
      }
    };
    try {
      return await streamCompletionsDirect(wrappedOptions);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.code !== 'NETWORK_ERROR') throw error;
      const interruptedResponseId = String(error?.responseId || responseId || '');
      return interruptedResponseId
        ? resumeInterruptedCompletion(wrappedOptions, interruptedResponseId)
        : retryInterruptedCompletion(wrappedOptions, { resetRendered: receivedAny });
    }
  }

  async function stopGeneration({ chatId, responseId }) {
    const effectiveChatId = String(chatId || '');
    const effectiveResponseId = String(responseId || '');
    if (!effectiveChatId || !effectiveResponseId) return;
    try {
      await requestJson(`${CHAT_BASE}/api/v2/chat/completions/stop?chat_id=${encodeURIComponent(effectiveChatId)}`, {
        method: 'POST',
        body: {
          chat_id: effectiveChatId,
          response_id: effectiveResponseId
        }
      });
    } catch {
      // 停止失败不抛出，当前响应已中止
    }
  }

  global.BjtuQwenClient = {
    CHAT_BASE,
    isLoggedIn,
    tryRefreshLogin,
    openLoginPage,
    captureToken,
    fetchModels,
    newChat,
    fetchChatHistory,
    resumeChatHistory,
    deleteChat,
    buildUserMessage,
    streamCompletions,
    stopGeneration
  };
})(globalThis);
