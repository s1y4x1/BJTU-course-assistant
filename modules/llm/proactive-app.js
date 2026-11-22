(function(global){
  'use strict';
  if(!/\/app\/app\.html$/i.test(location.pathname)||new URLSearchParams(location.search).has('autoUpdate')||global.__bjtuLlmProactiveStarted)return;
  global.__bjtuLlmProactiveStarted=true;
  let closed=false;global.addEventListener('pagehide',()=>{closed=true;},{once:true});
  const pause=()=>new Promise(resolve=>setTimeout(resolve,500));
  void(async()=>{
    const initial=await chrome.storage.local.get('llmProactiveEnabled');if(initial.llmProactiveEnabled===false)return;
    await global.__bjtuAppInitialization;
    let stable=0;
    while(!closed&&stable<2){
      const pending=Object.entries(global.platformLoadPending||{}).some(([id,pending])=>global.platformEnabled?.[id]&&pending);
      const checking=Object.entries(global.platformLoginState||{}).some(([id,state])=>global.platformEnabled?.[id]&&state==='checking');
      if(checking||pending)stable=0;else stable++;
      await pause();
    }
    if(closed)return;
    const settings=await chrome.runtime.sendMessage({type:'QWEN_GET_STATUS',payload:{checkLogin:false}});
    if(settings?.proactiveEnabled===false)return;
    const snapshot=global.BjtuLlmProactive.sanitize(await global.__bjtuLlmPageSnapshot?.());
    const response=await chrome.runtime.sendMessage({type:'LLM_PROACTIVE',payload:{id:crypto.randomUUID(),snapshot}});
    if(response?.localPrompt){
      const text=await global.BjtuQwenLocalModel.generateText(response.localPrompt);
      await chrome.runtime.sendMessage({type:'LLM_PROACTIVE_RESULT',payload:{id:response.requestId,text}});
    }else if(response?.ok===false)throw new Error(response.message);
  })().catch(error=>{if(!closed)console.warn('[llm] 主动消息生成失败：',error);});
})(globalThis);
