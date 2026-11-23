(function(global){
  'use strict';
  let files=[],info={},revision=0,preview=null,parser=null,selfName='我',draftStartedAt=0;
  const node=id=>document.getElementById(`llm-chat-${id}`);
  let contextReader=()=>[],contextTimer=null;
  const estimateTokens=text=>Math.ceil([...String(text || '')].reduce((n,c)=>n+(/[\u0000-\u007f]/.test(c)?0.3:1),0));
  function updateCounters(){
    const text=node('input')?.value || '';
    const bytes=new TextEncoder().encode(text).length+files.reduce((n,f)=>n+f.size,0);
    const input=global.BjtuLlmModelInfo.appendText(text,files);
    const inputTokens=estimateTokens(input),images=files.some(file=>file.kind==='image')?'（未计图片 token）':'';
    const counter=node('message-size');
    if(counter){counter.textContent=`${bytes.toLocaleString()} B · 输入约 ${inputTokens.toLocaleString()} tokens / ${info.inputTokens?`${info.inputTokens.toLocaleString()} tokens`:'输入上限未知'}${images}`;counter.title='Token 数为估计值；输入上限不使用上下文上限代替。附件合计上限 16 MiB';}
    const context=node('context-size');
    if(context){const tokens=contextReader().reduce((n,value)=>n+estimateTokens(value),0)+inputTokens;context.textContent=`上下文约 ${tokens.toLocaleString()} tokens / ${info.contextTokens?`${info.contextTokens.toLocaleString()} tokens`:'上下文上限未知'}${images}`;context.title='估算系统提示词、当前会话历史与草稿；不含尚未生成的回复、服务端内部提示词及图片 token，实际用量以模型服务为准';}
  }
  function scheduleContextUpdate(){
    if(contextTimer!==null)return;
    contextTimer=setTimeout(()=>{contextTimer=null;updateCounters();},100);
  }
  function update(){
    const text=node('input')?.value || '';
    updateCounters();
    const list=node('attachments');
    if(list){list.replaceChildren();files.forEach((file,i)=>{const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`${file.name} ×`;button.addEventListener('click',()=>{files.splice(i,1);update();});list.append(button);});}
    if(preview)preview.remove();preview=null;
    if(!text)draftStartedAt=0;
    if(node('preview')?.checked&&text){
      draftStartedAt ||= Date.now();
      preview=document.createElement('article');preview.className='message mine message-draft llm-chat-draft';preview.dataset.draft='true';
      const label=document.createElement('div');label.className='message-draft-label';label.textContent='预览 · 未发送';
      const header=document.createElement('div');header.className='muted message-author';
      const name=document.createElement('strong');name.className='message-author-name';name.dataset.llmAuthor='user';name.textContent=selfName;name.tabIndex=0;name.setAttribute('role','button');name.title='修改昵称';
      const edit=()=>global.parent.postMessage({type:'BJTU_LLM_EDIT_NAME',role:'user'},global.location.origin);
      name.addEventListener('click',edit);name.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();edit();}});
      const time=document.createElement('span');global.BjtuDateTime.set(time,draftStartedAt);header.append(name,document.createTextNode(' · '),time);
      const body=document.createElement('div');body.className='message-text bjtu-markdown';parser ||= global.BjtuMarkdown.createChatParser();body.innerHTML=parser.parse(text);
      preview.append(label,header,body);node('messages').append(preview);
    }
  }
  async function refresh(){
    const version=++revision,button=node('pick-file');if(!button)return;
    button.disabled=true;
    try{const response=await chrome.runtime.sendMessage({type:'LLM_MODEL_INFO',payload:{modelId:node('model')?.value}});if(version!==revision)return;info=response?.ok?response.info:{};}catch{if(version!==revision)return;info={};}
    button.disabled=!(info.images||info.textFiles);button.textContent=info.textFiles?'发送文件':info.images?'发送图片':'发送文件';button.title=info.attachmentNote || '未获取到模型附件能力';
    node('file-picker').accept=[...(info.textFiles?(info.textExtensions || []).map(ext=>`.${ext}`):[]),...(info.images?['image/png','image/jpeg','image/webp','image/gif']:[])].join(',');update();
  }
  async function mount(){
    const response=await fetch(chrome.runtime.getURL('modules/chatroom/chat.html'));
    if(!response.ok)throw new Error('无法加载聊天室输入区');
    const template=new DOMParser().parseFromString(await response.text(),'text/html').querySelector('form.composer');
    const old=node('input-form'),form=document.importNode(template,true);
    form.querySelectorAll('#paste-message-file,#share-screen,#stop-screen').forEach(el=>el.remove());
    const ids={'message-form':'input-form',message:'input','message-size':'message-size','pick-file':'pick-file','file-picker':'file-picker','share-draft':'thinking','share-draft-label':'thinking-label','draft-preview':'preview','send-shortcut':'send-shortcut',send:'send'};
    [form,...form.querySelectorAll('[id]')].forEach(el=>{if(ids[el.id])el.id=`llm-chat-${ids[el.id]}`;});
    form.classList.add('llm-chat-composer');form.querySelector('textarea').classList.add('llm-chat-input');
    form.querySelector('#llm-chat-thinking-label').textContent='思考';
    const ops=old.querySelector('.llm-chat-ops-toggle-wrap'),stop=node('stop');
    if(ops)form.querySelector('.composer-footer > .actions').append(ops);
    if(stop)form.querySelector('.composer-send-actions').append(stop);
    old.replaceWith(form);
    const counters=document.createElement('span');counters.className='llm-chat-token-counters';
    const inputCounter=node('message-size');inputCounter.replaceWith(counters);counters.append(inputCounter);
    const contextCounter=document.createElement('span');contextCounter.id='llm-chat-context-size';contextCounter.className='composer-message-size';counters.append(contextCounter);
    const chips=document.createElement('div');chips.id='llm-chat-attachments';chips.className='actions';form.querySelector('textarea').after(chips);
    const settings=await chrome.storage.local.get(['chatroomSendShortcut','chatroomDraftPreviewEnabled']);
    node('send-shortcut').value=settings.chatroomSendShortcut==='ctrl-enter'?'ctrl-enter':'enter';
    node('preview').checked=settings.chatroomDraftPreviewEnabled===true;
    const placeholder=()=>{node('input').placeholder=node('send-shortcut').value==='ctrl-enter'?'Ctrl+Enter 发送，Enter / Shift+Enter 换行；支持 Markdown 语法':'Enter 发送，Ctrl+Enter / Shift+Enter 换行；支持 Markdown 语法';};placeholder();
    node('send-shortcut').addEventListener('change',()=>{placeholder();void chrome.storage.local.set({chatroomSendShortcut:node('send-shortcut').value});});
    node('preview').addEventListener('change',()=>{void chrome.storage.local.set({chatroomDraftPreviewEnabled:node('preview').checked});update();});
    node('input').addEventListener('input',update);
    node('input').addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing)return;
      const ctrl=event.ctrlKey||event.metaKey;
      const send=!event.shiftKey && ctrl===(node('send-shortcut').value==='ctrl-enter');
      if(send){event.preventDefault();form.requestSubmit();}
      else if(ctrl){
        // Chromium 不会为 Ctrl+Enter 原生插入换行，需显式替换选区。
        event.preventDefault();
        const input=event.currentTarget;
        input.setRangeText('\n',input.selectionStart,input.selectionEnd,'end');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }
    });
    node('pick-file').addEventListener('click',()=>node('file-picker').click());
    node('file-picker').addEventListener('change',async event=>{
      try{const additions=[];for(const file of event.target.files){if(file.size>16*1024*1024)throw new Error('附件合计不能超过 16 MiB');if(/^image\/(png|jpeg|webp|gif)$/.test(file.type)&&info.images){const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});additions.push({kind:'image',name:file.name,size:file.size,dataUrl});}else{const ext=file.name.split('.').pop().toLowerCase();if(!info.textFiles||!info.textExtensions.includes(ext))throw new Error('该接口不支持此文件类型');additions.push({kind:'text',name:file.name,size:file.size,text:await file.text()});}}const all=[...files,...additions];global.BjtuLlmModelInfo.validate(all,info);files=all;update();}catch(error){global.alert(error.message);}finally{event.target.value='';}
    });
    void refresh();update();
  }
  global.BjtuLlmComposer={mount,refresh,update,scheduleContextUpdate,setContextReader:reader=>{contextReader=reader;updateCounters();},setSelfName:value=>{selfName=String(value||'我');},files:()=>files.slice(),clear:()=>{files=[];update();}};
})(globalThis);
