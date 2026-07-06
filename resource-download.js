function setResourceSpaceStatus(text = '', tone = 'normal') {
  if (!resourceSpaceStatus) return;
  resourceSpaceStatus.textContent = String(text || '');
  if (tone === 'error') {
    resourceSpaceStatus.style.color = '#b91c1c';
  } else if (tone === 'success') {
    resourceSpaceStatus.style.color = '#166534';
  } else if (tone === 'warning') {
    resourceSpaceStatus.style.color = '#92400e';
  } else {
    resourceSpaceStatus.style.color = '#64748b';
  }
}

function formatResourceQueueFileWithSize(item, fallbackId = '') {
  const name = ensureResourceDownloadFileName(item, String(item?.url || '').trim()) || String(fallbackId || '未命名文件');
  const rawSize = getResourceItemSizeBytes(item);
  const sizeText = rawSize > 0
    ? formatSize(rawSize)
    : (String(item?.sizeMb || '').trim() || '未知大小');
  return `${name}（${sizeText}）`;
}

function refreshResourceQueueStatusText() {
  const stat = window.resourceDownloadQueueStatus || { totalFiles: 0, savedFiles: 0 };
  const totalFiles = Math.max(0, Number(stat.totalFiles) || 0);
  if (!totalFiles) {
    const activeCount = Object.values(window.resourceDownloadTasks || {}).filter((t) => !!t?.active).length;
    const queuedCount = (window.resourceDownloadQueue || []).filter((q) => q && !q.cancelled).length;
    if (!activeCount && !queuedCount) {
      const text = String(resourceSpaceStatus?.textContent || '').trim();
      if (/^\(\d+\+\d+\)\s*\/\s*\d+/.test(text)) {
        setResourceSpaceStatus('');
      }
    }
    return;
  }

  const activeIds = Object.entries(window.resourceDownloadTasks || {})
    .filter(([, task]) => !!task?.active)
    .map(([rid]) => String(rid || '').trim())
    .filter(Boolean);
  const downloadingCount = activeIds.length;
  const savedFiles = Math.max(0, Math.min(totalFiles, Number(stat.savedFiles) || 0));

  const names = activeIds.map((rid) => {
    const item = findSelectableDownloadItemById(rid)
      || window.resourceDownloadQueueById?.[rid]?.item
      || window.resourceDownloadTasks?.[rid]?.item
      || null;
    return formatResourceQueueFileWithSize(item, rid);
  });
  const nameText = names.length ? names.join('；') : '等待下载中';

  setResourceSpaceStatus(`(${savedFiles}+${downloadingCount}) / ${totalFiles} ${nameText}`, 'normal');

  const queuedCount = (window.resourceDownloadQueue || []).filter((q) => q && !q.cancelled).length;
  if (savedFiles >= totalFiles && downloadingCount === 0 && queuedCount === 0) {
    setResourceSpaceStatus(`(${savedFiles}+0) / ${totalFiles} 下载完成`, 'success');
    window.resourceDownloadQueueStatus = { totalFiles: 0, savedFiles: 0 };
  }
}

function setResourceSpaceCount(count = 0, mode = 'total') {
  if (!resourceSpaceCount) return;
  const n = Math.max(0, Number(count) || 0);
  if (String(mode) === 'loaded') {
    resourceSpaceCount.textContent = `已加载 ${n} 个资源文件`;
    return;
  }
  resourceSpaceCount.textContent = `共 ${n} 个资源文件`;
}

function normalizeResourceSearchKeyword(v) {
  return String(v || '').trim();
}

function getResourceSpaceSelectableIds() {
  const list = Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : [];
  return list
    .map((it) => String(it?.id || '').trim())
    .filter((id) => id && !isResourceDownloadActive(id));
}

function refreshResourceSelectAllButton() {
  if (!(resourceSelectAllBtn instanceof HTMLButtonElement)) return;
  const ids = getResourceSpaceSelectableIds();
  resourceSelectAllBtn.textContent = '反选';
  if (!ids.length) {
    resourceSelectAllBtn.disabled = true;
    return;
  }
  resourceSelectAllBtn.disabled = false;
}

function invertResourceSpaceSelectionByVisibleItems() {
  const ids = getResourceSpaceSelectableIds();
  ids.forEach((id) => {
    if (window.resourceSpaceSelected.has(id)) window.resourceSpaceSelected.delete(id);
    else window.resourceSpaceSelected.add(id);
  });

  if (resourceSpaceList instanceof HTMLElement) {
    const cbs = resourceSpaceList.querySelectorAll('input[data-action="resource-check"][data-resource-id]');
    cbs.forEach((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      const id = String(el.dataset.resourceId || '').trim();
      if (!id || isResourceDownloadActive(id)) return;
      el.checked = window.resourceSpaceSelected.has(id);
    });
  }
  refreshResourceSelectAllButton();
}

