(function initBjtuHomeworkUi(global) {
  'use strict';

  const PLATFORM_NAMES = Object.freeze({
    ve: '智慧课程平台',
    ykt: '雨课堂',
    mrjzy: '每日交作业',
    jlgj: '接龙管家',
    mooc: '中国大学MOOC',
    xuetangx: '学堂在线'
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

  function spinnerPhaseStyle(periodMs = 1000) {
    const period = Math.max(1, Number(periodMs) || 1000);
    return `animation-delay:-${Date.now() % period}ms;`;
  }

  function sanitizeRichHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    template.content
      .querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,meta,link')
      .forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const raw = String(attr.value || '').trim();
        if (name.startsWith('on') || ['style', 'id', 'class', 'srcdoc'].includes(name)) {
          node.removeAttribute(attr.name);
          continue;
        }
        if (['href', 'src'].includes(name) && !/^(?:https?:|data:image\/|\/)/i.test(raw)) {
          node.removeAttribute(attr.name);
        }
      }
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return template.innerHTML.trim();
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

  function deadlineMetaHtml({ deadline, formatted, done = false, overdue = false, loading = false, showStatus = true, showCountdown = true, suffixHtml = '', tailHtml = '', escape = (value) => String(value ?? '') } = {}) {
    const status = showStatus ? statusHtml({ done, overdue }) : '';
    const countdown = showCountdown && !done && !overdue && !loading && deadline
      ? `<span class="deadline-countdown" data-deadline="${escape(String(deadline))}"></span>`
      : '';
    return `<div class="homework-deadline-meta">截止：<span class="homework-deadline-value">${escape(formatted || '无期限')}</span>${suffixHtml}${status ? ` ${status}` : ''}${countdown}${tailHtml}</div>`;
  }

  function scoreBadgeHtml({ userScore = null, totalScore = null, visible = true, escape = (value) => String(value ?? ''), className = '' } = {}) {
    if (!visible || userScore === null || userScore === undefined || String(userScore) === '') return '';
    const total = totalScore === null || totalScore === undefined || String(totalScore) === '' ? '' : `/${escape(totalScore)}`;
    return `<span class="homework-score-badge ${escape(className)}">[${escape(userScore)}${total}]</span>`;
  }

  function progressHtml({ ratio = 0, label = '进度', loading = false, escape = (value) => String(value ?? ''), color = '#1769fe', className = '' } = {}) {
    const normalized = Math.max(0, Math.min(1, Number(ratio) || 0));
    const percentNumber = normalized * 100;
    const percent = percentNumber >= 99.95
      ? '100%'
      : `${percentNumber.toFixed(percentNumber < 10 ? 1 : 0).replace(/\.0$/, '')}%`;
    const value = loading
      ? `<span class="spinner homework-progress-spinner" style="${spinnerPhaseStyle()}"></span>`
      : `<span class="homework-progress-value">${escape(percent)}</span>`;
    return `<div class="homework-progress-row ${escape(className)}"><span class="homework-progress-label">${escape(label)} ${value}</span><span class="homework-progress-track"><span style="width:${percentNumber}%;background:${escape(color)}"></span></span></div>`;
  }

  function toggleLabels(kind) {
    return kind === 'done'
      ? { collapsed: '查看已交作业', expanded: '收起已交作业' }
      : { collapsed: '查看逾期作业', expanded: '收起逾期作业' };
  }

  function titleHtml({ typeLabel = '', typeHref = '', title = '', color = 'inherit', href = '', escape = (value) => String(value ?? ''), className = '' } = {}) {
    const typeContent = escape(typeLabel);
    const type = typeLabel
      ? (typeHref
        ? `<a class="homework-type-badge" href="${escape(typeHref)}" target="_blank" rel="noopener noreferrer">${typeContent}</a>`
        : `<span class="homework-type-badge">${typeContent}</span>`)
      : '';
    const text = href
      ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${escape(title)}</a>`
      : escape(title);
    return `<div class="homework-card-title ${escape(className)}" style="color:${escape(color)};">${type}${text}</div>`;
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
    spinnerPhaseStyle,
    sanitizeRichHtml,
    statusHtml,
    actionLabel,
    renderActionLink,
    homeworkPalette,
    deadlineMetaHtml,
    scoreBadgeHtml,
    progressHtml,
    toggleLabels,
    titleHtml,
    renderHomeworkCard
  });
})(globalThis);
