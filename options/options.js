let msgHideTimer = null;
function scheduleMsgHide(msg, delay) {
  if (msgHideTimer) clearTimeout(msgHideTimer);
  msgHideTimer = setTimeout(() => msg.classList.remove('show'), delay);
}

function setMsg(text, ok = true) {
  const msg = document.getElementById('msg');
  msg.textContent = text;
  msg.className = `${ok ? 'ok' : 'err'} show`;
  msg.title = '点击复制通知内容并关闭';
  const delay = ok ? 1800 : 3200;
  msg.onmouseenter = () => {
    if (msgHideTimer) clearTimeout(msgHideTimer);
  };
  msg.onmouseleave = () => scheduleMsgHide(msg, delay);
  if (msg.dataset.copyBound !== '1') {
    msg.dataset.copyBound = '1';
    msg.addEventListener('click', () => {
      const content = String(msg.textContent || '');
      if (content) navigator.clipboard.writeText(content).catch(() => {});
      if (msgHideTimer) clearTimeout(msgHideTimer);
      msg.classList.remove('show');
    });
  }
  scheduleMsgHide(msg, delay);
}

const DEFAULT_PLATFORM_ENABLED = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false, xuetangx: false };
const DEFAULT_PLATFORM_VISIBLE = { jlgj: true, mooc: true, mrjzy: true, ve: true, ykt: true, xuetangx: true };

const DEFAULT_OPEN_MODE = 'popup';
const DEFAULT_POPUP_WIDTH_PX = 500;
const DEFAULT_POPUP_HEIGHT_PX = 600;
const DEFAULT_PREFER_EXISTING_FULLSCREEN_PAGE = true;
const DEFAULT_GROUP_EXTENSION_TABS_ENABLED = false;
const DEFAULT_COURSE_HELPER_EXPANDED = false;
const DEFAULT_SHOW_COURSE_LIST_DURING_LAYOUT_TRANSITION = false;
const DEFAULT_DEADLINE_COUNTDOWN_STYLE = 'seven-seg';
const DEFAULT_MOOC_PEER_REVIEW_COUNT = 5;
const MIN_MOOC_PEER_REVIEW_COUNT = 1;
const MIN_POPUP_WIDTH_PX = 360;
const MAX_POPUP_WIDTH_PX = 800;
const MIN_POPUP_HEIGHT_PX = 420;
const MAX_POPUP_HEIGHT_PX = 600;

const DEFAULT_SAVE_UPLOADS_ENABLED = true;
const DEFAULT_POPUP_CACHE_ENABLED = true;
const DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED = false;
const DEFAULT_PARALLEL_LIMIT = 3;
const DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES = 3;
const DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES = 3;
const DEFAULT_YKT_ACTIVITY_TYPES = Object.freeze([14, 15, 5, 9]);
const DEFAULT_XUETANGX_ACTIVITY_TYPES = Object.freeze([6, 7, 8, 10, 11, 12]);
const DEFAULT_HOMEWORK_REMINDER_ENABLED = true;
const DEFAULT_HOMEWORK_REMINDER_MINUTES = [120];
const DEFAULT_THEME_MODE = 'system';
const DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED = true;
const DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED = false;
const DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES = 30;
const DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES = 30;
const MAX_SCHEDULE_INTERVAL_MINUTES = 525600;

function normalizeScheduleIntervalMinutes(value, fallback) {
  const minutes = Math.round(Number(value));
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_SCHEDULE_INTERVAL_MINUTES
    ? minutes
    : fallback;
}

function setScheduleIntervalEditor(prefix, minutes, fallback) {
  const normalized = normalizeScheduleIntervalMinutes(minutes, fallback);
  const valueInput = document.getElementById(`${prefix}Value`);
  const unitSelect = document.getElementById(`${prefix}Unit`);
  if (!(valueInput instanceof HTMLInputElement) || !(unitSelect instanceof HTMLSelectElement)) return;
  const unit = normalized % 1440 === 0 ? 1440 : (normalized % 60 === 0 ? 60 : 1);
  valueInput.value = String(normalized / unit);
  unitSelect.value = String(unit);
}

function readScheduleIntervalEditor(prefix) {
  const value = Number(document.getElementById(`${prefix}Value`)?.value || 0);
  const unit = Number(document.getElementById(`${prefix}Unit`)?.value || 1);
  const minutes = Math.round(value * unit);
  return Number.isFinite(value) && Number.isFinite(unit) && value >= 1
    && minutes >= 1 && minutes <= MAX_SCHEDULE_INTERVAL_MINUTES
    ? minutes
    : NaN;
}

function normalizeHomeworkReminderMinutes(value) {
  const source = Array.isArray(value) ? value : DEFAULT_HOMEWORK_REMINDER_MINUTES;
  return [...new Set(source.map(Number)
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600)
    .map((minutes) => Math.round(minutes)))]
    .sort((a, b) => b - a);
}

function formatHomeworkReminderMinutes(minutes) {
  if (minutes % 1440 === 0) return `提前 ${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时`;
  return `提前 ${minutes} 分钟`;
}

function formatShanghaiDateForFile(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizePlatformEnabled(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const result = {
    jlgj: typeof src.jlgj === 'boolean' ? src.jlgj : DEFAULT_PLATFORM_ENABLED.jlgj,
    mooc: typeof src.mooc === 'boolean' ? src.mooc : DEFAULT_PLATFORM_ENABLED.mooc,
    mrjzy: typeof src.mrjzy === 'boolean' ? src.mrjzy : DEFAULT_PLATFORM_ENABLED.mrjzy,
    ve: typeof src.ve === 'boolean' ? src.ve : DEFAULT_PLATFORM_ENABLED.ve,
    ykt: typeof src.ykt === 'boolean' ? src.ykt : DEFAULT_PLATFORM_ENABLED.ykt,
    xuetangx: typeof src.xuetangx === 'boolean' ? src.xuetangx : DEFAULT_PLATFORM_ENABLED.xuetangx
  };
  ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx'].forEach((id) => {
    if (globalThis.BjtuModuleRegistry && !globalThis.BjtuModuleRegistry.has(id)) result[id] = false;
  });
  return result;
}

function normalizePlatformVisible(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return Object.fromEntries(Object.keys(DEFAULT_PLATFORM_VISIBLE).map((key) => [
    key,
    typeof src[key] === 'boolean' ? src[key] : DEFAULT_PLATFORM_VISIBLE[key]
  ]));
}

function normalizeDeadlineCountdownStyle(value) {
  return ['normal', 'seven-seg', 'none'].includes(value) ? value : DEFAULT_DEADLINE_COUNTDOWN_STYLE;
}

function normalizePopupDimension(value, fallback, min, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeDetailCollapsedLines(value, fallback = 3) {
  if (value === '' || value === null || value === undefined) return fallback;
  const lines = Number(value);
  return Number.isFinite(lines) && lines >= 0 ? Math.trunc(lines) : fallback;
}

function normalizeParallelLimit(value, fallback = DEFAULT_PARALLEL_LIMIT) {
  const limit = Math.trunc(Number(value));
  return Number.isFinite(limit) && limit > 0 ? limit : fallback;
}

function normalizeMoocPeerReviewCount(value, fallback = DEFAULT_MOOC_PEER_REVIEW_COUNT) {
  if (value === '' || value === null || value === undefined) return fallback;
  const count = Math.trunc(Number(value));
  return Number.isFinite(count)
    ? Math.max(MIN_MOOC_PEER_REVIEW_COUNT, count)
    : fallback;
}

function updateMoocPeerReviewState() {
  const enabled = document.getElementById('injectMoocPeerReviewEnabled')?.checked === true;
  const editor = document.getElementById('moocPeerReviewCountEditor');
  const input = document.getElementById('moocPeerReviewCount');
  if (input instanceof HTMLInputElement) input.disabled = !enabled;
  if (editor instanceof HTMLElement) {
    editor.style.setProperty('opacity', enabled ? '' : '.5');
    editor.style.setProperty('pointer-events', enabled ? '' : 'none');
  }
}

const FALLBACK_OPTIONS_SECTION_ORDER = ['appearance', 'platforms', 'popup', 'reminders', 'updater', 'module:campusnet', 'module:captcha', 'module:academic', 'module:cas', 'module:mail', 'module:qwen'];
const FALLBACK_PLATFORM_ORDER = ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx'];
const PLATFORM_ORDER_LABELS = {
  ve: '智慧课程平台',
  ykt: '雨课堂',
  mrjzy: '每日交作业',
  jlgj: '接龙管家',
  mooc: '中国大学MOOC',
  xuetangx: '学堂在线'
};
let currentOptionsSectionOrder = [...FALLBACK_OPTIONS_SECTION_ORDER];
let currentPlatformOrder = [...FALLBACK_PLATFORM_ORDER];
let uiOrderEditorReady = false;

function normalizeOptionsSectionOrder(raw) {
  return globalThis.BjtuUiOrder?.normalizeOptionsSections(raw)
    || [...FALLBACK_OPTIONS_SECTION_ORDER];
}

function normalizePlatformOrder(raw) {
  return globalThis.BjtuUiOrder?.normalizePlatforms(raw)
    || [...FALLBACK_PLATFORM_ORDER];
}

function getPresentOptionsSections() {
  const main = document.getElementById('options-controlled-content');
  if (!main) return [];
  return [...main.querySelectorAll(':scope > [data-options-section]')].map((element) => ({
    id: String(element.dataset.optionsSection || ''),
    label: String(element.dataset.optionsLabel || element.querySelector('.section-title')?.textContent || element.dataset.optionsSection || '').trim(),
    element
  })).filter((item) => item.id);
}

function applyOptionsSectionOrder(order = currentOptionsSectionOrder) {
  const main = document.getElementById('options-controlled-content');
  if (!main) return;
  const entries = getPresentOptionsSections();
  const byId = new Map(entries.map((item) => [item.id, item.element]));
  order.forEach((id) => {
    const element = byId.get(id);
    if (element) main.appendChild(element);
  });
  entries.forEach(({ id, element }) => {
    if (!order.includes(id)) main.appendChild(element);
  });
}

function applyPlatformOrderToOptions(order = currentPlatformOrder) {
  const container = document.getElementById('platform-options-title')?.parentElement;
  if (!container) return;
  const anchor = container.querySelector(':scope > .tip[data-tip-target="#platform-options-title"]');
  const beforeAnchor = (element) => {
    if (anchor) anchor.before(element);
    else container.appendChild(element);
  };
  order.forEach((id) => {
    const choice = container.querySelector(`:scope > .platform-option[data-module="${id}"]`);
    if (choice) beforeAnchor(choice);
    const detail = container.querySelector(`:scope > .platform-option-detail[data-module="${id}"]`);
    if (detail) beforeAnchor(detail);
  });
  container.querySelectorAll(':scope > .platform-option, :scope > .platform-option-detail').forEach((element) => {
    if (!order.includes(String(element.dataset.module || ''))) beforeAnchor(element);
  });
}

function renderUiOrderList(containerId, entries, group) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.replaceChildren();
  entries.forEach((entry, index) => {
    const item = document.createElement('div');
    item.className = 'ui-order-item';
    item.draggable = true;
    item.dataset.orderId = entry.id;
    item.dataset.orderGroup = group;
    item.innerHTML = `
      <span class="ui-order-grip" title="拖动排序" aria-hidden="true">⋮⋮</span>
      <span class="ui-order-label"></span>
      <button type="button" class="ui-order-move" data-direction="-1" title="上移" aria-label="上移">↑</button>
      <button type="button" class="ui-order-move" data-direction="1" title="下移" aria-label="下移">↓</button>`;
    item.querySelector('.ui-order-label').textContent = entry.label;
    item.querySelector('[data-direction="-1"]').disabled = index === 0;
    item.querySelector('[data-direction="1"]').disabled = index === entries.length - 1;
    container.appendChild(item);
  });
}

function getVisibleOptionsOrderEntries() {
  const labels = new Map(getPresentOptionsSections().map((item) => [item.id, item.label]));
  return currentOptionsSectionOrder
    .filter((id) => labels.has(id))
    .map((id) => ({ id, label: labels.get(id) }));
}

