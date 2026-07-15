let msgHideTimer = null;
function scheduleMsgHide(msg, delay) {
  if (msgHideTimer) clearTimeout(msgHideTimer);
  msgHideTimer = setTimeout(() => msg.classList.remove('show'), delay);
}

function setMsg(text, ok = true) {
  const msg = document.getElementById('msg');
  msg.textContent = text;
  msg.className = `${ok ? 'ok' : 'err'} show`;
  msg.title = '点击复制通知内容并关闭';
  const delay = ok ? 1800 : 3200;
  msg.onmouseenter = () => {
    if (msgHideTimer) clearTimeout(msgHideTimer);
  };
  msg.onmouseleave = () => scheduleMsgHide(msg, delay);
  if (msg.dataset.copyBound !== '1') {
    msg.dataset.copyBound = '1';
    msg.addEventListener('click', () => {
      const content = String(msg.textContent || '');
      if (content) navigator.clipboard.writeText(content).catch(() => {});
      if (msgHideTimer) clearTimeout(msgHideTimer);
      msg.classList.remove('show');
    });
  }
  scheduleMsgHide(msg, delay);
}

const DEFAULT_PLATFORM_ENABLED = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false };
const DEFAULT_PLATFORM_VISIBLE = { jlgj: true, mooc: true, mrjzy: true, ve: true, ykt: true };

const DEFAULT_OPEN_MODE = 'popup';
const DEFAULT_POPUP_WIDTH_PX = 500;
const DEFAULT_POPUP_HEIGHT_PX = 600;
const MIN_POPUP_WIDTH_PX = 360;
const MAX_POPUP_WIDTH_PX = 800;
const MIN_POPUP_HEIGHT_PX = 420;
const MAX_POPUP_HEIGHT_PX = 600;

const DEFAULT_SAVE_UPLOADS_ENABLED = true;
const DEFAULT_POPUP_CACHE_ENABLED = true;
const DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED = false;
const DEFAULT_PARALLEL_LIMIT = 3;
const DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES = 3;
const DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES = 3;
const DEFAULT_HOMEWORK_REMINDER_ENABLED = true;
const DEFAULT_HOMEWORK_REMINDER_MINUTES = [120];
const DEFAULT_THEME_MODE = 'system';
const DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED = true;
const DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED = false;
const DEFAULT_ACADEMIC_SCORE_MONITOR_INTERVAL_MINUTES = 1;
const DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES = 30;
const DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES = 30;
const DEFAULT_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS = 1;
const MAX_SCHEDULE_INTERVAL_MINUTES = 525600;
const MIN_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS = 0.1;
const MAX_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS = 3600;

function normalizeScheduleIntervalMinutes(value, fallback) {
  const minutes = Math.round(Number(value));
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_SCHEDULE_INTERVAL_MINUTES
    ? minutes
    : fallback;
}

function setScheduleIntervalEditor(prefix, minutes, fallback) {
  const normalized = normalizeScheduleIntervalMinutes(minutes, fallback);
  const valueInput = document.getElementById(`${prefix}Value`);
  const unitSelect = document.getElementById(`${prefix}Unit`);
  if (!(valueInput instanceof HTMLInputElement) || !(unitSelect instanceof HTMLSelectElement)) return;
  const unit = normalized % 1440 === 0 ? 1440 : (normalized % 60 === 0 ? 60 : 1);
  valueInput.value = String(normalized / unit);
  unitSelect.value = String(unit);
}

function readScheduleIntervalEditor(prefix) {
  const value = Number(document.getElementById(`${prefix}Value`)?.value || 0);
  const unit = Number(document.getElementById(`${prefix}Unit`)?.value || 1);
  const minutes = Math.round(value * unit);
  return Number.isFinite(value) && Number.isFinite(unit) && value >= 1
    && minutes >= 1 && minutes <= MAX_SCHEDULE_INTERVAL_MINUTES
    ? minutes
    : NaN;
}

function normalizeHomeworkReminderMinutes(value) {
  const source = Array.isArray(value) ? value : DEFAULT_HOMEWORK_REMINDER_MINUTES;
  return [...new Set(source.map(Number)
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600)
    .map((minutes) => Math.round(minutes)))]
    .sort((a, b) => b - a);
}

function formatHomeworkReminderMinutes(minutes) {
  if (minutes % 1440 === 0) return `提前 ${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `提前 ${minutes / 60} 小时`;
  return `提前 ${minutes} 分钟`;
}

function formatShanghaiDateForFile(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizePlatformEnabled(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const result = {
    jlgj: typeof src.jlgj === 'boolean' ? src.jlgj : DEFAULT_PLATFORM_ENABLED.jlgj,
    mooc: typeof src.mooc === 'boolean' ? src.mooc : DEFAULT_PLATFORM_ENABLED.mooc,
    mrjzy: typeof src.mrjzy === 'boolean' ? src.mrjzy : DEFAULT_PLATFORM_ENABLED.mrjzy,
    ve: typeof src.ve === 'boolean' ? src.ve : DEFAULT_PLATFORM_ENABLED.ve,
    ykt: typeof src.ykt === 'boolean' ? src.ykt : DEFAULT_PLATFORM_ENABLED.ykt
  };
  ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].forEach((id) => {
    if (globalThis.BjtuModuleRegistry && !globalThis.BjtuModuleRegistry.has(id)) result[id] = false;
  });
  return result;
}

function normalizePlatformVisible(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  return Object.fromEntries(Object.keys(DEFAULT_PLATFORM_VISIBLE).map((key) => [
    key,
    typeof src[key] === 'boolean' ? src[key] : DEFAULT_PLATFORM_VISIBLE[key]
  ]));
}

function normalizeScheduleIntervalSeconds(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= MIN_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS && seconds <= MAX_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS
    ? seconds
    : fallback;
}

function setScheduleIntervalSecondsEditor(prefix, seconds, fallback) {
  const normalized = normalizeScheduleIntervalSeconds(seconds, fallback);
  const valueInput = document.getElementById(`${prefix}Value`);
  const unitSelect = document.getElementById(`${prefix}Unit`);
  if (!(valueInput instanceof HTMLInputElement) || !(unitSelect instanceof HTMLSelectElement)) return;
  const unit = normalized % 3600 === 0 ? 3600 : (normalized % 60 === 0 ? 60 : 1);
  valueInput.value = String(normalized / unit);
  unitSelect.value = String(unit);
}

function readScheduleIntervalSecondsEditor(prefix) {
  const value = Number(document.getElementById(`${prefix}Value`)?.value || 0);
  const unit = Number(document.getElementById(`${prefix}Unit`)?.value || 1);
  const seconds = Number((value * unit).toFixed(3));
  return Number.isFinite(value) && Number.isFinite(unit) && value > 0
    && seconds >= MIN_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS && seconds <= MAX_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS
    ? seconds
    : NaN;
}

function normalizePopupDimension(value, fallback, min, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeDetailCollapsedLines(value, fallback = 3) {
  if (value === '' || value === null || value === undefined) return fallback;
  const lines = Number(value);
  return Number.isFinite(lines) && lines >= 0 ? Math.trunc(lines) : fallback;
}

function normalizeParallelLimit(value, fallback = DEFAULT_PARALLEL_LIMIT) {
  const limit = Math.trunc(Number(value));
  return Number.isFinite(limit) && limit > 0 ? limit : fallback;
}

function formatModuleBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${parseFloat((value / (1024 ** index)).toFixed(2))} ${units[index]}`;
}

async function setupInstalledModuleOptions() {
  const list = document.getElementById('installedModuleList');
  const applyButton = document.getElementById('applyInstalledModules');
  const status = document.getElementById('installedModuleStatus');
  if (!(list instanceof HTMLElement) || !(applyButton instanceof HTMLButtonElement)) return;

  const definitions = globalThis.BjtuModuleRegistry?.definitions || {};
  const available = await globalThis.BjtuModuleRegistry.ready;
  const updaterReady = await globalThis.__bjtuUpdaterReady;
  if (updaterReady && globalThis.BjtuUpdaterModuleManager?.prepare) {
    await globalThis.BjtuUpdaterModuleManager.prepare().catch(() => null);
  }
  const installed = new Set(Object.keys(definitions).filter((id) => available[id] === true));
  list.innerHTML = '';
  Object.entries(definitions).forEach(([id, definition]) => {
    const label = document.createElement('label');
    label.className = 'installed-module-item';
    label.dataset.moduleId = id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = installed.has(id);
    checkbox.disabled = installed.has(id) && (id === 've' || id === 'updater');
    label.append(checkbox, document.createTextNode(definition.label || id));
    list.appendChild(label);
  });

  const selectedIds = () => [...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  const hasChanges = () => {
    const selected = new Set(selectedIds());
    return Object.keys(definitions).some((id) => selected.has(id) !== installed.has(id));
  };
  const refreshButton = () => { applyButton.disabled = !hasChanges(); };
  list.addEventListener('click', (event) => {
    const item = event.target instanceof Element
      ? event.target.closest('.installed-module-item')
      : null;
    if (!(item instanceof HTMLElement)
        || !installed.has(item.dataset.moduleId || '')
        || !['ve', 'updater'].includes(item.dataset.moduleId || '')) return;
    event.preventDefault();
    setMsg('不可卸载此模块，但您可前往扩展安装目录手动删除，可能引发异常问题', false);
  });
  list.addEventListener('change', refreshButton);
  refreshButton();
  if (status instanceof HTMLElement) status.textContent = `已安装 ${installed.size} 个模块。取消勾选可卸载，勾选未安装模块可安装。`;

  applyButton.addEventListener('click', async () => {
    if (!hasChanges()) return;
    applyButton.disabled = true;
    list.querySelectorAll('input').forEach((input) => { input.disabled = true; });
    if (status instanceof HTMLElement) status.textContent = '正在准备模块更改…';
    try {
      const manager = updaterReady && globalThis.BjtuUpdaterModuleManager;
      if (!manager?.applyModuleSelection) throw new Error('updater 模块未能加载');
      const result = await manager.applyModuleSelection({
        selected: selectedIds(),
        installed: [...installed],
        onProgress(progress) {
          if (!(status instanceof HTMLElement)) return;
          if (progress.phase === 'download') {
            status.textContent = progress.total > 0
              ? `正在下载模块：${formatModuleBytes(progress.loaded)} / ${formatModuleBytes(progress.total)}`
              : `正在下载模块：${formatModuleBytes(progress.loaded)}`;
          } else if (progress.phase === 'write') {
            status.textContent = `正在安装模块：${progress.completed} / ${progress.total} · ${progress.path || ''}`;
          }
        }
      });
      const changes = [
        result.added.length ? `安装 ${result.added.length} 个` : '',
        result.removed.length ? `卸载 ${result.removed.length} 个` : ''
      ].filter(Boolean).join('，');
      if (status instanceof HTMLElement) status.textContent = `模块更改完成（${changes}），正在重新加载扩展…`;
      setMsg(`模块更改完成：${changes}`);
      setTimeout(() => chrome.runtime.reload(), 1000);
    } catch (error) {
      if (status instanceof HTMLElement) status.textContent = `模块更改失败：${String(error?.message || error)}`;
      setMsg(`模块更改失败：${String(error?.message || error)}`, false);
      list.querySelectorAll('input').forEach((input) => {
        input.disabled = installed.has(input.value) && (input.value === 've' || input.value === 'updater');
      });
      refreshButton();
    }
  });
}

function goBackToApp() {
  // options.html is opened either as a top-level options page, or embedded inside the
  // popup iframe by app.html's ⚙️ button. Detect which one and route accordingly.
  const inPopup = new URLSearchParams(String(location.search || '')).get('popup') === '1';
  if (inPopup) {
    try { window.location.href = 'app.html?popup=1'; return; } catch {}
  }
  const appUrl = chrome.runtime.getURL('app.html');
  // Prefer reusing an existing app.html tab; otherwise navigate this page to app.html.
  try {
    chrome.tabs.query({ url: appUrl }, (tabs) => {
      if (chrome.runtime.lastError) {
        try { window.location.href = appUrl; } catch {}
        return;
      }
      if (Array.isArray(tabs) && tabs.length) {
        const t = tabs[0];
        try {
          chrome.tabs.update(t.id, { active: true }, () => {
            if (chrome.runtime.lastError) {
              try { window.location.href = appUrl; } catch {}
            } else {
              try { window.close(); } catch {}
            }
          });
        } catch {
          try { window.location.href = appUrl; } catch {}
        }
      } else {
        try { window.location.href = appUrl; } catch {}
      }
    });
  } catch {
    try { window.location.href = appUrl; } catch {}
  }
}

const EXTENSION_RUNTIME_STORAGE_KEYS = ['extensionInstalledAt', 'extensionLastReloadedAt'];

function formatExtensionRuntimeTime(value) {
  const timestamp = Number(value);
  if (!(timestamp > 0)) return '尚未记录';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '尚未记录';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function renderExtensionRuntimeInfo() {
  const versionEl = document.getElementById('extension-version');
  const installedEl = document.getElementById('extension-installed-at');
  const reloadedEl = document.getElementById('extension-reloaded-at');
  if (!versionEl || !installedEl || !reloadedEl) return;
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = manifest.version_name || manifest.version || '未知';
  const stored = await chrome.storage.local.get(EXTENSION_RUNTIME_STORAGE_KEYS).catch(() => ({}));
  installedEl.textContent = formatExtensionRuntimeTime(stored.extensionInstalledAt);
  reloadedEl.textContent = formatExtensionRuntimeTime(stored.extensionLastReloadedAt);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && EXTENSION_RUNTIME_STORAGE_KEYS.some((key) => changes[key])) {
    void renderExtensionRuntimeInfo();
  }
});

