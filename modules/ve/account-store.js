(function initBjtuAccountStore(global) {
  'use strict';

  const DB_NAME = 'bjtu-course-assistant';
  const DB_VERSION = 5;
  const STORE_NAME = 'accounts';
  const LEGACY_KEY = 'accountList';
  const LEGACY_MIGRATION_LOCK = 'bjtu-account-store-legacy-migration';
  const PASSWORD_MIGRATION_LOCK = 'bjtu-account-password-field-migration';
  const PASSWORD_MIGRATION_STATE_KEY = 'accountPasswordFieldMigration';
  const PASSWORD_MIGRATION_BATCH_SIZE = 1000;
  const WRITE_BATCH_SIZE = 1000;
  const READ_PROGRESS_STEP = 1000;
  const WRITE_PROGRESS_STEP = 1000;
  let dbPromise = null;
  let legacyMigrationPromise = null;
  let legacyMigrationCompleted = false;
  let passwordMigrationPromise = null;

  function normalize(loginName, value) {
    const id = String(loginName || value?.loginName || '').trim();
    if (!id || !value || typeof value !== 'object') return null;
    const migrated = Object.prototype.hasOwnProperty.call(value, 'passwordMd5')
      || Object.prototype.hasOwnProperty.call(value, 'passwordMD5');
    return {
      loginName: id,
      roleName: String(value.roleName || '').trim(),
      userName: String(value.userName || '').trim(),
      password: migrated ? String(value.password || '') : '',
      passwordMd5: String(migrated
        ? (value.passwordMd5 || value.passwordMD5 || '')
        : (value.password || '')).trim(),
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
      request.onupgradeneeded = (event) => {
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
        if (!store.indexNames.contains('roleName')) {
          store.createIndex('roleName', 'roleName', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('无法打开账号数据库'));
      };
    });
    return dbPromise;
  }

  function migratePasswordFieldBatch(db, afterKey = null) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const range = afterKey == null ? null : IDBKeyRange.lowerBound(afterKey, true);
      const request = store.openCursor(range);
      let scanned = 0;
      let teacherScanned = 0;
      let studentScanned = 0;
      const teacherLogins = [];
      const studentLogins = [];
      let lastKey = afterKey;
      let hasMore = false;
      request.onerror = () => reject(request.error || new Error('密码字段迁移读取失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (scanned >= PASSWORD_MIGRATION_BATCH_SIZE) {
          hasMore = true;
          return;
        }
        const value = cursor.value && typeof cursor.value === 'object' ? cursor.value : {};
        if (!Object.prototype.hasOwnProperty.call(value, 'passwordMd5')
            && !Object.prototype.hasOwnProperty.call(value, 'passwordMD5')) {
          cursor.update({
            ...value,
            password: '',
            passwordMd5: String(value.password || '').trim()
          });
        }
        scanned += 1;
        const loginName = String(value.loginName || cursor.primaryKey || '').trim();
        if (String(value.roleName || '').trim() === '学生') {
          studentScanned += 1;
          if (loginName) studentLogins.push(loginName);
        } else {
          teacherScanned += 1;
          if (loginName) teacherLogins.push(loginName);
        }
        lastKey = cursor.primaryKey;
        cursor.continue();
      };
      transaction.oncomplete = () => resolve({
        scanned,
        teacherScanned,
        studentScanned,
        teacherCurrentPrefixes: currentLoginPrefixes(teacherLogins),
        studentCurrentPrefixes: currentLoginPrefixes(studentLogins),
        lastKey,
        hasMore
      });
      transaction.onerror = () => reject(transaction.error || new Error('密码字段迁移失败'));
      transaction.onabort = () => reject(transaction.error || new Error('密码字段迁移已中止'));
    });
  }

  async function findUnmigratedPasswordRecord() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).openCursor();
      request.onerror = () => reject(request.error || new Error('密码字段迁移检测失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(false);
          return;
        }
        const value = cursor.value && typeof cursor.value === 'object' ? cursor.value : {};
        if (!Object.prototype.hasOwnProperty.call(value, 'passwordMd5')
            && !Object.prototype.hasOwnProperty.call(value, 'passwordMD5')) {
          resolve(true);
          return;
        }
        cursor.continue();
      };
    });
  }

  async function needsPasswordFieldMigration() {
    const stored = await chrome.storage.local.get([PASSWORD_MIGRATION_STATE_KEY]).catch(() => ({}));
    const state = stored?.[PASSWORD_MIGRATION_STATE_KEY];
    if (state?.complete === true) return false;
    if (state?.schemaVersion === 2) return true;
    const required = await findUnmigratedPasswordRecord();
    if (!required) {
      await chrome.storage.local.set({
        [PASSWORD_MIGRATION_STATE_KEY]: { schemaVersion: 2, complete: true, processed: 0, completedAt: Date.now() }
      });
    }
    return required;
  }

  async function runPasswordFieldMigration(onProgress = null) {
    const stored = await chrome.storage.local.get([PASSWORD_MIGRATION_STATE_KEY]).catch(() => ({}));
    let state = stored?.[PASSWORD_MIGRATION_STATE_KEY];
    if (state?.complete === true) return state;
    if (state?.schemaVersion !== 2) state = null;
    const totals = await countByRole();
    let lastKey = state?.lastKey ?? null;
    let processed = Number(state?.processed || 0);
    let teacherProcessed = Number(state?.teacherProcessed || 0);
    let studentProcessed = Number(state?.studentProcessed || 0);
    const db = await open();
    const report = (extra = {}) => {
      if (typeof onProgress !== 'function') return;
      onProgress({
        processed,
        total: totals.total,
        teacherProcessed,
        teacherTotal: totals.teacher,
        studentProcessed,
        studentTotal: totals.student,
        ...extra
      });
    };
    report();
    while (true) {
      const batch = await migratePasswordFieldBatch(db, lastKey);
      processed += Number(batch.scanned || 0);
      teacherProcessed += Number(batch.teacherScanned || 0);
      studentProcessed += Number(batch.studentScanned || 0);
      report({
        teacherCurrentPrefixes: batch.teacherCurrentPrefixes,
        studentCurrentPrefixes: batch.studentCurrentPrefixes
      });
      if (!batch.hasMore) {
        const completed = {
          schemaVersion: 2,
          complete: true,
          processed,
          teacherProcessed,
          studentProcessed,
          completedAt: Date.now()
        };
        await chrome.storage.local.set({
          [PASSWORD_MIGRATION_STATE_KEY]: completed
        });
        return completed;
      }
      lastKey = batch.lastKey;
      await chrome.storage.local.set({
        [PASSWORD_MIGRATION_STATE_KEY]: {
          schemaVersion: 2,
          complete: false,
          processed,
          teacherProcessed,
          studentProcessed,
          lastKey,
          updatedAt: Date.now()
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  async function migratePasswordFields(onProgress = null) {
    if (passwordMigrationPromise) return passwordMigrationPromise;
    const run = () => runPasswordFieldMigration(onProgress);
    passwordMigrationPromise = global.navigator?.locks?.request
      ? global.navigator.locks.request(PASSWORD_MIGRATION_LOCK, run)
      : run();
    try {
      return await passwordMigrationPromise;
    } finally {
      passwordMigrationPromise = null;
    }
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

  async function countByRole() {
    const db = await open();
    const transaction = db.transaction(STORE_NAME);
    const store = transaction.objectStore(STORE_NAME);
    const [total, student] = await Promise.all([
      requestResult(store.count()),
      requestResult(store.index('roleName').count('学生'))
    ]);
    const normalizedTotal = Number(total || 0);
    const normalizedStudent = Number(student || 0);
    return {
      total: normalizedTotal,
      student: normalizedStudent,
      teacher: Math.max(0, normalizedTotal - normalizedStudent)
    };
  }

  async function getAll(onProgress = null) {
    const db = await open();
    if (typeof onProgress !== 'function') {
      const values = await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll());
      return values.map((value) => normalize(value?.loginName, value)).filter(Boolean);
    }
    const roleCounts = await countByRole();
    const total = roleCounts.total;
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
      studentRead,
      teacherTotal: roleCounts.teacher,
      studentTotal: roleCounts.student
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
          if (read % READ_PROGRESS_STEP === 0) reportProgress();
        }
        cursor.continue();
      };
    });
    await done;
    return rows;
  }

  async function put(value) {
    let record = normalize(value?.loginName, value);
    if (!record) return null;
    if (!record.password || !record.passwordMd5 || !record.quickUsername) {
      const current = await get(record.loginName);
      if (current) {
        record = {
          ...record,
          password: record.password || current.password,
          passwordMd5: record.passwordMd5 || current.passwordMd5,
          quickUsername: record.quickUsername || current.quickUsername
        };
      }
    }
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

  async function clearCredentials(loginName, fields = []) {
    const id = String(loginName || '').trim();
    const allowed = new Set(['password', 'passwordMd5', 'quickUsername']);
    const targets = [...new Set((Array.isArray(fields) ? fields : [fields])
      .map((field) => String(field || '').trim())
      .filter((field) => allowed.has(field)))];
    if (!id || !targets.length) return null;
    const current = await get(id);
    if (!current) return null;
    const record = { ...current, loginName: id };
    targets.forEach((field) => { record[field] = ''; });
    const db = await open();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(normalize(id, record));
    await transactionDone(transaction);
    return record;
  }

  async function getQuickAccounts({ limit = Number.POSITIVE_INFINITY, onProgress = null } = {}) {
    const db = await open();
    const transaction = db.transaction(STORE_NAME);
    const index = transaction.objectStore(STORE_NAME).index('quickUsername');
    const maxItems = Number.isFinite(Number(limit))
      ? Math.max(1, Math.floor(Number(limit)))
      : Number.POSITIVE_INFINITY;
    return new Promise((resolve, reject) => {
      const rows = [];
      const request = index.openCursor(IDBKeyRange.lowerBound('', true));
      request.onerror = () => reject(request.error || new Error('MIS 绑定账号读取失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          onProgress?.({ read: rows.length, limit: maxItems, done: true });
          resolve(rows);
          return;
        }
        const record = normalize(cursor.value?.loginName, cursor.value);
        if (record?.quickUsername) rows.push(record);
        onProgress?.({ read: rows.length, limit: maxItems, done: false });
        if (rows.length >= maxItems) {
          resolve(rows);
          return;
        }
        cursor.continue();
      };
    });
  }

  async function getCredentialAccounts() {
    const db = await open();
    const transaction = db.transaction(STORE_NAME);
    const store = transaction.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const rows = [];
      const request = store.openCursor();
      request.onerror = () => reject(request.error || new Error('账号凭据读取失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(rows);
          return;
        }
        const record = normalize(cursor.value?.loginName, cursor.value);
        if (record && (record.password || record.passwordMd5 || record.quickUsername)) rows.push(record);
        cursor.continue();
      };
    });
  }

  async function getAccountStates() {
    const db = await open();
    const transaction = db.transaction(STORE_NAME);
    const store = transaction.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const states = new Map();
      const request = store.openCursor();
      request.onerror = () => reject(request.error || new Error('账号状态读取失败'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(states);
          return;
        }
        const record = normalize(cursor.value?.loginName, cursor.value);
        if (record) states.set(record.loginName, record);
        cursor.continue();
      };
    });
  }

  async function deleteMany(loginNames, onProgress = null) {
    const rows = [...new Set((Array.isArray(loginNames) ? loginNames : [])
      .map((value) => String(value || '').trim()).filter(Boolean))];
    if (!rows.length) {
      onProgress?.({ deleted: 0, total: 0 });
      return 0;
    }
    const db = await open();
    let deleted = 0;
    onProgress?.({ deleted, total: rows.length });
    for (let offset = 0; offset < rows.length; offset += WRITE_BATCH_SIZE) {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const batch = rows.slice(offset, offset + WRITE_BATCH_SIZE);
      batch.forEach((loginName) => store.delete(loginName));
      await transactionDone(transaction);
      deleted += batch.length;
      onProgress?.({ deleted, total: rows.length });
    }
    return deleted;
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
    return hiddenLength > 0 ? prefix + '*'.repeat(hiddenLength) : prefix;
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

  async function putAll(source, onProgress = null, { preserveExistingCredentials = true } = {}) {
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
    const existingCredentials = new Map();
    if (preserveExistingCredentials) {
      try {
        const credentialRows = await getCredentialAccounts();
        credentialRows.forEach((row) => {
          const loginName = String(row?.loginName || '').trim();
          if (!loginName) return;
          existingCredentials.set(loginName, {
            password: String(row?.password || ''),
            passwordMd5: String(row?.passwordMd5 || '').trim(),
            quickUsername: String(row?.quickUsername || '').trim()
          });
        });
      } catch {
        // If reading existing credentials fails, continue with incoming data.
      }
    }
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
        let record = normalize(isArray ? value?.loginName : key, value);
        if (!record) return;
        const existing = existingCredentials.get(record.loginName);
        if (existing && (!record.password || !record.passwordMd5 || !record.quickUsername)) {
          record = {
            ...record,
            password: record.password || existing.password,
            passwordMd5: record.passwordMd5 || existing.passwordMd5,
            quickUsername: record.quickUsername || existing.quickUsername
          };
        }
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
    if (legacyMigrationCompleted) return 0;
    if (legacyMigrationPromise) return legacyMigrationPromise;
    const runMigration = async () => {
      const stored = await chrome.storage.local.get([LEGACY_KEY]);
      const legacy = stored?.[LEGACY_KEY];
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
        legacyMigrationCompleted = true;
        return 0;
      }
      const existingCount = await count();
      const migratedSource = Object.fromEntries(Object.entries(legacy).map(([loginName, value]) => [loginName, {
        ...(value && typeof value === 'object' ? value : {}),
        password: '',
        passwordMd5: String(value?.passwordMd5 || value?.passwordMD5 || value?.password || '').trim()
      }]));
      const migrated = existingCount > 0 ? 0 : await replaceAll(migratedSource);
      await chrome.storage.local.remove([LEGACY_KEY]);
      legacyMigrationCompleted = true;
      return migrated;
    };
    legacyMigrationPromise = global.navigator?.locks?.request
      ? global.navigator.locks.request(LEGACY_MIGRATION_LOCK, runMigration)
      : runMigration();
    try {
      return await legacyMigrationPromise;
    } catch (error) {
      legacyMigrationPromise = null;
      throw error;
    }
  }

  async function getByQuickUsername(quickUsername) {
    const quick = String(quickUsername || '').trim();
    if (!quick) return null;
    const db = await open();
    const transaction = db.transaction(STORE_NAME);
    const value = await requestResult(transaction.objectStore(STORE_NAME).index('quickUsername').get(quick));
    return normalize(value?.loginName, value);
  }

  global.BjtuAccountStore = {
    get,
    getAll,
    count,
    countByRole,
    put,
    update,
    clearCredentials,
    search,
    getQuickAccounts,
    getByQuickUsername,
    getCredentialAccounts,
    getAccountStates,
    deleteMany,
    clear,
    putAll,
    replaceAll,
    migrateLegacy,
    needsPasswordFieldMigration,
    migratePasswordFields
  };
})(globalThis);
