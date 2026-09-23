(function initBjtuCaptchaCoreLoader(global) {
  'use strict';

  async function activate(assets) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await assets.extensionCoreExists()) {
        await chrome.runtime.sendMessage({ type: 'CAPTCHA_MODEL_VERSION_CHANGED' }).catch(() => {});
        const status = await chrome.runtime.sendMessage({ type: 'CAPTCHA_RECOGNIZER_STATUS' }).catch(() => null);
        return status?.ok === true && status.ready === true;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  }

  global.BjtuCaptchaCoreLoader = Object.freeze({ activate });
})(globalThis);