function getVisiblePlatformOrderEntries() {
  const available = globalThis.__bjtuAvailableModules || {};
  return currentPlatformOrder
    .filter((id) => available[id] === true)
    .map((id) => ({ id, label: PLATFORM_ORDER_LABELS[id] || id }));
}

function renderUiOrderEditor() {
  renderUiOrderList('optionsSectionOrderList', getVisibleOptionsOrderEntries(), 'sections');
  renderUiOrderList('platformOrderList', getVisiblePlatformOrderEntries(), 'platforms');
}

function applyInstalledModuleListOrder(
  sectionOrder = currentOptionsSectionOrder,
  platformOrder = currentPlatformOrder
) {
  const list = document.getElementById('installedModuleList');
  const definitions = globalThis.BjtuModuleRegistry?.definitions || {};
  if (!(list instanceof HTMLElement)) return;
  const items = new Map([...list.querySelectorAll(':scope > .installed-module-item')]
    .map((item) => [String(item.dataset.moduleId || ''), item]));
  buildInstalledModuleOrderedIds(definitions, sectionOrder, platformOrder).forEach((id) => {
    const item = items.get(id);
    if (item) list.appendChild(item);
  });
}

async function saveUiOrder(group, visibleOrder) {
  if (group === 'sections') {
    const visibleSet = new Set(visibleOrder);
    currentOptionsSectionOrder = normalizeOptionsSectionOrder([
      ...visibleOrder,
      ...currentOptionsSectionOrder.filter((id) => !visibleSet.has(id))
    ]);
    applyOptionsSectionOrder();
    await chrome.storage.local.set({ optionsSectionOrder: currentOptionsSectionOrder });
  } else {
    const visibleSet = new Set(getVisiblePlatformOrderEntries().map((entry) => entry.id));
    const reorderedVisible = [...visibleOrder];
    currentPlatformOrder = normalizePlatformOrder(currentPlatformOrder.map((id) => (
      visibleSet.has(id) ? reorderedVisible.shift() : id
    )));
    applyPlatformOrderToOptions();
    await chrome.storage.local.set({ platformOrder: currentPlatformOrder });
  }
  applyInstalledModuleListOrder();
  renderUiOrderEditor();
  setMsg('已应用排序');
}

function setupUiOrderEditor(rawSectionOrder, rawPlatformOrder) {
  currentOptionsSectionOrder = normalizeOptionsSectionOrder(rawSectionOrder);
  currentPlatformOrder = normalizePlatformOrder(rawPlatformOrder);
  applyOptionsSectionOrder();
  applyPlatformOrderToOptions();
  renderUiOrderEditor();
  if (uiOrderEditorReady) return;
  uiOrderEditorReady = true;

  let dragged = null;
  document.querySelectorAll('.ui-order-list').forEach((list) => {
    let dropTarget = null;
    let dropAfter = false;
    let itemDocumentMidpoints = new Map();

    list.addEventListener('click', (event) => {
      const button = event.target.closest('.ui-order-move');
      const item = button?.closest('.ui-order-item');
      if (!button || !item) return;
      const group = String(item.dataset.orderGroup || '');
      const entries = group === 'sections' ? getVisibleOptionsOrderEntries() : getVisiblePlatformOrderEntries();
      const ids = entries.map((entry) => entry.id);
      const index = ids.indexOf(String(item.dataset.orderId || ''));
      const targetIndex = index + Number(button.dataset.direction || 0);
      if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) return;
      [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
      void saveUiOrder(group, ids);
    });
    const clearDropIndicator = () => {
      if (dropTarget) dropTarget.classList.remove('drop-before', 'drop-after');
      dropTarget = null;
      dropAfter = false;
    };
    const setDropIndicator = (target, insertAfter) => {
      if (dropTarget === target && dropAfter === insertAfter) return;
      clearDropIndicator();
      dropTarget = target;
      dropAfter = insertAfter;
      target.classList.add(insertAfter ? 'drop-after' : 'drop-before');
    };
    const isAfterItemMidpoint = (item, clientY) => {
      const id = String(item.dataset.orderId || '');
      let midpoint = itemDocumentMidpoints.get(id);
      if (!Number.isFinite(midpoint)) {
        const rect = item.getBoundingClientRect();
        midpoint = rect.top + window.scrollY + rect.height / 2;
        itemDocumentMidpoints.set(id, midpoint);
      }
      return clientY + window.scrollY > midpoint;
    };
    list.addEventListener('dragstart', (event) => {
      const item = event.target.closest('.ui-order-item');
      if (!item) return;
      dragged = { id: String(item.dataset.orderId || ''), group: String(item.dataset.orderGroup || '') };
      item.classList.add('dragging');
      itemDocumentMidpoints = new Map([...list.querySelectorAll(':scope > .ui-order-item')].map((entry) => {
        const rect = entry.getBoundingClientRect();
        return [String(entry.dataset.orderId || ''), rect.top + window.scrollY + rect.height / 2];
      }));
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragged.id);
      }
    });
    list.addEventListener('dragend', (event) => {
      event.target.closest('.ui-order-item')?.classList.remove('dragging');
      clearDropIndicator();
      itemDocumentMidpoints.clear();
      dragged = null;
    });
    list.addEventListener('dragover', (event) => {
      const target = event.target.closest('.ui-order-item');
      if (!target || !dragged || target.dataset.orderGroup !== dragged.group) return;
      event.preventDefault();
      if (target.dataset.orderId === dragged.id) {
        clearDropIndicator();
        return;
      }
      setDropIndicator(target, isAfterItemMidpoint(target, event.clientY));
    });
    list.addEventListener('dragleave', (event) => {
      if (!list.contains(event.relatedTarget)) clearDropIndicator();
    });
    list.addEventListener('drop', (event) => {
      const target = event.target.closest('.ui-order-item');
      if (!target || !dragged || target.dataset.orderGroup !== dragged.group) return;
      event.preventDefault();
      const draggedId = dragged.id;
      const draggedGroup = dragged.group;
      const insertAfter = dropTarget === target
        ? dropAfter
        : isAfterItemMidpoint(target, event.clientY);
      clearDropIndicator();
      const entries = draggedGroup === 'sections' ? getVisibleOptionsOrderEntries() : getVisiblePlatformOrderEntries();
      const ids = entries.map((entry) => entry.id).filter((id) => id !== draggedId);
      const targetIndex = ids.indexOf(String(target.dataset.orderId || ''));
      if (targetIndex < 0) return;
      ids.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedId);
      void saveUiOrder(draggedGroup, ids);
    });
  });
}

function formatModuleBytes(bytes) {
  return globalThis.BjtuFileSizeEmphasis.formatBytes(bytes);
}

function escapeOptionsHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function renderInstalledModuleFileSize(bytes) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const style = globalThis.BjtuFileSizeEmphasis.buildBytesStyle(safeBytes);
  const text = typeof globalThis.formatDownloadBytes === 'function'
    ? globalThis.formatDownloadBytes(safeBytes)
    : formatModuleBytes(safeBytes);
  return `<span class="file-size-emphasis" data-file-size-bytes="${safeBytes}" style="${escapeOptionsHtml(style)}">${escapeOptionsHtml(text)}</span>`;
}

function buildInstalledModuleProgressHtml(state) {
  if (!state) return '';
  if (state.mode === 'download') {
    const separator = state.total > 0
      ? ` <span class="option-download-progress-separator">/</span> ${renderInstalledModuleFileSize(state.total)}`
      : '';
    return `正在下载程序包：${renderInstalledModuleFileSize(state.completed)}${separator}`;
  }
  if (state.mode === 'write') {
    return `正在安装模块：${state.completed} / ${state.total}${state.path ? ` · ${escapeOptionsHtml(state.path)}` : ''}`;
  }
  return escapeOptionsHtml(state.text);
}

let installedModuleProgressState = null;

window.addEventListener('bjtu-theme-change', () => {
  if (!installedModuleProgressState) return;
  const label = document.getElementById('installedModuleProgressLabel');
  if (label instanceof HTMLElement) {
    label.innerHTML = buildInstalledModuleProgressHtml(installedModuleProgressState);
  }
});

const INSTALLABLE_PLATFORM_MODULE_IDS = ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx'];

