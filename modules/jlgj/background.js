(function initBjtuJlgjBackground() {
  'use strict';

async function injectJlgjThemeIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://i.jielong.com/*'] }).catch(() => []);
  await Promise.allSettled((tabs || []).filter((tab) => tab?.id).map((tab) =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['modules/jlgj/theme.js'] })
  ));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.jlgjAlwaysDarkModeEnabled) void injectJlgjThemeIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(() => { void injectJlgjThemeIntoOpenTabs(); });
void injectJlgjThemeIntoOpenTabs();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'JLGJ_CLEAR_LOGIN_DARK' || !sender?.tab?.id) return;
  chrome.scripting.executeScript({
    target: { tabId: sender.tab.id },
    world: 'MAIN',
    func: () => {
      const restore = (selector, property, valueKey, priorityKey) => {
        document.querySelectorAll(selector).forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const value = element.dataset[valueKey] || '';
          const priority = element.dataset[priorityKey] || '';
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
          delete element.dataset[valueKey];
          delete element.dataset[priorityKey];
        });
      };
      restore('[data-bjtu-jlgj-login-bg]', 'background', 'bjtuJlgjLoginBg', 'bjtuJlgjLoginBgPriority');
      restore('[data-bjtu-jlgj-login-color]', 'color', 'bjtuJlgjLoginColor', 'bjtuJlgjLoginColorPriority');
      document.getElementById('__bjtu_jlgj_dark_style__')?.remove();
      try { globalThis.__bjtuJlgjDarkObserver?.disconnect(); } catch { /* ignore */ }
      globalThis.__bjtuJlgjDarkObserver = null;
      globalThis.__bjtuJlgjDarkObserverVersion = 0;
    }
  }).catch(() => {});
});

})();
