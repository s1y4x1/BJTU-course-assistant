(function(global){
  'use strict';
  if(!/\/app\/app\.html$/i.test(location.pathname)||new URLSearchParams(location.search).has('autoUpdate')||new URLSearchParams(location.search).get('view')==='sidepanel'||new URLSearchParams(location.search).get('popup')==='1')return;
  const pause=()=>new Promise(resolve=>setTimeout(resolve,150));
  async function sendPrompt(text, options){
    const stored=await chrome.storage.local.get('llmEnabled');
    const available=await global.BjtuModuleRegistry.ready;
    if(available.chatroom&&stored.llmEnabled===false){
      await global.BjtuModuleRegistry.loadScript('modules/chatroom/launch.js');
      await global.BjtuChatroomLauncher.open();
      const deadline=Date.now()+20000;
      while(Date.now()<deadline){
        const ui=document.querySelector('#chatroom-module-window iframe')?.contentWindow?.BjtuChatroomUi;
        if(ui)return ui.sendAssistantPrompt(text, options);
        await pause();
      }
      throw new Error('聊天室尚未就绪，请稍后重试');
    }
    return global.BjtuLlmChat.sendPrompt(text, options);
  }
  void(async()=>{
    await global.__bjtuAppInitialization;
    const reminder=await chrome.storage.local.get(['llmRestyleReminderMode','llmRestyleReminderDismissed']);
    if(reminder.llmRestyleReminderMode==='never'||reminder.llmRestyleReminderDismissed===true)return;
    while([...document.querySelectorAll('.version-modal-mask')].some(node=>node.getClientRects().length))await pause();
    const mask=document.createElement('div');mask.id='llm-restyle-reminder';mask.className='version-modal-mask';mask.style.display='flex';
    mask.innerHTML='<section class="version-modal-card" role="dialog" aria-modal="true" aria-labelledby="llm-restyle-title"><div class="version-modal-header"><h2 id="llm-restyle-title">使用 AI 助手为扩展焕新</h2></div><div class="bjtu-dialog-actions"><button type="button" class="btn bjtu-dialog-primary" data-action="try">尝试圣诞风格</button><button type="button" class="btn bjtu-dialog-danger" data-action="never">不再提醒</button><button type="button" class="btn bjtu-dialog-secondary" data-action="later">稍后再说</button></div></section>';
    document.body.append(mask);
    mask.querySelector('[data-action="later"]').addEventListener('click',()=>mask.remove());
    mask.querySelector('[data-action="never"]').addEventListener('click',async()=>{
      try{
        const stored=await chrome.storage.local.get('apiStartupScript');
        await chrome.storage.local.set({llmRestyleReminderMode:'never',llmRestyleReminderDismissed:true,apiStartupScript:{...stored.apiStartupScript,enabled:false}});
        mask.remove();
      }catch(error){global.showToast?.(error.message,'error');}
    });
    mask.querySelector('[data-action="try"]').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{
        const response=await fetch(chrome.runtime.getURL('modules/llm/restyle-christmas.md'));
        if(!response.ok)throw new Error(`无法读取圣诞风格提示词：HTTP ${response.status}`);
        mask.style.display='none';
        await sendPrompt(await response.text(),{withSystemPrompt:true});mask.remove();
      }catch(error){mask.style.display='flex';button.disabled=false;global.showToast?.(error.message,'error');}
    });
  })().catch(error=>console.warn('[llm] 风格推荐弹窗加载失败：',error));
})(globalThis);
