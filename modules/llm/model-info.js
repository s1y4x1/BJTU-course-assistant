(function(global){
  'use strict';
  const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
  const textExtensions='txt,md,markdown,csv,tsv,json,jsonl,xml,yaml,yml,toml,ini,log,html,htm,css,js,mjs,cjs,ts,tsx,jsx,py,java,c,cpp,h,hpp,rs,go,sh,ps1,sql,tex'.split(',');
  function describe(raw={},provider='openai',preset='custom'){
    const meta=raw.info?.meta || raw.meta || {},cap=raw.capabilities || meta.capabilities || {};
    const modalities=raw.input_modalities || raw.architecture?.input_modalities || meta.input_modalities || [];
    const has=name=>Array.isArray(cap)?cap.includes(name):cap[name]===true;
    const images=has('vision')||has('image')||modalities.includes('image')||raw.supports_vision===true;
    const documents=has('document')||has('file')||modalities.includes('file')||modalities.includes('document');
    return {
      id:raw.id || '',inputTokens:positive(raw.max_input_tokens || raw.input_token_limit || raw.limits?.max_input_tokens || meta.max_input_tokens),
      contextTokens:positive(raw.context_window || raw.context_length || raw.max_context_length || raw.top_provider?.context_length || meta.max_context_length),
      images:provider==='openai'&&images,textFiles:documents,
      attachmentNote:provider==='qwen'?'当前接入支持纯文本、Markdown 和代码文件，内容作为文本发送；图片及二进制文档请在原站上传':documents?'支持图片及纯文本/代码文件；二进制文档暂不接入':images?'支持 PNG、JPEG、WebP、GIF 图片':'当前模型未公开可用的附件能力',
      textExtensions
    };
  }
  function validate(files=[],info={}){
    if(!Array.isArray(files)||files.length>20)throw new Error('附件数量不能超过 20');
    let total=0;
    return files.map(file=>{
      const name=String(file.name || '附件').slice(0,200);
      if(file.kind==='image'){
        if(!info.images || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(file.dataUrl || ''))throw new Error('当前模型或接口不支持此图片附件');
        if(String(file.dataUrl).length>24*1024*1024)throw new Error('图片附件过大');
        total+=Math.floor(file.dataUrl.slice(file.dataUrl.indexOf(',')+1).replace(/=+$/,'').length*3/4);
        if(total>16*1024*1024)throw new Error('附件合计不能超过 16 MiB（扩展传输限制）');
        return {kind:'image',name,size:Number(file.size)||0,dataUrl:file.dataUrl};
      }
      if(file.kind!=='text'||!info.textFiles||typeof file.text!=='string')throw new Error('当前模型或接口不支持此文件附件');
      total+=new TextEncoder().encode(file.text).length;
      if(total>16*1024*1024)throw new Error('附件合计不能超过 16 MiB（扩展传输限制）');
      return {kind:'text',name,size:Number(file.size)||0,text:file.text};
    });
  }
  const appendText=(content,files=[])=>String(content || '')+files.filter(f=>f.kind==='text').map(f=>`\n\n附件 ${JSON.stringify(f.name)}：\n${f.text}`).join('');
  global.BjtuLlmModelInfo={describe,validate,appendText,textExtensions};
})(globalThis);
