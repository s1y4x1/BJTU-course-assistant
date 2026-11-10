(function initApiOperationPanel(global) {
  'use strict';

  async function refresh() {
    const response = await global.BjtuApiOperationsUi.refresh({ showLoading: true });
    if (response?.ok !== true) {
      const list = document.querySelector('[data-operation-list]');
      if (list) {
        list.replaceChildren();
        const message = document.createElement('div');
        message.className = 'api-operation-loading';
        message.textContent = `操作加载失败：${response?.message || response?.error || '通信失败'}`;
        list.appendChild(message);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void refresh(), { once: true });
  } else {
    void refresh();
  }
})(globalThis);
