(function initVeUploadPicker() {
  'use strict';

  const query = new URLSearchParams(location.search);
  const requestId = query.get('requestId') || '';
  const common = globalThis.BjtuVeUploadCommon;
  const input = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const fileList = document.getElementById('file-list');
  const status = document.getElementById('picker-status');
  const loginButton = document.getElementById('picker-login');
  const retryButton = document.getElementById('picker-retry');
  const errorActions = document.getElementById('picker-error-actions');
  const totalSizeInfo = document.getElementById('total-size-info');
  const totalPercent = document.getElementById('total-percent');
  const totalBar = document.getElementById('total-server-bar');
  const totalSpeed = document.getElementById('total-speed');
  const totalEta = document.getElementById('total-eta');
  let pendingFiles = [];
  let uploading = false;

  if (!requestId) {
    status.textContent = '缺少上传请求标识';
    status.classList.add('error');
    dropZone.hidden = true;
    return;
  }
  input.accept = query.get('accept') || common.accept;

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    }));
  }

  async function ensureSession() {
    const current = await sendRuntimeMessage({ type: 'VE_LOGIN_CHECK_STATUS', payload: {} });
    if (current?.userInfo?.loginName) return current.userInfo;
    const stored = await chrome.storage.local.get('username');
    const loginName = String(stored?.username || '').trim();
    if (loginName) {
      setStatus(`正在登录智慧课程平台账号 ${loginName}…`);
      const result = await sendRuntimeMessage({
        type: 'VE_LOGIN_REQUEST',
        payload: { loginName, skipCurrentCheck: true, allowStoredCredentials: true }
      });
      if (result?.ok && result?.userInfo?.loginName === loginName) return result.userInfo;
      throw new Error(result?.message || '智慧课程平台登录失败，请先在网页中登录');
    }
    throw new Error('请先登录智慧课程平台后再上传文件');
  }

  function createFileRow(file) {
    const row = document.createElement('div');
    row.className = 'file-item';
    const head = document.createElement('div');
    head.className = 'upload-file-head-row';
    const labels = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = file.name;
    const state = document.createElement('span');
    state.className = 'inline-status';
    state.textContent = '等待上传';
    const size = document.createElement('span');
    size.className = 'size-progress';
    size.textContent = `(0 B / ${formatSize(file.size)})`;
    const progress = document.createElement('div');
    progress.className = 'progress-bar-container';
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    progress.append(bar);
    labels.append(name, state, size);
    head.append(labels);
    row.append(head, progress);
    fileList.prepend(row);
    return { progress, state, bar, size };
  }

  function formatSize(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
  }

  function showDownloadLink(ui, visitName) {
    const url = common.downloadUrl(visitName);
    const linkRow = document.createElement('div');
    linkRow.className = 'upload-link-row';
    const link = document.createElement('a');
    link.className = 'url-link';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = url;
    const copyButton = document.createElement('button');
    copyButton.className = 'btn';
    copyButton.type = 'button';
    copyButton.textContent = '复制';
    copyButton.addEventListener('click', () => { void navigator.clipboard.writeText(url); });
    linkRow.append(link, copyButton);
    ui.progress.replaceWith(linkRow);
  }

  function uploadOne(file, userInfo, ui, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', common.uploadUrl(userInfo.roleName), true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Upgrade-Insecure-Requests', '1');
      ui.state.textContent = '上传中…';
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const loaded = Math.min(file.size, event.loaded);
          ui.bar.style.width = `${Math.min(100, event.loaded / event.total * 100)}%`;
          ui.size.textContent = `(${formatSize(loaded)} / ${formatSize(file.size)})`;
          onProgress(loaded);
        }
        if (event.lengthComputable && event.loaded >= event.total) ui.state.textContent = '等待服务器处理…';
      };
      xhr.onload = () => {
        if (xhr.status !== 200) {
          reject(new Error(`上传失败：HTTP ${xhr.status}`));
          return;
        }
        let data;
        try { data = JSON.parse(xhr.responseText || '{}'); }
        catch { reject(new Error(String(xhr.responseText || '上传接口返回非 JSON').trim())); return; }
        if (!data.visitName) {
          reject(new Error(String(data.ERRMSG || data.message || '上传接口未返回文件地址')));
          return;
        }
        ui.bar.style.width = '100%';
        ui.size.textContent = `(${formatSize(file.size)} / ${formatSize(file.size)})`;
        onProgress(file.size);
        ui.state.textContent = '上传完成';
        showDownloadLink(ui, data.visitName);
        resolve({ fileName: file.name, fileSize: file.size, visitName: data.visitName });
      };
      xhr.onerror = () => reject(new Error('网络请求失败'));
      xhr.onabort = () => reject(new Error('上传已取消'));
      const body = new FormData();
      body.append('file', file);
      xhr.send(body);
    });
  }

  async function upload(files) {
    if (uploading) return;
    let selected = Array.from(files || []).filter((file) => file instanceof File);
    if (!selected.length) return;
    const unsupported = selected.filter((file) => !common.extensions.includes(common.fileExtension(file)));
    if (unsupported.length && !common.confirmUnsupportedFiles(unsupported)) {
      const rejected = new Set(unsupported);
      selected = selected.filter((file) => !rejected.has(file));
      if (!selected.length) return;
    }
    pendingFiles = selected;
    uploading = true;
    dropZone.setAttribute('aria-disabled', 'true');
    errorActions.hidden = true;
    fileList.replaceChildren();
    const rows = selected.map(createFileRow);
    const loadedBytes = selected.map(() => 0);
    const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
    let lastProgressTime = Date.now();
    let lastProgressBytes = 0;
    const updateSummary = () => {
      const done = loadedBytes.reduce((sum, bytes) => sum + bytes, 0);
      const percent = totalBytes > 0 ? Math.min(100, done / totalBytes * 100) : 0;
      totalSizeInfo.textContent = `${formatSize(done)} / ${formatSize(totalBytes)}`;
      totalPercent.textContent = `${Math.round(percent)}%`;
      totalBar.style.width = `${percent}%`;
      const now = Date.now();
      const elapsed = (now - lastProgressTime) / 1000;
      if (elapsed >= 0.15) {
        const speed = Math.max(0, (done - lastProgressBytes) / elapsed);
        totalSpeed.textContent = `${formatSize(speed)}/s`;
        totalEta.textContent = speed > 0 && done < totalBytes ? `剩余: ${Math.ceil((totalBytes - done) / speed)}秒` : '';
        lastProgressTime = now;
        lastProgressBytes = done;
      }
    };
    updateSummary();
    try {
      const userInfo = await ensureSession();
      const completed = [];
      const saved = await chrome.storage.local.get(['saveUploadedFilesEnabled', 'savedUploadedFiles']);
      const knownFiles = Array.isArray(saved.savedUploadedFiles) ? saved.savedUploadedFiles : [];
      for (let index = 0; index < selected.length; index += 1) {
        try {
          const file = selected[index];
          const known = knownFiles.find((item) => item?.fileName === file.name
            && Number(item?.fileSize) === file.size && String(item?.visitName || '').trim());
          if (known && globalThis.confirm(`「${file.name}」已上传过，是否直接复用已上传文件？\n选择“取消”将重新上传。`)) {
            completed.push({ fileName: file.name, fileSize: file.size, visitName: known.visitName, reused: true });
            rows[index].bar.style.width = '100%';
            rows[index].state.textContent = '已复用上传记录';
            rows[index].size.textContent = `(${formatSize(file.size)} / ${formatSize(file.size)})`;
            showDownloadLink(rows[index], known.visitName);
            loadedBytes[index] = file.size;
            updateSummary();
          } else {
            completed.push(await uploadOne(file, userInfo, rows[index], (loaded) => {
              loadedBytes[index] = loaded;
              updateSummary();
            }));
          }
        } catch (error) {
          rows[index].state.textContent = String(error?.message || error);
          rows[index].state.classList.add('error');
          throw error;
        }
      }
      const fileListResult = completed.map(common.fileListItem).filter(Boolean);
      if (!fileListResult.length) throw new Error('未获得可提交的上传结果');
      if (saved.saveUploadedFilesEnabled !== false) {
        const entries = knownFiles;
        for (const item of completed.filter((result) => !result.reused)) {
          const entry = {
            id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            fileName: item.fileName,
            fileSize: item.fileSize,
            visitName: item.visitName,
            url: common.downloadUrl(item.visitName),
            savedAt: Date.now()
          };
          const index = entries.findIndex((known) => known?.visitName === item.visitName);
          if (index >= 0) entries[index] = entry;
          else entries.unshift(entry);
        }
        try { await chrome.storage.local.set({ savedUploadedFiles: entries }); } catch { /* 保存记录失败不影响上传结果 */ }
      }
      setStatus('上传完成，正在返回结果…');
      totalSpeed.textContent = '0 KB/s';
      totalEta.textContent = '';
      await sendRuntimeMessage({ type: 'VE_UPLOAD_PICKER_RESULT', requestId, value: { fileList: fileListResult } });
      globalThis.close();
    } catch (error) {
      setStatus(String(error?.message || error), true);
      errorActions.hidden = false;
    } finally {
      uploading = false;
      dropZone.removeAttribute('aria-disabled');
    }
  }

  dropZone.addEventListener('click', (event) => {
    if (!uploading && !event.target.closest('#paste-file-btn')) input.click();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (!uploading && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); input.click(); }
  });
  dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    void upload(event.dataTransfer?.files);
  });
  input.addEventListener('change', () => { void upload(input.files); input.value = ''; });
  document.getElementById('paste-file-btn').addEventListener('click', async () => {
    try {
      const entries = await navigator.clipboard.read();
      const files = [];
      for (const entry of entries) {
        const type = entry.types.find((value) => value.startsWith('image/') || value === 'application/pdf');
        if (!type) continue;
        const blob = await entry.getType(type);
        files.push(new File([blob], `粘贴文件.${type.split('/')[1] || 'bin'}`, { type }));
      }
      if (files.length) void upload(files);
      else setStatus('剪贴板中没有文件', true);
    } catch (error) { setStatus(`读取剪贴板失败：${String(error?.message || error)}`, true); }
  });
  document.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    void upload(files);
  });
  retryButton.addEventListener('click', () => { void upload(pendingFiles); });
  loginButton.addEventListener('click', () => {
    void chrome.tabs.create({ url: 'http://123.121.147.7:88/ve/', active: true }).then((tab) => {
      if (tab?.id != null) void chrome.runtime.sendMessage({ type: 'GROUP_BJTU_OPENED_TAB', tabId: tab.id });
    });
  });
})();
