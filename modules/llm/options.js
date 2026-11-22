(function initQwenOptions(global) {
  'use strict';

  let initialized = false;
  let localModelScript;
  function loadLocalModel() {
    if (global.BjtuQwenLocalModel) return Promise.resolve();
    return localModelScript ||= new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('modules/llm/local-model.js');
      script.onload = resolve;
      script.onerror = () => {localModelScript=null;reject(new Error('无法加载本地模型组件'));};
      document.head.append(script);
    });
  }
  let selectedFabColorMode = 'extension';
  let extensionThemeMode = 'system';
  const systemThemeMedia = global.matchMedia?.('(prefers-color-scheme: dark)');
  let setMessage = (...args) => global.BjtuOptionsMessage.show(...args);

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

  async function refresh() {
    const [status, themeSettings] = await Promise.all([
      send('QWEN_GET_STATUS'),
      chrome.storage.local.get('themeMode').catch(() => ({}))
    ]);
    extensionThemeMode = global.BjtuTheme?.normalizeMode(themeSettings?.themeMode) || 'system';
    const toggle = document.getElementById('qwenEnabled');
    if (toggle instanceof HTMLInputElement) toggle.checked = status.enabled !== false;
    applyEnabledState(status.enabled !== false);
    applyFabColorMode(status.fabColorMode);
    const thinking = document.getElementById('qwenThinkingEnabled');
    if (thinking instanceof HTMLInputElement) thinking.checked = status.thinkingEnabled === true;
    const local = status.provider === 'local';
    document.getElementById('qwenProvider').value = status.provider || 'qwen';
    document.getElementById('qwenLocalModelOptions').hidden = !local;
    document.getElementById('llmApiOptions').hidden = status.provider !== 'openai';
    for(const [id,value] of Object.entries({llmApiBaseUrl:status.apiBaseUrl,llmApiKey:status.apiKey,llmApiModel:status.apiModel})) {
      const input=document.getElementById(id);if(input && document.activeElement!==input)input.value=value || '';
    }
    const base=status.apiBaseUrl || '';
    document.getElementById('llmApiPreset').value = base.includes('apihub.agnes-ai.com')?'agnes':/^http:\/\/(localhost|127\.0\.0\.1):11434\/v1\/?$/.test(base)?'ollama':'custom';
    if (thinking) thinking.disabled = status.provider !== 'qwen';
    if (local) {
      const localStatus = document.getElementById('qwenLocalModelStatus');
      localStatus.textContent = '正在检查本地模型…';
      void loadLocalModel().then(() => global.BjtuQwenLocalModel.availability()).then(state => {
        localStatus.textContent = ({available:'本地模型已就绪',downloadable:'需要下载模型',downloading:'浏览器正在下载模型',unavailable:'当前设备或浏览器设置不支持本地模型'})[state] || state;
      }).catch(error => {localStatus.textContent=String(error.message || error);});
    }
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
          if (model.id === (status.provider==='openai'?status.apiModel:status.modelId)) option.selected = true;
          select.appendChild(option);
        }
        if (!(status.provider==='openai'?status.apiModel:status.modelId) && !local) {
          const first = modelsResponse.models[0];
          await send('QWEN_SETTINGS_SET', { modelId: first.id });
        }
        select.disabled = local;
      } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = modelsResponse.ok ? '无可用模型' : `模型加载失败：${modelsResponse.message || ''}`;
        select.appendChild(option);
        select.disabled = true;
      }
    }
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;
    for(const [id,field] of Object.entries({llmApiBaseUrl:'apiBaseUrl',llmApiKey:'apiKey',llmApiModel:'apiModel'})) {
      document.getElementById(id)?.addEventListener('change',async event=>{
        const result=await send('QWEN_SETTINGS_SET',{[field]:event.target.value});
        if(result.ok===false)setMessage(result.message,false);
        else {setMessage('已保存');if(field!=='apiKey')await refresh();}
      });
    }
    document.getElementById('llmRefreshModels')?.addEventListener('click',()=>void refresh().catch(e=>setMessage(e.message,false)));
    document.getElementById('llmApiPreset')?.addEventListener('change',async event=>{
      const presets={ollama:{apiBaseUrl:'http://127.0.0.1:11434/v1',apiKey:'',apiModel:''},agnes:{apiBaseUrl:'https://apihub.agnes-ai.com/v1',apiKey:'',apiModel:'agnes-2.5-flash'}};
      if(presets[event.target.value]){
        const result=await send('QWEN_SETTINGS_SET',presets[event.target.value]);
        if(result.ok===false)setMessage(result.message,false);else await refresh();
      }
    });
    document.getElementById('qwenLocalModelSettings')?.addEventListener('click', async () => {
      try {
        await loadLocalModel();
        await chrome.tabs.create({url:global.BjtuQwenLocalModel.settingsUrl(),active:true});
      } catch (error) {setMessage(String(error.message || error),false);}
    });
    document.getElementById('qwenProvider')?.addEventListener('change', async event => {
      const result = await send('QWEN_SETTINGS_SET',{provider:event.target.value});
      if (result.ok === false) setMessage(result.message,false);
      await refresh();
    });
    document.getElementById('qwenPrepareLocalModel')?.addEventListener('click', async event => {
      const button = event.currentTarget, status = document.getElementById('qwenLocalModelStatus');
      button.disabled = true; status.textContent = '正在准备本地模型…';
      try {
        await loadLocalModel();
        await global.BjtuQwenLocalModel.prepare(fraction => {status.textContent=`正在下载本地模型… ${Math.round(fraction*100)}%`;});
        status.textContent = '本地模型已就绪';
      } catch (error) { status.textContent = String(error.message || error); }
      finally {button.disabled=false;}
    });

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
        ? chrome.runtime.getURL('modules/llm/chat.html')
        : 'modules/llm/chat.html';
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

    void refresh().catch((error) => setMessage(`初始化失败：${String(error?.message || error)}`, false));
  }

  async function reset() {
    await send('QWEN_SETTINGS_SET', { provider:'qwen', enabled: true, fabColorMode: 'extension', modelId: '', thinkingEnabled: false, maxIterations: 6, alwaysAllow: false, approvalNotificationMode: 'background', completionNotificationMode: 'background' });
    void refresh();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.qwenProvider) void refresh().catch(error => setMessage(error.message,false));
    if (changes.qwenEnabled) {
      const enabled = changes.qwenEnabled.newValue !== false;
      const toggle = document.getElementById('qwenEnabled');
      if (toggle instanceof HTMLInputElement) toggle.checked = enabled;
      applyEnabledState(enabled);
    }
    if (changes.qwenThinkingEnabled) {
      const toggle = document.getElementById('qwenThinkingEnabled');
      if (toggle instanceof HTMLInputElement) toggle.checked = changes.qwenThinkingEnabled.newValue === true;
    }
    if (changes.qwenModelId) {
      const select = document.getElementById('qwenModelSelect');
      if (select instanceof HTMLSelectElement) select.value = String(changes.qwenModelId.newValue || '');
    }
    if (changes.qwenMaxIterations) {
      const input = document.getElementById('qwenMaxIterations');
      if (input instanceof HTMLInputElement) input.value = String(Math.max(1, Number(changes.qwenMaxIterations.newValue) || 6));
    }
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
  });
  systemThemeMedia?.addEventListener?.('change', () => applyFabColorMode(selectedFabColorMode));

  global.BjtuQwenOptions = { init, reset };
  global.BjtuOptionsModules?.register('llm', global.BjtuQwenOptions);
})(globalThis);
