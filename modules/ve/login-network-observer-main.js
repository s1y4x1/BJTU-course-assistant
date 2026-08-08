(function observeBjtuVeLoginNetwork() {
  'use strict';

  const MESSAGE_TYPE = '__BJTU_VE_LOGIN_NETWORK_RESPONSE__';

  function isLoginRequest(url, method) {
    try {
      const parsed = new URL(String(url || ''), location.href);
      return parsed.hostname === '123.121.147.7'
        && parsed.port === '88'
        && /^\/ve\/s\.shtml$/i.test(parsed.pathname)
        && ['GET', 'POST'].includes(String(method || 'GET').toUpperCase());
    } catch {
      return false;
    }
  }

  function report(url, html) {
    let activeSuccessScript = false;
    try {
      const document = new DOMParser().parseFromString(String(html || ''), 'text/html');
      activeSuccessScript = [...document.scripts].some((script) => (
        /location\.href\s*=\s*['"]http:\/\/123\.121\.147\.7:88\/ve\/back\/core\/main\/index\.shtml\?method=index&type=qxkt['"]/i
          .test(String(script.textContent || ''))
      ));
    } catch {
      activeSuccessScript = false;
    }
    window.postMessage({
      type: MESSAGE_TYPE,
      payload: { url: String(url || ''), html: String(html || ''), activeSuccessScript }
    }, location.origin);
  }

  async function decodeGbkResponse(response) {
    const bytes = await response.arrayBuffer();
    return new TextDecoder('gbk').decode(bytes);
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function bjtuObservedFetch(input, init) {
      const requestUrl = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const response = await originalFetch.apply(this, arguments);
      if (isLoginRequest(requestUrl, method)) {
        decodeGbkResponse(response.clone()).then((html) => report(response.url || requestUrl, html)).catch(() => {});
      }
      return response;
    };
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function bjtuObservedXhrOpen(method, url) {
    this.__bjtuVeLoginRequest = { method: String(method || 'GET').toUpperCase(), url: String(url || '') };
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function bjtuObservedXhrSend() {
    const request = this.__bjtuVeLoginRequest;
    if (request && isLoginRequest(request.url, request.method)) {
      this.addEventListener('loadend', () => {
        try {
          if (this.responseType && this.responseType !== 'text') return;
          report(this.responseURL || request.url, this.responseText);
        } catch {
          // Ignore unreadable response bodies.
        }
      }, { once: true });
    }
    return xhrSend.apply(this, arguments);
  };
})();
