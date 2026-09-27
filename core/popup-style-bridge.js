(function bridgePopupStyles() {
  'use strict';

  if (new URLSearchParams(window.location.search).get('popup') !== '1') return;
  const markPopupBody = () => {
    if (!(document.body instanceof HTMLElement)) return false;
    document.body.classList.add('popup-mode');
    return true;
  };
  if (!markPopupBody()) {
    const observer = new MutationObserver(() => {
      if (markPopupBody()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true });
  }
  if (window === window.parent) return;
  try {
    const source = window.parent.document.querySelector('link[data-popup-content-style]');
    if (!source?.href) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = source.href;
    link.dataset.popupStyles = '1';
    document.head.appendChild(link);
  } catch {
    // The popup iframe is same-origin; ignore access failures in other embedding contexts.
  }
})();
