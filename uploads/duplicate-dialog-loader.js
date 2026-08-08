(function loadUploadDuplicateDialog(global) {
  'use strict';

  global.__bjtuUploadDuplicateDialogReady = (async () => {
    if (document.getElementById('upload-duplicate-modal')) return true;
    const response = await fetch(chrome.runtime.getURL('uploads/duplicate-dialog.html'), {
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`无法加载重复文件确认弹窗：HTTP ${response.status}`);
    const holder = document.createElement('template');
    holder.innerHTML = await response.text();
    document.body.appendChild(holder.content.cloneNode(true));
    return !!document.getElementById('upload-duplicate-modal');
  })().catch((error) => {
    console.error('[bjtu] upload duplicate dialog failed to load:', error);
    return false;
  });
})(globalThis);
