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
      for (const entry of names) {
        const name = String(entry?.name ?? entry ?? '');
        const summary = String(entry?.summary || '');
        const isMeta = name.startsWith('qwen.');
        const label = document.createElement('label');
        label.className = 'qwen-operation-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.operationName = name;
        checkbox.checked = isMeta || allSelected || selectedSet.has(name) || anySelected.has(name) || selectedSet.size === 0;
        checkbox.disabled = isMeta;
        const code = document.createElement('code');
        code.textContent = name;
        label.append(checkbox, code);
        if (summary) {
          const desc = document.createElement('span');
          desc.className = 'qwen-operation-item-desc';
          desc.textContent = summary;
          label.appendChild(desc);
        }
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
    const thinking = document.getElementById('qwenThinkingEnabled');
    if (thinking instanceof HTMLInputElement) thinking.checked = status.thinkingEnabled === true;
    const maxIterations = document.getElementById('qwenMaxIterations');
    if (maxIterations instanceof HTMLInputElement) maxIterations.value = String(Math.max(1, Number(status.maxIterations) || 6));
    const alwaysAllow = document.getElementById('qwenAlwaysAllow');
    if (alwaysAllow instanceof HTMLInputElement) alwaysAllow.checked = status.alwaysAllow === true;
    if (maxIterations instanceof HTMLInputElement && alwaysAllow instanceof HTMLInputElement) maxIterations.disabled = alwaysAllow.checked === true;

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
    const list = document.getElementById('qwenOperationList');
    if (list instanceof HTMLElement) {
      const loading = document.createElement('div');
      loading.className = 'qwen-operation-loading';
      loading.textContent = '操作加载中…';
      if (!list.childElementCount) list.appendChild(loading);
    }
    const opsResponse = await send('QWEN_LIST_OPERATIONS');
    if (opsResponse.ok) {
      renderOperations(opsResponse.groups, opsResponse.enabledOperations, !Array.isArray(opsResponse.enabledOperations));
    } else {
      if (list instanceof HTMLElement) {
        list.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'qwen-operation-loading';
        empty.textContent = String(opsResponse.message || '操作加载失败');
        list.appendChild(empty);
      }
    }
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;

    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) {
      toggle.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { enabled: toggle.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
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
        document.querySelectorAll('#qwenOperationList input[type="checkbox"]:not(:disabled)').forEach((input) => { input.checked = !input.checked; });
        void send('QWEN_SETTINGS_SET', { enabledOperations: collectSelectedOperations() }).then(() => setMessage('已保存'));
      });
    }

    void refresh().catch((error) => setMessage(`初始化失败：${String(error?.message || error)}`, false));
    void refreshOperations().catch((error) => setMessage(`操作加载失败：${String(error?.message || error)}`, false));
  }

  async function reset() {
    await send('QWEN_SETTINGS_SET', { enabled: true, modelId: '', enabledOperations: null, thinkingEnabled: false, maxIterations: 6, alwaysAllow: false });
    void refresh();
  }

  global.BjtuQwenOptions = { init, reset };
  global.BjtuOptionsModules?.register('qwen', global.BjtuQwenOptions);
})(globalThis);
