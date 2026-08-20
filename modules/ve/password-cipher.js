(function initBjtuVePasswordCipher(global) {
  'use strict';

  function decrypt(value) {
    return typeof global.strDec === 'function' ? global.strDec(value) : '';
  }

  function isReasonablePassword(value) {
    const password = String(value || '');
    if (!password || password.length > 256) return false;
    if (/^[\x20-\x7e]+$/.test(password)) return true;
    return /[\x21-\x7e]/.test(password) && /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u.test(password);
  }

  global.BjtuVePasswordCipher = { decrypt, isReasonablePassword };
})(globalThis);
