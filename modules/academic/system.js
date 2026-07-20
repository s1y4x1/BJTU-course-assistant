(function (global) {
  'use strict';

  const LOGIN_URL = 'https://aa.bjtu.edu.cn/client/login/';
  const INDEX_URL = 'https://aa.bjtu.edu.cn/client/index/';
  const SCORE_URL = 'https://aa.bjtu.edu.cn/score/scores/stu/view';
  const TRAINING_PROGRAM_URL = 'https://aa.bjtu.edu.cn/training/training/program/';
  const MIS_MODULE_URL = 'https://mis.bjtu.edu.cn/module/module/10/';
  const ACCOUNTS_KEY = 'academicSystemAccounts';
  const OBSOLETE_BINDING_KEYS = ['academicSystemBindings', 'academicSystemBindToastShown'];
  const STUDENT_ID_KEY = 'academicSystemStudentId';
  const MONITOR_KEY = 'academicScoreMonitorEnabled';
  const MONITOR_INTERVAL_KEY = 'academicScoreMonitorIntervalMinutes';
  const DEFAULT_MONITOR_INTERVAL_MINUTES = 1;
  const SNAPSHOTS_KEY = 'academicScoreSnapshots';
  const PENDING_NOTIFICATIONS_KEY = 'academicScorePendingNotifications';
  const STATUS_KEY = 'academicScoreMonitorStatus';
  const ALARM_NAME = 'bjtu-academic-score-check';
  const NOTIFICATION_PREFIX = 'bjtu-academic-score:';
  // Can be changed from the extension service worker console through
  // BjtuAcademicSystemInternals.notifyInitialScoreRows.
  let notifyInitialScoreRows = true;
  const misLoginTabs = new Set();
  const misLoginVerifyingTabs = new Set();
  const pendingCredentialsByTab = new Map();
  let scoreCheckPromise = null;
  let scoreProcessPromise = Promise.resolve();
  let accountWritePromise = Promise.resolve();

  function decodeHtmlEntities(value) {
    const named = {
      amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"'
    };
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const token = String(entity || '').toLowerCase();
      if (token.startsWith('#x')) return String.fromCodePoint(parseInt(token.slice(2), 16));
      if (token.startsWith('#')) return String.fromCodePoint(parseInt(token.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(named, token) ? named[token] : match;
    });
  }

  function textFromHtml(value, preserveLines = false) {
    let text = String(value || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    text = decodeHtmlEntities(text).replace(/\r/g, '');
    if (preserveLines) {
      return text.split('\n')
        .map((line) => line.replace(/[\t ]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function extractDataContent(html) {
    const match = String(html || '').match(/\bdata-content\s*=\s*(["'])([\s\S]*?)\1/i);
    return match ? textFromHtml(match[2], true) : '';
  }

  function normalizeScoreRow(row) {
    const source = row && typeof row === 'object' ? row : {};
    const normalized = {
      sequence: String(source.sequence || '').trim(),
      academicYear: String(source.academicYear || '').replace(/\s+/g, ' ').trim(),
      course: String(source.course || '').replace(/\s+/g, ' ').trim(),
      credit: String(source.credit || '').replace(/\s+/g, ' ').trim(),
      score: String(source.score || '').replace(/\s+/g, ' ').trim(),
      bonusScore: String(source.bonusScore || '').replace(/\s+/g, ' ').trim(),
      teacher: String(source.teacher || '').replace(/\s+/g, ' ').trim(),
      details: String(source.details || '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim()
    };
    const courseCode = normalized.course.match(/^[A-Z0-9]+/i)?.[0] || '';
    const courseName = normalized.course.slice(courseCode.length).trim() || normalized.course;
    normalized.courseCode = courseCode;
    normalized.courseName = courseName;
    normalized.key = `${normalized.academicYear}|${normalized.course}`;
    return normalized;
  }

  function parseScorePage(html) {
    const source = String(html || '');
    const table = [...source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
      .find((match) => /\bclass\s*=\s*["'][^"']*\btable-bordered\b/i.test(match[1])
        && /<th\b[^>]*>\s*学年\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*成绩\s*<\/th>/i.test(match[2]));
    const hasScoreTable = !!table;
    const tableHtml = table?.[2] || '';
    const rows = [];
    for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[1];
      const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length < 7) continue;
      const details = extractDataContent(cells[7] || rowHtml)
        || textFromHtml(cells[7] || '', true).replace(/^详情$/u, '');
      const row = normalizeScoreRow({
        sequence: textFromHtml(cells[0]),
        academicYear: textFromHtml(cells[1]),
        course: textFromHtml(cells[2]),
        credit: textFromHtml(cells[3]),
        score: textFromHtml(cells[4]),
        bonusScore: textFromHtml(cells[5]),
        teacher: textFromHtml(cells[6]),
        details
      });
      if (row.academicYear && row.course) rows.push(row);
    }
    return { hasScoreTable, rows };
  }

  function parseCurrentAccountPage(html) {
    const source = String(html || '');
    const table = [...source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
      .find((match) => /\bclass\s*=\s*["'][^"']*\btable-bordered\b/i.test(match[1])
        && /<th\b[^>]*>\s*学生\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*专业\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*培养方案\s*<\/th>/i.test(match[2]));
    if (!table) return null;
    for (const rowMatch of table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length < 2) continue;
      const student = textFromHtml(cells[1]);
      const match = student.match(/^(\S+)\s+(.+)$/u);
      if (!match) continue;
      return {
        studentId: String(match[1] || '').trim(),
        userName: String(match[2] || '').trim()
      };
    }
    return null;
  }

  function scoreFingerprint(row) {
    return JSON.stringify([
      row.academicYear, row.course, row.credit, row.score,
      row.bonusScore, row.teacher, row.details
    ]);
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const ch of String(value || '')) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function formatScoreNotification(row) {
    return [
      `成绩：${row.score || '-'}`,
      `上课教师：${row.teacher || '-'}`,
      `学年：${row.academicYear || '-'}`,
      `学分：${row.credit || '-'}`,
      `序号：${row.sequence || '-'}`,
      `详细信息：${row.details || '-'}`
    ].join('\n');
  }

  async function broadcastStatus(payload) {
    const status = { ...payload, ts: Date.now() };
    try {
      chrome.runtime.sendMessage({ type: 'ACADEMIC_SYSTEM_STATUS', payload: status }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // No extension page may be open.
    }
  }

  async function showAcademicPageToast(tabId, message) {
    if (!tabId) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (content) => {
        const id = '__bjtu_academic_login_toast__';
        document.getElementById(id)?.remove();
        const toast = document.createElement('div');
        toast.id = id;
        toast.textContent = content;
        toast.style.cssText = [
          'position:fixed', 'left:50%', 'top:18px', 'transform:translateX(-50%)',
          'z-index:2147483647', 'background:#16a34a', 'color:#fff',
          'font:600 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
          'padding:10px 14px', 'border-radius:8px', 'box-shadow:0 10px 30px rgba(0,0,0,.22)'
        ].join(';');
        document.documentElement.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
      },
      args: [String(message || '')]
    }).catch(() => {});
  }

  async function getAcademicAccounts() {
    const stored = await chrome.storage.local.get([ACCOUNTS_KEY]);
    const rawAccounts = stored?.[ACCOUNTS_KEY] && typeof stored[ACCOUNTS_KEY] === 'object'
      ? stored[ACCOUNTS_KEY]
      : {};
    const accounts = {};
    for (const [studentId, source] of Object.entries(rawAccounts)) {
      const id = String(studentId || '').trim();
      if (!id) continue;
      accounts[id] = {
        studentId: id,
        userName: String(source?.userName || ''),
        password: String(source?.password || ''),
        updatedAt: Number(source?.updatedAt || 0),
        lastLoginAt: Number(source?.lastLoginAt || 0)
      };
    }
    return accounts;
  }
  async function saveAcademicAccount(studentId, patch = {}) {
    const id = String(studentId || '').trim();
    if (!id) throw new Error('学号为空');
    const write = accountWritePromise.then(async () => {
      const accounts = await getAcademicAccounts();
      const current = accounts[id] || { studentId: id, userName: '', password: '', updatedAt: 0, lastLoginAt: 0 };
      accounts[id] = {
        ...current,
        ...patch,
        studentId: id,
        userName: patch.userName === undefined ? String(current.userName || '') : String(patch.userName || ''),
        password: patch.password === undefined ? String(current.password || '') : String(patch.password || ''),
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts, [STUDENT_ID_KEY]: id });
      return accounts[id];
    });
    accountWritePromise = write.catch(() => {});
    return write;
  }
  async function clearAcademicCookies() {
    const cookies = await chrome.cookies.getAll({ domain: 'aa.bjtu.edu.cn' }).catch(() => []);
    await Promise.all((cookies || []).map((cookie) => {
      const host = String(cookie.domain || 'aa.bjtu.edu.cn').replace(/^\./, '');
      const path = String(cookie.path || '/');
      return chrome.cookies.remove({
        url: `https://${host}${path}`,
        name: cookie.name,
        storeId: cookie.storeId
      }).catch(() => null);
    }));
  }

  async function ensureAcademicOriginTab() {
    const tabs = await chrome.tabs.query({ url: ['https://aa.bjtu.edu.cn/*'] }).catch(() => []);
    const reusable = tabs.find((tab) => tab?.id && tab.status === 'complete');
    if (reusable) return { tab: reusable, temporary: false };
    const tab = await chrome.tabs.create({ url: LOGIN_URL, active: false });
    if (!tab?.id) throw new Error('无法打开教务系统登录页');
    const loaded = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(null, new Error('教务系统登录页加载超时')), 20000);
      const finish = (result, error) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        if (error) reject(error); else resolve(result);
      };
      const onUpdated = (updatedId, changeInfo, updatedTab) => {
        if (updatedId === tab.id && changeInfo.status === 'complete') finish(updatedTab);
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
    return { tab: loaded || tab, temporary: true };
  }

  async function loginWithPassword(studentId, password) {
    const id = String(studentId || '').trim();
    const secret = String(password || '').trim();
    if (!id) throw new Error('请输入学号');
    if (!secret) throw new Error('请输入身份证后六位');
    if (secret.length !== 6) throw new Error('身份证后六位必须为 6 个字符');
    await clearAcademicCookies();
    const { tab, temporary } = await ensureAcademicOriginTab();
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: async (loginUrl, indexUrl, loginName, loginPassword) => {
          const readCookie = (name) => document.cookie.split(';')
            .map((item) => item.trim())
            .find((item) => item.startsWith(`${name}=`))
            ?.slice(name.length + 1) || '';
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const page = await fetch(loginUrl, { credentials: 'include', cache: 'no-store' });
            if (!page.ok) return { ok: false, message: `登录页 HTTP ${page.status}` };
            const pageHtml = await page.text();
            const doc = new DOMParser().parseFromString(pageHtml, 'text/html');
            const csrf = doc.querySelector('input[name="csrfmiddlewaretoken"]')?.value || '';
            if (!csrf) return { ok: false, message: '登录页中未找到 CSRF Token' };
            const body = new URLSearchParams({
              csrfmiddlewaretoken: csrf,
              loginname: loginName,
              password: loginPassword
            });
            const headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
            const csrfCookie = decodeURIComponent(readCookie('csrftoken'));
            if (csrfCookie) headers['X-CSRFToken'] = csrfCookie;
            const response = await fetch(loginUrl, {
              method: 'POST', body, headers, credentials: 'include', cache: 'no-store', redirect: 'follow'
            });
            const html = await response.text();
            const success = response.url.startsWith(indexUrl) || html.includes('欢迎您，');
            if (success) return { ok: true, url: response.url };
            if (response.status === 403 && attempt === 0) continue;
            const resultDoc = new DOMParser().parseFromString(html, 'text/html');
            const message = [...resultDoc.querySelectorAll('.alert,.error,.help-block')]
              .map((element) => String(element.textContent || '').trim())
              .find(Boolean) || (html.includes('密码错误，登录失败') ? '账号或密码错误' : '教务系统登录失败');
            return { ok: false, message };
          }
          return { ok: false, message: 'CSRF Token 已失效，请重试' };
        },
        args: [LOGIN_URL, INDEX_URL, id, secret]
      });
      const result = results?.[0]?.result || { ok: false, message: '教务系统未返回登录结果' };
      if (result.ok) {
        await saveAcademicAccount(id, { password: secret, lastLoginAt: Date.now() });
        await broadcastStatus({ status: 'login-done', studentId: id });
        scheduleScoreCheck();
      } else {
        await broadcastStatus({ status: 'login-error', studentId: id, error: result.message });
      }
      return result;
    } finally {
      if (temporary && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  async function loginSavedAcademicAccount(studentId) {
    const id = String(studentId || '').trim();
    const accounts = await getAcademicAccounts();
    const account = accounts[id];
    if (!account) throw new Error('未保存此教务系统账号');
    if (!account.password) throw new Error('此账号没有已保存的密码');
    return loginWithPassword(id, account.password);
  }
  function isLoginPageResponse(responseUrl, html) {
    return /\/client\/login\/?(?:[?#]|$)/i.test(String(responseUrl || ''))
      || /name\s*=\s*["']csrfmiddlewaretoken["']/i.test(String(html || ''))
        && /name\s*=\s*["']loginname["']/i.test(String(html || ''));
  }

  async function fetchCurrentAcademicAccount() {
    const response = await fetch(TRAINING_PROGRAM_URL, {
      credentials: 'include', cache: 'no-store', redirect: 'follow'
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`培养方案页面 HTTP ${response.status}`);
    if (isLoginPageResponse(response.url, html)) return null;
    const account = parseCurrentAccountPage(html);
    if (!account?.studentId) throw new Error('培养方案页面中未找到当前学生信息');
    await saveAcademicAccount(account.studentId, { userName: account.userName });
    return account;
  }

  async function fetchScorePage() {
    let account = await fetchCurrentAcademicAccount();
    if (!account) {
      const stored = await chrome.storage.local.get([STUDENT_ID_KEY, 'username']);
      const studentId = String(stored?.[STUDENT_ID_KEY] || stored?.username || '').trim();
      try {
        await loginSavedAcademicAccount(studentId);
      } catch {
        throw Object.assign(new Error('教务系统未登录，请输入账号密码或通过 MIS 登录'), { code: 'not-logged-in' });
      }
      account = await fetchCurrentAcademicAccount();
      if (!account) throw Object.assign(new Error('教务系统登录已失效'), { code: 'not-logged-in' });
    }
    const response = await fetch(SCORE_URL, { credentials: 'include', cache: 'no-store', redirect: 'follow' });
    const html = await response.text();
    if (!response.ok) throw new Error(`成绩页面 HTTP ${response.status}`);
    if (isLoginPageResponse(response.url, html)) {
      throw Object.assign(new Error('教务系统登录已失效'), { code: 'not-logged-in' });
    }
    return { html, account };
  }

  async function notifyScoreChange(row, kind, studentId = '') {
    const titlePrefix = kind === 'new' ? '新增成绩' : '成绩更新';
    const notificationId = `${NOTIFICATION_PREFIX}${shortHash(`${studentId}|${kind}|${row.key}|${scoreFingerprint(row)}`)}`;
    if (global.BjtuSystemNotifications?.create) {
      await global.BjtuSystemNotifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `${titlePrefix}：${row.courseName || row.course}`,
        message: formatScoreNotification(row),
        priority: 2
      }, 'academic-score');
      return;
    }
    await new Promise((resolve, reject) => {
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `${titlePrefix}：${row.courseName || row.course}`,
        message: formatScoreNotification(row),
        priority: 2
      }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || '创建成绩通知失败'));
        else resolve(notificationId);
      });
    });
  }

  function normalizePendingScoreNotifications(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const [key, item] of Object.entries(source)) {
      const studentId = String(item?.studentId || '').trim();
      const kind = item?.kind === 'updated' ? 'updated' : 'new';
      const row = normalizeScoreRow(item?.row);
      if (!studentId || !row.academicYear || !row.course) continue;
      result[key] = { studentId, kind, row, createdAt: Number(item?.createdAt || Date.now()) };
    }
    return result;
  }

  async function flushPendingScoreNotifications(pendingOverride = null) {
    const stored = pendingOverride
      ? null
      : await chrome.storage.local.get([PENDING_NOTIFICATIONS_KEY]);
    const pending = normalizePendingScoreNotifications(
      pendingOverride || stored?.[PENDING_NOTIFICATIONS_KEY]
    );
    let changed = false;
    for (const [key, item] of Object.entries(pending)) {
      try {
        await notifyScoreChange(item.row, item.kind, item.studentId);
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

  async function processScoreRowsInternal(rows, studentId = '', source = 'poll') {
    const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeScoreRow)
      .filter((row) => row.academicYear && row.course);
    const stored = await chrome.storage.local.get([
      SNAPSHOTS_KEY, PENDING_NOTIFICATIONS_KEY, STUDENT_ID_KEY, MONITOR_KEY, 'username'
    ]);
    const id = String(studentId || stored?.[STUDENT_ID_KEY] || stored?.username || 'default').trim() || 'default';
    const snapshots = stored?.[SNAPSHOTS_KEY] && typeof stored[SNAPSHOTS_KEY] === 'object'
      ? { ...stored[SNAPSHOTS_KEY] }
      : {};
    const previous = snapshots[id]?.rows && typeof snapshots[id].rows === 'object'
      ? snapshots[id].rows
      : null;
    const nextRows = Object.fromEntries(normalizedRows.map((row) => [row.key, row]));
    const changes = [];
    const notificationsEnabled = stored?.[MONITOR_KEY] === true;
    if (previous && notificationsEnabled) {
      for (const row of normalizedRows) {
        if (!previous[row.key]) changes.push({ kind: 'new', row });
        else if (scoreFingerprint(previous[row.key]) !== scoreFingerprint(row)) changes.push({ kind: 'updated', row });
      }
    } else if (!previous && notificationsEnabled && notifyInitialScoreRows) {
      for (const row of normalizedRows) changes.push({ kind: 'new', row });
    }
    const pending = normalizePendingScoreNotifications(stored?.[PENDING_NOTIFICATIONS_KEY]);
    for (const change of changes) {
      const pendingKey = shortHash(`${id}|${change.kind}|${change.row.key}|${scoreFingerprint(change.row)}`);
      pending[pendingKey] = {
        studentId: id,
        kind: change.kind,
        row: change.row,
        createdAt: Date.now()
      };
    }
    snapshots[id] = { rows: nextRows, updatedAt: Date.now(), source };
    await chrome.storage.local.set({
      [SNAPSHOTS_KEY]: snapshots,
      [PENDING_NOTIFICATIONS_KEY]: pending,
      [STUDENT_ID_KEY]: id,
      [STATUS_KEY]: { status: 'ok', studentId: id, count: normalizedRows.length, checkedAt: Date.now() }
    });
    const remainingPending = await flushPendingScoreNotifications(pending);
    return {
      count: normalizedRows.length,
      changes: changes.length,
      pendingNotifications: Object.keys(remainingPending).length,
      baseline: !previous,
      rows: normalizedRows,
      studentId: id
    };
  }

  function processScoreRows(rows, studentId = '', source = 'poll') {
    const run = scoreProcessPromise.then(() => processScoreRowsInternal(rows, studentId, source));
    scoreProcessPromise = run.catch(() => {});
    return run;
  }

  async function checkScores(source = 'poll', { force = false } = {}) {
    if (scoreCheckPromise) return scoreCheckPromise;
    scoreCheckPromise = (async () => {
      const settings = await chrome.storage.local.get([MONITOR_KEY]);
      if (!force && settings?.[MONITOR_KEY] !== true) return { skipped: true };
      try {
        await flushPendingScoreNotifications();
        const page = await fetchScorePage();
        const parsed = parseScorePage(page.html);
        if (!parsed.hasScoreTable) throw new Error('成绩页面中未找到成绩表格');
        return await processScoreRows(parsed.rows, page.account.studentId, source);
      } catch (error) {
        await chrome.storage.local.set({
          [STATUS_KEY]: {
            status: 'error', error: String(error?.message || error),
            code: String(error?.code || ''), checkedAt: Date.now()
          }
        }).catch(() => {});
        throw error;
      }
    })().finally(() => { scoreCheckPromise = null; });
    return scoreCheckPromise;
  }

  function scheduleScoreCheck() {
    checkScores('scheduled').catch(() => {});
  }

  async function captureScoreTab(tabId) {
    const enabled = (await chrome.storage.local.get([MONITOR_KEY]))?.[MONITOR_KEY] === true;
    if (!enabled || !tabId) return;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const details = (cell) => {
          const source = cell?.querySelector('[data-content]')?.getAttribute('data-content') || '';
          if (!source) return '';
          const holder = document.createElement('div');
          holder.innerHTML = source.replace(/<br\s*\/?\s*>/gi, '\n');
          return String(holder.textContent || '').split('\n').map((line) => clean(line)).filter(Boolean).join('\n');
        };
        const table = [...document.querySelectorAll('table.table-bordered')].find((candidate) => {
          const headings = [...candidate.querySelectorAll('th')].map((item) => clean(item.textContent));
          return headings.includes('学年') && headings.includes('成绩');
        });
        if (!table) return [];
        return [...table.querySelectorAll('tr')].map((tr) => {
          const cells = tr.querySelectorAll('td');
          if (cells.length < 7) return null;
          return {
            sequence: clean(cells[0].textContent), academicYear: clean(cells[1].textContent),
            course: clean(cells[2].textContent), credit: clean(cells[3].textContent),
            score: clean(cells[4].textContent), bonusScore: clean(cells[5].textContent),
            teacher: clean(cells[6].textContent), details: details(cells[7])
          };
        }).filter(Boolean);
      }
    }).catch(() => []);
    const rows = results?.[0]?.result;
    if (Array.isArray(rows)) {
      const account = await fetchCurrentAcademicAccount().catch(() => null);
      if (account?.studentId) await processScoreRows(rows, account.studentId, 'page');
    }
  }

  function normalizeMonitorIntervalMinutes(value) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600
      ? minutes
      : DEFAULT_MONITOR_INTERVAL_MINUTES;
  }

  async function ensureAlarm() {
    const stored = await chrome.storage.local.get([MONITOR_INTERVAL_KEY]).catch(() => ({}));
    const interval = normalizeMonitorIntervalMinutes(stored?.[MONITOR_INTERVAL_KEY]);
    const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);
    if (existing && Number(existing.periodInMinutes || 0) === interval) return existing;
    if (existing) await chrome.alarms.clear(ALARM_NAME).catch(() => false);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: interval, periodInMinutes: interval });
    return chrome.alarms.get(ALARM_NAME).catch(() => null);
  }

  async function focusScorePage() {
    const tabs = await chrome.tabs.query({ url: ['https://aa.bjtu.edu.cn/score/scores/stu/view*'] }).catch(() => []);
    if (tabs.length) {
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return;
    }
    await chrome.tabs.create({ url: SCORE_URL, active: true });
  }

  function extractLoginCredentials(details) {
    if (String(details?.method || '').toUpperCase() !== 'POST' || details?.type !== 'main_frame') return null;
    try {
      const url = new URL(String(details?.url || ''));
      if (url.hostname !== 'aa.bjtu.edu.cn' || !/^\/client\/login\/?$/i.test(url.pathname)) return null;
    } catch {
      return null;
    }
    const formData = details?.requestBody?.formData || {};
    let studentId = String(formData.loginname?.[0] || '').trim();
    let password = String(formData.password?.[0] || '');
    if ((!studentId || !password) && details?.requestBody?.raw?.[0]?.bytes) {
      try {
        const body = new TextDecoder().decode(details.requestBody.raw[0].bytes);
        const params = new URLSearchParams(body);
        studentId = studentId || String(params.get('loginname') || '').trim();
        password = password || String(params.get('password') || '');
      } catch {
        // Ignore an unsupported request-body encoding.
      }
    }
    return studentId && password ? { studentId, password, capturedAt: Date.now() } : null;
  }

  async function cleanupObsoleteBindingData() {
    const accounts = await getAcademicAccounts();
    await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts });
    await chrome.storage.local.remove(OBSOLETE_BINDING_KEYS);
  }

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'ACADEMIC_LOGIN_WITH_PASSWORD') {
        loginWithPassword(message?.payload?.studentId, message?.payload?.password)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'START_ACADEMIC_MIS_LOGIN') {
        (async () => {
          await clearAcademicCookies();
          const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
          if (!tab?.id) throw new Error('无法打开 MIS 登录页');
          misLoginTabs.add(tab.id);
          await chrome.tabs.update(tab.id, { url: MIS_MODULE_URL });
          sendResponse({ ok: true, tabId: tab.id });
        })().catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'ACADEMIC_CHECK_SCORES') {
        checkScores('manual')
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'ACADEMIC_LOAD_SCORES') {
        checkScores('options', { force: true })
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      if (message?.type === 'ACADEMIC_SWITCH_ACCOUNT') {
        loginSavedAcademicAccount(message?.payload?.studentId)
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'ACADEMIC_GET_CONTEXT') {
        (async () => {
          const stored = await chrome.storage.local.get([STUDENT_ID_KEY, MONITOR_KEY, MONITOR_INTERVAL_KEY, STATUS_KEY, 'username']);
          const accounts = await getAcademicAccounts();
          const studentId = String(stored?.[STUDENT_ID_KEY] || stored?.username || '').trim();
          const summaries = Object.values(accounts)
            .map((account) => ({
              studentId: account.studentId,
              userName: String(account.userName || ''),
              hasPassword: !!account.password,
              updatedAt: Number(account.updatedAt || 0),
              lastLoginAt: Number(account.lastLoginAt || 0)
            }))
            .sort((a, b) => Number(b.lastLoginAt || b.updatedAt || 0) - Number(a.lastLoginAt || a.updatedAt || 0));
          sendResponse({
            ok: true, studentId,
            accounts: summaries,
            monitorEnabled: stored?.[MONITOR_KEY] === true,
            monitorIntervalMinutes: normalizeMonitorIntervalMinutes(stored?.[MONITOR_INTERVAL_KEY]),
            monitorStatus: stored?.[STATUS_KEY] || null
          });
        })().catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      return false;
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const url = String(changeInfo?.url || tab?.url || '');
      if (changeInfo.status === 'complete') {
        let parsed = null;
        try { parsed = new URL(url); } catch { parsed = null; }
        if (parsed?.hostname === 'aa.bjtu.edu.cn') {
          const onLoginPage = /^\/client\/login(?:\/|$)/i.test(parsed.pathname);
          const pending = pendingCredentialsByTab.get(tabId);
          if (pending && !onLoginPage) {
            pendingCredentialsByTab.delete(tabId);
            void (async () => {
              const accounts = await getAcademicAccounts();
              const wasSaved = !!accounts[pending.studentId];
              await saveAcademicAccount(pending.studentId, {
                password: pending.password,
                lastLoginAt: Date.now()
              });
              await fetchCurrentAcademicAccount().catch(() => null);
              await broadcastStatus({ status: 'credentials-saved', studentId: pending.studentId, silent: true });
              if (!wasSaved) {
                await showAcademicPageToast(tabId, `已保存教务系统账号 ${pending.studentId} 的登录密码`);
              }
            })().catch(() => {});
          } else if (pending && onLoginPage) {
            pendingCredentialsByTab.delete(tabId);
          }
          if (misLoginTabs.has(tabId) && !onLoginPage && !misLoginVerifyingTabs.has(tabId)) {
            misLoginVerifyingTabs.add(tabId);
            void (async () => {
              try {
                const account = await fetchCurrentAcademicAccount();
                if (!account || !misLoginTabs.delete(tabId)) return;
                await broadcastStatus({
                  status: 'mis-login-done', tabId,
                  studentId: account.studentId, userName: account.userName
                });
                await chrome.tabs.remove(tabId).catch(() => {});
                checkScores('mis-login', { force: true }).catch(() => {});
              } finally {
                misLoginVerifyingTabs.delete(tabId);
              }
            })().catch(() => {});
            return;
          }
        }
      }
      if (changeInfo.status === 'complete' && /^https:\/\/aa\.bjtu\.edu\.cn\/score\/scores\/stu\/view(?:[?#]|$)/i.test(url)) {
        captureScoreTab(tabId).catch(() => {});
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      pendingCredentialsByTab.delete(tabId);
      misLoginVerifyingTabs.delete(tabId);
      if (misLoginTabs.delete(tabId)) {
        broadcastStatus({ status: 'mis-login-cancelled', tabId }).catch(() => {});
      }
    });
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        const credentials = extractLoginCredentials(details);
        if (credentials && Number(details?.tabId ?? -1) >= 0) {
          pendingCredentialsByTab.set(Number(details.tabId), credentials);
        }
      },
      { urls: ['https://aa.bjtu.edu.cn/client/login/*'] },
      ['requestBody']
    );
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name === ALARM_NAME) scheduleScoreCheck();
    });
    chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); scheduleScoreCheck(); });
    chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); scheduleScoreCheck(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || (!changes[MONITOR_KEY] && !changes[MONITOR_INTERVAL_KEY])) return;
      void ensureAlarm();
      if (!changes[MONITOR_KEY]) return;
      if (changes[MONITOR_KEY].newValue === true) scheduleScoreCheck();
      else chrome.storage.local.remove([PENDING_NOTIFICATIONS_KEY]).catch(() => {});
    });
    chrome.notifications.onClicked.addListener((notificationId) => {
      if (!String(notificationId || '').startsWith(NOTIFICATION_PREFIX)) return;
      focusScorePage().catch(() => {});
      chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    });
    void ensureAlarm();
    cleanupObsoleteBindingData().catch(() => {});
  }

  global.BjtuAcademicSystemInternals = {
    extractLoginCredentials,
    parseCurrentAccountPage,
    normalizeScoreRow,
    parseScorePage,
    scoreFingerprint,
    processScoreRows,
    flushPendingScoreNotifications,
    get notifyInitialScoreRows() { return notifyInitialScoreRows; },
    set notifyInitialScoreRows(value) { notifyInitialScoreRows = value !== false; }
  };
})(globalThis);
