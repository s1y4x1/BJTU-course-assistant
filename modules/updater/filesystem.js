(function initBjtuUpdateFileSystem(global) {
  'use strict';

  const INSTALL_LOCK_NAME = 'bjtu-course-assistant-update-install';
  const INVALID_STATE_RETRY_DELAYS = [80, 200];
  const DIRECTORY_DB_NAME = 'BJTUCA-FileSystem';
  const DIRECTORY_STORE = 'handles';
  const DIRECTORY_KEY = 'update-directory';
  let fileConcurrencyDefaultsPromise = null;

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

  async function writeDirectoryValue(handle) {
    const db = await openDirectoryDatabase(DIRECTORY_DB_NAME);
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(DIRECTORY_STORE, 'readwrite');
        const store = transaction.objectStore(DIRECTORY_STORE);
        if (handle) store.put(handle, DIRECTORY_KEY);
        else store.delete(DIRECTORY_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('无法保存扩展目录'));
        transaction.onabort = () => reject(transaction.error || new Error('保存扩展目录已中止'));
      });
    } finally {
      db.close();
    }
  }

  async function readDirectoryHandle() {
    await global.__bjtuDatabaseMigrationReady;
    return readDirectoryValue(DIRECTORY_DB_NAME, DIRECTORY_KEY);
  }

  async function storeDirectoryHandle(handle) {
    await global.__bjtuDatabaseMigrationReady;
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

  async function fileMatchesBytes(file, bytes) {
    if (file.size !== bytes.byteLength) return false;
    const reader = file.stream().getReader();
    let offset = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return offset === bytes.byteLength;
        for (let index = 0; index < value.byteLength; index += 1) {
          if (value[index] !== bytes[offset + index]) return false;
        }
        offset += value.byteLength;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }

  async function writeFile(root, relativePath, bytes, { skipUnchanged = false } = {}) {
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
      if (skipUnchanged) {
        try {
          const existing = await directory.getFileHandle(parts.at(-1));
          const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          if (await fileMatchesBytes(await existing.getFile(), content)) return false;
        } catch (error) {
          if (error?.name !== 'NotFoundError') throw error;
        }
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
      return true;
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

  function archiveCacheKey(url, version) {
    const key = new URL('https://bjtuca.invalid/update-archive.zip');
    key.searchParams.set('url', new URL(url).href);
    key.searchParams.set('version', String(version || '').replace(/^v/i, ''));
    return key.href;
  }

  function normalizeFileConcurrency(value) {
    if (value === null || value === '') return null;
    const count = Number(value);
    return Number.isSafeInteger(count) && count > 0 ? count : null;
  }

  async function readFileConcurrency() {
    await ensureFileConcurrencyDefaults();
    const stored = await chrome.storage.local.get('updateFileConcurrency');
    return normalizeFileConcurrency(stored.updateFileConcurrency) ?? Infinity;
  }

  function ensureFileConcurrencyDefaults() {
    if (!fileConcurrencyDefaultsPromise) {
      const initialize = async () => {
        const stored = await chrome.storage.local.get('updateFileConcurrencyDefaultsVersion');
        if (stored.updateFileConcurrencyDefaultsVersion === 1) return;
        await chrome.storage.local.set({ updateFileConcurrency: null, updateFileConcurrencyDefaultsVersion: 1 });
      };
      fileConcurrencyDefaultsPromise = (global.navigator?.locks
        ? global.navigator.locks.request('bjtu-ca-file-concurrency-defaults', initialize)
        : initialize()).catch((error) => {
          fileConcurrencyDefaultsPromise = null;
          throw error;
        });
    }
    return fileConcurrencyDefaultsPromise;
  }

  async function readArchive(url, version) {
    const cache = await caches.open('bjtu-ca-update-archive');
    const response = await cache.match(archiveCacheKey(url, version));
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  async function storeArchive(url, version, bytes) {
    const cache = await caches.open('bjtu-ca-update-archive');
    const key = archiveCacheKey(url, version);
    await cache.put(key, new Response(bytes, { headers: { 'Content-Type': 'application/zip' } }));
    for (const request of await cache.keys()) {
      if (request.url !== key) await cache.delete(request);
    }
  }

  global.BjtuUpdateFileSystem = {
    ensureFileConcurrencyDefaults,
    normalizeFileConcurrency,
    readFileConcurrency,
    readArchive,
    storeArchive,
    fileMatchesBytes,
    isInvalidStateError,
    retryInvalidState,
    withInstallLock,
    readDirectoryHandle,
    storeDirectoryHandle,
    writeFile,
    writeFileIfChanged: (root, relativePath, bytes) => writeFile(root, relativePath, bytes, { skipUnchanged: true }),
    removeEntry
  };
})(globalThis);
