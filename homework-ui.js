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

  function homeworkPalette({ done = false, overdue = false } = {}) {
    if (done) return { background: '#e8f5e9', border: '#4caf50', foreground: '#2e7d32', action: '#2E7D32' };
    if (overdue) return { background: '#ffebee', border: '#ef4444', foreground: '#b91c1c', action: '#b91c1c' };
    return { background: '#fff3e0', border: '#ff9800', foreground: '#e65100', action: '#E65100' };
  }

  function renderHomeworkCard({
    done = false,
    className = '',
    background = '#fff',
    border = '#d1d5db',
    titleHtml = '',
    metaHtml = '',
    actionsHtml = '',
    detailHtml = '',
    headClass = '',
    mainClass = '',
    actionsClass = '',
    headStyle = 'display:flex;justify-content:space-between;align-items:start;gap:8px;',
    attributes = ''
  } = {}) {
    const classes = ['hw-card-item', className].filter(Boolean).join(' ');
    const headClasses = headClass || 'homework-card-head';
    const mainClasses = mainClass || 'homework-card-main';
    const actionClasses = actionsClass || 'homework-card-actions';
    return `<div class="${classes}" data-homework-done="${done ? '1' : '0'}" ${attributes} style="background:${background};border:1px solid ${border};border-radius:6px;padding:8px;margin-top:8px;">
      <div class="${headClasses}" style="${headStyle}">
        <div class="${mainClasses}">${titleHtml}${metaHtml}</div>
        ${actionsHtml ? `<div class="${actionClasses}" style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">${actionsHtml}</div>` : ''}
      </div>
      ${detailHtml}
    </div>`;
  }

  global.BjtuHomeworkUi = Object.freeze({
    text,
    detailOptions,
    statusHtml,
    actionLabel,
    renderActionLink,
    homeworkPalette,
    renderHomeworkCard
  });
})(globalThis);
