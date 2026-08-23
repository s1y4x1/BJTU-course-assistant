(function (global) {
  'use strict';

  const MIS_SSO_URL = 'https://mis.bjtu.edu.cn/osys_sso_email/';
  const MAIL_HOME_URL = 'https://mail.bjtu.edu.cn/';
  const FOLDERS_URL = 'https://mail.bjtu.edu.cn/coremail/XT/jsp/mail.jsp';
  const LIST_THREADS_URL = 'https://mail.bjtu.edu.cn/coremail/s/json';

  const ENABLED_KEY = 'mailMonitorEnabled';
  const INTERVAL_KEY = 'mailMonitorIntervalMinutes';
  const LIST_LIMIT_KEY = 'mailListLimit';
  const SNAPSHOTS_KEY = 'mailSnapshots';
  const PENDING_NOTIFICATIONS_KEY = 'mailPendingNotifications';
  const STATUS_KEY = 'mailMonitorStatus';
  const ALARM_NAME = 'bjtu-mail-check';
  const NOTIFICATION_PREFIX = 'bjtu-mail-new:';

  const DEFAULT_INTERVAL_MINUTES = 10;
  const MAX_INTERVAL_MINUTES = 525600;
  const DEFAULT_LIST_LIMIT = 10;
  const INBOX_FID = 1;

  let cachedSid = '';
  let mailCheckPromise = null;
  let mailProcessPromise = Promise.resolve();

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const ch of String(value || '')) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  async function broadcastData(kind, payload) {
    try {
      chrome.runtime.sendMessage({
        type: 'MAIL_DATA_UPDATED',
        payload: { kind, ...payload, ts: Date.now() }
      }, () => { void chrome.runtime.lastError; });
    } catch {
      // No extension page may be open.
    }
  }

  function createSystemNotification(notificationId, options) {
    if (globalThis.BjtuSystemNotifications?.create) {
      return globalThis.BjtuSystemNotifications.create(notificationId, options, 'mail');
    }
    return new Promise((resolve, reject) => {
      chrome.notifications.create(notificationId, options, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || '创建邮件通知失败'));
        else resolve(notificationId);
      });
    });
  }

  // sid 获取：GET MIS 邮箱 SSO 入口并跟随跳转，最终落在
  // https://mail.bjtu.edu.cn/coremail/main.jsp?sid={sid}（需已完成 CAS 登录）。
  async function resolveMailSid() {
    const response = await fetch(MIS_SSO_URL, {
      credentials: 'include', cache: 'no-store', redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });
    let parsed = null;
    try { parsed = new URL(String(response.url || '')); } catch { parsed = null; }
    if (parsed?.hostname === 'cas.bjtu.edu.cn' && /^\/auth\/login(?:\/|$)/i.test(parsed.pathname)) {
      throw Object.assign(new Error('CAS 未登录'), { code: 'not-logged-in' });
    }
    if (parsed?.hostname !== 'mail.bjtu.edu.cn') {
      throw new Error(`邮件系统跳转异常：${String(response.url || '无最终地址')}`);
    }
    let sid = String(parsed.searchParams.get('sid') || '').trim();
    if (!sid) {
      const cookie = await chrome.cookies.get({
        url: 'https://mail.bjtu.edu.cn/', name: 'Coremail.sid'
      }).catch(() => null);
      sid = String(cookie?.value || '').trim();
    }
    if (!sid) throw new Error('未能获取邮件系统 sid');
    return sid;
  }

  // 自动登录：使用「CAS 统一身份认证」模块中已保存的账号密码完成 CAS 登录。
  async function casLoginForMail() {
    const internals = global.BjtuCasSystemInternals;
    if (!internals?.getContext || !internals?.loginSavedAccount) {
      throw Object.assign(new Error('CAS 模块不可用，无法自动登录'), { code: 'not-logged-in' });
    }
    const context = await internals.getContext().catch(() => null);
    const accounts = Array.isArray(context?.accounts) ? context.accounts : [];
    const preferred = String(context?.loginName || '').trim();
    const account = accounts.find((item) => item.loginName === preferred && item.hasPassword)
      || accounts.find((item) => item.hasPassword);
    if (!account) {
      throw Object.assign(
        new Error('CAS 未登录且没有已保存的账号密码，请先在「CAS 统一身份认证」中登录'),
        { code: 'not-logged-in' }
      );
    }
    const result = await internals.loginSavedAccount({ loginName: account.loginName });
    if (!result?.ok) {
      throw Object.assign(
        new Error(`CAS 自动登录失败：${result?.message || '未知错误'}`),
        { code: 'not-logged-in' }
      );
    }
    await wait(300);
  }

  async function getMailSid({ allowRelogin = true } = {}) {
    if (cachedSid) return cachedSid;
    try {
      cachedSid = await resolveMailSid();
      return cachedSid;
    } catch (error) {
      if (!allowRelogin || String(error?.code || '') !== 'not-logged-in') throw error;
      await casLoginForMail();
      cachedSid = await resolveMailSid();
      return cachedSid;
    }
  }

  function invalidateSid() {
    cachedSid = '';
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
      ...options
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text.trim());
    } catch {
      throw new Error(`响应不是有效 JSON：${text.slice(0, 120)}`);
    }
  }

  // var[1].stats.unreadMessageCount 为未读消息数；异常时退化为扫描含 stats 的目录项。
  function extractUnreadCount(data) {
    const list = Array.isArray(data?.var) ? data.var : [];
    const preferred = Number(list[1]?.stats?.unreadMessageCount);
    if (Number.isFinite(preferred)) return preferred;
    for (const item of list) {
      const count = Number(item?.stats?.unreadMessageCount);
      if (Number.isFinite(count)) return count;
    }
    return null;
  }

  async function fetchUnreadCount(sid) {
    const params = new URLSearchParams({ func: 'getAllFolders', sid, stats: 'true', threads: 'true' });
    const data = await requestJson(`${FOLDERS_URL}?${params.toString()}`, { method: 'POST' });
    if (data?.code !== 'S_OK') throw new Error(`读取邮箱目录失败：${data?.code || '无响应码'}`);
    return extractUnreadCount(data);
  }

  function normalizeMailRow(row) {
    const source = row && typeof row === 'object' ? row : {};
    const id = String(source.id || '').trim();
    // 兼容原始响应（flags.read）与已规范化的行（read）。
    const read = typeof source.read === 'boolean' ? source.read : source.flags?.read === true;
    const attached = typeof source.attached === 'boolean'
      ? source.attached
      : source.flags?.attached === true;
    return {
      id,
      fid: Number(source.fid || INBOX_FID),
      subject: String(source.subject || '').replace(/\s+/g, ' ').trim(),
      from: String(source.from || '').replace(/\s+/g, ' ').trim(),
      sender: String(source.sender || '').trim(),
      to: String(source.to || '').replace(/\s+/g, ' ').trim(),
      summary: String(source.summary || '').replace(/\s+/g, ' ').trim(),
      sentDate: String(source.sentDate || '').trim(),
      receivedDate: String(source.receivedDate || '').trim(),
      modifiedDate: String(source.modifiedDate || '').trim(),
      read,
      attached,
      threadMessageCount: Number(source.threadMessageCount || 0)
    };
  }

  function mailFingerprint(row) {
    return JSON.stringify([
      row.subject, row.from, row.receivedDate, row.sentDate,
      row.read, row.threadMessageCount
    ]);
  }

  // limit 为正整数时限制条数；为空时不传 limit，服务端返回全部邮件。
  async function fetchInboxThreads(sid, limit = null) {
    const params = new URLSearchParams({ func: 'mbox:listThreads', sid });
    const body = {
      start: 0,
      mode: 'count',
      order: 'date',
      desc: true,
      returnTotal: true,
      returnTag: false,
      fid: INBOX_FID,
      mboxa: '',
      topFirst: true
    };
    const boundedLimit = Number(limit);
    if (Number.isFinite(boundedLimit) && boundedLimit >= 1) {
      body.limit = Math.floor(boundedLimit);
      body.summaryWindowSize = body.limit;
    } else {
      body.summaryWindowSize = 100;
    }
    const data = await requestJson(`${LIST_THREADS_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (data?.code !== 'S_OK') throw new Error(`读取收件箱失败：${data?.code || '无响应码'}`);
    const rows = (Array.isArray(data?.var) ? data.var : []).map(normalizeMailRow).filter((row) => row.id);
    return { rows, total: Number(data?.total ?? rows.length) };
  }

  function normalizeListLimit(value) {
    if (String(value ?? '').trim() === '') return null;
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number >= 1 ? number : DEFAULT_LIST_LIMIT;
  }

  async function currentAccountKey() {
    try {
      const context = await global.BjtuCasSystemInternals?.getContext();
      return String(context?.loginName || '').trim() || 'default';
    } catch {
      return 'default';
    }
  }

  function formatMailNotification(row) {
    const summary = String(row.summary || '');
    return [
      `发件人：${row.from || row.sender || '-'}`,
      `时间：${row.receivedDate || row.sentDate || '-'}`,
      summary ? `摘要：${summary.slice(0, 140)}${summary.length > 140 ? '…' : ''}` : ''
    ].filter(Boolean).join('\n');
  }

  async function notifyNewMail(row) {
    const notificationId = `${NOTIFICATION_PREFIX}${shortHash(`${row.id}|${mailFingerprint(row)}`)}`;
    await createSystemNotification(notificationId, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: `收到新邮件：${row.subject || '(无主题)'}`,
      message: formatMailNotification(row),
      priority: 2
    });
    return notificationId;
  }

  function normalizePendingNotifications(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const [key, item] of Object.entries(source)) {
      const row = normalizeMailRow(item?.row);
      if (!row.id) continue;
      result[key] = { row, createdAt: Number(item?.createdAt || Date.now()) };
    }
    return result;
  }

  async function flushPendingNotifications(pendingOverride = null) {
    const stored = pendingOverride
      ? null
      : await chrome.storage.local.get([PENDING_NOTIFICATIONS_KEY]);
    const pending = normalizePendingNotifications(
      pendingOverride || stored?.[PENDING_NOTIFICATIONS_KEY]
    );
    let changed = false;
    for (const [key, item] of Object.entries(pending)) {
      try {
        await notifyNewMail(item.row);
        delete pending[key];
        changed = true;
      } catch {
        // Keep failed notifications for the next alarm instead of losing them.
      }
    }
    if (changed || pendingOverride) {
      await chrome.storage.local.set({ [PENDING_NOTIFICATIONS_KEY]: pending });
    }
    return pending;
  }

  async function processMailRowsInternal(rows, total, unreadCount, source = 'poll') {
    const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeMailRow)
      .filter((row) => row.id);
    const stored = await chrome.storage.local.get([SNAPSHOTS_KEY, PENDING_NOTIFICATIONS_KEY, ENABLED_KEY]);
    const key = await currentAccountKey();
    const snapshots = stored?.[SNAPSHOTS_KEY] && typeof stored[SNAPSHOTS_KEY] === 'object'
      ? { ...stored[SNAPSHOTS_KEY] }
      : {};
    const previous = snapshots[key]?.rows && typeof snapshots[key].rows === 'object'
      ? snapshots[key].rows
      : null;
    const nextRows = Object.fromEntries(normalizedRows.map((row) => [row.id, row]));
    const changes = [];
    const notificationsEnabled = stored?.[ENABLED_KEY] === true;
    // 首次检测仅建立基线，避免把历史邮件全部当作新邮件通知。
    if (previous && notificationsEnabled) {
      for (const row of normalizedRows) {
        if (!previous[row.id]) changes.push(row);
      }
    }
    const pending = normalizePendingNotifications(stored?.[PENDING_NOTIFICATIONS_KEY]);
    for (const row of changes) {
      // 已读邮件（如已在其他端阅读过）只入基线，不发系统通知。
      if (row.read === true) continue;
      pending[shortHash(`${key}|new|${row.id}|${mailFingerprint(row)}`)] = {
        row,
        createdAt: Date.now()
      };
    }
    const checkedAt = Date.now();
    snapshots[key] = { rows: nextRows, updatedAt: checkedAt };
    await chrome.storage.local.set({
      [SNAPSHOTS_KEY]: snapshots,
      [PENDING_NOTIFICATIONS_KEY]: pending,
      [STATUS_KEY]: {
        status: 'ok', total, unreadCount,
        count: normalizedRows.length, changes: changes.length, checkedAt
      }
    });
    broadcastData('threads', {
      rows: normalizedRows, total, unreadCount, checkedAt
    });
    const remainingPending = await flushPendingNotifications(pending);
    return {
      count: normalizedRows.length,
      changes: changes.length,
      pendingNotifications: Object.keys(remainingPending).length,
      baseline: !previous,
      rows: normalizedRows,
      total,
      unreadCount,
      checkedAt
    };
  }

  function processMailRows(rows, total, unreadCount, source = 'poll') {
    const run = mailProcessPromise.then(() => processMailRowsInternal(rows, total, unreadCount, source));
    mailProcessPromise = run.catch(() => {});
    return run;
  }

  async function checkMail(source = 'poll', { force = false } = {}) {
    if (mailCheckPromise) return mailCheckPromise;
    mailCheckPromise = (async () => {
      const settings = await chrome.storage.local.get([ENABLED_KEY, LIST_LIMIT_KEY]);
      if (!force && settings?.[ENABLED_KEY] !== true) return { skipped: true };
      const listLimit = normalizeListLimit(settings?.[LIST_LIMIT_KEY] ?? DEFAULT_LIST_LIMIT);
      try {
        await flushPendingNotifications();
        let sid = await getMailSid();
        let unreadCount;
        let threads;
        try {
          [unreadCount, threads] = await Promise.all([
            fetchUnreadCount(sid), fetchInboxThreads(sid, listLimit)
          ]);
        } catch (error) {
          // sid 可能已过期：重置后经 CAS 重新获取一次。
          invalidateSid();
          sid = await getMailSid();
          [unreadCount, threads] = await Promise.all([
            fetchUnreadCount(sid), fetchInboxThreads(sid, listLimit)
          ]).catch(() => { throw error; });
        }
        return await processMailRows(threads.rows, threads.total, unreadCount, source);
      } catch (error) {
        invalidateSid();
        await chrome.storage.local.set({
          [STATUS_KEY]: {
            status: 'error', error: String(error?.message || error),
            code: String(error?.code || ''), checkedAt: Date.now()
          }
        }).catch(() => {});
        broadcastData('status', {});
        throw error;
      }
    })().finally(() => { mailCheckPromise = null; });
    return mailCheckPromise;
  }

  function normalizeIntervalMinutes(value) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_INTERVAL_MINUTES
      ? minutes
      : DEFAULT_INTERVAL_MINUTES;
  }

  async function ensureAlarm() {
    const stored = await chrome.storage.local.get([INTERVAL_KEY]).catch(() => ({}));
    const interval = normalizeIntervalMinutes(stored?.[INTERVAL_KEY]);
    const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);
    if (existing && Number(existing.periodInMinutes || 0) === interval) return existing;
    if (existing) await chrome.alarms.clear(ALARM_NAME).catch(() => false);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: interval, periodInMinutes: interval });
    return chrome.alarms.get(ALARM_NAME).catch(() => null);
  }

  function scheduleMailChecks() {
    checkMail('scheduled').catch(() => {});
  }

  async function buildMailContext() {
    const stored = await chrome.storage.local.get([
      ENABLED_KEY, INTERVAL_KEY, LIST_LIMIT_KEY, STATUS_KEY
    ]);
    let casLoginName = '';
    try {
      const casContext = await global.BjtuCasSystemInternals?.getContext();
      casLoginName = String(casContext?.loginName || '');
    } catch {
      casLoginName = '';
    }
    return {
      ok: true,
      enabled: stored?.[ENABLED_KEY] === true,
      intervalMinutes: normalizeIntervalMinutes(stored?.[INTERVAL_KEY]),
      listLimit: normalizeListLimit(stored?.[LIST_LIMIT_KEY] ?? DEFAULT_LIST_LIMIT),
      status: stored?.[STATUS_KEY] || null,
      casLoginName
    };
  }

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'MAIL_GET_CONTEXT') {
        buildMailContext()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'MAIL_LOAD_THREADS') {
        checkMail('manual', { force: true })
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      return false;
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name === ALARM_NAME) scheduleMailChecks();
    });

    chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); scheduleMailChecks(); });
    chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); scheduleMailChecks(); });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local'
        || (!changes[ENABLED_KEY] && !changes[INTERVAL_KEY])) return;
      void ensureAlarm();
      if (changes[ENABLED_KEY]) {
        if (changes[ENABLED_KEY].newValue === true) checkMail('enabled').catch(() => {});
        else chrome.storage.local.remove([PENDING_NOTIFICATIONS_KEY]).catch(() => {});
      }
    });

    chrome.notifications.onClicked.addListener((notificationId) => {
      if (!String(notificationId || '').startsWith(NOTIFICATION_PREFIX)) return;
      globalThis.BjtuTabs.create({ url: MAIL_HOME_URL, active: true }).catch(() => {});
      chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    });

    void ensureAlarm();
  }

  global.BjtuMailSystemInternals = {
    getContext: () => buildMailContext(),
    checkNow: () => checkMail('manual', { force: true }),
    resolveMailSid,
    getMailSid,
    extractUnreadCount,
    normalizeMailRow,
    mailFingerprint,
    parseInboxResponse: (data) => ({
      rows: (Array.isArray(data?.var) ? data.var : []).map(normalizeMailRow),
      total: Number(data?.total ?? 0)
    })
  };
})(globalThis);
