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

async function persistSavedUploads(list = window.savedUploadedFiles, strict = false) {
  try {
    await chrome.storage.local.set({ [SAVED_UPLOADS_KEY]: list });
  } catch (error) {
    if (strict) throw error;
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
    sha256: await globalThis.BjtuVeUploadCommon.fileHash(file),
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
  await removeSavedUploads(new Set([target]));
}

async function removeSavedUploads(ids) {
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const next = list.filter((it) => it && !ids.has(it.id));
  await persistSavedUploads(next, true);
  window.savedUploadedFiles = next;
  // Clean up the synthesized meta entry so the checkbox can no longer find the file.
  for (const id of ids) {
    if (window.uploadedFileMetaById) delete window.uploadedFileMetaById[`saved_${id}`];
  }
  renderSavedUploadsSection();
}

function normalizeSavedUploadUrl(value) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error('URL 必须是有效的 HTTP(S) 地址');
  if (!/^https?:\/\//i.test(value)) throw new Error('URL 仅支持 HTTP(S)');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('URL 不允许包含账号或密码');
  url.hash = '';
  url.searchParams.sort();
  return url.href;
}

function validateSavedUploadsImport(data) {
  // Export uses the storage array verbatim; also accept a chrome.storage-style envelope.
  const list = Array.isArray(data) ? data
    : data && typeof data === 'object' && Object.keys(data).length === 1 ? data[SAVED_UPLOADS_KEY] : null;
  if (!Array.isArray(list)) throw new Error('JSON 必须是文件记录数组或 savedUploadedFiles 对象');
  if (list.length > 10000) throw new Error('一次最多导入 10000 条记录');
  const allowed = new Set(['id', 'fileName', 'fileSize', 'sha256', 'visitName', 'url', 'savedAt']);
  return list.map((item, index) => {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !allowed.has(key))) throw new Error('记录结构或字段不正确');
      for (const key of ['id', 'fileName', 'visitName', 'url']) {
        if (typeof item[key] !== 'string' || !item[key].trim() || /[\u0000-\u001f\u007f]/.test(item[key])) throw new Error(`${key} 必须是非空字符串`);
      }
      if (!Number.isSafeInteger(item.fileSize) || item.fileSize < 0) throw new Error('fileSize 必须是非负安全整数');
      if (!Number.isSafeInteger(item.savedAt) || item.savedAt < 0 || item.savedAt > 8640000000000000) throw new Error('savedAt 必须是有效时间戳');
      if (item.sha256 !== undefined && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256))) throw new Error('sha256 必须是 64 位十六进制散列');
      normalizeSavedUploadUrl(item.url);
      // Keep the actual URL intact: rewriting query encoding can invalidate signed links.
      return { id: item.id.trim(), fileName: item.fileName.trim(), fileSize: item.fileSize, visitName: item.visitName.trim(), url: item.url, savedAt: item.savedAt, ...(item.sha256 === undefined ? {} : { sha256: item.sha256.toLowerCase() }) };
    } catch (error) {
      throw new Error(`第 ${index + 1} 条记录：${error.message}`);
    }
  });
}

