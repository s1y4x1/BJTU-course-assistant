(function () {
  'use strict';

  const ENABLED_KEY = 'homeworkBackgroundRefreshEnabled';
  const ACCOUNT_KEY = 'homeworkBackgroundRefreshAccount';
  const INTERVAL_KEY = 'homeworkBackgroundRefreshIntervalMinutes';
  const NEW_HOMEWORK_NOTIFY_KEY = 'homeworkNewAssignmentNotificationEnabled';
  const STATUS_KEY = 'homeworkBackgroundRefreshStatus';
  const RUN_STATE_KEY = 'homeworkBackgroundRefreshRunState';
  const KNOWN_ASSIGNMENTS_KEY = 'homeworkBackgroundKnownAssignments';
  const ALARM_NAME = 'bjtu-homework-background-refresh';
  const TIMEOUT_ALARM_NAME = 'bjtu-homework-background-refresh-timeout';
  const DEFAULT_INTERVAL_MINUTES = 30;
  const APP_URL = chrome.runtime.getURL('app.html');
  const NOTIFICATION_PREFIX = 'bjtu-homework-reminder:new:';

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
        && url.searchParams.get('popup') !== '1'
        && url.searchParams.get('backgroundHomeworkRefresh') !== '1';
    } catch {
      return false;
    }
  }

  async function hasFullscreenAppPage() {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    return tabs.some((tab) => isFullscreenAppUrl(tab?.url));
  }

  async function closeRunStateTab(state) {
    const tabId = Number(state?.tabId || 0);
    if (tabId > 0) await chrome.tabs.remove(tabId).catch(() => {});
    await chrome.storage.local.remove([RUN_STATE_KEY]).catch(() => {});
    await chrome.alarms.clear(TIMEOUT_ALARM_NAME).catch(() => false);
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
      const state = (await chrome.storage.local.get([RUN_STATE_KEY]).catch(() => ({})))?.[RUN_STATE_KEY];
      if (state) await closeRunStateTab(state);
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
    const stored = await chrome.storage.local.get([
      ENABLED_KEY, ACCOUNT_KEY, RUN_STATE_KEY
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

    const previousState = stored?.[RUN_STATE_KEY];
    if (previousState) {
      const previousTab = Number(previousState.tabId || 0) > 0
        ? await chrome.tabs.get(Number(previousState.tabId)).catch(() => null)
        : null;
      if (previousTab && Date.now() - Number(previousState.startedAt || 0) < 10 * 60 * 1000) {
        return { skipped: 'already-running' };
      }
      await closeRunStateTab(previousState);
    }

    const token = crypto.randomUUID();
    const url = new URL(APP_URL);
    url.searchParams.set('backgroundHomeworkRefresh', '1');
    url.searchParams.set('account', account);
    url.searchParams.set('token', token);
    const tab = await chrome.tabs.create({ url: url.href, active: false });
    if (!tab?.id) throw new Error('无法创建后台作业刷新页面');
    await chrome.storage.local.set({
      [RUN_STATE_KEY]: { token, tabId: tab.id, account, startedAt: Date.now() }
    });
    chrome.alarms.create(TIMEOUT_ALARM_NAME, { delayInMinutes: 5 });
    await setStatus('loading', { account, tabId: tab.id });
    return { started: true, tabId: tab.id };
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
      return chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `发现新作业：${String(item?.courseName || '未知课程')}`,
        message: `${String(item?.platform || '课程平台')} · ${String(item?.title || '未命名作业')}\n截止时间：${formatDeadline(item?.deadline)}`,
        priority: 2
      });
    }));
  }

  async function finishRefresh(message, sender) {
    const stored = await chrome.storage.local.get([RUN_STATE_KEY]).catch(() => ({}));
    const state = stored?.[RUN_STATE_KEY];
    const token = String(message?.token || '').trim();
    if (!state || token !== String(state.token || '') || Number(sender?.tab?.id || 0) !== Number(state.tabId || 0)) return;
    try {
      if (message?.ok) {
        await notifyNewHomework(message);
        await setStatus('complete', {
          account: String(message?.account || state.account || ''),
          courseCount: Number(message?.courseCount || 0),
          homeworkCount: Array.isArray(message?.assignments) ? message.assignments.length : 0
        });
      } else {
        await setStatus('error', {
          account: String(state.account || ''),
          error: String(message?.error || '后台作业刷新失败')
        });
      }
    } finally {
      await closeRunStateTab(state);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'BACKGROUND_HOMEWORK_REFRESH_COMPLETE') return false;
    sendResponse({ ok: true });
    finishRefresh(message, sender).catch((error) => {
      setStatus('error', { error: String(error?.message || error) });
    });
    return false;
  });

  async function stopRefreshWhenFullscreenOpens(tab) {
    if (!isFullscreenAppUrl(tab?.url)) return;
    const stored = await chrome.storage.local.get([RUN_STATE_KEY]).catch(() => ({}));
    const state = stored?.[RUN_STATE_KEY];
    if (!state || Number(state.tabId || 0) === Number(tab?.id || 0)) return;
    await setStatus('foreground-open', { account: String(state.account || '') });
    await closeRunStateTab(state);
  }

  chrome.tabs.onCreated.addListener((tab) => { void stopRefreshWhenFullscreenOpens(tab); });
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo?.url || changeInfo?.status === 'complete') void stopRefreshWhenFullscreenOpens(tab);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === ALARM_NAME) runBackgroundHomeworkRefresh().catch((error) => {
      setStatus('error', { error: String(error?.message || error) });
    });
    if (alarm?.name === TIMEOUT_ALARM_NAME) {
      chrome.storage.local.get([RUN_STATE_KEY]).then((stored) => {
        const state = stored?.[RUN_STATE_KEY];
        if (!state) return;
        return setStatus('error', { account: String(state.account || ''), error: '后台作业刷新超时' })
          .then(() => closeRunStateTab(state));
      }).catch(() => {});
    }
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

  void ensureAlarm();
})();
