// -------------------- Upload --------------------
function processQueue() {
  while (activeUploads < maxParallelUploads && uploadQueue.length > 0) {
    const task = uploadQueue.shift();
    activeUploads++;
    task();
  }
}

function runPendingLoginCallbacks() {
  const cbs = pendingLoginCallbacks;
  pendingLoginCallbacks = [];
  cbs.forEach(fn => {
    try { fn(); } catch {}
  });
  return cbs.length;
}

function handleLoginRequired(retryCallback, cancelCallback, message) {
  if (retryCallback) {
    pendingLoginCallbacks.push(retryCallback);
  }
  promptLoginIfPossible(message || '请输入账号登录');
  if (cancelCallback) {
    // store cancel? keep simple: ignore
  }
}

function normalizeUploadDuplicateName(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();
}

function isSameUploadFileSize(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.max(0, Math.round(na)) === Math.max(0, Math.round(nb));
}

function isApproxSameUploadFileSize(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na < 0 || nb < 0) return false;
  const diff = Math.abs(na - nb);
  return diff <= Math.max(64 * 1024, Math.max(na, nb) * 0.01);
}

function buildUploadMetaFromKnownFile(file, known) {
  const nameParts = splitFileName(file?.name || known?.fileName || known?.name || '');
  return {
    fileNameNoExt: String(nameParts.fileNameNoExt || safeDecodeUploadNamePart(known?.fileNameNoExt) || '').trim(),
    fileExtName: String(nameParts.fileExtName || known?.fileExtName || '').trim(),
    fileSize: Number(known?.fileSize || file?.size || 0),
    visitName: String(known?.visitName || '').trim(),
    pid: '',
    ftype: 'insert',
    fileName: String(file?.name || known?.fileName || known?.name || '').trim(),
    url: String(known?.url || '').trim()
  };
}

