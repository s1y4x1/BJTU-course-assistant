(function () {
  'use strict';
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'CITEL_BACKGROUND_REFRESH') return false;
    BjtuCitelPlatform.fetchBackgroundCourses(message.settings || {}).then(
      (courses) => respond({ ok: true, courses }),
      (error) => respond({ ok: false, error: error.message, code: error.code || '' })
    );
    return true;
  });
})();
