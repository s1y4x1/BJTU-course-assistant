(function (global) {
  'use strict';

  const BASE_VE = 'http://123.121.147.7:88/ve/';
  const CAPTCHA_URL = BASE_VE + 'GetImg';
  const gbkEncodeCache = new Map();

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

  function buildPasswordLoginBody(loginName, password, passcode = '') {
    const plainLoginName = String(loginName || '').trim();
    const encryptedLoginName = typeof global.strEnc === 'function'
      ? global.strEnc(plainLoginName)
      : plainLoginName;
    return 'login=main_2&username=' + encodeURIComponent(encryptedLoginName)
      + '&password=' + encodeURIComponent(String(password || '').trim())
      + '&passcode=' + encodeURIComponent(normalizePasscode(passcode));
  }

  function buildPasswordLoginRequest(loginName, password, passcode = '') {
    return {
      url: BASE_VE + 's.shtml',
      options: {
        method: 'POST',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
          'Cache-Control': 'max-age=0',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: buildPasswordLoginBody(loginName, password, passcode)
      }
    };
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
    const recognizer = global.BjtuCaptchaRecognizer;
    if (!recognizer || typeof recognizer.recognize !== 'function') {
      return { ok: false, reason: 'module-missing', image };
    }
    try {
      // recognize() 的第二个参数是模型版本，不是请求选项；把 { signal }
      // 传进去会被当成名为 "[object Object]" 的模型，导致自动识别必定失败。
      const result = await recognizer.recognize(image);
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      const passcode = normalizePasscode(result?.passcode);
      return result?.ok && passcode.length === 4
        ? { ok: true, passcode, image }
        : { ok: false, reason: 'recognition-failed', image };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      const code = String(error?.code || '').trim();
      return {
        ok: false,
        reason: code === 'captcha-module-missing'
          ? 'module-missing'
          : code === 'captcha-resources-missing'
            ? 'resources-missing'
            : 'recognition-failed',
        image,
        error
      };
    }
  }

  global.BjtuVeLoginUtils = {
    BASE_VE,
    CAPTCHA_URL,
    gbkUrlEncode,
    normalizePasscode,
    buildPasswordLoginBody,
    buildPasswordLoginRequest,
    buildQuickLoginUrl,
    getCaptchaImage,
    recognizeCaptcha
  };
})(globalThis);
