/* 通义千问聊天客户端：读取登录令牌、查询模型、新建会话、流式生成回复。
 * API 优先经 chat.qwen.ai 页面（内容脚本同源请求）执行，规避阿里 baxia WAF 的
 * JS 挑战；页面不可用/未注入时回退为 Service Worker 直接请求（附带反爬标头）。 */
(function initBjtuQwenClient(global) {
  'use strict';

  const CHAT_BASE = 'https://chat.qwen.ai';

  function notLoggedInError() {
    return Object.assign(new Error('尚未登录通义千问，请先打开 https://chat.qwen.ai/ 登录'), { code: 'NOT_LOGGED_IN' });
  }

  function unparsableError() {
    return Object.assign(new Error('通义千问 API 返回了无法解析的内容（可能被 WAF 拦截），请刷新 chat.qwen.ai 页面后重试'), { code: 'WAF_CHALLENGE' });
  }

  function wafPunishError() {
    return Object.assign(new Error('通义千问触发风控校验（可能要求完成验证码或被限流），请到 chat.qwen.ai 页面完成验证后重试'), { code: 'WAF_PUNISH' });
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
    if (typeof chrome !== 'object' || !chrome?.storage?.session) return '';
    try {
      const data = await chrome.storage.session.get('qwenToken');
      return String(data?.qwenToken || '');
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
    if (await getStoredToken()) return true;
    const cookies = await getCookies();
    return cookies.some((cookie) => String(cookie.name || '') === 'token' && !!cookie.value);
  }

  async function openLoginPage() {
    await chrome.tabs.create({ url: CHAT_BASE, active: true });
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

  // 无可用页面时静默打开 chat.qwen.ai 标签页，等待其内容脚本就绪（确保请求走同源路径）
  async function ensureChatTab() {
    if (typeof chrome !== 'object' || !chrome?.tabs?.create) return null;
    try {
      const tab = await chrome.tabs.create({ url: CHAT_BASE, active: false });
      for (let i = 0; i < 24; i += 1) {
        await sleep(500);
        const ping = await sendToTab(tab.id, { type: 'QWEN_PING' });
        if (ping?.ready) return tab;
      }
      return tab;
    } catch {
      return null;
    }
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const error = chrome?.runtime?.lastError;
          resolve(error ? null : (response || null));
        });
      } catch {
        resolve(null);
      }
    });
  }

  function buildBrowserHeaders() {
    return {
      'x-ap': 'cn-hongkong',
      Version: '0.2.86',
      'X-Request-Id': (globalThis.crypto?.randomUUID?.() || `req-${Date.now()}`),
      source: 'web',
      'bx-v': '2.5.37',
      Origin: CHAT_BASE,
      Referer: `${CHAT_BASE}/c/new-chat`
    };
  }

  function parseJsonOrThrow(text) {
    if (!text) return null;
    try {
      const value = JSON.parse(text);
      const ret0 = String((Array.isArray(value?.ret) ? value.ret[0] : '') || '');
      const dataUrl = String(value?.data?.url || '');
      if (ret0.startsWith('FAIL_SYS_USER_VALIDATE') || ret0.includes('RGV587') || dataUrl.includes('/_____tmd_____/punish')) {
        throw wafPunishError();
      }
      return value;
    } catch (error) {
      if (error?.code === 'WAF_PUNISH') throw error;
      throw unparsableError();
    }
  }

  async function requestJsonDirect(url, options = {}) {
    const token = await getStoredToken();
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...buildBrowserHeaders(),
        ...(options.headers || {})
      },
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
    if (response.status === 401 || response.status === 403) throw notLoggedInError();
    if (!response.ok) throw new Error(`通义千问 API 请求失败：HTTP ${response.status}`);
    const text = await response.text();
    return parseJsonOrThrow(text);
  }

  async function requestJson(url, options = {}) {
    let tab = await findChatTab();
    if (!tab) tab = await ensureChatTab();
    if (tab) {
      let punished = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await sleep(2500);
        const result = await sendToTab(tab.id, {
          type: 'QWEN_API_REQUEST',
          payload: {
            id: `req-${Date.now()}-${attempt}`,
            method: options.method || 'GET',
            url,
            body: options.body,
            headers: options.headers || {}
          }
        });
        if (!result?.ok) continue;
        if (result.status === 401 || result.status === 403) throw notLoggedInError();
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`通义千问 API 请求失败：HTTP ${result.status}`);
        }
        try {
          return parseJsonOrThrow(String(result.text || ''));
        } catch (error) {
          if (error?.code === 'WAF_PUNISH' && attempt === 0) {
            punished = true;
            continue;
          }
          throw error;
        }
      }
      if (punished) throw wafPunishError();
    }
    return requestJsonDirect(url, options);
  }

  async function fetchModels() {
    const data = await requestJson(`${CHAT_BASE}/api/v2/models/`);
    const list = Array.isArray(data?.data?.data) ? data.data.data : [];
    return list.map((item) => ({
      id: String(item?.id || ''),
      name: String(item?.name || item?.id || ''),
      description: String(item?.info?.meta?.description || '')
    })).filter((item) => item.id);
  }

  async function newChat(modelId) {
    if (!await isLoggedIn()) throw notLoggedInError();
    const timestamp = Date.now();
    const data = await requestJson(`${CHAT_BASE}/api/v2/chats/new`, {
      method: 'POST',
      body: {
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

  const pendingStreams = new Map();

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'QWEN_STREAM_DATA') return false;
      const data = message.payload || {};
      const pending = pendingStreams.get(String(data.id || ''));
      if (!pending) return false;
      if (data.error) {
        pendingStreams.delete(data.id);
        const code = String(data.error || '');
        if (code === 'WAF_PUNISH') pending.reject(wafPunishError());
        else if (code === 'WAF_CHALLENGE') pending.reject(unparsableError());
        else pending.reject(new Error(code));
      } else if (data.end) {
        pendingStreams.delete(data.id);
        pending.resolve({ text: String(data.text || ''), responseId: String(data.responseId || '') });
      } else {
        pending.onEvent?.(data);
      }
      return false;
    });
  }

  function streamViaContentScript(tab, { chatId, modelId, messages, onEvent, signal }) {
    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = {
      stream: true,
      version: '2.1',
      incremental_output: true,
      chatId,
      parentId: '',
      chat_id: chatId,
      chat_mode: 'normal',
      model: String(modelId || ''),
      parent_id: null,
      messages,
      timestamp: Date.now()
    };
    return new Promise((resolve, reject) => {
      const pending = { onEvent, resolve, reject };
      pendingStreams.set(id, pending);

      const abort = () => {
        pendingStreams.delete(id);
        reject(new DOMException('Aborted', 'AbortError'));
        try {
          chrome.tabs.sendMessage(tab.id, { type: 'QWEN_ABORT_STREAM', payload: { id } }, () => {
            void chrome?.runtime?.lastError;
          });
        } catch {
          // 忽略
        }
      };

      if (signal) {
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
      }

      sendToTab(tab.id, {
        type: 'QWEN_API_REQUEST',
        payload: {
          id,
          method: 'POST',
          url: `${CHAT_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`,
          body,
          stream: true,
          headers: { 'Content-Type': 'application/json' }
        }
      }).then((response) => {
        if (!response?.ok) {
          pendingStreams.delete(id);
          reject(new Error('chat.qwen.ai 页面未就绪，请稍后重试'));
        }
      });
    });
  }

  async function streamCompletionsDirect({ chatId, modelId, messages, onEvent, signal }) {
    if (!await isLoggedIn()) throw notLoggedInError();
    const url = `${CHAT_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`;
    const token = await getStoredToken();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...buildBrowserHeaders()
      },
      credentials: 'include',
      body: JSON.stringify({
        stream: true,
        version: '2.1',
        incremental_output: true,
        chatId,
        parentId: '',
        chat_id: chatId,
        chat_mode: 'normal',
        model: String(modelId || ''),
        parent_id: null,
        messages,
        timestamp: Date.now()
      }),
      signal
    });
    if (response.status === 401 || response.status === 403) throw notLoggedInError();
    if (!response.ok) throw new Error(`通义千问 API 请求失败：HTTP ${response.status}`);
    if (!response.body?.getReader) {
      const text = await response.text();
      if (text) onEvent?.({ text });
      return { text, responseId: '' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let responseId = '';
    let fullText = '';

    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      let payload;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        return;
      }
      if (payload?.response_id) responseId = String(payload.response_id);
      if (payload?.['response.created']?.response_id) responseId = String(payload['response.created'].response_id);
      const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
      if (choice?.response_id) responseId = String(choice.response_id);
      const delta = choice?.delta;
      if (!delta) {
        onEvent?.({ meta: payload });
        return;
      }
      const content = String(delta.content || '');
      const status = String(delta.status || '');
      if (status === 'finished') {
        onEvent?.({ finished: true, responseId });
        return;
      }
      if (content) {
        fullText += content;
        onEvent?.({ text: content, responseId });
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) handleLine(line);
      }
    }
    if (buffer.trim()) handleLine(buffer.trim());
    return { text: fullText, responseId };
  }

  async function streamCompletions(options) {
    let receivedAny = false;
    const wrappedOptions = {
      ...options,
      onEvent: (event) => {
        if (event?.text) receivedAny = true;
        options.onEvent?.(event);
      }
    };
    let tab = await findChatTab();
    if (!tab) tab = await ensureChatTab();
    if (tab) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          if (receivedAny) break;
          await sleep(2500);
        }
        try {
          return await streamViaContentScript(tab, wrappedOptions);
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          if (error?.code === 'WAF_PUNISH' && attempt === 0 && !receivedAny) continue;
          break;
        }
      }
    }
    return streamCompletionsDirect(wrappedOptions);
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
    openLoginPage,
    captureToken,
    fetchModels,
    newChat,
    buildUserMessage,
    streamCompletions,
    stopGeneration
  };
})(globalThis);