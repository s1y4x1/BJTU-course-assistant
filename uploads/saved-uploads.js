// -------------------- Saved Uploads (本地保存本次上传过的文件) --------------------
const SAVED_UPLOADS_KEY = 'savedUploadedFiles';
const SAVE_UPLOADS_ENABLED_KEY = 'saveUploadedFilesEnabled';

async function loadSavedUploadsFromStorage() {
  try {
    const raw = await chrome.storage.local.get([SAVED_UPLOADS_KEY, SAVE_UPLOADS_ENABLED_KEY]);
    const list = raw?.[SAVED_UPLOADS_KEY];
    window.savedUploadedFiles = Array.isArray(list) ? list.filter((it) => it && it.url && it.visitName) : [];
    if (typeof raw?.[SAVE_UPLOADS_ENABLED_KEY] === 'boolean') {
      window.saveUploadedFilesEnabled = raw[SAVE_UPLOADS_ENABLED_KEY];
    }
  } catch {
    window.savedUploadedFiles = [];
  }
}

async function persistSavedUploads() {
  try {
    await chrome.storage.local.set({ [SAVED_UPLOADS_KEY]: window.savedUploadedFiles });
  } catch {
    // ignore quota / IO errors
  }
}

async function persistSaveUploadsEnabled() {
  try {
    await chrome.storage.local.set({ [SAVE_UPLOADS_ENABLED_KEY]: !!window.saveUploadedFilesEnabled });
  } catch {
    // ignore
  }
}

async function addSavedUpload(file, serverData, convertedUrl) {
  if (!window.saveUploadedFilesEnabled) return;
  const visitName = String(serverData?.visitName || '').trim();
  const url = String(convertedUrl || '').trim();
  if (!visitName || !url) return;
  const fileName = String(file?.name || '').trim() || '(未命名)';
  const fileSize = Number(file?.size || 0);
  const entry = {
    id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    fileSize,
    visitName,
    url,
    savedAt: Date.now()
  };
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const existingIdx = list.findIndex((it) => it && it.visitName === visitName);
  if (existingIdx >= 0) {
    list[existingIdx] = entry;
  } else {
    list.unshift(entry);
  }
  window.savedUploadedFiles = list;
  await persistSavedUploads();
}

async function removeSavedUpload(id) {
  const target = String(id || '').trim();
  if (!target) return;
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  window.savedUploadedFiles = list.filter((it) => it && it.id !== target);
  // Clean up the synthesized meta entry so the checkbox can no longer find the file.
  if (window.uploadedFileMetaById) {
    delete window.uploadedFileMetaById[`saved_${target}`];
  }
  await persistSavedUploads();
  renderSavedUploadsSection();
}

