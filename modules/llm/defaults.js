(function(global){
  'use strict';
  const values=Object.freeze({
    qwenProvider:'openai',
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
  let pending;
  function ensure(){
    return pending ||= (async()=>{
      const stored=await chrome.storage.local.get(Object.keys(values));
      const missing=Object.fromEntries(Object.entries(values).filter(([key])=>stored[key]===undefined));
      if(Object.keys(missing).length)await chrome.storage.local.set(missing);
    })().catch(error=>{pending=null;throw error;});
  }
  global.BjtuLlmDefaults={ensure,values};
})(globalThis);
