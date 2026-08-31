(function initMjMediaReplacer() {
  'use strict';

  const ENABLED_KEY = 'mjSoundVideoEnabled';
  const VIDEO_PATHS = Object.freeze([
    'modules/MJ/assets/effect1.webm',
    'modules/MJ/assets/effect2.webm'
  ]);
  let enabled = true;

  function replaceImage(image) {
    if (!enabled || !(image instanceof HTMLImageElement) || image.dataset.mjVideoReplaced === '1') return;
    image.dataset.mjVideoReplaced = '1';
    const video = document.createElement('video');
    video.className = image.className;
    video.src = chrome.runtime.getURL(VIDEO_PATHS[Math.floor(Math.random() * VIDEO_PATHS.length)]);
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

  chrome.storage.local.get([ENABLED_KEY]).then((stored) => {
    enabled = stored[ENABLED_KEY] !== false;
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ENABLED_KEY]) {
      enabled = changes[ENABLED_KEY].newValue !== false;
    }
  });

  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(inspect);
  }).observe(document.documentElement, { childList: true, subtree: true });
})(globalThis);
