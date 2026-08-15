(function initBjtuLocalCaptchaRecognizer(global) {
  'use strict';

  const OFFSCREEN_URL = 'modules/captcha/offscreen.html';
  const REQUIRED_RUNTIME_FILES = Object.freeze([
    'modules/captcha/module.json',
    OFFSCREEN_URL,
    'modules/captcha/offscreen.js',
    'modules/captcha/worker.js',
    'modules/captcha/vendor/tesseract.min.js',
    'modules/captcha/vendor/worker.min.js'
  ]);
  const MIS_BUNDLED_RUNTIME_FILES = Object.freeze([
    'modules/captcha/mis-assets.js',
    'modules/captcha/vendor/ort.min.js'
  ]);
  const MIS_CAPTCHA_ENABLED_KEY = 'misCaptchaRecognitionEnabled';
  let creatingDocument = null;
  let offscreenReadyPromise = null;

  async function runtimeFilesState() {
    const results = await Promise.all(REQUIRED_RUNTIME_FILES.map(async (path) => {
      try {
        return (await fetch(chrome.runtime.getURL(path), { cache: 'no-store' })).ok;
      } catch {
        return false;
      }
    }));
    return {
      installed: results[0] === true,
      ready: results.every(Boolean)
    };
  }

  async function misRuntimeFilesState() {
    const bundledResults = await Promise.all(MIS_BUNDLED_RUNTIME_FILES.map(async (path) => {
      try {
        return (await fetch(chrome.runtime.getURL(path), { cache: 'no-store' })).ok;
      } catch {
        return false;
      }
    }));
    const assets = globalThis.BjtuMisAssets
      ? await globalThis.BjtuMisAssets.getMisAssetsStatus().catch(() => null)
      : null;
    const allInstalled = bundledResults.every(Boolean) && assets?.installed === true;
    return {
      installed: allInstalled,
      ready: allInstalled && !assets?.downloading?.length
    };
  }

  async function isMisRecognitionEnabled() {
    try {
      const stored = await chrome.storage.local.get([MIS_CAPTCHA_ENABLED_KEY]);
      return stored[MIS_CAPTCHA_ENABLED_KEY] !== false;
    } catch {
      return true;
    }
  }

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

  async function sendRecognitionRequest(imageUrl, modelVersion, type = 'VE_CAPTCHA_RECOGNIZE_LOCAL') {
    await ensureOffscreenDocument();
    let timer = null;
    let response;
    try {
      response = await Promise.race([
        chrome.runtime.sendMessage({
          type,
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
    const runtimeState = await runtimeFilesState();
    if (!runtimeState.installed) {
      throw Object.assign(
        new Error('本地验证码识别模块未安装'),
        { code: 'captcha-module-missing' }
      );
    }
    if (!runtimeState.ready) {
      throw Object.assign(
        new Error('本地验证码识别模块尚未完整安装'),
        { code: 'captcha-resources-missing' }
      );
    }
    const version = await global.BjtuCaptchaAssets.getSelectedModelVersion();
    const [model, coreReady] = await Promise.all([
      global.BjtuCaptchaAssets.getCachedModel(version),
      global.BjtuCaptchaAssets.extensionCoreExists()
    ]);
    if (!model || !coreReady) {
      const missing = [
        !model ? '识别模型' : '',
        !coreReady ? 'OCR 核心' : ''
      ].filter(Boolean).join('和');
      throw Object.assign(
        new Error(`${missing}尚未下载，请在扩展选项中完成本地验证码识别资源安装`),
        { code: 'captcha-resources-missing' }
      );
    }
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

  async function recognizeMisCaptcha(image) {
    if (!(await isMisRecognitionEnabled())) {
      throw Object.assign(
        new Error('MIS 算术验证码识别已禁用，请在扩展选项中启用'),
        { code: 'mis-captcha-disabled' }
      );
    }
    const runtimeState = await misRuntimeFilesState();
    if (!runtimeState.installed) {
      throw Object.assign(
        new Error('MIS 验证码识别模型未安装'),
        { code: 'mis-captcha-module-missing' }
      );
    }
    if (!runtimeState.ready) {
      throw Object.assign(
        new Error('MIS 验证码识别资源尚未完整安装'),
        { code: 'mis-captcha-resources-missing' }
      );
    }
    const imageUrl = await blobToDataUrl(image);
    let response;
    try {
      response = await sendRecognitionRequest(imageUrl, '', 'MIS_CAPTCHA_RECOGNIZE_LOCAL');
    } catch (error) {
      await resetOffscreenDocument();
      try {
        response = await sendRecognitionRequest(imageUrl, '', 'MIS_CAPTCHA_RECOGNIZE_LOCAL');
      } catch (retryError) {
        const firstMessage = String(error?.message || error || '');
        const retryMessage = String(retryError?.message || retryError || '');
        throw new Error(
          retryMessage && retryMessage !== firstMessage
            ? `${retryMessage}；首次尝试：${firstMessage}`
            : retryMessage || firstMessage || 'MIS 验证码识别失败'
        );
      }
    }
    const answer = Number(response.answer);
    return {
      ok: true,
      expression: String(response.expression || ''),
      answer: Number.isFinite(answer) ? answer : null,
      trace: Array.isArray(response.trace) ? response.trace : []
    };
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

  global.BjtuCaptchaRecognizer = {
    recognize,
    recognizeMisCaptcha,
    isMisRecognitionEnabled
  };
})(globalThis);
