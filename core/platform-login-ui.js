(function initBjtuPlatformLoginUi(global) {
  'use strict';

  const PLATFORM_LOGIN_CONFIG = Object.freeze({
    ve: Object.freeze({
      name: '智慧课程平台',
      url: 'http://123.121.147.7:88/ve/',
      color: '#1565c0',
      content: '课程'
    }),
    ykt: Object.freeze({
      name: '雨课堂',
      url: 'https://www.yuketang.cn/v2/web/index',
      color: '#5096f5',
      content: '作业'
    }),
    mrjzy: Object.freeze({
      name: '每日交作业',
      url: 'https://zuoye.lulufind.com/',
      color: '#29a9fc',
      content: '课程'
    }),
    jlgj: Object.freeze({
      name: '接龙管家',
      url: 'https://i.jielong.com/my-class',
      color: '#ffd243',
      content: '课程'
    }),
    mooc: Object.freeze({
      name: '中国大学MOOC',
      url: 'https://www.icourse163.org/',
      color: '#00cc7e',
      content: '课程'
    }),
    xuetangx: Object.freeze({
      name: '学堂在线',
      url: 'https://www.xuetangx.com/',
      color: '#1769fe',
      content: '课程'
    })
  });

  function loginLinkHtml(platform) {
    const config = PLATFORM_LOGIN_CONFIG[String(platform || '').trim()];
    if (!config) return '';
    return `<a href="${config.url}" target="_blank" rel="noopener noreferrer" style="color:${config.color}; text-decoration:none; font-weight:600;">${config.name}</a>`;
  }

  function loginRequiredHtml(platform) {
    const config = PLATFORM_LOGIN_CONFIG[String(platform || '').trim()];
    if (!config) return '请前往对应平台登录';
    return `如需查看${loginLinkHtml(platform)}${config.content}，请前往登录`;
  }

  global.BjtuPlatformLoginUi = Object.freeze({
    configs: PLATFORM_LOGIN_CONFIG,
    loginLinkHtml,
    loginRequiredHtml
  });
})(globalThis);
