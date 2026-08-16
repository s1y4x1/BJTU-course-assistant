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

  function el(id) {
    return document.getElementById(id);
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
    if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = busy;
    if (input instanceof HTMLTextAreaElement) input.disabled = busy;
    if (stopBtn instanceof HTMLButtonElement) stopBtn.hidden = !busy;
  }

  function appendMessage(role, text) {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return;
    const bubble = document.createElement('div');
    bubble.className = `qwen-chat-msg ${role}`;
    bubble.textContent = String(text || '');
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function appendOperationCard(operation) {
    const messages = el(MESSAGES_ID);
    if (!(messages instanceof HTMLElement)) return;
    const card = document.createElement('div');
    card.className = 'qwen-chat-op';
    const name = document.createElement('div');
    name.className = 'qwen-chat-op-name';
    name.textContent = `操作：${operation.name}`;
    const args = document.createElement('div');
    args.className = 'qwen-chat-op-result';
    args.textContent = `参数：${JSON.stringify(operation.arguments || {})}`;
    card.append(name, args);
    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
    return card;
  }

  function updateOperationResult(card, result) {
    if (!(card instanceof HTMLElement)) return;
    const content = document.createElement('div');
    content.className = 'qwen-chat-op-result';
    if (result?.ok) {
      content.textContent = `结果：${JSON.stringify(result.result)}`;
    } else {
      content.textContent = `失败：${result?.error || '未知错误'}`;
    }
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
    const status = await send('QWEN_GET_STATUS');
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
    const status = await send('QWEN_GET_STATUS');
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
    if (bubble.lastChild instanceof Text) {
      bubble.lastChild.appendData(String(text));
    } else {
      bubble.appendChild(document.createTextNode(String(text)));
    }
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

  function sendMessage(text) {
    if (busy) return;
    appendMessage('user', text);
    const input = el(INPUT_ID);
    if (input instanceof HTMLTextAreaElement) input.value = '';
    setBusy(true);
    setStatus('思考中…');
    activeBubble = null;
    const lastOperationCard = { card: null };

    const connectPort = () => {
      port = chrome.runtime.connect({ name: 'bjtu-qwen-chat' });
      port.onMessage.addListener((message) => {
        if (message?.type === 'delta') {
          if (nextReplyFresh) {
            activeBubble = null;
            nextReplyFresh = false;
          }
          const bubble = ensureAssistantBubble();
          if (bubble) appendAssistantText(bubble, message.text);
          const messages = el(MESSAGES_ID);
          if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
        } else if (message?.type === 'thinking') {
          if (nextReplyFresh) {
            activeBubble = null;
            nextReplyFresh = false;
          }
          const bubble = ensureAssistantBubble();
          if (bubble) {
            const body = ensureThinkingBlock(bubble);
            if (body) appendAssistantText(body, message.text);
            const messages = el(MESSAGES_ID);
            if (messages instanceof HTMLElement) messages.scrollTop = messages.scrollHeight;
          }
        } else if (message?.type === 'operation') {
          lastOperationCard.card = appendOperationCard(message.operation);
        } else if (message?.type === 'operationResult') {
          updateOperationResult(lastOperationCard.card, message.result);
          nextReplyFresh = true;
        } else if (message?.type === 'done') {
          sessionChatId = String(message.chatId || sessionChatId);
          sessionParentId = String(message.responseId || sessionParentId);
          nextReplyFresh = false;
          if (activeBubble instanceof HTMLElement && !activeBubble.textContent) {
            activeBubble.textContent = '（无回复）';
          }
          activeBubble = null;
          setBusy(false);
          setStatus('已登录', 'ok');
          port.disconnect();
          port = null;
        } else if (message?.type === 'stopped') {
          nextReplyFresh = false;
          if (activeBubble instanceof HTMLElement) {
            if (activeBubble.textContent) appendAssistantText(activeBubble, '\n（已停止）');
            else appendAssistantText(activeBubble, '（已停止）');
          }
          activeBubble = null;
          setBusy(false);
          setStatus('已登录', 'ok');
          port.disconnect();
          port = null;
        } else if (message?.type === 'error') {
          nextReplyFresh = false;
          if (message.code === 'NOT_LOGGED_IN') {
            setStatus('未登录', 'error');
            showLoginHint(true);
            if (activeBubble instanceof HTMLElement) activeBubble.remove();
            activeBubble = null;
} else if (message.code === 'WAF_PUNISH' || message.code === 'WAF_CHALLENGE') {
          const bubble = ensureAssistantBubble();
          if (bubble instanceof HTMLElement) {
            if (bubble.textContent) bubble.textContent += '\n';
            bubble.textContent += `（${message.message || '请求失败'}）`;
          }
          activeBubble = null;
          setStatus('风控校验', 'error');
          void send('QWEN_OPEN_LOGIN');
          } else {
            appendMessage('error', message.message || '请求失败');
          }
          setBusy(false);
          port.disconnect();
          port = null;
        }
      });
      port.onDisconnect.addListener(() => {
        if (activeBubble) {
          activeBubble = null;
          setBusy(false);
        }
        port = null;
      });
      port.postMessage({ type: 'send', text, thinking: (el(THINKING_ID) instanceof HTMLInputElement) && el(THINKING_ID).checked, chatId: sessionChatId, parentId: sessionParentId });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }
})(globalThis);
