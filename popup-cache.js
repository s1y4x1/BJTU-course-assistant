var POPUP_CACHE_ENABLED_KEY = window.POPUP_CACHE_ENABLED_KEY = 'popupUseFullscreenCacheEnabled';
var POPUP_FULLSCREEN_CACHE_KEY = window.POPUP_FULLSCREEN_CACHE_KEY = 'popupFullscreenCourseCache';

window.popupUseFullscreenCacheEnabled = true;
window.__popupUsingFullscreenCache = false;

async function loadPopupCacheEnabledSetting() {
  try {
    const data = await chrome.storage.local.get([POPUP_CACHE_ENABLED_KEY]);
    window.popupUseFullscreenCacheEnabled = data[POPUP_CACHE_ENABLED_KEY] === undefined
      ? true
      : !!data[POPUP_CACHE_ENABLED_KEY];
  } catch {
    window.popupUseFullscreenCacheEnabled = true;
  }
  return window.popupUseFullscreenCacheEnabled;
}

function safeStorageClone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value, (_key, val) => {
      if (typeof val === 'function') return undefined;
      if (val && typeof val.then === 'function') return undefined;
      if (val instanceof Set) return Array.from(val);
      return val;
    }));
  } catch {
    return fallback;
  }
}

function resetCachedPanelButton(btn, text, progressClass, progressProp) {
  if (!(btn instanceof HTMLElement)) return;
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.pointerEvents = 'auto';
  btn.classList.remove(progressClass);
  btn.classList.remove('courseware-list-loading');
  btn.classList.remove('replay-list-loading');
  btn.style.removeProperty(progressProp);
  btn.textContent = text;
}

function collapseRestoredCoursePanelsForPopup(root) {
  if (!(root instanceof HTMLElement)) return;
  root.querySelectorAll('.file-item').forEach((card) => {
    if (!(card instanceof HTMLElement)) return;
    delete card.dataset.resultView;
    const area = card.querySelector('.result-area');
    if (area instanceof HTMLElement) {
      area.innerHTML = '';
      area.style.display = 'none';
      area.style.maxHeight = '0px';
      area.style.opacity = '0';
      area.style.overflow = 'hidden';
      area.dataset.animOpen = '0';
    }
    card.querySelectorAll('.replay-shadow-area').forEach((el) => el.remove());
  });
  root.querySelectorAll('button[data-action="courseware"]').forEach((btn) => {
    resetCachedPanelButton(btn, '课件下载', 'courseware-link-progress', '--courseware-progress');
  });
  root.querySelectorAll('button[data-action="videos"]').forEach((btn) => {
    resetCachedPanelButton(btn, '回放下载', 'replay-link-progress', '--replay-progress');
  });
}

function getCollapsedCourseListHtmlForPopup() {
  if (!courseListDiv) return '';
  const clone = courseListDiv.cloneNode(true);
  collapseRestoredCoursePanelsForPopup(clone);
  return String(clone.innerHTML || '');
}

function normalizeRestoredCachesForPopup() {
  Object.values(window.coursewareCacheByCourseId || {}).forEach((cache) => {
    if (!cache) return;
    cache.rpLinksFetching = false;
  });
  Object.values(window.videoReplayCacheByCourseId || {}).forEach((cache) => {
    if (!cache) return;
    cache.linksFetching = false;
  });
  Object.values(window.courseCardStateById || {}).forEach((state) => {
    if (!state) return;
    state.replayListLoading = false;
    state.coursewareListLoading = false;
  });
}

