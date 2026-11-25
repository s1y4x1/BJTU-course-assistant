(function(global){
  'use strict';
  if(!/\/app\/app\.html$/i.test(location.pathname)||new URLSearchParams(location.search).has('autoUpdate')||global.__bjtuLlmProactiveStarted)return;
  global.__bjtuLlmProactiveStarted=true;
  let closed=false,timer=null,busy=false,settings={},started=false;
  const keys=['llmProactiveEnabled','llmProactiveOnStartup','llmProactiveIntervalEnabled','llmProactiveIntervalMinutes'];
  const pause=()=>new Promise(resolve=>setTimeout(resolve,500));
  function schedule(){
    clearTimeout(timer);timer=null;
    if(closed||busy||settings.llmProactiveEnabled===false||settings.llmProactiveIntervalEnabled!==true)return;
    const minutes=Number(settings.llmProactiveIntervalMinutes);
    const due=Date.now()+(Number.isFinite(minutes)&&minutes>=1?minutes:30)*60000;
    const wait=()=>{
      if(closed)return;
      const remaining=due-Date.now();
      if(remaining>0){timer=setTimeout(wait,Math.min(remaining,2147483647));return;}
      void generate('interval');
    };
    wait();
  }
  async function generate(reason){
    if(closed||busy||settings.llmProactiveEnabled===false)return;
    busy=true;
    try{
      await global.__bjtuAppInitialization;
      let stable=0;
      while(!closed&&stable<2){
        const pending=Object.entries(global.platformLoadPending||{}).some(([id,value])=>global.platformEnabled?.[id]&&value);
        const checking=Object.entries(global.platformLoginState||{}).some(([id,state])=>global.platformEnabled?.[id]&&state==='checking');
        stable=checking||pending?0:stable+1;
        await pause();
      }
      if(closed||settings.llmProactiveEnabled===false)return;
      if(reason==='startup'&&settings.llmProactiveOnStartup===false)return;
      if(reason==='interval'&&settings.llmProactiveIntervalEnabled!==true)return;
      const snapshot=global.BjtuLlmProactive.sanitize(await global.__bjtuLlmPageSnapshot?.());
      const response=await chrome.runtime.sendMessage({type:'LLM_PROACTIVE',payload:{id:crypto.randomUUID(),snapshot,reason}});
      if(response?.localPrompt){
        const text=await global.BjtuLlmLocalModel.generateText(response.localPrompt);
        if(!closed)await chrome.runtime.sendMessage({type:'LLM_PROACTIVE_RESULT',payload:{id:response.requestId,text}});
      }else if(response?.ok===false)throw new Error(response.message);
    }catch(error){if(!closed)console.warn('[llm] 主动消息生成失败：',error);}
    finally{busy=false;schedule();}
  }
  global.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);},{once:true});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local'||!keys.some(key=>changes[key]))return;
    for(const key of keys)if(changes[key])settings[key]=changes[key].newValue;
    if(started)schedule();
  });
  void chrome.storage.local.get(keys).then(async stored=>{
    settings=stored;await global.__bjtuAppInitialization;started=true;
    if(settings.llmProactiveOnStartup!==false)await generate('startup');else schedule();
  }).catch(error=>console.warn('[llm] 主动消息设置加载失败：',error));
})(globalThis);
