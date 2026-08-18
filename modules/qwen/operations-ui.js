/* 共享的「允许 AI 调用以下操作」界面。
 * 通过 fetch 注入 modules/qwen/operations-ui.html 到页面上每个 [data-operation-ui-mount] 占位符中，
 * 供 modules/qwen/options.html 与聊天面板的「操作」弹窗共用，保证两处显示一致。
 * 暴露：BjtuQwenOperationsUi.mounted（Promise，注入与事件绑定完成后 resolve）
 *        BjtuQwenOperationsUi.render(list, groups, selectedNames, allSelected, options)
 *        BjtuQwenOperationsUi.collect(list)  // 全部选中返回 null，否则返回已勾选操作名数组
 * 勾选变化与「反选」按钮会自动通过 QWEN_SETTINGS_SET 持久化，并派发
 * document 上的 'qwenOperationsPersisted'（detail.ok）事件供宿主提示。 */
(function (global) {
  'use strict';

  const NS = 'BjtuQwenOperationsUi';

  function send(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          const error = chrome?.runtime?.lastError;
          resolve(error ? { ok: false, message: String(error.message || '通信失败') } : (response || {}));
        });
      } catch {
        resolve({ ok: false });
      }
    });
  }

  function render(list, groups, selectedNames, allSelected, options = {}) {
    if (!(list instanceof HTMLElement)) return;
    list.replaceChildren();
    const showSummary = options.showSummary !== false;
    const selectedSet = new Set(allSelected ? [] : (selectedNames || []));
    const anySelected = new Set(selectedNames || []);

    for (const group of groups || []) {
      const names = group.operations || [];
      if (!names.length) continue;
      const groupEl = document.createElement('div');
      groupEl.className = 'qwen-operation-group';

      const title = document.createElement('div');
      title.className = 'qwen-operation-group-title';
      title.textContent = String(group.label || '');
      groupEl.appendChild(title);

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
        if (showSummary && summary) {
          const desc = document.createElement('span');
          desc.className = 'qwen-operation-item-desc';
          desc.textContent = summary;
          label.appendChild(desc);
        }
        items.appendChild(label);
      }
      groupEl.appendChild(items);
      list.appendChild(groupEl);
    }

    if (list.childElementCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'qwen-operation-loading';
      empty.textContent = '暂无可调用的操作';
      list.appendChild(empty);
    }
  }

  function collect(list) {
    if (!(list instanceof HTMLElement)) return [];
    const inputs = [...list.querySelectorAll('input[type="checkbox"]:not(:disabled)')];
    const checked = inputs
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => String(checkbox.dataset.operationName || ''))
      .filter(Boolean);
    return inputs.length > 0 && checked.length === inputs.length ? null : checked;
  }

  async function persist(list) {
    const payload = collect(list);
    const response = await send('QWEN_SETTINGS_SET', { enabledOperations: payload });
    document.dispatchEvent(new CustomEvent('qwenOperationsPersisted', {
      detail: { ok: response?.ok !== false }
    }));
  }

  function wire(root) {
    const list = root.querySelector('[data-operation-list]');
    const toggle = root.querySelector('[data-operation-toggle-all]');
    if (!(list instanceof HTMLElement)) return;
    list.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
        void persist(list);
      }
    });
    if (toggle instanceof HTMLButtonElement) {
      toggle.addEventListener('click', () => {
        list.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((checkbox) => { checkbox.checked = !checkbox.checked; });
        void persist(list);
      });
    }
  }

  let markupPromise = null;
  function loadMarkup() {
    if (markupPromise) return markupPromise;
    markupPromise = fetch(chrome.runtime.getURL('modules/qwen/operations-ui.html'), { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`operations-ui.html HTTP ${response.status}`);
        return response.text();
      });
    return markupPromise;
  }

  const mounted = (async () => {
    const mounts = [...document.querySelectorAll('[data-operation-ui-mount]')];
    if (!mounts.length) return [];
    const html = await loadMarkup();
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const template = wrap.querySelector('[data-operation-ui-root]');
    const roots = [];
    for (const mount of mounts) {
      if (!(mount instanceof HTMLElement)) continue;
      const node = template ? template.cloneNode(true) : wrap.cloneNode(true);
      mount.replaceWith(node);
      roots.push(node);
      wire(node);
    }
    return roots;
  })();

  global[NS] = { mounted, render, collect };
})(globalThis);
