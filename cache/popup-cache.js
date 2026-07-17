var POPUP_CACHE_ENABLED_KEY = window.POPUP_CACHE_ENABLED_KEY = 'popupUseFullscreenCacheEnabled';
var POPUP_FULLSCREEN_CACHE_KEY = window.POPUP_FULLSCREEN_CACHE_KEY = 'popupFullscreenCourseCache';
var HOMEWORK_REMINDER_SNAPSHOT_KEY = 'homeworkReminderSnapshot';

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
  root.querySelectorAll('.expandable-box').forEach((box) => {
    if (!(box instanceof HTMLElement)) return;
    box.classList.remove('expanded');
    box.dataset.expanded = '0';
    const body = box.querySelector('.expandable-body');
    if (body instanceof HTMLElement) {
      body.style.removeProperty('max-height');
      body.style.removeProperty('overflow');
      body.style.removeProperty('overflow-x');
      body.style.removeProperty('overflow-y');
    }
    const toggle = box.querySelector('.expandable-toggle');
    if (toggle instanceof HTMLElement) {
      toggle.textContent = toggle.dataset.openText || '点击展开详情';
    }
  });
  root.querySelectorAll('.homework-group[data-homework-group="overdue"], .homework-group[data-homework-group="done"]').forEach((group) => {
    if (!(group instanceof HTMLElement)) return;
    group.classList.add('is-hidden');
    group.classList.remove('homework-group-animating');
    group.dataset.expanded = '0';
    group.setAttribute('aria-hidden', 'true');
    group.style.removeProperty('max-height');
    group.style.removeProperty('opacity');
    group.style.removeProperty('transform');
    group.style.removeProperty('overflow');
  });
  root.querySelectorAll('.homework-toggle-btn[data-homework-toggle-kind], .homework-toggle-btn[data-mooc-action="toggle-overdue"], .homework-toggle-btn[data-mooc-action="toggle-done"]').forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    btn.classList.remove('is-expanded', 'homework-toggle-btn--up');
    btn.classList.add('homework-toggle-btn--down');
    btn.setAttribute('aria-expanded', 'false');
    delete btn.dataset.animating;
    const label = btn.querySelector('.homework-toggle-label');
    const count = String(btn.dataset.count || '').trim();
    const collapsedText = String(btn.dataset.collapsedText || '').trim();
    if (label instanceof HTMLElement && collapsedText) {
      label.textContent = `${collapsedText}${count ? ` (${count})` : ''}`;
    }
  });
  root.querySelectorAll('.force-score-publish-row').forEach((el) => el.remove());
  root.querySelectorAll('.submit-panel').forEach((panel) => {
    if (panel instanceof HTMLElement) panel.style.display = 'none';
  });
  root.querySelectorAll('button[data-action="courseware"]').forEach((btn) => {
    resetCachedPanelButton(btn, '课件下载', 'courseware-link-progress', '--courseware-progress');
  });
  root.querySelectorAll('button[data-action="videos"]').forEach((btn) => {
    resetCachedPanelButton(btn, '回放下载', 'replay-link-progress', '--replay-progress');
  });
}

function unwrapPlatformCourseColumnsForPopup(root) {
  if (!(root instanceof HTMLElement)) return;
  root.querySelectorAll(':scope > .platform-course-column').forEach((column) => {
    column.querySelectorAll(':scope > .platform-course-column-body > .file-item[data-course-rankable="1"]').forEach((card) => {
      root.appendChild(card);
    });
    column.remove();
  });
  root.querySelectorAll(':scope > .platform-column-resizer').forEach((resizer) => resizer.remove());
  root.classList.remove('platform-split-grid');
  root.style.removeProperty('grid-template-columns');
}

function getCollapsedCourseListHtmlForPopup() {
  if (!courseListDiv) return '';
  const clone = courseListDiv.cloneNode(true);
  unwrapPlatformCourseColumnsForPopup(clone);
  collapseRestoredCoursePanelsForPopup(clone);
  return String(clone.innerHTML || '');
}

