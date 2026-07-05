(function initBjtuAccountLogin(global) {
  'use strict';

  const BASE_VE = 'http://123.121.147.7:88/ve/';
  const ACCOUNT_LIST_VERSION_KEY = 'accountListVersion';
  const ACCOUNT_LIST_REVISION_KEY = 'accountListRevision';
  const ACCOUNT_LIST_WRITING_KEY = 'accountListWriting';
  const ACCOUNT_LIST_SKIPPED_KEY = 'accountListInitializationSkipped';
  const ACCOUNT_LIST_WRITE_LOCK = 'bjtu-account-list-write';
  const ACCOUNT_LIST_VERSION = 4;
  const ACCOUNT_FILE_FORMAT = 'bjtu-course-assistant-account-list';
  const ACCOUNT_FILE_VERSION = 1;
  const HISTORY_KEY = 'loginAccountHistory';
  const ADMIN_QUICK_USERNAME = 'QjQ0M0Y1MUY3OEIyNDU0MA==';
  const CURRENT_USER_URL = BASE_VE + 'back/coursePlatform/coursePlatform.shtml?method=getUserInfo';
  const PERSONAL_CENTER_URL = BASE_VE + 'back/personalCenter/personalCenter.shtml?method=toPersonalCenter';
  const CURRENT_ACCOUNT_PASSWORD_URL = PERSONAL_CENTER_URL + '&pageToType=2';
  const TEACHER_URL = BASE_VE + 'back/core/base/person/R005_P.shtml?para=F70FAB64CDA3B68EA6A1E9E008548F93';
  const QUICK_USERNAME_URL = BASE_VE + 'back/core/base/person/R005_P.shtml?para=570820F5E1FC92605C7CB3FB9872D88E&jrName=';
  const STUDENT_URL = BASE_VE + 'back/jw/student/student.shtml?method=studentList&ref=ch';
  const QUICK_USERNAME_CONCURRENCY = 5;
  const accountCache = new Map();
  const gbkEncodeCache = new Map();
  const currentAccountImportPromises = new Map();
  let initializationPromise = null;

  function decodeJsStringLiteral(value) {
    return String(value || '')
      .replace(/\\u([0-9a-f]{4})/gi, (_all, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/\\x([0-9a-f]{2})/gi, (_all, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/\\(['"\\])/g, '$1');
  }

  function decodePercentBytes(value, encoding = 'gbk') {
    const source = String(value || '');
    if (!/%[0-9a-f]{2}/i.test(source)) return source;
    const chunks = [];
    let bytes = [];
    const flush = () => {
      if (!bytes.length) return;
      try {
        chunks.push(new TextDecoder(encoding).decode(new Uint8Array(bytes)));
      } catch {
        chunks.push(new TextDecoder('utf-8').decode(new Uint8Array(bytes)));
      }
      bytes = [];
    };
    for (let i = 0; i < source.length;) {
      if (source[i] === '%' && /^[0-9a-f]{2}$/i.test(source.slice(i + 1, i + 3))) {
        bytes.push(parseInt(source.slice(i + 1, i + 3), 16));
        i += 3;
      } else {
        flush();
        chunks.push(source[i]);
        i += 1;
      }
    }
    flush();
    return chunks.join('');
  }

  function normalizeLoginNameText(value) {
    const raw = decodeJsStringLiteral(value).trim();
    if (!raw) return '';
    try {
      const utf8 = decodeURIComponent(raw).trim();
      if (utf8) return utf8;
    } catch {
      // fall back to GBK below
    }
    const gbk = decodePercentBytes(raw, 'gbk').trim();
    if (gbk && !gbk.includes('�')) return gbk;
    return raw;
  }

  function gbkBytesForChar(ch) {
    if (gbkEncodeCache.has(ch)) return gbkEncodeCache.get(ch);
    const code = ch.codePointAt(0);
    if (code <= 0x7f) {
      const bytes = [code];
      gbkEncodeCache.set(ch, bytes);
      return bytes;
    }
    for (let hi = 0x81; hi <= 0xfe; hi += 1) {
      for (let lo = 0x40; lo <= 0xfe; lo += 1) {
        if (lo === 0x7f) continue;
        try {
          if (new TextDecoder('gbk').decode(new Uint8Array([hi, lo])) === ch) {
            const bytes = [hi, lo];
            gbkEncodeCache.set(ch, bytes);
            return bytes;
          }
        } catch {
          // try next code point
        }
      }
    }
    const fallback = Array.from(unescape(encodeURIComponent(ch))).map((c) => c.charCodeAt(0));
    gbkEncodeCache.set(ch, fallback);
    return fallback;
  }

  function gbkUrlEncode(value) {
    const safe = /^[A-Za-z0-9_.~-]$/;
    return Array.from(String(value || '')).map((ch) => {
      if (safe.test(ch)) return ch;
      return gbkBytesForChar(ch).map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
    }).join('');
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

  async function ensureCurrentAccountStored(userInfo, { signal } = {}) {
    const loginName = String(userInfo?.loginName || '').trim();
    if (!loginName) return null;
    const existing = await global.BjtuAccountStore.get(loginName);
    if (existing) return existing;
    if (currentAccountImportPromises.has(loginName)) {
      return currentAccountImportPromises.get(loginName);
    }

    const task = (async () => {
      const response = await fetch(CURRENT_ACCOUNT_PASSWORD_URL, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal
      });
      if (!response.ok) return null;
      const html = await decodeResponse(response);
      let password = '';
      try {
        const document = new DOMParser().parseFromString(String(html || ''), 'text/html');
        password = String(document.querySelector('input#odbcPassword')?.getAttribute('value') || '').trim();
      } catch {
        password = '';
      }
      if (!password) return null;

      const current = await global.BjtuAccountStore.get(loginName);
      if (current) return current;
      const record = await global.BjtuAccountStore.put({
        loginName,
        userName: String(userInfo?.userName || '').trim(),
        roleName: String(userInfo?.roleName || '').trim(),
        password,
        quickUsername: ''
      });
      if (record) accountCache.set(loginName, record);
      return record;
    })().finally(() => currentAccountImportPromises.delete(loginName));

    currentAccountImportPromises.set(loginName, task);
    return task;
  }

  async function loginAdminWithQuickUsername({ signal } = {}) {
    const url = BASE_VE + 's.shtml?loginType=2&login=main_2&goLogin=1&username=' + ADMIN_QUICK_USERNAME;
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal
    });
    return parseLoginResponse(await decodeResponse(response));
  }

  async function ensureAdminQuickAccountStored() {
    const current = await global.BjtuAccountStore.get('admin');
    const record = await global.BjtuAccountStore.put({
      loginName: 'admin',
      roleName: String(current?.roleName || '超级管理员'),
      userName: String(current?.userName || 'admin'),
      password: String(current?.password || ''),
      quickUsername: ADMIN_QUICK_USERNAME
    });
    if (record) accountCache.set('admin', record);
    return record;
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

  async function fetchQuickUsername(loginName, { signal } = {}) {
    const response = await fetch(QUICK_USERNAME_URL + encodeURIComponent(String(loginName || '').trim()), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = JSON.parse(String(await decodeResponse(response) || '').trim());
    return String(data?.jrName || '').trim();
  }

  function isStaffAccount(userInfo) {
    const loginName = String(userInfo?.loginName || '').trim().toLowerCase();
    const roleCode = String(userInfo?.roleCode || '').trim().toLowerCase();
    const roleName = String(userInfo?.roleName || '').trim();
    if (loginName === 'admin') return true;
    if (roleCode) return roleCode !== 'xs';
    return !/学生/.test(roleName) && /教师|老师|助教|管理员|督导|领导/.test(roleName);
  }

  async function ensureQuickUsernameForLogin(loginName, { currentUser = null, signal, onStatus = null } = {}) {
    const id = String(loginName || '').trim();
    if (!id) throw new Error('账号为空');
    await load();

    let record = await global.BjtuAccountStore.get(id);
    if (record?.quickUsername) return { loginName: id, ...record };
    if (id.toLowerCase() === 'admin') {
      record = await ensureAdminQuickAccountStored();
      return record ? { loginName: id, ...record } : null;
    }

    let activeUser = currentUser || await getCurrentUserInfo({ signal });
    if (!isStaffAccount(activeUser)) {
      if (typeof onStatus === 'function') onStatus('正在登录管理员账号…');
      await ensureAdminQuickAccountStored();
      const adminResult = await loginAdminWithQuickUsername({ signal });
      if (!adminResult?.ok) {
        throw new Error(adminResult?.message || '管理员极速登录失败');
      }
      activeUser = await getCurrentUserInfo({ signal });
      if (String(activeUser?.loginName || '').trim().toLowerCase() !== 'admin') {
        throw new Error('管理员登录状态校验失败');
      }
    }

    if (typeof onStatus === 'function') onStatus('正在获取极速登录名…');
    const quickUsername = await fetchQuickUsername(id, { signal });
    if (!quickUsername) throw new Error('未获取到极速登录名');

    record = await global.BjtuAccountStore.put({
      loginName: id,
      userName: String(record?.userName || '').trim(),
      roleName: String(record?.roleName || '').trim(),
      password: String(record?.password || '').trim(),
      quickUsername
    });
    if (record) accountCache.set(id, record);
    await chrome.storage.local.set({ [ACCOUNT_LIST_REVISION_KEY]: Date.now() });
    return record ? { loginName: id, ...record } : null;
  }

  async function enrichQuickUsernames(accounts, roleState, updateProgress, existingLoginNames = new Set()) {
    const rows = Object.values(accounts || {}).filter((account) => {
      const loginName = String(account?.loginName || '').trim();
      return loginName && !existingLoginNames.has(loginName);
    });
    roleState.phase = 'quick';
    roleState.quickProcessed = 0;
    roleState.quickTotal = rows.length;
    roleState.currentPrefixes = [];
    updateProgress();
    let cursor = 0;
    const activeLogins = new Set();
    const worker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= rows.length) return;
        const account = rows[index];
        activeLogins.add(account.loginName);
        roleState.currentPrefixes = [...activeLogins];
        try {
          const quickUsername = await fetchQuickUsername(account.loginName);
          if (quickUsername) account.quickUsername = quickUsername;
        } catch {
          // A missing quick username must not discard the account or abort initialization.
        } finally {
          activeLogins.delete(account.loginName);
          roleState.quickProcessed += 1;
          roleState.currentPrefixes = [...activeLogins];
          if (roleState.quickProcessed % 10 === 0 || roleState.quickProcessed === rows.length) {
            updateProgress();
          }
        }
      }
    };
    const workerCount = Math.min(QUICK_USERNAME_CONCURRENCY, Math.max(1, rows.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  function parseCount(html, pattern, label) {
    const match = String(html || '').match(pattern);
    const count = Number(match?.[1] || 0);
    if (!Number.isFinite(count) || count <= 0) throw new Error('无法读取' + label + '总数');
    return Math.floor(count);
  }

  function parseLoginCall(source) {
    const match = String(source || '').match(/goLogin\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([0-9a-f]{32})['"]\s*\)/i);
    return match ? { loginName: normalizeLoginNameText(match[1]), password: String(match[2]).trim() } : null;
  }

  function parseAccountLogin(source) {
    const legacy = parseLoginCall(source);
    if (legacy?.loginName) return legacy;
    const match = String(source || '').match(/glyjsqhyh\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
    return match ? { loginName: normalizeLoginNameText(match[1]), password: '' } : null;
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
    const login = parseAccountLogin(row);
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
    let latestLoginName = '';
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
          latestLoginName = account.loginName;
          processed += 1;
        }
        if (processed > 0 && processed % 250 === 0) {
          if (typeof onParsed === 'function') onParsed(parsedCount, latestLoginName);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      if (typeof onParsed === 'function') onParsed(parsedCount, latestLoginName);
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

  function clearAccountInitQueryParameter() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('accountInit')) return;
      url.searchParams.delete('accountInit');
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // URL cleanup is best-effort and must not affect account initialization.
    }
  }

  function setListProgress(type, parsed, total, pendingLabel = '正在读取总数', phase = '', currentAccounts = []) {
    const bar = document.getElementById('account-init-' + type + '-progress-bar');
    const label = document.getElementById('account-init-' + type + '-label');
    const safeParsed = Math.max(0, Number(parsed) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const percent = safeTotal > 0 ? Math.min(100, (safeParsed / safeTotal) * 100) : 0;
    if (bar instanceof HTMLElement) bar.style.width = percent + '%';
    if (label instanceof HTMLElement) {
      const name = type === 'teacher' ? '教职工' : '学生';
      const prefix = name + (phase ? phase : '') + '：';
      const currentText = Array.isArray(currentAccounts) && currentAccounts.length && phase
        ? `；正在${phase}：` + currentAccounts.join('、')
        : '';
      label.textContent = safeTotal > 0
        ? (prefix + safeParsed + ' / ' + safeTotal + currentText)
        : (prefix + pendingLabel);
    }
  }

  async function load() {
    await global.BjtuAccountStore.migrateLegacy();
    return global.BjtuAccountStore.count();
  }

  async function readLocalAccountState() {
    const bindings = new Map();
    const [previous, existingLoginNames] = await Promise.all([
      typeof global.BjtuAccountStore.getCredentialAccounts === 'function'
        ? global.BjtuAccountStore.getCredentialAccounts()
        : global.BjtuAccountStore.getQuickAccounts(),
      typeof global.BjtuAccountStore.getLoginNames === 'function'
        ? global.BjtuAccountStore.getLoginNames()
        : global.BjtuAccountStore.getAll().then((rows) => new Set(rows.map((row) => String(row?.loginName || '').trim()).filter(Boolean)))
    ]);
    previous.forEach((record) => {
      const loginName = String(record?.loginName || '').trim();
      if (!loginName) return;
      bindings.set(loginName, {
        password: String(record?.password || '').trim(),
        quickUsername: String(record?.quickUsername || '').trim()
      });
    });
    return { bindings, existingLoginNames };
  }

  function preserveLocalBindings(next, bindings) {
    Object.keys(next || {}).forEach((loginName) => {
      const current = bindings?.get(loginName);
      if (!current) return;
      if (current.quickUsername && !next[loginName].quickUsername) {
        next[loginName].quickUsername = current.quickUsername;
      }
      if (current.password && !next[loginName].password) {
        next[loginName].password = current.password;
      }
    });
  }

  function createWritingMarker() {
    return {
      token: Date.now() + '-' + Math.random(),
      startedAt: Date.now(),
      heartbeatAt: Date.now()
    };
  }

  async function acquireWritingLock() {
    if (!navigator.locks?.request) return () => {};
    let releaseLock;
    let markAcquired;
    const acquired = new Promise((resolve) => { markAcquired = resolve; });
    const released = new Promise((resolve) => { releaseLock = resolve; });
    navigator.locks.request(ACCOUNT_LIST_WRITE_LOCK, async () => {
      markAcquired();
      await released;
    }).catch(() => markAcquired());
    await acquired;
    return () => releaseLock?.();
  }

  function startWritingHeartbeat(marker) {
    return setInterval(async () => {
      try {
        const current = await chrome.storage.local.get([ACCOUNT_LIST_WRITING_KEY]);
        if (current?.[ACCOUNT_LIST_WRITING_KEY]?.token !== marker.token) return;
        marker.heartbeatAt = Date.now();
        await chrome.storage.local.set({ [ACCOUNT_LIST_WRITING_KEY]: marker });
      } catch {
        // A transient storage failure must not interrupt account initialization.
      }
    }, 2000);
  }

  async function clearWritingMarker(marker, heartbeatTimer) {
    clearInterval(heartbeatTimer);
    const current = await chrome.storage.local.get([ACCOUNT_LIST_WRITING_KEY]);
    if (current?.[ACCOUNT_LIST_WRITING_KEY]?.token === marker.token) {
      await chrome.storage.local.remove([ACCOUNT_LIST_WRITING_KEY]);
    }
  }

  function parseAccountFile(source) {
    let payload;
    try {
      payload = typeof source === 'string' ? JSON.parse(source) : source;
    } catch {
      throw new Error('文件不是有效的 JSON');
    }
    if (!payload || payload.format !== ACCOUNT_FILE_FORMAT || Number(payload.version) !== ACCOUNT_FILE_VERSION) {
      throw new Error('不支持的账号列表文件格式或版本');
    }
    if (!Array.isArray(payload.accounts) || !payload.accounts.length) {
      throw new Error('文件中没有账号记录');
    }
    if (payload.accounts.length > 300000) throw new Error('账号记录数量异常');
    const accounts = Object.create(null);
    payload.accounts.forEach((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('第 ' + (index + 1) + ' 条账号记录无效');
      }
      const loginName = String(value.loginName || '').trim();
      const password = String(value.password || '').trim().toLowerCase();
      if (!loginName || loginName.length > 128) throw new Error('第 ' + (index + 1) + ' 条账号缺少有效账号');
      if (Object.prototype.hasOwnProperty.call(accounts, loginName)) {
        throw new Error('文件中存在重复账号：' + loginName);
      }
      if (password && !/^[0-9a-f]{32}$/.test(password)) {
        throw new Error('账号 ' + loginName + ' 的密码 MD5 无效');
      }
      accounts[loginName] = {
        loginName,
        roleName: String(value.roleName || '').trim().slice(0, 256),
        userName: String(value.userName || '').trim().slice(0, 256),
        password,
        quickUsername: String(value.quickUsername || '').trim()
      };
    });
    return accounts;
  }

  async function importAccountFile(source, { showProgress = false } = {}) {
    const accounts = parseAccountFile(source);
    const localBindings = await readLocalBindings();
    preserveLocalBindings(accounts, localBindings);
    const total = Object.keys(accounts).length;
    const releaseWritingLock = await acquireWritingLock();
    const marker = createWritingMarker();
    await chrome.storage.local.set({ [ACCOUNT_LIST_WRITING_KEY]: marker });
    const heartbeatTimer = startWritingHeartbeat(marker);
    try {
      if (showProgress) setProgress(0, '正在导入账号列表…');
      await global.BjtuAccountStore.replaceAll(accounts, (progress) => {
        if (!showProgress) return;
        setProgress(100, '正在导入账号列表…（' + Number(progress?.written || 0) + ' / ' + total + '）');
        setListProgress('teacher', progress?.teacherWritten, progress?.teacherTotal, '正在写入', '写入', progress?.teacherCurrentPrefixes);
        setListProgress('student', progress?.studentWritten, progress?.studentTotal, '正在写入', '写入', progress?.studentCurrentPrefixes);
      });
      await chrome.storage.local.set({
        [ACCOUNT_LIST_VERSION_KEY]: ACCOUNT_LIST_VERSION,
        [ACCOUNT_LIST_REVISION_KEY]: Date.now()
      });
      await chrome.storage.local.remove([ACCOUNT_LIST_SKIPPED_KEY]);
      await syncHistoryWithAccountList(accounts);
      accountCache.clear();
      return total;
    } finally {
      await clearWritingMarker(marker, heartbeatTimer);
      releaseWritingLock();
    }
  }

  async function exportAccountFile({ showProgress = false } = {}) {
    const state = await chrome.storage.local.get([ACCOUNT_LIST_WRITING_KEY]);
    const writingState = state?.[ACCOUNT_LIST_WRITING_KEY];
    const heartbeatAt = Number(writingState?.heartbeatAt || 0);
    const lockState = navigator.locks?.query ? await navigator.locks.query() : null;
    const hasActiveLock = !!lockState?.held?.some((lock) => lock.name === ACCOUNT_LIST_WRITE_LOCK);
    const hasRecentHeartbeat = heartbeatAt && Date.now() - heartbeatAt < 7000;
    if (hasActiveLock || (!lockState && hasRecentHeartbeat)) {
      throw new Error('账号列表仍在获取或写入，请完成后再导出');
    }
    if (writingState) await chrome.storage.local.remove([ACCOUNT_LIST_WRITING_KEY]);
    if (showProgress) {
      setProgress(0, '正在读取账号列表…');
      setListProgress('teacher', 0, 0, '正在读取');
      setListProgress('student', 0, 0, '正在读取');
    }
    const accounts = await global.BjtuAccountStore.getAll((progress) => {
      if (!showProgress) return;
      const total = Number(progress?.total || 0);
      const read = Number(progress?.read || 0);
      const teacherRead = Number(progress?.teacherRead || 0);
      const studentRead = Number(progress?.studentRead || 0);
      const teacherTotal = Number(progress?.teacherTotal ?? teacherRead);
      const studentTotal = Number(progress?.studentTotal ?? studentRead);
      setProgress(total > 0 ? Math.min(100, (read / total) * 100) : 0, '正在导出账号列表…（' + read + ' / ' + total + '）');
      setListProgress('teacher', teacherRead, teacherTotal, '正在读取', '读取');
      setListProgress('student', studentRead, studentTotal, '正在读取', '读取');
    });
    if (!accounts.length) throw new Error('账号列表为空');
    const studentCount = accounts.filter((account) => account.roleName === '学生').length;
    if (showProgress) {
      setProgress(100, '正在生成导出文件…（' + accounts.length + ' / ' + accounts.length + '）');
      setListProgress('teacher', accounts.length - studentCount, accounts.length - studentCount, '正在生成', '读取');
      setListProgress('student', studentCount, studentCount, '正在生成', '读取');
    }
    return {
      format: ACCOUNT_FILE_FORMAT,
      version: ACCOUNT_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      summary: {
        total: accounts.length,
        teacher: accounts.length - studentCount,
        student: studentCount
      },
      accounts
    };
  }

  function requestInitializationSource() {
    return new Promise((resolve) => {
      const actions = document.getElementById('account-init-actions');
      const remote = document.getElementById('account-init-remote');
      const importButton = document.getElementById('account-init-import');
      const skipButton = document.getElementById('account-init-skip');
      const fileInput = document.getElementById('account-init-file');
      const fetchOptions = document.getElementById('account-init-fetch-options');
      const teacherCheckbox = document.getElementById('account-init-fetch-teachers');
      const studentCheckbox = document.getElementById('account-init-fetch-students');
      const quickOption = document.getElementById('account-init-quick-option');
      const quickCheckbox = document.getElementById('account-init-fetch-quick-usernames');
      if (!(actions instanceof HTMLElement) || !(fileInput instanceof HTMLInputElement)) {
        resolve({ source: 'remote', fetchTeachers: true, fetchStudents: true, fetchQuickUsernames: false });
        return;
      }
      const cleanup = () => {
        remote?.removeEventListener('click', onRemote);
        importButton?.removeEventListener('click', onImport);
        skipButton?.removeEventListener('click', onSkip);
        fileInput.removeEventListener('change', onFile);
        actions.style.display = 'none';
        if (fetchOptions instanceof HTMLElement) fetchOptions.style.display = 'none';
        if (quickOption instanceof HTMLElement) quickOption.style.display = 'none';
      };
      const onRemote = () => {
        const fetchTeachers = !(teacherCheckbox instanceof HTMLInputElement) || teacherCheckbox.checked;
        const fetchStudents = !(studentCheckbox instanceof HTMLInputElement) || studentCheckbox.checked;
        if (!fetchTeachers && !fetchStudents) {
          setProgress(0, '请至少选择获取教职工或学生中的一类');
          return;
        }
        const fetchQuickUsernames = quickCheckbox instanceof HTMLInputElement && quickCheckbox.checked;
        cleanup();
        resolve({ source: 'remote', fetchTeachers, fetchStudents, fetchQuickUsernames });
      };
      const onImport = () => {
        fileInput.value = '';
        fileInput.click();
      };
      const onSkip = () => {
        cleanup();
        clearAccountInitQueryParameter();
        resolve({ source: 'skip' });
      };
      const onFile = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        cleanup();
        try {
          const count = await importAccountFile(await file.text(), { showProgress: true });
          setProgress(100, '', false);
          resolve({ source: 'import', count });
        } catch (error) {
          setProgress(0, '导入失败：' + String(error?.message || error));
          remote?.addEventListener('click', onRemote);
          importButton?.addEventListener('click', onImport);
          skipButton?.addEventListener('click', onSkip);
          fileInput.addEventListener('change', onFile);
          actions.style.display = 'flex';
          if (fetchOptions instanceof HTMLElement) fetchOptions.style.display = 'flex';
          if (quickOption instanceof HTMLElement) quickOption.style.display = 'flex';
        }
      };
      remote?.addEventListener('click', onRemote);
      importButton?.addEventListener('click', onImport);
      skipButton?.addEventListener('click', onSkip);
      fileInput.addEventListener('change', onFile);
      if (teacherCheckbox instanceof HTMLInputElement) teacherCheckbox.checked = true;
      if (studentCheckbox instanceof HTMLInputElement) studentCheckbox.checked = true;
      if (quickCheckbox instanceof HTMLInputElement) quickCheckbox.checked = false;
      if (fetchOptions instanceof HTMLElement) fetchOptions.style.display = 'flex';
      if (quickOption instanceof HTMLElement) quickOption.style.display = 'flex';
      actions.style.display = 'flex';
      setProgress(0, '请选择账号列表初始化方式');
    });
  }

  async function syncHistoryWithAccountList(next) {
    const stored = await chrome.storage.local.get([HISTORY_KEY]);
    const history = Array.isArray(stored?.[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    const updated = history.map((record) => {
      const loginName = String(record?.loginName || record?.userId || '').trim();
      return {
        loginName,
        lastLoginAt: Number(record?.lastLoginAt || 0) || 0
      };
    }).filter((record) => record.loginName);
    await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  }

  async function initialize({
    force = false,
    showProgress = true,
    fetchTeachers = true,
    fetchStudents = true,
    fetchQuickUsernames = false
  } = {}) {
    if (initializationPromise) return initializationPromise;
    initializationPromise = (async () => {
      let remoteMarker = null;
      let remoteHeartbeatTimer = null;
      let releaseRemoteWritingLock = null;
      let shouldFetchTeachers = fetchTeachers !== false;
      let shouldFetchStudents = fetchStudents !== false;
      let shouldFetchQuickUsernames = fetchQuickUsernames === true;
      try {
        const existingCount = await load();
        const versionState = await chrome.storage.local.get([ACCOUNT_LIST_VERSION_KEY]);
        const isCurrentVersion = Number(versionState?.[ACCOUNT_LIST_VERSION_KEY] || 0) === ACCOUNT_LIST_VERSION;
        if (!force && isCurrentVersion && existingCount > 0) return existingCount;
        const skippedState = await chrome.storage.local.get([ACCOUNT_LIST_SKIPPED_KEY]);
        if (!force && skippedState?.[ACCOUNT_LIST_SKIPPED_KEY] === true) {
          return existingCount;
        }

        if (showProgress) {
          const source = await requestInitializationSource();
          if (source.source === 'skip') {
            await chrome.storage.local.set({ [ACCOUNT_LIST_SKIPPED_KEY]: true });
            setProgress(0, '', false);
            global.showToast?.(
              '已跳过账号列表初始化；登录时可在“账号或密码错误”窗口中重新初始化账号列表',
              'info',
              5000
            );
            return { skipped: true, count: existingCount };
          }
          if (source.source === 'import') {
            await chrome.storage.local.remove([ACCOUNT_LIST_SKIPPED_KEY]);
            setProgress(100, '', false);
            clearAccountInitQueryParameter();
            return Number(source.count || 0);
          }
          shouldFetchTeachers = source.fetchTeachers !== false;
          shouldFetchStudents = source.fetchStudents !== false;
          shouldFetchQuickUsernames = source.fetchQuickUsernames === true;
        }
        if (!shouldFetchTeachers && !shouldFetchStudents) {
          throw new Error('请至少选择获取教职工或学生中的一类');
        }

        releaseRemoteWritingLock = await acquireWritingLock();
        remoteMarker = createWritingMarker();
        await chrome.storage.local.set({ [ACCOUNT_LIST_WRITING_KEY]: remoteMarker });
        remoteHeartbeatTimer = startWritingHeartbeat(remoteMarker);

        await ensureAdminQuickAccountStored();
        if (showProgress) setProgress(1, '正在检查管理员登录状态…');
        const currentUser = await getCurrentUserInfo();
        if (String(currentUser?.loginName || '').trim() !== 'admin') {
          if (showProgress) setProgress(1, '正在快速登录管理员账号…');
          const adminResult = await loginAdminWithQuickUsername();
          if (!adminResult.ok) throw new Error(adminResult.message || '管理员账号快速登录失败');
          const adminUser = await getCurrentUserInfo();
          if (String(adminUser?.loginName || '').trim() !== 'admin') {
            throw new Error('管理员账号快速登录后身份验证失败');
          }
        }

        const state = {
          teacher: { parsed: 0, quickProcessed: 0, quickTotal: 0, written: 0, total: 0, phase: shouldFetchTeachers ? 'load' : 'skipped', currentPrefixes: [] },
          student: { parsed: 0, quickProcessed: 0, quickTotal: 0, written: 0, total: 0, phase: shouldFetchStudents ? 'load' : 'skipped', currentPrefixes: [] }
        };
        const { bindings: localBindings, existingLoginNames } = await readLocalAccountState();
        let writeQueue = Promise.resolve();
        const updateProgress = () => {
          if (!showProgress) return;
          setProgress(0, '正在获取并写入账号列表…');
          ['teacher', 'student'].forEach((type) => {
            const roleState = state[type];
            if (roleState.phase === 'skipped') {
              setListProgress(type, 0, 0, '已跳过');
              return;
            }
            const isWriting = roleState.phase === 'write' || roleState.phase === 'done';
            const isFetchingQuick = roleState.phase === 'quick';
            setListProgress(
              type,
              isWriting ? roleState.written : (isFetchingQuick ? roleState.quickProcessed : roleState.parsed),
              isFetchingQuick ? roleState.quickTotal : roleState.total,
              isWriting ? '正在写入' : (isFetchingQuick ? '正在获取极速登录名' : '正在读取总数'),
              isWriting ? '写入' : (isFetchingQuick ? '获取极速登录名' : '读取'),
              roleState.currentPrefixes
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
          const parser = createStreamingAccountParser('teacher', (parsed, loginName) => {
            state.teacher.parsed = parsed;
            state.teacher.currentPrefixes = loginName ? [loginName] : [];
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
          if (shouldFetchQuickUsernames) {
            await enrichQuickUsernames(parser.result, state.teacher, updateProgress, existingLoginNames);
          }
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
          const parser = createStreamingAccountParser('student', (parsed, loginName) => {
            state.student.parsed = parsed;
            state.student.currentPrefixes = loginName ? [loginName] : [];
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
          if (shouldFetchQuickUsernames) {
            await enrichQuickUsernames(parser.result, state.student, updateProgress, existingLoginNames);
          }
          return parser.result;
        };

        const writeRole = (type, accounts) => {
          preserveLocalBindings(accounts, localBindings);
          const total = Object.keys(accounts).length;
          state[type].phase = 'write';
          state[type].written = 0;
          state[type].currentPrefixes = [];
          updateProgress();
          writeQueue = writeQueue.then(async () => {
            await global.BjtuAccountStore.putAll(accounts, (progress) => {
              if (!showProgress) return;
              setProgress(100, '正在获取并写入账号列表…');
              const written = type === 'teacher' ? progress?.teacherWritten : progress?.studentWritten;
              state[type].written = Number(written || 0);
              const prefixes = type === 'teacher' ? progress?.teacherCurrentPrefixes : progress?.studentCurrentPrefixes;
              state[type].currentPrefixes = Array.isArray(prefixes) ? prefixes : [];
              setListProgress(type, state[type].written, total, '正在写入', '写入', state[type].currentPrefixes);
            });
            state[type].phase = 'done';
            state[type].written = total;
            state[type].currentPrefixes = [];
            updateProgress();
          });
          return writeQueue;
        };

        const teacherTask = shouldFetchTeachers
          ? loadTeachers().then(async (accounts) => {
            await writeRole('teacher', accounts);
            return accounts;
          })
          : Promise.resolve({});
        const studentTask = shouldFetchStudents
          ? loadStudents().then(async (accounts) => {
            await writeRole('student', accounts);
            return accounts;
          })
          : Promise.resolve({});
        const [teachers, students] = await Promise.all([teacherTask, studentTask]);
        const next = { ...teachers, ...students };
        if (!Object.keys(next).length) throw new Error('账号列表为空');

        await chrome.storage.local.set({
          [ACCOUNT_LIST_VERSION_KEY]: ACCOUNT_LIST_VERSION,
          [ACCOUNT_LIST_REVISION_KEY]: Date.now()
        });
        await chrome.storage.local.remove([ACCOUNT_LIST_SKIPPED_KEY]);
        await syncHistoryWithAccountList(next);
        accountCache.clear();
        if (showProgress) setProgress(100, '', false);
        clearAccountInitQueryParameter();
        return Object.keys(next).length;
      } catch (error) {
        if (showProgress) {
          setProgress(100, '账号列表初始化失败：' + String(error?.message || error));
          await new Promise((resolve) => setTimeout(resolve, 1800));
          setProgress(0, '', false);
        }
        throw error;
      } finally {
        if (remoteMarker) {
          await clearWritingMarker(remoteMarker, remoteHeartbeatTimer);
        }
        releaseRemoteWritingLock?.();
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
    let record = await global.BjtuAccountStore.get(id);
    if (!record) {
      const normalizedId = normalizeLoginNameText(id);
      if (normalizedId && normalizedId !== id) record = await global.BjtuAccountStore.get(normalizedId);
    }
    if (!record && /[^\x00-\x7f]/.test(id)) {
      const encodedId = gbkUrlEncode(id);
      if (encodedId && encodedId !== id) record = await global.BjtuAccountStore.get(encodedId);
    }
    if (record) accountCache.set(id, record);
    return record ? { loginName: record.loginName || id, ...record } : null;
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
      + gbkUrlEncode(String(loginName || '').trim())
      + '&password=' + encodeURIComponent(String(password || '').trim());
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', signal });
    return parseLoginResponse(await decodeResponse(res));
  }

  async function loginWithQuickUsername(quickUsername, { signal } = {}) {
    const url = BASE_VE + 's.shtml?loginType=2&login=main_2&goLogin=1&username=' + encodeURIComponent(String(quickUsername || '').trim());
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
          if (md5Input instanceof HTMLInputElement && typeof global.strEnc === 'function') {
            md5Input.value = global.strEnc(plainInput.value);
          }
          plainInput.focus();
        }
      };
      const onPlainInput = () => {
        if (!(plainInput instanceof HTMLInputElement) || !(md5Input instanceof HTMLInputElement)) return;
        md5Input.value = plainInput.value && typeof global.strEnc === 'function'
          ? global.strEnc(plainInput.value)
          : '';
      };
      const onMd5Input = () => {
        if (!(md5Input instanceof HTMLInputElement)) return;
        const value = String(md5Input.value || '').replace(/[^0-9a-f]/gi, '').slice(0, 256).toUpperCase();
        if (md5Input.value !== value) md5Input.value = value;
      };
      const onSubmit = () => {
        const plain = String(plainInput?.value || '');
        const password = plain
          ? (typeof global.strEnc === 'function' ? global.strEnc(plain) : '')
          : String(md5Input?.value || '').trim();
        if (!/^(?:[0-9a-f]{16})+$/i.test(password)) {
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
    ensureCurrentAccountStored,
    getAccount,
    updateQuickUsername,
    updatePassword,
    ensureQuickUsernameForLogin,
    importAccountFile,
    exportAccountFile,
    loginWithPassword,
    loginWithQuickUsername,
    requestRecovery
  };

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes?.[ACCOUNT_LIST_REVISION_KEY]) accountCache.clear();
  });

})(globalThis);
