(function initApiOptions(global) {
  'use strict';

  let initialized = false;
  let setMessage = (...args) => global.BjtuOptionsMessage.show(...args);

  async function refresh() {
    const response = await global.BjtuApiOperationsUi.refresh({ showLoading: true });
    if (response?.ok !== true) {
      setMessage(`操作加载失败：${response?.message || response?.error || '通信失败'}`, false);
    }
    return response;
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;
    document.addEventListener('bjtuApiOperationsPersisted', (event) => {
      const ok = event?.detail?.ok === true;
      setMessage(ok ? '已保存' : '保存失败', ok);
    });
    return refresh().catch((error) => {
      setMessage(`操作加载失败：${String(error?.message || error)}`, false);
    });
  }

  async function reset() {
    const response = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          type: 'BJTUCA_OPERATION_SETTINGS_SET',
          payload: { enabledOperations: null, alwaysAllowedOperations: [] }
        }, (result) => {
          const error = chrome.runtime.lastError;
          resolve(error ? { ok: false, message: error.message } : (result || {}));
        });
      } catch (error) {
        resolve({ ok: false, message: String(error?.message || error) });
      }
    });
    if (response?.ok !== true) {
      setMessage(`重置失败：${response?.message || response?.error || '通信失败'}`, false);
      return;
    }
    if (initialized) await refresh();
  }

  global.BjtuApiOptions = { init, reset };
  global.BjtuOptionsModules?.register('api', global.BjtuApiOptions);

  // 独立页面自行启动；聚合选项页仍由 BjtuOptionsModules 统一初始化。
  const initStandalone = () => {
    if (document.body?.matches('.module-options-standalone[data-options-module="api"]')) {
      void init();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStandalone, { once: true });
  } else {
    initStandalone();
  }
})(globalThis);
