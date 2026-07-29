(function initCaptchaOptionsModule(global) {
  'use strict';

  let initialized = false;
  let setMessage = () => {};

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${parseFloat((bytes / (1024 ** index)).toFixed(2))} ${units[index]}`;
  }

  function setStatus(text, error = false) {
    const status = document.getElementById('captchaResourceStatus');
    if (!(status instanceof HTMLElement)) return;
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function progressText(prefix, progress) {
    const loaded = formatBytes(progress?.loaded);
    const total = Number(progress?.total) > 0 ? ` / ${formatBytes(progress.total)}` : '';
    return `${prefix}：${loaded}${total}`;
  }

  async function prepareResources(interactive) {
    const button = document.getElementById('captchaPrepareResources');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      const assets = global.BjtuCaptchaAssets;
      if (!assets) throw new Error('验证码资源管理器未加载');
      const version = await assets.getSelectedModelVersion();
      await assets.ensureModel({
        version,
        onProgress: (progress) => setStatus(progressText('正在下载识别模型', progress))
      });
      const manager = await global.__bjtuUpdaterReady && global.BjtuUpdaterModuleManager;
      if (!manager?.prepareCaptchaAssets) {
        const coreReady = await assets.extensionCoreExists();
        if (!coreReady) throw new Error('OCR 核心缺失，且 updater 模块不可用');
        setStatus(`识别模型 ${version} 已缓存，OCR 核心已就绪`);
        return;
      }
      const result = await manager.prepareCaptchaAssets({
        interactive,
        modelReady: true,
        onProgress(progress) {
          if (progress.phase === 'core') setStatus(progressText('正在下载 OCR 核心', progress));
          else if (progress.phase === 'write') setStatus(`正在写入 ${progress.path}`);
        }
      });
      if (result.corePending) {
        setStatus(`识别模型 ${version} 已缓存；OCR 核心缺失，请点击按钮并授权扩展目录`, true);
      } else if (result.written > 0) {
        setStatus('OCR 核心已写入，正在重新加载扩展…');
        setTimeout(() => chrome.runtime.reload(), 800);
      } else {
        setStatus(`识别模型 ${version} 已缓存，OCR 核心已就绪`);
      }
    } catch (error) {
      setStatus(String(error?.message || error), true);
      if (interactive) setMessage(`验证码识别资源准备失败：${String(error?.message || error)}`, false);
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  }

  async function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;
    const assets = global.BjtuCaptchaAssets;
    const select = document.getElementById('captchaModelVersion');
    if (!assets || !(select instanceof HTMLSelectElement)) return;
    select.disabled = true;
    setStatus('正在从识别模型源获取版本列表…');
    const versions = await assets.getModelVersions();
    for (const [version, definition] of Object.entries(versions)) {
      const option = document.createElement('option');
      option.value = version;
      option.textContent = definition.label;
      select.appendChild(option);
    }
    select.value = await assets.getSelectedModelVersion();
    select.disabled = false;
    select.addEventListener('change', async () => {
      const version = await assets.setSelectedModelVersion(select.value);
      setStatus(`已选择 ${versions[version]?.label || version}，正在下载…`);
      await chrome.runtime.sendMessage({ type: 'CAPTCHA_MODEL_VERSION_CHANGED' }).catch(() => {});
      await prepareResources(false);
    });
    document.getElementById('captchaPrepareResources')?.addEventListener('click', () => {
      void prepareResources(true);
    });
    await prepareResources(false);
  }

  async function reset() {
    const assets = global.BjtuCaptchaAssets;
    if (!assets) return;
    await assets.setSelectedModelVersion(assets.DEFAULT_MODEL_VERSION);
    const select = document.getElementById('captchaModelVersion');
    if (select instanceof HTMLSelectElement) select.value = assets.DEFAULT_MODEL_VERSION;
  }

  global.BjtuOptionsModules?.register('captcha', { init, reset });
})(globalThis);
