(function(global) {
  'use strict';
  const defaults = Object.freeze({
    chatroomSignalingUrl: 'wss://public.localsend.org/v1/ws',
    chatroomAutoSaveEnabled: true,
    chatroomAutoSaveMaxBytes: 100000000
  });
  const units = ['B', 'KB', 'MB', 'GB'];
  function normalizeLimit(text, unit) {
    if (String(text).trim() === '') return null;
    const bytes = Number(text) * 1000 ** units.indexOf(unit);
    if (!units.includes(unit) || !Number.isFinite(bytes) || bytes < 1 || bytes > Number.MAX_SAFE_INTEGER)
      throw new Error('文件大小必须至少为 1 B，或留空表示不设限制。');
    return Math.round(bytes);
  }
  function displayLimit(bytes) {
    if (bytes === null) return {value: '', unit: 'MB'};
    const index = Math.max(0, Math.min(3, Math.floor(Math.log10(Math.max(1, bytes)) / 3)));
    return {value: String(Number((bytes / 1000 ** index).toPrecision(12))), unit: units[index]};
  }
  async function directory() {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('BJTUCA-FileSystem', 1);
      request.onupgradeneeded = () => request.transaction.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('尚未授权扩展目录，请在聊天室设置中授权。'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('handles').objectStore('handles').get('update-directory');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  async function authorizedDirectory() {
    const root = await directory();
    if (!root || await root.queryPermission({mode: 'readwrite'}) !== 'granted')
      throw new Error('自动保存需要扩展目录写入权限，请在聊天室设置中授权，或手动接收文件。');
    return root;
  }
  async function authorize() {
    let root = await directory().catch(() => null);
    if (root && await root.requestPermission({mode: 'readwrite'}) === 'granted') return root;
    root = await showDirectoryPicker({mode: 'readwrite', id: 'bjtu-ca-directory'});
    const manifest = JSON.parse(await (await root.getFileHandle('manifest.json')).getFile().then(file => file.text()));
    if (manifest.name !== chrome.runtime.getManifest().name) throw new Error('请选择 BJTU 课程助手的扩展目录。');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('BJTUCA-FileSystem', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(root, 'update-directory');
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
    return root;
  }
  async function createDownload(name) {
    const root = await authorizedDirectory();
    const downloads = await root.getDirectoryHandle('downloads', {create: true});
    // Never overwrite an existing file, including simultaneous transfers.
    return navigator.locks.request('bjtu-chatroom-download-name', async () => {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
      for (let index = 0; ; index++) {
        const filename = index ? `${stem} (${index})${ext}` : name;
        try { await downloads.getFileHandle(filename); continue; }
        catch(error) { if (error.name !== 'NotFoundError') throw error; }
        const handle = await downloads.getFileHandle(filename, {create: true});
        const writer = await handle.createWritable();
        return {writer, handle, savedPath: `downloads/${filename}`, downloads, filename};
      }
    });
  }
  async function mount(root, report) {
    const $ = id => root.querySelector('#' + id);
    const abort = new AbortController();
    const dirty = new Set(), revisions = new Map();
    let values = await chrome.storage.local.get(defaults), saveQueue = Promise.resolve();
    function render() {
      if (!dirty.has('url')) $('chatroomSignalingUrl').value = values.chatroomSignalingUrl;
      $('chatroomAutoSaveEnabled').checked = values.chatroomAutoSaveEnabled !== false;
      if (!dirty.has('limit')) {
        const limit = displayLimit(values.chatroomAutoSaveMaxBytes);
        $('chatroomAutoSaveValue').value = limit.value; $('chatroomAutoSaveUnit').value = limit.unit;
      }
      $('chatroomAutoSaveValue').disabled = $('chatroomAutoSaveUnit').disabled = values.chatroomAutoSaveEnabled === false;
    }
    function save(patch, key) {
      const version = revisions.get(key);
      saveQueue = saveQueue.catch(() => {}).then(async () => {
        if (key && version !== revisions.get(key)) return;
        await chrome.storage.local.set(patch); values = {...values, ...patch};
        if (!key || version === revisions.get(key)) dirty.delete(key);
        render();
      }).catch(report);
      return saveQueue;
    }
    function markDirty(key) { dirty.add(key); revisions.set(key, (revisions.get(key) || 0) + 1); }
    $('chatroomSignalingUrl').addEventListener('input', () => markDirty('url'), {signal: abort.signal});
    $('chatroomSignalingUrl').addEventListener('change', () => {
      try {
        const url = new URL($('chatroomSignalingUrl').value.trim() || defaults.chatroomSignalingUrl);
        if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
          throw new Error('请填写不含凭据或片段的 ws:// 或 wss:// 地址。');
        $('chatroomSignalingUrl').setCustomValidity('');
        void save({chatroomSignalingUrl: url.href}, 'url');
      } catch(error) { $('chatroomSignalingUrl').setCustomValidity(error.message); report(error); }
    }, {signal: abort.signal});
    function saveLimit() {
      try {
        if ($('chatroomAutoSaveValue').validity.badInput) throw new Error('请输入有效的文件大小，或留空表示不设限制。');
        const bytes = normalizeLimit($('chatroomAutoSaveValue').value, $('chatroomAutoSaveUnit').value);
        $('chatroomAutoSaveValue').setCustomValidity('');
        void save({chatroomAutoSaveMaxBytes: bytes}, 'limit');
      } catch(error) { $('chatroomAutoSaveValue').setCustomValidity(error.message); report(error); }
    }
    for (const id of ['chatroomAutoSaveValue', 'chatroomAutoSaveUnit']) {
      $(id).addEventListener('input', () => markDirty('limit'), {signal: abort.signal});
      $(id).addEventListener('change', saveLimit, {signal: abort.signal});
    }
    $('chatroomAutoSaveEnabled').addEventListener('change', event => {
      void save({chatroomAutoSaveEnabled: event.target.checked});
    }, {signal: abort.signal});
    $('chatroomAuthorizeDownloads').addEventListener('click', () => {
      authorize().then(() => global.BjtuOptionsMessage?.show('已授权，文件将保存到扩展目录 downloads/。', true)).catch(report);
    }, {signal: abort.signal});
    const changed = (changes, area) => {
      if (area !== 'local') return;
      for (const key of Object.keys(defaults)) if (changes[key]) values[key] = changes[key].newValue === undefined ? defaults[key] : changes[key].newValue;
      render();
    };
    chrome.storage.onChanged.addListener(changed); render();
    return {destroy() { abort.abort(); chrome.storage.onChanged.removeListener(changed); }};
  }
  global.BjtuChatroomSettings = {defaults, normalizeLimit, displayLimit, mount, createDownload};
})(globalThis);
