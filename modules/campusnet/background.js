(function initBjtuCampusNetworkAutoReconnect(global) {
  'use strict';

  const SETTINGS_KEYS = [
    'campusNetworkReconnectEnabled',
    'campusNetworkReconnectAccount',
    'campusNetworkReconnectPassword',
    'campusNetworkReconnectIntervalSeconds',
    'campusNetworkReconnectNotifyOnSuccess',
    'username'
  ];
  const STATUS_KEY = 'campusNetworkReconnectStatus';
  const NOTIFICATION_ID = 'bjtu-campus-network-reconnected';
  const MIN_INTERVAL_SECONDS = 0.1;
  const MAX_INTERVAL_SECONDS = 3600;

  let timerId = null;
  let running = false;
  let lastState = '';

  function normalizeIntervalSeconds(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds)
      ? Math.max(MIN_INTERVAL_SECONDS, Math.min(MAX_INTERVAL_SECONDS, seconds))
      : 1;
  }

  function parseJsonpReturn(text) {
    const source = String(text || '').trim();
    const match = source.match(/^jsonpReturn\(([\s\S]*)\);?$/);
    if (!match) throw new Error(source ? `校园网返回异常：${source.slice(0, 120)}` : '校园网返回为空');
    return JSON.parse(match[1]);
  }

  function buildLoginUrl(account, password) {
    const params = new URLSearchParams();
    params.set('login_method', '1');
    params.set('user_account', account);
    params.set('user_password', password);
    return `https://login.bjtu.edu.cn:802/eportal/portal/login?${params.toString()}`;
  }

  async function notifyReconnected() {
    const settings = await chrome.storage.local.get(['campusNetworkReconnectNotifyOnSuccess']).catch(() => ({}));
    if (settings.campusNetworkReconnectNotifyOnSuccess === false) return;
    const createNotification = global.BjtuSystemNotifications?.create
      || ((id, options) => chrome.notifications.create(id, options));
    await createNotification(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'BJTU 课程助手',
      message: 'BJTU 课程助手已为您自动重新连接校园网',
      priority: 1
    }, 'campus-network-reconnected', true).catch((error) => {
      console.warn('[bjtu] campus network notification failed:', error);
    });
  }

  async function setStatus(patch) {
    const record = {
      ...(patch && typeof patch === 'object' ? patch : {}),
      checkedAt: Date.now()
    };
    await chrome.storage.local.set({ [STATUS_KEY]: record }).catch(() => {});
    return record;
  }

  async function tick() {
    if (running) return null;
    running = true;
    try {
      const settings = await chrome.storage.local.get(SETTINGS_KEYS);
      if (settings.campusNetworkReconnectEnabled !== true) {
        return setStatus({ status: 'disabled', message: '校园网自动重连未启用。' });
      }
      const account = String(settings.campusNetworkReconnectAccount || settings.username || '').trim();
      const password = String(settings.campusNetworkReconnectPassword || '').trim();
      if (!account || !password) {
        lastState = 'missing-credentials';
        return setStatus({ status: 'missing-credentials', message: '请先填写校园网账号和密码。' });
      }

      let response;
      try {
        response = await fetch(buildLoginUrl(account, password), {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          headers: { Accept: '*/*' }
        });
      } catch (error) {
        lastState = 'network-error';
        return setStatus({ status: 'network-error', message: String(error?.message || error), account });
      }

      if (response.status === 503) {
        return setStatus({ status: 'retrying', message: '校园网认证服务暂不可用，正在重试。', account, statusCode: 503 });
      }

      const text = await response.text();
      let data;
      try {
        data = parseJsonpReturn(text);
      } catch (error) {
        lastState = 'parse-error';
        return setStatus({ status: 'parse-error', message: String(error?.message || error), account, statusCode: response.status });
      }

      const result = Number(data?.result);
      const msg = String(data?.msg || '').trim();
      if (result === 1) {
        if (lastState !== 'success') await notifyReconnected();
        lastState = 'success';
        return setStatus({ status: 'success', message: msg || 'Portal协议认证成功！', account });
      }
      if (result === 0 && Number(data?.ret_code) === 2) {
        lastState = 'online';
        return setStatus({ status: 'online', message: msg || '已经在线。', account });
      }
      lastState = 'failed';
      return setStatus({ status: 'failed', message: msg || text.slice(0, 160) || '校园网登录失败。', account, result, retCode: data?.ret_code });
    } finally {
      running = false;
      scheduleNext();
    }
  }

  async function scheduleNext() {
    if (timerId) clearTimeout(timerId);
    const settings = await chrome.storage.local.get(['campusNetworkReconnectEnabled', 'campusNetworkReconnectIntervalSeconds']).catch(() => ({}));
    if (settings.campusNetworkReconnectEnabled !== true) return;
    const delay = normalizeIntervalSeconds(settings.campusNetworkReconnectIntervalSeconds) * 1000;
    timerId = setTimeout(() => { void tick(); }, delay);
  }

  function restart() {
    if (timerId) clearTimeout(timerId);
    timerId = null;
    return tick();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (SETTINGS_KEYS.some((key) => changes[key])) restart();
  });

  chrome.runtime.onInstalled.addListener(restart);
  chrome.runtime.onStartup.addListener(restart);
  chrome.alarms.create('bjtu-campus-network-reconnect-heartbeat', { delayInMinutes: 1, periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === 'bjtu-campus-network-reconnect-heartbeat') restart();
  });
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId !== NOTIFICATION_ID) return;
    chrome.runtime.openOptionsPage().catch(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') }).catch(() => {});
    });
    chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
  });

  restart();

  global.BjtuCampusNetworkReconnect = { restart };
})(globalThis);
