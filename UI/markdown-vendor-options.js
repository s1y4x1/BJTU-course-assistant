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
  async function readBytes(stream,limit,onProgress = () => {}) {
    if (!stream) throw new Error('下载未返回文件内容');
    const reader = stream.getReader(), chunks = [];
    let count = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        count += value.length;
        if (count > limit) throw new Error('官方安装包超出大小限制');
        chunks.push(value); onProgress(count);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
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
  async function getPackage(id,version,report) {
    const component = components[id];
    if (!supported(component,version)) throw new Error('请选择受支持的正式版本');
    const metadata = await (await request(packageUrl(component,version))).json();
    const tarball = new URL(metadata?.dist?.tarball);
    const integrity = String(metadata?.dist?.integrity || '');
    if (metadata.name !== component.packageName || metadata.version !== version ||
        tarball.origin !== new URL(registry).origin || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) {
      throw new Error('未能验证官方安装包来源');
    }
    const response = await request(tarball.href);
    const total = Number(response.headers.get('content-length')) || 0;
    const bytes = await readBytes(response.body,32 * 1024 * 1024,loaded =>
      report(total ? `下载中… ${Math.min(100,Math.floor(loaded / total * 100))}%` : `下载中… ${Math.round(loaded / 1024)} KB`));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-512',bytes));
    if ('sha512-' + btoa(String.fromCharCode(...hash)) !== integrity) throw new Error('安装包完整性校验失败');
    const unpacked = await readBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),64 * 1024 * 1024);
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
  async function saveSelection(id,version) {
    await navigator.locks.request('bjtu-markdown-vendor-options',async () => {
      const stored = await chrome.storage.local.get(settingsKey);
      const versions = {...stored[settingsKey]};
      if (version) versions[id] = version; else delete versions[id];
      await chrome.storage.local.set({[settingsKey]:versions});
    });
  }
  function bind(row) {
    const id = row.dataset.markdownVendor, component = components[id];
    const versions = row.querySelector('select'), state = row.querySelector('[data-state]');
    const download = row.querySelector('[data-download]'), disable = row.querySelector('[data-disable]');
    let busy = false, loaded = false, installed = '', revision = 0;
    const status = (text,tone = '') => { state.textContent = text; state.dataset.tone = tone; };
    function render() {
      versions.disabled = busy || !loaded;
      download.disabled = busy || !loaded || !versions.value || versions.value === installed;
      disable.disabled = busy; disable.hidden = !installed;
    }
    function installedStatus() { status(installed ? `已安装 ${installed}（重新打开相关页面后生效）` : '未安装'); }
    async function refresh(value) {
      const current = ++revision;
      const version = value?.[id] || '';
      let present = false;
      if (supported(component,version)) {
        const file = component.script.replace(/^dist\//,'');
        const url = chrome.runtime.getURL(`UI/vendor/${id}/${version}/${file}`);
        present = await fetch(url,{cache:'no-store'}).then(response => response.ok,() => false);
      }
      if (current !== revision) return;
      installed = present ? version : '';
      if (!busy) {
        if (version && !present) status(`${version} 的本地文件已缺失，可重新下载`,'error');
        else installedStatus();
      }
      render();
    }
    chrome.storage.onChanged.addListener((changes,area) => {
      if (area === 'local' && changes[settingsKey]) void refresh(changes[settingsKey].newValue);
    });
    async function loadVersions() {
      if (!panel.open || loaded || busy) return;
      busy = true; status('正在读取官方版本…'); render();
      try {
        const metadata = await (await request(packageUrl(component),{headers:{Accept:'application/vnd.npm.install-v1+json'}})).json();
        const releases = Object.keys(metadata.versions || {}).filter(version => supported(component,version)).sort((a,b) => {
          const left = versionParts(a), right = versionParts(b);
          return right[0]-left[0] || right[1]-left[1] || right[2]-left[2];
        });
        if (!releases.length) throw new Error('未找到可用的正式版本');
        versions.replaceChildren(...releases.map(version => new Option(version,version)));
        versions.value = releases.includes(installed) ? installed : releases[0];
        loaded = true; installedStatus();
      } catch (error) { status(`${error.message}，请重新展开后重试`,'error'); }
      finally { busy = false; render(); }
    }
    versions.onchange = render;
    panel.addEventListener('toggle',loadVersions);
    void chrome.storage.local.get(settingsKey).then(async stored => {
      await refresh(stored[settingsKey]); return loadVersions();
    });
    disable.onclick = async () => {
      try { await saveSelection(id,''); } catch (error) { status(error.message,'error'); }
    };
    download.onclick = async () => {
      if (busy || !versions.value) return;
      const version = versions.value;
      busy = true; status('正在检查扩展目录权限…'); render();
      try {
        await globalThis.__bjtuUpdaterReady;
        if (!globalThis.BjtuDirectoryPermission) throw new Error('更新组件未就绪，无法写入本地扩展目录');
        const root = await globalThis.BjtuDirectoryPermission.request();
        if (!root) { installedStatus(); return; }
        status('正在连接 npm 官方源…');
        const files = await getPackage(id,version,status);
        status('正在写入本地扩展目录…');
        await globalThis.BjtuUpdateFileSystem.withInstallLock(async () => {
          for (const [path,bytes] of files) {
            const relative = id === 'katex' ? path.replace(/^dist\//,'') : path;
            await globalThis.BjtuUpdateFileSystem.writeFile(root,`UI/vendor/${id}/${version}/${relative}`,bytes);
          }
          await saveSelection(id,version);
        });
        installed = version; installedStatus();
      } catch (error) { status(error.message,'error'); }
      finally { busy = false; render(); }
    };
  }
  panel.querySelectorAll('[data-markdown-vendor]').forEach(bind);
})();
