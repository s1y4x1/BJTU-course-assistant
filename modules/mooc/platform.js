const MOOC_LOGIN_LINK_HTML = '<a href="https://www.icourse163.org/" target="_blank" rel="noopener noreferrer" style="color:#00cc7e; text-decoration:none; font-weight:600;">中国大学MOOC</a>';
const MOOC_LOGIN_REQUIRED_HTML = `如需查看${MOOC_LOGIN_LINK_HTML}课程，请前往登录`;
const MOOC_LOGIN_ASSIST_URL = 'https://www.icourse163.org/passport/sns/doOAuth.htm?snsType=6&oauthType=login';
let moocLoginAssistPollTimer = null;
let moocLoginAssistChecking = false;
let moocLoginAssistPopupWindowId = null;
let moocLoginAssistPopupTabId = null;

(function () {
  'use strict';

  let env;
  let courses = [];
  let loadSerial = 0;
  let operationRunning = false;
  const expandedGroups = new Map();
  const taskDetailCache = new Map();

  const request = async (action, payload = {}) => {
    const response = await chrome.runtime.sendMessage({ type: 'MOOC_REQUEST', action, payload });
    if (!response?.ok) {
      const error = new Error(response?.message || '中国大学MOOC请求失败');
      error.code = response?.code || '';
      throw error;
    }
    return response.data;
  };

  const checkLogin = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'MOOC_LOGIN_STATUS' });
    if (!response?.ok || !response.loggedIn) {
      const error = new Error('未登录中国大学MOOC');
      error.code = 'not-logged-in';
      throw error;
    }
  };

  async function acquireHelperTab() {
    const response = await chrome.runtime.sendMessage({ type: 'MOOC_ACQUIRE_HELPER_TAB' });
    if (!response?.ok || !response.leaseId) {
      throw new Error(response?.message || '无法创建中国大学MOOC后台页面');
    }
    return String(response.leaseId);
  }

  async function releaseHelperTab(leaseId) {
    if (!leaseId) return;
    await chrome.runtime.sendMessage({ type: 'MOOC_RELEASE_HELPER_TAB', leaseId }).catch(() => null);
  }

  const formatTime = (value) => {
    const d = new Date(Number(value || 0));
    if (!Number(value) || Number.isNaN(d.getTime())) return '无期限';
    const pad = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const typeText = (type) => type === 'hw' ? '单元作业' : (type === 'exam' ? '考试' : '单元测试');
  const actionText = (type) => type === 'hw' ? '提交' : (type === 'exam' ? '考试' : '测验');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isRetryableDetailError(error) {
    const message = String(error?.message || error || '');
    if (/未登录|拒绝|HTTP\s*(?:401|403)|missing.?csrf/i.test(message) || ['not-logged-in', 'missing-csrf'].includes(error?.code)) return false;
    return /并发|频繁|稍后|繁忙|busy|limit|too many|failed to fetch|network|HTTP\s*(?:429|5\d\d)/i.test(message)
      || !error?.code;
  }

  async function requestPaperWithRetry(action, tid, emptyMessage) {
    let lastError = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const response = await request(action, { tid: Number(tid) });
        if (response?.result) return response.result;
        lastError = new Error(emptyMessage);
      } catch (error) {
        lastError = error;
        if (!isRetryableDetailError(error)) throw error;
      }
      if (attempt < 9) await sleep(Math.min(400 * (attempt + 1), 2000));
    }
    throw lastError || new Error(emptyMessage);
  }

  async function requestTeachersWithRetry(url) {
    let lastError = null;
    let lastEmptyResult = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const teachers = await request('course-page', { url });
        if (Array.isArray(teachers) && teachers.length) return teachers;
        lastEmptyResult = Array.isArray(teachers) ? teachers : [];
        lastError = new Error('课程教师解析为空');
      } catch (error) {
        lastError = error;
      }
      if (attempt < 4) await sleep(400 * (attempt + 1));
    }
    if (lastEmptyResult.length) return lastEmptyResult;
    throw lastError || new Error('课程教师获取失败');
  }

  function buildTask(test, type, chapterName) {
    const deadline = Number(test?.deadline || 0);
    const done = test?.userScore !== null && test?.userScore !== undefined && String(test.userScore) !== '';
    const task = {
      id: String(test.id),
      type,
      title: String(test.name || typeText(type)),
      chapterName: String(chapterName || ''),
      deadline,
      userScore: done ? test.userScore : null,
      totalScore: test?.totalScore ?? null,
      done,
      overdue: !done && deadline > 0 && deadline < Date.now()
    };
    task.detail = taskDetailCache.get(`${type}:${task.id}`) || null;
    return task;
  }

  function normalizeTasks(term) {
    const tasks = [];
    for (const chapter of (term?.chapters || [])) {
      for (const item of (chapter?.homeworks || [])) if (item?.test?.id) tasks.push(buildTask(item.test, 'hw', chapter.name));
      for (const item of (chapter?.quizs || [])) if (item?.test?.id) tasks.push(buildTask(item.test, 'quiz', chapter.name));
      if (chapter?.exam?.objectTestVo?.id) tasks.push(buildTask(chapter.exam.objectTestVo, 'exam', chapter.name));
    }
    return tasks;
  }

  function normalizeCourse(panel, term) {
    const id = String(panel?.id || term?.courseId || '');
    const tid = String(panel?.termPanel?.id || term?.id || '');
    const schoolShortName = String(panel?.schoolPanel?.shortName || 'COURSE');
    return {
      id,
      tid,
      name: String(panel?.name || term?.courseName || '中国大学MOOC课程'),
      schoolName: String(panel?.schoolPanel?.name || ''),
      schoolShortName,
      teachers: Array.isArray(panel?.teachers) ? panel.teachers : [],
      url: `https://www.icourse163.org/learn/${encodeURIComponent(schoolShortName)}-${encodeURIComponent(id)}?tid=${encodeURIComponent(tid)}`,
      tasks: normalizeTasks(term),
      detailLoaded: !!term
    };
  }

  function taskUrl(course, task) {
    const hash = task.type === 'hw' ? `#/learn/hw?id=${task.id}`
      : (task.type === 'exam' ? `#/learn/examObject?id=${task.id}` : `#/learn/quiz?id=${task.id}`);
    return course.url + hash;
  }

  function sanitizeDetailHtml(value) {
    const template = document.createElement('template');
    template.innerHTML = String(value || '');
    template.content.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,meta,link').forEach((node) => node.remove());
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

  function buildPaperDetail(paper, correctIds = new Set()) {
    const questions = [...(paper?.objectiveQList || []), ...(paper?.subjectiveQList || [])];
    return questions.map((question, index) => {
      const linesHtml = [];
      for (const option of (question?.optionDtos || [])) {
        const html = sanitizeDetailHtml(option?.name || option?.content || option?.optionContent || option?.id);
        if (html) linesHtml.push(`${correctIds.has(option?.id) ? '<span class="mooc-correct-mark">✓</span> ' : ''}${html}`);
      }
      for (const judge of (question?.judgeDtos || [])) {
        const html = sanitizeDetailHtml(judge?.msg || judge?.content || '');
        if (html) linesHtml.push(html);
      }
      return {
        titleHtml: sanitizeDetailHtml(question?.name || question?.title || question?.content) || `第${index + 1}题`,
        linesHtml
      };
    });
  }

  function renderTaskDetail(course, task, colors) {
    if (task.detailLoading) {
      return `<div class="mooc-task-detail" style="border-top-color:${colors[1]};"><span class="spinner mooc-inline-spinner"></span> 正在获取作业详情…</div>`;
    }
    const questions = Array.isArray(task.detail?.questions) ? task.detail.questions : [];
    if (!questions.length) return '';
    const contentHtml = questions.map((question, index) => `
      <div class="mooc-question-detail">
        <div class="mooc-question-title">第${index + 1}题 · ${question.titleHtml || env.escape(question.title || '')}</div>
        ${(question.linesHtml?.length || question.lines?.length) ? `<div class="mooc-question-lines">${(question.linesHtml || question.lines || []).map((line) => `<div>${question.linesHtml ? line : env.escape(line)}</div>`).join('')}</div>` : ''}
      </div>`).join('');
    const courseId = `mooc-${course.id}`;
    const expandKey = `mooc-detail:${task.type}:${task.id}`;
    const expandable = env.renderExpandable
      ? env.renderExpandable(contentHtml, {
          hideWhenEmpty: true,
          expandText: '点击查看作业详情',
          collapseText: '点击收起作业详情',
          baseBg: 'rgba(255,255,255,.28)',
          flatDisplay: true,
          courseId,
          expandKey,
          expanded: !!env.isDetailExpanded?.(courseId, expandKey)
        })
      : contentHtml;
    return `<div class="mooc-task-detail" style="border-top-color:${colors[1]};">${expandable}</div>`;
  }

  function renderTeachers(course) {
    const teachers = Array.isArray(course.teachers) ? course.teachers : [];
    if (!teachers.length) return env.escape(course.schoolName || course.schoolShortName);
    return teachers.map((teacher) => {
      const href = String(teacher?.href || '').trim();
      let url = '';
      try { url = href ? new URL(href, 'https://www.icourse163.org/').href : ''; } catch { url = ''; }
      return url
        ? `<a class="mooc-teacher-link" href="${env.escape(url)}" target="_blank" rel="noopener noreferrer">${env.escape(teacher.name)}</a>`
        : env.escape(teacher.name);
    }).join(' / ');
  }

  function clearCards() {
    env?.courseList?.querySelectorAll('.mooc-standalone-card').forEach((node) => node.remove());
    env?.updateEmpty?.();
  }

  function renderTask(course, task) {
    const colors = task.done ? ['#e8f5e9', '#4caf50', '#2e7d32']
      : (task.overdue ? ['#ffebee', '#ef4444', '#b91c1c'] : ['#fff3e0', '#ff9800', '#e65100']);
    const score = task.userScore !== null
      ? `<span class="mooc-score">[${env.escape(String(task.userScore))}${task.totalScore !== null ? `/${env.escape(String(task.totalScore))}` : ''}]</span>`
      : '';
    const countdown = !task.done && !task.overdue && task.deadline
      ? `<span class="deadline-countdown" data-deadline="${env.escape(String(task.deadline))}" style="margin-left:4px; font-weight:normal; color:#e65100"></span>`
      : '';
    return `<div class="hw-card-item mooc-task" data-homework-done="${task.done ? '1' : '0'}" style="background:${colors[0]};border-color:${colors[1]};">
      <div class="mooc-task-head"><div class="mooc-task-main">
        <div class="mooc-task-title" style="color:${colors[2]};"><span class="mooc-task-kind">${typeText(task.type)}</span>${env.escape(task.title)}</div>
        <div class="mooc-task-meta">截止: <span class="mooc-deadline">${env.escape(formatTime(task.deadline))}</span>${task.done ? ' <span class="homework-status-done">(已提交)</span>' : (task.overdue ? ' <span class="homework-status-overdue">(已逾期)</span>' : '')}${countdown}${task.chapterName ? ` · ${env.escape(task.chapterName)}` : ''}</div>
      </div><div class="mooc-task-actions">${score}
        <div class="mooc-task-button-row">
          <a class="btn mooc-go-btn" style="background:${colors[2]};" href="${env.escape(taskUrl(course, task))}" target="_blank" rel="noopener noreferrer">前往中国大学MOOC${actionText(task.type)}</a>
          <button class="btn mooc-gins-btn" style="background:${colors[2]};" data-mooc-action="task" data-course-id="${env.escape(course.id)}" data-task-id="${env.escape(task.id)}">通过GinsMooc完成</button>
        </div>
      </div></div>
      ${renderTaskDetail(course, task, colors)}
    </div>`;
  }

  function renderToggle(courseId, kind, expanded, count, collapsedText, expandedText) {
    const direction = expanded ? 'up' : 'down';
    const label = `${expanded ? expandedText : collapsedText} (${count})`;
    return `<div class="homework-toggle-row homework-toggle-row--${kind}">
      <button class="btn homework-toggle-btn ${expanded ? 'is-expanded' : ''} homework-toggle-btn--${direction}" data-mooc-action="toggle-${kind}" data-course-id="${env.escape(courseId)}" data-count="${env.escape(String(count))}" data-collapsed-text="${env.escape(collapsedText)}" data-expanded-text="${env.escape(expandedText)}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
        <span class="homework-toggle-label">${env.escape(label)}</span>
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
      </button>
    </div>`;
  }

  function render() {
    if (!env?.courseList) return;
    clearCards();
    const baseOrder = Number(env.courseList.dataset.orderBase || 100000) + 120000;
    courses.forEach((course, index) => {
      const pending = course.tasks.filter((task) => !task.done && !task.overdue);
      const overdue = course.tasks.filter((task) => task.overdue);
      const done = course.tasks.filter((task) => task.done);
      const card = document.createElement('div');
      card.className = 'file-item mooc-standalone-card';
      card.id = `course-mooc-${course.id}`;
      card.dataset.courseId = `mooc-${course.id}`;
      card.dataset.courseRankable = '1';
      card.dataset.order = String(baseOrder + index);
      card.dataset.rank = pending.length ? '0' : (overdue.length ? '2' : (done.length ? '4' : '7'));
      const expanded = expandedGroups.get(course.id) || { overdue: false, done: false };
      const pendingHtml = pending.map((task) => renderTask(course, task)).join('');
      const overdueHtml = overdue.map((task) => renderTask(course, task)).join('');
      const doneHtml = done.map((task) => renderTask(course, task)).join('');
      const taskSections = `${pendingHtml}
        ${overdue.length ? renderToggle(course.id, 'overdue', expanded.overdue, overdue.length, '查看逾期作业', '收起逾期作业') : ''}
        ${overdue.length ? `<div class="homework-group homework-group--overdue ${expanded.overdue ? '' : 'is-hidden'}" data-homework-group="overdue" aria-hidden="${expanded.overdue ? 'false' : 'true'}">${overdueHtml}</div>` : ''}
        ${done.length ? renderToggle(course.id, 'done', expanded.done, done.length, '查看已交作业', '收起已交作业') : ''}
        ${done.length ? `<div class="homework-group homework-group--done ${expanded.done ? '' : 'is-hidden'}" data-homework-group="done" aria-hidden="${expanded.done ? 'false' : 'true'}">${doneHtml}</div>` : ''}`;
      card.innerHTML = `<div class="mooc-course-head"><div class="mooc-course-identity">
          <div class="course-card-title"><strong><a href="${env.escape(course.url)}" target="_blank" rel="noopener noreferrer">${env.escape(course.name)}</a></strong></div>
          <div class="mooc-course-meta">${renderTeachers(course)}</div>
        </div><button class="btn mooc-complete-all-btn" data-mooc-action="course" data-course-id="${env.escape(course.id)}">通过GinsMooc一键扫描并完成全部</button></div>
        <div class="homework-area mooc-homework-area">${course.detailLoaded ? (taskSections.trim() || '<span class="mooc-empty">没有单元测试、单元作业或考试</span>') : '<span class="spinner mooc-inline-spinner"></span> 正在读取课程作业…'}</div>`;
      env.courseList.appendChild(card);
    });
    env.updateEmpty?.();
    env.sortCourseCards?.();
    env.scheduleCache?.();
    setTimeout(() => {
      env.applyExpandableAutoToggle?.(env.courseList);
      env.updateCountdowns?.();
    }, 0);
  }

  async function loadHomeworkDetail(task) {
    task.detailLoading = true;
    render();
    try {
      const paper = await requestPaperWithRetry('homework-paper', task.id, '作业详情为空（可能受到并发限制）');
      task.detail = { questions: buildPaperDetail(paper) };
      taskDetailCache.set(`${task.type}:${task.id}`, task.detail);
      return paper;
    } finally {
      task.detailLoading = false;
      render();
    }
  }

  async function loadObjectiveDetail(task) {
    task.detailLoading = true;
    render();
    try {
      const [answers, paper] = await Promise.all([
        request('gins-answer', { tid: task.id }).catch(() => ({ data: { questionList: [] } })),
        requestPaperWithRetry('quiz-paper', task.id, '试卷数据为空（可能受到并发限制）')
      ]);
      const correctIds = new Set();
      for (const question of (answers?.data?.questionList || [])) {
        for (const option of (question.optionList || [])) if (option.answer) correctIds.add(option.id);
      }
      task.detail = { questions: buildPaperDetail(paper, correctIds) };
      taskDetailCache.set(`${task.type}:${task.id}`, task.detail);
      return { paper, correctIds };
    } finally {
      task.detailLoading = false;
      render();
    }
  }

  async function hydrateHomeworkDetails(course) {
    const tasks = course.tasks.filter((task) => task.type === 'hw');
    let next = 0;
    const failures = [];
    const workers = Array.from({ length: Math.min(3, tasks.length) }, async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        try { await loadHomeworkDetail(task); } catch (error) { failures.push(error); }
      }
    });
    await Promise.all(workers);
    if (failures.length) throw failures[0];
  }

  async function load() {
    const serial = ++loadSerial;
    let helperLeaseId = '';
    env.setState('checking');
    clearCards();
    try {
      helperLeaseId = await acquireHelperTab();
      await checkLogin();
      const panels = await request('course-list');
      if (serial !== loadSerial) return;
      courses = (Array.isArray(panels) ? panels : []).map((panel) => normalizeCourse(panel, null));
      render();
      let next = 0;
      const workers = Array.from({ length: Math.min(4, courses.length) }, async () => {
        while (next < courses.length && serial === loadSerial) {
          const index = next++;
          const old = courses[index];
          try {
            const [detailResult, teacherResult] = await Promise.allSettled([
              request('course-detail', { tid: Number(old.tid) }),
              requestTeachersWithRetry(old.url)
            ]);
            if (detailResult.status === 'rejected') throw detailResult.reason;
            const response = detailResult.value;
            const term = response?.result?.mocTermDto || response?.mocTermDto;
            courses[index] = normalizeCourse({
              id: old.id, name: old.name, termPanel: { id: old.tid },
              schoolPanel: { name: old.schoolName, shortName: old.schoolShortName },
              teachers: teacherResult.status === 'fulfilled' ? teacherResult.value : []
            }, term);
            render();
            await hydrateHomeworkDetails(courses[index]);
          } catch (error) {
            if (error?.code === 'not-logged-in') throw error;
            courses[index].detailLoaded = true;
          }
          if (serial === loadSerial) render();
        }
      });
      await Promise.all(workers);
      if (serial !== loadSerial) return;
      env.setLoaded(true);
      env.setState('online');
      render();
    } catch (error) {
      if (serial !== loadSerial) return;
      courses = [];
      clearCards();
      env.setLoaded(false);
      if (error?.code === 'not-logged-in') {
        env.loginRequired?.();
        env.setState('offline');
      } else {
        env.setLoaded(false);
        env.setState('checking');
        env.toast(`中国大学MOOC加载失败：${error?.message || error}`, 'error');
        if (isPlatformEnabled('mooc')) {
          setTimeout(() => {
            if (isPlatformEnabled('mooc') && serial === loadSerial) void load();
          }, 1200);
        }
      }
    } finally {
      await releaseHelperTab(helperLeaseId);
    }
  }

  function ensureModal() {
    let mask = document.getElementById('mooc-progress-modal');
    if (mask) return mask;
    mask = document.createElement('div');
    mask.id = 'mooc-progress-modal';
    mask.className = 'version-modal-mask mooc-progress-mask';
    mask.innerHTML = `<div class="version-modal-card mooc-progress-card">
      <div class="version-modal-header"><div class="mooc-progress-title"><a href="https://github.com/ginnnnnncc/GinsMooc" target="_blank" rel="noopener noreferrer">GinsMooc</a></div><button class="btn version-close-btn" data-mooc-close title="关闭" aria-label="关闭">×</button></div>
      <div class="mooc-progress-summary">正在准备…</div>
      <div class="progress-bar-container"><div class="progress-bar mooc-progress-bar"></div></div>
      <div class="mooc-progress-log"></div></div>`;
    document.body.appendChild(mask);
    mask.addEventListener('click', (event) => {
      if (!operationRunning && (event.target === mask || event.target.closest('[data-mooc-close]'))) mask.classList.remove('show');
    });
    return mask;
  }

  function progress(mask, completed, total, text, type = '') {
    mask.querySelector('.mooc-progress-summary').textContent = text;
    mask.querySelector('.mooc-progress-bar').style.width = `${total ? Math.round(completed * 100 / total) : 0}%`;
    const line = document.createElement('div');
    line.className = `mooc-progress-line ${type}`;
    line.textContent = text;
    const log = mask.querySelector('.mooc-progress-log');
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  async function completeTask(task) {
    const completed = await request('complete-task', { taskType: task.type, tid: task.id });
    const correctIds = new Set(Array.isArray(completed?.correctIds) ? completed.correctIds : []);
    task.detail = { questions: buildPaperDetail(completed?.paper || {}, correctIds) };
    taskDetailCache.set(`${task.type}:${task.id}`, task.detail);
    render();
    return completed?.response;
  }

  function isTaskSubmittable(task) {
    if (task.overdue) return false;
    if (task.type === 'hw') return true;
    if (task.userScore === null || task.totalScore === null) return true;
    return Number(task.userScore) < Number(task.totalScore);
  }

  async function runTasks(tasks, inspectUnavailable = false) {
    if (operationRunning) return;
    operationRunning = true;
    let helperLeaseId = '';
    const mask = ensureModal();
    const close = mask.querySelector('[data-mooc-close]');
    mask.querySelector('.mooc-progress-log').innerHTML = '';
    mask.querySelector('.mooc-progress-bar').style.width = '0%';
    mask.classList.add('show');
    close.disabled = true;
    const candidates = inspectUnavailable ? tasks : tasks.filter(isTaskSubmittable);
    let succeeded = 0;
    let inspected = 0;
    try {
      helperLeaseId = await acquireHelperTab();
      if (!candidates.length) throw new Error('没有待完成的任务（均已完成或已截止）');
      for (let i = 0; i < candidates.length; i++) {
        const task = candidates[i];
        progress(mask, i, candidates.length, `正在处理：${task.title}`);
        try {
          if (!isTaskSubmittable(task)) {
            if (task.type !== 'hw') await loadObjectiveDetail(task);
            inspected++;
            progress(mask, i + 1, candidates.length, `已加载详情：${task.title}（当前不可提交）`, 'success');
            continue;
          }
          await completeTask(task);
          succeeded++;
          progress(mask, i + 1, candidates.length, `已完成：${task.title}`, 'success');
        } catch (error) {
          progress(mask, i + 1, candidates.length, `失败：${task.title}（${error?.message || error}）`, 'error');
        }
      }
      const handled = succeeded + inspected;
      const summary = inspected
        ? `处理完成：提交 ${succeeded} 项，查看详情 ${inspected} 项`
        : `处理完成：成功 ${succeeded}/${candidates.length}`;
      progress(mask, candidates.length, candidates.length, summary, handled === candidates.length ? 'success' : 'error');
    } catch (error) {
      progress(mask, 0, 1, error?.message || String(error), 'error');
    } finally {
      operationRunning = false;
      close.disabled = false;
      if (succeeded > 0) {
        await load().catch(() => {});
      }
      await releaseHelperTab(helperLeaseId);
    }
  }

  function handleClick(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-mooc-action]') : null;
    if (!(button instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const course = courses.find((item) => item.id === String(button.dataset.courseId || ''));
    if (!course) return;
    if (button.dataset.moocAction === 'toggle-overdue' || button.dataset.moocAction === 'toggle-done') {
      if (button.dataset.animating === '1') return;
      const kind = button.dataset.moocAction === 'toggle-overdue' ? 'overdue' : 'done';
      const state = expandedGroups.get(course.id) || { overdue: false, done: false };
      const expanded = !state[kind];
      expandedGroups.set(course.id, { ...state, [kind]: expanded });

      const card = button.closest('.mooc-standalone-card');
      const group = card?.querySelector(`.homework-group[data-homework-group="${kind}"]`);
      if (!(group instanceof HTMLElement) || typeof env.animateHomeworkGroupVisibility !== 'function') {
        render();
        return;
      }

      const count = String(button.dataset.count || '').trim();
      const text = expanded ? button.dataset.expandedText : button.dataset.collapsedText;
      const label = button.querySelector('.homework-toggle-label');
      if (label) label.textContent = `${text || ''}${count ? ` (${count})` : ''}`;
      button.classList.toggle('is-expanded', expanded);
      button.classList.remove('homework-toggle-btn--up', 'homework-toggle-btn--down');
      button.classList.add(expanded ? 'homework-toggle-btn--up' : 'homework-toggle-btn--down');
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.dataset.animating = '1';
      group.dataset.expanded = expanded ? '1' : '0';
      group.setAttribute('aria-hidden', expanded ? 'false' : 'true');
      env.animateHomeworkGroupVisibility(group, expanded);
      setTimeout(() => {
        delete button.dataset.animating;
        if (expanded) {
          env.applyExpandableAutoToggle?.(card);
          env.updateCountdowns?.();
        }
      }, 240);
      return;
    }
    if (button.dataset.moocAction === 'course') runTasks(course.tasks);
    else {
      const task = course.tasks.find((item) => item.id === String(button.dataset.taskId || ''));
      if (task) runTasks([task], true);
    }
  }

  window.BjtuMoocPlatform = {
    init(options) {
      env = options;
      env.courseList?.addEventListener('click', handleClick);
    },
    load,
    clear() {
      loadSerial++;
      courses = [];
      clearCards();
      chrome.runtime.sendMessage({ type: 'MOOC_CANCEL_PENDING' }).catch(() => {});
    },
    render,
    getCourses: () => courses,
    restore(value) {
      courses = Array.isArray(value) ? value : [];
      courses.forEach((course) => (course.tasks || []).forEach((task) => {
        if (task?.detail && task?.id) taskDetailCache.set(`${task.type}:${task.id}`, task.detail);
      }));
    }
  };
})();