function safeDecodeUploadNamePart(v) {
  const raw = String(v || '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function findAlreadyUploadedFile(file) {
  const fileName = normalizeUploadDuplicateName(file?.name || '');
  const fileSize = Number(file?.size || 0);
  if (!fileName) return null;

  const savedList = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const saved = savedList.find((it) => (
    normalizeUploadDuplicateName(it?.fileName) === fileName &&
    isSameUploadFileSize(it?.fileSize, fileSize) &&
    String(it?.visitName || '').trim() &&
    String(it?.url || '').trim()
  ));
  if (saved) {
    return {
      source: '本地记录',
      fileName: String(saved.fileName || file?.name || '').trim(),
      fileSize: Number(saved.fileSize || fileSize || 0),
      visitName: String(saved.visitName || '').trim(),
      url: String(saved.url || '').trim()
    };
  }

  const current = Object.values(window.uploadedFileMetaById || {}).find((meta) => {
    if (!meta?.visitName) return false;
    const metaName = normalizeUploadDuplicateName(
      meta.fileName || `${safeDecodeUploadNamePart(meta.fileNameNoExt)}${meta.fileExtName ? '.' + meta.fileExtName : ''}`
    );
    return metaName === fileName && isSameUploadFileSize(meta.fileSize, fileSize);
  });
  if (current) {
    return {
      source: '本页已上传',
      ...buildUploadMetaFromKnownFile(file, current)
    };
  }

  const resource = (Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : []).find((it) => (
    normalizeUploadDuplicateName(it?.name) === fileName &&
    isApproxSameUploadFileSize(getResourceItemSizeBytes(it), fileSize) &&
    String(it?.url || '').trim()
  ));
  if (resource) {
    return {
      source: '资源空间',
      fileName: String(resource.name || file?.name || '').trim(),
      fileSize,
      visitName: '',
      url: String(resource.url || '').trim()
    };
  }

  return null;
}

async function promptDuplicateUploadConfirmation(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return Promise.resolve(new Set());
  await globalThis.__bjtuUploadDuplicateDialogReady;
  const modal = document.getElementById('upload-duplicate-modal');
  const listEl = document.getElementById('upload-duplicate-list');
  const invertBtn = document.getElementById('upload-duplicate-invert');
  const cancelBtn = document.getElementById('upload-duplicate-cancel');
  const confirmBtn = document.getElementById('upload-duplicate-confirm');
  if (!(modal instanceof HTMLElement) || !(listEl instanceof HTMLElement) || !(confirmBtn instanceof HTMLButtonElement)) {
    return Promise.resolve(new Set());
  }

  listEl.innerHTML = list.map((entry, idx) => {
    const file = entry?.file;
    const known = entry?.known || {};
    const name = String(file?.name || known.fileName || '(未命名)').trim();
    const sizeBytes = Number(file?.size || known.fileSize || 0);
    return `
      <label class="upload-duplicate-row">
        <input type="checkbox" data-duplicate-index="${idx}">
        <span class="upload-duplicate-fileline">
          <span class="upload-duplicate-name">${escapeHtml(name)}</span>
          <span class="upload-duplicate-size">${renderFileSizeText(sizeBytes)}</span>
        </span>
      </label>
    `;
  }).join('');

  return new Promise((resolve) => {
    const cleanup = () => {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      if (invertBtn instanceof HTMLButtonElement) invertBtn.removeEventListener('click', onInvert);
      if (cancelBtn instanceof HTMLButtonElement) cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('mousedown', onMaskPointerDown);
      modal.removeEventListener('mouseup', onMaskPointerUp);
    };
    const onInvert = () => {
      listEl.querySelectorAll('input[type="checkbox"][data-duplicate-index]').forEach((el) => {
        if (el instanceof HTMLInputElement) el.checked = !el.checked;
      });
    };
    const onConfirm = () => {
      const selected = new Set();
      listEl.querySelectorAll('input[type="checkbox"][data-duplicate-index]:checked').forEach((el) => {
        if (el instanceof HTMLInputElement) selected.add(Number(el.dataset.duplicateIndex));
      });
      cleanup();
      resolve(selected);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onMaskPointerDown = (e) => {
      modal.dataset.mdownMask = e.target === modal ? '1' : '0';
    };
    const onMaskPointerUp = (e) => {
      if (e.target === modal && modal.dataset.mdownMask === '1') {
        onCancel();
      }
      delete modal.dataset.mdownMask;
    };
    if (invertBtn instanceof HTMLButtonElement) invertBtn.addEventListener('click', onInvert);
    if (cancelBtn instanceof HTMLButtonElement) cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    modal.addEventListener('mousedown', onMaskPointerDown);
    modal.addEventListener('mouseup', onMaskPointerUp);
    modal.style.display = 'flex';
  });
}

function renderAlreadyUploadedFile(file, fileId, known) {
  const url = String(known?.url || '').trim();
  if (!url) return false;
  const hasVisitName = !!String(known?.visitName || '').trim();
  if (!window.filesData) window.filesData = {};
  window.filesData[fileId] = { size: Number(file?.size || 0), uploaded: Number(file?.size || 0) };
  if (hasVisitName) {
    window.uploadedFileMetaById[fileId] = buildUploadMetaFromKnownFile(file, known);
  }

  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.uploadFileId = fileId;
  item.dataset.duplicateUpload = '1';
  const source = escapeHtml(String(known?.source || '已上传').trim());
  const safeName = escapeHtml(String(file?.name || known?.fileName || '(未命名)').trim());
  const safeUrl = escapeHtml(url);
  const sizeBytes = Number(file?.size || known?.fileSize || 0);
  const checkboxHtml = hasVisitName
    ? `<label class="upload-select-wrap"><input type="checkbox" class="submit-file-check" data-file-id="${escapeHtml(fileId)}"> 作为作业附件</label>`
    : '<span class="upload-select-wrap" style="display:none;"></span>';
  item.innerHTML = `
    <div class="upload-file-head-row" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
      <div>
        ${checkboxHtml}
        <strong>${safeName}</strong>
        <span class="inline-status" style="font-size:12px; margin-left:8px; color:#2e7d32;">${source}</span>
        <span class="size-progress" style="margin-left:5px;">(${renderFileSizeText(sizeBytes)})</span>
      </div>
      <div></div>
    </div>
    <div class="upload-link-row">
      <a class="url-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>
      <button type="button" class="btn duplicate-upload-copy" style="padding:2px 8px; font-size:12px; white-space:nowrap;">复制</button>
    </div>
  `;
  const copyBtn = item.querySelector('.duplicate-upload-copy');
  if (copyBtn instanceof HTMLButtonElement) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        showToast('链接已复制', 'success', 1200);
      });
    });
  }
  fileList.prepend(item);
  refreshUploadSelectVisibility();
  updateTotalProgress();
  return true;
}

function enqueueUploadFile(file) {
  const fileId = Math.random().toString(36).slice(2);
  window.filesData[fileId] = { size: file.size, uploaded: 0 };
  return uploadFile(file, fileId);
}

