(function(global){
  'use strict';
  function setup(content){
    if(!content?.isConnected||content.dataset.collapseReady)return;
    const maxHeight=Math.max(160,Math.min(640,Math.floor(global.innerHeight*0.55)));
    if(content.scrollHeight<=maxHeight+8)return;
    content.dataset.collapseReady='1';content.style.maxHeight=`${maxHeight}px`;content.classList.add('message-text-collapsed');
    const toggle=document.createElement('button');toggle.type='button';toggle.className='message-expand';toggle.textContent='展开全文';
    toggle.addEventListener('click',()=>{
      const collapsed=content.classList.toggle('message-text-collapsed');content.style.maxHeight=collapsed?`${maxHeight}px`:'';toggle.textContent=collapsed?'展开全文':'收起';
    });
    content.after(toggle);
  }
  global.BjtuMessageCollapse={setup};
})(globalThis);
