(function initBjtuLocalCaptchaRecognizer(global) {
  'use strict';

  const OFFSCREEN_URL = 'modules/captcha/offscreen.html';
  let creatingDocument = null;

  async function ensureOffscreenDocument() {
    if (!chrome.offscreen) throw new Error('当前浏览器不支持本地验证码识别');
    if (await chrome.offscreen.hasDocument?.()) return;
    if (!creatingDocument) {
      creatingDocument = chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['DOM_PARSER'],
        justification: '在扩展本地识别一行 4 位数字验证码'
      }).finally(() => { creatingDocument = null; });
    }
    await creatingDocument;
  }

  async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
  }

  async function recognize(image) {
    await ensureOffscreenDocument();
    let timer = null;
    let response;
    try {
      response = await Promise.race([
        chrome.runtime.sendMessage({
          type: 'VE_CAPTCHA_RECOGNIZE_LOCAL',
          imageUrl: await blobToDataUrl(image)
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('验证码本地识别超时')), 30000);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response?.ok) throw new Error(response?.message || '验证码本地识别失败');
    const passcode = String(response.passcode || '').replace(/\D/g, '').slice(0, 4);
    return passcode.length === 4
      ? { ok: true, passcode }
      : { ok: false, reason: 'recognition-failed' };
  }

  global.BjtuCaptchaRecognizer = { recognize };
})(globalThis);
