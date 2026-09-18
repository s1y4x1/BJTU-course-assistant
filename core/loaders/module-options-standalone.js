(function initStandaloneModuleOptions(global) {
  'use strict';

  let messageHideTimer = 0;

  function setMessage(text, ok = true, options = {}) {
    const message = document.getElementById('msg');
    if (!(message instanceof HTMLElement)) return;
    if (messageHideTimer) clearTimeout(messageHideTimer);
    message.textContent = String(text || '');
    const type = options?.type === 'info' ? 'info' : (ok ? 'ok' : 'err');
    message.className = `${type} show`;
    if (options?.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'toast-spinner';
      message.appendChild(spinner);
    }
    if (!options?.persistent) {
      messageHideTimer = setTimeout(() => {
        messageHideTimer = 0;
        message.classList.remove('show');
      }, ok ? 1800 : 3200);
    }
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
    const controllers = {
      academic: global.BjtuAcademicOptions,
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
