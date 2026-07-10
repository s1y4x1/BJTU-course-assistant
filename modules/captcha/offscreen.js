(function initBjtuCaptchaOffscreen() {
  'use strict';

  let workerPromise = null;
  let recognitionQueue = Promise.resolve();

  async function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      if (!globalThis.Tesseract?.createWorker) throw new Error('Tesseract 未加载');
      const options = {
        logger: () => {},
        workerPath: chrome.runtime.getURL('modules/captcha/vendor/worker.min.js'),
        corePath: chrome.runtime.getURL('modules/captcha/vendor/tesseract-core-simd.wasm.js'),
        langPath: chrome.runtime.getURL('modules/captcha/vendor'),
        workerBlobURL: false
      };
      let worker;
      try {
        worker = await globalThis.Tesseract.createWorker('eng', 1, options);
      } catch {
        worker = await globalThis.Tesseract.createWorker(options);
        await worker.loadLanguage?.('eng');
        await worker.initialize?.('eng');
      }
      await worker.setParameters?.({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7'
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
    return workerPromise;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'VE_CAPTCHA_RECOGNIZE_LOCAL') return false;
    const task = recognitionQueue.catch(() => {}).then(async () => {
      const result = await (await getWorker()).recognize(String(message.imageUrl || ''));
      const passcode = String(result?.data?.text || '').replace(/\D/g, '').slice(0, 4);
      return passcode.length === 4
        ? { ok: true, passcode }
        : { ok: false, message: '未能识别出 4 位数字' };
    });
    recognitionQueue = task.then(() => undefined, () => undefined);
    task.then(sendResponse).catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  });
})();
