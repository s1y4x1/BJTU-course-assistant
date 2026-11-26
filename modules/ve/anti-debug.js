(function installVeAntiDebugBlocking() {
  'use strict';
  const KEY = 'veBlockAntiDebugEnabled';
  const RULE_ID = 914315;
  // Dynamic rules survive service-worker suspension and browser restarts.
  let pending = Promise.resolve();
  function synchronize() {
    pending = pending.catch(() => {}).then(async () => {
      const settings = await chrome.storage.local.get(KEY);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID],
        addRules: settings[KEY] === false ? [] : [{
          id: RULE_ID,
          priority: 1,
          action: { type: 'block' },
          condition: {
            regexFilter: '^http://(123\\.121\\.147\\.7|2071565063):88/ve/ui/jydH5Player/jyd20241210\\.min\\.js([?#]|$)',
            isUrlFilterCaseSensitive: true,
            resourceTypes: ['script']
          }
        }]
      });
    });
    pending.catch(error => console.warn('[bjtu] 更新智慧课程平台反调试拦截规则失败', error));
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.hasOwn(changes, KEY)) synchronize();
  });
  synchronize();
})();
