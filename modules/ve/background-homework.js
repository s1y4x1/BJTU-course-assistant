(function () {
  'use strict';

  const ENABLED_KEY = 'homeworkBackgroundRefreshEnabled';
  const ACCOUNT_KEY = 'homeworkReminderAccount';
  const PLATFORMS_KEY = 'homeworkBackgroundRefreshPlatforms';
  const INTERVAL_KEY = 'homeworkBackgroundRefreshIntervalMinutes';
  const NEW_HOMEWORK_NOTIFY_KEY = 'homeworkNewAssignmentNotificationEnabled';
  const FOREGROUND_NEW_HOMEWORK_NOTIFY_KEY = 'homeworkForegroundNewAssignmentNotificationEnabled';
  const STATUS_KEY = 'homeworkBackgroundRefreshStatus';
  const KNOWN_ASSIGNMENTS_KEY = 'homeworkBackgroundKnownAssignments';
  const CACHE_KEY = 'popupFullscreenCourseCache';
  const XQ_CODE_KEY = 'selectedXqCode';
  const ALARM_NAME = 'bjtu-homework-background-refresh';
  const DEFAULT_INTERVAL_MINUTES = 30;
  const APP_URL = chrome.runtime.getURL('app/app.html');
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
    const contexts = await chrome.runtime.getContexts({});
    return contexts.some((context) => {
      const url = String(context.documentUrl || '').split('?')[0];
      return url === APP_URL || url === chrome.runtime.getURL('popup/popup.html');
    });
  }

  async function setStatus(status, extra = {}) {
    await chrome.storage.local.set({
      [STATUS_KEY]: { status, ...extra, checkedAt: Date.now() }
    }).catch(() => {});
  }

  async function ensureAlarm() {
    const stored = await chrome.storage.local.get([ENABLED_KEY, INTERVAL_KEY, PLATFORMS_KEY, NEW_HOMEWORK_NOTIFY_KEY]).catch(() => ({}));
    const enabled = stored?.[ENABLED_KEY] === true
      || (stored[NEW_HOMEWORK_NOTIFY_KEY] === true && (stored[PLATFORMS_KEY] || []).length > 0);
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
      ENABLED_KEY, ACCOUNT_KEY, CACHE_KEY, XQ_CODE_KEY, PLATFORMS_KEY, NEW_HOMEWORK_NOTIFY_KEY, 'loginAccountHistory', 'platformEnabled', 'yktActivityTypes', 'moocActivityTypes'
    ]).catch(() => ({}));
    const selected = new Set(stored[NEW_HOMEWORK_NOTIFY_KEY] === true ? stored[PLATFORMS_KEY] || [] : []);
    if (stored?.[ENABLED_KEY] !== true && !selected.size) return { skipped: 'disabled' };
    const account = globalThis.BjtuHomeworkReminders.selectedVeAccount(stored);
    if (await hasFullscreenAppPage()) {
      await setStatus('foreground-open', { account });
      return { skipped: 'foreground-open' };
    }
    const controller = new AbortController();
    activeRefreshController = controller;
    await setStatus('loading', { account });

    const failures = [];
    let externalCount = 0;
    const installed = await globalThis.BjtuModuleRegistry.ready;
    for (const platform of selected) {
      if (platform === 've' || !installed[platform] || stored.platformEnabled?.[platform] !== true
          || stored[CACHE_KEY]?.platformLoginState?.[platform] !== 'online') continue;
      controller.signal.throwIfAborted();
      try {
        const assignments = await globalThis.BjtuBackgroundHomeworkPlatforms[platform](stored);
        controller.signal.throwIfAborted();
        const savedAt = Date.now();
        await globalThis.BjtuHomeworkReminders.update(async (state) => {
          globalThis.BjtuHomeworkReminders.replaceSnapshot(state.snapshot, platform, '', assignments.filter((item) => item.deadline > savedAt), savedAt);
        });
        await notifyNewHomework({ platform, assignments });
        externalCount += assignments.length;
      } catch (error) {
        controller.signal.throwIfAborted();
        failures.push(`${globalThis.BjtuHomeworkReminders.labels[platform]}：${error?.message || error}`);
      }
    }
    const refreshVe = stored[ENABLED_KEY] === true || (selected.has('ve') && stored.platformEnabled?.ve !== false
      && stored[CACHE_KEY]?.platformLoginState?.ve === 'online');
    if (!refreshVe) {
      await setStatus(failures.length ? 'error' : 'complete', { account, homeworkCount: externalCount, error: failures.join('；') });
      return { updated: true, homeworkCount: externalCount, failures };
    }
    if (!account) throw new Error('没有最后登录的智慧课程平台账号');

    const loginService = globalThis.BjtuVeLoginService;
    if (!loginService?.login || !loginService?.fetchCurrentUserInfo) {
      throw new Error('智慧课程平台登录服务未加载');
    }
    const loginResult = stored[ENABLED_KEY] === true ? await loginService.login({ loginName: account })
      : { ok: true, userInfo: await loginService.fetchCurrentUserInfo() };
    controller.signal.throwIfAborted();
    if (!loginResult?.ok) throw new Error(String(loginResult?.message || '后台登录失败'));
    const userInfo = loginResult?.userInfo;
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
    await globalThis.BjtuHomeworkReminders.update(async (state) => {
      if (!await globalThis.BjtuAccountStore.get(account)) throw new Error('后台维护账号已被删除');
      globalThis.BjtuHomeworkReminders.replaceSnapshot(state.snapshot, 've', account, reminderItems, savedAt);
      await chrome.storage.local.set({ [CACHE_KEY]: cache, [XQ_CODE_KEY]: xqCode });
      await notifyNewHomework({ account, assignments });
    });
    await setStatus(failures.length ? 'error' : 'complete', {
      account,
      courseCount: courses.length,
      homeworkCount: assignments.length + externalCount,
      error: failures.join('；')
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
    return navigator.locks.request('bjtu-homework-new-assignments', () => recordNewHomework(message));
  }

  async function recordNewHomework(message) {
    const notifyKey = message.foreground === true ? FOREGROUND_NEW_HOMEWORK_NOTIFY_KEY : NEW_HOMEWORK_NOTIFY_KEY;
    const stored = await chrome.storage.local.get([notifyKey, KNOWN_ASSIGNMENTS_KEY, ACCOUNT_KEY, 'homeworkReminderOnlySelectedAccount', 'loginAccountHistory']).catch(() => ({}));
    const platform = message.platform || 've';
    const account = String(message?.account || '').trim();
    if (platform === 've' && !account) return;
    const scopeKey = platform === 've' ? `${platform}|${account}` : platform;
    const knownByAccount = stored?.[KNOWN_ASSIGNMENTS_KEY] && typeof stored[KNOWN_ASSIGNMENTS_KEY] === 'object'
      ? { ...stored[KNOWN_ASSIGNMENTS_KEY] }
      : {};
    const previousList = Array.isArray(knownByAccount[scopeKey]) ? knownByAccount[scopeKey] : null;
    const previousKeys = new Set(previousList || []);
    const freshItems = Array.isArray(message?.assignments) ? message.assignments : [];
    const additions = freshItems.filter((item) => {
      const key = homeworkIdentity(item);
      return key && !previousKeys.has(key);
    });
    knownByAccount[scopeKey] = [...new Set([
      ...(previousList || []),
      ...freshItems.map(homeworkIdentity).filter(Boolean)
    ])].slice(-5000);
    await chrome.storage.local.set({ [KNOWN_ASSIGNMENTS_KEY]: knownByAccount }).catch(() => {});
    if (!previousList || stored?.[notifyKey] !== true) return;
    if (platform === 've' && stored.homeworkReminderOnlySelectedAccount !== false
        && account !== globalThis.BjtuHomeworkReminders.selectedVeAccount(stored)) return;
    await Promise.all(additions.map((item) => {
      const id = globalThis.BjtuHomeworkReminders.notificationId('new', platform, account, homeworkIdentity(item));
      const createNotification = globalThis.BjtuSystemNotifications?.create
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'HOMEWORK_FOREGROUND_DISCOVERED') return false;
    if (!String(sender.url || '').startsWith(chrome.runtime.getURL(''))
        || !Object.hasOwn(globalThis.BjtuHomeworkReminders.labels, message.payload?.platform)) return false;
    notifyNewHomework({ ...message.payload, foreground: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  function stopRefreshWhenFullscreenOpens(tab) {
    if (!activeRefreshController || !isFullscreenAppUrl(tab?.url)) return;
    activeRefreshController.abort('foreground-open');
  }

  function scheduleResumeAfterFullscreenClose() {
    if (foregroundCloseResumeTimer) clearTimeout(foregroundCloseResumeTimer);
    foregroundCloseResumeTimer = setTimeout(async () => {
      foregroundCloseResumeTimer = null;
      if (await hasFullscreenAppPage()) return;
      const stored = await chrome.storage.local.get([ENABLED_KEY, STATUS_KEY, PLATFORMS_KEY]).catch(() => ({}));
      if (stored?.[ENABLED_KEY] !== true && !(stored[PLATFORMS_KEY] || []).length) return;
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
    if (area !== 'local' || (!changes[ENABLED_KEY] && !changes[INTERVAL_KEY] && !changes[ACCOUNT_KEY] && !changes[PLATFORMS_KEY] && !changes[NEW_HOMEWORK_NOTIFY_KEY] && !changes.loginAccountHistory)) return;
    void ensureAlarm();
    if (changes[ENABLED_KEY]?.newValue === true || changes[ACCOUNT_KEY] || changes[PLATFORMS_KEY] || changes.loginAccountHistory) {
      runBackgroundHomeworkRefresh().catch((error) => {
        setStatus('error', { error: String(error?.message || error) });
      });
    }
  });

  void cleanupLegacyRefreshPage();
  void ensureAlarm();
  scheduleResumeAfterFullscreenClose();
})();
