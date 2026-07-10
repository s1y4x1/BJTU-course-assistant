(function initBjtuUpdateFileSystem(global) {
  'use strict';

  const INSTALL_LOCK_NAME = 'bjtu-course-assistant-update-install';
  const INVALID_STATE_RETRY_DELAYS = [80, 200];

  function isInvalidStateError(error) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || error || '').toLowerCase();
    return name === 'invalidstateerror'
      || message.includes('state cached in an interface object')
      || message.includes('state had changed since it was read from disk');
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function retryInvalidState(operation) {
    let lastError = null;
    for (let attempt = 0; attempt <= INVALID_STATE_RETRY_DELAYS.length; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        if (!isInvalidStateError(error) || attempt >= INVALID_STATE_RETRY_DELAYS.length) throw error;
        await wait(INVALID_STATE_RETRY_DELAYS[attempt]);
      }
    }
    throw lastError;
  }

  async function withInstallLock(operation) {
    if (typeof operation !== 'function') throw new TypeError('更新安装任务无效');
    const lockManager = global.navigator?.locks;
    if (!lockManager || typeof lockManager.request !== 'function') return operation();
    return lockManager.request(INSTALL_LOCK_NAME, { mode: 'exclusive' }, operation);
  }

  async function writeFile(root, relativePath, bytes) {
    if (!root) throw new Error('尚未授权更新目录');
    const parts = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
      throw new Error(`更新文件路径无效：${relativePath}`);
    }
    return retryInvalidState(async () => {
      let directory = root;
      for (const part of parts.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(part, { create: true });
      }
      const fileHandle = await directory.getFileHandle(parts.at(-1), { create: true });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(bytes);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch(() => {});
        throw error;
      }
    });
  }

  async function removeEntry(root, name, options = { recursive: true }) {
    if (!root) throw new Error('尚未授权更新目录');
    return retryInvalidState(async () => {
      try {
        await root.removeEntry(name, options);
      } catch (error) {
        if (String(error?.name || '').toLowerCase() === 'notfounderror') return;
        throw error;
      }
    });
  }

  global.BjtuUpdateFileSystem = {
    isInvalidStateError,
    retryInvalidState,
    withInstallLock,
    writeFile,
    removeEntry
  };
})(globalThis);
