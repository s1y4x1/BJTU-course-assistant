(function initBjtuAccountLogin(global) {
  'use strict';

  const BASE_VE = 'http://123.121.147.7:88/ve/';
  const ACCOUNT_LIST_KEY = 'accountList';
  const ACCOUNT_LIST_VERSION_KEY = 'accountListVersion';
  const ACCOUNT_LIST_VERSION = 2;
  const HISTORY_KEY = 'loginAccountHistory';
  const ADMIN_LOGIN_URL = BASE_VE + 's.shtml?username=admin&password=a85fb6a51c8e861bb394d00f598f41b3&login=main_2&goLogin=1';
  const TEACHER_URL = BASE_VE + 'back/core/base/person/R005_P.shtml?para=F70FAB64CDA3B68EA6A1E9E008548F93&page=2&sr=ch';
  const STUDENT_URL = BASE_VE + 'back/jw/student/student.shtml?method=studentList&ref=ch';
  let accountList = null;
  let initializationPromise = null;

  function normalizeAccountList(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const result = {};
    Object.entries(source).forEach(([key, value]) => {
      const loginName = String(key || value?.loginName || '').trim();
      if (!loginName || !value || typeof value !== 'object') return;
      result[loginName] = {
        roleName: String(value.roleName || '').trim(),
        userName: String(value.userName || '').trim(),
        password: String(value.password || value.passwordMd5 || '').trim(),
        quickUsername: String(value.quickUsername || '').trim()
      };
    });
    return result;
  }

  function decodeBuffer(buf, contentType = '') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('gbk') || type.includes('gb2312')) {
      return new TextDecoder('gbk').decode(buf);
    }
    const utf8 = new TextDecoder('utf-8').decode(buf);
    if (!utf8.includes('�')) return utf8;
    const gbk = new TextDecoder('gbk').decode(buf);
    return gbk.includes('�') ? utf8 : gbk;
  }

  async function decodeResponse(res) {
    return decodeBuffer(await res.arrayBuffer(), res.headers.get('content-type'));
  }

  async function fetchHtml(url, options = {}, onProgress = null) {
    const { headers: optionHeaders, ...rest } = options;
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...rest,
      headers: {
        sessionId: 'D571D57D255EA0BECF299C45D4C0468A',
        ...(optionHeaders || {})
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (typeof onProgress === 'function' && res.body?.getReader) {
      const total = Math.max(0, Number(res.headers.get('content-length') || 0));
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress(loaded, total);
      }
      const merged = new Uint8Array(loaded);
      let offset = 0;
      chunks.forEach((chunk) => {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return decodeBuffer(merged.buffer, res.headers.get('content-type'));
    }
    return decodeResponse(res);
  }

  async function streamHtml(url, options = {}, onText = null) {
    const { headers: optionHeaders, responseEncoding = '', ...rest } = options;
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...rest,
      headers: {
        sessionId: 'D571D57D255EA0BECF299C45D4C0468A',
        ...(optionHeaders || {})
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body?.getReader) {
      const text = await decodeResponse(res);
      if (typeof onText === 'function') onText(text, true);
      return;
    }

    const type = String(res.headers.get('content-type') || '').toLowerCase();
    const encoding = type.includes('utf-8')
      ? 'utf-8'
      : (type.includes('gbk') || type.includes('gb2312') ? 'gbk' : (responseEncoding || 'utf-8'));
    const decoder = new TextDecoder(encoding);
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const text = decoder.decode(value, { stream: true });
      if (text && typeof onText === 'function') onText(text, false);
    }
    const tail = decoder.decode();
    if (tail && typeof onText === 'function') onText(tail, false);
    if (typeof onText === 'function') onText('', true);
  }

  function parseCount(html, pattern, label) {
    const match = String(html || '').match(pattern);
    const count = Number(match?.[1] || 0);
    if (!Number.isFinite(count) || count <= 0) throw new Error('无法读取' + label + '总数');
    return Math.floor(count);
  }

  function parseLoginCall(row) {
    const source = String(row?.innerHTML || '');
    const match = source.match(/goLogin\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([0-9a-f]{32})['"]\s*\)/i);
    return match ? { loginName: String(match[1]).trim(), password: String(match[2]).trim() } : null;
  }

  function parseTeacherAccounts(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const result = {};
    doc.querySelectorAll('tr').forEach((row) => {
      const login = parseLoginCall(row);
      if (!login?.loginName) return;
      const nameAnchor = [...row.querySelectorAll('a')].find((a) => /edit\.jsp\?id=/i.test(String(a.getAttribute('onclick') || '')));
      const roleEl = row.querySelector('.roleHide');
      result[login.loginName] = {
        roleName: String(roleEl?.getAttribute('title') || roleEl?.textContent || '老师').trim() || '老师',
        userName: String(nameAnchor?.textContent || '').trim(),
        password: login.password,
        quickUsername: ''
      };
    });
    return result;
  }

  function parseStudentAccounts(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const result = {};
    doc.querySelectorAll('tr').forEach((row) => {
      const login = parseLoginCall(row);
      if (!login?.loginName) return;
      const titledCells = [...row.querySelectorAll('td[title]')];
      const accountIndex = titledCells.findIndex((td) => String(td.getAttribute('title') || '').trim() === login.loginName);
      const name = accountIndex >= 0 ? String(titledCells[accountIndex + 1]?.getAttribute('title') || titledCells[accountIndex + 1]?.textContent || '').trim() : '';
      result[login.loginName] = {
        roleName: '学生',
        userName: name,
        password: login.password,
        quickUsername: ''
      };
    });
    return result;
  }

  function createStreamingAccountParser(parseChunk, onParsed) {
    const result = {};
    let pending = '';
    let parsedCount = 0;
    const parseAvailable = (final = false) => {
      let end = final ? pending.length : pending.toLowerCase().lastIndexOf('</tr>');
      if (!final && end >= 0) end += 5;
      if (end <= 0) return;
      const chunk = pending.slice(0, end);
      pending = pending.slice(end);
      const parsed = parseChunk(chunk);
      Object.entries(parsed).forEach(([loginName, account]) => {
        if (!Object.prototype.hasOwnProperty.call(result, loginName)) parsedCount += 1;
        result[loginName] = account;
      });
      if (typeof onParsed === 'function') onParsed(parsedCount);
    };
    return {
      push(text, final = false) {
        if (text) pending += String(text);
        parseAvailable(final);
      },
      result
    };
  }

  function setProgress(percent, status, visible = true) {
    const modal = document.getElementById('account-init-modal');
    const bar = document.getElementById('account-init-progress-bar');
    const text = document.getElementById('account-init-status');
    if (modal instanceof HTMLElement) modal.style.display = visible ? 'flex' : 'none';
    if (bar instanceof HTMLElement) bar.style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + '%';
    if (text instanceof HTMLElement) text.textContent = String(status || '');
  }

  async function load() {
    if (accountList) return accountList;
    const stored = await chrome.storage.local.get([ACCOUNT_LIST_KEY]);
    accountList = normalizeAccountList(stored?.[ACCOUNT_LIST_KEY]);
    return accountList;
  }

  async function preserveLocalBindings(next) {
    const stored = await chrome.storage.local.get([ACCOUNT_LIST_KEY, HISTORY_KEY]);
    const previous = normalizeAccountList(stored?.[ACCOUNT_LIST_KEY]);
    Object.entries(previous).forEach(([loginName, record]) => {
      if (next[loginName] && record.quickUsername) next[loginName].quickUsername = record.quickUsername;
    });
    const history = Array.isArray(stored?.[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    history.forEach((record) => {
      const loginName = String(record?.loginName || record?.userId || '').trim();
      if (!loginName || !next[loginName]) return;
      const quickUsername = String(record?.quickUsername || '').trim();
      if (quickUsername) next[loginName].quickUsername = quickUsername;
    });
  }

  async function syncHistoryWithAccountList(next) {
    const stored = await chrome.storage.local.get([HISTORY_KEY]);
    const history = Array.isArray(stored?.[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    let changed = false;
    const updated = history.map((record) => {
      const loginName = String(record?.loginName || record?.userId || '').trim();
      const account = next[loginName];
      if (!account) return record;
      changed = true;
      return {
        ...record,
        loginName,
        userName: String(account.userName || record?.userName || '').trim(),
        roleName: String(account.roleName || record?.roleName || '').trim(),
        passwordMd5: String(account.password || '').trim(),
        quickUsername: String(account.quickUsername || record?.quickUsername || '').trim()
      };
    });
    if (changed) await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  }

  async function initialize({ force = false, showProgress = true } = {}) {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
      const existing = await load();
      const versionState = await chrome.storage.local.get([ACCOUNT_LIST_VERSION_KEY]);
      const isCurrentVersion = Number(versionState?.[ACCOUNT_LIST_VERSION_KEY] || 0) === ACCOUNT_LIST_VERSION;
      if (!force && isCurrentVersion && Object.keys(existing).length) return existing;
      try {
        if (showProgress) setProgress(1, '正在登录管理员账号…');
        const adminRes = await fetch(ADMIN_LOGIN_URL, { credentials: 'include', cache: 'no-store' });
        const adminText = await decodeResponse(adminRes);
        const adminResult = parseLoginResponse(adminText);
        if (!adminResult.ok) throw new Error(adminResult.message || '管理员账号登录失败');

        const state = {
          teacher: { parsed: 0, total: 0, label: '正在读取总数' },
          student: { parsed: 0, total: 0, label: '正在读取总数' }
        };
        const updateProgress = () => {
          if (!showProgress) return;
          const teacherRatio = state.teacher.total > 0 ? Math.min(1, state.teacher.parsed / state.teacher.total) : 0;
          const studentRatio = state.student.total > 0 ? Math.min(1, state.student.parsed / state.student.total) : 0;
          const percent = 3 + ((teacherRatio + studentRatio) / 2) * 96;
          const teacherText = state.teacher.total > 0
            ? ('教职工 ' + state.teacher.parsed + '/' + state.teacher.total)
            : '教职工：正在读取总数';
          const studentText = state.student.total > 0
            ? ('学生 ' + state.student.parsed + '/' + state.student.total)
            : '学生：正在读取总数';
          setProgress(percent, teacherText + '；' + studentText);
        };
        updateProgress();

        const loadTeachers = async () => {
          const indexHtml = await fetchHtml(TEACHER_URL);
          const total = parseCount(indexHtml, /查询到\s*(\d+)\s*条记录/i, '教职工');
          state.teacher.total = total;
          updateProgress();
          const parser = createStreamingAccountParser(parseTeacherAccounts, (parsed) => {
            state.teacher.parsed = parsed;
            updateProgress();
          });
          const body = new URLSearchParams({
            cdeparcode: '', key: '', keycate: '2', pagerecords: String(total), page: '1'
          });
          await streamHtml(TEACHER_URL, {
            method: 'POST',
            responseEncoding: 'gbk',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: body.toString()
          }, (text, final) => parser.push(text, final));
          if (!Object.keys(parser.result).length) throw new Error('教职工列表解析为空');
          return parser.result;
        };

        const loadStudents = async () => {
          const indexHtml = await fetchHtml(STUDENT_URL);
          const total = parseCount(indexHtml, /共\s*(\d+)\s*条记录/i, '学生');
          state.student.total = total;
          updateProgress();
          const parser = createStreamingAccountParser(parseStudentAccounts, (parsed) => {
            state.student.parsed = parsed;
            updateProgress();
          });
          const body = new URLSearchParams({
            crolename: '', crolecode: '', stu_no: '', page: '1', stu_name: '', sex: '',
            school_id: '', grade_id: '', class_id: '', xj_status: '1', pagesize: String(total)
          });
          await streamHtml(STUDENT_URL, {
            method: 'POST',
            responseEncoding: 'gbk',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: body.toString()
          }, (text, final) => parser.push(text, final));
          if (!Object.keys(parser.result).length) throw new Error('学生列表解析为空');
          return parser.result;
        };

        const [teachers, students] = await Promise.all([loadTeachers(), loadStudents()]);
        const next = { ...teachers, ...students };
        if (!Object.keys(next).length) throw new Error('账号列表为空');

        if (showProgress) {
          setProgress(100, '账号列表解析完成');
          setProgress(100, '', false);
        }
        await preserveLocalBindings(next);
        await chrome.storage.local.set({
          [ACCOUNT_LIST_KEY]: next,
          [ACCOUNT_LIST_VERSION_KEY]: ACCOUNT_LIST_VERSION
        });
        await syncHistoryWithAccountList(next);
        accountList = next;
        return next;
      } catch (error) {
        if (showProgress) {
          setProgress(100, '账号列表初始化失败：' + String(error?.message || error));
          await new Promise((resolve) => setTimeout(resolve, 1800));
          setProgress(0, '', false);
        }
        throw error;
      } finally {
        initializationPromise = null;
      }
    })();
    return initializationPromise;
  }

  function getAccount(loginName) {
    const id = String(loginName || '').trim();
    const record = accountList?.[id];
    return record ? { loginName: id, ...record } : null;
  }

  async function updateQuickUsername(loginName, quickUsername) {
    const id = String(loginName || '').trim();
    const quick = String(quickUsername || '').trim();
    if (!id || !quick) return null;
    await load();
    if (!accountList[id]) return null;
    accountList[id] = { ...accountList[id], quickUsername: quick };
    await chrome.storage.local.set({ [ACCOUNT_LIST_KEY]: accountList });
    return getAccount(id);
  }

  async function updatePassword(loginName, password) {
    const id = String(loginName || '').trim();
    const value = String(password || '').trim();
    if (!id || !value) return null;
    await load();
    if (!accountList[id]) return null;
    accountList[id] = { ...accountList[id], password: value };
    await chrome.storage.local.set({ [ACCOUNT_LIST_KEY]: accountList });
    return getAccount(id);
  }

  function parseLoginResponse(text) {
    const source = String(text || '');
    const alerts = [...source.matchAll(/alert\s*\(\s*(['"])(.*?)\1\s*\)/gis)];
    const message = String(alerts.at(-1)?.[2] || '').trim();
    if (/错误次数过多|锁定10分钟/i.test(message)) return { ok: false, reason: 'locked', message };
    if (/账号或密码错误/i.test(message)) return { ok: false, reason: 'credential', message };
    if (/默认密码[\s\S]*弱密码[\s\S]*重置密码/i.test(source)) {
      return { ok: false, reason: 'password-reset', message: '需要重置密码后重新登录' };
    }
    if (/index\.shtml\?method=index&type=qxkt/i.test(source)) return { ok: true };
    return { ok: false, reason: 'other', message: message || '登录失败' };
  }

  async function loginWithPassword(loginName, password, { signal } = {}) {
    const url = BASE_VE + 's.shtml?login=main_2&goLogin=1&username='
      + encodeURIComponent(String(loginName || '').trim())
      + '&password=' + encodeURIComponent(String(password || '').trim());
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
    return parseLoginResponse(await decodeResponse(res));
  }

  async function loginWithQuickUsername(quickUsername, { signal } = {}) {
    const url = BASE_VE + 's.shtml?loginType=2&login=main_2&username=' + encodeURIComponent(String(quickUsername || '').trim());
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
    return parseLoginResponse(await decodeResponse(res));
  }

  function requestRecovery(loginName, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('account-recovery-modal');
      const text = document.getElementById('account-recovery-message');
      const choice = document.getElementById('account-recovery-choice');
      const manual = document.getElementById('account-recovery-manual');
      const plainInput = document.getElementById('account-recovery-password-plain');
      const md5Input = document.getElementById('account-recovery-password-md5');
      const reinit = document.getElementById('account-recovery-reinitialize');
      const manualBtn = document.getElementById('account-recovery-manual-btn');
      const cancel = document.getElementById('account-recovery-cancel');
      const fillDefault = document.getElementById('account-recovery-default');
      const submit = document.getElementById('account-recovery-submit');
      const manualCancel = document.getElementById('account-recovery-manual-cancel');
      if (!(modal instanceof HTMLElement)) return resolve({ action: 'cancel' });

      let settled = false;
      const cleanup = () => {
        reinit?.removeEventListener('click', onReinit);
        manualBtn?.removeEventListener('click', onManual);
        cancel?.removeEventListener('click', onCancel);
        fillDefault?.removeEventListener('click', onDefault);
        submit?.removeEventListener('click', onSubmit);
        manualCancel?.removeEventListener('click', onCancel);
        plainInput?.removeEventListener('input', onPlainInput);
        md5Input?.removeEventListener('input', onMd5Input);
        plainInput?.removeEventListener('keydown', onPasswordKeyDown);
        md5Input?.removeEventListener('keydown', onPasswordKeyDown);
        modal.removeEventListener('mousedown', onMaskDown);
        modal.removeEventListener('mouseup', onMaskUp);
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        modal.style.display = 'none';
        resolve(value);
      };
      const onReinit = () => finish({ action: 'reinitialize' });
      const onManual = () => {
        if (choice instanceof HTMLElement) choice.style.display = 'none';
        if (manual instanceof HTMLElement) manual.style.display = 'block';
        if (plainInput instanceof HTMLInputElement) {
          plainInput.value = '';
          plainInput.focus();
        }
        if (md5Input instanceof HTMLInputElement) md5Input.value = '';
      };
      const onCancel = () => finish({ action: 'cancel' });
      const onDefault = () => {
        if (plainInput instanceof HTMLInputElement) {
          plainInput.value = 'Bjtu@' + String(loginName || '').trim();
          if (md5Input instanceof HTMLInputElement) md5Input.value = global.md5(plainInput.value);
          plainInput.focus();
        }
      };
      const onPlainInput = () => {
        if (!(plainInput instanceof HTMLInputElement) || !(md5Input instanceof HTMLInputElement)) return;
        md5Input.value = plainInput.value ? global.md5(plainInput.value) : '';
      };
      const onMd5Input = () => {
        if (!(md5Input instanceof HTMLInputElement)) return;
        const value = String(md5Input.value || '').replace(/[^0-9a-f]/gi, '').slice(0, 32).toLowerCase();
        if (md5Input.value !== value) md5Input.value = value;
      };
      const onSubmit = () => {
        const plain = String(plainInput?.value || '');
        const password = plain
          ? global.md5(plain)
          : String(md5Input?.value || '').trim().toLowerCase();
        if (!/^[0-9a-f]{32}$/.test(password)) {
          md5Input?.focus();
          return;
        }
        finish({ action: 'password', password });
      };
      const onPasswordKeyDown = (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        onSubmit();
      };
      const onMaskDown = (event) => { modal.dataset.maskDown = event.target === modal ? '1' : '0'; };
      const onMaskUp = (event) => {
        if (event.target === modal && modal.dataset.maskDown === '1') onCancel();
        delete modal.dataset.maskDown;
      };

      if (text instanceof HTMLElement) text.textContent = String(message || '账号或密码错误');
      if (choice instanceof HTMLElement) choice.style.display = 'flex';
      if (manual instanceof HTMLElement) manual.style.display = 'none';
      reinit?.addEventListener('click', onReinit);
      manualBtn?.addEventListener('click', onManual);
      cancel?.addEventListener('click', onCancel);
      fillDefault?.addEventListener('click', onDefault);
      submit?.addEventListener('click', onSubmit);
      manualCancel?.addEventListener('click', onCancel);
      plainInput?.addEventListener('input', onPlainInput);
      md5Input?.addEventListener('input', onMd5Input);
      plainInput?.addEventListener('keydown', onPasswordKeyDown);
      md5Input?.addEventListener('keydown', onPasswordKeyDown);
      modal.addEventListener('mousedown', onMaskDown);
      modal.addEventListener('mouseup', onMaskUp);
      modal.style.display = 'flex';
    });
  }

  global.BjtuAccountLogin = {
    load,
    initialize,
    ensureInitialized: (options = {}) => initialize({ ...options, force: false }),
    getAccount,
    updateQuickUsername,
    updatePassword,
    loginWithPassword,
    loginWithQuickUsername,
    requestRecovery
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[ACCOUNT_LIST_KEY]) return;
    accountList = normalizeAccountList(changes[ACCOUNT_LIST_KEY].newValue);
  });
})(globalThis);
