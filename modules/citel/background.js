(function (global) {
  'use strict';
  let pending = null;
  const url = 'modules/citel/background.html';
  const absolute = chrome.runtime.getURL(url);
  async function contexts() {
    return chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  }
  global.BjtuCitelBackground = {
    fetchCourses(settings) {
      if (pending) return pending;
      pending = navigator.locks.request('bjtu-citel-background-parser', async () => {
        let owned = false;
        try {
          const open = await contexts();
          if (open.some((context) => context.documentUrl !== absolute)) throw new Error('其他离屏任务正在运行，CITEL 后台刷新将在下次重试');
          if (!open.length) {
            await chrome.offscreen.createDocument({ url, reasons: ['DOM_PARSER'], justification: '解析 CITEL Moodle 课程和作业页面用于后台提醒' });
            owned = true;
          }
          const response = await chrome.runtime.sendMessage({ type: 'CITEL_BACKGROUND_REFRESH', settings });
          if (!response?.ok) throw Object.assign(new Error(response?.error || 'CITEL 后台解析失败'), { code: response?.code || '' });
          return response.courses;
        } finally {
          // Never close another module's offscreen document.
          if (owned && (await contexts()).some((context) => context.documentUrl === absolute)) await chrome.offscreen.closeDocument();
        }
      }).finally(() => { pending = null; });
      return pending;
    }
  };
})(globalThis);
