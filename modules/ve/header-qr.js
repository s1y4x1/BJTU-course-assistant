(async function initHeaderQr() {
  'use strict';
  if (!(await globalThis.__bjtuVeAppReady)) return;
  let enabled = (await chrome.storage.local.get('headerQrEnabled')).headerQrEnabled !== false;
  const common = globalThis.BjtuVeUploadCommon, cache = new Map(), tasks = new Map();
  const selector = '.course-header > span:first-child,.upload-section-header > h1,.resource-space-title';
  const shareCss = `
    body{font:14px/1.6 system-ui,sans-serif;max-width:1100px;margin:20px auto;padding:0 12px;background:#f9f9f9;color:#172033}
    a{color:#1768b0;overflow-wrap:anywhere} img{max-width:100%} [hidden]{display:none!important}
    .share-search{box-sizing:border-box;width:min(100%,320px);padding:8px;border:1px solid #cbd5e1;border-radius:6px}
    .course-card,.homework-card,.file-item,.share-file{padding:12px;margin:5px 0;border:1px solid #cbd5e1;border-radius:8px;background:#fff}
    .course-card-title,.course-title{font-size:20px;font-weight:bold}
    .homework-card-title{font-size:16px;font-weight:bold}
    .homework-card-title a{color:inherit}.homework-deadline-meta,.resource-row-title{display:flex;flex-wrap:wrap;gap:4px 8px}
    details{margin:8px 0} summary{cursor:pointer;color:#1768b0} table{border-collapse:collapse} td,th{padding:4px;border:1px solid #94a3b8}
  `;
  const shareJs = `
    'use strict';
    const input = document.querySelector('.share-search');
    const list = document.querySelector('.share-list');
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase();
      for (const item of list.querySelectorAll('.file-item,.homework-card,.share-file')) {
        item.hidden = !!query && !item.textContent.toLocaleLowerCase().includes(query);
      }
      if (query) for (const group of list.querySelectorAll('details')) group.open = true;
    });
  `;
  const tooltip = document.createElement('div'); tooltip.className = 've-header-qr-tooltip'; tooltip.hidden = true;
  const status = document.createElement('div'), spinner = document.createElement('span'), image = document.createElement('img'), link = document.createElement('a');
  spinner.className = 'options-page-spinner'; image.hidden = true; image.alt = '内容分享二维码';
  link.textContent = '打开分享页面'; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.hidden = true;
  const dismiss = createQrDismissButton('headerQrEnabled');
  const progress = document.createElement('progress'); progress.max = 100; progress.hidden = true;
  progress.setAttribute('aria-label', '分享页面处理进度');
  status.setAttribute('role', 'status');
  tooltip.append(status,spinner,progress,image,link,dismiss); document.body.append(tooltip);
  let activeHeader = null, hideTimer;
  function snapshot(section) {
    const out = document.implementation.createHTMLDocument(section === 'courses' ? '课程助手' : section === 'uploads' ? '已上传文件' : '资源空间');
    const meta = out.createElement('meta'); meta.charset = 'utf-8'; out.head.prepend(meta);
    const viewport = out.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'; out.head.append(viewport);
    const policy = out.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; img-src http: https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'"; out.head.append(policy);
    const style = out.createElement('link'); style.rel = 'stylesheet'; style.setAttribute('href','share.css'); out.head.append(style);
    const script = out.createElement('script'); script.defer = true; script.setAttribute('src','share.js'); out.head.append(script);
    const heading = out.createElement('h1'); heading.textContent = out.title; out.body.append(heading);
    const search = out.createElement('input'); search.type = 'search'; search.className = 'share-search';
    search.placeholder = section === 'courses' ? '搜索课程或作业' : '搜索文件'; search.setAttribute('aria-label',search.placeholder);
    const list = out.createElement('main'); list.className = 'share-list'; out.body.append(search,list);
    if (section === 'uploads') {
      const entries = [...(window.savedUploadedFiles || []),...Object.values(window.uploadedFileMetaById || {})], seen = new Set();
      for (const file of entries) {
        const url = file.url || common.downloadUrl(file.visitName);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const row = out.createElement('p'), anchor = out.createElement('a');
        anchor.href = url; anchor.textContent = file.fileName || [file.fileNameNoExt,file.fileExtName].filter(Boolean).join('.') || url;
        row.className = 'share-file'; row.append(anchor); list.append(row);
      }
      if (!seen.size) throw new Error('暂无可分享的已上传文件。');
    } else {
      const source = document.querySelector(section === 'courses' ? '#course-list' : '#resource-space-list');
      if (!source?.querySelector('.file-item,.homework-card')) throw new Error('暂无可分享的内容，请先加载。');
      const clone = source.cloneNode(true);
      for (const row of clone.querySelectorAll('.homework-toggle-row')) {
        const group = row.nextElementSibling, toggle = row.querySelector('.homework-toggle-btn');
        if (!group?.classList.contains('homework-group') || !toggle) continue;
        const details = document.createElement('details'), summary = document.createElement('summary');
        const label = toggle.querySelector('.homework-toggle-text') || toggle;
        summary.textContent = label.textContent.trim().replace(/^(查看|收起)\s*/, '');
        details.open = !group.classList.contains('is-hidden');
        row.replaceWith(details); details.append(summary,group);
      }
      clone.querySelectorAll('script,style,link,meta,base,iframe,object,embed,input,textarea,button,form,.submit-panel,.progress-bar-container,.resource-download-progress,.inline-status,.spinner,.options-page-spinner').forEach(node=>node.remove());
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
      list.append(out.importNode(clone,true));
    }
    return '<!doctype html>\n'+out.documentElement.outerHTML;
  }
  function uploadZip(url, zip, report) {
    const form = new FormData(); form.append('file',zip);
    return new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST',url); xhr.withCredentials = true;
      xhr.upload.onprogress = ({lengthComputable,loaded,total}) => {
        if (lengthComputable && total > 0) report('正在上传 ZIP…',loaded / total * 100);
      };
      xhr.upload.onload = () => report('已上传，正在等待平台返回文件链接…',100);
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.responseText) : reject(new Error(`上传失败：HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error('上传失败：网络连接异常'));
      xhr.onabort = () => reject(new Error('上传已取消'));
      xhr.send(form);
    });
  }
  async function publish(section, onProgress) {
    const html = snapshot(section), files = [
      new File([html],'index.html',{type:'text/html',lastModified:0}),
      new File([shareCss],'share.css',{type:'text/css',lastModified:0}),
      new File([shareJs],'share.js',{type:'text/javascript',lastModified:0})
    ];
    const hash = await common.fileHash(new Blob(files));
    if (cache.get(section)?.hash === hash) return cache.get(section).url;
    const key = section+':'+hash;
    if (!tasks.has(key)) {
      const task = {listeners:new Set(), latest:null};
      const report = (text, percent = null) => {
        task.latest = [text,percent];
        for (const listener of task.listeners) listener(...task.latest);
      };
      task.promise = (async () => {
        report('正在压缩分享页面…',0);
        const zip = await common.zipFiles(files,'index.zip',(loaded,total) => report('正在压缩分享页面…',loaded / total * 100));
        report('正在确认上传登录状态…');
        const user = await ensureVeUploadSession();
        report('正在上传 ZIP…',0);
        const text = await uploadZip(common.uploadUrl(user.roleName),zip,report);
        let data; try { data = JSON.parse(text); } catch { throw new Error(text || '上传接口返回非 JSON'); }
        if (!data.visitName) throw new Error(data.ERRMSG || data.message || '上传接口未返回文件地址');
        report('正在后台准备在线预览…');
        const preview = await chrome.runtime.sendMessage({
          type:'VE_PREPARE_HEADER_QR_PREVIEW',
          zipUrl:common.downloadUrl(data.visitName)
        });
        if (!preview?.ok) throw new Error(preview?.error || '后台未能准备在线预览');
        const url = globalThis.BjtuVeAddress.replace(preview.url);
        cache.set(section,{hash,url}); return url;
      })().finally(()=>tasks.delete(key));
      tasks.set(key,task);
    }
    const task = tasks.get(key);
    task.listeners.add(onProgress);
    if (task.latest) onProgress(...task.latest);
    try { return await task.promise; }
    finally { task.listeners.delete(onProgress); }
  }
  function position(header) {
    const rect = header.getBoundingClientRect(), box = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(4,Math.min(rect.left,innerWidth-box.width-4))+'px';
    tooltip.style.top = Math.max(4,rect.bottom+8+box.height>innerHeight ? rect.top-box.height-8 : rect.bottom+8)+'px';
  }
  document.addEventListener('mouseover',event => {
    const header = event.target.closest?.(selector);
    if (!enabled || !header || header === activeHeader) return;
    clearTimeout(hideTimer); activeHeader = header; tooltip.hidden = false; image.hidden = link.hidden = progress.hidden = true; spinner.hidden = false;
    status.textContent = '正在生成分享页面…'; position(header);
    const section = header.closest('.course-header') ? 'courses' : header.closest('.upload-section-header') ? 'uploads' : 'resources';
    publish(section,(text,percent) => {
      if (activeHeader !== header || !enabled) return;
      status.textContent = percent === null ? text : `${text} ${Math.floor(percent)}%`;
      spinner.hidden = percent !== null; progress.hidden = percent === null;
      if (percent !== null) progress.value = percent;
      position(header);
    }).then(url => {
      if (activeHeader !== header || !enabled) return;
      applyQrImageToElement(image,url,160); image.hidden = link.hidden = false; spinner.hidden = progress.hidden = true;
      link.href = url; status.textContent = '扫码查看当前已加载内容'; position(header);
    }).catch(error => {
      if (activeHeader !== header) return;
      status.textContent = String(error?.message || error); spinner.hidden = progress.hidden = true; position(header);
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
