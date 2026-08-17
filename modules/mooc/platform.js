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
  let currentOperationCancel = null;
  let originTabPromise = null;
  let activeRequestTabId = null;
  let operationGeneration = 0;
  const helperTabIds = new Set();
  const helperCloseTimers = new Map();
  const helperLeases = new Set();
  const expandedGroups = new Map();
  const taskDetailCache = new Map();

  const request = async (action, payload = {}) => {
    const tab = await ensureOriginTab();
    const response = await chrome.runtime.sendMessage({ type: 'MOOC_REQUEST', action, payload, tabId: tab.id });
    if (!response?.ok) {
      const error = new Error(response?.message || '中国大学MOOC请求失败');
      error.code = response?.code || '';
      throw error;
    }
    scheduleHelperTabClose(tab.id);
    return response.data;
  };

  const checkLogin = async () => {
    const tab = await ensureOriginTab();
    const response = await chrome.runtime.sendMessage({ type: 'MOOC_LOGIN_STATUS', tabId: tab.id });
    if (!response?.ok || !response.loggedIn) {
      if (helperTabIds.has(tab.id)) closeHelperTab(tab.id);
      const error = new Error('未登录中国大学MOOC');
      error.code = 'not-logged-in';
      throw error;
    }
    scheduleHelperTabClose(tab.id);
  };

  function scheduleHelperTabClose(tabId, delayMs = 120000) {
    if (!helperTabIds.has(tabId)) return;
    if (helperLeases.size > 0) return;
    const oldTimer = helperCloseTimers.get(tabId);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
      helperCloseTimers.delete(tabId);
      helperTabIds.delete(tabId);
      if (Number(activeRequestTabId) === Number(tabId)) activeRequestTabId = null;
      chrome.tabs.remove(tabId).catch(() => {});
    }, delayMs);
    helperCloseTimers.set(tabId, timer);
  }

  function closeHelperTab(tabId) {
    if (!helperTabIds.has(tabId)) return;
    const timer = helperCloseTimers.get(tabId);
    if (timer) clearTimeout(timer);
    helperCloseTimers.delete(tabId);
    helperTabIds.delete(tabId);
    if (Number(activeRequestTabId) === Number(tabId)) activeRequestTabId = null;
    chrome.tabs.remove(tabId).catch(() => {});
  }

  async function waitForTabComplete(tabId, timeoutMs = 15000) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (current?.status === 'complete') return current;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        reject(Object.assign(new Error('中国大学MOOC页面加载超时'), { code: 'tab-timeout' }));
      }, timeoutMs);
      const onUpdated = (updatedId, changeInfo, tab) => {
        if (updatedId !== tabId || changeInfo.status !== 'complete') return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        resolve(tab);
      };
      const onRemoved = (removedId) => {
        if (removedId !== tabId) return;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        reject(Object.assign(new Error('中国大学MOOC后台页面已关闭'), { code: 'tab-closed' }));
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  }

  async function ensureOriginTabOnce() {
    if (activeRequestTabId) {
      const activeTab = await chrome.tabs.get(Number(activeRequestTabId)).catch(() => null);
      if (activeTab?.id && String(activeTab.url || '').startsWith('https://www.icourse163.org/')) {
        return activeTab.status === 'complete' ? activeTab : waitForTabComplete(activeTab.id);
      }
      activeRequestTabId = null;
    }
    const existingTabs = await chrome.tabs.query({ url: ['https://www.icourse163.org/*'] }).catch(() => []);
    const reusableTab = (existingTabs || []).find((tab) => tab?.id && tab.status === 'complete');
    if (reusableTab?.id) {
      activeRequestTabId = reusableTab.id;
      return reusableTab;
    }
    if (!originTabPromise) {
      originTabPromise = chrome.tabs.create({
        url: 'https://www.icourse163.org/',
        active: false
      }).then((tab) => {
        if (!tab?.id) throw new Error('无法创建中国大学MOOC请求页面');
        helperTabIds.add(tab.id);
        activeRequestTabId = tab.id;
        return waitForTabComplete(tab.id);
      }).finally(() => {
        originTabPromise = null;
      });
    }
    return originTabPromise;
  }

  async function ensureOriginTab() {
    const generation = operationGeneration;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (generation !== operationGeneration) throw Object.assign(new Error('中国大学MOOC加载已取消'), { code: 'cancelled' });
      try {
        const tab = await ensureOriginTabOnce();
        if (generation !== operationGeneration) {
          closeHelperTab(tab.id);
          throw Object.assign(new Error('中国大学MOOC加载已取消'), { code: 'cancelled' });
        }
        return tab;
      } catch (error) {
        lastError = error;
        activeRequestTabId = null;
        originTabPromise = null;
        if (!['tab-closed', 'tab-timeout'].includes(String(error?.code || ''))) throw error;
        if (attempt < 2) await sleep(350 * (attempt + 1));
      }
    }
    throw lastError || new Error('无法打开中国大学MOOC后台页面');
  }

  async function acquireHelperTab() {
    const leaseId = crypto.randomUUID();
    helperLeases.add(leaseId);
    try {
      const tab = await ensureOriginTab();
      const timer = helperCloseTimers.get(tab.id);
      if (timer) clearTimeout(timer);
      helperCloseTimers.delete(tab.id);
      return leaseId;
    } catch (error) {
      helperLeases.delete(leaseId);
      if (helperLeases.size === 0) {
        [...helperTabIds].forEach((tabId) => closeHelperTab(tabId));
      }
      throw error;
    }
  }

  async function releaseHelperTab(leaseId) {
    if (!leaseId) return;
    helperLeases.delete(String(leaseId));
    if (helperLeases.size > 0) return;
    [...helperTabIds].forEach((tabId) => closeHelperTab(tabId));
  }

  const formatTime = (value) => {
    const d = new Date(Number(value || 0));
    if (!Number(value) || Number.isNaN(d.getTime())) return '无期限';
    const pad = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const typeText = (type) => type === 'hw' ? '单元作业' : (type === 'exam' ? '考试' : '单元测试');
  const actionKind = (type) => type === 'hw' ? 'submit' : (type === 'exam' ? 'exam' : 'quiz');
  const GINS_TASK_GAP_MS = 450;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isRetryableDetailError(error) {
    const message = String(error?.message || error || '');
    if (/未登录|拒绝|HTTP\s*(?:401|403)|missing.?csrf/i.test(message) || ['not-logged-in', 'missing-csrf'].includes(error?.code)) return false;
    return error?.code === 'rate-limit'
      || /并发|频繁|稍后|繁忙|busy|limit|too many|HTTP\s*429/i.test(message);
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
    return globalThis.BjtuHomeworkUi.sanitizeRichHtml(value);
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
      return `<div class="mooc-task-detail" style="border-top-color:${colors[1]};"><span class="spinner mooc-inline-spinner" style="${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span> ${globalThis.BjtuHomeworkUi.text.detailLoading}</div>`;
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
      ? env.renderExpandable(contentHtml, globalThis.BjtuHomeworkUi.detailOptions({
          hideWhenEmpty: true,
          baseBg: 'rgba(255,255,255,.28)',
          flatDisplay: true,
          courseId,
          expandKey,
          expanded: !!env.isDetailExpanded?.(courseId, expandKey)
        }))
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
    const palette = globalThis.BjtuHomeworkUi.homeworkPalette({ done: task.done, overdue: task.overdue });
    const colors = [palette.background, palette.border, palette.foreground];
    const score = globalThis.BjtuHomeworkUi.scoreBadgeHtml({ userScore: task.userScore, totalScore: task.totalScore, escape: env.escape });
    const goActionText = globalThis.BjtuHomeworkUi.actionLabel('mooc', actionKind(task.type), { lead: '前往' });
    return globalThis.BjtuHomeworkUi.renderHomeworkCard({
      done: task.done,
      className: 'mooc-task',
      background: palette.background,
      border: palette.border,
      headClass: 'mooc-task-head',
      headStyle: '',
      mainClass: 'mooc-task-main',
      actionsClass: 'mooc-task-actions',
      titleHtml: globalThis.BjtuHomeworkUi.titleHtml({ typeLabel: typeText(task.type), title: task.title, color: palette.foreground, href: taskUrl(course, task), escape: env.escape, className: 'mooc-task-title' }),
      metaHtml: `${globalThis.BjtuHomeworkUi.deadlineMetaHtml({ deadline: task.deadline, formatted: formatTime(task.deadline), done: task.done, overdue: task.overdue, escape: env.escape })}${task.chapterName ? `<div class="mooc-task-meta">${env.escape(task.chapterName)}</div>` : ''}`,
      actionsHtml: `${score}<div class="mooc-task-button-row">
          <a class="btn mooc-go-btn" style="background:${colors[2]};" href="${env.escape(taskUrl(course, task))}" target="_blank" rel="noopener noreferrer">${env.escape(goActionText)}</a>
          <button class="btn mooc-gins-btn" style="background:${colors[2]};" data-mooc-action="task" data-course-id="${env.escape(course.id)}" data-task-id="${env.escape(task.id)}">通过GinsMooc完成</button>
        </div>`,
      detailHtml: renderTaskDetail(course, task, colors)
    });
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
      const expanded = expandedGroups.get(course.id) || { overdue: false, done: false };
      const pendingHtml = pending.map((task) => renderTask(course, task)).join('');
      const overdueHtml = overdue.map((task) => renderTask(course, task)).join('');
      const doneHtml = done.map((task) => renderTask(course, task)).join('');
      const taskSections = `${pendingHtml}
        ${overdue.length ? renderToggle(course.id, 'overdue', expanded.overdue, overdue.length, '查看逾期作业', '收起逾期作业') : ''}
        ${overdue.length ? `<div class="homework-group homework-group--overdue ${expanded.overdue ? '' : 'is-hidden'}" data-homework-group="overdue" aria-hidden="${expanded.overdue ? 'false' : 'true'}">${overdueHtml}</div>` : ''}
        ${done.length ? renderToggle(course.id, 'done', expanded.done, done.length, '查看已交作业', '收起已交作业') : ''}
        ${done.length ? `<div class="homework-group homework-group--done ${expanded.done ? '' : 'is-hidden'}" data-homework-group="done" aria-hidden="${expanded.done ? 'false' : 'true'}">${doneHtml}</div>` : ''}`;
    const card = globalThis.BjtuCourseCardUi.createCourseCard({
        courseId: `mooc-${course.id}`,
        className: 'mooc-standalone-card',
        order: baseOrder + index,
        rank: pending.length ? 0 : (overdue.length ? 2 : (done.length ? 4 : 7)),
        titleHtml: `<a href="${env.escape(course.url)}" target="_blank" rel="noopener noreferrer">${env.escape(course.name)}</a>`,
        metaHtml: `<div class="mooc-course-meta">${renderTeachers(course)}</div>`,
        actionsHtml: `<button class="btn mooc-complete-all-btn" data-mooc-action="course" data-course-id="${env.escape(course.id)}">通过GinsMooc一键扫描并完成全部</button>`,
        contentHtml: course.detailLoaded ? (taskSections.trim() || '<span class="mooc-empty">没有单元测试、单元作业或考试</span>') : `<span class="spinner mooc-inline-spinner" style="${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span> 正在读取课程作业…`,
        headerClass: 'mooc-course-head',
        identityClass: 'mooc-course-identity',
        homeworkClass: 'homework-area mooc-homework-area',
        includeResultArea: false,
        wrapActions: false,
        headerStyle: '',
        homeworkStyle: ''
      });
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
    env.setProgress?.(0, 0);
    clearCards();
    try {
      helperLeaseId = await acquireHelperTab();
      await checkLogin();
      const panels = await request('course-list');
      if (serial !== loadSerial) return;
      courses = (Array.isArray(panels) ? panels : []).map((panel) => normalizeCourse(panel, null));
      render();
      env.setLoaded(true);
      env.setState('online');
      let completedCourseLoads = 0;
      env.setProgress?.(0, courses.length);
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
          } finally {
            if (serial === loadSerial) {
              completedCourseLoads += 1;
              env.setProgress?.(completedCourseLoads, courses.length);
            }
          }
          if (serial === loadSerial) render();
        }
      });
      await Promise.all(workers);
      if (serial !== loadSerial) return;
      env.setLoaded(true);
      env.setState('online');
      env.setProgress?.(courses.length, courses.length);
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
      const closeButton = event.target instanceof Element ? event.target.closest('[data-mooc-close]') : null;
      if (operationRunning && closeButton) {
        event.preventDefault();
        currentOperationCancel?.();
        mask.classList.remove('show');
        return;
      }
      if (!operationRunning && (event.target === mask || closeButton)) mask.classList.remove('show');
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
    const operationToken = { cancelled: false, cancelLogged: false };
    const throwIfCancelled = () => {
      if (operationToken.cancelled) throw Object.assign(new Error('操作已取消'), { code: 'cancelled' });
    };
    const mask = ensureModal();
    const close = mask.querySelector('[data-mooc-close]');
    mask.querySelector('.mooc-progress-log').innerHTML = '';
    mask.querySelector('.mooc-progress-bar').style.width = '0%';
    mask.querySelector('.mooc-progress-summary').textContent = '正在准备…';
    mask.classList.add('show');
    close.disabled = false;
    const candidates = inspectUnavailable ? tasks : tasks.filter(isTaskSubmittable);
    let succeeded = 0;
    let inspected = 0;
    currentOperationCancel = () => {
      if (operationToken.cancelled) return;
      operationToken.cancelled = true;
      operationGeneration++;
      helperLeases.clear();
      [...helperTabIds].forEach((tabId) => closeHelperTab(tabId));
      activeRequestTabId = null;
      originTabPromise = null;
      if (!operationToken.cancelLogged) {
        operationToken.cancelLogged = true;
        progress(mask, 0, 1, '正在取消操作…', 'error');
      }
    };
    try {
      helperLeaseId = await acquireHelperTab();
      throwIfCancelled();
      if (!candidates.length) throw new Error('没有待完成的任务（均已完成或已截止）');
      for (let i = 0; i < candidates.length; i++) {
        throwIfCancelled();
        const task = candidates[i];
        progress(mask, i, candidates.length, `正在处理：${task.title}`);
        try {
          if (!isTaskSubmittable(task)) {
            if (task.type !== 'hw') await loadObjectiveDetail(task);
            throwIfCancelled();
            inspected++;
            progress(mask, i + 1, candidates.length, `已加载详情：${task.title}（当前不可提交）`, 'success');
            continue;
          }
          await completeTask(task);
          throwIfCancelled();
          succeeded++;
          progress(mask, i + 1, candidates.length, `已完成：${task.title}`, 'success');
          if (i < candidates.length - 1) {
            await sleep(GINS_TASK_GAP_MS);
            throwIfCancelled();
          }
        } catch (error) {
          if (error?.code === 'cancelled') throw error;
          if (error?.code === 'gins-system-error') throw error;
          progress(mask, i + 1, candidates.length, `失败：${task.title}（${error?.message || error}）`, 'error');
        }
      }
      const handled = succeeded + inspected;
      const summary = inspected
        ? `处理完成：提交 ${succeeded} 项，查看详情 ${inspected} 项`
        : `处理完成：成功 ${succeeded}/${candidates.length}`;
      progress(mask, candidates.length, candidates.length, summary, handled === candidates.length ? 'success' : 'error');
    } catch (error) {
      if (error?.code !== 'cancelled') progress(mask, 0, 1, error?.message || String(error), 'error');
    } finally {
      operationRunning = false;
      if (currentOperationCancel && operationToken.cancelled) currentOperationCancel = null;
      else if (currentOperationCancel) currentOperationCancel = null;
      close.disabled = false;
      if (!operationToken.cancelled && succeeded > 0) {
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

  chrome.tabs?.onRemoved?.addListener?.((tabId) => {
    const timer = helperCloseTimers.get(tabId);
    if (timer) clearTimeout(timer);
    helperCloseTimers.delete(tabId);
    helperTabIds.delete(tabId);
    if (Number(activeRequestTabId) === Number(tabId)) activeRequestTabId = null;
  });

  window.BjtuMoocPlatform = {
    init(options) {
      env = options;
      env.courseList?.addEventListener('click', handleClick);
    },
    load,
    clear() {
      loadSerial++;
      operationGeneration++;
      courses = [];
      clearCards();
      env.setProgress?.(0, 0);
      helperLeases.clear();
      [...helperTabIds].forEach((tabId) => closeHelperTab(tabId));
      activeRequestTabId = null;
      originTabPromise = null;
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

/* ================= qwen 页面桥（service worker 经 app 页面调用） ================= */

async function moocPageLogin(args = {}) {
  const platform = 'mooc';
  const enabled = typeof isPlatformEnabled === 'function' ? isPlatformEnabled(platform) : true;
  if (!enabled && typeof togglePlatformSelection === 'function') {
    try { togglePlatformSelection(platform, { interactive: true }); } catch {}
  }
  if (typeof triggerExternalPlatformLoad === 'function') {
    try { triggerExternalPlatformLoad(platform, true); } catch {}
  }
  if (typeof openMoocLoginAssistPopup === 'function') {
    try { openMoocLoginAssistPopup(true); } catch {}
  }
  return await waitForPlatformLoginResult(platform, Number(args?.timeoutMs) || 120000);
}

globalThis.BjtuMoocPageApi = Object.freeze({
  login: (args) => moocPageLogin(args)
});

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'PAGE_API' || message?.payload?.module !== 'mooc') return false;
    const api = globalThis.BjtuMoocPageApi;
    const fn = api && typeof api[String(message.payload?.fn || '')] === 'function' ? api[String(message.payload.fn)] : null;
    if (!fn) {
      sendResponse({ ok: false, error: 'MOOC 页面接口不存在' });
      return true;
    }
    Promise.resolve(fn(message.payload?.args || {})).then(
      (value) => sendResponse({ ok: true, value }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error), code: String(error?.code || '') })
    );
    return true;
  });
}