(async function init() {
  void renderExtensionRuntimeInfo();
  await globalThis.BjtuModuleRegistry?.ready;
  await globalThis.__bjtuVeOptionsReady;
  await setupInstalledModuleOptions();
  const { platformEnabled, platformVisible, injectMoocHelperEnabled, homeworkReminderEnabled, homeworkReminderMinutes, homeworkBackgroundRefreshEnabled, homeworkBackgroundRefreshAccount, homeworkBackgroundRefreshIntervalMinutes, homeworkNewAssignmentNotificationEnabled, homeworkBackgroundRefreshStatus, themeMode, jlgjDarkModeEnabled, jlgjAlwaysDarkModeEnabled, autoLoadAllHomeworkDetails, homeworkDetailCollapsedLines, replayDetailCollapsedLines, parallelLimit, backgroundAutoUpdateEnabled, backgroundAutoInstallOptionalEnabled, backgroundAutoUpdateStatus, academicScoreMonitorIntervalMinutes, backgroundAutoUpdateIntervalMinutes, campusNetworkReconnectEnabled, campusNetworkReconnectAccount, campusNetworkReconnectPassword, campusNetworkReconnectIntervalSeconds, campusNetworkReconnectNotifyOnSuccess, campusNetworkReconnectStatus, username, popupWidthPx, popupHeightPx } = await chrome.storage.local.get([
    'platformEnabled', 'platformVisible', 'injectMoocHelperEnabled', 'homeworkReminderEnabled', 'homeworkReminderMinutes', 'homeworkBackgroundRefreshEnabled', 'homeworkBackgroundRefreshAccount', 'homeworkBackgroundRefreshIntervalMinutes', 'homeworkNewAssignmentNotificationEnabled', 'homeworkBackgroundRefreshStatus', 'themeMode', 'jlgjDarkModeEnabled', 'jlgjAlwaysDarkModeEnabled', 'autoLoadAllHomeworkDetails', 'homeworkDetailCollapsedLines', 'replayDetailCollapsedLines', 'parallelLimit', 'backgroundAutoUpdateEnabled', 'backgroundAutoInstallOptionalEnabled', 'backgroundAutoUpdateStatus', 'academicScoreMonitorIntervalMinutes', 'backgroundAutoUpdateIntervalMinutes', 'campusNetworkReconnectEnabled', 'campusNetworkReconnectAccount', 'campusNetworkReconnectPassword', 'campusNetworkReconnectIntervalSeconds', 'campusNetworkReconnectNotifyOnSuccess', 'campusNetworkReconnectStatus', 'username', 'popupWidthPx', 'popupHeightPx'
  ]);
  try { await chrome.storage.sync.remove(['platformEnabled']); } catch {}
  const { openMode } = await chrome.storage.local.get(['openMode']);
  const { autoLoadCourseResourcesEnabled } = await chrome.storage.local.get(['autoLoadCourseResourcesEnabled']);
  const { saveUploadedFilesEnabled } = await chrome.storage.local.get(['saveUploadedFilesEnabled']);
  const { linkQrEnabled } = await chrome.storage.local.get(['linkQrEnabled']);
  const { popupUseFullscreenCacheEnabled } = await chrome.storage.local.get(['popupUseFullscreenCacheEnabled']);
  const {
    injectPortalLoginOnLoginPage,
    injectPortalLoginOnTimeoutPage
  } = await chrome.storage.local.get([
    'injectPortalLoginOnLoginPage',
    'injectPortalLoginOnTimeoutPage'
  ]);
  const enabled = normalizePlatformEnabled(platformEnabled);
  const visible = normalizePlatformVisible(platformVisible);
  const effectiveEnabled = Object.fromEntries(Object.keys(DEFAULT_PLATFORM_ENABLED).map((key) => [
    key,
    !!enabled[key] && !!visible[key]
  ]));

  document.getElementById('enableVe').checked = !!effectiveEnabled.ve;
  document.getElementById('enableYkt').checked = !!effectiveEnabled.ykt;
  document.getElementById('enableMrjzy').checked = !!effectiveEnabled.mrjzy;
  document.getElementById('enableJlgj').checked = !!effectiveEnabled.jlgj;
  document.getElementById('enableMooc').checked = !!effectiveEnabled.mooc;
  Object.entries(visible).forEach(([key, value]) => {
    const id = 'show' + key.charAt(0).toUpperCase() + key.slice(1);
    document.getElementById(id).checked = !!value;
  });
  if (Object.keys(effectiveEnabled).some((key) => effectiveEnabled[key] !== enabled[key])) {
    await chrome.storage.local.set({ platformEnabled: effectiveEnabled });
  }
  document.getElementById('injectMoocHelperEnabled').checked = injectMoocHelperEnabled !== false;
  document.getElementById('jlgjDarkModeEnabled').checked = jlgjDarkModeEnabled !== false;
  document.getElementById('jlgjAlwaysDarkModeEnabled').checked = jlgjAlwaysDarkModeEnabled === true;
  document.getElementById('autoLoadAllHomeworkDetails').checked = autoLoadAllHomeworkDetails === true;
  document.getElementById('homeworkDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
    homeworkDetailCollapsedLines,
    DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES
  ));
  document.getElementById('replayDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
    replayDetailCollapsedLines,
    DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES
  ));
  document.getElementById('parallelLimit').value = String(normalizeParallelLimit(parallelLimit));
  const autoLoadResourcesVal = autoLoadCourseResourcesEnabled === undefined
    ? DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED
    : !!autoLoadCourseResourcesEnabled;
  document.getElementById('autoLoadCourseResourcesEnabled').checked = autoLoadResourcesVal;
  const mode = String(openMode || DEFAULT_OPEN_MODE);
  document.getElementById('openModePopup').checked = mode === 'popup';
  document.getElementById('openModePage').checked = mode === 'page';
  document.getElementById('popupWidthPx').value = String(normalizePopupDimension(
    popupWidthPx,
    DEFAULT_POPUP_WIDTH_PX,
    MIN_POPUP_WIDTH_PX,
    MAX_POPUP_WIDTH_PX
  ));
  document.getElementById('popupHeightPx').value = String(normalizePopupDimension(
    popupHeightPx,
    DEFAULT_POPUP_HEIGHT_PX,
    MIN_POPUP_HEIGHT_PX,
    MAX_POPUP_HEIGHT_PX
  ));
  const saveUploadsVal = saveUploadedFilesEnabled === undefined
    ? DEFAULT_SAVE_UPLOADS_ENABLED
    : !!saveUploadedFilesEnabled;
  document.getElementById('saveUploadsEnabled').checked = saveUploadsVal;
  document.getElementById('headerQrEnabled').checked = false;
  document.getElementById('headerQrEnabled').disabled = true;
  const linkQrVal = linkQrEnabled === undefined ? true : !!linkQrEnabled;
  document.getElementById('linkQrEnabled').checked = linkQrVal;
  const popupCacheVal = popupUseFullscreenCacheEnabled === undefined
    ? DEFAULT_POPUP_CACHE_ENABLED
    : !!popupUseFullscreenCacheEnabled;
  document.getElementById('popupUseFullscreenCacheEnabled').checked = popupCacheVal;
  document.getElementById('injectPortalLoginOnLoginPage').checked = injectPortalLoginOnLoginPage !== false;
  document.getElementById('injectPortalLoginOnTimeoutPage').checked = injectPortalLoginOnTimeoutPage !== false;
  document.getElementById('homeworkReminderEnabled').checked = homeworkReminderEnabled === undefined
    ? DEFAULT_HOMEWORK_REMINDER_ENABLED
    : !!homeworkReminderEnabled;
  document.getElementById('homeworkBackgroundRefreshEnabled').checked = homeworkBackgroundRefreshEnabled === true;
  document.getElementById('homeworkNewAssignmentNotificationEnabled').checked = homeworkNewAssignmentNotificationEnabled === true;
  document.getElementById('backgroundAutoUpdateEnabled').checked = backgroundAutoUpdateEnabled === undefined
    ? DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED
    : backgroundAutoUpdateEnabled === true;
  document.getElementById('backgroundAutoInstallOptionalEnabled').checked = backgroundAutoInstallOptionalEnabled === true;
  setScheduleIntervalEditor('academicScoreMonitorInterval', academicScoreMonitorIntervalMinutes, DEFAULT_ACADEMIC_SCORE_MONITOR_INTERVAL_MINUTES);
  setScheduleIntervalEditor('backgroundAutoUpdateInterval', backgroundAutoUpdateIntervalMinutes, DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES);
  setScheduleIntervalEditor('homeworkBackgroundRefreshInterval', homeworkBackgroundRefreshIntervalMinutes, DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES);
  document.getElementById('campusNetworkReconnectEnabled').checked = campusNetworkReconnectEnabled === true;
  document.getElementById('campusNetworkReconnectAccount').value = String(campusNetworkReconnectAccount || username || '');
  document.getElementById('campusNetworkReconnectPassword').value = String(campusNetworkReconnectPassword || '');
  document.getElementById('campusNetworkReconnectNotifyOnSuccess').checked = campusNetworkReconnectNotifyOnSuccess !== false;
  setScheduleIntervalSecondsEditor('campusNetworkReconnectInterval', campusNetworkReconnectIntervalSeconds, DEFAULT_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS);
  updateThemeModeUi(themeMode);
  let currentHomeworkReminderMinutes = normalizeHomeworkReminderMinutes(homeworkReminderMinutes);
  let currentHomeworkBackgroundRefreshAccount = String(homeworkBackgroundRefreshAccount || '').trim();
  let academicContext = await chrome.runtime.sendMessage({ type: 'ACADEMIC_GET_CONTEXT' }).catch(() => null);
  let portalLoginContext = await chrome.runtime.sendMessage({ type: 'PORTAL_LOGIN_CONTEXT' }).catch(() => null);
  const academicStudentIdInput = document.getElementById('academicStudentId');
  const academicPasswordInput = document.getElementById('academicPassword');
  const academicMonitorInput = document.getElementById('academicScoreMonitorEnabled');
  const academicStatus = document.getElementById('academicSystemStatus');
  const academicAccountSelect = document.getElementById('academicAccountSelect');
  const academicScoreLoading = document.getElementById('academicScoreLoading');
  const academicScoreEmpty = document.getElementById('academicScoreEmpty');
  const academicScoreTableWrap = document.getElementById('academicScoreTableWrap');
  const academicScoreTableBody = document.getElementById('academicScoreTableBody');
  const academicScoreCount = document.getElementById('academicScoreCount');
  const backgroundAutoUpdateStatusEl = document.getElementById('backgroundAutoUpdateStatus');
  const campusNetworkReconnectInput = document.getElementById('campusNetworkReconnectEnabled');
  const campusNetworkReconnectStatusEl = document.getElementById('campusNetworkReconnectStatus');
  const homeworkBackgroundRefreshInput = document.getElementById('homeworkBackgroundRefreshEnabled');
  const homeworkBackgroundRefreshAccountSelect = document.getElementById('homeworkBackgroundRefreshAccount');
  const homeworkNewAssignmentNotificationInput = document.getElementById('homeworkNewAssignmentNotificationEnabled');
  const homeworkBackgroundRefreshStatusEl = document.getElementById('homeworkBackgroundRefreshStatus');

  const renderBackgroundAutoUpdateStatus = (status) => {
    if (!(backgroundAutoUpdateStatusEl instanceof HTMLElement)) return;
    const enabled = !!document.getElementById('backgroundAutoUpdateEnabled')?.checked;
    if (!enabled) {
      backgroundAutoUpdateStatusEl.textContent = '后台自动更新未启用。';
      return;
    }
    const state = String(status?.status || 'waiting');
    const versionName = String(status?.name || status?.version || status?.ver || '').trim();
    const messages = {
      checking: '正在后台检查更新…',
      latest: `已是最新版本${versionName ? `：${versionName}` : ''}。`,
      'directory-required': `检测到${versionName ? ` ${versionName}` : '新版本'}，请先在全屏页面手动更新一次并授权扩展安装目录。`,
      'optional-update-available': `检测到非强制更新${versionName ? `：${versionName}` : ''}，已按设置保留为手动更新。`,
      downloading: `正在后台下载${versionName ? ` ${versionName}` : '更新'}…`,
      installing: `正在后台覆盖更新文件${status?.total ? `：${Number(status.completed || 0)} / ${Number(status.total)}` : ''}。`,
      reloading: '更新已写入，正在自动重新加载扩展…',
      'reload-pending': `更新文件已写入${versionName ? `（${versionName}）` : ''}，正在等待扩展重新加载。`,
      'reload-cooldown': `本地版本仍未更新${versionName ? `（目标 ${versionName}）` : ''}，将在下一轮后台检查时重新覆盖。`,
      complete: `后台更新已完成${versionName ? `：${versionName}` : ''}${status?.reloaded ? '，扩展已自动重新加载' : ''}。`,
      error: `后台自动更新失败：${String(status?.error || '未知错误')}`
    };
    backgroundAutoUpdateStatusEl.textContent = messages[state] || '等待下一次后台更新检查。';
  };
  renderBackgroundAutoUpdateStatus(backgroundAutoUpdateStatus);

  const renderCampusNetworkReconnectStatus = (status) => {
    if (!(campusNetworkReconnectStatusEl instanceof HTMLElement)) return;
    if (!(campusNetworkReconnectInput instanceof HTMLInputElement) || !campusNetworkReconnectInput.checked) {
      campusNetworkReconnectStatusEl.textContent = '校园网自动重连未启用。';
      return;
    }
    const message = String(status?.message || '').trim();
    const state = String(status?.status || 'waiting');
    const labels = {
      waiting: '等待下一次校园网认证请求。',
      success: '最近一次请求：已重新连接校园网。',
      online: '最近一次请求：当前 IP 已经在线。',
      retrying: '校园网认证服务暂不可用，正在重试。',
      'missing-credentials': '请先填写校园网账号和密码。',
      'network-error': '校园网认证请求失败。',
      'parse-error': '校园网认证响应解析失败。',
      failed: '校园网认证失败。'
    };
    campusNetworkReconnectStatusEl.textContent = message
      ? `${labels[state] || '最近一次校园网认证请求已完成。'} ${message}`
      : (labels[state] || '等待下一次校园网认证请求。');
  };
  renderCampusNetworkReconnectStatus(campusNetworkReconnectStatus);

  const updateBackgroundAutoInstallOptionalDisabled = () => {
    const parentEnabled = !!document.getElementById('backgroundAutoUpdateEnabled')?.checked;
    const child = document.getElementById('backgroundAutoInstallOptionalEnabled');
    if (child instanceof HTMLInputElement) {
      child.disabled = !parentEnabled;
      child.closest('label')?.classList.toggle('is-disabled', !parentEnabled);
    }
    const editor = document.getElementById('backgroundAutoUpdateIntervalEditor');
    editor?.classList.toggle('is-disabled', !parentEnabled);
    editor?.querySelectorAll('input,select').forEach((control) => { control.disabled = !parentEnabled; });
  };
  const updateAcademicMonitorIntervalDisabled = () => {
    const enabled = academicMonitorInput instanceof HTMLInputElement && academicMonitorInput.checked;
    const editor = document.getElementById('academicScoreMonitorIntervalEditor');
    editor?.classList.toggle('is-disabled', !enabled);
    editor?.querySelectorAll('input,select').forEach((control) => { control.disabled = !enabled; });
  };
  const updateHomeworkBackgroundRefreshDisabled = () => {
    const enabled = homeworkBackgroundRefreshInput instanceof HTMLInputElement && homeworkBackgroundRefreshInput.checked;
    const detail = document.getElementById('homeworkBackgroundRefreshDetail');
    detail?.classList.toggle('is-disabled', !enabled);
    detail?.querySelectorAll('input,select').forEach((control) => { control.disabled = !enabled; });
  };
  const updateCampusNetworkReconnectDisabled = () => {
    const enabled = campusNetworkReconnectInput instanceof HTMLInputElement && campusNetworkReconnectInput.checked;
    const detail = document.getElementById('campusNetworkReconnectDetail');
    detail?.classList.toggle('is-disabled', !enabled);
    detail?.querySelectorAll('input,select').forEach((control) => { control.disabled = !enabled; });
  };
  const renderHomeworkBackgroundRefreshStatus = (status) => {
    if (!(homeworkBackgroundRefreshStatusEl instanceof HTMLElement)) return;
    if (!(homeworkBackgroundRefreshInput instanceof HTMLInputElement) || !homeworkBackgroundRefreshInput.checked) {
      homeworkBackgroundRefreshStatusEl.textContent = '后台作业获取未启用。';
      return;
    }
    const state = String(status?.status || 'waiting');
    const messages = {
      loading: `正在后台登录 ${String(status?.account || '')} 并获取作业…`,
      complete: `最近刷新完成：${Number(status?.courseCount || 0)} 门课程，${Number(status?.homeworkCount || 0)} 项未交作业。`,
      'foreground-open': '已打开全屏页面，本轮不执行后台获取。',
      error: `最近刷新失败：${String(status?.error || '未知错误')}`
    };
    homeworkBackgroundRefreshStatusEl.textContent = messages[state] || '等待下一次后台作业获取。';
  };
  updateBackgroundAutoInstallOptionalDisabled();
  updateCampusNetworkReconnectDisabled();

  const renderHomeworkBackgroundAccounts = (context) => {
    if (!(homeworkBackgroundRefreshAccountSelect instanceof HTMLSelectElement)) return;
    const history = Array.isArray(context?.history) ? context.history : [];
    const selected = String(currentHomeworkBackgroundRefreshAccount || homeworkBackgroundRefreshAccountSelect.value || '').trim();
    homeworkBackgroundRefreshAccountSelect.replaceChildren();
    if (!history.length) {
      homeworkBackgroundRefreshAccountSelect.append(new Option('暂无已登录账号', ''));
      return;
    }
    history.forEach((account) => {
      const loginName = String(account?.loginName || account?.userId || '').trim();
      if (!loginName) return;
      const userName = String(account?.userName || '').trim();
      const roleName = String(account?.roleName || '').trim();
      homeworkBackgroundRefreshAccountSelect.append(new Option(
        [loginName, roleName, userName].filter(Boolean).join(' '),
        loginName
      ));
    });
    if (history.some((account) => String(account?.loginName || account?.userId || '').trim() === selected)) {
      homeworkBackgroundRefreshAccountSelect.value = selected;
    } else {
      homeworkBackgroundRefreshAccountSelect.value = String(homeworkBackgroundRefreshAccountSelect.options[0]?.value || '');
    }
  };
  renderHomeworkBackgroundAccounts(portalLoginContext);
  updateHomeworkBackgroundRefreshDisabled();
  renderHomeworkBackgroundRefreshStatus(homeworkBackgroundRefreshStatus);

  const renderAcademicAccounts = (context) => {
    if (!(academicAccountSelect instanceof HTMLSelectElement)) return;
    const accounts = Array.isArray(context?.accounts) ? context.accounts : [];
    const selected = String(context?.studentId || '').trim();
    academicAccountSelect.replaceChildren();
    if (!accounts.length) {
      academicAccountSelect.append(new Option('暂无已保存账号', ''));
    } else {
      for (const account of accounts) {
        const isCurrent = account.studentId === selected;
        const userName = String(account.userName || '').trim();
        const option = new Option(`${account.studentId}${userName ? ` ${userName}` : ''}`, account.studentId);
        option.disabled = !account.hasPassword && !isCurrent;
        academicAccountSelect.append(option);
      }
      academicAccountSelect.value = accounts.some((account) => account.studentId === selected)
        ? selected
        : String(accounts[0]?.studentId || '');
    }
  };

  const renderAcademicMonitorStatus = (status) => {
    if (!(academicStatus instanceof HTMLElement) || !status) return;
    if (status.status === 'error') {
      academicStatus.textContent = `最近检查失败：${status.error || '未知错误'}`;
      return;
    }
    if (status.status === 'ok') {
      const checkedAt = Number(status.checkedAt || 0);
      const time = checkedAt ? new Date(checkedAt).toLocaleString() : '';
      academicStatus.textContent = `最近检查${time ? `（${time}）` : ''}：读取 ${Number(status.count || 0)} 项成绩。`;
      return;
    }

  };

  const renderAcademicScores = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (academicScoreLoading instanceof HTMLElement) academicScoreLoading.style.display = 'none';
    if (academicScoreCount instanceof HTMLElement) academicScoreCount.textContent = `共 ${list.length} 项`;
    if (academicScoreTableBody instanceof HTMLElement) academicScoreTableBody.replaceChildren();
    if (!list.length) {
      if (academicScoreEmpty instanceof HTMLElement) academicScoreEmpty.style.display = '';
      if (academicScoreTableWrap instanceof HTMLElement) academicScoreTableWrap.style.display = 'none';
      return;
    }
    if (academicScoreEmpty instanceof HTMLElement) academicScoreEmpty.style.display = 'none';
    if (academicScoreTableWrap instanceof HTMLElement) academicScoreTableWrap.style.display = '';
    for (const row of list) {
      const tr = document.createElement('tr');
      [row.sequence, row.academicYear, row.course, row.credit, row.score, row.bonusScore, row.teacher].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = String(value || '-');
        tr.appendChild(td);
      });
      const detailCell = document.createElement('td');
      if (String(row.details || '').trim()) {
        const details = document.createElement('details');
        details.className = 'academic-score-details';
        const summary = document.createElement('summary');
        summary.textContent = '查看';
        const content = document.createElement('div');
        content.textContent = String(row.details || '');
        details.append(summary, content);
        detailCell.appendChild(details);
      } else {
        detailCell.textContent = '-';
      }
      tr.appendChild(detailCell);
      academicScoreTableBody?.appendChild(tr);
    }
  };

  const refreshAcademicContext = async () => {
    const context = await chrome.runtime.sendMessage({ type: 'ACADEMIC_GET_CONTEXT' }).catch(() => null);
    if (context?.ok) academicContext = context;
    if (academicStudentIdInput instanceof HTMLInputElement && document.activeElement !== academicStudentIdInput) {
      academicStudentIdInput.value = String(academicContext?.studentId || '').trim();
    }
    if (academicMonitorInput instanceof HTMLInputElement) academicMonitorInput.checked = academicContext?.monitorEnabled === true;
    updateAcademicMonitorIntervalDisabled();
    renderAcademicAccounts(academicContext);
    renderAcademicMonitorStatus(academicContext?.monitorStatus);
    return academicContext;
  };

  const loadAcademicScores = async () => {
    if (academicScoreLoading instanceof HTMLElement) academicScoreLoading.style.display = 'flex';
    if (academicScoreEmpty instanceof HTMLElement) academicScoreEmpty.style.display = 'none';
    if (academicScoreTableWrap instanceof HTMLElement) academicScoreTableWrap.style.display = 'none';
    if (academicScoreCount instanceof HTMLElement) academicScoreCount.textContent = '';
    if (academicStatus instanceof HTMLElement) academicStatus.textContent = '正在检查教务系统登录状态并读取成绩…';
    const result = await chrome.runtime.sendMessage({ type: 'ACADEMIC_LOAD_SCORES' }).catch((error) => ({
      ok: false, message: String(error?.message || error)
    }));
    if (!result?.ok) {
      if (academicScoreLoading instanceof HTMLElement) academicScoreLoading.style.display = 'none';
      if (academicScoreEmpty instanceof HTMLElement) {
        academicScoreEmpty.style.display = '';
        academicScoreEmpty.textContent = result?.code === 'not-logged-in' ? '教务系统未登录' : '成绩读取失败';
      }
      if (academicStatus instanceof HTMLElement) {
        academicStatus.textContent = result?.code === 'not-logged-in'
          ? '教务系统未登录，请输入账号密码或通过 MIS 登录后重试。'
          : `成绩读取失败：${result?.message || '未知错误'}`;
      }
      return result;
    }
    renderAcademicScores(result.rows);
    if (academicStatus instanceof HTMLElement) academicStatus.textContent = `已读取 ${Number(result.count || 0)} 项成绩。`;
    await refreshAcademicContext();
    return result;
  };

  if (academicStudentIdInput instanceof HTMLInputElement) academicStudentIdInput.value = String(academicContext?.studentId || '').trim();
  if (academicMonitorInput instanceof HTMLInputElement) academicMonitorInput.checked = academicContext?.monitorEnabled === true;
  updateAcademicMonitorIntervalDisabled();
  renderAcademicAccounts(academicContext);
  renderAcademicMonitorStatus(academicContext?.monitorStatus);

  const updateHomeworkReminderDisabled = () => {
    const disabled = !document.getElementById('homeworkReminderEnabled').checked;
    const editor = document.getElementById('homeworkReminderEditor');
    editor.classList.toggle('is-disabled', disabled);
    editor.querySelectorAll('input,select,button').forEach((control) => { control.disabled = disabled; });
  };
  const renderHomeworkReminderNodes = () => {
    const list = document.getElementById('homeworkReminderNodeList');
    list.innerHTML = currentHomeworkReminderMinutes.map((minutes) => `
      <span class="reminder-node">${formatHomeworkReminderMinutes(minutes)}<button type="button" data-remove-reminder-minutes="${minutes}" title="删除" aria-label="删除 ${formatHomeworkReminderMinutes(minutes)}">×</button></span>
    `).join('');
  };
  const persistHomeworkReminderSettings = async () => {
    await chrome.storage.local.set({
      homeworkReminderEnabled: !!document.getElementById('homeworkReminderEnabled').checked,
      homeworkReminderMinutes: currentHomeworkReminderMinutes
    });
    setMsg('已应用更改');
  };
  renderHomeworkReminderNodes();
  updateHomeworkReminderDisabled();
  updatePopupCacheDisabled();

  // apply changes immediately when inputs change
  const applyPlatform = async () => {
    const pe = {
      ve: !!document.getElementById('showVe').checked && !!document.getElementById('enableVe').checked,
      ykt: !!document.getElementById('showYkt').checked && !!document.getElementById('enableYkt').checked,
      mrjzy: !!document.getElementById('showMrjzy').checked && !!document.getElementById('enableMrjzy').checked,
      jlgj: !!document.getElementById('showJlgj').checked && !!document.getElementById('enableJlgj').checked,
      mooc: !!document.getElementById('showMooc').checked && !!document.getElementById('enableMooc').checked
    };
    await chrome.storage.local.set({ platformEnabled: pe });
    await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
    setMsg('已应用更改');
  };

  function updateThemeModeUi(value) {
    const mode = globalThis.BjtuTheme?.normalizeMode(value) || DEFAULT_THEME_MODE;
    const container = document.getElementById('themeMode');
    const btns = container.querySelectorAll('.theme-mode-btn');
    btns.forEach((btn) => {
      const isActive = btn.dataset.value === mode;
      btn.classList.toggle('theme-mode-btn--active', isActive);
      btn.classList.remove('theme-mode-btn--system-active');
    });
    if (mode === 'system') {
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
      const systemValue = prefersDark ? 'dark' : 'light';
      const systemBtn = container.querySelector(`.theme-mode-btn[data-value="${systemValue}"]`);
      if (systemBtn) systemBtn.classList.add('theme-mode-btn--system-active');
    }
  }

  const updatePlatformDetailDisabled = () => {
    const visibleState = {};
    ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].forEach((key) => {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const shown = !!document.getElementById(`show${cap}`).checked;
      visibleState[key] = shown;
      const enableInput = document.getElementById(`enable${cap}`);
      if (!shown) enableInput.checked = false;
      enableInput.disabled = !shown;
      enableInput.closest('label')?.classList.toggle('is-disabled', !shown);
    });
    ['autoLoadCourseResourcesEnabled', 'linkQrEnabled'].forEach((id) => {
      const input = document.getElementById(id);
      input.disabled = !visibleState.ve;
      input.closest('label')?.classList.toggle('is-disabled', !visibleState.ve);
    });
    [['autoLoadAllHomeworkDetails', 'ykt']].forEach(([id, platform]) => {
      const input = document.getElementById(id);
      input.disabled = !visibleState[platform];
      input.closest('label')?.classList.toggle('is-disabled', !visibleState[platform]);
    });
    const jlgjDark = document.getElementById('jlgjDarkModeEnabled');
    const alwaysDark = document.getElementById('jlgjAlwaysDarkModeEnabled');
    const extensionDark = document.documentElement.dataset.colorScheme === 'dark';
    jlgjDark.disabled = !extensionDark;
    jlgjDark.closest('label')?.classList.toggle('is-disabled', jlgjDark.disabled);
    alwaysDark.disabled = jlgjDark.disabled || !jlgjDark.checked;
    alwaysDark.closest('label')?.classList.toggle('is-disabled', alwaysDark.disabled);
  };

  const enforceJlgjDarkThemeAvailability = async () => { updatePlatformDetailDisabled(); };

  const applyPlatformVisible = async () => {
    const value = {};
    const enabledValue = {};
    ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc'].forEach((key) => {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const shown = !!document.getElementById(`show${cap}`).checked;
      const enableInput = document.getElementById(`enable${cap}`);
      value[key] = shown;
      if (!shown) enableInput.checked = false;
      enabledValue[key] = shown && !!enableInput.checked;
    });
    await chrome.storage.local.set({ platformVisible: value, platformEnabled: enabledValue });
    await chrome.storage.sync.remove(['platformEnabled']).catch(() => {});
    updatePlatformDetailDisabled();
    setMsg('已应用更改');
  };
  void enforceJlgjDarkThemeAvailability();
  window.addEventListener('bjtu-theme-change', () => { void enforceJlgjDarkThemeAvailability(); });

  const applyOpenMode = async () => {
    const v = document.getElementById('openModePage').checked ? 'page' : 'popup';
    await chrome.storage.local.set({ openMode: v });
    updatePopupCacheDisabled();
    setMsg('已应用更改');
  };
  const applyPopupSize = async () => {
    const widthInput = document.getElementById('popupWidthPx');
    const heightInput = document.getElementById('popupHeightPx');
    const width = normalizePopupDimension(widthInput?.value, DEFAULT_POPUP_WIDTH_PX, MIN_POPUP_WIDTH_PX, MAX_POPUP_WIDTH_PX);
    const height = normalizePopupDimension(heightInput?.value, DEFAULT_POPUP_HEIGHT_PX, MIN_POPUP_HEIGHT_PX, MAX_POPUP_HEIGHT_PX);
    if (widthInput instanceof HTMLInputElement) widthInput.value = String(width);
    if (heightInput instanceof HTMLInputElement) heightInput.value = String(height);
    await chrome.storage.local.set({ popupWidthPx: width, popupHeightPx: height });
    setMsg('已应用更改');
  };

  function updatePopupCacheDisabled() {
    const disabled = document.getElementById('openModePage').checked;
    const container = document.getElementById('popupCacheContainer');
    const checkbox = document.getElementById('popupUseFullscreenCacheEnabled');
    container.classList.toggle('is-disabled', disabled);
    checkbox.disabled = disabled;
  }

  function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el instanceof HTMLInputElement) el.checked = !!checked;
  }

  function applyPlatformUi(raw) {
    const enabled = normalizePlatformEnabled(raw);
    setChecked('enableVe', enabled.ve);
    setChecked('enableYkt', enabled.ykt);
    setChecked('enableMrjzy', enabled.mrjzy);
    setChecked('enableJlgj', enabled.jlgj);
    setChecked('enableMooc', enabled.mooc);
  }

  function applyPlatformVisibleUi(raw) {
    const visible = normalizePlatformVisible(raw);
    Object.entries(visible).forEach(([key, value]) => {
      setChecked('show' + key.charAt(0).toUpperCase() + key.slice(1), value);
    });
    updatePlatformDetailDisabled();
  }

  function applyOpenModeUi(raw) {
    const mode = String(raw || DEFAULT_OPEN_MODE);
    setChecked('openModePopup', mode !== 'page');
    setChecked('openModePage', mode === 'page');
    updatePopupCacheDisabled();
  }

  function applyPopupSizeUi(widthRaw, heightRaw) {
    const widthInput = document.getElementById('popupWidthPx');
    const heightInput = document.getElementById('popupHeightPx');
    if (widthInput instanceof HTMLInputElement && widthRaw !== undefined) {
      widthInput.value = String(normalizePopupDimension(widthRaw, DEFAULT_POPUP_WIDTH_PX, MIN_POPUP_WIDTH_PX, MAX_POPUP_WIDTH_PX));
    }
    if (heightInput instanceof HTMLInputElement && heightRaw !== undefined) {
      heightInput.value = String(normalizePopupDimension(heightRaw, DEFAULT_POPUP_HEIGHT_PX, MIN_POPUP_HEIGHT_PX, MAX_POPUP_HEIGHT_PX));
    }
  }

  function applyBooleanUi(id, raw, fallback = true) {
    setChecked(id, raw === undefined ? fallback : !!raw);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.platformEnabled) applyPlatformUi(changes.platformEnabled.newValue);
      if (changes.platformVisible) applyPlatformVisibleUi(changes.platformVisible.newValue);
      if (changes.injectMoocHelperEnabled) applyBooleanUi('injectMoocHelperEnabled', changes.injectMoocHelperEnabled.newValue, true);
      if (changes.jlgjDarkModeEnabled) {
        applyBooleanUi('jlgjDarkModeEnabled', changes.jlgjDarkModeEnabled.newValue, true);
        void enforceJlgjDarkThemeAvailability();
      }
      if (changes.jlgjAlwaysDarkModeEnabled) {
        applyBooleanUi('jlgjAlwaysDarkModeEnabled', changes.jlgjAlwaysDarkModeEnabled.newValue, false);
        void enforceJlgjDarkThemeAvailability();
      }
      if (changes.autoLoadAllHomeworkDetails) applyBooleanUi('autoLoadAllHomeworkDetails', changes.autoLoadAllHomeworkDetails.newValue, false);
      if (changes.homeworkDetailCollapsedLines) {
        document.getElementById('homeworkDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
          changes.homeworkDetailCollapsedLines.newValue,
          DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES
        ));
      }
      if (changes.replayDetailCollapsedLines) {
        document.getElementById('replayDetailCollapsedLines').value = String(normalizeDetailCollapsedLines(
          changes.replayDetailCollapsedLines.newValue,
          DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES
        ));
      }
      if (changes.parallelLimit) {
        document.getElementById('parallelLimit').value = String(normalizeParallelLimit(changes.parallelLimit.newValue));
      }
      if (changes.openMode) applyOpenModeUi(changes.openMode.newValue);
      if (changes.popupWidthPx || changes.popupHeightPx) {
        applyPopupSizeUi(changes.popupWidthPx?.newValue, changes.popupHeightPx?.newValue);
      }
      if (changes.themeMode) {
        updateThemeModeUi(changes.themeMode.newValue);
        setTimeout(() => { void enforceJlgjDarkThemeAvailability(); }, 0);
      }
      if (changes.autoLoadCourseResourcesEnabled) applyBooleanUi('autoLoadCourseResourcesEnabled', changes.autoLoadCourseResourcesEnabled.newValue, DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED);
      if (changes.saveUploadedFilesEnabled) applyBooleanUi('saveUploadsEnabled', changes.saveUploadedFilesEnabled.newValue, DEFAULT_SAVE_UPLOADS_ENABLED);
      if (changes.linkQrEnabled) applyBooleanUi('linkQrEnabled', changes.linkQrEnabled.newValue, true);
      if (changes.popupUseFullscreenCacheEnabled) {
        applyBooleanUi('popupUseFullscreenCacheEnabled', changes.popupUseFullscreenCacheEnabled.newValue, DEFAULT_POPUP_CACHE_ENABLED);
      }
      if (changes.homeworkReminderEnabled) {
        applyBooleanUi('homeworkReminderEnabled', changes.homeworkReminderEnabled.newValue, DEFAULT_HOMEWORK_REMINDER_ENABLED);
        updateHomeworkReminderDisabled();
      }
      if (changes.homeworkReminderMinutes) {
        currentHomeworkReminderMinutes = normalizeHomeworkReminderMinutes(changes.homeworkReminderMinutes.newValue);
        renderHomeworkReminderNodes();
      }
      if (changes.homeworkBackgroundRefreshEnabled) {
        applyBooleanUi('homeworkBackgroundRefreshEnabled', changes.homeworkBackgroundRefreshEnabled.newValue, false);
        updateHomeworkBackgroundRefreshDisabled();
        renderHomeworkBackgroundRefreshStatus(changes.homeworkBackgroundRefreshStatus?.newValue || null);
      }
      if (changes.homeworkBackgroundRefreshIntervalMinutes) {
        setScheduleIntervalEditor('homeworkBackgroundRefreshInterval', changes.homeworkBackgroundRefreshIntervalMinutes.newValue, DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES);
      }
      if (changes.homeworkNewAssignmentNotificationEnabled) {
        applyBooleanUi('homeworkNewAssignmentNotificationEnabled', changes.homeworkNewAssignmentNotificationEnabled.newValue, false);
      }
      if (changes.homeworkBackgroundRefreshAccount && homeworkBackgroundRefreshAccountSelect instanceof HTMLSelectElement) {
        currentHomeworkBackgroundRefreshAccount = String(changes.homeworkBackgroundRefreshAccount.newValue || '').trim();
        homeworkBackgroundRefreshAccountSelect.value = currentHomeworkBackgroundRefreshAccount;
      }
      if (changes.homeworkBackgroundRefreshStatus) {
        renderHomeworkBackgroundRefreshStatus(changes.homeworkBackgroundRefreshStatus.newValue);
      }
      if (changes.loginAccountHistory) {
        chrome.runtime.sendMessage({ type: 'PORTAL_LOGIN_CONTEXT' }).then((context) => {
          if (context?.ok) portalLoginContext = context;
          renderHomeworkBackgroundAccounts(portalLoginContext);
        }).catch(() => {});
      }
      if (changes.injectPortalLoginOnLoginPage) {
        applyBooleanUi('injectPortalLoginOnLoginPage', changes.injectPortalLoginOnLoginPage.newValue, true);
      }
      if (changes.injectPortalLoginOnTimeoutPage) {
        applyBooleanUi('injectPortalLoginOnTimeoutPage', changes.injectPortalLoginOnTimeoutPage.newValue, true);
      }
      if (changes.academicScoreMonitorEnabled) {
        applyBooleanUi('academicScoreMonitorEnabled', changes.academicScoreMonitorEnabled.newValue, false);
        updateAcademicMonitorIntervalDisabled();
      }
      if (changes.academicScoreMonitorIntervalMinutes) {
        setScheduleIntervalEditor('academicScoreMonitorInterval', changes.academicScoreMonitorIntervalMinutes.newValue, DEFAULT_ACADEMIC_SCORE_MONITOR_INTERVAL_MINUTES);
      }
      if (changes.academicSystemStudentId && academicStudentIdInput instanceof HTMLInputElement) {
        academicStudentIdInput.value = String(changes.academicSystemStudentId.newValue || '').trim();
      }
      if (changes.username && academicStudentIdInput instanceof HTMLInputElement && document.activeElement !== academicStudentIdInput) {
        academicStudentIdInput.value = String(changes.username.newValue || '').trim();
      }
      if (changes.academicScoreMonitorStatus) renderAcademicMonitorStatus(changes.academicScoreMonitorStatus.newValue);
      if (changes.backgroundAutoUpdateEnabled) {
        applyBooleanUi('backgroundAutoUpdateEnabled', changes.backgroundAutoUpdateEnabled.newValue, DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED);
        updateBackgroundAutoInstallOptionalDisabled();
        renderBackgroundAutoUpdateStatus(changes.backgroundAutoUpdateStatus?.newValue || null);
      }
      if (changes.backgroundAutoInstallOptionalEnabled) {
        applyBooleanUi('backgroundAutoInstallOptionalEnabled', changes.backgroundAutoInstallOptionalEnabled.newValue, DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED);
      }
      if (changes.backgroundAutoUpdateIntervalMinutes) {
        setScheduleIntervalEditor('backgroundAutoUpdateInterval', changes.backgroundAutoUpdateIntervalMinutes.newValue, DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES);
      }
      if (changes.backgroundAutoUpdateStatus) renderBackgroundAutoUpdateStatus(changes.backgroundAutoUpdateStatus.newValue);
      if (changes.campusNetworkReconnectEnabled) {
        applyBooleanUi('campusNetworkReconnectEnabled', changes.campusNetworkReconnectEnabled.newValue, false);
        updateCampusNetworkReconnectDisabled();
        renderCampusNetworkReconnectStatus(changes.campusNetworkReconnectStatus?.newValue || null);
      }
      if (changes.campusNetworkReconnectAccount) {
        const input = document.getElementById('campusNetworkReconnectAccount');
        if (input instanceof HTMLInputElement && document.activeElement !== input) input.value = String(changes.campusNetworkReconnectAccount.newValue || '');
      }
      if (changes.username) {
        const accountInput = document.getElementById('campusNetworkReconnectAccount');
        if (accountInput instanceof HTMLInputElement && document.activeElement !== accountInput && !String(accountInput.value || '').trim()) {
          accountInput.value = String(changes.username.newValue || '').trim();
        }
      }
      if (changes.campusNetworkReconnectPassword) {
        const input = document.getElementById('campusNetworkReconnectPassword');
        if (input instanceof HTMLInputElement && document.activeElement !== input) input.value = String(changes.campusNetworkReconnectPassword.newValue || '');
      }
      if (changes.campusNetworkReconnectIntervalSeconds) {
        setScheduleIntervalSecondsEditor('campusNetworkReconnectInterval', changes.campusNetworkReconnectIntervalSeconds.newValue, DEFAULT_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS);
      }
      if (changes.campusNetworkReconnectNotifyOnSuccess) {
        applyBooleanUi('campusNetworkReconnectNotifyOnSuccess', changes.campusNetworkReconnectNotifyOnSuccess.newValue, true);
      }
      if (changes.campusNetworkReconnectStatus) renderCampusNetworkReconnectStatus(changes.campusNetworkReconnectStatus.newValue);
    });
  } catch {
    // ignore non-extension contexts
  }

  document.getElementById('enableVe').addEventListener('change', applyPlatform);
  document.getElementById('enableYkt').addEventListener('change', applyPlatform);
  document.getElementById('enableMrjzy').addEventListener('change', applyPlatform);
  document.getElementById('enableJlgj').addEventListener('change', applyPlatform);
  document.getElementById('enableMooc').addEventListener('change', applyPlatform);
  ['showVe', 'showYkt', 'showMrjzy', 'showJlgj', 'showMooc'].forEach((id) => {
    document.getElementById(id).addEventListener('change', applyPlatformVisible);
  });
  document.getElementById('injectMoocHelperEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({ injectMoocHelperEnabled: !!document.getElementById('injectMoocHelperEnabled').checked });
    setMsg('已应用更改');
  });
  ['jlgjDarkModeEnabled', 'jlgjAlwaysDarkModeEnabled', 'autoLoadAllHomeworkDetails'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      await chrome.storage.local.set({ [id]: !!document.getElementById(id).checked });
      setMsg('已应用更改');
      if (id === 'jlgjDarkModeEnabled') updatePlatformDetailDisabled();
    });
  });
  document.getElementById('openModePopup').addEventListener('change', applyOpenMode);
  document.getElementById('openModePage').addEventListener('change', applyOpenMode);
  document.getElementById('popupWidthPx').addEventListener('change', applyPopupSize);
  document.getElementById('popupHeightPx').addEventListener('change', applyPopupSize);
  document.getElementById('themeMode').addEventListener('click', async (e) => {
    const btn = e.target.closest('.theme-mode-btn');
    if (!btn) return;
    const value = btn.dataset.value;
    await chrome.storage.local.set({ themeMode: globalThis.BjtuTheme?.normalizeMode(value) || DEFAULT_THEME_MODE });
    updateThemeModeUi(value);
    setMsg('已应用更改');
  });

  const themeModeContainer = document.getElementById('themeMode');
  const systemMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSystemThemeChange = () => {
    const activeBtn = themeModeContainer?.querySelector('.theme-mode-btn--active');
    if (activeBtn?.dataset.value === 'system') {
      themeModeContainer.querySelectorAll('.theme-mode-btn--system-active').forEach((btn) => btn.classList.remove('theme-mode-btn--system-active'));
      const systemValue = systemMedia?.matches ? 'dark' : 'light';
      const systemBtn = themeModeContainer?.querySelector(`.theme-mode-btn[data-value="${systemValue}"]`);
      if (systemBtn) systemBtn.classList.add('theme-mode-btn--system-active');
    }
  };
  if (typeof systemMedia?.addEventListener === 'function') systemMedia.addEventListener('change', onSystemThemeChange);

  document.getElementById('autoLoadCourseResourcesEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      autoLoadCourseResourcesEnabled: !!document.getElementById('autoLoadCourseResourcesEnabled').checked
    });
    setMsg('已应用更改');
  });

  ['injectPortalLoginOnLoginPage', 'injectPortalLoginOnTimeoutPage'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      await chrome.storage.local.set({ [id]: !!document.getElementById(id).checked });
      setMsg('已应用更改');
    });
  });

  document.getElementById('saveUploadsEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      saveUploadedFilesEnabled: !!document.getElementById('saveUploadsEnabled').checked
    });
    setMsg('已应用更改');
  });

  (() => {
    const cb = document.getElementById('headerQrEnabled');
    const label = cb?.closest('label');
    if (label) {
      label.addEventListener('click', (e) => {
        e.preventDefault();
        cb.checked = false;
        setMsg('此功能所需条件已被智慧课程平台禁用', false);
      });
    }
  })();

  document.getElementById('linkQrEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      linkQrEnabled: !!document.getElementById('linkQrEnabled').checked
    });
    setMsg('已应用更改');
  });

  document.getElementById('popupUseFullscreenCacheEnabled').addEventListener('change', async () => {
    await chrome.storage.local.set({
      popupUseFullscreenCacheEnabled: !!document.getElementById('popupUseFullscreenCacheEnabled').checked
    });
    setMsg('已应用更改');
  });

  document.getElementById('homeworkReminderEnabled').addEventListener('change', async () => {
    updateHomeworkReminderDisabled();
    await persistHomeworkReminderSettings();
  });

  const academicLoginBtn = document.getElementById('academicLoginBtn');
  const bindAcademicSystemBtn = document.getElementById('bindAcademicSystemBtn');
  const submitAcademicLogin = async () => {
    const studentId = String(academicStudentIdInput?.value || '').trim();
    const password = String(academicPasswordInput?.value || '').trim();
    if (!studentId) { setMsg('请输入学号', false); return; }
    if (!password) { setMsg('请输入身份证号后六位', false); return; }
    if (password.length !== 6) { setMsg('身份证号后六位必须为 6 个字符', false); return; }
    academicLoginBtn.disabled = true;
    setMsg('正在登录教务系统…');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ACADEMIC_LOGIN_WITH_PASSWORD', payload: { studentId, password } });
      if (!result?.ok) throw new Error(result?.message || '教务系统登录失败');
      academicPasswordInput.value = '';
      await refreshAcademicContext();
      await loadAcademicScores();
      setMsg('教务系统登录成功');
    } catch (error) {
      setMsg('教务系统登录失败：' + String(error?.message || error), false);
    } finally {
      academicLoginBtn.disabled = false;
    }
  };
  academicLoginBtn?.addEventListener('click', submitAcademicLogin);
  academicAccountSelect?.addEventListener('change', async () => {
    const studentId = String(academicAccountSelect.value || '').trim();
    if (!studentId) return;
    academicAccountSelect.disabled = true;
    if (academicStudentIdInput instanceof HTMLInputElement) academicStudentIdInput.value = studentId;
    setMsg(`正在切换至教务系统账号 ${studentId}…`);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'ACADEMIC_SWITCH_ACCOUNT', payload: { studentId } });
      if (!result?.ok) throw new Error(result?.message || '账号切换失败');
      await loadAcademicScores();
      setMsg(`已切换至教务系统账号 ${studentId}`);
    } catch (error) {
      setMsg(`切换教务系统账号失败：${String(error?.message || error)}`, false);
      await refreshAcademicContext();
    } finally {
      academicAccountSelect.disabled = false;
    }
  });
  academicPasswordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void submitAcademicLogin(); }
  });
  academicStudentIdInput?.addEventListener('change', async () => {
    await chrome.storage.local.set({ academicSystemStudentId: String(academicStudentIdInput.value || '').trim() });
  });
  bindAcademicSystemBtn?.addEventListener('click', async () => {
    bindAcademicSystemBtn.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'START_ACADEMIC_MIS_LOGIN' });
      if (!response?.ok) throw new Error(response?.message || '无法打开 MIS');
      setMsg('已打开 MIS，请完成教务系统登录');
    } catch (error) {
      bindAcademicSystemBtn.disabled = false;
      setMsg('打开 MIS 失败：' + String(error?.message || error), false);
    }
  });
  academicMonitorInput?.addEventListener('change', async () => {
    await chrome.storage.local.set({ academicScoreMonitorEnabled: !!academicMonitorInput.checked });
    updateAcademicMonitorIntervalDisabled();
    setMsg(academicMonitorInput.checked ? '已启用本学期成绩监控' : '已关闭本学期成绩监控');
  });
  document.getElementById('backgroundAutoUpdateEnabled')?.addEventListener('change', async (event) => {
    const enabled = !!event.currentTarget.checked;
    await chrome.storage.local.set({ backgroundAutoUpdateEnabled: enabled });
    updateBackgroundAutoInstallOptionalDisabled();
    renderBackgroundAutoUpdateStatus(enabled ? { status: 'checking' } : null);
    setMsg(enabled ? '已启用后台自动更新' : '已关闭后台自动更新');
  });
  document.getElementById('backgroundAutoInstallOptionalEnabled')?.addEventListener('change', async (event) => {
    const enabled = !!event.currentTarget.checked;
    await chrome.storage.local.set({ backgroundAutoInstallOptionalEnabled: enabled });
    setMsg(enabled ? '已启用非强制更新自动安装' : '已关闭非强制更新自动安装');
  });
  ['homeworkDetailCollapsedLines', 'replayDetailCollapsedLines'].forEach((id) => {
    document.getElementById(id).addEventListener('change', async () => {
      const input = document.getElementById(id);
      const fallback = id === 'homeworkDetailCollapsedLines'
        ? DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES
        : DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES;
      const value = normalizeDetailCollapsedLines(input.value, fallback);
      input.value = String(value);
      await chrome.storage.local.set({ [id]: value });
      setMsg('已应用更改');
    });
  });
  document.getElementById('parallelLimit').addEventListener('change', async (event) => {
    const value = normalizeParallelLimit(event.currentTarget.value);
    event.currentTarget.value = String(value);
    await chrome.storage.local.set({ parallelLimit: value });
    setMsg('已应用更改');
  });
  campusNetworkReconnectInput?.addEventListener('change', async () => {
    const enabled = campusNetworkReconnectInput.checked;
    await chrome.storage.local.set({ campusNetworkReconnectEnabled: enabled });
    updateCampusNetworkReconnectDisabled();
    renderCampusNetworkReconnectStatus(enabled ? { status: 'waiting' } : null);
    setMsg(enabled ? '已启用校园网自动重连' : '已关闭校园网自动重连');
  });
  document.getElementById('campusNetworkReconnectAccount')?.addEventListener('change', async (event) => {
    await chrome.storage.local.set({ campusNetworkReconnectAccount: String(event.currentTarget.value || '').trim() });
    setMsg('已保存校园网上网账号');
  });
  document.getElementById('campusNetworkReconnectPassword')?.addEventListener('change', async (event) => {
    await chrome.storage.local.set({ campusNetworkReconnectPassword: String(event.currentTarget.value || '') });
    setMsg('已保存校园网密码');
  });
  document.getElementById('campusNetworkReconnectNotifyOnSuccess')?.addEventListener('change', async (event) => {
    const enabled = !!event.currentTarget.checked;
    await chrome.storage.local.set({ campusNetworkReconnectNotifyOnSuccess: enabled });
    setMsg(enabled ? '已启用校园网重连成功通知' : '已关闭校园网重连成功通知');
  });
  const bindScheduleIntervalSetting = (prefix, key, fallback, label) => {
    const save = async () => {
      const minutes = readScheduleIntervalEditor(prefix);
      if (!Number.isFinite(minutes)) {
        setMsg(`${label}必须在 1 分钟到 365 天之间`, false);
        const stored = await chrome.storage.local.get([key]);
        setScheduleIntervalEditor(prefix, stored?.[key], fallback);
        return;
      }
      await chrome.storage.local.set({ [key]: minutes });
      setScheduleIntervalEditor(prefix, minutes, fallback);
      setMsg(`已将${label}设为 ${minutes} 分钟`);
    };
    document.getElementById(`${prefix}Value`)?.addEventListener('change', save);
    document.getElementById(`${prefix}Unit`)?.addEventListener('change', save);
  };
  bindScheduleIntervalSetting('academicScoreMonitorInterval', 'academicScoreMonitorIntervalMinutes', DEFAULT_ACADEMIC_SCORE_MONITOR_INTERVAL_MINUTES, '成绩检查间隔');
  bindScheduleIntervalSetting('backgroundAutoUpdateInterval', 'backgroundAutoUpdateIntervalMinutes', DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES, '更新检查间隔');
  bindScheduleIntervalSetting('homeworkBackgroundRefreshInterval', 'homeworkBackgroundRefreshIntervalMinutes', DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES, '后台作业刷新间隔');
  const bindScheduleIntervalSecondsSetting = (prefix, key, fallback, label) => {
    const save = async () => {
      const seconds = readScheduleIntervalSecondsEditor(prefix);
      if (!Number.isFinite(seconds)) {
        setMsg(`${label}必须在 0.1 秒到 1 小时之间`, false);
        const stored = await chrome.storage.local.get([key]);
        setScheduleIntervalSecondsEditor(prefix, stored?.[key], fallback);
        return;
      }
      await chrome.storage.local.set({ [key]: seconds });
      setScheduleIntervalSecondsEditor(prefix, seconds, fallback);
      setMsg(`已将${label}设为 ${seconds} 秒`);
    };
    document.getElementById(`${prefix}Value`)?.addEventListener('change', save);
    document.getElementById(`${prefix}Unit`)?.addEventListener('change', save);
  };
  bindScheduleIntervalSecondsSetting('campusNetworkReconnectInterval', 'campusNetworkReconnectIntervalSeconds', DEFAULT_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS, '校园网请求间隔');
  homeworkBackgroundRefreshInput?.addEventListener('change', async () => {
    const enabled = homeworkBackgroundRefreshInput.checked;
    const account = String(homeworkBackgroundRefreshAccountSelect?.value || '').trim();
    if (enabled && !account) {
      homeworkBackgroundRefreshInput.checked = false;
      updateHomeworkBackgroundRefreshDisabled();
      setMsg('请先登录至少一个智慧课程平台账号', false);
      return;
    }
    await chrome.storage.local.set({
      homeworkBackgroundRefreshEnabled: enabled,
      ...(enabled ? { homeworkBackgroundRefreshAccount: account } : {})
    });
    updateHomeworkBackgroundRefreshDisabled();
    setMsg(enabled ? '已启用后台作业获取' : '已关闭后台作业获取');
  });
  homeworkBackgroundRefreshAccountSelect?.addEventListener('change', async () => {
    currentHomeworkBackgroundRefreshAccount = String(homeworkBackgroundRefreshAccountSelect.value || '').trim();
    await chrome.storage.local.set({ homeworkBackgroundRefreshAccount: currentHomeworkBackgroundRefreshAccount });
    setMsg('已更改后台维护账号');
  });
  homeworkNewAssignmentNotificationInput?.addEventListener('change', async () => {
    await chrome.storage.local.set({ homeworkNewAssignmentNotificationEnabled: homeworkNewAssignmentNotificationInput.checked });
    setMsg(homeworkNewAssignmentNotificationInput.checked ? '已启用新增作业通知' : '已关闭新增作业通知');
  });
  document.getElementById('addHomeworkReminderNode').addEventListener('click', async () => {
    const value = Number(document.getElementById('homeworkReminderValue').value || 0);
    const unit = Number(document.getElementById('homeworkReminderUnit').value || 1);
    const minutes = Math.round(value * unit);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) {
      setMsg('提醒时间必须在 1 分钟到 365 天之间', false);
      return;
    }
    currentHomeworkReminderMinutes = normalizeHomeworkReminderMinutes([...currentHomeworkReminderMinutes, minutes]);
    renderHomeworkReminderNodes();
    await persistHomeworkReminderSettings();
  });
  document.getElementById('homeworkReminderNodeList').addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-remove-reminder-minutes]') : null;
    if (!(button instanceof HTMLElement)) return;
    const minutes = Number(button.dataset.removeReminderMinutes || 0);
    currentHomeworkReminderMinutes = currentHomeworkReminderMinutes.filter((item) => item !== minutes);
    renderHomeworkReminderNodes();
    await persistHomeworkReminderSettings();
  });

  // "BJTU 上传助手" link: navigate to app.html
  const backHome = document.getElementById('back-home');
  if (backHome) {
    const go = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      goBackToApp();
    };
    backHome.addEventListener('click', go);
    backHome.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') go(e);
    });
  }

  const bindBtn = document.getElementById('bindPortalUsernameBtn');
  if (bindBtn) {
    bindBtn.addEventListener('click', async () => {
      bindBtn.disabled = true;
      const bindUrl = 'http://123.121.147.7:88/oauth/api/user/thirdLogin';
      try {
        const { username } = await chrome.storage.local.get(['username']);
        const resp = await chrome.runtime.sendMessage({
          type: 'START_BIND_PORTAL_USERNAME',
          payload: { loginName: String(username || '').trim() }
        });
        if (!resp?.ok) {
          await chrome.tabs.create({ url: bindUrl, active: true });
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
          return;
        }
        setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
      } catch (e) {
        try {
          await chrome.tabs.create({ url: bindUrl, active: true });
          setMsg('已打开 MIS 绑定页面，请在新标签页完成登录');
        } catch (err) {
          setMsg(String(err?.message || e?.message || e || '无法打开 MIS 绑定页面'), false);
          bindBtn.disabled = false;
        }
      }
    });
  }

  document.getElementById('exportBindDataBtn').addEventListener('click', async () => {
    const button = document.getElementById('exportBindDataBtn');
    const progressModal = document.getElementById('account-init-modal');
    const progressTitle = progressModal?.querySelector('.account-progress-title');
    const progressStatus = document.getElementById('account-init-status');
    const teacherRow = document.getElementById('account-init-teacher-label')?.closest('.account-init-progress-row');
    const studentRow = document.getElementById('account-init-student-label')?.closest('.account-init-progress-row');
    const teacherLabel = document.getElementById('account-init-teacher-label');
    const teacherBar = document.getElementById('account-init-teacher-progress-bar');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    if (progressTitle instanceof HTMLElement) progressTitle.textContent = '导出 MIS 绑定数据';
    if (progressStatus instanceof HTMLElement) progressStatus.textContent = '正在读取绑定账号…';
    if (teacherLabel instanceof HTMLElement) teacherLabel.textContent = '已读取 0 / 17';
    if (teacherBar instanceof HTMLElement) teacherBar.style.width = '0%';
    if (teacherRow instanceof HTMLElement) teacherRow.style.display = '';
    if (studentRow instanceof HTMLElement) studentRow.style.display = 'none';
    if (progressModal instanceof HTMLElement) progressModal.style.display = 'flex';
    try {
      const withQuick = await globalThis.BjtuAccountStore.getQuickAccounts({
        limit: 17,
        onProgress: ({ read, done }) => {
          if (teacherLabel instanceof HTMLElement) {
            teacherLabel.textContent = done && read < 17 ? `已读取 ${read} 个` : `已读取 ${read} / 17`;
          }
          if (teacherBar instanceof HTMLElement) {
            teacherBar.style.width = `${done ? 100 : Math.min(100, (Number(read || 0) / 17) * 100)}%`;
          }
        }
      });
      if (!withQuick.length) {
        setMsg('没有找到已绑定 MIS 的账号', false);
        return;
      }
      if (withQuick.length > 16) {
        setMsg('绑定的账号很多！请点击「导出账号列表」按钮', false);
        return;
      }
      const lines = [];
      for (const acc of withQuick) {
        const loginName = String(acc.loginName || acc.userId || '').trim();
        const quickUsername = String(acc.quickUsername || '').trim();
        if (!loginName || !quickUsername) continue;
        try {
          lines.push(`${loginName}:${atob(quickUsername)}`);
        } catch { /* skip invalid base64 */ }
      }
      if (!lines.length) {
        setMsg('没有找到有效的绑定数据', false);
        return;
      }
      await navigator.clipboard.writeText(lines.join('\n'));
      setMsg('已复制到剪贴板');
    } catch (error) {
      setMsg('复制到剪贴板失败：' + String(error?.message || error), false);
    } finally {
      if (progressModal instanceof HTMLElement) progressModal.style.display = 'none';
      if (studentRow instanceof HTMLElement) studentRow.style.display = '';
      if (teacherBar instanceof HTMLElement) teacherBar.style.width = '0%';
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'ACADEMIC_SYSTEM_STATUS') {
      const status = message.payload || {};
      if (status.status === 'mis-login-done') {
        if (bindAcademicSystemBtn) bindAcademicSystemBtn.disabled = false;
        void refreshAcademicContext().then(() => loadAcademicScores());
        setMsg(`已通过 MIS 登录教务系统：${status.studentId || ''}${status.userName ? ` ${status.userName}` : ''}`);
      } else if (status.status === 'mis-login-cancelled') {
        if (bindAcademicSystemBtn) bindAcademicSystemBtn.disabled = false;
        setMsg('已取消通过 MIS 登录教务系统', false);
      } else if (status.status === 'credentials-saved') {
        void refreshAcademicContext();
      }
      return;
    }
    if (message?.type !== 'PORTAL_USERNAME_BIND_STATUS') return;
    const st = message.payload || {};
    if (st.status === 'done') {
      setMsg(`已绑定快速登录 username：${st.userId || st.quickUsername || ''}`);
      if (bindBtn) bindBtn.disabled = false;
    } else if (st.status === 'detected') {
      setMsg('已检测到新 username，正在匹配账号信息');
    } else if (st.status === 'error') {
      setMsg(`绑定失败：${st.error || '无法匹配账号信息'}`, false);
      if (bindBtn) bindBtn.disabled = false;
    }
  });

  const importAccountListBtn = document.getElementById('importAccountListBtn');
  const importAccountListFile = document.getElementById('importAccountListFile');
  const setAccountProgressTitle = (title) => {
    const el = document.querySelector('#account-init-modal .account-progress-title');
    if (el instanceof HTMLElement) el.textContent = String(title || '账号列表');
  };
  importAccountListBtn?.addEventListener('click', () => {
    importAccountListFile.value = '';
    importAccountListFile.click();
  });
  importAccountListFile?.addEventListener('change', async () => {
    const file = importAccountListFile.files?.[0];
    if (!file) return;
    importAccountListBtn.disabled = true;
    try {
      setAccountProgressTitle('导入登录账号列表');
      const count = await globalThis.BjtuAccountLogin.importAccountFile(await file.text(), { showProgress: true });
      setMsg('已导入 ' + count + ' 个账号');
    } catch (error) {
      setMsg('导入失败：' + String(error?.message || error), false);
    } finally {
      const progressModal = document.getElementById('account-init-modal');
      if (progressModal) progressModal.style.display = 'none';
      importAccountListBtn.disabled = false;
    }
  });
  const exportAccountListBtn = document.getElementById('exportAccountListBtn');
  exportAccountListBtn?.addEventListener('click', async () => {
    exportAccountListBtn.disabled = true;
    setAccountProgressTitle('导出登录账号列表');
    try {
      const payload = await globalThis.BjtuAccountLogin.exportAccountFile({ showProgress: true });
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bjtu-account-list-' + formatShanghaiDateForFile() + '.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg('已导出教职工 ' + Number(payload.summary?.teacher || 0)
        + ' 个、学生 ' + Number(payload.summary?.student || 0) + ' 个');
    } catch (error) {
      setMsg('导出失败：' + String(error?.message || error), false);
    } finally {
      const progressModal = document.getElementById('account-init-modal');
      if (progressModal) progressModal.style.display = 'none';
      exportAccountListBtn.disabled = false;
    }
  });

  // Reset: restore defaults. Platform display/load should only check VE.
  const restoreDefaultSettings = async () => {
    const defaultPlatform = { jlgj: false, mooc: false, mrjzy: false, ve: true, ykt: false };
    await chrome.storage.local.set({
      platformEnabled: defaultPlatform,
      platformVisible: { ...DEFAULT_PLATFORM_VISIBLE },
      injectMoocHelperEnabled: true,
      jlgjDarkModeEnabled: true,
      jlgjAlwaysDarkModeEnabled: false,
      autoLoadAllHomeworkDetails: false,
      homeworkDetailCollapsedLines: DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES,
      replayDetailCollapsedLines: DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES,
      parallelLimit: DEFAULT_PARALLEL_LIMIT,
      homeworkReminderEnabled: DEFAULT_HOMEWORK_REMINDER_ENABLED,
      homeworkReminderMinutes: DEFAULT_HOMEWORK_REMINDER_MINUTES,
      homeworkBackgroundRefreshEnabled: false,
      homeworkBackgroundRefreshAccount: '',
      homeworkBackgroundRefreshIntervalMinutes: DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES,
      homeworkNewAssignmentNotificationEnabled: false,
      academicScoreMonitorEnabled: false,
      academicScoreMonitorIntervalMinutes: DEFAULT_ACADEMIC_SCORE_MONITOR_INTERVAL_MINUTES,
      campusNetworkReconnectEnabled: false,
      campusNetworkReconnectIntervalSeconds: DEFAULT_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS,
      campusNetworkReconnectNotifyOnSuccess: true,
      backgroundAutoUpdateEnabled: DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED,
      backgroundAutoInstallOptionalEnabled: DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED,
      backgroundAutoUpdateIntervalMinutes: DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES,
      popupWidthPx: DEFAULT_POPUP_WIDTH_PX,
      popupHeightPx: DEFAULT_POPUP_HEIGHT_PX,
      themeMode: DEFAULT_THEME_MODE
    });
    await chrome.storage.sync.remove(['platformEnabled']);
    document.getElementById('enableVe').checked = true;
    document.getElementById('enableYkt').checked = false;
    document.getElementById('enableMrjzy').checked = false;
    document.getElementById('enableJlgj').checked = false;
    document.getElementById('enableMooc').checked = false;
    ['showVe', 'showYkt', 'showMrjzy', 'showJlgj', 'showMooc'].forEach((id) => {
      document.getElementById(id).checked = true;
    });
    document.getElementById('injectMoocHelperEnabled').checked = true;
    document.getElementById('jlgjDarkModeEnabled').checked = true;
    document.getElementById('jlgjAlwaysDarkModeEnabled').checked = false;
    document.getElementById('autoLoadAllHomeworkDetails').checked = false;
    document.getElementById('homeworkDetailCollapsedLines').value = String(DEFAULT_HOMEWORK_DETAIL_COLLAPSED_LINES);
    document.getElementById('replayDetailCollapsedLines').value = String(DEFAULT_REPLAY_DETAIL_COLLAPSED_LINES);
    document.getElementById('parallelLimit').value = String(DEFAULT_PARALLEL_LIMIT);
    document.getElementById('homeworkReminderEnabled').checked = DEFAULT_HOMEWORK_REMINDER_ENABLED;
    document.getElementById('homeworkBackgroundRefreshEnabled').checked = false;
    document.getElementById('homeworkNewAssignmentNotificationEnabled').checked = false;
    setScheduleIntervalEditor('homeworkBackgroundRefreshInterval', DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES, DEFAULT_HOMEWORK_BACKGROUND_REFRESH_INTERVAL_MINUTES);
    currentHomeworkBackgroundRefreshAccount = '';
    renderHomeworkBackgroundAccounts(portalLoginContext);
    updateHomeworkBackgroundRefreshDisabled();
    document.getElementById('academicScoreMonitorEnabled').checked = false;
    document.getElementById('campusNetworkReconnectEnabled').checked = false;
    document.getElementById('campusNetworkReconnectNotifyOnSuccess').checked = true;
    setScheduleIntervalSecondsEditor('campusNetworkReconnectInterval', DEFAULT_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS, DEFAULT_CAMPUS_NETWORK_RECONNECT_INTERVAL_SECONDS);
    updateCampusNetworkReconnectDisabled();
    renderCampusNetworkReconnectStatus(null);
    document.getElementById('backgroundAutoUpdateEnabled').checked = DEFAULT_BACKGROUND_AUTO_UPDATE_ENABLED;
    document.getElementById('backgroundAutoInstallOptionalEnabled').checked = DEFAULT_BACKGROUND_AUTO_INSTALL_OPTIONAL_ENABLED;
    setScheduleIntervalEditor('academicScoreMonitorInterval', DEFAULT_ACADEMIC_SCORE_MONITOR_INTERVAL_MINUTES, DEFAULT_ACADEMIC_SCORE_MONITOR_INTERVAL_MINUTES);
    setScheduleIntervalEditor('backgroundAutoUpdateInterval', DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES, DEFAULT_BACKGROUND_AUTO_UPDATE_INTERVAL_MINUTES);
    updateAcademicMonitorIntervalDisabled();
    updateBackgroundAutoInstallOptionalDisabled();
    renderBackgroundAutoUpdateStatus(null);
    updateThemeModeUi(DEFAULT_THEME_MODE);
    currentHomeworkReminderMinutes = [...DEFAULT_HOMEWORK_REMINDER_MINUTES];
    renderHomeworkReminderNodes();
    updateHomeworkReminderDisabled();
    updatePlatformDetailDisabled();
    document.getElementById('autoLoadCourseResourcesEnabled').checked = DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED;
    document.getElementById('openModePopup').checked = true;
    document.getElementById('openModePage').checked = false;
    document.getElementById('popupWidthPx').value = String(DEFAULT_POPUP_WIDTH_PX);
    document.getElementById('popupHeightPx').value = String(DEFAULT_POPUP_HEIGHT_PX);
    document.getElementById('saveUploadsEnabled').checked = true;
    document.getElementById('headerQrEnabled').checked = false;
    document.getElementById('headerQrEnabled').disabled = true;
    document.getElementById('linkQrEnabled').checked = true;
    document.getElementById('popupUseFullscreenCacheEnabled').checked = true;
    document.getElementById('injectPortalLoginOnLoginPage').checked = true;
    document.getElementById('injectPortalLoginOnTimeoutPage').checked = true;
    updatePopupCacheDisabled();
    await chrome.storage.local.set({ openMode: DEFAULT_OPEN_MODE });
    await chrome.storage.local.set({ autoLoadCourseResourcesEnabled: DEFAULT_AUTO_LOAD_COURSE_RESOURCES_ENABLED });
    await chrome.storage.local.set({ saveUploadedFilesEnabled: DEFAULT_SAVE_UPLOADS_ENABLED });
    await chrome.storage.local.set({ linkQrEnabled: true });
    await chrome.storage.local.set({ popupUseFullscreenCacheEnabled: DEFAULT_POPUP_CACHE_ENABLED });
    await chrome.storage.local.set({
      injectPortalLoginOnLoginPage: true,
      injectPortalLoginOnTimeoutPage: true
    });
    setMsg('已恢复默认配置');
  };

  const resetConfirmModal = document.getElementById('reset-confirm-modal');
  const closeResetConfirmModal = () => {
    if (resetConfirmModal instanceof HTMLElement) resetConfirmModal.style.display = 'none';
  };
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!(resetConfirmModal instanceof HTMLElement)) return;
    resetConfirmModal.style.display = 'flex';
    document.getElementById('reset-confirm-submit')?.focus();
  });
  document.getElementById('reset-confirm-close')?.addEventListener('click', closeResetConfirmModal);
  document.getElementById('reset-confirm-cancel')?.addEventListener('click', closeResetConfirmModal);
  document.getElementById('reset-confirm-submit')?.addEventListener('click', async () => {
    closeResetConfirmModal();
    await restoreDefaultSettings();
  });
  resetConfirmModal?.addEventListener('click', (event) => {
    if (event.target === resetConfirmModal) closeResetConfirmModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && resetConfirmModal?.style.display === 'flex') closeResetConfirmModal();
  });
  document.documentElement.classList.remove('options-loading');
  void loadAcademicScores();
})();
