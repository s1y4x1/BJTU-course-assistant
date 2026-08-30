(function initBjtuModuleRegistry(global) {
  'use strict';

  const MODULES = Object.freeze({
    ve: {
      label: '智慧课程平台',
      styles: ['platform.css'],
      files: [
        'vendor/main2.min.js', 'password-cipher.js', 'login-utils.js',
        'login-credentials-dialog.js', 'login-overlay.js', 'account-store.js',
        'account-login.js', 'homework-core.js', 'platform.js', 'session.js',
        'resource-download.js', 'login-service.js', 'background-homework.js'
      ]
    },
    ykt: { label: '雨课堂', files: ['platform.js'] },
    mrjzy: { label: '每日交作业', styles: ['platform.css'], files: ['platform.js'] },
    jlgj: { label: '接龙管家', files: ['platform.js', 'background.js', 'capture.js', 'theme.js'] },
    mooc: { label: '中国大学MOOC', styles: ['platform.css'], files: ['platform.js', 'background.js', 'inject.js'] },
    xuetangx: { label: '学堂在线', styles: ['platform.css'], files: ['platform.js'] },
    campusnet: {
      label: '校园网自动重连',
      styles: ['options.css'],
      files: ['background.js', 'options.html', 'options.js'],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    captcha: {
      label: '本地验证码识别',
      styles: ['options.css'],
      files: [
        'recognizer.js', 'offscreen.html', 'offscreen.js', 'worker.js',
        'options.html', 'options.js',
        'vendor/tesseract.min.js', 'vendor/worker.min.js'
      ],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    academic: {
      label: '教务系统',
      styles: ['options.css'],
      files: ['system.js', 'score-statistics.js', 'options.html', 'options.js'],
      options: {
        fragment: 'options.html',
        style: 'options.css',
        script: 'options.js',
        scripts: ['score-statistics.js'],
        wide: true
      }
    },
    cas: {
      label: '统一身份认证',
      styles: ['options.css'],
      files: ['system.js', 'options.html', 'options.js'],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    mail: {
      label: 'BJTU 邮件系统',
      styles: ['options.css'],
      files: ['system.js', 'options.html', 'options.js'],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    updater: {
      label: '更新组件',
      styles: ['app.css'],
      files: ['app.html', 'checker.js', 'background.js', 'filesystem.js', 'vendor/marked.umd.js']
    },
    qwen: {
      label: '通义千问',
      styles: ['options.css', 'app.css', 'operations-ui.css', 'chat.css'],
      files: ['background.js', 'operations.js', 'qwen-client.js', 'agent.js', 'icon.svg', 'app.html', 'app.js', 'chat.html', 'chat.css', 'options.html', 'options.js', 'operations-ui.js', 'operations-ui.html'],
      options: {
        fragment: 'options.html',
        style: 'options.css',
        script: 'options.js',
        styles: ['operations-ui.css'],
        scripts: ['operations-ui.js']
      }
    }
  });

  async function exists(id) {
    if (!MODULES[id]) return false;
    try {
      const files = ['module.json', ...(MODULES[id].styles || []), ...(MODULES[id].files || [])];
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
    return global.__bjtuAvailableModules?.[id] === true;
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

  function loadStyle(path) {
    const url = chrome.runtime.getURL(path);
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find((link) => link.href === url);
    if (existing) return Promise.resolve(path);
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = () => resolve(path);
      link.onerror = () => reject(new Error(`无法加载模块样式：${path}`));
      document.head.appendChild(link);
    });
  }

  global.BjtuModuleRegistry = { definitions: MODULES, ready, has, exists, loadScript, loadStyle };
})(globalThis);
