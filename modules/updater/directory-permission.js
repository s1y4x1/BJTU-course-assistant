(() => {
'use strict';
async function validateVersionUpdateDirectory(handle) {
  if (!handle || handle.kind !== 'directory') throw new Error('请选择扩展安装目录');
  try {
    const manifestHandle = await handle.getFileHandle('manifest.json');
    const manifest = JSON.parse(await (await manifestHandle.getFile()).text());
    if (!manifest || typeof manifest !== 'object') throw new Error('manifest.json 格式无效');
    if (manifest.name !== chrome.runtime.getManifest().name) {
      throw new Error('所选目录不是 BJTU 课程助手的安装目录');
    }
  } catch (error) {
    if (/manifest\.json|不是 BJTU 课程助手/.test(String(error?.message || ''))) throw error;
    throw new Error('所选目录中未找到有效的 manifest.json');
  }
  return handle;
}

async function verifyVersionDirectoryWriteAccess(handle) {
  await validateVersionUpdateDirectory(handle);
  const updaterDirectory = await (await handle.getDirectoryHandle('modules')).getDirectoryHandle('updater');
  const marker = await updaterDirectory.getFileHandle('directory-permission.json', { create: true });
  const probeId = crypto.randomUUID();
  let content = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    content = JSON.stringify({ format: 'bjtu-ca-directory-permission', probeId, attempt, checkedAt: Date.now() });
    const writer = await marker.createWritable();
    await writer.write(content);
    await writer.close();
    const readBack = await (await marker.getFile()).text();
    if (readBack !== content) throw new Error(`第 ${attempt} 次写入后读取不一致`);
    let runtimeMatches = false;
    for (let retry = 0; retry < 5; retry += 1) {
      const runtimeUrl = new URL(chrome.runtime.getURL('modules/updater/directory-permission.json'));
      runtimeUrl.searchParams.set('probe', `${probeId}-${attempt}-${retry}`);
      const response = await fetch(runtimeUrl, { cache: 'no-store' }).catch(() => null);
      if (response?.ok && await response.text() === content) {
        runtimeMatches = true;
        break;
      }
      if (retry < 4) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!runtimeMatches) {
      throw new Error('所选目录的测试文件与当前扩展运行时读取到的内容不一致，请选择当前扩展的安装目录');
    }
  }
  return content;
}

async function verifyVersionBackgroundDirectoryWriteAccess(handle, foregroundProbe) {
  const result = await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(Object.assign(new Error('后台目录权限验证未响应，请检查扩展后台是否正常运行后重试'),{code:'PERMISSION_CHECK_TIMEOUT'})),15000);
    Promise.resolve().then(() => chrome.runtime.sendMessage({
      type: 'VERIFY_UPDATER_DIRECTORY_BACKGROUND_ACCESS',
      expectedForegroundProbe: foregroundProbe
    })).then(resolve,reject).finally(() => clearTimeout(timeout));
  });
  if (!result?.ok || !result.probe) {
    throw new Error(`后台目录权限验证失败：${String(result?.message || '后台未返回验证结果')}`);
  }
  const updaterDirectory = await (await handle.getDirectoryHandle('modules')).getDirectoryHandle('updater');
  const marker = await updaterDirectory.getFileHandle('directory-permission-background.json');
  if (await (await marker.getFile()).text() !== result.probe) {
    throw new Error('前台读到的后台测试文件与后台写入内容不一致');
  }
  for (let retry = 0; retry < 5; retry += 1) {
    const runtimeUrl = new URL(chrome.runtime.getURL('modules/updater/directory-permission-background.json'));
    runtimeUrl.searchParams.set('probe', `${retry}-${Date.now()}`);
    const response = await fetch(runtimeUrl, { cache: 'no-store' }).catch(() => null);
    if (response?.ok && await response.text() === result.probe) return;
    if (retry < 4) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('后台测试文件与当前扩展运行时读取到的内容不一致');
}

function withVersionDirectoryPermissionAuditLock(operation) {
  const locks = navigator.locks;
  return locks?.request
    ? locks.request('bjtu-ca-directory-permission-audit', { mode: 'exclusive' }, operation)
    : operation();
}

let initialization;
let requestInProgress;
let dismissed = false;
let permissionMessageTemplate;
let requestForUpdate = false;

