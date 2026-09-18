(function initQwenOptions(global) {
  'use strict';

  let initialized = false;
  let selectedFabColorMode = 'extension';
  let extensionThemeMode = 'system';
  const systemThemeMedia = global.matchMedia?.('(prefers-color-scheme: dark)');
  let setMessage = (text, ok = true) => {
    const message = document.getElementById('msg');
    if (message instanceof HTMLElement) {
      message.textContent = String(text || '');
      message.className = `${ok ? 'ok' : 'err'} show`;
    }
  };

  async function send(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const error = chrome?.runtime?.lastError;
        resolve(error ? { ok: false, message: String(error.message || '通信失败') } : (response || {}));
      });
    });
  }

  function applyAlwaysAllowState(value) {
    const alwaysAllow = document.getElementById('qwenAlwaysAllow');
    const maxIterations = document.getElementById('qwenMaxIterations');
    if (alwaysAllow instanceof HTMLInputElement) alwaysAllow.checked = value === true;
    if (maxIterations instanceof HTMLInputElement) maxIterations.disabled = value === true;
  }

  function applyFabColorMode(value) {
    selectedFabColorMode = ['dark', 'light', 'system', 'extension'].includes(value) ? value : 'extension';
    const buttons = [...document.querySelectorAll('#qwenFabColorMode [data-value]')];
    const buttonFor = (mode) => buttons.find((button) => button.dataset.value === mode);
    buttons.forEach((button) => button.classList.remove(
      'theme-mode-btn--active',
      'theme-mode-btn--system-active',
      'qwen-fab-color-chain-70',
      'qwen-fab-color-resolved-70',
      'qwen-fab-color-resolved-40'
    ));
    buttonFor(selectedFabColorMode)?.classList.add('theme-mode-btn--active');
    const systemResolved = systemThemeMedia?.matches ? 'dark' : 'light';
    if (selectedFabColorMode === 'system') {
      // 与扩展「外观」一致：系统是主选项，当前解析出的深/浅色用内框标记。
      buttonFor(systemResolved)?.classList.add('theme-mode-btn--system-active');
    } else if (selectedFabColorMode === 'extension') {
      const extensionResolved = extensionThemeMode === 'system' ? systemResolved : extensionThemeMode;
      if (extensionThemeMode === 'system') {
        buttonFor('system')?.classList.add('qwen-fab-color-chain-70');
        buttonFor(extensionResolved)?.classList.add('qwen-fab-color-resolved-40');
      } else {
        buttonFor(extensionResolved)?.classList.add('qwen-fab-color-resolved-70');
      }
    }
  }

  function applyEnabledState(enabled) {
    const option = document.getElementById('qwenFabColorOption');
    option?.classList.toggle('is-disabled', !enabled);
    option?.querySelectorAll('button').forEach((button) => { button.disabled = !enabled; });
  }

  function applyLocalBridgeStatus(status = {}) {
    const enabled = document.getElementById('qwenLocalBridgeEnabled');
    const port = document.getElementById('qwenLocalBridgePort');
    const state = String(status.state || (status.enabled ? 'disconnected' : 'disabled'));
    if (enabled instanceof HTMLInputElement) enabled.checked = status.enabled === true;
    if (port instanceof HTMLInputElement && document.activeElement !== port) {
      port.value = String(Number(status.port) || 1896);
    }
    const label = document.getElementById('qwenLocalBridgeStatus');
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
    const disconnect = document.getElementById('qwenLocalBridgeDisconnect');
    if (disconnect instanceof HTMLButtonElement) disconnect.hidden = !connected;
    const copy = document.getElementById('qwenLocalBridgeCopyConfig');
    if (copy instanceof HTMLButtonElement) copy.hidden = !connected;
    const tokenRow = document.getElementById('qwenLocalBridgeTokenRow');
    if (tokenRow instanceof HTMLElement) tokenRow.hidden = !connected;
    const tokenInput = document.getElementById('qwenLocalBridgeToken');
    if (tokenInput instanceof HTMLInputElement) {
      if (!connected) {
        tokenInput.value = '';
      } else {
        void chrome.storage.local.get('bjtuLocalBridgeToken').then((stored) => {
          if (!tokenRow?.hidden) tokenInput.value = String(stored?.bjtuLocalBridgeToken || '');
        });
      }
    }
  }

  async function ensureMarkdownRenderer() {
    if (global.marked) return global.marked;
    if (global.BjtuModuleRegistry?.loadScript) {
      await global.BjtuModuleRegistry.loadScript('core/vendor/marked.umd.js');
      return global.marked;
    }
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('core/vendor/marked.umd.js');
      script.onload = resolve;
      script.onerror = () => reject(new Error('Markdown 渲染器加载失败'));
      document.head.appendChild(script);
    });
    return global.marked;
  }

  async function loadLocalBridgeGuide() {
    const section = document.querySelector('.qwen-local-bridge-options');
    if (!(section instanceof HTMLElement)) return false;
    const available = global.BjtuModuleRegistry?.exists
      ? await global.BjtuModuleRegistry.exists('local-bridge')
      : (await fetch(chrome.runtime.getURL('modules/local-bridge/module.json'), { cache: 'no-store' }).catch(() => null))?.ok === true;
    document.querySelectorAll('[data-local-bridge-layout]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.hidden = !available;
      element.style.removeProperty('display');
    });
    if (!available) return false;

    const body = document.getElementById('qwenLocalBridgeGuideBody');
    if (!(body instanceof HTMLElement)) return true;
    try {
      const [readmeResponse, markdown] = await Promise.all([
        fetch(chrome.runtime.getURL('modules/local-bridge/README.md'), { cache: 'no-store' }),
        ensureMarkdownRenderer()
      ]);
      if (!readmeResponse.ok) throw new Error(`HTTP ${readmeResponse.status}`);
      const source = await readmeResponse.text();
      const html = typeof markdown?.parse === 'function'
        ? markdown.parse(source)
        : new markdown.Marked().parse(source);
      body.innerHTML = html;
      body.querySelectorAll('a').forEach((link) => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      });
    } catch (error) {
      body.textContent = `说明读取失败：${String(error?.message || error)}`;
    }
    return true;
  }

  async function refresh() {
    const [status, themeSettings, bridgeStatus] = await Promise.all([
      send('QWEN_GET_STATUS'),
      chrome.storage.local.get('themeMode').catch(() => ({})),
      send('BJTUCA_LOCAL_BRIDGE_STATUS')
    ]);
    applyLocalBridgeStatus(bridgeStatus);
    extensionThemeMode = global.BjtuTheme?.normalizeMode(themeSettings?.themeMode) || 'system';
    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) toggle.checked = status.enabled !== false;
    applyEnabledState(status.enabled !== false);
    applyFabColorMode(status.fabColorMode);
    const thinking = document.getElementById('qwenThinkingEnabled');
    if (thinking instanceof HTMLInputElement) thinking.checked = status.thinkingEnabled === true;
    const maxIterations = document.getElementById('qwenMaxIterations');
    if (maxIterations instanceof HTMLInputElement) maxIterations.value = String(Math.max(1, Number(status.maxIterations) || 6));
    applyAlwaysAllowState(status.alwaysAllow === true);
    const approvalNotification = document.getElementById('qwenApprovalNotificationMode');
    if (approvalNotification instanceof HTMLSelectElement) {
      approvalNotification.value = status.approvalNotificationMode || 'background';
    }
    const completionNotification = document.getElementById('qwenCompletionNotificationMode');
    if (completionNotification instanceof HTMLSelectElement) {
      completionNotification.value = status.completionNotificationMode || 'background';
    }

    const modelsResponse = await send('QWEN_LIST_MODELS');
    const select = document.getElementById('qwenModelSelect');
    if (select instanceof HTMLSelectElement) {
      select.replaceChildren();
      if (modelsResponse.ok && Array.isArray(modelsResponse.models) && modelsResponse.models.length) {
        for (const model of modelsResponse.models) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name;
          if (model.id === status.modelId) option.selected = true;
          select.appendChild(option);
        }
        if (!status.modelId) {
          const first = modelsResponse.models[0];
          await send('QWEN_SETTINGS_SET', { modelId: first.id });
        }
        select.disabled = false;
      } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = modelsResponse.ok ? '无可用模型' : `模型加载失败：${modelsResponse.message || ''}`;
        select.appendChild(option);
        select.disabled = true;
      }
    }
  }

  async function refreshOperations() {
    return global.BjtuQwenOperationsUi.refresh({ showLoading: true });
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;

    const bridgeEnabled = document.getElementById('qwenLocalBridgeEnabled');
    if (bridgeEnabled instanceof HTMLInputElement) {
      bridgeEnabled.addEventListener('change', () => {
        void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { enabled: bridgeEnabled.checked }).then((response) => {
          applyLocalBridgeStatus(response);
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.error || response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const bridgePort = document.getElementById('qwenLocalBridgePort');
    if (bridgePort instanceof HTMLInputElement) {
      bridgePort.addEventListener('change', () => {
        const port = Number(bridgePort.value);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
          setMessage('端口必须是 1024 至 65535 的整数', false);
          void send('BJTUCA_LOCAL_BRIDGE_STATUS').then(applyLocalBridgeStatus);
          return;
        }
        void send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { port }).then((response) => {
          applyLocalBridgeStatus(response);
          setMessage(response?.ok !== false ? '端口已保存' : `端口修改失败：${response?.error || response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    document.getElementById('qwenLocalBridgePair')?.addEventListener('click', () => {
      const code = String(document.getElementById('qwenLocalBridgePairCode')?.value || '').trim();
      const port = Number(document.getElementById('qwenLocalBridgePort')?.value) || 1896;
      if (!/^\d{6}$/.test(code)) {
        setMessage('请输入 Bridge 显示的 6 位配对码', false);
        return;
      }
      void send('BJTUCA_LOCAL_BRIDGE_PAIR', { code, port }).then((response) => {
        applyLocalBridgeStatus(response);
        setMessage(response?.ok !== false ? '本地 Bridge 配对成功' : `配对失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });

    document.getElementById('qwenLocalBridgeDisconnect')?.addEventListener('click', () => {
      void send('BJTUCA_LOCAL_BRIDGE_DISCONNECT').then((response) => {
        applyLocalBridgeStatus(response);
        setMessage(response?.ok !== false ? '已断开并删除本地 Bridge 授权' : `断开失败：${response?.error || response?.message || ''}`, response?.ok !== false);
      });
    });

    document.getElementById('qwenLocalBridgeCopyConfig')?.addEventListener('click', () => {
      void (async () => {
        const stored = await chrome.storage.local.get(['bjtuLocalBridgePort', 'bjtuLocalBridgeToken']);
        const port = Number(stored?.bjtuLocalBridgePort) || 1896;
        const token = String(stored?.bjtuLocalBridgeToken || '');
        if (!token) throw new Error('请先完成配对');
        const text = [
          `[Environment]::SetEnvironmentVariable('BJTU_CA_BRIDGE_TOKEN', '${token.replace(/'/g, "''")}', 'User')`,
          '',
          '[mcp_servers.bjtu_course_assistant]',
          `url = "http://127.0.0.1:${port}/mcp"`,
          'bearer_token_env_var = "BJTU_CA_BRIDGE_TOKEN"',
          'tool_timeout_sec = 86400'
        ].join('\n');
        await navigator.clipboard.writeText(text);
        setMessage('Codex 配置已复制');
      })().catch((error) => setMessage(`复制失败：${String(error?.message || error)}`, false));
    });

    const bridgeToken = document.getElementById('qwenLocalBridgeToken');
    if (bridgeToken instanceof HTMLInputElement) {
      bridgeToken.addEventListener('click', () => bridgeToken.select());
    }

    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) {
      toggle.addEventListener('change', () => {
        applyEnabledState(toggle.checked === true);
        void send('QWEN_SETTINGS_SET', { enabled: toggle.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    document.getElementById('qwenFabColorMode')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-value]');
      if (!(button instanceof HTMLButtonElement)) return;
      const value = button.dataset.value;
      if (!['dark', 'light', 'system', 'extension'].includes(value)) return;
      applyFabColorMode(value);
      void send('QWEN_SETTINGS_SET', { fabColorMode: value }).then((response) => {
        setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
      });
    });

    const standaloneLink = document.getElementById('qwenOpenChatStandalone');
    if (standaloneLink instanceof HTMLAnchorElement) {
      standaloneLink.href = global.chrome?.runtime?.getURL
        ? chrome.runtime.getURL('modules/qwen/chat.html')
        : 'modules/qwen/chat.html';
    }

    const thinking = document.getElementById('qwenThinkingEnabled');
    if (thinking instanceof HTMLInputElement) {
      thinking.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { thinkingEnabled: thinking.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const alwaysAllow = document.getElementById('qwenAlwaysAllow');
    if (alwaysAllow instanceof HTMLInputElement) {
      alwaysAllow.addEventListener('change', () => {
        const maxIterationsInput = document.getElementById('qwenMaxIterations');
        if (maxIterationsInput instanceof HTMLInputElement) maxIterationsInput.disabled = alwaysAllow.checked === true;
        void send('QWEN_SETTINGS_SET', { alwaysAllow: alwaysAllow.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const approvalNotification = document.getElementById('qwenApprovalNotificationMode');
    if (approvalNotification instanceof HTMLSelectElement) {
      approvalNotification.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', {
          approvalNotificationMode: approvalNotification.value
        }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const completionNotification = document.getElementById('qwenCompletionNotificationMode');
    if (completionNotification instanceof HTMLSelectElement) {
      completionNotification.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', {
          completionNotificationMode: completionNotification.value
        }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const select = document.getElementById('qwenModelSelect');
    if (select instanceof HTMLSelectElement) {
      select.addEventListener('change', () => {
        void send('QWEN_SETTINGS_SET', { modelId: select.value }).then(() => setMessage('已保存'));
      });
    }

    document.addEventListener('qwenOperationsPersisted', (event) => {
      const ok = event?.detail?.ok !== false;
      setMessage(ok ? '已保存' : '保存失败', ok);
    });

    void loadLocalBridgeGuide();
    void refresh().catch((error) => setMessage(`初始化失败：${String(error?.message || error)}`, false));
    void refreshOperations().catch((error) => setMessage(`操作加载失败：${String(error?.message || error)}`, false));
  }

  async function reset() {
    await send('QWEN_SETTINGS_SET', { enabled: true, fabColorMode: 'extension', modelId: '', enabledOperations: null, alwaysAllowedOperations: [], thinkingEnabled: false, maxIterations: 6, alwaysAllow: false, approvalNotificationMode: 'background', completionNotificationMode: 'background' });
    await send('BJTUCA_LOCAL_BRIDGE_SETTINGS_SET', { enabled: false, port: 1896 });
    void refresh();
    void refreshOperations();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.qwenAlwaysAllow) applyAlwaysAllowState(changes.qwenAlwaysAllow.newValue === true);
    if (changes.qwenApprovalNotificationMode) {
      const approvalNotification = document.getElementById('qwenApprovalNotificationMode');
      if (approvalNotification instanceof HTMLSelectElement) {
        approvalNotification.value = changes.qwenApprovalNotificationMode.newValue || 'background';
      }
    }
    if (changes.qwenCompletionNotificationMode) {
      const completionNotification = document.getElementById('qwenCompletionNotificationMode');
      if (completionNotification instanceof HTMLSelectElement) {
        completionNotification.value = changes.qwenCompletionNotificationMode.newValue || 'background';
      }
    }
    if (changes.qwenFabColorMode) applyFabColorMode(changes.qwenFabColorMode.newValue);
    if (changes.themeMode) {
      extensionThemeMode = global.BjtuTheme?.normalizeMode(changes.themeMode.newValue) || 'system';
      applyFabColorMode(selectedFabColorMode);
    }
    if (changes.bjtuLocalBridgeEnabled || changes.bjtuLocalBridgePort || changes.bjtuLocalBridgeToken) {
      void send('BJTUCA_LOCAL_BRIDGE_STATUS').then(applyLocalBridgeStatus);
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'BJTUCA_LOCAL_BRIDGE_STATUS_CHANGED') applyLocalBridgeStatus(message.payload || {});
    return false;
  });
  systemThemeMedia?.addEventListener?.('change', () => applyFabColorMode(selectedFabColorMode));

  global.BjtuQwenOptions = { init, reset };
  global.BjtuOptionsModules?.register('qwen', global.BjtuQwenOptions);
})(globalThis);
