(function initAcademicOptionsModule(global) {
  'use strict';

  const DEFAULT_MONITOR_INTERVAL_MINUTES = 1;
  const DEFAULT_CLASS_REMINDER_LEAD_MINUTES = 10;
  const MAX_INTERVAL_MINUTES = 525600;
  const ASSESSMENT_SCRIPT_ID = 'assessment-satisfied';
  const ASSESSMENT_CONTENT_SCRIPT_ID = 'bjtu-academic-assessment-satisfied';
  const ASSESSMENT_SCRIPT_STORAGE_KEY = 'academicAssessmentExternalScriptEnabled';
  const ASSESSMENT_SCRIPT_URL = 'https://update.greasyfork.org/scripts/537626/BJTU%20%E5%8C%97%E4%BA%AC%E4%BA%A4%E9%80%9A%E5%A4%A7%E5%AD%A6%20%E4%B8%80%E9%94%AE%E8%AF%84%E6%95%99%E4%B8%BA%E2%80%9C%E9%9D%9E%E5%B8%B8%E6%BB%A1%E6%84%8F%E2%80%9D%E5%B9%B6%E5%A1%AB%E5%86%99%E4%B8%BB%E8%A7%82%E6%84%8F%E8%A7%81.user.js';
  const ASSESSMENT_SCRIPT_PATH = `modules/academic/external/${decodeURIComponent(ASSESSMENT_SCRIPT_URL.split('/').at(-1))}`;
  const BB_SCRIPT_ID = 'bb-course-availability';
  const BB_CONTENT_SCRIPT_ID = 'bjtu-academic-bb-course-availability';
  const BB_SCRIPT_STORAGE_KEY = 'academicBbCourseAvailabilityExternalScriptEnabled';
  const BB_SCRIPT_URL = 'https://update.greasyfork.org/scripts/561136/BB%E9%85%B1%E5%B8%AE%E4%BD%A0%E6%9F%A5%E8%AF%BE%E4%BD%99%E9%87%8F%20%282026%E4%BF%AE%E5%A4%8D%E7%89%88%29.user.js';
  const BB_SCRIPT_PATH = `modules/academic/external/${decodeURIComponent(BB_SCRIPT_URL.split('/').at(-1))}`;
  const BB_WISH_LIST_KEY = 'academicBbWishListCourses';
  const BB_REFRESH_DELAY_KEY = 'academicBbRefreshDelayMs';
  const DEFAULT_BB_REFRESH_DELAY_MS = 3000;
  const ACADEMIC_DATA_CACHE_KEY = 'academicDataCache';
  const ACADEMIC_OPTIONS_REQUEST_PORT = 'bjtu-academic-options-requests';
  const ACADEMIC_FULLSCREEN_BUTTON_KEY = 'academicFullscreenButtonEnabled';
  const DEFAULTS = Object.freeze({
    [ACADEMIC_FULLSCREEN_BUTTON_KEY]: true,
    academicOptionsWideEnabled: true,
    academicScoreMonitorEnabled: false,
    academicExamMonitorEnabled: false,
    academicClassReminderEnabled: false,
    academicClassReminderLeadMinutes: DEFAULT_CLASS_REMINDER_LEAD_MINUTES,
    academicScoreMonitorIntervalMinutes: DEFAULT_MONITOR_INTERVAL_MINUTES,
    academicScheduleWeek: 'all',
    academicScheduleSemester: '',
    academicScoreSemester: '',
    [BB_WISH_LIST_KEY]: [],
    [BB_REFRESH_DELAY_KEY]: DEFAULT_BB_REFRESH_DELAY_MS
  });

  let initialized = false;
  let context = null;
  let scheduleData = null;
  let academicSemestersLoaded = false;
  let scoreSemesterPreference = '';
  let scoreCurrentZxjxjhh = '';
  let scoreSemesterOptions = [];
  let academicSemesterOptions = [];
  let academicSemestersPromise = null;
  let scheduleSemesterPreference = '';
  const loadedSharedTerms = new Set();
  const sharedTermsInFlight = new Map();
  let sharedTermWorkerRunning = false;
  const loadedScheduleTerms = new Set();
  const scheduleTermsInFlight = new Map();
  let scheduleTermWorkerRunning = false;
  let selectionSchedulePromise = null;
  let academicDataCacheWritePromise = Promise.resolve();
  let sharedAllLoading = false;
  let sharedLoadingTerm = '';
  let academicRequestBusyDepth = 0;
  let academicRequestIdleTimer = 0;
  const academicRequestPort = chrome.runtime.connect({ name: ACADEMIC_OPTIONS_REQUEST_PORT });
  let setMessage = () => {};
  let assessmentScriptInstalled = false;
  let assessmentScriptEnabled = false;
  let assessmentScriptBusy = false;
  let assessmentScriptReady = false;
  let assessmentScriptSizeBytes = 0;
  let assessmentScriptRuntimeReady = false;
  let assessmentScriptReloadRequired = false;
  let bbScriptInstalled = false;
  let bbScriptEnabled = false;
  let bbScriptBusy = false;
  let bbScriptReady = false;
  let bbScriptSizeBytes = 0;
  let bbScriptRuntimeReady = false;
  let bbScriptReloadRequired = false;

  const element = (id) => document.getElementById(id);

  function beginAcademicOptionsRequest() {
    if (academicRequestIdleTimer) {
      clearTimeout(academicRequestIdleTimer);
      academicRequestIdleTimer = 0;
    }
    academicRequestBusyDepth += 1;
    if (academicRequestBusyDepth === 1) academicRequestPort.postMessage({ type: 'busy', value: true });
  }

  function endAcademicOptionsRequest() {
    academicRequestBusyDepth = Math.max(0, academicRequestBusyDepth - 1);
    if (academicRequestBusyDepth > 0) return;
    academicRequestIdleTimer = setTimeout(() => {
      academicRequestIdleTimer = 0;
      if (academicRequestBusyDepth === 0) academicRequestPort.postMessage({ type: 'busy', value: false });
    }, 100);
  }

  const send = async (type, payload) => {
    beginAcademicOptionsRequest();
    try {
      return await chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    } finally {
      endAcademicOptionsRequest();
    }
  };

  function persistAcademicDataCache() {
    academicDataCacheWritePromise = academicDataCacheWritePromise.catch(() => {}).then(async () => {
      const studentId = String(context?.studentId || '').trim();
      if (!studentId || !academicSemestersLoaded) return;
      await chrome.storage.session.set({
        [ACADEMIC_DATA_CACHE_KEY]: {
          studentId,
          academicSemesterOptions,
          scoreCurrentZxjxjhh,
          scheduleCache,
          examsCache,
          scoresCache,
          loadedSharedTerms: [...loadedSharedTerms],
          loadedScheduleTerms: [...loadedScheduleTerms],
          updatedAt: Date.now()
        }
      });
    });
    return academicDataCacheWritePromise;
  }

  async function restoreAcademicDataCache() {
    const studentId = String(context?.studentId || '').trim();
    if (!studentId) return false;
    const stored = await chrome.storage.session.get(ACADEMIC_DATA_CACHE_KEY);
    const cache = stored?.[ACADEMIC_DATA_CACHE_KEY];
    if (!cache || String(cache.studentId || '') !== studentId) return false;
    academicSemesterOptions = Array.isArray(cache.academicSemesterOptions) ? cache.academicSemesterOptions : [];
    scoreCurrentZxjxjhh = String(cache.scoreCurrentZxjxjhh || '');
    scheduleCache = cache.scheduleCache && typeof cache.scheduleCache === 'object' ? cache.scheduleCache : null;
    examsCache = cache.examsCache && typeof cache.examsCache === 'object' ? cache.examsCache : null;
    scoresCache = cache.scoresCache && typeof cache.scoresCache === 'object' ? cache.scoresCache : null;
    loadedSharedTerms.clear();
    (Array.isArray(cache.loadedSharedTerms) ? cache.loadedSharedTerms : []).forEach((term) => loadedSharedTerms.add(String(term)));
    loadedScheduleTerms.clear();
    (Array.isArray(cache.loadedScheduleTerms) ? cache.loadedScheduleTerms : []).forEach((term) => loadedScheduleTerms.add(String(term)));
    academicSemestersLoaded = academicSemesterOptions.length > 0;
    if (!academicSemestersLoaded) return false;
    renderScoreSemesterOptions(academicSemesterOptions, scoreCurrentZxjxjhh, scoreSemesterPreference);
    renderAvailableSharedSemesters();
    renderCachedAcademicData();
    return true;
  }

  function applyWideOption(enabled) {
    const section = element('academic-system-section');
    const slot = section?.closest('[data-options-module="academic"]');
    if (slot instanceof HTMLElement && slot.parentElement?.id === 'options-controlled-content') {
      slot.classList.toggle('options-wide-card', enabled === true);
    }
  }

  async function getUpdaterManager() {
    const ready = await global.__bjtuUpdaterReady;
    const manager = ready && global.BjtuUpdaterModuleManager;
    if (!manager?.requestDirectory || !manager?.managedFileExists
        || !manager?.writeManagedFile || !manager?.readManagedFile || !manager?.removeManagedFile) {
      throw new Error('更新组件不可用，无法管理外部脚本');
    }
    return manager;
  }

  function setAssessmentScriptStatus(text, error = false) {
    const status = element('academicAssessmentScriptStatus');
    if (!(status instanceof HTMLElement)) return;
    status.textContent = String(text || '');
    status.classList.toggle('error', error);
  }

  function formatExternalScriptBytes(value) {
    return global.BjtuFileSizeEmphasis.formatBytes(value);
  }

  function buildFileSizeEmphasisStyle(bytes) {
    return global.BjtuFileSizeEmphasis.buildBytesStyle(bytes);
  }

  function setAssessmentScriptProgress({ visible = true, loaded = 0, total = 0, label = '正在下载…' } = {}) {
    const container = element('academicAssessmentScriptProgress');
    const bar = element('academicAssessmentScriptProgressBar');
    const labelElement = container?.querySelector('.academic-external-script-progress-label');
    if (!(container instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
    container.hidden = !visible;
    if (labelElement instanceof HTMLElement) labelElement.textContent = label;
    if (!visible) {
      container.classList.remove('is-indeterminate');
      bar.style.width = '0';
      return;
    }
    const determinate = Number(total) > 0;
    container.classList.toggle('is-indeterminate', !determinate);
    bar.style.width = determinate ? `${Math.min(100, Number(loaded) / Number(total) * 100)}%` : '';
  }

  function renderAssessmentScriptState() {
    const checkbox = element('academicAssessmentScriptEnabled');
    const download = element('academicAssessmentScriptDownload');
    const checkUpdate = element('academicAssessmentScriptCheckUpdate');
    const deleteButton = element('academicAssessmentScriptDelete');
    const size = element('academicAssessmentScriptSize');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.disabled = assessmentScriptBusy || !assessmentScriptReady;
      checkbox.checked = assessmentScriptEnabled;
    }
    if (download instanceof HTMLButtonElement) {
      download.hidden = assessmentScriptInstalled;
      download.disabled = assessmentScriptBusy || !assessmentScriptReady;
      download.textContent = assessmentScriptBusy ? '处理中…' : '下载';
    }
    if (checkUpdate instanceof HTMLButtonElement) {
      checkUpdate.hidden = !assessmentScriptInstalled;
      checkUpdate.disabled = assessmentScriptBusy;
    }
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.hidden = !assessmentScriptInstalled;
      deleteButton.disabled = assessmentScriptBusy || assessmentScriptEnabled;
    }
    if (size instanceof HTMLElement) {
      size.textContent = assessmentScriptSizeBytes > 0
        ? formatExternalScriptBytes(assessmentScriptSizeBytes)
        : '—';
      size.style.cssText = buildFileSizeEmphasisStyle(assessmentScriptSizeBytes);
    }
    if (!assessmentScriptBusy) {
      setAssessmentScriptStatus(assessmentScriptInstalled ? '已下载' : '未下载');
    }
  }

  async function runtimeAssessmentScriptInfo() {
    try {
      const response = await fetch(chrome.runtime.getURL(ASSESSMENT_SCRIPT_PATH), { cache: 'no-store' });
      if (!response.ok) return { exists: false, size: 0 };
      const bytes = await response.arrayBuffer();
      return { exists: true, size: bytes.byteLength };
    } catch {
      return { exists: false, size: 0 };
    }
  }

  async function refreshAssessmentScriptState() {
    const stored = await chrome.storage.local.get([ASSESSMENT_SCRIPT_STORAGE_KEY]);
    let directoryReady = false;
    let directorySize = 0;
    try {
      const manager = await getUpdaterManager();
      directoryReady = await manager.managedFileExists(ASSESSMENT_SCRIPT_PATH);
      if (directoryReady && typeof manager.managedFileSize === 'function') {
        directorySize = await manager.managedFileSize(ASSESSMENT_SCRIPT_PATH);
      }
    } catch {
      // Runtime visibility is enough to display an already installed script.
    }
    const runtimeInfo = await runtimeAssessmentScriptInfo();
    assessmentScriptInstalled = directoryReady || runtimeInfo.exists;
    assessmentScriptSizeBytes = directorySize || runtimeInfo.size;
    assessmentScriptRuntimeReady = runtimeInfo.exists;
    assessmentScriptReloadRequired = false;
    assessmentScriptEnabled = assessmentScriptInstalled && stored[ASSESSMENT_SCRIPT_STORAGE_KEY] === true;
    if (!assessmentScriptInstalled && stored[ASSESSMENT_SCRIPT_STORAGE_KEY] === true) {
      assessmentScriptEnabled = false;
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
    }
    assessmentScriptReady = true;
    renderAssessmentScriptState();
  }

  function validateAssessmentScript(source) {
    const text = String(source || '');
    if (text.length < 500 || text.length > 500000
        || !text.includes('// ==UserScript==')
        || !/@match\s+https:\/\/aa\.bjtu\.edu\.cn\/teaching_assessment\/stu\*/.test(text)
        || !text.includes('一键非常满意')
        || !text.includes('function autoSelect()')) {
      throw new Error('下载内容不是预期的「BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见」');
    }
    return text;
  }

  async function reloadAcademicOptionsPage(source = ASSESSMENT_SCRIPT_ID) {
    const currentTab = await chrome.tabs.getCurrent().catch(() => null);
    const standalone = /\/modules\/academic\/options\.html$/i.test(location.pathname);
    const popup = new URLSearchParams(location.search).get('popup') === '1';
    const result = await send('RELOAD_EXTENSION_AND_OPEN_APP', {
      reopenApp: false,
      source,
      sourceTabId: Number(currentTab?.id) || null,
      restoreOptionsPath: popup
        ? ''
        : (standalone ? 'modules/academic/options.html' : 'options/options.html')
    });
    if (!result?.ok) throw new Error(result?.message || '无法重新加载扩展');
  }

  async function fetchAssessmentScript(onProgress) {
    const response = await fetch(ASSESSMENT_SCRIPT_URL, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`GreasyFork 下载失败：HTTP ${response.status}`);
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    if (!response.body?.getReader) {
      const text = await response.text();
      onProgress?.({ loaded: new TextEncoder().encode(text).byteLength, total });
      return validateAssessmentScript(text);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return validateAssessmentScript(new TextDecoder().decode(bytes));
  }

  async function downloadAssessmentScript({ enableAfterDownload = false } = {}) {
    if (assessmentScriptBusy || assessmentScriptInstalled) return;
    assessmentScriptBusy = true;
    assessmentScriptEnabled = enableAfterDownload;
    renderAssessmentScriptState();
    setAssessmentScriptStatus('正在请求扩展目录写入权限…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      setAssessmentScriptStatus('正在从 GreasyFork 下载…');
      setAssessmentScriptProgress({ visible: true });
      const source = await fetchAssessmentScript(({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setAssessmentScriptProgress({
          visible: true,
          loaded,
          total,
          label: `正在下载：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      await manager.writeManagedFile(root, ASSESSMENT_SCRIPT_PATH, new TextEncoder().encode(source));
      assessmentScriptSizeBytes = new TextEncoder().encode(source).byteLength;
      assessmentScriptReloadRequired = true;
      assessmentScriptInstalled = true;
      assessmentScriptEnabled = enableAfterDownload;
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: enableAfterDownload });
      setAssessmentScriptProgress({ visible: false });
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      if (enableAfterDownload) {
        setAssessmentScriptStatus('已下载，正在启用并重新加载扩展…');
        await reloadAcademicOptionsPage();
      } else {
        setMessage('「BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见」已下载');
      }
    } catch (error) {
      assessmentScriptBusy = false;
      assessmentScriptEnabled = false;
      setAssessmentScriptProgress({ visible: false });
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本下载失败：${String(error?.message || error)}`, false);
    }
  }

  async function setAssessmentScriptEnabled(enabled) {
    if (assessmentScriptBusy || !assessmentScriptReady) return;
    if (enabled && !assessmentScriptInstalled) {
      await downloadAssessmentScript({ enableAfterDownload: true });
      return;
    }
    assessmentScriptBusy = true;
    assessmentScriptEnabled = enabled;
    renderAssessmentScriptState();
    if (enabled) {
      try {
        await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: true });
        assessmentScriptBusy = false;
        renderAssessmentScriptState();
        const result = await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
        if (!result?.ok) throw new Error(result?.message || '脚本注册失败');
        if (!assessmentScriptReloadRequired && Array.isArray(result.registeredIds)
            && result.registeredIds.includes(ASSESSMENT_CONTENT_SCRIPT_ID)) {
          assessmentScriptRuntimeReady = true;
          assessmentScriptReloadRequired = false;
          setMessage('已启用「BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见」');
        } else {
          setAssessmentScriptStatus('正在启用并重新加载扩展…');
          await reloadAcademicOptionsPage();
        }
      } catch (error) {
        await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
        assessmentScriptEnabled = false;
        assessmentScriptBusy = false;
        renderAssessmentScriptState();
        setAssessmentScriptStatus(String(error?.message || error), true);
      }
      return;
    }

    try {
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
      const result = await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      if (!result?.ok) throw new Error(result?.message || '脚本注销失败');
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      setMessage('已停用「BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见」，可点击「删除」卸载');
    } catch (error) {
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: true });
      assessmentScriptEnabled = true;
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本停用失败：${String(error?.message || error)}`, false);
    }
  }

  async function deleteAssessmentScript() {
    if (assessmentScriptBusy || !assessmentScriptInstalled || assessmentScriptEnabled) return;
    assessmentScriptBusy = true;
    renderAssessmentScriptState();
    setAssessmentScriptStatus('正在删除…');
    try {
      const shouldReload = assessmentScriptRuntimeReady;
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      await manager.removeManagedFile(root, ASSESSMENT_SCRIPT_PATH);
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      assessmentScriptInstalled = false;
      assessmentScriptSizeBytes = 0;
      assessmentScriptRuntimeReady = false;
      assessmentScriptReloadRequired = false;
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      if (shouldReload) {
        setAssessmentScriptStatus('已删除，正在重新加载扩展…');
        await reloadAcademicOptionsPage();
      } else {
        setAssessmentScriptStatus('未下载');
        setMessage('「BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见」已删除');
      }
    } catch (error) {
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本删除失败：${String(error?.message || error)}`, false);
    }
  }

  async function checkAssessmentScriptUpdate() {
    if (assessmentScriptBusy || !assessmentScriptInstalled) return;
    assessmentScriptBusy = true;
    renderAssessmentScriptState();
    setAssessmentScriptStatus('正在检查更新…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      const current = await (await manager.readManagedFile(root, ASSESSMENT_SCRIPT_PATH)).text();
      setAssessmentScriptProgress({ visible: true, label: '正在从 GreasyFork 检查更新…' });
      const latest = await fetchAssessmentScript(({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setAssessmentScriptProgress({
          visible: true,
          loaded,
          total,
          label: `正在检查：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').trim();
      if (normalize(current) === normalize(latest)) {
        assessmentScriptBusy = false;
        setAssessmentScriptProgress({ visible: false });
        renderAssessmentScriptState();
        setAssessmentScriptStatus('已下载（已是最新）');
        return;
      }
      await manager.writeManagedFile(root, ASSESSMENT_SCRIPT_PATH, new TextEncoder().encode(latest));
      assessmentScriptSizeBytes = new TextEncoder().encode(latest).byteLength;
      assessmentScriptReloadRequired = true;
      assessmentScriptBusy = false;
      setAssessmentScriptProgress({ visible: false });
      renderAssessmentScriptState();
      setAssessmentScriptStatus(assessmentScriptEnabled
        ? '已下载（已更新，重新启用后生效）'
        : '已下载（已更新）');
      setMessage(assessmentScriptEnabled
        ? '「BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见」已更新，请取消勾选后重新启用'
        : '「BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见」已更新');
    } catch (error) {
      assessmentScriptBusy = false;
      setAssessmentScriptProgress({ visible: false });
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`检查外部脚本更新失败：${String(error?.message || error)}`, false);
    }
  }

  function normalizeBbWishList(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
    return [...new Set(source.map((item) => String(item || '').trim().toUpperCase().replace(/\s+/g, ' '))
      .filter((item) => /^[A-Z]\d{6}[A-Z]\s\d{2}$/.test(item)))];
  }

  function normalizeBbRefreshDelay(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(3600000, Math.max(500, Math.round(number)))
      : DEFAULT_BB_REFRESH_DELAY_MS;
  }

  function renderBbSettings(settings = {}) {
    const wishList = element('academicBbWishListCourses');
    const delay = element('academicBbRefreshDelayMs');
    if (wishList instanceof HTMLTextAreaElement) {
      wishList.value = normalizeBbWishList(settings[BB_WISH_LIST_KEY]).join('\n');
    }
    if (delay instanceof HTMLInputElement) {
      delay.value = String(normalizeBbRefreshDelay(settings[BB_REFRESH_DELAY_KEY]));
    }
  }

  async function saveBbSettings() {
    const wishList = normalizeBbWishList(element('academicBbWishListCourses')?.value);
    const refreshDelay = normalizeBbRefreshDelay(element('academicBbRefreshDelayMs')?.value);
    await chrome.storage.local.set({
      [BB_WISH_LIST_KEY]: wishList,
      [BB_REFRESH_DELAY_KEY]: refreshDelay
    });
    renderBbSettings({ [BB_WISH_LIST_KEY]: wishList, [BB_REFRESH_DELAY_KEY]: refreshDelay });
    setMessage(`BB酱查课设置已保存：${wishList.length} 门课程，间隔 ${refreshDelay} 毫秒`);
  }

  function setBbScriptStatus(text, error = false) {
    const status = element('academicBbScriptStatus');
    if (!(status instanceof HTMLElement)) return;
    status.textContent = String(text || '');
    status.classList.toggle('error', error);
  }

  function setBbScriptProgress({ visible = true, loaded = 0, total = 0, label = '正在下载…' } = {}) {
    const container = element('academicBbScriptProgress');
    const bar = element('academicBbScriptProgressBar');
    const labelElement = container?.querySelector('.academic-external-script-progress-label');
    if (!(container instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
    container.hidden = !visible;
    if (labelElement instanceof HTMLElement) labelElement.textContent = label;
    if (!visible) {
      container.classList.remove('is-indeterminate');
      bar.style.width = '0';
      return;
    }
    const determinate = Number(total) > 0;
    container.classList.toggle('is-indeterminate', !determinate);
    bar.style.width = determinate ? `${Math.min(100, Number(loaded) / Number(total) * 100)}%` : '';
  }

  function renderBbScriptState() {
    const checkbox = element('academicBbScriptEnabled');
    const download = element('academicBbScriptDownload');
    const checkUpdate = element('academicBbScriptCheckUpdate');
    const deleteButton = element('academicBbScriptDelete');
    const size = element('academicBbScriptSize');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.disabled = bbScriptBusy || !bbScriptReady;
      checkbox.checked = bbScriptEnabled;
    }
    if (download instanceof HTMLButtonElement) {
      download.hidden = bbScriptInstalled;
      download.disabled = bbScriptBusy || !bbScriptReady;
      download.textContent = bbScriptBusy ? '处理中…' : '下载';
    }
    if (checkUpdate instanceof HTMLButtonElement) {
      checkUpdate.hidden = !bbScriptInstalled;
      checkUpdate.disabled = bbScriptBusy;
    }
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.hidden = !bbScriptInstalled;
      deleteButton.disabled = bbScriptBusy || bbScriptEnabled;
    }
    if (size instanceof HTMLElement) {
      size.textContent = bbScriptSizeBytes > 0 ? formatExternalScriptBytes(bbScriptSizeBytes) : '—';
      size.style.cssText = buildFileSizeEmphasisStyle(bbScriptSizeBytes);
    }
    if (!bbScriptBusy) setBbScriptStatus(bbScriptInstalled ? '已下载' : '未下载');
  }

  async function runtimeBbScriptInfo() {
    try {
      const response = await fetch(chrome.runtime.getURL(BB_SCRIPT_PATH), { cache: 'no-store' });
      if (!response.ok) return { exists: false, size: 0 };
      const bytes = await response.arrayBuffer();
      return { exists: true, size: bytes.byteLength };
    } catch {
      return { exists: false, size: 0 };
    }
  }

  async function refreshBbScriptState() {
    const stored = await chrome.storage.local.get([BB_SCRIPT_STORAGE_KEY]);
    let directoryReady = false;
    let directorySize = 0;
    try {
      const manager = await getUpdaterManager();
      directoryReady = await manager.managedFileExists(BB_SCRIPT_PATH);
      if (directoryReady && typeof manager.managedFileSize === 'function') {
        directorySize = await manager.managedFileSize(BB_SCRIPT_PATH);
      }
    } catch {}
    const runtimeInfo = await runtimeBbScriptInfo();
    bbScriptInstalled = directoryReady || runtimeInfo.exists;
    bbScriptSizeBytes = directorySize || runtimeInfo.size;
    bbScriptRuntimeReady = runtimeInfo.exists;
    bbScriptReloadRequired = false;
    bbScriptEnabled = bbScriptInstalled && stored[BB_SCRIPT_STORAGE_KEY] === true;
    if (!bbScriptInstalled && stored[BB_SCRIPT_STORAGE_KEY] === true) {
      bbScriptEnabled = false;
      await chrome.storage.local.set({ [BB_SCRIPT_STORAGE_KEY]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
    }
    bbScriptReady = true;
    renderBbScriptState();
  }

  function transformBbScript(source) {
    let text = String(source || '');
    if (text.length < 2000 || text.length > 500000
        || !text.includes('// ==UserScript==')
        || !text.includes('@name         BB酱帮你查课余量 (2026修复版)')
        || !/@match\s+https:\/\/aa\.bjtu\.edu\.cn\/course_selection\/courseselecttask\/selects\//.test(text)
        || !text.includes('function main()')
        || !text.includes('GM_notification')
        || !text.includes('GM_addStyle')) {
      throw new Error('下载内容不是预期的「BB酱帮你查课余量 (2026修复版)」');
    }
    const original = text;
    text = text.replace(/var\s+wishListCourses\s*=\s*\[[\s\S]*?\];/, 'let wishListCourses = [];');
    text = text.replace(/const\s+REFRESH_DELAY\s*=\s*\d+\s*;/, `let REFRESH_DELAY = ${DEFAULT_BB_REFRESH_DELAY_MS};`);
    text = text.replace(/\bGM_addStyle\b/g, '__bjtuGMAddStyle');
    text = text.replace(/\bGM_notification\b/g, '__bjtuGMNotification');
    const bootstrap = `
    const __bjtuGMAddStyle = (css) => {
        const style = document.createElement('style');
        style.textContent = String(css || '');
        (document.head || document.documentElement).appendChild(style);
        return style;
    };
    const __bjtuNotificationCallbacks = new Map();
    const __bjtuNormalizeWishList = (value) => {
        const source = Array.isArray(value) ? value : String(value || '').split(/[\\r\\n,]+/);
        return [...new Set(source.map(item => String(item || '').trim().toUpperCase().replace(/\\s+/g, ' '))
            .filter(item => /^[A-Z]\\d{6}[A-Z]\\s\\d{2}$/.test(item)))];
    };
    const __bjtuNormalizeDelay = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(3600000, Math.max(500, Math.round(number))) : 3000;
    };
    const __bjtuGMNotification = (options = {}) => {
        const text = String(options.text || '');
        const key = String(text.match(/课程\\s+(.+?)\\s+有余量/)?.[1] || text || 'course').trim();
        if (typeof options.onclick === 'function') __bjtuNotificationCallbacks.set(key, options.onclick);
        chrome.runtime.sendMessage({
            type: 'ACADEMIC_BB_COURSE_NOTIFICATION',
            payload: { key, title: String(options.title || ''), text }
        }).catch(() => {});
    };
    chrome.runtime.onMessage.addListener(message => {
        if (message?.type !== 'ACADEMIC_BB_NOTIFICATION_CLICKED') return;
        const callback = __bjtuNotificationCallbacks.get(String(message?.payload?.key || ''));
        if (callback) { try { callback(); } catch {} }
    });
    const __bjtuApplyConfig = (settings) => {
        wishListCourses = __bjtuNormalizeWishList(settings.academicBbWishListCourses);
        REFRESH_DELAY = __bjtuNormalizeDelay(settings.academicBbRefreshDelayMs);
    };
    const __bjtuLoadConfig = async () => {
        const settings = await chrome.storage.local.get(['academicBbWishListCourses', 'academicBbRefreshDelayMs']);
        __bjtuApplyConfig(settings);
    };
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.academicBbWishListCourses) wishListCourses = __bjtuNormalizeWishList(changes.academicBbWishListCourses.newValue);
        if (changes.academicBbRefreshDelayMs) REFRESH_DELAY = __bjtuNormalizeDelay(changes.academicBbRefreshDelayMs.newValue);
    });
`;
    text = text.replace(/(['"]use strict['"];)/, `$1${bootstrap}`);
    text = text.replace(/setTimeout\(\(\) => \{\s*LogManager\.init\(\);\s*main\(\);\s*\},\s*500\s*\);/, `setTimeout(() => {
        void __bjtuLoadConfig().finally(() => {
            LogManager.init();
            main();
        });
    }, 500);`);
    if (text === original || !text.includes('__bjtuLoadConfig().finally')
        || !text.includes('let wishListCourses = [];') || !text.includes('let REFRESH_DELAY =')) {
      throw new Error('「BB酱帮你查课余量 (2026修复版)」结构已变化，无法安全应用扩展配置');
    }
    return text;
  }

  // 新增外部脚本时只需补充这一项；下载、启用、更新、删除均复用下方通用流程。
  const EXTERNAL_SCRIPTS = Object.freeze([
    {
      id: ASSESSMENT_SCRIPT_ID,
      name: 'BJTU 北京交通大学 一键评教为“非常满意”并填写主观意见',
      storageKey: ASSESSMENT_SCRIPT_STORAGE_KEY,
      path: ASSESSMENT_SCRIPT_PATH,
      url: ASSESSMENT_SCRIPT_URL,
      contentScriptId: ASSESSMENT_CONTENT_SCRIPT_ID,
      controlPrefix: 'academicAssessmentScript',
      prepare: validateAssessmentScript
    },
    {
      id: BB_SCRIPT_ID,
      name: 'BB酱帮你查课余量 (2026修复版)',
      storageKey: BB_SCRIPT_STORAGE_KEY,
      path: BB_SCRIPT_PATH,
      url: BB_SCRIPT_URL,
      contentScriptId: BB_CONTENT_SCRIPT_ID,
      controlPrefix: 'academicBbScript',
      prepare: transformBbScript
    }
  ]);
  const externalScriptById = new Map(EXTERNAL_SCRIPTS.map((script) => [script.id, script]));
  const externalScriptState = new Map(EXTERNAL_SCRIPTS.map((script) => [script.id, {
    installed: false,
    enabled: false,
    busy: false,
    ready: false,
    localSizeBytes: 0,
    remoteSizeBytes: 0,
    prefetchedSource: null,
    runtimeReady: false,
    reloadRequired: false
  }]));

  function getExternalScriptState(script) {
    return externalScriptState.get(script.id);
  }

  function externalScriptElement(script, suffix) {
    return element(`${script.controlPrefix}${suffix}`);
  }

  function setExternalScriptStatus(script, text, error = false) {
    const status = externalScriptElement(script, 'Status');
    if (!(status instanceof HTMLElement)) return;
    status.textContent = String(text || '');
    status.classList.toggle('error', error);
  }

  function setExternalScriptProgress(script, { visible = true, loaded = 0, total = 0, label = '正在下载…' } = {}) {
    const container = externalScriptElement(script, 'Progress');
    const bar = externalScriptElement(script, 'ProgressBar');
    const labelElement = container?.querySelector('.academic-external-script-progress-label');
    if (!(container instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
    container.hidden = !visible;
    if (labelElement instanceof HTMLElement) labelElement.textContent = label;
    if (!visible) {
      container.classList.remove('is-indeterminate');
      bar.style.width = '0';
      return;
    }
    const determinate = Number(total) > 0;
    container.classList.toggle('is-indeterminate', !determinate);
    bar.style.width = determinate ? `${Math.min(100, Number(loaded) / Number(total) * 100)}%` : '';
  }

  function renderExternalScriptState(script) {
    const state = getExternalScriptState(script);
    const checkbox = externalScriptElement(script, 'Enabled');
    const download = externalScriptElement(script, 'Download');
    const checkUpdate = externalScriptElement(script, 'CheckUpdate');
    const deleteButton = externalScriptElement(script, 'Delete');
    const size = externalScriptElement(script, 'Size');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.disabled = state.busy || !state.ready;
      checkbox.checked = state.enabled;
    }
    if (download instanceof HTMLButtonElement) {
      download.hidden = state.installed;
      download.disabled = state.busy || !state.ready;
      download.textContent = state.busy ? '处理中…' : '下载';
    }
    if (checkUpdate instanceof HTMLButtonElement) {
      checkUpdate.hidden = !state.installed;
      checkUpdate.disabled = state.busy;
    }
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.hidden = !state.installed;
      deleteButton.disabled = state.busy;
      deleteButton.classList.toggle('is-locked', state.enabled);
    }
    if (size instanceof HTMLElement) {
      const bytes = state.localSizeBytes || state.remoteSizeBytes;
      size.textContent = bytes > 0
        ? formatExternalScriptBytes(bytes)
        : (state.ready && !state.installed ? '正在获取…' : '—');
      size.style.cssText = buildFileSizeEmphasisStyle(bytes);
      size.title = state.localSizeBytes > 0 ? '已下载文件大小' : (bytes > 0 ? '远端文件大小' : '正在获取远端文件大小');
    }
    if (!state.busy) setExternalScriptStatus(script, state.installed ? '已下载' : '未下载');
  }

  async function runtimeExternalScriptInfo(script) {
    try {
      const response = await fetch(chrome.runtime.getURL(script.path), { cache: 'no-store' });
      if (!response.ok) return { exists: false, size: 0 };
      return { exists: true, size: (await response.arrayBuffer()).byteLength };
    } catch {
      return { exists: false, size: 0 };
    }
  }

  async function refreshExternalScriptState(script) {
    const state = getExternalScriptState(script);
    const stored = await chrome.storage.local.get([script.storageKey]);
    let directoryReady = false;
    let directorySize = 0;
    try {
      const manager = await getUpdaterManager();
      directoryReady = await manager.managedFileExists(script.path);
      if (directoryReady && typeof manager.managedFileSize === 'function') {
        directorySize = await manager.managedFileSize(script.path);
      }
    } catch {}
    const runtimeInfo = await runtimeExternalScriptInfo(script);
    state.installed = directoryReady || runtimeInfo.exists;
    state.localSizeBytes = directorySize || runtimeInfo.size;
    state.runtimeReady = runtimeInfo.exists;
    state.reloadRequired = false;
    state.enabled = state.installed && stored[script.storageKey] === true;
    if (!state.installed && stored[script.storageKey] === true) {
      state.enabled = false;
      await chrome.storage.local.set({ [script.storageKey]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
    }
    state.ready = true;
    renderExternalScriptState(script);
    if (!state.localSizeBytes) await prefetchExternalScriptSource(script);
  }

  async function fetchExternalScriptSource(script, onProgress) {
    const response = await fetch(script.url, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`GreasyFork 下载失败：HTTP ${response.status}`);
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = await response.text();
      onProgress?.({ loaded: new TextEncoder().encode(text).byteLength, total });
      return script.prepare(text);
    }
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return script.prepare(new TextDecoder().decode(bytes));
  }

  async function prefetchExternalScriptSource(script) {
    const state = getExternalScriptState(script);
    try {
      const source = await fetchExternalScriptSource(script);
      if (state.installed) return;
      state.prefetchedSource = source;
      state.remoteSizeBytes = new TextEncoder().encode(source).byteLength;
      renderExternalScriptState(script);
    } catch {
      // The download button remains available; only the optional size preview is unavailable.
    }
  }

  async function downloadExternalScript(script, { enableAfterDownload = false } = {}) {
    const state = getExternalScriptState(script);
    if (state.busy || state.installed) return;
    state.busy = true;
    state.enabled = enableAfterDownload;
    renderExternalScriptState(script);
    setExternalScriptStatus(script, '正在请求扩展目录写入权限…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      setExternalScriptStatus(script, '正在从 GreasyFork 下载…');
      setExternalScriptProgress(script, { visible: true });
      const source = state.prefetchedSource || await fetchExternalScriptSource(script, ({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setExternalScriptProgress(script, {
          visible: true, loaded, total,
          label: `正在下载：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      const bytes = new TextEncoder().encode(source);
      await manager.writeManagedFile(root, script.path, bytes);
      state.localSizeBytes = bytes.byteLength;
      state.remoteSizeBytes = 0;
      state.prefetchedSource = null;
      state.reloadRequired = true;
      state.installed = true;
      state.enabled = enableAfterDownload;
      await chrome.storage.local.set({ [script.storageKey]: enableAfterDownload });
      setExternalScriptProgress(script, { visible: false });
      state.busy = false;
      renderExternalScriptState(script);
      if (enableAfterDownload) {
        await setExternalScriptEnabled(script, true);
      } else {
        setMessage(`「${script.name}」已下载`);
      }
    } catch (error) {
      state.busy = false;
      state.enabled = false;
      setExternalScriptProgress(script, { visible: false });
      renderExternalScriptState(script);
      setExternalScriptStatus(script, String(error?.message || error), true);
      setMessage(`外部脚本下载失败：${String(error?.message || error)}`, false);
    }
  }

  async function setExternalScriptEnabled(script, enabled) {
    const state = getExternalScriptState(script);
    if (state.busy || !state.ready) return;
    if (enabled && !state.installed) return downloadExternalScript(script, { enableAfterDownload: true });
    state.busy = true;
    state.enabled = enabled;
    renderExternalScriptState(script);
    try {
      await chrome.storage.local.set({ [script.storageKey]: enabled });
      const result = await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      if (!result?.ok) throw new Error(result?.message || `脚本${enabled ? '注册' : '注销'}失败`);
      state.busy = false;
      renderExternalScriptState(script);
      if (!enabled) {
        setMessage(`已停用「${script.name}」，可点击「删除」卸载`);
        return;
      }
      if (Array.isArray(result.registeredIds)
          && result.registeredIds.includes(script.contentScriptId)) {
        state.runtimeReady = true;
        state.reloadRequired = false;
        setMessage(`已启用「${script.name}」`);
      } else {
        setExternalScriptStatus(script, '正在启用并重新加载扩展…');
        await reloadAcademicOptionsPage(script.id);
      }
    } catch (error) {
      await chrome.storage.local.set({ [script.storageKey]: !enabled });
      state.enabled = !enabled;
      state.busy = false;
      renderExternalScriptState(script);
      setExternalScriptStatus(script, String(error?.message || error), true);
      setMessage(`外部脚本${enabled ? '启用' : '停用'}失败：${String(error?.message || error)}`, false);
    }
  }

  async function deleteExternalScript(script) {
    const state = getExternalScriptState(script);
    if (state.busy || !state.installed) return;
    if (state.enabled) {
      setMessage('请先停用该脚本再删除', false);
      return;
    }
    state.busy = true;
    renderExternalScriptState(script);
    setExternalScriptStatus(script, '正在删除…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      await manager.removeManagedFile(root, script.path);
      await chrome.storage.local.set({ [script.storageKey]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      Object.assign(state, { installed: false, localSizeBytes: 0, remoteSizeBytes: 0, prefetchedSource: null, runtimeReady: false, reloadRequired: false, busy: false });
      renderExternalScriptState(script);
      setExternalScriptStatus(script, '已删除，正在重新加载扩展…');
      await reloadAcademicOptionsPage(script.id);
    } catch (error) {
      state.busy = false;
      renderExternalScriptState(script);
      setExternalScriptStatus(script, String(error?.message || error), true);
      setMessage(`外部脚本删除失败：${String(error?.message || error)}`, false);
    }
  }

  async function checkExternalScriptUpdate(script) {
    const state = getExternalScriptState(script);
    if (state.busy || !state.installed) return;
    state.busy = true;
    renderExternalScriptState(script);
    setExternalScriptStatus(script, '正在检查更新…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      const current = await (await manager.readManagedFile(root, script.path)).text();
      setExternalScriptProgress(script, { visible: true, label: '正在从 GreasyFork 检查更新…' });
      const latest = await fetchExternalScriptSource(script, ({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setExternalScriptProgress(script, {
          visible: true, loaded, total,
          label: `正在检查：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').trim();
      if (normalize(current) === normalize(latest)) {
        state.busy = false;
        setExternalScriptProgress(script, { visible: false });
        renderExternalScriptState(script);
        setExternalScriptStatus(script, '已下载（已是最新）');
        return;
      }
      const bytes = new TextEncoder().encode(latest);
      await manager.writeManagedFile(root, script.path, bytes);
      state.localSizeBytes = bytes.byteLength;
      state.remoteSizeBytes = 0;
      state.reloadRequired = true;
      state.busy = false;
      setExternalScriptProgress(script, { visible: false });
      renderExternalScriptState(script);
      setExternalScriptStatus(script, state.enabled ? '已下载（已更新，重新启用后生效）' : '已下载（已更新）');
      setMessage(state.enabled
        ? `「${script.name}」已更新，请取消勾选后重新启用`
        : `「${script.name}」已更新`);
    } catch (error) {
      state.busy = false;
      setExternalScriptProgress(script, { visible: false });
      renderExternalScriptState(script);
      setExternalScriptStatus(script, String(error?.message || error), true);
      setMessage(`检查外部脚本更新失败：${String(error?.message || error)}`, false);
    }
  }

  function externalScriptAction(scriptId, action, value) {
    const script = externalScriptById.get(scriptId);
    if (!script) return;
    const actions = {
      download: () => downloadExternalScript(script),
      update: () => checkExternalScriptUpdate(script),
      delete: () => deleteExternalScript(script),
      enabled: () => setExternalScriptEnabled(script, value === true)
    };
    return actions[action]?.();
  }

  async function fetchBbScript(onProgress) {
    const response = await fetch(BB_SCRIPT_URL, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`GreasyFork 下载失败：HTTP ${response.status}`);
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = await response.text();
      onProgress?.({ loaded: new TextEncoder().encode(text).byteLength, total });
      return transformBbScript(text);
    }
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return transformBbScript(new TextDecoder().decode(bytes));
  }

  async function downloadBbScript({ enableAfterDownload = false } = {}) {
    if (bbScriptBusy || bbScriptInstalled) return;
    bbScriptBusy = true;
    bbScriptEnabled = enableAfterDownload;
    renderBbScriptState();
    setBbScriptStatus('正在请求扩展目录写入权限…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      setBbScriptStatus('正在从 GreasyFork 下载…');
      setBbScriptProgress({ visible: true });
      const source = await fetchBbScript(({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setBbScriptProgress({
          visible: true,
          loaded,
          total,
          label: `正在下载：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      const bytes = new TextEncoder().encode(source);
      await manager.writeManagedFile(root, BB_SCRIPT_PATH, bytes);
      bbScriptSizeBytes = bytes.byteLength;
      bbScriptReloadRequired = true;
      bbScriptInstalled = true;
      bbScriptEnabled = enableAfterDownload;
      await chrome.storage.local.set({ [BB_SCRIPT_STORAGE_KEY]: enableAfterDownload });
      setBbScriptProgress({ visible: false });
      bbScriptBusy = false;
      renderBbScriptState();
      if (enableAfterDownload) {
        setBbScriptStatus('已下载，正在启用并重新加载扩展…');
        await reloadAcademicOptionsPage(BB_SCRIPT_ID);
      } else {
        setMessage('「BB酱帮你查课余量 (2026修复版)」已下载');
      }
    } catch (error) {
      bbScriptBusy = false;
      bbScriptEnabled = false;
      setBbScriptProgress({ visible: false });
      renderBbScriptState();
      setBbScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本下载失败：${String(error?.message || error)}`, false);
    }
  }

  async function setBbScriptEnabled(enabled) {
    if (bbScriptBusy || !bbScriptReady) return;
    if (enabled && !bbScriptInstalled) {
      await downloadBbScript({ enableAfterDownload: true });
      return;
    }
    bbScriptBusy = true;
    bbScriptEnabled = enabled;
    renderBbScriptState();
    if (enabled) {
      try {
        await chrome.storage.local.set({ [BB_SCRIPT_STORAGE_KEY]: true });
        bbScriptBusy = false;
        renderBbScriptState();
        const result = await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
        if (!result?.ok) throw new Error(result?.message || '脚本注册失败');
        if (!bbScriptReloadRequired && Array.isArray(result.registeredIds)
            && result.registeredIds.includes(BB_CONTENT_SCRIPT_ID)) {
          bbScriptRuntimeReady = true;
          bbScriptReloadRequired = false;
          setMessage('已启用「BB酱帮你查课余量 (2026修复版)」');
        } else {
          setBbScriptStatus('正在启用并重新加载扩展…');
          await reloadAcademicOptionsPage(BB_SCRIPT_ID);
        }
      } catch (error) {
        await chrome.storage.local.set({ [BB_SCRIPT_STORAGE_KEY]: false });
        bbScriptEnabled = false;
        bbScriptBusy = false;
        renderBbScriptState();
        setBbScriptStatus(String(error?.message || error), true);
      }
      return;
    }
    try {
      await chrome.storage.local.set({ [BB_SCRIPT_STORAGE_KEY]: false });
      const result = await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      if (!result?.ok) throw new Error(result?.message || '脚本注销失败');
      bbScriptBusy = false;
      renderBbScriptState();
      setMessage('已停用「BB酱帮你查课余量 (2026修复版)」，可点击「删除」卸载');
    } catch (error) {
      await chrome.storage.local.set({ [BB_SCRIPT_STORAGE_KEY]: true });
      bbScriptEnabled = true;
      bbScriptBusy = false;
      renderBbScriptState();
      setBbScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本停用失败：${String(error?.message || error)}`, false);
    }
  }

  async function deleteBbScript() {
    if (bbScriptBusy || !bbScriptInstalled || bbScriptEnabled) return;
    bbScriptBusy = true;
    renderBbScriptState();
    setBbScriptStatus('正在删除…');
    try {
      const shouldReload = bbScriptRuntimeReady;
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      await manager.removeManagedFile(root, BB_SCRIPT_PATH);
      await chrome.storage.local.set({ [BB_SCRIPT_STORAGE_KEY]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      bbScriptInstalled = false;
      bbScriptSizeBytes = 0;
      bbScriptRuntimeReady = false;
      bbScriptReloadRequired = false;
      bbScriptBusy = false;
      renderBbScriptState();
      if (shouldReload) {
        setBbScriptStatus('已删除，正在重新加载扩展…');
        await reloadAcademicOptionsPage(BB_SCRIPT_ID);
      } else {
        setBbScriptStatus('未下载');
        setMessage('「BB酱帮你查课余量 (2026修复版)」已删除');
      }
    } catch (error) {
      bbScriptBusy = false;
      renderBbScriptState();
      setBbScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本删除失败：${String(error?.message || error)}`, false);
    }
  }

  async function checkBbScriptUpdate() {
    if (bbScriptBusy || !bbScriptInstalled) return;
    bbScriptBusy = true;
    renderBbScriptState();
    setBbScriptStatus('正在检查更新…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      const current = await (await manager.readManagedFile(root, BB_SCRIPT_PATH)).text();
      setBbScriptProgress({ visible: true, label: '正在从 GreasyFork 检查更新…' });
      const latest = await fetchBbScript(({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setBbScriptProgress({
          visible: true,
          loaded,
          total,
          label: `正在检查：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').trim();
      if (normalize(current) === normalize(latest)) {
        bbScriptBusy = false;
        setBbScriptProgress({ visible: false });
        renderBbScriptState();
        setBbScriptStatus('已下载（已是最新）');
        return;
      }
      const bytes = new TextEncoder().encode(latest);
      await manager.writeManagedFile(root, BB_SCRIPT_PATH, bytes);
      bbScriptSizeBytes = bytes.byteLength;
      bbScriptReloadRequired = true;
      bbScriptBusy = false;
      setBbScriptProgress({ visible: false });
      renderBbScriptState();
      setBbScriptStatus(bbScriptEnabled ? '已下载（已更新，重新启用后生效）' : '已下载（已更新）');
      setMessage(bbScriptEnabled
        ? '「BB酱帮你查课余量 (2026修复版)」已更新，请取消勾选后重新启用'
        : '「BB酱帮你查课余量 (2026修复版)」已更新');
    } catch (error) {
      bbScriptBusy = false;
      setBbScriptProgress({ visible: false });
      renderBbScriptState();
      setBbScriptStatus(String(error?.message || error), true);
      setMessage(`检查外部脚本更新失败：${String(error?.message || error)}`, false);
    }
  }

  function isRetryableAcademicLoadFailure(result) {
    const status = Number(result?.status || result?.httpStatus || 0);
    const code = String(result?.code || '');
    const message = String(result?.message || result?.error || '');
    if (result?.ok === true) return false;
    if (code === 'not-logged-in' || /登录已失效|未登录/u.test(message)) return false;
    return result?.ok === false
      || status === 503
      || /(?:^|\D)503(?:\D|$)/i.test(message)
      || /Failed to fetch/i.test(message);
  }

  async function sendAcademicLoadWithRetry(type, payload, label, notify = false) {
    beginAcademicOptionsRequest();
    try {
      while (true) {
        const result = await send(type, payload);
        if (!isRetryableAcademicLoadFailure(result)) return result;
        if (notify) setMessage(`${label}暂时不可用，1 秒后自动重试…`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } finally {
      endAcademicOptionsRequest();
    }
  }

  function normalizeMinutes(value, fallback) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_INTERVAL_MINUTES
      ? minutes
      : fallback;
  }

  function intervalParts(value, fallback) {
    const minutes = normalizeMinutes(value, fallback);
    for (const unit of [1440, 60]) {
      if (minutes % unit === 0) return { value: minutes / unit, unit };
    }
    return { value: minutes, unit: 1 };
  }

  function setIntervalEditor(prefix, value, fallback) {
    const parts = intervalParts(value, fallback);
    const input = element(`${prefix}Value`);
    const select = element(`${prefix}Unit`);
    if (input instanceof HTMLInputElement) input.value = String(parts.value);
    if (select instanceof HTMLSelectElement) select.value = String(parts.unit);
  }

  function readIntervalEditor(prefix, fallback) {
    const value = Number(element(`${prefix}Value`)?.value);
    const unit = Number(element(`${prefix}Unit`)?.value);
    return normalizeMinutes(value * unit, fallback);
  }

  function bindIntervalEditor(prefix, key, fallback, label) {
    const save = async () => {
      const minutes = readIntervalEditor(prefix, fallback);
      await chrome.storage.local.set({ [key]: minutes });
      setIntervalEditor(prefix, minutes, fallback);
      setMessage(`已将${label}设为 ${minutes} 分钟`);
    };
    element(`${prefix}Value`)?.addEventListener('change', save);
    element(`${prefix}Unit`)?.addEventListener('change', save);
  }

  function updateDisabledState() {
    const monitorEnabled = ['academicScoreMonitorEnabled', 'academicExamMonitorEnabled', 'academicClassReminderEnabled']
      .some((id) => element(id)?.checked);
    const monitorEditor = element('academicScoreMonitorIntervalEditor');
    monitorEditor?.classList.toggle('is-disabled', !monitorEnabled);
    monitorEditor?.querySelectorAll('input,select').forEach((control) => {
      control.disabled = !monitorEnabled;
    });
    const reminderEnabled = element('academicClassReminderEnabled')?.checked === true;
    const reminderEditor = element('academicClassReminderLeadEditor');
    reminderEditor?.classList.toggle('is-disabled', !reminderEnabled);
    reminderEditor?.querySelectorAll('input,select').forEach((control) => {
      control.disabled = !reminderEnabled;
    });
  }

  function renderAccounts(value) {
    const select = element('academicAccountSelect');
    if (!(select instanceof HTMLSelectElement)) return;
    const accounts = Array.isArray(value?.accounts) ? value.accounts : [];
    const selected = String(value?.studentId || '');
    select.replaceChildren();
    if (!accounts.length) {
      select.append(new Option('暂无已保存账号', ''));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    for (const account of accounts) {
      const id = String(account?.studentId || '');
      const option = new Option([id, account?.userName].filter(Boolean).join(' '), id);
      option.disabled = !account?.hasPassword && id !== selected;
      select.append(option);
    }
    select.value = accounts.some((account) => String(account?.studentId) === selected)
      ? selected
      : String(accounts[0]?.studentId || '');
  }

  function renderEmptyDataStatus(target, bodyId, loadingId, message) {
    if (!(target instanceof HTMLElement)) return;
    const loading = element(loadingId);
    if (loading instanceof HTMLElement && loading.style.display !== 'none') {
      target.style.display = 'none';
      target.textContent = '';
      return;
    }
    const empty = element(bodyId)?.childElementCount === 0;
    target.style.display = empty ? 'block' : 'none';
    target.textContent = empty ? message : '';
  }

  function renderMonitorStatus(status) {
    const target = element('academicSystemStatus');
    if (!(target instanceof HTMLElement) || !status) return;
    if (status.status === 'error') {
      target.style.display = 'block';
      target.textContent = `成绩检查失败：${status.error || '未知错误'}`;
    } else if (status.status === 'complete' || status.status === 'ok') {
      renderEmptyDataStatus(target, 'academicScoreTableBody', 'academicScoreLoading', '暂无成绩数据');
    }
  }

  function renderExamStatus(status) {
    const target = element('academicExamStatus');
    if (!(target instanceof HTMLElement)) return;
    if (!status) {
      renderEmptyDataStatus(target, 'academicExamTableBody', 'academicExamLoading', '暂无考试信息');
      return;
    }
    if (status.status === 'error') {
      target.style.display = 'block';
      target.textContent = `考试信息检查失败：${status.error || '未知错误'}`;
    } else if (status.status === 'retrying') {
      target.style.display = 'none';
      target.textContent = '';
    } else if (status.status === 'complete' || status.status === 'ok') {
      renderEmptyDataStatus(target, 'academicExamTableBody', 'academicExamLoading', '暂无考试信息');
    } else {
      target.style.display = 'none';
      target.textContent = '';
    }
  }

  function renderScores(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const body = element('academicScoreTableBody');
    if (body instanceof HTMLElement) body.replaceChildren();
    element('academicScoreLoading').style.display = sharedAllLoading ? 'flex' : 'none';
    element('academicScoreTableWrap').style.display = list.length ? 'block' : 'none';
    const semesterSizes = new Map();
    list.forEach((row) => {
      const semester = String(row?.academicYear || '');
      semesterSizes.set(semester, (semesterSizes.get(semester) || 0) + 1);
    });
    const renderedSemesters = new Set();
    for (const row of list) {
      const tr = document.createElement('tr');
      const semester = String(row?.academicYear || '');
      if (!renderedSemesters.has(semester)) {
        renderedSemesters.add(semester);
        const semesterCell = document.createElement('td');
        semesterCell.className = 'academic-exam-group-cell';
        semesterCell.rowSpan = semesterSizes.get(semester) || 1;
        semesterCell.textContent = semester || '-';
        tr.appendChild(semesterCell);
      }
      [row.course, row.credit, row.score, row.bonusScore, row.teacher]
        .forEach((value) => {
          const td = document.createElement('td');
          td.textContent = String(value || '-');
          tr.appendChild(td);
        });
      const detailsCell = document.createElement('td');
      if (row.details) {
        const details = document.createElement('details');
        details.className = 'academic-score-details';
        const summary = document.createElement('summary');
        summary.textContent = '详情';
        const content = document.createElement('div');
        content.textContent = String(row.details);
        details.append(summary, content);
        detailsCell.appendChild(details);
      } else {
        detailsCell.textContent = '-';
      }
      tr.appendChild(detailsCell);
      body?.appendChild(tr);
    }
    renderAcademicScoreStatistics(list);
    renderEmptyDataStatus(element('academicSystemStatus'), 'academicScoreTableBody', 'academicScoreLoading', '暂无成绩数据');
  }

  function renderAcademicScoreStatistics(rows, loading = sharedAllLoading) {
    const container = element('academicScoreStatistics');
    if (!(container instanceof HTMLElement)) return;
    const result = global.BjtuAcademicScoreStatistics?.calculate(rows) || null;
    container.style.display = result || loading ? 'flex' : 'none';
    if (!result && !loading) return;
    const values = {
      academicAverageGpa: result?.averageGpaText || '-',
      academicWeightedAverageScore: result?.weightedAverageScoreText || '-'
    };
    for (const [id, text] of Object.entries(values)) {
      const value = element(id);
      if (!(value instanceof HTMLElement)) continue;
      value.replaceChildren(document.createTextNode(text));
      if (loading) {
        const spinner = document.createElement('span');
        spinner.className = 'options-page-spinner academic-score-statistics-spinner';
        spinner.setAttribute('aria-label', '仍在加载其他学期成绩');
        value.appendChild(spinner);
      }
    }
  }

  function renderAcademicScoreStatisticsLoading() {
    renderAcademicScoreStatistics(filterCachedScoreRows(element('academicScoreSemester')?.value), true);
  }

  function renderScoreSemesterOptions(semesters, currentZxjxjhh = '', preferredValue = '') {
    const select = element('academicScoreSemester');
    if (!(select instanceof HTMLSelectElement)) return;
    scoreSemesterOptions = Array.isArray(semesters) ? semesters : [];
    scoreCurrentZxjxjhh = String(currentZxjxjhh || '').trim();
    select.replaceChildren(new Option('全部', '__all__'));
    for (const semester of scoreSemesterOptions) {
      const value = String(semester?.zxjxjhh || '').trim();
      const label = String(semester?.label || '').trim();
      if (!value || !label) continue;
      select.append(new Option(
        value === scoreCurrentZxjxjhh ? `${label}(本学期)` : label,
        value
      ));
    }
    const preferred = String(preferredValue || '');
    select.value = preferred && [...select.options].some((option) => option.value === preferred)
      ? preferred
      : (scoreCurrentZxjxjhh || '__all__');
    scoreSemesterPreference = select.value === scoreCurrentZxjxjhh ? '' : select.value;
    const button = element('academicScoreCurrentSemesterBtn');
    if (button instanceof HTMLButtonElement) {
      button.disabled = !scoreCurrentZxjxjhh;
      button.textContent = select.value === scoreCurrentZxjxjhh ? '全部' : '本学期';
    }
  }

  function renderDataSemesterOptions(selectId, buttonId, semesters, currentValue, preferredValue, { all = false } = {}) {
    const select = element(selectId);
    if (!(select instanceof HTMLSelectElement)) return '';
    const list = Array.isArray(semesters) ? semesters : [];
    const current = String(currentValue || '').trim();
    select.replaceChildren();
    if (all) select.append(new Option('全部', '__all__'));
    for (const semester of list) {
      const value = String(semester?.value || semester?.zxjxjhh || semester?.xnxq || '').trim();
      const label = String(semester?.label || '').trim();
      if (value && label) select.append(new Option(value === current ? `${label}(本学期)` : label, value));
    }
    const preferred = String(preferredValue || '').trim();
    const fallback = [...select.options].some((option) => option.value === current)
      ? current
      : (all ? '__all__' : String(select.options[0]?.value || ''));
    select.value = [...select.options].some((option) => option.value === preferred) ? preferred : fallback;
    const button = element(buttonId);
    if (button instanceof HTMLButtonElement) {
      button.disabled = !current || ![...select.options].some((option) => option.value === current);
      button.textContent = all && select.value === current ? '全部' : '本学期';
    }
    return select.value;
  }

  function normalizedAcademicCourseCode(value) {
    return String(value || '').trim().toUpperCase().match(/^([A-Z]\d{6}[A-Z])(?:\b|\s|$)/)?.[1] || '';
  }

  function academicScoreRowsForCourse(semester, courseCode) {
    const normalizedSemester = String(semester || '').trim();
    const normalizedCode = normalizedAcademicCourseCode(courseCode);
    if (!normalizedSemester || !normalizedCode) return [];
    return (scoresCache?.rows || []).filter((row) => (
      String(row?.academicYear || '').trim() === normalizedSemester
      && normalizedAcademicCourseCode(row?.courseCode || row?.course) === normalizedCode
    ));
  }

  function academicExamRowsForCourse(semester, courseCode) {
    const normalizedSemester = String(semester || '').trim();
    const normalizedCode = normalizedAcademicCourseCode(courseCode);
    if (!normalizedSemester || !normalizedCode) return [];
    return (examsCache?.results || [])
      .filter((item) => String(item?.label || '').trim() === normalizedSemester)
      .flatMap((item) => item?.rows || [])
      .filter((row) => normalizedAcademicCourseCode(row?.courseCode || row?.course) === normalizedCode);
  }

  function appendAcademicHoverField(parent, label, value, multiline = false) {
    const text = String(value ?? '').trim();
    if (!text) return;
    const row = document.createElement('div');
    row.className = `academic-course-hover-field${multiline ? ' is-multiline' : ''}`;
    const name = document.createElement('span');
    name.className = 'academic-course-hover-label';
    name.textContent = `${label}：`;
    const content = document.createElement('span');
    content.className = 'academic-course-hover-value';
    content.textContent = text;
    row.append(name, content);
    parent.appendChild(row);
  }

  function appendAcademicHoverSection(parent, title, rows, type) {
    if (!rows.length) return;
    const section = document.createElement('section');
    section.className = 'academic-course-hover-section';
    const heading = document.createElement('strong');
    heading.className = 'academic-course-hover-heading';
    heading.textContent = title;
    section.appendChild(heading);
    rows.forEach((row) => {
      const record = document.createElement('div');
      record.className = 'academic-course-hover-record';
      if (type === 'score') {
        appendAcademicHoverField(record, '课程', row.course);
        appendAcademicHoverField(record, '学分', row.credit);
        appendAcademicHoverField(record, '成绩', row.score);
        appendAcademicHoverField(record, '加分成绩', row.bonusScore);
        appendAcademicHoverField(record, '上课教师', row.teacher);
        appendAcademicHoverField(record, '详细信息', row.details, true);
      } else {
        appendAcademicHoverField(record, '考试', row.exam);
        appendAcademicHoverField(record, '课程', row.course);
        appendAcademicHoverField(record, '时间地点', row.timeLocation, true);
        appendAcademicHoverField(record, '考试方式', row.method);
        appendAcademicHoverField(record, '备注', row.remarks);
        appendAcademicHoverField(record, '报名信息', row.registration);
        appendAcademicHoverField(record, '考试状态', row.status);
        appendAcademicHoverField(record, '操作', row.operation);
      }
      section.appendChild(record);
    });
    parent.appendChild(section);
  }

  function academicCourseHoverCard() {
    let card = element('academicCourseHoverCard');
    if (card instanceof HTMLElement) return card;
    card = document.createElement('div');
    card.id = 'academicCourseHoverCard';
    card.className = 'academic-course-hover-card';
    card.hidden = true;
    document.body.appendChild(card);
    return card;
  }

  function positionAcademicCourseHoverCard(event) {
    const card = academicCourseHoverCard();
    if (card.hidden) return;
    const gap = 14;
    const margin = 8;
    const rect = card.getBoundingClientRect();
    let left = Number(event?.clientX || 0) + gap;
    let top = Number(event?.clientY || 0) + gap;
    if (left + rect.width > window.innerWidth - margin) left = Number(event?.clientX || 0) - rect.width - gap;
    if (top + rect.height > window.innerHeight - margin) top = Number(event?.clientY || 0) - rect.height - gap;
    card.style.left = `${Math.max(margin, left)}px`;
    card.style.top = `${Math.max(margin, top)}px`;
  }

  function showAcademicCourseHoverCard(event, data) {
    const scores = Array.isArray(data?.scores) ? data.scores : [];
    const exams = Array.isArray(data?.exams) ? data.exams : [];
    const card = academicCourseHoverCard();
    card.replaceChildren();
    if (!scores.length && !exams.length) {
      card.hidden = true;
      return;
    }
    const title = document.createElement('div');
    title.className = 'academic-course-hover-title';
    title.textContent = [data?.courseCode, data?.semester].filter(Boolean).join(' · ');
    card.appendChild(title);
    appendAcademicHoverSection(card, '考务考试信息', exams, 'exam');
    appendAcademicHoverSection(card, '成绩', scores, 'score');
    card.hidden = false;
    positionAcademicCourseHoverCard(event);
  }

  function bindAcademicCourseHover(target, resolveData) {
    if (!(target instanceof HTMLElement)) return;
    target.classList.add('academic-course-hover-target');
    target.addEventListener('mouseenter', (event) => showAcademicCourseHoverCard(event, resolveData()));
    target.addEventListener('mousemove', positionAcademicCourseHoverCard);
    target.addEventListener('mouseleave', () => { academicCourseHoverCard().hidden = true; });
  }

  function renderExams(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const body = element('academicExamTableBody');
    if (body instanceof HTMLElement) body.replaceChildren();
    element('academicExamLoading').style.display = sharedAllLoading ? 'flex' : 'none';
    element('academicExamTableWrap').style.display = list.length ? 'block' : 'none';
    const groupSizes = new Map();
    const semesterSizes = new Map();
    list.forEach((row) => {
      const semester = String(row.semester || '');
      semesterSizes.set(semester, (semesterSizes.get(semester) || 0) + 1);
      const key = `${row.semester || ''}|${row.exam || ''}`;
      groupSizes.set(key, (groupSizes.get(key) || 0) + 1);
    });
    const renderedGroups = new Set();
    const renderedSemesters = new Set();
    for (const row of list) {
      const tr = document.createElement('tr');
      const semester = String(row.semester || '');
      if (!renderedSemesters.has(semester)) {
        renderedSemesters.add(semester);
        const semesterCell = document.createElement('td');
        semesterCell.className = 'academic-exam-group-cell';
        semesterCell.rowSpan = semesterSizes.get(semester) || 1;
        semesterCell.textContent = semester || '-';
        tr.appendChild(semesterCell);
      }
      const groupKey = `${row.semester || ''}|${row.exam || ''}`;
      if (!renderedGroups.has(groupKey)) {
        renderedGroups.add(groupKey);
        const exam = document.createElement('td');
        exam.className = 'academic-exam-group-cell';
        exam.rowSpan = groupSizes.get(groupKey) || 1;
        exam.textContent = String(row.exam || '-');
        tr.appendChild(exam);
      }
      const course = document.createElement('td');
      course.textContent = String(row.course || '-');
      const courseCode = normalizedAcademicCourseCode(row.courseCode || row.course);
      bindAcademicCourseHover(course, () => ({
        courseCode,
        semester,
        scores: academicScoreRowsForCourse(semester, courseCode)
      }));
      tr.appendChild(course);
      const timeLocation = document.createElement('td');
      const lines = String(row.timeLocation || '-').split(/\n+/).filter(Boolean);
      const timeLine = document.createElement('div');
      timeLine.className = 'academic-exam-time-line';
      const timeText = document.createElement('span');
      timeText.textContent = lines[0] || '-';
      timeLine.appendChild(timeText);
      if (Number(row.startAt || 0) > Date.now()) {
        const countdown = document.createElement('span');
        countdown.className = 'deadline-countdown academic-exam-countdown';
        countdown.dataset.deadline = String(row.startAt);
        timeLine.appendChild(countdown);
      }
      timeLocation.appendChild(timeLine);
      if (lines.length > 1) {
        const location = document.createElement('div');
        location.textContent = lines.slice(1).join(' ');
        timeLocation.appendChild(location);
      }
      tr.appendChild(timeLocation);
      [row.method, row.remarks, row.registration, row.status, row.operation].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = String(value || '-');
        tr.appendChild(td);
      });
      body?.appendChild(tr);
    }
    renderEmptyDataStatus(element('academicExamStatus'), 'academicExamTableBody', 'academicExamLoading', '暂无考试信息');
    global.updateAllCountdowns?.();
  }

  function occupiedScheduleWeeks(rows) {
    return new Set((Array.isArray(rows) ? rows : []).flatMap((row) => (
      (Array.isArray(row?.days) ? row.days : []).flatMap((courses) => (
        (Array.isArray(courses) ? courses : []).flatMap((course) => (
          Array.isArray(course?.weeks) ? course.weeks : []
        ))
      ))
    )).map(Number));
  }

  function renderScheduleWeekOptions(data, preferredValue = 'all') {
    const select = element('academicScheduleWeek');
    if (!(select instanceof HTMLSelectElement)) return;
    const currentWeek = Number(data?.currentWeek || 0);
    const labels = data?.weekLabels && typeof data.weekLabels === 'object' ? data.weekLabels : {};
    const occupied = occupiedScheduleWeeks(data?.rows);
    const selection = data?.type === 'selection';
    select.replaceChildren(new Option('全部', 'all'));
    for (const week of Array.isArray(data?.weeks) ? data.weeks : []) {
      const status = selection
        ? (occupied.has(Number(week)) ? '(有课)' : '')
        : String(labels[week] || '').replaceAll('（', '(').replaceAll('）', ')');
      select.append(new Option(`第${week}周${status}${Number(week) === currentWeek ? '(本周)' : ''}`, String(week)));
    }
    select.value = [...select.options].some((option) => option.value === String(preferredValue))
      ? String(preferredValue)
      : 'all';
    const button = element('academicScheduleCurrentWeekBtn');
    if (button instanceof HTMLButtonElement) {
      button.disabled = currentWeek <= 0;
      button.textContent = select.value === String(currentWeek) ? '全部' : '本周';
    }
  }

  function appendScheduleCourse(cell, course) {
    const item = document.createElement('div');
    item.className = 'academic-schedule-course';
    for (const [className, value] of [
      ['academic-schedule-course-code', course?.courseCode || '-'],
      ['academic-schedule-course-name', course?.name || '-'],
      ['academic-schedule-course-detail', [course?.weekText, course?.teacher].filter(Boolean).join(' · ')],
      ['academic-schedule-course-location', course?.location || '-']
    ]) {
      const line = document.createElement('div');
      line.className = className;
      line.textContent = String(value);
      item.appendChild(line);
    }
    if (course?.selectionStatus) {
      const status = document.createElement('span');
      status.className = 'academic-schedule-selection-status';
      status.textContent = String(course.selectionStatus);
      item.appendChild(status);
    }
    const semester = String(scheduleData?.label || '').trim();
    const courseCode = normalizedAcademicCourseCode(course?.courseCode);
    bindAcademicCourseHover(item, () => ({
      courseCode,
      semester,
      exams: academicExamRowsForCourse(semester, courseCode),
      scores: academicScoreRowsForCourse(semester, courseCode)
    }));
    cell.appendChild(item);
  }

  function renderSchedule() {
    const rows = Array.isArray(scheduleData?.rows) ? scheduleData.rows : [];
    const selected = element('academicScheduleWeek')?.value;
    const selectedWeek = selected === 'all' ? 0 : Number(selected || 0);
    const body = element('academicScheduleTableBody');
    body?.replaceChildren();
    let courseCount = 0;
    for (const row of rows) {
      const tr = document.createElement('tr');
      const periodCell = document.createElement('td');
      periodCell.className = 'academic-schedule-period';
      const period = document.createElement('strong');
      period.textContent = String(row?.period || '-');
      const time = document.createElement('span');
      time.textContent = String(row?.time || '');
      periodCell.append(period, time);
      tr.appendChild(periodCell);
      for (let day = 0; day < 7; day += 1) {
        const td = document.createElement('td');
        const courses = (Array.isArray(row?.days?.[day]) ? row.days[day] : [])
          .filter((course) => !selectedWeek || (
            Array.isArray(course?.weeks)
            && course.weeks.some((week) => Number(week) === selectedWeek)
          ));
        courseCount += courses.length;
        courses.forEach((course) => appendScheduleCourse(td, course));
        tr.appendChild(td);
      }
      body?.appendChild(tr);
    }
    const visible = rows.length > 0 && (!selectedWeek || courseCount > 0);
    element('academicScheduleLoading').style.display = 'none';
    element('academicScheduleTableWrap').style.display = visible ? 'block' : 'none';
    element('academicScheduleEmpty').style.display = visible ? 'none' : 'block';
    element('academicScheduleEmpty').textContent = selectedWeek ? `第${selectedWeek}周暂无课程` : '暂无课表数据';
  }

  async function refreshContext() {
    const result = await send('ACADEMIC_GET_CONTEXT');
    if (result?.ok) context = result;
    const studentId = element('academicStudentId');
    if (studentId instanceof HTMLInputElement && document.activeElement !== studentId) {
      studentId.value = String(context?.studentId || '');
    }
    element('academicScoreMonitorEnabled').checked = context?.monitorEnabled === true;
    element('academicExamMonitorEnabled').checked = context?.examMonitorEnabled === true;
    element('academicClassReminderEnabled').checked = context?.classReminderEnabled === true;
    renderAccounts(context);
    renderMonitorStatus(context?.monitorStatus);
    renderExamStatus(context?.examMonitorStatus);
    updateDisabledState();
    return context;
  }

  // ===== 课表 / 成绩 / 考试缓存 =====
  // 首先请求用户选中的学期（默认本学期），完成首屏渲染后再补查其余学期。
  let scheduleCache = null;
  let examsCache = null;
  let scoresCache = null;

  function invalidateAcademicCaches() {
    academicDataCacheWritePromise = academicDataCacheWritePromise.catch(() => {})
      .then(() => chrome.storage.session.remove(ACADEMIC_DATA_CACHE_KEY));
    scheduleCache = null;
    scheduleData = null;
    examsCache = null;
    scoresCache = null;
    academicSemestersLoaded = false;
    academicSemestersPromise = null;
    academicSemesterOptions = [];
    scoreSemesterOptions = [];
    scoreCurrentZxjxjhh = '';
    loadedSharedTerms.clear();
    sharedTermsInFlight.clear();
    loadedScheduleTerms.clear();
    scheduleTermsInFlight.clear();
    selectionSchedulePromise = null;
  }

  function scheduleHasCourses(result) {
    return (Array.isArray(result?.rows) ? result.rows : []).some((row) => (
      (Array.isArray(row?.days) ? row.days : []).some((courses) => Array.isArray(courses) && courses.length > 0)
    ));
  }

  function applyScheduleView(result) {
    scheduleData = result;
    if (result.weekWarning) {
      element('academicScheduleStatus').style.display = 'block';
      element('academicScheduleStatus').textContent = result.weekSource === 'bksy'
        ? `${result.weekWarning}，当前周数使用本科生院教学服务平台`
        : result.weekWarning;
    }
    renderScheduleWeekOptions(result, element('academicScheduleWeek')?.value || 'all');
    renderSchedule();
  }

  async function ensureAcademicSemesterOptions() {
    if (academicSemestersLoaded) return academicSemesterOptions;
    if (!academicSemestersPromise) {
      academicSemestersPromise = sendAcademicLoadWithRetry('ACADEMIC_SEMESTERS', undefined, '教务学期服务')
        .then((semesterResult) => {
          if (!semesterResult?.ok) {
            throw Object.assign(new Error(semesterResult?.message || '学期列表读取失败'), { code: String(semesterResult?.code || '') });
          }
          academicSemesterOptions = Array.isArray(semesterResult.semesters) ? semesterResult.semesters : [];
          scoreCurrentZxjxjhh = String(semesterResult.currentZxjxjhh || '').trim();
          academicSemestersLoaded = true;
          renderScoreSemesterOptions(academicSemesterOptions, scoreCurrentZxjxjhh, scoreSemesterPreference);
          return academicSemesterOptions;
        })
        .finally(() => { academicSemestersPromise = null; });
    }
    return academicSemestersPromise;
  }

  function mergeScoreResult(result) {
    if (!result?.ok) return;
    const seen = new Map((scoresCache?.rows || []).map((row) => [String(row?.key || ''), row]));
    for (const row of (result.rows || [])) {
      const key = String(row?.key || `${row?.academicYear}|${row?.course}` || '');
      if (!key || seen.has(key)) continue;
      seen.set(key, row);
    }
    scoresCache = {
      rows: [...seen.values()],
      checkedAt: Math.max(Number(scoresCache?.checkedAt || 0), Number(result.checkedAt || 0)) || Date.now()
    };
  }

  function filterCachedScoreRows(selected) {
    const rows = scoresCache?.rows || [];
    const value = String(selected || '');
    if (!value || value === '__all__') return rows;
    const semester = (scoreSemesterOptions || []).find((item) => item.zxjxjhh === value);
    if (!semester) return rows;
    const label = String(semester.label || '').trim();
    return rows.filter((row) => String(row?.academicYear || '').trim() === label);
  }

  function mergeExamResult(result) {
    if (!result?.ok) return;
    const byTerm = new Map((examsCache?.results || []).map((item) => [item.zxjxjhh, item]));
    for (const item of (result.results || [])) byTerm.set(item.zxjxjhh, item);
    examsCache = {
      ...result,
      currentZxjxjhh: result.currentZxjxjhh || examsCache?.currentZxjxjhh || scoreCurrentZxjxjhh,
      results: [...byTerm.values()]
    };
  }

  function mergeScheduleResult(result) {
    if (!result?.ok) return;
    const byTerm = new Map((scheduleCache?.results || []).map((item) => [item.xnxq, item]));
    for (const item of (result.results || [])) {
      const existing = byTerm.get(item.xnxq);
      if (item.xnxq === result.currentXnxq && existing?.type === 'semester' && item.type === 'selection') continue;
      byTerm.set(item.xnxq, item);
    }
    scheduleCache = {
      ...result,
      currentXnxq: result.currentXnxq || scheduleCache?.currentXnxq || scoreCurrentZxjxjhh,
      selectionSemester: result.selectionSemester || scheduleCache?.selectionSemester || null,
      selectionProbed: result.selectionProbed === true || scheduleCache?.selectionProbed === true,
      results: [...byTerm.values()]
    };
  }

  function filterCachedExamRows(selected) {
    const results = Array.isArray(examsCache?.results) ? examsCache.results : [];
    const selectedResults = selected && selected !== '__all__'
      ? results.filter((item) => item.zxjxjhh === selected)
      : results;
    return selectedResults.flatMap((item) => item.rows.map((row) => ({ ...row, semester: item.label })));
  }

  function showSharedLoading() {
    sharedAllLoading = false;
    updateSharedLoadingText();
    renderAcademicScoreStatistics([], true);
    for (const id of ['academicScoreLoading', 'academicExamLoading']) {
      if (element(id)) element(id).style.display = 'flex';
    }
    for (const id of ['academicScoreTableWrap', 'academicExamTableWrap']) {
      if (element(id)) element(id).style.display = 'none';
    }
    for (const id of ['academicSystemStatus', 'academicExamStatus']) {
      if (element(id)) element(id).style.display = 'none';
    }
  }

  function setSharedAllLoading(active) {
    sharedAllLoading = active === true;
    updateSharedLoadingText();
    for (const id of ['academicScoreLoading', 'academicExamLoading']) {
      if (element(id)) element(id).style.display = sharedAllLoading ? 'flex' : 'none';
    }
    if (sharedAllLoading) {
      renderAcademicScoreStatisticsLoading();
      for (const id of ['academicSystemStatus', 'academicExamStatus']) {
        if (element(id)) element(id).style.display = 'none';
      }
    }
  }

  function academicSemesterLabel(term) {
    return String(academicSemesterOptions.find((item) => String(item?.zxjxjhh || '') === String(term || ''))?.label || term || '').trim();
  }

  function updateSharedLoadingText() {
    const label = academicSemesterLabel(sharedLoadingTerm);
    const suffix = label ? `（${label}）` : '';
    const scoreText = element('academicScoreLoadingText');
    const examText = element('academicExamLoadingText');
    if (scoreText) scoreText.textContent = `正在读取成绩${suffix}…`;
    if (examText) examText.textContent = `正在读取考试信息${suffix}…`;
  }

  function setSharedLoadingTerm(term) {
    sharedLoadingTerm = String(term || '');
    updateSharedLoadingText();
  }

  function renderCachedSharedData() {
    const selected = String(element('academicScoreSemester')?.value || scoreCurrentZxjxjhh || '__all__');
    renderScores(filterCachedScoreRows(selected));
    renderExams(filterCachedExamRows(selected));
  }

  function renderCachedScheduleData() {
    const cachedResults = scheduleCache?.results || [];
    const cachedByTerm = new Map(cachedResults.map((item) => [item.xnxq, item]));
    const availableSchedules = academicSemesterOptions
      .filter((semester) => {
        const value = String(semester?.zxjxjhh || '');
        return !loadedScheduleTerms.has(value) || scheduleHasCourses(cachedByTerm.get(value));
      })
      .map((semester) => ({
        label: semester.label,
        xnxq: semester.zxjxjhh,
        ...(cachedByTerm.get(semester.zxjxjhh) || {})
      }));
    for (const result of cachedResults) {
      if (availableSchedules.some((item) => item.xnxq === result.xnxq)) continue;
      if (result?.type !== 'selection' && !scheduleHasCourses(result)) continue;
      availableSchedules.push(result);
    }
    const requestedPreference = scheduleSemesterPreference;
    const scheduleSelected = renderDataSemesterOptions(
      'academicScheduleSemester',
      'academicScheduleCurrentSemesterBtn',
      availableSchedules.map((item) => ({
        label: `${item.label}${item.type === 'selection' && item.xnxq !== scheduleCache?.currentXnxq ? '(选课)' : ''}`,
        value: item.xnxq
      })),
      scheduleCache?.currentXnxq,
      scheduleSemesterPreference
    );
    updateScheduleSemesterToggle(scheduleSelected);
    const preferenceIsStillUnknown = requestedPreference
      && !availableSchedules.some((item) => item.xnxq === requestedPreference)
      && !loadedScheduleTerms.has(requestedPreference);
    if (!preferenceIsStillUnknown) {
      scheduleSemesterPreference = scheduleSelected === String(scheduleCache?.currentXnxq || '') ? '' : scheduleSelected;
    }
    const schedule = cachedByTerm.get(scheduleSelected);
    const isInvalidCurrentSelection = scheduleSelected === String(scheduleCache?.currentXnxq || '')
      && schedule?.type === 'selection';
    if (isInvalidCurrentSelection) {
      if (element('academicScheduleLoading')) element('academicScheduleLoading').style.display = 'flex';
      if (element('academicScheduleTableWrap')) element('academicScheduleTableWrap').style.display = 'none';
      if (element('academicScheduleEmpty')) element('academicScheduleEmpty').style.display = 'none';
    } else if (schedule) {
      applyScheduleView(schedule);
    }
  }

  function updateScheduleSemesterToggle(selectedValue = '') {
    const button = element('academicScheduleCurrentSemesterBtn');
    if (!(button instanceof HTMLButtonElement)) return;
    const current = String(scheduleCache?.currentXnxq || '').trim();
    const selection = String(scheduleCache?.selectionSemester?.xnxq || '').trim();
    const canToggle = !!current && !!selection && current !== selection;
    button.style.display = canToggle ? '' : 'none';
    button.disabled = !canToggle;
    button.textContent = String(selectedValue || '') === current ? '选课' : '本学期';
  }

  function renderCachedAcademicData() {
    renderCachedSharedData();
    renderCachedScheduleData();
  }

  function renderAvailableSharedSemesters() {
    const availableLabels = new Set([
      ...(scoresCache?.rows || []).map((row) => String(row?.academicYear || '')),
      ...(examsCache?.results || []).filter((item) => item?.rows?.length).map((item) => String(item?.label || ''))
    ]);
    const available = academicSemesterOptions.filter((item) => (
      !loadedSharedTerms.has(String(item?.zxjxjhh || ''))
      || availableLabels.has(String(item?.label || ''))
    ));
    const selected = String(element('academicScoreSemester')?.value || scoreSemesterPreference || scoreCurrentZxjxjhh || '__all__');
    renderScoreSemesterOptions(available, scoreCurrentZxjxjhh, selected);
  }

  async function requestSharedTerms(values) {
    const terms = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
    if (terms.length !== 1) throw new Error('成绩与考务每次只能加载一个学期');
    const shouldRender = () => {
      const selected = String(element('academicScoreSemester')?.value || '');
      return selected === '__all__' || terms.includes(selected);
    };
    const scores = await sendAcademicLoadWithRetry('ACADEMIC_LOAD_SCORES', { semesters: terms }, '成绩服务');
    if (!scores?.ok) throw Object.assign(new Error(scores?.message || '成绩读取失败'), { code: scores?.code });
    mergeScoreResult(scores);
    if (shouldRender()) renderScores(filterCachedScoreRows(element('academicScoreSemester')?.value));
    const exams = await sendAcademicLoadWithRetry('ACADEMIC_LOAD_EXAMS', { zxjxjhh: terms }, '考试信息服务', false);
    if (!exams?.ok) throw Object.assign(new Error(exams?.message || '考试信息读取失败'), { code: exams?.code });
    mergeExamResult(exams);
    if (shouldRender()) renderExams(filterCachedExamRows(element('academicScoreSemester')?.value));
    terms.forEach((term) => loadedSharedTerms.add(term));
    void persistAcademicDataCache();
  }

  async function ensureSharedTerms(values) {
    const terms = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
    for (const term of terms) {
      if (!loadedSharedTerms.has(term)) await enqueueSharedTerm(term);
    }
  }

  function enqueueSharedTerm(term) {
    if (loadedSharedTerms.has(term)) return Promise.resolve();
    const existing = sharedTermsInFlight.get(term);
    if (existing) return existing.promise;
    let resolveJob;
    let rejectJob;
    const promise = new Promise((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    sharedTermsInFlight.set(term, { promise, resolve: resolveJob, reject: rejectJob });
    void runSharedTermWorker();
    return promise;
  }

  async function runSharedTermWorker() {
    if (sharedTermWorkerRunning) return;
    sharedTermWorkerRunning = true;
    beginAcademicOptionsRequest();
    try {
      while (sharedTermsInFlight.size) {
        const selected = String(element('academicScoreSemester')?.value || '');
        const priority = selected && selected !== '__all__' && sharedTermsInFlight.has(selected)
          ? selected
          : sharedTermsInFlight.keys().next().value;
        const job = sharedTermsInFlight.get(priority);
        if (!job) continue;
        setSharedLoadingTerm(priority);
        try {
          await requestSharedTerms([priority]);
          job.resolve();
        } catch (error) {
          job.reject(error);
        } finally {
          if (sharedTermsInFlight.get(priority) === job) sharedTermsInFlight.delete(priority);
          if (sharedLoadingTerm === priority) setSharedLoadingTerm('');
        }
      }
    } finally {
      sharedTermWorkerRunning = false;
      endAcademicOptionsRequest();
      if (sharedTermsInFlight.size) void runSharedTermWorker();
    }
  }

  async function prefetchSharedTerms(values) {
    beginAcademicOptionsRequest();
    const pending = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
    let firstError = null;
    try {
      while (pending.length) {
        const selected = String(element('academicScoreSemester')?.value || '');
        if (selected && selected !== '__all__' && !loadedSharedTerms.has(selected)) {
          try {
            await ensureSharedTerms([selected]);
          } catch (error) {
            throw error;
          }
          renderAvailableSharedSemesters();
          if (loadedSharedTerms.has(selected)) renderCachedSharedData();
        }
        const term = pending.shift();
        if (term && !loadedSharedTerms.has(term)) {
          try {
            await ensureSharedTerms([term]);
          } catch (error) {
            firstError ||= error;
          }
          renderAvailableSharedSemesters();
          const activeSelection = String(element('academicScoreSemester')?.value || '');
          if (activeSelection === '__all__' || loadedSharedTerms.has(activeSelection)) renderCachedSharedData();
        }
      }
      if (firstError) throw firstError;
    } finally {
      endAcademicOptionsRequest();
    }
  }

  async function requestScheduleTerms(values, { includeSelection = false } = {}) {
    const terms = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
    if (terms.length !== 1) throw new Error('课表每次只能加载一个学期');
    const schedule = await sendAcademicLoadWithRetry(
      'ACADEMIC_LOAD_SCHEDULE',
      { xnxq: terms, includeSelection },
      '课表服务'
    );
    if (!schedule?.ok) throw Object.assign(new Error(schedule?.message || '课表读取失败'), { code: schedule?.code });
    mergeScheduleResult(schedule);
    terms.forEach((term) => loadedScheduleTerms.add(term));
    for (const result of (schedule.results || [])) loadedScheduleTerms.add(String(result?.xnxq || ''));
    void persistAcademicDataCache();
  }

  async function requestSelectionSchedule() {
    if (scheduleCache?.selectionProbed === true && scheduleCache?.selectionSemester?.xnxq) return;
    if (selectionSchedulePromise) return selectionSchedulePromise;
    selectionSchedulePromise = (async () => {
      const selection = await sendAcademicLoadWithRetry(
        'ACADEMIC_LOAD_SELECTION_SCHEDULE',
        undefined,
        '选课课表服务'
      );
      if (!selection?.ok) {
        throw Object.assign(new Error(selection?.message || '选课课表读取失败'), { code: selection?.code });
      }
      mergeScheduleResult(selection);
      for (const result of (selection.results || [])) loadedScheduleTerms.add(String(result?.xnxq || ''));
      void persistAcademicDataCache();
    })().finally(() => {
      selectionSchedulePromise = null;
    });
    return selectionSchedulePromise;
  }

  async function ensureScheduleTerms(values, { includeSelection = false } = {}) {
    const terms = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
    for (const term of terms) {
      if (!isScheduleTermReady(term)) await enqueueScheduleTerm(term, includeSelection);
    }
  }

  function isScheduleTermReady(term) {
    if (!loadedScheduleTerms.has(term)) return false;
    const currentTerm = String(scheduleCache?.currentXnxq || scoreCurrentZxjxjhh || '');
    if (term !== currentTerm) return true;
    return (scheduleCache?.results || []).some((item) => item.xnxq === term && item.type === 'semester');
  }

  function enqueueScheduleTerm(term, includeSelection = false) {
    if (isScheduleTermReady(term)) return Promise.resolve();
    const existing = scheduleTermsInFlight.get(term);
    if (existing) {
      existing.includeSelection ||= includeSelection;
      return existing.promise;
    }
    let resolveJob;
    let rejectJob;
    const promise = new Promise((resolve, reject) => {
      resolveJob = resolve;
      rejectJob = reject;
    });
    scheduleTermsInFlight.set(term, {
      promise,
      resolve: resolveJob,
      reject: rejectJob,
      includeSelection
    });
    void runScheduleTermWorker();
    return promise;
  }

  async function runScheduleTermWorker() {
    if (scheduleTermWorkerRunning) return;
    scheduleTermWorkerRunning = true;
    beginAcademicOptionsRequest();
    try {
      while (scheduleTermsInFlight.size) {
        const selected = String(element('academicScheduleSemester')?.value || '');
        const priority = selected && scheduleTermsInFlight.has(selected)
          ? selected
          : scheduleTermsInFlight.keys().next().value;
        const job = scheduleTermsInFlight.get(priority);
        if (!job) continue;
        try {
          await requestScheduleTerms([priority], { includeSelection: job.includeSelection });
          job.resolve();
        } catch (error) {
          job.reject(error);
        } finally {
          if (scheduleTermsInFlight.get(priority) === job) scheduleTermsInFlight.delete(priority);
        }
      }
    } finally {
      scheduleTermWorkerRunning = false;
      endAcademicOptionsRequest();
      if (scheduleTermsInFlight.size) void runScheduleTermWorker();
    }
  }

  async function prefetchScheduleTerms(values) {
    beginAcademicOptionsRequest();
    const pending = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
    try {
      while (pending.length) {
        const selected = String(element('academicScheduleSemester')?.value || '');
        if (selected && !isScheduleTermReady(selected)) {
          await ensureScheduleTerms([selected]);
          renderCachedScheduleData();
        }
        const term = pending.shift();
        if (term && !isScheduleTermReady(term)) {
          await ensureScheduleTerms([term]);
          renderCachedScheduleData();
        }
      }
    } finally {
      endAcademicOptionsRequest();
    }
  }

  async function loadAll({ preserveRendered = false } = {}) {
    beginAcademicOptionsRequest();
    try {
    if (!preserveRendered) {
      renderAcademicScoreStatisticsLoading();
      for (const id of ['academicScoreLoading', 'academicExamLoading', 'academicScheduleLoading']) {
        if (element(id)) element(id).style.display = 'flex';
      }
      for (const id of ['academicScoreTableWrap', 'academicExamTableWrap', 'academicScheduleTableWrap']) {
        if (element(id)) element(id).style.display = 'none';
      }
    }
    try {
      const semesters = await ensureAcademicSemesterOptions();
      const allTerms = semesters.map((item) => String(item?.zxjxjhh || '')).filter(Boolean);
      const selected = String(element('academicScoreSemester')?.value || scoreCurrentZxjxjhh || allTerms[0] || '');
      const sharedPriority = selected === '__all__' ? (scoreCurrentZxjxjhh || allTerms[0]) : selected;
      const currentScheduleTerm = scoreCurrentZxjxjhh || allTerms[0];
      if (!sharedPriority || !currentScheduleTerm) throw new Error('没有可查询的学期');
      if (selected === '__all__') {
        renderCachedSharedData();
        setSharedAllLoading(allTerms.some((term) => !loadedSharedTerms.has(term)));
      } else if (!loadedSharedTerms.has(sharedPriority)) {
        renderAcademicScoreStatisticsLoading();
      }

      await ensureScheduleTerms([currentScheduleTerm]);
      renderCachedScheduleData();

      const schedulePriority = String(element('academicScheduleSemester')?.value || currentScheduleTerm);
      if (!loadedScheduleTerms.has(schedulePriority)) {
        await ensureScheduleTerms([schedulePriority]);
        renderCachedScheduleData();
      }

      await ensureSharedTerms([sharedPriority]);
      renderAvailableSharedSemesters();
      renderCachedSharedData();

      await requestSelectionSchedule();
      renderCachedScheduleData();
      await refreshContext();

      const sharedRemaining = selected === '__all__'
        ? allTerms.filter((term) => term !== sharedPriority)
        : [];
      const scheduleRemaining = allTerms.filter((term) => (
        term !== schedulePriority && term !== currentScheduleTerm
      ));
      if (sharedRemaining.length || scheduleRemaining.length) {
        void (async () => {
          try {
            if (sharedRemaining.length) await prefetchSharedTerms(sharedRemaining);
          } finally {
            if (String(element('academicScoreSemester')?.value || '') === '__all__') {
              setSharedAllLoading(false);
              renderCachedSharedData();
            }
          }
          if (scheduleRemaining.length) await prefetchScheduleTerms(scheduleRemaining);
          renderAvailableSharedSemesters();
          renderCachedAcademicData();
        })().catch((error) => setMessage(`其他学期数据读取失败：${error?.message || error}`, false));
      } else {
        setSharedAllLoading(false);
        renderAvailableSharedSemesters();
      }
      return { ok: true };
    } catch (error) {
      sharedAllLoading = false;
      renderAcademicScoreStatistics(filterCachedScoreRows(element('academicScoreSemester')?.value));
      for (const id of ['academicScoreLoading', 'academicExamLoading', 'academicScheduleLoading']) {
        if (element(id)) element(id).style.display = 'none';
      }
      element('academicSystemStatus').style.display = 'block';
      element('academicSystemStatus').textContent = error?.code === 'not-logged-in'
        ? '教务系统未登录，请输入账号密码或通过 MIS 登录'
        : `教务数据读取失败：${error?.message || '未知错误'}`;
      return { ok: false, code: error?.code || '', message: error?.message };
    }
    } finally {
      endAcademicOptionsRequest();
    }
  }

  function bindEvents() {
    element(ACADEMIC_FULLSCREEN_BUTTON_KEY)?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      await chrome.storage.local.set({ [ACADEMIC_FULLSCREEN_BUTTON_KEY]: enabled });
      setMessage(enabled ? '已显示教务系统按钮' : '已隐藏教务系统按钮');
    });
    element('academicOptionsWideEnabled')?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      applyWideOption(enabled);
      await chrome.storage.local.set({ academicOptionsWideEnabled: enabled });
      setMessage(enabled ? '教务系统将在宽屏时占满宽度' : '教务系统将在宽屏时按普通模块宽度显示');
    });
    EXTERNAL_SCRIPTS.forEach((script) => {
      externalScriptElement(script, 'Download')?.addEventListener('click', () => {
        void externalScriptAction(script.id, 'download');
      });
      externalScriptElement(script, 'CheckUpdate')?.addEventListener('click', () => {
        void externalScriptAction(script.id, 'update');
      });
      externalScriptElement(script, 'Delete')?.addEventListener('click', () => {
        void externalScriptAction(script.id, 'delete');
      });
      externalScriptElement(script, 'Enabled')?.addEventListener('change', (event) => {
        void externalScriptAction(script.id, 'enabled', event.currentTarget.checked === true);
      });
    });
    element('academicBbWishListCourses')?.addEventListener('change', () => {
      void saveBbSettings();
    });
    element('academicBbRefreshDelayMs')?.addEventListener('change', () => {
      void saveBbSettings();
    });
    element('academicLoginBtn')?.addEventListener('click', async () => {
      const button = element('academicLoginBtn');
      const studentId = String(element('academicStudentId')?.value || '').trim();
      const password = String(element('academicPassword')?.value || '').trim();
      if (!studentId || !password) return setMessage('请输入用户名（学号）和密码（身份证号后六位）', false);
      button.disabled = true;
      try {
        const result = await send('ACADEMIC_LOGIN_WITH_PASSWORD', { studentId, password });
        if (!result?.ok) throw new Error(result?.message || '登录失败');
        element('academicPassword').value = '';
        invalidateAcademicCaches();
        await refreshContext();
        await loadAll();
        setMessage(`教务系统账号 ${studentId} 登录成功`);
      } catch (error) {
        setMessage(`教务系统登录失败：${String(error?.message || error)}`, false);
      } finally {
        button.disabled = false;
      }
    });
    element('academicPassword')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        element('academicLoginBtn')?.click();
      }
    });
    element('academicStudentId')?.addEventListener('change', (event) => {
      chrome.storage.local.set({ academicSystemStudentId: String(event.currentTarget.value || '').trim() });
    });
    element('academicAccountSelect')?.addEventListener('change', async (event) => {
      const select = event.currentTarget;
      const studentId = String(event.currentTarget.value || '').trim();
      if (!studentId) return;
      select.disabled = true;
      element('academicStudentId').value = studentId;
      setMessage(`正在切换至教务系统账号 ${studentId}…`);
      try {
        const result = await send('ACADEMIC_SWITCH_ACCOUNT', { studentId });
        if (!result?.ok) {
          setMessage(`切换教务系统账号失败：${result?.message || '未知错误'}`, false);
          await refreshContext();
          return;
        }
        invalidateAcademicCaches();
        await refreshContext();
        setMessage(`已切换至教务系统账号 ${studentId}`);
        void loadAll();
      } catch (error) {
        setMessage(`切换教务系统账号失败：${String(error?.message || error)}`, false);
        await refreshContext();
      } finally {
        select.disabled = false;
      }
    });
    element('bindAcademicSystemBtn')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      const result = await send('START_ACADEMIC_MIS_LOGIN');
      if (!result?.ok) {
        event.currentTarget.disabled = false;
        setMessage(`打开 MIS 失败：${result?.message || '未知错误'}`, false);
      } else {
        setMessage('已打开 MIS，请完成教务系统登录');
      }
    });
    for (const [id, key, enabledText, disabledText] of [
      ['academicScoreMonitorEnabled', 'academicScoreMonitorEnabled', '已启用本学期成绩监控', '已关闭本学期成绩监控'],
      ['academicExamMonitorEnabled', 'academicExamMonitorEnabled', '已启用考试信息监控', '已关闭考试信息监控'],
      ['academicClassReminderEnabled', 'academicClassReminderEnabled', '已启用上课前通知', '已关闭上课前通知']
    ]) {
      element(id)?.addEventListener('change', async (event) => {
        await chrome.storage.local.set({ [key]: event.currentTarget.checked });
        updateDisabledState();
        setMessage(event.currentTarget.checked ? enabledText : disabledText);
      });
    }
    element('academicScheduleSemester')?.addEventListener('change', async (event) => {
      const selected = String(event.currentTarget.value || '');
      const current = String(scheduleCache?.currentXnxq || '');
      updateScheduleSemesterToggle(selected);
      scheduleSemesterPreference = selected === current ? '' : selected;
      await chrome.storage.local.set({ academicScheduleSemester: scheduleSemesterPreference });
      const cached = (scheduleCache?.results || []).find((item) => item.xnxq === selected);
      if (cached) applyScheduleView(cached);
      else if (selected) {
        element('academicScheduleLoading').style.display = 'flex';
        element('academicScheduleTableWrap').style.display = 'none';
        element('academicScheduleEmpty').style.display = 'none';
        try {
          await ensureScheduleTerms([selected]);
          renderCachedScheduleData();
        } catch (error) {
          element('academicScheduleLoading').style.display = 'none';
          element('academicScheduleStatus').style.display = 'block';
          element('academicScheduleStatus').textContent = `课表读取失败：${error?.message || error}`;
        }
      }
    });
    element('academicScheduleCurrentSemesterBtn')?.addEventListener('click', () => {
      const select = element('academicScheduleSemester');
      const current = String(scheduleCache?.currentXnxq || '');
      const selection = String(scheduleCache?.selectionSemester?.xnxq || '');
      if (!(select instanceof HTMLSelectElement) || !current || !selection || current === selection) return;
      select.value = select.value === current ? selection : current;
      select.dispatchEvent(new Event('change'));
    });
    element('academicScheduleWeek')?.addEventListener('change', (event) => {
      const selectedWeek = String(event.currentTarget.value || 'all');
      const button = element('academicScheduleCurrentWeekBtn');
      button.textContent = selectedWeek === String(scheduleData?.currentWeek || '') ? '全部' : '本周';
      renderSchedule();
      chrome.storage.local.set({ academicScheduleWeek: selectedWeek }).catch(() => {});
    });
    element('academicScheduleCurrentWeekBtn')?.addEventListener('click', () => {
      const select = element('academicScheduleWeek');
      const currentWeek = Number(scheduleData?.currentWeek || 0);
      select.value = currentWeek > 0 && select.value !== String(currentWeek) ? String(currentWeek) : 'all';
      select.dispatchEvent(new Event('change'));
    });
    element('academicScoreSemester')?.addEventListener('change', async (event) => {
      const selected = String(event.currentTarget.value || '');
      scoreSemesterPreference = selected === scoreCurrentZxjxjhh ? '' : selected;
      const button = element('academicScoreCurrentSemesterBtn');
      if (button instanceof HTMLButtonElement) button.textContent = selected === scoreCurrentZxjxjhh ? '全部' : '本学期';
      const terms = selected === '__all__'
        ? academicSemesterOptions.map((item) => item.zxjxjhh)
        : [selected];
      const needsLoad = terms.some((term) => !loadedSharedTerms.has(String(term || '')));
      if (selected === '__all__') {
        renderCachedSharedData();
        setSharedAllLoading(needsLoad);
      } else if (needsLoad) {
        showSharedLoading();
      } else {
        setSharedAllLoading(false);
      }
      void chrome.storage.local.set({ academicScoreSemester: scoreSemesterPreference }).catch(() => {});
      try {
        if (needsLoad) await prefetchSharedTerms(terms);
        setSharedAllLoading(false);
        renderAvailableSharedSemesters();
        renderCachedSharedData();
      } catch (error) {
        setSharedAllLoading(false);
        renderCachedSharedData();
        setMessage(`所选学期数据读取失败：${error?.message || error}`, false);
      }
    });
    element('academicScoreCurrentSemesterBtn')?.addEventListener('click', () => {
      const select = element('academicScoreSemester');
      if (!(select instanceof HTMLSelectElement)) return;
      select.value = select.value === scoreCurrentZxjxjhh ? '__all__' : scoreCurrentZxjxjhh;
      select.dispatchEvent(new Event('change'));
    });
    bindIntervalEditor('academicScoreMonitorInterval', 'academicScoreMonitorIntervalMinutes',
      DEFAULT_MONITOR_INTERVAL_MINUTES, '教务信息检查间隔');
    bindIntervalEditor('academicClassReminderLead', 'academicClassReminderLeadMinutes',
      DEFAULT_CLASS_REMINDER_LEAD_MINUTES, '上课前通知提前时间');
  }

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'ACADEMIC_DATA_UPDATED') {
        const payload = message.payload || {};
        if (payload.kind === 'score' || payload.kind === 'scores') {
          if (Array.isArray(payload.rows)) {
            const currentLabel = String((scoreSemesterOptions || [])
              .find((item) => item.zxjxjhh === scoreCurrentZxjxjhh)?.label
              || payload.rows[0]?.academicYear
              || '');
            const preserved = currentLabel
              ? (scoresCache?.rows || []).filter((row) => String(row?.academicYear || '').trim() !== currentLabel)
              : (scoresCache?.rows || []);
            scoresCache = {
              rows: [...preserved, ...payload.rows],
              checkedAt: Number(payload.checkedAt || Date.now())
            };
            void persistAcademicDataCache();
          }
          if ([scoreCurrentZxjxjhh, '__all__'].includes(element('academicScoreSemester')?.value)) {
            renderScores(filterCachedScoreRows(element('academicScoreSemester')?.value));
          }
        } else if (payload.kind === 'exam' || payload.kind === 'exams') {
          const current = String(examsCache?.currentZxjxjhh || scoreCurrentZxjxjhh || '');
          if (current && Array.isArray(payload.rows)) {
            const currentLabel = String((academicSemesterOptions || [])
              .find((item) => item.zxjxjhh === current)?.label || '');
            const byTerm = new Map((examsCache?.results || []).map((item) => [item.zxjxjhh, item]));
            byTerm.set(current, {
              ...(byTerm.get(current) || {}),
              label: byTerm.get(current)?.label || currentLabel,
              zxjxjhh: current,
              rows: payload.rows
            });
            examsCache = {
              ...(examsCache || {}),
              currentZxjxjhh: current,
              results: [...byTerm.values()],
              checkedAt: Number(payload.checkedAt || Date.now())
            };
            void persistAcademicDataCache();
          }
          if ([current, '__all__'].includes(element('academicScoreSemester')?.value)) {
            renderExams(filterCachedExamRows(element('academicScoreSemester')?.value));
          }
        }
      } else if (message?.type === 'ACADEMIC_SYSTEM_STATUS') {
        const status = message.payload || {};
        if (status.status === 'mis-login-done') {
          element('bindAcademicSystemBtn').disabled = false;
          invalidateAcademicCaches();
          refreshContext().then(loadAll);
          setMessage(`已通过 MIS 登录教务系统：${status.studentId || ''}${status.userName ? ` ${status.userName}` : ''}`);
        } else if (status.status === 'mis-login-cancelled') {
          element('bindAcademicSystemBtn').disabled = false;
          setMessage('已取消通过 MIS 登录教务系统', false);
        } else {
          if (status.status === 'login-done' || status.status === 'credentials-saved') {
            invalidateAcademicCaches();
          }
          refreshContext();
        }
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const key of ['academicScoreMonitorEnabled', 'academicExamMonitorEnabled', 'academicClassReminderEnabled']) {
        if (changes[key] && element(key)) element(key).checked = changes[key].newValue === true;
      }
      if (changes.academicScoreMonitorIntervalMinutes) {
        setIntervalEditor('academicScoreMonitorInterval', changes.academicScoreMonitorIntervalMinutes.newValue,
          DEFAULT_MONITOR_INTERVAL_MINUTES);
      }
      if (changes.academicClassReminderLeadMinutes) {
        setIntervalEditor('academicClassReminderLead', changes.academicClassReminderLeadMinutes.newValue,
          DEFAULT_CLASS_REMINDER_LEAD_MINUTES);
      }
      if (changes.academicSystemStudentId && element('academicStudentId')) {
        element('academicStudentId').value = String(changes.academicSystemStudentId.newValue || '');
      }
      if (changes.academicOptionsWideEnabled) {
        const enabled = changes.academicOptionsWideEnabled.newValue !== false;
        element('academicOptionsWideEnabled').checked = enabled;
        applyWideOption(enabled);
      }
      if (changes[ACADEMIC_FULLSCREEN_BUTTON_KEY] && element(ACADEMIC_FULLSCREEN_BUTTON_KEY)) {
        element(ACADEMIC_FULLSCREEN_BUTTON_KEY).checked = changes[ACADEMIC_FULLSCREEN_BUTTON_KEY].newValue !== false;
      }
      if (changes.academicScoreMonitorStatus) renderMonitorStatus(changes.academicScoreMonitorStatus.newValue);
      if (changes.academicExamMonitorStatus) renderExamStatus(changes.academicExamMonitorStatus.newValue);
      EXTERNAL_SCRIPTS.forEach((script) => {
        const state = getExternalScriptState(script);
        if (changes[script.storageKey] && !state.busy) {
          state.enabled = state.installed && changes[script.storageKey].newValue === true;
          renderExternalScriptState(script);
        }
      });
      if (changes[BB_WISH_LIST_KEY] || changes[BB_REFRESH_DELAY_KEY]) {
        const wishList = changes[BB_WISH_LIST_KEY]
          ? changes[BB_WISH_LIST_KEY].newValue
          : element('academicBbWishListCourses')?.value;
        const refreshDelay = changes[BB_REFRESH_DELAY_KEY]
          ? changes[BB_REFRESH_DELAY_KEY].newValue
          : element('academicBbRefreshDelayMs')?.value;
        renderBbSettings({ [BB_WISH_LIST_KEY]: wishList, [BB_REFRESH_DELAY_KEY]: refreshDelay });
      }
      updateDisabledState();
    });
  }

  async function autoLoginIfPossible() {
    // 通过 GET 培养方案页探测登录态；确认未登录才用最近登录的保存账号自动登录。
    const status = await send('ACADEMIC_LOGIN_STATUS');
    if (!status?.ok || status.loggedIn) return;
    const candidate = (context?.accounts || []).find((account) => account.hasPassword);
    if (!candidate) return;
    setMessage(`正在使用已保存账号 ${candidate.studentId} 自动登录教务系统…`);
    try {
      const result = await send('ACADEMIC_SWITCH_ACCOUNT', { studentId: candidate.studentId });
      if (!result?.ok) throw new Error(result?.message || '未知错误');
      await refreshContext();
      setMessage(`已使用保存的账号 ${candidate.studentId} 自动登录教务系统`);
    } catch (error) {
      setMessage(`教务系统自动登录失败：${String(error?.message || error)}`, false);
    }
  }

  async function init(options = {}) {
    if (initialized) return true;
    initialized = true;
    setMessage = typeof options.setMessage === 'function' ? options.setMessage : setMessage;
    await chrome.storage.local.remove(['academicScheduleType', 'academicExamSemester']);
    const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
    element(ACADEMIC_FULLSCREEN_BUTTON_KEY).checked = stored[ACADEMIC_FULLSCREEN_BUTTON_KEY] !== false;
    element('academicOptionsWideEnabled').checked = stored.academicOptionsWideEnabled !== false;
    applyWideOption(stored.academicOptionsWideEnabled !== false);
    element('academicScoreMonitorEnabled').checked = stored.academicScoreMonitorEnabled === true;
    element('academicExamMonitorEnabled').checked = stored.academicExamMonitorEnabled === true;
    element('academicClassReminderEnabled').checked = stored.academicClassReminderEnabled === true;
    renderBbSettings(stored);
    scheduleSemesterPreference = String(stored.academicScheduleSemester || '');
    scoreSemesterPreference = String(stored.academicScoreSemester || '');
    setIntervalEditor('academicScoreMonitorInterval', stored.academicScoreMonitorIntervalMinutes,
      DEFAULT_MONITOR_INTERVAL_MINUTES);
    setIntervalEditor('academicClassReminderLead', stored.academicClassReminderLeadMinutes,
      DEFAULT_CLASS_REMINDER_LEAD_MINUTES);
    bindEvents();
    bindMessages();
    updateDisabledState();
    EXTERNAL_SCRIPTS.forEach((script) => { void refreshExternalScriptState(script); });
    await refreshContext();
    void autoLoginIfPossible().finally(async () => {
      await refreshContext();
      const restored = await restoreAcademicDataCache().catch(() => false);
      await loadAll({ preserveRendered: restored });
    });
    return true;
  }

  async function reset() {
    await chrome.storage.local.set(DEFAULTS);
    if (!initialized) return;
    invalidateAcademicCaches();
    element('academicScoreMonitorEnabled').checked = false;
    element(ACADEMIC_FULLSCREEN_BUTTON_KEY).checked = true;
    element('academicOptionsWideEnabled').checked = true;
    applyWideOption(true);
    element('academicExamMonitorEnabled').checked = false;
    element('academicClassReminderEnabled').checked = false;
    renderBbSettings(DEFAULTS);
    element('academicScheduleWeek').value = 'all';
    renderDataSemesterOptions('academicScheduleSemester', 'academicScheduleCurrentSemesterBtn', [], '', '');
    renderScoreSemesterOptions([], '', '');
    scheduleSemesterPreference = '';
    scoreSemesterPreference = '';
    setIntervalEditor('academicScoreMonitorInterval', DEFAULT_MONITOR_INTERVAL_MINUTES,
      DEFAULT_MONITOR_INTERVAL_MINUTES);
    setIntervalEditor('academicClassReminderLead', DEFAULT_CLASS_REMINDER_LEAD_MINUTES,
      DEFAULT_CLASS_REMINDER_LEAD_MINUTES);
    updateDisabledState();
  }

  global.BjtuAcademicOptions = { init, reset, loadAll };
  global.BjtuOptionsModules?.register('academic', global.BjtuAcademicOptions);
})(globalThis);
