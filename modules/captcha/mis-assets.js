(function initBjtuMisAssets(global) {
  'use strict';

  const MIS_DB_NAME = 'bjtu-mis-assets';
  const MIS_DB_STORE = 'assets';

  const MIS_FILES = Object.freeze([
    Object.freeze({
      key: 'omis.onnx',
      label: 'omis.onnx（MIS 验证码识别模型）',
      url: 'https://raw.githubusercontent.com/hyskr/bjtu-mis-helper/refs/heads/main/public/omis.onnx',
      size: 10905617,
      sha256: 'D7CF5FB8AFAEEEAC751E05CACB1D7F6F0CDE0687D5B2B666C0ED7916C151E5BC'
    }),
    Object.freeze({
      key: 'ort-wasm-simd.wasm',
      label: 'ort-wasm-simd.wasm（ONNX Runtime 后端）',
      url: 'https://github.com/hyskr/bjtu-mis-helper/raw/refs/heads/main/public/onnxruntime/ort-wasm-simd.wasm',
      size: 10912730,
      sha256: '8A9CEB098C19F181C72C3BEB9E00E718D3A1DE139D11EB3E3589C5B557CDD78F'
    })
  ]);

  const downloadPromises = new Map();
  const downloadControllers = new Map();

  function openDatabase(name, storeName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error(`无法打开验证码资源数据库：${name}`));
    });
  }

  async function readStoreValue(databaseName, storeName, key) {
    const db = await openDatabase(databaseName, storeName);
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('无法读取验证码识别资源'));
      });
    } finally {
      db.close();
    }
  }

  async function writeStoreValue(databaseName, storeName, key, value) {
    const db = await openDatabase(databaseName, storeName);
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('无法保存验证码识别资源'));
        transaction.onabort = () => reject(transaction.error || new Error('保存验证码识别资源已中止'));
      });
    } finally {
      db.close();
    }
  }

  async function deleteStoreValue(databaseName, storeName, key) {
    const db = await openDatabase(databaseName, storeName);
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(key);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('无法卸载验证码识别资源'));
        transaction.onabort = () => reject(transaction.error || new Error('卸载验证码识别资源已中止'));
      });
    } finally {
      db.close();
    }
  }

  async function deleteIndexedDatabase(databaseName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error || new Error(`无法删除数据库 ${databaseName}`));
      request.onblocked = () => reject(new Error(`数据库 ${databaseName} 正在使用，暂时无法删除`));
    });
  }

  function fileDefinition(key) {
    return MIS_FILES.find((item) => item.key === key) || null;
  }

  async function getMisAsset(key) {
    const definition = fileDefinition(key);
    if (!definition) return null;
    const record = await readStoreValue(MIS_DB_NAME, MIS_DB_STORE, key);
    const blob = record?.blob instanceof Blob ? record.blob : null;
    if (!blob
        || blob.size !== definition.size
        || record?.sha256 !== definition.sha256) return null;
    return { ...record, key, blob };
  }

  async function getMisAssetsStatus() {
    const files = {};
    for (const item of MIS_FILES) {
      files[item.key] = (await getMisAsset(item.key)) ? 'installed' : 'missing';
    }
    const downloading = [...downloadPromises.keys()];
    return {
      files,
      downloading,
      installed: Object.values(files).every((state) => state === 'installed')
    };
  }

  async function fetchBytes(url, onProgress, { signal = null, expectedSize = 0 } = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/octet-stream,*/*' },
      signal
    });
    if (!response.ok) throw new Error(`MIS 验证码识别资源下载失败（HTTP ${response.status}）`);
    const responseSize = Math.max(0, Number(response.headers.get('content-length') || 0));
    const total = Math.max(responseSize, Number(expectedSize) || 0);
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      onProgress?.({ loaded: bytes.byteLength, total: total || bytes.byteLength });
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    );
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  async function validateAsset(bytes, definition, label) {
    if (bytes.byteLength !== definition.size) {
      throw new Error(`${label}大小不符（应为 ${definition.size} 字节，实际为 ${bytes.byteLength} 字节）`);
    }
    if (await sha256Hex(bytes) !== definition.sha256) {
      throw new Error(`${label}完整性校验失败`);
    }
  }

  function downloadMisAsset(key, options = {}) {
    const definition = fileDefinition(key);
    if (!definition) throw new Error(`未知的 MIS 资源：${key}`);
    if (downloadPromises.has(key)) return downloadPromises.get(key);
    const controller = new AbortController();
    if (options.signal?.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal?.addEventListener('abort', () => {
        controller.abort(options.signal.reason);
      }, { once: true });
    }
    downloadControllers.set(key, controller);
    const promise = (async () => {
      options.onProgress?.({ key, loaded: 0, total: definition.size });
      const bytes = await fetchBytes(definition.url, ({ loaded, total }) => {
        options.onProgress?.({ key, loaded, total });
      }, { signal: controller.signal, expectedSize: definition.size });
      await validateAsset(bytes, definition, definition.label);
      const record = {
        key,
        sourceUrl: definition.url,
        downloadedAt: Date.now(),
        size: bytes.byteLength,
        sha256: definition.sha256,
        blob: new Blob([bytes], { type: 'application/octet-stream' })
      };
      await writeStoreValue(MIS_DB_NAME, MIS_DB_STORE, key, record);
      return record;
    })().finally(() => {
      downloadPromises.delete(key);
      downloadControllers.delete(key);
    });
    downloadPromises.set(key, promise);
    return promise;
  }

  async function ensureMisAssets(options = {}) {
    const results = {};
    for (const item of MIS_FILES) {
      const cached = await getMisAsset(item.key);
      results[item.key] = cached || await downloadMisAsset(item.key, options);
    }
    return results;
  }

  function cancelMisDownload(key) {
    const controller = downloadControllers.get(key);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async function uninstallMisAsset(key) {
    if (downloadPromises.has(key)) throw new Error('MIS 资源正在下载，暂时无法卸载');
    await deleteStoreValue(MIS_DB_NAME, MIS_DB_STORE, key);
    return key;
  }

  async function deleteMisDatabases() {
    for (const controller of downloadControllers.values()) controller.abort();
    await Promise.allSettled([...downloadPromises.values()]);
    await deleteIndexedDatabase(MIS_DB_NAME);
    return true;
  }

  global.BjtuMisAssets = Object.freeze({
    MIS_FILES,
    getMisAsset,
    getMisAssetsStatus,
    ensureMisAssets,
    downloadMisAsset,
    cancelMisDownload,
    uninstallMisAsset,
    deleteMisDatabases
  });
})(globalThis);