// Login assistance UI used by app.html.
function stopMoocLoginAssistWatcher() {
  if (moocLoginAssistPollTimer) {
    clearInterval(moocLoginAssistPollTimer);
    moocLoginAssistPollTimer = null;
  }
  moocLoginAssistChecking = false;
}

function closeMoocLoginAssistPopup(cancelPending = false) {
  if (moocLoginAssistPopupWindowId) {
    chrome.windows.remove(Number(moocLoginAssistPopupWindowId)).catch(() => {});
  }
  moocLoginAssistPopupWindowId = null;
  moocLoginAssistPopupTabId = null;
  stopMoocLoginAssistWatcher();
  if (cancelPending) window.platformInteractiveLoginPending.mooc = false;
}

async function checkMoocLoginAssistStatus() {
  if (moocLoginAssistChecking || !window.platformInteractiveLoginPending?.mooc) return false;
  moocLoginAssistChecking = true;
  try {
    if (moocLoginAssistPopupTabId) {
      const tab = await chrome.tabs.get(Number(moocLoginAssistPopupTabId)).catch(() => null);
      if (!tab) {
        moocLoginAssistPopupWindowId = null;
        moocLoginAssistPopupTabId = null;
        window.platformInteractiveLoginPending.mooc = false;
        stopMoocLoginAssistWatcher();
        return false;
      }
      if (!String(tab?.url || '').startsWith('https://www.icourse163.org/')) return false;
    }
    const response = await chrome.runtime.sendMessage({
      type: 'MOOC_LOGIN_STATUS',
      tabId: moocLoginAssistPopupTabId || null
    });
    if (!response?.ok || !response.loggedIn) return false;
    stopMoocLoginAssistWatcher();
    completeExternalLoginAssist('mooc', true);
    return true;
  } catch {
    return false;
  } finally {
    moocLoginAssistChecking = false;
  }
}

