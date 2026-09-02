const JLGJ_API_BASE = 'https://i-api.jielong.com';
const JLGJ_WEB_BASE = 'https://i.jielong.com/my-class';
const JLGJ_GROUP_LIST_API = `${JLGJ_API_BASE}/api/UserGroup/UserGroupPages?pageIndex=1&pageSize=20`;
const JLGJ_LOGIN_ASSIST_URL = 'https://i.jielong.com/login?redirectTo=https://i.jielong.com/my-class';
const JLGJ_LOGIN_SUCCESS_URL_PREFIX = 'https://i.jielong.com/my-class';
let jlgjLoginAssistRetryTimer = null;
let jlgjLoginAssistPollTimer = null;
let jlgjLoginAssistPopupWindowId = null;
let jlgjLoginAssistPopupTabId = null;

// Platform-specific functions extracted from app.js. Shared helpers remain global.

function scheduleJlgjLoginAssistRecheck(delayMs = 500) {
  if (jlgjLoginAssistRetryTimer) {
    clearTimeout(jlgjLoginAssistRetryTimer);
    jlgjLoginAssistRetryTimer = null;
  }
  jlgjLoginAssistRetryTimer = setTimeout(() => {
    jlgjLoginAssistRetryTimer = null;
    if (!window.platformInteractiveLoginPending?.jlgj && !isPlatformEnabled('jlgj')) return;
    completeExternalLoginAssist('jlgj', true);
  }, Math.max(120, Number(delayMs) || 500));
}

function stopJlgjLoginAssistWatcher() {
  if (jlgjLoginAssistPollTimer) {
    clearInterval(jlgjLoginAssistPollTimer);
    jlgjLoginAssistPollTimer = null;
  }
}

function isJlgjLoginSuccessUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  return u.startsWith(JLGJ_LOGIN_SUCCESS_URL_PREFIX);
}

async function checkJlgjLoginAssistPopupUrl() {
  if (!window.platformInteractiveLoginPending?.jlgj) return false;
  if (!jlgjLoginAssistPopupTabId) return false;
  try {
    const tab = await chrome.tabs.get(Number(jlgjLoginAssistPopupTabId));
    const currentUrl = String(tab?.url || '').trim();
    if (isJlgjLoginSuccessUrl(currentUrl)) {
      const auth = await getJlgjAuthHeaders();
      if (!auth.token) return false;
      closeJlgjLoginAssistPopup(false);
      stopJlgjLoginAssistWatcher();
      scheduleJlgjLoginAssistRecheck(180);
      return true;
    }
  } catch {
    jlgjLoginAssistPopupWindowId = null;
    jlgjLoginAssistPopupTabId = null;
    stopJlgjLoginAssistWatcher();
  }
  return false;
}

function startJlgjLoginAssistWatcher() {
  stopJlgjLoginAssistWatcher();
  jlgjLoginAssistPollTimer = setInterval(() => {
    void checkJlgjLoginAssistPopupUrl();
  }, PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS);
  void checkJlgjLoginAssistPopupUrl();
}

function closeJlgjLoginAssistPopup(cancelPending = false) {
  if (jlgjLoginAssistPopupWindowId) {
    chrome.windows.remove(Number(jlgjLoginAssistPopupWindowId)).catch(() => {});
  }
  jlgjLoginAssistPopupWindowId = null;
  jlgjLoginAssistPopupTabId = null;
  stopJlgjLoginAssistWatcher();
  if (cancelPending) {
    window.platformInteractiveLoginPending.jlgj = false;
  }
}