function normalizeResourceUrl(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    if (raw.startsWith('/rp/')) return `${FILE_BASE}${raw}`;
    return `${BASE}${raw}`;
  }
  return `${BASE_VE}${raw}`;
}

function formatResourceSizeMb(rpSize) {
  const n = Number(rpSize);
  if (!Number.isFinite(n) || n < 0) return '未知';
  return `${n.toFixed(2)}MB`;
}

function buildResourceSizeEmphasisStyle(rpSize) {
  const mb = Number(rpSize);
  if (!Number.isFinite(mb) || mb <= 0) {
    return 'font-size:10px; font-weight:500; color:#94a3b8; text-shadow:none;';
  }

  // Log scale keeps very large files from exploding while preserving contrast.
  const ratio = Math.max(0, Math.min(1, Math.log10(mb + 1) / Math.log10(1024 + 1)));
  const fontPx = (10 + ratio * 6).toFixed(2); // 10px -> 16px
  const weight = Math.round(500 + ratio * 320); // 500 -> 820
  const shadowBlur = Math.max(0, (ratio - 0.18) * 5).toFixed(2);
  const shadowAlpha = Math.max(0, (ratio - 0.2) * 0.35);
  if (document.documentElement.dataset.colorScheme === 'dark') {
    const r = Math.round(182 + ratio * 73);
    const g = Math.round(194 + ratio * 61);
    const b = Math.round(209 + ratio * 46);
    const brightAlpha = Math.min(1, shadowAlpha * 1.2).toFixed(2);
    const shadow = shadowBlur === '0.00' ? 'none' : `0 1px ${shadowBlur}px rgba(255,255,255,${brightAlpha})`;
    return `font-size:${fontPx}px; font-weight:${weight}; color:rgb(${r},${g},${b}); text-shadow:${shadow};`;
  }
  const colorLight = Math.round(148 - ratio * 118); // lighter start -> deep end
  const g = Math.max(18, colorLight + 8);
  const b = Math.max(28, colorLight + 20);
  const shadow = shadowBlur === '0.00' ? 'none' : `0 1px ${shadowBlur}px rgba(15,23,42,${shadowAlpha.toFixed(2)})`;
  return `font-size:${fontPx}px; font-weight:${weight}; color:rgb(${colorLight},${g},${b}); text-shadow:${shadow};`;
}

