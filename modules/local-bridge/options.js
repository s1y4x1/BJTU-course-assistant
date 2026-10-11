(function initLocalBridgeOptions(global) {
  'use strict';

  let initialized = false;
  let setMessage = () => {};
  let guideSource = '';
  let guideMarkdown = null;
  let pairing = false;
  let attemptedPairCode = '';
  const element = (id) => document.getElementById(id);

  function updateConnectionFields() {
    const host = element('localBridgeHost').value.trim().toLowerCase();
    const remote = !['', '127.0.0.1', 'localhost', '[::1]', '::1'].includes(host);
    element('localBridgePairCode').disabled = !remote || pairing;
    element('localBridgePort').readOnly = !remote;
  }

  function createGuideMarkdownParser(markedApi) {
    if (!markedApi?.Marked || !markedApi?.Renderer) return markedApi;
    const renderer = new markedApi.Renderer();
    renderer.code = ({ text, lang }) => global.BjtuMarkdown.renderCodeBlock(text, lang);
    return new markedApi.Marked({ gfm: true, breaks: true, pedantic: false, renderer });
  }

  function renderGuide() {
    const body = element('localBridgeGuideBody');
    if (!(body instanceof HTMLElement) || !guideSource || !guideMarkdown) return;
    const port = Number(element('localBridgePort')?.value) || 1896;
    const host = String(element('localBridgeHost')?.value || '127.0.0.1').trim();
    const token = String(element('localBridgeToken')?.value || '').trim() || '<连接后自动填入 Bearer Token>';
    const source = guideSource
      .replaceAll('{{BJTU_CA_BRIDGE_PORT}}', String(port))
      .replaceAll('{{BJTU_CA_BRIDGE_HOST}}', host)
      .replaceAll('{{BJTU_CA_BRIDGE_TOKEN}}', token);
    body.innerHTML = typeof guideMarkdown?.parse === 'function'
      ? guideMarkdown.parse(source)
      : new guideMarkdown.Marked().parse(source);
    body.querySelectorAll('a').forEach((link) => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
  }

  async function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { ok: false, message: String(error.message || '通信失败') } : (response || {}));
      });
    });
  }

  function applyStatus(status = {}) {
    const state = String(status.state || (status.enabled ? 'disconnected' : 'disabled'));
    const enabled = element('localBridgeEnabled');
    const autoRetry = element('localBridgeAutoRetry');
    const retryInterval = element('localBridgeRetryInterval');
    const port = element('localBridgePort');
    const allowLan = element('localBridgeAllowLan');
    const connected = status.connected === true || state === 'connected';
    if (enabled instanceof HTMLInputElement) {
      enabled.checked = status.enabled === true;
      enabled.disabled = false;
      enabled.title = '';
    }
    if (autoRetry instanceof HTMLInputElement) autoRetry.checked = status.autoRetry !== false;
    if (retryInterval instanceof HTMLInputElement) {
      retryInterval.disabled = status.autoRetry === false;
      if (document.activeElement !== retryInterval) {
        retryInterval.value = String((Math.max(100, Number(status.retryIntervalMs) || 500) / 1000));
      }
    }
    if (allowLan instanceof HTMLInputElement) allowLan.checked = status.allowLan === true;
    const listenPort = element('localBridgeListenPort');
    if (document.activeElement !== listenPort) listenPort.value = String(status.localPort || 1896);
    if (port instanceof HTMLInputElement && document.activeElement !== port) {
      port.value = String(Number(status.port) || 1896);
    }
    const host = element('localBridgeHost');
    if (host instanceof HTMLInputElement && document.activeElement !== host) host.value = String(status.host || '127.0.0.1');
    updateConnectionFields();
    const label = element('localBridgeStatus');
    if (label instanceof HTMLElement) {
      const names = {
        disabled: '未启用',
        unconfigured: '未检测到配置',
        connecting: '正在连接…',
        connected: '已连接',
        disconnected: '未连接'
      };
      label.dataset.state = state;
      label.textContent = status.message ? `${names[state] || state}：${status.message}` : (names[state] || state);
    }
    const tokenRow = element('localBridgeTokenRow');
    if (tokenRow instanceof HTMLElement) tokenRow.hidden = !connected;
    const tokenInput = element('localBridgeToken');
    if (!(tokenInput instanceof HTMLInputElement)) return;
    if (!connected) {
      tokenInput.value = '';
      renderGuide();
      return;
    }
    void chrome.storage.local.get('bjtuLocalBridgeToken').then((stored) => {
      if (!tokenRow?.hidden) tokenInput.value = String(stored?.bjtuLocalBridgeToken || '');
      renderGuide();
    });
  }

  async function ensureMarkdownRenderer() {
    if (global.BjtuModuleRegistry?.loadScript) {
      await global.BjtuModuleRegistry.loadStyle('UI/markdown.css');
      await global.BjtuModuleRegistry.loadScript('UI/marked.umd.js');
      await global.BjtuModuleRegistry.loadScript('UI/markdown.js');
      return global.marked;
    }
    if (!document.querySelector('link[data-bjtu-markdown-style]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('UI/markdown.css');
      link.dataset.bjtuMarkdownStyle = '1';
      document.head.appendChild(link);
    }
    const loadScript = (path) => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.onload = resolve;
      script.onerror = () => reject(new Error('Markdown 渲染器加载失败'));
      document.head.appendChild(script);
    });
    if (!global.marked) await loadScript('UI/marked.umd.js');
    if (!global.BjtuMarkdown) await loadScript('UI/markdown.js');
    return global.marked;
  }

  async function loadGuide() {
    const body = element('localBridgeGuideBody');
    if (!(body instanceof HTMLElement)) return;
    try {
      const [response, markdown] = await Promise.all([
        fetch(chrome.runtime.getURL('modules/local-bridge/README.md'), { cache: 'no-store' }),
        ensureMarkdownRenderer()
      ]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      guideSource = await response.text();
      guideMarkdown = createGuideMarkdownParser(markdown);
      global.BjtuMarkdown.bindCopy(body, {
        onError: (error) => setMessage(`复制失败：${String(error?.message || error)}`, false)
      });
      renderGuide();
    } catch (error) {
      body.textContent = `说明读取失败：${String(error?.message || error)}`;
    }
  }

  async function refresh() {
    applyStatus(await send('BJTUCA_LOCAL_BRIDGE_STATUS'));
  }

  function bindEvents() {
    element('localBridgeHost')?.addEventListener('change', (event) => {
      updateConnectionFields();
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', {host:event.currentTarget.value}).then((response) => {
        if (response?.ok !== false) applyStatus(response);
        setMessage(response?.ok !== false ? '地址已保存' : `保存失败：${response?.error || ''}`, response?.ok !== false);
      });
    });
    element('localBridgePairCode')?.addEventListener('input', async (event) => {
      const input = event.currentTarget;
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      const code = input.value;
      if (code.length !== 6) {
        attemptedPairCode = '';
        return;
      }
      if (pairing || code === attemptedPairCode || input.disabled) return;
      attemptedPairCode = code;
      pairing = true;
      updateConnectionFields();
      try {
        const response = await send('BJTUCA_LOCAL_BRIDGE_PAIR', {
          host:element('localBridgeHost').value,
          port:Number(element('localBridgePort').value),
          code
        });
        if (response?.ok !== false) applyStatus(response);
        setMessage(response?.ok !== false ? '配对成功' : `配对失败：${response?.error || ''}`, response?.ok !== false);
      } finally {
        input.value = '';
        attemptedPairCode = '';
        pairing = false;
        updateConnectionFields();
      }
    });
    element('localBridgeEnabled')?.addEventListener('change', (event) => {
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { enabled: event.currentTarget.checked === true }).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    element('localBridgeAutoRetry')?.addEventListener('change', (event) => {
      const autoRetry = event.currentTarget.checked === true;
      const interval = element('localBridgeRetryInterval');
      if (interval instanceof HTMLInputElement) interval.disabled = !autoRetry;
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { autoRetry }).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '自动重试设置已保存' : `保存失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    element('localBridgeRetryInterval')?.addEventListener('change', (event) => {
      const seconds = Number(event.currentTarget.value);
      if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 60) {
        setMessage('重试间隔必须为 0.1 至 60 秒', false);
        void refresh();
        return;
      }
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { retryIntervalMs: Math.round(seconds * 1000) }).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '重试间隔已保存' : `保存失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    for (const id of ['localBridgePort', 'localBridgeListenPort']) element(id)?.addEventListener('change', (event) => {
      const port = Number(event.currentTarget.value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        setMessage('端口必须是 1 至 65535 的整数', false);
        void refresh();
        return;
      }
      const patch = id === 'localBridgeListenPort' ? { localPort: port } : { port };
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', patch).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '端口已保存' : `端口修改失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    element('localBridgeAllowLan')?.addEventListener('change', (event) => {
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { allowLan: event.currentTarget.checked === true }).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '局域网访问设置已保存' : `保存失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    const token = element('localBridgeToken');
    if (token instanceof HTMLInputElement) token.addEventListener('click', () => token.select());

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.bjtuLocalBridgeEnabled || changes.bjtuLocalBridgePort
        || changes.bjtuLocalBridgeHost
        || changes.bjtuLocalBridgeListenPort || changes.bjtuLocalBridgeRemoteConfig
        || changes.bjtuLocalBridgeToken || changes.bjtuLocalBridgeAllowLan
        || changes.bjtuLocalBridgeAutoRetry || changes.bjtuLocalBridgeRetryIntervalMs) {
        void refresh();
      }
    });
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'BJTUCA_LOCAL_BRIDGE_STATUS_CHANGED') applyStatus(message.payload || {});
      return false;
    });
  }

  async function init(context = {}) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context.setMessage === 'function' ? context.setMessage : setMessage;
    bindEvents();
    await Promise.all([refresh(), loadGuide()]);
  }

  async function reset() {
    await send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', {
      enabled: true,
      host: '127.0.0.1',
      port: 1896,
      localPort: 1896,
      allowLan: false,
      autoRetry: true,
      retryIntervalMs: 500
    });
    if (initialized) await refresh();
  }

  global.BjtuLocalBridgeOptions = { init, reset };
  global.BjtuOptionsModules?.register('local-bridge', global.BjtuLocalBridgeOptions);
})(globalThis);
