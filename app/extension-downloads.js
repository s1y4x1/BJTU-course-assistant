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
    const path = `downloads/${name}`, total = Number(response.headers.get('content-length')) || 0;
    const abort = new AbortController();
    const progress = globalThis.BjtuDownloadProgress.begin({
      name,source:'智慧课程平台作业包',total,path,cancel:() => abort.abort()
    });
    let loaded = 0;
    try {
      const track = new TransformStream({transform(chunk, controller) {
        loaded += chunk.byteLength; progress.update(loaded);
        controller.enqueue(chunk);
      }});
      await response.body.pipeThrough(track).pipeTo(await handle.createWritable(),{signal:abort.signal});
    } catch (error) {
      await directory.removeEntry(name).catch(() => {});
      throw error;
    } finally { progress.finish(); }
    return {ok:true, destination:'extension-downloads', filename:name, path, bytes:loaded};
  }
  globalThis.BjtuExtensionDownloads = {writableRoot, saveResponse};

  const section = document.getElementById('extension-downloads-section');
  if (!section) return;
  const list = section.querySelector('.resource-space-list:last-child');
  const active = section.querySelector('.extension-download-active');
  const status = section.querySelector('.resource-space-status');
  const footer = section.querySelector('.resource-space-footer');
  const totals = footer.querySelector('.resource-total-meta');
  const totalBar = footer.querySelector('.progress-bar-container');
  const invert = document.getElementById('extension-download-invert');
  const dedup = document.getElementById('extension-download-dedup');
  const uploadSelected = document.getElementById('extension-download-upload-selected');
  const deleteSelected = document.getElementById('extension-download-delete-selected');
  const report = error => showToast(error?.message || String(error), 'error');
  const transfers = new Map(), transferRows = new Map();
  const selected = new Set();
  let saved = [], revision = 0, working = false;
  async function* files(directory, prefix = '') {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === 'directory') yield* files(handle, prefix + name + '/');
      else yield {directory, handle, name, path:prefix + name};
    }
  }
  function span(className, text = '') {
    const node = document.createElement('span');
    node.className = className; node.textContent = text;
    return node;
  }
  function rowTitle(row, name) {
    const title = document.createElement('div'); title.className = 'resource-row-title';
    title.append(span('resource-name',name)); row.append(title);
    return title;
  }
  const previewTypes = {
    pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp',
    webp:'image/webp', avif:'image/avif', mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
    mp4:'video/mp4', webm:'video/webm', txt:'text/plain', md:'text/plain', csv:'text/plain',
    json:'text/plain', html:'text/plain', htm:'text/plain', svg:'text/plain', xml:'text/plain',
    js:'text/plain', css:'text/plain', py:'text/plain', log:'text/plain'
  };
  async function exportFile(handle,name,saveAs) {
    const url = URL.createObjectURL(await handle.getFile());
    try { await chrome.downloads.download({url,filename:name,conflictAction:'uniquify',saveAs}); }
    finally { setTimeout(() => URL.revokeObjectURL(url),60000); }
  }
  async function openFile(handle,name) {
    const type = previewTypes[name.split('.').pop().toLowerCase()];
    if (!type) return exportFile(handle,name,false);
    const file = await handle.getFile();
    const url = URL.createObjectURL(file.slice(0,file.size,type));
    try {
      const tab = await chrome.tabs.create({url});
      const cleanup = tabId => {
        if (tabId !== tab.id) return;
        chrome.tabs.onRemoved.removeListener(cleanup); URL.revokeObjectURL(url);
      };
      chrome.tabs.onRemoved.addListener(cleanup);
    } catch (error) { URL.revokeObjectURL(url); throw error; }
  }
  function actionButton(controls,text,className,action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `btn ${className}`; button.textContent = text;
    button.onclick = () => void action().catch(report);
    controls.append(button);
    return button;
  }
  async function uploadFiles(entries) {
    await globalThis.processFilesForUpload(await Promise.all(entries.map(entry => entry.handle.getFile())));
  }
  function availableFiles() {
    const reserved = new Set([...transfers.values()].map(task => task.path));
    return saved.filter(entry => !reserved.has(`downloads/${entry.path}`));
  }
  function syncSelection() {
    const entries = availableFiles();
    const any = entries.some(entry => selected.has(entry.path));
    uploadSelected.disabled = deleteSelected.disabled = working || !any;
    invert.disabled = working || !entries.length;
    dedup.disabled = working || transfers.size > 0 || entries.length < 2;
    for (const checkbox of list.querySelectorAll('input[type=checkbox]')) {
      checkbox.checked = selected.has(checkbox.value);
      checkbox.disabled = working;
    }
  }
  function renderFile(entry) {
    const {handle, name, path, size, savedAt} = entry;
    const row = document.createElement('div');
    row.className = 'file-item extension-download-row'; row.dataset.path = `downloads/${path}`;
    const title = rowTitle(row,path);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.value = path;
    checkbox.setAttribute('aria-label',`选择 ${name}`);
    checkbox.onchange = () => {
      if (checkbox.checked) selected.add(path); else selected.delete(path);
      syncSelection();
    };
    title.prepend(checkbox);
    const sizeNode = span('resource-time-inline file-size-emphasis',BjtuFileSizeEmphasis.formatBytes(size));
    BjtuFileSizeEmphasis.applyBytes(sizeNode,size);
    const time = span('resource-time-inline');
    time.append('保存时间：');
    const date = span('');
    BjtuDateTime.set(date,savedAt); time.append(date);
    title.append(sizeNode,time);
    const controls = document.createElement('div'); controls.className = 'resource-link-row extension-download-actions';
    const link = document.createElement('a');
    link.className = 'resource-url';
    link.href = `#${encodeURIComponent(path)}`;
    link.textContent = chrome.runtime.getURL(`downloads/${path.split('/').map(encodeURIComponent).join('/')}`);
    const open = event => {
      if (event.button > 1) return;
      event.preventDefault(); void openFile(handle,name).catch(report);
    };
    link.onclick = link.onauxclick = open;
    controls.append(link);
    actionButton(controls,'上传','resource-copy-btn',() => uploadFiles([entry]));
    actionButton(controls,'另存','resource-download-btn',() => exportFile(handle,name,true));
    actionButton(controls,'删除','resource-download-btn is-cancel',() => deleteFiles([entry]));
    row.append(controls);
    return row;
  }
  function remaining(loaded,total,speed) {
    if (total > 0 && loaded >= total) return '0 秒';
    if (!total || !speed) return '估算中…';
    const seconds = Math.ceil((total - loaded) / speed);
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60;
    return `${hours ? hours + ' 小时 ' : ''}${minutes ? minutes + ' 分 ' : ''}${seconds % 60} 秒`;
  }
  function updateProgress(bar,meta,{loaded,total,speed},label,{aggregate = false,idle = false} = {}) {
    const percent = idle ? 0 : total > 0 ? Math.min(100,loaded / total * 100) : null;
    bar.classList.toggle('is-indeterminate',percent === null);
    bar.firstElementChild.style.width = percent === null ? '' : `${percent}%`;
    const size = span(aggregate ? 'resource-total-size' : 'resource-dl-size');
    size.innerHTML = renderFileSizePair(loaded,total);
    const rate = span('resource-dl-speed file-size-emphasis',`${BjtuFileSizeEmphasis.formatBytes(speed)}/s`);
    BjtuFileSizeEmphasis.applyBytes(rate,speed);
    meta.replaceChildren(...(label ? [span('resource-dl-status',label)] : []),size,
      ...(idle || percent === null ? [] : [span('',`${Math.floor(percent)}%`)]),rate,
      ...(idle ? [] : [span('resource-dl-eta',`${aggregate ? '总剩余' : '剩余时间'}：${remaining(loaded,total,speed)}`)]));
  }
  function syncSavedRows() {
    const paths = new Set([...transfers.values()].map(task => task.path).filter(Boolean));
    for (const row of list.children) row.hidden = paths.has(row.dataset.path);
    syncSelection();
  }
  function renderTransfers() {
    for (const [id,row] of transferRows) if (!transfers.has(id)) {
      row.remove(); transferRows.delete(id);
    }
    const total = {loaded:0,total:0,speed:0};
    let indeterminate = false;
    for (const [id,task] of transfers) {
      let row = transferRows.get(id);
      if (!row) {
        row = document.createElement('div'); row.className = 'file-item extension-download-row';
        const title = rowTitle(row,task.name);
        if (task.cancellable) actionButton(title,'取消','resource-download-btn is-cancel extension-download-cancel',async () => {
          title.querySelector('button').disabled = true;
          channel.postMessage({type:'cancel-progress',id});
        });
        const progress = document.createElement('div'); progress.className = 'resource-download-progress';
        progress.innerHTML = '<div class="progress-bar-container"><div class="progress-bar"></div></div><div class="resource-download-meta"></div>';
        row.append(progress); active.append(row); transferRows.set(id,row);
      }
      row.querySelector('.resource-name').textContent = task.name;
      updateProgress(row.querySelector('.progress-bar-container'),row.querySelector('.resource-download-meta'),task,task.source + (task.status ? ` · ${task.status}` : ''));
      total.loaded += task.loaded; total.total += task.total; total.speed += task.speed;
      indeterminate ||= !task.total;
    }
    updateProgress(totalBar,totals,{...total,total:indeterminate ? 0 : total.total},'',{aggregate:true,idle:!transfers.size});
    syncSavedRows();
  }
  async function relinkFiles(from, to) {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('BJTUCA-FileSystem',1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve,reject) => {
        const tx = db.transaction('handles','readwrite'), store = tx.objectStore('handles');
        const source = `downloads/${from.path}`, target = to && `downloads/${to.path}`;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) {
            if (to) store.put({handle:to.handle,downloadPath:target},`download-alias:${source}`);
            return;
          }
          const key = String(entry.key), value = entry.value;
          if (value?.downloadPath === source) {
            if (to) entry.update({...value,handle:to.handle,downloadPath:target,deduplicated:true});
            else if (key.startsWith('download-alias:')) entry.delete();
          }
          entry.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('无法更新本地文件引用'));
      });
    } finally { db.close(); }
  }
  async function deleteFiles(entries) {
    if (!entries.length || working) return;
    if (!confirm(`删除扩展下载中的 ${entries.length} 个文件？此操作无法撤销。`)) return;
    working = true; syncSelection();
    try {
      await navigator.locks.request('bjtu-extension-download-name',async () => {
        for (const entry of entries) {
          if (!availableFiles().includes(entry)) continue;
          await entry.directory.removeEntry(entry.name);
          await relinkFiles(entry,null);
          selected.delete(entry.path);
        }
      });
    } finally { working = false; changed(); await refresh(); }
  }
  async function fileSignature(file) {
    const parts = [];
    for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
      const buffer = await file.slice(offset,offset + 4 * 1024 * 1024).arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));
      parts.push(btoa(String.fromCharCode(...digest)));
    }
    return parts.join('');
  }
  async function deduplicate() {
    if (working || transfers.size || saved.length < 2) return;
    working = true; syncSelection();
    try {
      await navigator.locks.request('bjtu-extension-download-name',async () => {
        const sizes = new Map(), groups = new Map();
        for (const entry of availableFiles()) {
          const group = sizes.get(entry.size) || [];
          group.push(entry); sizes.set(entry.size,group);
        }
        for (const [size, entries] of sizes) {
          if (entries.length < 2) continue;
          for (const entry of entries) {
            const file = await entry.handle.getFile();
            if (file.size !== size || file.lastModified !== entry.savedAt) continue;
            const signature = size + ':' + await fileSignature(file);
            const group = groups.get(signature) || [];
            group.push(entry); groups.set(signature,group);
          }
        }
        const duplicates = [...groups.values()].filter(group => group.length > 1);
        const count = duplicates.reduce((sum,group) => sum + group.length - 1,0);
        if (!count) { showToast('没有发现重复文件','success'); return; }
        if (transfers.size || !confirm(`发现 ${count} 个重复文件。每组保留最早保存的一份，删除其他副本并更新本地引用。继续吗？`)) return;
        let removed = 0;
        for (const group of duplicates) {
          const [keep,...copies] = group.sort((a,b) => a.savedAt - b.savedAt || a.path.localeCompare(b.path));
          for (const copy of copies) {
            if (transfers.size) throw new Error('有文件开始传输，已停止继续去重');
            const [original,duplicate] = await Promise.all([keep.handle.getFile(),copy.handle.getFile()]);
            if (original.lastModified !== keep.savedAt || original.size !== keep.size ||
                duplicate.lastModified !== copy.savedAt || duplicate.size !== copy.size) continue;
            await relinkFiles(copy,keep);
            await copy.directory.removeEntry(copy.name);
            selected.delete(copy.path); removed++;
          }
        }
        showToast(`已去除 ${removed} 个重复文件`,'success');
      });
    } finally { working = false; changed(); await refresh(); }
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
        try {
          const file = await entry.handle.getFile();
          entries.push({...entry,size:file.size,savedAt:file.lastModified});
        } catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
      if (current !== revision) return;
      saved = entries.sort((a,b) => b.savedAt - a.savedAt || a.path.localeCompare(b.path,'zh-CN',{numeric:true}));
      const paths = new Set(saved.map(entry => entry.path));
      for (const path of selected) if (!paths.has(path)) selected.delete(path);
      list.replaceChildren(...saved.map(renderFile));
      syncSavedRows();
      status.textContent = entries.length ? `共 ${entries.length} 个文件` : '暂无下载文件';
    } catch (error) {
      if (current !== revision) return;
      saved = []; list.replaceChildren(); syncSelection();
      status.textContent = error.name === 'NotFoundError' ? '暂无下载文件' : `无法读取下载文件：${error.message}`;
    }
  }
  const update = () => void refresh().catch(report);
  invert.onclick = () => {
    for (const entry of availableFiles()) {
      if (selected.has(entry.path)) selected.delete(entry.path); else selected.add(entry.path);
    }
    syncSelection();
  };
  dedup.onclick = () => void deduplicate().catch(report);
  uploadSelected.onclick = () => void uploadFiles(availableFiles().filter(entry => selected.has(entry.path))).catch(report);
  deleteSelected.onclick = () => void deleteFiles(availableFiles().filter(entry => selected.has(entry.path))).catch(report);
  window.addEventListener('focus',update);
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === 'local' && changes.chatroomManageDownloadsEnabled) update();
  });
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = ({data}) => {
    if (data === 'changed') update();
    else if (data?.type === 'progress') {
      transfers.set(data.task.id,data.task); renderTransfers();
    } else if (data?.type === 'progress-ended' && transfers.delete(data.id)) {
      renderTransfers(); update();
    } else if (data?.type === 'cancel-progress-error' && transfers.has(data.id)) {
      const cancel = transferRows.get(data.id)?.querySelector('button');
      if (cancel) cancel.disabled = false;
      report(data.error);
    }
  };
  channel.postMessage({type:'request-progress'});
  window.addEventListener('pagehide',event => { if (!event.persisted) channel.close(); });
  renderTransfers();
  update();
})();