function uploadFile(file, fileId) {
  let completionSettled = false;
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const completeUpload = (value) => {
    if (completionSettled) return;
    completionSettled = true;
    resolveCompletion(value);
  };
  const failUpload = (message, code = '') => {
    if (completionSettled) return;
    completionSettled = true;
    rejectCompletion(Object.assign(new Error(String(message || '上传失败')), { code: String(code || '') }));
  };
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.uploadFileId = fileId;
  item.innerHTML = `
    <div class="upload-file-head-row" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
      <div>
        <label class="upload-select-wrap" style="display:none;">
          <input type="checkbox" class="submit-file-check" data-file-id="${fileId}">
          作为作业附件
        </label>
        <strong>${file.name}</strong>
        <span class="inline-status" style="font-size:12px; margin-left:8px; color:#6b7280;">排队中…</span>
        <span class="size-progress" style="margin-left:5px;">(${renderFileSizePair(0, file.size)})</span>
        <span class="speed-display" style="font-size:12px; color:#666; margin-left:10px;"></span>
        <span class="eta-display" style="font-size:12px; color:#6b7280; margin-left:10px;"></span>
      </div>
      <div>
        <button class="btn retry-btn" style="padding:2px 8px; font-size:12px; background-color:#2196F3; display:none; margin-right:5px;">重试</button>
        <button class="btn cancel-btn" style="padding:2px 8px; font-size:12px; background-color:#f44336;">取消</button>
      </div>
    </div>
    <div class="progress-bar-container"><div class="progress-bar" style="width:0%"></div></div>
  `;
  fileList.prepend(item);

  const progressBar = item.querySelector('.progress-bar');
  const inlineStatus = item.querySelector('.inline-status');
  const cancelBtn = item.querySelector('.cancel-btn');
  const retryBtn = item.querySelector('.retry-btn');
  const speedDisplay = item.querySelector('.speed-display');
  const etaDisplay = item.querySelector('.eta-display');
  const sizeProgressDisplay = item.querySelector('.size-progress');
  const uploadSelectWrap = item.querySelector('.upload-select-wrap');

  let isRunning = false;
  let cancelRequested = false;
  let xhrRef = null;
  let autoRetryQueuedByLogin = false;

  const showRetry = () => {
    cancelBtn.style.display = 'none';
    retryBtn.style.display = 'inline-block';
  };

  const setInlineStatus = (text = '', tone = 'normal') => {
    if (!inlineStatus) return;
    inlineStatus.textContent = String(text || '');
    if (!text) {
      inlineStatus.style.color = '#6b7280';
      return;
    }
    if (tone === 'error') {
      inlineStatus.style.color = '#c62828';
    } else if (tone === 'warning') {
      inlineStatus.style.color = '#b45309';
    } else if (tone === 'success') {
      inlineStatus.style.color = '#2e7d32';
    } else {
      inlineStatus.style.color = '#6b7280';
    }
  };

  const doCancelUiAndAccounting = (statusText = '已取消') => {
    setInlineStatus(statusText, 'warning');
    if (etaDisplay) etaDisplay.textContent = '';
    setSpeedDisplay(speedDisplay, 0, '');
    progressBar.style.backgroundColor = '#999';
    showRetry();
    // remove from aggregated speed
    delete window.activeSpeeds[fileId];
    updateTotalSpeed();
    // cancelled files should not count in total progress
    if (window.filesData[fileId]) {
      delete window.filesData[fileId];
      updateTotalProgress();
    }
    failUpload(statusText, 'USER_CANCELLED');
  };

  const queueAutoRetryAfterLogin = () => {
    if (autoRetryQueuedByLogin) return;
    autoRetryQueuedByLogin = true;
    handleLoginRequired(() => {
      autoRetryQueuedByLogin = false;
      if (cancelRequested) return;
      retryBtn.style.display = 'none';
      cancelBtn.style.display = 'inline-block';
      setInlineStatus('登录恢复，自动重试中…', 'warning');
      if (etaDisplay) etaDisplay.textContent = '';
      isRunning = false;
      xhrRef = null;
      if (!window.filesData[fileId]) {
        window.filesData[fileId] = { size: file.size, uploaded: 0 };
        updateTotalProgress();
      }
      uploadQueue.push(performUpload);
      processQueue();
    }, null, '登录已失效，请输入账号登录');
  };

  retryBtn.onclick = () => {
    autoRetryQueuedByLogin = false;
    retryBtn.style.display = 'none';
    cancelBtn.style.display = 'inline-block';
    setInlineStatus('准备重试…', 'warning');
    if (etaDisplay) etaDisplay.textContent = '';
    cancelRequested = false;
    isRunning = false;
    xhrRef = null;
    if (!window.filesData[fileId]) {
      window.filesData[fileId] = { size: file.size, uploaded: 0 };
      updateTotalProgress();
    }
    uploadQueue.push(performUpload);
    processQueue();
  };

  cancelBtn.onclick = () => {
    autoRetryQueuedByLogin = false;
    if (!isRunning) {
      cancelRequested = true;
      const idx = uploadQueue.indexOf(performUpload);
      if (idx >= 0) uploadQueue.splice(idx, 1);
      doCancelUiAndAccounting();
      return;
    }

    cancelRequested = true;
    if (xhrRef) {
      try { xhrRef.abort(); } catch {}
    }
  };

  const performUpload = async () => {
    cancelRequested = false;
    isRunning = true;
    const manualJsessionMode = !usernameInput.value.trim();
    const jsid = (jsessionidInput.value.trim() || await getLocal('jsessionid', '')).trim();
    if (manualJsessionMode && !jsid) {
      setInlineStatus('等待登录…', 'warning');
      if (etaDisplay) etaDisplay.textContent = '';
      queueAutoRetryAfterLogin();
      showRetry();
      isRunning = false;
      xhrRef = null;
      activeUploads--; processQueue();
      return;
    }

    setInlineStatus('上传中…', 'normal');
    progressBar.style.backgroundColor = '#4CAF50';

    const fd = new FormData();
    fd.append('file', file);

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef = xhr;
      const start = Date.now();
      let lastLoaded = 0;
      let lastTime = start;
      const progressSamples = [];
      const speedId = fileId;
      window.activeSpeeds[speedId] = 0;
      updateTotalSpeed();

      const uploadUrl = manualJsessionMode
        ? `${BASE}/ve/back/rp/common/rpUpload.shtml;jsessionid=${encodeURIComponent(jsid)}`
        : `${BASE}/ve/back/rp/common/rpUpload.shtml`;
      xhr.open('POST', uploadUrl, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Upgrade-Insecure-Requests', '1');

      xhr.onabort = () => {
        doCancelUiAndAccounting();
        xhrRef = null;
        resolve();
      };

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const fileSize = Math.max(0, Number(file.size || 0));
        const visibleLoaded = fileSize > 0
          ? Math.min(fileSize, Math.max(0, Number(e.loaded || 0)))
          : Math.max(0, Number(e.loaded || 0));
        const percent = fileSize > 0
          ? Math.min(100, Math.max(0, (visibleLoaded / fileSize) * 100))
          : (e.total > 0 ? Math.min(100, Math.max(0, (e.loaded / e.total) * 100)) : 0);
        progressBar.style.width = percent + '%';
        progressBar.textContent = '';
        sizeProgressDisplay.innerHTML = `(${renderFileSizePair(visibleLoaded, fileSize)})`;

        // speed: update on every progress event so very fast uploads still show non-zero throughput.
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        const elapsed = Math.max((now - start) / 1000, 0.001);
        const db = Math.max(0, e.loaded - lastLoaded);
        let spd = 0;
        if (dt > 0.04) {
          spd = db / dt;
        } else {
          // fallback to average speed when progress callbacks are too dense or upload is near-instant
          spd = e.loaded / elapsed;
        }
        const smoothed = pushAndCalcRecentSpeed(progressSamples, e.loaded, now);
        const speedForEta = smoothed > 0 ? smoothed : spd;
        if (Number.isFinite(speedForEta) && speedForEta >= 0) {
          setSpeedDisplay(speedDisplay, speedForEta);
          window.activeSpeeds[speedId] = speedForEta;
          const remainingBytes = fileSize > 0 ? Math.max(0, fileSize - visibleLoaded) : Math.max(0, e.total - e.loaded);
          if (etaDisplay) {
            etaDisplay.textContent = remainingBytes > 0 && speedForEta > 0
              ? `剩余: ${formatEta(remainingBytes / speedForEta)}`
              : '剩余: 0秒';
          }
          updateTotalSpeed();
        }
        lastLoaded = e.loaded;
        lastTime = now;

        if (window.filesData[fileId]) {
          window.filesData[fileId].uploaded = visibleLoaded;
          updateTotalProgress();
        }
      };

      xhr.onload = async () => {
        xhrRef = null;
        setSpeedDisplay(speedDisplay, 0, '');
        if (etaDisplay) etaDisplay.textContent = '';
        delete window.activeSpeeds[speedId];
        updateTotalSpeed();
        if (xhr.status !== 200) {
          setInlineStatus(`上传失败 HTTP ${xhr.status}`, 'error');
          progressBar.style.backgroundColor = '#f44336';
          showRetry();
          failUpload(`上传失败：HTTP ${xhr.status}`);
          resolve();
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (data.visitName) {
            const convertedUrl = convertVisitNameToUrl(data.visitName);
            progressBar.style.width = '100%';
            progressBar.textContent = '';
            sizeProgressDisplay.innerHTML = `(${renderFileSizePair(file.size, file.size)})`;
            setInlineStatus('上传完成', 'success');

            await addSavedUpload(file, data, convertedUrl);

            const nameParts = splitFileName(file.name);
            window.uploadedFileMetaById[fileId] = {
              fileNameNoExt: String(data.fileNameNoExt || encodeURIComponent(nameParts.fileNameNoExt || '') || '').trim(),
              fileExtName: String(data.fileExtName || nameParts.fileExtName || '').trim(),
              fileSize: Number(data.fileSize || file.size || 0),
              visitName: String(data.visitName || '').trim(),
              pid: '',
              ftype: 'insert',
              fileName: String(file.name || '').trim(),
              url: convertedUrl
            };
            if (uploadSelectWrap instanceof HTMLElement) {
              uploadSelectWrap.style.display = 'none';
            }
            refreshUploadSelectVisibility();

            // Hide progress bar container and render link + copy button at the same position
            const pc = item.querySelector('.progress-bar-container');
            if (pc) {
              const row = document.createElement('div');
              row.className = 'upload-link-row';
              const a = document.createElement('a');
              a.className = 'url-link';
              a.href = convertedUrl;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              a.textContent = convertedUrl;
              a.style.color = '#4CAF50';
              a.style.fontWeight = '700';
              a.style.textDecoration = 'none';
              const btn = document.createElement('button');
              btn.className = 'btn';
              btn.style.padding = '2px 8px';
              btn.style.fontSize = '12px';
              btn.style.whiteSpace = 'nowrap';
              btn.textContent = '复制';
              btn.addEventListener('click', () => {
                navigator.clipboard.writeText(convertedUrl).then(() => {
                  showToast('链接已复制', 'success', 1200);
                });
              });
              row.appendChild(a);
              row.appendChild(btn);
              pc.replaceWith(row);
            }

            if (window.filesData[fileId]) {
              window.filesData[fileId].uploaded = file.size;
              updateTotalProgress();
            }
            cancelBtn.style.display = 'none';
            const saved = (window.savedUploadedFiles || [])
              .find((entry) => String(entry?.visitName || '') === String(data.visitName || ''));
            completeUpload({
              id: fileId,
              savedId: String(saved?.id || ''),
              fileName: String(file.name || ''),
              fileSize: Number(file.size || 0),
              mimeType: String(file.type || ''),
              url: convertedUrl,
              visitName: String(data.visitName || '')
            });
          } else {
            const msg = data.ERRMSG || '未知错误';
            setInlineStatus(`上传失败：${msg}`, 'error');
            progressBar.style.backgroundColor = '#f44336';
            if (String(msg).includes('不合法') || String(msg).includes('登录')) {
              isLoginSessionValid = false;
              queueAutoRetryAfterLogin();
            }
            showRetry();
            failUpload(msg, /登录|不合法/.test(String(msg)) ? 'LOGIN_REQUIRED' : '');
          }
        } catch {
          const raw = String(xhr.responseText || '').trim();
          // Server sometimes returns plain text, e.g. “上传文件类型不支持,请更换文件！”
          const msg = raw ? escapeHtml(raw).slice(0, 300) : '返回非 JSON';
          setInlineStatus(`上传失败：${msg}`, 'error');
          progressBar.style.backgroundColor = '#f44336';
          showRetry();
          failUpload(raw || '上传接口返回非 JSON');
        }
        resolve();
      };

      xhr.onerror = () => {
        xhrRef = null;
        // If user already requested cancel, treat as cancel
        if (cancelRequested) {
          doCancelUiAndAccounting();
          resolve();
          return;
        }
        setSpeedDisplay(speedDisplay, 0, '');
        if (etaDisplay) etaDisplay.textContent = '';
        delete window.activeSpeeds[speedId];
        updateTotalSpeed();
        setInlineStatus('网络请求失败', 'error');
        progressBar.style.backgroundColor = '#f44336';
        showRetry();
        failUpload('网络请求失败');
        resolve();
      };

      if (cancelRequested) {
        try { xhr.abort(); } catch {}
        return;
      }

      xhr.send(fd);
    });

    isRunning = false;
    xhrRef = null;
    activeUploads--; processQueue();
  };

  uploadQueue.push(performUpload);
  processQueue();
  return completion;
}

