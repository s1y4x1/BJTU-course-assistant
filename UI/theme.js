(() => {
  const STORAGE_KEY = 'themeMode';
  const DEFAULT_MODE = 'system';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const ANIMATION_STORAGE_KEY = 'animationMode';
  const ANIMATION_SPEED_STORAGE_KEY = 'animationSpeed';
  const DEFAULT_ANIMATION_MODE = 'system';
  const DEFAULT_ANIMATION_SPEED = 1;
  const reducedMotionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let mode = DEFAULT_MODE;
  let animationMode = DEFAULT_ANIMATION_MODE;
  let animationSpeed = DEFAULT_ANIMATION_SPEED;

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
  }

  function normalizeAnimationMode(value) {
    return value === 'on' || value === 'off' ? value : DEFAULT_ANIMATION_MODE;
  }

  function normalizeAnimationSpeed(value) {
    const speed = Number(value);
    return Number.isFinite(speed) && speed >= 0.25 && speed <= 2 ? speed : DEFAULT_ANIMATION_SPEED;
  }

  function applyPlaybackRate() {
    if (!document.getAnimations) return;
    const rate = isAnimationEnabled() ? animationSpeed : 1;
    document.getAnimations().forEach((animation) => {
      try { animation.updatePlaybackRate(rate); } catch {}
    });
  }

  function isAnimationEnabled() {
    return animationMode === 'on'
      || (animationMode === DEFAULT_ANIMATION_MODE && !reducedMotionMedia?.matches);
  }

  function applyAnimation(nextMode = animationMode, nextSpeed = animationSpeed) {
    animationMode = normalizeAnimationMode(nextMode);
    animationSpeed = normalizeAnimationSpeed(nextSpeed);
    const enabled = isAnimationEnabled();
    document.documentElement.dataset.animationMode = animationMode;
    document.documentElement.dataset.animationEnabled = enabled ? 'true' : 'false';
    document.documentElement.style.setProperty('--bjtu-animation-speed', String(animationSpeed));
    applyPlaybackRate();
    try {
      window.dispatchEvent(new CustomEvent('bjtu-animation-change', {
        detail: { mode: animationMode, enabled, speed: animationSpeed }
      }));
    } catch {}
  }

  const motionPolicy = document.createElement('style');
  motionPolicy.id = 'bjtu-animation-policy';
  motionPolicy.textContent = `
    html[data-animation-enabled="false"] *,
    html[data-animation-enabled="false"] *::before,
    html[data-animation-enabled="false"] *::after {
      animation-delay: 0s !important;
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-delay: 0s !important;
      transition-duration: 0.001ms !important;
      scroll-behavior: auto !important;
    }
  `;
  document.documentElement.appendChild(motionPolicy);

  applyTheme();
  applyAnimation();

  try {
    chrome.storage.local.get([STORAGE_KEY, ANIMATION_STORAGE_KEY, ANIMATION_SPEED_STORAGE_KEY]).then((data) => {
      applyTheme(data?.[STORAGE_KEY]);
      applyAnimation(data?.[ANIMATION_STORAGE_KEY], data?.[ANIMATION_SPEED_STORAGE_KEY]);
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE_KEY]) applyTheme(changes[STORAGE_KEY].newValue);
      if (changes[ANIMATION_STORAGE_KEY] || changes[ANIMATION_SPEED_STORAGE_KEY]) {
        applyAnimation(
          changes[ANIMATION_STORAGE_KEY]?.newValue ?? animationMode,
          changes[ANIMATION_SPEED_STORAGE_KEY]?.newValue ?? animationSpeed
        );
      }
    });
  } catch {}

  const onSystemThemeChange = () => {
    if (mode === DEFAULT_MODE) applyTheme(mode);
  };
  if (typeof media?.addEventListener === 'function') media.addEventListener('change', onSystemThemeChange);
  else if (typeof media?.addListener === 'function') media.addListener(onSystemThemeChange);

  const onSystemMotionChange = () => {
    if (animationMode === DEFAULT_ANIMATION_MODE) applyAnimation(animationMode, animationSpeed);
  };
  if (typeof reducedMotionMedia?.addEventListener === 'function') reducedMotionMedia.addEventListener('change', onSystemMotionChange);
  else if (typeof reducedMotionMedia?.addListener === 'function') reducedMotionMedia.addListener(onSystemMotionChange);

  ['animationstart', 'transitionrun'].forEach((eventName) => {
    document.addEventListener(eventName, () => requestAnimationFrame(applyPlaybackRate), true);
  });

  globalThis.BjtuTheme = Object.freeze({
    storageKey: STORAGE_KEY,
    defaultMode: DEFAULT_MODE,
    normalizeMode,
    applyTheme,
    getMode: () => mode
  });

  globalThis.BjtuMotion = Object.freeze({
    storageKey: ANIMATION_STORAGE_KEY,
    speedStorageKey: ANIMATION_SPEED_STORAGE_KEY,
    defaultMode: DEFAULT_ANIMATION_MODE,
    defaultSpeed: DEFAULT_ANIMATION_SPEED,
    normalizeMode: normalizeAnimationMode,
    normalizeSpeed: normalizeAnimationSpeed,
    apply: applyAnimation,
    getMode: () => animationMode,
    getSpeed: () => animationSpeed,
    isEnabled: isAnimationEnabled,
    duration: (milliseconds) => isAnimationEnabled() ? Number(milliseconds) / animationSpeed : 0
  });
})();
