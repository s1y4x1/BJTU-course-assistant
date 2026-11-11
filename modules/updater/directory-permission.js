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
  const result = await chrome.runtime.sendMessage({
    type: 'VERIFY_UPDATER_DIRECTORY_BACKGROUND_ACCESS',
    expectedForegroundProbe: foregroundProbe
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
    document.body.append(modal);
    return modal;
  })().catch(error => { initialization = null; throw error; });
}

async function verify(handle, store = false) {
  await withVersionDirectoryPermissionAuditLock(async () => {
    const foregroundProbe = await verifyVersionDirectoryWriteAccess(handle);
    if (store) await globalThis.BjtuUpdateFileSystem.storeDirectoryHandle(handle);
    await verifyVersionBackgroundDirectoryWriteAccess(handle, foregroundProbe);
  });
  return handle;
}

async function request({ startup = false, audit = false } = {}) {
  if (startup && (dismissed || (await chrome.storage.local.get('updateDirectoryStartupCheckEnabled')).updateDirectoryStartupCheckEnabled === false)) return null;
  if (requestInProgress) return requestInProgress;
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
    message.textContent = '请选择 BJTU 课程助手的安装目录，并允许扩展更改该文件夹。浏览器要求通过点击按钮发起目录选择和授权。';
    return new Promise(resolve => {
      const finish = result => {
        modal.classList.remove('show');
        choose.onclick = later.onclick = never.onclick = null;
        resolve(result);
      };
      const dismiss = () => { dismissed = true; finish(null); };
      later.onclick = dismiss;
      never.onclick = () => { dismiss(); void chrome.storage.local.set({updateDirectoryStartupCheckEnabled:false}); };
      choose.onclick = async () => {
        choose.disabled = later.disabled = never.disabled = true;
        try {
          let selected = handle;
          if (selected && await selected.requestPermission({mode:'readwrite'}) !== 'granted') selected = null;
          if (!selected) selected = await window.showDirectoryPicker({id:'bjtu-update-dir',mode:'readwrite'});
          const verified = await verify(selected, true);
          dismissed = false;
          finish(verified);
        } catch (error) {
          handle = null;
          if (error?.name !== 'AbortError') message.textContent = `目录验证未通过：${error?.message || error}。请重新选择扩展安装目录并允许写入。`;
        } finally { choose.disabled = later.disabled = never.disabled = false; }
      };
      modal.classList.add('show');
    });
  })().finally(() => { requestInProgress = null; });
  return requestInProgress;
}

globalThis.BjtuDirectoryPermission = { request, validate: validateVersionUpdateDirectory };

})();
