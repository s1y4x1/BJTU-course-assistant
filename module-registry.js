(function initBjtuModuleRegistry(global) {
  'use strict';

  const MODULES = Object.freeze({
    ve: { required: true, label: '智慧课程平台', files: ['platform.js', 'login-service.js'] },
    ykt: { label: '雨课堂', files: ['platform.js'] },
    mrjzy: { label: '每日交作业', files: ['platform.js', 'md5.js'] },
    jlgj: { label: '接龙管家', files: ['platform.js', 'background.js', 'capture.js', 'theme.js'] },
    mooc: { label: '中国大学MOOC', files: ['platform.js', 'background.js', 'inject.js'] },
    academic: { label: '教务系统', files: ['system.js'] },
    captcha: { label: '本地验证码识别', files: ['recognizer.js', 'offscreen.js', 'vendor/eng.traineddata.gz'] },
    updater: { label: '更新组件', files: ['checker.js', 'background.js', 'filesystem.js'] }
  });

  async function exists(id) {
    if (!MODULES[id]) return false;
    try {
      const files = ['module.json', ...(MODULES[id].files || [])];
      const responses = await Promise.all(files.map((path) => fetch(
        chrome.runtime.getURL(`modules/${id}/${path}`),
        { cache: 'no-store' }
      )));
      return responses.every((response) => response.ok);
    } catch {
      return false;
    }
  }

  const ready = (async () => {
    const entries = await Promise.all(Object.keys(MODULES).map(async (id) => [id, await exists(id)]));
    const available = Object.fromEntries(entries);
    available.ve = true;
    global.__bjtuAvailableModules = available;
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.modulesReady = '1';
      document.querySelectorAll('[data-module]').forEach((element) => {
        const ids = String(element.getAttribute('data-module') || '').split(/\s+/).filter(Boolean);
        const missing = ids.some((id) => !available[id]);
        element.hidden = missing;
        if (missing) element.style.setProperty('display', 'none', 'important');
        else element.style.removeProperty('display');
      });
    }
    return available;
  })();

  function has(id) {
    return id === 've' || global.__bjtuAvailableModules?.[id] === true;
  }

  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.onload = () => resolve(path);
      script.onerror = () => reject(new Error(`无法加载模块脚本：${path}`));
      document.head.appendChild(script);
    });
  }

  global.BjtuModuleRegistry = { definitions: MODULES, ready, has, exists, loadScript };
})(globalThis);
