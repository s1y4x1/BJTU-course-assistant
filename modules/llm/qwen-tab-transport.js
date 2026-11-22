/* Background-first Qwen requests. Page-only security work may reuse an existing tab. */
(function(global) {
  'use strict';
  const ORIGIN='https://chat.qwen.ai';
  const AUTH_REFRESH='https://auth.qwen.ai/api/v2/auths/refresh';
  let preparation,validatedToken='',authHeadersReady;
  function withAbort(promise,signal) {
    if(!signal)return promise;
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason || new DOMException('请求已取消','AbortError'));
      signal.addEventListener('abort',abort,{once:true});
      promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
  function expiresAt(token) {
    try{const payload=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return Number(JSON.parse(atob(payload)).exp)*1000 || 0;}catch{return 0;}
  }
  async function prepareBackground() {
    if(preparation)return preparation;
    preparation=(async()=>{
      const stored=await chrome.storage.session.get(['qwenToken','qwenWebContext']);
      let context=stored.qwenWebContext;
      if(!context?.version || Date.now()-Number(context.checkedAt || 0)>6*60*60*1000){
        const response=await fetch(ORIGIN+'/',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000)});
        const html=await response.text();
        const version=html.match(/assets\.alicdn\.com\/g\/qwenweb\/qwen-chat-fe\/([^/\s"'<>]+)\/js\/main\.js/)?.[1];
        if(!response.ok || !version)throw new Error('后台未能读取 Qwen 当前网页版本，请先在站点完成登录或安全验证');
        context={version,checkedAt:Date.now()};
        await chrome.storage.session.set({qwenWebContext:context});
      }
      let token=String(stored.qwenToken || '');
      if(token && token===validatedToken && expiresAt(token)>Date.now()+180000)return {token,version:context.version};
      authHeadersReady ||= (async()=>{
        if(!chrome.declarativeNetRequest?.updateSessionRules)return;
        await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[914314],addRules:[{
          id:914314,priority:1,action:{type:'modifyHeaders',requestHeaders:[
            {header:'Origin',operation:'set',value:ORIGIN},{header:'Referer',operation:'set',value:ORIGIN+'/'}
          ]},condition:{urlFilter:'|'+AUTH_REFRESH,initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest']}
        }]});
      })().catch(error=>{authHeadersReady=null;throw error;});
      await authHeadersReady;
      const response=await fetch(AUTH_REFRESH,{
        credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000),
        headers:{Accept:'application/json',Version:context.version,source:'web',Timezone:new Date().toString().replace(/ \([^)]*\)$/,''),'X-Request-Id':crypto.randomUUID(),'x-request-origin':ORIGIN}
      });
      const data=await response.json().catch(()=>null);
      token=String(data?.data?.access_token || '');
      if(!response.ok || data?.success!==true || !token)throw new Error(String(data?.data?.message || data?.data?.details || `Qwen 后台会话校验失败（HTTP ${response.status}），请在站点确认登录状态`));
      await chrome.storage.session.set({qwenToken:token});validatedToken=token;
      return {token,version:context.version};
    })();
    try{return await preparation;}finally{preparation=null;}
  }
  async function fetchBackgroundFirst(url,options={}) {
    options.signal?.throwIfAborted();
    const target=new URL(url);
    if(target.origin!==ORIGIN || !['/api/v2/chat/completions','/api/v2/chats/new'].includes(target.pathname))throw new Error('Qwen 请求地址无效');
    let context;
    try{context=await withAbort(prepareBackground(),options.signal);}
    catch(error){
      if(error.name==='AbortError' || options.signal?.aborted)throw error;
      // No generation request has been sent yet: it is safe to try the existing page.
      const tabs=chrome.tabs?.query?await chrome.tabs.query({url:ORIGIN+'/*'}):[];
      if(tabs.length)return fetchInTab(url,options);
      throw Object.assign(new Error(`${error.message}；不会自动打开新标签页`),{code:'QWEN_BACKGROUND_PREPARE_FAILED'});
    }
    options.signal?.throwIfAborted();
    try{
      return await fetch(url,{...options,credentials:'include',headers:{...options.headers,Authorization:'Bearer '+context.token,Version:context.version}});
    }catch(error){
      if(error.name==='AbortError' || options.signal?.aborted)throw error;
      // Do not replay a POST after a network failure: the server may have received it.
      throw Object.assign(new Error(`Qwen 后台请求失败：${error.message}`),{code:'QWEN_BACKGROUND_REQUEST_FAILED'});
    }
  }
  async function tabFor(chatId,signal) {
    signal?.throwIfAborted();
      const url=chatId?`${ORIGIN}/c/${encodeURIComponent(chatId)}`:ORIGIN+'/';
      const tabs=await chrome.tabs.query({url:ORIGIN+'/*'});
      const tab=tabs.find(t=>t.url===url) || tabs.find(t=>t.active) || tabs[0];
      if(!tab)throw new Error('Qwen 需要网页安全验证，但当前没有已打开的 Qwen 页面；不会自动打开新标签页');
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
            if(window.baxiaInitialized){
              try{
                const sdk=window.__baxia__;
                const module=typeof sdk?.getFYModule==='function'?sdk.getFYModule():sdk?.getFYModule;
                if(!module || typeof module.getUidToken!=='function' || module.getUidToken())break;
              }catch{break;}
            }
            await new Promise(resolve=>setTimeout(resolve,200));
          }
        }
        controller.signal.throwIfAborted();
        if(version)post('context',{version});
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
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID(),encoder=new TextEncoder();
      let port,streamController,headerReceived=false,closed=false,timer,pendingAck;
      const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);try{port?.disconnect();}catch{}};
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
            validatedToken=String(message.token || '');
            void global.BjtuQwenClient?.captureToken?.(message.token).catch(()=>{});
          }else if(message.type==='context'){
            void chrome.storage.session.set({qwenWebContext:{version:String(message.version || ''),checkedAt:Date.now()}}).catch(()=>{});
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
  global.BjtuQwenTabTransport={fetch:fetchBackgroundFirst,fetchInTab};
})(globalThis);
