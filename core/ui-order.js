(function initBjtuUiOrder(global) {
  'use strict';

  const DEFAULT_OPTIONS_SECTION_ORDER = Object.freeze([
    'appearance',
    'platforms',
    'popup',
    'reminders',
    'updater',
    'module:campusnet',
    'module:captcha',
    'module:academic',
    'module:cas',
    'module:mail',
    'module:qwen'
  ]);
  const DEFAULT_PLATFORM_ORDER = Object.freeze(['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx']);

  function getOptionsSectionIds() {
    const discoveredModules = Object.entries(global.BjtuModuleRegistry?.definitions || {})
      .filter(([, definition]) => !!definition?.options)
      .map(([id]) => `module:${id}`);
    return [...new Set([...DEFAULT_OPTIONS_SECTION_ORDER, ...discoveredModules])];
  }

  function normalize(raw, allowed) {
    const allowedIds = [...allowed].map(String);
    const allowedSet = new Set(allowedIds);
    const seen = new Set();
    const result = [];
    (Array.isArray(raw) ? raw : []).forEach((value) => {
      const id = String(value || '');
      if (!allowedSet.has(id) || seen.has(id)) return;
      seen.add(id);
      result.push(id);
    });
    allowedIds.forEach((id) => {
      if (!seen.has(id)) result.push(id);
    });
    return result;
  }

  global.BjtuUiOrder = {
    DEFAULT_OPTIONS_SECTION_ORDER,
    DEFAULT_PLATFORM_ORDER,
    normalizeOptionsSections: (raw) => normalize(raw, getOptionsSectionIds()),
    normalizePlatforms: (raw) => normalize(raw, DEFAULT_PLATFORM_ORDER)
  };
})(globalThis);
