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

  function setLoginStatus(text, state = '') {
    const value = document.getElementById('qwenLoginStatusValue');
    const openBtn = document.getElementById('qwenOpenLogin');
    if (value instanceof HTMLElement) {
      value.textContent = text;
      value.className = `qwen-login-status-value ${state}`;
    }
    if (openBtn instanceof HTMLButtonElement) openBtn.hidden = state !== 'error';
  }

  function renderOperations(groups, selectedNames, allSelected) {
    const list = document.getElementById('qwenOperationList');
    if (!(list instanceof HTMLElement)) return;
    list.replaceChildren();
    const selectedSet = new Set(allSelected ? [] : (selectedNames || []));
    const anySelected = new Set(selectedNames || []);

    for (const group of groups || []) {
      const names = group.operations || [];
      if (!names.length) continue;
      const container = document.createElement('div');
      container.className = 'qwen-operation-group';

      const title = document.createElement('div');
      title.className = 'qwen-operation-group-title';
      title.textContent = group.label;
      container.appendChild(title);

      const items = document.createElement('div');
      items.className = 'qwen-operation-group-items';
      for (const name of names) {
        const label = document.createElement('label');
        label.className = 'qwen-operation-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.operationName = name;
        checkbox.checked = allSelected || selectedSet.has(name) || anySelected.has(name) || selectedSet.size === 0;
        const code = document.createElement('code');
        code.textContent = name;
        label.append(checkbox, code);
        items.appendChild(label);
      }
      container.appendChild(items);
      list.appendChild(container);
    }

    if (list.childElementCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'qwen-operation-loading';
      empty.textContent = '暂无可调用的操作';
      list.appendChild(empty);
    }
  }

  function collectSelectedOperations() {
    const checked = [...document.querySelectorAll('#qwenOperationList input[type="checkbox"]:checked')]
      .map((input) => String(input.dataset.operationName || ''))
      .filter(Boolean);
    const total = [...document.querySelectorAll('#qwenOperationList input[type="checkbox"]')].length;
    return total > 0 && checked.length === total ? null : checked;
  }

  async function refresh() {
    const status = await send('QWEN_GET_STATUS');
    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) toggle.checked = status.enabled !== false;
    if (status.ok) {
      if (status.loggedIn) {
        setLoginStatus('已登录 chat.qwen.ai', 'ok');
      } else {
        setLoginStatus('未登录 chat.qwen.ai，请打开登录页', 'error');
      }
    } else {
      setLoginStatus('状态获取失败', 'error');
    }

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

    const opsResponse = await send('QWEN_LIST_OPERATIONS');
    if (opsResponse.ok) {
      renderOperations(opsResponse.groups, opsResponse.enabledOperations, !Array.isArray(opsResponse.enabledOperations));
    }
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'QWEN_TOKEN_CAPTURED_BROADCAST') {
        void refresh().catch(() => {});
      }
    });

    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) {
      toggle.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { enabled: toggle.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const openLogin = document.getElementById('qwenOpenLogin');
    if (openLogin instanceof HTMLButtonElement) {
      openLogin.addEventListener('click', () => {
        void send('QWEN_OPEN_LOGIN').then(() => {
          setLoginStatus('请在打开的页面中登录 chat.qwen.ai…', '');
          setTimeout(() => void refresh(), 5000);
        });
      });
    }

    const select = document.getElementById('qwenModelSelect');
    if (select instanceof HTMLSelectElement) {
      select.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { modelId: select.value }).then(() => setMessage('已保存'));
      });
    }

    const list = document.getElementById('qwenOperationList');
    if (list instanceof HTMLElement) {
      list.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
          void send('QWEN_SETTINGS_SET', { enabledOperations: collectSelectedOperations() }).then(() => setMessage('已保存'));
        }
      });
    }

    const opsToggle = document.getElementById('qwenOpsToggle');
    if (opsToggle instanceof HTMLButtonElement) {
      opsToggle.addEventListener('click', () => {
        document.querySelectorAll('#qwenOperationList input[type="checkbox"]').forEach((input) => { input.checked = !input.checked; });
        void send('QWEN_SETTINGS_SET', { enabledOperations: collectSelectedOperations() }).then(() => setMessage('已保存'));
      });
    }

    void refresh().catch((error) => setMessage(`初始化失败：${String(error?.message || error)}`, false));
  }

  async function reset() {
    await send('QWEN_SETTINGS_SET', { enabled: true, modelId: '', enabledOperations: null });
    void refresh();
  }

  global.BjtuQwenOptions = { init, reset };
  global.BjtuOptionsModules?.register('qwen', global.BjtuQwenOptions);
})(globalThis);
