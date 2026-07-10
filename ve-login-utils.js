(function (global) {
  'use strict';

  const BASE_VE = 'http://123.121.147.7:88/ve/';
  const CAPTCHA_URL = BASE_VE + 'GetImg';
  const CAPTCHA_OCR_URL = 'https://bhshare.cn/imgcode/';
  const gbkEncodeCache = new Map();
  let captchaRecognitionExhausted = false;
  const CAPTCHA_EXHAUSTED_SESSION_KEY = 'veCaptchaRecognitionExhausted';

  async function isCaptchaRecognitionExhausted() {
    if (captchaRecognitionExhausted) return true;
    try {
      const state = await chrome.storage.session.get(CAPTCHA_EXHAUSTED_SESSION_KEY);
      captchaRecognitionExhausted = state?.[CAPTCHA_EXHAUSTED_SESSION_KEY] === true;
    } catch {
      // Session storage is not required for the current context.
    }
    return captchaRecognitionExhausted;
  }

  function markCaptchaRecognitionExhausted() {
    captchaRecognitionExhausted = true;
    chrome.storage.session.set({ [CAPTCHA_EXHAUSTED_SESSION_KEY]: true }).catch(() => {});
  }

  function gbkBytesForChar(ch) {
    if (gbkEncodeCache.has(ch)) return gbkEncodeCache.get(ch);
    const code = ch.codePointAt(0);
    if (code <= 0x7f) {
      const bytes = [code];
      gbkEncodeCache.set(ch, bytes);
      return bytes;
    }
    for (let hi = 0x81; hi <= 0xfe; hi += 1) {
      for (let lo = 0x40; lo <= 0xfe; lo += 1) {
        if (lo === 0x7f) continue;
        try {
          if (new TextDecoder('gbk').decode(new Uint8Array([hi, lo])) === ch) {
            const bytes = [hi, lo];
            gbkEncodeCache.set(ch, bytes);
            return bytes;
          }
        } catch {
          // Continue trying valid GBK byte pairs.
        }
      }
    }
    const fallback = Array.from(unescape(encodeURIComponent(ch))).map((item) => item.charCodeAt(0));
    gbkEncodeCache.set(ch, fallback);
    return fallback;
  }

  function gbkUrlEncode(value) {
    const safe = /^[A-Za-z0-9_.~-]$/;
    return Array.from(String(value || '')).map((ch) => {
      if (safe.test(ch)) return ch;
      return gbkBytesForChar(ch).map((byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
    }).join('');
  }

  function normalizePasscode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
  }

  function buildPasswordLoginUrl(loginName, password, passcode = '') {
    return BASE_VE + 's.shtml?login=main_2&username=' + gbkUrlEncode(String(loginName || '').trim())
      + '&password=' + encodeURIComponent(String(password || '').trim())
      + '&passcode=' + encodeURIComponent(normalizePasscode(passcode));
  }

  function buildQuickLoginUrl(quickUsername) {
    return BASE_VE + 's.shtml?loginType=2&login=main_2&username=' + encodeURIComponent(String(quickUsername || '').trim());
  }

  async function getCaptchaImage({ signal } = {}) {
    const response = await fetch(CAPTCHA_URL, {
      credentials: 'include',
      cache: 'no-store',
      signal
    });
    if (!response.ok) throw new Error('验证码图片获取失败：HTTP ' + response.status);
    const image = await response.blob();
    if (!image.size) throw new Error('验证码图片为空');
    return image;
  }

  async function recognizeCaptcha({ signal } = {}) {
    const image = await getCaptchaImage({ signal });
    if (await isCaptchaRecognitionExhausted()) {
      return { ok: false, reason: 'quota-exhausted', image, times: 0 };
    }
    try {
      const form = new FormData();
      form.append('token', 'free');
      form.append('type', 'local');
      form.append('file', image, 'GetImg.jpg');
      const response = await fetch(CAPTCHA_OCR_URL, {
        method: 'POST',
        body: form,
        cache: 'no-store',
        signal
      });
      if (!response.ok) throw new Error('验证码识别服务返回 HTTP ' + response.status);
      const payload = await response.json();
      const passcode = normalizePasscode(payload?.data);
      const times = Math.max(0, Number(payload?.times) || 0);
      if (times === 0) markCaptchaRecognitionExhausted();
      if (Number(payload?.code) !== 200 || passcode.length !== 4) {
        return { ok: false, reason: 'recognition-failed', image, times };
      }
      return { ok: true, passcode, image, times };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      return { ok: false, reason: 'recognition-failed', image, times: null, error };
    }
  }

  global.BjtuVeLoginUtils = {
    BASE_VE,
    CAPTCHA_URL,
    gbkUrlEncode,
    normalizePasscode,
    buildPasswordLoginUrl,
    buildQuickLoginUrl,
    getCaptchaImage,
    recognizeCaptcha
  };
})(globalThis);
