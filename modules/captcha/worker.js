(function initBjtuCaptchaWorker(global) {
  'use strict';

  const MODEL_DB_NAME = 'bjtu-captcha-assets';
  const MODEL_DB_STORE = 'assets';
  const MODEL_PATH_MARKER = '/__captcha_model__/';
  const nativeFetch = global.fetch.bind(global);

  function readModelRecord(version) {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(MODEL_DB_NAME, 1);
      openRequest.onerror = () => reject(openRequest.error || new Error('无法打开验证码模型数据库'));
      openRequest.onupgradeneeded = () => {
        openRequest.transaction?.abort();
        reject(new Error('验证码模型数据库尚未初始化'));
      };
      openRequest.onsuccess = () => {
        const database = openRequest.result;
        let transaction;
        try {
          transaction = database.transaction(MODEL_DB_STORE, 'readonly');
        } catch (error) {
          database.close();
          reject(error);
          return;
        }
        const request = transaction.objectStore(MODEL_DB_STORE).get(`eng.traineddata.gz:${version}`);
        request.onsuccess = () => {
          const record = request.result;
          database.close();
          if (!(record?.blob instanceof Blob) || record.blob.size < 100000) {
            reject(new Error(`验证码识别模型 ${version} 不存在`));
            return;
          }
          resolve(record);
        };
        request.onerror = () => {
          database.close();
          reject(request.error || new Error('无法读取验证码识别模型'));
        };
      };
    });
  }

  global.fetch = async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : String(input?.url || '');
    const parsed = new URL(requestUrl, global.location.href);
    const markerIndex = parsed.pathname.indexOf(MODEL_PATH_MARKER);
    if (markerIndex < 0 || !parsed.pathname.endsWith('/eng.traineddata.gz')) {
      return nativeFetch(input, init);
    }
    const encodedVersion = parsed.pathname
      .slice(markerIndex + MODEL_PATH_MARKER.length, -'/eng.traineddata.gz'.length)
      .replace(/^\/+|\/+$/g, '');
    const version = decodeURIComponent(encodedVersion);
    const record = await readModelRecord(version);
    return new Response(record.blob, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Length': String(record.blob.size)
      }
    });
  };

  importScripts('vendor/worker.min.js');
})(globalThis);
