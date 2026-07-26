(function initBjtuCourseCardUi(global) {
  'use strict';

  function createCourseCard({
    courseId,
    className = '',
    order = 0,
    rank = 7,
    titleHtml = '',
    metaHtml = '',
    actionsHtml = '',
    contentHtml = '',
    headerClass = '',
    identityClass = '',
    homeworkClass = 'homework-area',
    includeResultArea = true,
    wrapActions = true,
    headerStyle = 'display:flex;justify-content:space-between;align-items:center;gap:8px;',
    homeworkStyle = 'margin-top:6px;padding-top:6px;border-top:1px dashed #eee;font-size:13px;color:#666;',
    background = '#fff'
  } = {}) {
    const card = document.createElement('div');
    card.className = ['file-item', className].filter(Boolean).join(' ');
    card.style.backgroundColor = background;
    card.id = `course-${String(courseId || '')}`;
    card.dataset.courseId = String(courseId || '');
    card.dataset.courseRankable = '1';
    card.dataset.order = String(order);
    card.dataset.rank = String(rank);
    const headerClasses = headerClass || 'course-card-head';
    const identityClasses = identityClass || 'course-card-identity';
    card.innerHTML = `<div class="${headerClasses}" style="${headerStyle}">
        <div class="${identityClasses}">
          <div class="course-card-title"><strong>${titleHtml}</strong></div>
          ${metaHtml}
        </div>
        ${actionsHtml ? (wrapActions ? `<div class="course-actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">${actionsHtml}</div>` : actionsHtml) : ''}
      </div>
      ${includeResultArea ? '<div class="result-area" style="margin-top:6px;display:none;padding-top:6px;border-top:1px dashed #eee;"></div>' : ''}
      <div id="homework-area-${String(courseId || '')}" class="${homeworkClass}" style="${homeworkStyle}">${contentHtml}</div>`;
    return card;
  }

  global.BjtuCourseCardUi = Object.freeze({ createCourseCard });
})(globalThis);
