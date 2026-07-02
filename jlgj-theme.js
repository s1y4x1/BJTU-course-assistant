(function () {
  if (globalThis.__bjtuJlgjThemeInstalled) return;
  globalThis.__bjtuJlgjThemeInstalled = true;

  const STYLE_ID = '__bjtu_jlgj_always_dark_style__';
  const ROOT_CLASS = '__bjtu-jlgj-always-dark';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let themeMode = 'system';
  let loginDarkEnabled = false;
  let alwaysDarkEnabled = false;

  function apply(enabled) {
    const root = document.documentElement;
    if (!root) return;
    let style = document.getElementById(STYLE_ID);
    if (enabled) {
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
          html.${ROOT_CLASS},
          html.${ROOT_CLASS} body {
            background:#0f172a none !important;
            color:#e5e7eb !important;
            color-scheme:dark !important;
          }
          html.${ROOT_CLASS} body *:not(iframe):not(.toggle):not(.toggle *) {
            background:#0f172a none !important;
            color:#e5e7eb !important;
            border-color:#334155 !important;
          }
          html.${ROOT_CLASS} iframe[src*="open.weixin.qq.com/connect/"][src*="qrconnect"] {
            color-scheme:light !important;
          }
        `;
        (document.head || root).appendChild(style);
      }
      root.classList.add(ROOT_CLASS);
      return;
    }
    root.classList.remove(ROOT_CLASS);
    style?.remove();
  }

  function resolvedDark() {
    if (themeMode === 'dark') return true;
    if (themeMode === 'light') return false;
    return !!media?.matches;
  }

  function sync() {
    if (!resolvedDark()) {
      apply(false);
      if (loginDarkEnabled || alwaysDarkEnabled) {
        loginDarkEnabled = false;
        alwaysDarkEnabled = false;
        chrome.storage.local.set({
          jlgjDarkModeEnabled: false,
          jlgjAlwaysDarkModeEnabled: false
        }).catch(() => {});
      }
      return;
    }
    apply(alwaysDarkEnabled);
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