// -------------------- Events --------------------
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover', 'dragover-invalid', 'dragover-text');
  const dt = e.dataTransfer;
  if (!dt) return;
  const types = Array.from(dt.types || []);
  if (types.includes('Files')) {
    dropZone.classList.add('dragover');
  } else if (types.includes('text/plain') || types.includes('text/html')) {
    dropZone.classList.add('dragover-text');
  } else {
    dropZone.classList.add('dragover-invalid');
  }
});
dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover', 'dragover-invalid', 'dragover-text');
});
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover', 'dragover-invalid', 'dragover-text');

  const dt = e.dataTransfer;
  const types = Array.from(dt?.types || []);
  if (types.includes('Files')) {
    const files = await clipboardDataToFiles(dt);
    if (files.length) {
      processFilesForUpload(files);
    } else {
      showToast('未找到可上传的文件', 'warning', 1800);
    }
    return;
  }

  const textFiles = await convertTextDropToFiles(dt);
  processFilesForUpload(textFiles);
});

fileInput.addEventListener('change', handleFiles);

if (dropZone instanceof HTMLElement) {
  dropZone.tabIndex = 0;
}

function cloneFileWithPath(file, relativePath = '') {
  const name = String(relativePath || file?.webkitRelativePath || file?.name || 'pasted-file').replace(/^[/\\]+/, '');
  if (!name || name === file.name) return file;
  return new File([file], name, { type: file.type || '', lastModified: file.lastModified || Date.now() });
}