function sanitizeDownloadFileName(name, fallback = 'download') {
  const src = String(name || '').trim();
  const cleaned = src
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function normalizeResourceExt(ext) {
  const raw = String(ext || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^\.+/, '')
    .replace(/[?#].*$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .trim();
}

function inferResourceExtFromUrl(url) {
  try {
    const u = new URL(String(url || ''));
    const seg = String(u.pathname || '').split('/').pop() || '';
    const m = seg.match(/\.([a-zA-Z0-9_-]{1,16})$/);
    return normalizeResourceExt(m?.[1] || '');
  } catch {
    const m = String(url || '').match(/\.([a-zA-Z0-9_-]{1,16})(?:[?#]|$)/);
    return normalizeResourceExt(m?.[1] || '');
  }
}

function ensureResourceDownloadFileName(item, rawUrl) {
  const baseName = sanitizeDownloadFileName(item?.name || 'resource-file');
  const preferredExt = normalizeResourceExt(item?.extName || item?.rpPrix || '');
  const existingExt = normalizeResourceExt((String(baseName).match(/\.([a-zA-Z0-9_-]{1,16})$/)?.[1]) || '');
  const finalExt = preferredExt || existingExt || inferResourceExtFromUrl(rawUrl);
  if (!finalExt) return baseName;
  if (existingExt && existingExt.toLowerCase() === finalExt.toLowerCase()) return baseName;
  if (existingExt && preferredExt) {
    return baseName.replace(/\.[a-zA-Z0-9_-]{1,16}$/, `.${finalExt}`);
  }
  return `${baseName}.${finalExt}`;
}

function findResourceItemElementById(resourceId) {
  const rid = String(resourceId || '').trim();
  if (!rid) return null;
  const rows = document.querySelectorAll('.file-item[data-resource-id]');
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    if (String(row.dataset.resourceId || '').trim() === rid) return row;
  }
  // Also search saved upload items
  const savedRows = document.querySelectorAll('.file-item[data-saved-upload-id]');
  for (const row of savedRows) {
    if (!(row instanceof HTMLElement)) continue;
    if (`saved_${String(row.dataset.savedUploadId || '').trim()}` === rid) return row;
  }
  return null;
}

function getSelectableDownloadItems() {
  const native = Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : [];
  const courseware = Object.values(window.coursewareItemsById || {});
  const archives = Object.values(window.archiveItemsById || {});
  const attachments = Object.values(window.homeworkAttachmentItemsById || {});
  return [...native, ...courseware, ...archives, ...attachments];
}

function findSelectableDownloadItemById(resourceId) {
  const rid = String(resourceId || '').trim();
  if (!rid) return null;
  const native = (window.resourceSpaceItems || []).find((x) => String(x?.id || '').trim() === rid);
  if (native) return native;
  return window.coursewareItemsById?.[rid] || window.archiveItemsById?.[rid] || window.homeworkAttachmentItemsById?.[rid] || null;
}

function getResourceItemSizeBytes(item) {
  const mb = Number(item?.sizeMbRaw ?? item?.rpSize ?? NaN);
  if (!Number.isFinite(mb) || mb < 0) return 0;
  return Math.round(mb * 1024 * 1024);
}

function getKnownResourceSizeBytes(resourceId) {
  const rid = String(resourceId || '').trim();
  if (!rid) return 0;
  const itemBytes = getResourceItemSizeBytes(findSelectableDownloadItemById(rid));
  if (itemBytes > 0) return itemBytes;
  if (!rid.startsWith('saved_')) return 0;
  const savedId = rid.slice('saved_'.length);
  const saved = (window.savedUploadedFiles || []).find((it) => it && String(it.id || '').trim() === savedId);
  return Math.max(0, Number(saved?.fileSize) || 0);
}

function resetResourceDownloadBatch() {
  window.resourceDownloadBatch = {
    active: false,
    totalFiles: 0,
    totalBytes: 0,
    knownTotal: true,
    completedFiles: 0,
    completedBytes: 0
  };
}

function processResourceDownloadQueue() {
  const limit = Math.max(1, Number(maxParallelUploads) || 1);
  while (window.resourceDownloadQueueRunning < limit && window.resourceDownloadQueue.length > 0) {
    const entry = window.resourceDownloadQueue.shift();
    if (!entry || entry.cancelled) {
      if (entry) entry.settled = true;
      continue;
    }
    entry.started = true;
    window.resourceDownloadQueueRunning += 1;
    (async () => {
      try {
        await downloadResourceItemWithProgress(entry.item);
        entry.resolve();
      } catch (err) {
        entry.reject(err);
      } finally {
        entry.settled = true;
        window.resourceDownloadQueueRunning = Math.max(0, Number(window.resourceDownloadQueueRunning || 0) - 1);
        const rid = String(entry?.id || '').trim();
        if (rid && window.resourceDownloadQueueById[rid] === entry) {
          delete window.resourceDownloadQueueById[rid];
        }
        processResourceDownloadQueue();
      }
    })();
  }
}

function enqueueResourceDownload(item) {
  const id = String(item?.id || '').trim();
  if (!id) return Promise.reject(new Error('资源链接无效'));
  if (isResourceDownloadActive(id)) return Promise.reject(new Error('该文件正在下载中'));
  const expectedBytes = getResourceItemSizeBytes(item);

  const existing = window.resourceDownloadQueueById?.[id];
  if (existing?.promise && !existing.cancelled && !existing.settled) return existing.promise;
  if (existing?.settled || existing?.cancelled) delete window.resourceDownloadQueueById[id];

  let resolveRef;
  let rejectRef;
  const promise = new Promise((resolve, reject) => {
    resolveRef = resolve;
    rejectRef = reject;
  });

  const entry = {
    id,
    item,
    expectedBytes,
    resolve: resolveRef,
    reject: rejectRef,
    cancelled: false,
    started: false,
    settled: false,
    promise
  };

  window.resourceDownloadQueue.push(entry);
  window.resourceDownloadQueueById[id] = entry;

  setResourceItemDownloadingState(id, true);
  setResourceDownloadUi(id, {
    active: true,
    percent: 0,
    loaded: 0,
    total: expectedBytes,
    speed: 0,
    etaSec: null,
    status: '排队等待…'
  });

  processResourceDownloadQueue();
  return promise;
}

function startResourceDownloadBatch(items) {
  const list = Array.isArray(items) ? items : [];
  let totalBytes = 0;
  let knownTotal = true;
  list.forEach((it) => {
    const b = getResourceItemSizeBytes(it);
    if (b > 0) totalBytes += b;
    else knownTotal = false;
  });
  window.resourceDownloadBatch = {
    active: true,
    totalFiles: list.length,
    totalBytes,
    knownTotal,
    completedFiles: 0,
    completedBytes: 0
  };
  updateResourceDownloadTotals();
}

function markResourceDownloadBatchDone(item, success = true) {
  const batch = window.resourceDownloadBatch;
  if (!batch || !batch.active) return;
  batch.completedFiles += 1;
  if (success) {
    const guess = getResourceItemSizeBytes(item);
    if (guess > 0) batch.completedBytes += guess;
  }
  updateResourceDownloadTotals();
}

function getResourceDownloadTask(resourceId) {
  const rid = String(resourceId || '').trim();
  if (!rid) return null;
  return window.resourceDownloadTasks?.[rid] || null;
}

function isResourceDownloadActive(resourceId) {
  return !!getResourceDownloadTask(resourceId)?.active;
}

function setResourceItemDownloadingState(resourceId, downloading) {
  const row = findResourceItemElementById(resourceId);
  if (!row) return;
  const checkbox = row.querySelector('input[data-action="resource-check"]');
  const downloadBtn = row.querySelector('button.resource-download-btn') || row.querySelector('button.saved-upload-download');

  if (checkbox instanceof HTMLInputElement) {
    checkbox.disabled = !!downloading;
    if (downloading) {
      checkbox.checked = false;
      window.resourceSpaceSelected.delete(String(resourceId || '').trim());
    }
  }

  if (downloadBtn instanceof HTMLButtonElement) {
    if (downloading) {
      downloadBtn.dataset.prevAction = downloadBtn.dataset.action || 'download-saved-upload';
      const prevAction = String(downloadBtn.dataset.prevAction || '').trim();
      const isSavedUpload = prevAction === 'download-saved-upload'
        || downloadBtn.classList.contains('saved-upload-download')
        || row.hasAttribute('data-saved-upload-id');
      downloadBtn.dataset.action = isSavedUpload ? 'cancel-saved-upload' : 'resource-cancel-download';
      downloadBtn.textContent = '取消';
      downloadBtn.classList.add('is-cancel');
      downloadBtn.style.background = '#dc2626';
    } else {
      const isSavedUpload = downloadBtn.classList.contains('saved-upload-download') || row.hasAttribute('data-saved-upload-id');
      downloadBtn.dataset.action = isSavedUpload ? 'download-saved-upload' : 'resource-download';
      downloadBtn.textContent = '下载';
      downloadBtn.classList.remove('is-cancel');
      downloadBtn.style.background = '#1e3a8a';
      downloadBtn.disabled = false;
    }
  }
}

function updateResourceDownloadTotals() {
  if (!resourceTotalBar || !resourceTotalSizeInfo || !resourceTotalPercent || !resourceTotalSpeed || !resourceTotalEta) return;
  const resourceProgressWrap = resourceTotalBar.closest('.progress-bar-container');
  const tasks = Object.values(window.resourceDownloadTasks || {}).filter((t) => t && t.active);
  const queuedEntries = (window.resourceDownloadQueue || []).filter((q) => q && !q.cancelled && !q.started);
  const batch = window.resourceDownloadBatch || {};
  const hasActiveOrQueued = !!tasks.length || !!batch.active || !!queuedEntries.length;

  const completedLoaded = Math.max(0, Number(window.resourceDownloadCompletedContribution?.loadedBytes) || 0);
  const completedTotal = Math.max(0, Number(window.resourceDownloadCompletedContribution?.totalBytes) || 0);

  if (hasActiveOrQueued && window.resourceDownloadQueueClearTimer) {
    clearTimeout(window.resourceDownloadQueueClearTimer);
    window.resourceDownloadQueueClearTimer = null;
  }

  if (!tasks.length && !batch.active && !queuedEntries.length && completedLoaded <= 0 && completedTotal <= 0) {
    if (resourceProgressWrap instanceof HTMLElement) resourceProgressWrap.style.display = 'none';
    resourceTotalBar.style.width = '0%';
    resourceTotalBar.textContent = '';
    resourceTotalSizeInfo.innerHTML = renderFileSizePair(0, 0);
    resourceTotalSizeInfo.style.cssText = '';
    resourceTotalPercent.textContent = '0%';
    resourceTotalPercent.style.display = 'none';
    setSpeedDisplay(resourceTotalSpeed, 0);
    resourceTotalEta.textContent = '';
    refreshResourceQueueStatusText();
    return;
  }

  const batchActive = !!batch.active;
  let totalLoaded = completedLoaded + (batchActive ? Math.max(0, Number(batch.completedBytes) || 0) : 0);
  let totalSize = completedTotal + (batchActive ? Math.max(0, Number(batch.totalBytes) || 0) : 0);
  let hasKnownTotal = batchActive ? (batch.knownTotal !== false) : true;
  let totalSpeed = 0;
  tasks.forEach((t) => {
    const loaded = Math.max(0, Number(t.loaded) || 0);
    const total = Math.max(0, Number(t.total) || 0);
    const speed = Math.max(0, Number(t.speed) || 0);
    totalLoaded += loaded;
    totalSpeed += speed;
    if (!batchActive) {
      if (total > 0) {
        totalSize += total;
      } else {
        hasKnownTotal = false;
      }
    }
  });

  if (!batchActive) {
    queuedEntries.forEach((q) => {
      const expected = Math.max(0, Number(q?.expectedBytes) || 0);
      if (expected > 0) {
        totalSize += expected;
      } else {
        hasKnownTotal = false;
      }
      // queued items contribute 0 speed by design
    });
  }

  const exactPercent = hasKnownTotal && totalSize > 0
    ? Math.max(0, Math.min(100, (totalLoaded / totalSize) * 100))
    : 0;
  const percent = Math.round(exactPercent);
  if (resourceProgressWrap instanceof HTMLElement) resourceProgressWrap.style.display = totalSize > 0 ? '' : 'none';
  resourceTotalPercent.style.display = totalSize > 0 ? '' : 'none';
  resourceTotalBar.style.width = `${exactPercent}%`;
  resourceTotalBar.textContent = '';
  resourceTotalSizeInfo.innerHTML = hasKnownTotal && totalSize > 0
    ? renderFileSizePair(totalLoaded, totalSize)
    : `${renderFileSizeText(totalLoaded)} <span class="file-size-separator">/</span> <span class="file-size-placeholder">--</span>`;
  resourceTotalSizeInfo.style.cssText = '';
  resourceTotalPercent.textContent = hasKnownTotal && totalSize > 0 ? `${percent}%` : '--';
  setSpeedDisplay(resourceTotalSpeed, totalSpeed);

  if (hasKnownTotal && totalSize > totalLoaded && totalSpeed > 0) {
    resourceTotalEta.textContent = `总剩余: ${formatEta((totalSize - totalLoaded) / totalSpeed)}`;
  } else if (hasKnownTotal && totalSize > totalLoaded) {
    resourceTotalEta.textContent = '总剩余: 计算中…';
  } else if (tasks.length || batchActive || queuedEntries.length) {
    resourceTotalEta.textContent = hasKnownTotal ? '' : '总剩余: 计算中…';
  } else {
    resourceTotalEta.textContent = '';
  }

  refreshResourceQueueStatusText();
}

function addResourceDownloadCompletedContribution(loaded = 0, total = 0) {
  const loadedSafe = Math.max(0, Number(loaded) || 0);
  const totalSafe = Math.max(0, Number(total) || 0);
  if (!window.resourceDownloadCompletedContribution || typeof window.resourceDownloadCompletedContribution !== 'object') {
    window.resourceDownloadCompletedContribution = { loadedBytes: 0, totalBytes: 0 };
  }
  window.resourceDownloadCompletedContribution.loadedBytes = Math.max(0, Number(window.resourceDownloadCompletedContribution.loadedBytes) || 0) + loadedSafe;
  window.resourceDownloadCompletedContribution.totalBytes = Math.max(0, Number(window.resourceDownloadCompletedContribution.totalBytes) || 0) + Math.max(totalSafe, loadedSafe);
}

function cancelResourceDownload(resourceId) {
  const rid = String(resourceId || '').trim();
  const task = getResourceDownloadTask(rid);
  if (task && task.active) {
    task.cancelled = true;
    try { task.abortController?.abort(); } catch { /* ignore */ }
    try { task.xhr?.abort(); } catch { /* ignore */ }
    if (Number.isFinite(Number(task.chromeDownloadId)) && chrome?.downloads?.cancel) {
      try { chrome.downloads.cancel(Number(task.chromeDownloadId), () => {}); } catch { /* ignore */ }
    }
    return true;
  }

  const queued = window.resourceDownloadQueueById?.[rid];
  if (queued && !queued.started) {
    const expectedBytes = Math.max(0, Number(queued.expectedBytes) || getResourceItemSizeBytes(queued.item));
    queued.cancelled = true;
    window.resourceDownloadQueue = (window.resourceDownloadQueue || []).filter((it) => it !== queued);
    delete window.resourceDownloadQueueById[rid];
    try { queued.reject(new Error('下载已取消')); } catch { /* ignore */ }
    setResourceDownloadUi(rid, {
      active: true,
      percent: 0,
      loaded: 0,
      total: expectedBytes,
      speed: 0,
      etaSec: null,
      status: '已取消'
    });
    setTimeout(() => {
      setResourceDownloadUi(rid, { active: false, percent: 0, loaded: 0, total: 0, speed: 0, etaSec: null, status: '' });
      setResourceItemDownloadingState(rid, false);
    }, 1200);
    return true;
  }
  return false;
}

function setResourceDownloadUi(resourceId, { active = false, percent = 0, loaded = 0, total = 0, speed = 0, etaSec = null, status = '' } = {}) {
  const row = findResourceItemElementById(resourceId);
  if (!row) return;
  const task = getResourceDownloadTask(resourceId);
  const requestedTotal = Math.max(0, Number(total) || 0);
  const knownTaskTotal = Math.max(0, Number(task?.total) || 0);
  const knownItemTotal = getKnownResourceSizeBytes(resourceId);
  const effectiveTotal = requestedTotal > 0
    ? requestedTotal
    : (active ? Math.max(knownTaskTotal, knownItemTotal) : 0);
  const wrap = row.querySelector('.resource-download-progress');
  const bar = row.querySelector('.resource-download-progress .progress-bar');
  const statusEl = row.querySelector('.resource-dl-status');
  const sizeEl = row.querySelector('.resource-dl-size');
  const speedEl = row.querySelector('.resource-dl-speed');
  const etaEl = row.querySelector('.resource-dl-eta');
  if (!(wrap instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;

  wrap.style.display = active ? 'block' : 'none';

  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  bar.style.width = `${pct}%`;
  bar.textContent = '';

  if (statusEl instanceof HTMLElement) statusEl.textContent = String(status || '');

  if (sizeEl instanceof HTMLElement) {
    const loadedSafe = Math.max(0, Number(loaded) || 0);
    const totalSafe = effectiveTotal;
    sizeEl.style.cssText = 'margin-left:6px;';
    if (totalSafe > 0) {
      sizeEl.innerHTML = `(${renderFileSizePair(loadedSafe, totalSafe)})`;
    } else if (loadedSafe > 0) {
      sizeEl.innerHTML = `(${renderFileSizeText(loadedSafe)})`;
    } else if (active) {
      sizeEl.textContent = '(未知大小)';
    } else {
      sizeEl.textContent = '';
    }
  }

  if (speedEl instanceof HTMLElement) {
    setSpeedDisplay(speedEl, speed, active ? null : '');
  }
  if (etaEl instanceof HTMLElement) {
    if (active && Number.isFinite(Number(etaSec)) && Number(etaSec) > 0) {
      etaEl.textContent = `剩余: ${formatEta(Number(etaSec))}`;
    } else if (active && effectiveTotal > 0 && loaded >= effectiveTotal) {
      etaEl.textContent = '剩余: 0秒';
    } else if (active) {
      etaEl.textContent = '剩余: --';
    } else {
      etaEl.textContent = '';
    }
  }

  if (task) {
    task.loaded = Math.max(0, Number(loaded) || 0);
    task.total = effectiveTotal;
    task.speed = Math.max(0, Number(speed) || 0);
  }
  updateResourceDownloadTotals();
}

async function downloadResourceItemWithProgress(item) {
  const id = String(item?.id || '').trim();
  let rawUrl = String(item?.url || '').trim();
  const fileName = ensureResourceDownloadFileName(item, rawUrl);
  const expectedBytes = getResourceItemSizeBytes(item);
  if (!id) throw new Error('资源链接无效');
  if (!rawUrl && item?.rpId) {
    const result = await fetchCoursewareRpUrl(item.rpId);
    rawUrl = String(result?.url || '').trim();
    if (rawUrl) item.url = rawUrl;
    else if (result?.loginExpired) {
      await restartVePlatformForLoginExpired('课件下载链接获取失败，正在重启智慧课程平台…');
      throw new Error('登录已失效，正在重启智慧课程平台');
    }
  }
  if (!rawUrl) throw new Error('资源链接无效');

  if (isResourceDownloadActive(id)) {
    throw new Error('该文件正在下载中');
  }

  const url = (() => {
    try {
      return encodeURI(rawUrl);
    } catch {
      return rawUrl;
    }
  })();

  const PROGRESS_INTERVAL_MS = 180;
  const task = {
    active: true,
    loaded: 0,
    total: expectedBytes,
    speed: 0,
    samples: [],
    lastUiTs: 0,
    abortController: null,
    xhr: null,
    cancelled: false,
    chromeDownloadId: null
  };
  window.resourceDownloadTasks[id] = task;
  setResourceItemDownloadingState(id, true);
  setResourceDownloadUi(id, {
    active: true,
    percent: 0,
    loaded: 0,
    total: expectedBytes,
    speed: 0,
    etaSec: null,
    status: '下载中…'
  });

  const updateProgress = (loaded, total, status = '下载中…', force = false) => {
    const now = Date.now();
    const loadedSafe = Math.max(0, Number(loaded) || 0);
    const totalSafe = Math.max(0, Number(total) || 0);
    task.loaded = loadedSafe;
    if (totalSafe > 0) task.total = totalSafe;
    const effectiveTotal = task.total;

    const speed = pushAndCalcRecentSpeed(task.samples, loadedSafe, now);
    task.speed = speed;

    if (!force && now - task.lastUiTs < PROGRESS_INTERVAL_MS) return;
    task.lastUiTs = now;

    const percent = effectiveTotal > 0
      ? Math.max(0, Math.min(100, (loadedSafe / effectiveTotal) * 100))
      : 0;
    const etaSec = (effectiveTotal > 0 && speed > 0) ? ((effectiveTotal - loadedSafe) / speed) : null;
    setResourceDownloadUi(id, {
      active: true,
      percent,
      loaded: loadedSafe,
      total: effectiveTotal,
      speed,
      etaSec,
      status
    });
  };

  const finalizeSuccessUi = (loaded, total, status = '已保存') => {
    setResourceDownloadUi(id, {
      active: true,
      percent: 100,
      loaded,
      total,
      speed: 0,
      etaSec: 0,
      status
    });
  };

  const finalizeCancelledUi = () => {
    setResourceDownloadUi(id, {
      active: true,
      percent: 0,
      loaded: 0,
      total: 0,
      speed: 0,
      etaSec: null,
      status: '已取消'
    });
  };

  const cleanup = () => {
    task.active = false;
    task.speed = 0;
    task.abortController = null;
    task.xhr = null;
    task.chromeDownloadId = null;
    delete window.resourceDownloadTasks[id];
    const qEntry = window.resourceDownloadQueueById?.[id];
    if (qEntry) {
      qEntry.settled = true;
      delete window.resourceDownloadQueueById[id];
    }
    setResourceItemDownloadingState(id, false);
    updateResourceDownloadTotals();
    setTimeout(() => {
      setResourceDownloadUi(id, { active: false, percent: 0, loaded: 0, total: 0, speed: 0, etaSec: null, status: '' });
    }, 1800);
  };

  const saveBlobToFile = (blob, loaded = 0, total = 0) => {
    if (task.cancelled) throw new Error('下载已取消');
    const finalTotal = total > 0 ? total : (blob?.size || loaded);
    const finalLoaded = blob?.size || loaded;
    addResourceDownloadCompletedContribution(finalLoaded, finalTotal);
    finalizeSuccessUi(finalLoaded, finalTotal, '下载完成，准备保存…');

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    a.rel = 'noopener noreferrer';
    a.click();
    setTimeout(() => {
      try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
    }, 1500);

    finalizeSuccessUi(finalLoaded, finalTotal, '已保存');
  };

  const tryDownloadByXhr = () => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    task.xhr = xhr;
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    xhr.onprogress = (e) => {
      updateProgress(Number(e.loaded || 0), Number(e.total || 0), '下载中…');
    };

    xhr.onload = () => {
      task.xhr = null;
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`HTTP ${xhr.status}`));
        return;
      }
      const blob = xhr.response;
      if (!(blob instanceof Blob)) {
        reject(new Error('返回内容无效'));
        return;
      }
      const loaded = Number(blob.size || 0);
      const total = Number(xhr.getResponseHeader('content-length') || loaded || 0);
      updateProgress(loaded, total, '下载中…', true);
      resolve({ blob, loaded, total });
    };

    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.onabort = () => reject(new Error(task.cancelled ? '下载已取消' : '下载已中止'));
    xhr.send();
  });

  const fallbackToBrowserDirectDownload = () => {
    if (task.cancelled) throw new Error('下载已取消');
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
    finalizeSuccessUi(0, 0, '已转为浏览器下载');
  };

  const tryChromeDownloadsApi = () => new Promise((resolve, reject) => {
    if (!chrome?.downloads?.download) {
      reject(new Error('downloads-api-unavailable'));
      return;
    }
    chrome.downloads.download(
      {
        url,
        filename: fileName,
        conflictAction: 'uniquify',
        saveAs: false
      },
      (downloadId) => {
        const err = chrome.runtime?.lastError;
        if (err) {
          reject(new Error(String(err.message || 'downloads-api-failed')));
          return;
        }
        if (!Number.isFinite(Number(downloadId)) || Number(downloadId) <= 0) {
          reject(new Error('downloads-api-invalid-id'));
          return;
        }
        task.chromeDownloadId = Number(downloadId);
        resolve(downloadId);
      }
    );
  });

  try {
    task.abortController = new AbortController();
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      signal: task.abortController.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get('content-length') || 0);
    let loaded = 0;
    let blob;

    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (task.cancelled) throw new Error('下载已取消');
          chunks.push(value);
          loaded += value.byteLength;
          updateProgress(loaded, total, '下载中…');
        }
      }
      blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/octet-stream' });
    } else {
      blob = await res.blob();
      loaded = blob.size;
      updateProgress(loaded, total || loaded, '下载中…', true);
    }

    saveBlobToFile(blob, loaded, total);
    cleanup();
  } catch (fetchErr) {
    if (task.cancelled || String(fetchErr?.name || '').toLowerCase() === 'aborterror') {
      finalizeCancelledUi();
      cleanup();
      throw new Error('下载已取消');
    }
    try {
      setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: task.speed, etaSec: null, status: 'Fetch失败，正在重试…' });
      const xhrResult = await tryDownloadByXhr();
      saveBlobToFile(xhrResult.blob, xhrResult.loaded, xhrResult.total);
      cleanup();
    } catch (xhrErr) {
      if (task.cancelled) {
        finalizeCancelledUi();
        cleanup();
        throw new Error('下载已取消');
      }
      try {
        setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: task.speed, etaSec: null, status: '页面下载失败，转浏览器下载…' });
        await tryChromeDownloadsApi();
        finalizeSuccessUi(0, 0, '已转为浏览器下载');
        cleanup();
      } catch {
        try {
          fallbackToBrowserDirectDownload();
          cleanup();
        } catch {
          setResourceDownloadUi(id, { active: true, percent: 0, loaded: 0, total: 0, speed: 0, etaSec: null, status: '下载失败' });
          cleanup();
          throw new Error(`下载失败: ${String(fetchErr?.message || fetchErr)}; ${String(xhrErr?.message || xhrErr)}`);
        }
      }
    }
  }
}

