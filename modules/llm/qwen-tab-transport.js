/* Stream completions through Qwen's own page environment (cookies and fetch hooks). */
(function(global) {
  'use strict';
  const ORIGIN='https://chat.qwen.ai';
  const opening=new Map(),activeTabs=new Map();
  async function tabFor(chatId,signal) {
    signal?.throwIfAborted();
    if(opening.has(chatId))return opening.get(chatId);
    const pending=(async()=>{
      const url=chatId?`${ORIGIN}/c/${encodeURIComponent(chatId)}`:ORIGIN+'/';
      const tabs=await chrome.tabs.query({url:ORIGIN+'/*'});
      let tab=tabs.find(t=>t.url===url);
      if(!tab){
        const stored=await chrome.storage.session.get('qwenRequestTabId');
        tab=tabs.find(t=>t.id===stored.qwenRequestTabId&&!activeTabs.get(t.id));
        signal?.throwIfAborted();
        tab=tab?await chrome.tabs.update(tab.id,{url,autoDiscardable:false}):await chrome.tabs.create({url,active:false});
        await chrome.storage.session.set({qwenRequestTabId:tab.id});
      }
      if(tab.status!=='complete')await new Promise((resolve,reject)=>{
        let timer;
        const cleanup=()=>{clearTimeout(timer);chrome.tabs.onUpdated.removeListener(update);chrome.tabs.onRemoved.removeListener(removed);signal?.removeEventListener('abort',abort);};
        const finish=error=>{cleanup();error?reject(error):resolve();};
        const update=(id,change)=>{if(id===tab.id&&change.status==='complete')finish();};
        const removed=id=>{if(id===tab.id)finish(new Error('Qwen 请求标签页已关闭'));};
        const abort=()=>finish(signal.reason || new DOMException('生成中止','AbortError'));
        chrome.tabs.onUpdated.addListener(update);chrome.tabs.onRemoved.addListener(removed);
        signal?.addEventListener('abort',abort,{once:true});
        timer=setTimeout(()=>finish(new Error('Qwen 页面加载超时，请在浏览器中完成登录或验证后重试')),60000);
        // Cover completion between tabs.query/create and listener registration.
        chrome.tabs.get(tab.id).then(t=>{if(t.status==='complete')finish();},finish);
        if(signal?.aborted)abort();
      });
      signal?.throwIfAborted();
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['modules/llm/content-script.js']});
      return tab;
    })();
    opening.set(chatId,pending);
    try{return await pending;}finally{if(opening.get(chatId)===pending)opening.delete(chatId);}
  }

  // Serialized by chrome.scripting, never evaluates downloaded code.
  function startPageFetch({id,url,method,body,authorization}) {
    if(location.origin!=='https://chat.qwen.ai')throw new Error('Qwen 页面来源不匹配');
    const target=new URL(url);
    if(target.origin!==location.origin||!['/api/v2/chat/completions','/api/v2/chats/new'].includes(target.pathname)||!['GET','POST'].includes(method))throw new Error('Qwen 请求地址无效');
    const controller=new AbortController();let awaiting,sequence=0;
    const post=(type,payload={})=>window.postMessage({source:'BJTU_QWEN_PAGE_FETCH',id,type,...payload},location.origin);
    const control=event=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.source!=='BJTU_QWEN_PAGE_CONTROL'||event.data.id!==id)return;
      if(event.data.type==='cancel'){controller.abort();awaiting?.reject(new DOMException('请求已取消','AbortError'));}
      if(event.data.type==='ack'&&event.data.sequence===awaiting?.sequence)awaiting.resolve();
    };
    window.addEventListener('message',control);
    void (async()=>{
      let reader;
      try{
        let token='',version='';
        const entry=[...document.scripts].find(script=>script.type==='module' && /^https:\/\/assets\.alicdn\.com\/g\/qwenweb\/qwen-chat-fe\/[^/]+\/js\/main\.js(?:\?|$)/.test(script.src));
        if(entry){
          version=new URL(entry.src).pathname.split('/qwen-chat-fe/')[1].split('/')[0];
          // Import the already loaded page entry from the browser's module cache.
          // Discover the existing singleton by its public methods, not minified names.
          const exports=await import(entry.src);
          const manager=Object.values(exports).find(value=>value && typeof value.ensureValidToken==='function' && typeof value.getAccessToken==='function');
          if(manager){
            token=await manager.ensureValidToken();
            if(!token)throw new Error('Qwen 尚未登录，请先在打开的 Qwen 标签页中完成登录后重试');
          }
        }
        if(!token)try{
          const state=JSON.parse(localStorage.getItem('qwen_access_token_state') || 'null');
          if(state?.token && Number(state.expiresAt)>Date.now())token=state.token;
          if(!token)for(const key of ['token','access_token','qwen_token','jwt_token']){token=localStorage.getItem(key)||'';if(token)break;}
        }catch{}
        if(window.baxiaCommon || window.__baxia__){
          const deadline=Date.now()+8000;
          while(!controller.signal.aborted && Date.now()<deadline){
            if(window.baxiaInitialized && window.__baxia__?.getFYModule?.()?.getUidToken?.())break;
            await new Promise(resolve=>setTimeout(resolve,200));
          }
        }
        controller.signal.throwIfAborted();
        if(token)post('token',{token});
        const response=await window.fetch(target.href,{
          method,credentials:'include',body:method==='POST'?body:undefined,signal:controller.signal,
          headers:{Accept:method==='GET'?'text/event-stream':'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{}),...(token||authorization?{Authorization:token?'Bearer '+token:authorization}:{}),...(version?{Version:version}:{}),source:'web',timezone:new Date().toString().replace(/ \([^)]*\)$/,''),'X-Request-Id':crypto.randomUUID(),'X-Accel-Buffering':'no'}
        });
        post('headers',{status:response.status,statusText:response.statusText,headers:[...response.headers]});
        const send=async text=>{
          for(let offset=0;offset<text.length;){
            // Do not split a UTF-16 surrogate pair between port messages.
            let end=Math.min(text.length,offset+16384);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
            let timer;
            try{await new Promise((resolve,reject)=>{
              awaiting={sequence:++sequence,resolve,reject};
              timer=setTimeout(()=>reject(new Error('扩展未继续读取 Qwen 响应')),30000);
              post('chunk',{text:text.slice(offset,end),sequence});
            });}finally{clearTimeout(timer);awaiting=null;}
            offset=end;
          }
        };
        if(response.body){
          reader=response.body.getReader();const decoder=new TextDecoder();
          while(true){const {value,done}=await reader.read();const text=done?decoder.decode():decoder.decode(value,{stream:true});if(text)await send(text);if(done)break;}
        }else await send(await response.text());
        post('end');
      }catch(error){post('error',{message:String(error?.message||error),name:error?.name||'Error'});}
      finally{controller.abort();await reader?.cancel().catch(()=>{});reader?.releaseLock();window.removeEventListener('message',control);}
    })();
    return {started:true};
  }

  async function fetchInTab(url,options) {
    let tab;
    try{tab=await tabFor(new URL(url).searchParams.get('chat_id'),options.signal);}
    catch(error){if(error.name==='AbortError')throw error;throw Object.assign(error,{code:'QWEN_TAB_UNAVAILABLE'});}
    options.signal?.throwIfAborted();
    activeTabs.set(tab.id,(activeTabs.get(tab.id)||0)+1);
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),encoder=new TextEncoder();
      let port,streamController,headerReceived=false,closed=false,timer,pendingAck;
      const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);const count=(activeTabs.get(tab.id)||1)-1;if(count)activeTabs.set(tab.id,count);else activeTabs.delete(tab.id);try{port?.disconnect();}catch{}};
      const fail=error=>{if(closed)return;closed=true;cleanup();if(headerReceived)streamController?.error(error);else reject(error);};
      const resetTimeout=()=>{clearTimeout(timer);timer=setTimeout(()=>fail(Object.assign(new Error(headerReceived?'Qwen 响应长时间未继续，请重试':'Qwen 页面请求超时，请在该标签页中检查登录或风控验证'),{code:'QWEN_TAB_TIMEOUT'})),headerReceived?120000:60000);};
      const abort=()=>fail(options.signal.reason || new DOMException('生成中止','AbortError'));
      const ack=()=>{if(!closed&&pendingAck!=null){port.postMessage({type:'ack',sequence:pendingAck});pendingAck=null;}};
      const stream=new ReadableStream({start(c){streamController=c;},pull(){ack();},cancel(){if(!closed){closed=true;cleanup();}}});
      try{
        port=chrome.tabs.connect(tab.id,{name:'bjtu-qwen-fetch:'+id});
        port.onDisconnect.addListener(()=>fail(Object.assign(new Error('Qwen 请求标签页连接已断开，请检查该页面后重试'),{code:'QWEN_TAB_CLOSED'})));
        port.onMessage.addListener(message=>{
          if(closed)return;
          resetTimeout();
          if(message.type==='token'){
            void global.BjtuQwenClient?.captureToken?.(message.token).catch(()=>{});
          }else if(message.type==='ready'){
            void chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:startPageFetch,args:[{id,url,method:options.method||'POST',body:options.body,authorization:options.headers?.Authorization||''}]}).catch(error=>fail(Object.assign(error,{code:'QWEN_TAB_UNAVAILABLE'})));
          }else if(message.type==='headers'){
            try{
              const response=new Response([204,205,304].includes(message.status)?null:stream,{status:message.status,statusText:message.statusText,headers:message.headers});
              headerReceived=true;resolve(response);
            }catch(error){fail(error);}
          }else if(message.type==='chunk'){
            streamController.enqueue(encoder.encode(message.text));pendingAck=message.sequence;
            if(streamController.desiredSize>0)ack();
          }else if(message.type==='end'){
            closed=true;streamController.close();cleanup();
          }else if(message.type==='error')fail(Object.assign(new Error(message.message),{name:message.name,code:'QWEN_TAB_REQUEST_FAILED'}));
        });
        options.signal?.addEventListener('abort',abort,{once:true});
        resetTimeout();port.postMessage({type:'init'});
        if(options.signal?.aborted)abort();
      }catch(error){fail(error);}
    });
  }
  global.BjtuQwenTabTransport={fetch:fetchInTab};
})(globalThis);
