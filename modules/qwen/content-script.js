/* 通义千问内容脚本：
 * 1. 读取 chat.qwen.ai 页面 localStorage 中的登录令牌并上报后台；
 * 2. 以页面同源上下文执行 /api/v2/* 请求（JSON 与 SSE 流），并附带与真实浏览器一致的
 *    反爬标头，规避阿里 baxia WAF 的 JS 挑战与风控拦截（否则会返回 200 HTML 或
 *    {"ret":["FAIL_SYS_USER_VALIDATE",...]} 的验证码惩罚响应而非正常 JSON/SSE）。 */
(function () {
  'use strict';

  const SESSION_KEY_CANDIDATES = ['token', 'access_token', 'qwen_token', 'jwt_token'];
  const STREAM_CONTROLLERS = new Map();
  let lastSent = '';

  function readToken() {
    for (const key of SESSION_KEY_CANDIDATES) {
      const value = String(localStorage.getItem(key) || '');
      if (value.trim()) return value;
    }
    return '';
  }

  function sendToBackground(payload) {
    try {
      chrome.runtime.sendMessage(payload, () => {
        void chrome?.runtime?.lastError;
      });
    } catch {
      // 忽略
    }
  }

  function sendToken(token) {
    if (!token || token === lastSent) return;
    lastSent = token;
    sendToBackground({ type: 'QWEN_TOKEN_CAPTURED', payload: { token } });
  }

  function check() {
    sendToken(readToken());
  }

  function newRequestId() {
    return (crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  function buildApiHeaders(isStream, extra) {
    return {
      'x-ap': 'cn-hongkong',
      Version: '0.2.86',
      'X-Request-Id': newRequestId(),
      source: 'web',
      'bx-v': '2.5.37',
      'Content-Type': 'application/json',
      Accept: isStream ? 'application/json' : 'application/json, text/plain, */*',
      ...(extra || {})
    };
  }

  async function getAntiBotHeaders() {
    try {
      const data = await chrome?.storage?.session?.get?.('qwenAntiBotHeaders') || {};
      const h = data?.qwenAntiBotHeaders || {};
      if (!h.bxUa || !h.capturedAt || (Date.now() - h.capturedAt > 120000)) return {};
      const out = { 'bx-ua': h.bxUa };
      if (h.bxUmidtoken) out['bx-umidtoken'] = h.bxUmidtoken;
      return out;
    } catch {
      return {};
    }
  }

  // 识别 baxia WAF 的惩罚/挑战响应文本，返回错误代号
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
        if (details) return 'API_ERROR';
      }
      if (String(obj?.data?.code || '') === 'RateLimited') {
        return 'RATE_LIMITED';
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

  function rateLimitMessageFromText(text) {
    try {
      const num = Number(JSON.parse(String(text || ''))?.data?.num) || 0;
      return num
        ? `你已达到每日使用限制。请在 ${Math.max(0, Math.ceil(num))} 小时后再试。`
        : '你已达到每日使用限制。请稍后再试。';
    } catch {
      return '已达通义千问今日用量上限，请稍后再试。';
    }
  }

  function apiStreamErrorMessage(err) {
    return String(err?.details || err?.message || '通义千问返回了错误');
  }

  function extractApiDetails(text) {
    try {
      const obj = JSON.parse(String(text || ''));
      return String(obj?.data?.details || obj?.data?.message || '');
    } catch {
      return '';
    }
  }

  async function executeRequest(payload) {
    const id = String(payload.id || '');
    const url = String(payload.url || '');
    const method = String(payload.method || 'GET');
    const body = payload.body;
    const isStream = payload.stream === true;
    const controller = new AbortController();
    const emit = (data) => sendToBackground({ type: 'QWEN_STREAM_DATA', payload: { id, ...data } });
    try {
      const response = await fetch(url, {
        method,
        headers: buildApiHeaders(isStream, { ...(await getAntiBotHeaders()), ...(payload.headers || {}) }),
        credentials: 'include',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      if (!isStream) {
        const text = await response.text();
        return { ok: true, id, status: response.status, text };
      }

      STREAM_CONTROLLERS.set(id, controller);
      emit({ status: response.status });

      if (!response.ok) {
        const raw = await response.text();
        STREAM_CONTROLLERS.delete(id);
        const kind = detectApiErrorText(raw);
        if (kind === 'RATE_LIMITED') emit({ error: kind, message: rateLimitMessageFromText(raw) });
        else if (kind === 'API_ERROR') emit({ error: kind, message: extractApiDetails(raw) });
        else emit({ error: kind || `HTTP ${response.status}` });
        return null;
      }

      const contentType = String(response.headers.get('content-type') || '');
      if (!response.body?.getReader || !contentType.includes('event-stream')) {
        const raw = await response.text();
        STREAM_CONTROLLERS.delete(id);
        const kind = detectApiErrorText(raw);
        if (kind === 'RATE_LIMITED') {
          emit({ error: kind, message: rateLimitMessageFromText(raw) });
        } else if (kind === 'API_ERROR') {
          emit({ error: kind, message: extractApiDetails(raw) });
        } else if (kind) {
          emit({ error: kind });
        } else if (raw) {
          emit({ error: 'UNEXPECTED_RESPONSE' });
        } else {
          emit({ end: true, text: '', responseId: '', responseParentId });
        }
        return null;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let rawText = '';
      let fullText = '';
      let responseId = '';
      let responseParentId = '';
      let sawDataLine = false;
      let targetResponseId = '';
      let sawAlternateResponse = false;

      const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        sawDataLine = true;
        let data;
        try {
          data = JSON.parse(line.slice(5).trim());
        } catch {
          return;
        }
        if (data?.response_id) responseId = String(data.response_id);
        if (data?.['response.created']?.response_id) responseId = String(data['response.created'].response_id);
        const created = data?.['response.created'];
        if (created) {
          const idx = String(created.response_index ?? '');
          const rid = String(created.response_id || '');
          if (idx === '0') {
            targetResponseId = rid;
          } else if (rid && !targetResponseId) {
            sawAlternateResponse = true;
          }
        }
        const createdParentId = String(data?.['response.created']?.response?.parent_id
          || data?.['response.created']?.response?.parentId
          || data?.['response.created']?.parent_id
          || '');
        if (createdParentId && createdParentId !== responseParentId) {
          responseParentId = createdParentId;
          emit({ responseParentId });
        }
        if (data?.error) {
          emit({ error: 'STREAM_ERROR', message: apiStreamErrorMessage(data.error) });
          return;
        }
        const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
        if (choice?.response_id) responseId = String(choice.response_id);
        const delta = choice?.delta;
        if (!delta) {
          emit({ meta: data });
          return;
        }
        // 千问可能一次返回多条 response（response_index 0/1），只需读取 index==0 对应的回复。
        if (targetResponseId && responseId && responseId !== targetResponseId) return;
        if (!targetResponseId && sawAlternateResponse) return;
        const content = String(delta.content || '');
        const status = String(delta.status || '');
        const phase = String(delta.phase || '');
        if (status === 'finished') {
          emit({ finished: true, responseId });
          return;
        }
        if (content) {
          if (phase === 'think') {
            emit({ thinking: content, responseId });
          } else {
            fullText += content;
            emit({ text: content, responseId });
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

      STREAM_CONTROLLERS.delete(id);
      if (!sawDataLine && rawText.trim()) {
        const kind = detectApiErrorText(rawText);
        if (kind) {
          emit(kind === 'RATE_LIMITED' ? { error: kind, message: rateLimitMessageFromText(rawText) } : { error: kind });
          return null;
        }
      }
      emit({ end: true, text: fullText, responseId, responseParentId });
      return null;
    } catch (error) {
      STREAM_CONTROLLERS.delete(id);
      if (controller.signal.aborted) {
        if (isStream) emit({ error: String(error?.name || 'AbortError') });
        return null;
      }
      if (isStream) {
        emit({ error: 'NETWORK_ERROR' });
      }
      return { ok: false, id, error: String(error?.message || error) };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = String(message?.type || '');
    if (type === 'QWEN_PING') {
      sendResponse({ ok: true, ready: true });
      return false;
    }
    if (type === 'QWEN_API_REQUEST') {
      void executeRequest(message.payload || {}).then((result) => {
        sendResponse(result || { ok: false, error: '请求已改为流式转发' });
      });
      return true;
    }
    if (type === 'QWEN_ABORT_STREAM') {
      const id = String(message.payload?.id || '');
      STREAM_CONTROLLERS.get(id)?.abort();
      return false;
    }
    return false;
  });

  check();
  window.addEventListener('pageshow', check);
  setInterval(check, 8000);
})();