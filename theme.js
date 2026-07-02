(() => {
  const STORAGE_KEY = 'themeMode';
  const DEFAULT_MODE = 'system';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  let mode = DEFAULT_MODE;
  let settingsLoaded = false;

  function normalizeMode(value) {
    return value === 'light' || value === 'dark' ? value : DEFAULT_MODE;
  }

  function applyTheme(nextMode = mode) {
    mode = normalizeMode(nextMode);
    const resolved = mode === DEFAULT_MODE ? (media?.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.colorScheme = resolved;
    document.documentElement.style.colorScheme = resolved;
    try {
      window.dispatchEvent(new CustomEvent('bjtu-theme-change', { detail: { mode, resolved } }));
    } catch {}
    if (settingsLoaded && resolved === 'light') {
      try {
        chrome.storage.local.set({
          jlgjDarkModeEnabled: false,
          jlgjAlwaysDarkModeEnabled: false
        }).catch(() => {});
      } catch {}
    }
  }

  applyTheme();

  try {
    chrome.storage.local.get([STORAGE_KEY]).then((data) => {
      settingsLoaded = true;
      applyTheme(data?.[STORAGE_KEY]);
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        settingsLoaded = true;
        applyTheme(changes[STORAGE_KEY].newValue);
      }
    });
  } catch {}

  const onSystemThemeChange = () => {
    if (mode === DEFAULT_MODE) applyTheme(mode);
  };
  if (typeof media?.addEventListener === 'function') media.addEventListener('change', onSystemThemeChange);
  else if (typeof media?.addListener === 'function') media.addListener(onSystemThemeChange);

  globalThis.BjtuTheme = Object.freeze({
    storageKey: STORAGE_KEY,
    defaultMode: DEFAULT_MODE,
    normalizeMode,
    applyTheme,
    getMode: () => mode
  });
})();