function readFileEntry(entry, basePath = '') {
  return new Promise((resolve) => {
    try {
      entry.file((file) => {
        const rel = `${basePath || ''}${file.name || entry.name || 'file'}`;
        resolve([cloneFileWithPath(file, rel)]);
      }, () => resolve([]));
    } catch {
      resolve([]);
    }
  });
}

async function readDirectoryEntry(entry, basePath = '') {
  const dirPath = `${basePath || ''}${entry.name || 'folder'}/`;
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await new Promise((resolve) => {
      try { reader.readEntries(resolve, () => resolve([])); } catch { resolve([]); }
    });
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((child) => readEntryFiles(child, dirPath)));
  return nested.flat();
}

async function readEntryFiles(entry, basePath = '') {
  if (!entry) return [];
  if (entry.isFile) return readFileEntry(entry, basePath);
  if (entry.isDirectory) return readDirectoryEntry(entry, basePath);
  return [];
}

async function clipboardDataToFiles(dt) {
  if (!dt) return [];
  const items = Array.from(dt.items || []);
  // 先同步提取所有 entry，避免 async 中 DataTransfer 作废导致后续条目丢失
  const tasks = items.map((item) => {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) return readEntryFiles(entry);
    if (item.kind === 'file') {
      const file = item.getAsFile();
      return file ? [file] : [];
    }
    return [];
  });
  const nested = await Promise.all(tasks);
  const files = nested.flat();
  if (!files.length && dt.files?.length) files.push(...Array.from(dt.files));
  return files;
}

