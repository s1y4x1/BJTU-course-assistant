/* 共享的「允许 AI 调用以下操作」界面。
 * 通过 fetch 注入 modules/qwen/operations-ui.html 到页面上每个 [data-operation-ui-mount] 占位符中，
 * 供 modules/qwen/options.html 与聊天面板的「操作」弹窗共用，保证两处显示一致。
 * 暴露：BjtuQwenOperationsUi.refresh()（从后台读取并刷新当前页面上的全部操作面板）
 *        BjtuQwenOperationsUi.collect(list)  // 全部选中返回 null，否则返回已勾选操作名数组
 * 勾选变化与「反选」按钮会自动通过 QWEN_SETTINGS_SET 持久化，并派发
 * document 上的 'qwenOperationsPersisted'（detail.ok）事件供宿主提示。 */
(function (global) {
  'use strict';

  const NS = 'BjtuQwenOperationsUi';
  const refreshVersions = new WeakMap();

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
    const alwaysAllowedSet = new Set((options.alwaysAllowedOperations || []).map(String));

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
        const item = document.createElement('div');
        item.className = 'qwen-operation-item';
        const label = document.createElement('label');
        label.className = 'qwen-operation-enable';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.operationName = name;
        checkbox.dataset.operationSetting = 'enabled';
        checkbox.checked = isMeta || allSelected || selectedSet.has(name) || anySelected.has(name) || alwaysAllowedSet.has(name);
        checkbox.disabled = isMeta;
        const code = document.createElement('code');
        code.textContent = name;
        label.append(checkbox, code);
        item.appendChild(label);
        if (showSummary && summary) {
          const desc = document.createElement('span');
          desc.className = 'qwen-operation-item-desc';
          desc.textContent = summary;
          item.appendChild(desc);
        }
        const alwaysLabel = document.createElement('label');
        alwaysLabel.className = 'qwen-operation-always';
        alwaysLabel.title = isMeta ? '千问元操作默认在所有会话中始终允许' : `在所有会话中始终允许 ${name}`;
        const alwaysCheckbox = document.createElement('input');
        alwaysCheckbox.type = 'checkbox';
        alwaysCheckbox.dataset.operationName = name;
        alwaysCheckbox.dataset.operationSetting = 'always';
        alwaysCheckbox.checked = isMeta || alwaysAllowedSet.has(name);
        alwaysCheckbox.disabled = isMeta;
        const alwaysText = document.createElement('span');
        alwaysText.textContent = '始终允许';
        alwaysLabel.append(alwaysCheckbox, alwaysText);
        item.appendChild(alwaysLabel);
        items.appendChild(item);
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

  function renderState(list, message) {
    if (!(list instanceof HTMLElement)) return;
    list.replaceChildren();
    const state = document.createElement('div');
    state.className = 'qwen-operation-loading';
    state.textContent = String(message || '操作加载失败');
    list.appendChild(state);
  }

  function collectAlwaysAllowed(list) {
    if (!(list instanceof HTMLElement)) return [];
    return [...list.querySelectorAll('input[data-operation-setting="always"]:not(:disabled):checked')]
      .map((checkbox) => String(checkbox.dataset.operationName || ''))
      .filter(Boolean);
  }

  function collect(list) {
    if (!(list instanceof HTMLElement)) return [];
    const inputs = [...list.querySelectorAll('input[data-operation-setting="enabled"]:not(:disabled)')];
    const checked = inputs
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => String(checkbox.dataset.operationName || ''))
      .filter(Boolean);
    return inputs.length > 0 && checked.length === inputs.length ? null : checked;
  }

  async function persistAll(list) {
    const response = await send('QWEN_SETTINGS_SET', {
      enabledOperations: collect(list),
      alwaysAllowedOperations: collectAlwaysAllowed(list)
    });
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
        const name = String(event.target.dataset.operationName || '');
        if (event.target.dataset.operationSetting === 'always') {
          if (event.target.checked) {
            const enabled = [...list.querySelectorAll('input[data-operation-setting="enabled"]')]
              .find((input) => String(input.dataset.operationName || '') === name);
            if (enabled instanceof HTMLInputElement && !enabled.checked) {
              enabled.checked = true;
            }
          }
        } else {
          if (!event.target.checked) {
            const always = [...list.querySelectorAll('input[data-operation-setting="always"]')]
              .find((input) => String(input.dataset.operationName || '') === name);
            if (always instanceof HTMLInputElement && always.checked) {
              always.checked = false;
            }
          }
        }
        void persistAll(list);
      }
    });
    if (toggle instanceof HTMLButtonElement) {
      toggle.addEventListener('click', () => {
        list.querySelectorAll('input[data-operation-setting="enabled"]:not(:disabled)').forEach((checkbox) => {
          checkbox.checked = !checkbox.checked;
          if (!checkbox.checked) {
            const name = String(checkbox.dataset.operationName || '');
            const always = [...list.querySelectorAll('input[data-operation-setting="always"]')]
              .find((input) => String(input.dataset.operationName || '') === name);
            if (always instanceof HTMLInputElement) always.checked = false;
          }
        });
        void persistAll(list);
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

  async function refresh({ showLoading = false } = {}) {
    const roots = await mounted;
    const targets = roots.filter((root) => root instanceof HTMLElement && root.isConnected);
    const versions = new Map();
    for (const root of targets) {
      const version = (refreshVersions.get(root) || 0) + 1;
      refreshVersions.set(root, version);
      versions.set(root, version);
      const list = root.querySelector('[data-operation-list]');
      if (showLoading && list instanceof HTMLElement && !list.childElementCount) renderState(list, '操作加载中…');
    }
    const response = await send('QWEN_LIST_OPERATIONS');
    for (const root of targets) {
      if (refreshVersions.get(root) !== versions.get(root)) continue;
      const list = root.querySelector('[data-operation-list]');
      if (!(list instanceof HTMLElement)) continue;
      if (response?.ok === true) {
        render(
          list,
          response.groups,
          response.enabledOperations,
          !Array.isArray(response.enabledOperations),
          { alwaysAllowedOperations: response.alwaysAllowedOperations }
        );
      } else {
        renderState(list, response?.message || '操作加载失败');
      }
    }
    document.dispatchEvent(new CustomEvent('qwenOperationsRefreshed', {
      detail: { ok: response?.ok === true }
    }));
    return response;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!changes.qwenEnabledOperations && !changes.qwenAlwaysAllowedOperations) return;
    void refresh();
  });

  global[NS] = { refresh, collect, collectAlwaysAllowed };
})(globalThis);
