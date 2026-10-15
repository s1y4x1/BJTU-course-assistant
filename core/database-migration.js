(function initDatabaseMigration(global) {
  'use strict';

  const DATABASES = [
    ['bjtu-course-assistant', 'BJTUCA-Accounts'],
    ['bjtu-captcha-assets', 'BJTUCA-Captcha'],
    ['bjtu-course-assistant-filesystem', 'BJTUCA-FileSystem'],
    ['bjtu-course-assistant-update-filesystem', 'BJTUCA-FileSystem']
  ];
  const BATCH_SIZE = 100;
  let running;

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('迁移事务中止'));
    });
  }

  async function openDatabase(name, version, upgrade, status) {
    const request = version ? indexedDB.open(name, version) : indexedDB.open(name);
    request.onblocked = () => status('请关闭其他仍在使用数据库的扩展页面，关闭后将自动继续…');
    request.onupgradeneeded = () => upgrade?.(request.result);
    const db = await requestResult(request);
    db.onversionchange = () => db.close();
    return db;
  }

  function schemaOf(db) {
    if (!db.objectStoreNames.length) return [];
    const tx = db.transaction([...db.objectStoreNames], 'readonly');
    return [...db.objectStoreNames].map(name => {
      const store = tx.objectStore(name);
      return {
        name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
        indexes: [...store.indexNames].map(name => {
          const index = store.index(name);
          return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
        })
      };
    });
  }

  async function readBatch(db, name, lastKey) {
    const tx = db.transaction(name, 'readonly');
    const done = transactionDone(tx);
    const result = await new Promise((resolve, reject) => {
      const rows = [];
      const request = tx.objectStore(name).openCursor(lastKey === undefined ? null : IDBKeyRange.lowerBound(lastKey, true));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= BATCH_SIZE) { resolve(rows); return; }
        rows.push({ key: cursor.primaryKey, value: cursor.value });
        cursor.continue();
      };
    });
    await done;
    return result;
  }

  async function equalValues(left, right) {
    if (Object.is(left, right)) return true;
    if (left == null || right == null || typeof left !== typeof right) return false;
    if (typeof left !== 'object') return false;
    if (typeof left.isSameEntry === 'function') return !!right.isSameEntry && left.isSameEntry(right);
    if (left instanceof Blob) {
      if (!(right instanceof Blob) || left.size !== right.size || left.type !== right.type) return false;
      for (let offset = 0; offset < left.size; offset += 65536) {
        const a = new Uint8Array(await left.slice(offset, offset + 65536).arrayBuffer());
        const b = new Uint8Array(await right.slice(offset, offset + 65536).arrayBuffer());
        if (!a.every((byte, index) => byte === b[index])) return false;
      }
      return true;
    }
    if (left instanceof ArrayBuffer || ArrayBuffer.isView(left)) {
      if (!(right instanceof ArrayBuffer) && !ArrayBuffer.isView(right)) return false;
      const view = value => value instanceof ArrayBuffer ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const a = view(left), b = view(right);
      return a.length === b.length && a.every((byte, index) => byte === b[index]);
    }
    if (left instanceof Date) return right instanceof Date && left.getTime() === right.getTime();
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(right, key) || !await equalValues(left[key], right[key])) return false;
    }
    return true;
  }

  async function copyBatch(db, name, rows) {
    const tx = db.transaction(name, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(name);
    // Do not overwrite records already saved under the new database name.
    for (const row of rows) {
      const request = store.getKey(row.key);
      request.onsuccess = () => {
        if (request.result !== undefined) return;
        if (store.keyPath === null) store.put(row.value, row.key);
        else store.put(row.value);
      };
    }
    await done;
    const verification = db.transaction(name, 'readonly');
    const verified = transactionDone(verification);
    const values = await Promise.all(rows.map(row => requestResult(verification.objectStore(name).get(row.key))));
    await verified;
    return values;
  }

  async function migrateDatabase(oldName, newName, progress) {
    progress.status(`正在迁移 ${oldName} → ${newName}…`);
    const source = await openDatabase(oldName, null, null, progress.status);
    let target;
    try {
      const schema = schemaOf(source);
      const inventory = await indexedDB.databases();
      const existingVersion = inventory.find(db => db.name === newName)?.version || 0;
      target = await openDatabase(newName, Math.max(source.version, existingVersion), db => {
        for (const definition of schema) {
          if (db.objectStoreNames.contains(definition.name)) continue;
          const store = db.createObjectStore(definition.name, { keyPath: definition.keyPath, autoIncrement: definition.autoIncrement });
          for (const index of definition.indexes) store.createIndex(index.name, index.keyPath, index);
        }
      }, progress.status);
      for (const { name } of schema) {
        if (!target.objectStoreNames.contains(name)) throw new Error(`${newName} 缺少对象仓库 ${name}`);
        let lastKey;
        while (true) {
          const rows = await readBatch(source, name, lastKey);
          if (!rows.length) break;
          // Capture existing values so newer destination records can be retained and verified.
          const tx = target.transaction(name, 'readonly');
          const done = transactionDone(tx);
          const previous = await Promise.all(rows.map(row => requestResult(tx.objectStore(name).get(row.key))));
          await done;
          const values = await copyBatch(target, name, rows);
          for (let index = 0; index < rows.length; index++) {
            const expected = previous[index] === undefined ? rows[index].value : previous[index];
            if (!await equalValues(expected, values[index])) throw new Error(`${oldName}/${name} 迁移校验失败，旧库已保留`);
            progress.advance(`${oldName} → ${newName} · ${name}`);
          }
          lastKey = rows.at(-1).key;
        }
      }
    } finally {
      source.close();
      target?.close();
    }
    const deletion = indexedDB.deleteDatabase(oldName);
    deletion.onblocked = () => progress.status(`迁移已校验；请关闭仍在使用 ${oldName} 的扩展页面，随后自动删除旧库…`);
    await requestResult(deletion);
    progress.advance(`已删除旧库 ${oldName}`);
  }

  async function createDialog() {
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('UI/database-migration.css');
    document.head.append(link);
    const dialog = document.createElement('dialog');
    dialog.className = 'database-migration-dialog';
    dialog.innerHTML = '<h2>迁移本地数据库</h2><p>正在将旧数据库迁移至新名称，校验完成后删除旧库。请勿关闭此页面。</p><div class="database-migration-status" role="status"></div><progress max="1" value="0" aria-label="数据库迁移进度"></progress><div class="database-migration-count"></div><button type="button" hidden>重试</button>';
    dialog.querySelector('[role="status"]').textContent = '正在统计旧数据库中的记录…';
    dialog.addEventListener('cancel', event => event.preventDefault());
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
  }

  async function migrate() {
    const inventory = await indexedDB.databases();
    const pending = DATABASES.filter(([oldName]) => inventory.some(db => db.name === oldName));
    if (!pending.length) return;
    const dialog = await createDialog();
    const message = dialog.querySelector('[role="status"]');
    const bar = dialog.querySelector('progress');
    const count = dialog.querySelector('.database-migration-count');
    const button = dialog.querySelector('button');
    try {
      let total = pending.length;
      for (const [name] of pending) {
        const db = await openDatabase(name, null, null, text => message.textContent = text);
        try {
          for (const store of db.objectStoreNames) total += await requestResult(db.transaction(store).objectStore(store).count());
        } finally { db.close(); }
      }
      let completed = 0;
      bar.max = total;
      const progress = {
        status: text => { message.textContent = text; },
        advance(text) {
          bar.value = ++completed;
          message.textContent = text;
          count.textContent = `${completed} / ${total} · ${Math.round(completed * 100 / total)}%`;
        }
      };
      for (const [oldName, newName] of pending) await migrateDatabase(oldName, newName, progress);
      message.textContent = '迁移完成，旧数据库已删除。';
      button.textContent = '完成';
      button.hidden = false;
      button.onclick = () => { dialog.close(); dialog.remove(); };
    } catch (error) {
      message.textContent = `迁移失败：${String(error?.message || error)}。未完成迁移的旧库已保留。`;
      button.hidden = false;
      await new Promise(resolve => {
        button.onclick = () => { dialog.close(); dialog.remove(); resolve(); };
      });
      return migrate();
    }
  }

  function run() {
    if (!running) running = navigator.locks.request('bjtu-ca-database-migration', { mode: 'exclusive' }, migrate);
    return running;
  }

  global.BjtuDatabaseMigration = { run };
})(globalThis);
