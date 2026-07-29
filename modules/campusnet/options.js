(function initCampusnetOptions(global) {
  'use strict';

  const DEFAULT_INTERVAL_SECONDS = 1;
  const MIN_INTERVAL_SECONDS = 0.1;
  const MAX_INTERVAL_SECONDS = 3600;
  let initialized = false;
  let setMessage = () => {};

  const element = (id) => document.getElementById(id);

  function normalizeInterval(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds)
      && seconds >= MIN_INTERVAL_SECONDS
      && seconds <= MAX_INTERVAL_SECONDS
      ? seconds
      : DEFAULT_INTERVAL_SECONDS;
  }

  function setIntervalEditor(seconds) {
    const normalized = normalizeInterval(seconds);
    const value = element('campusNetworkReconnectIntervalValue');
    const unit = element('campusNetworkReconnectIntervalUnit');
    if (!(value instanceof HTMLInputElement) || !(unit instanceof HTMLSelectElement)) return;
    const multiplier = normalized % 3600 === 0 ? 3600 : (normalized % 60 === 0 ? 60 : 1);
    value.value = String(normalized / multiplier);
    unit.value = String(multiplier);
  }

  function readIntervalEditor() {
    const value = Number(element('campusNetworkReconnectIntervalValue')?.value || 0);
    const unit = Number(element('campusNetworkReconnectIntervalUnit')?.value || 1);
    const seconds = Number((value * unit).toFixed(3));
    return Number.isFinite(seconds)
      && seconds >= MIN_INTERVAL_SECONDS
      && seconds <= MAX_INTERVAL_SECONDS
      ? seconds
      : NaN;
  }

  function updateDisabledState() {
    const enabled = element('campusNetworkReconnectEnabled')?.checked === true;
    const detail = element('campusNetworkReconnectDetail');
    detail?.classList.toggle('is-disabled', !enabled);
    detail?.querySelectorAll('input,select').forEach((control) => { control.disabled = !enabled; });
  }

  function renderStatus(status) {
    const target = element('campusNetworkReconnectStatus');
    if (!(target instanceof HTMLElement)) return;
    if (element('campusNetworkReconnectEnabled')?.checked !== true) {
      target.textContent = '校园网自动重连未启用。';
      return;
    }
    const state = String(status?.status || 'waiting');
    const message = String(status?.message || '').trim();
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
    target.textContent = message
      ? `${labels[state] || '最近一次校园网认证请求已完成。'} ${message}`
      : (labels[state] || '等待下一次校园网认证请求。');
  }

  async function saveInterval() {
    const seconds = readIntervalEditor();
    if (!Number.isFinite(seconds)) {
      setMessage('校园网请求间隔必须在 0.1 秒到 1 小时之间', false);
      const stored = await chrome.storage.local.get(['campusNetworkReconnectIntervalSeconds']);
      setIntervalEditor(stored.campusNetworkReconnectIntervalSeconds);
      return;
    }
    await chrome.storage.local.set({ campusNetworkReconnectIntervalSeconds: seconds });
    setIntervalEditor(seconds);
    setMessage(`已将校园网请求间隔设为 ${seconds} 秒`);
  }

  function bindEvents() {
    element('campusNetworkReconnectEnabled')?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      await chrome.storage.local.set({ campusNetworkReconnectEnabled: enabled });
      updateDisabledState();
      renderStatus(enabled ? { status: 'waiting' } : null);
      setMessage(enabled ? '已启用校园网自动重连' : '已关闭校园网自动重连');
    });
    element('campusNetworkReconnectAccount')?.addEventListener('change', async (event) => {
      await chrome.storage.local.set({
        campusNetworkReconnectAccount: String(event.currentTarget.value || '').trim()
      });
      setMessage('已保存校园网上网账号');
    });
    element('campusNetworkReconnectPassword')?.addEventListener('change', async (event) => {
      await chrome.storage.local.set({
        campusNetworkReconnectPassword: String(event.currentTarget.value || '')
      });
      setMessage('已保存校园网密码');
    });
    element('campusNetworkReconnectNotifyOnSuccess')?.addEventListener('change', async (event) => {
      const enabled = event.currentTarget.checked === true;
      await chrome.storage.local.set({ campusNetworkReconnectNotifyOnSuccess: enabled });
      setMessage(enabled ? '已启用校园网重连成功通知' : '已关闭校园网重连成功通知');
    });
    element('campusNetworkReconnectIntervalValue')?.addEventListener('change', saveInterval);
    element('campusNetworkReconnectIntervalUnit')?.addEventListener('change', saveInterval);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.campusNetworkReconnectEnabled) {
        element('campusNetworkReconnectEnabled').checked = changes.campusNetworkReconnectEnabled.newValue === true;
        updateDisabledState();
      }
      if (changes.campusNetworkReconnectAccount
          && document.activeElement !== element('campusNetworkReconnectAccount')) {
        element('campusNetworkReconnectAccount').value = String(changes.campusNetworkReconnectAccount.newValue || '');
      }
      if (changes.username && document.activeElement !== element('campusNetworkReconnectAccount')
          && !String(element('campusNetworkReconnectAccount')?.value || '').trim()) {
        element('campusNetworkReconnectAccount').value = String(changes.username.newValue || '');
      }
      if (changes.campusNetworkReconnectPassword
          && document.activeElement !== element('campusNetworkReconnectPassword')) {
        element('campusNetworkReconnectPassword').value = String(changes.campusNetworkReconnectPassword.newValue || '');
      }
      if (changes.campusNetworkReconnectIntervalSeconds) {
        setIntervalEditor(changes.campusNetworkReconnectIntervalSeconds.newValue);
      }
      if (changes.campusNetworkReconnectNotifyOnSuccess) {
        element('campusNetworkReconnectNotifyOnSuccess').checked =
          changes.campusNetworkReconnectNotifyOnSuccess.newValue !== false;
      }
      if (changes.campusNetworkReconnectStatus) renderStatus(changes.campusNetworkReconnectStatus.newValue);
    });
  }

  async function init(options = {}) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof options.setMessage === 'function' ? options.setMessage : setMessage;
    const stored = await chrome.storage.local.get([
      'campusNetworkReconnectEnabled',
      'campusNetworkReconnectAccount',
      'campusNetworkReconnectPassword',
      'campusNetworkReconnectIntervalSeconds',
      'campusNetworkReconnectNotifyOnSuccess',
      'campusNetworkReconnectStatus',
      'username'
    ]);
    element('campusNetworkReconnectEnabled').checked = stored.campusNetworkReconnectEnabled === true;
    element('campusNetworkReconnectAccount').value =
      String(stored.campusNetworkReconnectAccount || stored.username || '');
    element('campusNetworkReconnectPassword').value = String(stored.campusNetworkReconnectPassword || '');
    element('campusNetworkReconnectNotifyOnSuccess').checked =
      stored.campusNetworkReconnectNotifyOnSuccess !== false;
    setIntervalEditor(stored.campusNetworkReconnectIntervalSeconds);
    bindEvents();
    updateDisabledState();
    renderStatus(stored.campusNetworkReconnectStatus);
  }

  async function reset() {
    await chrome.storage.local.set({
      campusNetworkReconnectEnabled: false,
      campusNetworkReconnectIntervalSeconds: DEFAULT_INTERVAL_SECONDS,
      campusNetworkReconnectNotifyOnSuccess: true
    });
    if (!initialized) return;
    element('campusNetworkReconnectEnabled').checked = false;
    element('campusNetworkReconnectNotifyOnSuccess').checked = true;
    setIntervalEditor(DEFAULT_INTERVAL_SECONDS);
    updateDisabledState();
    renderStatus(null);
  }

  global.BjtuCampusnetOptions = { init, reset };
  global.BjtuOptionsModules?.register('campusnet', global.BjtuCampusnetOptions);
})(globalThis);
