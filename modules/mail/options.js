(function initMailOptionsModule(global) {
  'use strict';

  const DEFAULT_INTERVAL_MINUTES = 10;
  const MAX_INTERVAL_MINUTES = 525600;
  const DEFAULT_LIST_LIMIT = 10;
  const ENABLED_KEY = 'mailMonitorEnabled';
  const INTERVAL_KEY = 'mailMonitorIntervalMinutes';
  const LIST_LIMIT_KEY = 'mailListLimit';
  const LIST_LIMIT_INPUT_ID = 'mailListLimit';
  const STATUS_KEY = 'mailMonitorStatus';

  let initialized = false;
  let setMessage = () => {};

  const element = (id) => document.getElementById(id);
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload })
    .catch((error) => ({ ok: false, message: String(error?.message || error) }));

  function normalizeMinutes(value, fallback) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_INTERVAL_MINUTES
      ? minutes
      : fallback;
  }

  function intervalParts(value, fallback) {
    const minutes = normalizeMinutes(value, fallback);
    for (const unit of [1440, 60]) {
      if (minutes % unit === 0) return { value: minutes / unit, unit };
    }
    return { value: minutes, unit: 1 };
  }

  function setIntervalEditor(value, fallback) {
    const parts = intervalParts(value, fallback);
    const input = element('mailMonitorIntervalValue');
    const select = element('mailMonitorIntervalUnit');
    if (input instanceof HTMLInputElement) input.value = String(parts.value);
    if (select instanceof HTMLSelectElement) select.value = String(parts.unit);
  }

  function readIntervalEditor() {
    const value = Number(element('mailMonitorIntervalValue')?.value);
    const unit = Number(element('mailMonitorIntervalUnit')?.value || 1);
    return normalizeMinutes(value * unit, DEFAULT_INTERVAL_MINUTES);
  }

  function updateDisabledState() {
    const enabled = element(ENABLED_KEY)?.checked === true;
    const editor = element('mailMonitorIntervalEditor');
    editor?.classList.toggle('is-disabled', !enabled);
    editor?.querySelectorAll('input,select').forEach((control) => { control.disabled = !enabled; });
  }

  function renderCheckedAt(target, value) {
    if (!(target instanceof HTMLTimeElement)) return;
    const date = new Date(Number(value || 0));
    target.textContent = Number.isNaN(date.getTime()) || !Number(value)
      ? ''
      : date.toLocaleString('zh-CN', { hour12: false });
  }

  function renderSummary({ total = null, unreadCount = null, checkedAt = 0 } = {}) {
    renderCheckedAt(element('mailCheckedAt'), checkedAt);
    const parts = [];
    if (Number.isFinite(Number(total))) parts.push(`共 ${Number(total)} 封`);
    if (Number.isFinite(Number(unreadCount))) parts.push(`未读 ${Number(unreadCount)} 封`);
    element('mailCount').textContent = parts.length ? parts.join('，') : '';
  }

  function renderError(message) {
    const target = element('mailStatus');
    if (!(target instanceof HTMLElement)) return;
    target.classList.add('error');
    target.style.display = 'block';
    target.textContent = String(message || '');
  }

  function clearError() {
    const target = element('mailStatus');
    if (!(target instanceof HTMLElement)) return;
    target.classList.remove('error');
    target.style.display = 'none';
    target.textContent = '';
  }

  function renderStatus(status) {
    if (!status) {
      renderSummary({});
      return;
    }
    if (status.status === 'error') {
      renderError(`邮件检查失败：${status.error || '未知错误'}`);
      return;
    }
    if (status.status === 'ok' || status.status === 'complete') {
      renderSummary(status);
      if (!element('mailTableBody')?.childElementCount) renderError('暂无邮件数据');
      else clearError();
    }
  }

  function appendCell(row, className, text) {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = String(text ?? '');
    row.appendChild(td);
    return td;
  }

  function renderRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const body = element('mailTableBody');
    body?.replaceChildren();
    list.forEach((row) => {
      const unread = row.read !== true;
      const tr = document.createElement('tr');
      tr.className = unread ? 'mail-row mail-row-unread' : 'mail-row';
      const subjectCell = document.createElement('td');
      const subjectLine = document.createElement('div');
      subjectLine.className = 'mail-subject';
      subjectLine.textContent = `${unread ? '[未读] ' : ''}${row.subject || '(无主题)'}`;
      if (row.attached) {
        const attach = document.createElement('span');
        attach.className = 'mail-attachment';
        attach.textContent = '📎';
        subjectLine.appendChild(attach);
      }
      subjectCell.appendChild(subjectLine);
      if (row.summary) {
        const summaryLine = document.createElement('div');
        summaryLine.className = 'mail-summary-line';
        summaryLine.textContent = row.summary.slice(0, 80) + (row.summary.length > 80 ? '…' : '');
        subjectCell.appendChild(summaryLine);
      }
      tr.appendChild(subjectCell);
      appendCell(tr, 'mail-from', row.from || row.sender || '-');
      appendCell(tr, '', row.receivedDate || row.sentDate || '-');
      appendCell(tr, '', Number(row.threadMessageCount) > 0 ? Number(row.threadMessageCount) : '-');
      body?.appendChild(tr);
    });
    element('mailLoading').style.display = 'none';
    element('mailTableHeadWrap').style.display = list.length ? 'block' : 'none';
    element('mailTableWrap').style.display = list.length ? 'block' : 'none';
    if (!list.length) renderError('暂无邮件数据');
    else clearError();
  }

  async function loadThreads() {
    element('mailLoading').style.display = 'flex';
    element('mailTableHeadWrap').style.display = 'none';
    element('mailTableWrap').style.display = 'none';
    clearError();
    const result = await send('MAIL_LOAD_THREADS');
    if (!result?.ok) {
      element('mailLoading').style.display = 'none';
      renderError(result?.code === 'not-logged-in'
        ? '邮箱未登录：请先在「C统一身份认证」中登录并保存账号密码'
        : `收件箱读取失败：${result?.message || '未知错误'}`);
      await refreshContext();
      return result;
    }
    renderRows(result.rows);
    renderSummary(result);
    return result;
  }

  async function refreshContext() {
    const context = await send('MAIL_GET_CONTEXT');
    if (!context?.ok) return null;
    element(ENABLED_KEY).checked = context.enabled === true;
    setIntervalEditor(context.intervalMinutes, DEFAULT_INTERVAL_MINUTES);
    const limitInput = element(LIST_LIMIT_INPUT_ID);
    if (limitInput instanceof HTMLInputElement && document.activeElement !== limitInput) {
      limitInput.value = context.listLimit === null ? '' : String(context.listLimit);
    }
    updateDisabledState();
    renderStatus(context.status);
    return context;
  }

  function bindEvents() {
    element(ENABLED_KEY)?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
      updateDisabledState();
      setMessage(enabled ? '已启用邮件监控，正在执行首次检测…' : '已关闭邮件监控');
    });
    const saveInterval = async () => {
      const minutes = readIntervalEditor();
      await chrome.storage.local.set({ [INTERVAL_KEY]: minutes });
      setIntervalEditor(minutes, DEFAULT_INTERVAL_MINUTES);
      setMessage(`已将邮件检查间隔设为 ${minutes} 分钟`);
    };
    element('mailMonitorIntervalValue')?.addEventListener('change', saveInterval);
    element('mailMonitorIntervalUnit')?.addEventListener('change', saveInterval);
    element(LIST_LIMIT_INPUT_ID)?.addEventListener('change', async (event) => {
      const input = event.currentTarget;
      const raw = String(input?.value ?? '').trim();
      let saved;
      if (raw === '') {
        await chrome.storage.local.set({ [LIST_LIMIT_KEY]: '' });
        saved = null;
      } else {
        const number = Math.floor(Number(raw));
        saved = Number.isFinite(number) && number >= 1 ? number : DEFAULT_LIST_LIMIT;
        await chrome.storage.local.set({ [LIST_LIMIT_KEY]: saved });
      }
      if (document.activeElement !== input) {
        input.value = saved === null ? '' : String(saved);
      }
      setMessage(saved === null ? '收件箱将加载全部邮件' : `收件箱将加载最近 ${saved} 封邮件`);
      void loadThreads();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[ENABLED_KEY]) {
        element(ENABLED_KEY).checked = changes[ENABLED_KEY].newValue === true;
        updateDisabledState();
      }
      if (changes[INTERVAL_KEY]) {
        setIntervalEditor(changes[INTERVAL_KEY].newValue, DEFAULT_INTERVAL_MINUTES);
      }
      if (changes[STATUS_KEY]) renderStatus(changes[STATUS_KEY].newValue);
    });
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'MAIL_DATA_UPDATED') return;
      const payload = message.payload || {};
      if (payload.kind === 'threads') {
        renderRows(payload.rows);
        renderSummary(payload);
      } else if (payload.kind === 'status') {
        void refreshContext();
      }
    });
  }

  async function init(options = {}) {
    if (initialized) return true;
    initialized = true;
    setMessage = typeof options.setMessage === 'function' ? options.setMessage : setMessage;
    bindEvents();
    await refreshContext();
    void loadThreads();
    return true;
  }

  async function reset() {
    await chrome.storage.local.set({
      [ENABLED_KEY]: false,
      [INTERVAL_KEY]: DEFAULT_INTERVAL_MINUTES,
      [LIST_LIMIT_KEY]: DEFAULT_LIST_LIMIT
    });
    await chrome.storage.local.remove([STATUS_KEY]);
    if (!initialized) return;
    element(ENABLED_KEY).checked = false;
    setIntervalEditor(DEFAULT_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES);
    const limitInput = element(LIST_LIMIT_INPUT_ID);
    if (limitInput instanceof HTMLInputElement) limitInput.value = String(DEFAULT_LIST_LIMIT);
    updateDisabledState();
    renderSummary({});
    clearError();
  }

  global.BjtuMailOptions = { init, reset };
  global.BjtuOptionsModules?.register('mail', global.BjtuMailOptions);
})(globalThis);
