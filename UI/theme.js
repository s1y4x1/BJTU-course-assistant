(() => {
  const STORAGE_KEY = 'themeMode';
  const DEFAULT_MODE = 'system';
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const ANIMATION_STORAGE_KEY = 'animationMode';
  const ANIMATION_SPEED_STORAGE_KEY = 'animationSpeed';
  const FONT_SIZE_STORAGE_KEY = 'fontSizeSettings';
  const FONT_SIZE_DEFAULTS = Object.freeze({
    zeroTitle: 24,
    icon: 22,
    primaryTitle: 18,
    secondaryTitle: 15,
    body: 13,
    auxiliary: 11
  });
  const DEFAULT_ANIMATION_MODE = 'system';
  const DEFAULT_ANIMATION_SPEED = 1;
  const reducedMotionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let mode = DEFAULT_MODE;
  let animationMode = DEFAULT_ANIMATION_MODE;
  let animationSpeed = DEFAULT_ANIMATION_SPEED;
  let fontSizeSettings = { ...FONT_SIZE_DEFAULTS };

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
    return Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_ANIMATION_SPEED;
  }

  function animationTargetElement(animation) {
    const target = animation?.effect?.target;
    if (target instanceof Element) return target;
    return target?.element instanceof Element ? target.element : null;
  }

  function isLoadingSpinnerAnimation(animation) {
    if (/spin/i.test(String(animation?.animationName || ''))) return true;
    const target = animationTargetElement(animation);
    return !!target && (
      target.matches('[class*="spinner"], .checking .dot, .content-loading .dot, .is-loading')
      || !!target.closest('[class*="spinner"], .checking, .content-loading, .is-loading')
    );
  }

  function applyPlaybackRate() {
    if (!document.getAnimations) return;
    const rate = isAnimationEnabled() ? animationSpeed : 1;
    document.getAnimations().forEach((animation) => {
      try { animation.updatePlaybackRate(isLoadingSpinnerAnimation(animation) ? 1 : rate); } catch {}
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

  function normalizeFontSizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.fromEntries(Object.entries(FONT_SIZE_DEFAULTS).map(([key, fallback]) => {
      const size = Number(source[key]);
      return [key, Number.isFinite(size) && size > 0 ? size : fallback];
    }));
  }

  function applyFontSizeSettings(value = fontSizeSettings) {
    fontSizeSettings = normalizeFontSizeSettings(value);
    Object.entries(fontSizeSettings).forEach(([key, size]) => {
      document.documentElement.style.setProperty(`--bjtu-font-size-${key}`, `${size}px`);
    });
    try {
      window.dispatchEvent(new CustomEvent('bjtu-font-size-change', { detail: { ...fontSizeSettings } }));
    } catch {}
  }

  const rewrittenStyleSheets = new WeakSet();
  const fontSizeCategoryByValue = new Map([
    ['24px', 'zeroTitle'],
    ['1.5rem', 'zeroTitle'],
    ['22px', 'icon'],
    ['18px', 'primaryTitle'],
    ['15px', 'secondaryTitle'],
    ['14px', 'secondaryTitle'],
    ['13px', 'body'],
    ['12px', 'body'],
    ['11px', 'auxiliary']
  ]);

  function rewriteFontSizeDeclaration(style) {
    const raw = String(style?.getPropertyValue?.('font-size') || '').trim().toLowerCase();
    const category = fontSizeCategoryByValue.get(raw);
    if (!category) return;
    const priority = style.getPropertyPriority('font-size');
    style.setProperty(
      'font-size',
      `var(--bjtu-font-size-${category}, ${FONT_SIZE_DEFAULTS[category]}px)`,
      priority
    );
  }

  function rewriteCssRules(rules) {
    Array.from(rules || []).forEach((rule) => {
      if (rule.style) rewriteFontSizeDeclaration(rule.style);
      if (rule.cssRules) rewriteCssRules(rule.cssRules);
    });
  }

  function rewriteStyleSheet(sheet) {
    if (!sheet || rewrittenStyleSheets.has(sheet)) return;
    try {
      rewriteCssRules(sheet.cssRules);
      rewrittenStyleSheets.add(sheet);
    } catch {}
  }

  function rewriteInlineFontSizes(root) {
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof HTMLElement && root.hasAttribute('style')) rewriteFontSizeDeclaration(root.style);
    root.querySelectorAll?.('[style]').forEach((element) => rewriteFontSizeDeclaration(element.style));
  }

  function installFontSizeCategories() {
    Array.from(document.styleSheets).forEach(rewriteStyleSheet);
    rewriteInlineFontSizes(document);
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes') {
          rewriteFontSizeDeclaration(mutation.target.style);
          return;
        }
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          rewriteInlineFontSizes(node);
          if (node.matches('link[rel="stylesheet"], style')) {
            if (node.sheet) rewriteStyleSheet(node.sheet);
            node.addEventListener('load', () => rewriteStyleSheet(node.sheet), { once: true });
          }
          node.querySelectorAll?.('link[rel="stylesheet"], style').forEach((styleNode) => {
            if (styleNode.sheet) rewriteStyleSheet(styleNode.sheet);
            styleNode.addEventListener('load', () => rewriteStyleSheet(styleNode.sheet), { once: true });
          });
        });
      });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  }

  const motionPolicy = document.createElement('style');
  motionPolicy.id = 'bjtu-animation-policy';
  motionPolicy.textContent = `
    html[data-animation-enabled="false"] *:not(:is([class*="spinner"], .checking .dot, .content-loading .dot, .is-loading)),
    html[data-animation-enabled="false"] *:not(:is([class*="spinner"], .checking .dot, .content-loading .dot, .is-loading))::before,
    html[data-animation-enabled="false"] *:not(:is([class*="spinner"], .checking .dot, .content-loading .dot, .is-loading))::after {
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
  applyFontSizeSettings();

  try {
    chrome.storage.local.get([STORAGE_KEY, ANIMATION_STORAGE_KEY, ANIMATION_SPEED_STORAGE_KEY, FONT_SIZE_STORAGE_KEY]).then((data) => {
      applyTheme(data?.[STORAGE_KEY]);
      applyAnimation(data?.[ANIMATION_STORAGE_KEY], data?.[ANIMATION_SPEED_STORAGE_KEY]);
      applyFontSizeSettings(data?.[FONT_SIZE_STORAGE_KEY]);
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
      if (changes[FONT_SIZE_STORAGE_KEY]) applyFontSizeSettings(changes[FONT_SIZE_STORAGE_KEY].newValue);
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installFontSizeCategories, { once: true });
  else installFontSizeCategories();

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

  globalThis.BjtuTypography = Object.freeze({
    storageKey: FONT_SIZE_STORAGE_KEY,
    defaults: FONT_SIZE_DEFAULTS,
    normalizeSettings: normalizeFontSizeSettings,
    apply: applyFontSizeSettings,
    getSettings: () => ({ ...fontSizeSettings })
  });
})();
