(function initMailOptionsModule(global) {
  'use strict';

  const DEFAULT_INTERVAL_MINUTES = 10;
  const MAX_INTERVAL_MINUTES = 525600;
  const DEFAULT_LIST_LIMIT = 10;
  const ENABLED_KEY = 'mailMonitorEnabled';
  const INTERVAL_KEY = 'mailMonitorIntervalMinutes';
  const LIST_LIMIT_KEY = 'mailListLimit';
  const FULLSCREEN_BUTTON_KEY = 'mailFullscreenButtonEnabled';
  const FULLSCREEN_BUTTON_ICON_KEY = 'mailFullscreenButtonIcon';
  const LIST_LIMIT_INPUT_ID = 'mailListLimit';
  const STATUS_KEY = 'mailMonitorStatus';

  let initialized = false;
  let setMessage = () => {};
  let mailPreviewHideTimer = null;
  let mailPreviewRequestId = 0;
  let activeMailPreviewCell = null;

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
    const fullscreenButtonEnabled = element(FULLSCREEN_BUTTON_KEY)?.checked === true;
    const fullscreenButtonIconOption = element('mailFullscreenButtonIconOption');
    fullscreenButtonIconOption?.classList.toggle('is-disabled', !fullscreenButtonEnabled);
    const fullscreenButtonIcon = element(FULLSCREEN_BUTTON_ICON_KEY);
    if (fullscreenButtonIcon instanceof HTMLSelectElement) fullscreenButtonIcon.disabled = !fullscreenButtonEnabled;
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

  function ensureMailPreviewCard() {
    let card = document.getElementById('mailMessagePreviewCard');
    if (card instanceof HTMLElement) return card;
    card = document.createElement('div');
    card.id = 'mailMessagePreviewCard';
    card.className = 'mail-message-preview-card';
    card.hidden = true;
    card.innerHTML = `
      <div class="mail-message-preview-loading"><span class="options-page-spinner"></span><span>正在读取邮件正文…</span></div>
      <div class="mail-message-preview-error" hidden></div>
      <div class="mail-message-preview-attachments" hidden>
        <strong>附件</strong>
        <div class="mail-message-preview-attachment-list"></div>
      </div>
      <iframe class="mail-message-preview-frame" title="邮件正文" sandbox="allow-same-origin" referrerpolicy="no-referrer" hidden></iframe>
    `;
    const frame = card.querySelector('.mail-message-preview-frame');
    frame?.addEventListener('load', () => {
      const frameDocument = frame instanceof HTMLIFrameElement ? frame.contentDocument : null;
      frameDocument?.addEventListener('click', (event) => {
        const anchor = event.target instanceof Element
          ? event.target.closest('a[data-mail-authenticated-url]')
          : null;
        if (!(anchor instanceof HTMLAnchorElement)) return;
        event.preventDefault();
        void downloadMailUrl(anchor.dataset.mailAuthenticatedUrl);
      });
    });
    card.addEventListener('mouseenter', () => {
      if (mailPreviewHideTimer) clearTimeout(mailPreviewHideTimer);
      mailPreviewHideTimer = null;
    });
    card.addEventListener('mouseleave', scheduleHideMailPreview);
    document.body.appendChild(card);
    return card;
  }

  function hideMailPreview() {
    if (mailPreviewHideTimer) clearTimeout(mailPreviewHideTimer);
    mailPreviewHideTimer = null;
    activeMailPreviewCell = null;
    mailPreviewRequestId += 1;
    const card = document.getElementById('mailMessagePreviewCard');
    if (card instanceof HTMLElement) card.hidden = true;
  }

  function scheduleHideMailPreview() {
    if (mailPreviewHideTimer) clearTimeout(mailPreviewHideTimer);
    mailPreviewHideTimer = setTimeout(hideMailPreview, 220);
  }

  function positionMailPreview(cell) {
    const card = ensureMailPreviewCard();
    if (!(cell instanceof HTMLElement) || card.hidden) return;
    const margin = 8;
    const gap = 8;
    const anchor = cell.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const rightSpace = window.innerWidth - anchor.right - margin;
    const leftSpace = anchor.left - margin;
    let left;
    if (rightSpace >= cardRect.width + gap) left = anchor.right + gap;
    else if (leftSpace >= cardRect.width + gap) left = anchor.left - cardRect.width - gap;
    else left = Math.max(margin, (window.innerWidth - cardRect.width) / 2);
    let top = anchor.top;
    if (top + cardRect.height > window.innerHeight - margin) top = window.innerHeight - cardRect.height - margin;
    card.style.left = `${Math.max(margin, left)}px`;
    card.style.top = `${Math.max(margin, top)}px`;
  }

  function buildMailPreviewDocument(content) {
    const parsed = new DOMParser().parseFromString(String(content || ''), 'text/html');
    parsed.querySelectorAll('script, object, embed, iframe, frame, base, meta[http-equiv="refresh" i]').forEach((node) => node.remove());
    const base = parsed.createElement('base');
    base.href = 'https://mail.bjtu.edu.cn/';
    const policy = parsed.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; base-uri https://mail.bjtu.edu.cn; img-src https: http: data:; style-src 'unsafe-inline'; font-src https: data:";
    const style = parsed.createElement('style');
    style.textContent = 'html,body{margin:0;padding:8px;box-sizing:border-box;overflow-wrap:anywhere;color:#111827;background:#fff;font:13px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}';
    parsed.querySelectorAll('a[href]').forEach((anchor) => {
      let url;
      try { url = new URL(anchor.getAttribute('href'), 'https://mail.bjtu.edu.cn/'); } catch { return; }
      if (url.protocol === 'https:' && url.hostname === 'mail.bjtu.edu.cn' && url.pathname.startsWith('/coremail/')) {
        anchor.dataset.mailAuthenticatedUrl = url.href;
        anchor.href = url.href;
      } else {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
    });
    parsed.head.prepend(policy, base, style);
    return `<!doctype html>${parsed.documentElement.outerHTML}`;
  }

  async function downloadMailUrl(url) {
    const result = await send('MAIL_DOWNLOAD_AUTHENTICATED_URL', { url: String(url || '') });
    setMessage(result?.ok ? '已开始下载邮件附件' : `邮件附件下载失败：${result?.message || '未知错误'}`, result?.ok === true);
    return result;
  }

  function buildMailAttachmentUrl(mid, part) {
    const params = new URLSearchParams({ part: String(part || ''), mid: String(mid || ''), mode: 'download' });
    return `https://mail.bjtu.edu.cn/coremail/mbox-data?${params.toString()}`;
  }

  function renderMailPreviewAttachments(card, mid, attachments) {
    const container = card.querySelector('.mail-message-preview-attachments');
    const list = card.querySelector('.mail-message-preview-attachment-list');
    if (!(container instanceof HTMLElement) || !(list instanceof HTMLElement)) return;
    list.replaceChildren();
    const items = Array.isArray(attachments) ? attachments : [];
    items.forEach((attachment) => {
      const row = document.createElement('div');
      row.className = 'mail-message-preview-attachment';
      const button = document.createElement('button');
      button.className = 'mail-message-preview-attachment-download';
      button.type = 'button';
      button.textContent = String(attachment?.filename || '未命名附件');
      button.title = '下载附件';
      button.addEventListener('click', () => {
        void downloadMailUrl(buildMailAttachmentUrl(mid, attachment?.id));
      });
      const bytes = Math.max(0, Number(attachment?.estimateSize) || Number(attachment?.contentLength) || 0);
      const size = document.createElement('span');
      size.className = 'mail-message-preview-attachment-size file-size-emphasis';
      size.dataset.fileSizeBytes = String(bytes);
      size.textContent = globalThis.BjtuFileSizeEmphasis?.formatBytes?.(bytes) || `${bytes} B`;
      row.append(button, size);
      list.appendChild(row);
    });
    container.hidden = items.length === 0;
    globalThis.BjtuFileSizeEmphasis?.refresh?.(container);
  }

  async function showMailPreview(cell, row, { showAttachments = false, showContent = true } = {}) {
    if (!(cell instanceof HTMLElement)) return;
    if (mailPreviewHideTimer) clearTimeout(mailPreviewHideTimer);
    mailPreviewHideTimer = null;
    activeMailPreviewCell = cell;
    const requestId = ++mailPreviewRequestId;
    const card = ensureMailPreviewCard();
    const loading = card.querySelector('.mail-message-preview-loading');
    const loadingText = loading?.querySelector('span:last-child');
    const error = card.querySelector('.mail-message-preview-error');
    const frame = card.querySelector('.mail-message-preview-frame');
    renderMailPreviewAttachments(card, '', []);
    if (loading instanceof HTMLElement) loading.hidden = false;
    if (loadingText instanceof HTMLElement) {
      loadingText.textContent = showContent ? '正在读取邮件正文…' : '正在读取邮件附件…';
    }
    if (error instanceof HTMLElement) {
      error.hidden = true;
      error.textContent = '';
    }
    if (frame instanceof HTMLIFrameElement) {
      frame.hidden = true;
      frame.removeAttribute('srcdoc');
    }
    card.hidden = false;
    positionMailPreview(cell);

    const result = await send('MAIL_GET_MESSAGE_CONTENT', { mid: row.id });
    if (requestId !== mailPreviewRequestId || activeMailPreviewCell !== cell || !cell.isConnected) return;
    if (loading instanceof HTMLElement) loading.hidden = true;
    if (!result?.ok) {
      if (error instanceof HTMLElement) {
        error.textContent = `邮件${showContent ? '正文' : '附件'}读取失败：${result?.message || '未知错误'}`;
        error.hidden = false;
      }
    } else {
      if (showAttachments) {
        renderMailPreviewAttachments(card, result.mid || row.id, result.attachments);
      }
      if (showContent && frame instanceof HTMLIFrameElement) {
        frame.srcdoc = buildMailPreviewDocument(result.content);
        frame.hidden = false;
      }
    }
    positionMailPreview(cell);
  }

  function bindMailPreview(cell, row, { showAttachments = false, showContent = true } = {}) {
    if (!(cell instanceof HTMLElement)) return;
    cell.classList.add('mail-summary-preview-target');
    cell.tabIndex = 0;
    cell.addEventListener('mouseenter', () => {
      void showMailPreview(cell, row, { showAttachments, showContent });
    });
    cell.addEventListener('mouseleave', scheduleHideMailPreview);
    cell.addEventListener('focus', () => {
      void showMailPreview(cell, row, { showAttachments, showContent });
    });
    cell.addEventListener('blur', scheduleHideMailPreview);
  }

  function renderRows(rows) {
    hideMailPreview();
    const list = Array.isArray(rows) ? rows : [];
    const body = element('mailTableBody');
    body?.replaceChildren();
    list.forEach((row) => {
      const unread = row.read !== true;
      const tr = document.createElement('tr');
      tr.className = unread ? 'mail-row mail-row-unread' : 'mail-row';
      const subjectCell = document.createElement('td');
      const subjectLine = document.createElement('a');
      subjectLine.className = 'mail-subject';
      subjectLine.href = String(row.readUrl || 'https://mail.bjtu.edu.cn/');
      subjectLine.target = '_blank';
      subjectLine.rel = 'noopener noreferrer';
      subjectLine.title = '在邮箱网站中打开这封邮件';
      subjectLine.textContent = `${unread ? '[未读] ' : ''}${row.subject || '(无主题)'}`;
      subjectLine.addEventListener('click', (event) => {
        event.preventDefault();
        void send('MAIL_OPEN_MESSAGE', { mid: row.id, fid: row.fid }).then((result) => {
          if (!result?.ok) setMessage(`打开邮件失败：${result?.message || '未知错误'}`, false);
        });
      });
      if (row.attached) {
        const attach = document.createElement('span');
        attach.className = 'mail-attachment';
        attach.textContent = '📎';
        subjectLine.appendChild(attach);
        bindMailPreview(subjectLine, row, { showAttachments: true, showContent: false });
      }
      subjectCell.appendChild(subjectLine);
      tr.appendChild(subjectCell);
      const summaryCell = document.createElement('td');
      summaryCell.className = 'mail-summary-cell';
      if (row.summary) {
        const summaryLine = document.createElement('div');
        summaryLine.className = 'mail-summary-line';
        summaryLine.textContent = row.summary.slice(0, 100) + (row.summary.length > 100 ? '…' : '');
        summaryCell.appendChild(summaryLine);
      } else {
        summaryCell.textContent = '-';
      }
      bindMailPreview(summaryCell, row);
      tr.appendChild(summaryCell);
      appendCell(tr, 'mail-from', row.from || row.sender || '-');
      appendCell(tr, '', row.receivedDate || row.sentDate || '-');
      body?.appendChild(tr);
    });
    element('mailLoading').style.display = 'none';
    element('mailTableWrap').style.display = list.length ? 'block' : 'none';
    if (!list.length) renderError('暂无邮件数据');
    else clearError();
  }

  async function loadThreads() {
    element('mailLoading').style.display = 'flex';
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
    const [context, buttonSettings] = await Promise.all([
      send('MAIL_GET_CONTEXT'),
      chrome.storage.local.get([FULLSCREEN_BUTTON_KEY, FULLSCREEN_BUTTON_ICON_KEY])
    ]);
    const fullscreenButton = element(FULLSCREEN_BUTTON_KEY);
    if (fullscreenButton instanceof HTMLInputElement) {
      fullscreenButton.checked = buttonSettings?.[FULLSCREEN_BUTTON_KEY] !== false;
    }
    const fullscreenButtonIcon = element(FULLSCREEN_BUTTON_ICON_KEY);
    if (fullscreenButtonIcon instanceof HTMLSelectElement) {
      fullscreenButtonIcon.value = buttonSettings?.[FULLSCREEN_BUTTON_ICON_KEY] === 'system' ? 'system' : 'envelope';
    }
    updateDisabledState();
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

  function renderUserInfo(result) {
    const target = element('mailUserInfo');
    if (!(target instanceof HTMLElement)) return;
    if (!result?.ok) return;
    const name = String(result.trueName || '').trim();
    const email = String(result.email || '').trim();
    target.textContent = [name || '（未知姓名）', email].filter(Boolean).join(' · ');
  }

  async function loadUserInfo() {
    const target = element('mailUserInfo');
    if (!(target instanceof HTMLElement)) return null;
    target.textContent = '正在读取用户信息…';
    const result = await send('MAIL_GET_USER_INFO');
    if (result?.ok) {
      renderUserInfo(result);
      return result;
    }
    if (result?.code === 'not-logged-in') {
      target.textContent = '邮箱未登录：请先在「统一身份认证」中保存账号密码';
    } else {
      target.textContent = `用户信息读取失败：${result?.message || '未知错误'}`;
    }
    return null;
  }

  // 无头登录：无论是否已缓存会话，都强制重新经 osys_sso_email 换取 sid；
  // 必要时自动用已保存的 CAS 账号密码完成登录；user:getAttrs 使用该新 sid。
  async function bindMailViaMis(button) {
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    try {
      setMessage('正在通过 MIS 登录邮箱…');
      const result = await send('MAIL_GET_USER_INFO', { forceNewSid: true });
      if (!result?.ok) throw Object.assign(new Error(result?.message || '未知错误'), { code: String(result?.code || '') });
      setMessage('已通过 MIS 登录邮箱');
      renderUserInfo(result);
      await refreshContext();
      void loadThreads();
    } catch (error) {
      if (error?.code === 'not-logged-in') {
        const target = element('mailUserInfo');
        if (target instanceof HTMLElement) {
          target.textContent = '邮箱未登录：请先在「统一身份认证」中保存账号密码';
        }
      }
      setMessage(`通过 MIS 登录邮箱失败：${String(error?.message || error)}`, false);
    } finally {
      button.disabled = false;
    }
  }

  function bindEvents() {
    element(FULLSCREEN_BUTTON_KEY)?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      updateDisabledState();
      await chrome.storage.local.set({ [FULLSCREEN_BUTTON_KEY]: enabled });
      setMessage(enabled ? '已显示 BJTU 邮件系统按钮' : '已隐藏 BJTU 邮件系统按钮');
    });
    element(FULLSCREEN_BUTTON_ICON_KEY)?.addEventListener('change', async (event) => {
      const value = event.currentTarget.value === 'system' ? 'system' : 'envelope';
      await chrome.storage.local.set({ [FULLSCREEN_BUTTON_ICON_KEY]: value });
      setMessage(value === 'system' ? '已使用邮箱网站图标' : '已使用信封图标');
    });
    element(ENABLED_KEY)?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      await chrome.storage.local.set({ [ENABLED_KEY]: enabled });
      updateDisabledState();
      setMessage(enabled ? '已启用邮件监控' : '已关闭邮件监控');
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
        saved = Number.isFinite(number) && number >= 0 ? number : DEFAULT_LIST_LIMIT;
        await chrome.storage.local.set({ [LIST_LIMIT_KEY]: saved });
      }
      if (document.activeElement !== input) {
        input.value = saved === null ? '' : String(saved);
      }
      setMessage(saved === null
        ? '收件箱将加载全部邮件'
        : `收件箱将加载最近 ${saved} 封邮件`);
      void loadThreads();
    });
    element('bindMailSystemBtn')?.addEventListener('click', (event) => {
      void bindMailViaMis(event.currentTarget);
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
      if (changes[FULLSCREEN_BUTTON_KEY] && element(FULLSCREEN_BUTTON_KEY)) {
        element(FULLSCREEN_BUTTON_KEY).checked = changes[FULLSCREEN_BUTTON_KEY].newValue !== false;
        updateDisabledState();
      }
      if (changes[FULLSCREEN_BUTTON_ICON_KEY] && element(FULLSCREEN_BUTTON_ICON_KEY)) {
        element(FULLSCREEN_BUTTON_ICON_KEY).value = changes[FULLSCREEN_BUTTON_ICON_KEY].newValue === 'system'
          ? 'system'
          : 'envelope';
      }
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
    void loadUserInfo();
    void loadThreads();
    return true;
  }

  async function reset() {
    await chrome.storage.local.set({
      [ENABLED_KEY]: true,
      [INTERVAL_KEY]: DEFAULT_INTERVAL_MINUTES,
      [LIST_LIMIT_KEY]: DEFAULT_LIST_LIMIT,
      [FULLSCREEN_BUTTON_KEY]: true,
      [FULLSCREEN_BUTTON_ICON_KEY]: 'envelope'
    });
    await chrome.storage.local.remove([STATUS_KEY]);
    if (!initialized) return;
    element(ENABLED_KEY).checked = true;
    element(FULLSCREEN_BUTTON_KEY).checked = true;
    element(FULLSCREEN_BUTTON_ICON_KEY).value = 'envelope';
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
