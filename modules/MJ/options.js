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
  const VIDEO_ASSETS_INITIALIZED_KEY = 'mjSoundVideoAssetsInitialized';
  const VIDEO_AVAILABLE_PATHS_KEY = 'mjSoundVideoAvailablePaths';
  const VIDEO_ASSETS = Object.freeze([
    Object.freeze({
      name: 'effect1.webm',
      url: 'https://s1y4x1.github.io/assets/effect1.webm',
      path: 'modules/MJ/assets/effect1.webm'
    }),
    Object.freeze({
      name: 'effect2.webm',
      url: 'https://s1y4x1.github.io/assets/effect2.webm',
      path: 'modules/MJ/assets/effect2.webm'
    })
  ]);

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
    soundVideoEnabled: true,
    videoAssetsInitialized: false,
    videoAssets: Object.fromEntries(VIDEO_ASSETS.map((asset) => [asset.name, {
      installed: false,
      size: 0,
      busy: false,
      error: ''
    }]))
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
    renderVideoAssets();
    if (!state.busy) status(state.installed ? '已下载' : '未下载');
  }

  function installedVideoAssets() {
    return VIDEO_ASSETS.filter((asset) => state.videoAssets[asset.name]?.installed);
  }

  async function persistAvailableVideoPaths() {
    await chrome.storage.local.set({
      [VIDEO_AVAILABLE_PATHS_KEY]: installedVideoAssets().map((asset) => asset.path)
    });
  }

  function renderVideoAssets() {
    const wrap = element('mjVideoAssets');
    wrap?.classList.toggle('is-disabled', !state.enabled || !state.soundVideoEnabled);
    const installedCount = installedVideoAssets().length;
    for (const asset of VIDEO_ASSETS) {
      const assetState = state.videoAssets[asset.name];
      const row = document.querySelector(`[data-video-asset="${CSS.escape(asset.name)}"]`);
      if (!(row instanceof HTMLElement)) continue;
      const size = row.querySelector('.mj-video-asset-size');
      const assetStatus = row.querySelector('.mj-video-asset-status');
      const downloadButton = row.querySelector('.mj-video-asset-download');
      const deleteButton = row.querySelector('.mj-video-asset-delete');
      if (size instanceof HTMLElement) {
        size.textContent = assetState.size ? formatBytes(assetState.size) : '—';
        size.style.cssText = fileSizeStyle(assetState.size);
      }
      if (assetStatus instanceof HTMLElement) {
        assetStatus.textContent = assetState.busy
          ? '正在下载…'
          : (assetState.error || (assetState.installed ? '已下载' : '未下载'));
        assetStatus.classList.toggle('error', Boolean(assetState.error));
      }
      if (downloadButton instanceof HTMLButtonElement) {
        downloadButton.hidden = assetState.installed;
        downloadButton.disabled = state.busy || assetState.busy || !state.enabled || !state.soundVideoEnabled;
      }
      if (deleteButton instanceof HTMLButtonElement) {
        deleteButton.hidden = !assetState.installed;
        deleteButton.disabled = state.busy || assetState.busy || installedCount <= 1;
        deleteButton.classList.toggle('is-locked', installedCount <= 1);
        deleteButton.title = installedCount <= 1 ? '至少保留一个有声视频素材' : '';
      }
    }
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

  async function runtimeFileInfo(path) {
    try {
      const response = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
      if (!response.ok) return { exists: false, size: 0 };
      return { exists: true, size: (await response.arrayBuffer()).byteLength };
    } catch {
      return { exists: false, size: 0 };
    }
  }

  async function fetchBinary(asset, onProgress) {
    const response = await fetch(asset.url, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`${asset.name} 下载失败：HTTP ${response.status}`);
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    const reader = response.body?.getReader?.();
    if (!reader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      onProgress?.({ loaded: bytes.byteLength, total });
      return bytes;
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
    if (!bytes.byteLength) throw new Error(`${asset.name} 下载内容为空`);
    return bytes;
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
    const stored = await chrome.storage.local.get([
      SCRIPT.storageKey,
      SOUND_VIDEO_ENABLED_KEY,
      VIDEO_ASSETS_INITIALIZED_KEY
    ]);
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
    state.videoAssetsInitialized = stored[VIDEO_ASSETS_INITIALIZED_KEY] === true;
    try {
      const manager = await updaterManager();
      for (const asset of VIDEO_ASSETS) {
        const managedAssetExists = await manager.managedFileExists(asset.path);
        const runtimeAsset = managedAssetExists ? { exists: false, size: 0 } : await runtimeFileInfo(asset.path);
        state.videoAssets[asset.name].installed = managedAssetExists || runtimeAsset.exists;
        state.videoAssets[asset.name].size = managedAssetExists && typeof manager.managedFileSize === 'function'
          ? await manager.managedFileSize(asset.path)
          : runtimeAsset.size;
        state.videoAssets[asset.name].error = '';
      }
    } catch {
      for (const asset of VIDEO_ASSETS) {
        const runtimeAsset = await runtimeFileInfo(asset.path);
        state.videoAssets[asset.name].installed = runtimeAsset.exists;
        state.videoAssets[asset.name].size = runtimeAsset.size;
      }
    }
    await persistAvailableVideoPaths();
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

  async function downloadVideoAsset(asset, root = null) {
    const standalone = !root;
    const assetState = state.videoAssets[asset.name];
    if (!assetState || assetState.busy || assetState.installed) return true;
    assetState.busy = true;
    assetState.error = '';
    if (standalone) state.busy = true;
    render();
    try {
      const manager = await updaterManager();
      const directory = root || await manager.requestDirectory();
      const bytes = await fetchBinary(asset, ({ loaded, total }) => progress({
        visible: true,
        loaded,
        total,
        label: `正在下载 ${asset.name}：${total ? `${Math.round(loaded / total * 100)}% · ` : ''}${formatBytes(loaded)}${total ? ` / ${formatBytes(total)}` : ''}`
      }));
      await manager.writeManagedFile(directory, asset.path, bytes);
      assetState.installed = true;
      assetState.size = bytes.byteLength;
      assetState.busy = false;
      if (standalone) state.busy = false;
      state.videoAssetsInitialized = true;
      await chrome.storage.local.set({ [VIDEO_ASSETS_INITIALIZED_KEY]: true });
      await persistAvailableVideoPaths();
      if (standalone) progress({ visible: false });
      render();
      if (standalone) setMessage(`已下载有声视频素材「${asset.name}」`);
      return true;
    } catch (error) {
      assetState.busy = false;
      assetState.error = String(error?.message || error);
      if (standalone) state.busy = false;
      if (standalone) progress({ visible: false });
      render();
      if (standalone) setMessage(assetState.error, false);
      return false;
    }
  }

  async function ensureVideoAssets() {
    if (!state.enabled || !state.soundVideoEnabled) return;
    const missing = VIDEO_ASSETS.filter((asset) => !state.videoAssets[asset.name]?.installed);
    if (!missing.length) {
      state.videoAssetsInitialized = true;
      await chrome.storage.local.set({ [VIDEO_ASSETS_INITIALIZED_KEY]: true });
      return;
    }
    state.busy = true;
    render();
    let root;
    try {
      const manager = await updaterManager();
      root = await manager.requestDirectory();
    } catch (error) {
      state.busy = false;
      progress({ visible: false });
      render();
      setMessage(`有声视频素材下载失败：${String(error?.message || error)}`, false);
      return;
    }
    let succeeded = 0;
    for (const asset of missing) {
      if (await downloadVideoAsset(asset, root)) succeeded += 1;
    }
    state.busy = false;
    state.videoAssetsInitialized = installedVideoAssets().length > 0;
    await chrome.storage.local.set({ [VIDEO_ASSETS_INITIALIZED_KEY]: state.videoAssetsInitialized });
    progress({ visible: false });
    render();
    if (succeeded) setMessage(`已下载 ${succeeded} 个有声视频素材`);
  }

  async function removeVideoAsset(asset) {
    const assetState = state.videoAssets[asset.name];
    if (!assetState?.installed || assetState.busy || installedVideoAssets().length <= 1) return;
    assetState.busy = true;
    assetState.error = '';
    renderVideoAssets();
    try {
      const manager = await updaterManager();
      const root = await manager.requestDirectory();
      await manager.removeManagedFile(root, asset.path);
      assetState.installed = false;
      assetState.size = 0;
      assetState.busy = false;
      state.videoAssetsInitialized = true;
      await chrome.storage.local.set({ [VIDEO_ASSETS_INITIALIZED_KEY]: true });
      await persistAvailableVideoPaths();
      renderVideoAssets();
      setMessage(`已删除有声视频素材「${asset.name}」`);
    } catch (error) {
      assetState.busy = false;
      assetState.error = String(error?.message || error);
      renderVideoAssets();
      setMessage(`删除 ${asset.name} 失败：${assetState.error}`, false);
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
      render();
      if (state.soundVideoEnabled) {
        await ensureVideoAssets();
        setMessage('已启用有声视频素材');
      } else {
        setMessage('已恢复原 GIF 素材');
      }
    });
    document.querySelectorAll('[data-video-asset]').forEach((row) => {
      const asset = VIDEO_ASSETS.find((item) => item.name === row.dataset.videoAsset);
      if (!asset) return;
      row.querySelector('.mj-video-asset-download')?.addEventListener('click', () => void downloadVideoAsset(asset));
      row.querySelector('.mj-video-asset-delete')?.addEventListener('click', () => void removeVideoAsset(asset));
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
    if (state.enabled && state.soundVideoEnabled && !state.videoAssetsInitialized) {
      await ensureVideoAssets();
    }
    return true;
  }

  async function reset() {
    await chrome.storage.local.set({
      [SCRIPT.storageKey]: false,
      [AUTO_INSTALL_PENDING_KEY]: false,
      [SOUND_VIDEO_ENABLED_KEY]: true,
      [VIDEO_ASSETS_INITIALIZED_KEY]: false,
      [VIDEO_AVAILABLE_PATHS_KEY]: []
    });
    if (initialized) await refresh();
  }

  global.BjtuMjOptions = { init, reset };
  global.BjtuOptionsModules?.register('MJ', global.BjtuMjOptions);
})(globalThis);
