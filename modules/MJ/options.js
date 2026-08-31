(function initMjOptionsModule(global) {
  'use strict';

  const SCRIPT = Object.freeze({
    name: 'MJ 蜘蛛侠网页彩蛋',
    url: 'https://update.greasyfork.org/scripts/593142/MJ%20%E8%9C%98%E8%9B%9B%E4%BE%A0%E7%BD%91%E9%A1%B5%E5%BD%A9%E8%9B%8B.user.js',
    path: 'modules/MJ/external/MJ 蜘蛛侠网页彩蛋.user.js',
    storageKey: 'mjExternalScriptEnabled',
    contentScriptId: 'bjtu-mj-spider-man-easter-egg'
  });
  const AUTO_INSTALL_PENDING_KEY = 'mjAutoInstallPending';
  const SOUND_VIDEO_ENABLED_KEY = 'mjSoundVideoEnabled';

  let initialized = false;
  let setMessage = () => {};
  const state = {
    installed: false,
    enabled: false,
    busy: false,
    ready: false,
    runtimeReady: false,
    localSize: 0,
    remoteSize: 0,
    prefetchedSource: '',
    soundVideoEnabled: true
  };

  const element = (id) => document.getElementById(id);
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload })
    .catch((error) => ({ ok: false, message: String(error?.message || error) }));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function updaterManager() {
    const ready = await global.__bjtuUpdaterReady;
    const manager = ready && global.BjtuUpdaterModuleManager;
    if (!manager?.requestDirectory || !manager?.managedFileExists || !manager?.writeManagedFile
        || !manager?.readManagedFile || !manager?.removeManagedFile) {
      throw new Error('更新组件未就绪，无法管理外部脚本');
    }
    return manager;
  }

  function validateSource(source) {
    const text = String(source || '');
    if (text.length < 300 || text.length > 1000000
        || !text.includes('// ==UserScript==')
        || !/@name\s+MJ\s+蜘蛛侠网页彩蛋/.test(text)
        || !/@match\s+\*:\/\/\*\/\*/.test(text)) {
      throw new Error('下载内容不是预期的「MJ 蜘蛛侠网页彩蛋」脚本');
    }
    return text;
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  function fileSizeStyle(bytes) {
    return typeof global.BjtuFileSizeEmphasis?.buildBytesStyle === 'function'
      ? global.BjtuFileSizeEmphasis.buildBytesStyle(bytes)
      : '';
  }

  function status(text, error = false) {
    const node = element('mjExternalScriptStatus');
    if (!(node instanceof HTMLElement)) return;
    node.textContent = String(text || '');
    node.classList.toggle('error', error);
  }

  function progress({ visible = true, loaded = 0, total = 0, label = '正在下载…' } = {}) {
    const wrap = element('mjExternalScriptProgress');
    const bar = element('mjExternalScriptProgressBar');
    const text = element('mjExternalScriptProgressLabel');
    if (!(wrap instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
    wrap.hidden = !visible;
    if (text instanceof HTMLElement) text.textContent = label;
    const determinate = Number(total) > 0;
    wrap.classList.toggle('is-indeterminate', visible && !determinate);
    bar.style.width = visible && determinate
      ? `${Math.min(100, Number(loaded) / Number(total) * 100)}%`
      : '';
  }

  function render() {
    const checkbox = element('mjExternalScriptEnabled');
    const download = element('mjExternalScriptDownload');
    const update = element('mjExternalScriptCheckUpdate');
    const remove = element('mjExternalScriptDelete');
    const size = element('mjExternalScriptSize');
    const soundVideo = element('mjSoundVideoEnabled');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = state.enabled;
      checkbox.disabled = state.busy || !state.ready;
    }
    if (download instanceof HTMLButtonElement) {
      download.hidden = state.installed;
      download.disabled = state.busy || !state.ready;
    }
    if (update instanceof HTMLButtonElement) {
      update.hidden = !state.installed;
      update.disabled = state.busy;
    }
    if (remove instanceof HTMLButtonElement) {
      remove.hidden = !state.installed;
      remove.disabled = state.busy || state.enabled;
      remove.classList.toggle('is-locked', state.enabled);
    }
    if (size instanceof HTMLElement) {
      const bytes = state.localSize || state.remoteSize;
      size.textContent = bytes ? formatBytes(bytes) : (state.ready && !state.installed ? '正在获取…' : '—');
      size.style.cssText = fileSizeStyle(bytes);
    }
    if (soundVideo instanceof HTMLInputElement) {
      soundVideo.checked = state.soundVideoEnabled;
      soundVideo.disabled = state.busy || !state.enabled;
    }
    if (!state.busy) status(state.installed ? '已下载' : '未下载');
  }

  async function runtimeInfo() {
    try {
      const response = await fetch(chrome.runtime.getURL(SCRIPT.path), { cache: 'no-store' });
      if (!response.ok) return { exists: false, size: 0 };
      return { exists: true, size: (await response.arrayBuffer()).byteLength };
    } catch {
      return { exists: false, size: 0 };
    }
  }

  async function fetchSource(onProgress) {
    const response = await fetch(SCRIPT.url, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`GreasyFork 下载失败：HTTP ${response.status}`);
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    const reader = response.body?.getReader?.();
    if (!reader) {
      const source = validateSource(await response.text());
      onProgress?.({ loaded: new TextEncoder().encode(source).byteLength, total });
      return source;
    }
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return validateSource(new TextDecoder().decode(bytes));
  }

  async function reloadOptions() {
    const currentTab = await chrome.tabs.getCurrent().catch(() => null);
    const popup = new URLSearchParams(location.search).get('popup') === '1';
    const result = await send('RELOAD_EXTENSION_AND_OPEN_APP', {
      reopenApp: false,
      source: 'mj-external-script',
      sourceTabId: Number(currentTab?.id) || null,
      restoreOptionsPath: popup ? '' : 'modules/MJ/options.html'
    });
    if (!result?.ok) throw new Error(result?.message || '无法重新加载扩展');
  }

  async function refresh({ prefetch = true } = {}) {
    const stored = await chrome.storage.local.get([SCRIPT.storageKey, SOUND_VIDEO_ENABLED_KEY]);
    let managedExists = false;
    let managedSize = 0;
    try {
      const manager = await updaterManager();
      managedExists = await manager.managedFileExists(SCRIPT.path);
      if (managedExists && typeof manager.managedFileSize === 'function') {
        managedSize = await manager.managedFileSize(SCRIPT.path);
      }
    } catch {}
    const runtime = await runtimeInfo();
    state.installed = managedExists || runtime.exists;
    state.runtimeReady = runtime.exists;
    state.localSize = managedSize || runtime.size;
    state.enabled = state.installed && stored[SCRIPT.storageKey] === true;
    state.soundVideoEnabled = stored[SOUND_VIDEO_ENABLED_KEY] !== false;
    state.ready = true;
    if (!state.installed && stored[SCRIPT.storageKey] === true) {
      state.enabled = false;
      await chrome.storage.local.set({ [SCRIPT.storageKey]: false });
    }
    render();
    if (prefetch && !state.localSize && !state.installed) {
      void fetchSource().then((source) => {
        if (state.installed) return;
        state.prefetchedSource = source;
        state.remoteSize = new TextEncoder().encode(source).byteLength;
        render();
      }).catch(() => {});
    }
  }

  async function setEnabled(enabled) {
    if (state.busy || !state.ready) return;
    if (enabled && !state.installed) return download(true);
    state.busy = true;
    state.enabled = enabled;
    render();
    try {
      await chrome.storage.local.set({ [SCRIPT.storageKey]: enabled });
      const result = await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      if (!result?.ok) throw new Error(result?.message || '动态脚本同步失败');
      state.busy = false;
      render();
      if (!enabled) {
        setMessage(`已停用「${SCRIPT.name}」`);
        return;
      }
      if (!Array.isArray(result.registeredIds) || !result.registeredIds.includes(SCRIPT.contentScriptId)) {
        status('正在重新加载扩展以启用脚本…');
        await reloadOptions();
        return;
      }
      state.runtimeReady = true;
      setMessage(`已启用「${SCRIPT.name}」`);
    } catch (error) {
      state.busy = false;
      if (enabled && state.installed && !state.runtimeReady) {
        status('脚本尚未进入当前扩展运行时，正在重新加载…');
        await reloadOptions();
        return;
      }
      state.enabled = !enabled;
      await chrome.storage.local.set({ [SCRIPT.storageKey]: !enabled });
      render();
      status(String(error?.message || error), true);
      setMessage(`外部脚本${enabled ? '启用' : '停用'}失败：${String(error?.message || error)}`, false);
    }
  }

  async function download(enableAfterDownload = false) {
    if (state.busy || state.installed) return;
    state.busy = true;
    render();
    status('正在请求扩展目录写入权限…');
    try {
      const manager = await updaterManager();
      const root = await manager.requestDirectory();
      status('正在从 GreasyFork 下载…');
      progress({ visible: true });
      const source = state.prefetchedSource || await fetchSource(({ loaded, total }) => {
        progress({
          visible: true,
          loaded,
          total,
          label: `正在下载：${total ? `${Math.round(loaded / total * 100)}% · ` : ''}${formatBytes(loaded)}${total ? ` / ${formatBytes(total)}` : ''}`
        });
      });
      const bytes = new TextEncoder().encode(source);
      await manager.writeManagedFile(root, SCRIPT.path, bytes);
      await chrome.storage.local.set({
        [SCRIPT.storageKey]: enableAfterDownload,
        [AUTO_INSTALL_PENDING_KEY]: false
      });
      Object.assign(state, {
        installed: true,
        enabled: enableAfterDownload,
        busy: false,
        localSize: bytes.byteLength,
        remoteSize: 0,
        prefetchedSource: ''
      });
      progress({ visible: false });
      render();
      if (enableAfterDownload) await setEnabled(true);
      else setMessage(`「${SCRIPT.name}」已下载`);
    } catch (error) {
      state.busy = false;
      progress({ visible: false });
      render();
      status(String(error?.message || error), true);
      setMessage(`外部脚本下载失败：${String(error?.message || error)}`, false);
    }
  }

  async function remove() {
    if (state.busy || !state.installed || state.enabled) return;
    state.busy = true;
    render();
    status('正在删除…');
    try {
      const manager = await updaterManager();
      const root = await manager.requestDirectory();
      await manager.removeManagedFile(root, SCRIPT.path);
      await chrome.storage.local.set({ [SCRIPT.storageKey]: false, [AUTO_INSTALL_PENDING_KEY]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      status('已删除，正在重新加载扩展…');
      await sleep(100);
      await reloadOptions();
    } catch (error) {
      state.busy = false;
      render();
      status(String(error?.message || error), true);
      setMessage(`删除失败：${String(error?.message || error)}`, false);
    }
  }

  async function checkUpdate() {
    if (state.busy || !state.installed) return;
    state.busy = true;
    render();
    status('正在检查更新…');
    try {
      const manager = await updaterManager();
      const root = await manager.requestDirectory();
      const current = await (await manager.readManagedFile(root, SCRIPT.path)).text();
      progress({ visible: true, label: '正在从 GreasyFork 检查更新…' });
      const latest = await fetchSource(({ loaded, total }) => progress({
        visible: true,
        loaded,
        total,
        label: `正在检查：${total ? `${Math.round(loaded / total * 100)}% · ` : ''}${formatBytes(loaded)}${total ? ` / ${formatBytes(total)}` : ''}`
      }));
      const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').trim();
      if (normalize(current) === normalize(latest)) {
        state.busy = false;
        progress({ visible: false });
        render();
        status('已下载（已是最新）');
        return;
      }
      const bytes = new TextEncoder().encode(latest);
      await manager.writeManagedFile(root, SCRIPT.path, bytes);
      state.localSize = bytes.byteLength;
      state.busy = false;
      progress({ visible: false });
      render();
      if (state.enabled) {
        status('已更新，正在重新加载扩展…');
        await reloadOptions();
      } else {
        status('已下载（已更新）');
        setMessage(`「${SCRIPT.name}」已更新`);
      }
    } catch (error) {
      state.busy = false;
      progress({ visible: false });
      render();
      status(String(error?.message || error), true);
      setMessage(`检查更新失败：${String(error?.message || error)}`, false);
    }
  }

  function bindEvents() {
    element('mjExternalScriptEnabled')?.addEventListener('change', (event) => void setEnabled(event.currentTarget.checked));
    element('mjExternalScriptDownload')?.addEventListener('click', () => void download(false));
    element('mjExternalScriptCheckUpdate')?.addEventListener('click', () => void checkUpdate());
    element('mjExternalScriptDelete')?.addEventListener('click', () => void remove());
    element('mjSoundVideoEnabled')?.addEventListener('change', async (event) => {
      state.soundVideoEnabled = event.currentTarget.checked === true;
      await chrome.storage.local.set({ [SOUND_VIDEO_ENABLED_KEY]: state.soundVideoEnabled });
      setMessage(state.soundVideoEnabled ? '已启用有声视频素材' : '已恢复原 GIF 素材');
    });
  }

  async function init(options = {}) {
    if (initialized) return true;
    initialized = true;
    setMessage = typeof options.setMessage === 'function' ? options.setMessage : setMessage;
    bindEvents();
    const stored = await chrome.storage.local.get([AUTO_INSTALL_PENDING_KEY]);
    await refresh({ prefetch: stored[AUTO_INSTALL_PENDING_KEY] !== true });
    if (stored[AUTO_INSTALL_PENDING_KEY] === true) {
      if (!state.installed) {
        await download(true);
      } else {
        await chrome.storage.local.set({ [AUTO_INSTALL_PENDING_KEY]: false });
        if (!state.enabled) await setEnabled(true);
      }
    }
    return true;
  }

  async function reset() {
    await chrome.storage.local.set({
      [SCRIPT.storageKey]: false,
      [AUTO_INSTALL_PENDING_KEY]: false,
      [SOUND_VIDEO_ENABLED_KEY]: true
    });
    if (initialized) await refresh();
  }

  global.BjtuMjOptions = { init, reset };
  global.BjtuOptionsModules?.register('MJ', global.BjtuMjOptions);
})(globalThis);
