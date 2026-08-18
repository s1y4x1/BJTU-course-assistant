/* 通义千问聊天客户端：读取登录令牌、查询模型、新建会话、流式生成回复。
 * API 优先经 chat.qwen.ai 页面（内容脚本同源请求）执行，规避阿里 baxia WAF 的
 * JS 挑战；页面不可用/未注入时回退为 Service Worker 直接请求（附带反爬标头）。 */
(function initBjtuQwenClient(global) {
  'use strict';

  const CHAT_BASE = 'https://chat.qwen.ai';
  const AUTH_URL = `${CHAT_BASE}/auth`;
  const LOGIN_TAB_ID_KEY = 'qwenLoginTabId';
  let ensureChatTabPromise = null;
  let openLoginPagePromise = null;
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

  function wafPunishError() {
    return Object.assign(new Error('通义千问触发风控校验（可能要求完成验证码或被限流），请到 chat.qwen.ai 页面完成验证后重试'), { code: 'WAF_PUNISH' });
  }

  function wafBusyError() {
    return Object.assign(new Error('通义千问触发风控校验（可能要求完成验证码或被限流），请到 chat.qwen.ai 页面完成验证后重试'), { code: 'WAF_BUSY' });
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

  async function openLoginPage(options = {}) {
    if (openLoginPagePromise) return openLoginPagePromise;
    openLoginPagePromise = queueQwenPageOperation(async () => {
      const auth = options?.auth === true;
      if (auth) {
        const stored = await chrome.storage.session.get(LOGIN_TAB_ID_KEY).catch(() => ({}));
        const storedTabId = Number(stored?.[LOGIN_TAB_ID_KEY]);
        const existingLoginTab = Number.isInteger(storedTabId)
          ? await chrome.tabs.get(storedTabId).catch(() => null)
          : null;
        if (existingLoginTab && String(existingLoginTab.url || existingLoginTab.pendingUrl || '').startsWith(CHAT_BASE)) {
          await chrome.tabs.update(existingLoginTab.id, { active: true, autoDiscardable: false }).catch(() => null);
          if (Number.isInteger(existingLoginTab.windowId)) {
            await chrome.windows.update(existingLoginTab.windowId, { focused: true }).catch(() => null);
          }
          return existingLoginTab;
        }
        await chrome.storage.session.remove(LOGIN_TAB_ID_KEY).catch(() => {});
        const reusable = await findChatTab();
        if (reusable) {
          const loginTab = await chrome.tabs.update(reusable.id, {
            url: AUTH_URL,
            active: true,
            autoDiscardable: false
          }).catch(() => reusable);
          await chrome.storage.session.set({ [LOGIN_TAB_ID_KEY]: reusable.id }).catch(() => {});
          if (Number.isInteger(reusable.windowId)) await chrome.windows.update(reusable.windowId, { focused: true }).catch(() => null);
          return loginTab;
        }
      } else {
        const existing = await findChatTab();
        if (existing) {
          await keepChatTabResident(existing.id);
          await chrome.tabs.update(existing.id, { active: true }).catch(() => null);
          if (Number.isInteger(existing.windowId)) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => null);
          return existing;
        }
      }

      const tab = await global.BjtuTabs.create({ url: auth ? AUTH_URL : CHAT_BASE, active: true });
      await keepChatTabResident(tab?.id);
      if (auth && Number.isInteger(tab?.id)) {
        await chrome.storage.session.set({ [LOGIN_TAB_ID_KEY]: tab.id }).catch(() => {});
      }
      return tab;
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

  // 无可用页面时静默打开 chat.qwen.ai 标签页，等待其内容脚本就绪（确保请求走同源路径）
  async function ensureChatTab() {
    if (ensureChatTabPromise) return ensureChatTabPromise;
    ensureChatTabPromise = queueQwenPageOperation(async () => {
      if (typeof chrome !== 'object' || !chrome?.tabs?.create) return null;
      try {
        const existing = await findChatTab();
        if (existing) {
          await keepChatTabResident(existing.id);
          return existing;
        }
        const tab = await global.BjtuTabs.create({ url: CHAT_BASE, active: false });
        await keepChatTabResident(tab?.id);
        for (let i = 0; i < 24; i += 1) {
          await sleep(500);
          const ping = await sendToTab(tab.id, { type: 'QWEN_PING' });
          if (ping?.ready) return tab;
        }
        return tab;
      } catch {
        return null;
      }
    }).finally(() => {
      ensureChatTabPromise = null;
    });
    return ensureChatTabPromise;
  }

  // 复用已有 chat.qwen.ai 页面或后台新开一个，等待内容脚本重新上报登录令牌后复查登录状态。
  // 若旧页面内容脚本未就绪（例如扩展刚重载、session 令牌已清空且页面未刷新），则重载该页以
  // 重新注入内容脚本；仍无法复用则自动打开新页面。
  async function tryRefreshLogin() {
    if (await isLoggedIn()) return true;
    let tab = await findChatTab();
    if (tab) {
      tab = await ensureChatTabReady(tab);
      for (let i = 0; tab && i < 12; i += 1) {
        if (await isLoggedIn()) return true;
        await sleep(500);
      }
    }
    if (!await isLoggedIn()) {
      tab = await ensureChatTab();
    }
    return await isLoggedIn();
  }

  async function pingChatTab(tabId) {
    const ping = await Promise.race([
      sendToTab(tabId, { type: 'QWEN_PING' }),
      sleep(1500).then(() => null)
    ]);
    return ping?.ready === true;
  }

  async function keepChatTabResident(tabId) {
    const id = Number(tabId);
    if (!Number.isInteger(id)) return null;
    return chrome.tabs.update(id, { autoDiscardable: false }).catch(() => null);
  }

  async function waitForChatTabReady(tabId, attempts = 24) {
    for (let i = 0; i < attempts; i += 1) {
      if (await pingChatTab(tabId)) return true;
      await sleep(500);
    }
    return false;
  }

  // frozen/discarded 标签只能通过激活解除休眠。这里短暂激活 Qwen 页，
  // 等内容脚本恢复后立即切回原标签，并通过 autoDiscardable=false 避免再次被自动丢弃。
  async function ensureChatTabReady(tab) {
    if (!tab) return null;
    let current = tab;
    try {
      const fresh = await chrome.tabs.get(tab.id);
      if (fresh) current = fresh;
    } catch {
      // 页面可能已关闭，沿用原引用
    }
    await keepChatTabResident(current.id);
    const sleeping = current.discarded === true || current.frozen === true || current.status === 'unloaded';
    if (!sleeping && await pingChatTab(current.id)) return current;

    const activeTabs = Number.isInteger(current.windowId)
      ? await chrome.tabs.query({ windowId: current.windowId, active: true }).catch(() => [])
      : [];
    const restoreTabId = activeTabs.find((item) => item?.id !== current.id)?.id;
    let ready = false;
    try {
      await chrome.tabs.update(current.id, { active: true, autoDiscardable: false });
      ready = await waitForChatTabReady(current.id, sleeping ? 24 : 8);
      if (!ready) {
        await chrome.tabs.reload(current.id);
        ready = await waitForChatTabReady(current.id, 24);
      }
    } catch {
      ready = false;
    } finally {
      if (Number.isInteger(restoreTabId)) {
        await chrome.tabs.update(restoreTabId, { active: true }).catch(() => null);
      }
    }
    if (!ready) return null;
    return await chrome.tabs.get(current.id).catch(() => current);
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
    if (kind === 'WAF_BUSY') throw wafBusyError();
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
    let tab = await findChatTab();
    if (!tab && !options.noEnsureTab) tab = await ensureChatTab();
    if (tab) {
      const staleTab = tab;
      tab = await ensureChatTabReady(tab);
      if (!tab && !options.noEnsureTab) {
        await chrome.tabs.remove(staleTab.id).catch(() => null);
        tab = await ensureChatTab();
      }
      let punished = false;
      for (let attempt = 0; tab && attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await sleep(2500);
          const ready = await ensureChatTabReady(tab);
          if (ready) tab = ready;
        }
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
          const raw = String(result.text || '');
          const errKind = detectApiErrorText(raw);
          if (errKind === 'RATE_LIMITED') {
            throw rateLimitError(extractRateLimitNum(raw), rateLimitMessage(extractRateLimitNum(raw)));
          }
          if (errKind === 'NOT_LOGGED_IN') throw notLoggedInError();
          if (errKind === 'API_ERROR') throw new Error(extractApiDetails(raw) || `通义千问 API 请求失败：HTTP ${result.status}`);
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
    // 直接从扩展自身页面（Service Worker）请求模型列表，不依赖 chat.qwen.ai 标签页
    // （标签页可能闲置/未激活，导致选项页的模型下拉框等不到结果）。
    const data = await requestJsonDirect(`${CHAT_BASE}/api/v2/models/`);
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
        else if (code === 'WAF_BUSY') pending.reject(wafBusyError());
        else if (code === 'WAF_CHALLENGE') pending.reject(unparsableError());
        else if (code === 'RATE_LIMITED') pending.reject(rateLimitError(0, String(data.message || '')));
        else if (code === 'STREAM_ERROR') pending.reject(new Error(String(data.message || '通义千问返回了错误')));
        else if (code === 'NOT_LOGGED_IN') pending.reject(notLoggedInError());
        else if (code === 'API_ERROR') pending.reject(new Error(String(data.message || '通义千问返回了错误')));
        else pending.reject(new Error(code));
      } else if (data.end) {
        pendingStreams.delete(data.id);
        pending.resolve({
          text: String(data.text || ''),
          responseId: String(data.responseId || ''),
          responseParentId: String(data.responseParentId || '')
        });
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
    if (!response.ok) {
      const text = await response.text();
      const errKind = detectApiErrorText(text);
      if (errKind === 'NOT_LOGGED_IN') throw notLoggedInError();
      if (errKind === 'API_ERROR') throw new Error(extractApiDetails(text) || `通义千问 API 请求失败：HTTP ${response.status}`);
      throw new Error(`通义千问 API 请求失败：HTTP ${response.status}`);
    }
    const contentType = String(response.headers.get('content-type') || '');
    if (!response.body?.getReader || !contentType.includes('event-stream')) {
      const text = await response.text();
      const kind = detectApiErrorText(text);
      if (kind === 'NOT_LOGGED_IN') throw notLoggedInError();
      if (kind === 'API_ERROR') throw new Error(extractApiDetails(text) || '通义千问返回了错误');
      if (kind === 'WAF_BUSY') throw wafBusyError();
      if (kind === 'WAF_PUNISH') throw wafPunishError();
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
        if (payload?.response_id) responseId = String(payload.response_id);
        if (payload?.['response.created']?.response_id) responseId = String(payload['response.created'].response_id);
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
        throw new Error(String(payload.error.details || payload.error.message || '通义千问返回了错误'));
      }
      const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
      if (choice?.response_id) responseId = String(choice.response_id);
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
      if (kind === 'WAF_BUSY') throw wafBusyError();
      if (kind === 'WAF_PUNISH') throw wafPunishError();
      if (kind) throw unparsableError();
    }
    return { text: fullText, responseId, responseParentId };
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
      const staleTab = tab;
      tab = await ensureChatTabReady(tab);
      if (!tab) {
        await chrome.tabs.remove(staleTab.id).catch(() => null);
        tab = await ensureChatTab();
      }
    }
    if (tab) {
      let lastError = null;
      let replaced = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
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
          const notReady = String(error?.message || '').includes('页面未就绪');
          if (notReady) {
            const ready = await ensureChatTabReady(tab);
            if (ready) {
              tab = ready;
              continue;
            }
          }
          if (notReady && !replaced) {
            replaced = true;
            try {
              await chrome.tabs.remove(tab.id);
            } catch {
              // 旧页面无法关闭（如无权限），继续尝试新页面
            }
            tab = await ensureChatTab();
            if (tab) {
              tab = await ensureChatTabReady(tab);
              if (tab) continue;
            }
          }
          break;
        }
      }
      // 页面路径彻底失败时回退为扩展自身页面直接请求
      if (lastError && !String(lastError?.message || '').includes('页面未就绪')) throw lastError;
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
    tryRefreshLogin,
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
