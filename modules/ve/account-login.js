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
  const ACCOUNT_FILE_VERSION = 2;
  const REMOTE_ACCOUNT_LIST_URL = 'https://s1y4x1.github.io/account-list.json';
  const HISTORY_KEY = 'loginAccountHistory';
  const ADMIN_LOGIN_NAME = 'JyDadmin';
  const ADMIN_USER_NAME = 'admin';
  const ADMIN_QUICK_USERNAME = 'RjREQkM5NTRDMTJBMzU1QkZCNzFDMEM5RjYwNzg4RDg=';
  const PERSONAL_CENTER_URL = BASE_VE + 'back/personalCenter/personalCenter.shtml?method=toPersonalCenter';
  const CURRENT_ACCOUNT_PASSWORD_URL = PERSONAL_CENTER_URL + '&pageToType=2';
  const TEACHER_URL = BASE_VE + 'back/core/base/person/R005_P.shtml?para=F70FAB64CDA3B68EA6A1E9E008548F93';
  const QUICK_USERNAME_URL = BASE_VE + 'back/core/base/person/R005_P.shtml?para=570820F5E1FC9260A1B9D87499FD2190A6A1E9E008548F93&jrName=';
  const STUDENT_URL = BASE_VE + 'back/jw/student/student.shtml?method=studentList&ref=ch';
  const QUICK_USERNAME_CONCURRENCY = 5;
  const accountCache = new Map();
  const gbkEncodeCache = new Map();
  const currentAccountImportPromises = new Map();
  let initializationPromise = null;
  let adminAccountNormalizationPromise = null;

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: 'runtime', message: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, reason: 'runtime', message: '扩展后台未返回结果' });
      });
    });
  }

  function isAdminLoginName(value) {
    return String(value || '').trim().toLowerCase() === ADMIN_LOGIN_NAME.toLowerCase();
  }

  function normalizeAdminAccountEntries(accounts) {
    if (!accounts || typeof accounts !== 'object') return accounts;
    Object.keys(accounts).forEach((key) => {
      const normalized = String(key || '').trim().toLowerCase();
      if (normalized === 'admin') {
        delete accounts[key];
        return;
      }
      if (normalized !== ADMIN_LOGIN_NAME.toLowerCase()) return;
      const record = accounts[key] || {};
      if (key !== ADMIN_LOGIN_NAME) delete accounts[key];
      accounts[ADMIN_LOGIN_NAME] = {
        ...record,
        loginName: ADMIN_LOGIN_NAME,
        userName: ADMIN_USER_NAME,
        quickUsername: ADMIN_QUICK_USERNAME
      };
    });
    return accounts;
  }

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
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const response = await sendRuntimeMessage({ type: 'VE_LOGIN_CHECK_STATUS', payload: {} });
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    return response?.userInfo || null;
  }

  async function ensureCurrentAccountStored(userInfo, { signal } = {}) {
    const loginName = String(userInfo?.loginName || '').trim();
    if (!loginName) return null;
    const userName = String(userInfo?.userName || '').trim();
    const roleName = String(userInfo?.roleName || '').trim();
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
      const existing = await global.BjtuAccountStore.get(loginName);
      if (!response.ok) return existing;
      const html = await decodeResponse(response);
      let password = '';
      try {
        const document = new DOMParser().parseFromString(String(html || ''), 'text/html');
        password = String(document.querySelector('input#odbcPassword')?.getAttribute('value') || '').trim();
      } catch {
        password = '';
      }
      if (!password) return existing;

      const current = await global.BjtuAccountStore.get(loginName);
      if (current) {
        const patch = {};
        if (userName && userName !== String(current.userName || '').trim()) patch.userName = userName;
        if (roleName && roleName !== String(current.roleName || '').trim()) patch.roleName = roleName;
        if (password !== String(current.passwordMd5 || '').trim()) patch.passwordMd5 = password;
        if (Object.keys(patch).length) {
          const updated = await global.BjtuAccountStore.update(loginName, patch);
          if (updated) {
            accountCache.set(loginName, updated);
            return updated;
          }
        }
        return current;
      }
      const record = await global.BjtuAccountStore.put({
        loginName,
        userName,
        roleName,
        password: '',
        passwordMd5: password,
        quickUsername: ''
      });
      if (record) accountCache.set(loginName, record);
      return record;
    })().finally(() => currentAccountImportPromises.delete(loginName));

    currentAccountImportPromises.set(loginName, task);
    return task;
  }

  async function loginAdminWithQuickUsername({ signal } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const response = await sendRuntimeMessage({
      type: 'VE_LOGIN_WITH_QUICK_USERNAME',
      payload: { quickUsername: ADMIN_QUICK_USERNAME, loginName: ADMIN_LOGIN_NAME, recordHistory: false }
    });
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    return response;
  }

  async function ensureAdminQuickAccountStored() {
    if (adminAccountNormalizationPromise) return adminAccountNormalizationPromise;
    adminAccountNormalizationPromise = (async () => {
      if (typeof global.BjtuAccountStore.deleteMany === 'function') {
        await global.BjtuAccountStore.deleteMany(['admin']);
      }
      accountCache.delete('admin');
      const current = await global.BjtuAccountStore.get(ADMIN_LOGIN_NAME);
      const record = await global.BjtuAccountStore.put({
        loginName: ADMIN_LOGIN_NAME,
        roleName: String(current?.roleName || '超级管理员'),
        userName: ADMIN_USER_NAME,
        password: String(current?.password || ''),
        passwordMd5: String(current?.passwordMd5 || ''),
        quickUsername: ADMIN_QUICK_USERNAME
      });
      if (record) accountCache.set(ADMIN_LOGIN_NAME, record);
      return record;
    })().catch((error) => {
      adminAccountNormalizationPromise = null;
      throw error;
    });
    return adminAccountNormalizationPromise;
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

  async function enrichQuickUsernames(accounts, roleState, updateProgress, existingQuickLoginNames = new Set()) {
    const rows = Object.values(accounts || {}).filter((account) => {
      const loginName = String(account?.loginName || '').trim();
      return loginName && !String(account?.quickUsername || '').trim() && !existingQuickLoginNames.has(loginName);
    });
    roleState.phase = 'quick';
    roleState.quickProcessed = 0;
    roleState.quickTotal = rows.length;
    roleState.currentPrefixes = [];
    updateProgress();
    let cursor = 0;
    const completedSinceProgress = [];
    const worker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= rows.length) return;
        const account = rows[index];
        try {
          const quickUsername = await fetchQuickUsername(account.loginName);
          if (quickUsername) account.quickUsername = quickUsername;
        } catch {
          // A missing quick username must not discard the account or abort initialization.
        } finally {
          roleState.quickProcessed += 1;
          completedSinceProgress.push(account.loginName);
          if (roleState.quickProcessed % 10 === 0 || roleState.quickProcessed === rows.length) {
            roleState.currentPrefixes = completedSinceProgress.splice(0);
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
        password: '',
        passwordMd5: login.password,
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
      password: '',
      passwordMd5: login.password,
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
      setAccountImportDownloadProgress({ visible: false });
      setListProgress('teacher', 0, 0, '正在等待');
      setListProgress('student', 0, 0, '正在等待');
    }
  }

  function formatBytesForAccountImport(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(value < 100 * 1024 ? 1 : 0) + ' KB';
    return (value / 1024 / 1024).toFixed(value < 100 * 1024 * 1024 ? 1 : 0) + ' MB';
  }

  function setAccountImportDownloadProgress({ loaded = 0, total = 0, visible = true } = {}) {
    const row = document.getElementById('account-init-download-progress');
    const label = document.getElementById('account-init-download-label');
    const bar = document.getElementById('account-init-download-progress-bar');
    const safeLoaded = Math.max(0, Number(loaded) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const hasReliableTotal = safeTotal > 0 && safeLoaded <= safeTotal;
    if (row instanceof HTMLElement) {
      row.style.display = visible ? 'block' : 'none';
      row.classList.toggle('indeterminate', visible && !hasReliableTotal);
      row.setAttribute('aria-valuenow', hasReliableTotal ? String(Math.min(100, (safeLoaded / safeTotal) * 100)) : '0');
    }
    if (label instanceof HTMLElement) {
      label.textContent = hasReliableTotal
        ? `下载：${formatBytesForAccountImport(safeLoaded)} / ${formatBytesForAccountImport(safeTotal)}`
        : `下载：已下载 ${formatBytesForAccountImport(safeLoaded)}`;
    }
    if (bar instanceof HTMLElement) {
      bar.style.width = hasReliableTotal ? Math.min(100, (safeLoaded / safeTotal) * 100) + '%' : '35%';
    }
  }

  async function readAccountImportResponseText(response, statusPrefix = '正在从远程仓库下载账号列表…') {
    if (!response?.body?.getReader) {
      const text = await response.text();
      setAccountImportDownloadProgress({ loaded: new TextEncoder().encode(text).byteLength, visible: true });
      return text;
    }
    const contentEncoding = String(response.headers.get('content-encoding') || '').trim().toLowerCase();
    const headerTotal = Number(response.headers.get('content-length') || 0);
    // Fetch exposes decoded response bytes. A compressed Content-Length therefore cannot be used as their total.
    let total = contentEncoding && contentEncoding !== 'identity' ? 0 : headerTotal;
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      loaded += value.byteLength || value.length || 0;
      if (total > 0 && loaded > total) total = 0;
      setAccountImportDownloadProgress({ loaded, total, visible: true });
      setProgress(total > 0 ? Math.min(100, (loaded / total) * 100) : 0, statusPrefix);
    }
    const merged = new Uint8Array(loaded);
    let offset = 0;
    chunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.byteLength || chunk.length || 0;
    });
    if (total > 0 && loaded !== total) total = 0;
    setAccountImportDownloadProgress({ loaded, total, visible: true });
    setProgress(100, statusPrefix);
    return new TextDecoder('utf-8').decode(merged);
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

  function setAccountInitTitle(text) {
    const title = document.getElementById('account-init-title');
    if (title instanceof HTMLElement) title.textContent = String(text || '初始化登录账号列表');
  }

  function hideAccountInitializationChoices() {
    [
      'account-init-actions',
      'account-init-import-actions',
      'account-init-fetch-options',
      'account-init-quick-option'
    ].forEach((id) => {
      const element = document.getElementById(id);
      if (element instanceof HTMLElement) element.style.display = 'none';
    });
    setAccountImportDownloadProgress({ visible: false });
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

  async function migratePasswords({ showProgress = true } = {}) {
    if (typeof global.BjtuAccountStore?.migratePasswordFields !== 'function') {
      throw new Error('当前版本缺少账号密码迁移组件');
    }
    setAccountInitTitle('迁移账号密码');
    hideAccountInitializationChoices();
    if (showProgress) {
      setProgress(0, '正在准备迁移账号密码…');
      setListProgress('teacher', 0, 0, '正在读取总数', '迁移');
      setListProgress('student', 0, 0, '正在读取总数', '迁移');
    }
    try {
      const result = await global.BjtuAccountStore.migratePasswordFields((progress) => {
        if (!showProgress) return;
        const processed = Number(progress?.processed || 0);
        const total = Number(progress?.total || 0);
        const percent = total > 0 ? Math.min(100, (processed / total) * 100) : 100;
        setProgress(percent, `正在迁移账号密码…（${processed} / ${total}）`);
        setListProgress(
          'teacher',
          progress?.teacherProcessed,
          progress?.teacherTotal,
          '无需迁移',
          '迁移',
          progress?.teacherCurrentPrefixes
        );
        setListProgress(
          'student',
          progress?.studentProcessed,
          progress?.studentTotal,
          '无需迁移',
          '迁移',
          progress?.studentCurrentPrefixes
        );
      });
      await chrome.storage.local.set({ [ACCOUNT_LIST_REVISION_KEY]: Date.now() });
      accountCache.clear();
      if (showProgress) {
        const total = Number(result?.processed || 0);
        setProgress(100, `账号密码迁移完成（${total} / ${total}）`);
        setListProgress('teacher', result?.teacherProcessed, result?.teacherProcessed, '无需迁移', '迁移');
        setListProgress('student', result?.studentProcessed, result?.studentProcessed, '无需迁移', '迁移');
        await new Promise((resolve) => setTimeout(resolve, 350));
        setProgress(100, '', false);
      }
      clearAccountInitQueryParameter();
      setAccountInitTitle('初始化登录账号列表');
      return result;
    } catch (error) {
      if (showProgress) setProgress(0, '账号密码迁移失败：' + String(error?.message || error));
      throw error;
    }
  }

  async function load() {
    await global.BjtuAccountStore.migrateLegacy();
    await ensureAdminQuickAccountStored();
    return global.BjtuAccountStore.count();
  }

  async function readLocalBindings() {
    const bindings = new Map();
    const previous = typeof global.BjtuAccountStore.getCredentialAccounts === 'function'
      ? await global.BjtuAccountStore.getCredentialAccounts()
      : await global.BjtuAccountStore.getQuickAccounts();
    previous.forEach((record) => {
      const loginName = String(record?.loginName || '').trim();
      if (!loginName) return;
      bindings.set(loginName, {
        password: String(record?.password || ''),
        passwordMd5: String(record?.passwordMd5 || '').trim(),
        quickUsername: String(record?.quickUsername || '').trim()
      });
    });
    return bindings;
  }

  async function readLocalAccountState() {
    const existingAccounts = typeof global.BjtuAccountStore.getAccountStates === 'function'
      ? await global.BjtuAccountStore.getAccountStates()
      : new Map((await global.BjtuAccountStore.getAll()).map((record) => [String(record?.loginName || '').trim(), record]));
    const bindings = new Map();
    existingAccounts.forEach((record, loginName) => {
      const password = String(record?.password || '');
      const passwordMd5 = String(record?.passwordMd5 || '').trim();
      const quickUsername = String(record?.quickUsername || '').trim();
      if (password || passwordMd5 || quickUsername) bindings.set(loginName, { password, passwordMd5, quickUsername });
    });
    const existingQuickLoginNames = new Set(
      [...existingAccounts.entries()]
        .filter(([, record]) => !!String(record?.quickUsername || '').trim())
        .map(([loginName]) => loginName)
    );
    return { bindings, existingAccounts, existingQuickLoginNames };
  }

  function preserveLocalBindings(next, bindings, { preferExisting = false } = {}) {
    Object.keys(next || {}).forEach((loginName) => {
      const current = bindings?.get(loginName);
      if (!current) return;
      if (current.quickUsername && (preferExisting || !next[loginName].quickUsername)) {
        next[loginName].quickUsername = current.quickUsername;
      }
      if (current.password && (preferExisting || !next[loginName].password)) {
        next[loginName].password = current.password;
      }
      if (current.passwordMd5 && (preferExisting || !next[loginName].passwordMd5)) {
        next[loginName].passwordMd5 = current.passwordMd5;
      }
    });
  }

  function accountRecordsEqual(left, right) {
    if (!left || !right) return false;
    if (String(left?.password || '') !== String(right?.password || '')) return false;
    return ['loginName', 'roleName', 'userName', 'passwordMd5', 'quickUsername'].every((key) => (
      String(left?.[key] || '').trim() === String(right?.[key] || '').trim()
    ));
  }

  function selectChangedAccounts(accounts, existingAccounts) {
    const changed = Object.create(null);
    Object.entries(accounts || {}).forEach(([loginName, record]) => {
      if (!accountRecordsEqual(record, existingAccounts?.get(loginName))) changed[loginName] = record;
    });
    return changed;
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
    const fileVersion = Number(payload?.version || 0);
    if (!payload || payload.format !== ACCOUNT_FILE_FORMAT || ![1, ACCOUNT_FILE_VERSION].includes(fileVersion)) {
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
      const password = fileVersion >= 2 ? String(value.password || '') : '';
      const passwordMd5 = String(fileVersion >= 2
        ? (value.passwordMd5 || value.passwordMD5 || '')
        : (value.password || value.passwordMd5 || value.passwordMD5 || '')).trim().toLowerCase();
      if (!loginName || loginName.length > 128) throw new Error('第 ' + (index + 1) + ' 条账号缺少有效账号');
      if (Object.prototype.hasOwnProperty.call(accounts, loginName)) {
        throw new Error('文件中存在重复账号：' + loginName);
      }
      if (password.length > 256 || /[\u0000-\u001f\u007f]/u.test(password)) {
        throw new Error('账号 ' + loginName + ' 的密码原文无效');
      }
      if (passwordMd5 && !/^[0-9a-f]{32}$/.test(passwordMd5)) {
        throw new Error('账号 ' + loginName + ' 的密码 MD5 无效');
      }
      accounts[loginName] = {
        loginName,
        roleName: String(value.roleName || '').trim().slice(0, 256),
        userName: String(value.userName || '').trim().slice(0, 256),
        password,
        passwordMd5,
        quickUsername: String(value.quickUsername || '').trim()
      };
    });
    return normalizeAdminAccountEntries(accounts);
  }

  async function importAccountFile(source, { showProgress = false } = {}) {
    if (showProgress) {
      setProgress(0, '正在准备导入账号列表…');
      setListProgress('teacher', 0, 0, '正在等待');
      setListProgress('student', 0, 0, '正在等待');
    }
    const accounts = parseAccountFile(source);
    await ensureAdminQuickAccountStored();
    const { bindings: localBindings, existingAccounts } = await readLocalAccountState();
    preserveLocalBindings(accounts, localBindings);
    if (accounts[ADMIN_LOGIN_NAME]) {
      accounts[ADMIN_LOGIN_NAME].userName = ADMIN_USER_NAME;
      accounts[ADMIN_LOGIN_NAME].quickUsername = ADMIN_QUICK_USERNAME;
    }
    const changedAccounts = selectChangedAccounts(accounts, existingAccounts);
    const importedLoginNames = new Set(Object.keys(accounts));
    importedLoginNames.add(ADMIN_LOGIN_NAME);
    const removedLoginNames = [...existingAccounts.keys()]
      .filter((loginName) => !importedLoginNames.has(loginName));
    const total = Object.keys(accounts).length;
    const changedTotal = Object.keys(changedAccounts).length;
    const changedTeacherTotal = Object.values(changedAccounts)
      .filter((record) => String(record?.roleName || '').trim() !== '学生').length;
    const changedStudentTotal = changedTotal - changedTeacherTotal;
    const releaseWritingLock = await acquireWritingLock();
    const marker = createWritingMarker();
    await chrome.storage.local.set({ [ACCOUNT_LIST_WRITING_KEY]: marker });
    const heartbeatTimer = startWritingHeartbeat(marker);
    try {
      if (showProgress) setProgress(0, '正在导入账号列表…');
      if (showProgress) {
        setListProgress('teacher', 0, changedTeacherTotal, changedTeacherTotal ? '正在写入' : '无需写入', '写入');
        setListProgress('student', 0, changedStudentTotal, changedStudentTotal ? '正在写入' : '无需写入', '写入');
      }
      if (changedTotal > 0) {
        await global.BjtuAccountStore.putAll(changedAccounts, (progress) => {
          if (!showProgress) return;
          setProgress(100, '正在导入账号列表变动…（' + Number(progress?.written || 0) + ' / ' + changedTotal + '）');
          setListProgress('teacher', progress?.teacherWritten, changedTeacherTotal, '正在写入', '写入', progress?.teacherCurrentPrefixes);
          setListProgress('student', progress?.studentWritten, changedStudentTotal, '正在写入', '写入', progress?.studentCurrentPrefixes);
        }, { preserveExistingCredentials: false });
      }
      if (removedLoginNames.length && typeof global.BjtuAccountStore.deleteMany === 'function') {
        await global.BjtuAccountStore.deleteMany(removedLoginNames, (progress) => {
          if (!showProgress) return;
          setProgress(100, `正在清理导入文件中不存在的账号…（${Number(progress?.deleted || 0)} / ${Number(progress?.total || 0)}）`);
        });
      }
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
      const importActions = document.getElementById('account-init-import-actions');
      const remote = document.getElementById('account-init-remote');
      const importButton = document.getElementById('account-init-import');
      const skipButton = document.getElementById('account-init-skip');
      const importLocalButton = document.getElementById('account-init-import-local');
      const importRemoteButton = document.getElementById('account-init-import-remote');
      const importBackButton = document.getElementById('account-init-import-back');
      const fileInput = document.getElementById('account-init-file');
      const fetchOptions = document.getElementById('account-init-fetch-options');
      const teacherCheckbox = document.getElementById('account-init-fetch-teachers');
      const studentCheckbox = document.getElementById('account-init-fetch-students');
      const quickOption = document.getElementById('account-init-quick-option');
      const quickCheckbox = document.getElementById('account-init-fetch-quick-usernames');
      if (!(actions instanceof HTMLElement) || !(fileInput instanceof HTMLInputElement)) {
        resolve({ source: 'skip' });
        return;
      }
      const cleanup = () => {
        importButton?.removeEventListener('click', onImport);
        skipButton?.removeEventListener('click', onSkip);
        importLocalButton?.removeEventListener('click', onImportLocal);
        importRemoteButton?.removeEventListener('click', onImportRemote);
        importBackButton?.removeEventListener('click', onImportBack);
        fileInput.removeEventListener('change', onFile);
        actions.style.display = 'none';
        if (importActions instanceof HTMLElement) importActions.style.display = 'none';
        if (fetchOptions instanceof HTMLElement) fetchOptions.style.display = 'none';
        if (quickOption instanceof HTMLElement) quickOption.style.display = 'none';
      };
      const setImportButtonsDisabled = (disabled) => {
        [importLocalButton, importRemoteButton, importBackButton].forEach((button) => {
          if (button instanceof HTMLButtonElement) button.disabled = disabled;
        });
      };
      const showMainActions = () => {
        actions.style.display = 'flex';
        if (importActions instanceof HTMLElement) importActions.style.display = 'none';
        if (fetchOptions instanceof HTMLElement) fetchOptions.style.display = 'none';
        if (quickOption instanceof HTMLElement) quickOption.style.display = 'none';
        setAccountImportDownloadProgress({ visible: false });
        setProgress(0, '请选择账号列表初始化方式');
      };
      const showImportActions = (status = '请选择账号列表导入方式') => {
        actions.style.display = 'none';
        if (importActions instanceof HTMLElement) importActions.style.display = 'flex';
        if (fetchOptions instanceof HTMLElement) fetchOptions.style.display = 'none';
        if (quickOption instanceof HTMLElement) quickOption.style.display = 'none';
        setImportButtonsDisabled(false);
        setAccountImportDownloadProgress({ visible: false });
        setProgress(0, status);
      };
      const onImport = () => {
        showImportActions();
      };
      const onImportLocal = () => {
        fileInput.value = '';
        fileInput.click();
      };
      const finishImport = async (sourceText) => {
        actions.style.display = 'none';
        if (importActions instanceof HTMLElement) importActions.style.display = 'none';
        setAccountImportDownloadProgress({ visible: false });
        const count = await importAccountFile(sourceText, { showProgress: true });
        cleanup();
        setProgress(100, '', false);
        resolve({ source: 'import', count });
      };
      const onImportRemote = async () => {
        try {
          setImportButtonsDisabled(true);
          setAccountImportDownloadProgress({ loaded: 0, visible: true });
          setProgress(0, '正在从远程仓库下载账号列表…');
          const response = await fetch(REMOTE_ACCOUNT_LIST_URL, { cache: 'no-store', credentials: 'omit' });
          if (!response.ok) throw new Error('远程仓库返回 HTTP ' + response.status);
          await finishImport(await readAccountImportResponseText(response));
        } catch (error) {
          setImportButtonsDisabled(false);
          showImportActions('远程导入失败：' + String(error?.message || error));
        }
      };
      const onImportBack = () => {
        showMainActions();
      };
      const onSkip = () => {
        cleanup();
        clearAccountInitQueryParameter();
        resolve({ source: 'skip' });
      };
      const onFile = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          setImportButtonsDisabled(true);
          await finishImport(await file.text());
        } catch (error) {
          setImportButtonsDisabled(false);
          showImportActions('导入失败：' + String(error?.message || error));
        }
      };
      if (remote instanceof HTMLButtonElement) {
        remote.disabled = true;
        remote.title = '从平台获取账号列表暂不可用，请使用导入 JSON';
      }
      importButton?.addEventListener('click', onImport);
      skipButton?.addEventListener('click', onSkip);
      importLocalButton?.addEventListener('click', onImportLocal);
      importRemoteButton?.addEventListener('click', onImportRemote);
      importBackButton?.addEventListener('click', onImportBack);
      fileInput.addEventListener('change', onFile);
      if (teacherCheckbox instanceof HTMLInputElement) teacherCheckbox.checked = true;
      if (studentCheckbox instanceof HTMLInputElement) studentCheckbox.checked = true;
      if (quickCheckbox instanceof HTMLInputElement) quickCheckbox.checked = false;
      showMainActions();
    });
  }

  async function syncHistoryWithAccountList() {
    const stored = await chrome.storage.local.get([HISTORY_KEY]);
    const history = Array.isArray(stored?.[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    const updated = history.map((record) => {
      const rawLoginName = String(record?.loginName || record?.userId || '').trim();
      const loginName = rawLoginName.toLowerCase() === 'admin' ? ADMIN_LOGIN_NAME : rawLoginName;
      return {
        loginName,
        lastLoginAt: Number(record?.lastLoginAt || 0) || 0
      };
    })
      .filter((record) => record.loginName)
      .sort((a, b) => b.lastLoginAt - a.lastLoginAt)
      .filter((record, index, records) => records.findIndex((candidate) => (
        candidate.loginName.toLowerCase() === record.loginName.toLowerCase()
      )) === index);
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
    setAccountInitTitle('初始化登录账号列表');
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
        if (!isAdminLoginName(currentUser?.loginName)) {
          if (showProgress) setProgress(1, '正在快速登录管理员账号…');
          const adminResult = await loginAdminWithQuickUsername();
          if (!adminResult.ok) throw new Error(adminResult.message || '管理员账号快速登录失败');
          const adminUser = await getCurrentUserInfo();
          if (!isAdminLoginName(adminUser?.loginName)) {
            throw new Error('管理员账号快速登录后身份验证失败');
          }
        }

        const state = {
          teacher: { parsed: 0, quickProcessed: 0, quickTotal: 0, written: 0, writeTotal: 0, total: 0, phase: shouldFetchTeachers ? 'load' : 'skipped', currentPrefixes: [] },
          student: { parsed: 0, quickProcessed: 0, quickTotal: 0, written: 0, writeTotal: 0, total: 0, phase: shouldFetchStudents ? 'load' : 'skipped', currentPrefixes: [] }
        };
        const { bindings: localBindings, existingAccounts, existingQuickLoginNames } = await readLocalAccountState();
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
            if (roleState.phase === 'done' && roleState.writeTotal === 0) {
              setListProgress(type, 0, 0, '无需写入', '写入');
              return;
            }
            setListProgress(
              type,
              isWriting ? roleState.written : (isFetchingQuick ? roleState.quickProcessed : roleState.parsed),
              isWriting ? roleState.writeTotal : (isFetchingQuick ? roleState.quickTotal : roleState.total),
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
            await enrichQuickUsernames(parser.result, state.teacher, updateProgress, existingQuickLoginNames);
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
            await enrichQuickUsernames(parser.result, state.student, updateProgress, existingQuickLoginNames);
          }
          return parser.result;
        };

        const writeRole = (type, accounts) => {
          normalizeAdminAccountEntries(accounts);
          preserveLocalBindings(accounts, localBindings, { preferExisting: true });
          const changedAccounts = selectChangedAccounts(accounts, existingAccounts);
          const total = Object.keys(changedAccounts).length;
          state[type].phase = 'write';
          state[type].written = 0;
          state[type].writeTotal = total;
          state[type].currentPrefixes = [];
          updateProgress();
          if (total === 0) {
            state[type].phase = 'done';
            updateProgress();
            return Promise.resolve();
          }
          writeQueue = writeQueue.then(async () => {
            await global.BjtuAccountStore.putAll(changedAccounts, (progress) => {
              if (!showProgress) return;
              setProgress(100, '正在获取并写入账号列表…');
              const written = type === 'teacher' ? progress?.teacherWritten : progress?.studentWritten;
              state[type].written = Number(written || 0);
              const prefixes = type === 'teacher' ? progress?.teacherCurrentPrefixes : progress?.studentCurrentPrefixes;
              state[type].currentPrefixes = Array.isArray(prefixes) ? prefixes : [];
              setListProgress(type, state[type].written, total, '正在写入', '写入', state[type].currentPrefixes);
            }, { preserveExistingCredentials: false });
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

        const completeTeacherList = shouldFetchTeachers
          && Object.keys(teachers).length === state.teacher.total;
        const completeStudentList = shouldFetchStudents
          && Object.keys(students).length === state.student.total;
        if (completeTeacherList && completeStudentList) {
          const currentLoginNames = new Set(Object.keys(next));
          currentLoginNames.add(ADMIN_LOGIN_NAME);
          const removedLoginNames = [...existingAccounts.keys()]
            .filter((loginName) => !currentLoginNames.has(loginName));
          if (removedLoginNames.length && typeof global.BjtuAccountStore.deleteMany === 'function') {
            await global.BjtuAccountStore.deleteMany(removedLoginNames, (progress) => {
              if (!showProgress) return;
              setProgress(100, `正在清理已不存在账号…（${Number(progress?.deleted || 0)} / ${Number(progress?.total || 0)}）`);
            });
          }
        }

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
    const value = String(password || '');
    if (!id || !value) return null;
    await load();
    const record = await global.BjtuAccountStore.update(id, { password: value });
    if (record) accountCache.set(id, record);
    return record ? { loginName: id, ...record } : null;
  }

  async function loginWithPassword(loginName, password, { signal, passcode = '', passwordPlain = '' } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const response = await sendRuntimeMessage({
      type: 'VE_LOGIN_WITH_PASSWORD',
      payload: { loginName, password, passwordPlain, passcode }
    });
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    return response;
  }

  async function loginWithQuickUsername(quickUsername, { signal, loginName = '' } = {}) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const response = await sendRuntimeMessage({
      type: 'VE_LOGIN_WITH_QUICK_USERNAME',
      payload: { quickUsername, loginName }
    });
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    return response;
  }

  async function login(loginName, options = {}) {
    const signal = options?.signal;
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const response = await sendRuntimeMessage({
      type: 'VE_LOGIN_REQUEST',
      payload: {
        loginName,
        passwordEncoded: options?.password,
        passwordPlain: options?.passwordPlain,
        passcode: options?.passcode,
        skipCurrentCheck: options?.skipCurrentCheck,
        allowStoredCredentials: options?.allowStoredCredentials
      }
    });
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    return response;
  }

  async function getCaptchaImageDataUrl() {
    const response = await sendRuntimeMessage({ type: 'VE_LOGIN_GET_CAPTCHA' });
    if (!response?.ok || !response.imageUrl) throw new Error(response?.message || '验证码图片获取失败');
    return response.imageUrl;
  }

  async function recognizeCaptchaImageDataUrl(imageUrl) {
    const response = await sendRuntimeMessage({
      type: 'VE_LOGIN_RECOGNIZE_CAPTCHA',
      payload: { imageUrl }
    });
    if (!response?.ok || !/^\d{4}$/.test(String(response.passcode || ''))) {
      if (response?.code === 'captcha-resources-missing') {
        const suffix = new URLSearchParams(String(location.search || '')).get('popup') === '1'
          ? '?popup=1'
          : '';
        const optionsUrl = chrome.runtime.getURL(`options/options.html${suffix}`);
        location.href = optionsUrl;
      }
      throw new Error(response?.message || '验证码本地识别失败');
    }
    return String(response.passcode);
  }

  function requestRecovery(loginName, message, options = {}) {
    return global.BjtuVeLoginCredentialsDialog.open({
      modal: document.getElementById('account-recovery-modal'),
      message: document.getElementById('account-recovery-message'),
      choice: document.getElementById('account-recovery-choice'),
      manual: document.getElementById('account-recovery-manual'),
      plainInput: document.getElementById('account-recovery-password-plain'),
      encryptedInput: document.getElementById('account-recovery-password-md5'),
      captchaWrap: document.getElementById('account-recovery-captcha'),
      captchaImage: document.getElementById('account-recovery-captcha-image'),
      passcodeInput: document.getElementById('account-recovery-passcode'),
      buttons: {
        reinitialize: document.getElementById('account-recovery-reinitialize'),
        manual: document.getElementById('account-recovery-manual-btn'),
        cancel: document.getElementById('account-recovery-cancel'),
        fillDefault: document.getElementById('account-recovery-default'),
        submit: document.getElementById('account-recovery-submit'),
        manualCancel: document.getElementById('account-recovery-manual-cancel')
      },
      loginName,
      messageText: message,
      requireCaptcha: options?.requireCaptcha === true,
      startManual: options?.startManual === true,
      fallbackPassword: options?.fallbackPassword,
      initialCaptchaUrl: options?.captchaImageUrl,
      loadCaptcha: getCaptchaImageDataUrl,
      recognizeCaptcha: recognizeCaptchaImageDataUrl,
      encryptPassword: (plain) => typeof global.strEnc === 'function' ? global.strEnc(plain) : ''
    });
  }

  global.BjtuAccountLogin = {
    load,
    initialize,
    migratePasswords,
    ensureInitialized: (options = {}) => initialize({ ...options, force: false }),
    getCurrentUserInfo,
    ensureCurrentAccountStored,
    getAccount,
    updateQuickUsername,
    updatePassword,
    importAccountFile,
    exportAccountFile,
    loginWithPassword,
    loginWithQuickUsername,
    login,
    getCaptchaImageDataUrl,
    recognizeCaptchaImageDataUrl,
    requestRecovery
  };

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes?.[ACCOUNT_LIST_REVISION_KEY]) accountCache.clear();
  });

})(globalThis);
