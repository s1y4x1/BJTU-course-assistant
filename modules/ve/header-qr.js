(async function initHeaderQr() {
  'use strict';
  if (!(await globalThis.__bjtuVeAppReady)) return;
  let enabled = (await chrome.storage.local.get('headerQrEnabled')).headerQrEnabled !== false;
  const common = globalThis.BjtuVeUploadCommon, cache = new Map(), tasks = new Map();
  const selector = '.course-header > span:first-child,.upload-section-header > h1,.resource-space-title';
  const tooltip = document.createElement('div'); tooltip.className = 've-header-qr-tooltip'; tooltip.hidden = true;
  const status = document.createElement('div'), spinner = document.createElement('span'), image = document.createElement('img'), link = document.createElement('a');
  spinner.className = 'options-page-spinner'; image.hidden = true; image.alt = '内容分享二维码';
  link.textContent = '打开分享页面'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.hidden = true;
  const dismiss = createQrDismissButton('headerQrEnabled');
  tooltip.append(status,spinner,image,link,dismiss); document.body.append(tooltip);
  let activeHeader = null, hideTimer;
  function snapshot(section) {
    const out = document.implementation.createHTMLDocument(section === 'courses' ? '课程助手' : section === 'uploads' ? '已上传文件' : '资源空间');
    const meta = out.createElement('meta'); meta.charset = 'utf-8'; out.head.prepend(meta);
    const viewport = out.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'; out.head.append(viewport);
    const policy = out.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"; out.head.append(policy);
    const heading = out.createElement('h1'); heading.textContent = out.title; out.body.append(heading);
    if (section === 'uploads') {
      const entries = [...(window.savedUploadedFiles || []),...Object.values(window.uploadedFileMetaById || {})], seen = new Set();
      for (const file of entries) {
        const url = file.url || common.downloadUrl(file.visitName);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const row = out.createElement('p'), anchor = out.createElement('a');
        anchor.href = url; anchor.textContent = file.fileName || [file.fileNameNoExt,file.fileExtName].filter(Boolean).join('.') || url;
        row.append(anchor); out.body.append(row);
      }
      if (!seen.size) throw new Error('暂无可分享的已上传文件。');
    } else {
      const source = document.querySelector(section === 'courses' ? '#course-list' : '#resource-space-list');
      if (!source?.querySelector('.file-item,.homework-card')) throw new Error('暂无可分享的内容，请先加载。');
      const clone = source.cloneNode(true);
      clone.querySelectorAll('script,style,iframe,object,embed,input,textarea,button,form,.submit-panel,.progress-bar-container,.resource-download-progress,.inline-status,.spinner,.options-page-spinner').forEach(node=>node.remove());
      const originalCards = source.querySelectorAll('.course-card,.homework-card,.file-item');
      clone.querySelectorAll('.course-card,.homework-card,.file-item').forEach((node,index) => {
        const style = getComputedStyle(originalCards[index]); node.style.backgroundColor = style.backgroundColor; node.style.color = style.color;
      });
      [clone,...clone.querySelectorAll('*')].forEach(node => {
        for (const attribute of [...node.attributes]) if (attribute.name.startsWith('on')) node.removeAttribute(attribute.name);
        node.removeAttribute('hidden'); node.removeAttribute('id');
        if (node.style.display === 'none') node.style.removeProperty('display');
        node.style.removeProperty('height'); node.style.removeProperty('max-height'); node.style.removeProperty('opacity'); node.style.removeProperty('transform');
        if (node.hasAttribute('href')) {
          const url = new URL(node.getAttribute('href') || '',location.href);
          if (['http:','https:','mailto:'].includes(url.protocol)) {
            let href = url.href;
            if (section === 'resources' && node instanceof HTMLAnchorElement) {
              const name = node.closest('.file-item')?.querySelector('.resource-name')?.textContent || node.textContent;
              href = globalThis.BjtuVeFilePreview?.previewUrl?.(href, name) || href;
            }
            node.setAttribute('href',href);
          } else node.removeAttribute('href');
          node.setAttribute('target','_blank'); node.setAttribute('rel','noopener noreferrer');
        }
        node.removeAttribute('xlink:href');
        if (node instanceof HTMLImageElement) node.src = new URL(node.getAttribute('src') || '',location.href).href;
      });
      out.body.append(out.importNode(clone,true));
    }
    const style = out.createElement('style'); style.textContent = 'body{font:14px/1.6 system-ui,sans-serif;max-width:1100px;margin:20px auto;padding:0 12px;background:#f9f9f9;color:#172033}a{color:#1768b0;overflow-wrap:anywhere}img{max-width:100%}.course-card,.homework-card,.file-item{padding:12px;margin:10px 0;border:1px solid #cbd5e1;border-radius:8px}.course-title{font-size:20px;font-weight:bold}.homework-card-title{font-size:16px;font-weight:bold}table{border-collapse:collapse}td,th{padding:4px;border:1px solid #94a3b8}';
    out.head.append(style);
    return '<!doctype html>\n'+out.documentElement.outerHTML;
  }
  async function publish(section) {
    const html = snapshot(section), file = new File([html],'index.html',{type:'text/html',lastModified:0}), hash = await common.fileHash(file);
    if (cache.get(section)?.hash === hash) return cache.get(section).url;
    const key = section+':'+hash;
    if (!tasks.has(key)) tasks.set(key,(async () => {
      const user = await ensureVeUploadSession(), zip = await common.zipFile(file), form = new FormData(); form.append('file',zip);
      const response = await fetch(common.uploadUrl(user.roleName),{method:'POST',credentials:'include',body:form});
      const text = await response.text();
      if (!response.ok) throw new Error(`上传失败：HTTP ${response.status}`);
      let data; try { data = JSON.parse(text); } catch { throw new Error(text || '上传接口返回非 JSON'); }
      if (!data.visitName) throw new Error(data.ERRMSG || data.message || '上传接口未返回文件地址');
      const zipName = new URL(common.downloadUrl(data.visitName)).pathname.split('/').pop();
      if (!zipName || !/\.zip$/i.test(zipName)) throw new Error('上传接口未返回 ZIP 文件地址');
      const base = 'http://123.121.147.7:1936/kk/', directory = new URL('onlinePreview',base);
      directory.searchParams.set('url',btoa(`http://${zipName}_`));
      const unpacked = await fetch(directory.href,{credentials:'include',cache:'no-store'});
      if (!unpacked.ok) throw new Error(`解压失败：HTTP ${unpacked.status}`);
      await unpacked.text();
      const url = globalThis.BjtuVeAddress.replace(`${base}${zipName}_/index.html`);
      cache.set(section,{hash,url}); return url;
    })().finally(()=>tasks.delete(key)));
    return tasks.get(key);
  }
  function position(header) {
    const rect = header.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(4,Math.min(rect.left,innerWidth-box.width-4))+'px';
    tooltip.style.top = Math.max(4,rect.bottom+8+box.height>innerHeight ? rect.top-box.height-8 : rect.bottom+8)+'px';
  }
  document.addEventListener('mouseover',event => {
    const header = event.target.closest?.(selector);
    if (!enabled || !header || header === activeHeader) return;
    clearTimeout(hideTimer); activeHeader = header; tooltip.hidden = false; image.hidden = link.hidden = true; spinner.hidden = false;
    status.textContent = '正在生成并上传分享页面…'; position(header);
    const section = header.closest('.course-header') ? 'courses' : header.closest('.upload-section-header') ? 'uploads' : 'resources';
    publish(section).then(url => {
      if (activeHeader !== header || !enabled) return;
      applyQrImageToElement(image,url,160); image.hidden = link.hidden = false; spinner.hidden = true;
      link.href = url; status.textContent = '扫码查看当前已加载内容'; position(header);
    }).catch(error => {
      if (activeHeader !== header) return;
      status.textContent = String(error?.message || error); spinner.hidden = true; position(header);
    });
  });
  document.addEventListener('mouseout',event => {
    if (!activeHeader || !(activeHeader.contains(event.target) || tooltip.contains(event.target))) return;
    if (event.relatedTarget && (activeHeader.contains(event.relatedTarget) || tooltip.contains(event.relatedTarget))) return;
    clearTimeout(hideTimer); hideTimer = setTimeout(()=>{tooltip.hidden=true;activeHeader=null;},120);
  });
  tooltip.addEventListener('mouseenter',()=>clearTimeout(hideTimer));
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area !== 'local' || !changes.headerQrEnabled) return;
    enabled = changes.headerQrEnabled.newValue !== false;
    if (!enabled) { tooltip.hidden=true; activeHeader=null; }
  });
})().catch(error=>console.warn('[bjtu] header QR:',error));
