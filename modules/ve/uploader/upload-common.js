(function initVeUploadCommon(global) {
  'use strict';

  const extensions = Object.freeze([
    'ppt', 'pptx', 'doc', 'docx', 'pdf', 'txt', 'xls', 'xlsx',
    'jpg', 'jpeg', 'png', 'bmp', 'gif',
    'mp3', 'mp4', 'avi', 'wmv', 'mov', 'rmvb', 'flv', 'f4v',
    'rar', 'zip'
  ]);
  const extensionSet = new Set(extensions);
  const fileHashes = new WeakMap();

  function fileHash(file) {
    if (!fileHashes.has(file)) {
      const pending = file.arrayBuffer()
        .then((buffer) => global.crypto.subtle.digest('SHA-256', buffer))
        .then((digest) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
        .catch((error) => {
          fileHashes.delete(file);
          throw error;
        });
      fileHashes.set(file, pending);
    }
    return fileHashes.get(file);
  }

  function fileExtension(file) {
    const name = String(file?.name || '').replace(/\\/g, '/').split('/').pop() || '';
    const index = name.lastIndexOf('.');
    return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : '';
  }

  function confirmUnsupportedFiles(files) {
    const unsupported = Array.from(files || []).filter((file) => !extensionSet.has(fileExtension(file)));
    if (!unsupported.length) return true;
    const shownNames = unsupported.slice(0, 12).map((file) => `• ${String(file?.name || '(未命名文件)')}`);
    if (unsupported.length > shownNames.length) shownNames.push(`• 以及另外 ${unsupported.length - shownNames.length} 个文件`);
    return global.confirm([
      '以下文件的后缀不在智慧课程平台支持范围内：', '', ...shownNames, '',
      `支持的后缀：${extensions.join('、')}`, '',
      '平台可能拒绝或无法正常使用这些文件，是否仍继续上传？'
    ].join('\n'));
  }

  function uploadUrl(roleName, jsessionid = '') {
    const base = 'http://123.121.147.7:88/ve/back/rp/common/';
    if (!/教师|老师|助教/.test(String(roleName || ''))) return `${base}homeworkUpload.shtml?noteId=1`;
    return `${base}rpUpload.shtml${jsessionid ? `;jsessionid=${encodeURIComponent(jsessionid)}` : ''}`;
  }

  function fileListItem(item) {
    const visitName = String(item?.visitName || '').trim();
    if (!visitName) return null;
    const name = String(item?.fileName || '').trim();
    const index = name.lastIndexOf('.');
    const hasExtension = index > 0 && index < name.length - 1;
    const fileNameNoExt = hasExtension ? name.slice(0, index) : name;
    const fileExtName = hasExtension ? name.slice(index + 1) : '';
    return {
      fileNameNoExt: encodeURIComponent(fileNameNoExt),
      fileExtName,
      fileSize: String(Math.max(0, Number(item?.fileSize || 0) || 0)),
      visitName,
      pid: '',
      ftype: 'insert'
    };
  }

  function downloadUrl(visitName) {
    const path = String(visitName || '').trim().replace(/^W:\\Root\\?/i, '').replace(/\\/g, '/').replace(/^\/+/, '');
    return path ? `http://123.121.147.7:8081/${path}` : '';
  }

  function clipboardFiles(data) {
    const files = Array.from(data?.files || []);
    if (files.length) return files;
    return Array.from(data?.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter(Boolean);
  }

  async function readClipboardFiles() {
    // 原生粘贴事件可保留文件名，并读取异步 Clipboard API 不暴露的文件列表。
    const target = document.createElement('div');
    target.contentEditable = 'true';
    target.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    const previousFocus = document.activeElement;
    let nativeFiles = [];
    target.addEventListener('paste', (event) => {
      nativeFiles = clipboardFiles(event.clipboardData);
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    document.body.append(target);
    try {
      target.focus({ preventScroll: true });
      document.execCommand('paste');
    } catch { /* 继续使用异步剪贴板接口 */ }
    finally {
      target.remove();
      previousFocus?.focus?.({ preventScroll: true });
    }
    if (nativeFiles.length) return { files: nativeFiles, textCount: 0 };

    const entries = await navigator.clipboard.read();
    const files = [];
    let textCount = 0;
    for (const entry of entries) {
      const types = Array.from(entry.types || []);
      const binaryType = types.find((type) => type.startsWith('image/'))
        || types.find((type) => !type.startsWith('text/'));
      if (binaryType) {
        const blob = await entry.getType(binaryType);
        const extension = binaryType.split('/')[1]?.split(';')[0] || 'bin';
        files.push(new File([blob], `粘贴文件.${extension}`, { type: binaryType }));
        continue;
      }
      const textType = types.includes('text/html') ? 'text/html'
        : types.includes('text/plain') ? 'text/plain' : '';
      if (!textType) continue;
      const blob = await entry.getType(textType);
      if (!(await blob.text()).trim()) continue;
      files.push(new File([blob], `粘贴内容.${textType === 'text/html' ? 'html' : 'txt'}`, { type: textType }));
      textCount += 1;
    }
    return { files, textCount };
  }

  global.BjtuVeUploadCommon = Object.freeze({
    extensions,
    accept: extensions.map((extension) => `.${extension}`).join(','),
    fileExtension,
    fileHash,
    confirmUnsupportedFiles,
    uploadUrl,
    fileListItem,
    downloadUrl,
    clipboardFiles,
    readClipboardFiles
  });
})(globalThis);
