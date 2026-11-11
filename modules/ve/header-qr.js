(async function initHeaderQr() {
  'use strict';
  if (!(await globalThis.__bjtuVeAppReady)) return;
  let enabled = (await chrome.storage.local.get('headerQrEnabled')).headerQrEnabled !== false;
  const common = globalThis.BjtuVeUploadCommon, cache = new Map(), tasks = new Map();
  const selector = '.course-header > span:first-child,.upload-section-header > h1,#resource-space-section .resource-space-title';
  const shareCss = `
    body{font:var(--bjtu-font-size-body,13px)/1.6 'Segoe UI',system-ui,sans-serif;max-width:1100px;margin:20px auto;padding:0 12px;background:var(--bjtu-page-background,#f9f9f9);color:#172033}
    html[data-color-scheme="dark"] body{color:#e2e8f0;color-scheme:dark}
    a{color:#1768b0;overflow-wrap:anywhere} img{max-width:100%} [hidden]{display:none!important}
    .share-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px}
    .share-search{box-sizing:border-box;width:min(100%,320px);padding:8px;border:1px solid #cbd5e1;border-radius:6px;background:var(--bjtu-card-background,#fff);color:inherit}
    .share-list .file-item,.share-list .homework-card{padding:10px;margin:5px 0;border:1px solid #cbd5e1;border-radius:6px;background:var(--bjtu-card-background,#fff)}
    .share-list :is(.file-item,.homework-card,.homework-group,.expandable-box){animation:none!important;transition:none!important}
    .share-list details{margin:8px 0} .share-list summary{cursor:pointer;color:#1768b0}
    .share-list .share-detail .expandable-body{max-height:none;overflow:visible}
    .share-list .share-detail summary{display:list-item}
    .share-list .resource-link-row{flex-wrap:wrap}
    .share-list .resource-link-row .btn{flex:none}
    .share-list .resource-row-title input{vertical-align:middle}
    table{border-collapse:collapse} td,th{padding:4px;border:1px solid #94a3b8}
  `;
  const shareJs = `
    'use strict';
    const input = document.querySelector('.share-search');
    const list = document.querySelector('.share-list');
    const toolbar = document.querySelector('.share-toolbar');
    const status = document.querySelector('.share-feedback');
    const fileLinks = [...list.querySelectorAll('a[data-share-url]')];
    const button = (label, parent, run, className = '') => {
      const node = document.createElement('button');
      node.type = 'button'; node.className = 'btn ' + className; node.textContent = label;
      node.addEventListener('click', run); parent.append(node); return node;
    };
    async function copy(urls) {
      try {
        if (!navigator.clipboard) throw new Error();
        await navigator.clipboard.writeText(urls.join('\\n'));
      } catch {
        const area = document.createElement('textarea');
        area.value = urls.join('\\n'); document.body.append(area); area.select();
        const copied = document.execCommand('copy'); area.remove();
        if (!copied) { status.textContent = '浏览器未允许复制'; return; }
      }
      status.textContent = urls.length === 1 ? '链接已复制' : '已复制 ' + urls.length + ' 个链接';
    }
    function download(link) {
      const target = document.createElement('a');
      target.href = link.dataset.shareUrl; target.download = '';
      target.target = '_blank'; target.rel = 'noopener noreferrer';
      document.body.append(target); target.click(); target.remove();
    }
    const selections = [];
    for (const link of fileLinks) {
      const row = link.closest('.file-item');
      if (!row) continue;
      const controls = link.closest('.resource-link-row') || link.parentElement;
      button('复制',controls,() => copy([link.dataset.shareUrl]),'resource-copy-btn');
      button('下载',controls,() => download(link),'resource-download-btn');
      const title = row.querySelector('.resource-row-title');
      if (!title) continue;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label','选择 ' + link.textContent);
      title.prepend(checkbox); selections.push({checkbox,link});
    }
    const visible = () => selections.filter(({checkbox}) => !checkbox.closest('[hidden]'));
    const selected = () => visible().filter(({checkbox}) => checkbox.checked).map(({link}) => link);
    if (selections.length) {
      button('反选',toolbar,() => { for (const {checkbox} of visible()) checkbox.checked = !checkbox.checked; sync(); });
      const copySelected = button('复制选中链接',toolbar,() => copy(selected().map(link => link.dataset.shareUrl)));
      const downloadSelected = button('下载选中文件',toolbar,() => selected().forEach(download));
      function sync() { copySelected.disabled = downloadSelected.disabled = !selected().length; }
      list.addEventListener('change',sync); input.addEventListener('input',() => queueMicrotask(sync)); sync();
    }
    if (list.querySelector('details')) {
      const toggle = button('展开全部',toolbar,() => {
        const details = [...list.querySelectorAll('details')], open = details.some(item => !item.open);
        for (const item of details) item.open = open;
        toggle.textContent = open ? '收起全部' : '展开全部';
      });
    }
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
  function nativeStyles() {
    const allowed = /\.(?:btn\b|file-item\b|homework-|hw-card-item\b|course-card-|course-actions\b|resource-|expandable-|ve-meta-|ve-teacher-name\b|ve-student-count-text\b|file-size-)/;
    const rules = [];
    for (const sheet of document.styleSheets) {
      if (!sheet.href || !/\/(?:app\/app|modules\/ve\/platform|UI\/theme|UI\/file-size-emphasis)\.css$/.test(sheet.href)) continue;
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && allowed.test(rule.selectorText) && !/url\(/i.test(rule.cssText)) rules.push(rule.cssText);
        }
      } catch { /* A stylesheet from another origin cannot be included. */ }
    }
    return rules.join('\n') + shareCss;
  }
  function snapshot(section) {
    const out = document.implementation.createHTMLDocument(section === 'courses' ? '课程助手' : section === 'uploads' ? '已上传文件' : '资源空间');
    const meta = out.createElement('meta'); meta.charset = 'utf-8'; out.head.prepend(meta);
    const viewport = out.createElement('meta'); viewport.name = 'viewport'; viewport.content = 'width=device-width,initial-scale=1'; out.head.append(viewport);
    const policy = out.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; img-src http: https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'"; out.head.append(policy);
    const style = out.createElement('link'); style.rel = 'stylesheet'; style.setAttribute('href','share.css'); out.head.append(style);
    const script = out.createElement('script'); script.defer = true; script.setAttribute('src','share.js'); out.head.append(script);
    out.documentElement.dataset.colorScheme = document.documentElement.dataset.colorScheme || 'light';
    for (const name of Array.from(document.documentElement.style)) {
      const value = document.documentElement.style.getPropertyValue(name);
      if (name.startsWith('--bjtu-') && !/url\(/i.test(value)) out.documentElement.style.setProperty(name,value);
    }
    const heading = out.createElement('h1'); heading.textContent = out.title; out.body.append(heading);
    const search = out.createElement('input'); search.type = 'search'; search.className = 'share-search';
    search.placeholder = section === 'courses' ? '搜索课程或作业' : '搜索文件'; search.setAttribute('aria-label',search.placeholder);
    const toolbar = out.createElement('div'); toolbar.className = 'share-toolbar';
    const feedback = out.createElement('span'); feedback.className = 'share-feedback'; feedback.setAttribute('role','status');
    toolbar.append(search,feedback);
    const list = out.createElement('main'); list.className = 'share-list'; out.body.append(toolbar,list);
    if (section === 'uploads') {
      const entries = [...(window.savedUploadedFiles || []),...Object.values(window.uploadedFileMetaById || {})], seen = new Set();
      for (const file of entries) {
        const url = file.url || common.downloadUrl(file.visitName);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        let parsed;
        try { parsed = new URL(url); } catch { continue; }
        if (!['http:','https:'].includes(parsed.protocol)) continue;
        const row = out.createElement('div'), anchor = out.createElement('a');
        const title = out.createElement('div'), controls = out.createElement('div');
        title.className = 'resource-row-title'; title.textContent = file.fileName || [file.fileNameNoExt,file.fileExtName].filter(Boolean).join('.') || url;
        controls.className = 'resource-link-row'; anchor.className = 'resource-url';
        anchor.href = parsed.href; anchor.dataset.shareUrl = parsed.href; anchor.textContent = parsed.href;
        anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
        row.className = 'file-item'; controls.append(anchor); row.append(title,controls); list.append(row);
      }
      if (!seen.size) throw new Error('暂无可分享的已上传文件。');
    } else {
      const source = document.querySelector(section === 'courses' ? '#course-list' : '#resource-space-list');
      if (!source?.querySelector('.file-item,.homework-card')) throw new Error('暂无可分享的内容，请先加载。');
      const clone = source.cloneNode(true);
      const originalCards = source.querySelectorAll('.course-card,.homework-card,.file-item');
      clone.querySelectorAll('.course-card,.homework-card,.file-item').forEach((node,index) => {
        const style = getComputedStyle(originalCards[index]); node.style.backgroundColor = style.backgroundColor; node.style.color = style.color;
      });
      for (const row of clone.querySelectorAll('.homework-toggle-row')) {
        const group = row.nextElementSibling, toggle = row.querySelector('.homework-toggle-btn');
        if (!group?.classList.contains('homework-group') || !toggle) continue;
        const details = document.createElement('details'), summary = document.createElement('summary');
        const label = toggle.querySelector('.homework-toggle-text') || toggle;
        summary.textContent = label.textContent.trim().replace(/^(查看|收起)\s*/, '');
        details.open = !group.classList.contains('is-hidden');
        group.classList.remove('is-hidden','homework-group-animating');
        row.replaceWith(details); details.append(summary,group);
      }
      for (const box of clone.querySelectorAll('.expandable-box:not(.no-toggle)')) {
        const body = box.querySelector(':scope > .expandable-body');
        if (!body) continue;
        const details = document.createElement('details'), summary = document.createElement('summary');
        details.className = 'share-detail'; summary.textContent = '详情'; details.open = box.dataset.expanded === '1';
        box.replaceWith(details); details.append(summary,body);
      }
      clone.querySelectorAll('script,style,link,meta,base,iframe,object,embed,input,textarea,button,form,.submit-panel,.progress-bar-container,.resource-download-progress,.inline-status,.spinner,.options-page-spinner').forEach(node=>node.remove());
      [clone,...clone.querySelectorAll('*')].forEach(node => {
        for (const attribute of [...node.attributes]) if (attribute.name.startsWith('on')) node.removeAttribute(attribute.name);
        node.removeAttribute('hidden'); node.removeAttribute('id');
        node.removeAttribute('data-share-url');
        if (node.style.display === 'none') node.style.removeProperty('display');
        node.style.removeProperty('height'); node.style.removeProperty('max-height'); node.style.removeProperty('opacity'); node.style.removeProperty('transform');
        if (node.hasAttribute('href')) {
          const url = new URL(node.getAttribute('href') || '',location.href);
          if (['http:','https:','mailto:'].includes(url.protocol)) {
            let href = url.href;
            if (node.matches('a.resource-url') && url.protocol !== 'mailto:') node.dataset.shareUrl = href;
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
      new File([nativeStyles()],'share.css',{type:'text/css',lastModified:0}),
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
