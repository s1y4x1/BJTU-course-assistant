(function initBjtuHomeworkUi(global) {
  'use strict';

  const PLATFORM_NAMES = Object.freeze({
    ve: '智慧课程平台',
    ykt: '雨课堂',
    mrjzy: '每日交作业',
    jlgj: '接龙管家',
    mooc: '中国大学MOOC'
  });
  const ACTION_NAMES = Object.freeze({
    view: '查看',
    submit: '提交',
    learn: '学习',
    quiz: '测验',
    exam: '考试'
  });
  const text = Object.freeze({
    detailExpand: '点击查看作业详情',
    detailCollapse: '点击收起作业详情',
    detailLoading: '正在获取作业详情…',
    detailQueued: '正在排队等待…',
    detailFailed: '作业详情获取失败，可稍后重试',
    detailEmpty: '无作业详情'
  });

  function detailOptions(options = {}) {
    return {
      expandText: text.detailExpand,
      collapseText: text.detailCollapse,
      ...options
    };
  }

  function statusHtml({ done = false, overdue = false } = {}) {
    if (done) return '<span class="homework-status-done">(已提交)</span>';
    if (overdue) return '<span class="homework-status-overdue">(已逾期)</span>';
    return '';
  }

  function actionLabel(platform, action, { lead } = {}) {
    const platformName = PLATFORM_NAMES[String(platform || '')] || '';
    const actionName = ACTION_NAMES[String(action || '')] || String(action || '');
    if (!platformName || lead === '') return actionName;
    return `${lead === undefined ? '去' : String(lead)}${platformName}${actionName}`;
  }

  function renderActionLink({
    href,
    label,
    color,
    className = 'btn',
    padding = '2px 6px',
    escape = (value) => String(value || '')
  } = {}) {
    return `<a class="${escape(className)}" href="${escape(href)}" target="_blank" rel="noopener noreferrer" style="background:${escape(color)}; padding:${escape(padding)}; font-size:12px; text-decoration:none; color:#fff;">${escape(label)}</a>`;
  }

  global.BjtuHomeworkUi = Object.freeze({
    text,
    detailOptions,
    statusHtml,
    actionLabel,
    renderActionLink
  });
})(globalThis);
