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
    const progress = globalThis.BjtuDownloadProgress.begin({name,source:'智慧课程平台作业包',total,path});
    let loaded = 0;
    try {
      const track = new TransformStream({transform(chunk, controller) {
        loaded += chunk.byteLength; progress.update(loaded);
        controller.enqueue(chunk);
      }});
      await response.body.pipeThrough(track).pipeTo(await handle.createWritable());
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
  const report = error => showToast(error?.message || String(error), 'error');
  const transfers = new Map(), transferRows = new Map();
  let revision = 0;
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
  }
  function renderFile({directory, handle, name, path, size, savedAt}) {
    const row = document.createElement('div');
    row.className = 'file-item extension-download-row'; row.dataset.path = `downloads/${path}`;
    const title = rowTitle(row,path);
    const sizeNode = span('resource-time-inline file-size-emphasis',BjtuFileSizeEmphasis.formatBytes(size));
    BjtuFileSizeEmphasis.applyBytes(sizeNode,size);
    const time = span('resource-time-inline');
    time.append('保存时间：');
    const date = span('');
    BjtuDateTime.set(date,savedAt); time.append(date);
    title.append(sizeNode,time);
    const controls = document.createElement('div'); controls.className = 'resource-link-row extension-download-actions';
    actionButton(controls,'打开','resource-download-btn',() => openFile(handle,name));
    actionButton(controls,'另存','resource-download-btn',() => exportFile(handle,name,true));
    actionButton(controls,'删除','resource-download-btn is-cancel',async () => {
      if (!confirm(`删除扩展下载中的「${path}」？此操作无法撤销。`)) return;
      await directory.removeEntry(name);
      changed(); await refresh();
    });
    row.append(controls);
    return row;
  }
  function updateProgress(bar,meta,{loaded,total,speed},label) {
    const percent = total > 0 ? Math.min(100,loaded / total * 100) : null;
    bar.classList.toggle('is-indeterminate',percent === null);
    bar.firstElementChild.style.width = percent === null ? '' : `${percent}%`;
    const size = span('resource-dl-size');
    size.innerHTML = renderFileSizePair(loaded,total);
    const rate = span('resource-dl-speed file-size-emphasis',`${BjtuFileSizeEmphasis.formatBytes(speed)}/s`);
    BjtuFileSizeEmphasis.applyBytes(rate,speed);
    meta.replaceChildren(...(label ? [span('resource-dl-status',label)] : []),size,
      ...(percent === null ? [] : [span('',`${Math.floor(percent)}%`)]),rate);
  }
  function syncSavedRows() {
    const paths = new Set([...transfers.values()].map(task => task.path).filter(Boolean));
    for (const row of list.children) row.hidden = paths.has(row.dataset.path);
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
        rowTitle(row,task.name);
        const progress = document.createElement('div'); progress.className = 'resource-download-progress';
        progress.innerHTML = '<div class="progress-bar-container"><div class="progress-bar"></div></div><div class="resource-download-meta"></div>';
        row.append(progress); active.append(row); transferRows.set(id,row);
      }
      row.querySelector('.resource-name').textContent = task.name;
      updateProgress(row.querySelector('.progress-bar-container'),row.querySelector('.resource-download-meta'),task,task.source + (task.status ? ` · ${task.status}` : ''));
      total.loaded += task.loaded; total.total += task.total; total.speed += task.speed;
      indeterminate ||= !task.total;
    }
    footer.hidden = transfers.size === 0;
    if (!footer.hidden) updateProgress(totalBar,totals,{...total,total:indeterminate ? 0 : total.total},`正在处理 ${transfers.size} 个文件`);
    syncSavedRows();
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
      entries.sort((a,b) => a.path.localeCompare(b.path,'zh-CN',{numeric:true}));
      list.replaceChildren(...entries.map(renderFile));
      syncSavedRows();
      status.textContent = entries.length ? `共 ${entries.length} 个文件` : '暂无下载文件';
    } catch (error) {
      if (current !== revision) return;
      list.replaceChildren();
      status.textContent = error.name === 'NotFoundError' ? '暂无下载文件' : `无法读取下载文件：${error.message}`;
    }
  }
  const update = () => void refresh().catch(report);
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
    }
  };
  channel.postMessage({type:'request-progress'});
  window.addEventListener('pagehide',event => { if (!event.persisted) channel.close(); });
  update();
})();
