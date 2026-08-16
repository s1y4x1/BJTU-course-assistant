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
      if (ret0.startsWith('FAIL_SYS_USER_VALIDATE') || ret0.includes('RGV587') || dataUrl.includes('/_____tmd_____/punish')) {
        return 'WAF_PUNISH';
      }
      return '';
    } catch {
      return 'WAF_CHALLENGE';
    }
  }

  function parseJsonOrThrow(text) {
    if (!text) return null;
    const kind = detectApiErrorText(text);
    if (kind === 'WAF_PUNISH') throw wafPunishError();
    if (kind === 'WAF_CHALLENGE') throw unparsableError();
    try {
      return JSON.parse(text);
    } catch {
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
        ...(await buildBrowserHeadersWithAntiBot()),
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
    if (!tab && !options.noEnsureTab) tab = await ensureChatTab();
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
    const data = await requestJson(`${CHAT_BASE}/api/v2/models/`, { noEnsureTab: true });
    const list = Array.isArray(data?.data?.data) ? data.data.data : [];
    return list.map((item) => ({
      id: String(item?.id || ''),
      name: String(item?.name || item?.id || ''),
      description: String(item?.info?.meta?.description || '')
    })).filter((item) => item.id);
  }

  async function fetchChatHistory(chatId) {
    const effectiveChatId = String(chatId || '');
    if (!effectiveChatId) return [];
    const data = await requestJson(`${CHAT_BASE}/api/v2/chats/${encodeURIComponent(effectiveChatId)}`);
    return Array.isArray(data?.data?.chat?.messages) ? data.data.chat.messages : [];
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

  function streamViaContentScript(tab, { chatId, modelId, messages, onEvent, signal, parentId }) {
    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const parent = String(parentId || '');
    const body = {
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

  async function streamCompletionsDirect({ chatId, modelId, messages, onEvent, signal, parentId }) {
    if (!await isLoggedIn()) throw notLoggedInError();
    const url = `${CHAT_BASE}/api/v2/chat/completions?chat_id=${encodeURIComponent(chatId)}`;
    const token = await getStoredToken();
    const parent = String(parentId || '');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(await buildBrowserHeadersWithAntiBot())
      },
      credentials: 'include',
      body: JSON.stringify({
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
    if (response.status === 401 || response.status === 403) throw notLoggedInError();
    if (!response.ok) throw new Error(`通义千问 API 请求失败：HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '');
    if (!response.body?.getReader || !contentType.includes('event-stream')) {
      const text = await response.text();
      const kind = detectApiErrorText(text);
      if (kind === 'WAF_PUNISH') throw wafPunishError();
      if (kind || text.trim()) throw unparsableError();
      return { text: '', responseId: '' };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawText = '';
    let sawDataLine = false;
    let responseId = '';
    let fullText = '';

    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      sawDataLine = true;
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
      const phase = String(delta.phase || '');
      if (status === 'finished') {
        onEvent?.({ finished: true, responseId });
        return;
      }
      if (content) {
        if (phase === 'think') {
          onEvent?.({ thinking: content, responseId });
        } else {
          fullText += content;
          onEvent?.({ text: content, responseId });
        }
      }
    };

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
    if (!sawDataLine && rawText.trim()) {
      const kind = detectApiErrorText(rawText);
      if (kind === 'WAF_PUNISH') throw wafPunishError();
      if (kind) throw unparsableError();
    }
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
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          if (receivedAny) break;
          await sleep(3000 * attempt);
        }
        try {
          return await streamViaContentScript(tab, wrappedOptions);
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          lastError = error;
          if (error?.code === 'WAF_PUNISH' && attempt < 2 && !receivedAny) continue;
          break;
        }
      }
      if (lastError) throw lastError;
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
    fetchChatHistory,
    deleteChat,
    buildUserMessage,
    streamCompletions,
    stopGeneration
  };
})(globalThis);