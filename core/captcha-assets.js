(function initBjtuCaptchaAssets(global) {
  'use strict';

  const MODEL_VERSION_KEY = 'captchaModelVersion';
  const DEFAULT_MODEL_VERSION = '4.0.0_fast';
  const MODEL_DB_NAME = 'bjtu-captcha-assets';
  const MODEL_DB_STORE = 'assets';
  const CORE_RELATIVE_PATH = 'modules/captcha/vendor/tesseract-core-simd.wasm.js';
  const CORE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm.js';
  const CORE_SIZE = 4735153;
  const CORE_SHA256 = '63F232C4F7A97B04E52EB940202700B2C6239783A75D0FF0553274FAC530CD5C';
  const MODEL_PACKAGE = '@tesseract.js-data/eng';
  const MODEL_SOURCE_API = `https://data.jsdelivr.com/v1/package/npm/${MODEL_PACKAGE}`;
  const modelDownloadPromises = new Map();
  const modelDownloadControllers = new Map();
  let modelCatalogPromise = null;

  const FALLBACK_MODEL_VERSIONS = Object.freeze({
    '4.0.0_fast': Object.freeze({
      label: '4.0.0 Fast（原内置模型，推荐）',
      url: 'https://cdn.jsdelivr.net/gh/naptha/tessdata/4.0.0_fast/eng.traineddata.gz',
      size: 1984273,
      sha256: '18C1AC52B75E35D44735FB6C2A60ACFAF23033524653200738E98F0243EDB75B'
    }),
    '4.0.0_best_int': Object.freeze({
      label: '4.0.0 LSTM 精简版',
      url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz',
      size: 2952873,
      sha256: '45B4CB346724AC1774F1C36F42F182B887BCDB28EBE63E6FFF90AC41F3FCFF91'
    }),
    '4.0.0': Object.freeze({
      label: '4.0.0 完整版',
      url: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0/eng.traineddata.gz',
      size: 10923060,
      sha256: 'ED350F3752F81EE8F38769EDC14D92D997DABABE23B565C59879372CC46A2468'
    })
  });
  let modelVersions = FALLBACK_MODEL_VERSIONS;

  function normalizeVersion(value) {
    const version = String(value || '');
    return modelVersions[version] ? version : DEFAULT_MODEL_VERSION;
  }

  function sourceLabel(version) {
    if (version === DEFAULT_MODEL_VERSION) return `${version} Fast（原内置模型，推荐）`;
    if (/_best_int$/i.test(version)) return `${version} LSTM 精简版`;
    if (/_fast_int$/i.test(version)) return `${version} LSTM 快速版`;
    return `${version} 完整版`;
  }

  function base64Sha256ToHex(value) {
    return [...Uint8Array.from(atob(String(value || '')), (char) => char.charCodeAt(0))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  async function fetchModelVersions() {
    const metadataResponse = await fetch(MODEL_SOURCE_API, { cache: 'no-store', credentials: 'omit' });
    if (!metadataResponse.ok) throw new Error(`识别模型源 HTTP ${metadataResponse.status}`);
    const metadata = await metadataResponse.json();
    const packageVersion = String(metadata?.tags?.latest || '').trim();
    if (!packageVersion) throw new Error('识别模型源未返回最新版本');
    const filesResponse = await fetch(`${MODEL_SOURCE_API}@${encodeURIComponent(packageVersion)}/flat`, {
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!filesResponse.ok) throw new Error(`识别模型文件清单 HTTP ${filesResponse.status}`);
    const payload = await filesResponse.json();
    const definitions = {};
    for (const file of Array.isArray(payload?.files) ? payload.files : []) {
      const match = String(file?.name || '').match(/^\/([^/]+)\/eng\.traineddata\.gz$/i);
      const size = Number(file?.size || 0);
      if (!match || size <= 0 || !file?.hash) continue;
      const version = match[1];
      definitions[version] = Object.freeze({
        label: sourceLabel(version),
        url: `https://cdn.jsdelivr.net/npm/${MODEL_PACKAGE}@${packageVersion}/${version}/eng.traineddata.gz`,
        size,
        sha256: base64Sha256ToHex(file.hash),
        packageVersion
      });
    }
    if (!Object.keys(definitions).length) throw new Error('识别模型源中没有可用模型');
    const combined = {
      [DEFAULT_MODEL_VERSION]: FALLBACK_MODEL_VERSIONS[DEFAULT_MODEL_VERSION],
      ...definitions
    };
    const ordered = Object.fromEntries(Object.entries(combined).sort(([left], [right]) => {
      if (left === DEFAULT_MODEL_VERSION) return -1;
      if (right === DEFAULT_MODEL_VERSION) return 1;
      return right.localeCompare(left, undefined, { numeric: true });
    }));
    modelVersions = Object.freeze(ordered);
    return modelVersions;
  }

  async function getModelVersions() {
    if (!modelCatalogPromise) {
      modelCatalogPromise = fetchModelVersions().catch((error) => {
        console.info('[bjtu] captcha model source unavailable, using fallback catalog:', String(error?.message || error));
        return modelVersions;
      });
    }
    return modelCatalogPromise;
  }

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
        request.onerror = () => reject(request.error || new Error('无法读取验证码识别模型'));
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
        transaction.onerror = () => reject(transaction.error || new Error('无法保存验证码识别模型'));
        transaction.onabort = () => reject(transaction.error || new Error('保存验证码识别模型已中止'));
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
        transaction.onerror = () => reject(transaction.error || new Error('无法卸载验证码识别模型'));
        transaction.onabort = () => reject(transaction.error || new Error('卸载验证码识别模型已中止'));
      });
    } finally {
      db.close();
    }
  }

  function modelStorageKey(version) {
    return `eng.traineddata.gz:${normalizeVersion(version)}`;
  }

  async function getSelectedModelVersion() {
    await getModelVersions();
    const stored = await chrome.storage.local.get(MODEL_VERSION_KEY).catch(() => ({}));
    return normalizeVersion(stored?.[MODEL_VERSION_KEY]);
  }

  async function setSelectedModelVersion(version) {
    await getModelVersions();
    const normalized = normalizeVersion(version);
    await chrome.storage.local.set({ [MODEL_VERSION_KEY]: normalized });
    return normalized;
  }

  async function getCachedModel(version) {
    await getModelVersions();
    const normalized = normalizeVersion(version);
    const definition = modelVersions[normalized];
    const record = await readStoreValue(MODEL_DB_NAME, MODEL_DB_STORE, modelStorageKey(normalized));
    const blob = record?.blob instanceof Blob ? record.blob : null;
    if (!blob
        || blob.size !== definition.size
        || record?.sha256 !== definition.sha256) return null;
    return { ...record, version: normalized, blob };
  }

  async function deleteCachedModel(version) {
    await getModelVersions();
    const normalized = normalizeVersion(version);
    if (modelDownloadPromises.has(normalized)) {
      throw new Error('该识别模型正在下载，暂时无法卸载');
    }
    await deleteStoreValue(MODEL_DB_NAME, MODEL_DB_STORE, modelStorageKey(normalized));
    return normalized;
  }

  function deleteIndexedDatabase(databaseName) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error || new Error(`无法删除数据库 ${databaseName}`));
      request.onblocked = () => reject(new Error(`数据库 ${databaseName} 正在使用，暂时无法删除`));
    });
  }

  async function deleteDatabases() {
    const pendingDownloads = [...modelDownloadPromises.values()];
    for (const controller of modelDownloadControllers.values()) controller.abort();
    await Promise.allSettled(pendingDownloads);
    await Promise.all([
      deleteIndexedDatabase(MODEL_DB_NAME),
      deleteIndexedDatabase('keyval-store')
    ]);
    return true;
  }

  async function fetchBytes(url, onProgress, { signal = null, expectedSize = 0 } = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/octet-stream,*/*' },
      signal
    });
    if (!response.ok) throw new Error(`验证码识别资源下载失败（HTTP ${response.status}）`);
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

  async function ensureModel(options = {}) {
    await getModelVersions();
    const version = normalizeVersion(options.version || await getSelectedModelVersion());
    const cached = await getCachedModel(version);
    if (cached) return { ...cached, downloaded: false };
    if (!modelDownloadPromises.has(version)) {
      const definition = modelVersions[version];
      const controller = new AbortController();
      if (options.signal?.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal?.addEventListener('abort', () => {
          controller.abort(options.signal.reason);
        }, { once: true });
      }
      modelDownloadControllers.set(version, controller);
      modelDownloadPromises.set(version, (async () => {
        const bytes = await fetchBytes(definition.url, ({ loaded, total }) => {
          options.onProgress?.({ phase: 'model', loaded, total, version });
        }, { signal: controller.signal, expectedSize: definition.size });
        if (bytes.byteLength < 100000 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
          throw new Error('验证码识别模型内容无效');
        }
        await validateAsset(bytes, definition, '验证码识别模型');
        const record = {
          version,
          sourceUrl: definition.url,
          downloadedAt: Date.now(),
          size: bytes.byteLength,
          sha256: definition.sha256,
          blob: new Blob([bytes], { type: 'application/gzip' })
        };
        await writeStoreValue(MODEL_DB_NAME, MODEL_DB_STORE, modelStorageKey(version), record);
        return { ...record, downloaded: true };
      })().finally(() => {
        modelDownloadPromises.delete(version);
        modelDownloadControllers.delete(version);
      }));
    }
    options.onProgress?.({ phase: 'model', loaded: 0, total: 0, version });
    return modelDownloadPromises.get(version);
  }

  function cancelModelDownload(version) {
    const normalized = normalizeVersion(version);
    const controller = modelDownloadControllers.get(normalized);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async function extensionCoreExists() {
    try {
      const response = await fetch(chrome.runtime.getURL(CORE_RELATIVE_PATH), { cache: 'no-store' });
      if (!response.ok) return false;
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > 0) return contentLength === CORE_SIZE;
      return (await response.arrayBuffer()).byteLength === CORE_SIZE;
    } catch {
      return false;
    }
  }

  async function downloadCore(options = {}) {
    options.onProgress?.({ phase: 'core', loaded: 0, total: 0 });
    const bytes = await fetchBytes(CORE_URL, ({ loaded, total }) => {
      options.onProgress?.({ phase: 'core', loaded, total });
    }, { expectedSize: CORE_SIZE });
    if (bytes.byteLength < 1000000) throw new Error('验证码识别核心内容无效');
    await validateAsset(bytes, { size: CORE_SIZE, sha256: CORE_SHA256 }, '验证码识别核心');
    return bytes;
  }

  global.BjtuCaptchaAssets = Object.freeze({
    MODEL_VERSION_KEY,
    DEFAULT_MODEL_VERSION,
    get MODEL_VERSIONS() { return modelVersions; },
    MODEL_SOURCE_API,
    CORE_RELATIVE_PATH,
    CORE_URL,
    CORE_SIZE,
    normalizeVersion,
    getModelVersions,
    getSelectedModelVersion,
    setSelectedModelVersion,
    getCachedModel,
    deleteCachedModel,
    deleteDatabases,
    ensureModel,
    cancelModelDownload,
    extensionCoreExists,
    downloadCore
  });

  void deleteIndexedDatabase('keyval-store').catch((error) => {
    console.info('[bjtu] legacy captcha cache cleanup deferred:', String(error?.message || error));
  });
})(globalThis);