async function handleClipboardUploadPaste(e) {
  const active = document.activeElement;
  if (active && (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active.isContentEditable
  )) return;
  const files = await clipboardDataToFiles(e.clipboardData);
  if (!files.length) return;
  e.preventDefault();
  processFilesForUpload(files);
}

document.addEventListener('paste', (e) => {
  handleClipboardUploadPaste(e).catch((err) => {
    showToast(`粘贴失败：${String(err?.message || err)}`, 'error', 3000);
  });
});

const pasteFileBtn = document.getElementById('paste-file-btn');
if (pasteFileBtn) {
  pasteFileBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (!isLoginSessionValid) {
        showToast('登录状态已失效，请重新登录', 'warning');
        return;
      }
      const items = await navigator.clipboard.read();
      if (!items || !items.length) {
        showToast('剪贴板中没有可粘贴的内容', 'info', 2000);
        return;
      }
      const files = [];
      let textCount = 0;
      for (const item of items) {
        let handled = false;
        const allTypes = item.types || [];
        for (const type of allTypes) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const ext = type.split('/')[1] || 'png';
            files.push(new File([blob], `pasted-image.${ext}`, { type }));
            handled = true;
            break;
          }
        }
        if (handled) continue;
        // Try text types
        const textBlob = await item.getType('text/plain').catch(() => null);
        const htmlBlob = await item.getType('text/html').catch(() => null);
        if (textBlob || htmlBlob) {
          let addedText = false;
          let content = '';
          if (htmlBlob) {
            content = await htmlBlob.text();
            if (content.trim()) {
              files.push(new File([new Blob([content], { type: 'text/html' })], 'pasted-content.html', { type: 'text/html' }));
              addedText = true;
            }
          } else if (textBlob) {
            content = await textBlob.text();
            if (content.trim()) {
              files.push(new File([new Blob([content], { type: 'text/plain' })], 'pasted-content.txt', { type: 'text/plain' }));
              addedText = true;
            }
          }
          if (addedText) textCount++;
          handled = true;
        }
        if (handled) continue;
        // Fallback: try any non-text type as a file
        for (const type of allTypes) {
          if (type.startsWith('text/')) continue;
          try {
            const blob = await item.getType(type);
            const ext = type.includes('/') ? type.split('/')[1].split(';')[0] : 'bin';
            files.push(new File([blob], `pasted-file.${ext || 'bin'}`, { type }));
            break;
          } catch {}
        }
      }
      if (!files.length) {
        showToast('若从资源管理器复制文件或文件夹，请在页面按 Ctrl+V 粘贴', 'info', 3000);
        return;
      }
      const nonTextCount = files.length - textCount;
      if (textCount > 0 && nonTextCount === 0) {
        showToast(`已将剪贴板文本转为 ${files.length} 个文件并开始上传`, 'info', 3000);
      } else if (textCount > 0) {
        showToast(`已粘贴 ${nonTextCount} 个文件，${textCount} 个文本已转为文件`, 'info', 3000);
      }
      processFilesForUpload(files);
    } catch (err) {
      if (String(err?.message || err).includes('clipboard-read')) {
        showToast('没有剪贴板读取权限，请授予后重试', 'error', 3000);
      } else {
        showToast(`粘贴失败：${String(err?.message || err)}`, 'error', 3000);
      }
    }
  });
}

