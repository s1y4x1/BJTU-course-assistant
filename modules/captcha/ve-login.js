(function initVeCaptchaFill() {
  'use strict';
  let enabled = false;
  let generation = 0;
  let lastImage = '';
  let watchedImage = null;

  async function fillCaptcha() {
    const input = document.querySelector('#passcode');
    const image = [...document.images].find((item) => /\/ve\/GetImg(?:[?#]|$)/i.test(item.src));
    if (!enabled || !input || !image || !image.complete || !image.naturalWidth) return;
    if (lastImage === image.src) return;
    lastImage = image.src;
    const imageSource = image.src;
    const requestGeneration = ++generation;
    const initialValue = input.value;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const result = await chrome.runtime.sendMessage({
        type: 'VE_LOGIN_RECOGNIZE_CAPTCHA',
        payload: { imageUrl: canvas.toDataURL('image/png') }
      });
      if (!enabled || generation !== requestGeneration || input.value !== initialValue
        || image.src !== imageSource
        || !result?.ok || !/^\d{4}$/.test(result.passcode)) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, result.passcode);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      console.info('[bjtu] VE 验证码自动填充失败：', error.message);
    }
  }

  function observeImage() {
    const image = [...document.images].find((item) => /\/ve\/GetImg(?:[?#]|$)/i.test(item.src));
    if (image && image !== watchedImage) {
      watchedImage = image;
      image.addEventListener('load', () => { lastImage = ''; void fillCaptcha(); });
    }
    void fillCaptcha();
  }
  chrome.storage.local.get('veCaptchaRecognitionEnabled').then((stored) => {
    enabled = stored.veCaptchaRecognitionEnabled === true;
    observeImage();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.veCaptchaRecognitionEnabled) return;
    enabled = changes.veCaptchaRecognitionEnabled.newValue === true;
    generation += 1;
    lastImage = '';
    observeImage();
  });
  new MutationObserver(observeImage).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src']
  });
})();
