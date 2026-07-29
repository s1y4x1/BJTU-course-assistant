(function initBjtuLocalCaptchaRecognizer(global) {
  'use strict';

  const OFFSCREEN_URL = 'modules/captcha/offscreen.html';
  let creatingDocument = null;
  let offscreenReadyPromise = null;

  void global.BjtuCaptchaAssets?.ensureModel().catch((error) => {
    console.info('[bjtu] captcha model preload deferred:', String(error?.message || error));
  });

  async function ensureOffscreenDocument() {
    if (!chrome.offscreen) throw new Error('当前浏览器不支持本地验证码识别');
    if (!(await chrome.offscreen.hasDocument?.())) {
      if (!creatingDocument) {
        creatingDocument = chrome.offscreen.createDocument({
          url: OFFSCREEN_URL,
          reasons: ['DOM_PARSER'],
          justification: '在扩展本地识别一行 4 位数字验证码'
        }).finally(() => { creatingDocument = null; });
      }
      await creatingDocument;
    }
    if (!offscreenReadyPromise) {
      offscreenReadyPromise = waitForOffscreenReady().finally(() => {
        offscreenReadyPromise = null;
      });
    }
    await offscreenReadyPromise;
  }

  async function waitForOffscreenReady() {
    const deadline = Date.now() + 5000;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'VE_CAPTCHA_OFFSCREEN_PING' });
        if (response?.ok && response.ready) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `验证码识别页面启动超时${lastError ? `：${String(lastError?.message || lastError)}` : ''}`
    );
  }

  async function resetOffscreenDocument() {
    offscreenReadyPromise = null;
    if (!chrome.offscreen?.hasDocument || !chrome.offscreen?.closeDocument) return;
    try {
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    } catch {
      // Best effort only; the next ensure call will surface any persistent error.
    }
  }

  async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
  }

  async function sendRecognitionRequest(imageUrl, modelVersion) {
    await ensureOffscreenDocument();
    let timer = null;
    let response;
    try {
      response = await Promise.race([
        chrome.runtime.sendMessage({
          type: 'VE_CAPTCHA_RECOGNIZE_LOCAL',
          imageUrl,
          modelVersion
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('验证码本地识别超时')), 60000);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response) throw new Error('验证码识别页面未返回结果');
    if (!response.ok) throw new Error(response.message || '验证码本地识别失败');
    return response;
  }

  async function recognize(image) {
    if (!global.BjtuCaptchaAssets) throw new Error('验证码识别资源管理器未加载');
    const model = await global.BjtuCaptchaAssets.ensureModel();
    const imageUrl = await blobToDataUrl(image);
    let response;
    try {
      response = await sendRecognitionRequest(imageUrl, model.version);
    } catch (error) {
      await resetOffscreenDocument();
      try {
        response = await sendRecognitionRequest(imageUrl, model.version);
      } catch (retryError) {
        const firstMessage = String(error?.message || error || '');
        const retryMessage = String(retryError?.message || retryError || '');
        throw new Error(
          retryMessage && retryMessage !== firstMessage
            ? `${retryMessage}；首次尝试：${firstMessage}`
            : retryMessage || firstMessage || '验证码本地识别失败'
        );
      }
    }
    const passcode = String(response.passcode || '').replace(/\D/g, '').slice(0, 4);
    return passcode.length === 4
      ? { ok: true, passcode }
      : { ok: false, reason: 'recognition-failed' };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'CAPTCHA_MODEL_VERSION_CHANGED') return false;
    if (chrome.offscreen?.hasDocument && chrome.offscreen?.closeDocument) {
      void chrome.offscreen.hasDocument().then((exists) => {
        if (exists) return chrome.offscreen.closeDocument();
        return undefined;
      }).catch(() => {});
    }
    return false;
  });

  global.BjtuCaptchaRecognizer = { recognize };
})(globalThis);
