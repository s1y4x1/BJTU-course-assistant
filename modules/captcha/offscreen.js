(function initBjtuCaptchaOffscreen() {
  'use strict';

  let workerPromise = null;
  let recognitionQueue = Promise.resolve();

  async function recognizePasscode(imageUrl, modelVersion) {
    const result = await (await getWorker(modelVersion)).recognize(String(imageUrl || ''));
    const recognized = String(result?.data?.text || '').trim();
    const passcode = recognized.replace(/\D/g, '');
    return passcode.length === 4
      ? { ok: true, passcode }
      : {
          ok: false,
          message: recognized
            ? `未能识别出 4 位数字（识别结果：${recognized}）`
            : '未能识别出 4 位数字（识别结果为空）'
        };
  }

  async function getWorker(modelVersion) {
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      if (!globalThis.Tesseract?.createWorker) throw new Error('Tesseract 未加载');
      const version = String(modelVersion || '').trim();
      if (!version) throw new Error('验证码识别模型版本为空');
      const options = {
        logger: () => {},
        workerPath: chrome.runtime.getURL('modules/captcha/worker.js'),
        corePath: chrome.runtime.getURL('modules/captcha/vendor/tesseract-core-simd.wasm.js'),
        langPath: chrome.runtime.getURL(`__captcha_model__/${encodeURIComponent(version)}`),
        cacheMethod: 'none',
        workerBlobURL: false
      };
      const worker = await globalThis.Tesseract.createWorker('eng', 1, options);
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
    if (message?.type === 'VE_CAPTCHA_OFFSCREEN_PING') {
      sendResponse({ ok: true, ready: true });
      return false;
    }
    if (message?.type !== 'VE_CAPTCHA_RECOGNIZE_LOCAL') return false;
    const task = recognitionQueue.catch(() => {}).then(
      () => recognizePasscode(String(message.imageUrl || ''), message.modelVersion)
    );
    recognitionQueue = task.then(() => undefined, () => undefined);
    task.then(sendResponse).catch((error) => {
      const messageText = String(error?.message || error || '验证码本地识别失败');
      console.error('[bjtu] local captcha recognition failed:', error);
      sendResponse({ ok: false, message: messageText });
    });
    return true;
  });
})();
