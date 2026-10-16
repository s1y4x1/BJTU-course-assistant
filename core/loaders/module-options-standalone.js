(function initStandaloneModuleOptions(global) {
  'use strict';

  function setMessage(text, ok = true, options = {}) {
    global.BjtuOptionsMessage.show(text, ok, options);
  }

  async function applyTheme() {
    const stored = global.chrome?.storage?.local
      ? await global.chrome.storage.local.get(['themeMode']).catch(() => ({}))
      : {};
    const mode = ['light', 'dark'].includes(stored.themeMode) ? stored.themeMode : 'system';
    const dark = mode === 'dark'
      || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.colorScheme = dark ? 'dark' : 'light';
  }

  async function init() {
    await applyTheme();
    if (!global.chrome?.storage?.local) {
      setMessage('当前为静态预览，扩展设置功能不可用', false);
      return;
    }
    const id = String(document.body?.dataset?.optionsModule || '');
    if (!global.BjtuModuleRegistry) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('core/module-registry.js');
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    if (!global.__bjtuApiReady) await global.BjtuModuleRegistry.loadScript('core/loaders/api-loader.js');
    await global.__bjtuApiReady;
    const controllers = {
      academic: global.BjtuAcademicOptions,
      api: global.BjtuApiOptions,
      campusnet: global.BjtuCampusnetOptions,
      captcha: global.BjtuCaptchaOptions,
      cas: global.BjtuCasOptions,
      mail: global.BjtuMailOptions,
      'local-bridge': global.BjtuLocalBridgeOptions,
      MJ: global.BjtuMjOptions,
      qwen: global.BjtuQwenOptions
    };
    const controller = controllers[id];
    if (!controller?.init) {
      setMessage('模块选项控制器未加载', false);
      return;
    }
    await controller.init({ setMessage });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init(), { once: true });
  } else {
    void init();
  }
})(globalThis);