fileList.addEventListener('click', (e) => {
  const rawTarget = e.target;
  const t = rawTarget instanceof Element
    ? rawTarget
    : (rawTarget && rawTarget.nodeType === Node.TEXT_NODE ? rawTarget.parentElement : null);
  if (!(t instanceof Element)) return;
  const row = t.closest('.upload-file-head-row');
  if (!(row instanceof HTMLElement)) return;
  if (t.closest('button,a,input,textarea,select,label')) return;
  const cb = row.querySelector('input.submit-file-check');
  if (!(cb instanceof HTMLInputElement)) return;
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});

async function processFilesForUpload(files, { waitForCompletion = false } = {}) {
  if (!files || !files.length) return;
  const filesList = Array.from(files).filter(Boolean);
  if (!filesList.length) return;

  const pendingFiles = [];
  const duplicateEntries = [];
  filesList.forEach((f) => {
    const known = findAlreadyUploadedFile(f);
    if (known) {
      duplicateEntries.push({ file: f, known });
      return;
    }
    pendingFiles.push(f);
  });

  let skippedDuplicateCount = 0;
  const reusedResults = [];
  if (duplicateEntries.length > 0) {
    const selectedDuplicateIndexes = await promptDuplicateUploadConfirmation(duplicateEntries);
    if (selectedDuplicateIndexes instanceof Set) {
      duplicateEntries.forEach((entry, idx) => {
        if (selectedDuplicateIndexes.has(idx)) {
          pendingFiles.push(entry.file);
          return;
        }
        const fileId = Math.random().toString(36).slice(2);
        if (renderAlreadyUploadedFile(entry.file, fileId, entry.known)) {
          skippedDuplicateCount++;
          reusedResults.push({
            id: fileId,
            savedId: '',
            fileName: String(entry.file?.name || entry.known?.fileName || ''),
            fileSize: Number(entry.file?.size || entry.known?.fileSize || 0),
            mimeType: String(entry.file?.type || ''),
            url: String(entry.known?.url || ''),
            visitName: String(entry.known?.visitName || ''),
            reused: true
          });
        }
      });
    }
  }

  if (skippedDuplicateCount > 0) {
    showToast(`已复用 ${skippedDuplicateCount} 个已上传文件`, 'info', 1800);
  }
  if (!pendingFiles.length) {
    updateTotalProgress();
    return reusedResults;
  }

  if (!isLoginSessionValid) {
    if (waitForCompletion) {
      return new Promise((resolve, reject) => {
        handleLoginRequired(() => {
          const tasks = pendingFiles.map(enqueueUploadFile);
          updateTotalProgress();
          Promise.all(tasks).then((results) => resolve([...reusedResults, ...results]), reject);
        });
      });
    }
    handleLoginRequired(() => {
      pendingFiles.map(enqueueUploadFile).forEach((task) => task.catch(() => {}));
      updateTotalProgress();
    });
    return reusedResults;
  }

  const tasks = pendingFiles.map(enqueueUploadFile);
  updateTotalProgress();
  if (waitForCompletion) return [...reusedResults, ...await Promise.all(tasks)];
  tasks.forEach((task) => task.catch(() => {}));
  return reusedResults;
}

function handleFiles(e) {
  const files = e.target.files || e.dataTransfer.files;
  processFilesForUpload(files);
}

