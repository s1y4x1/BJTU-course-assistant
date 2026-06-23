(function initBjtuAccountStore(global) {
  'use strict';

  const DB_NAME = 'bjtu-course-assistant';
  const DB_VERSION = 2;
  const STORE_NAME = 'accounts';
  const LEGACY_KEY = 'accountList';
  const WRITE_BATCH_SIZE = 1000;
  const WRITE_PROGRESS_STEP = 1000;
  let dbPromise = null;

  function normalize(loginName, value) {
    const id = String(loginName || value?.loginName || '').trim();
    if (!id || !value || typeof value !== 'object') return null;
    return {
      loginName: id,
      roleName: String(value.roleName || '').trim(),
      userName: String(value.userName || '').trim(),
      password: String(value.password || value.passwordMd5 || '').trim(),
      quickUsername: String(value.quickUsername || value.username || '').trim()
    };
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'loginName' });
        if (!store.indexNames.contains('quickUsername')) {
          store.createIndex('quickUsername', 'quickUsername', { unique: false });
        }
        if (!store.indexNames.contains('userName')) {
          store.createIndex('userName', 'userName', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('无法打开账号数据库'));
      };
    });
    return dbPromise;
  }

  async function get(loginName) {
    const id = String(loginName || '').trim();
    if (!id) return null;
    const db = await open();
    const value = await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).get(id));
    return normalize(id, value);
  }

  async function count() {
    const db = await open();
    return Number(await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).count()) || 0);
  }

  async function getAll(onProgress = null) {
    const db = await open();
    if (typeof onProgress !== 'function') {
      const values = await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll());
      return values.map((value) => normalize(value?.loginName, value)).filter(Boolean);
    }
    const total = await count();
    const transaction = db.transaction(STORE_NAME);
    const store = transaction.objectStore(STORE_NAME);
    const rows = [];
    let read = 0;
    let teacherRead = 0;
    let studentRead = 0;
    const reportProgress = () => onProgress({
      read,
      total,
      teacherRead,
      studentRead
    });
    reportProgress();
    const done = transactionDone(transaction);
    await new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error || new Error('账号列表读取失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          reportProgress();
          resolve();
          return;
        }
        const record = normalize(cursor.value?.loginName, cursor.value);
        if (record) {
          rows.push(record);
          read += 1;
          if (record.roleName === '学生') studentRead += 1;
          else teacherRead += 1;
          if (read % WRITE_PROGRESS_STEP === 0) reportProgress();
        }
        cursor.continue();
      };
    });
    await done;
    return rows;
  }

  async function put(value) {
    const record = normalize(value?.loginName, value);
    if (!record) return null;
    const db = await open();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
    return record;
  }

  async function update(loginName, patch) {
    const id = String(loginName || '').trim();
    const current = await get(id);
    if (!current) return null;
    return put({ ...current, ...patch, loginName: id });
  }

  async function getQuickAccounts() {
    const db = await open();
    const transaction = db.transaction(STORE_NAME);
    const index = transaction.objectStore(STORE_NAME).index('quickUsername');
    const values = await requestResult(index.getAll(IDBKeyRange.lowerBound('', true)));
    return values.map((value) => normalize(value?.loginName, value)).filter(Boolean);
  }

  async function search({ loginName = '', userName = '', limit = 100 } = {}) {
    const loginQuery = String(loginName || '').trim();
    const nameQuery = String(userName || '').trim();
    if (!loginQuery && !nameQuery) return { accounts: [], hasMore: false };
    const maxItems = Math.max(1, Math.min(200000, Number(limit) || 100));
    const db = await open();
    const transaction = db.transaction(STORE_NAME);
    const store = transaction.objectStore(STORE_NAME);
    const source = loginQuery ? store : store.index('userName');
    const query = loginQuery || nameQuery;
    const range = IDBKeyRange.bound(query, query + '\uffff');
    return new Promise((resolve, reject) => {
      const rows = [];
      const request = source.openCursor(range);
      request.onerror = () => reject(request.error || new Error('账号搜索失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve({ accounts: rows, hasMore: false });
          return;
        }
        const record = normalize(cursor.value?.loginName, cursor.value);
        const matchesLogin = !loginQuery || String(record?.loginName || '').startsWith(loginQuery);
        const matchesName = !nameQuery || String(record?.userName || '').includes(nameQuery);
        if (record && matchesLogin && matchesName) rows.push(record);
        if (rows.length > maxItems) {
          resolve({ accounts: rows.slice(0, maxItems), hasMore: true });
          return;
        }
        cursor.continue();
      };
    });
  }

  async function replaceAll(source, onProgress = null) {
    await clear();
    return putAll(source, onProgress);
  }

  async function clear() {
    const db = await open();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
  }

  function longestCommonPrefix(values) {
    const rows = values.map((value) => String(value || '').trim()).filter(Boolean);
    if (!rows.length) return '';
    let prefix = rows[0];
    for (let i = 1; i < rows.length && prefix; i += 1) {
      const current = rows[i];
      let index = 0;
      const limit = Math.min(prefix.length, current.length);
      while (index < limit && prefix[index] === current[index]) index += 1;
      prefix = prefix.slice(0, index);
    }
    return prefix;
  }

  function formatCommonPrefix(prefix, values) {
    if (!prefix) return '';
    const length = String(values[0] || '').trim().length;
    const hiddenLength = Math.max(0, length - prefix.length);
    return hiddenLength > 0 ? prefix + 'x'.repeat(hiddenLength) : prefix;
  }

  function prefixesForSameLength(values) {
    const rows = values.map((value) => String(value || '').trim()).filter(Boolean);
    const common = longestCommonPrefix(rows);
    if (common) return [formatCommonPrefix(common, rows)];
    const groups = new Map();
    rows.forEach((value) => {
      const first = value[0] || '';
      if (!first) return;
      if (!groups.has(first)) groups.set(first, []);
      groups.get(first).push(value);
    });
    return [...groups.values()].map((group) => {
      const prefix = longestCommonPrefix(group) || String(group[0] || '').slice(0, 1);
      return formatCommonPrefix(prefix, group);
    });
  }

  function currentLoginPrefixes(values) {
    const rows = values.map((value) => String(value || '').trim()).filter(Boolean);
    if (!rows.length) return [];
    const lengthGroups = new Map();
    rows.forEach((value) => {
      const length = value.length;
      if (!lengthGroups.has(length)) lengthGroups.set(length, []);
      lengthGroups.get(length).push(value);
    });
    return [...lengthGroups.keys()]
      .sort((a, b) => a - b)
      .flatMap((length) => prefixesForSameLength(lengthGroups.get(length)));
  }

  function sortedPrefixes(prefixes) {
    return [...new Set(prefixes)].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  async function putAll(source, onProgress = null) {
    const isArray = Array.isArray(source);
    const safeSource = source && typeof source === 'object' ? source : {};
    const keys = isArray ? safeSource.map((_value, index) => index) : Object.keys(safeSource);
    let teacherTotal = 0;
    let studentTotal = 0;
    keys.forEach((key) => {
      const value = safeSource[key];
      if (String(value?.roleName || '').trim() === '学生') studentTotal += 1;
      else teacherTotal += 1;
    });
    const db = await open();
    let transaction;
    let storedCount = 0;
    let teacherWritten = 0;
    let studentWritten = 0;
    const teacherCurrentLogins = [];
    const studentCurrentLogins = [];
    const reportProgress = ({ clearCurrent = true } = {}) => {
      if (typeof onProgress !== 'function') return;
      const currentTeacherPrefixes = sortedPrefixes(currentLoginPrefixes(teacherCurrentLogins));
      const currentStudentPrefixes = sortedPrefixes(currentLoginPrefixes(studentCurrentLogins));
      onProgress({
        written: storedCount,
        total: keys.length,
        teacherWritten,
        teacherTotal,
        studentWritten,
        studentTotal,
        currentPrefixes: sortedPrefixes([...currentTeacherPrefixes, ...currentStudentPrefixes]),
        teacherCurrentPrefixes: currentTeacherPrefixes,
        studentCurrentPrefixes: currentStudentPrefixes
      });
      if (clearCurrent) {
        teacherCurrentLogins.length = 0;
        studentCurrentLogins.length = 0;
      }
    };
    reportProgress();
    for (let offset = 0; offset < keys.length; offset += WRITE_BATCH_SIZE) {
      transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      keys.slice(offset, offset + WRITE_BATCH_SIZE).forEach((key) => {
        const value = safeSource[key];
        const record = normalize(isArray ? value?.loginName : key, value);
        if (!record) return;
        store.put(record);
        storedCount += 1;
        if (record.roleName === '学生') {
          studentWritten += 1;
          studentCurrentLogins.push(record.loginName);
        } else {
          teacherWritten += 1;
          teacherCurrentLogins.push(record.loginName);
        }
        if (storedCount % WRITE_PROGRESS_STEP === 0) reportProgress();
      });
      await transactionDone(transaction);
      reportProgress();
    }
    return storedCount;
  }

  async function migrateLegacy() {
    const stored = await chrome.storage.local.get([LEGACY_KEY]);
    const legacy = stored?.[LEGACY_KEY];
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return 0;
    const existingCount = await count();
    const migrated = existingCount > 0 ? 0 : await replaceAll(legacy);
    await chrome.storage.local.remove([LEGACY_KEY]);
    return migrated;
  }

  global.BjtuAccountStore = {
    get,
    getAll,
    count,
    put,
    update,
    search,
    getQuickAccounts,
    clear,
    putAll,
    replaceAll,
    migrateLegacy
  };
})(globalThis);
