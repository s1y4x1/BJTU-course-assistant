(function initClipboardFiles(global) {
  'use strict';

  if (global.BjtuClipboardFiles) return;

  function clipboardFiles(data) {
    const files = Array.from(data?.files || []);
    if (files.length) return files;
    return Array.from(data?.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter(Boolean);
  }

  function timestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  }

  function extensionFor(type) {
    const subtype = String(type || '').split('/')[1]?.split(';')[0] || 'bin';
    return subtype.replace(/[^a-z0-9.+-]/gi, '').replace('+xml', '') || 'bin';
  }

  async function nativeFiles() {
    if (!document.body) return [];
    const target = document.createElement('div');
    target.contentEditable = 'true';
    target.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    const previousFocus = document.activeElement;
    let files = [];
    target.addEventListener('paste', (event) => {
      files = clipboardFiles(event.clipboardData);
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
    return files;
  }

  async function read({ plainTextExtension = 'txt' } = {}) {
    const textExtension = plainTextExtension === 'md' ? 'md' : 'txt';
    const files = await nativeFiles();
    if (files.length) return { files, textCount: 0 };

    let entries = null;
    if (navigator.clipboard?.read) {
      try { entries = await navigator.clipboard.read(); }
      catch (error) { if (!navigator.clipboard?.readText) throw error; }
    }
    if (!entries) {
      const text = navigator.clipboard?.readText ? await navigator.clipboard.readText() : '';
      if (!text.trim()) return { files: [], textCount: 0 };
      return {
        files: [new File([text], `粘贴内容.${textExtension}`, {
          type: textExtension === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8'
        })],
        textCount: 1
      };
    }

    const result = [];
    let textCount = 0;
    for (const entry of entries) {
      const types = Array.from(entry.types || []);
      const binaryType = types.find((type) => type.startsWith('image/'))
        || types.find((type) => !type.startsWith('text/'));
      if (binaryType) {
        const blob = await entry.getType(binaryType);
        result.push(new File([blob], `粘贴文件.${extensionFor(binaryType)}`, { type: binaryType }));
        continue;
      }
      const textType = types.includes('text/html') ? 'text/html'
        : types.includes('text/plain') ? 'text/plain' : '';
      if (!textType) continue;
      const blob = await entry.getType(textType);
      if (!(await blob.text()).trim()) continue;
      const isPlain = textType === 'text/plain';
      const extension = isPlain ? textExtension : 'html';
      result.push(new File([blob], `粘贴内容.${extension}`, {
        type: isPlain
          ? (extension === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8')
          : 'text/html;charset=utf-8'
      }));
      textCount += 1;
    }
    return { files: result, textCount };
  }

  global.BjtuClipboardFiles = Object.freeze({ read, clipboardFiles });
})(globalThis);
