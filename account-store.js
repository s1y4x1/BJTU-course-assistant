(function initBjtuAccountStore(global) {
  'use strict';

  const DB_NAME = 'bjtu-course-assistant';
  const DB_VERSION = 2;
  const STORE_NAME = 'accounts';
  const LEGACY_KEY = 'accountList';
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
    let transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
    let storedCount = 0;
    let teacherWritten = 0;
    let studentWritten = 0;
    const reportProgress = () => {
      if (typeof onProgress !== 'function') return;
      onProgress({
        written: storedCount,
        total: keys.length,
        teacherWritten,
        teacherTotal,
        studentWritten,
        studentTotal
      });
    };
    reportProgress();
    for (let offset = 0; offset < keys.length; offset += 2000) {
      transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      keys.slice(offset, offset + 2000).forEach((key) => {
        const value = safeSource[key];
        const record = normalize(isArray ? value?.loginName : key, value);
        if (!record) return;
        store.put(record);
        storedCount += 1;
        if (record.roleName === '学生') studentWritten += 1;
        else teacherWritten += 1;
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
    count,
    put,
    update,
    search,
    getQuickAccounts,
    replaceAll,
    migrateLegacy
  };
})(globalThis);
