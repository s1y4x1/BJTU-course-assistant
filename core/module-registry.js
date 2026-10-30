(function initBjtuModuleRegistry(global) {
  'use strict';

  const MODULES = Object.freeze({
    ve: {
      label: '智慧课程平台',
      styles: ['platform.css', 'uploader/saved-uploads.css'],
      files: [
        'vendor/main2.min.js', 'password-cipher.js', 'login-utils.js',
        'login-credentials-dialog.js', 'login-overlay.js', 'account-store.js',
        'video-page.js', 'video-page.css', 'video-native-layout.js',
        'account-login.js', 'homework-core.js', 'platform.js', 'session.js',
        'resource-download.js', 'file-preview.js', 'login-service.js', 'background-homework.js',
        'uploader/duplicate-dialog-loader.js', 'uploader/duplicate-dialog.css',
        'uploader/duplicate-dialog.html', 'uploader/saved-uploads.js',
        'uploader/upload-manager.js', 'uploader/upload-common.js', 'uploader/saved-uploads.html',
        'uploader/index.html', 'uploader/index.css', 'uploader/index.js'
      ]
    },
    ykt: { label: '雨课堂', files: ['network.js', 'platform.js'] },
    mrjzy: { label: '每日交作业', styles: ['platform.css'], files: ['network.js', 'platform.js'] },
    jlgj: { label: '接龙管家', files: ['network.js', 'platform.js', 'background.js', 'theme.js'] },
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
        'options.html', 'options.js', 'core-loader.js',
        'vendor/tesseract.min.js', 'vendor/worker.min.js'
      ],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    academic: {
      label: '教务系统',
      styles: ['options.css'],
      files: ['system.js', 'cache-store.js', 'score-statistics.js', 'options.html', 'options.js'],
      options: {
        fragment: 'options.html',
        style: 'options.css',
        script: 'options.js',
        scripts: ['cache-store.js', 'score-statistics.js'],
        wide: true
      }
    },
    cas: {
      label: '统一身份认证',
      styles: ['options.css'],
      files: ['system.js', 'vendor/sm2.min.js', 'sso-login-capture.js', 'sso-login-capture-main.js', 'options.html', 'options.js'],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    mail: {
      label: 'BJTU 邮件系统',
      styles: ['options.css'],
      files: ['system.js', 'options.html', 'options.js'],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    MJ: {
      label: 'MJ',
      activationKey: 'mjModuleActivated',
      styles: ['options.css'],
      files: ['options.html', 'options.js', 'media-replacer.js'],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    updater: {
      label: '更新组件',
      styles: ['app.css'],
      files: ['app.html', 'checker.js', 'background.js', 'filesystem.js']
    },
    api: {
      label: '扩展接口',
      styles: ['options.css', 'operations-ui.css'],
      files: ['operations.js', 'background.js', 'page.js', 'operations-ui.js', 'operations-ui.html', 'options.html', 'options.js', 'run.html', 'run.js', 'run.css'],
      options: {
        fragment: 'options.html', style: 'options.css', script: 'options.js',
        styles: ['operations-ui.css'], scripts: ['operations-ui.js']
      }
    },
    qwen: {
      label: '通义千问',
      dependencies: ['api'],
      styles: ['options.css', 'app.css', 'chat.css'],
      files: ['background.js', 'qwen-client.js', 'agent.js', 'SystemPrompt.md', 'icon.svg', 'app.html', 'app.js', 'chat.html', 'chat.css', 'options.html', 'options.js'],
      options: {
        fragment: 'options.html',
        style: 'options.css',
        script: 'options.js'
      }
    },
    chatroom: {
      label: '局域网聊天室',
      files: ['chat.html', 'chat.css', 'chat.js', 'transport.js', 'link.js', 'launch.js', 'options.html', 'options.css', 'options.js'],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
    },
    'local-bridge': {
      label: '本地程序桥接',
      dependencies: ['api'],
      files: [
        'client.js', 'README.md', 'install.ps1', 'package.json', 'package-lock.json',
        'src/config.js', 'src/server.js', 'src/check-dependencies.js', 'options.html', 'options.css', 'options.js'
      ],
      options: { fragment: 'options.html', style: 'options.css', script: 'options.js' }
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

  if (typeof document !== 'undefined') {
    global.__bjtuDatabaseMigrationReady = (async () => {
      await Promise.resolve();
      if (window.parent !== window && window.parent.__bjtuDatabaseMigrationReady) {
        return window.parent.__bjtuDatabaseMigrationReady;
      }
      await loadScript('core/database-migration.js');
      return global.BjtuDatabaseMigration.run();
    })();
  }

  const installed = (async () => {
    const entries = await Promise.all(Object.keys(MODULES).map(async (id) => [id, await exists(id)]));
    return Object.fromEntries(entries);
  })();

  const ready = (async () => {
    await global.__bjtuDatabaseMigrationReady;
    const available = { ...await installed };
    for (const id of Object.keys(MODULES)) {
      if ([...withDependencies([id])].some((dependency) => !available[dependency])) available[id] = false;
    }
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

  function withDependencies(ids) {
    const selected = new Set(ids);
    const visit = (id) => {
      for (const dependency of MODULES[id]?.dependencies || []) {
        if (selected.has(dependency)) continue;
        selected.add(dependency);
        visit(dependency);
      }
    };
    for (const id of [...selected]) visit(id);
    return selected;
  }

  function syncSelection(container, changed = null) {
    const inputs = [...container.querySelectorAll('input[type="checkbox"]')];
    let selected = new Set(inputs.filter((input) => input.checked).map((input) => input.value));
    if (changed && !changed.checked) {
      for (const id of [...selected]) {
        if (withDependencies([id]).has(changed.value)) selected.delete(id);
      }
    }
    selected = withDependencies(selected);
    inputs.forEach((input) => { input.checked = selected.has(input.value); });
    return selected;
  }

  function assertDependencies(selected, presentIds) {
    const present = new Set(presentIds);
    for (const id of selected) {
      for (const dependency of withDependencies(MODULES[id]?.dependencies || [])) {
        if (!present.has(dependency)) {
          throw new Error(`${MODULES[id]?.label || id}需要前置模块「${MODULES[dependency]?.label || dependency}」，但本地或更新包中未找到该模块`);
        }
      }
    }
  }

  const scriptLoads = new Map();
  function loadScript(path) {
    const url = chrome.runtime.getURL(path);
    if (scriptLoads.has(url)) return scriptLoads.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve(path);
      script.onerror = () => reject(new Error(`无法加载模块脚本：${path}`));
      document.head.appendChild(script);
    });
    scriptLoads.set(url, promise);
    promise.catch(() => scriptLoads.delete(url));
    return promise;
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

  global.BjtuModuleRegistry = { definitions: MODULES, installed, ready, has, exists, withDependencies, syncSelection, assertDependencies, loadScript, loadStyle };
})(globalThis);