function initialize() {
  return initialization ??= (async () => {
    if (!globalThis.BjtuUpdateFileSystem) {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('modules/updater/filesystem.js');
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error('无法加载扩展目录管理组件'));
        document.head.append(script);
      });
    }
    const response = await fetch(chrome.runtime.getURL('modules/updater/directory-permission.html'));
    if (!response.ok) throw new Error('无法加载扩展目录授权界面');
    if (!document.querySelector('link[href$="modules/updater/app.css"]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = chrome.runtime.getURL('modules/updater/app.css');
      document.head.append(style);
    }
    const template = document.createElement('template');
    template.innerHTML = await response.text();
    const modal = template.content.firstElementChild;
    permissionMessageTemplate = modal.querySelector('#version-directory-permission-message').innerHTML;
    document.body.append(modal);
    return modal;
  })().catch(error => { initialization = null; throw error; });
}

async function verify(handle, store = false, { ifAvailable = false, onProgress } = {}) {
  const fileSystem = globalThis.BjtuUpdateFileSystem;
  await fileSystem.withInstallLock(() => withVersionDirectoryPermissionAuditLock(async () => {
    onProgress?.('正在验证前台目录写入权限…');
    const foregroundProbe = await verifyVersionDirectoryWriteAccess(handle);
    if (store) await fileSystem.storeDirectoryHandle(handle);
    onProgress?.('正在验证后台目录写入权限…');
    await verifyVersionBackgroundDirectoryWriteAccess(handle, foregroundProbe);
  }), {ifAvailable});
  if (store) {
    const channel = new BroadcastChannel('bjtu-extension-downloads');
    channel.postMessage('changed'); channel.close();
  }
  return handle;
}

async function check({ifAvailable = false, onProgress} = {}) {
  try {
    onProgress?.('正在读取已保存的扩展目录…');
    const handle = await globalThis.BjtuUpdateFileSystem.readDirectoryHandle();
    onProgress?.('正在查询扩展目录授权状态…');
    if (await handle?.queryPermission({mode:'readwrite'}) !== 'granted') return null;
    onProgress?.('正在等待目录权限验证…');
    return await verify(handle,false,{ifAvailable,onProgress});
  } catch (error) {
    if (error?.code === 'INSTALL_DIRECTORY_BUSY' || error?.code === 'PERMISSION_CHECK_TIMEOUT') throw error;
    return null;
  }
}

async function request({ startup = false, audit = false, forUpdate = false } = {}) {
  if (startup && (dismissed || (await chrome.storage.local.get('updateDirectoryStartupCheckEnabled')).updateDirectoryStartupCheckEnabled === false)) return null;
  if (requestInProgress) {
    if (forUpdate) {
      requestForUpdate = true;
    }
    return requestInProgress;
  }
  requestForUpdate = forUpdate;
  requestInProgress = (async () => {
    const modal = await initialize();
    let handle = await globalThis.BjtuUpdateFileSystem.readDirectoryHandle();
    if (handle && await handle.queryPermission({mode:'readwrite'}) === 'granted') {
      try { return audit ? await verify(handle) : await validateVersionUpdateDirectory(handle); }
      catch { handle = null; }
    }
    const choose = modal.querySelector('#version-directory-permission-choose');
    const later = modal.querySelector('#version-directory-permission-later');
    const never = modal.querySelector('#version-directory-permission-never');
    const message = modal.querySelector('#version-directory-permission-message');
    message.innerHTML = permissionMessageTemplate;
    return new Promise(resolve => {
      const finish = result => {
        modal.classList.remove('show');
        choose.onclick = later.onclick = never.onclick = null;
        resolve(result);
      };
      const dismiss = () => { dismissed = true; finish(null); };
      later.onclick = dismiss;
      never.onclick = async () => {
        await chrome.storage.local.set({updateDirectoryStartupCheckEnabled:false});
        dismiss();
        const text = '已关闭提醒，可在扩展选项中重新开启';
        if (typeof globalThis.showToast === 'function') globalThis.showToast(text,'warning',3000);
        else {
          const container = document.createElement('div'); container.className = 'bjtu-toast-container';
          const toast = document.createElement('div'); toast.className = 'bjtu-toast warning'; toast.textContent = text;
          container.append(toast); document.body.append(container);
          toast.addEventListener('click', () => container.remove());
          setTimeout(() => container.remove(),3000);
        }
      };
      choose.onclick = async () => {
        choose.disabled = later.disabled = never.disabled = true;
        try {
          let selected = handle;
          if (selected && await selected.requestPermission({mode:'readwrite'}) !== 'granted') selected = null;
          if (!selected) selected = await window.showDirectoryPicker({id:'bjtu-update-dir',mode:'readwrite'});
          const verified = await verify(selected, true);
          dismissed = false;
          const reload = !requestForUpdate && window.confirm('目录验证成功。建议重新加载扩展。若再次提示授权，请重复完成授权，直到浏览器允许您选择「每次访问都允许」。现在重新加载吗？');
          if (reload) {
            const result = await chrome.runtime.sendMessage({type:'RELOAD_EXTENSION_AND_OPEN_APP',payload:{reopenApp:true}});
            if (!result?.ok) throw new Error(result?.message || '无法安排重新加载扩展并恢复全屏页面');
          }
          finish(verified);
        } catch (error) {
          handle = null;
          if (error?.name !== 'AbortError') message.textContent = `目录验证未通过：${error?.message || error}。请重新选择扩展安装目录并允许写入。`;
        } finally { choose.disabled = later.disabled = never.disabled = false; }
      };
      modal.classList.add('show');
    });
  })().finally(() => { requestInProgress = null; requestForUpdate = false; });
  return requestInProgress;
}

