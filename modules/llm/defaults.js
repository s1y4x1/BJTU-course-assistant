(function(global){
  'use strict';
  const values=Object.freeze({
    llmProvider:'openai',
    llmApiPreset:'agnes',
    llmApiBaseUrl:'https://apihub.agnes-ai.com/v1',
    llmApiModel:'agnes-3.0-flash',
    llmApiKey:'sk-mGhEkoGrulPEPWxOcbpXPdSKMJLkuNpAkF770nbBU6CjE8t7',
    llmProactiveEnabled:true,
    llmProactiveOnStartup:true,
    llmProactiveIntervalEnabled:false,
    llmProactiveIntervalMinutes:30,
    llmProactiveIncludeInContext:false
  });
  // 通用 AI 设置只迁移一次；qwen.ai 的令牌、模型和远端会话仍保留原名。
  const legacyKeys = ['Enabled','Provider','FabColorMode','ThinkingEnabled','MaxIterations','AlwaysAllow',
    'ApprovalNotificationMode','CompletionNotificationMode','LastChatId','OpeningPendingChatId','LocalLastChatId'];
  async function migrateSettings() {
    const marker = 'llmSettingsMigrated1';
    const stored = await chrome.storage.local.get([marker, ...legacyKeys.flatMap(name => ['qwen'+name,'llm'+name])]);
    if (stored[marker]) return;
    const patch = {}, remove = [];
    for (const name of legacyKeys) {
      const oldKey='qwen'+name, newKey='llm'+name;
      if (stored[oldKey] === undefined) continue;
      if (stored[newKey] === undefined) patch[newKey]=stored[oldKey];
      remove.push(oldKey);
    }
    const keys = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
    const chats = keys.filter(key=>key.startsWith('qwenLocalChat:'));
    if(chats.length){
      const oldChats=await chrome.storage.local.get(chats);
      const newChats=await chrome.storage.local.get(chats.map(key=>key.replace(/^qwen/,'llm')));
      for(const key of chats){const next=key.replace(/^qwen/,'llm');if(newChats[next]===undefined)patch[next]=oldChats[key];remove.push(key);}
    }
    if(chrome.storage.session){
      const sessions=await chrome.storage.session.get(['qwenChatPermissionSessions','llmChatPermissionSessions']);
      if(sessions.qwenChatPermissionSessions!==undefined){
        await chrome.storage.session.set({llmChatPermissionSessions:{...sessions.qwenChatPermissionSessions,...sessions.llmChatPermissionSessions}});
        await chrome.storage.session.remove('qwenChatPermissionSessions');
      }
    }
    await chrome.storage.local.set(patch);
    if(remove.length)await chrome.storage.local.remove(remove);
    await chrome.storage.local.set({[marker]:true});
  }
  let pending;
  function ensure(){
    return pending ||= (async()=>{
      if(global.navigator?.locks)await navigator.locks.request('bjtu-llm-settings-migration',migrateSettings);
      else await migrateSettings();
      const stored=await chrome.storage.local.get(Object.keys(values));
      const missing=Object.fromEntries(Object.entries(values).filter(([key])=>stored[key]===undefined));
      if(Object.keys(missing).length)await chrome.storage.local.set(missing);
    })().catch(error=>{pending=null;throw error;});
  }
  global.BjtuLlmDefaults={ensure,values};
})(globalThis);
