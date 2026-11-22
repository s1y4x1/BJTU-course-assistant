/* OpenAI-compatible text streaming. Runs in the extension background, not in Node. */
(function(global) {
  'use strict';
  const PREFIX = 'compatible-';
  const modelCatalog=new Map();
  const storageKey = id => {
    if (!String(id).startsWith(PREFIX)) throw new Error('不是兼容 API 会话，请新建会话');
    return 'llmApiChat:' + id;
  };
  async function config() {
    await global.BjtuLlmDefaults?.ensure();
    const s = await chrome.storage.local.get(['llmApiBaseUrl','llmApiKey','llmApiModel','llmApiPreset','llmApiTemperature','llmApiTopP','llmApiTopK','llmApiMaxTokens','llmApiThinkingProtocol']);
    const url = new URL(s.llmApiBaseUrl || 'http://127.0.0.1:11434/v1');
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址必须为不含账密、查询参数和片段的 HTTP(S) 地址');
    const preset=s.llmApiPreset || (url.hostname.endsWith('agnes-ai.com')||url.hostname.endsWith('agnes-ai.cn')?'agnes':url.hostname==='api.deepseek.com'?'deepseek':url.port==='11434'?'ollama':'custom');
    return {base:url.href.replace(/\/$/,''),key:String(s.llmApiKey || '').trim(),model:String(s.llmApiModel || '').trim(),preset,settings:s};
  }
  function apiError(data,status,key='') {
    let message=String(data?.error?.message || (typeof data?.error==='string'?data.error:'') || data?.message || `兼容 API 请求失败${status?`：HTTP ${status}`:''}`);
    if(key)message=message.split(key).join('[已隐藏密钥]');
    return Object.assign(new Error(message),{status,code:String(data?.error?.code || '')});
  }
  async function request(path,body,signal,nativeOllama=false) {
    const c = await config();
    const timeout = AbortSignal.timeout(120000);
    const response = await fetch((nativeOllama?c.base.replace(/\/v1$/,''):c.base) + path, {
      method: body ? 'POST' : 'GET', credentials:'omit',
      headers:{Accept:body?'text/event-stream, application/json':'application/json',...(body?{'Content-Type':'application/json'}:{}),...(c.key?{Authorization:'Bearer '+c.key}:{})},
      body:body?JSON.stringify(body):undefined, signal:signal?AbortSignal.any([signal,timeout]):timeout
    });
    if(!response.ok) {
      const data=await response.json().catch(()=>null);
      if(response.status===403 && c.preset==='ollama' && !data?.error && !data?.message) {
        throw Object.assign(new Error(`Ollama 拒绝了当前扩展来源（HTTP 403）。请在 OLLAMA_ORIGINS 中允许 chrome-extension://${chrome.runtime.id}，然后完全退出并重启 Ollama`),{status:403});
      }
      throw apiError(data,response.status,c.key);
    }
    return response;
  }
  async function fetchChatHistory(id) {
    const k=storageKey(id); return (await chrome.storage.local.get(k))[k]?.messages || [];
  }
  function create() {
    return {
      isLoggedIn:async()=>{await config();return true;},
      async fetchModels() {
        const data=await (await request('/models')).json();
        if(data.error)throw apiError(data);
        const c=await config();
        const list=(Array.isArray(data.data)?data.data:[]).filter(m=>!m.type || !/image|video|audio|embedding/i.test(m.type));
        modelCatalog.set(c.base,list);if(modelCatalog.size>8)modelCatalog.delete(modelCatalog.keys().next().value);
        return list.map(m=>({...global.BjtuLlmModelInfo.describe(m,'openai',c.preset),id:String(m.id || ''),name:String(m.name || m.id || '')})).filter(m=>m.id);
      },
      async getModelInfo(modelId){
        const c=await config();
        if(!modelCatalog.has(c.base))await this.fetchModels().catch(()=>{});
        const raw=(modelCatalog.get(c.base)||[]).find(m=>m.id===modelId) || {id:modelId};
        let info=global.BjtuLlmModelInfo.describe(raw,'openai',c.preset);
        if(c.preset==='ollama'){
          const show=await(await request('/api/show',{model:modelId},undefined,true)).json();
          if(show.error)throw apiError(show);
          info=global.BjtuLlmModelInfo.describe({...raw,capabilities:show.capabilities},'openai',c.preset);
          const configured=Number(String(show.parameters || '').match(/\bnum_ctx\s+(\d+)/)?.[1]);
          info.contextTokens=configured || Object.entries(show.model_info || {}).filter(([k])=>k.endsWith('.context_length')).map(([,v])=>Number(v)).find(v=>v>0) || info.contextTokens;
        }
        return info;
      },
      async prepareAttachments(files,{modelId}){return global.BjtuLlmModelInfo.validate(files,await this.getModelInfo(modelId));},
      newChat:async()=>{const id=PREFIX+crypto.randomUUID(),c=await config();await chrome.storage.local.set({[storageKey(id)]:{base:c.base,messages:[]}});return id;},
      fetchChatHistory,
      deleteChat:id=>chrome.storage.local.remove(storageKey(id)),
      buildUserMessage:({content,thinking=false,attachments=[]})=>({id:crypto.randomUUID(),role:'user',content:global.BjtuLlmModelInfo.appendText(content,attachments),images:attachments.filter(f=>f.kind==='image').map(f=>f.dataUrl),attachmentNames:attachments.map(f=>f.name),thinking:thinking===true,timestamp:Math.floor(Date.now()/1000)}),
      async streamCompletions({chatId,modelId,messages,parentId,onEvent,signal}) {
        signal?.throwIfAborted();
        const c=await config(),k=storageKey(chatId),stored=(await chrome.storage.local.get(k))[k];
        if(stored?.base!==c.base)throw new Error('API 地址已变更，请新建会话，避免把其他服务的历史发送到当前地址');
        let history=stored?.messages || [];
        if(parentId){const i=history.findIndex(m=>m.id===parentId);if(i<0)throw new Error('父消息不存在，请新建会话');history=history.slice(0,i+1);}else history=[];
        const model=c.model || modelId;
        if(!model)throw new Error('请先选择或填写 API 模型');
        const user={...messages[0],id:crypto.randomUUID()},responseId=crypto.randomUUID();
        const options={};
        for(const [field,key]of Object.entries({temperature:'llmApiTemperature',top_p:'llmApiTopP',top_k:'llmApiTopK',max_tokens:'llmApiMaxTokens'})){
          const raw=c.settings[key];if(raw!==''&&raw!=null&&Number.isFinite(Number(raw)))options[field]=Number(raw);
        }
        const thinking=user.thinking===true;
        const native=c.preset==='ollama';
        let body={model,stream:true,messages:[...history,user].map(({role,content,images=[]})=>native
          ?{role,content,...(images.length?{images:images.map(url=>url.slice(url.indexOf(',')+1))}:{})}
          :{role,content:images.length?[{type:'text',text:content},...images.map(url=>({type:'image_url',image_url:{url}}))]:content})};
        if(native){
          if(options.max_tokens!==undefined){options.num_predict=options.max_tokens;delete options.max_tokens;}
          body={...body,...(c.settings.llmApiThinkingProtocol==='none'?{}:{think:thinking}),options};
        }else{
          if(c.preset==='deepseek'){
            delete options.top_k;
            if(thinking)delete options.temperature;
          }else if(c.preset!=='agnes')delete options.top_k;
          Object.assign(body,options);
          let protocol=c.settings.llmApiThinkingProtocol || 'auto';
          if(protocol==='auto')protocol=c.preset==='deepseek'?'thinking':c.preset==='agnes'?'template':'none';
          if(protocol==='thinking')body.thinking={type:thinking?'enabled':'disabled'};
          if(protocol==='template'){body.chat_template_kwargs={enable_thinking:thinking};if(thinking)body.reasoning_effort='high';}
          if(protocol==='reasoning_effort')body.reasoning_effort=thinking?'high':'none';
        }
        const response=await request(native?'/api/chat':'/chat/completions',body,signal,native);
        let text='',finished=false;
        onEvent?.({responseId,responseParentId:user.id});
        const receive=data=>{
          if(data.error)throw apiError(data,undefined,c.key);
          if(native){
            if(data.message?.thinking)onEvent?.({thinking:data.message.thinking});
            const chunk=data.message?.content;if(chunk){text+=chunk;onEvent?.({text:chunk});}
            if(data.done){finished=true;if(data.done_reason==='length')throw new Error('模型输出达到长度限制，请调整最大输出后重试');}
            return;
          }
          const choice=data.choices?.[0];
          const reasoning=choice?.delta?.reasoning_content || choice?.delta?.reasoning;
          if(reasoning)onEvent?.({thinking:reasoning});
          const chunk=choice?.delta?.content ?? choice?.message?.content ?? '';
          if(typeof chunk==='string'&&chunk){text+=chunk;onEvent?.({text:chunk});}
          if(choice?.finish_reason){finished=true;if(choice.finish_reason==='length')throw new Error('模型输出达到长度限制，请调整服务端限制后重试');}
        };
        if((response.headers.get('content-type') || '').includes('application/json') && !native) {receive(await response.json());finished=true;}
        else {
          const reader=response.body?.getReader();if(!reader)throw new Error('API 未返回可读响应');
          const decoder=new TextDecoder();let buffer='';
          const line=value=>{if(native){if(value.trim())receive(JSON.parse(value));return;}if(!value.startsWith('data:'))return;const payload=value.slice(5).trim();if(payload==='[DONE]'){finished=true;return;}if(payload)receive(JSON.parse(payload));};
          try {
            while(true){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){line(buffer.slice(0,i).replace(/\r$/,''));buffer=buffer.slice(i+1);}if(done){if(buffer.trim())line(buffer);break;}}
          } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
        }
        signal?.throwIfAborted();
        if(!finished)throw new Error('API 响应流意外中断，请重试');
        await chrome.storage.local.set({[k]:{base:c.base,messages:[...history,user,{id:responseId,role:'assistant',content:text,timestamp:Math.floor(Date.now()/1000)}]}});
        return {text,responseId,responseParentId:user.id};
      }
    };
  }
  global.BjtuLlmCompatibleClient={create};
})(globalThis);
