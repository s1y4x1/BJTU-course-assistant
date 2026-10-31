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
  // app.html 默认采用全屏左栏顶栏布局；弹出页仍保留自己的顶栏位置。
  const restorePopupHeader = () => {
    document.body.classList.remove('page-top-config-in-left-column', 'course-header-sticky');
    const topConfig = document.querySelector('.page-top-config');
    const layout = document.querySelector('.layout-container');
    if (topConfig && layout) layout.before(topConfig);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restorePopupHeader, {once: true});
  else restorePopupHeader();
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
