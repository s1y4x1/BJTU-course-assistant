(function () {
  if (globalThis.__bjtuJlgjThemeInstalled) return;
  globalThis.__bjtuJlgjThemeInstalled = true;

  const STYLE_ID = '__bjtu_jlgj_always_dark_style__';
  const ROOT_CLASS = '__bjtu-jlgj-always-dark';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let themeMode = 'system';
  let loginDarkEnabled = false;
  let alwaysDarkEnabled = false;
  let observer = null;

  const colorParts = (value) => {
    const match = String(value || '').match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])] : null;
  };
  const isNeutral = (parts) => parts && Math.max(parts[0], parts[1], parts[2]) - Math.min(parts[0], parts[1], parts[2]) <= 18;
  const isWhite = (parts) => isNeutral(parts) && parts[3] > 0.15 && (parts[0] + parts[1] + parts[2]) / 3 >= 235;
  const isBlack = (parts) => isNeutral(parts) && parts[3] > 0.15 && (parts[0] + parts[1] + parts[2]) / 3 <= 48;

  function classify(element) {
    if (!(element instanceof HTMLElement) || element instanceof HTMLIFrameElement || element.matches('.toggle, .toggle *')) return;
    const computed = getComputedStyle(element);
    if (computed.backgroundImage === 'none' && isWhite(colorParts(computed.backgroundColor))) element.classList.add('__bjtu-jlgj-dark-bg');
    if (isBlack(colorParts(computed.color))) element.classList.add('__bjtu-jlgj-dark-text');
    const borders = [computed.borderTopColor, computed.borderRightColor, computed.borderBottomColor, computed.borderLeftColor].map(colorParts);
    if (borders.some((parts) => isWhite(parts) || isBlack(parts))) element.classList.add('__bjtu-jlgj-dark-border');
  }

  function classifyTree(node) {
    if (!(node instanceof Element)) return;
    classify(node);
    node.querySelectorAll('*').forEach(classify);
  }

  function apply(enabled) {
    const root = document.documentElement;
    if (!root) return;
    let style = document.getElementById(STYLE_ID);
    if (enabled) {
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
          html.${ROOT_CLASS} { color-scheme:dark !important; }
          html.${ROOT_CLASS}.__bjtu-jlgj-dark-bg,
          html.${ROOT_CLASS} .__bjtu-jlgj-dark-bg { background:#0f172a none !important; }
          html.${ROOT_CLASS}.__bjtu-jlgj-dark-text,
          html.${ROOT_CLASS} .__bjtu-jlgj-dark-text { color:#e5e7eb !important; }
          html.${ROOT_CLASS}.__bjtu-jlgj-dark-border,
          html.${ROOT_CLASS} .__bjtu-jlgj-dark-border { border-color:#334155 !important; }
          html.${ROOT_CLASS} iframe[src*="open.weixin.qq.com/connect/"][src*="qrconnect"] {
            color-scheme:light !important;
          }
        `;
        (document.head || root).appendChild(style);
      }
      classifyTree(root);
      root.classList.add(ROOT_CLASS);
      if (!observer) {
        observer = new MutationObserver((records) => records.forEach((record) =>
          record.addedNodes.forEach(classifyTree)
        ));
        observer.observe(root, { childList: true, subtree: true });
      }
      return;
    }
    root.classList.remove(ROOT_CLASS);
    style?.remove();
    observer?.disconnect();
    observer = null;
    document.querySelectorAll('[data-bjtu-jlgj-login-bg]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const value = element.dataset.bjtuJlgjLoginBg || '';
      const priority = element.dataset.bjtuJlgjLoginBgPriority || '';
      if (value) element.style.setProperty('background', value, priority);
      else element.style.removeProperty('background');
      delete element.dataset.bjtuJlgjLoginBg;
      delete element.dataset.bjtuJlgjLoginBgPriority;
    });
    document.querySelectorAll('[data-bjtu-jlgj-login-color]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const value = element.dataset.bjtuJlgjLoginColor || '';
      const priority = element.dataset.bjtuJlgjLoginColorPriority || '';
      if (value) element.style.setProperty('color', value, priority);
      else element.style.removeProperty('color');
      delete element.dataset.bjtuJlgjLoginColor;
      delete element.dataset.bjtuJlgjLoginColorPriority;
    });
    document.getElementById('__bjtu_jlgj_dark_style__')?.remove();
    try { globalThis.__bjtuJlgjDarkObserver?.disconnect(); } catch { /* ignore */ }
    globalThis.__bjtuJlgjDarkObserver = null;
    globalThis.__bjtuJlgjDarkObserverVersion = 0;
  }

  function resolvedDark() {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    return !!media?.matches;
  }

  function sync() {
    if (!resolvedDark()) {
      apply(false);
      chrome.runtime.sendMessage({ type: 'JLGJ_CLEAR_LOGIN_DARK' }).catch(() => {});
      return;
    }
    apply(loginDarkEnabled && alwaysDarkEnabled);
  }

  chrome.storage.local.get(['themeMode', 'jlgjDarkModeEnabled', 'jlgjAlwaysDarkModeEnabled']).then((data) => {
    themeMode = data?.themeMode === 'light' || data?.themeMode === 'dark' ? data.themeMode : 'system';
    loginDarkEnabled = data?.jlgjDarkModeEnabled === true;
    alwaysDarkEnabled = data?.jlgjAlwaysDarkModeEnabled === true;
    sync();
  }).catch(() => apply(false));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.themeMode) {
      const value = changes.themeMode.newValue;
      themeMode = value === 'light' || value === 'dark' ? value : 'system';
    }
    if (changes.jlgjDarkModeEnabled) loginDarkEnabled = changes.jlgjDarkModeEnabled.newValue === true;
    if (changes.jlgjAlwaysDarkModeEnabled) alwaysDarkEnabled = changes.jlgjAlwaysDarkModeEnabled.newValue === true;
    if (changes.themeMode || changes.jlgjDarkModeEnabled || changes.jlgjAlwaysDarkModeEnabled) sync();
  });

  const onSystemThemeChange = () => { if (themeMode === 'system') sync(); };
  if (typeof media?.addEventListener === 'function') media.addEventListener('change', onSystemThemeChange);
  else if (typeof media?.addListener === 'function') media.addListener(onSystemThemeChange);
})();
