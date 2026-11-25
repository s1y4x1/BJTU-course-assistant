(function initLlmOptions(global) {
  'use strict';

  let initialized = false;
  let refreshRevision = 0;
  let chatroomAvailable = false;
  function applyEntryChoice(enabled) {
    document.getElementById('llmStandaloneToggle').hidden=chatroomAvailable;
    document.getElementById('llmEntryChoices').hidden=!chatroomAvailable;
    document.querySelectorAll('input[name="llmEntry"]').forEach(input=>{input.checked=input.value===(enabled?'standalone':'chatroom');});
  }
  let localModelScript;
  function loadLocalModel() {
    if (global.BjtuLlmLocalModel) return Promise.resolve();
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
    const alwaysAllow = document.getElementById('llmAlwaysAllow');
    const maxIterations = document.getElementById('llmMaxIterations');
    if (alwaysAllow instanceof HTMLInputElement) alwaysAllow.checked = value === true;
    if (maxIterations instanceof HTMLInputElement) maxIterations.disabled = false;
  }

  function applyFabColorMode(value) {
    selectedFabColorMode = ['dark', 'light', 'system', 'extension'].includes(value) ? value : 'extension';
    const buttons = [...document.querySelectorAll('#llmFabColorMode [data-value]')];
    const buttonFor = (mode) => buttons.find((button) => button.dataset.value === mode);
    buttons.forEach((button) => button.classList.remove(
      'theme-mode-btn--active',
      'theme-mode-btn--system-active',
      'llm-fab-color-chain-70',
      'llm-fab-color-resolved-70',
      'llm-fab-color-resolved-40'
    ));
    buttonFor(selectedFabColorMode)?.classList.add('theme-mode-btn--active');
    const systemResolved = systemThemeMedia?.matches ? 'dark' : 'light';
    if (selectedFabColorMode === 'system') {
      // 与扩展「外观」一致：系统是主选项，当前解析出的深/浅色用内框标记。
      buttonFor(systemResolved)?.classList.add('theme-mode-btn--system-active');
    } else if (selectedFabColorMode === 'extension') {
      const extensionResolved = extensionThemeMode === 'system' ? systemResolved : extensionThemeMode;
      if (extensionThemeMode === 'system') {
        buttonFor('system')?.classList.add('llm-fab-color-chain-70');
        buttonFor(extensionResolved)?.classList.add('llm-fab-color-resolved-40');
      } else {
        buttonFor(extensionResolved)?.classList.add('llm-fab-color-resolved-70');
      }
    }
  }

  function applyEnabledState(enabled) {
    const option = document.getElementById('llmFabColorOption');
    option?.classList.toggle('is-disabled', !enabled);
    option?.querySelectorAll('button').forEach((button) => { button.disabled = !enabled; });
  }

  async function refresh() {
    const revision=++refreshRevision;
    const [status, themeSettings] = await Promise.all([
      send('LLM_GET_STATUS'),
      chrome.storage.local.get('themeMode').catch(() => ({}))
    ]);
    extensionThemeMode = global.BjtuTheme?.normalizeMode(themeSettings?.themeMode) || 'system';
    const toggle = document.getElementById('llmEnabled');
    chatroomAvailable=status.chatroomAvailable===true;
    document.getElementById('llmProactiveEnabled').checked=status.proactiveEnabled!==false;
    document.getElementById('llmProactiveOnStartup').checked=status.proactiveOnStartup!==false;
    document.getElementById('llmProactiveIntervalEnabled').checked=status.proactiveIntervalEnabled===true;
    document.getElementById('llmProactiveIncludeInContext').checked=status.proactiveIncludeInContext===true;
    const interval=Number(status.proactiveIntervalMinutes)||30;
    const unit=interval%1440===0?1440:interval%60===0?60:1;
    if(document.activeElement!==document.getElementById('llmProactiveIntervalValue')){
      document.getElementById('llmProactiveIntervalUnit').value=String(unit);
      document.getElementById('llmProactiveIntervalValue').value=String(interval/unit);
    }
    document.querySelectorAll('.llm-proactive-sub-options input,.llm-proactive-sub-options select').forEach(input=>{input.disabled=status.proactiveEnabled===false;});
    document.getElementById('llmProactiveIncludeInContext').disabled=status.proactiveEnabled===false;
    for(const id of ['llmProactiveIntervalValue','llmProactiveIntervalUnit'])document.getElementById(id).disabled=status.proactiveEnabled===false || status.proactiveIntervalEnabled!==true;
    applyEntryChoice(status.enabled!==false);
    if (toggle instanceof HTMLInputElement) toggle.checked = status.enabled !== false;
    applyEnabledState(status.enabled !== false);
    applyFabColorMode(status.fabColorMode);
    const thinking = document.getElementById('llmThinkingEnabled');
    if (thinking instanceof HTMLInputElement) thinking.checked = status.thinkingEnabled === true;
    const local = status.provider === 'local';
    document.getElementById('llmProvider').value = status.provider || 'qwen';
    document.getElementById('llmLocalModelOptions').hidden = !local;
    document.getElementById('llmApiOptions').hidden = status.provider !== 'openai';
    if(revision!==refreshRevision)return;
    for(const [id,value] of Object.entries({llmApiBaseUrl:status.apiBaseUrl,llmApiKey:status.apiKey,llmApiModel:status.apiModel,llmApiTemperature:status.apiTemperature,llmApiTopP:status.apiTopP,llmApiTopK:status.apiTopK,llmApiMaxTokens:status.apiMaxTokens,llmApiThinkingProtocol:status.apiThinkingProtocol || 'auto'})) {
      const input=document.getElementById(id);if(input && document.activeElement!==input)input.value=value ?? '';
    }
    const base=status.apiBaseUrl || '';
    const preset=status.apiPreset || (base.includes('agnes-ai.')?'agnes':base.includes('api.deepseek.com')?'deepseek':/:11434/.test(base)?'ollama':'custom');
    document.getElementById('llmApiPreset').value = preset;
    document.getElementById('llmApiTopKRow').hidden=!['ollama','agnes'].includes(preset);
    document.getElementById('llmRefreshModels').hidden=status.provider!=='openai';
    if (thinking) thinking.disabled = local;
    if (local) {
      const localStatus = document.getElementById('llmLocalModelStatus');
      localStatus.textContent = '正在检查本地模型…';
      void loadLocalModel().then(() => global.BjtuLlmLocalModel.availability()).then(state => {
        localStatus.textContent = ({available:'本地模型已就绪',downloadable:'需要下载模型',downloading:'浏览器正在下载模型',unavailable:'当前设备或浏览器设置不支持本地模型'})[state] || state;
      }).catch(error => {localStatus.textContent=String(error.message || error);});
    }
    const maxIterations = document.getElementById('llmMaxIterations');
    if (maxIterations instanceof HTMLInputElement && document.activeElement !== maxIterations) maxIterations.value = status.maxIterations === null || status.maxIterations === '' ? '' : String(status.maxIterations ?? 6);
    applyAlwaysAllowState(status.alwaysAllow === true);
    const approvalNotification = document.getElementById('llmApprovalNotificationMode');
    if (approvalNotification instanceof HTMLSelectElement) {
      approvalNotification.value = status.approvalNotificationMode || 'background';
    }
    const completionNotification = document.getElementById('llmCompletionNotificationMode');
    if (completionNotification instanceof HTMLSelectElement) {
      completionNotification.value = status.completionNotificationMode || 'background';
    }

    const modelsResponse = await send('LLM_LIST_MODELS');
    if(revision!==refreshRevision)return;
    const manual=status.provider==='openai' && (!modelsResponse.ok || !modelsResponse.models?.length);
    document.getElementById('llmApiManualModelRow').hidden=!manual;
    document.getElementById('llmApiModelError').textContent=manual?String(modelsResponse.message || '服务未返回可用模型，允许手动输入'):'';
    const select = document.getElementById('llmModelSelect');
    if (select instanceof HTMLSelectElement) {
      select.style.display=manual?'none':'';
      select.replaceChildren();
      if (modelsResponse.ok && Array.isArray(modelsResponse.models) && modelsResponse.models.length) {
        for (const model of modelsResponse.models) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name;
          if (model.id === (status.provider==='openai'?status.apiModel:status.modelId)) option.selected = true;
          select.appendChild(option);
        }
        const configured=status.provider==='openai'?status.apiModel:status.modelId;
        if (!modelsResponse.models.some(m=>m.id===configured) && !local) {
          const preferred=status.provider==='openai' && preset==='agnes'?'agnes-3.0-flash':'';
          const first = modelsResponse.models.find(m=>m.id===preferred) || modelsResponse.models[0];
          select.value=first.id;
          await send('LLM_SETTINGS_SET', { modelId: first.id });
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
    document.querySelectorAll('input[name="llmEntry"]').forEach(input=>input.addEventListener('change',async()=>{
      if(!input.checked)return;
      const enabled=input.value==='standalone';
      const result=await send('LLM_SETTINGS_SET',{enabled});
      if(result.ok===false)setMessage(result.message,false);
      else {applyEntryChoice(enabled);applyEnabledState(enabled);setMessage('已保存');}
    }));
    for(const [id,field] of Object.entries({llmApiBaseUrl:'apiBaseUrl',llmApiKey:'apiKey',llmApiModel:'apiModel',llmApiTemperature:'apiTemperature',llmApiTopP:'apiTopP',llmApiTopK:'apiTopK',llmApiMaxTokens:'apiMaxTokens',llmApiThinkingProtocol:'apiThinkingProtocol'})) {
      document.getElementById(id)?.addEventListener('change',async event=>{
        if(event.target instanceof HTMLInputElement && !event.target.checkValidity()){
          event.target.reportValidity();await refresh();return;
        }
        const result=await send('LLM_SETTINGS_SET',{[field]:event.target.value});
        if(result.ok===false)setMessage(result.message,false);
        else {setMessage('已保存');if(['apiBaseUrl','apiKey','apiModel'].includes(field))await refresh();}
      });
    }
    document.getElementById('llmRefreshModels')?.addEventListener('click',()=>void refresh().catch(e=>setMessage(e.message,false)));
    document.getElementById('llmApiPreset')?.addEventListener('change',async event=>{
      const presets={ollama:{apiBaseUrl:'http://127.0.0.1:11434/v1',apiKey:'',apiModel:''},agnes:{apiBaseUrl:'https://apihub.agnes-ai.com/v1',apiKey:'',apiModel:'agnes-3.0-flash'},deepseek:{apiBaseUrl:'https://api.deepseek.com/v1',apiKey:'',apiModel:'deepseek-flash'}};
      if(presets[event.target.value]){
        const result=await send('LLM_SETTINGS_SET',{...presets[event.target.value],apiPreset:event.target.value,apiThinkingProtocol:'auto'});
        if(result.ok===false)setMessage(result.message,false);else await refresh();
      }else await send('LLM_SETTINGS_SET',{apiPreset:'custom'});
    });
    document.getElementById('llmLocalModelSettings')?.addEventListener('click', async () => {
      try {
        await loadLocalModel();
        await chrome.tabs.create({url:global.BjtuLlmLocalModel.settingsUrl(),active:true});
      } catch (error) {setMessage(String(error.message || error),false);}
    });
    document.getElementById('llmProvider')?.addEventListener('change', async event => {
      const result = await send('LLM_SETTINGS_SET',{provider:event.target.value});
      if (result.ok === false) setMessage(result.message,false);
      await refresh();
    });
    document.getElementById('llmPrepareLocalModel')?.addEventListener('click', async event => {
      const button = event.currentTarget, status = document.getElementById('llmLocalModelStatus');
      button.disabled = true; status.textContent = '正在准备本地模型…';
      try {
        await loadLocalModel();
        await global.BjtuLlmLocalModel.prepare(fraction => {status.textContent=`正在下载本地模型… ${Math.round(fraction*100)}%`;});
        status.textContent = '本地模型已就绪';
      } catch (error) { status.textContent = String(error.message || error); }
      finally {button.disabled=false;}
    });

    const toggle = document.getElementById('llmEnabled');
    if (toggle instanceof HTMLInputElement) {
      toggle.addEventListener('change', () => {
        applyEnabledState(toggle.checked === true);
        void send('LLM_SETTINGS_SET', { enabled: toggle.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }
    document.getElementById('llmProactiveEnabled')?.addEventListener('change',event=>{
      void send('LLM_SETTINGS_SET',{proactiveEnabled:event.target.checked}).then(response=>{if(response?.ok===false)setMessage(response.message,false);});
    });
    for(const [id,field]of Object.entries({llmProactiveOnStartup:'proactiveOnStartup',llmProactiveIntervalEnabled:'proactiveIntervalEnabled',llmProactiveIncludeInContext:'proactiveIncludeInContext'})){
      document.getElementById(id)?.addEventListener('change',event=>{
        void send('LLM_SETTINGS_SET',{[field]:event.target.checked}).then(response=>{if(response?.ok===false)setMessage(response.message,false);});
      });
    }
    const saveProactiveInterval=async()=>{
      const minutes=Number(document.getElementById('llmProactiveIntervalValue').value)*Number(document.getElementById('llmProactiveIntervalUnit').value);
      if(!Number.isFinite(minutes)||minutes<1){setMessage('主动消息间隔不能小于 1 分钟',false);await refresh();return;}
      const response=await send('LLM_SETTINGS_SET',{proactiveIntervalMinutes:minutes});
      if(response?.ok===false)setMessage(response.message,false);
    };
    for(const id of ['llmProactiveIntervalValue','llmProactiveIntervalUnit'])document.getElementById(id)?.addEventListener('change',saveProactiveInterval);

    document.getElementById('llmFabColorMode')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-value]');
      if (!(button instanceof HTMLButtonElement)) return;
      const value = button.dataset.value;
      if (!['dark', 'light', 'system', 'extension'].includes(value)) return;
      applyFabColorMode(value);
      void send('LLM_SETTINGS_SET', { fabColorMode: value }).then((response) => {
        setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
      });
    });

    const standaloneLink = document.getElementById('llmOpenChatStandalone');
    if (standaloneLink instanceof HTMLAnchorElement) {
      standaloneLink.href = global.chrome?.runtime?.getURL
        ? chrome.runtime.getURL('modules/llm/chat.html')
        : 'modules/llm/chat.html';
    }

    const thinking = document.getElementById('llmThinkingEnabled');
    if (thinking instanceof HTMLInputElement) {
      thinking.addEventListener('change', () => {
        void send('LLM_SETTINGS_SET', { thinkingEnabled: thinking.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const alwaysAllow = document.getElementById('llmAlwaysAllow');
    document.getElementById('llmMaxIterations')?.addEventListener('change', async event => {
      const input=event.currentTarget;
      if(!input.checkValidity()){input.reportValidity();await refresh();return;}
      const maxIterations=input.value===''?null:Number(input.value);
      const patch={maxIterations};
      // 主动填写有限上限优先于旧的“始终允许”，不保留隐藏的覆盖状态。
      if(maxIterations!==null)patch.alwaysAllow=false;
      const response=await send('LLM_SETTINGS_SET',patch);
      if(response?.ok===false)setMessage(response.message,false);
      else if(maxIterations!==null)applyAlwaysAllowState(false);
    });
    if (alwaysAllow instanceof HTMLInputElement) {
      alwaysAllow.addEventListener('change', () => {
        const maxIterationsInput = document.getElementById('llmMaxIterations');
        if (maxIterationsInput instanceof HTMLInputElement) maxIterationsInput.disabled = false;
        void send('LLM_SETTINGS_SET', { alwaysAllow: alwaysAllow.checked === true }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const approvalNotification = document.getElementById('llmApprovalNotificationMode');
    if (approvalNotification instanceof HTMLSelectElement) {
      approvalNotification.addEventListener('change', () => {
        void send('LLM_SETTINGS_SET', {
          approvalNotificationMode: approvalNotification.value
        }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const completionNotification = document.getElementById('llmCompletionNotificationMode');
    if (completionNotification instanceof HTMLSelectElement) {
      completionNotification.addEventListener('change', () => {
        void send('LLM_SETTINGS_SET', {
          completionNotificationMode: completionNotification.value
        }).then((response) => {
          setMessage(response?.ok !== false ? '已保存' : `保存失败：${response?.message || ''}`, response?.ok !== false);
        });
      });
    }

    const select = document.getElementById('llmModelSelect');
    if (select instanceof HTMLSelectElement) {
      select.addEventListener('change', () => {
        void send('LLM_SETTINGS_SET', { modelId: select.value }).then(() => setMessage('已保存'));
      });
    }

    void refresh().catch((error) => setMessage(`初始化失败：${String(error?.message || error)}`, false));
  }

  async function reset() {
    await send('LLM_SETTINGS_SET',{proactiveOnStartup:true,proactiveIntervalEnabled:false,proactiveIntervalMinutes:30,proactiveIncludeInContext:false});
    const defaults=global.BjtuLlmDefaults.values;
    await send('LLM_SETTINGS_SET', { provider:'openai',apiPreset:defaults.llmApiPreset,apiBaseUrl:defaults.llmApiBaseUrl,apiKey:defaults.llmApiKey,apiModel:defaults.llmApiModel, proactiveEnabled:true,enabled:!chatroomAvailable, fabColorMode: 'extension', modelId: '', thinkingEnabled: false, maxIterations: 6, alwaysAllow: false, approvalNotificationMode: 'background', completionNotificationMode: 'background' });
    void refresh();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.llmProvider || Object.keys(changes).some(key=>key.startsWith('llmProactive')&&key!=='llmProactiveMessages')) void refresh().catch(error => setMessage(error.message,false));
    if (changes.llmEnabled) {
      const enabled = changes.llmEnabled.newValue !== false;
      applyEntryChoice(enabled);
      const toggle = document.getElementById('llmEnabled');
      if (toggle instanceof HTMLInputElement) toggle.checked = enabled;
      applyEnabledState(enabled);
    }
    if (changes.llmThinkingEnabled) {
      const toggle = document.getElementById('llmThinkingEnabled');
      if (toggle instanceof HTMLInputElement) toggle.checked = changes.llmThinkingEnabled.newValue === true;
    }
    if (changes.qwenModelId) {
      const select = document.getElementById('llmModelSelect');
      if (select instanceof HTMLSelectElement) select.value = String(changes.qwenModelId.newValue || '');
    }
    if (changes.llmMaxIterations) {
      const input = document.getElementById('llmMaxIterations');
      if (input instanceof HTMLInputElement && document.activeElement !== input) input.value = changes.llmMaxIterations.newValue == null || changes.llmMaxIterations.newValue === '' ? '' : String(changes.llmMaxIterations.newValue);
    }
    if (changes.llmAlwaysAllow) applyAlwaysAllowState(changes.llmAlwaysAllow.newValue === true);
    if (changes.llmApprovalNotificationMode) {
      const approvalNotification = document.getElementById('llmApprovalNotificationMode');
      if (approvalNotification instanceof HTMLSelectElement) {
        approvalNotification.value = changes.llmApprovalNotificationMode.newValue || 'background';
      }
    }
    if (changes.llmCompletionNotificationMode) {
      const completionNotification = document.getElementById('llmCompletionNotificationMode');
      if (completionNotification instanceof HTMLSelectElement) {
        completionNotification.value = changes.llmCompletionNotificationMode.newValue || 'background';
      }
    }
    if (changes.llmFabColorMode) applyFabColorMode(changes.llmFabColorMode.newValue);
    if (changes.themeMode) {
      extensionThemeMode = global.BjtuTheme?.normalizeMode(changes.themeMode.newValue) || 'system';
      applyFabColorMode(selectedFabColorMode);
    }
  });
  systemThemeMedia?.addEventListener?.('change', () => applyFabColorMode(selectedFabColorMode));

  global.BjtuLlmOptions = { init, reset };
  global.BjtuOptionsModules?.register('llm', global.BjtuLlmOptions);
})(globalThis);
