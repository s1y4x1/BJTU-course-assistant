/* Qwen 聊天面板（加载于 app 页面）。 */
(function initQwenChatApp(global) {
  'use strict';

  const FAB_ID = 'qwen-chat-fab';
  const PANEL_ID = 'qwen-chat-panel';
  const STATUS_ID = 'qwen-chat-status';
  const MESSAGES_ID = 'qwen-chat-messages';
  const MESSAGES_SCROLL_ID = 'qwen-chat-messages-scroll';
  const LOGIN_HINT_ID = 'qwen-chat-login-hint';
  const INPUT_ID = 'qwen-chat-input';
  const SEND_ID = 'qwen-chat-send';
  const STOP_ID = 'qwen-chat-stop';
  const SCROLL_BOTTOM_ID = 'qwen-chat-scroll-bottom';
  const MODEL_ID = 'qwen-chat-model';
  const THINKING_ID = 'qwen-chat-thinking';

  let port = null;
  let historyNeedsInitialScroll = false;
  let activeBubble = null;
  let busy = false;
  let sessionChatId = '';
  let sessionParentId = '';
  let nextReplyFresh = false;
  let inThinking = false;
  let lastSendText = '';
  let pendingEditParentId = '';
  let pendingEdit = false;
  let chatStateLoaded = false;
  let lastKnownLoggedIn = false;
  let lastKnownEnabled = true;
  let openingStarted = false;
  let openingCompleted = false;
  let autoScrollEnabled = true;
  let lastMessagesScrollTop = 0;
  let historyLoadPromise = null;
  let historyReloadAfterLogin = false;
  let pendingWafRetryAction = null;
  let wafRecoveryActive = false;
  let chatStateLoadPromise = null;
  let panelActivationPromise = null;
  let panelActivated = false;
  let panelHistoryInitialized = false;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtmlQwen(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function safeUrlQwen(href, allowed) {
    try {
      const url = new URL(href, global.location?.href);
      return allowed.has(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  let qwenMarkdownParser = null;
  function getQwenMarkdownParser() {
    if (qwenMarkdownParser) return qwenMarkdownParser;
    const markedApi = global.marked;
    if (!markedApi?.Marked || !markedApi?.Renderer) return null;
    const renderer = new markedApi.Renderer();
    renderer.html = ({ text }) => {
      const value = String(text || '').trim();
      if (/^<br\s*\/?\s*>$/i.test(value)) return '<br>';
      return escapeHtmlQwen(text);
    };
    renderer.link = function renderSafeLink({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens || []);
      const safeHref = safeUrlQwen(href, new Set(['http:', 'https:', 'mailto:']));
      if (!safeHref) return text;
      const titleAttribute = title ? ` title="${escapeHtmlQwen(title)}"` : '';
      return `<a href="${escapeHtmlQwen(safeHref)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${text}</a>`;
    };
    renderer.image = ({ href, title, text }) => {
      const safeSrc = safeUrlQwen(href, new Set(['http:', 'https:']));
      if (!safeSrc) return escapeHtmlQwen(String(text || ''));
      const titleAttribute = title ? ` title="${escapeHtmlQwen(title)}"` : '';
      return `<img src="${escapeHtmlQwen(safeSrc)}" alt="${escapeHtmlQwen(String(text || ''))}"${titleAttribute} loading="lazy">`;
    };
    renderer.codespan = ({ text }) => `<code class="qwen-md-inline-code" role="button" tabindex="0" title="点击复制">${escapeHtmlQwen(text)}</code>`;
    renderer.code = ({ text, lang }) => {
      const languageInfo = String(lang || '').trim();
      const language = languageInfo.split(/\s+/)[0];
      if (language.toLowerCase() === 'suggestions') return '';
      const resultMode = /^res: (sandbox|app|background)$/.exec(languageInfo)?.[1] || '';
      if (resultMode) {
        const jsonText = String(text || '').trim();
        return `<div class="qwen-chat-op qwen-inline-res"><div class="qwen-chat-op-name">操作结果（${escapeHtmlQwen(resultMode)}）</div><div class="qwen-chat-op-result">${escapeHtmlQwen(jsonText)}</div></div>`;
      }
      const languageAttribute = language ? ` data-language="${escapeHtmlQwen(language)}"` : '';
      const languageLabel = language || '代码';
      return `<div class="qwen-md-codeblock-wrap"${languageAttribute}><div class="qwen-md-codeblock-toolbar"><span class="qwen-md-codeblock-language">${escapeHtmlQwen(languageLabel)}</span><button type="button" class="qwen-md-codeblock-copy" title="复制代码">复制</button></div><pre class="qwen-md-codeblock"><code>${escapeHtmlQwen(String(text || ''))}</code></pre></div>`;
    };
    renderer.blockquote = function renderBlockquote({ tokens }) {
      return `<blockquote class="qwen-md-blockquote">${this.parser.parse(tokens || [])}</blockquote>`;
    };
    qwenMarkdownParser = new markedApi.Marked({
      gfm: true,
      breaks: true,
      pedantic: false,
      renderer
    });
    return qwenMarkdownParser;
  }

  function renderQwenMarkdown(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    if (!source) return '';
    const parser = getQwenMarkdownParser();
    if (!parser) return escapeHtmlQwen(source);
    try {
      return parser.parse(source, { async: false });
    } catch {
      return escapeHtmlQwen(source);
    }
  }

  function mdContainer(bubble) {
    let container = bubble.querySelector(':scope > .qwen-chat-md');
    if (!(container instanceof HTMLElement)) {
      container = document.createElement('div');
      container.className = 'qwen-chat-md';
      container._mdText = '';
      bubble.appendChild(container);
    }
    return container;
  }

  function mdRawText(bubble) {
    if (!(bubble instanceof HTMLElement)) return '';
    const container = bubble.querySelector(':scope > .qwen-chat-md');
    return container?._mdText || '';
  }

  function splitSuggestedReplies(text, { allowIncomplete = false } = {}) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    const completeMatch = /(?:^|\n)[ \t]*```suggestions[ \t]*\n([\s\S]*?)```[ \t]*$/i.exec(source);
    const incompleteMatch = allowIncomplete && !completeMatch
      ? /(?:^|\n)[ \t]*```suggestions[ \t]*(?:\n([\s\S]*)|$)/i.exec(source)
      : null;
    const match = completeMatch || incompleteMatch;
    if (!match) return { text: source, suggestions: [], found: false, complete: false, cursorPlacement: '' };
    const suggestionBody = String(match[1] || '');
    const suggestionLines = suggestionBody.split('\n');
    const trailingLine = String(suggestionLines.at(-1) || '').trim();
    const partialClosingFence = !completeMatch && /^`{1,2}$/.test(trailingLine);
    const visibleSuggestionBody = partialClosingFence
      ? suggestionLines.slice(0, -1).join('\n')
      : suggestionBody;
    const suggestions = [...new Set(visibleSuggestionBody
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean))];
    return {
      text: source.slice(0, match.index).trimEnd(),
      suggestions,
      found: true,
      complete: !!completeMatch,
      cursorPlacement: !completeMatch && trailingLine && !partialClosingFence ? 'button' : 'container'
    };
  }

  function clearSuggestedReplies() {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return;
    messages.querySelectorAll(':scope > .qwen-chat-suggestions').forEach((item) => item.remove());
  }

  function renderSuggestedReplies(bubble, suggestions) {
    if (!(bubble instanceof HTMLElement) || !Array.isArray(suggestions)) return null;
    const anchor = messageDisplayNode(bubble);
    if (!(anchor instanceof HTMLElement) || !anchor.isConnected) return null;
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return null;
    let container = [...messages.querySelectorAll(':scope > .qwen-chat-suggestions')]
      .find((item) => item._qwenSuggestionBubble === bubble);
    messages.querySelectorAll(':scope > .qwen-chat-suggestions').forEach((item) => {
      if (item !== container) item.remove();
    });
    if (!(container instanceof HTMLElement)) {
      container = document.createElement('div');
      container.className = 'qwen-chat-suggestions';
      container._qwenSuggestionBubble = bubble;
      anchor.after(container);
    }
    container.querySelectorAll('.qwen-chat-cursor').forEach((node) => node.remove());
    suggestions.forEach((suggestion, index) => {
      let button = container.children[index];
      if (!(button instanceof HTMLButtonElement)) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'qwen-chat-suggestion-btn';
        button.addEventListener('click', () => {
          if (busy) return;
          const reply = String(button.textContent || '').trim();
          if (!reply) return;
          clearSuggestedReplies();
          sendMessage(reply);
        });
        container.appendChild(button);
      }
      button.textContent = suggestion;
      button.title = `发送：${suggestion}`;
      button.disabled = busy;
    });
    while (container.children.length > suggestions.length) container.lastElementChild?.remove();
    maybeAutoScrollMessages(messages);
    return container;
  }

  function finalizeAssistantSuggestions(bubble, { render = true } = {}) {
    if (!(bubble instanceof HTMLElement)) return null;
    const parsed = splitSuggestedReplies(mdRawText(bubble), { allowIncomplete: true });
    if (!parsed.suggestions.length) return null;
    const container = mdContainer(bubble);
    container._mdText = parsed.text;
    container.innerHTML = renderQwenMarkdown(parsed.text);
    enhanceOperationResultControls(container);
    const candidate = { bubble, suggestions: parsed.suggestions };
    if (render) renderSuggestedReplies(candidate.bubble, candidate.suggestions);
    return candidate;
  }

  async function copyQwenText(text, button) {
    const value = String(text || '');
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    if (button instanceof HTMLButtonElement) {
      const previous = button.textContent;
      button.textContent = '已复制';
      setTimeout(() => { button.textContent = previous; }, 900);
    } else if (button instanceof HTMLElement) {
      button.classList.add('qwen-copy-success');
      button.dataset.copyFeedback = '已复制';
      setTimeout(() => {
        button.classList.remove('qwen-copy-success');
        delete button.dataset.copyFeedback;
      }, 900);
    }
  }

  function createCopyButton(getText, className = 'qwen-chat-copy-btn') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = '复制';
    button.title = '复制 Markdown 原文';
    button.addEventListener('click', () => void copyQwenText(getText?.(), button));
    return button;
  }

  function createOperationResultSize(text) {
    const bytes = new TextEncoder().encode(String(text || '')).byteLength;
    const size = document.createElement('span');
    size.className = 'qwen-chat-op-size file-size-emphasis';
    size.dataset.fileSizeBytes = String(bytes);
    size.textContent = global.formatSize(bytes);
    global.applyEmphasisStyle(size, global.buildFileSizeEmphasisStyle(bytes));
    return size;
  }

  function completeOperationCard(card) {
    if (!(card instanceof HTMLElement)) return;
    const name = card.querySelector(':scope > .qwen-chat-op-name');
    const result = card.querySelector(':scope > .qwen-chat-op-result');
    if (!(name instanceof HTMLElement) || !(result instanceof HTMLElement)) return;
    result.classList.remove('qwen-chat-op-result-loading');
    let actions = name.querySelector(':scope > .qwen-chat-op-actions');
    if (!(actions instanceof HTMLElement)) {
      actions = document.createElement('span');
      actions.className = 'qwen-chat-op-actions';
      name.appendChild(actions);
    }
    actions.replaceChildren(
      createOperationResultSize(result.textContent || ''),
      createCopyButton(() => result.textContent || '')
    );
  }

  function enhanceOperationResultControls(container) {
    if (!(container instanceof HTMLElement)) return;
    container.querySelectorAll('.qwen-chat-op').forEach((card) => {
      if (card.querySelector(':scope > .qwen-chat-op-result-loading')) return;
      completeOperationCard(card);
    });
  }

  function extractUserQuestion(content) {
    const source = String(content || '');
    const marker = '用户问题：';
    const index = source.lastIndexOf(marker);
    return index >= 0 ? source.slice(index + marker.length).trim() : source;
  }

  function normalizeFunctionId(value) {
    const raw = String(value || '');
    return raw.match(/call_[\w-]+$/)?.[0] || raw;
  }

  function historyFunctionResult(item) {
    const extra = item?.extra;
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return { found: false, value: undefined };
    if (Object.prototype.hasOwnProperty.call(extra, 'tool_result')) {
      return { found: true, value: extra.tool_result };
    }
    const ignored = new Set(['display_position', 'function_id', 'code_interpreter_info']);
    const entries = Object.entries(extra).filter(([key]) => !ignored.has(key));
    return entries.length
      ? { found: true, value: Object.fromEntries(entries) }
      : { found: false, value: undefined };
  }

  function renderAssistantHistoryMessage(message) {
    const list = Array.isArray(message?.content_list) ? message.content_list : [];
    if (!list.length) {
      const parsed = splitSuggestedReplies(String(message?.content || ''));
      const bubble = appendMessage('assistant', parsed.text || '（无回复）');
      return parsed.suggestions.length ? { bubble, suggestions: parsed.suggestions } : null;
    }

    let rendered = false;
    let answer = '';
    let suggestionCandidate = null;
    const flushAnswer = () => {
      if (!answer) return;
      const parsed = splitSuggestedReplies(answer);
      const bubble = appendMessage('assistant', parsed.text || '（无回复）');
      suggestionCandidate = parsed.suggestions.length ? { bubble, suggestions: parsed.suggestions } : null;
      answer = '';
      rendered = true;
    };

    for (const item of list) {
      const functionCall = item?.function_call;
      const isFunction = String(item?.role || '') === 'function'
        || (functionCall && typeof functionCall === 'object');
      if (isFunction) {
        flushAnswer();
        const call = {
          id: normalizeFunctionId(item?.function_id || item?.extra?.function_id),
          name: String(functionCall?.name || item?.name || item?.phase || 'function_call'),
          arguments: String(functionCall?.arguments || '')
        };
        const card = appendFunctionCallCard(call);
        const result = historyFunctionResult(item);
        if (result.found) finishFunctionCallCard(card, { result: result.value });
        suggestionCandidate = null;
        rendered = true;
      } else if (String(item?.phase || '') === 'answer' && item?.content) {
        answer += String(item.content);
      }
    }
    flushAnswer();
    if (!rendered) {
      const parsed = splitSuggestedReplies(String(message?.content || ''));
      const bubble = appendMessage('assistant', parsed.text || '（无回复）');
      suggestionCandidate = parsed.suggestions.length ? { bubble, suggestions: parsed.suggestions } : null;
    }
    return suggestionCandidate;
  }

  function extractResJson(text) {
    const match = /^```res: (sandbox|app|background)\n([\s\S]*?)```$/.exec(String(text || '').trim());
    return match ? String(match[2] || '').trim() : '';
  }

  function resBlocksFromText(text) {
    const blocks = [];
    const regex = /```res: (sandbox|app|background)\n([\s\S]*?)```/g;
    const source = String(text || '');
    let match;
    while ((match = regex.exec(source))) blocks.push(match[0]);
    return blocks;
  }

  function appendResCard(text) {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return;
    const card = document.createElement('div');
    card.className = 'qwen-chat-op';
    const name = document.createElement('div');
    name.className = 'qwen-chat-op-name';
    const nameText = document.createElement('span');
    nameText.textContent = '操作结果';
    const content = document.createElement('div');
    content.className = 'qwen-chat-op-result';
    content.textContent = extractResJson(text);
    name.appendChild(nameText);
    card.append(name, content);
    completeOperationCard(card);
    messages.appendChild(card);
    maybeAutoScrollMessages(messages);
  }

  function renderHistory(messages) {
    const messagesEl = el(MESSAGES_ID);
    if (!(messagesEl instanceof HTMLElement)) return;
    messagesEl.replaceChildren();
    const list = Array.isArray(messages) ? messages : [];
    let lastAssistantResponseId = '';
    let suggestionCandidate = null;
    for (const message of list) {
      const role = String(message?.role || '');
      if (role === 'user') {
        suggestionCandidate = null;
        const content = String(message?.content || '');
        if (content.includes('你是「BJTU 课程助手」的智能代理')) continue;
        const blocks = resBlocksFromText(content);
        if (blocks.length) {
          for (const block of blocks) appendResCard(block);
        } else {
          appendMessage('user', extractUserQuestion(content), String(message?.parentId || message?.parent_id || lastAssistantResponseId));
        }
      } else if (role === 'assistant') {
        suggestionCandidate = renderAssistantHistoryMessage(message);
        lastAssistantResponseId = String(message?.response_id || message?.id || lastAssistantResponseId);
      }
    }
    if (suggestionCandidate) {
      renderSuggestedReplies(suggestionCandidate.bubble, suggestionCandidate.suggestions);
    }
    sessionParentId = lastAssistantResponseId;
    scrollMessagesToBottom(messagesEl, { force: true });
  }

  // 历史记录渲染完成后滚动到最后一条消息（Markdown 可能异步渲染，多拍几次确保到位）
  function getMessagesScrollContainer(container) {
    const scroller = el(MESSAGES_SCROLL_ID);
    if (scroller instanceof HTMLElement) return scroller;
    return container instanceof HTMLElement ? container : null;
  }

  function isMessagesAtBottom(container) {
    container = getMessagesScrollContainer(container);
    return container instanceof HTMLElement
      && container.scrollHeight - container.scrollTop - container.clientHeight <= 3;
  }

  function updateScrollBottomButton(container) {
    container = getMessagesScrollContainer(container);
    const button = el(SCROLL_BOTTOM_ID);
    if (button instanceof HTMLButtonElement) button.hidden = autoScrollEnabled || isMessagesAtBottom(container);
  }

  function scrollMessagesToBottom(container, { force = false, settle = true } = {}) {
    container = getMessagesScrollContainer(container);
    if (!(container instanceof HTMLElement)) return;
    if (!force && !autoScrollEnabled) {
      updateScrollBottomButton(container);
      return;
    }
    if (force) autoScrollEnabled = true;
    const scroll = () => {
      if (!autoScrollEnabled) return;
      container.scrollTop = container.scrollHeight;
      lastMessagesScrollTop = container.scrollTop;
      updateScrollBottomButton(container);
    };
    scroll();
    if (settle) {
      requestAnimationFrame(scroll);
      setTimeout(scroll, 60);
      setTimeout(scroll, 180);
    }
  }

  function maybeAutoScrollMessages(container) {
    scrollMessagesToBottom(container, { settle: false });
  }

  const HISTORY_LOADING_ID = 'qwen-chat-history-loading';

  async function loadHistoryOnce() {
    if (!sessionChatId) return;
    const loadingEl = el(HISTORY_LOADING_ID);
    if (loadingEl instanceof HTMLElement) loadingEl.hidden = false;
    try {
      const response = await send('QWEN_GET_CHAT_HISTORY', { chatId: sessionChatId });
      if (response?.ok && Array.isArray(response.messages)) {
        historyNeedsInitialScroll = true;
        renderHistory(response.messages);
      } else if (response?.code === 'CHAT_NOT_FOUND') {
        // 原会话已被用户删除：清空会话并重新触发开场，
        // 由 maybeSendOpening/sendOpening 自动新建会话并发送系统提示词。
        sessionChatId = '';
        sessionParentId = '';
        nextReplyFresh = false;
        pendingEditParentId = '';
        pendingEdit = false;
        openingStarted = false;
        openingCompleted = false;
        void chrome.storage.local.remove(['qwenLastChatId', 'qwenOpeningPendingChatId']).catch(() => { });
      }
    } finally {
      if (loadingEl instanceof HTMLElement) loadingEl.hidden = true;
      const messagesEl = el(MESSAGES_ID);
      scrollMessagesToBottom(messagesEl, { force: true });
      if (messagesEl instanceof HTMLElement && messagesEl.clientHeight > 0) historyNeedsInitialScroll = false;
    }
  }

  function loadHistory() {
    if (!sessionChatId) return Promise.resolve();
    if (historyLoadPromise) return historyLoadPromise;
    historyLoadPromise = loadHistoryOnce().finally(() => {
      historyLoadPromise = null;
    });
    return historyLoadPromise;
  }

  function restoreHistoryAfterLogin() {
    if (!chatStateLoaded || !historyReloadAfterLogin) return Promise.resolve();
    historyReloadAfterLogin = false;
    return (sessionChatId ? loadHistory() : Promise.resolve()).finally(() => {
      maybeSendOpening();
    });
  }

  function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome?.runtime?.lastError;
        resolve(error ? { ok: false, message: String(error.message || '通信失败') } : (response || {}));
      });
    });
  }

  const JS_SANDBOX_CHANNEL = 'bjtu-qwen-js-sandbox';
  let jsSandboxFramePromise = null;

  function ensureJsSandboxFrame() {
    if (jsSandboxFramePromise) return jsSandboxFramePromise;
    jsSandboxFramePromise = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.setAttribute('aria-hidden', 'true');
      frame.src = chrome.runtime.getURL('core/sandbox/js-executor.html');
      const timer = setTimeout(() => {
        frame.remove();
        jsSandboxFramePromise = null;
        reject(new Error('JavaScript 沙箱加载超时'));
      }, 10000);
      frame.addEventListener('load', () => {
        clearTimeout(timer);
        resolve(frame);
      }, { once: true });
      frame.addEventListener('error', () => {
        clearTimeout(timer);
        frame.remove();
        jsSandboxFramePromise = null;
        reject(new Error('JavaScript 沙箱加载失败'));
      }, { once: true });
      document.body.appendChild(frame);
    });
    return jsSandboxFramePromise;
  }

  function jsBridgePathParts(path) {
    const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('桥接路径为空');
    if (['window', 'globalThis', 'self'].includes(parts[0])) parts.shift();
    if (!parts.length) throw new Error('不能直接访问整个页面全局对象');
    return parts;
  }

  function resolveJsBridgePath(root, path) {
    const parts = jsBridgePathParts(path);
    let owner = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      owner = owner?.[parts[i]];
      if (owner == null) throw new Error(`桥接路径不存在：${parts.slice(0, i + 1).join('.')}`);
    }
    const key = parts.at(-1);
    return { owner, key, value: owner?.[key] };
  }

  function jsBridgeSerializable(value, seen = new WeakSet(), depth = 0) {
    if (value === undefined) return { __type: 'undefined' };
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value === 'symbol') return String(value);
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || '' };
    if (value instanceof Element) {
      return {
        tagName: value.tagName.toLowerCase(),
        id: value.id || '',
        className: typeof value.className === 'string' ? value.className : '',
        textContent: String(value.textContent || '').slice(0, 10000),
        attributes: Object.fromEntries(Array.from(value.attributes || []).map((item) => [item.name, item.value]))
      };
    }
    if (depth > 8) return '[深度受限]';
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => jsBridgeSerializable(item, seen, depth + 1));
    const output = {};
    for (const key of Object.keys(value)) {
      try { output[key] = jsBridgeSerializable(value[key], seen, depth + 1); } catch (error) {
        output[key] = `[读取失败：${String(error?.message || error)}]`;
      }
    }
    return output;
  }

  function requireJsBridgeElement(selector) {
    const element = document.querySelector(String(selector || ''));
    if (!(element instanceof Element)) throw new Error(`未找到元素：${String(selector || '')}`);
    return element;
  }

  async function handleAppJsBridge(action, payload) {
    if (action === 'roots') {
      return [...new Set([
        'document',
        ...Object.getOwnPropertyNames(global)
      ].filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(name))))];
    }
    if (action === 'dom.query') return jsBridgeSerializable(document.querySelector(String(payload?.selector || '')));
    if (action === 'dom.queryAll') {
      return jsBridgeSerializable(Array.from(document.querySelectorAll(String(payload?.selector || ''))));
    }
    if (action.startsWith('dom.')) {
      const element = requireJsBridgeElement(payload?.selector);
      if (action === 'dom.get') return jsBridgeSerializable(resolveJsBridgePath(element, payload?.property).value);
      if (action === 'dom.set') {
        const target = resolveJsBridgePath(element, payload?.property);
        target.owner[target.key] = payload?.value;
        return true;
      }
      if (action === 'dom.call') {
        const target = resolveJsBridgePath(element, payload?.method);
        if (typeof target.value !== 'function') throw new Error(`DOM 方法不存在：${String(payload?.method || '')}`);
        return jsBridgeSerializable(await target.value.apply(target.owner, Array.isArray(payload?.args) ? payload.args : []));
      }
    }
    const target = resolveJsBridgePath(global, payload?.path);
    if (action === 'get') return jsBridgeSerializable(target.value);
    if (action === 'set') {
      target.owner[target.key] = payload?.value;
      return true;
    }
    if (action === 'call') {
      if (typeof target.value !== 'function') throw new Error(`页面方法不存在：${String(payload?.path || '')}`);
      return jsBridgeSerializable(await target.value.apply(target.owner, Array.isArray(payload?.args) ? payload.args : []));
    }
    throw new Error(`未知 app 桥接操作：${String(action || '')}`);
  }

  async function handleJsBridge(mode, action, payload) {
    if (mode === 'app') return handleAppJsBridge(action, payload);
    if (mode === 'background') {
      const response = await send('QWEN_JS_BACKGROUND_BRIDGE', { action, payload });
      if (!response?.ok) throw new Error(String(response?.message || '后台桥接调用失败'));
      return response.value;
    }
    throw new Error('sandbox 模式不能调用上下文桥接');
  }

  async function executeJsInSandbox(code, mode = 'sandbox') {
    const frame = await ensureJsSandboxFrame();
    const id = `js-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const normalizedMode = ['sandbox', 'app', 'background'].includes(String(mode)) ? String(mode) : 'sandbox';
    let bindingRoots = [];
    if (normalizedMode === 'app') {
      bindingRoots = await handleAppJsBridge('roots', {});
    } else if (normalizedMode === 'background') {
      const response = await send('QWEN_JS_BACKGROUND_BRIDGE', { action: 'roots', payload: {} });
      if (!response?.ok) throw new Error(String(response?.message || '无法读取后台可用命名空间'));
      bindingRoots = Array.isArray(response.value) ? response.value : [];
    }
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = event?.data;
        if (event.source !== frame.contentWindow || data?.channel !== JS_SANDBOX_CHANNEL) return;
        if (data?.type === 'bridge-call' && String(data.executionId || '') === id) {
          void handleJsBridge(mode, String(data.action || ''), data.payload).then((result) => {
            frame.contentWindow?.postMessage({
              channel: JS_SANDBOX_CHANNEL,
              type: 'bridge-result',
              requestId: String(data.requestId || ''),
              ok: true,
              result: jsBridgeSerializable(result)
            }, '*');
          }).catch((error) => {
            frame.contentWindow?.postMessage({
              channel: JS_SANDBOX_CHANNEL,
              type: 'bridge-result',
              requestId: String(data.requestId || ''),
              ok: false,
              error: String(error?.message || error)
            }, '*');
          });
          return;
        }
        if (data?.type !== 'result' || String(data.id || '') !== id) return;
        global.removeEventListener('message', onMessage);
        if (data.ok === true) resolve(data.result);
        else reject(new Error(String(data.error || 'JavaScript 执行失败')));
      };
      global.addEventListener('message', onMessage);
      frame.contentWindow?.postMessage({
        channel: JS_SANDBOX_CHANNEL,
        type: 'execute',
        id,
        code: String(code || ''),
        mode: normalizedMode,
        bindingRoots
      }, '*');
    });
  }

  function setStatus(text, state = '') {
    const statusEl = el(STATUS_ID);
    if (statusEl instanceof HTMLElement) {
      statusEl.textContent = text;
      statusEl.className = `qwen-chat-status ${state}`;
    }
  }

  function initOperationsPopover() {
    const wrap = document.querySelector('.qwen-chat-ops-toggle-wrap');
    const popover = el('qwen-chat-ops-popover');
    if (!(wrap instanceof HTMLElement) || !(popover instanceof HTMLElement)) return;
    const toggle = el('qwen-chat-ops-toggle');
    if (popover.parentElement !== document.body) {
      document.body.appendChild(popover);
    }
    let closeTimer = null;
    const clearCloseTimer = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };
    const positionPopover = () => {
      if (popover.hidden) return;
      const btnRect = toggle.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      popover.style.visibility = 'hidden';
      popover.style.top = 'auto';
      popover.style.left = 'auto';
      popover.style.right = '0px';
      popover.style.bottom = '0px';
      const pw = popover.offsetWidth || 300;
      const ph = popover.offsetHeight || 0;
      const right = pw > vw ? 0 : Math.max(0, vw - btnRect.right);
      popover.style.right = `${right}px`;
      if (ph <= btnRect.top) {
        popover.style.bottom = `${vh - btnRect.top}px`;
        popover.style.top = 'auto';
      } else {
        popover.style.top = `${btnRect.bottom}px`;
        popover.style.bottom = 'auto';
      }
      popover.style.visibility = '';
    };
    const open = () => {
      clearCloseTimer();
      popover.hidden = false;
      positionPopover();
      void global.BjtuQwenOperationsUi.refresh({ showLoading: true }).then(() => {
        positionPopover();
      });
    };
    const close = () => {
      clearCloseTimer();
      popover.hidden = true;
    };
    const scheduleClose = () => {
      clearCloseTimer();
      closeTimer = setTimeout(close, 140);
    };
    wrap.addEventListener('mouseenter', open);
    wrap.addEventListener('mouseleave', scheduleClose);
    popover.addEventListener('mouseenter', clearCloseTimer);
    popover.addEventListener('mouseleave', scheduleClose);
    if (toggle instanceof HTMLButtonElement) {
      toggle.addEventListener('click', () => {
        if (popover.hidden) open();
        else close();
      });
    }
    window.addEventListener('resize', () => positionPopover());
  }

  function setBusy(value) {
    busy = value === true;
    const sendBtn = el(SEND_ID);
    const input = el(INPUT_ID);
    const stopBtn = el(STOP_ID);
    if (sendBtn instanceof HTMLButtonElement) sendBtn.hidden = busy;
    if (stopBtn instanceof HTMLButtonElement) stopBtn.hidden = !busy;
    const messages = el(MESSAGES_ID);
    if (messages instanceof HTMLElement) {
      messages.classList.toggle('qwen-chat-generating', busy);
      messages.querySelectorAll('.qwen-chat-suggestion-btn').forEach((button) => {
        if (button instanceof HTMLButtonElement) button.disabled = busy;
      });
    }
  }

  function appendMessage(role, text, parentId) {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return;
    const str = String(text || '');
    let bubble;
    let anchor;
    if (role === 'user') {
      const row = document.createElement('div');
      row.className = 'qwen-chat-msg-row user';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'qwen-chat-edit-btn';
      editBtn.textContent = '编辑';
      editBtn.title = '编辑此消息（发送时将以此消息为基准续接）';
      editBtn.addEventListener('click', () => {
        pendingEditParentId = String(parentId || '');
        pendingEdit = true;
        const container = row.parentElement;
        if (container instanceof HTMLElement) {
          while (row.nextSibling) row.nextSibling.remove();
          row.remove();
        }
        const input = el(INPUT_ID);
        if (input instanceof HTMLTextAreaElement) {
          input.value = str;
          const panel = el(PANEL_ID);
          if (panel instanceof HTMLElement) panel.hidden = false;
          const fab = el(FAB_ID);
          if (fab instanceof HTMLElement) fab.style.display = 'none';
          input.focus();
        }
      });
      row.appendChild(editBtn);
      bubble = document.createElement('div');
      bubble.className = 'qwen-chat-msg user';
      row.appendChild(bubble);
      anchor = row;
    } else if (role === 'assistant') {
      const row = document.createElement('div');
      row.className = 'qwen-chat-msg-row assistant';
      bubble = document.createElement('div');
      bubble.className = 'qwen-chat-msg assistant';
      row.append(bubble, createCopyButton(() => mdRawText(bubble), 'qwen-chat-copy-btn qwen-chat-assistant-copy-btn'));
      anchor = row;
    } else {
      bubble = document.createElement('div');
      bubble.className = `qwen-chat-msg ${role}`;
      anchor = bubble;
    }
    if (role === 'error') {
      bubble.textContent = str;
    } else {
      const container = mdContainer(bubble);
      container._mdText = str;
      container.innerHTML = renderQwenMarkdown(str);
      enhanceOperationResultControls(container);
    }
    messages.appendChild(anchor);
    maybeAutoScrollMessages(messages);
    return bubble;
  }

  function removeMessageBubble(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    const row = bubble.closest('.qwen-chat-msg-row.assistant');
    if (row instanceof HTMLElement) row.remove();
    else bubble.remove();
  }

  function messageDisplayNode(bubble) {
    if (!(bubble instanceof HTMLElement)) return null;
    return bubble.closest('.qwen-chat-msg-row') || bubble;
  }

  function placeMessageAfter(bubble, anchor) {
    const node = messageDisplayNode(bubble);
    if (!(node instanceof HTMLElement) || !(anchor instanceof HTMLElement)
      || !anchor.isConnected || node === anchor) return node;
    anchor.after(node);
    return node;
  }

  function latestRetryDisplayAnchor() {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return null;
    const candidates = messages.querySelectorAll('.qwen-chat-msg-row.user, .qwen-chat-op, .qwen-chat-msg-row.assistant');
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  function cursorHost(bubble) {
    if (!(bubble instanceof HTMLElement)) return bubble;
    const md = bubble.querySelector(':scope > .qwen-chat-md');
    const container = md instanceof HTMLElement ? md : bubble;
    let host = container;
    const last = container.lastElementChild;
    if (last instanceof HTMLElement) {
      if (last.matches('ul, ol, table')) {
        host = last.lastElementChild instanceof HTMLElement ? last.lastElementChild : last;
      } else {
        host = last;
      }
      // 围栏代码块的光标应留在 <code> 内；行内代码后的光标必须成为
      // 段落的下一个节点，否则看起来会停在 `code` 的底色内部。
      if (host.matches('.qwen-md-codeblock-wrap')) {
        const code = host.querySelector(':scope > .qwen-md-codeblock > code');
        if (code instanceof HTMLElement) host = code;
      } else if (host.matches('pre')) {
        const code = host.querySelector(':scope > code');
        if (code instanceof HTMLElement) host = code;
      }
    }
    return host;
  }

  function ensureCursor(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    const host = cursorHost(bubble);
    if (!host.querySelector(':scope > .qwen-chat-cursor')) {
      const cursor = document.createElement('span');
      cursor.className = 'qwen-chat-cursor';
      let insertionPoint = null;
      let tail = host.lastChild;
      while (tail) {
        if (tail instanceof HTMLBRElement) {
          insertionPoint = tail;
          tail = tail.previousSibling;
          continue;
        }
        if (tail.nodeType === Node.TEXT_NODE) {
          const trailingNewlines = /[\r\n]+$/.exec(tail.data || '');
          if (!trailingNewlines) break;
          const splitAt = trailingNewlines.index;
          if (splitAt > 0) {
            insertionPoint = tail.splitText(splitAt);
            break;
          }
          insertionPoint = tail;
          tail = tail.previousSibling;
          continue;
        }
        break;
      }
      if (insertionPoint) host.insertBefore(cursor, insertionPoint);
      else host.appendChild(cursor);
    }
  }

  function removeCursor(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    bubble.querySelectorAll('.qwen-chat-cursor').forEach((node) => node.remove());
    const messages = el(MESSAGES_ID);
    if (messages instanceof HTMLElement) {
      messages.querySelectorAll(':scope > .qwen-chat-suggestions').forEach((container) => {
        if (container._qwenSuggestionBubble === bubble) {
          container.querySelectorAll('.qwen-chat-cursor').forEach((node) => node.remove());
        }
      });
    }
  }

  function placeSuggestionCursor(bubble) {
    const parsed = splitSuggestedReplies(mdRawText(bubble), { allowIncomplete: true });
    if (!parsed.found) return false;
    const container = renderSuggestedReplies(bubble, parsed.suggestions);
    if (!(container instanceof HTMLElement)) return false;
    const cursor = document.createElement('span');
    cursor.className = 'qwen-chat-cursor';
    if (parsed.cursorPlacement === 'button') {
      const buttons = container.querySelectorAll(':scope > .qwen-chat-suggestion-btn');
      const button = buttons.length ? buttons[buttons.length - 1] : null;
      if (button instanceof HTMLButtonElement) {
        button.appendChild(cursor);
        return true;
      }
    }
    container.appendChild(cursor);
    return true;
  }

  function collapseThinking(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    const details = bubble.querySelector(':scope > .qwen-chat-thinking');
    if (details instanceof HTMLDetailsElement) details.open = false;
  }

  function placeCursor(bubble, inThinkingFlag) {
    if (!(bubble instanceof HTMLElement)) return;
    removeCursor(bubble);
    if (inThinkingFlag) {
      const details = bubble.querySelector(':scope > .qwen-chat-thinking');
      const body = details instanceof HTMLElement ? details.querySelector('.qwen-chat-thinking-body') : null;
      if (body instanceof HTMLElement) {
        ensureCursor(body);
      } else {
        ensureCursor(bubble);
      }
    } else {
      if (!placeSuggestionCursor(bubble)) ensureCursor(bubble);
    }
  }

  function appendOperationCard(operation) {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return;
    const card = document.createElement('div');
    card.className = 'qwen-chat-op';
    const name = document.createElement('div');
    name.className = 'qwen-chat-op-name';
    const nameText = document.createElement('span');
    nameText.textContent = '操作结果';
    name.appendChild(nameText);
    const content = document.createElement('div');
    content.className = 'qwen-chat-op-result qwen-chat-op-result-loading';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const loadingText = document.createElement('span');
    loadingText.textContent = '执行中…';
    content.append(spinner, loadingText);
    card.append(name, content);
    messages.appendChild(card);
    maybeAutoScrollMessages(messages);
    return card;
  }

  function appendFunctionCallCard(call) {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return null;
    const card = document.createElement('div');
    card.className = 'qwen-chat-op qwen-chat-function-call';
    card.dataset.functionId = String(call?.id || '');
    const name = document.createElement('div');
    name.className = 'qwen-chat-op-name';
    const nameText = document.createElement('span');
    nameText.textContent = String(call?.name || 'function_call');
    name.appendChild(nameText);
    const content = document.createElement('div');
    content.className = 'qwen-chat-op-result qwen-chat-function-body';
    const argumentsEl = document.createElement('div');
    argumentsEl.className = 'qwen-chat-function-arguments';
    argumentsEl.textContent = String(call?.arguments || '');
    content.appendChild(argumentsEl);
    card.append(name, content);
    messages.appendChild(card);
    maybeAutoScrollMessages(messages);
    return card;
  }

  function updateFunctionCallCard(card, call) {
    if (!(card instanceof HTMLElement)) return;
    const nameText = card.querySelector(':scope > .qwen-chat-op-name > span:first-child');
    if (nameText instanceof HTMLElement && call?.name) nameText.textContent = String(call.name);
    const argumentsEl = card.querySelector(':scope > .qwen-chat-function-body > .qwen-chat-function-arguments');
    if (argumentsEl instanceof HTMLElement) argumentsEl.textContent = String(call?.arguments || '');
    maybeAutoScrollMessages(el(MESSAGES_ID));
  }

  function toolResultText(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  function toolResultImageUrls(value, output = [], seen = new WeakSet()) {
    if (!value || typeof value !== 'object') return output;
    if (seen.has(value)) return output;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => toolResultImageUrls(item, output, seen));
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      if (['image', 'image_url'].includes(String(key).toLowerCase()) && typeof child === 'string') {
        const url = safeUrlQwen(child, new Set(['https:']));
        if (url && !output.includes(url)) output.push(url);
      } else {
        toolResultImageUrls(child, output, seen);
      }
    }
    return output;
  }

  function renderFunctionToolResult(container, value) {
    container.replaceChildren();
    const text = document.createElement('div');
    text.className = 'qwen-chat-function-result-text';
    text.textContent = toolResultText(value);
    container.appendChild(text);
    const imageUrls = toolResultImageUrls(value);
    if (imageUrls.length) {
      const previews = document.createElement('div');
      previews.className = 'qwen-chat-function-images';
      for (const url of imageUrls) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const image = document.createElement('img');
        image.src = url;
        image.alt = '工具生成的图片';
        image.loading = 'lazy';
        link.appendChild(image);
        previews.appendChild(link);
      }
      container.appendChild(previews);
    }
  }

  function finishFunctionCallCard(card, functionResult) {
    if (!(card instanceof HTMLElement)) return;
    const body = card.querySelector(':scope > .qwen-chat-function-body');
    if (!(body instanceof HTMLElement)) return;
    body.querySelector(':scope > .qwen-chat-function-divider')?.remove();
    body.querySelector(':scope > .qwen-chat-function-result')?.remove();
    const divider = document.createElement('hr');
    divider.className = 'qwen-chat-function-divider';
    const result = document.createElement('div');
    result.className = 'qwen-chat-function-result';
    renderFunctionToolResult(result, functionResult?.result);
    body.append(divider, result);
    completeOperationCard(card);
    maybeAutoScrollMessages(el(MESSAGES_ID));
  }

  function formatResult(value, depth = 0) {
    if (value === null || value === undefined) return 'null';
    const type = typeof value;
    if (type === 'string') {
      const text = String(value);
      if (depth === 0) return text;
      return /[\r\n]/.test(text) ? `"""${text}"""` : `"${text}"`;
    }
    if (type === 'number' || type === 'boolean') return String(value);
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      const items = value.map((item) => `${childIndent}${formatResult(item, depth + 1)}`);
      return `[\n${items.join(',\n')}\n${indent}]`;
    }
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    const entries = keys.map((key) => {
      const keyText = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? key
        : formatResult(key, depth + 1);
      return `${childIndent}${keyText}: ${formatResult(value[key], depth + 1)}`;
    });
    return `{\n${entries.join(',\n')}\n${indent}}`;
  }

  function formatOutcomeText(outcome) {
    if (outcome && typeof outcome === 'object' && typeof outcome.ok === 'boolean') {
      if (outcome.ok) return formatResult(outcome.result);
      const parts = [];
      if (outcome.code) parts.push(`错误代码：${outcome.code}`);
      parts.push(String(outcome.error || '操作失败'));
      return parts.join('\n');
    }
    return formatResult(outcome);
  }

  function updateOperationResult(card, result) {
    if (!(card instanceof HTMLElement)) return;
    const existing = card.querySelector(':scope > .qwen-chat-op-result');
    if (existing instanceof HTMLElement) existing.remove();
    const content = document.createElement('div');
    content.className = 'qwen-chat-op-result';
    content.textContent = formatOutcomeText(result);
    card.appendChild(content);
    completeOperationCard(card);
    const messages = el(MESSAGES_ID);
    maybeAutoScrollMessages(messages);
  }

  function showLoginHint(show) {
    const hint = el(LOGIN_HINT_ID);
    if (hint instanceof HTMLElement) hint.hidden = !show;
  }

  async function refreshModels() {
    const select = el(MODEL_ID);
    if (!(select instanceof HTMLSelectElement)) return;
    const status = await send('QWEN_GET_STATUS', { ensureLogin: false });
    const response = await send('QWEN_LIST_MODELS');
    select.replaceChildren();
    if (response?.ok && Array.isArray(response.models) && response.models.length) {
      for (const model of response.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        select.appendChild(option);
      }
      const current = String(status?.modelId || '') || String(response.models[0]?.id || '');
      if (current) select.value = current;
      select.disabled = false;
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = response?.ok ? '无可用模型' : '模型加载失败';
      select.appendChild(option);
      select.disabled = true;
    }
  }

  async function refreshStatus({ openLoginIfNeeded = false, allowOpening = true } = {}) {
    const status = await send('QWEN_GET_STATUS', { ensureLogin: false });
    lastKnownLoggedIn = status?.loggedIn === true;
    lastKnownEnabled = status?.enabled !== false;
    if (status?.loggedIn) {
      setStatus('已登录', 'ok');
      showLoginHint(false);
    } else {
      setStatus('未登录', 'error');
      showLoginHint(true);
      const panel = el(PANEL_ID);
      if (openLoginIfNeeded && panel instanceof HTMLElement && !panel.hidden) {
        void send('QWEN_OPEN_LOGIN', { auth: true });
      }
    }
    const thinking = el(THINKING_ID);
    if (thinking instanceof HTMLInputElement) thinking.checked = status?.thinkingEnabled === true;
    if (allowOpening) maybeSendOpening();
    return status;
  }

  function ensureAssistantBubble() {
    const messages = el(MESSAGES_ID);
    if (!activeBubble && messages instanceof HTMLElement) {
      activeBubble = appendMessage('assistant', '');
    }
    return activeBubble;
  }

  function appendAssistantText(bubble, text) {
    if (!text) return;
    const container = mdContainer(bubble);
    container._mdText = String(container._mdText || '') + String(text);
    const parsed = splitSuggestedReplies(container._mdText, { allowIncomplete: true });
    container.innerHTML = renderQwenMarkdown(parsed.text);
    enhanceOperationResultControls(container);
    if (parsed.found) renderSuggestedReplies(bubble, parsed.suggestions);
  }

  function ensureThinkingBlock(bubble) {
    let details = bubble.querySelector(':scope > .qwen-chat-thinking');
    if (!(details instanceof HTMLElement)) {
      details = document.createElement('details');
      details.className = 'qwen-chat-thinking';
      const summary = document.createElement('summary');
      summary.textContent = '思考过程';
      const body = document.createElement('div');
      body.className = 'qwen-chat-thinking-body';
      details.append(summary, body);
    }
    if (bubble.firstElementChild !== details) bubble.prepend(details);
    return details.querySelector('.qwen-chat-thinking-body');
  }

  let pendingAskId = null;
  let pendingAskMode = '';

  function updateAskContinueLabel() {
    const count = el('qwen-chat-ask-count');
    const button = el('qwen-chat-ask-continue');
    if (button instanceof HTMLButtonElement) {
      if (pendingAskMode === 'operation-permission') {
        button.textContent = '允许一次';
        return;
      }
      const value = count instanceof HTMLInputElement ? parseInt(count.value, 10) : 0;
      button.textContent = `继续 ${value > 0 ? value : 1} 次`;
    }
  }

  function showAsk(message) {
    pendingAskId = String(message?.id || '');
    pendingAskMode = String(message?.mode || '');
    const container = el('qwen-chat-ask');
    const text = el('qwen-chat-ask-text');
    const count = el('qwen-chat-ask-count');
    const always = el('qwen-chat-ask-always');
    const sessionAlways = el('qwen-chat-ask-session');
    const operationsAlways = el('qwen-chat-ask-operations');
    const stop = el('qwen-chat-ask-stop');
    if (container instanceof HTMLElement) {
      if (text instanceof HTMLElement) text.textContent = message?.message || '操作调用次数过多，是否继续？';
      const value = Number(message?.count) > 0 ? Number(message.count) : 3;
      if (count instanceof HTMLInputElement) {
        count.value = String(value);
        count.hidden = pendingAskMode === 'operation-permission';
      }
      const executionMode = ['app', 'background'].includes(String(message?.executionMode || ''))
        ? String(message.executionMode)
        : 'app';
      const operationNames = Array.isArray(message?.operationNames) ? message.operationNames.map(String).filter(Boolean) : [];
      if (always instanceof HTMLButtonElement) {
        always.textContent = pendingAskMode === 'operation-permission'
          ? `在此轮对话中始终允许 ${executionMode} 所有操作`
          : '始终允许';
      }
      if (sessionAlways instanceof HTMLButtonElement) {
        sessionAlways.hidden = pendingAskMode !== 'operation-permission';
        sessionAlways.textContent = `在本次会话中始终允许 ${executionMode} 所有操作`;
      }
      if (operationsAlways instanceof HTMLButtonElement) {
        operationsAlways.hidden = pendingAskMode !== 'operation-permission' || operationNames.length === 0;
        operationsAlways.textContent = operationNames.length
          ? `在所有会话中始终允许 ${operationNames.map((name) => `\`${name}\``).join(' ')}`
          : '在所有会话中始终允许操作';
      }
      if (stop instanceof HTMLButtonElement) stop.textContent = pendingAskMode === 'operation-permission' ? '拒绝' : '结束本次';
      updateAskContinueLabel();
      container.hidden = false;
    }
  }

  function hideAsk() {
    const container = el('qwen-chat-ask');
    if (container instanceof HTMLElement) container.hidden = true;
    pendingAskId = null;
    pendingAskMode = '';
  }

  function resolveAsk(action) {
    const container = el('qwen-chat-ask');
    if (container instanceof HTMLElement) container.hidden = true;
    if (!pendingAskId) return;
    const id = pendingAskId;
    pendingAskId = null;
    pendingAskMode = '';
    const countEl = el('qwen-chat-ask-count');
    const count = countEl instanceof HTMLInputElement ? parseInt(countEl.value, 10) : 0;
    try {
      port?.postMessage({ type: 'askResponse', id, action, count: count > 0 ? count : 1 });
    } catch {
      // 端口可能已断开
    }
  }

  function startStream({ text, editParent = '', isEditSend = false, showUserBubble = true }) {
    clearSuggestedReplies();
    const wasOpeningStream = openingStarted;
    const requestParentId = wasOpeningStream ? '' : (editParent || sessionParentId);
    lastSendText = text;
    let retryVisibleAnchor = null;
    if (showUserBubble) {
      const userBubble = appendMessage('user', text, editParent || sessionParentId);
      retryVisibleAnchor = messageDisplayNode(userBubble);
      const input = el(INPUT_ID);
      if (input instanceof HTMLTextAreaElement) input.value = '';
    } else {
      retryVisibleAnchor = latestRetryDisplayAnchor();
    }
    hideAsk();
    setBusy(true);
    setStatus('思考中…');
    inThinking = false;
    activeBubble = ensureAssistantBubble();
    placeCursor(activeBubble, false);
    scrollMessagesToBottom(el(MESSAGES_ID), { force: true });
    const lastOperationCard = { card: null };
    const functionCallCards = new Map();
    let retryPrompt = null;
    let streamStartAnchor = retryVisibleAnchor;

    const resetCurrentStreamRendering = () => {
      const messages = el(MESSAGES_ID);
      if (!(messages instanceof HTMLElement)) return;
      let node = streamStartAnchor instanceof HTMLElement && streamStartAnchor.isConnected
        ? streamStartAnchor.nextSibling
        : messages.firstChild;
      while (node) {
        const next = node.nextSibling;
        node.remove();
        node = next;
      }
      functionCallCards.clear();
      if (lastOperationCard.card instanceof HTMLElement && !lastOperationCard.card.isConnected) {
        lastOperationCard.card = null;
      }
      activeBubble = null;
      inThinking = false;
      const fresh = ensureAssistantBubble();
      placeCursor(fresh, false);
      setStatus('思考中…');
      maybeAutoScrollMessages(messages);
    };

    const closeActiveAnswerAtToolCall = () => {
      clearSuggestedReplies();
      if (inThinking) {
        collapseThinking(activeBubble);
        inThinking = false;
      }
      removeCursor(activeBubble);
      if (activeBubble instanceof HTMLElement
        && !mdRawText(activeBubble)
        && !activeBubble.querySelector(':scope > .qwen-chat-thinking')) {
        removeMessageBubble(activeBubble);
      }
      activeBubble = null;
    };

    const connectPort = () => {
      const chatPort = chrome.runtime.connect({ name: 'bjtu-qwen-chat' });
      port = chatPort;
      chatPort.onMessage.addListener((message) => {
        if (message?.type === 'streamRestart') {
          resetCurrentStreamRendering();
        } else if (message?.type === 'delta') {
          setStatus('回复中…');
          const bubble = ensureAssistantBubble();
          if (bubble) appendAssistantText(bubble, message.text);
          if (inThinking) {
            collapseThinking(bubble);
            inThinking = false;
          }
          placeCursor(bubble, false);
          const messages = el(MESSAGES_ID);
          maybeAutoScrollMessages(messages);
        } else if (message?.type === 'thinking') {
          setStatus('思考中…');
          const bubble = ensureAssistantBubble();
          if (bubble) {
            const existingDetails = bubble.querySelector(':scope > .qwen-chat-thinking');
            const body = ensureThinkingBlock(bubble);
            if (body) appendAssistantText(body, message.text);
            const details = bubble.querySelector(':scope > .qwen-chat-thinking');
            if (!(existingDetails instanceof HTMLDetailsElement) && details instanceof HTMLDetailsElement) details.open = true;
            inThinking = true;
            placeCursor(bubble, true);
            if (body instanceof HTMLElement) body.scrollTop = body.scrollHeight;
            const messages = el(MESSAGES_ID);
            maybeAutoScrollMessages(messages);
          }
        } else if (message?.type === 'functionCall') {
          setStatus('操作中…');
          const call = message.functionCall || {};
          const key = String(call.id || call.name || 'function_call');
          let card = functionCallCards.get(key);
          if (!(card instanceof HTMLElement) || !card.isConnected) {
            closeActiveAnswerAtToolCall();
            card = appendFunctionCallCard(call);
            if (card instanceof HTMLElement) functionCallCards.set(key, card);
          } else {
            updateFunctionCallCard(card, call);
          }
        } else if (message?.type === 'functionResult') {
          setStatus('操作中…');
          const result = message.functionResult || {};
          const key = String(result.id || result.name || 'function_call');
          let card = functionCallCards.get(key);
          if (!(card instanceof HTMLElement) || !card.isConnected) {
            closeActiveAnswerAtToolCall();
            card = appendFunctionCallCard({ id: result.id, name: result.name, arguments: '' });
            if (card instanceof HTMLElement) functionCallCards.set(key, card);
          }
          finishFunctionCallCard(card, result);
        } else if (message?.type === 'operation') {
          setStatus('操作中…');
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          removeCursor(activeBubble);
          if (activeBubble instanceof HTMLElement && !mdRawText(activeBubble) && !activeBubble.querySelector(':scope > .qwen-chat-thinking')) {
            removeMessageBubble(activeBubble);
            activeBubble = null;
          }
          lastOperationCard.card = appendOperationCard(message.operation);
          const messages = el(MESSAGES_ID);
          maybeAutoScrollMessages(messages);
        } else if (message?.type === 'operationResult') {
          setStatus('思考中…');
          updateOperationResult(lastOperationCard.card, message.result);
          if (lastOperationCard.card instanceof HTMLElement) retryVisibleAnchor = lastOperationCard.card;
          streamStartAnchor = retryVisibleAnchor;
          nextReplyFresh = false;
          if (activeBubble instanceof HTMLElement) removeCursor(activeBubble);
          activeBubble = null;
          const fresh = ensureAssistantBubble();
          placeCursor(fresh, false);
          const messages = el(MESSAGES_ID);
          maybeAutoScrollMessages(messages);
        } else if (message?.type === 'firstMessage') {
          setStatus('思考中…');
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          if (activeBubble instanceof HTMLElement) removeCursor(activeBubble);
          activeBubble = null;
          const messages = el(MESSAGES_ID);
          maybeAutoScrollMessages(messages);
        } else if (message?.type === 'done') {
          pendingWafRetryAction = null;
          wafRecoveryActive = false;
          sessionChatId = String(message.chatId || sessionChatId);
          sessionParentId = String(message.responseId || sessionParentId);
          if (sessionChatId) void chrome.storage.local.set({ qwenLastChatId: sessionChatId });
          if (openingStarted) {
            openingStarted = false;
            openingCompleted = true;
            void chrome.storage.local.remove('qwenOpeningPendingChatId');
          }
          hideAsk();
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          if (message.stoppedByLimit === true) {
            const bubble = ensureAssistantBubble();
            if (bubble instanceof HTMLElement) {
              if (mdRawText(bubble)) appendAssistantText(bubble, '\n\n_（操作调用次数过多，已结束本次。）_');
              else appendAssistantText(bubble, '_（操作调用次数过多，已结束本次。）_');
            }
          } else if (activeBubble instanceof HTMLElement && !mdRawText(activeBubble)) {
            appendAssistantText(activeBubble, '（无回复）');
          }
          removeCursor(activeBubble);
          finalizeAssistantSuggestions(activeBubble);
          activeBubble = null;
          setBusy(false);
          setStatus('已登录', 'ok');
          chatPort.disconnect();
          if (port === chatPort) port = null;
        } else if (message?.type === 'historyReload') {
          pendingWafRetryAction = null;
          wafRecoveryActive = false;
          hideAsk();
          sessionChatId = String(message?.chatId || sessionChatId || '');
          if (sessionChatId) void chrome.storage.local.set({ qwenLastChatId: sessionChatId });
          if (openingStarted) {
            openingStarted = false;
            openingCompleted = true;
            void chrome.storage.local.remove('qwenOpeningPendingChatId');
          }
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          removeCursor(activeBubble);
          activeBubble = null;
          setBusy(false);
          setStatus('已登录', 'ok');
          chatPort.disconnect();
          if (port === chatPort) port = null;
          void loadHistoryOnce();
        } else if (message?.type === 'stopped') {
          pendingWafRetryAction = null;
          wafRecoveryActive = false;
          hideAsk();
          const stoppedChatId = String(message?.chatId || '');
          if (stoppedChatId) {
            sessionChatId = stoppedChatId;
            const patch = { qwenLastChatId: stoppedChatId };
            if (openingStarted) patch.qwenOpeningPendingChatId = stoppedChatId;
            void chrome.storage.local.set(patch);
          }
          if (openingStarted) openingStarted = false;
          sessionParentId = String(message?.retryParentId || requestParentId || '');
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          removeCursor(activeBubble);
          activeBubble = null;
          setBusy(false);
          setStatus('已登录', 'ok');
          chatPort.disconnect();
          if (port === chatPort) port = null;
          const stoppedBubble = appendMessage('error', '生成中止');
          const retryBtn = document.createElement('button');
          retryBtn.type = 'button';
          retryBtn.className = 'qwen-chat-retry-btn';
          retryBtn.textContent = '重试';
          retryBtn.title = '重新发送刚才中止的请求';
          retryBtn.addEventListener('click', () => {
            if (busy) return;
            retryBtn.disabled = true;
            stoppedBubble.remove();
            if (wasOpeningStream) openingStarted = true;
            startStream({
              text: String(message?.retryText || text),
              editParent: String(message?.retryParentId || requestParentId || ''),
              isEditSend: true,
              showUserBubble: false
            });
          }, { once: true });
          stoppedBubble.appendChild(retryBtn);
        } else if (message?.type === 'ask') {
          showAsk(message);
        } else if (message?.type === 'askResolved') {
          if (!message?.id || String(message.id) === pendingAskId) hideAsk();
        } else if (message?.type === 'retryRequest') {
          const retryChatId = String(message?.chatId || sessionChatId || '');
          const retryId = String(message?.retryId || '');
          if (retryChatId) {
            sessionChatId = retryChatId;
            const patch = { qwenLastChatId: retryChatId };
            if (openingStarted) patch.qwenOpeningPendingChatId = retryChatId;
            void chrome.storage.local.set(patch);
          }
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          if (message?.afterOperationResult === true) {
            if (!(lastOperationCard.card instanceof HTMLElement) || !lastOperationCard.card.isConnected) {
              lastOperationCard.card = appendOperationCard();
            }
            updateOperationResult(lastOperationCard.card, message.operationResult);
            if (lastOperationCard.card instanceof HTMLElement) retryVisibleAnchor = lastOperationCard.card;
          }
          const retriedBubble = activeBubble instanceof HTMLElement ? activeBubble : null;
          removeCursor(retriedBubble);
          const retriedBubbleHasContent = retriedBubble instanceof HTMLElement
            && (!!mdRawText(retriedBubble) || !!retriedBubble.querySelector(':scope > .qwen-chat-thinking'));
          if (retriedBubbleHasContent) {
            retryVisibleAnchor = messageDisplayNode(retriedBubble) || retryVisibleAnchor;
          } else if (retriedBubble instanceof HTMLElement) {
            removeMessageBubble(retriedBubble);
          }
          activeBubble = null;
          const bubble = appendMessage('error', message.message || '请求失败');
          placeMessageAfter(bubble, retryVisibleAnchor);
          const isWafError = message.code === 'WAF_PUNISH' || message.code === 'WAF_BUSY' || message.code === 'WAF_CHALLENGE';
          if (isWafError) {
            wafRecoveryActive = true;
            historyReloadAfterLogin = false;
            setStatus('风控校验', 'error');
            void send('QWEN_OPEN_LOGIN');
          }
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'qwen-chat-retry-btn';
          btn.textContent = '重试';
          btn.title = '重新发送刚才的请求';
          btn.addEventListener('click', () => {
            btn.disabled = true;
            btn.textContent = '正在重试…';
            try {
              chatPort.postMessage({
                type: 'retryDecision',
                action: 'retry',
                retryId,
                chatId: retryChatId || sessionChatId
              });
            } catch {
              btn.disabled = false;
              btn.textContent = '重试';
              btn.title = '重试连接已失效，请重新发送消息';
            }
          });
          bubble.appendChild(btn);
          retryPrompt = { id: retryId, bubble, button: btn, retriedBubble };
          if (isWafError) {
            pendingWafRetryAction = () => {
              if (retryPrompt?.id !== retryId || btn.disabled || !btn.isConnected) return false;
              btn.click();
              return true;
            };
          } else {
            pendingWafRetryAction = null;
          }
          const messages = el(MESSAGES_ID);
          maybeAutoScrollMessages(messages);
        } else if (message?.type === 'retryAccepted') {
          if (!retryPrompt || (message?.retryId && String(message.retryId) !== retryPrompt.id)) return;
          retryPrompt.bubble.remove();
          retryPrompt = null;
          pendingWafRetryAction = null;
          activeBubble = null;
          const fresh = ensureAssistantBubble();
          placeCursor(fresh, false);
          setBusy(true);
          setStatus('思考中…');
          maybeAutoScrollMessages(el(MESSAGES_ID));
        } else if (message?.type === 'retryRejected') {
          if (!retryPrompt || (message?.retryId && String(message.retryId) !== retryPrompt.id)) return;
          retryPrompt.button.disabled = false;
          retryPrompt.button.textContent = '重试';
          retryPrompt.button.title = '重试连接已失效，请重新发送消息';
        } else if (message?.type === 'error') {
          hideAsk();
          if (message?.parentId) sessionParentId = String(message.parentId);
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          const errorChatId = String(message.chatId || '');
          if (errorChatId) {
            sessionChatId = errorChatId;
            const patch = { qwenLastChatId: errorChatId };
            if (openingStarted) patch.qwenOpeningPendingChatId = errorChatId;
            void chrome.storage.local.set(patch);
          }
          if (openingStarted) openingStarted = false;
          if (message.code === 'NOT_LOGGED_IN') {
            pendingWafRetryAction = null;
            wafRecoveryActive = false;
            setStatus('未登录', 'error');
            showLoginHint(true);
            removeMessageBubble(activeBubble);
            activeBubble = null;
          } else if (message.code === 'WAF_PUNISH' || message.code === 'WAF_BUSY' || message.code === 'WAF_CHALLENGE') {
            wafRecoveryActive = true;
            historyReloadAfterLogin = false;
            let visibleAnchor = retryVisibleAnchor;
            if (activeBubble instanceof HTMLElement) {
              removeCursor(activeBubble);
              if (mdRawText(activeBubble) || activeBubble.querySelector(':scope > .qwen-chat-thinking')) {
                visibleAnchor = messageDisplayNode(activeBubble) || visibleAnchor;
                retryVisibleAnchor = visibleAnchor;
              } else {
                removeMessageBubble(activeBubble);
              }
            }
            activeBubble = null;
            const errorBubble = appendMessage('error', message.message || '请求失败');
            placeMessageAfter(errorBubble, visibleAnchor);
            setStatus('风控校验', 'error');
            void send('QWEN_OPEN_LOGIN');
            pendingWafRetryAction = () => {
              if (busy) return false;
              removeMessageBubble(errorBubble);
              if (wasOpeningStream) openingStarted = true;
              startStream({
                text,
                editParent: requestParentId,
                isEditSend: true,
                showUserBubble: false
              });
              return true;
            };
          } else {
            pendingWafRetryAction = null;
            wafRecoveryActive = false;
            removeCursor(activeBubble);
            if (activeBubble instanceof HTMLElement && !mdRawText(activeBubble)) removeMessageBubble(activeBubble);
            activeBubble = null;
            appendMessage('error', message.message || '请求失败');
          }
          setBusy(false);
          chatPort.disconnect();
          if (port === chatPort) port = null;
        }
      });
      chatPort.onDisconnect.addListener(() => {
        if (!wafRecoveryActive) pendingWafRetryAction = null;
        hideAsk();
        if (activeBubble) {
          activeBubble = null;
          setBusy(false);
        }
        if (openingStarted) openingStarted = false;
        if (port === chatPort) port = null;
      });
      chatPort.postMessage({
        type: 'send',
        text,
        thinking: (el(THINKING_ID) instanceof HTMLInputElement) && el(THINKING_ID).checked,
        chatId: sessionChatId,
        parentId: requestParentId,
        editParentGiven: isEditSend || wasOpeningStream
      });
    };

    try {
      connectPort();
    } catch (error) {
      appendMessage('error', `无法连接：${String(error?.message || error)}`);
      setBusy(false);
    }
  }

  function sendMessage(text) {
    if (busy) return;
    if (!chatStateLoaded || !openingCompleted) {
      maybeSendOpening();
      return;
    }
    const editParent = pendingEditParentId;
    pendingEditParentId = '';
    const isEditSend = pendingEdit;
    pendingEdit = false;
    startStream({ text, editParent, isEditSend, showUserBubble: true });
  }

  function maybeSendOpening() {
    if (!chatStateLoaded || !lastKnownEnabled || !lastKnownLoggedIn
      || openingCompleted || openingStarted || historyLoadPromise) return;
    sendOpening();
  }

  function sendOpening() {
    if (!lastKnownEnabled || !lastKnownLoggedIn || openingStarted || openingCompleted) return;
    openingStarted = true;
    setBusy(true);
    setStatus('思考中…');
    void send('QWEN_BUILD_SYSTEM_PROMPT').then((response) => {
      const text = String(response?.text || '').trim();
      if (!text) throw new Error('系统提示词为空');
      startStream({ text, showUserBubble: false });
    }).catch((error) => {
      openingStarted = false;
      appendMessage('error', `系统提示词发送准备失败：${String(error?.message || error)}`);
      setTimeout(() => sendOpening(), 1000);
    });
  }

  function loadChatStateFromStorage() {
    if (chatStateLoaded) return Promise.resolve();
    if (chatStateLoadPromise) return chatStateLoadPromise;
    chatStateLoadPromise = chrome.storage.local.get(['qwenLastChatId', 'qwenOpeningPendingChatId']).then((data) => {
      sessionChatId = String(data?.qwenLastChatId || '');
      const pendingOpeningChatId = String(data?.qwenOpeningPendingChatId || '');
      openingCompleted = !!sessionChatId && pendingOpeningChatId !== sessionChatId;
      chatStateLoaded = true;
      if (sessionChatId && !port && !openingStarted) setBusy(false);
    }).finally(() => {
      chatStateLoadPromise = null;
    });
    return chatStateLoadPromise;
  }

  function activateQwenPanel() {
    panelActivated = true;
    if (panelActivationPromise) return panelActivationPromise;
    panelActivationPromise = (async () => {
      await loadChatStateFromStorage();
      const status = await refreshStatus({ openLoginIfNeeded: true, allowOpening: false });
      if (status?.loggedIn !== true) return;
      await refreshModels();

      if (wafRecoveryActive) {
        historyReloadAfterLogin = false;
        return;
      } else if (historyReloadAfterLogin) {
        await restoreHistoryAfterLogin();
        panelHistoryInitialized = true;
      } else if (sessionChatId && !panelHistoryInitialized) {
        await loadHistory();
        panelHistoryInitialized = true;
      }
      maybeSendOpening();
    })().catch((error) => {
      setStatus(`初始化失败：${String(error?.message || error)}`, 'error');
    }).finally(() => {
      panelActivationPromise = null;
    });
    return panelActivationPromise;
  }

  function init() {
    if (new URLSearchParams(global.location?.search || '').get('popup') === '1') {
      const fab = el(FAB_ID);
      if (fab instanceof HTMLElement) fab.style.display = 'none';
      const panel = el(PANEL_ID);
      if (panel instanceof HTMLElement) panel.hidden = true;
      return;
    }

    void chrome.storage.local.get(['qwenEnabled']).then((data) => {
      if (data?.qwenEnabled === false) {
        const fab = el(FAB_ID);
        if (fab instanceof HTMLElement) fab.style.display = 'none';
        const panel = el(PANEL_ID);
        if (panel instanceof HTMLElement) panel.hidden = true;
      }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'QWEN_TOKEN_CAPTURED_BROADCAST') {
        lastKnownLoggedIn = true;
        if (wafRecoveryActive || message?.reason === 'waf') {
          historyReloadAfterLogin = false;
          showLoginHint(false);
          return false;
        }
        historyReloadAfterLogin = true;
        if (panelActivated) {
          showLoginHint(false);
          const currentActivation = panelActivationPromise;
          void Promise.resolve(currentActivation).catch(() => {}).then(() => activateQwenPanel());
        }
        return false;
      }
      if (message?.type === 'QWEN_WAF_VERIFIED_BROADCAST') {
        wafRecoveryActive = true;
        historyReloadAfterLogin = false;
        lastKnownLoggedIn = true;
        showLoginHint(false);
        const retry = pendingWafRetryAction;
        const retryStarted = typeof retry === 'function' && retry() === true;
        sendResponse({
          ok: true,
          retryPending: typeof retry === 'function',
          retryStarted
        });
        return false;
      }
      if (message?.type !== 'PAGE_API' || message?.payload?.module !== 'qwen') return false;
      if (String(message?.payload?.fn || '') !== 'executeJs') {
        sendResponse({ ok: false, error: `未知页面操作：${String(message?.payload?.fn || '')}` });
        return false;
      }
      void executeJsInSandbox(message?.payload?.args?.code, message?.payload?.args?.mode).then((value) => {
        sendResponse({ ok: true, value });
      }).catch((error) => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
      return true;
    });

    const fab = el(FAB_ID);
    const panel = el(PANEL_ID);
    const closeBtn = el('qwen-chat-close');
    const stopBtn = el(STOP_ID);
    const form = el('qwen-chat-input-form');
    const input = el(INPUT_ID);
    const loginBtn = el('qwen-chat-login-btn');
    const messages = el(MESSAGES_ID);
    const messagesScroller = getMessagesScrollContainer(messages);
    const scrollBottomBtn = el(SCROLL_BOTTOM_ID);

    if (messages instanceof HTMLElement) {
      const copyMarkdownCode = (target, event) => {
        const inline = target.closest('.qwen-md-inline-code');
        if (inline instanceof HTMLElement && messages.contains(inline)) {
          event?.preventDefault();
          void copyQwenText(inline.textContent || '', inline);
          return true;
        }
        const copyButton = target.closest('.qwen-md-codeblock-copy');
        if (!(copyButton instanceof HTMLButtonElement) || !messages.contains(copyButton)) return false;
        const wrapper = copyButton.closest('.qwen-md-codeblock-wrap');
        const code = wrapper?.querySelector(':scope > .qwen-md-codeblock > code');
        void copyQwenText(code?.textContent || '', copyButton);
        return true;
      };
      messages.addEventListener('click', (event) => {
        if (event.target instanceof Element) copyMarkdownCode(event.target, event);
      });
      messages.addEventListener('keydown', (event) => {
        if (!(event.target instanceof HTMLElement) || !event.target.matches('.qwen-md-inline-code')) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        copyMarkdownCode(event.target, event);
      });
    }

    // app.html 被扩展重载流程恢复时，始终从收起状态开始；
    // 仅在用户主动展开面板后，才检查登录并访问 chat.qwen.ai。
    if (panel instanceof HTMLElement) panel.hidden = true;
    if (fab instanceof HTMLButtonElement) fab.style.display = '';

    if (messagesScroller instanceof HTMLElement) {
      lastMessagesScrollTop = messagesScroller.scrollTop;
      messagesScroller.addEventListener('wheel', (event) => {
        if (event.deltaY < 0) {
          autoScrollEnabled = false;
          updateScrollBottomButton(messagesScroller);
        }
      }, { passive: true });
      messagesScroller.addEventListener('scroll', () => {
        const current = messagesScroller.scrollTop;
        if (isMessagesAtBottom(messagesScroller)) autoScrollEnabled = true;
        else if (current < lastMessagesScrollTop - 1) autoScrollEnabled = false;
        lastMessagesScrollTop = current;
        updateScrollBottomButton(messagesScroller);
      }, { passive: true });
    }
    if (scrollBottomBtn instanceof HTMLButtonElement) {
      scrollBottomBtn.addEventListener('click', () => {
        scrollMessagesToBottom(messages, { force: true });
      });
    }

    if (panel instanceof HTMLElement) {
      const panelEdgeGap = 20;
      const syncPanelViewportHeight = () => {
        const availableHeight = Math.max(1, window.innerHeight - panelEdgeGap * 2);
        panel.style.maxHeight = `${availableHeight}px`;
        panel.style.minHeight = `${Math.min(320, availableHeight)}px`;
        const currentHeight = panel.getBoundingClientRect().height;
        if (currentHeight > availableHeight) panel.style.height = `${availableHeight}px`;
      };
      syncPanelViewportHeight();
      panel.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const rect = panel.getBoundingClientRect();
        const resizeHandleSize = 20;
        const onNativeResizeHandle = event.clientX >= rect.right - resizeHandleSize
          && event.clientY >= rect.bottom - resizeHandleSize;
        if (!onNativeResizeHandle) return;
        // fixed + bottom 会使原生右下角缩放以底部为锚点；缩放前改为 top 锚定。
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.width = `${rect.width}px`;
        panel.style.height = `${rect.height}px`;
      }, { capture: true });
      const header = panel.querySelector('.qwen-chat-header');
      if (header instanceof HTMLElement) {
        header.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          if (event.target.closest('button, select, input, a')) return;
          const rect = panel.getBoundingClientRect();
          const edgeGap = panelEdgeGap;
          const availableHeight = Math.max(1, window.innerHeight - edgeGap * 2);
          const fixedHeight = Math.min(rect.height, availableHeight);
          panel.style.height = `${fixedHeight}px`;
          panel.style.maxHeight = `${availableHeight}px`;
          const fixedRect = panel.getBoundingClientRect();
          const offsetX = event.clientX - fixedRect.left;
          const offsetY = event.clientY - fixedRect.top;
          const onMove = (moveEvent) => {
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            const size = panel.getBoundingClientRect();
            const maxLeft = Math.max(edgeGap, window.innerWidth - size.width - edgeGap);
            const maxTop = Math.max(edgeGap, window.innerHeight - size.height - edgeGap);
            const left = Math.min(Math.max(edgeGap, moveEvent.clientX - offsetX), maxLeft);
            const top = Math.min(Math.max(edgeGap, moveEvent.clientY - offsetY), maxTop);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.maxWidth = `${Math.max(280, window.innerWidth - left - edgeGap)}px`;
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp, { once: true });
          event.preventDefault();
        });
      }
      const clampPanel = () => {
        syncPanelViewportHeight();
        if (panel.hidden) return;
        const rect = panel.getBoundingClientRect();
        const edgeGap = panelEdgeGap;
        const inBounds =
          rect.left >= edgeGap && rect.top >= edgeGap &&
          rect.right <= window.innerWidth - edgeGap && rect.bottom <= window.innerHeight - edgeGap;
        if (inBounds) return;
        const size = rect;
        const maxHeight = Math.max(1, window.innerHeight - edgeGap * 2);
        panel.style.height = `${Math.min(size.height, maxHeight)}px`;
        panel.style.maxHeight = `${maxHeight}px`;
        const resized = panel.getBoundingClientRect();
        const maxLeft = Math.max(edgeGap, window.innerWidth - resized.width - edgeGap);
        const maxTop = Math.max(edgeGap, window.innerHeight - resized.height - edgeGap);
        const left = Math.min(Math.max(edgeGap, resized.left), maxLeft);
        const top = Math.min(Math.max(edgeGap, resized.top), maxTop);
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.maxWidth = `${Math.max(280, window.innerWidth - left - edgeGap)}px`;
      };
      window.addEventListener('resize', clampPanel);
    }

    if (fab instanceof HTMLButtonElement) {
      fab.addEventListener('click', () => {
        if (panel instanceof HTMLElement) {
          panel.hidden = !panel.hidden;
          if (!panel.hidden) {
            fab.style.display = 'none';
            void activateQwenPanel();
            if (historyNeedsInitialScroll) {
              scrollMessagesToBottom(el(MESSAGES_ID), { force: true });
              historyNeedsInitialScroll = false;
            }
            if (input instanceof HTMLTextAreaElement) input.focus();
          } else {
            fab.style.display = '';
          }
        }
      });
    }
    const modelSelect = el(MODEL_ID);
    if (modelSelect instanceof HTMLSelectElement) {
      modelSelect.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { modelId: modelSelect.value });
      });
    }
    const thinkingToggle = el(THINKING_ID);
    if (thinkingToggle instanceof HTMLInputElement) {
      thinkingToggle.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { thinkingEnabled: thinkingToggle.checked === true });
      });
    }
    if (closeBtn instanceof HTMLButtonElement) {
      closeBtn.addEventListener('click', () => {
        if (panel instanceof HTMLElement) panel.hidden = true;
        if (fab instanceof HTMLButtonElement) fab.style.display = '';
      });
    }
    const newChatBtn = el('qwen-chat-new');
    if (newChatBtn instanceof HTMLButtonElement) {
      newChatBtn.addEventListener('click', () => {
        const currentId = sessionChatId;
        const doNew = () => {
          sessionChatId = '';
          sessionParentId = '';
          nextReplyFresh = false;
          pendingEditParentId = '';
          pendingEdit = false;
          openingStarted = false;
          openingCompleted = false;
          hideAsk();
          const messages = el(MESSAGES_ID);
          if (messages instanceof HTMLElement) messages.replaceChildren();
          void chrome.storage.local.remove(['qwenLastChatId', 'qwenOpeningPendingChatId']);
          sendOpening();
        };
        if (!currentId) {
          doNew();
          return;
        }
        if (global.confirm('是否删除当前会话？')) {
          void send('QWEN_DELETE_CHAT', { chatId: currentId }).then(() => doNew()).catch(() => doNew());
        } else {
          doNew();
        }
      });
    }
    if (stopBtn instanceof HTMLButtonElement) {
      stopBtn.addEventListener('click', () => {
        if (port && busy) {
          try {
            port.postMessage({ type: 'stop' });
          } catch {
            // 端口可能已断开
          }
        }
      });
    }
    const askCount = el('qwen-chat-ask-count');
    if (askCount instanceof HTMLInputElement) {
      askCount.addEventListener('input', updateAskContinueLabel);
    }
    const askContinue = el('qwen-chat-ask-continue');
    if (askContinue instanceof HTMLButtonElement) {
      askContinue.addEventListener('click', () => resolveAsk('continue'));
    }
    const askAlways = el('qwen-chat-ask-always');
    if (askAlways instanceof HTMLButtonElement) {
      askAlways.addEventListener('click', () => resolveAsk(pendingAskMode === 'operation-permission' ? 'always-turn' : 'always'));
    }
    const askSession = el('qwen-chat-ask-session');
    if (askSession instanceof HTMLButtonElement) {
      askSession.addEventListener('click', () => resolveAsk('always-session'));
    }
    const askOperations = el('qwen-chat-ask-operations');
    if (askOperations instanceof HTMLButtonElement) {
      askOperations.addEventListener('click', () => resolveAsk('always-operations'));
    }
    const askStop = el('qwen-chat-ask-stop');
    if (askStop instanceof HTMLButtonElement) {
      askStop.addEventListener('click', () => resolveAsk('stop'));
    }
    if (form instanceof HTMLFormElement) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = String(input instanceof HTMLTextAreaElement ? input.value : '').trim();
        if (text) sendMessage(text);
      });
    }
    if (input instanceof HTMLTextAreaElement) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          form?.requestSubmit?.();
        }
      });
    }
    if (loginBtn instanceof HTMLButtonElement) {
      loginBtn.addEventListener('click', () => {
        void send('QWEN_OPEN_LOGIN', { auth: true });
        setTimeout(() => void refreshStatus(), 4000);
        setTimeout(() => void refreshModels(), 4000);
      });
    }

    initOperationsPopover();
  }

  // 所有注册操作统一通过同一个调用入口；任意代码执行由回复末尾的
  // sandbox/app/background 代码块触发，不再注册为 qwen.executeJs 操作。
  async function invokeOperation(name, args) {
    const response = await send('BJTU_RUN_OPERATION', { name, arguments: args || {} });
    if (response?.ok === true) return response.result;
    const error = new Error(response?.error || response?.message || `操作失败：${name}`);
    error.code = String(response?.code || '');
    throw error;
  }
  const operationInvoker = Object.freeze({ invoke: invokeOperation });
  global.BjtuOperations = operationInvoker;
  global.BjtuQwenDebug = Object.freeze({ callOp: invokeOperation, invokeOperation });
  global.callOp = invokeOperation;

  async function installConsoleOperationNamespaces() {
    const response = await send('QWEN_LIST_OPERATIONS');
    if (!response?.ok || !Array.isArray(response.groups)) return false;
    for (const group of response.groups) {
      for (const entry of Array.isArray(group?.operations) ? group.operations : []) {
        const operationName = String(entry?.name || entry || '').trim();
        const parts = operationName.split('.');
        if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
        const [moduleName, methodName] = parts;
        let namespace = global[moduleName];
        if (!namespace || (typeof namespace !== 'object' && typeof namespace !== 'function')) {
          namespace = {};
          Object.defineProperty(global, moduleName, {
            value: namespace,
            configurable: true,
            enumerable: true,
            writable: false
          });
        }
        if (Object.prototype.hasOwnProperty.call(namespace, methodName)) continue;
        Object.defineProperty(namespace, methodName, {
          value: (args = {}) => {
            const promise = operationInvoker.invoke(operationName, args);
            promise.then(
              (result) => console.log(`[${operationName}]`, result),
              (error) => console.error(`[${operationName}]`, error)
            );
            return promise;
          },
          configurable: true,
          enumerable: true,
          writable: false
        });
      }
    }
    return true;
  }
  void (async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (await installConsoleOperationNamespaces()) return;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})(globalThis);
