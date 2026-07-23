(function () {
  'use strict';

  const ENABLED_KEY = 'homeworkBackgroundRefreshEnabled';
  const ACCOUNT_KEY = 'homeworkBackgroundRefreshAccount';
  const INTERVAL_KEY = 'homeworkBackgroundRefreshIntervalMinutes';
  const NEW_HOMEWORK_NOTIFY_KEY = 'homeworkNewAssignmentNotificationEnabled';
  const STATUS_KEY = 'homeworkBackgroundRefreshStatus';
  const KNOWN_ASSIGNMENTS_KEY = 'homeworkBackgroundKnownAssignments';
  const CACHE_KEY = 'popupFullscreenCourseCache';
  const SNAPSHOT_KEY = 'homeworkReminderSnapshot';
  const XQ_CODE_KEY = 'selectedXqCode';
  const ALARM_NAME = 'bjtu-homework-background-refresh';
  const DEFAULT_INTERVAL_MINUTES = 30;
  const APP_URL = chrome.runtime.getURL('app.html');
  const NOTIFICATION_PREFIX = 'bjtu-homework-reminder:new:';
  let runningPromise = null;
  let activeRefreshController = null;
  let foregroundCloseResumeTimer = null;

  async function cleanupLegacyRefreshPage() {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const legacyIds = tabs.filter((tab) => {
      try {
        const url = new URL(String(tab?.url || ''));
        return url.origin === new URL(APP_URL).origin
          && url.pathname === new URL(APP_URL).pathname
          && url.searchParams.get('backgroundHomeworkRefresh') === '1';
      } catch {
        return false;
      }
    }).map((tab) => tab.id).filter(Boolean);
    if (legacyIds.length) await chrome.tabs.remove(legacyIds).catch(() => {});
    await chrome.storage.local.remove(['homeworkBackgroundRefreshRunState']).catch(() => {});
    await chrome.alarms.clear('bjtu-homework-background-refresh-timeout').catch(() => false);
  }

  function normalizeIntervalMinutes(value) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600
      ? minutes
      : DEFAULT_INTERVAL_MINUTES;
  }

  function isFullscreenAppUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.origin === new URL(APP_URL).origin
        && url.pathname === new URL(APP_URL).pathname
        && url.searchParams.get('popup') !== '1';
    } catch {
      return false;
    }
  }

  async function hasFullscreenAppPage() {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs.some((tab) => isFullscreenAppUrl(tab?.url));
  }

  async function setStatus(status, extra = {}) {
    await chrome.storage.local.set({
      [STATUS_KEY]: { status, ...extra, checkedAt: Date.now() }
    }).catch(() => {});
  }

  async function ensureAlarm() {
    const stored = await chrome.storage.local.get([ENABLED_KEY, INTERVAL_KEY]).catch(() => ({}));
    const enabled = stored?.[ENABLED_KEY] === true;
    if (!enabled) {
      await chrome.alarms.clear(ALARM_NAME).catch(() => false);
      return null;
    }
    const interval = normalizeIntervalMinutes(stored?.[INTERVAL_KEY]);
    const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);
    if (existing && Number(existing.periodInMinutes || 0) === interval) return existing;
    if (existing) await chrome.alarms.clear(ALARM_NAME).catch(() => false);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: interval, periodInMinutes: interval });
    return chrome.alarms.get(ALARM_NAME).catch(() => null);
  }

  async function runBackgroundHomeworkRefresh() {
    if (runningPromise) return runningPromise;
    runningPromise = (async () => {
    const stored = await chrome.storage.local.get([
      ENABLED_KEY, ACCOUNT_KEY, CACHE_KEY, XQ_CODE_KEY
    ]).catch(() => ({}));
    if (stored?.[ENABLED_KEY] !== true) return { skipped: 'disabled' };
    const account = String(stored?.[ACCOUNT_KEY] || '').trim();
    if (!account) {
      await setStatus('error', { error: '未选择后台维护账号' });
      return { skipped: 'missing-account' };
    }
    if (await hasFullscreenAppPage()) {
      await setStatus('foreground-open', { account });
      return { skipped: 'foreground-open' };
    }
    const controller = new AbortController();
    activeRefreshController = controller;
    await setStatus('loading', { account });

    const loginService = globalThis.BjtuVeLoginService;
    if (!loginService?.login || !loginService?.fetchCurrentUserInfo) {
      throw new Error('智慧课程平台登录服务未加载');
    }
    const loginResult = await loginService.login({ loginName: account });
    controller.signal.throwIfAborted();
    if (!loginResult?.ok) throw new Error(String(loginResult?.message || '后台登录失败'));
    const userInfo = loginResult?.userInfo || await loginService.fetchCurrentUserInfo();
    const currentAccount = String(userInfo?.loginName || '').trim();
    if (currentAccount !== account) throw new Error(`后台登录账号不匹配：${currentAccount || '未登录'}`);

    const core = globalThis.BjtuVeHomeworkCore;
    if (!core) throw new Error('智慧课程平台后台核心未加载');
    const terms = await core.fetchTerms({ signal: controller.signal });
    const xqCode = core.chooseTermCode(terms, stored?.[XQ_CODE_KEY]);
    if (!xqCode) throw new Error('未获取到当前学期');
    const courses = await core.fetchCourses(xqCode, { signal: controller.signal });
    const previousCache = stored?.[CACHE_KEY] && typeof stored[CACHE_KEY] === 'object' ? stored[CACHE_KEY] : {};
    const previousHomework = previousCache.courseHomeworkData || {};
    const courseHomeworkData = {};
    const attachmentCache = {};
    let cursor = 0;
    const workerCount = Math.min(6, Math.max(1, courses.length));
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < courses.length) {
        const course = courses[cursor++];
        const courseId = core.getCourseId(course);
        if (!courseId) continue;
        const list = await core.fetchCourseHomework(courseId, {
          previousList: previousHomework?.[courseId]?.list || [],
          signal: controller.signal
        });
        courseHomeworkData[courseId] = { list, showOverdue: false, showDone: false };
        Object.assign(attachmentCache, await core.fetchHomeworkAttachments(course, list, { signal: controller.signal }));
      }
    }));

    const assignments = core.collectPendingAssignments(courses, courseHomeworkData);
    const reminderItems = core.collectPendingAssignments(courses, courseHomeworkData, { futureOnly: true });
    const savedAt = Date.now();
    const isTeacher = /教师|老师|助教/.test(String(userInfo?.roleName || ''));
    const xqSelectHtml = terms.map((term) => (
      `<option value="${String(term.xqCode).replace(/[&"<>]/g, '')}"${term.xqCode === xqCode ? ' selected' : ''}>${String(term.xqName || term.xqCode).replace(/[&<>]/g, '')}</option>`
    )).join('');
    const cache = {
      ...previousCache,
      version: 1,
      savedAt,
      backgroundStructuredVe: true,
      courseListHtml: '',
      resourceSpaceItems: [],
      resourceSpaceHtml: '',
      platformEnabled: { ...(previousCache.platformEnabled || {}), ve: true },
      platformLoginState: { ...(previousCache.platformLoginState || {}), ve: 'online' },
      platformLoginChecked: { ...(previousCache.platformLoginChecked || {}), ve: true },
      platformLoadedOnce: { ...(previousCache.platformLoadedOnce || {}), ve: true },
      platformNeedLogin: { ...(previousCache.platformNeedLogin || {}), ve: false },
      currentVeCourseList: courses,
      courseHomeworkData,
      homeworkNoteAttachmentCacheByKey: attachmentCache,
      currentAccountLoginName: account,
      isTeacherAccount: isTeacher,
      xqSelectHtml,
      xqSelectValue: xqCode
    };
    const snapshot = { version: 1, updatedAt: savedAt, account, items: reminderItems };
    await chrome.storage.local.set({
      [CACHE_KEY]: cache,
      [SNAPSHOT_KEY]: snapshot,
      [XQ_CODE_KEY]: xqCode
    });
    await notifyNewHomework({ account, assignments });
    await setStatus('complete', {
      account,
      courseCount: courses.length,
      homeworkCount: assignments.length
    });
    return { updated: true, account, courseCount: courses.length, homeworkCount: assignments.length };
    })().catch(async (error) => {
      if (activeRefreshController?.signal?.aborted
          && activeRefreshController.signal.reason === 'foreground-open') {
        await setStatus('foreground-open');
        return { skipped: 'foreground-open' };
      }
      await setStatus('error', { error: String(error?.message || error) });
      throw error;
    }).finally(() => {
      activeRefreshController = null;
      runningPromise = null;
    });
    return runningPromise;
  }

  function homeworkIdentity(item) {
    return [item?.platform, item?.courseName, item?.title]
      .map((value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase())
      .join('|');
  }

  function formatDeadline(value) {
    const date = new Date(Number(value || 0));
    if (Number.isNaN(date.getTime())) return '未知';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function notifyNewHomework(message) {
    const stored = await chrome.storage.local.get([NEW_HOMEWORK_NOTIFY_KEY, KNOWN_ASSIGNMENTS_KEY]).catch(() => ({}));
    const account = String(message?.account || '').trim();
    if (!account) return;
    const knownByAccount = stored?.[KNOWN_ASSIGNMENTS_KEY] && typeof stored[KNOWN_ASSIGNMENTS_KEY] === 'object'
      ? { ...stored[KNOWN_ASSIGNMENTS_KEY] }
      : {};
    const previousList = Array.isArray(knownByAccount[account]) ? knownByAccount[account] : null;
    const previousKeys = new Set(previousList || []);
    const freshItems = Array.isArray(message?.assignments) ? message.assignments : [];
    const additions = freshItems.filter((item) => {
      const key = homeworkIdentity(item);
      return key && !previousKeys.has(key);
    });
    knownByAccount[account] = [...new Set([
      ...(previousList || []),
      ...freshItems.map(homeworkIdentity).filter(Boolean)
    ])].slice(-5000);
    await chrome.storage.local.set({ [KNOWN_ASSIGNMENTS_KEY]: knownByAccount }).catch(() => {});
    if (!previousList || stored?.[NEW_HOMEWORK_NOTIFY_KEY] !== true) return;
    await Promise.all(additions.map((item) => {
      const id = `${NOTIFICATION_PREFIX}${homeworkIdentity(item).split('').reduce((hash, ch) => {
        hash ^= ch.charCodeAt(0);
        return Math.imul(hash, 16777619);
      }, 2166136261) >>> 0}`;
      const createNotification = global.BjtuSystemNotifications?.create
        || ((notificationId, options) => chrome.notifications.create(notificationId, options));
      return createNotification(id, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `发现新作业：${String(item?.courseName || '未知课程')}`,
        message: `${String(item?.platform || '课程平台')} · ${String(item?.title || '未命名作业')}\n截止时间：${formatDeadline(item?.deadline)}`,
        priority: 2
      }, 'new-homework');
    }));
  }

  function stopRefreshWhenFullscreenOpens(tab) {
    if (!activeRefreshController || !isFullscreenAppUrl(tab?.url)) return;
    activeRefreshController.abort('foreground-open');
  }

  function scheduleResumeAfterFullscreenClose() {
    if (foregroundCloseResumeTimer) clearTimeout(foregroundCloseResumeTimer);
    foregroundCloseResumeTimer = setTimeout(async () => {
      foregroundCloseResumeTimer = null;
      if (await hasFullscreenAppPage()) return;
      const stored = await chrome.storage.local.get([ENABLED_KEY, STATUS_KEY]).catch(() => ({}));
      if (stored?.[ENABLED_KEY] !== true) return;
      if (String(stored?.[STATUS_KEY]?.status || '') !== 'foreground-open') return;
      runBackgroundHomeworkRefresh().catch(() => {});
    }, 250);
  }

  chrome.tabs.onCreated.addListener(stopRefreshWhenFullscreenOpens);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo?.url || changeInfo?.status === 'complete') {
      stopRefreshWhenFullscreenOpens(tab);
      scheduleResumeAfterFullscreenClose();
    }
  });
  chrome.tabs.onRemoved.addListener(() => scheduleResumeAfterFullscreenClose());

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARM_NAME) runBackgroundHomeworkRefresh().catch((error) => {
      setStatus('error', { error: String(error?.message || error) });
    });
  });

  chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); });
  chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes[ENABLED_KEY] && !changes[INTERVAL_KEY] && !changes[ACCOUNT_KEY])) return;
    void ensureAlarm();
    if (changes[ENABLED_KEY]?.newValue === true || changes[ACCOUNT_KEY]?.newValue) {
      runBackgroundHomeworkRefresh().catch((error) => {
        setStatus('error', { error: String(error?.message || error) });
      });
    }
  });

  void cleanupLegacyRefreshPage();
  void ensureAlarm();
  scheduleResumeAfterFullscreenClose();
})();
