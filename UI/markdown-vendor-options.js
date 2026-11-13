(() => {
  'use strict';
  const panel = document.getElementById('markdownVendorEditor');
  if (!panel) return;
  const settingsKey = 'markdownVendorVersions';
  const registry = 'https://registry.npmjs.org/';
  const components = {
    katex:{packageName:'katex',script:'dist/katex.min.js',supports:([major,minor]) => major > 0 || minor >= 16},
    highlight:{packageName:'@highlightjs/cdn-assets',script:'highlight.min.js',supports:([major]) => major >= 11}
  };
  const decode = new TextDecoder();
  const versionParts = version => /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null;
  function supported(component,version) {
    const parts = versionParts(version);
    return parts && component.supports(parts);
  }
  function packageUrl(component,version = '') {
    return registry + encodeURIComponent(component.packageName) + (version ? '/' + version : '');
  }
  async function request(url,options = {}) {
    const response = await fetch(url,{credentials:'omit',redirect:'error',...options});
    if (!response.ok) throw new Error(`npm 返回 HTTP ${response.status}`);
    return response;
  }
  async function readBytes(stream,limit,onProgress = () => {},signal) {
    if (!stream) throw new Error('下载未返回文件内容');
    const reader = stream.getReader(), chunks = [];
    let count = 0;
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      while (true) {
        signal?.throwIfAborted();
        const {done,value} = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        count += value.length;
        if (count > limit) throw new Error('官方安装包超出大小限制');
        chunks.push(value); onProgress(count);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { signal?.removeEventListener('abort',cancel); reader.releaseLock(); }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    return bytes;
  }
  function readTar(bytes,allow) {
    const files = new Map();
    const text = (offset,length) => decode.decode(bytes.subarray(offset,offset + length)).split('\0',1)[0];
    for (let offset = 0; offset + 512 <= bytes.length;) {
      const name = text(offset,100), prefix = text(offset + 345,155);
      if (!name) break;
      const sizeField = text(offset + 124,12).trim(), type = bytes[offset + 156];
      const size = /^[0-7]+$/.test(sizeField) ? parseInt(sizeField,8) : NaN;
      const start = offset + 512, end = start + size;
      if (!Number.isSafeInteger(size) || end > bytes.length) throw new Error('npm 安装包格式无效');
      const path = (prefix ? prefix + '/' : '') + name;
      if ((type === 0 || type === 48) && path.startsWith('package/') && allow(path.slice(8))) {
        files.set(path.slice(8),bytes.subarray(start,end));
      }
      offset = start + Math.ceil(size / 512) * 512;
    }
    return files;
  }
  async function getPackage(id,version,report,signal) {
    const component = components[id];
    if (!supported(component,version)) throw new Error('请选择受支持的正式版本');
    const metadata = await (await request(packageUrl(component,version),{signal})).json();
    const tarball = new URL(metadata?.dist?.tarball);
    const integrity = String(metadata?.dist?.integrity || '');
    if (metadata.name !== component.packageName || metadata.version !== version ||
        tarball.origin !== new URL(registry).origin || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
      throw new Error('未能验证官方安装包来源');
    }
    const response = await request(tarball.href,{signal});
    const total = Number(response.headers.get('content-length')) || 0;
    report(0,total);
    const bytes = await readBytes(response.body,32 * 1024 * 1024,loaded => report(loaded,total),signal);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-512',bytes));
    if ('sha512-' + btoa(String.fromCharCode(...hash)) !== integrity) throw new Error('安装包完整性校验失败');
    const unpacked = await readBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),64 * 1024 * 1024,undefined,signal);
    const allow = path => path === component.script || /^LICENSE(?:\.[a-z]+)?$/i.test(path)
      || (id === 'katex' && (path === 'dist/katex.min.css' || /^dist\/fonts\/[A-Za-z0-9_-]+\.(?:woff2?|ttf)$/.test(path)));
    const files = readTar(unpacked,allow);
    if (!files.has(component.script)) throw new Error('官方包中找不到浏览器版脚本');
    if (id === 'katex') {
      const css = files.get('dist/katex.min.css');
      if (!css) throw new Error('KaTeX 安装包缺少样式文件');
      const fonts = [...decode.decode(css).matchAll(/url\(\s*['"]?(fonts\/[A-Za-z0-9_.-]+)['"]?\s*\)/g)].map(match => 'dist/' + match[1]);
      if (!fonts.length || fonts.some(font => !files.has(font))) throw new Error('KaTeX 安装包缺少所需字体');
    }
    return files;
  }
  async function saveSelection(id,version,installedBytes) {
    await navigator.locks.request('bjtu-markdown-vendor-options',async () => {
      const stored = await chrome.storage.local.get(settingsKey);
      const versions = {...stored[settingsKey]};
      if (version) versions[id] = {version,installedBytes}; else delete versions[id];
      await chrome.storage.local.set({[settingsKey]:versions});
    });
  }
  async function getInstalledBytes(id) {
    async function sum(directory) {
      let bytes = 0;
      for await (const handle of directory.values()) {
        bytes += handle.kind === 'directory' ? await sum(handle) : (await handle.getFile()).size;
      }
      return bytes;
    }
    try {
      await globalThis.__bjtuUpdaterReady;
      let dir = await globalThis.BjtuUpdateFileSystem?.readDirectoryHandle();
      if (!dir || await dir.queryPermission({mode:'read'}) !== 'granted') return 0;
      for (const part of ['UI','vendor',id]) dir = await dir.getDirectoryHandle(part);
      return await sum(dir);
    } catch { return 0; }
  }
  async function clearComponent(root,id) {
    try {
      const ui = await root.getDirectoryHandle('UI');
      const vendor = await ui.getDirectoryHandle('vendor');
      await globalThis.BjtuUpdateFileSystem.removeEntry(vendor,id,{recursive:true});
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
    }
  }
  function bind(row) {
    const id = row.dataset.markdownVendor, component = components[id];
    const versions = row.querySelector('select'), state = row.querySelector('[data-state]');
    const download = row.querySelector('[data-download]'), remove = row.querySelector('[data-delete]');
    const size = row.querySelector('[data-size]'), progress = row.querySelector('[role="progressbar"]');
    const bar = progress.querySelector('.option-download-progress-bar');
    const fileSizes = globalThis.BjtuFileSizeEmphasis;
    let busy = false, loaded = false, configured = '', installed = false, installedVersion = '', installedBytes = 0, revision = 0;
    let controller = null;
    let writing = false;
    const status = (text,tone = '') => { state.textContent = text; state.dataset.tone = tone; };
    function styledBytes(bytes) {
      const span = document.createElement('span');
      span.className = 'file-size-emphasis';
      span.dataset.fileSizeBytes = String(bytes);
      span.textContent = fileSizes.formatBytes(bytes);
      fileSizes.applyBytes(span,bytes);
      return span;
    }
    function setProgress(value) {
      progress.hidden = false;
      progress.classList.toggle('is-indeterminate',value === undefined);
      if (value === undefined) progress.removeAttribute('aria-valuenow');
      else progress.setAttribute('aria-valuenow',value);
      bar.style.width = value === undefined ? '' : `${value}%`;
    }
    function showProgress(loadedBytes,total,title = '官方安装包下载进度') {
      if (total > 0) {
        const percent = Math.min(100,Math.floor(100 * loadedBytes / total));
        setProgress(percent);
        const separator = document.createElement('span');
        separator.className = 'file-size-separator'; separator.textContent = ' / ';
        size.replaceChildren(styledBytes(loadedBytes),separator,styledBytes(total),` ${percent}%`);
      } else {
        setProgress();
        size.replaceChildren(styledBytes(loadedBytes));
      }
      size.title = title;
    }
    function showInstalledSize() {
      progress.hidden = true;
      size.replaceChildren(...(installedBytes ? [styledBytes(installedBytes)] : []));
      size.title = installedBytes ? '组件全部已安装文件的大小' : '';
    }
    function render() {
      versions.disabled = busy || !loaded;
      download.hidden = writing;
      download.disabled = busy || (loaded && !versions.value);
      download.textContent = installed && versions.value && versions.value === installedVersion ? '修复' : loaded ? '下载' : '重试';
      remove.hidden = !controller && (busy || !installed);
      remove.disabled = controller ? controller.signal.aborted : busy;
      remove.textContent = controller ? '取消' : '删除';
    }
    function installedStatus() {
      if (configured && !installed) status('本地文件已缺失，可重新下载','error');
      else status(installed ? (installedVersion ? `已安装 ${installedVersion}` : '已安装（本地文件）') : '未安装');
    }
    async function refresh(value) {
      const current = ++revision;
      const selection = value?.[id];
      const version = selection?.version || '';
      let exists = false, bytes = 0;
      const file = component.script.replace(/^dist\//,'');
      const required = id === 'katex' ? [file,'katex.min.css'] : [file];
      try {
        const readable = await Promise.all(required.map(async name => {
          const response = await fetch(chrome.runtime.getURL(`UI/vendor/${id}/${name}`),{cache:'no-store'});
          return response.ok && (await response.blob()).size > 0;
        }));
        exists = readable.every(Boolean);
      } catch {}
      if (exists) {
        bytes = Number.isSafeInteger(selection?.installedBytes) && selection.installedBytes > 0
          ? selection.installedBytes : await getInstalledBytes(id);
      }
      if (current !== revision) return;
      const wasConfigured = configured;
      configured = version;
      installed = exists;
      installedVersion = exists ? version : '';
      installedBytes = bytes;
      if (version && (!versions.value || versions.value === wasConfigured) &&
          [...versions.options].some(option => option.value === version)) {
        versions.value = version;
      }
      if (!busy) { installedStatus(); showInstalledSize(); }
      render();
    }
    chrome.storage.onChanged.addListener((changes,area) => {
      if (area !== 'local' || !changes[settingsKey]) return;
      const {oldValue,newValue} = changes[settingsKey];
      if (JSON.stringify(oldValue?.[id]) !== JSON.stringify(newValue?.[id])) void refresh(newValue);
    });
    async function loadVersions() {
      if (loaded || busy) return;
      busy = true; status('正在读取官方版本…'); render();
      try {
        const metadata = await (await request(packageUrl(component),{headers:{Accept:'application/vnd.npm.install-v1+json'}})).json();
        const releases = Object.keys(metadata.versions || {}).filter(version => supported(component,version)).sort((a,b) => {
          const left = versionParts(a), right = versionParts(b);
          return right[0]-left[0] || right[1]-left[1] || right[2]-left[2];
        });
        if (!releases.length) throw new Error('未找到可用的正式版本');
        versions.replaceChildren(...releases.map(version => new Option(version,version)));
        versions.value = releases.includes(configured) ? configured : releases[0];
        loaded = true; installedStatus();
      } catch (error) { status(error.message,'error'); }
      finally { busy = false; render(); }
    }
    async function modify(version) {
      if (busy) return;
      busy = true; status('正在检查扩展目录权限…'); render();
      try {
        await navigator.locks.request(`bjtu-markdown-vendor-${id}`,{ifAvailable:true},async lock => {
          if (!lock) throw new Error('此组件正在另一页面处理');
          await globalThis.__bjtuUpdaterReady;
          if (!globalThis.BjtuDirectoryPermission) throw new Error('更新组件未就绪，无法写入本地扩展目录');
          const root = await globalThis.BjtuDirectoryPermission.request();
          if (!root) return;
          let files;
          if (version) {
            controller = new AbortController();
            const {signal} = controller;
            status('正在连接 npm 官方源…');
            size.replaceChildren();
            setProgress(); render();
            files = await getPackage(id,version,(done,total) => {
              status('下载中…'); showProgress(done,total);
            },signal);
            signal.throwIfAborted();
            controller = null;
            writing = true; render();
          }
          status(version ? '正在写入本地扩展目录…' : '正在删除…');
          const totalBytes = files ? [...files.values()].reduce((sum,bytes) => sum + bytes.byteLength,0) : 0;
          const writeTitle = '组件文件写入进度';
          if (files) showProgress(0,totalBytes,writeTitle);
          await globalThis.BjtuUpdateFileSystem.withInstallLock(async () => {
            await saveSelection(id,'');
            await clearComponent(root,id);
            if (!files) return;
            let writtenBytes = 0;
            for (const [path,bytes] of files) {
              const relative = path.replace(/^dist\//,'');
              await globalThis.BjtuUpdateFileSystem.writeFile(root,`UI/vendor/${id}/${relative}`,bytes);
              writtenBytes += bytes.byteLength;
              showProgress(writtenBytes,totalBytes,writeTitle);
            }
            await saveSelection(id,version,totalBytes);
          });
        });
        await refresh((await chrome.storage.local.get(settingsKey))[settingsKey]);
        installedStatus();
      } catch (error) { status(controller?.signal.aborted ? '已取消下载' : error.message,controller?.signal.aborted ? '' : 'error'); }
      finally { controller = null; writing = false; busy = false; showInstalledSize(); render(); }
    }
    versions.onchange = render;
    remove.onclick = () => {
      if (!controller) { void modify(''); return; }
      controller.abort(); render();
    };
    download.onclick = () => loaded ? modify(versions.value) : loadVersions();
    void chrome.storage.local.get(settingsKey).then(async stored => {
      await refresh(stored[settingsKey]);
      await loadVersions();
    });
  }
  panel.querySelectorAll('[data-markdown-vendor]').forEach(bind);
})();
