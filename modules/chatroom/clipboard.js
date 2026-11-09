/* Clipboard reader for the chat composer. The shared clipboard module keeps
 * file extraction and plain-text conversion identical to the VE uploader;
 * chat only asks it to name plain-text attachments with a `.md` extension. */
(() => {
  'use strict';
  if (globalThis.BjtuChatroomClipboard) return;

  async function read() {
    if (!globalThis.BjtuClipboardFiles?.read) throw new Error('剪贴板读取组件未加载。');
    return globalThis.BjtuClipboardFiles.read({ plainTextExtension: 'md' });
  }

  globalThis.BjtuChatroomClipboard = Object.freeze({ read });
})();
