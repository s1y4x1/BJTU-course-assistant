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
    createToggle('切换访问角色（userRole=2）', savedRole !== null && ownUrl.searchParams.get('userRole') === '2', (enabled) => {
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
  const layoutClasses = ['jyd-leftWrap-doubleScreen', 'jyd-rightWrap-doubleScreen', 'jyd-noVideo',
    'jyd-leftWrap', 'jyd-rightTopWrap', 'jyd-rightBottomWrap'];
  const targetClasses = ['jyd-leftWrap', 'jyd-rightTopWrap', 'jyd-rightBottomWrap'];
  const snapshots = new Map();
  let enabled = false;
  let toggle;
  let scheduled = false;

  function restore(part, snapshot) {
    part.removeAttribute('data-bjtuca-three-screen');
    snapshot.forEach(({ element, classes }) => {
      element.classList.remove(...layoutClasses);
      element.classList.add(...classes);
    });
  }

  function applyLayout() {
    const restoring = !enabled && snapshots.size > 0;
    snapshots.forEach((snapshot, part) => {
      if (!enabled || !part.isConnected) {
        restore(part, snapshot);
        snapshots.delete(part);
      }
    });
    if (!enabled) {
      if (restoring) window.dispatchEvent(new Event('resize'));
      return;
    }
    document.querySelectorAll('.jyd-videoPart').forEach((part) => {
      const wraps = [1, 2, 3].map((id) => part.querySelector(`#jyd-video${id}Wrap`));
      if (wraps.some((wrap) => !wrap)) return;
      const previous = snapshots.get(part);
      if (previous && previous.some((item, index) => item.element !== wraps[index])) {
        restore(part, previous);
        snapshots.delete(part);
      }
      if (!snapshots.has(part)) snapshots.set(part, wraps.map((element) => ({
        element, classes: layoutClasses.filter((name) => element.classList.contains(name))
      })));
      if (!part.hasAttribute('data-bjtuca-three-screen')) part.setAttribute('data-bjtuca-three-screen', '');
      wraps.forEach((wrap, index) => {
        const unwanted = layoutClasses.filter((name) => name !== targetClasses[index] && wrap.classList.contains(name));
        if (unwanted.length) wrap.classList.remove(...unwanted);
        if (!wrap.classList.contains(targetClasses[index])) wrap.classList.add(targetClasses[index]);
      });
    });
  }

  function scheduleLayout() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; applyLayout(); });
  }

  new MutationObserver(scheduleLayout).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    enabled = changes[storageKey].newValue === true;
    if (toggle) toggle.checked = enabled;
    applyLayout();
  });
  void chrome.storage.local.get(storageKey).then((stored) => {
    enabled = stored[storageKey] === true;
    if (window === window.top || isCoursePage(ownUrl)) toggle = createToggle('三画面布局', enabled, (checked) => {
      enabled = checked;
      applyLayout();
      void chrome.storage.local.set({ [storageKey]: checked });
    });
    applyLayout();
  });
})();
