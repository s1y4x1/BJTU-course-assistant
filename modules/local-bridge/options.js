(function initLocalBridgeOptions(global) {
  'use strict';

  let initialized = false;
  let setMessage = () => {};
  let guideSource = '';
  let guideMarkdown = null;
  const element = (id) => document.getElementById(id);

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
    const token = String(element('localBridgeToken')?.value || '').trim() || '<配对后自动填入 Bearer Token>';
    const source = guideSource
      .replaceAll('{{BJTU_CA_BRIDGE_PORT}}', String(port))
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
    const port = element('localBridgePort');
    if (enabled instanceof HTMLInputElement) enabled.checked = status.enabled === true;
    if (port instanceof HTMLInputElement && document.activeElement !== port) {
      port.value = String(Number(status.port) || 1896);
    }
    const label = element('localBridgeStatus');
    if (label instanceof HTMLElement) {
      const names = {
        disabled: '未启用',
        unpaired: '尚未配对',
        connecting: '正在连接…',
        connected: '已连接',
        disconnected: '未连接'
      };
      label.dataset.state = state;
      label.textContent = status.message ? `${names[state] || state}：${status.message}` : (names[state] || state);
    }
    const connected = status.connected === true || state === 'connected';
    const disconnect = element('localBridgeDisconnect');
    const tokenRow = element('localBridgeTokenRow');
    if (disconnect instanceof HTMLButtonElement) disconnect.hidden = !connected;
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
    element('localBridgeEnabled')?.addEventListener('change', (event) => {
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { enabled: event.currentTarget.checked === true }).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    element('localBridgePort')?.addEventListener('change', (event) => {
      const port = Number(event.currentTarget.value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        setMessage('端口必须是 1024 至 65535 的整数', false);
        void refresh();
        return;
      }
      void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { port }).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '端口已保存' : `端口修改失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    element('localBridgePair')?.addEventListener('click', () => {
      const code = String(element('localBridgePairCode')?.value || '').trim();
      const port = Number(element('localBridgePort')?.value) || 1896;
      if (!/^\d{6}$/.test(code)) {
        setMessage('请输入 Bridge 显示的 6 位配对码', false);
        return;
      }
      void send('BJTUCA_LOCAL_BRIDGE_PAIR', { code, port }).then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '本地 Bridge 配对成功' : `配对失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    element('localBridgeDisconnect')?.addEventListener('click', () => {
      void send('BJTUCA_LOCAL_BRIDGE_DISCONNECT').then((response) => {
        applyStatus(response);
        setMessage(response?.ok !== false ? '已断开并删除本地 Bridge 授权' : `断开失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });
    const token = element('localBridgeToken');
    if (token instanceof HTMLInputElement) token.addEventListener('click', () => token.select());

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.bjtuLocalBridgeEnabled || changes.bjtuLocalBridgePort || changes.bjtuLocalBridgeToken) {
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
    await send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { enabled: false, port: 1896 });
    if (initialized) await refresh();
  }

  global.BjtuLocalBridgeOptions = { init, reset };
  global.BjtuOptionsModules?.register('local-bridge', global.BjtuLocalBridgeOptions);
})(globalThis);
