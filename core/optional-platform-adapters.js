(function installOptionalPlatformAdapters(global) {
  'use strict';

  const noop = () => {};
  const emptyHtml = () => '';
  const falseValue = () => false;
  const resolved = () => Promise.resolve();
  const defineFunction = (name, value) => {
    if (typeof global[name] !== 'function') global[name] = value;
  };
  global.__bjtuOptionalPlatformAdaptersReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    await global.__bjtuPlatformModulesReady;

    if (!available.ykt) {
      defineFunction('isYktHomeworkDone', falseValue);
      defineFunction('isYktHomeworkPending', falseValue);
      defineFunction('isYktHomeworkOverdue', falseValue);
      defineFunction('yktCourseLink', () => '');
      defineFunction('clearYktStandaloneCards', noop);
      defineFunction('closeYktLoginAssistPopup', noop);
      defineFunction('renderYktNeedLoginMessage', noop);
      defineFunction('loadDeferredYktHomeworkDetails', resolved);
      defineFunction('renderYktHomeworkItems', emptyHtml);
      defineFunction('renderYktStandaloneCourses', noop);
      defineFunction('scheduleYktLoad', resolved);
    }

    if (!available.mrjzy) {
      defineFunction('formatMrjzyDateTime', (value) => String(value || ''));
      defineFunction('removeMrjzyLoginTip', noop);
      defineFunction('closeMrjzyLoginAssistPopup', noop);
      defineFunction('clearMrjzyStandaloneCards', noop);
      defineFunction('renderMrjzyNeedLoginMessage', noop);
      defineFunction('isMrjzyHomeworkDone', falseValue);
      defineFunction('isMrjzyHomeworkPending', falseValue);
      defineFunction('isMrjzyHomeworkOverdue', falseValue);
      defineFunction('renderMrjzyHomeworkItems', emptyHtml);
      defineFunction('renderMrjzyStandaloneCourses', noop);
      defineFunction('scheduleMrjzyLoad', resolved);
    }

    if (!available.jlgj) {
      defineFunction('closeJlgjLoginAssistPopup', noop);
      defineFunction('clearJlgjStandaloneCards', noop);
      defineFunction('renderJlgjNeedLoginMessage', noop);
      defineFunction('isJlgjHomeworkDone', falseValue);
      defineFunction('isJlgjHomeworkPending', falseValue);
      defineFunction('isJlgjHomeworkOverdue', falseValue);
      defineFunction('renderJlgjHomeworkItems', emptyHtml);
      defineFunction('renderJlgjStandaloneCourses', noop);
      defineFunction('scheduleJlgjLoad', resolved);
    }

    if (!available.mooc) {
      defineFunction('closeMoocLoginAssistPopup', noop);
      defineFunction('openMoocLoginAssistPopup', noop);
      global.BjtuMoocPlatform = null;
    }

    if (!available.xuetangx) {
      global.BjtuXuetangxPlatform = null;
    }
  })();
})(globalThis);