function openJlgjLoginAssistPopup(force = false) {
  if (!force && !isPlatformEnabled('jlgj')) return;
  window.platformInteractiveLoginPending.jlgj = true;
  if (jlgjLoginAssistPopupWindowId && jlgjLoginAssistPopupTabId) {
    chrome.windows.update(Number(jlgjLoginAssistPopupWindowId), { focused: true }).catch(() => {});
    startJlgjLoginAssistWatcher();
    return;
  }

  const openPopup = async () => {
    const screenW = Number(globalThis.screen?.availWidth || globalThis.screen?.width || 0);
    const screenH = Number(globalThis.screen?.availHeight || globalThis.screen?.height || 0);
    const popupWidth = Math.max(980, Math.min(1320, Math.round(screenW * 0.9) || 980));
    const popupHeight = Math.max(640, Math.min(860, Math.round(screenH * 0.82) || 760));
    let left;
    let top;
    try {
      const currentWin = await chrome.windows.getCurrent();
      if (Number.isFinite(Number(currentWin?.left)) && Number.isFinite(Number(currentWin?.top)) && Number.isFinite(Number(currentWin?.width)) && Number.isFinite(Number(currentWin?.height))) {
        left = Math.max(0, Number(currentWin.left) + Math.round((Number(currentWin.width) - popupWidth) / 2));
        top = Math.max(0, Number(currentWin.top) + Math.round((Number(currentWin.height) - popupHeight) / 2));
      }
    } catch {
      left = undefined;
      top = undefined;
    }

    const created = await chrome.windows.create({
      url: JLGJ_LOGIN_ASSIST_URL,
      type: 'popup',
      focused: true,
      width: popupWidth,
      height: popupHeight,
      left,
      top
    });
    jlgjLoginAssistPopupWindowId = Number(created?.id || 0) || null;
    const tab = Array.isArray(created?.tabs) && created.tabs.length ? created.tabs[0] : null;
    jlgjLoginAssistPopupTabId = Number(tab?.id || 0) || null;
    startJlgjLoginAssistWatcher();
  };

  openPopup().catch(() => {
    showToast('打开接龙管家登录弹窗失败，请检查浏览器弹窗权限', 'error', 2200);
  });
}

function clearJlgjStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.jlgj-standalone-card');
  cards.forEach((n) => n.remove());
  updateCourseListEmptyPlaceholder();
}

function renderJlgjNeedLoginMessage() {
  const shouldOpenAssist = !!window.platformInteractiveLoginPending?.jlgj;
  window.platformLoadedOnce.jlgj = false;
  clearPlatformData('jlgj');
  rerenderAllHomeworkAreas();
  setPlatformLoginState('jlgj', 'offline');

  if (shouldOpenAssist) {
    openJlgjLoginAssistPopup(true);
    return;
  }

  closeJlgjLoginAssistPopup(true);
  window.platformNeedLogin.jlgj = false;
  refreshPlatformLoginTip();
}

async function getJlgjAuthHeaders() {
  try {
    const cookieSets = await Promise.all([
      chrome.cookies.getAll({ url: 'https://i.jielong.com/' }),
      chrome.cookies.getAll({ url: 'https://i-api.jielong.com/' })
    ]);
    const cookies = cookieSets.flat();
    const tokenCookie = (cookies || []).find((cookie) => String(cookie?.name || '').toLowerCase() === 'token');
    let token = String(tokenCookie?.value || '').trim();
    try { token = decodeURIComponent(token); } catch { /* Keep the raw cookie value. */ }
    token = token.replace(/^['"]|['"]$/g, '').replace(/^Bearer\s+/i, '').trim();
    return { authorization: token ? `Bearer ${token}` : '', token };
  } catch {
    return { authorization: '', token: '' };
  }
}

function extractJlgjData(payload) {
  if (payload && payload.Data !== undefined) return payload.Data;
  if (payload && payload.data !== undefined) return payload.data;
  return null;
}

function isJlgjUnauthorizedPayload(payload) {
  const type = String(payload?.Type ?? payload?.type ?? '').trim();
  const dataText = String(payload?.Data ?? payload?.data ?? '').trim();
  return type === '100000' || /请先授权登录小程序/i.test(dataText);
}

async function fetchJlgjJson(url) {
  const headers = { Accept: 'application/json, text/plain, */*' };
  const auth = await getJlgjAuthHeaders();
  if (!auth.authorization) {
    return { ok: false, status: 401, data: null, unauthorized: true, message: '接龙管家登录 token 不存在' };
  }
  headers.authorization = auth.authorization;

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      unauthorized: false,
      message: String(error?.message || error)
    };
  }
  const text = await res.text();
  try {
    const data = JSON.parse(String(text || '{}'));
    const unauthorized = Number(res.status || 0) === 401 || Number(res.status || 0) === 403 || isJlgjUnauthorizedPayload(data);
    return { ok: res.ok, status: Number(res.status || 0), data, unauthorized };
  } catch {
    return { ok: false, status: Number(res.status || 0), data: null, raw: text, unauthorized: Number(res.status || 0) === 401 || Number(res.status || 0) === 403 };
  }
}

function isJlgjHomeworkDone(hw) {
  return !!hw?.done;
}

function isJlgjHomeworkPending(hw) {
  return !isJlgjHomeworkDone(hw) && !isDeadlinePassed(hw?.end);
}

function isJlgjHomeworkOverdue(hw) {
  return !isJlgjHomeworkDone(hw) && isDeadlinePassed(hw?.end);
}

