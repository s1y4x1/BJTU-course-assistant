/* Shared toast rendering for CAS, MIS, academic and VE web pages. */
(function initBjtuPageToast(global) {
  'use strict';

  let stylesheetPromise = null;

  function loadStylesheet() {
    if (!stylesheetPromise) {
      stylesheetPromise = fetch(chrome.runtime.getURL('UI/toast.css'))
        .then((response) => {
          if (!response.ok) throw new Error(`Toast stylesheet HTTP ${response.status}`);
          return response.text();
        })
        .catch((error) => {
          stylesheetPromise = null;
          throw error;
        });
    }
    return stylesheetPromise;
  }

  async function show(tabId, message, type = 'success', duration = 3600) {
    const id = Number(tabId);
    if (!Number.isInteger(id) || id < 0 || !message) return false;
    const tone = ['success', 'error', 'warning', 'info'].includes(String(type)) ? String(type) : 'success';
    const stylesheet = await loadStylesheet();
    await chrome.scripting.executeScript({
      target: { tabId: id },
      world: 'ISOLATED',
      func: (content, toneClass, timeout, cssText) => {
        const hostId = '__bjtu_page_toast_host__';
        let host = document.getElementById(hostId);
        if (host instanceof HTMLElement) host.remove();
        host = document.createElement('div');
        host.id = hostId;
        host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
        host.attachShadow({ mode: 'open' });
        document.documentElement.appendChild(host);
        const root = host.shadowRoot;
        const style = document.createElement('style');
        style.textContent = cssText;
        const container = document.createElement('div');
        container.className = 'bjtu-toast-container';
        const toast = document.createElement('div');
        toast.className = `bjtu-toast ${toneClass}`;
        toast.textContent = content;
        toast.title = '点击复制通知内容并关闭';
        toast.addEventListener('click', () => {
          navigator.clipboard?.writeText?.(content).catch(() => {});
          toast.remove();
        });
        container.appendChild(toast);
        root.append(style, container);
        setTimeout(() => host.remove(), Math.max(0, Number(timeout) || 3600));
      },
      args: [String(message), tone, duration, stylesheet]
    });
    return true;
  }

  global.BjtuPageToast = Object.freeze({ show });
})(globalThis);
