(function initMjMediaReplacer() {
  'use strict';

  const ENABLED_KEY = 'mjSoundVideoEnabled';
  const AVAILABLE_PATHS_KEY = 'mjSoundVideoAvailablePaths';
  let enabled = true;
  let videoPaths = [];

  function replaceImage(image) {
    if (!enabled || !videoPaths.length || !(image instanceof HTMLImageElement) || image.dataset.mjVideoReplaced === '1') return;
    image.dataset.mjVideoReplaced = '1';
    const video = document.createElement('video');
    video.className = image.className;
    video.src = chrome.runtime.getURL(videoPaths[Math.floor(Math.random() * videoPaths.length)]);
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.controls = false;
    video.muted = false;
    video.disablePictureInPicture = true;
    video.setAttribute('aria-hidden', 'true');
    video.addEventListener('canplay', () => {
      void video.play().catch(() => {});
    }, { once: true });
    image.replaceWith(video);
  }

  function inspect(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('img.tm-mj-spiderman-image')) replaceImage(node);
    node.querySelectorAll('img.tm-mj-spiderman-image').forEach(replaceImage);
  }

  chrome.storage.local.get([ENABLED_KEY, AVAILABLE_PATHS_KEY]).then((stored) => {
    enabled = stored[ENABLED_KEY] !== false;
    videoPaths = Array.isArray(stored[AVAILABLE_PATHS_KEY])
      ? stored[AVAILABLE_PATHS_KEY].filter((path) => typeof path === 'string' && path.startsWith('modules/MJ/assets/'))
      : [];
    inspect(document.documentElement);
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ENABLED_KEY]) {
      enabled = changes[ENABLED_KEY].newValue !== false;
    }
    if (area === 'local' && changes[AVAILABLE_PATHS_KEY]) {
      videoPaths = Array.isArray(changes[AVAILABLE_PATHS_KEY].newValue)
        ? changes[AVAILABLE_PATHS_KEY].newValue.filter((path) => typeof path === 'string' && path.startsWith('modules/MJ/assets/'))
        : [];
    }
  });

  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(inspect);
  }).observe(document.documentElement, { childList: true, subtree: true });
})(globalThis);
