(function bridgePopupStyles() {
  'use strict';

  if (window === window.parent || new URLSearchParams(window.location.search).get('popup') !== '1') return;
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
