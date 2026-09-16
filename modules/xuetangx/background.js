(function initBjtuXuetangxBackground() {
  'use strict';

  const BASE = 'https://www.xuetangx.com';
  const EXERCISE_PATH_PREFIX = '/api/v1/lms/exercise/';
  const SECOND_REQUEST_RULE_MIN_ID = 915000;
  const SECOND_REQUEST_RULE_MAX_ID = 919999;
  const activeRuleIds = new Set();

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function allocateRuleId() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = SECOND_REQUEST_RULE_MIN_ID
        + Math.floor(Math.random() * (SECOND_REQUEST_RULE_MAX_ID - SECOND_REQUEST_RULE_MIN_ID + 1));
      if (!activeRuleIds.has(id)) {
        activeRuleIds.add(id);
        return id;
      }
    }
    throw new Error('第二账号请求规则暂时不可用');
  }

  function releaseRuleId(id) {
    activeRuleIds.delete(id);
  }

  function normalizeRequest(message) {
    const rawUrl = String(message?.url || '').trim();
    let url;
    try { url = new URL(rawUrl); } catch { throw new Error('第二账号请求地址无效'); }
    if (url.origin !== BASE || !url.pathname.startsWith(EXERCISE_PATH_PREFIX)) {
      throw new Error('第二账号请求地址不在学堂在线作业接口范围内');
    }
    const method = String(message?.options?.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('第二账号请求方法不受支持');
    const headers = {};
    for (const [name, value] of Object.entries(message?.options?.headers || {})) {
      const normalizedName = String(name || '').toLowerCase();
      if (['accept', 'content-type', 'x-client', 'xtbz', 'x-csrftoken'].includes(normalizedName)) {
        headers[normalizedName] = String(value ?? '');
      }
    }
    const cookie = String(message?.cookieHeader || '').trim();
    if (!cookie) throw new Error('第二账号 Cookie 为空');
    const body = message?.options?.body === undefined || message?.options?.body === null
      ? undefined
      : String(message.options.body);
    return { url, method, headers, cookie, body };
  }

  async function requestWithSecondCookie(message) {
    const request = normalizeRequest(message);
    const ruleId = allocateRuleId();
    const targetUrl = request.url.href;
    const rulePattern = `^${escapeRegex(targetUrl)}$`;
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id: ruleId,
          priority: 2000,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{
              header: 'cookie',
              operation: 'set',
              value: request.cookie
            }, {
              header: 'origin',
              operation: 'set',
              value: BASE
            }, {
              header: 'referer',
              operation: 'set',
              value: `${BASE}/`
            }]
          },
          condition: {
            regexFilter: rulePattern,
            requestDomains: ['www.xuetangx.com'],
            resourceTypes: ['xmlhttprequest'],
            requestMethods: [request.method.toLowerCase()],
            initiatorDomains: [chrome.runtime.id]
          }
        }]
      });
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        credentials: 'omit',
        cache: 'no-store'
      });
      return {
        ok: true,
        status: response.status,
        url: response.url,
        body: await response.text()
      };
    } finally {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId]
      }).catch(() => {});
      releaseRuleId(ruleId);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'XUETANGX_SECOND_REQUEST') return undefined;
    requestWithSecondCookie(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: String(error?.message || error) })
    );
    return true;
  });
})();