function getPopupCacheTimestampText(ts) {
  const d = new Date(Number(ts || 0));
  if (Number.isNaN(d.getTime())) return '未知时间';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function showPopupCacheNotice(cache) {
  let el = document.getElementById('popup-cache-notice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'popup-cache-notice';
    el.style.cssText = 'margin:0 0 8px;padding:7px 10px;border:1px solid #f59e0b;border-radius:6px;background:#fffbeb;color:#92400e;font-size:12px;line-height:1.45;';
    const host = document.querySelector('.right-column') || courseListDiv?.parentElement || document.body;
    const resizer = host?.querySelector?.('.right-column-resizer');
    if (resizer?.nextSibling) host.insertBefore(el, resizer.nextSibling);
    else if (host?.firstChild) host.insertBefore(el, host.firstChild);
    else host?.appendChild(el);
  }
  const savedAt = getPopupCacheTimestampText(cache?.savedAt);
  el.textContent = `于 ${savedAt} 缓存。如需更新，请重启平台或全屏打开。`;
}

async function saveFullscreenCourseCache() {
  if (popupMode || !window.popupUseFullscreenCacheEnabled || !courseListDiv) return;
  const cache = {
    version: 1,
    savedAt: Date.now(),
    platformEnabled: safeStorageClone(window.platformEnabled, {}),
    platformLoginState: safeStorageClone(window.platformLoginState, {}),
    platformLoginChecked: safeStorageClone(window.platformLoginChecked, {}),
    platformLoadedOnce: safeStorageClone(window.platformLoadedOnce, {}),
    platformNeedLogin: safeStorageClone(window.platformNeedLogin, {}),
    currentVeCourseList: safeStorageClone(window.currentVeCourseList, []),
    courseHomeworkData: safeStorageClone(window.courseHomeworkData, {}),
    yktMatchedHomeworkByCourseId: safeStorageClone(window.yktMatchedHomeworkByCourseId, {}),
    yktMatchedCourseLinkByCourseId: safeStorageClone(window.yktMatchedCourseLinkByCourseId, {}),
    yktStandaloneCourses: safeStorageClone(window.yktStandaloneCourses, []),
    yktCourseGroupsSnapshot: safeStorageClone(window.yktCourseGroupsSnapshot, []),
    mrzyMatchedHomeworkByCourseId: safeStorageClone(window.mrzyMatchedHomeworkByCourseId, {}),
    mrzyStandaloneCourses: safeStorageClone(window.mrzyStandaloneCourses, []),
    mrzyCourseGroupsSnapshot: safeStorageClone(window.mrzyCourseGroupsSnapshot, []),
    jlgjMatchedHomeworkByCourseId: safeStorageClone(window.jlgjMatchedHomeworkByCourseId, {}),
    jlgjStandaloneCourses: safeStorageClone(window.jlgjStandaloneCourses, []),
    jlgjCourseGroupsSnapshot: safeStorageClone(window.jlgjCourseGroupsSnapshot, []),
    courseCardStateById: safeStorageClone(window.courseCardStateById, {}),
    videoReplayCacheByCourseId: safeStorageClone(window.videoReplayCacheByCourseId, {}),
    coursewareCacheByCourseId: safeStorageClone(window.coursewareCacheByCourseId, {}),
    homeworkScoreCacheByKey: safeStorageClone(window.homeworkScoreCacheByKey, {}),
    homeworkNoteAttachmentCacheByKey: safeStorageClone(window.homeworkNoteAttachmentCacheByKey, {}),
    veTeacherMetaByCourseId: safeStorageClone(window.veTeacherMetaByCourseId, {}),
    veCourseTeachersMetaByCourseId: safeStorageClone(window.veCourseTeachersMetaByCourseId, {}),
    resourceSpaceItems: safeStorageClone(window.resourceSpaceItems, []),
    currentAccountLoginName: String(window.currentAccountLoginName || ''),
    isTeacherAccount: !!window.isTeacherAccount,
    courseListHtml: getCollapsedCourseListHtmlForPopup(),
    resourceSpaceHtml: String(resourceSpaceList?.innerHTML || ''),
    resourceSpaceStatusText: String(resourceSpaceStatus?.textContent || ''),
    resourceSpaceCountText: String(resourceSpaceCount?.textContent || ''),
    xqSelectHtml: String(xqSelect?.innerHTML || ''),
    xqSelectValue: String(xqSelect?.value || '')
  };
  try {
    await chrome.storage.local.set({ [POPUP_FULLSCREEN_CACHE_KEY]: cache });
  } catch (e) {
    try { console.warn('[bjtu] save popup cache failed:', e); } catch {}
  }
}

let popupCourseCacheSaveTimer = null;
function scheduleFullscreenCourseCacheSave(delayMs = 900) {
  if (popupMode || !window.popupUseFullscreenCacheEnabled) return;
  if (popupCourseCacheSaveTimer) clearTimeout(popupCourseCacheSaveTimer);
  popupCourseCacheSaveTimer = setTimeout(() => {
    popupCourseCacheSaveTimer = null;
    saveFullscreenCourseCache().catch(() => {});
  }, Math.max(120, Number(delayMs) || 900));
}

function setupFullscreenCourseCacheObserver() {
  if (popupMode || !window.popupUseFullscreenCacheEnabled || !courseListDiv) return;
  try {
    const mo = new MutationObserver(() => scheduleFullscreenCourseCacheSave());
    mo.observe(courseListDiv, { childList: true, subtree: true, attributes: true, characterData: true });
    if (resourceSpaceList) mo.observe(resourceSpaceList, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch {
    // ignore
  }
}

async function restorePopupFullscreenCacheIfNeeded() {
  if (!popupMode || !window.popupUseFullscreenCacheEnabled) return false;
  let cache = null;
  try {
    const data = await chrome.storage.local.get([POPUP_FULLSCREEN_CACHE_KEY]);
    cache = data[POPUP_FULLSCREEN_CACHE_KEY] || null;
  } catch {
    cache = null;
  }
  window.__popupUsingFullscreenCache = true;
  if (!cache || !String(cache.courseListHtml || '').trim()) {
    window.platformEnabled = sanitizePlatformEnabled(cache?.platformEnabled || window.platformEnabled, window.platformEnabled);
    refreshPlatformLoginTip();
    showPopupCacheNotice(cache);
    if (courseListDiv) {
      courseListDiv.innerHTML = '<div style="color:#666;padding:6px 0;">暂无全屏缓存内容，请全屏打开后加载一次。</div>';
    }
    if (resourceSpaceStatus) setResourceSpaceStatus('弹出窗口使用缓存；暂无资源空间缓存', 'warning');
    return true;
  }

  window.platformEnabled = sanitizePlatformEnabled(cache.platformEnabled || {}, window.platformEnabled);
  window.platformLoginState = { ...window.platformLoginState, ...(cache.platformLoginState || {}) };
  window.platformLoginChecked = { ...window.platformLoginChecked, ...(cache.platformLoginChecked || {}) };
  window.platformLoadedOnce = { ...window.platformLoadedOnce, ...(cache.platformLoadedOnce || {}) };
  window.platformNeedLogin = { ...window.platformNeedLogin, ...(cache.platformNeedLogin || {}) };
  window.currentVeCourseList = Array.isArray(cache.currentVeCourseList) ? cache.currentVeCourseList : [];
  window.courseHomeworkData = cache.courseHomeworkData || {};
  window.yktMatchedHomeworkByCourseId = cache.yktMatchedHomeworkByCourseId || {};
  window.yktMatchedCourseLinkByCourseId = cache.yktMatchedCourseLinkByCourseId || {};
  window.yktStandaloneCourses = Array.isArray(cache.yktStandaloneCourses) ? cache.yktStandaloneCourses : [];
  window.yktCourseGroupsSnapshot = Array.isArray(cache.yktCourseGroupsSnapshot) ? cache.yktCourseGroupsSnapshot : [];
  window.mrzyMatchedHomeworkByCourseId = cache.mrzyMatchedHomeworkByCourseId || {};
  window.mrzyStandaloneCourses = Array.isArray(cache.mrzyStandaloneCourses) ? cache.mrzyStandaloneCourses : [];
  window.mrzyCourseGroupsSnapshot = Array.isArray(cache.mrzyCourseGroupsSnapshot) ? cache.mrzyCourseGroupsSnapshot : [];
  window.jlgjMatchedHomeworkByCourseId = cache.jlgjMatchedHomeworkByCourseId || {};
  window.jlgjStandaloneCourses = Array.isArray(cache.jlgjStandaloneCourses) ? cache.jlgjStandaloneCourses : [];
  window.jlgjCourseGroupsSnapshot = Array.isArray(cache.jlgjCourseGroupsSnapshot) ? cache.jlgjCourseGroupsSnapshot : [];
  window.courseCardStateById = cache.courseCardStateById || {};
  window.videoReplayCacheByCourseId = cache.videoReplayCacheByCourseId || {};
  window.coursewareCacheByCourseId = cache.coursewareCacheByCourseId || {};
  window.homeworkScoreCacheByKey = cache.homeworkScoreCacheByKey || {};
  window.homeworkNoteAttachmentCacheByKey = cache.homeworkNoteAttachmentCacheByKey || {};
  window.veTeacherMetaByCourseId = cache.veTeacherMetaByCourseId || {};
  window.veCourseTeachersMetaByCourseId = cache.veCourseTeachersMetaByCourseId || {};
  window.resourceSpaceItems = Array.isArray(cache.resourceSpaceItems) ? cache.resourceSpaceItems : [];
  window.currentAccountLoginName = String(cache.currentAccountLoginName || '');
  window.isTeacherAccount = !!cache.isTeacherAccount;
  normalizeRestoredCachesForPopup();

  if (courseListDiv) {
    courseListDiv.innerHTML = String(cache.courseListHtml || '');
    collapseRestoredCoursePanelsForPopup(courseListDiv);
  }
  if (resourceSpaceList) resourceSpaceList.innerHTML = String(cache.resourceSpaceHtml || '');
  if (resourceSpaceStatus) setResourceSpaceStatus(cache.resourceSpaceStatusText || '弹出窗口使用缓存', 'warning');
  if (resourceSpaceCount && cache.resourceSpaceCountText) resourceSpaceCount.textContent = String(cache.resourceSpaceCountText);
  if (xqSelect && cache.xqSelectHtml) {
    xqSelect.innerHTML = String(cache.xqSelectHtml || '');
    xqSelect.value = String(cache.xqSelectValue || '');
  }
  refreshPlatformLoginTip();
  showPopupCacheNotice(cache);
  return true;
}