function startMoocLoginAssistWatcher() {
  stopMoocLoginAssistWatcher();
  moocLoginAssistPollTimer = setInterval(() => void checkMoocLoginAssistStatus(), PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS);
  void checkMoocLoginAssistStatus();
}

function openMoocLoginAssistPopup(force = false) {
  if (!force && !isPlatformEnabled('mooc')) return;
  window.platformInteractiveLoginPending.mooc = true;
  if (moocLoginAssistPopupWindowId && moocLoginAssistPopupTabId) {
    chrome.windows.update(Number(moocLoginAssistPopupWindowId), { focused: true }).catch(() => {});
    startMoocLoginAssistWatcher();
    return;
  }
  const openPopup = async () => {
    const popupWidth = 420;
    const popupHeight = 600;
    let left;
    let top;
    try {
      const currentWin = await chrome.windows.getCurrent();
      if ([currentWin?.left, currentWin?.top, currentWin?.width, currentWin?.height].every((value) => Number.isFinite(Number(value)))) {
        left = Math.max(0, Number(currentWin.left) + Math.round((Number(currentWin.width) - popupWidth) / 2));
        top = Math.max(0, Number(currentWin.top) + Math.round((Number(currentWin.height) - popupHeight) / 2));
      }
    } catch {
      left = undefined;
      top = undefined;
    }
    const created = await chrome.windows.create({
      url: MOOC_LOGIN_ASSIST_URL,
      type: 'popup',
      focused: true,
      width: popupWidth,
      height: popupHeight,
      left,
      top
    });
    moocLoginAssistPopupWindowId = Number(created?.id || 0) || null;
    const tab = Array.isArray(created?.tabs) && created.tabs.length ? created.tabs[0] : null;
    moocLoginAssistPopupTabId = Number(tab?.id || 0) || null;
    startMoocLoginAssistWatcher();
  };
  openPopup().catch(() => {
    window.platformInteractiveLoginPending.mooc = false;
    showToast('打开中国大学MOOC登录弹窗失败，请检查浏览器弹窗权限', 'error', 2200);
  });
}
