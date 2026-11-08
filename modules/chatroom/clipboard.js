/* Clipboard reader for the chat composer.
 * Files keep their clipboard MIME type; plain text is left for the caller to
 * turn into a Markdown attachment. HTML-only clipboard entries are flattened
 * to text because the composer never uploads raw markup as a message.
 */
(() => {
  'use strict';
  if (globalThis.BjtuChatroomClipboard) return;

  function fileName(extension = 'md') {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    return `粘贴内容-${stamp}.${extension}`;
  }

  function extensionFor(type) {
    const subtype = String(type || '').split('/')[1]?.split(';')[0] || 'bin';
    return subtype.replace(/[^a-z0-9.+-]/gi, '').replace('+xml', '') || 'bin';
  }

  function htmlToPlainText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
    for (const block of doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre')) block.append('\n');
    return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function read() {
    let entries = null;
    if (navigator.clipboard?.read) {
      try { entries = await navigator.clipboard.read(); }
      catch (error) { if (!navigator.clipboard?.readText) throw error; }
    }
    if (!entries) {
      const text = navigator.clipboard?.readText ? await navigator.clipboard.readText() : '';
      return { files: [], text };
    }

    const files = [];
    let text = '';
    for (const entry of entries) {
      const types = Array.from(entry.types || []);
      const binary = types.find(type => !type.startsWith('text/'));
      if (binary) {
        const blob = await entry.getType(binary);
        files.push(new File([blob], fileName(extensionFor(binary)), { type: binary }));
        continue;
      }
      const textType = types.includes('text/plain') ? 'text/plain'
        : types.find(type => type.startsWith('text/')) || '';
      if (!textType) continue;
      const value = await (await entry.getType(textType)).text();
      if (!value.trim()) continue;
      text = textType === 'text/html' ? htmlToPlainText(value) : value;
    }
    return { files, text };
  }

  globalThis.BjtuChatroomClipboard = Object.freeze({ read, fileName });
})();