function formatSavedUploadSize(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderSavedUploadsSection() {
  const section = document.getElementById('saved-uploads-section');
  if (!(section instanceof HTMLElement)) return;
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const count = list.length;
  if (count === 0) {
    section.innerHTML = '';
    section.dataset.expanded = '0';
    return;
  }
  const expanded = section.dataset.expanded === '1';
  const collapsedText = '查看全部已上传文件';
  const expandedText = '收起全部已上传文件';
  const toggleLabel = `${expanded ? expandedText : collapsedText} (${count})`;
  const direction = expanded ? 'up' : 'down';

  // Register synthesized metas so saved files can be selected as homework attachments.
  if (!window.uploadedFileMetaById) window.uploadedFileMetaById = {};
  for (const it of list) {
    if (!it || !it.id || !it.visitName || !it.url) continue;
    const synthId = `saved_${it.id}`;
    const nameParts = splitFileName(it.fileName || '');
    window.uploadedFileMetaById[synthId] = {
      fileNameNoExt: String(nameParts?.fileNameNoExt || ''),
      fileExtName: String(nameParts?.fileExtName || ''),
      fileSize: String(Number(it.fileSize || 0) || 0),
      visitName: String(it.visitName || ''),
      pid: '',
      ftype: 'insert'
    };
  }

  const cardsHtml = list.map((it) => {
    const entryId = String(it.id || '').trim();
    if (!entryId) return '';
    const synthFileId = `saved_${entryId}`;
    const name = escapeHtml(it.fileName || '(未命名)');
    const sizeBytes = Number(it.fileSize || 0);
    const size = renderFileSizeText(sizeBytes, formatSavedUploadSize(sizeBytes));
    const url = String(it.url || '').trim();
    const safeUrl = escapeHtml(url);
    const safeHref = escapeHtml(url);
    const safeEntryId = escapeHtml(entryId);
    const safeSynthFileId = escapeHtml(synthFileId);
    const timeText = it.savedAt ? new Date(it.savedAt).toLocaleString('zh-CN', { hour12: false }) : '';
    const timeHtml = timeText ? ` <span class="resource-time-inline">上传时间: ${escapeHtml(timeText)}</span>` : '';
    return `
      <div class="file-item" data-saved-upload-id="${safeEntryId}" data-resource-id="${safeSynthFileId}">
        <div class="upload-file-head-row" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
          <div class="saved-upload-main">
            <label class="upload-select-wrap">
              <input type="checkbox" class="submit-file-check" data-file-id="${safeSynthFileId}">
              作为作业附件
            </label>
            <strong class="saved-upload-name">${name}</strong>
            <span class="inline-status" style="font-size:12px; margin-left:8px; color:#2e7d32;">已上传</span>
            <span class="size-progress" style="margin-left:5px;">${size}</span>${timeHtml}
          </div>
          <div class="saved-upload-actions">
            <button type="button" class="btn saved-upload-delete" data-action="delete-saved-upload" data-saved-upload-id="${safeEntryId}" style="padding:2px 8px; font-size:12px; background-color:#f44336;">删除</button>
          </div>
        </div>
        <div class="upload-link-row">
          <a class="url-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>
          <button type="button" class="btn saved-upload-copy" data-action="copy-saved-upload" data-saved-upload-id="${safeEntryId}" style="padding:2px 8px; font-size:12px; white-space:nowrap;">复制</button>
          <button type="button" class="btn saved-upload-download" data-action="download-saved-upload" data-saved-upload-id="${safeEntryId}" data-url="${safeHref}" data-filename="${escapeHtml(it.fileName || '')}" style="padding:2px 8px; font-size:12px; white-space:nowrap; background:#1e3a8a;">下载</button>
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

  section.innerHTML = `
    <div class="homework-toggle-row homework-toggle-row--saved-uploads">
      <button class="btn homework-toggle-btn ${expanded ? 'is-expanded' : ''} homework-toggle-btn--${direction}" data-action="toggle-saved-uploads" data-collapsed-text="${escapeHtml(collapsedText)}" data-expanded-text="${escapeHtml(expandedText)}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
        <span class="homework-toggle-label">${escapeHtml(toggleLabel)}</span>
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
      </button>
    </div>
    <div class="saved-uploads-list homework-group ${expanded ? '' : 'is-hidden'} homework-group-animating">${cardsHtml}</div>
  `;
  if (typeof refreshUploadSelectVisibility === 'function') {
    refreshUploadSelectVisibility();
  }
}

function setupSavedUploadsUi() {
  const cb = document.getElementById('save-uploads-enabled');
  if (cb instanceof HTMLInputElement) {
    cb.checked = !!window.saveUploadedFilesEnabled;
    cb.addEventListener('change', () => {
      window.saveUploadedFilesEnabled = !!cb.checked;
      persistSaveUploadsEnabled();
    });
  }
  const invertBtn = document.getElementById('invert-save-uploads-btn');
  if (invertBtn) {
    invertBtn.addEventListener('click', () => {
      document.querySelectorAll('#file-list .file-item input.submit-file-check').forEach(cb => { cb.checked = !cb.checked; });
      document.querySelectorAll('.saved-uploads-list:not(.is-hidden) .file-item input.submit-file-check').forEach(cb => { cb.checked = !cb.checked; });
    });
  }
  const section = document.getElementById('saved-uploads-section');
  if (section instanceof HTMLElement) {
    section.addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;

      // Handle action buttons first
      const actionEl = t.closest('[data-action]');
      if (actionEl instanceof HTMLElement) {
        const action = String(actionEl.dataset.action || '').trim();
        if (action === 'toggle-saved-uploads') {
          const expanded = section.dataset.expanded === '1';
          const nextExpanded = expanded ? '0' : '1';
          section.dataset.expanded = nextExpanded;
          const list = section.querySelector('.saved-uploads-list');
          if (list) {
            if (nextExpanded === '1') list.classList.remove('is-hidden');
            else list.classList.add('is-hidden');
          }
          const btn = actionEl;
          const isExpanded = nextExpanded === '1';
          btn.classList.toggle('is-expanded', isExpanded);
          btn.classList.toggle('homework-toggle-btn--up', isExpanded);
          btn.classList.toggle('homework-toggle-btn--down', !isExpanded);
          btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
          return;
        }
        if (action === 'delete-saved-upload') {
          const id = String(actionEl.dataset.savedUploadId || '').trim();
          if (id) removeSavedUpload(id);
          return;
        }
        if (action === 'copy-saved-upload') {
          const id = String(actionEl.dataset.savedUploadId || '').trim();
          const entry = (window.savedUploadedFiles || []).find((it) => it && it.id === id);
          if (entry && entry.url) {
            navigator.clipboard.writeText(entry.url).then(() => {
              showToast('链接已复制', 'success', 1200);
            }).catch(() => {
              if (typeof showToast === 'function') {
                showToast('复制失败，请手动复制链接', 'error', 2000);
              }
            });
          }
          return;
        }
        if (action === 'cancel-saved-upload') {
          const id = `saved_${String(actionEl.dataset.savedUploadId || '').trim()}`;
          if (id) cancelResourceDownload(id);
          return;
        }
        if (action === 'download-saved-upload') {
          const url = String(actionEl.dataset.url || '').trim();
          const filename = String(actionEl.dataset.filename || '').trim() || '下载';
          const entryId = String(actionEl.dataset.savedUploadId || '').trim();
          const savedEntry = (window.savedUploadedFiles || []).find((it) => it && String(it.id || '').trim() === entryId);
          const sizeBytes = Math.max(0, Number(savedEntry?.fileSize) || 0);
          if (url) {
            try {
              await enqueueResourceDownload({
                id: `saved_${entryId}`,
                name: filename,
                url: url,
                extName: filename.includes('.') ? filename.split('.').pop() : '',
                sizeMb: sizeBytes > 0 ? formatSize(sizeBytes) : '-',
                sizeMbRaw: sizeBytes / (1024 * 1024),
                inputTime: ''
              });
            } catch (e) {
              showToast(`下载失败：${String(e?.message || e)}`, 'error', 2000);
            }
          }
          return;
        }
        return;
      }

      // Click on a head row (not on button/link/input) toggles the checkbox
      const row = t.closest('.upload-file-head-row');
      if (!(row instanceof HTMLElement)) return;
      if (t.closest('button,a,input,textarea,select,label')) return;
      const cb = row.querySelector('input.submit-file-check');
      if (!(cb instanceof HTMLInputElement)) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  renderSavedUploadsSection();
}
