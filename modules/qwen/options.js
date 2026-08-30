(function initQwenOptions(global) {
  'use strict';

  let initialized = false;
  let setMessage = (text, ok = true) => {
    const message = document.getElementById('msg');
    if (message instanceof HTMLElement) {
      message.textContent = String(text || '');
      message.className = `${ok ? 'ok' : 'err'} show`;
    }
  };

  async function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome?.runtime?.lastError;
        resolve(error ? { ok: false, message: String(error.message || '通信失败') } : (response || {}));
      });
    });
  }

  function applyAlwaysAllowState(value) {
    const alwaysAllow = document.getElementById('qwenAlwaysAllow');
    const maxIterations = document.getElementById('qwenMaxIterations');
    if (alwaysAllow instanceof HTMLInputElement) alwaysAllow.checked = value === true;
    if (maxIterations instanceof HTMLInputElement) maxIterations.disabled = value === true;
  }

  function applyFabColorMode(value) {
    const mode = ['dark', 'light', 'system', 'extension'].includes(value) ? value : 'dark';
    document.querySelectorAll('#qwenFabColorMode [data-value]').forEach((button) => {
      button.classList.toggle('theme-mode-btn--active', button.dataset.value === mode);
    });
  }

  function applyEnabledState(enabled) {
    const option = document.getElementById('qwenFabColorOption');
    option?.classList.toggle('is-disabled', !enabled);
    option?.querySelectorAll('button').forEach((button) => { button.disabled = !enabled; });
  }

  async function refresh() {
    const status = await send('QWEN_GET_STATUS');
    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) toggle.checked = status.enabled !== false;
    applyEnabledState(status.enabled !== false);
    applyFabColorMode(status.fabColorMode);
    const thinking = document.getElementById('qwenThinkingEnabled');
    if (thinking instanceof HTMLInputElement) thinking.checked = status.thinkingEnabled === true;
    const maxIterations = document.getElementById('qwenMaxIterations');
    if (maxIterations instanceof HTMLInputElement) maxIterations.value = String(Math.max(1, Number(status.maxIterations) || 6));
    applyAlwaysAllowState(status.alwaysAllow === true);

    const modelsResponse = await send('QWEN_LIST_MODELS');
    const select = document.getElementById('qwenModelSelect');
    if (select instanceof HTMLSelectElement) {
      select.replaceChildren();
      if (modelsResponse.ok && Array.isArray(modelsResponse.models) && modelsResponse.models.length) {
        for (const model of modelsResponse.models) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name;
          if (model.id === status.modelId) option.selected = true;
          select.appendChild(option);
        }
        if (!status.modelId) {
          const first = modelsResponse.models[0];
          await send('QWEN_SETTINGS_SET', { modelId: first.id });
        }
        select.disabled = false;
      } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = modelsResponse.ok ? '无可用模型' : `模型加载失败：${modelsResponse.message || ''}`;
        select.appendChild(option);
        select.disabled = true;
      }
    }
  }

  async function refreshOperations() {
    return global.BjtuQwenOperationsUi.refresh({ showLoading: true });
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;

    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) {
      toggle.addEventListener('change', () => {
        applyEnabledState(toggle.checked === true);
        void send('QWEN_SETTINGS_SET', { enabled: toggle.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    document.getElementById('qwenFabColorMode')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-value]');
      if (!(button instanceof HTMLButtonElement)) return;
      const value = button.dataset.value;
      if (!['dark', 'light', 'system', 'extension'].includes(value)) return;
      applyFabColorMode(value);
      void send('QWEN_SETTINGS_SET', { fabColorMode: value }).then((response) => {
        setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
      });
    });

    const standaloneLink = document.getElementById('qwenOpenChatStandalone');
    if (standaloneLink instanceof HTMLAnchorElement) {
      standaloneLink.href = global.chrome?.runtime?.getURL
        ? chrome.runtime.getURL('modules/qwen/chat.html')
        : 'modules/qwen/chat.html';
    }

    const thinking = document.getElementById('qwenThinkingEnabled');
    if (thinking instanceof HTMLInputElement) {
      thinking.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { thinkingEnabled: thinking.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const alwaysAllow = document.getElementById('qwenAlwaysAllow');
    if (alwaysAllow instanceof HTMLInputElement) {
      alwaysAllow.addEventListener('change', () => {
        const maxIterationsInput = document.getElementById('qwenMaxIterations');
        if (maxIterationsInput instanceof HTMLInputElement) maxIterationsInput.disabled = alwaysAllow.checked === true;
        void send('QWEN_SETTINGS_SET', { alwaysAllow: alwaysAllow.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const select = document.getElementById('qwenModelSelect');
    if (select instanceof HTMLSelectElement) {
      select.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { modelId: select.value }).then(() => setMessage('已保存'));
      });
    }

    document.addEventListener('qwenOperationsPersisted', (event) => {
      const ok = event?.detail?.ok !== false;
      setMessage(ok ? '已保存' : '保存失败', ok);
    });

    void refresh().catch((error) => setMessage(`初始化失败：${String(error?.message || error)}`, false));
    void refreshOperations().catch((error) => setMessage(`操作加载失败：${String(error?.message || error)}`, false));
  }

  async function reset() {
    await send('QWEN_SETTINGS_SET', { enabled: true, fabColorMode: 'dark', modelId: '', enabledOperations: null, alwaysAllowedOperations: [], thinkingEnabled: false, maxIterations: 6, alwaysAllow: false });
    void refresh();
    void refreshOperations();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.qwenAlwaysAllow) return;
    applyAlwaysAllowState(changes.qwenAlwaysAllow.newValue === true);
  });

  global.BjtuQwenOptions = { init, reset };
  global.BjtuOptionsModules?.register('qwen', global.BjtuQwenOptions);
})(globalThis);
