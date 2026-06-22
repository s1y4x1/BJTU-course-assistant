(function initBjtuAccountLogin(global) {
  'use strict';

  const BASE_VE = 'http://123.121.147.7:88/ve/';
  const ACCOUNT_LIST_VERSION_KEY = 'accountListVersion';
  const ACCOUNT_LIST_VERSION = 3;
  const HISTORY_KEY = 'loginAccountHistory';
  const ADMIN_LOGIN_URL = BASE_VE + 's.shtml?username=admin&password=3115b155e14c1fb027ef459be500e8fd&login=main_2&goLogin=1';
  const CURRENT_USER_URL = BASE_VE + 'back/coursePlatform/coursePlatform.shtml?method=getUserInfo';
  const TEACHER_URL = BASE_VE + 'back/core/base/person/R005_P.shtml?para=F70FAB64CDA3B68EA6A1E9E008548F93';
  const STUDENT_URL = BASE_VE + 'back/jw/student/student.shtml?method=studentList&ref=ch';
  const accountCache = new Map();
  let initializationPromise = null;

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

  async function getCurrentUserInfo({ signal } = {}) {
    try {
      const res = await fetch(CURRENT_USER_URL, {
        credentials: 'include',
        cache: 'no-store',
        signal,
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
      });
      if (!res.ok) return null;
      const source = String(await decodeResponse(res) || '').trim();
      const data = JSON.parse(source.startsWith('{}') && source.length > 2 ? source.slice(2) : source);
      return String(data?.STATUS) === '0' && data?.result ? data.result : null;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      return null;
    }
  }

  async function waitForPostRetry(attempt, signal) {
    await new Promise((resolve, reject) => {
      const delay = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, 400 * (attempt + 1));
      const onAbort = () => {
        clearTimeout(delay);
        signal?.removeEventListener('abort', onAbort);
        reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function fetchWithPostRetry(url, options = {}, maxRetries = 3) {
    const method = String(options?.method || 'GET').toUpperCase();
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await fetch(url, options);
      } catch (error) {
        const aborted = options?.signal?.aborted || error?.name === 'AbortError';
        if (method !== 'POST' || aborted || attempt >= maxRetries) throw error;
        await waitForPostRetry(attempt, options?.signal);
        continue;
      }
      if (method !== 'POST' || res.status !== 500 || attempt >= maxRetries) return res;
      try { await res.body?.cancel(); } catch {}
      await waitForPostRetry(attempt, options?.signal);
    }
  }

  async function fetchHtml(url, options = {}, onProgress = null) {
    const { headers: optionHeaders, ...rest } = options;
    const res = await fetchWithPostRetry(url, {
      credentials: 'include',
      cache: 'no-store',
      ...rest,
      headers: { ...(optionHeaders || {}) }
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
    const res = await fetchWithPostRetry(url, {
      credentials: 'include',
      cache: 'no-store',
      ...rest,
      headers: { ...(optionHeaders || {}) }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body?.getReader) {
      const text = await decodeResponse(res);
      if (typeof onText === 'function') await onText(text, true);
      return;
    }

    const type = String(res.headers.get('content-type') || '').toLowerCase();
    const encoding = responseEncoding || (type.includes('utf-8')
      ? 'utf-8'
      : (type.includes('gbk') || type.includes('gb2312') ? 'gbk' : 'utf-8'));
    const decoder = new TextDecoder(encoding);
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const text = decoder.decode(value, { stream: true });
      if (text && typeof onText === 'function') await onText(text, false);
    }
    const tail = decoder.decode();
    if (tail && typeof onText === 'function') await onText(tail, false);
    if (typeof onText === 'function') await onText('', true);
  }

  function parseCount(html, pattern, label) {
    const match = String(html || '').match(pattern);
    const count = Number(match?.[1] || 0);
    if (!Number.isFinite(count) || count <= 0) throw new Error('无法读取' + label + '总数');
    return Math.floor(count);
  }

  function parseLoginCall(source) {
    const match = String(source || '').match(/goLogin\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([0-9a-f]{32})['"]\s*\)/i);
    return match ? { loginName: String(match[1]).trim(), password: String(match[2]).trim() } : null;
  }

  function decodeHtmlText(value) {
    return String(value || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number(code)))
      .trim();
  }

  function parseAccountRow(row, type) {
    const login = parseLoginCall(row);
    if (!login?.loginName) return null;
    if (type === 'student') {
      const titledCells = [...String(row).matchAll(/<td\b[^>]*\btitle\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/td>/gi)]
        .map((match) => decodeHtmlText(match[2] || match[3]));
      const accountIndex = titledCells.findIndex((value) => value === login.loginName);
      return {
        loginName: login.loginName,
        roleName: '学生',
        userName: accountIndex >= 0 ? String(titledCells[accountIndex + 1] || '').trim() : '',
        password: login.password,
        quickUsername: ''
      };
    }
    const nameMatch = String(row).match(/<a\b[^>]*\bonclick\s*=\s*"[^"]*edit\.jsp\?id=[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || String(row).match(/<a\b[^>]*\bonclick\s*=\s*'[^']*edit\.jsp\?id=[^']*'[^>]*>([\s\S]*?)<\/a>/i);
    const roleMatch = String(row).match(/<p\b[^>]*\bclass\s*=\s*(["'])roleHide\1[^>]*\btitle\s*=\s*(["'])(.*?)\2/i);
    return {
      loginName: login.loginName,
      roleName: decodeHtmlText(roleMatch?.[3] || '老师') || '老师',
      userName: decodeHtmlText(nameMatch?.[1] || ''),
      password: login.password,
      quickUsername: ''
    };
  }

  function createStreamingAccountParser(type, onParsed) {
    const result = {};
    let pending = '';
    let parsedCount = 0;
    const parseAvailable = async (final = false) => {
      let processed = 0;
      while (true) {
        const start = pending.search(/<tr\b/i);
        if (start < 0) {
          if (final) pending = '';
          else if (pending.length > 4096) pending = pending.slice(-4096);
          break;
        }
        const rest = pending.slice(start);
        const closeMatch = /<\/tr\s*>/i.exec(rest);
        if (!closeMatch) {
          pending = rest;
          break;
        }
        const end = start + closeMatch.index + closeMatch[0].length;
        const account = parseAccountRow(pending.slice(start, end), type);
        pending = pending.slice(end);
        if (account?.loginName) {
          if (!Object.prototype.hasOwnProperty.call(result, account.loginName)) parsedCount += 1;
          result[account.loginName] = account;
          processed += 1;
        }
        if (processed > 0 && processed % 250 === 0) {
          if (typeof onParsed === 'function') onParsed(parsedCount);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      if (typeof onParsed === 'function') onParsed(parsedCount);
    };
    return {
      async push(text, final = false) {
        if (text) pending += String(text);
        await parseAvailable(final);
      },
      result
    };
  }

  function setProgress(percent, status, visible = true) {
    const modal = document.getElementById('account-init-modal');
    const text = document.getElementById('account-init-status');
    if (modal instanceof HTMLElement) modal.style.display = visible ? 'flex' : 'none';
    if (text instanceof HTMLElement) text.textContent = String(status || '');
    if (!visible) {
      setListProgress('teacher', 0, 0, '正在等待');
      setListProgress('student', 0, 0, '正在等待');
    }
  }

  function setListProgress(type, parsed, total, pendingLabel = '正在读取总数', phase = '') {
    const bar = document.getElementById('account-init-' + type + '-progress-bar');
    const label = document.getElementById('account-init-' + type + '-label');
    const safeParsed = Math.max(0, Number(parsed) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const percent = safeTotal > 0 ? Math.min(100, (safeParsed / safeTotal) * 100) : 0;
    if (bar instanceof HTMLElement) bar.style.width = percent + '%';
    if (label instanceof HTMLElement) {
      const name = type === 'teacher' ? '教职工' : '学生';
      const prefix = name + (phase ? phase : '') + '：';
      label.textContent = safeTotal > 0
        ? (prefix + safeParsed + ' / ' + safeTotal)
        : (prefix + pendingLabel);
    }
  }

  async function load() {
    await global.BjtuAccountStore.migrateLegacy();
    return global.BjtuAccountStore.count();
  }

  async function readLocalBindings() {
    const bindings = new Map();
    const previous = await global.BjtuAccountStore.getQuickAccounts();
    previous.forEach((record) => {
      const loginName = String(record?.loginName || '').trim();
      if (loginName && record.quickUsername) bindings.set(loginName, String(record.quickUsername).trim());
    });
    const stored = await chrome.storage.local.get([HISTORY_KEY]);
    const history = Array.isArray(stored?.[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    history.forEach((record) => {
      const loginName = String(record?.loginName || record?.userId || '').trim();
      const quickUsername = String(record?.quickUsername || '').trim();
      if (loginName && quickUsername) bindings.set(loginName, quickUsername);
    });
    return bindings;
  }

  function preserveLocalBindings(next, bindings) {
    Object.keys(next || {}).forEach((loginName) => {
      const quickUsername = bindings?.get(loginName);
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
      try {
        const existingCount = await load();
        const versionState = await chrome.storage.local.get([ACCOUNT_LIST_VERSION_KEY]);
        const isCurrentVersion = Number(versionState?.[ACCOUNT_LIST_VERSION_KEY] || 0) === ACCOUNT_LIST_VERSION;
        if (!force && isCurrentVersion && existingCount > 0) return existingCount;

        if (showProgress) setProgress(1, '正在检查管理员登录状态…');
        const currentUser = await getCurrentUserInfo();
        if (String(currentUser?.loginName || '').trim() !== 'admin') {
          if (showProgress) setProgress(1, '正在登录管理员账号…');
          const adminRes = await fetch(ADMIN_LOGIN_URL, { credentials: 'include', cache: 'no-store' });
          const adminText = await decodeResponse(adminRes);
          const adminResult = parseLoginResponse(adminText);
          if (!adminResult.ok) throw new Error(adminResult.message || '管理员账号登录失败');
        }

        const state = {
          teacher: { parsed: 0, written: 0, total: 0, phase: 'load' },
          student: { parsed: 0, written: 0, total: 0, phase: 'load' }
        };
        const localBindings = await readLocalBindings();
        let databaseCleared = false;
        let writeQueue = Promise.resolve();
        const updateProgress = () => {
          if (!showProgress) return;
          setProgress(0, '正在获取并写入账号列表…');
          ['teacher', 'student'].forEach((type) => {
            const roleState = state[type];
            const isWriting = roleState.phase === 'write' || roleState.phase === 'done';
            setListProgress(
              type,
              isWriting ? roleState.written : roleState.parsed,
              roleState.total,
              isWriting ? '正在写入' : '正在读取总数',
              isWriting ? '写入' : ''
            );
          });
        };
        updateProgress();

        const loadTeachers = async () => {
          const countBody = new URLSearchParams({
            cdeparcode: '', key: '', keycate: '1', page: '1'
          });
          const indexHtml = await fetchHtml(TEACHER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: countBody.toString()
          });
          const total = parseCount(indexHtml, /查询到\s*(\d+)\s*条记录/i, '教职工');
          state.teacher.total = total;
          updateProgress();
          const parser = createStreamingAccountParser('teacher', (parsed) => {
            state.teacher.parsed = parsed;
            updateProgress();
          });
          const body = new URLSearchParams({
            cdeparcode: '', key: '', keycate: '1', pagerecords: String(total), page: '1'
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
          const countBody = new URLSearchParams({
            crolename: '', crolecode: '', stu_no: '', page: '1', stu_name: '', sex: '',
            school_id: '', grade_id: '', class_id: '', xj_status: '1', pagesize: ''
          });
          const indexHtml = await fetchHtml(STUDENT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: countBody.toString()
          });
          const total = parseCount(indexHtml, /共\s*(\d+)\s*条记录/i, '学生');
          state.student.total = total;
          updateProgress();
          const parser = createStreamingAccountParser('student', (parsed) => {
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

        const writeRole = (type, accounts) => {
          preserveLocalBindings(accounts, localBindings);
          const total = Object.keys(accounts).length;
          state[type].phase = 'write';
          state[type].written = 0;
          updateProgress();
          writeQueue = writeQueue.then(async () => {
            if (!databaseCleared) {
              await global.BjtuAccountStore.clear();
              databaseCleared = true;
            }
            await global.BjtuAccountStore.putAll(accounts, (progress) => {
              if (!showProgress) return;
              setProgress(100, '正在获取并写入账号列表…');
              const written = type === 'teacher' ? progress?.teacherWritten : progress?.studentWritten;
              state[type].written = Number(written || 0);
              setListProgress(type, state[type].written, total, '正在写入', '写入');
            });
            state[type].phase = 'done';
            state[type].written = total;
            updateProgress();
          });
          return writeQueue;
        };

        const teacherTask = loadTeachers().then(async (accounts) => {
          await writeRole('teacher', accounts);
          return accounts;
        });
        const studentTask = loadStudents().then(async (accounts) => {
          await writeRole('student', accounts);
          return accounts;
        });
        const [teachers, students] = await Promise.all([teacherTask, studentTask]);
        const next = { ...teachers, ...students };
        if (!Object.keys(next).length) throw new Error('账号列表为空');

        await chrome.storage.local.set({ [ACCOUNT_LIST_VERSION_KEY]: ACCOUNT_LIST_VERSION });
        await syncHistoryWithAccountList(next);
        accountCache.clear();
        if (showProgress) setProgress(100, '', false);
        return Object.keys(next).length;
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

  async function getAccount(loginName) {
    const id = String(loginName || '').trim();
    if (!id) return null;
    const cached = accountCache.get(id);
    if (cached) return { loginName: id, ...cached };
    const record = await global.BjtuAccountStore.get(id);
    if (record) accountCache.set(id, record);
    return record ? { loginName: id, ...record } : null;
  }

  async function updateQuickUsername(loginName, quickUsername) {
    const id = String(loginName || '').trim();
    const quick = String(quickUsername || '').trim();
    if (!id || !quick) return null;
    await load();
    const record = await global.BjtuAccountStore.update(id, { quickUsername: quick });
    if (record) accountCache.set(id, record);
    return record ? { loginName: id, ...record } : null;
  }

  async function updatePassword(loginName, password) {
    const id = String(loginName || '').trim();
    const value = String(password || '').trim();
    if (!id || !value) return null;
    await load();
    const record = await global.BjtuAccountStore.update(id, { password: value });
    if (record) accountCache.set(id, record);
    return record ? { loginName: id, ...record } : null;
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
    getCurrentUserInfo,
    getAccount,
    updateQuickUsername,
    updatePassword,
    loginWithPassword,
    loginWithQuickUsername,
    requestRecovery
  };

})(globalThis);