function getCollapsedCourseHomeworkDataForPopup() {
  const data = safeStorageClone(window.courseHomeworkData, {});
  Object.values(data).forEach((course) => {
    if (!course) return;
    course.showOverdue = false;
    course.showDone = false;
    delete course.justExpanded;
    delete course.justCollapsed;
  });
  return data;
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

function restoreFullscreenCacheStateForBackground(cache) {
  if (!cache || typeof cache !== 'object') return;
  window.platformLoginState = { ...window.platformLoginState, ...(cache.platformLoginState || {}) };
  window.platformLoginChecked = { ...window.platformLoginChecked, ...(cache.platformLoginChecked || {}) };
  window.platformLoadedOnce = { ...window.platformLoadedOnce, ...(cache.platformLoadedOnce || {}) };
  window.platformNeedLogin = { ...window.platformNeedLogin, ...(cache.platformNeedLogin || {}) };
  window.courseHomeworkData = cache.courseHomeworkData || {};
  window.yktMatchedHomeworkByCourseId = cache.yktMatchedHomeworkByCourseId || {};
  window.yktMatchedCourseLinkByCourseId = cache.yktMatchedCourseLinkByCourseId || {};
  window.yktStandaloneCourses = Array.isArray(cache.yktStandaloneCourses) ? cache.yktStandaloneCourses : [];
  window.yktCourseGroupsSnapshot = Array.isArray(cache.yktCourseGroupsSnapshot) ? cache.yktCourseGroupsSnapshot : [];
  window.mrjzyMatchedHomeworkByCourseId = cache.mrjzyMatchedHomeworkByCourseId || {};
  window.mrjzyStandaloneCourses = Array.isArray(cache.mrjzyStandaloneCourses) ? cache.mrjzyStandaloneCourses : [];
  window.mrjzyCourseGroupsSnapshot = Array.isArray(cache.mrjzyCourseGroupsSnapshot) ? cache.mrjzyCourseGroupsSnapshot : [];
  window.jlgjMatchedHomeworkByCourseId = cache.jlgjMatchedHomeworkByCourseId || {};
  window.jlgjStandaloneCourses = Array.isArray(cache.jlgjStandaloneCourses) ? cache.jlgjStandaloneCourses : [];
  window.jlgjCourseGroupsSnapshot = Array.isArray(cache.jlgjCourseGroupsSnapshot) ? cache.jlgjCourseGroupsSnapshot : [];
  window.BjtuMoocPlatform?.restore(cache.moocCourses || []);
  window.courseCardStateById = cache.courseCardStateById || {};
  window.videoReplayCacheByCourseId = cache.videoReplayCacheByCourseId || {};
  window.coursewareCacheByCourseId = cache.coursewareCacheByCourseId || {};
  window.homeworkScoreCacheByKey = cache.homeworkScoreCacheByKey || {};
  window.homeworkNoteAttachmentCacheByKey = cache.homeworkNoteAttachmentCacheByKey || {};
  window.veTeacherMetaByCourseId = cache.veTeacherMetaByCourseId || {};
  window.veCourseTeachersMetaByCourseId = cache.veCourseTeachersMetaByCourseId || {};
  window.resourceSpaceItems = Array.isArray(cache.resourceSpaceItems) ? cache.resourceSpaceItems : [];
  if (resourceSpaceList) resourceSpaceList.innerHTML = String(cache.resourceSpaceHtml || '');
  if (resourceSpaceStatus) resourceSpaceStatus.textContent = String(cache.resourceSpaceStatusText || '');
  if (resourceSpaceCount) resourceSpaceCount.textContent = String(cache.resourceSpaceCountText || '');
  if (xqSelect && cache.xqSelectHtml) {
    xqSelect.innerHTML = String(cache.xqSelectHtml || '');
    xqSelect.value = String(cache.xqSelectValue || '');
  }
}

async function saveFullscreenCourseCache({ force = false } = {}) {
  if (popupMode || (!force && !window.popupUseFullscreenCacheEnabled) || !courseListDiv) return;
  const cache = {
    version: 1,
    structuredCourseCache: true,
    savedAt: Date.now(),
    platformEnabled: safeStorageClone(window.platformEnabled, {}),
    platformLoginState: safeStorageClone(window.platformLoginState, {}),
    platformLoginChecked: safeStorageClone(window.platformLoginChecked, {}),
    platformLoadedOnce: safeStorageClone(window.platformLoadedOnce, {}),
    platformNeedLogin: safeStorageClone(window.platformNeedLogin, {}),
    currentVeCourseList: safeStorageClone(window.currentVeCourseList, []),
    courseHomeworkData: getCollapsedCourseHomeworkDataForPopup(),
    yktMatchedHomeworkByCourseId: safeStorageClone(window.yktMatchedHomeworkByCourseId, {}),
    yktMatchedCourseLinkByCourseId: safeStorageClone(window.yktMatchedCourseLinkByCourseId, {}),
    yktStandaloneCourses: safeStorageClone(window.yktStandaloneCourses, []),
    yktCourseGroupsSnapshot: safeStorageClone(window.yktCourseGroupsSnapshot, []),
    mrjzyMatchedHomeworkByCourseId: safeStorageClone(window.mrjzyMatchedHomeworkByCourseId, {}),
    mrjzyStandaloneCourses: safeStorageClone(window.mrjzyStandaloneCourses, []),
    mrjzyCourseGroupsSnapshot: safeStorageClone(window.mrjzyCourseGroupsSnapshot, []),
    jlgjMatchedHomeworkByCourseId: safeStorageClone(window.jlgjMatchedHomeworkByCourseId, {}),
    jlgjStandaloneCourses: safeStorageClone(window.jlgjStandaloneCourses, []),
    jlgjCourseGroupsSnapshot: safeStorageClone(window.jlgjCourseGroupsSnapshot, []),
    moocCourses: safeStorageClone(window.BjtuMoocPlatform?.getCourses?.(), []),
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

function detectReminderPlatform(item, courseCard) {
  if (item.classList.contains('mooc-task') || String(courseCard?.id || '').startsWith('course-mooc-')) return '中国大学MOOC';
  const hrefs = Array.from(item.querySelectorAll('a[href]')).map((link) => String(link.href || '')).join(' ');
  if (/yuketang\.cn|xuetangx\.com/i.test(hrefs)) return '雨课堂';
  if (/lulufind\.com|mrzuoye\.com/i.test(hrefs)) return '每日交作业';
  if (/jielong\.com/i.test(hrefs)) return '接龙管家';
  return '智慧课程平台';
}

function collectPendingHomeworkItems({ futureDeadlineOnly = false } = {}) {
  if (!courseListDiv) return [];
  const now = Date.now();
  const seen = new Set();
  const items = [];
  courseListDiv.querySelectorAll('.hw-card-item').forEach((homework) => {
    const countdown = homework.querySelector('.deadline-countdown[data-deadline]');
    const deadline = countdown
      ? (typeof parseDeadlineToTs === 'function'
        ? parseDeadlineToTs(countdown.dataset.deadline)
        : Number(countdown.dataset.deadline || 0))
      : 0;
    if (futureDeadlineOnly && (!deadline || deadline <= now)) return;
    const courseCard = homework.closest('.file-item');
    if (!(homework instanceof HTMLElement) || !(courseCard instanceof HTMLElement)) return;
    if (homework.dataset.homeworkDone === '1') return;
    const courseName = String(courseCard.querySelector('.course-card-title')?.textContent || '未知课程').replace(/\s+/g, ' ').trim();
    const titleElement = homework.querySelector('.mooc-task-title')
      || Array.from(homework.querySelectorAll('div')).find((node) => node instanceof HTMLElement && node.style.fontWeight === 'bold');
    const title = String(titleElement?.textContent || '未交作业').replace(/\s+/g, ' ').trim();
    const platform = detectReminderPlatform(homework, courseCard);
    const actionUrl = String(homework.querySelector('a.btn[href]')?.href || courseCard.querySelector('.course-card-title a[href]')?.href || '');
    const key = `${platform}|${courseName}|${title}|${deadline}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ key, platform, courseName, title, deadline, actionUrl });
  });
  return items;
}

function collectHomeworkReminderSnapshot() {
  return collectPendingHomeworkItems({ futureDeadlineOnly: true });
}

let homeworkReminderSnapshotTimer = null;
async function saveHomeworkReminderSnapshotNow() {
  const snapshot = {
    version: 1,
    updatedAt: Date.now(),
    account: String(window.currentAccountLoginName || ''),
    items: collectHomeworkReminderSnapshot()
  };
  await chrome.storage.local.set({ [HOMEWORK_REMINDER_SNAPSHOT_KEY]: snapshot });
  return snapshot;
}

function scheduleHomeworkReminderSnapshotSave(delayMs = 500) {
  if (popupMode) return;
  if (homeworkReminderSnapshotTimer) clearTimeout(homeworkReminderSnapshotTimer);
  homeworkReminderSnapshotTimer = setTimeout(async () => {
    homeworkReminderSnapshotTimer = null;
    try {
      await saveHomeworkReminderSnapshotNow();
    } catch (error) {
      try { console.warn('[bjtu] save homework reminder snapshot failed:', error); } catch {}
    }
  }, Math.max(100, Number(delayMs) || 500));
}

let popupCourseCacheSaveTimer = null;
function scheduleFullscreenCourseCacheSave(delayMs = 900) {
  if (!popupMode) scheduleHomeworkReminderSnapshotSave(Math.min(500, Number(delayMs) || 500));
  if (popupMode || !window.popupUseFullscreenCacheEnabled) return;
  if (popupCourseCacheSaveTimer) clearTimeout(popupCourseCacheSaveTimer);
  popupCourseCacheSaveTimer = setTimeout(() => {
    popupCourseCacheSaveTimer = null;
    saveFullscreenCourseCache().catch(() => {});
  }, Math.max(120, Number(delayMs) || 900));
}

function setupFullscreenCourseCacheObserver() {
  if (popupMode || !courseListDiv) return;
  try {
    const mo = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        return !(target instanceof Element && target.closest('.deadline-countdown'));
      });
      if (relevant) scheduleFullscreenCourseCacheSave();
    });
    mo.observe(courseListDiv, { childList: true, subtree: true, attributes: true, characterData: true });
    if (window.popupUseFullscreenCacheEnabled && resourceSpaceList) mo.observe(resourceSpaceList, { childList: true, subtree: true, attributes: true, characterData: true });
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
  const hasStructuredVeCache = (cache?.backgroundStructuredVe === true || cache?.structuredCourseCache === true)
    && Array.isArray(cache?.currentVeCourseList)
    && typeof renderCourseList === 'function';
  if (!cache || (!hasStructuredVeCache && !String(cache.courseListHtml || '').trim())) {
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
  Object.values(window.courseHomeworkData).forEach((data) => {
    if (!data) return;
    data.showOverdue = false;
    data.showDone = false;
    data.justExpanded = false;
    data.justCollapsed = false;
  });
  window.courseShowOverdueById = {};
  window.courseShowDoneById = {};
  window.homeworkDetailExpandedByCourse = {};
  window.yktMatchedHomeworkByCourseId = cache.yktMatchedHomeworkByCourseId || {};
  window.yktMatchedCourseLinkByCourseId = cache.yktMatchedCourseLinkByCourseId || {};
  window.yktStandaloneCourses = Array.isArray(cache.yktStandaloneCourses) ? cache.yktStandaloneCourses : [];
  window.yktCourseGroupsSnapshot = Array.isArray(cache.yktCourseGroupsSnapshot) ? cache.yktCourseGroupsSnapshot : [];
  window.mrjzyMatchedHomeworkByCourseId = cache.mrjzyMatchedHomeworkByCourseId || {};
  window.mrjzyStandaloneCourses = Array.isArray(cache.mrjzyStandaloneCourses) ? cache.mrjzyStandaloneCourses : [];
  window.mrjzyCourseGroupsSnapshot = Array.isArray(cache.mrjzyCourseGroupsSnapshot) ? cache.mrjzyCourseGroupsSnapshot : [];
  window.jlgjMatchedHomeworkByCourseId = cache.jlgjMatchedHomeworkByCourseId || {};
  window.jlgjStandaloneCourses = Array.isArray(cache.jlgjStandaloneCourses) ? cache.jlgjStandaloneCourses : [];
  window.jlgjCourseGroupsSnapshot = Array.isArray(cache.jlgjCourseGroupsSnapshot) ? cache.jlgjCourseGroupsSnapshot : [];
  window.BjtuMoocPlatform?.restore(cache.moocCourses || []);
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
  if (hasStructuredVeCache && typeof rematchExternalByVeCourses === 'function') {
    rematchExternalByVeCourses();
  }

  if (courseListDiv) {
    if (hasStructuredVeCache) {
      renderCourseList(window.currentVeCourseList, { cachedOnly: true });
      await Promise.resolve(window.veHomeworkLoadPromise).catch(() => {});
    } else {
      courseListDiv.innerHTML = String(cache.courseListHtml || '');
    }
    unwrapPlatformCourseColumnsForPopup(courseListDiv);
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
  applyPlatformVisibility();
  showPopupCacheNotice(cache);
  return true;
}
