(function initCaptchaOptionsModule(global) {
  'use strict';

  let initialized = false;
  let setMessage = () => {};
  let versions = {};
  let selectedVersion = '';
  let coreReady = false;
  let coreReloadRequired = false;
  let cachedVersions = new Set();
  const busyVersions = new Set();
  const cancelingVersions = new Set();
  const modelDownloadVersions = new Set();
  const modelAbortControllers = new Map();
  const modelProgress = new Map();
  const modelStateMessages = new Map();
  let extensionReloadStarted = false;
  let captchaRuntimeReloadRequired = false;

  async function getCaptchaRuntimeState() {
    const [available, background] = await Promise.all([
      global.BjtuModuleRegistry.ready.catch(() => ({})),
      chrome.runtime.sendMessage({ type: 'CAPTCHA_RECOGNIZER_STATUS' }).catch(() => null)
    ]);
    return {
      moduleReady: available?.captcha === true,
      recognizerReady: background?.ok === true && background?.ready === true
    };
  }

  async function reloadExtensionAndOpenApp() {
    if (extensionReloadStarted) return;
    extensionReloadStarted = true;
    setMessage('OCR 核心已写入，正在重新加载扩展…');
    const params = new URLSearchParams(location.search);
    const isPopupWindow = params.get('popupWindow') === '1';
    const currentTab = await chrome.tabs.getCurrent().catch(() => null);
    const response = await chrome.runtime.sendMessage({
      type: 'RELOAD_EXTENSION_AND_OPEN_APP',
      payload: {
        reopenApp: true,
        source: 'captcha-options',
        sourceTabId: Number(currentTab?.id) || null,
        popup: params.get('popup') === '1'
      }
    }).catch(() => null);
    if (response?.ok) {
      if (isPopupWindow) setTimeout(() => window.close(), 50);
      return;
    }
    try {
      const suffix = params.get('popup') === '1' ? '?popup=1' : '';
      location.replace(chrome.runtime.getURL(`app/app.html${suffix}`));
      chrome.runtime.reload();
    } catch {
      const suffix = params.get('popup') === '1' ? '?popup=1' : '';
      location.replace(chrome.runtime.getURL(`app/app.html${suffix}`));
    }
  }

  async function refreshOrReturnToApp() {
    const params = new URLSearchParams(location.search);
    if (params.get('from') === 'app') {
      setTimeout(() => {
        if (params.get('popupWindow') === '1') {
          window.close();
          return;
        }
        if (history.length > 1) {
          history.back();
          return;
        }
        const suffix = params.get('popup') === '1' ? '?popup=1' : '';
        location.replace(chrome.runtime.getURL(`app/app.html${suffix}`));
      }, 250);
      return;
    }
    await chrome.runtime.sendMessage({ type: 'REFRESH_OPEN_APP_PAGES' }).catch(() => null);
  }

  function isCaptchaOptionsPopupWindow() {
    return new URLSearchParams(location.search).get('popupWindow') === '1';
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${parseFloat((bytes / (1024 ** index)).toFixed(2))} ${units[index]}`;
  }

  function buildFileSizeEmphasisStyle(bytes) {
    const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
    if (!(mb > 0)) return 'font-size:10px; font-weight:500; color:#94a3b8; text-shadow:none;';
    const ratio = Math.max(0, Math.min(1, Math.log10(mb + 1) / Math.log10(1024 + 1)));
    const fontPx = (10 + ratio * 6).toFixed(2);
    const weight = Math.round(500 + ratio * 320);
    const shadowBlur = Math.max(0, (ratio - 0.18) * 5).toFixed(2);
    const shadowAlpha = Math.max(0, (ratio - 0.2) * 0.35);
    if (document.documentElement.dataset.colorScheme === 'dark') {
      const r = Math.round(182 + ratio * 73);
      const g = Math.round(194 + ratio * 61);
      const b = Math.round(209 + ratio * 46);
      const shadow = shadowBlur === '0.00'
        ? 'none'
        : `0 1px ${shadowBlur}px rgba(255,255,255,${Math.min(1, shadowAlpha * 1.2).toFixed(2)})`;
      return `font-size:${fontPx}px; font-weight:${weight}; color:rgb(${r},${g},${b}); text-shadow:${shadow};`;
    }
    const colorLight = Math.round(148 - ratio * 118);
    const g = Math.max(18, colorLight + 8);
    const b = Math.max(28, colorLight + 20);
    const shadow = shadowBlur === '0.00'
      ? 'none'
      : `0 1px ${shadowBlur}px rgba(15,23,42,${shadowAlpha.toFixed(2)})`;
    return `font-size:${fontPx}px; font-weight:${weight}; color:rgb(${colorLight},${g},${b}); text-shadow:${shadow};`;
  }

  function escapeOptionsHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
    ));
  }

  function renderCaptchaFileSizeText(bytes, text = '') {
    const n = Math.max(0, Number(bytes) || 0);
    const label = text || formatBytes(n);
    return `<span class="file-size-emphasis" data-file-size-bytes="${n}" style="${escapeOptionsHtml(buildFileSizeEmphasisStyle(n))}">${escapeOptionsHtml(label)}</span>`;
  }

  function renderCaptchaFileSizePair(loaded, total) {
    return `${renderCaptchaFileSizeText(loaded)} <span class="file-size-separator">/</span> ${renderCaptchaFileSizeText(total)}`;
  }

  window.addEventListener('bjtu-theme-change', () => {
    const root = document.querySelector('[data-options-module="captcha"]');
    if (!(root instanceof HTMLElement)) return;
    root.querySelectorAll('[data-file-size-bytes]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.style.cssText = buildFileSizeEmphasisStyle(Number(element.dataset.fileSizeBytes || 0));
    });
  });

  function modelLabel(version) {
    return versions[version]?.label || version;
  }

  function setCoreStatus(text, error = false) {
    const target = document.getElementById('captchaCoreStatusValue');
    if (!(target instanceof HTMLElement)) return;
    target.innerHTML = text;
    target.classList.toggle('error', error);
  }

  const MIS_CAPTCHA_ENABLED_KEY = global.BjtuMisAssets?.MIS_CAPTCHA_ENABLED_KEY || '';
  const MIS_CAPTCHA_RESOURCE_LABEL = global.BjtuMisAssets?.MIS_CAPTCHA_RESOURCE_LABEL || '';
  const MIS_CAPTCHA_FEATURE_LABEL = global.BjtuMisAssets?.MIS_CAPTCHA_FEATURE_LABEL || '';
  let misDownloading = false;

  function setMisStatus(text, error = false) {
    const target = document.getElementById('casCaptchaStatusValue');
    if (!(target instanceof HTMLElement)) return;
    target.innerHTML = text;
    target.classList.toggle('error', error);
  }

  function setMisFileProgress(key, visible, loaded = 0, total = 0) {
    const suffix = misElementSuffix(key);
    const progress = document.getElementById(`casCaptchaProgress${suffix}`);
    const bar = document.getElementById(`casCaptchaProgressBar${suffix}`);
    if (!(progress instanceof HTMLElement)) return;
    progress.hidden = !visible;
    if (bar instanceof HTMLElement) {
      const ratio = total > 0 ? Math.max(0, Math.min(100, (loaded / total) * 100)) : 0;
      bar.style.width = `${ratio}%`;
    }
  }

  function setMisActionButtons({ downloading = false, downloadLabel = '下载', downloadVisible = true, deleteVisible = false } = {}) {
    const downloadBtn = document.getElementById('casCaptchaDownload');
    const deleteBtn = document.getElementById('casCaptchaDelete');
    if (downloadBtn instanceof HTMLButtonElement) {
      downloadBtn.hidden = downloading || !downloadVisible;
      downloadBtn.textContent = downloadLabel;
      downloadBtn.dataset.mode = downloadLabel === '修复' ? 'repair' : 'download';
    }
    if (deleteBtn instanceof HTMLButtonElement) {
      const toggle = document.getElementById('casCaptchaRecognitionEnabled');
      const enabled = toggle instanceof HTMLInputElement && toggle.checked;
      deleteBtn.hidden = downloading || !deleteVisible;
      deleteBtn.disabled = enabled;
      deleteBtn.title = enabled ? `请先取消勾选「${MIS_CAPTCHA_FEATURE_LABEL}」再删除` : '';
    }
  }

  async function getMisAssets() {
    if (!global.BjtuMisAssets) return null;
    return global.BjtuMisAssets;
  }

  function misElementSuffix(key) {
    return key === 'ort-wasm-simd.wasm' ? 'Wasm' : 'Omis';
  }

  function setMisFileStatus(key, text, error = false, asHtml = false) {
    const target = document.getElementById(`casCaptchaStatus${misElementSuffix(key)}`);
    if (!(target instanceof HTMLElement)) return;
    if (asHtml) {
      target.innerHTML = String(text ?? '');
    } else {
      target.textContent = String(text ?? '');
    }
    target.classList.toggle('error', error);
  }

  function setMisFileSize(key, text, asHtml = false) {
    const target = document.getElementById(`casCaptchaSize${misElementSuffix(key)}`);
    if (!(target instanceof HTMLElement)) return;
    if (asHtml) {
      target.innerHTML = String(text ?? '');
    } else {
      target.textContent = String(text ?? '');
    }
  }

  async function refreshMisCaptchaOptions() {
    const toggle = document.getElementById('casCaptchaRecognitionEnabled');
    const assets = await getMisAssets();
    if (!toggle && !assets) return null;
    try {
      const [status, stored] = await Promise.all([
        assets ? assets.getMisAssetsStatus() : Promise.resolve({ files: {}, downloading: [], installed: false }),
        chrome.storage.local.get([MIS_CAPTCHA_ENABLED_KEY]).catch(() => ({}))
      ]);
      const enabled = stored[MIS_CAPTCHA_ENABLED_KEY] !== false;
      const missing = [];
      let installedCount = 0;
      if (assets) {
        for (const item of assets.MIS_FILES) {
          const downloading = status.downloading.includes(item.key);
          const installed = status.files[item.key] === 'installed';
          const record = installed ? await assets.getMisAsset(item.key) : null;
          setMisFileSize(item.key, installed ? renderCaptchaFileSizeText(record?.blob?.size || 0) : '—', installed);
          if (downloading) {
            setMisFileProgress(item.key, true, 0, 1);
            setMisFileStatus(item.key, `${renderCaptchaFileSizePair(0, item.size)} 0%`, false, true);
          } else {
            setMisFileProgress(item.key, false);
            setMisFileStatus(item.key, installed ? '已安装' : '未安装', !installed);
          }
          if (installed) installedCount += 1;
          else missing.push(item.label);
        }
      }
      const allInstalled = missing.length === 0;
      if (toggle instanceof HTMLInputElement) toggle.checked = enabled && allInstalled;
      if (status.downloading.length) {
        setMisStatus('下载中…', false);
        setMisActionButtons({ downloading: true });
      } else {
        setMisStatus(allInstalled ? '已就绪' : '未安装', !allInstalled);
        setMisActionButtons({
          downloadLabel: allInstalled ? '修复' : '下载',
          deleteVisible: installedCount > 0
        });
      }
      return { enabled, allInstalled, downloading: status.downloading.length > 0 };
    } catch (error) {
      setMisStatus(`检查失败：${String(error?.message || error)}`, true);
      return null;
    }
  }

  function misDownloadProgressHandler({ key, loaded, total }) {
    setMisStatus('下载中…', false);
    const ratio = total > 0 ? Math.round((loaded / total) * 100) : 0;
    setMisFileStatus(key, `${renderCaptchaFileSizePair(loaded, total)} ${ratio}%`, false, true);
    setMisFileProgress(key, true, loaded, total);
  }

  function startMisDownload() {
    if (misDownloading || !global.BjtuMisAssets) return;
    const assets = global.BjtuMisAssets;
    misDownloading = true;
    setMisStatus('下载中…', false);
    setMisActionButtons({ downloading: true });
    assets.getMisAssetsStatus()
      .then(async (status) => {
        const targets = assets.MIS_FILES.filter((item) => status.files[item.key] !== 'installed');
        if (!targets.length) return;
        await Promise.all(targets.map((item) => assets.downloadMisAsset(item.key, { onProgress: misDownloadProgressHandler })));
      })
      .then(() => {
        setMessage(`${MIS_CAPTCHA_RESOURCE_LABEL}已下载完成`);
        void refreshMisCaptchaOptions();
      })
      .catch((error) => {
        if (error?.name === 'AbortError') {
          setMisStatus('下载已取消', true);
        } else {
          setMisStatus(`下载失败：${String(error?.message || error)}`, true);
          setMessage(`${MIS_CAPTCHA_RESOURCE_LABEL}下载失败：${String(error?.message || error)}`, false);
        }
        void refreshMisCaptchaOptions();
      })
      .finally(() => {
        misDownloading = false;
      });
  }

  async function repairMisAssets() {
    const assets = await getMisAssets();
    if (!assets) return;
    setMessage(`正在检查 ${MIS_CAPTCHA_RESOURCE_LABEL}完整性…`);
    try {
      for (const item of assets.MIS_FILES) {
        const record = await assets.getMisAsset(item.key);
        if (!record) {
          setMessage(`${item.label} 已损坏，正在重新下载…`);
          await assets.downloadMisAsset(item.key, { onProgress: misDownloadProgressHandler });
        }
      }
      setMessage(`${MIS_CAPTCHA_RESOURCE_LABEL}完好`);
      void refreshMisCaptchaOptions();
    } catch (error) {
      setMessage(`修复失败：${String(error?.message || error)}`, false);
      void refreshMisCaptchaOptions();
    }
  }

  async function deleteMisAssets() {
    const assets = await getMisAssets();
    if (!assets) return;
    const toggle = document.getElementById('casCaptchaRecognitionEnabled');
    if (toggle instanceof HTMLInputElement && toggle.checked) {
      setMessage(`请先取消勾选「${MIS_CAPTCHA_FEATURE_LABEL}」再删除`, false);
      return;
    }
    try {
      const status = await assets.getMisAssetsStatus();
      for (const item of assets.MIS_FILES) {
        if (status.files[item.key] === 'installed') {
          await assets.uninstallMisAsset(item.key);
        }
      }
      setMessage(`已删除 ${MIS_CAPTCHA_RESOURCE_LABEL}`);
      void refreshMisCaptchaOptions();
    } catch (error) {
      setMessage(`删除失败：${String(error?.message || error)}`, false);
    }
  }

  function setCoreProgress({ visible = true, loaded = 0, total = 0 } = {}) {
    const progress = document.getElementById('captchaCoreProgress');
    const bar = document.getElementById('captchaCoreProgressBar');
    if (!(progress instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
    progress.hidden = !visible;
    if (!visible) {
      progress.classList.remove('is-indeterminate');
      bar.style.width = '0';
      return;
    }
    const normalizedLoaded = Math.max(0, Number(loaded) || 0);
    const normalizedTotal = Math.max(0, Number(total) || 0);
    const determinate = normalizedTotal > 0;
    progress.classList.toggle('is-indeterminate', !determinate);
    bar.style.width = determinate
      ? `${Math.min(100, normalizedLoaded / normalizedTotal * 100)}%`
      : '';
  }

  function showCoreReadyStatus() {
    setCoreStatus(coreReloadRequired
      ? '已安装，重新加载后生效'
      : '已就绪');
    setCoreProgress({ visible: false });
  }

  async function refreshCoreStatus() {
    const assets = global.BjtuCaptchaAssets;
    if (!assets) return false;
    const size = document.getElementById('captchaCoreSize');
    if (size instanceof HTMLElement) {
      size.innerHTML = renderCaptchaFileSizeText(assets.CORE_SIZE);
    }
    setCoreStatus('检查中…');
    setCoreProgress({ visible: false });
    const runtimeCheck = assets.extensionCoreExists();
    const directoryCheck = (async () => {
      const updaterReady = await global.__bjtuUpdaterReady;
      const manager = updaterReady && global.BjtuUpdaterModuleManager;
      return manager?.captchaCoreExistsInDirectory
        ? manager.captchaCoreExistsInDirectory()
        : false;
    })();
    const [runtimeReady, directoryReady, captchaRuntime] = await Promise.all([
      runtimeCheck.catch(() => false),
      directoryCheck.catch(() => false),
      getCaptchaRuntimeState()
    ]);
    const params = new URLSearchParams(location.search);
    captchaRuntimeReloadRequired = params.get('from') === 'app'
      && captchaRuntime.moduleReady
      && !captchaRuntime.recognizerReady;
    const staleCaptchaRuntime = params.get('from') === 'app'
      && captchaRuntimeReloadRequired
      && cachedVersions.has(selectedVersion)
      && (runtimeReady || directoryReady);
    coreReady = runtimeReady || directoryReady;
    coreReloadRequired = (!runtimeReady && directoryReady) || staleCaptchaRuntime;
    if (runtimeReady) {
      showCoreReadyStatus();
      if (coreReloadRequired) setTimeout(() => void reloadExtensionAndOpenApp(), 0);
    } else if (directoryReady) {
      showCoreReadyStatus();
      setTimeout(() => void reloadExtensionAndOpenApp(), 0);
    } else {
      setCoreStatus('未安装', true);
    }
    setCoreProgress({ visible: false });
    return coreReady;
  }

  function progressText(prefix, progress) {
    const sizeHtml = Number(progress?.total) > 0
      ? renderCaptchaFileSizePair(progress?.loaded, progress.total)
      : renderCaptchaFileSizeText(progress?.loaded);
    return `${prefix}：${sizeHtml}`;
  }

  function setModelProgress(version, label, loaded = 0, total = 0) {
    const needsRender = !modelDownloadVersions.has(version);
    modelDownloadVersions.add(version);
    modelProgress.set(version, {
      label,
      loaded: Math.max(0, Number(loaded) || 0),
      total: Math.max(0, Number(total) || 0)
    });
    if (needsRender) renderModels();
    const item = [...document.querySelectorAll('.captcha-model-item')]
      .find((element) => element.dataset.version === version);
    if (!(item instanceof HTMLElement)) return;
    const progress = modelProgress.get(version);
    const container = item.querySelector('.captcha-model-progress');
    const text = item.querySelector('.captcha-model-progress-label');
    const bar = item.querySelector('.captcha-model-progress-bar');
    if (!(container instanceof HTMLElement)
        || !(text instanceof HTMLElement)
        || !(bar instanceof HTMLElement)) return;
    text.innerHTML = progress.label;
    const determinate = progress.total > 0;
    container.classList.toggle('is-indeterminate', !determinate);
    bar.style.width = determinate
      ? `${Math.min(100, progress.loaded / progress.total * 100)}%`
      : '';
  }

  async function refreshCachedVersions() {
    const assets = global.BjtuCaptchaAssets;
    const entries = await Promise.all(Object.keys(versions).map(async (version) => [
      version,
      Boolean(await assets.getCachedModel(version))
    ]));
    cachedVersions = new Set(entries.filter(([, cached]) => cached).map(([version]) => version));
  }

  function createActionButton(text, action, version, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.dataset.action = action;
    button.dataset.version = version;
    if (className) button.className = className;
    button.disabled = busyVersions.has(version);
    return button;
  }

  function renderModels() {
    const list = document.getElementById('captchaModelList');
    if (!(list instanceof HTMLElement)) return;
    const fragment = document.createDocumentFragment();
    for (const [index, [version, definition]] of Object.entries(versions).entries()) {
      const cached = cachedVersions.has(version);
      const busy = busyVersions.has(version);
      const modelDownloading = modelDownloadVersions.has(version);
      const item = document.createElement('div');
      item.className = 'captcha-model-item';
      item.dataset.version = version;

      const choice = document.createElement('label');
      choice.className = 'captcha-model-choice';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'captchaModelVersion';
      radio.value = version;
      radio.id = `captchaModelVersion-${index}`;
      radio.checked = version === selectedVersion;
      radio.disabled = busy;
      const name = document.createElement('span');
      name.className = 'captcha-model-name';
      name.textContent = definition.label;
      const size = document.createElement('span');
      size.className = 'captcha-model-size';
      size.textContent = formatBytes(definition.size);
      size.dataset.fileSizeBytes = String(Math.max(0, Number(definition.size) || 0));
      size.style.cssText = buildFileSizeEmphasisStyle(definition.size);
      choice.append(radio, name, size);

      const actions = document.createElement('div');
      actions.className = 'captcha-model-actions';
      const state = document.createElement('span');
      state.className = 'captcha-model-state';
      const stateMessage = modelStateMessages.get(version);
      state.textContent = modelDownloading
        ? (cancelingVersions.has(version) ? '正在取消…' : '处理中…')
        : (stateMessage?.text || (cached ? '已下载' : '未下载'));
      state.classList.toggle('error', stateMessage?.error === true);
      actions.append(state);
      if (modelDownloading) {
        const cancel = createActionButton('取消', 'cancel', version, 'captcha-model-cancel');
        cancel.disabled = cancelingVersions.has(version);
        actions.append(cancel);
      } else if (cached) {
        actions.append(createActionButton('修复', 'download', version));
        const deleteButton = createActionButton('删除', 'uninstall', version, 'captcha-model-uninstall');
        deleteButton.disabled = busy || version === selectedVersion;
        if (version === selectedVersion) deleteButton.title = '当前使用的模型不能删除';
        actions.append(deleteButton);
      } else {
        actions.append(createActionButton('下载', 'download', version));
      }
      item.append(choice, actions);
      if (modelDownloading) {
        const progress = modelProgress.get(version) || { label: '正在准备…', loaded: 0, total: 0 };
        const progressContainer = document.createElement('div');
        progressContainer.className = `captcha-model-progress${progress.total > 0 ? '' : ' is-indeterminate'}`;
        const progressLabel = document.createElement('div');
        progressLabel.className = 'captcha-model-progress-label';
        progressLabel.innerHTML = progress.label;
        const progressTrack = document.createElement('div');
        progressTrack.className = 'captcha-model-progress-track';
        const progressBar = document.createElement('div');
        progressBar.className = 'captcha-model-progress-bar';
        progressBar.style.width = progress.total > 0
          ? `${Math.min(100, progress.loaded / progress.total * 100)}%`
          : '';
        progressTrack.append(progressBar);
        progressContainer.append(progressLabel, progressTrack);
        item.append(progressContainer);
      }
      fragment.append(item);
    }
    list.replaceChildren(fragment);
  }

  async function ensureCore(interactive) {
    const assets = global.BjtuCaptchaAssets;
    if (coreReady) {
      showCoreReadyStatus();
      return {
        written: 0,
        corePending: false,
        coreReady: true,
        reloadRequired: coreReloadRequired
      };
    }
    if (await assets.extensionCoreExists()) {
      coreReady = true;
      coreReloadRequired = false;
      showCoreReadyStatus();
      return { written: 0, corePending: false };
    }
    setCoreStatus('准备下载…');
    setCoreProgress({ loaded: 0, total: 0 });
    const manager = await global.__bjtuUpdaterReady && global.BjtuUpdaterModuleManager;
    if (!manager?.prepareCaptchaAssets) {
      const existingCoreReady = await assets.extensionCoreExists();
      coreReady = existingCoreReady;
      coreReloadRequired = false;
      if (!existingCoreReady) {
        setCoreStatus('未安装，updater 不可用', true);
        setCoreProgress({ visible: false });
        throw new Error('OCR 核心缺失，且 updater 模块不可用');
      }
      return { written: 0, corePending: false };
    }
    try {
      const result = await manager.prepareCaptchaAssets({
        interactive,
        modelReady: true,
        onProgress(progress) {
          if (progress.phase === 'core') {
            setCoreStatus(progressText('下载中', progress));
            setCoreProgress({ loaded: progress.loaded, total: progress.total });
          } else if (progress.phase === 'write') {
            setCoreStatus(progress.completed >= progress.total ? '写入完成' : '正在写入…');
            setCoreProgress({ loaded: progress.completed, total: progress.total });
          }
        }
      });
      coreReady = result.corePending !== true && result.coreReady !== false;
      coreReloadRequired = Number(result.written || 0) > 0;
      return result;
    } catch (error) {
      coreReady = false;
      coreReloadRequired = false;
      setCoreStatus(escapeOptionsHtml(String(error?.message || error)), true);
      setCoreProgress({ visible: false });
      throw error;
    }
  }

  async function prepareModel(version, { interactive = true, notify = true } = {}) {
    const assets = global.BjtuCaptchaAssets;
    if (!assets || !versions[version] || busyVersions.has(version)) return false;
    busyVersions.add(version);
    const abortController = new AbortController();
    modelAbortControllers.set(version, abortController);
    modelStateMessages.delete(version);
    if (!cachedVersions.has(version)) {
      modelDownloadVersions.add(version);
      modelProgress.set(version, { label: '正在准备…', loaded: 0, total: 0 });
    }
    renderModels();
    try {
      const modelTask = assets.ensureModel({
        version,
        signal: abortController.signal,
        onProgress: (progress) => setModelProgress(
          version,
          progressText('正在下载识别模型', progress),
          progress.loaded,
          progress.total
        )
      }).then((result) => {
        cachedVersions.add(version);
        return result;
      }).finally(() => {
        modelDownloadVersions.delete(version);
        modelProgress.delete(version);
        modelAbortControllers.delete(version);
        renderModels();
      });
      const [modelOutcome, coreOutcome] = await Promise.allSettled([
        modelTask,
        ensureCore(interactive)
      ]);
      if (modelOutcome.status === 'rejected') {
        throw modelOutcome.reason;
      }
      if (coreOutcome.status === 'rejected') throw coreOutcome.reason;
      const result = modelOutcome.value;
      const coreResult = coreOutcome.value;
      cachedVersions.add(version);
      if (captchaRuntimeReloadRequired && coreReady) coreReloadRequired = true;
      if (coreResult.corePending) {
        setCoreStatus('未安装，请授权扩展目录', true);
        setCoreProgress({ visible: false });
        modelStateMessages.set(version, { text: 'OCR 核心缺失', error: true });
        if (notify || interactive) setMessage('OCR 核心缺失，请授权扩展目录', false);
        return false;
      } else if (coreResult.written > 0) {
        setCoreStatus('已写入');
        setCoreProgress({ loaded: 1, total: 1 });
        if (notify) setMessage(`验证码识别模型 ${modelLabel(version)} 已下载，OCR 核心已修复`);
      } else {
        showCoreReadyStatus();
        if (notify) {
          setMessage(result.downloaded
            ? `验证码识别模型 ${modelLabel(version)} 下载完成`
            : `验证码识别模型 ${modelLabel(version)} 及 OCR 核心均已就绪`);
        }
      }
      if (coreReloadRequired || coreResult.reloadRequired === true) {
        await reloadExtensionAndOpenApp();
      } else if (result.downloaded || coreResult.written > 0) {
        await refreshOrReturnToApp();
      } else if (isCaptchaOptionsPopupWindow()) {
        window.close();
      }
      return true;
    } catch (error) {
      const message = String(error?.message || error);
      const canceled = error?.name === 'AbortError' || /aborted|中止|取消/i.test(message);
      modelStateMessages.set(version, {
        text: canceled ? '下载已取消' : message,
        error: !canceled
      });
      if (notify || interactive) {
        setMessage(canceled ? '验证码识别模型下载已取消' : `验证码识别资源准备失败：${message}`, canceled);
      }
      return false;
    } finally {
      busyVersions.delete(version);
      cancelingVersions.delete(version);
      modelDownloadVersions.delete(version);
      modelAbortControllers.delete(version);
      modelProgress.delete(version);
      await refreshCachedVersions().catch(() => {});
      renderModels();
    }
  }

  function cancelModelDownload(version) {
    if (!busyVersions.has(version) || cancelingVersions.has(version)) return;
    cancelingVersions.add(version);
    modelAbortControllers.get(version)?.abort();
    global.BjtuCaptchaAssets?.cancelModelDownload?.(version);
    renderModels();
  }

  async function selectModel(version) {
    const assets = global.BjtuCaptchaAssets;
    if (!cachedVersions.has(version)) {
      const prepared = await prepareModel(version);
      if (!prepared && !cachedVersions.has(version)) {
        renderModels();
        return;
      }
    }
    selectedVersion = await assets.setSelectedModelVersion(version);
    renderModels();
    await chrome.runtime.sendMessage({ type: 'CAPTCHA_MODEL_VERSION_CHANGED' }).catch(() => {});
    setMessage(`已切换验证码识别模型：${modelLabel(selectedVersion)}`);
  }

  async function uninstallModel(version) {
    const assets = global.BjtuCaptchaAssets;
    if (version === selectedVersion) {
      setMessage('当前使用的验证码识别模型不能卸载，请先切换至其他模型', false);
      return;
    }
    busyVersions.add(version);
    renderModels();
    try {
      await assets.deleteCachedModel(version);
      cachedVersions.delete(version);
      modelStateMessages.delete(version);
      setMessage(`已卸载验证码识别模型：${modelLabel(version)}`);
    } catch (error) {
      const message = String(error?.message || error);
      modelStateMessages.set(version, { text: message, error: true });
      setMessage(`验证码识别模型卸载失败：${message}`, false);
    } finally {
      busyVersions.delete(version);
      renderModels();
    }
  }

  async function initializeModelOptions() {
    const assets = global.BjtuCaptchaAssets;
    const list = document.getElementById('captchaModelList');
    if (!assets || !(list instanceof HTMLElement)) return;

    versions = await assets.getModelVersions();
    selectedVersion = await assets.getSelectedModelVersion();
    await refreshCachedVersions();
    await refreshCoreStatus();
    renderModels();
    await prepareModel(selectedVersion, { interactive: false, notify: false });
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;
    const list = document.getElementById('captchaModelList');
    if (!(list instanceof HTMLElement)) return;
    list.addEventListener('change', (event) => {
      const radio = event.target;
      if (radio instanceof HTMLInputElement && radio.name === 'captchaModelVersion') {
        void selectModel(radio.value);
      }
    });
    list.addEventListener('click', (event) => {
      const target = event.target;
      const button = target instanceof Element
        ? target.closest('button[data-action][data-version]')
        : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const version = String(button.dataset.version || '');
      if (button.dataset.action === 'download') void prepareModel(version);
      else if (button.dataset.action === 'cancel') cancelModelDownload(version);
      else if (button.dataset.action === 'uninstall') void uninstallModel(version);
      return;
    });
    list.addEventListener('pointerdown', (event) => {
      const target = event.target;
      const button = target instanceof Element
        ? target.closest('button.captcha-model-uninstall')
        : null;
      if (!(button instanceof HTMLButtonElement) || !button.disabled) return;
      event.preventDefault();
      setMessage('请先选择其他版本再删除', false);
    });
    list.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)
          || target.closest('button')) return;
      const clickedChoice = target.closest('.captcha-model-choice');
      if (!(clickedChoice instanceof HTMLElement)) return;
      const item = clickedChoice.closest('.captcha-model-item');
      if (!(item instanceof HTMLElement)) return;
      const version = String(item.dataset.version || '');
      if (!version || busyVersions.has(version)) return;
      if (cachedVersions.has(version)) return;
      event.preventDefault();
      void selectModel(version);
    });
    const toggle = document.getElementById('casCaptchaRecognitionEnabled');
    if (toggle instanceof HTMLInputElement) {
      toggle.addEventListener('change', () => {
        const enabled = toggle.checked === true;
        chrome.storage.local.set({ [MIS_CAPTCHA_ENABLED_KEY]: enabled }).catch(() => {});
        chrome.runtime.sendMessage({ type: 'MIS_CAPTCHA_SETTING_CHANGED', enabled }).catch(() => {});
        if (enabled) {
          void (async () => {
            const status = global.BjtuMisAssets
              ? await global.BjtuMisAssets.getMisAssetsStatus().catch(() => null)
              : null;
            if (status && !status.installed) {
              if (toggle instanceof HTMLInputElement) toggle.checked = false;
              if (!status.downloading.length) {
                setMessage(`正在自动下载 ${MIS_CAPTCHA_RESOURCE_LABEL}…`);
                startMisDownload();
              } else {
                setMessage(`正在下载 ${MIS_CAPTCHA_RESOURCE_LABEL}…`);
              }
            } else {
              setMessage(`已启用${MIS_CAPTCHA_FEATURE_LABEL}`);
            }
          })();
        } else {
          setMessage(`已禁用${MIS_CAPTCHA_FEATURE_LABEL}`);
        }
        void refreshMisCaptchaOptions();
      });
    }
    const downloadButton = document.getElementById('casCaptchaDownload');
    if (downloadButton instanceof HTMLButtonElement) {
      downloadButton.addEventListener('click', () => {
        if (downloadButton.dataset.mode === 'repair') void repairMisAssets();
        else startMisDownload();
      });
    }
    const deleteButton = document.getElementById('casCaptchaDelete');
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.addEventListener('click', () => void deleteMisAssets());
      deleteButton.addEventListener('pointerdown', (event) => {
        if (deleteButton.disabled) {
          event.preventDefault();
          setMessage(`请先取消勾选「${MIS_CAPTCHA_FEATURE_LABEL}」再删除`, false);
        }
      });
    }
    void initializeModelOptions().catch((error) => {
      list.textContent = `识别模型列表加载失败：${String(error?.message || error)}`;
      setMessage(`识别模型列表加载失败：${String(error?.message || error)}`, false);
    });
    void (async () => {
      const state = await refreshMisCaptchaOptions();
      if (state?.enabled && !state.allInstalled && !state.downloading && !misDownloading) {
        startMisDownload();
      }
    })();
  }

  async function reset() {
    const assets = global.BjtuCaptchaAssets;
    if (!assets) return;
    const version = assets.DEFAULT_MODEL_VERSION;
    if (!cachedVersions.has(version)) {
      await prepareModel(version, { interactive: false, notify: false });
    }
    selectedVersion = await assets.setSelectedModelVersion(version);
    renderModels();
    await chrome.runtime.sendMessage({ type: 'CAPTCHA_MODEL_VERSION_CHANGED' }).catch(() => {});
  }

  global.BjtuCaptchaOptions = { init, reset };
  global.BjtuOptionsModules?.register('captcha', global.BjtuCaptchaOptions);
})(globalThis);
