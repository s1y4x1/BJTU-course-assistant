(function installOptionalPlatformAdapters(global) {
  'use strict';

  const noop = () => {};
  const emptyHtml = () => '';
  const falseValue = () => false;
  const resolved = () => Promise.resolve();
  const defineFunction = (name, value) => {
    if (typeof global[name] !== 'function') global[name] = value;
  };
  const defineValue = (name, value) => {
    if (!(name in global)) global[name] = value;
  };

  global.__bjtuOptionalPlatformAdaptersReady = (async () => {
    const available = await global.BjtuModuleRegistry.ready;
    await global.__bjtuPlatformModulesReady;

    if (!available.ykt) {
      defineValue('YKT_LOGIN_REQUIRED_HTML', '雨课堂模块未安装');
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
      defineValue('MRJZY_LOGIN_REQUIRED_HTML', '每日交作业模块未安装');
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
      defineValue('JLGJ_LOGIN_REQUIRED_HTML', '接龙管家模块未安装');
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
      defineValue('MOOC_LOGIN_REQUIRED_HTML', '中国大学MOOC模块未安装');
      defineFunction('closeMoocLoginAssistPopup', noop);
      defineFunction('openMoocLoginAssistPopup', noop);
      global.BjtuMoocPlatform = null;
    }

    if (!available.xuetangx) {
      global.BjtuXuetangxPlatform = null;
    }
  })();
})(globalThis);