function decodeApiUploadBase64(value) {
  const source = String(value || '').trim().replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
  if (!source) return new Uint8Array();
  let binary;
  try { binary = atob(source); } catch { throw new Error('base64 文件内容无效'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function buildApiUploadFile(args = {}) {
  if (args?.__localFile instanceof File) return args.__localFile;
  let fileName = String(args?.fileName || args?.name || '').trim();
  const requestedMimeType = String(args?.mimeType || args?.type || '').trim();
  let blob;
  if (args?.dataBase64 !== undefined || args?.base64 !== undefined) {
    blob = new Blob([decodeApiUploadBase64(args.dataBase64 ?? args.base64)], { type: requestedMimeType || 'application/octet-stream' });
  } else if (Array.isArray(args?.bytes)) {
    const values = args.bytes.map((item) => Number(item));
    if (values.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
      throw new Error('bytes 必须是由 0 至 255 整数组成的数组');
    }
    blob = new Blob([new Uint8Array(values)], { type: requestedMimeType || 'application/octet-stream' });
  } else if (args?.text !== undefined || args?.content !== undefined) {
    blob = new Blob([String(args.text ?? args.content ?? '')], { type: requestedMimeType || 'text/plain' });
  } else if (String(args?.url || '').trim()) {
    const sourceUrl = new URL(String(args.url).trim()).href;
    const response = await fetch(sourceUrl, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`获取待上传文件失败：HTTP ${response.status}`);
    blob = await response.blob();
    if (!fileName) {
      const inferredName = new URL(response.url || sourceUrl).pathname.split('/').filter(Boolean).pop() || 'upload.bin';
      try { fileName = decodeURIComponent(inferredName); } catch { fileName = inferredName; }
    }
  } else {
    throw new Error('缺少文件内容：请提供 text/content、base64/dataBase64、bytes 或 url');
  }
  if (!fileName) throw new Error('缺少参数 fileName');
  return new File([blob], fileName, { type: requestedMimeType || blob.type || 'application/octet-stream', lastModified: Date.now() });
}

function selectLocalFilesForApi({ accept = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!(fileInput instanceof HTMLInputElement)) {
      reject(new Error('页面文件选择器不存在'));
      return;
    }
    const previousAccept = fileInput.accept;
    fileInput.accept = String(accept || '').trim();
    fileInput.value = '';
    let settled = false;
    let focusTimer = 0;
    const cleanup = () => {
      clearTimeout(focusTimer);
      globalThis.removeEventListener('focus', onWindowFocus, true);
      fileInput.removeEventListener('change', onChange, true);
      fileInput.removeEventListener('cancel', onCancel, true);
      fileInput.accept = previousAccept;
    };
    const finish = (files) => {
      if (settled) return;
      settled = true;
      cleanup();
      const list = Array.from(files || []).filter((file) => file instanceof File);
      if (list.length) resolve(list);
      else reject(Object.assign(new Error('用户取消选择文件'), { code: 'USER_CANCELLED' }));
    };
    const onChange = (event) => {
      event.stopImmediatePropagation();
      finish(fileInput.files);
    };
    const onCancel = (event) => {
      event.stopImmediatePropagation();
      finish([]);
    };
    const onWindowFocus = () => {
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => finish(fileInput.files), 300);
    };
    fileInput.addEventListener('change', onChange, { capture: true, once: true });
    fileInput.addEventListener('cancel', onCancel, { capture: true, once: true });
    globalThis.addEventListener('focus', onWindowFocus, true);
    try { fileInput.click(); } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

async function uploadFileForApi(args = {}) {
  const hasSerializedSource = args?.dataBase64 !== undefined || args?.base64 !== undefined
    || Array.isArray(args?.bytes) || args?.text !== undefined || args?.content !== undefined
    || !!String(args?.url || '').trim();
  const files = hasSerializedSource
    ? [await buildApiUploadFile(args)]
    : await selectLocalFilesForApi({ accept: args?.accept });
  const results = await processFilesForUpload(files, { waitForCompletion: true });
  return results.length === 1 ? results[0] : results;
}

globalThis.BjtuVeUploadApi = Object.freeze({ uploadFile: uploadFileForApi });

async function convertTextDropToFiles(dt) {
  if (!dt) return [];
  const types = Array.from(dt.types || []);
  const files = [];

  if (types.includes('text/html')) {
    const html = dt.getData('text/html');
    if (html) {
      files.push(new File([new Blob([html], { type: 'text/html' })], 'pasted-content.html', { type: 'text/html' }));
      return files;
    }
  }

  if (types.includes('text/plain')) {
    const text = dt.getData('text/plain');
    if (text) {
      files.push(new File([new Blob([text], { type: 'text/plain' })], 'pasted-content.txt', { type: 'text/plain' }));
      return files;
    }
  }

  return files;
}

copyAllBtn.addEventListener('click', () => {
  let textToCopy = '';
  const appendChecked = (container) => {
    container.querySelectorAll('input.submit-file-check:checked').forEach(cb => {
      const item = cb.closest('.file-item');
      if (!item) return;
      const linkEl = item.querySelector('.url-link');
      if (!linkEl) return;
      const name = item.querySelector('strong')?.textContent || '';
      textToCopy += `${name}\n${linkEl.href}\n\n`;
    });
  };
  appendChecked(document.querySelector('#file-list'));
  const savedList = document.querySelector('.saved-uploads-list');
  if (savedList) appendChecked(savedList);
  textToCopy = textToCopy.trim();
  if (!textToCopy) {
    showToast('请先选择文件', 'warning', 1200);
    return;
  }
  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast('已复制选中链接', 'success', 1200);
  });
});
