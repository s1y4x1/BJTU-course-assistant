(function initBjtuCasCaptchaLogin() {
  'use strict';

  const log = (...args) => console.log('[bjtu-mis]', ...args);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function waitForElement(selector, timeout = 10000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        const element = document.querySelector(selector);
        if (element) return resolve(element);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(check, 200);
      };
      check();
    });
  }

  async function imageToDataUrl(img) {
    if (!img.complete || img.naturalWidth === 0) {
      await new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }
    if (img.src && /^data:/i.test(img.src)) return img.src;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建画布');
    context.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  (async () => {
    log('内容脚本已注入，等待验证码元素…');
    const img = await waitForElement('img[alt="captcha"]');
    if (!img) {
      log('未找到验证码图片（img[alt="captcha"]），请确认当前页面为 CAS 登录页');
      return;
    }
    log(`已找到验证码图片：${img.naturalWidth}×${img.naturalHeight}`);
    const input = document.querySelector('input[name="captcha_1"]');
    if (!input) {
      log('未找到验证码输入框（input[name="captcha_1"]），中止');
      return;
    }
    log('已找到验证码输入框（input[name="captcha_1"]）');

    let imageUrl;
    try {
      imageUrl = await imageToDataUrl(img);
    } catch (error) {
      log('图片转 data URL 失败：', error?.message || error);
      return;
    }
    log(`图片已转换为 data URL（长度 ${imageUrl.length}）`);

    log('已向扩展后台发送识别请求…');
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'MIS_CAPTCHA_RECOGNIZE', imageUrl });
    } catch (error) {
      log('发送识别请求失败：', error?.message || error);
      return;
    }
    if (!response) {
      log('未收到识别响应');
      return;
    }
    if (Array.isArray(response.trace)) {
      response.trace.forEach((item) => log(item));
    }
    if (!response.ok) {
      log('识别失败：', response.message || '未知错误');
      return;
    }
    log(`识别结果：${response.expression} = ${response.answer}`);
    const value = String(response.answer ?? '');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    log(`已将 ${value} 填入验证码输入框`);
  })().catch((error) => {
    log('捕获到未处理错误：', error?.stack || error);
  });
})();