function renderResourceSpaceList() {
  if (!resourceSpaceList) return;
  const list = Array.isArray(window.resourceSpaceItems) ? window.resourceSpaceItems : [];
  if (!list.length) {
    resourceSpaceList.innerHTML = '<div style="font-size:12px; color:#999;">暂无资源文件</div>';
    refreshResourceSelectAllButton();
    return;
  }

  resourceSpaceList.innerHTML = list.map((it) => {
    const id = String(it.id || '').trim();
    const checked = window.resourceSpaceSelected.has(id) ? 'checked' : '';
    const name = String(it.name || '未命名文件').trim();
    const uploadTime = String(it.inputTime || '未知').trim();
    const sizeMb = String(it.sizeMb || '未知').trim();
    const sizeStyle = buildResourceSizeEmphasisStyle(it?.sizeMbRaw);
    const url = String(it.url || '').trim();
    return `
      <div class="file-item" data-resource-id="${escapeHtml(id)}">
        <div class="resource-row-main">
          <div class="resource-row-left">
            <input type="checkbox" data-action="resource-check" data-resource-id="${escapeHtml(id)}" ${checked} style="margin-top:2px;">
            <div style="min-width:0; flex:1;">
              <div class="resource-row-title">
                <span class="resource-name">${escapeHtml(name)}</span>
                <span class="resource-time-inline file-size-emphasis" data-file-size-mb="${escapeHtml(String(Number(it?.sizeMbRaw) || 0))}" style="${sizeStyle}">${escapeHtml(sizeMb)}</span>
                <span class="resource-time-inline">上传时间: ${escapeHtml(uploadTime)}</span>
              </div>
              <div class="resource-link-row">
                <a class="resource-url" href="${escapeHtml(url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
                <button class="btn resource-copy-btn" data-action="resource-copy" data-resource-id="${escapeHtml(id)}">复制</button>
                <button class="btn resource-download-btn" data-action="resource-download" data-resource-id="${escapeHtml(id)}">下载</button>
              </div>
            </div>
          </div>
        </div>
        <div class="resource-download-progress" style="display:none;">
          <div class="progress-bar-container"><div class="progress-bar"></div></div>
          <div class="resource-download-meta">
            <span class="resource-dl-status"></span>
            <span class="resource-dl-size"></span>
            <span class="resource-dl-speed"></span>
            <span class="resource-dl-eta"></span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  refreshResourceSelectAllButton();
  updateResourceDownloadTotals();
}