function mergeSavedUploadsImport(current, imported) {
  const visits = new Set();
  const urls = new Set();
  const hashes = new Set();
  const ids = new Set(current.map((item) => item.id));
  const remember = (item) => {
    visits.add(String(item.visitName || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/'));
    try { urls.add(normalizeSavedUploadUrl(item.url)); } catch { /* Preserve legacy records. */ }
    if (item.sha256) hashes.add(String(item.sha256).toLowerCase());
  };
  current.forEach(remember);
  const added = [];
  for (const item of imported) {
    const visit = item.visitName.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (visits.has(visit) || urls.has(normalizeSavedUploadUrl(item.url)) || (item.sha256 && hashes.has(item.sha256))) continue;
    let id = item.id;
    while (ids.has(id)) id = `up_${globalThis.crypto.randomUUID()}`;
    const entry = { ...item, id };
    ids.add(id);
    remember(entry);
    added.push(entry);
  }
  return { list: [...added, ...current], added: added.length, skipped: imported.length - added.length };
}

function getSelectedSavedUploadIds() {
  return new Set(Array.from(document.querySelectorAll('#saved-uploads-section[data-expanded="1"] .submit-file-check:checked'), (checkbox) => checkbox.dataset.fileId.slice('saved_'.length)));
}

let savedUploadsMutationBusy = false;
let savedUploadsToolbarMarkup = '';
let savedUploadsUiReady;

function refreshSavedUploadActions() {
  const section = document.getElementById('saved-uploads-section');
  if (!section) return;
  const count = getSelectedSavedUploadIds().size;
  section.querySelectorAll('[data-action="export-saved-uploads"], [data-action="delete-selected-saved-uploads"]').forEach((button) => { button.disabled = savedUploadsMutationBusy || count === 0; });
  section.querySelectorAll('[data-action="import-saved-uploads"], [data-action="delete-saved-upload"]').forEach((button) => { button.disabled = savedUploadsMutationBusy; });
  const feedback = section.querySelector('.saved-uploads-selection');
  if (feedback) feedback.textContent = `已选 ${count} 个文件`;
}

async function exportSelectedSavedUploads() {
  const ids = getSelectedSavedUploadIds();
  const list = (window.savedUploadedFiles || []).filter((item) => ids.has(item.id));
  if (!list.length) return;
  await navigator.clipboard.writeText(JSON.stringify(list, null, 2));
  showToast(`已复制 ${list.length} 个文件的记录`, 'success', 2000);
}

let savedUploadsToggleAnimationSerial = 0;

function updateSavedUploadsToggleButton(section, expanded) {
  const button = section?.querySelector('[data-action="toggle-saved-uploads"]');
  if (!(button instanceof HTMLButtonElement)) return;
  const count = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles.length : 0;
  const text = expanded ? button.dataset.expandedText : button.dataset.collapsedText;
  button.classList.toggle('is-expanded', expanded);
  button.classList.toggle('homework-toggle-btn--up', expanded);
  button.classList.toggle('homework-toggle-btn--down', !expanded);
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  const label = button.querySelector('.homework-toggle-label');
  if (label instanceof HTMLElement) label.textContent = `${text || ''} (${count})`;
}

function animateSavedUploadsItems(section, expanding, initialHeight) {
  const list = section.querySelector('.saved-uploads-list');
  if (!(list instanceof HTMLElement)) return Promise.resolve(false);
  const interrupted = !!list.__heightMotion && !!list.__listTransition
    && list.__listTransition.open !== expanding;
  const scrollMotionEnabled = interrupted
    ? list.__listTransition.scroll
    : expanding ? window.scrollExpandHomeworkLists === true : window.scrollCollapseHomeworkLists !== false;
  const transition = { open: expanding, scroll: scrollMotionEnabled };
  list.__listTransition = transition;
  const previousScrollMotion = list.__scrollListMotion;
  list.__heightMotion?.cancel();
  list.__savedUploadsFade?.reset();
  delete list.__savedUploadsFade;
  if (!scrollMotionEnabled && previousScrollMotion) {
    previousScrollMotion.reset();
    delete list.__scrollListMotion;
  }

  const from = initialHeight ?? list.getBoundingClientRect().height;
  const fullHeight = Math.max(list.scrollHeight, from, previousScrollMotion?.fullHeight || 0, 1);
  list.style.boxSizing = 'border-box';
  list.style.height = `${from}px`;
  list.style.overflow = 'hidden';
  const motion = scrollMotionEnabled
    ? previousScrollMotion || createListScrollMotion(list, fullHeight)
    : createTopDownListFade(list.children, list, fullHeight);
  if (scrollMotionEnabled) list.__scrollListMotion = motion;
  else list.__savedUploadsFade = motion;
  return animateHeightWithMotion(list, from, expanding ? fullHeight : 0, (height) => {
    list.style.height = `${height}px`;
    motion.update(height);
  }).then((completed) => {
    if (!completed) return false;
    if (list.__listTransition === transition) delete list.__listTransition;
    motion.reset();
    if (scrollMotionEnabled) delete list.__scrollListMotion;
    else delete list.__savedUploadsFade;
    list.style.height = '';
    list.style.boxSizing = '';
    list.style.overflow = '';
    return completed;
  });
}

function renderSavedUploadsSection() {
  const section = document.getElementById('saved-uploads-section');
  if (!(section instanceof HTMLElement)) return;
  const list = Array.isArray(window.savedUploadedFiles) ? window.savedUploadedFiles : [];
  const count = list.length;
  const selectedIds = getSelectedSavedUploadIds();
  if (count === 0) {
    section.innerHTML = `<div class="saved-uploads-list">${savedUploadsToolbarMarkup}</div>`;
    section.dataset.expanded = '0';
    if (typeof refreshUploadedFileActions === 'function') refreshUploadedFileActions();
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
      sha256: it.sha256,
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
    const size = renderFileSizeText(sizeBytes, formatSize(sizeBytes));
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
              <input type="checkbox" class="submit-file-check" data-file-id="${safeSynthFileId}" ${selectedIds.has(entryId) ? 'checked' : ''}>
              <span class="upload-select-caption">作为作业附件</span>
            </label>
            <strong class="saved-upload-name">${name}</strong>
            <span class="size-progress" style="margin-left:5px;">${size}</span>${timeHtml}
          </div>
          <div class="saved-upload-actions">
            <button type="button" class="btn saved-upload-delete" data-action="delete-saved-upload" data-saved-upload-id="${safeEntryId}" style="padding:2px 8px; font-size:12px; background-color:#f44336;">删除</button>
          </div>
        </div>
        <div class="upload-link-row">
          <a class="url-link" href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>
          <button type="button" class="btn saved-upload-copy" data-action="copy-saved-upload" data-saved-upload-id="${safeEntryId}">复制</button>
          <button type="button" class="btn saved-upload-download" data-action="download-saved-upload" data-saved-upload-id="${safeEntryId}" data-url="${safeHref}" data-filename="${escapeHtml(it.fileName || '')}">下载</button>
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
    ${expanded ? `<div class="saved-uploads-list">${savedUploadsToolbarMarkup}${cardsHtml}<div class="saved-uploads-divider" aria-hidden="true"></div></div>` : ''}
  `;
  if (typeof refreshUploadSelectVisibility === 'function') {
    refreshUploadSelectVisibility();
  }
}

function setupSavedUploadsUi() {
  return savedUploadsUiReady ||= initializeSavedUploadsUi();
}

async function initializeSavedUploadsUi() {
  const response = await fetch(chrome.runtime.getURL('modules/ve/uploader/saved-uploads.html'));
  if (!response.ok) throw new Error(`已上传文件界面加载失败：HTTP ${response.status}`);
  const markup = new DOMParser().parseFromString(await response.text(), 'text/html');
  savedUploadsToolbarMarkup = markup.getElementById('saved-uploads-toolbar-template').innerHTML;
  const modal = document.importNode(markup.getElementById('saved-uploads-import-modal'), true);
  document.body.append(modal);
  const input = modal.querySelector('textarea');
  const importError = modal.querySelector('.saved-uploads-import-error');
  modal.querySelectorAll('[data-action="close"]').forEach(button => button.addEventListener('click', () => {
    if (!savedUploadsMutationBusy) modal.close();
  }));
  modal.addEventListener('cancel', event => { if (savedUploadsMutationBusy) event.preventDefault(); });
  modal.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (savedUploadsMutationBusy) return;
    savedUploadsMutationBusy = true;
    const submit = modal.querySelector('[type="submit"]');
    submit.disabled = true;
    input.readOnly = true;
    importError.hidden = true;
    refreshSavedUploadActions();
    try {
      const imported = validateSavedUploadsImport(JSON.parse(input.value.replace(/^\uFEFF/, '')));
      const result = mergeSavedUploadsImport(window.savedUploadedFiles || [], imported);
      if (result.added) {
        await persistSavedUploads(result.list, true);
        window.savedUploadedFiles = result.list;
        document.getElementById('saved-uploads-section').dataset.expanded = '1';
        renderSavedUploadsSection();
      }
      modal.close();
      showToast(`已导入 ${result.added} 个文件，跳过 ${result.skipped} 个重复记录`, 'success', 2500);
    } catch (error) {
      importError.textContent = `导入失败：${String(error?.message || error)}`;
      importError.hidden = false;
    } finally {
      savedUploadsMutationBusy = false;
      submit.disabled = false;
      input.readOnly = false;
      refreshSavedUploadActions();
    }
  });
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
      document.querySelectorAll('#saved-uploads-section[data-expanded="1"] .saved-uploads-list > .file-item input.submit-file-check').forEach(cb => { cb.checked = !cb.checked; });
      if (typeof refreshUploadedFileActions === 'function') refreshUploadedFileActions();
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
        if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return;
        if (action === 'import-saved-uploads') {
          input.value = '';
          importError.hidden = true;
          modal.showModal();
          input.focus();
          try {
            const clipboard = await navigator.clipboard.readText();
            if (modal.open && !input.value) input.value = clipboard.slice(0, input.maxLength);
          } catch { /* Manual input remains available without clipboard permission. */ }
          return;
        }
        if (action === 'export-saved-uploads') {
          try { await exportSelectedSavedUploads(); }
          catch (error) { showToast(`导出失败：${String(error?.message || error)}`, 'error', 2500); }
          return;
        }
        if (action === 'delete-selected-saved-uploads' || action === 'delete-saved-upload') {
          if (savedUploadsMutationBusy) return;
          const ids = action === 'delete-saved-upload' ? new Set([actionEl.dataset.savedUploadId]) : getSelectedSavedUploadIds();
          if (!ids.size) return;
          savedUploadsMutationBusy = true;
          refreshSavedUploadActions();
          try {
            await removeSavedUploads(ids);
            showToast(`已删除 ${ids.size} 条本地记录，远程文件不受影响`, 'success', 2000);
          } catch (error) {
            showToast(`删除失败：${String(error?.message || error)}`, 'error', 2500);
          } finally {
            savedUploadsMutationBusy = false;
            refreshSavedUploadActions();
          }
          return;
        }
        if (action === 'toggle-saved-uploads') {
          const expanded = section.dataset.expanded === '1';
          const serial = ++savedUploadsToggleAnimationSerial;
          if (!expanded) {
            const hasItems = !!section.querySelector('.saved-uploads-list');
            section.dataset.expanded = '1';
            if (hasItems) updateSavedUploadsToggleButton(section, true);
            else renderSavedUploadsSection();
            void animateSavedUploadsItems(section, true, hasItems ? undefined : 0);
            return;
          }
          section.dataset.expanded = '0';
          if (typeof refreshUploadedFileActions === 'function') refreshUploadedFileActions();
          updateSavedUploadsToggleButton(section, false);
          await animateSavedUploadsItems(section, false);
          if (serial === savedUploadsToggleAnimationSerial && section.dataset.expanded === '0') {
            renderSavedUploadsSection();
          }
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
