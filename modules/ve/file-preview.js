(function initVeFilePreview(global) {
  'use strict';

  const enabledKey = 'veOnlinePreviewEnabled';
  const typesKey = 'veOnlinePreviewTypes';
  const groups = Object.freeze({
    image: { label: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif'] },
    audio: { label: '音频', extensions: ['mp3'] },
    video: { label: '视频', extensions: ['mp4', 'avi', 'wmv', 'mov', 'rmvb', 'flv', 'f4v'] },
    pdf: { label: 'PDF', extensions: ['pdf'] },
    txt: { label: 'TXT', extensions: ['txt'] },
    document: { label: '文档', extensions: ['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx'] },
    archive: { label: '压缩包', extensions: ['rar', 'zip'] }
  });
  const defaultTypes = Object.freeze(['document', 'archive']);
  let enabled = true;
  let selectedTypes = new Set(defaultTypes);
  function applySettings(settings) {
    if (Object.hasOwn(settings, enabledKey)) enabled = settings[enabledKey] !== false;
    if (Object.hasOwn(settings, typesKey)) {
      selectedTypes = new Set(Array.isArray(settings[typesKey]) ? settings[typesKey] : defaultTypes);
    }
  }
  const ready = chrome.storage.local.get([enabledKey, typesKey]).then(applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const settings = {};
    for (const key of [enabledKey, typesKey]) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
    applySettings(settings);
    syncOptions();
  });

  function previewUrl(href, fileName = '') {
    if (!enabled) return '';
    let url;
    try { url = new URL(href); } catch { return ''; }
    if (url.protocol !== 'http:' || url.hostname !== '123.121.147.7' || url.port !== '8081'
        || !/^\/rp(?:\/|$)/i.test(url.pathname)) return '';
    const names = [fileName, decodeURIComponent(url.pathname), url.searchParams.get('fileName') || ''];
    const extension = names.map((name) => /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase()).find(Boolean);
    const group = Object.keys(groups).find((key) => groups[key].extensions.includes(extension));
    if (!selectedTypes.has(group)) return '';
    const base64 = btoa(Array.from(new TextEncoder().encode(href), (byte) => String.fromCharCode(byte)).join(''));
    return `http://123.121.147.7:1936/kk/onlinePreview?url=${encodeURIComponent(base64)}`;
  }

  function onFileClick(event) {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download')) return;
    const row = link.closest('.file-item');
    const fileName = link.dataset.filename || row?.querySelector('.resource-name, .saved-upload-name, strong')?.textContent || '';
    const url = previewUrl(link.getAttribute('href'), fileName);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    global.open(url, '_blank', 'noopener,noreferrer');
  }
  document.addEventListener('click', onFileClick, true);
  document.addEventListener('auxclick', onFileClick, true);

  function syncOptions() {
    const toggle = document.getElementById(enabledKey);
    if (!toggle) return;
    toggle.checked = enabled;
    for (const checkbox of document.querySelectorAll('[data-ve-preview-type]')) {
      checkbox.checked = selectedTypes.has(checkbox.dataset.vePreviewType);
      checkbox.disabled = !enabled;
    }
  }
  async function initOptions() {
    await ready;
    const toggle = document.getElementById(enabledKey);
    const list = document.getElementById(typesKey);
    if (!toggle || !list) return;
    for (const [key, group] of Object.entries(groups)) {
      const label = document.createElement('label');
      label.title = group.extensions.map((extension) => `.${extension}`).join('、');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.vePreviewType = key;
      label.append(checkbox, group.label);
      list.appendChild(label);
      checkbox.addEventListener('change', () => {
        const values = [...list.querySelectorAll('input:checked')].map((item) => item.dataset.vePreviewType);
        void chrome.storage.local.set({ [typesKey]: values });
      });
    }
    toggle.addEventListener('change', () => { void chrome.storage.local.set({ [enabledKey]: toggle.checked }); });
    syncOptions();
    global.BjtuOptionTips?.setup();
  }
  global.BjtuVeFilePreview = Object.freeze({
    ready, previewUrl, initOptions,
    resetOptions: () => chrome.storage.local.set({ [enabledKey]: true, [typesKey]: [...defaultTypes] })
  });
})(globalThis);