function formatJlgjDateTime(value) {
  const timestamp = parseDeadlineToTs(value);
  if (!timestamp) return '无';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '无';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderJlgjHomeworkItems(items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it) => {
    const done = isJlgjHomeworkDone(it);
    const overdue = !done && isJlgjHomeworkOverdue(it);
    const isLoadingMeta = !!it?.loadingMeta;
    const palette = globalThis.BjtuHomeworkUi.homeworkPalette({ done, overdue });
    const detail = isLoadingMeta ? '' : normalizeHomeworkContent(String(it?.content || '').trim());
    const contentHtml = isLoadingMeta
      ? `正在加载详情…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>`
      : (detail || `<span style="color:#999;">${globalThis.BjtuHomeworkUi.text.detailEmpty}</span>`);
    const expandableContentHtml = renderExpandableHtml(contentHtml, globalThis.BjtuHomeworkUi.detailOptions({
      baseBg: 'rgba(255,255,255,0.3)',
      flatDisplay: true
    }));
    const link = String(it?.link || JLGJ_WEB_BASE);
    const actionText = globalThis.BjtuHomeworkUi.actionLabel('jlgj', done ? 'view' : 'submit');
    const deadline = it?.end || it?.deadline || '';
    const endText = isLoadingMeta ? '正在加载……' : formatJlgjDateTime(it.end);
    const startTime = it?.start || it?.startTime || '';
    const endSuffix = isLoadingMeta
      ? ` <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>`
      : '';
    return globalThis.BjtuHomeworkUi.renderHomeworkCard({
      done,
      background: palette.background,
      border: palette.border,
      titleHtml: globalThis.BjtuHomeworkUi.titleHtml({ title: it.title || '接龙作业', color: palette.foreground, href: link, escape: escapeHtml }),
      metaHtml: globalThis.BjtuHomeworkUi.deadlineMetaHtml({
        deadline,
        formatted: endText,
        startTime,
        startFormatted: isLoadingMeta ? '' : formatJlgjDateTime(startTime),
        done,
        overdue,
        loading: isLoadingMeta,
        suffixHtml: endSuffix,
        escape: escapeHtml
      }),
      actionsHtml: globalThis.BjtuHomeworkUi.renderActionLink({ href: link, label: actionText, color: palette.action, escape: escapeHtml }),
      detailHtml: `<div style="margin-top:3px;border-top:1px dashed ${palette.border}40;padding-top:0;font-size:12px;color:#374151;line-height:1.45;">${expandableContentHtml}</div>`
    });
  }).join('');
}

