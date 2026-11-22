/* OpenAI-compatible text streaming. Runs in the extension background, not in Node. */
(function(global) {
  'use strict';
  const PREFIX = 'compatible-';
  const storageKey = id => {
    if (!String(id).startsWith(PREFIX)) throw new Error('不是兼容 API 会话，请新建会话');
    return 'llmApiChat:' + id;
  };
  async function config() {
    const s = await chrome.storage.local.get(['llmApiBaseUrl','llmApiKey','llmApiModel']);
    const url = new URL(s.llmApiBaseUrl || 'http://127.0.0.1:11434/v1');
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址必须为不含账密、查询参数和片段的 HTTP(S) 地址');
    return {base:url.href.replace(/\/$/,''),key:String(s.llmApiKey || '').trim(),model:String(s.llmApiModel || '').trim()};
  }
  async function request(path,body,signal) {
    const c = await config();
    const timeout = AbortSignal.timeout(120000);
    const response = await fetch(c.base + path, {
      method: body ? 'POST' : 'GET', credentials:'omit',
      headers:{Accept:body?'text/event-stream, application/json':'application/json',...(body?{'Content-Type':'application/json'}:{}),...(c.key?{Authorization:'Bearer '+c.key}:{})},
      body:body?JSON.stringify(body):undefined, signal:signal?AbortSignal.any([signal,timeout]):timeout
    });
    if(!response.ok) {
      // Do not echo request headers or arbitrary response text (which may include secrets).
      throw new Error(`兼容 API 请求失败：HTTP ${response.status}${response.status===401?'，请检查 API Key':''}${response.status===404?'，请检查 API 基础地址和模型':''}`);
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
        const c=await config();
        try {
          const data=await (await request('/models')).json();
          const models=(Array.isArray(data.data)?data.data:[]).map(m=>({id:String(m.id || ''),name:String(m.name || m.id || '')})).filter(m=>m.id);
          if(c.model&&!models.some(m=>m.id===c.model))models.unshift({id:c.model,name:c.model});
          return models;
        } catch(error) {if(c.model)return [{id:c.model,name:c.model}];throw error;}
      },
      newChat:async()=>{const id=PREFIX+crypto.randomUUID(),c=await config();await chrome.storage.local.set({[storageKey(id)]:{base:c.base,messages:[]}});return id;},
      fetchChatHistory,
      deleteChat:id=>chrome.storage.local.remove(storageKey(id)),
      buildUserMessage:({content})=>({id:crypto.randomUUID(),role:'user',content:String(content)}),
      async streamCompletions({chatId,modelId,messages,parentId,onEvent,signal}) {
        signal?.throwIfAborted();
        const c=await config(),k=storageKey(chatId),stored=(await chrome.storage.local.get(k))[k];
        if(stored?.base!==c.base)throw new Error('API 地址已变更，请新建会话，避免把其他服务的历史发送到当前地址');
        let history=stored?.messages || [];
        if(parentId){const i=history.findIndex(m=>m.id===parentId);if(i<0)throw new Error('父消息不存在，请新建会话');history=history.slice(0,i+1);}else history=[];
        const model=c.model || modelId;
        if(!model)throw new Error('请先选择或填写 API 模型');
        const user={...messages[0],id:crypto.randomUUID()},responseId=crypto.randomUUID();
        const response=await request('/chat/completions',{model,stream:true,messages:[...history,user].map(({role,content})=>({role,content}))},signal);
        let text='',finished=false;
        onEvent?.({responseId,responseParentId:user.id});
        const receive=data=>{
          if(data.error)throw new Error('兼容 API 返回错误，请检查模型、配额或服务端日志');
          const choice=data.choices?.[0];
          const reasoning=choice?.delta?.reasoning_content || choice?.delta?.reasoning;
          if(reasoning)onEvent?.({thinking:reasoning});
          const chunk=choice?.delta?.content ?? choice?.message?.content ?? '';
          if(typeof chunk==='string'&&chunk){text+=chunk;onEvent?.({text:chunk});}
          if(choice?.finish_reason){finished=true;if(choice.finish_reason==='length')throw new Error('模型输出达到长度限制，请调整服务端限制后重试');}
        };
        if((response.headers.get('content-type') || '').includes('application/json')) {receive(await response.json());finished=true;}
        else {
          const reader=response.body?.getReader();if(!reader)throw new Error('API 未返回可读响应');
          const decoder=new TextDecoder();let buffer='';
          const line=value=>{if(!value.startsWith('data:'))return;const payload=value.slice(5).trim();if(payload==='[DONE]'){finished=true;return;}if(payload)receive(JSON.parse(payload));};
          try {
            while(true){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){line(buffer.slice(0,i).replace(/\r$/,''));buffer=buffer.slice(i+1);}if(done){if(buffer.trim())line(buffer);break;}}
          } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
        }
        signal?.throwIfAborted();
        if(!finished)throw new Error('API 响应流意外中断，请重试');
        await chrome.storage.local.set({[k]:{base:c.base,messages:[...history,user,{id:responseId,role:'assistant',content:text}]}});
        return {text,responseId,responseParentId:user.id};
      }
    };
  }
  global.BjtuLlmCompatibleClient={create};
})(globalThis);
