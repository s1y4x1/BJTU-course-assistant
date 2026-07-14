(function initBjtuVePasswordCipher(global) {
  'use strict';

  const KEYS = ['1', '2', '3'];

  function hexToBits(value) {
    return Array.from(String(value || '')).flatMap((character) => {
      const number = Number.parseInt(character, 16);
      return [3, 2, 1, 0].map((shift) => (number >> shift) & 1);
    });
  }

  function decryptBlock(block, key) {
    const roundKeys = global.generateKeys(key);
    const permuted = global.initPermute(block);
    let left = permuted.slice(0, 32);
    let right = permuted.slice(32, 64);
    for (let round = 15; round >= 0; round -= 1) {
      const previousLeft = left;
      left = right;
      right = global.xor(
        global.pPermute(global.sBoxPermute(global.xor(global.expandPermute(right), roundKeys[round]))),
        previousLeft
      );
    }
    return global.finallyPermute([...right, ...left]);
  }

  function bitsToText(bits) {
    let result = '';
    for (let offset = 0; offset < 64; offset += 16) {
      let code = 0;
      for (let index = 0; index < 16; index += 1) code = (code << 1) | bits[offset + index];
      result += String.fromCharCode(code);
    }
    return result;
  }

  function decrypt(value) {
    const ciphertext = String(value || '').trim().toUpperCase();
    if (!ciphertext || !/^[0-9A-F]+$/.test(ciphertext) || ciphertext.length % 16 !== 0) return '';
    if (typeof global.getKeyBytes !== 'function' || typeof global.finallyPermute !== 'function') return '';
    let plaintext = '';
    for (let offset = 0; offset < ciphertext.length; offset += 16) {
      let block = hexToBits(ciphertext.slice(offset, offset + 16));
      for (let keyIndex = KEYS.length - 1; keyIndex >= 0; keyIndex -= 1) {
        const keyBlocks = global.getKeyBytes(KEYS[keyIndex]);
        for (let blockIndex = keyBlocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
          block = decryptBlock(block, keyBlocks[blockIndex]);
        }
      }
      plaintext += bitsToText(block);
    }
    plaintext = plaintext.replace(/\0+$/g, '');
    if (typeof global.strEnc !== 'function' || global.strEnc(plaintext).toUpperCase() !== ciphertext) return '';
    return plaintext;
  }

  function isReasonablePassword(value) {
    const password = String(value || '');
    if (!password || password.length > 256) return false;
    if (/^[\x20-\x7e]+$/.test(password)) return true;
    return /[\x21-\x7e]/.test(password) && /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u.test(password);
  }

  global.BjtuVePasswordCipher = { decrypt, isReasonablePassword };
})(globalThis);