// 已安装模块列表遵循「排序」编辑器的顺序：六个平台在「平台显示与加载」所在位置展开，
// 更新组件在「更新」所在位置，其余模块在各自模块选项所在位置。
function buildInstalledModuleOrderedIds(definitions, rawSectionOrder, rawPlatformOrder) {
  const sectionOrder = normalizeOptionsSectionOrder(rawSectionOrder);
  const platformOrder = normalizePlatformOrder(rawPlatformOrder);
  const ids = Object.keys(definitions || {});
  const byId = new Set(ids);
  const ordered = [];
  const seen = new Set();
  const push = (id) => {
    const key = String(id || '');
    if (byId.has(key) && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  };
  for (const sectionId of sectionOrder) {
    if (sectionId === 'platforms') {
      platformOrder.forEach(push);
      INSTALLABLE_PLATFORM_MODULE_IDS.forEach(push);
    } else if (sectionId === 'updater') {
      push('updater');
    } else if (sectionId.startsWith('module:')) {
      push(sectionId.slice('module:'.length));
    }
  }
  ids.forEach(push);
  return ordered;
}

async function getInstalledModuleOrderedIds(definitions) {
  const stored = await chrome.storage.local.get(['optionsSectionOrder', 'platformOrder']).catch(() => ({}));
  return buildInstalledModuleOrderedIds(
    definitions,
    stored?.optionsSectionOrder,
    stored?.platformOrder
  );
}

async function setupInstalledModuleOptions() {
  const list = document.getElementById('installedModuleList');
  const applyButton = document.getElementById('applyInstalledModules');
  const status = document.getElementById('installedModuleStatus');
  const progressElement = document.getElementById('installedModuleProgress');
  const progressLabel = document.getElementById('installedModuleProgressLabel');
  const progressBar = document.getElementById('installedModuleProgressBar');
  if (!(list instanceof HTMLElement) || !(applyButton instanceof HTMLButtonElement)) return;

  const updateProgress = ({ visible = true, label = '', mode = 'plain', completed = 0, total = 0, path = '' } = {}) => {
    if (!(progressElement instanceof HTMLElement)
        || !(progressLabel instanceof HTMLElement)
        || !(progressBar instanceof HTMLElement)) return;
    progressElement.hidden = !visible;
    if (!visible) {
      installedModuleProgressState = null;
      return;
    }
    installedModuleProgressState = { mode, text: label, completed: Math.max(0, Number(completed) || 0), total: Math.max(0, Number(total) || 0), path };
    progressLabel.innerHTML = buildInstalledModuleProgressHtml(installedModuleProgressState);
    const determinate = Number(total) > 0;
    progressElement.classList.toggle('is-indeterminate', !determinate);
    progressBar.style.width = determinate
      ? `${Math.min(100, Math.max(0, Number(completed) || 0) / Number(total) * 100)}%`
      : '';
  };

  const definitions = globalThis.BjtuModuleRegistry?.definitions || {};
  const available = await globalThis.BjtuModuleRegistry.ready;
  const activationKeys = Object.values(definitions)
    .map((definition) => String(definition?.activationKey || ''))
    .filter(Boolean);
  const activationState = activationKeys.length
    ? await chrome.storage.local.get(activationKeys)
    : {};
  const updaterReady = await globalThis.__bjtuUpdaterReady;
  if (updaterReady && globalThis.BjtuUpdaterModuleManager?.prepare) {
    await globalThis.BjtuUpdaterModuleManager.prepare().catch(() => null);
  }
  const installed = new Set(Object.keys(definitions).filter((id) => available[id] === true));
  list.innerHTML = '';
  const orderedIds = await getInstalledModuleOrderedIds(definitions);
  orderedIds.forEach((id) => {
    const definition = definitions[id];
    if (!definition) return;
    if (definition.activationKey && activationState[definition.activationKey] !== true) return;
    const label = document.createElement('label');
    label.className = 'installed-module-item';
    label.dataset.moduleId = id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = installed.has(id);
    checkbox.disabled = installed.has(id) && (id === 've' || id === 'updater');
    label.append(checkbox, document.createTextNode(definition.label || id));
    list.appendChild(label);
  });

  const selectedIds = () => [...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  const hasChanges = () => {
    const selected = new Set(selectedIds());
    return Object.keys(definitions).some((id) => selected.has(id) !== installed.has(id));
  };
  const refreshButton = () => { applyButton.disabled = !hasChanges(); };
  list.addEventListener('click', (event) => {
    const item = event.target instanceof Element
      ? event.target.closest('.installed-module-item')
      : null;
    if (!(item instanceof HTMLElement)
        || !installed.has(item.dataset.moduleId || '')
        || !['ve', 'updater'].includes(item.dataset.moduleId || '')) return;
    event.preventDefault();
    setMsg('不可卸载此模块，但您可前往扩展安装目录手动删除，可能引发异常问题', false);
  });
  list.addEventListener('change', refreshButton);
  refreshButton();
  if (status instanceof HTMLElement) status.textContent = `已安装 ${installed.size} 个模块。取消勾选可卸载，勾选未安装模块可安装。`;

  applyButton.addEventListener('click', async () => {
    if (!hasChanges()) return;
    applyButton.disabled = true;
    list.querySelectorAll('input').forEach((input) => { input.disabled = true; });
    if (status instanceof HTMLElement) status.style.display = 'none';
    updateProgress({ label: '正在准备模块更改…' });
    try {
      const manager = updaterReady && globalThis.BjtuUpdaterModuleManager;
      if (!manager?.applyModuleSelection) throw new Error('updater 模块未能加载');
      const result = await manager.applyModuleSelection({
        selected: selectedIds(),
        installed: [...installed],
        onProgress(progress) {
          if (progress.phase === 'download') {
            updateProgress({
              mode: 'download',
              completed: Math.max(0, Number(progress.loaded) || 0),
              total: Math.max(0, Number(progress.total) || 0)
            });
          } else if (progress.phase === 'write') {
            updateProgress({
              mode: 'write',
              completed: Math.max(0, Number(progress.completed) || 0),
              total: Math.max(0, Number(progress.total) || 0),
              path: String(progress.path || '')
            });
          }
        }
      });
      const changes = [
        result.added.length ? `安装 ${result.added.length} 个` : '',
        result.removed.length ? `卸载 ${result.removed.length} 个` : ''
      ].filter(Boolean).join('，');
      const reloadRequired = result.reload !== false;
      const completionText = reloadRequired
        ? `模块更改完成（${changes}），正在重新加载扩展…`
        : `模块更改完成（${changes}），正在刷新已打开的全屏页面…`;
      if (status instanceof HTMLElement) status.textContent = completionText;
      updateProgress({
        label: completionText,
        completed: 1,
        total: 1
      });
      setMsg(`模块更改完成：${changes}`);
      if (reloadRequired) {
        const popup = new URLSearchParams(location.search).get('popup') === '1';
        await chrome.runtime.sendMessage({
          type: 'PREPARE_APP_RESTORE_AFTER_RELOAD',
          payload: {
            source: 'module-selection',
            fileCount: Number(result.written || 0),
            restoreOptionsPath: popup ? '' : 'options/options.html'
          }
        });
        setTimeout(() => chrome.runtime.reload(), 1000);
      } else {
        await chrome.runtime.sendMessage({ type: 'REFRESH_OPEN_APP_PAGES' }).catch(() => null);
        if (status instanceof HTMLElement) status.textContent = `模块更改完成（${changes}）`;
        updateProgress({ visible: false });
      }
    } catch (error) {
      if (status instanceof HTMLElement) {
        status.style.display = '';
        status.textContent = `模块更改失败：${String(error?.message || error)}`;
      }
      updateProgress({ visible: false });
      setMsg(`模块更改失败：${String(error?.message || error)}`, false);
      list.querySelectorAll('input').forEach((input) => {
        input.disabled = installed.has(input.value) && (input.value === 've' || input.value === 'updater');
      });
      refreshButton();
    }
  });
}

function goBackToApp() {
  // options.html is opened either as a top-level options page, or embedded inside the
  // popup iframe by app.html's ⚙️ button. Detect which one and route accordingly.
  const inPopup = new URLSearchParams(String(location.search || '')).get('popup') === '1';
  if (inPopup) {
    try { window.location.href = '../app/app.html?popup=1'; return; } catch {}
  }
  const appUrl = chrome.runtime.getURL('app/app.html');
  try {
    chrome.runtime.sendMessage({ type: 'OPEN_APP' }, (result) => {
      if (chrome.runtime.lastError) {
        try { window.location.href = appUrl; } catch {}
        return;
      }
      if (result?.ok) try { window.close(); } catch {}
      else try { window.location.href = appUrl; } catch {}
    });
  } catch {
    try { window.location.href = appUrl; } catch {}
  }
}

const EXTENSION_RUNTIME_STORAGE_KEYS = ['extensionInstalledAt', 'extensionLastReloadedAt'];

function formatExtensionRuntimeTime(value) {
  const timestamp = Number(value);
  if (!(timestamp > 0)) return '尚未记录';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '尚未记录';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function renderExtensionRuntimeInfo() {
  const versionEl = document.getElementById('extension-version');
  const installedEl = document.getElementById('extension-installed-at');
  const reloadedEl = document.getElementById('extension-reloaded-at');
  if (!versionEl || !installedEl || !reloadedEl) return;
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = manifest.version_name || manifest.version || '未知';
  const stored = await chrome.storage.local.get(EXTENSION_RUNTIME_STORAGE_KEYS).catch(() => ({}));
  installedEl.textContent = formatExtensionRuntimeTime(stored.extensionInstalledAt);
  reloadedEl.textContent = formatExtensionRuntimeTime(stored.extensionLastReloadedAt);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && EXTENSION_RUNTIME_STORAGE_KEYS.some((key) => changes[key])) {
    void renderExtensionRuntimeInfo();
  }
});

(async function init() {
  void renderExtensionRuntimeInfo();
  await globalThis.BjtuModuleRegistry?.ready;
  await globalThis.__bjtuOptionsModulesReady;
  globalThis.BjtuOptionTips?.setup?.();
  await globalThis.__bjtuVeOptionsReady;
  await globalThis.BjtuOptionsModules?.initAll({ setMessage: setMsg });
  await setupInstalledModuleOptions();
  const storedUiOrder = await chrome.storage.local.get(['optionsSectionOrder', 'platformOrder']);
  setupUiOrderEditor(storedUiOrder.optionsSectionOrder, storedUiOrder.platformOrder);
  const { platformEnabled, platformVisible, injectMoocHelperEnabled, injectMoocPeerReviewEnabled, moocPeerReviewCount, homeworkReminderEnabled, homeworkReminderMinutes, homeworkBackgroundRefreshEnabled, homeworkBackgroundRefreshAccount, homeworkBackgroundRefreshIntervalMinutes, homeworkNewAssignmentNotificationEnabled, homeworkBackgroundRefreshStatus, systemNotificationStatus, themeMode, jlgjDarkModeEnabled, jlgjAlwaysDarkModeEnabled, homeworkDetailCollapsedLines, replayDetailCollapsedLines, parallelLimit, backgroundAutoUpdateEnabled, backgroundAutoInstallOptionalEnabled, backgroundAutoUpdateStatus, backgroundAutoUpdateIntervalMinutes, popupWidthPx, popupHeightPx, courseHelperExpandedByDefault, showCourseListDuringLayoutTransition, deadlineCountdownStyle, toolbarPinReminderEnabled, groupExtensionTabsEnabled } = await chrome.storage.local.get([
    'platformEnabled', 'platformVisible', 'injectMoocHelperEnabled', 'injectMoocPeerReviewEnabled', 'moocPeerReviewCount', 'homeworkReminderEnabled', 'homeworkReminderMinutes', 'homeworkBackgroundRefreshEnabled', 'homeworkBackgroundRefreshAccount', 'homeworkBackgroundRefreshIntervalMinutes', 'homeworkNewAssignmentNotificationEnabled', 'homeworkBackgroundRefreshStatus', 'systemNotificationStatus', 'themeMode', 'jlgjDarkModeEnabled', 'jlgjAlwaysDarkModeEnabled', 'homeworkDetailCollapsedLines', 'replayDetailCollapsedLines', 'parallelLimit', 'backgroundAutoUpdateEnabled', 'backgroundAutoInstallOptionalEnabled', 'backgroundAutoUpdateStatus', 'backgroundAutoUpdateIntervalMinutes', 'popupWidthPx', 'popupHeightPx', 'courseHelperExpandedByDefault', 'showCourseListDuringLayoutTransition', 'deadlineCountdownStyle', 'toolbarPinReminderEnabled', 'groupExtensionTabsEnabled'
  ]);
  const { yktActivityTypes, xuetangxCourseStatuses, xuetangxActivityTypes } = await chrome.storage.local.get([
    'yktActivityTypes',
    'xuetangxCourseStatuses',
    'xuetangxActivityTypes'
  ]);
  try { await chrome.storage.sync.remove(['platformEnabled']); } catch {}
  const { openMode, preferExistingFullscreenPage } = await chrome.storage.local.get(['openMode', 'preferExistingFullscreenPage']);
  const { autoLoadCourseResourcesEnabled } = await chrome.storage.local.get(['autoLoadCourseResourcesEnabled']);
  const { saveUploadedFilesEnabled } = await chrome.storage.local.get(['saveUploadedFilesEnabled']);
  const { linkQrEnabled } = await chrome.storage.local.get(['linkQrEnabled']);
  const { popupUseFullscreenCacheEnabled } = await chrome.storage.local.get(['popupUseFullscreenCacheEnabled']);
  const {
    injectPortalLoginOnLoginPage,
    injectPortalLoginOnTimeoutPage
  } = await chrome.storage.local.get([
    'injectPortalLoginOnLoginPage',
    'injectPortalLoginOnTimeoutPage'
  ]);
  const enabled = normalizePlatformEnabled(platformEnabled);
  const visible = normalizePlatformVisible(platformVisible);
  const effectiveEnabled = Object.fromEntries(Object.keys(DEFAULT_PLATFORM_ENABLED).map((key) => [
    key,
    !!enabled[key] && !!visible[key]
  ]));

  document.getElementById('enableVe').checked = !!effectiveEnabled.ve;
  document.getElementById('enableYkt').checked = !!effectiveEnabled.ykt;
  document.getElementById('enableMrjzy').checked = !!effectiveEnabled.mrjzy;
  document.getElementById('enableJlgj').checked = !!effectiveEnabled.jlgj;
  document.getElementById('enableMooc').checked = !!effectiveEnabled.mooc;
  document.getElementById('enableXuetangx').checked = !!effectiveEnabled.xuetangx;
  const visibleXuetangxStatuses = Array.isArray(xuetangxCourseStatuses) && xuetangxCourseStatuses.length
    ? new Set(xuetangxCourseStatuses.map(Number))
    : new Set([1]);
  document.querySelectorAll('.xuetangx-course-status').forEach((input) => {
    input.checked = visibleXuetangxStatuses.has(Number(input.value));
  });
  const visibleYktActivityTypes = new Set(
    Array.isArray(yktActivityTypes) ? yktActivityTypes.map(Number) : DEFAULT_YKT_ACTIVITY_TYPES
  );
  document.querySelectorAll('.ykt-activity-type').forEach((input) => {
    input.checked = visibleYktActivityTypes.has(Number(input.value));
  });
  const visibleXuetangxActivityTypes = new Set(
    Array.isArray(xuetangxActivityTypes) ? xuetangxActivityTypes.map(Number) : DEFAULT_XUETANGX_ACTIVITY_TYPES
  );
  document.querySelectorAll('.xuetangx-activity-type').forEach((input) => {
    input.checked = visibleXuetangxActivityTypes.has(Number(input.value));
  });
  Object.entries(visible).forEach(([key, value]) => {
    const id = 'show' + key.charAt(0).toUpperCase() + key.slice(1);
    document.getElementById(id).checked = !!value;
  });
  if (Object.keys(effectiveEnabled).some((key) => effectiveEnabled[key] !== enabled[key])) {
    await chrome.storage.local.set({ platformEnabled: effectiveEnabled });
  }
  document.getElementById('injectMoocHelperEnabled').checked = injectMoocHelperEnabled !== false;
  document.getElementById('injectMoocPeerReviewEnabled').checked = injectMoocPeerReviewEnabled !== false;
  document.getElementById('moocPeerReviewCount').value = String(normalizeMoocPeerReviewCount(moocPeerReviewCount));
  updateMoocPeerReviewState();
  document.getElementById('jlgjDarkModeEnabled').checked = jlgjDarkModeEnabled !== false;
  document.getElementById('jlgjAlwaysDarkModeEnabled').checked = jlgjAlwaysDarkModeEnabled === true;
  document.getElementById('homeworkDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
    homeworkDetailCollapsedLines,
    DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES
  ));
  document.getElementById('replayDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
    replayDetailCollapsedLines,
    DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES
  ));
  document.getElementById('parallelLimit').value = String(normalizeParallelLimit(parallelLimit));
  const autoLoadResourcesVal = autoLoadCourseResourcesEnabled === undefined
    ? DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED
    : !!autoLoadCourseResourcesEnabled;
  document.getElementById('autoLoadCourseResourcesEnabled').checked = autoLoadResourcesVal;
  const mode = String(openMode || DEFAULT_OPEN_MODE);
  document.getElementById('openModePopup').checked = mode === 'popup';
  document.getElementById('openModePage').checked = mode === 'page';
  document.getElementById('preferExistingFullscreenPage').checked = preferExistingFullscreenPage === undefined
    ? DEFAULT_PREFER_EXISTING_FULLSCREEN_PAGE
    : preferExistingFullscreenPage === true;
  document.getElementById('groupExtensionTabsEnabled').checked = groupExtensionTabsEnabled === true;
  document.getElementById('popupWidthPx').value = String(normalizePopupDimension(
    popupWidthPx,
    DEFAULT_POPUP_WIDTH_PX,
    MIN_POPUP_WIDTH_PX,
    MAX_POPUP_WIDTH_PX
  ));
  document.getElementById('popupHeightPx').value = String(normalizePopupDimension(
    popupHeightPx,
    DEFAULT_POPUP_HEIGHT_PX,
    MIN_POPUP_HEIGHT_PX,
    MAX_POPUP_HEIGHT_PX
  ));
  document.getElementById('courseHelperExpandedByDefault').checked = courseHelperExpandedByDefault === true;
  document.getElementById('showCourseListDuringLayoutTransition').checked = showCourseListDuringLayoutTransition === true;
  document.getElementById('deadlineCountdownStyle').value = normalizeDeadlineCountdownStyle(deadlineCountdownStyle);
  const saveUploadsVal = saveUploadedFilesEnabled === undefined
    ? DEFAULT_SAVE_UPLOADS_ENABLED
    : !!saveUploadedFilesEnabled;
  document.getElementById('saveUploadsEnabled').checked = saveUploadsVal;
  document.getElementById('headerQrEnabled').checked = false;
  document.getElementById('headerQrEnabled').disabled = true;
  const linkQrVal = linkQrEnabled === undefined ? true : !!linkQrEnabled;
  document.getElementById('linkQrEnabled').checked = linkQrVal;
  const popupCacheVal = popupUseFullscreenCacheEnabled === undefined
    ? DEFAULT_POPUP_CACHE_ENABLED
    : !!popupUseFullscreenCacheEnabled;
  document.getElementById('popupUseFullscreenCacheEnabled').checked = popupCacheVal;
  document.getElementById('injectPortalLoginOnLoginPage').checked = injectPortalLoginOnLoginPage !== false;
  document.getElementById('injectPortalLoginOnTimeoutPage').checked = injectPortalLoginOnTimeoutPage !== false;
  document.getElementById('homeworkReminderEnabled').checked = homeworkReminderEnabled === undefined
    ? DEFAULT_HOMEWORK_REMINDER_ENABLED
    : !!homeworkReminderEnabled;
  document.getElementById('toolbarPinReminderEnabled').checked = toolbarPinReminderEnabled !== false;
  document.getElementById('homeworkBackgroundRefreshEnabled').checked = homeworkBackgroundRefreshEnabled === true;
  document.getElementById('homeworkNewAssignmentNotificationEnabled').checked = homeworkNewAssignmentNotificationEnabled === true;
  document.getElementById('backgroundAutoUpdateEnabled').checked = backgroundAutoUpdateEnabled === undefined
    ? DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED
    : backgroundAutoUpdateEnabled === true;
  document.getElementById('backgroundAutoInstallOptionalEnabled').checked = backgroundAutoInstallOptionalEnabled === true;
  setScheduleIntervalEditor('backgroundAutoUpdateInterval', backgroundAutoUpdateIntervalMinutes, DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES);
  setScheduleIntervalEditor('homeworkBackgroundRefreshInterval', homeworkBackgroundRefreshIntervalMinutes, DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES);
  updateThemeModeUi(themeMode);
  let currentHomeworkReminderMinutes = normalizeHomeworkReminderMinutes(homeworkReminderMinutes);
  let currentHomeworkBackgroundRefreshAccount = String(homeworkBackgroundRefreshAccount || '').trim();
  let portalLoginContext = await chrome.runtime.sendMessage({ type: 'PORTAL_LOGIN_CONTEXT' }).catch(() => null);
  const backgroundAutoUpdateStatusEl = document.getElementById('backgroundAutoUpdateStatus');
  const homeworkBackgroundRefreshInput = document.getElementById('homeworkBackgroundRefreshEnabled');
  const homeworkBackgroundRefreshAccountSelect = document.getElementById('homeworkBackgroundRefreshAccount');
  const homeworkNewAssignmentNotificationInput = document.getElementById('homeworkNewAssignmentNotificationEnabled');
  const homeworkBackgroundRefreshStatusEl = document.getElementById('homeworkBackgroundRefreshStatus');
  const systemNotificationStatusEl = document.getElementById('systemNotificationStatus');

  const renderSystemNotificationStatus = (status) => {
    if (!(systemNotificationStatusEl instanceof HTMLElement)) return;
    if (!status || typeof status !== 'object') {
      systemNotificationStatusEl.textContent = '尚未测试系统通知。';
      return;
    }
    const time = formatExtensionRuntimeTime(status.attemptedAt);
    systemNotificationStatusEl.textContent = status.status === 'success'
      ? `浏览器已于 ${time} 创建系统通知。`
      : `最近创建失败：${String(status.error || '未知错误')}`;
  };
  renderSystemNotificationStatus(systemNotificationStatus);

  const renderBackgroundAutoUpdateStatus = (status) => {
    if (!(backgroundAutoUpdateStatusEl instanceof HTMLElement)) return;
    const enabled = !!document.getElementById('backgroundAutoUpdateEnabled')?.checked;
    if (!enabled) {
      backgroundAutoUpdateStatusEl.textContent = '后台自动更新未启用。';
      return;
    }
    const state = String(status?.status || 'waiting');
    const versionName = String(status?.name || status?.version || status?.ver || '').trim();
    const messages = {
      checking: '正在后台检查更新…',
      latest: `已是最新版本${versionName ? `：${versionName}` : ''}。`,
      'directory-required': `检测到${versionName ? ` ${versionName}` : '新版本'}，请先在全屏页面手动更新一次并授权扩展安装目录。`,
      'optional-update-available': `检测到非强制更新${versionName ? `：${versionName}` : ''}，已按设置保留为手动更新。`,
      downloading: `正在后台下载${versionName ? ` ${versionName}` : '更新'}…`,
      installing: `正在后台覆盖更新文件${status?.total ? `：${Number(status.completed || 0)} / ${Number(status.total)}` : ''}。`,
      reloading: '更新已写入，正在自动重新加载扩展…',
      'reload-pending': `更新文件已写入${versionName ? `（${versionName}）` : ''}，正在等待扩展重新加载。`,
      'reload-cooldown': `本地版本仍未更新${versionName ? `（目标 ${versionName}）` : ''}，将在下一轮后台检查时重新覆盖。`,
      complete: `后台更新已完成${versionName ? `：${versionName}` : ''}${status?.reloaded ? '，扩展已自动重新加载' : ''}。`,
      error: `后台自动更新失败：${String(status?.error || '未知错误')}`
    };
    backgroundAutoUpdateStatusEl.textContent = messages[state] || '等待下一次后台更新检查。';
  };
  renderBackgroundAutoUpdateStatus(backgroundAutoUpdateStatus);

  const updateBackgroundAutoInstallOptionalDisabled = () => {
    const parentEnabled = !!document.getElementById('backgroundAutoUpdateEnabled')?.checked;
    const child = document.getElementById('backgroundAutoInstallOptionalEnabled');
    if (child instanceof HTMLInputElement) {
      child.disabled = !parentEnabled;
      child.closest('label')?.classList.toggle('is-disabled', !parentEnabled);
    }
    const editor = document.getElementById('backgroundAutoUpdateIntervalEditor');
    editor?.classList.toggle('is-disabled', !parentEnabled);
    editor?.querySelectorAll('input,select').forEach((control) => { control.disabled = !parentEnabled; });
  };
  const updateHomeworkBackgroundRefreshDisabled = () => {
    const enabled = homeworkBackgroundRefreshInput instanceof HTMLInputElement && homeworkBackgroundRefreshInput.checked;
    const detail = document.getElementById('homeworkBackgroundRefreshDetail');
    detail?.classList.toggle('is-disabled', !enabled);
    detail?.querySelectorAll('input,select').forEach((control) => { control.disabled = !enabled; });
  };
  const renderHomeworkBackgroundRefreshStatus = (status) => {
    if (!(homeworkBackgroundRefreshStatusEl instanceof HTMLElement)) return;
    if (!(homeworkBackgroundRefreshInput instanceof HTMLInputElement) || !homeworkBackgroundRefreshInput.checked) {
      homeworkBackgroundRefreshStatusEl.textContent = '后台作业获取未启用。';
      return;
    }
    const state = String(status?.status || 'waiting');
    const messages = {
      loading: `正在后台登录 ${String(status?.account || '')} 并获取作业…`,
      complete: `最近刷新完成：${Number(status?.courseCount || 0)} 门课程，${Number(status?.homeworkCount || 0)} 项未交作业。`,
      'foreground-open': '已打开全屏页面，本轮不执行后台获取。',
      error: `最近刷新失败：${String(status?.error || '未知错误')}`
    };
    homeworkBackgroundRefreshStatusEl.textContent = messages[state] || '等待下一次后台作业获取。';
  };
  updateBackgroundAutoInstallOptionalDisabled();

  const renderHomeworkBackgroundAccounts = (context) => {
    if (!(homeworkBackgroundRefreshAccountSelect instanceof HTMLSelectElement)) return;
    const history = Array.isArray(context?.history) ? context.history : [];
    const selected = String(currentHomeworkBackgroundRefreshAccount || homeworkBackgroundRefreshAccountSelect.value || '').trim();
    homeworkBackgroundRefreshAccountSelect.replaceChildren();
    if (!history.length) {
      homeworkBackgroundRefreshAccountSelect.append(new Option('暂无已登录账号', ''));
      return;
    }
    history.forEach((account) => {
      const loginName = String(account?.loginName || account?.userId || '').trim();
      if (!loginName) return;
      const userName = String(account?.userName || '').trim();
      const roleName = String(account?.roleName || '').trim();
      homeworkBackgroundRefreshAccountSelect.append(new Option(
        [loginName, roleName, userName].filter(Boolean).join(' '),
        loginName
      ));
    });
    if (history.some((account) => String(account?.loginName || account?.userId || '').trim() === selected)) {
      homeworkBackgroundRefreshAccountSelect.value = selected;
    } else {
      homeworkBackgroundRefreshAccountSelect.value = String(homeworkBackgroundRefreshAccountSelect.options[0]?.value || '');
    }
  };
  renderHomeworkBackgroundAccounts(portalLoginContext);
  updateHomeworkBackgroundRefreshDisabled();
  renderHomeworkBackgroundRefreshStatus(homeworkBackgroundRefreshStatus);

  const updateHomeworkReminderDisabled = () => {
    const disabled = !document.getElementById('homeworkReminderEnabled').checked;
    const editor = document.getElementById('homeworkReminderEditor');
    editor.classList.toggle('is-disabled', disabled);
    editor.querySelectorAll('input,select,button').forEach((control) => { control.disabled = disabled; });
  };
  const renderHomeworkReminderNodes = () => {
    const list = document.getElementById('homeworkReminderNodeList');
    list.innerHTML = currentHomeworkReminderMinutes.map((minutes) => `
      <span class="reminder-node">${formatHomeworkReminderMinutes(minutes)}<button type="button" data-remove-reminder-minutes="${minutes}" title="删除" aria-label="删除 ${formatHomeworkReminderMinutes(minutes)}">×</button></span>
    `).join('');
  };
  const persistHomeworkReminderSettings = async () => {
    await chrome.storage.local.set({
      homeworkReminderEnabled: !!document.getElementById('homeworkReminderEnabled').checked,
      homeworkReminderMinutes: currentHomeworkReminderMinutes
    });
    setMsg('已应用更改');
  };
  renderHomeworkReminderNodes();
  updateHomeworkReminderDisabled();
  updatePopupCacheDisabled();

  // apply changes immediately when inputs change
  const applyPlatform = async () => {
    const pe = {
      ve: !!document.getElementById('showVe').checked && !!document.getElementById('enableVe').checked,
      ykt: !!document.getElementById('showYkt').checked && !!document.getElementById('enableYkt').checked,
      mrjzy: !!document.getElementById('showMrjzy').checked && !!document.getElementById('enableMrjzy').checked,
      jlgj: !!document.getElementById('showJlgj').checked && !!document.getElementById('enableJlgj').checked,
      mooc: !!document.getElementById('showMooc').checked && !!document.getElementById('enableMooc').checked,
      xuetangx: !!document.getElementById('showXuetangx').checked && !!document.getElementById('enableXuetangx').checked
    };
    await chrome.storage.local.set({ platformEnabled: pe });
    await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
    setMsg('已应用更改');
  };

  function updateThemeModeUi(value) {
    const mode = globalThis.BjtuTheme?.normalizeMode(value) || DEFAULT_THEME_MODE;
    const container = document.getElementById('themeMode');
    const btns = container.querySelectorAll('.theme-mode-btn');
    btns.forEach((btn) => {
      const isActive = btn.dataset.value === mode;
      btn.classList.toggle('theme-mode-btn--active', isActive);
      btn.classList.remove('theme-mode-btn--system-active');
    });
    if (mode === 'system') {
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
      const systemValue = prefersDark ? 'dark' : 'light';
      const systemBtn = container.querySelector(`.theme-mode-btn[data-value="${systemValue}"]`);
      if (systemBtn) systemBtn.classList.add('theme-mode-btn--system-active');
    }
  }

  const updatePlatformDetailDisabled = () => {
    const visibleState = {};
    ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx'].forEach((key) => {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const shown = !!document.getElementById(`show${cap}`).checked;
      visibleState[key] = shown;
      const enableInput = document.getElementById(`enable${cap}`);
      if (!shown) enableInput.checked = false;
      enableInput.disabled = !shown;
      enableInput.closest('label')?.classList.toggle('is-disabled', !shown);
    });
    ['autoLoadCourseResourcesEnabled', 'linkQrEnabled'].forEach((id) => {
      const input = document.getElementById(id);
      input.disabled = !visibleState.ve;
      input.closest('label')?.classList.toggle('is-disabled', !visibleState.ve);
    });
    document.querySelectorAll('.ykt-activity-type').forEach((input) => {
      input.disabled = !visibleState.ykt;
      input.closest('label')?.classList.toggle('is-disabled', !visibleState.ykt);
    });
    document.querySelectorAll('.xuetangx-course-status, .xuetangx-activity-type').forEach((input) => {
      input.disabled = !visibleState.xuetangx;
      input.closest('label')?.classList.toggle('is-disabled', !visibleState.xuetangx);
    });
    const jlgjDark = document.getElementById('jlgjDarkModeEnabled');
    const alwaysDark = document.getElementById('jlgjAlwaysDarkModeEnabled');
    const extensionDark = document.documentElement.dataset.colorScheme === 'dark';
    jlgjDark.disabled = !extensionDark;
    jlgjDark.closest('label')?.classList.toggle('is-disabled', jlgjDark.disabled);
    alwaysDark.disabled = jlgjDark.disabled || !jlgjDark.checked;
    alwaysDark.closest('label')?.classList.toggle('is-disabled', alwaysDark.disabled);
  };

  const enforceJlgjDarkThemeAvailability = async () => { updatePlatformDetailDisabled(); };

  const applyPlatformVisible = async () => {
    const value = {};
    const enabledValue = {};
    ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx'].forEach((key) => {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const shown = !!document.getElementById(`show${cap}`).checked;
      const enableInput = document.getElementById(`enable${cap}`);
      value[key] = shown;
      if (!shown) enableInput.checked = false;
      enabledValue[key] = shown && !!enableInput.checked;
    });
    await chrome.storage.local.set({ platformVisible: value, platformEnabled: enabledValue });
    await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
    updatePlatformDetailDisabled();
    setMsg('已应用更改');
  };
  void enforceJlgjDarkThemeAvailability();
  window.addEventListener('bjtu-theme-change', () => { void enforceJlgjDarkThemeAvailability(); });

  const applyOpenMode = async () => {
    const v = document.getElementById('openModePage').checked ? 'page' : 'popup';
    await chrome.storage.local.set({ openMode: v });
    updatePopupCacheDisabled();
    setMsg('已应用更改');
  };
  const applyPopupSize = async () => {
    const widthInput = document.getElementById('popupWidthPx');
    const heightInput = document.getElementById('popupHeightPx');
    const width = normalizePopupDimension(widthInput?.value, DEFAULT_POPUP_WIDTH_PX, MIN_POPUP_WIDTH_PX, MAX_POPUP_WIDTH_PX);
    const height = normalizePopupDimension(heightInput?.value, DEFAULT_POPUP_HEIGHT_PX, MIN_POPUP_HEIGHT_PX, MAX_POPUP_HEIGHT_PX);
    if (widthInput instanceof HTMLInputElement) widthInput.value = String(width);
    if (heightInput instanceof HTMLInputElement) heightInput.value = String(height);
    await chrome.storage.local.set({ popupWidthPx: width, popupHeightPx: height });
    setMsg('已应用更改');
  };

  function updatePopupCacheDisabled() {
    const disabled = document.getElementById('openModePage').checked;
    const container = document.getElementById('popupCacheContainer');
    const checkbox = document.getElementById('popupUseFullscreenCacheEnabled');
    container.classList.toggle('is-disabled', disabled);
    checkbox.disabled = disabled;
  }

  function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) el.checked = !!checked;
  }

  function applyPlatformUi(raw) {
    const enabled = normalizePlatformEnabled(raw);
    setChecked('enableVe', enabled.ve);
    setChecked('enableYkt', enabled.ykt);
    setChecked('enableMrjzy', enabled.mrjzy);
    setChecked('enableJlgj', enabled.jlgj);
    setChecked('enableMooc', enabled.mooc);
    setChecked('enableXuetangx', enabled.xuetangx);
  }

  function applyPlatformVisibleUi(raw) {
    const visible = normalizePlatformVisible(raw);
    Object.entries(visible).forEach(([key, value]) => {
      setChecked('show' + key.charAt(0).toUpperCase() + key.slice(1), value);
    });
    updatePlatformDetailDisabled();
  }

  function applyOpenModeUi(raw) {
    const mode = String(raw || DEFAULT_OPEN_MODE);
    setChecked('openModePopup', mode !== 'page');
    setChecked('openModePage', mode === 'page');
    updatePopupCacheDisabled();
  }

  function applyPopupSizeUi(widthRaw, heightRaw) {
    const widthInput = document.getElementById('popupWidthPx');
    const heightInput = document.getElementById('popupHeightPx');
    if (widthInput instanceof HTMLInputElement && widthRaw !== undefined) {
      widthInput.value = String(normalizePopupDimension(widthRaw, DEFAULT_POPUP_WIDTH_PX, MIN_POPUP_WIDTH_PX, MAX_POPUP_WIDTH_PX));
    }
    if (heightInput instanceof HTMLInputElement && heightRaw !== undefined) {
      heightInput.value = String(normalizePopupDimension(heightRaw, DEFAULT_POPUP_HEIGHT_PX, MIN_POPUP_HEIGHT_PX, MAX_POPUP_HEIGHT_PX));
    }
  }

  function applyBooleanUi(id, raw, fallback = true) {
    setChecked(id, raw === undefined ? fallback : !!raw);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      let uiOrderChanged = false;
      if (changes.platformEnabled) applyPlatformUi(changes.platformEnabled.newValue);
      if (changes.platformVisible) applyPlatformVisibleUi(changes.platformVisible.newValue);
      if (changes.optionsSectionOrder) {
        currentOptionsSectionOrder = normalizeOptionsSectionOrder(changes.optionsSectionOrder.newValue);
        applyOptionsSectionOrder();
        renderUiOrderEditor();
        uiOrderChanged = true;
      }
      if (changes.platformOrder) {
        currentPlatformOrder = normalizePlatformOrder(changes.platformOrder.newValue);
        applyPlatformOrderToOptions();
        renderUiOrderEditor();
        uiOrderChanged = true;
      }
      if (uiOrderChanged) applyInstalledModuleListOrder();
      if (changes.xuetangxCourseStatuses) {
        const values = Array.isArray(changes.xuetangxCourseStatuses.newValue)
          ? new Set(changes.xuetangxCourseStatuses.newValue.map(Number))
          : new Set([1]);
        document.querySelectorAll('.xuetangx-course-status').forEach((input) => {
          input.checked = values.has(Number(input.value));
        });
      }
      if (changes.yktActivityTypes) {
        const values = new Set(
          Array.isArray(changes.yktActivityTypes.newValue)
            ? changes.yktActivityTypes.newValue.map(Number)
            : DEFAULT_YKT_ACTIVITY_TYPES
        );
        document.querySelectorAll('.ykt-activity-type').forEach((input) => {
          input.checked = values.has(Number(input.value));
        });
      }
      if (changes.xuetangxActivityTypes) {
        const values = new Set(
          Array.isArray(changes.xuetangxActivityTypes.newValue)
            ? changes.xuetangxActivityTypes.newValue.map(Number)
            : DEFAULT_XUETANGX_ACTIVITY_TYPES
        );
        document.querySelectorAll('.xuetangx-activity-type').forEach((input) => {
          input.checked = values.has(Number(input.value));
        });
      }
      if (changes.injectMoocHelperEnabled) applyBooleanUi('injectMoocHelperEnabled', changes.injectMoocHelperEnabled.newValue, true);
      if (changes.injectMoocPeerReviewEnabled) {
        applyBooleanUi('injectMoocPeerReviewEnabled', changes.injectMoocPeerReviewEnabled.newValue, true);
        updateMoocPeerReviewState();
      }
      if (changes.moocPeerReviewCount) {
        document.getElementById('moocPeerReviewCount').value = String(normalizeMoocPeerReviewCount(
          changes.moocPeerReviewCount.newValue
        ));
      }
      if (changes.jlgjDarkModeEnabled) {
        applyBooleanUi('jlgjDarkModeEnabled', changes.jlgjDarkModeEnabled.newValue, true);
        void enforceJlgjDarkThemeAvailability();
      }
      if (changes.jlgjAlwaysDarkModeEnabled) {
        applyBooleanUi('jlgjAlwaysDarkModeEnabled', changes.jlgjAlwaysDarkModeEnabled.newValue, false);
        void enforceJlgjDarkThemeAvailability();
      }
      if (changes.homeworkDetailCollapsedLines) {
        document.getElementById('homeworkDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
          changes.homeworkDetailCollapsedLines.newValue,
          DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES
        ));
      }
      if (changes.replayDetailCollapsedLines) {
        document.getElementById('replayDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
          changes.replayDetailCollapsedLines.newValue,
          DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES
        ));
      }
      if (changes.parallelLimit) {
        document.getElementById('parallelLimit').value = String(normalizeParallelLimit(changes.parallelLimit.newValue));
      }
      if (changes.openMode) applyOpenModeUi(changes.openMode.newValue);
      if (changes.preferExistingFullscreenPage) {
        applyBooleanUi('preferExistingFullscreenPage', changes.preferExistingFullscreenPage.newValue, DEFAULT_PREFER_EXISTING_FULLSCREEN_PAGE);
      }
      if (changes.groupExtensionTabsEnabled) {
        applyBooleanUi('groupExtensionTabsEnabled', changes.groupExtensionTabsEnabled.newValue, DEFAULT_GROUP_EXTENSION_TABS_ENABLED);
      }
      if (changes.popupWidthPx || changes.popupHeightPx) {
        applyPopupSizeUi(changes.popupWidthPx?.newValue, changes.popupHeightPx?.newValue);
      }
      if (changes.courseHelperExpandedByDefault) {
        applyBooleanUi('courseHelperExpandedByDefault', changes.courseHelperExpandedByDefault.newValue, DEFAULT_COURSE_HELPER_EXPANDED);
      }
      if (changes.showCourseListDuringLayoutTransition) {
        applyBooleanUi(
          'showCourseListDuringLayoutTransition',
          changes.showCourseListDuringLayoutTransition.newValue,
          DEFAULT_SHOW_COURSE_LIST_DURING_LAYOUT_TRANSITION
        );
      }
      if (changes.deadlineCountdownStyle) {
        document.getElementById('deadlineCountdownStyle').value = normalizeDeadlineCountdownStyle(
          changes.deadlineCountdownStyle.newValue
        );
      }
      if (changes.themeMode) {
        updateThemeModeUi(changes.themeMode.newValue);
        setTimeout(() => { void enforceJlgjDarkThemeAvailability(); }, 0);
      }
      if (changes.autoLoadCourseResourcesEnabled) applyBooleanUi('autoLoadCourseResourcesEnabled', changes.autoLoadCourseResourcesEnabled.newValue, DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED);
      if (changes.saveUploadedFilesEnabled) applyBooleanUi('saveUploadsEnabled', changes.saveUploadedFilesEnabled.newValue, DEFAULT_SAVE_UPLOADS_ENABLED);
      if (changes.linkQrEnabled) applyBooleanUi('linkQrEnabled', changes.linkQrEnabled.newValue, true);
      if (changes.popupUseFullscreenCacheEnabled) {
        applyBooleanUi('popupUseFullscreenCacheEnabled', changes.popupUseFullscreenCacheEnabled.newValue, DEFAULT_POPUP_CACHE_ENABLED);
      }
      if (changes.homeworkReminderEnabled) {
        applyBooleanUi('homeworkReminderEnabled', changes.homeworkReminderEnabled.newValue, DEFAULT_HOMEWORK_REMINDER_ENABLED);
        updateHomeworkReminderDisabled();
      }
      if (changes.toolbarPinReminderEnabled) {
        applyBooleanUi('toolbarPinReminderEnabled', changes.toolbarPinReminderEnabled.newValue, true);
      }
      if (changes.homeworkReminderMinutes) {
        currentHomeworkReminderMinutes = normalizeHomeworkReminderMinutes(changes.homeworkReminderMinutes.newValue);
        renderHomeworkReminderNodes();
      }
      if (changes.homeworkBackgroundRefreshEnabled) {
        applyBooleanUi('homeworkBackgroundRefreshEnabled', changes.homeworkBackgroundRefreshEnabled.newValue, false);
        updateHomeworkBackgroundRefreshDisabled();
        renderHomeworkBackgroundRefreshStatus(changes.homeworkBackgroundRefreshStatus?.newValue || null);
      }
      if (changes.homeworkBackgroundRefreshIntervalMinutes) {
        setScheduleIntervalEditor('homeworkBackgroundRefreshInterval', changes.homeworkBackgroundRefreshIntervalMinutes.newValue, DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES);
      }
      if (changes.homeworkNewAssignmentNotificationEnabled) {
        applyBooleanUi('homeworkNewAssignmentNotificationEnabled', changes.homeworkNewAssignmentNotificationEnabled.newValue, false);
      }
      if (changes.homeworkBackgroundRefreshAccount && homeworkBackgroundRefreshAccountSelect instanceof HTMLSelectElement) {
        currentHomeworkBackgroundRefreshAccount = String(changes.homeworkBackgroundRefreshAccount.newValue || '').trim();
        homeworkBackgroundRefreshAccountSelect.value = currentHomeworkBackgroundRefreshAccount;
      }
      if (changes.homeworkBackgroundRefreshStatus) {
        renderHomeworkBackgroundRefreshStatus(changes.homeworkBackgroundRefreshStatus.newValue);
      }
      if (changes.systemNotificationStatus) {
        renderSystemNotificationStatus(changes.systemNotificationStatus.newValue);
      }
      if (changes.loginAccountHistory) {
        chrome.runtime.sendMessage({ type: 'PORTAL_LOGIN_CONTEXT' }).then((context) => {
          if (context?.ok) portalLoginContext = context;
          renderHomeworkBackgroundAccounts(portalLoginContext);
        }).catch(() => {});
      }
      if (changes.injectPortalLoginOnLoginPage) {
        applyBooleanUi('injectPortalLoginOnLoginPage', changes.injectPortalLoginOnLoginPage.newValue, true);
      }
      if (changes.injectPortalLoginOnTimeoutPage) {
        applyBooleanUi('injectPortalLoginOnTimeoutPage', changes.injectPortalLoginOnTimeoutPage.newValue, true);
      }
      if (changes.backgroundAutoUpdateEnabled) {
        applyBooleanUi('backgroundAutoUpdateEnabled', changes.backgroundAutoUpdateEnabled.newValue, DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED);
        updateBackgroundAutoInstallOptionalDisabled();
        renderBackgroundAutoUpdateStatus(changes.backgroundAutoUpdateStatus?.newValue || null);
      }
      if (changes.backgroundAutoInstallOptionalEnabled) {
        applyBooleanUi('backgroundAutoInstallOptionalEnabled', changes.backgroundAutoInstallOptionalEnabled.newValue, DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED);
      }
      if (changes.backgroundAutoUpdateIntervalMinutes) {
        setScheduleIntervalEditor('backgroundAutoUpdateInterval', changes.backgroundAutoUpdateIntervalMinutes.newValue, DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES);
      }
      if (changes.backgroundAutoUpdateStatus) renderBackgroundAutoUpdateStatus(changes.backgroundAutoUpdateStatus.newValue);
    });
  } catch {
    // ignore non-extension contexts
  }

  document.getElementById('enableVe').addEventListener('change', applyPlatform);
  document.getElementById('enableYkt').addEventListener('change', applyPlatform);
  document.getElementById('enableMrjzy').addEventListener('change', applyPlatform);
  document.getElementById('enableJlgj').addEventListener('change', applyPlatform);
  document.getElementById('enableMooc').addEventListener('change', applyPlatform);
  document.getElementById('enableXuetangx').addEventListener('change', applyPlatform);
  ['showVe', 'showYkt', 'showMrjzy', 'showJlgj', 'showMooc', 'showXuetangx'].forEach((id) => {
    document.getElementById(id).addEventListener('change', applyPlatformVisible);
  });
  document.getElementById('injectMoocHelperEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({ injectMoocHelperEnabled: !!document.getElementById('injectMoocHelperEnabled').checked });
    setMsg('已应用更改');
  });
  document.getElementById('injectMoocPeerReviewEnabled').addEventListener('change', async () => {
    updateMoocPeerReviewState();
    await chrome.storage.local.set({ injectMoocPeerReviewEnabled: !!document.getElementById('injectMoocPeerReviewEnabled').checked });
    setMsg('已应用更改');
  });
  document.getElementById('moocPeerReviewCount').addEventListener('change', async (event) => {
    const count = normalizeMoocPeerReviewCount(event.currentTarget.value);
    event.currentTarget.value = String(count);
    await chrome.storage.local.set({ moocPeerReviewCount: count });
    setMsg('已应用更改');
  });
  ['jlgjDarkModeEnabled', 'jlgjAlwaysDarkModeEnabled'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      await chrome.storage.local.set({ [id]: !!document.getElementById(id).checked });
      setMsg('已应用更改');
      if (id === 'jlgjDarkModeEnabled') updatePlatformDetailDisabled();
    });
  });
  document.querySelectorAll('.ykt-activity-type').forEach((input) => {
    input.addEventListener('change', async () => {
      const selected = [...document.querySelectorAll('.ykt-activity-type:checked')]
        .map((item) => Number(item.value));
      await chrome.storage.local.set({ yktActivityTypes: selected });
      setMsg('已应用更改');
    });
  });
  document.getElementById('openModePopup').addEventListener('change', applyOpenMode);
  document.getElementById('openModePage').addEventListener('change', applyOpenMode);
  document.getElementById('preferExistingFullscreenPage').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ preferExistingFullscreenPage: event.currentTarget.checked });
    setMsg('已应用更改');
  });
  document.getElementById('groupExtensionTabsEnabled').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ groupExtensionTabsEnabled: event.currentTarget.checked });
    setMsg('已应用更改');
  });
  document.querySelectorAll('.xuetangx-course-status').forEach((input) => {
    input.addEventListener('change', async () => {
      let selected = [...document.querySelectorAll('.xuetangx-course-status:checked')].map((item) => Number(item.value));
      if (!selected.length) {
        const ongoing = document.querySelector('.xuetangx-course-status[value="1"]');
        if (ongoing) ongoing.checked = true;
        selected = [1];
      }
      await chrome.storage.local.set({ xuetangxCourseStatuses: selected });
      setMsg('已应用更改');
    });
  });
  document.querySelectorAll('.xuetangx-activity-type').forEach((input) => {
    input.addEventListener('change', async () => {
      const selected = [...document.querySelectorAll('.xuetangx-activity-type:checked')]
        .map((item) => Number(item.value));
      await chrome.storage.local.set({ xuetangxActivityTypes: selected });
      setMsg('已应用更改');
    });
  });
  document.getElementById('popupWidthPx').addEventListener('change', applyPopupSize);
  document.getElementById('popupHeightPx').addEventListener('change', applyPopupSize);
  document.getElementById('courseHelperExpandedByDefault').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ courseHelperExpandedByDefault: event.currentTarget.checked });
    setMsg('已应用更改');
  });
  document.getElementById('themeMode').addEventListener('click', async (e) => {
    const btn = e.target.closest('.theme-mode-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    await chrome.storage.local.set({ themeMode: globalThis.BjtuTheme?.normalizeMode(value) || DEFAULT_THEME_MODE });
    updateThemeModeUi(value);
    setMsg('已应用更改');
  });

  const themeModeContainer = document.getElementById('themeMode');
  const systemMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSystemThemeChange = () => {
    const activeBtn = themeModeContainer?.querySelector('.theme-mode-btn--active');
    if (activeBtn?.dataset.value === 'system') {
      themeModeContainer.querySelectorAll('.theme-mode-btn--system-active').forEach((btn) => btn.classList.remove('theme-mode-btn--system-active'));
      const systemValue = systemMedia?.matches ? 'dark' : 'light';
      const systemBtn = themeModeContainer?.querySelector(`.theme-mode-btn[data-value="${systemValue}"]`);
      if (systemBtn) systemBtn.classList.add('theme-mode-btn--system-active');
    }
  };
  if (typeof systemMedia?.addEventListener === 'function') systemMedia.addEventListener('change', onSystemThemeChange);

  document.getElementById('autoLoadCourseResourcesEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      autoLoadCourseResourcesEnabled: !!document.getElementById('autoLoadCourseResourcesEnabled').checked
    });
    setMsg('已应用更改');
  });

  ['injectPortalLoginOnLoginPage', 'injectPortalLoginOnTimeoutPage'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      await chrome.storage.local.set({ [id]: !!document.getElementById(id).checked });
      setMsg('已应用更改');
    });
  });

  document.getElementById('saveUploadsEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      saveUploadedFilesEnabled: !!document.getElementById('saveUploadsEnabled').checked
    });
    setMsg('已应用更改');
  });

  (() => {
    const cb = document.getElementById('headerQrEnabled');
    const label = cb?.closest('label');
    if (label) {
      label.addEventListener('click', (e) => {
        e.preventDefault();
        cb.checked = false;
        setMsg('此功能所需条件已被智慧课程平台禁用', false);
      });
    }
  })();

  document.getElementById('linkQrEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      linkQrEnabled: !!document.getElementById('linkQrEnabled').checked
    });
    setMsg('已应用更改');
  });

  document.getElementById('popupUseFullscreenCacheEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      popupUseFullscreenCacheEnabled: !!document.getElementById('popupUseFullscreenCacheEnabled').checked
    });
    setMsg('已应用更改');
  });

  document.getElementById('homeworkReminderEnabled').addEventListener('change', async () => {
    updateHomeworkReminderDisabled();
    await persistHomeworkReminderSettings();
  });

  document.getElementById('toolbarPinReminderEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      toolbarPinReminderEnabled: !!document.getElementById('toolbarPinReminderEnabled').checked
    });
    setMsg('已应用更改');
  });

  document.getElementById('deadlineCountdownStyle')?.addEventListener('change', async (event) => {
    await chrome.storage.local.set({
      deadlineCountdownStyle: normalizeDeadlineCountdownStyle(event.currentTarget.value)
    });
    setMsg('已应用更改');
  });

  document.getElementById('showCourseListDuringLayoutTransition')?.addEventListener('change', async (event) => {
    await chrome.storage.local.set({
      showCourseListDuringLayoutTransition: event.currentTarget.checked === true
    });
    setMsg('已应用更改');
  });

  document.getElementById('testSystemNotificationBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在发送…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'SYSTEM_NOTIFICATION_TEST' });
      if (!result?.ok) throw new Error(result?.message || '浏览器未能创建系统通知');
      setMsg('测试通知已交给浏览器；若未看到横幅，请检查系统或浏览器通知设置');
    } catch (error) {
      setMsg(`系统通知发送失败：${String(error?.message || error)}`, false);
    } finally {
      button.disabled = false;
      button.textContent = '发送测试通知';
    }
  });

  document.getElementById('backgroundAutoUpdateEnabled')?.addEventListener('change', async (event) => {
    const enabled = !!event.currentTarget.checked;
    await chrome.storage.local.set({ backgroundAutoUpdateEnabled: enabled });
    updateBackgroundAutoInstallOptionalDisabled();
    renderBackgroundAutoUpdateStatus(enabled ? { status: 'checking' } : null);
    setMsg(enabled ? '已启用后台自动更新' : '已关闭后台自动更新');
  });
  document.getElementById('backgroundAutoInstallOptionalEnabled')?.addEventListener('change', async (event) => {
    const enabled = !!event.currentTarget.checked;
    await chrome.storage.local.set({ backgroundAutoInstallOptionalEnabled: enabled });
    setMsg(enabled ? '已启用非强制更新自动安装' : '已关闭非强制更新自动安装');
  });
  ['homeworkDetailCollapsedLines', 'replayDetailCollapsedLines'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      const input = document.getElementById(id);
      const fallback = id === 'homeworkDetailCollapsedLines'
        ? DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES
        : DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES;
      const value = normalizeDetailCollapsedLines(input.value, fallback);
      input.value = String(value);
      await chrome.storage.local.set({ [id]: value });
      setMsg('已应用更改');
    });
  });
  document.getElementById('parallelLimit').addEventListener('change', async (event) => {
    const value = normalizeParallelLimit(event.currentTarget.value);
    event.currentTarget.value = String(value);
    await chrome.storage.local.set({ parallelLimit: value });
    setMsg('已应用更改');
  });
  const bindScheduleIntervalSetting = (prefix, key, fallback, label) => {
    const save = async () => {
      const minutes = readScheduleIntervalEditor(prefix);
      if (!Number.isFinite(minutes)) {
        setMsg(`${label}必须在 1 分钟到 365 天之间`, false);
        const stored = await chrome.storage.local.get([key]);
        setScheduleIntervalEditor(prefix, stored?.[key], fallback);
        return;
      }
      await chrome.storage.local.set({ [key]: minutes });
      setScheduleIntervalEditor(prefix, minutes, fallback);
      setMsg(`已将${label}设为 ${minutes} 分钟`);
    };
    document.getElementById(`${prefix}Value`)?.addEventListener('change', save);
    document.getElementById(`${prefix}Unit`)?.addEventListener('change', save);
  };
  bindScheduleIntervalSetting('backgroundAutoUpdateInterval', 'backgroundAutoUpdateIntervalMinutes', DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES, '更新检查间隔');
  bindScheduleIntervalSetting('homeworkBackgroundRefreshInterval', 'homeworkBackgroundRefreshIntervalMinutes', DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES, '后台作业刷新间隔');
  homeworkBackgroundRefreshInput?.addEventListener('change', async () => {
    const enabled = homeworkBackgroundRefreshInput.checked;
    const account = String(homeworkBackgroundRefreshAccountSelect?.value || '').trim();
    if (enabled && !account) {
      homeworkBackgroundRefreshInput.checked = false;
      updateHomeworkBackgroundRefreshDisabled();
      setMsg('请先登录至少一个智慧课程平台账号', false);
      return;
    }
    await chrome.storage.local.set({
      homeworkBackgroundRefreshEnabled: enabled,
      ...(enabled ? { homeworkBackgroundRefreshAccount: account } : {})
    });
    updateHomeworkBackgroundRefreshDisabled();
    setMsg(enabled ? '已启用后台作业获取' : '已关闭后台作业获取');
  });
  homeworkBackgroundRefreshAccountSelect?.addEventListener('change', async () => {
    currentHomeworkBackgroundRefreshAccount = String(homeworkBackgroundRefreshAccountSelect.value || '').trim();
    await chrome.storage.local.set({ homeworkBackgroundRefreshAccount: currentHomeworkBackgroundRefreshAccount });
    setMsg('已更改后台维护账号');
  });
  homeworkNewAssignmentNotificationInput?.addEventListener('change', async () => {
    await chrome.storage.local.set({ homeworkNewAssignmentNotificationEnabled: homeworkNewAssignmentNotificationInput.checked });
    setMsg(homeworkNewAssignmentNotificationInput.checked ? '已启用新增作业通知' : '已关闭新增作业通知');
  });
  document.getElementById('addHomeworkReminderNode').addEventListener('click', async () => {
    const value = Number(document.getElementById('homeworkReminderValue').value || 0);
    const unit = Number(document.getElementById('homeworkReminderUnit').value || 1);
    const minutes = Math.round(value * unit);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) {
      setMsg('提醒时间必须在 1 分钟到 365 天之间', false);
      return;
    }
    currentHomeworkReminderMinutes = normalizeHomeworkReminderMinutes([...currentHomeworkReminderMinutes, minutes]);
    renderHomeworkReminderNodes();
    await persistHomeworkReminderSettings();
  });
  document.getElementById('homeworkReminderNodeList').addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-remove-reminder-minutes]') : null;
    if (!(button instanceof HTMLElement)) return;
    const minutes = Number(button.dataset.removeReminderMinutes || 0);
    currentHomeworkReminderMinutes = currentHomeworkReminderMinutes.filter((item) => item !== minutes);
    renderHomeworkReminderNodes();
    await persistHomeworkReminderSettings();
  });

  // "BJTU 上传助手" link: navigate to app.html
  const backHome = document.getElementById('back-home');
  if (backHome) {
    const go = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      goBackToApp();
    };
    backHome.addEventListener('click', go);
    backHome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') go(e);
    });
  }

  const bindBtn = document.getElementById('bindPortalUsernameBtn');
  if (bindBtn) {
    bindBtn.addEventListener('click', async () => {
      bindBtn.disabled = true;
      const bindUrl = 'http://123.121.147.7:88/oauth/api/user/thirdLogin';
      try {
        const { username } = await chrome.storage.local.get(['username']);
        const resp = await chrome.runtime.sendMessage({
          type: 'START_BIND_PORTAL_USERNAME',
          payload: { loginName: String(username || '').trim() }
        });
        if (!resp?.ok) {
          const tab = await chrome.tabs.create({ url: bindUrl, active: true });
          await chrome.runtime.sendMessage({ type: 'GROUP_BJTU_OPENED_TAB', tabId: tab?.id }).catch(() => null);
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
          return;
        }
        setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
      } catch (e) {
        try {
          const tab = await chrome.tabs.create({ url: bindUrl, active: true });
          await chrome.runtime.sendMessage({ type: 'GROUP_BJTU_OPENED_TAB', tabId: tab?.id }).catch(() => null);
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
        } catch (err) {
          setMsg(String(err?.message || e?.message || e || '无法打开 MIS 绑定页面'), false);
          bindBtn.disabled = false;
        }
      }
    });
  }

  document.getElementById('exportBindDataBtn').addEventListener('click', async () => {
    const button = document.getElementById('exportBindDataBtn');
    const exportModal = document.getElementById('export-bind-data-modal');
    const exportMessage = document.getElementById('export-bind-data-message');
    const progressModal = document.getElementById('account-init-modal');
    const progressTitle = progressModal?.querySelector('.account-progress-title');
    const progressStatus = document.getElementById('account-init-status');
    const teacherRow = document.getElementById('account-init-teacher-label')?.closest('.account-init-progress-row');
    const studentRow = document.getElementById('account-init-student-label')?.closest('.account-init-progress-row');
    const teacherLabel = document.getElementById('account-init-teacher-label');
    const teacherBar = document.getElementById('account-init-teacher-progress-bar');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    if (progressTitle instanceof HTMLElement) progressTitle.textContent = '导出 MIS 绑定数据';
    if (progressStatus instanceof HTMLElement) progressStatus.textContent = '正在读取绑定账号…';
    if (teacherLabel instanceof HTMLElement) teacherLabel.textContent = '已读取 0 个';
    if (teacherBar instanceof HTMLElement) teacherBar.style.width = '0%';
    if (teacherRow instanceof HTMLElement) teacherRow.style.display = '';
    if (studentRow instanceof HTMLElement) studentRow.style.display = 'none';
    if (progressModal instanceof HTMLElement) progressModal.style.display = 'flex';
    try {
      const withQuick = await globalThis.BjtuAccountStore.getQuickAccounts({
        limit: 10000,
        onProgress: ({ read }) => {
          if (teacherLabel instanceof HTMLElement) teacherLabel.textContent = `已读取 ${read} 个`;
          if (teacherBar instanceof HTMLElement) teacherBar.style.width = '100%';
        }
      });
      const context = await chrome.runtime.sendMessage({ type: 'PORTAL_LOGIN_CONTEXT' }).catch(() => null);
      const history = Array.isArray(context?.history) ? context.history : [];
      const historyIdSet = new Set(history
        .map((it) => String(it?.loginName || it?.userId || '').trim())
        .filter(Boolean));
      const lines = [];
      for (const acc of withQuick) {
        const loginName = String(acc.loginName || acc.userId || '').trim();
        const quickUsername = String(acc.quickUsername || '').trim();
        if (!loginName || !quickUsername) continue;
        if (!historyIdSet.has(loginName)) continue;
        lines.push(`${loginName}:${quickUsername}`);
      }
      if (!lines.length) {
        setMsg('没有找到已绑定 MIS 的账号', false);
        return;
      }
      const content = lines.join('\n');
      let savedToFile = false;
      if (lines.length > 128) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'bjtu-mis-bindings.txt';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        savedToFile = true;
      } else {
        await navigator.clipboard.writeText(content);
        savedToFile = false;
      }
      if (exportMessage instanceof HTMLElement) {
        exportMessage.textContent = (savedToFile ? '已保存到本地文件。' : '已复制到剪贴板。')
          + '我们恳请您点击下方按钮发送此内容，以帮助我们继续开发核心功能。';
      }
      if (exportModal instanceof HTMLElement) exportModal.style.display = 'flex';
    } catch (error) {
      setMsg('导出失败：' + String(error?.message || error), false);
    } finally {
      if (progressModal instanceof HTMLElement) progressModal.style.display = 'none';
      if (studentRow instanceof HTMLElement) studentRow.style.display = '';
      if (teacherBar instanceof HTMLElement) teacherBar.style.width = '0%';
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  });

  const exportBindDataModal = document.getElementById('export-bind-data-modal');
  const closeExportBindDataModal = () => {
    if (exportBindDataModal instanceof HTMLElement) exportBindDataModal.style.display = 'none';
  };
  document.getElementById('export-bind-data-close')?.addEventListener('click', closeExportBindDataModal);
  exportBindDataModal?.addEventListener('click', (event) => {
    if (event.target === exportBindDataModal) closeExportBindDataModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && exportBindDataModal?.style.display === 'flex') closeExportBindDataModal();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'PORTAL_USERNAME_BIND_STATUS') return;
    const st = message.payload || {};
    if (st.status === 'done') {
      setMsg(`已绑定快速登录 username：${st.userId || st.quickUsername || ''}`);
      if (bindBtn) bindBtn.disabled = false;
    } else if (st.status === 'detected') {
      setMsg('已检测到新 username，正在匹配账号信息');
    } else if (st.status === 'error') {
      setMsg(`绑定失败：${st.error || '无法匹配账号信息'}`, false);
      if (bindBtn) bindBtn.disabled = false;
    }
  });

  const importAccountListBtn = document.getElementById('importAccountListBtn');
  const importAccountListFile = document.getElementById('importAccountListFile');
  const setAccountProgressTitle = (title) => {
    const el = document.querySelector('#account-init-modal .account-progress-title');
    if (el instanceof HTMLElement) el.textContent = String(title || '账号列表');
  };
  importAccountListBtn?.addEventListener('click', () => {
    importAccountListFile.value = '';
    importAccountListFile.click();
  });
  importAccountListFile?.addEventListener('change', async () => {
    const file = importAccountListFile.files?.[0];
    if (!file) return;
    importAccountListBtn.disabled = true;
    try {
      setAccountProgressTitle('导入登录账号列表');
      const count = await globalThis.BjtuAccountLogin.importAccountFile(await file.text(), { showProgress: true });
      setMsg('已导入 ' + count + ' 个账号');
    } catch (error) {
      setMsg('导入失败：' + String(error?.message || error), false);
    } finally {
      const progressModal = document.getElementById('account-init-modal');
      if (progressModal) progressModal.style.display = 'none';
      importAccountListBtn.disabled = false;
    }
  });
  const exportAccountListBtn = document.getElementById('exportAccountListBtn');
  exportAccountListBtn?.addEventListener('click', async () => {
    exportAccountListBtn.disabled = true;
    setAccountProgressTitle('导出登录账号列表');
    try {
      const payload = await globalThis.BjtuAccountLogin.exportAccountFile({ showProgress: true });
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bjtu-account-list-' + formatShanghaiDateForFile() + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg('已导出教职工 ' + Number(payload.summary?.teacher || 0)
        + ' 个、学生 ' + Number(payload.summary?.student || 0) + ' 个');
    } catch (error) {
      setMsg('导出失败：' + String(error?.message || error), false);
    } finally {
      const progressModal = document.getElementById('account-init-modal');
      if (progressModal) progressModal.style.display = 'none';
      exportAccountListBtn.disabled = false;
    }
  });

  // Reset: restore defaults. Platform display/load should only check VE.
  const restoreDefaultSettings = async () => {
    await globalThis.BjtuOptionsModules?.resetAll();
    const defaultPlatform = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false, xuetangx: false };
    await chrome.storage.local.set({
      platformEnabled: defaultPlatform,
      platformVisible: { ...DEFAULT_PLATFORM_VISIBLE },
      optionsSectionOrder: [...FALLBACK_OPTIONS_SECTION_ORDER],
      platformOrder: [...FALLBACK_PLATFORM_ORDER],
      injectMoocHelperEnabled: true,
      injectMoocPeerReviewEnabled: true,
      moocPeerReviewCount: DEFAULT_MOOC_PEER_REVIEW_COUNT,
      jlgjDarkModeEnabled: true,
      jlgjAlwaysDarkModeEnabled: false,
      yktActivityTypes: [...DEFAULT_YKT_ACTIVITY_TYPES],
      xuetangxCourseStatuses: [1],
      xuetangxActivityTypes: [...DEFAULT_XUETANGX_ACTIVITY_TYPES],
      homeworkDetailCollapsedLines: DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES,
      replayDetailCollapsedLines: DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES,
      parallelLimit: DEFAULT_PARALLEL_LIMIT,
      homeworkReminderEnabled: DEFAULT_HOMEWORK_REMINDER_ENABLED,
      homeworkReminderMinutes: DEFAULT_HOMEWORK_REMINDER_MINUTES,
      toolbarPinReminderEnabled: true,
      homeworkBackgroundRefreshEnabled: false,
      homeworkBackgroundRefreshAccount: '',
      homeworkBackgroundRefreshIntervalMinutes: DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES,
      homeworkNewAssignmentNotificationEnabled: false,
      backgroundAutoUpdateEnabled: DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED,
      backgroundAutoInstallOptionalEnabled: DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED,
      backgroundAutoUpdateIntervalMinutes: DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES,
      popupWidthPx: DEFAULT_POPUP_WIDTH_PX,
      popupHeightPx: DEFAULT_POPUP_HEIGHT_PX,
      preferExistingFullscreenPage: DEFAULT_PREFER_EXISTING_FULLSCREEN_PAGE,
      groupExtensionTabsEnabled: DEFAULT_GROUP_EXTENSION_TABS_ENABLED,
      courseHelperExpandedByDefault: DEFAULT_COURSE_HELPER_EXPANDED,
      showCourseListDuringLayoutTransition: DEFAULT_SHOW_COURSE_LIST_DURING_LAYOUT_TRANSITION,
      deadlineCountdownStyle: DEFAULT_DEADLINE_COUNTDOWN_STYLE,
      themeMode: DEFAULT_THEME_MODE
    });
    await chrome.storage.sync.remove(['platformEnabled']);
    document.getElementById('enableVe').checked = true;
    document.getElementById('enableYkt').checked = false;
    document.getElementById('enableMrjzy').checked = false;
    document.getElementById('enableJlgj').checked = false;
    document.getElementById('enableMooc').checked = false;
    document.getElementById('enableXuetangx').checked = false;
    ['showVe', 'showYkt', 'showMrjzy', 'showJlgj', 'showMooc', 'showXuetangx'].forEach((id) => {
      document.getElementById(id).checked = true;
    });
    document.querySelectorAll('.xuetangx-course-status').forEach((input) => {
      input.checked = Number(input.value) === 1;
    });
    document.querySelectorAll('.ykt-activity-type').forEach((input) => {
      input.checked = DEFAULT_YKT_ACTIVITY_TYPES.includes(Number(input.value));
    });
    document.querySelectorAll('.xuetangx-activity-type').forEach((input) => {
      input.checked = DEFAULT_XUETANGX_ACTIVITY_TYPES.includes(Number(input.value));
    });
    document.getElementById('injectMoocHelperEnabled').checked = true;
    document.getElementById('injectMoocPeerReviewEnabled').checked = true;
    document.getElementById('moocPeerReviewCount').value = String(DEFAULT_MOOC_PEER_REVIEW_COUNT);
    updateMoocPeerReviewState();
    setupUiOrderEditor(FALLBACK_OPTIONS_SECTION_ORDER, FALLBACK_PLATFORM_ORDER);
    document.getElementById('jlgjDarkModeEnabled').checked = true;
    document.getElementById('jlgjAlwaysDarkModeEnabled').checked = false;
    document.getElementById('homeworkDetailCollapsedLines').value = String(DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES);
    document.getElementById('replayDetailCollapsedLines').value = String(DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES);
    document.getElementById('parallelLimit').value = String(DEFAULT_PARALLEL_LIMIT);
    document.getElementById('deadlineCountdownStyle').value = DEFAULT_DEADLINE_COUNTDOWN_STYLE;
    document.getElementById('showCourseListDuringLayoutTransition').checked = DEFAULT_SHOW_COURSE_LIST_DURING_LAYOUT_TRANSITION;
    document.getElementById('homeworkReminderEnabled').checked = DEFAULT_HOMEWORK_REMINDER_ENABLED;
    document.getElementById('toolbarPinReminderEnabled').checked = true;
    document.getElementById('homeworkBackgroundRefreshEnabled').checked = false;
    document.getElementById('homeworkNewAssignmentNotificationEnabled').checked = false;
    setScheduleIntervalEditor('homeworkBackgroundRefreshInterval', DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES, DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES);
    currentHomeworkBackgroundRefreshAccount = '';
    renderHomeworkBackgroundAccounts(portalLoginContext);
    updateHomeworkBackgroundRefreshDisabled();
    document.getElementById('backgroundAutoUpdateEnabled').checked = DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED;
    document.getElementById('backgroundAutoInstallOptionalEnabled').checked = DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED;
    setScheduleIntervalEditor('backgroundAutoUpdateInterval', DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES, DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES);
    updateBackgroundAutoInstallOptionalDisabled();
    renderBackgroundAutoUpdateStatus(null);
    updateThemeModeUi(DEFAULT_THEME_MODE);
    currentHomeworkReminderMinutes = [...DEFAULT_HOMEWORK_REMINDER_MINUTES];
    renderHomeworkReminderNodes();
    updateHomeworkReminderDisabled();
    updatePlatformDetailDisabled();
    document.getElementById('autoLoadCourseResourcesEnabled').checked = DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED;
    document.getElementById('openModePopup').checked = true;
    document.getElementById('openModePage').checked = false;
    document.getElementById('preferExistingFullscreenPage').checked = DEFAULT_PREFER_EXISTING_FULLSCREEN_PAGE;
    document.getElementById('groupExtensionTabsEnabled').checked = DEFAULT_GROUP_EXTENSION_TABS_ENABLED;
    document.getElementById('popupWidthPx').value = String(DEFAULT_POPUP_WIDTH_PX);
    document.getElementById('popupHeightPx').value = String(DEFAULT_POPUP_HEIGHT_PX);
    document.getElementById('courseHelperExpandedByDefault').checked = DEFAULT_COURSE_HELPER_EXPANDED;
    document.getElementById('saveUploadsEnabled').checked = true;
    document.getElementById('headerQrEnabled').checked = false;
    document.getElementById('headerQrEnabled').disabled = true;
    document.getElementById('linkQrEnabled').checked = true;
    document.getElementById('popupUseFullscreenCacheEnabled').checked = true;
    document.getElementById('injectPortalLoginOnLoginPage').checked = true;
    document.getElementById('injectPortalLoginOnTimeoutPage').checked = true;
    updatePopupCacheDisabled();
    await chrome.storage.local.set({ openMode: DEFAULT_OPEN_MODE });
    await chrome.storage.local.set({ autoLoadCourseResourcesEnabled: DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED });
    await chrome.storage.local.set({ saveUploadedFilesEnabled: DEFAULT_SAVE_UPLOADS_ENABLED });
    await chrome.storage.local.set({ linkQrEnabled: true });
    await chrome.storage.local.set({ popupUseFullscreenCacheEnabled: DEFAULT_POPUP_CACHE_ENABLED });
    await chrome.storage.local.set({
      injectPortalLoginOnLoginPage: true,
      injectPortalLoginOnTimeoutPage: true
    });
    setMsg('已恢复默认配置');
  };

  const resetConfirmModal = document.getElementById('reset-confirm-modal');
  const closeResetConfirmModal = () => {
    if (resetConfirmModal instanceof HTMLElement) resetConfirmModal.style.display = 'none';
  };
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!(resetConfirmModal instanceof HTMLElement)) return;
    resetConfirmModal.style.display = 'flex';
    document.getElementById('reset-confirm-submit')?.focus();
  });
  document.getElementById('reset-confirm-close')?.addEventListener('click', closeResetConfirmModal);
  document.getElementById('reset-confirm-cancel')?.addEventListener('click', closeResetConfirmModal);
  document.getElementById('reset-confirm-submit')?.addEventListener('click', async () => {
    closeResetConfirmModal();
    await restoreDefaultSettings();
  });
  resetConfirmModal?.addEventListener('click', (event) => {
    if (event.target === resetConfirmModal) closeResetConfirmModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && resetConfirmModal?.style.display === 'flex') closeResetConfirmModal();
  });
  document.documentElement.classList.remove('options-loading');
})();
