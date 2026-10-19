(function initVeVideoPage() {
  'use strict';

  const ownUrl = new URL(location.href);
  const isCoursePage = (url) => url.pathname === '/ve/back/coursePlatform/coursePlatform.shtml'
    && url.searchParams.get('method') === 'toCoursePlatform';
  const visitsPage = ownUrl.pathname === '/ve/back/video/teachingVisits.shtml'
    && ownUrl.searchParams.get('method') === 'videoList1';
  let coursePage = isCoursePage(ownUrl);
  try { coursePage ||= isCoursePage(new URL(window.top.location.href)); } catch {}
  if (!coursePage && !visitsPage) return;

  function createToggle(text, checked, onChange) {
    if (document.getElementById('bjtuca-ve-video-toggle')) return;
    const label = document.createElement('label');
    label.id = 'bjtuca-ve-video-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const caption = document.createElement('span');
    caption.textContent = text;
    label.append(input, caption);
    input.addEventListener('change', () => onChange(input.checked));
    document.documentElement.appendChild(label);
    return input;
  }

  if (visitsPage) {
    const identity = new URL(location.href);
    identity.searchParams.delete('userRole');
    identity.searchParams.sort();
    identity.hash = '';
    const key = `bjtuca-ve-video-role:${identity.href}`;
    const savedRole = sessionStorage.getItem(key);
    createToggle('切换访问角色', savedRole !== null && ownUrl.searchParams.get('userRole') === '2', (enabled) => {
      const url = new URL(location.href);
      if (enabled) {
        sessionStorage.setItem(key, JSON.stringify(url.searchParams.get('userRole')));
        url.searchParams.set('userRole', '2');
      } else {
        const originalRole = JSON.parse(sessionStorage.getItem(key));
        if (originalRole === null) url.searchParams.delete('userRole');
        else url.searchParams.set('userRole', originalRole);
        sessionStorage.removeItem(key);
      }
      location.replace(url.href);
    });
    return;
  }

  const storageKey = 'veThreeScreenLayoutEnabled';
  let enabled = false;
  let toggle;

  function syncLayout() {
    document.dispatchEvent(new CustomEvent('bjtu-ve-native-layout', { detail: enabled }));
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    enabled = changes[storageKey].newValue === true;
    if (toggle) toggle.checked = enabled;
    syncLayout();
  });
  void chrome.storage.local.get(storageKey).then((stored) => {
    enabled = stored[storageKey] === true;
    if (window === window.top || isCoursePage(ownUrl)) toggle = createToggle('三画面布局', enabled, (checked) => {
      void chrome.storage.local.set({ [storageKey]: checked });
    });
    if (toggle) toggle.title = '只重新初始化播放器，保留页面及播放位置';
    syncLayout();
  });
})();
