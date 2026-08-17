/* Qwen 聊天面板（加载于 app 页面）。 */
(function initQwenChatApp(global) {
  'use strict';

  const FAB_ID = 'qwen-chat-fab';
  const PANEL_ID = 'qwen-chat-panel';
  const STATUS_ID = 'qwen-chat-status';
  const MESSAGES_ID = 'qwen-chat-messages';
  const LOGIN_HINT_ID = 'qwen-chat-login-hint';
  const INPUT_ID = 'qwen-chat-input';
  const SEND_ID = 'qwen-chat-send';
  const STOP_ID = 'qwen-chat-stop';
  const MODEL_ID = 'qwen-chat-model';
  const THINKING_ID = 'qwen-chat-thinking';

  let port = null;
  let activeBubble = null;
  let busy = false;
  let sessionChatId = '';
  let sessionParentId = '';
  let nextReplyFresh = false;
  let inThinking = false;
  let lastSendText = '';
  let pendingEditParentId = '';
  let pendingEdit = false;

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
    renderer.html = ({ text }) => escapeHtmlQwen(text);
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
    renderer.codespan = ({ text }) => `<code class="qwen-md-inline-code">${escapeHtmlQwen(text)}</code>`;
    renderer.code = ({ text, lang }) => {
      const language = String(lang || '').trim().split(/\s+/)[0];
      if (language === 'res') {
        const jsonText = String(text || '').trim();
        return `<div class="qwen-chat-op qwen-inline-res"><div class="qwen-chat-op-name">操作结果</div><div class="qwen-chat-op-result">${escapeHtmlQwen(jsonText)}</div></div>`;
      }
      const languageAttribute = language ? ` data-language="${escapeHtmlQwen(language)}"` : '';
      return `<pre class="qwen-md-codeblock"${languageAttribute}><code>${escapeHtmlQwen(String(text || ''))}</code></pre>`;
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

  function extractUserQuestion(content) {
    const source = String(content || '');
    const marker = '用户问题：';
    const index = source.lastIndexOf(marker);
    return index >= 0 ? source.slice(index + marker.length).trim() : source;
  }

  function extractAssistantReply(message) {
    const list = Array.isArray(message?.content_list) ? message.content_list : [];
    const parts = [];
    for (const item of list) {
      if (item?.phase === 'answer' && item?.content) parts.push(String(item.content));
    }
    if (parts.length) return parts.join('\n');
    return String(message?.content || '');
  }

  function extractResJson(text) {
    const match = /^```res\s*([\s\S]*?)```\s*$/.exec(String(text || '').trim());
    return match ? String(match[1] || '').trim() : String(text || '');
  }

  function resBlocksFromText(text) {
    const blocks = [];
    const regex = /```res\s*([\s\S]*?)```/g;
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
    name.textContent = '操作结果';
    const content = document.createElement('div');
    content.className = 'qwen-chat-op-result';
    content.textContent = extractResJson(text);
    card.append(name, content);
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderHistory(messages) {
    const messagesEl = el(MESSAGES_ID);
    if (!(messagesEl instanceof HTMLElement)) return;
    messagesEl.replaceChildren();
    const list = Array.isArray(messages) ? messages : [];
    let lastAssistantResponseId = '';
    for (const message of list) {
      const role = String(message?.role || '');
      if (role === 'user') {
        const content = String(message?.content || '');
        const blocks = resBlocksFromText(content);
        if (blocks.length) {
          for (const block of blocks) appendResCard(block);
        } else {
          appendMessage('user', extractUserQuestion(content), String(message?.parentId || message?.parent_id || lastAssistantResponseId));
        }
      } else if (role === 'assistant') {
        const text = extractAssistantReply(message);
        appendMessage('assistant', text || '（无回复）');
        lastAssistantResponseId = String(message?.response_id || message?.id || lastAssistantResponseId);
      }
    }
  }

  async function loadHistory() {
    if (!sessionChatId) return;
    const response = await send('QWEN_GET_CHAT_HISTORY', { chatId: sessionChatId });
    if (response?.ok && Array.isArray(response.messages)) renderHistory(response.messages);
  }

  function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome?.runtime?.lastError;
        resolve(error ? { ok: false, message: String(error.message || '通信失败') } : (response || {}));
      });
    });
  }

  function setStatus(text, state = '') {
    const statusEl = el(STATUS_ID);
    if (statusEl instanceof HTMLElement) {
      statusEl.textContent = text;
      statusEl.className = `qwen-chat-status ${state}`;
    }
  }

  function setBusy(value) {
    busy = value === true;
    const sendBtn = el(SEND_ID);
    const input = el(INPUT_ID);
    const stopBtn = el(STOP_ID);
    if (sendBtn instanceof HTMLButtonElement) sendBtn.hidden = busy;
    if (input instanceof HTMLTextAreaElement) input.disabled = busy;
    if (stopBtn instanceof HTMLButtonElement) stopBtn.hidden = !busy;
    const messages = el(MESSAGES_ID);
    if (messages instanceof HTMLElement) messages.classList.toggle('qwen-chat-generating', busy);
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
          input.style.height = 'auto';
          input.style.height = `${Math.min(120, input.scrollHeight)}px`;
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
    }
    messages.appendChild(anchor);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function appendRetryButton(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qwen-chat-retry-btn';
    btn.textContent = '重试';
    btn.title = '重新发送刚才的消息';
    btn.addEventListener('click', () => {
      const text = lastSendText;
      if (busy || !text) return;
      if (activeBubble instanceof HTMLElement) activeBubble.remove();
      activeBubble = null;
      sendMessage(text);
    });
    bubble.appendChild(btn);
  }

  function ensureCursor(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    if (!bubble.querySelector(':scope > .qwen-chat-cursor')) {
      const cursor = document.createElement('span');
      cursor.className = 'qwen-chat-cursor';
      bubble.appendChild(cursor);
    }
  }

  function removeCursor(bubble) {
    if (!(bubble instanceof HTMLElement)) return;
    bubble.querySelectorAll(':scope > .qwen-chat-cursor').forEach((node) => node.remove());
    const body = bubble.querySelector(':scope > .qwen-chat-thinking .qwen-chat-thinking-body');
    if (body instanceof HTMLElement) body.querySelectorAll(':scope > .qwen-chat-cursor').forEach((node) => node.remove());
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
        const cursor = document.createElement('span');
        cursor.className = 'qwen-chat-cursor';
        body.appendChild(cursor);
      } else {
        ensureCursor(bubble);
      }
    } else {
      ensureCursor(bubble);
    }
  }

  function appendOperationCard(operation) {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return;
    const card = document.createElement('div');
    card.className = 'qwen-chat-op';
    const name = document.createElement('div');
    name.className = 'qwen-chat-op-name';
    name.textContent = '操作结果';
    card.append(name);
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
    return card;
  }

  function updateOperationResult(card, result) {
    if (!(card instanceof HTMLElement)) return;
    const existing = card.querySelector(':scope > .qwen-chat-op-result');
    if (existing instanceof HTMLElement) existing.remove();
    const content = document.createElement('div');
    content.className = 'qwen-chat-op-result';
    content.textContent = JSON.stringify(result);
    card.appendChild(content);
    const messages = el(MESSAGES_ID);
    if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
  }

  function showLoginHint(show) {
    const hint = el(LOGIN_HINT_ID);
    if (hint instanceof HTMLElement) hint.hidden = !show;
  }

  async function refreshModels() {
    const select = el(MODEL_ID);
    if (!(select instanceof HTMLSelectElement)) return;
    const status = await send('QWEN_GET_STATUS', { ensureLogin: true });
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

  async function refreshStatus() {
    const status = await send('QWEN_GET_STATUS', { ensureLogin: true });
    if (status?.loggedIn) {
      setStatus('已登录', 'ok');
      showLoginHint(false);
    } else {
      setStatus('未登录', 'error');
      showLoginHint(true);
    }
    const thinking = el(THINKING_ID);
    if (thinking instanceof HTMLInputElement) thinking.checked = status?.thinkingEnabled === true;
    return status;
  }

  function ensureAssistantBubble() {
    const messages = el(MESSAGES_ID);
    if (!activeBubble && messages instanceof HTMLElement) {
      const bubble = document.createElement('div');
      bubble.className = 'qwen-chat-msg assistant';
      messages.appendChild(bubble);
      activeBubble = bubble;
    }
    return activeBubble;
  }

  function appendAssistantText(bubble, text) {
    if (!text) return;
    const container = mdContainer(bubble);
    container._mdText = String(container._mdText || '') + String(text);
    container.innerHTML = renderQwenMarkdown(container._mdText);
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
      bubble.appendChild(details);
    }
    return details.querySelector('.qwen-chat-thinking-body');
  }

  let pendingAskId = null;

  function updateAskContinueLabel() {
    const count = el('qwen-chat-ask-count');
    const button = el('qwen-chat-ask-continue');
    if (button instanceof HTMLButtonElement) {
      const value = count instanceof HTMLInputElement ? parseInt(count.value, 10) : 0;
      button.textContent = `继续 ${value > 0 ? value : 1} 次`;
    }
  }

  function showAsk(message) {
    pendingAskId = String(message?.id || '');
    const container = el('qwen-chat-ask');
    const text = el('qwen-chat-ask-text');
    const count = el('qwen-chat-ask-count');
    if (container instanceof HTMLElement) {
      if (text instanceof HTMLElement) text.textContent = message?.message || '操作调用次数过多，是否继续？';
      const value = Number(message?.count) > 0 ? Number(message.count) : 3;
      if (count instanceof HTMLInputElement) count.value = String(value);
      updateAskContinueLabel();
      container.hidden = false;
    }
  }

  function hideAsk() {
    const container = el('qwen-chat-ask');
    if (container instanceof HTMLElement) container.hidden = true;
    pendingAskId = null;
  }

  function resolveAsk(action) {
    const container = el('qwen-chat-ask');
    if (container instanceof HTMLElement) container.hidden = true;
    if (!pendingAskId) return;
    const id = pendingAskId;
    pendingAskId = null;
    const countEl = el('qwen-chat-ask-count');
    const count = countEl instanceof HTMLInputElement ? parseInt(countEl.value, 10) : 0;
    try {
      port?.postMessage({ type: 'askResponse', id, action, count: count > 0 ? count : 1 });
    } catch {
      // 端口可能已断开
    }
  }

  function sendMessage(text) {
    if (busy) return;
    lastSendText = text;
    const editParent = pendingEditParentId;
    pendingEditParentId = '';
    const isEditSend = pendingEdit;
    pendingEdit = false;
    appendMessage('user', text, editParent || sessionParentId);
    const input = el(INPUT_ID);
    if (input instanceof HTMLTextAreaElement) input.value = '';
    hideAsk();
    setBusy(true);
    setStatus('思考中…');
    inThinking = false;
    activeBubble = ensureAssistantBubble();
    placeCursor(activeBubble, false);
    const lastOperationCard = { card: null };

    const connectPort = () => {
      port = chrome.runtime.connect({ name: 'bjtu-qwen-chat' });
      port.onMessage.addListener((message) => {
        if (message?.type === 'delta') {
          const bubble = ensureAssistantBubble();
          if (bubble) appendAssistantText(bubble, message.text);
          if (inThinking) {
            collapseThinking(bubble);
            inThinking = false;
          }
          placeCursor(bubble, false);
          const messages = el(MESSAGES_ID);
          if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
        } else if (message?.type === 'thinking') {
          const bubble = ensureAssistantBubble();
          if (bubble) {
            const body = ensureThinkingBlock(bubble);
            if (body) appendAssistantText(body, message.text);
            const details = bubble.querySelector(':scope > .qwen-chat-thinking');
            if (details instanceof HTMLDetailsElement) details.open = true;
            inThinking = true;
            placeCursor(bubble, true);
            const messages = el(MESSAGES_ID);
            if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
          }
        } else if (message?.type === 'operation') {
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          removeCursor(activeBubble);
          lastOperationCard.card = appendOperationCard(message.operation);
          const messages = el(MESSAGES_ID);
          if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
        } else if (message?.type === 'operationResult') {
          updateOperationResult(lastOperationCard.card, message.result);
          nextReplyFresh = false;
          if (activeBubble instanceof HTMLElement) removeCursor(activeBubble);
          activeBubble = null;
          const fresh = ensureAssistantBubble();
          placeCursor(fresh, false);
          const messages = el(MESSAGES_ID);
          if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
        } else if (message?.type === 'done') {
          sessionChatId = String(message.chatId || sessionChatId);
          sessionParentId = String(message.responseId || sessionParentId);
          if (sessionChatId) void chrome.storage.local.set({ qwenLastChatId: sessionChatId });
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
          activeBubble = null;
          setBusy(false);
          setStatus('已登录', 'ok');
          port.disconnect();
          port = null;
        } else if (message?.type === 'stopped') {
          hideAsk();
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          if (activeBubble instanceof HTMLElement) {
            const raw = mdRawText(activeBubble);
            appendAssistantText(activeBubble, raw ? '\n（已停止）' : '（已停止）');
          }
          removeCursor(activeBubble);
          activeBubble = null;
          setBusy(false);
          setStatus('已登录', 'ok');
          port.disconnect();
          port = null;
        } else if (message?.type === 'ask') {
          showAsk(message);
        } else if (message?.type === 'error') {
          hideAsk();
          if (inThinking) {
            collapseThinking(activeBubble);
            inThinking = false;
          }
          const errorChatId = String(message.chatId || '');
          if (errorChatId) {
            sessionChatId = errorChatId;
            void chrome.storage.local.set({ qwenLastChatId: errorChatId });
          }
          if (message.code === 'NOT_LOGGED_IN') {
            setStatus('未登录', 'error');
            showLoginHint(true);
            if (activeBubble instanceof HTMLElement) activeBubble.remove();
            activeBubble = null;
          } else if (message.code === 'WAF_PUNISH' || message.code === 'WAF_CHALLENGE') {
            if (activeBubble instanceof HTMLElement) {
              removeCursor(activeBubble);
              activeBubble.remove();
            }
            activeBubble = null;
            const bubble = appendMessage('error', message.message || '请求失败');
            appendRetryButton(bubble);
            setStatus('风控校验', 'error');
            void send('QWEN_OPEN_LOGIN');
          } else {
            removeCursor(activeBubble);
            appendMessage('error', message.message || '请求失败');
          }
          setBusy(false);
          port.disconnect();
          port = null;
        }
      });
      port.onDisconnect.addListener(() => {
        hideAsk();
        if (activeBubble) {
          activeBubble = null;
          setBusy(false);
        }
        port = null;
      });
      port.postMessage({ type: 'send', text, thinking: (el(THINKING_ID) instanceof HTMLInputElement) && el(THINKING_ID).checked, chatId: sessionChatId, parentId: editParent || sessionParentId, editParentGiven: isEditSend });
    };

    try {
      connectPort();
    } catch (error) {
      appendMessage('error', `无法连接：${String(error?.message || error)}`);
      setBusy(false);
    }
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

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'QWEN_TOKEN_CAPTURED_BROADCAST') {
        void refreshStatus();
      }
    });

    const fab = el(FAB_ID);
    const panel = el(PANEL_ID);
    const closeBtn = el('qwen-chat-close');
    const stopBtn = el(STOP_ID);
    const form = el('qwen-chat-input-form');
    const input = el(INPUT_ID);
    const loginBtn = el('qwen-chat-login-btn');

    if (panel instanceof HTMLElement) {
      const header = panel.querySelector('.qwen-chat-header');
      if (header instanceof HTMLElement) {
        header.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          if (event.target.closest('button, select, input, a')) return;
          const rect = panel.getBoundingClientRect();
          const offsetX = event.clientX - rect.left;
          const offsetY = event.clientY - rect.top;
          const onMove = (moveEvent) => {
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = `${Math.max(0, moveEvent.clientX - offsetX)}px`;
            panel.style.top = `${Math.max(0, moveEvent.clientY - offsetY)}px`;
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
    }

    void chrome.storage.local.get('qwenLastChatId').then((data) => {
      sessionChatId = String(data?.qwenLastChatId || '');
      if (sessionChatId) void loadHistory();
    });

    if (fab instanceof HTMLButtonElement) {
      fab.addEventListener('click', () => {
        if (panel instanceof HTMLElement) {
          panel.hidden = !panel.hidden;
          if (!panel.hidden) {
            fab.style.display = 'none';
            void refreshStatus();
            void refreshModels();
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
          hideAsk();
          const messages = el(MESSAGES_ID);
          if (messages instanceof HTMLElement) messages.replaceChildren();
          void chrome.storage.local.remove('qwenLastChatId');
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
      askAlways.addEventListener('click', () => resolveAsk('always'));
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
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = `${Math.min(120, input.scrollHeight)}px`;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          form?.requestSubmit?.();
        }
      });
    }
    if (loginBtn instanceof HTMLButtonElement) {
      loginBtn.addEventListener('click', () => {
        void send('QWEN_OPEN_LOGIN');
        setTimeout(() => void refreshStatus(), 4000);
        setTimeout(() => void refreshModels(), 4000);
      });
    }

    void refreshStatus();
    void refreshModels();
  }

  // 调试辅助：控制台可直接调用操作并拿到结果 JSON（无需手动粘桥代码）。
  // 例：callOp('ve.courseList', {})  → 返回 result；失败则抛错（err.code 携带错误码）。
  async function callOp(name, args) {
    const response = await send('QWEN_RUN_OPERATION', { name, arguments: args || {} });
    if (response?.ok === true) return response.result;
    const error = new Error(response?.error || response?.message || `操作失败：${name}`);
    error.code = String(response?.code || '');
    throw error;
  }
  global.BjtuQwenDebug = Object.freeze({ callOp });
  global.callOp = callOp;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})(globalThis);
