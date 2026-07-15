(function installBjtuStorageUtils(global) {
  'use strict';

  global.getLocal = async function getLocal(key, fallback = '') {
    const data = await chrome.storage.local.get([key]);
    return data[key] ?? fallback;
  };

  global.setLocal = async function setLocal(key, value) {
    await chrome.storage.local.set({ [key]: value });
  };
})(globalThis);