function renderJlgjStandaloneCourses() {
  clearJlgjStandaloneCards();
  const courses = window.jlgjStandaloneCourses || [];
  if (!courses.length) {
    updateCourseListEmptyPlaceholder();
    return;
  }

  const baseOrder = Number(courseListDiv.dataset.orderBase || 100000) + 80000;
  courses.forEach((c, idx) => {
    const courseId = `jlgj-${String(c.groupId || idx)}`;
    const loadingMeta = !!c.loadingMeta;
    const titleHtml = escapeHtml(c.name || '接龙管家课程');
    const teacherHtml = loadingMeta
      ? `正在加载…… <span class="spinner" style="display:inline-block; width:9px; height:9px; margin-left:4px; border-width:1px; border-color:#64748b; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>`
      : escapeHtml(String(c.teacherName || ''));
    const card = globalThis.BjtuCourseCardUi.createCourseCard({
      courseId,
      className: 'jlgj-standalone-card',
      order: baseOrder + idx,
      titleHtml: `<a href="${JLGJ_WEB_BASE}" target="_blank" rel="noopener noreferrer" style="color:#ffd243;text-decoration:none;line-height:1.3;">${titleHtml}</a>`,
      metaHtml: `<div style="font-size:12px;color:#666;line-height:1.35;">${teacherHtml}</div>`,
      actionsHtml: '<button class="btn" style="background:#9C27B0;display:none;" data-action="videos">回放下载</button>',
      contentHtml: loadingMeta && !(c.homeworks || []).length
        ? `<div class="spinner" style="border-color:#2196F3;border-top-color:transparent;display:inline-block;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></div> 正在获取作业…`
        : ''
    });
    courseListDiv.appendChild(card);

    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    window.jlgjMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
}

async function loadJlgjCoursesAndHomework(courses = [], loadVersion = 0) {
  const activeVersion = loadVersion || bumpPlatformLoadVersion('jlgj');
  const isStale = () => !!(activeVersion && activeVersion !== (window.platformLoadVersion?.jlgj || 0));
  if (isStale()) return;
  if (!isPlatformEnabled('jlgj')) {
    clearPlatformData('jlgj');
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('jlgj', 'checking');

  const matchMap = new Map();

  const pickArr = (payload) => {
    const data = extractJlgjData(payload);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.Data)) return data.Data;
    return [];
  };

  const listResp = await fetchJlgjJson(JLGJ_GROUP_LIST_API);
  if (isStale() || !isPlatformEnabled('jlgj')) return;

  if (listResp?.unauthorized) {
    window.platformLoadedOnce.jlgj = true;
    renderJlgjNeedLoginMessage();
    return;
  }

  const groups = pickArr(listResp?.data);

    const placeholderGroups = groups.map((group) => {
      const groupId = String(group?.Id || '').trim();
      const name = String(group?.Name || '接龙管家课程').trim();
      return {
        token: normalizeCourseNameToken(name),
        name,
        groupId,
        teacherName: '',
        loadingMeta: true,
        homeworks: []
      };
    }).filter((group) => group.groupId || group.name);

    const rebuildJlgjRender = () => {
      window.jlgjMatchedHomeworkByCourseId = {};
      window.jlgjStandaloneCourses = [];
      for (const cg of (window.jlgjCourseGroupsSnapshot || [])) {
        const matched = matchMap.get(String(cg?.token || ''));
        if (matched?.courseId) {
          const cid = String(matched.courseId);
          if (!window.jlgjMatchedHomeworkByCourseId[cid]) window.jlgjMatchedHomeworkByCourseId[cid] = [];
          window.jlgjMatchedHomeworkByCourseId[cid].push(...(Array.isArray(cg.homeworks) ? cg.homeworks : []));
        } else {
          window.jlgjStandaloneCourses.push({
            name: cg.name,
            groupId: cg.groupId,
            teacherName: cg.teacherName,
            loadingMeta: !!cg.loadingMeta,
            homeworks: Array.isArray(cg.homeworks) ? cg.homeworks : []
          });
        }
      }
      (courses || []).forEach((course) => {
        const cid = String(course?.id || course?.cId || course?.courseId || course?.course_id || '').trim();
        if (cid) renderHomeworkList(cid);
      });
      Object.keys(window.jlgjMatchedHomeworkByCourseId).forEach((courseId) => {
        renderHomeworkList(courseId);
      });
      renderJlgjStandaloneCourses();
    };

    if (placeholderGroups.length) {
      window.jlgjMatchedHomeworkByCourseId = {};
      window.jlgjStandaloneCourses = [];
      window.jlgjCourseGroupsSnapshot = placeholderGroups;
      setPlatformLoginState('jlgj', 'online');
      window.platformLoadedOnce.jlgj = true;
      rebuildJlgjRender();
    }

    if (!listResp?.ok && !groups.length) {
      window.platformLoadedOnce.jlgj = true;
      setPlatformLoginState('jlgj', 'online');
      clearPlatformData('jlgj');
      rerenderAllHomeworkAreas();
      return;
    }

    if (!placeholderGroups.length) {
      window.jlgjMatchedHomeworkByCourseId = {};
      window.jlgjStandaloneCourses = [];
      window.jlgjCourseGroupsSnapshot = [];
    }

    const detailGroups = [];
    for (const group of groups) {
      if (isStale()) return;
      const groupId = String(group?.Id || '').trim();
      const name = String(group?.Name || '接龙管家课程').trim();
      if (!groupId) continue;

      let courseGroup = window.jlgjCourseGroupsSnapshot.find((item) => String(item?.groupId || '') === groupId);
      if (!courseGroup) {
        courseGroup = {
          token: normalizeCourseNameToken(name),
          name,
          groupId,
          teacherName: '',
          loadingMeta: true,
          homeworks: []
        };
        window.jlgjCourseGroupsSnapshot.push(courseGroup);
        rebuildJlgjRender();
      }

      let threads = [];
      const threadUrl = `${JLGJ_API_BASE}/api/Thread/GroupThreads?pageIndex=1&pageSize=20&groupId=${encodeURIComponent(groupId)}&groupListType=0`;
      const threadsResp = await fetchJlgjJson(threadUrl);
      if (isStale()) return;
      if (threadsResp?.unauthorized) {
        renderJlgjNeedLoginMessage();
        return;
      }
      if (threadsResp?.ok) {
        threads = pickArr(threadsResp.data);
      }
      if (!threads.length) {
        courseGroup.loadingMeta = false;
        rebuildJlgjRender();
        continue;
      }

      const teacherSet = new Set();
      const homeworks = threads.map((t) => {
        const threadId = String(t?.ThreadStrId || '').trim();
        const teacherName0 = String(t?.Author || '').trim();
        if (teacherName0) teacherSet.add(teacherName0);
        const isAttend0 = t?.IsAttend;
        const done0 = isAttend0 === true || isAttend0 === 1 || isAttend0 === '1' || String(isAttend0 || '').toLowerCase() === 'true';
        return {
          threadId,
          title: String(t?.Subject || t?.GroupName || '接龙作业').trim(),
          end: '',
          content: '',
          done: done0,
          link: `https://i.jielong.com/h/${threadId}`,
          loadingMeta: true
        };
      });

      courseGroup.teacherName = Array.from(teacherSet).join(' / ');
      courseGroup.loadingMeta = true;
      courseGroup.homeworks = homeworks;
      rebuildJlgjRender();

      detailGroups.push({ courseGroup, threads, homeworks, teacherSet });
    }

    const totalDetailLoads = detailGroups.reduce((total, item) => total + item.threads.length, 0);
    let completedDetailLoads = 0;
    const updateDetailProgress = () => {
      setPlatformContentLoadProgress('jlgj', completedDetailLoads, totalDetailLoads);
    };
    updateDetailProgress();

    for (const { courseGroup, threads, homeworks, teacherSet } of detailGroups) {
      for (let i = 0; i < threads.length; i++) {
        if (isStale()) return;
        const t = threads[i];
        const threadId = String(t?.ThreadStrId || '').trim();
        try {
          if (!threadId) {
            if (homeworks[i]) homeworks[i].loadingMeta = false;
            continue;
          }

          let detail = null;
          const detailUrl = `${JLGJ_API_BASE}/api/Homework/HomeworkDetail?threadId=${encodeURIComponent(threadId)}`;
          const detailResp = await fetchJlgjJson(detailUrl);
          if (isStale()) return;
          if (detailResp?.unauthorized) {
            renderJlgjNeedLoginMessage();
            return;
          }
          if (detailResp?.ok) {
            const detailPayload = detailResp.data;
            detail = detailPayload?.Data?.Data || detailPayload?.Data || null;
          }
          if (!detail) {
            if (homeworks[i]) homeworks[i].loadingMeta = false;
            continue;
          }

          const homework = detail?.Homework || {};
          const threadData = detail?.Thread || {};
          const body = Array.isArray(threadData?.ThreadBody) ? threadData.ThreadBody : [];
          const content = body
            .map((item) => String(item?.Text?.Content || '').trim())
            .filter(Boolean)
            .join('\n');
          const teacherName = String(t?.Author || '').trim();
          if (teacherName) teacherSet.add(teacherName);
          const isAttend = t?.IsAttend;
          const done = isAttend === true || isAttend === 1 || isAttend === '1' || String(isAttend || '').toLowerCase() === 'true';

          homeworks[i] = {
            threadId,
            title: String(t?.Subject || t?.GroupName || '接龙作业').trim(),
            end: homework?.EndTime || '',
            start: homework?.StartTime || threadData?.CreateTime || t?.CreateTime || '',
            content,
            done,
            link: `https://i.jielong.com/h/${threadId}`,
            loadingMeta: false
          };
          courseGroup.teacherName = Array.from(teacherSet).join(' / ');
        } finally {
          completedDetailLoads += 1;
          updateDetailProgress();
          rebuildJlgjRender();
        }
      }

      courseGroup.loadingMeta = false;
      rebuildJlgjRender();
    }
    setPlatformContentLoadProgress('jlgj', totalDetailLoads, totalDetailLoads);
}

function scheduleJlgjLoad(courses, loadVersion = 0) {
  if (!isPlatformEnabled('jlgj')) return Promise.resolve();
  const list = Array.isArray(courses) ? courses : [];
  if (!window.__jlgjLoadSerialPromise) window.__jlgjLoadSerialPromise = Promise.resolve();
  window.__jlgjLoadSerialPromise = window.__jlgjLoadSerialPromise
    .catch(() => {})
    .then(() => loadJlgjCoursesAndHomework(list, loadVersion));
  return window.__jlgjLoadSerialPromise;
}

/* ================= qwen 页面桥（service worker 经 app 页面调用） ================= */

function jlgjPageSnapshot() {
  return Array.isArray(window.jlgjCourseGroupsSnapshot) ? window.jlgjCourseGroupsSnapshot : [];
}

async function jlgjPageCourseList() {
  const enabled = typeof isPlatformEnabled === 'function' ? isPlatformEnabled('jlgj') : true;
  if (!enabled) {
    return {
      enabled: false,
      loaded: false,
      loginState: 'disabled',
      loggedIn: false,
      courses: []
    };
  }
  if (window.__jlgjLoadSerialPromise && typeof window.__jlgjLoadSerialPromise.then === 'function') {
    await window.__jlgjLoadSerialPromise.catch(() => {});
  }
  const snap = jlgjPageSnapshot();
  const loginState = String(window.platformLoginState?.jlgj || 'checking');
  return {
    enabled: true,
    loaded: snap.length > 0,
    loginState,
    loggedIn: loginState === 'online',
    courses: snap.map((group) => ({
      groupId: String(group?.groupId || ''),
      name: String(group?.name || ''),
      teacherName: String(group?.teacherName || ''),
      homeworkCount: Array.isArray(group?.homeworks) ? group.homeworks.length : 0
    }))
  };
}

async function jlgjPageHomeworkOf(groupId) {
  const key = String(groupId || '').trim();
  if (!key) return { ok: false, message: '缺少参数 groupId，请先调用 jlgj.courseList 获取群组ID' };
  const loginState = String(window.platformLoginState?.jlgj || 'checking');
  if (loginState !== 'online') return { ok: false, code: 'LOGIN_REQUIRED', loggedIn: false, message: '接龙管家未登录，请先调用 jlgj.login' };
  if (window.__jlgjLoadSerialPromise && typeof window.__jlgjLoadSerialPromise.then === 'function') {
    await window.__jlgjLoadSerialPromise.catch(() => {});
  }
  const group = jlgjPageSnapshot().find((g) => String(g?.groupId || '').trim() === key) || null;
  if (!group) return { ok: false, message: `群组ID无效：${key} 不在接龙管家课程列表中，请先调用 jlgj.courseList 获取有效群组ID` };
  return {
    ok: true,
    groupId: String(group?.groupId || ''),
    name: String(group?.name || ''),
    teacherName: String(group?.teacherName || ''),
    homework: (Array.isArray(group?.homeworks) ? group.homeworks : []).map((hw) => ({
      threadId: hw?.threadId,
      title: hw?.title,
      end: hw?.end,
      content: hw?.content,
      done: !!hw?.done,
      link: hw?.link
    }))
  };
}

async function jlgjPageLoginStatus() {
  const enabled = typeof isPlatformEnabled === 'function' ? isPlatformEnabled('jlgj') : true;
  if (!enabled) return { enabled: false, loginState: 'disabled', loggedIn: false, snapshotLoaded: false };
  const state = String(window.platformLoginState?.jlgj || 'checking');
  return { enabled: true, loginState: state, loggedIn: state === 'online', snapshotLoaded: jlgjPageSnapshot().length > 0 };
}

async function jlgjPageLogin(args = {}) {
  const platform = 'jlgj';
  const enabled = typeof isPlatformEnabled === 'function' ? isPlatformEnabled(platform) : true;
  if (enabled) {
    return globalThis.getEnabledPlatformLoginResult(platform);
  } else if (typeof togglePlatformSelection === 'function') {
    try { togglePlatformSelection(platform, { interactive: true }); } catch {}
  }
  return await waitForPlatformLoginResult(platform, Number(args?.timeoutMs) || 120000);
}

globalThis.BjtuJlgjPageApi = Object.freeze({
  courseList: () => jlgjPageCourseList(),
  homework_of_: (args) => jlgjPageHomeworkOf(String(args?.groupId || args?.courseId || '').trim()),
  status: () => jlgjPageLoginStatus(),
  login: (args) => jlgjPageLogin(args)
});

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'PAGE_API' || message?.payload?.module !== 'jlgj') return false;
    const api = globalThis.BjtuJlgjPageApi;
    const fn = api && typeof api[String(message.payload?.fn || '')] === 'function' ? api[String(message.payload.fn)] : null;
    if (!fn) {
      sendResponse({ ok: false, error: 'JLGJ 页面接口不存在' });
      return true;
    }
    Promise.resolve(fn(message.payload?.args || {})).then(
      (value) => sendResponse({ ok: true, value }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error), code: String(error?.code || '') })
    );
    return true;
  });
}