function setupOptionsButton() {
  const button = document.getElementById('checkUpdateDirectoryPermission');
  if (!button || button.dataset.permissionBound) return;
  button.dataset.permissionBound = '1';
  let checking = false;
  const setGranted = granted => {
    button.textContent = granted ? '已授权扩展安装目录' : '授权扩展安装目录';
    button.disabled = granted;button.title = '';
  };
  const inspect = async () => {
    if (checking) return;
    if (typeof versionDownloadInProgress !== 'undefined' && versionDownloadInProgress) {
      button.textContent = '正在更新，完成后检查目录权限';button.disabled=true;return;
    }
    checking = true;button.disabled = true;
    let timer, active = true, phase = '';
    try {
      const result = await Promise.race([
        check({ifAvailable:true,onProgress:text=>{phase=text;if(active)button.textContent=text;}}),
        new Promise((resolve,reject) => {timer=setTimeout(()=>reject(new Error(`目录权限检查超时（${phase}），请关闭其他正在更新或占用目录的扩展页面后重试`)),30000);})
      ]);
      setGranted(!!result);
    } catch (error) {
      button.textContent = error?.code === 'INSTALL_DIRECTORY_BUSY' ? '目录正在使用，稍后自动检查' : '权限检查未完成，点击重试';
      button.disabled = error?.code === 'INSTALL_DIRECTORY_BUSY';
      button.title = String(error?.message || error);
      console.warn('[bjtu] directory permission check:',error);
    } finally {active=false;clearTimeout(timer);checking=false;}
  };
  button.addEventListener('click',async()=>{
    if(checking)return;
    checking=true;button.disabled=true;
    let granted=false;
    try {
      granted=!!await request({audit:true});
      if(granted){
        const text='前台与后台的扩展安装目录写入权限均已验证通过';
        if(globalThis.BjtuOptionsMessage)globalThis.BjtuOptionsMessage.show(text,true);
        else globalThis.showToast?.(text,'success');
      }
    }
    catch(error){
      const text=`目录权限检查失败：${error?.message || error}`;
      if(globalThis.BjtuOptionsMessage)globalThis.BjtuOptionsMessage.show(text,false);
      else globalThis.showToast?.(text,'error');
    } finally {checking=false;setGranted(granted);}
  });
  const audit=()=>{if(document.visibilityState==='visible')void inspect();};
  document.addEventListener('visibilitychange',audit);
  window.addEventListener('focus',audit);
  const interval=setInterval(audit,30000);
  window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});
  void inspect();
}

globalThis.BjtuDirectoryPermission = { check, request, validate: validateVersionUpdateDirectory, setupOptionsButton };
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupOptionsButton,{once:true});
else setupOptionsButton();

})();
