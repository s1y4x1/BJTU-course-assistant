(function initVeVideoPage() {
  'use strict';

  const ownUrl = new URL(location.href);
  const isCoursePage = (url) => url.pathname === '/ve/back/coursePlatform/coursePlatform.shtml'
    && url.searchParams.get('method') === 'toCoursePlatform'
    && url.searchParams.get('courseToPage') === '10480';
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
    let drag = null;
    let suppressClick = false;
    const positionKey = 'bjtuca-ve-video-toggle-position';
    const position = (left, top) => {
      const rect = label.getBoundingClientRect();
      label.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`;
      label.style.top = `${Math.max(8, Math.min(top, innerHeight - rect.height - 8))}px`;
      label.style.right = 'auto';
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem(positionKey));
      if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) position(saved.left, saved.top);
    } catch { }
    label.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target === input) return;
      const rect = label.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      label.setPointerCapture(event.pointerId);
    });
    label.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      label.classList.add('dragging');
      position(drag.left + dx, drag.top + dy);
    });
    const endDrag = (event) => {
      if (!drag) return;
      if (drag.moved) {
        suppressClick = event.type === 'pointerup';
        if (suppressClick) setTimeout(() => { suppressClick = false; }, 0);
        const rect = label.getBoundingClientRect();
        sessionStorage.setItem(positionKey, JSON.stringify({ left: rect.left, top: rect.top }));
      }
      drag = null;
      label.classList.remove('dragging');
      if (label.hasPointerCapture(event.pointerId)) label.releasePointerCapture(event.pointerId);
    };
    label.addEventListener('pointerup', endDrag);
    label.addEventListener('pointercancel', endDrag);
    label.addEventListener('click', (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
    window.addEventListener('resize', () => {
      const rect = label.getBoundingClientRect();
      position(rect.left, rect.top);
    });
    return input;
  }

  if (visitsPage) {
    const preferenceKey = 'veStudentLiveRoleEnabled';
    const identity = new URL(location.href);
    identity.searchParams.delete('userRole');
    identity.searchParams.sort();
    identity.hash = '';
    const key = `bjtuca-ve-video-role:${identity.href}`;
    let toggle;
    const applyRole = (enabled) => {
      if (toggle) toggle.checked = enabled;
      const url = new URL(location.href);
      const savedRole = sessionStorage.getItem(key);
      if (enabled) {
        if (savedRole === null) sessionStorage.setItem(key, JSON.stringify(url.searchParams.get('userRole')));
        url.searchParams.set('userRole', '2');
      } else if (savedRole !== null) {
        const originalRole = JSON.parse(savedRole);
        if (originalRole === null) url.searchParams.delete('userRole');
        else url.searchParams.set('userRole', originalRole);
        sessionStorage.removeItem(key);
      }
      if (url.href !== location.href) location.replace(url.href);
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[preferenceKey]) applyRole(changes[preferenceKey].newValue === true);
    });
    void chrome.storage.local.get(preferenceKey).then((stored) => {
      toggle = createToggle('切换访问角色', stored[preferenceKey] === true, (enabled) => {
        void chrome.storage.local.set({ [preferenceKey]: enabled });
      });
      applyRole(stored[preferenceKey] === true);
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
