/* 共享的「允许 AI 调用以下操作」列表渲染。
 * 同时被 modules/qwen/options.html 与聊天面板的「操作」弹窗使用，保证两处显示一致。
 * 结构统一采用 qwen-operation-* 样式（见 operations-ui.css）。
 * 暴露：BjtuQwenOperationsUi.render(container, groups, selectedNames, allSelected, options)
 *        BjtuQwenOperationsUi.collect(container)  // 全部选中返回 null，否则返回已勾选操作名数组 */
(function (global) {
  'use strict';

  const NS = 'BjtuQwenOperationsUi';

  function render(container, groups, selectedNames, allSelected, options = {}) {
    if (!(container instanceof HTMLElement)) return;
    container.replaceChildren();
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
      container.appendChild(groupEl);
    }

    if (container.childElementCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'qwen-operation-loading';
      empty.textContent = '暂无可调用的操作';
      container.appendChild(empty);
    }
  }

  function collect(container) {
    if (!(container instanceof HTMLElement)) return [];
    const inputs = [...container.querySelectorAll('input[type="checkbox"]:not(:disabled)')];
    const checked = inputs
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => String(checkbox.dataset.operationName || ''))
      .filter(Boolean);
    return inputs.length > 0 && checked.length === inputs.length ? null : checked;
  }

  global[NS] = { render, collect };
})(globalThis);
