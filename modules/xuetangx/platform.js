(function initBjtuXuetangxPlatform(global) {
  'use strict';

  const BASE = 'https://www.xuetangx.com';
  const REQUEST_PAGE_URL = `${BASE}/`;
  const COURSE_LIST_URL = `${BASE}/api/v1/lms/user/user-courses`;
  const COURSE_STATUS_LABELS = Object.freeze({
    1: '正在上课',
    2: '即将开课',
    3: '已结课',
    4: '已退课'
  });
  const ACTIVITY_TYPES = Object.freeze({
    6: { label: '视频', path: 'video', action: 'learn' },
    10: { label: '讨论', path: 'discussion', action: 'view' },
    11: { label: '作业', path: 'exercise', action: 'submit' },
    12: { label: '考试', path: 'exam', action: 'exam' }
  });
  const DEFAULT_VISIBLE_STATUSES = Object.freeze([1]);
  const THEME_COLOR = '#1769fe';
  const helperTabIds = new Set();
  const expandedGroups = new Map();
  let env = null;
  let courses = [];
  let activeRequestTabId = null;
  let originTabPromise = null;
  let loadSerial = 0;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escape = (value) => env?.escape?.(String(value ?? '')) ?? String(value ?? '');

  function formatTime(value) {
    const timestamp = Number(value || 0);
    const date = new Date(timestamp);
    if (!timestamp || Number.isNaN(date.getTime())) return '无期限';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatProgress(value) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const percent = ratio * 100;
    if (percent >= 99.95) return '100%';
    if (percent >= 10) return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
    return `${percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
  }

  function normalizeSchedule(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
  }

  function normalizeVisibleStatuses(value) {
    const source = Array.isArray(value) ? value : DEFAULT_VISIBLE_STATUSES;
    const statuses = [...new Set(source.map(Number).filter((item) => COURSE_STATUS_LABELS[item]))];
    return statuses.length ? statuses : [...DEFAULT_VISIBLE_STATUSES];
  }

  async function getVisibleStatuses() {
    const stored = await chrome.storage.local.get(['xuetangxCourseStatuses']).catch(() => ({}));
    return normalizeVisibleStatuses(stored.xuetangxCourseStatuses);
  }

  async function waitForTabComplete(tabId, timeoutMs = 20000) {
    const existing = await chrome.tabs.get(tabId).catch(() => null);
    if (existing?.status === 'complete') return existing;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Object.assign(new Error('学堂在线页面加载超时'), { code: 'tab-timeout' }));
      }, timeoutMs);
      const onUpdated = (updatedId, changeInfo, tab) => {
        if (updatedId !== tabId || changeInfo.status !== 'complete') return;
        cleanup();
        resolve(tab);
      };
      const onRemoved = (removedId) => {
        if (removedId !== tabId) return;
        cleanup();
        reject(Object.assign(new Error('学堂在线后台页面已关闭'), { code: 'tab-closed' }));
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  }

  async function ensureOriginTabOnce(serial) {
    if (serial !== loadSerial) throw Object.assign(new Error('学堂在线加载已取消'), { code: 'cancelled' });
    if (activeRequestTabId) {
      const tab = await chrome.tabs.get(Number(activeRequestTabId)).catch(() => null);
      if (tab?.id && String(tab.url || '').startsWith(`${BASE}/`)) {
        return tab.status === 'complete' ? tab : waitForTabComplete(tab.id);
      }
      activeRequestTabId = null;
    }
    const reusableTabs = await chrome.tabs.query({ url: [`${BASE}/*`] }).catch(() => []);
    const reusable = reusableTabs.find((tab) => tab?.id && tab.status === 'complete');
    if (reusable?.id) {
      activeRequestTabId = reusable.id;
      return reusable;
    }
    if (!originTabPromise) {
      originTabPromise = chrome.tabs.create({ url: REQUEST_PAGE_URL, active: false }).then(async (tab) => {
        if (!tab?.id) throw new Error('无法创建学堂在线请求页面');
        helperTabIds.add(tab.id);
        activeRequestTabId = tab.id;
        return waitForTabComplete(tab.id);
      }).finally(() => {
        originTabPromise = null;
      });
    }
    return originTabPromise;
  }

  async function ensureOriginTab(serial) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (serial !== loadSerial) throw Object.assign(new Error('学堂在线加载已取消'), { code: 'cancelled' });
      try {
        return await ensureOriginTabOnce(serial);
      } catch (error) {
        lastError = error;
        activeRequestTabId = null;
        originTabPromise = null;
        if (!['tab-closed', 'tab-timeout'].includes(String(error?.code || '')) || attempt >= 2) throw error;
        await sleep(350 * (attempt + 1));
      }
    }
    throw lastError || new Error('无法打开学堂在线请求页面');
  }

  async function requestJson(url, serial, tabRetry = 0) {
    const tab = await ensureOriginTab(serial);
    let execution;
    try {
      execution = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [{ url: String(url) }],
        func: async ({ url: requestUrl }) => {
          const cookieMap = Object.fromEntries(document.cookie.split(';').map((part) => {
            const index = part.indexOf('=');
            if (index < 0) return [part.trim(), ''];
            return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
          }));
          const csrf = cookieMap.csrftoken || cookieMap.CSRF_TOKEN || cookieMap.x_csrftoken || '';
          const headers = {
            accept: 'application/json, text/plain, */*',
            'x-client': 'web',
            xtbz: 'xt'
          };
          if (csrf) headers['x-csrftoken'] = csrf;
          let lastResult = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const response = await fetch(requestUrl, {
                method: 'GET',
                headers,
                credentials: 'include',
                cache: 'no-store'
              });
              const text = await response.text();
              let data = null;
              try { data = JSON.parse(text); } catch {}
              lastResult = {
                ok: response.ok,
                status: response.status,
                responseUrl: response.url,
                data,
                text: data ? '' : text.slice(0, 500)
              };
              if (response.status !== 429 && response.status < 500) return lastResult;
            } catch (error) {
              lastResult = { ok: false, status: 0, error: String(error?.message || error) };
            }
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          }
          return lastResult;
        }
      });
    } catch (error) {
      if (!await chrome.tabs.get(tab.id).catch(() => null)) {
        activeRequestTabId = null;
        if (tabRetry < 2 && serial === loadSerial) {
          await sleep(350 * (tabRetry + 1));
          return requestJson(url, serial, tabRetry + 1);
        }
        throw Object.assign(new Error('学堂在线后台页面已关闭'), { code: 'tab-closed' });
      }
      throw error;
    }
    const result = execution?.[0]?.result;
    if (!result?.ok || !result?.data) {
      const loginLike = [401, 403].includes(Number(result?.status))
        || /login|登录|<!doctype|<html/i.test(String(result?.text || result?.responseUrl || ''));
      const error = new Error(loginLike
        ? '未登录学堂在线'
        : `学堂在线请求失败${result?.status ? `（HTTP ${result.status}）` : ''}：${result?.error || result?.text || '响应不是 JSON'}`);
      error.code = loginLike ? 'not-logged-in' : 'request-failed';
      throw error;
    }
    return result.data;
  }

  function closeCreatedHelperTabs() {
    for (const tabId of [...helperTabIds]) {
      helperTabIds.delete(tabId);
      if (Number(activeRequestTabId) === Number(tabId)) activeRequestTabId = null;
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  async function exposeLoginTab() {
    if (!activeRequestTabId || !helperTabIds.has(Number(activeRequestTabId))) return;
    await chrome.tabs.update(Number(activeRequestTabId), { active: true }).catch(() => {});
    const tab = await chrome.tabs.get(Number(activeRequestTabId)).catch(() => null);
    if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    helperTabIds.delete(Number(activeRequestTabId));
  }

  function collectEvaluationLeaves(scoreData) {
    const map = new Map();
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const id = value?.score_info?.leaf_id ?? value?.id;
      const tagId = Number(value?.evaluation_tag?.id ?? value?.etag_info?.etag_id ?? 0);
      if (id && (tagId || value.score_info || value.time_info)) map.set(String(id), value);
      Object.values(value).forEach(visit);
    };
    visit(scoreData?.score_detail || []);
    return map;
  }

  function flattenChapterLeaves(root) {
    const rows = [];
    const walk = (node, path = []) => {
      if (!node || typeof node !== 'object') return;
      const nextPath = node.name ? [...path, String(node.name)] : path;
      for (const leaf of (Array.isArray(node.leaf_list) ? node.leaf_list : [])) {
        if (!leaf?.id || leaf.is_show === false) continue;
        rows.push({ ...leaf, chapterPath: nextPath });
      }
      for (const child of (Array.isArray(node.children) ? node.children : [])) walk(child, nextPath);
      for (const section of (Array.isArray(node.section_list) ? node.section_list : [])) walk(section, nextPath);
    };
    walk(root, []);
    return rows;
  }

  function activityType(leaf, evaluationLeaf) {
    const tagId = Number(evaluationLeaf?.evaluation_tag?.id ?? evaluationLeaf?.etag_info?.etag_id ?? 0);
    if (ACTIVITY_TYPES[tagId]) return { id: tagId, ...ACTIVITY_TYPES[tagId] };
    const title = String(leaf?.name || '');
    if (/考试|考核/.test(title)) return { id: 12, ...ACTIVITY_TYPES[12] };
    if (/讨论/.test(title)) return { id: 10, ...ACTIVITY_TYPES[10] };
    if (/作业|测试|习题|练习/.test(title)) return { id: 11, ...ACTIVITY_TYPES[11] };
    if (Number(leaf?.leaf_type) === 0) return { id: 6, ...ACTIVITY_TYPES[6] };
    if (Number(leaf?.leaf_type) === 6) return { id: 11, ...ACTIVITY_TYPES[11] };
    const fallbackId = tagId || Number(leaf?.leaf_type) || -1;
    return { id: fallbackId, label: `活动${fallbackId > 0 ? ` ${fallbackId}` : ''}`, path: 'activity', action: 'view' };
  }

  function taskUrl(course, task) {
    return `${BASE}/learn/space/${encodeURIComponent(course.courseSign)}/${encodeURIComponent(course.sign)}/${encodeURIComponent(course.classroomId)}/${encodeURIComponent(task.path)}/${encodeURIComponent(task.id)}`;
  }

  function courseUrl(course) {
    return `${BASE}/learn/space/${encodeURIComponent(course.courseSign)}/${encodeURIComponent(course.sign)}/${encodeURIComponent(course.classroomId)}`;
  }

  function buildCourse(panel) {
    return {
      id: String(panel?.classroom_id || panel?.product_id || panel?.sku_id || ''),
      classroomId: String(panel?.classroom_id || ''),
      sign: String(panel?.sign || panel?.course_sign || ''),
      courseSign: String(panel?.course_sign || panel?.sign || ''),
      name: String(panel?.name || '学堂在线课程'),
      status: Number(panel?.status || 0),
      cover: String(panel?.cover || panel?.mobile_cover || ''),
      classStart: Number(panel?.class_start || 0),
      classEnd: Number(panel?.class_end || 0),
      teachers: [],
      tasks: [],
      totalSchedule: 0,
      score: null,
      detailLoaded: false
    };
  }

  function hydrateCourse(course, basicInfo, chapterResponse, scheduleResponse, evaluationResponse) {
    const teachers = basicInfo?.data?.teacher_list ?? basicInfo?.teacher_list ?? [];
    const chapterRoot = chapterResponse?.data?.course_chapter ?? chapterResponse?.course_chapter;
    const schedules = scheduleResponse?.data?.leaf_schedules ?? scheduleResponse?.leaf_schedules ?? {};
    const totalSchedule = scheduleResponse?.data?.total_schedule ?? scheduleResponse?.total_schedule ?? 0;
    const scoreData = evaluationResponse?.data ?? evaluationResponse ?? {};
    const evaluationLeaves = collectEvaluationLeaves(scoreData);
    const leaves = flattenChapterLeaves(chapterRoot);
    course.teachers = (Array.isArray(teachers) ? teachers : [])
      .map((teacher) => String(teacher?.name || '').trim()).filter(Boolean);
    course.totalSchedule = normalizeSchedule(totalSchedule);
    course.score = scoreData?.total_score_and_schedule || null;
    course.tasks = leaves.map((leaf) => {
      const evaluationLeaf = evaluationLeaves.get(String(leaf.id)) || {};
      const type = activityType(leaf, evaluationLeaf);
      const schedule = normalizeSchedule(schedules[String(leaf.id)] ?? evaluationLeaf?.schedule ?? 0);
      const timeInfo = evaluationLeaf?.time_info || {};
      const deadline = Number(timeInfo.score_deadline ?? leaf.score_deadline ?? timeInfo.end_time ?? leaf.end_time ?? 0) || 0;
      const scoreInfo = evaluationLeaf?.score_info || {};
      const done = evaluationLeaf?.quiz_commit === true
        || evaluationLeaf?.is_done === true
        || schedule >= 0.9995;
      return {
        id: String(leaf.id),
        title: String(leaf.name || type.label),
        typeId: type.id,
        typeLabel: type.label,
        path: type.path,
        action: type.action,
        chapterPath: Array.isArray(leaf.chapterPath) ? leaf.chapterPath : [],
        startTime: Number(timeInfo.start_time ?? leaf.start_time ?? 0) || 0,
        deadline,
        schedule,
        done,
        overdue: !done && deadline > 0 && deadline < Date.now(),
        userScore: Number.isFinite(Number(scoreInfo.user_score)) ? Number(scoreInfo.user_score) : null,
        totalScore: Number.isFinite(Number(scoreInfo.leaf_score)) ? Number(scoreInfo.leaf_score) : null,
        locked: timeInfo.is_locked === true || leaf.is_locked === true
      };
    });
    course.detailLoaded = true;
    return course;
  }

  function clearCards() {
    env?.courseList?.querySelectorAll('.xuetangx-standalone-card').forEach((node) => node.remove());
    env?.updateEmpty?.();
  }

  function renderTask(course, task) {
    const palette = global.BjtuHomeworkUi.homeworkPalette({ done: task.done, overdue: task.overdue });
    const statusHtml = global.BjtuHomeworkUi.statusHtml({ done: task.done, overdue: task.overdue });
    const countdown = !task.done && !task.overdue && task.deadline
      ? `<span class="deadline-countdown" data-deadline="${escape(task.deadline)}"></span>`
      : '';
    const scoreVisible = task.done || Number(task.userScore) > 0;
    const score = scoreVisible && task.userScore !== null
      ? `<span class="xuetangx-task-score">${escape(task.userScore)}${task.totalScore !== null ? `/${escape(task.totalScore)}` : ''} 分</span>`
      : (task.totalScore !== null ? `<span class="xuetangx-task-score">总分 ${escape(task.totalScore)}</span>` : '');
    const actionLabel = global.BjtuHomeworkUi.actionLabel('xuetangx', task.action, { lead: '去' });
    const chapter = task.chapterPath.filter(Boolean).slice(1).join(' / ');
    return global.BjtuHomeworkUi.renderHomeworkCard({
      done: task.done,
      className: 'xuetangx-task',
      background: palette.background,
      border: palette.border,
      headClass: 'xuetangx-task-head',
      mainClass: 'xuetangx-task-main',
      actionsClass: 'xuetangx-task-actions',
      titleHtml: `<div class="xuetangx-task-title" style="color:${palette.foreground};"><span class="xuetangx-task-kind">${escape(task.typeLabel)}</span>${escape(task.title)}</div>`,
      metaHtml: `<div class="xuetangx-task-meta"><span>截止：<strong>${escape(formatTime(task.deadline))}</strong></span>${statusHtml ? ` ${statusHtml}` : ''}${countdown}${chapter ? ` · ${escape(chapter)}` : ''}</div>
        <div class="xuetangx-task-progress"><span>进度 ${escape(formatProgress(task.schedule))}</span><span class="xuetangx-task-progress-track"><span style="width:${Math.round(task.schedule * 10000) / 100}%"></span></span></div>`,
      actionsHtml: `${score}${global.BjtuHomeworkUi.renderActionLink({
        href: taskUrl(course, task),
        label: actionLabel,
        color: palette.action,
        className: 'btn xuetangx-go-btn',
        escape
      })}`
    });
  }

  function renderToggle(courseId, kind, expanded, count) {
    const noun = kind === 'done' ? '已完成项目' : '逾期项目';
    const label = expanded ? `收起${noun}` : `查看${noun}`;
    return `<div class="homework-toggle-row homework-toggle-row--${kind}">
      <button class="btn homework-toggle-btn ${expanded ? 'is-expanded homework-toggle-btn--up' : 'homework-toggle-btn--down'}" data-xuetangx-action="toggle-${kind}" data-course-id="${escape(courseId)}" data-count="${escape(count)}" data-collapsed-text="查看${noun}" data-expanded-text="收起${noun}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
        <span class="homework-toggle-label">${escape(label)} (${escape(count)})</span>
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
      </button>
    </div>`;
  }

  function render() {
    if (!env?.courseList) return;
    clearCards();
    const baseOrder = Number(env.courseList.dataset.orderBase || 100000) + 140000;
    courses.forEach((course, index) => {
      const pending = course.tasks.filter((task) => !task.done && !task.overdue);
      const overdue = course.tasks.filter((task) => task.overdue);
      const done = course.tasks.filter((task) => task.done);
      const expanded = expandedGroups.get(course.id) || { overdue: false, done: false };
      const taskSections = `${pending.map((task) => renderTask(course, task)).join('')}
        ${overdue.length ? renderToggle(course.id, 'overdue', expanded.overdue, overdue.length) : ''}
        ${overdue.length ? `<div class="homework-group homework-group--overdue ${expanded.overdue ? '' : 'is-hidden'}" data-homework-group="overdue" aria-hidden="${expanded.overdue ? 'false' : 'true'}">${overdue.map((task) => renderTask(course, task)).join('')}</div>` : ''}
        ${done.length ? renderToggle(course.id, 'done', expanded.done, done.length) : ''}
        ${done.length ? `<div class="homework-group homework-group--done ${expanded.done ? '' : 'is-hidden'}" data-homework-group="done" aria-hidden="${expanded.done ? 'false' : 'true'}">${done.map((task) => renderTask(course, task)).join('')}</div>` : ''}`;
      const score = course.score;
      const scoreText = score
        ? ` · 成绩 ${escape(score.user_score ?? 0)}${score.title ? `（${escape(score.title)}）` : ''}`
        : '';
      const meta = `${course.teachers.length ? escape(course.teachers.join(' / ')) : '教师信息加载中'} · ${escape(COURSE_STATUS_LABELS[course.status] || '未知状态')} · 总进度 ${escape(formatProgress(course.totalSchedule))}${scoreText}`;
      const card = global.BjtuCourseCardUi.createCourseCard({
        courseId: `xuetangx-${course.id}`,
        className: 'xuetangx-standalone-card',
        order: baseOrder + index,
        rank: pending.length ? 0 : (overdue.length ? 2 : (done.length ? 4 : 7)),
        titleHtml: `<a href="${escape(courseUrl(course))}" target="_blank" rel="noopener noreferrer">${escape(course.name)}</a>`,
        metaHtml: `<div class="xuetangx-course-meta">${meta}</div>`,
        contentHtml: course.detailLoaded
          ? (course.loadError
            ? `<span class="xuetangx-empty">课程详情加载失败：${escape(course.loadError)}</span>`
            : (taskSections.trim() || '<span class="xuetangx-empty">暂无学习活动</span>'))
          : `<span class="spinner xuetangx-inline-spinner" style="${global.BjtuHomeworkUi.spinnerPhaseStyle()}"></span> 正在获取作业…`,
        headerClass: 'xuetangx-course-head',
        identityClass: 'xuetangx-course-identity',
        homeworkClass: 'homework-area xuetangx-homework-area',
        includeResultArea: false,
        wrapActions: false
      });
      env.courseList.appendChild(card);
    });
    env.updateEmpty?.();
    env.sortCourseCards?.();
    env.scheduleCache?.();
    setTimeout(() => env.updateCountdowns?.(), 0);
  }

  async function loadCourseDetails(course, serial) {
    const query = `cid=${encodeURIComponent(course.classroomId)}&sign=${encodeURIComponent(course.sign)}`;
    const [basic, chapter, schedule, evaluation] = await Promise.all([
      requestJson(`${BASE}/api/v1/lms/product/get_product_basic_info/?sign=${encodeURIComponent(course.sign)}`, serial),
      requestJson(`${BASE}/api/v1/lms/kg/kg_learn_chapter/?${query}`, serial),
      requestJson(`${BASE}/api/v1/lms/learn/course/schedule?${query}`, serial),
      requestJson(`${BASE}/api/v1/lms/learn/get_evaluation_detail/?${query}`, serial)
    ]);
    if (serial !== loadSerial) return;
    const failed = [basic, chapter, schedule, evaluation].find((response) => response?.success === false);
    if (failed) throw new Error(failed.msg || '学堂在线课程详情接口返回失败');
    hydrateCourse(course, basic, chapter, schedule, evaluation);
  }

  async function load() {
    const serial = ++loadSerial;
    env?.setState?.('checking');
    env?.setProgress?.(0, 0);
    clearCards();
    try {
      const visibleStatuses = await getVisibleStatuses();
      const response = await requestJson(COURSE_LIST_URL, serial);
      if (serial !== loadSerial) return;
      if (response?.success !== true || !response?.data || !Array.isArray(response.data.product_list)) {
        const error = new Error(response?.msg || '未登录学堂在线');
        error.code = 'not-logged-in';
        throw error;
      }
      courses = response.data.product_list
        .filter((panel) => visibleStatuses.includes(Number(panel?.status)))
        .map(buildCourse).filter((course) => course.id && course.classroomId && course.sign);
      env?.setLoaded?.(true);
      env?.setState?.('online');
      env?.setProgress?.(0, courses.length);
      render();

      let completed = 0;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, courses.length) }, async () => {
        while (cursor < courses.length && serial === loadSerial) {
          const index = cursor++;
          try {
            await loadCourseDetails(courses[index], serial);
          } catch (error) {
            if (error?.code === 'not-logged-in' || error?.code === 'cancelled') throw error;
            courses[index].detailLoaded = true;
            courses[index].loadError = String(error?.message || error);
          } finally {
            if (serial === loadSerial) {
              completed += 1;
              env?.setProgress?.(completed, courses.length);
              render();
            }
          }
        }
      });
      await Promise.all(workers);
      if (serial !== loadSerial) return;
      env?.setProgress?.(courses.length, courses.length);
      env?.setLoaded?.(true);
      env?.setState?.('online');
      render();
      closeCreatedHelperTabs();
    } catch (error) {
      if (serial !== loadSerial || error?.code === 'cancelled') return;
      courses = [];
      clearCards();
      env?.setLoaded?.(false);
      if (error?.code === 'not-logged-in') {
        await exposeLoginTab();
        env?.setState?.('offline');
      } else {
        env?.setState?.('checking');
        env?.toast?.(`学堂在线加载失败：${error?.message || error}`, 'error');
        setTimeout(() => {
          if (serial === loadSerial && global.isPlatformEnabled?.('xuetangx')) void load();
        }, 1200);
      }
    }
  }

  function handleClick(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-xuetangx-action]') : null;
    if (!(button instanceof HTMLElement)) return;
    const course = courses.find((item) => item.id === String(button.dataset.courseId || ''));
    if (!course || button.dataset.animating === '1') return;
    const kind = button.dataset.xuetangxAction === 'toggle-done' ? 'done' : 'overdue';
    const state = expandedGroups.get(course.id) || { overdue: false, done: false };
    const expanded = !state[kind];
    expandedGroups.set(course.id, { ...state, [kind]: expanded });
    const card = button.closest('.xuetangx-standalone-card');
    const group = card?.querySelector(`.homework-group[data-homework-group="${kind}"]`);
    if (!(group instanceof HTMLElement) || typeof env?.animateHomeworkGroupVisibility !== 'function') {
      render();
      return;
    }
    const count = String(button.dataset.count || '');
    const text = expanded ? button.dataset.expandedText : button.dataset.collapsedText;
    const label = button.querySelector('.homework-toggle-label');
    if (label) label.textContent = `${text} (${count})`;
    button.classList.toggle('is-expanded', expanded);
    button.classList.toggle('homework-toggle-btn--up', expanded);
    button.classList.toggle('homework-toggle-btn--down', !expanded);
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.dataset.animating = '1';
    group.dataset.expanded = expanded ? '1' : '0';
    group.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    env.animateHomeworkGroupVisibility(group, expanded);
    setTimeout(() => { delete button.dataset.animating; }, 240);
  }

  chrome.tabs?.onRemoved?.addListener?.((tabId) => {
    helperTabIds.delete(tabId);
    if (Number(activeRequestTabId) === Number(tabId)) activeRequestTabId = null;
  });

  global.BjtuXuetangxPlatform = {
    init(options) {
      env = options;
      env.courseList?.addEventListener('click', handleClick);
    },
    load,
    render,
    clear() {
      loadSerial += 1;
      courses = [];
      expandedGroups.clear();
      clearCards();
      env?.setProgress?.(0, 0);
      closeCreatedHelperTabs();
      activeRequestTabId = null;
      originTabPromise = null;
    },
    getCourses: () => courses,
    restore(value) {
      courses = Array.isArray(value) ? value : [];
    },
    themeColor: THEME_COLOR
  };
})(globalThis);
