(function initBjtuUpdateFileSystem(global) {
  'use strict';

  const INSTALL_LOCK_NAME = 'bjtu-course-assistant-update-install';
  const INVALID_STATE_RETRY_DELAYS = [80, 200];
  const DIRECTORY_DB_NAME = 'bjtu-course-assistant-filesystem';
  const LEGACY_DIRECTORY_DB_NAME = 'bjtu-course-assistant-update-filesystem';
  const DIRECTORY_STORE = 'handles';
  const DIRECTORY_KEY = 'update-directory';
  const MIGRATION_KEY = 'directory-db-migrated';
  let migrationPromise = null;

  function openDirectoryDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DIRECTORY_STORE)) {
          request.result.createObjectStore(DIRECTORY_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开扩展目录数据库'));
    });
  }

  async function readDirectoryValue(name, key) {
    const db = await openDirectoryDatabase(name);
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(DIRECTORY_STORE, 'readonly').objectStore(DIRECTORY_STORE).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error || new Error('无法读取扩展目录数据库'));
      });
    } finally {
      db.close();
    }
  }

  async function writeDirectoryValue(handle, markMigrated = false) {
    const db = await openDirectoryDatabase(DIRECTORY_DB_NAME);
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DIRECTORY_STORE, 'readwrite');
        const store = transaction.objectStore(DIRECTORY_STORE);
        if (handle) store.put(handle, DIRECTORY_KEY);
        else if (!markMigrated) store.delete(DIRECTORY_KEY);
        if (markMigrated) store.put(true, MIGRATION_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('无法保存扩展目录'));
        transaction.onabort = () => reject(transaction.error || new Error('保存扩展目录已中止'));
      });
    } finally {
      db.close();
    }
  }

  async function migrateDirectoryDatabase() {
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
      const databases = await indexedDB.databases();
      const legacyExists = databases.some((database) => database.name === LEGACY_DIRECTORY_DB_NAME);
      if (await readDirectoryValue(DIRECTORY_DB_NAME, MIGRATION_KEY)) {
        if (legacyExists) removeLegacyDirectoryDatabase();
        return;
      }
      const current = await readDirectoryValue(DIRECTORY_DB_NAME, DIRECTORY_KEY);
      let previous = null;
      if (!current && legacyExists) {
        previous = await readDirectoryValue(LEGACY_DIRECTORY_DB_NAME, DIRECTORY_KEY);
      }
      await writeDirectoryValue(current || previous, true);
      if (legacyExists) removeLegacyDirectoryDatabase();
    })().catch((error) => {
      migrationPromise = null;
      throw error;
    });
    return migrationPromise;
  }

  function removeLegacyDirectoryDatabase() {
    const deletion = indexedDB.deleteDatabase(LEGACY_DIRECTORY_DB_NAME);
    deletion.onerror = () => console.warn('[bjtu] 无法移除旧扩展目录数据库', deletion.error);
  }

  async function readDirectoryHandle() {
    await migrateDirectoryDatabase();
    return readDirectoryValue(DIRECTORY_DB_NAME, DIRECTORY_KEY);
  }

  async function storeDirectoryHandle(handle) {
    await migrateDirectoryDatabase();
    await writeDirectoryValue(handle);
  }

  function isInvalidStateError(error) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    return name === 'invalidstateerror'
      || message.includes('state cached in an interface object')
      || message.includes('state had changed since it was read from disk');
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function retryInvalidState(operation) {
    let lastError = null;
    for (let attempt = 0; attempt <= INVALID_STATE_RETRY_DELAYS.length; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (!isInvalidStateError(error) || attempt >= INVALID_STATE_RETRY_DELAYS.length) throw error;
        await wait(INVALID_STATE_RETRY_DELAYS[attempt]);
      }
    }
    throw lastError;
  }

  async function withInstallLock(operation) {
    if (typeof operation !== 'function') throw new TypeError('更新安装任务无效');
    const lockManager = global.navigator?.locks;
    if (!lockManager || typeof lockManager.request !== 'function') return operation();
    return lockManager.request(INSTALL_LOCK_NAME, { mode: 'exclusive' }, operation);
  }

  async function writeFile(root, relativePath, bytes) {
    if (!root) throw new Error('尚未授权更新目录');
    const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
      throw new Error(`更新文件路径无效：${relativePath}`);
    }
    return retryInvalidState(async () => {
      let directory = root;
      for (const part of parts.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(part, { create: true });
      }
      const fileHandle = await directory.getFileHandle(parts.at(-1), { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch(() => {});
        throw error;
      }
    });
  }

  async function removeEntry(root, name, options = { recursive: true }) {
    if (!root) throw new Error('尚未授权更新目录');
    return retryInvalidState(async () => {
      try {
        await root.removeEntry(name, options);
      } catch (error) {
        if (String(error?.name || '').toLowerCase() === 'notfounderror') return;
        throw error;
      }
    });
  }

  global.BjtuUpdateFileSystem = {
    isInvalidStateError,
    retryInvalidState,
    withInstallLock,
    readDirectoryHandle,
    storeDirectoryHandle,
    writeFile,
    removeEntry
  };
})(globalThis);
