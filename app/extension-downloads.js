(() => {
  'use strict';
  const channelName = 'bjtu-extension-downloads';
  async function writableRoot() {
    await globalThis.__bjtuUpdaterReady;
    const root = await globalThis.BjtuUpdateFileSystem?.readDirectoryHandle();
    return root && await root.queryPermission({mode:'readwrite'}) === 'granted' ? root : null;
  }
  function changed() {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage('changed'); channel.close();
  }
  async function saveResponse(root, response, filename) {
    if (!response.body) throw new Error('下载响应没有文件内容');
    filename = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '') || '下载文件';
    const directory = await root.getDirectoryHandle('downloads', {create:true});
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0,dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '';
    const {name, handle} = await navigator.locks.request('bjtu-extension-download-name', async () => {
      for (let index = 0; ; index++) {
        const name = index ? `${stem} (${index})${extension}` : filename;
        try { await directory.getFileHandle(name); }
        catch (error) {
          if (error.name === 'TypeMismatchError') continue;
          if (error.name !== 'NotFoundError') throw error;
          return {name, handle:await directory.getFileHandle(name, {create:true})};
        }
      }
    });
    try {
      await response.body.pipeTo(await handle.createWritable());
    } catch (error) {
      await directory.removeEntry(name).catch(() => {});
      throw error;
    }
    changed();
    return {ok:true, destination:'extension-downloads', filename:name, path:`downloads/${name}`, bytes:(await handle.getFile()).size};
  }
  globalThis.BjtuExtensionDownloads = {writableRoot, saveResponse};

  const section = document.getElementById('extension-downloads-section');
  if (!section) return;
  const list = section.querySelector('.resource-space-list');
  const status = section.querySelector('.resource-space-status');
  const refreshButton = section.querySelector('button');
  const report = error => showToast(error?.message || String(error), 'error');
  let revision = 0;
  async function* files(directory, prefix = '') {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === 'directory') yield* files(handle, prefix + name + '/');
      else yield {directory, handle, name, path:prefix + name};
    }
  }
  function renderFile({directory, handle, name, path, size}) {
    const row = document.createElement('div');
    row.className = 'file-item extension-download-row';
    const title = document.createElement('span');
    title.className = 'extension-download-name'; title.textContent = path;
    const meta = document.createElement('span');
    meta.className = 'file-size-emphasis'; meta.dataset.fileSizeBytes = String(size);
    meta.textContent = globalThis.BjtuFileSizeEmphasis.formatBytes(size);
    globalThis.BjtuFileSizeEmphasis.applyBytes(meta, size);
    const controls = document.createElement('div');
    controls.className = 'extension-download-actions';
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'btn'; save.textContent = '下载';
    save.onclick = async () => {
      try {
        const url = URL.createObjectURL(await handle.getFile());
        try {
          await chrome.downloads.download({url, filename:name, conflictAction:'uniquify'});
        } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
      } catch (error) { report(error); }
    };
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn extension-download-delete'; remove.textContent = '删除';
    remove.onclick = async () => {
      if (!confirm(`删除扩展下载中的「${path}」？此操作无法撤销。`)) return;
      try {
        await directory.removeEntry(name);
        changed(); await refresh();
      } catch (error) { report(error); }
    };
    controls.append(save, remove);
    row.append(title, meta, controls);
    return row;
  }
  async function refresh() {
    const current = ++revision;
    const [settings, root] = await Promise.all([
      chrome.storage.local.get({chatroomManageDownloadsEnabled:true}), writableRoot()
    ]);
    if (current !== revision) return;
    section.hidden = !settings.chatroomManageDownloadsEnabled || !root;
    if (section.hidden) return;
    try {
      const directory = await root.getDirectoryHandle('downloads');
      const entries = [];
      for await (const entry of files(directory)) {
        try { entries.push({...entry, size:(await entry.handle.getFile()).size}); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
      if (current !== revision) return;
      entries.sort((a,b) => a.path.localeCompare(b.path, 'zh-CN', {numeric:true}));
      list.replaceChildren(...entries.map(renderFile));
      status.textContent = entries.length ? `共 ${entries.length} 个文件` : '暂无下载文件';
    } catch (error) {
      if (current !== revision) return;
      list.replaceChildren();
      status.textContent = error.name === 'NotFoundError' ? '暂无下载文件' : `无法读取下载文件：${error.message}`;
    }
  }
  const update = () => void refresh().catch(report);
  refreshButton.onclick = update;
  window.addEventListener('focus', update);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.chatroomManageDownloadsEnabled) update();
  });
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = update;
  window.addEventListener('pagehide', () => channel.close(), {once:true});
  update();
})();
