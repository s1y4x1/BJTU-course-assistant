const YKT_BASE = 'https://www.yuketang.cn';
const YKT_REQUEST_PAGE_URL = `${YKT_BASE}/v2/web/index`;
const YKT_EXAM_BASE = 'https://examination.xuetangx.com';
const YKT_COURSE_LIST_API = `${YKT_BASE}/v2/api/web/courses/list?identity=2`;
const YKT_HEADERS = {
  'uv-id': '0',
  'xt-agent': 'web',
  xtbz: 'ykt',
  Accept: 'application/json, text/plain, */*'
};
const YKT_ACTIVITY_TYPE_LABELS = Object.freeze({
  14: '课堂',
  15: '线上学习',
  5: '试卷',
  9: '公告'
});
const YKT_WECHAT_QR_LOGIN_URL = 'https://open.weixin.qq.com/connect/qrconnect?appid=wxda8c70bb118d342b&scope=snsapi_login&redirect_uri=https://www.yuketang.cn/api/v3/user/login/wechat-web-callback';
const YKT_WECHAT_LOGIN_SUCCESS_URL_PREFIX = 'https://www.yuketang.cn/authorize/wx-qrlogin?success=1';
let yktLoginAssistPollTimer = null;
let yktLoginAssistPopupWindowId = null;
let yktLoginAssistPopupTabId = null;
let yktLoginAssistCompleting = false;
let yktLoginAssistChecking = false;

// Platform-specific functions extracted from app.js. Shared helpers remain global.

function isYktHomeworkDone(hw) {
  if (Number(hw?.__actype ?? hw?.actype) === 14) return hw?.attend_status === true;
  if (Number(hw?.__actype) === 15) {
    if (hw?.video_progress_ratio !== null && hw?.video_progress_ratio !== undefined) {
      return Number(hw.video_progress_ratio) >= 0.9995;
    }
    if (hw?.video_total_done !== null && hw?.video_total_done !== undefined) {
      return Number(hw.video_total_done) === 1;
    }
  }
  const progress = Number(hw?.progress ?? 0);
  const problemCount = Number(hw?.problem_count ?? hw?.problemCount ?? 0);
  if (problemCount > 0) return progress >= problemCount;
  if (hw && hw.done !== null && hw.done !== undefined) return !!hw.done;
  if (hw && hw.unfinished !== null && hw.unfinished !== undefined) {
    return Number(hw.unfinished) === 0;
  }
  return false;
}

function isYktHomeworkPending(hw) {
  if (Number(hw?.__actype ?? hw?.actype) === 14) {
    return hw?.attend_status !== true && hw?.is_finished !== true;
  }
  return !isYktHomeworkDone(hw) && !isDeadlinePassed(hw?.end);
}

function isYktHomeworkOverdue(hw) {
  if (Number(hw?.__actype ?? hw?.actype) === 14) {
    return hw?.attend_status !== true && hw?.is_finished === true;
  }
  return !isYktHomeworkDone(hw) && isDeadlinePassed(hw?.end);
}

function formatYktDateTime(ts) {
  const n = parseDeadlineToTs(ts);
  if (!n) return '无';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '无';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getYktActivityDeadline(a) {
  if (Number(a?.__actype ?? a?.actype) === 14) return '';
  if (Number(a?.__actype) === 15) {
    const scoreDeadline = a?.content?.score_d;
    if (scoreDeadline !== null && scoreDeadline !== undefined && String(scoreDeadline).trim() !== '') return scoreDeadline;
  }
  return a?.end
    ?? a?.deadline
    ?? a?.end_time
    ?? a?.endTime
    ?? a?.exam_end_time
    ?? a?.examEndTime
    ?? a?.exam?.end
    ?? a?.exam?.end_time
    ?? '';
}

function yktCourseLink(classroomId) {
  return `${YKT_BASE}/v2/web/studentLog/${encodeURIComponent(String(classroomId || ''))}`;
}

function yktHomeworkLink(classroomId, coursewareId, id) {
  return `${YKT_BASE}/v2/web/studentCards/${encodeURIComponent(String(classroomId || ''))}/${encodeURIComponent(String(coursewareId || ''))}/${encodeURIComponent(String(id || ''))}`;
}

function yktClassroomReportLink(classroomId, coursewareId, id) {
  return `${YKT_BASE}/v2/web/student-lesson-report/${encodeURIComponent(String(classroomId || ''))}/${encodeURIComponent(String(coursewareId || ''))}/${encodeURIComponent(String(id || ''))}`;
}

function yktVideoStudentLink(classroomId, leafId) {
  return `${YKT_BASE}/v2/web/xcloud/video-student/${encodeURIComponent(String(classroomId || ''))}/${encodeURIComponent(String(leafId || ''))}`;
}

function yktExamLink(courseId, coursewareId) {
  return `${YKT_BASE}/v2/web/exam/${encodeURIComponent(String(courseId || ''))}/${encodeURIComponent(String(coursewareId || ''))}`;
}

function removeYktLoginSection() {
  const old = document.getElementById('ykt-extra-wrapper');
  if (old) old.remove();
}

function clearYktStandaloneCards() {
  const cards = courseListDiv.querySelectorAll('.ykt-standalone-card');
  cards.forEach((n) => n.remove());
  updateCourseListEmptyPlaceholder();
}

function stopYktLoginAssistWatcher() {
  if (yktLoginAssistPollTimer) {
    clearInterval(yktLoginAssistPollTimer);
    yktLoginAssistPollTimer = null;
  }
}

function isYktLoginSuccessUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    const expected = new URL(YKT_WECHAT_LOGIN_SUCCESS_URL_PREFIX);
    return parsed.origin === expected.origin
      && parsed.pathname === expected.pathname
      && parsed.searchParams.get('success') === '1';
  } catch {
    return false;
  }
}

function failYktLoginAssistAfterUserClose({ windowId = null, tabId = null } = {}) {
  const matchesWindow = windowId != null
    && Number(windowId) === Number(yktLoginAssistPopupWindowId);
  const matchesTab = tabId != null
    && Number(tabId) === Number(yktLoginAssistPopupTabId);
  if ((!matchesWindow && !matchesTab) || yktLoginAssistCompleting) return;
  yktLoginAssistPopupWindowId = null;
  yktLoginAssistPopupTabId = null;
  stopYktLoginAssistWatcher();
  if (!window.platformInteractiveLoginPending?.ykt) return;
  window.platformInteractiveLoginPending.ykt = false;
  setPlatformLoginState('ykt', 'offline');
}

if (chrome?.windows?.onRemoved) {
  chrome.windows.onRemoved.addListener((windowId) => {
    failYktLoginAssistAfterUserClose({ windowId });
  });
}

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    failYktLoginAssistAfterUserClose({ tabId });
  });
}

function isYktSiteUrl(url) {
  try {
    return new URL(String(url || '').trim()).origin === YKT_BASE;
  } catch {
    return false;
  }
}

function completeYktLoginAssist() {
  if (yktLoginAssistCompleting) return;
  yktLoginAssistCompleting = true;
  closeYktLoginAssistPopup(false);
  completeExternalLoginAssist('ykt', true);
}

async function verifyYktLoginAfterPopupClosed() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!window.platformInteractiveLoginPending?.ykt) return false;
    try {
      const response = await fetchYktJson(YKT_COURSE_LIST_API);
      if (Number(response?.errcode) === 0) {
        completeYktLoginAssist();
        return true;
      }
    } catch {
      // The login callback may still be committing the session cookie.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function checkYktLoginAssistPopupUrl() {
  if (yktLoginAssistChecking || yktLoginAssistCompleting) return false;
  if (!window.platformInteractiveLoginPending?.ykt) return false;
  if (!yktLoginAssistPopupTabId) return false;
  yktLoginAssistChecking = true;
  try {
    const tab = await chrome.tabs.get(Number(yktLoginAssistPopupTabId));
    const currentUrl = String(tab?.url || '').trim();
    if (isYktLoginSuccessUrl(currentUrl)) {
      completeYktLoginAssist();
      return true;
    }
    if (isYktSiteUrl(currentUrl)) {
      const response = await fetchYktJson(YKT_COURSE_LIST_API).catch(() => null);
      if (Number(response?.errcode) === 0) {
        completeYktLoginAssist();
        return true;
      }
    }
  } catch {
    // Keep the known IDs until verification finishes. A transient tabs.get failure can
    // happen during the success redirect while the popup window is still open.
    stopYktLoginAssistWatcher();
    void (async () => {
      if (await verifyYktLoginAfterPopupClosed()) return;
      const popupStillOpen = yktLoginAssistPopupWindowId
        ? await chrome.windows.get(Number(yktLoginAssistPopupWindowId)).then(() => true).catch(() => false)
        : false;
      if (popupStillOpen && window.platformInteractiveLoginPending?.ykt) {
        startYktLoginAssistWatcher();
} else {
        yktLoginAssistPopupWindowId = null;
        yktLoginAssistPopupTabId = null;
        window.platformInteractiveLoginPending.ykt = false;
        if (String(window.platformLoginState?.ykt || '') === 'checking') {
          setPlatformLoginState('ykt', 'offline');
        }
      }
    })();
  } finally {
    yktLoginAssistChecking = false;
  }
  return false;
}

function startYktLoginAssistWatcher() {
  stopYktLoginAssistWatcher();
  yktLoginAssistPollTimer = setInterval(() => {
    void checkYktLoginAssistPopupUrl();
  }, PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS);
  void checkYktLoginAssistPopupUrl();
}

function closeYktLoginAssistPopup(cancelPending = false) {
  const knownWindowId = Number(yktLoginAssistPopupWindowId || 0);
  const knownTabId = Number(yktLoginAssistPopupTabId || 0);
  yktLoginAssistPopupWindowId = null;
  yktLoginAssistPopupTabId = null;
  stopYktLoginAssistWatcher();
  if (cancelPending) {
    window.platformInteractiveLoginPending.ykt = false;
  }
  void (async () => {
    let windowId = knownWindowId;
    if (!windowId && knownTabId) {
      const tab = await chrome.tabs.get(knownTabId).catch(() => null);
      windowId = Number(tab?.windowId || 0);
    }
    if (windowId) {
      const removed = await chrome.windows.remove(windowId).then(() => true).catch(() => false);
      if (removed) return;
    }
    if (knownTabId) await chrome.tabs.remove(knownTabId).catch(() => {});
  })();
}

function openYktLoginAssistPopup(force = false) {
  if (!force && !isPlatformEnabled('ykt')) return;
  yktLoginAssistCompleting = false;
  window.platformInteractiveLoginPending.ykt = true;
  if (yktLoginAssistPopupWindowId && yktLoginAssistPopupTabId) {
    chrome.windows.update(Number(yktLoginAssistPopupWindowId), { focused: true }).catch(() => {});
    startYktLoginAssistWatcher();
    return;
  }
  const openPopup = async () => {
    const popupWidth = 360;
    const popupHeight = 520;
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
      url: YKT_WECHAT_QR_LOGIN_URL,
      type: 'popup',
      focused: true,
      width: popupWidth,
      height: popupHeight,
      left,
      top
    });
    yktLoginAssistPopupWindowId = Number(created?.id || 0) || null;
    const tab = Array.isArray(created?.tabs) && created.tabs.length ? created.tabs[0] : null;
    yktLoginAssistPopupTabId = Number(tab?.id || 0) || null;
    startYktLoginAssistWatcher();
  };
  openPopup().catch(() => {
    showToast('打开雨课堂登录弹窗失败，请检查浏览器弹窗权限', 'error', 2200);
  });
}

function ensureYktSection() {
  return null;
}

function renderYktNeedLoginMessage() {
  const shouldOpenAssist = !!window.platformInteractiveLoginPending?.ykt;
  removeYktLoginSection();
  window.platformLoadedOnce.ykt = false;
  clearPlatformData('ykt');
  rerenderAllHomeworkAreas();

  if (shouldOpenAssist) {
    // 二维码登录弹窗将打开：保持 checking，等弹窗关闭后再给出登录结果。
    setPlatformLoginState('ykt', 'checking');
    openYktLoginAssistPopup(true);
    return;
  }

  setPlatformLoginState('ykt', 'offline');
  closeYktLoginAssistPopup(true);
  window.platformNeedLogin.ykt = false;
  refreshPlatformLoginTip();
}

async function fetchYktJson(url) {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: YKT_HEADERS,
    cache: 'no-store'
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { errcode: -1, errmsg: text || `HTTP ${res.status}` };
  }
}

async function getYktCsrfToken() {
  if (!chrome?.cookies?.getAll) return '';
  const cookies = await chrome.cookies.getAll({ url: `${YKT_BASE}/` }).catch(() => []);
  const csrfCookie = (cookies || []).find((cookie) => {
    const name = String(cookie?.name || '').toLowerCase();
    return name === 'csrftoken' || name === 'csrf_token';
  });
  return String(csrfCookie?.value || '').trim();
}

function pickYktUniversityId(...sources) {
  for (const source of sources) {
    const value = source?.university_id
      ?? source?.universityId
      ?? source?.university?.id
      ?? source?.course?.university_id
      ?? source?.course?.universityId
      ?? source?.course?.university?.id;
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

async function getYktUniversityIdFromOpenTabs() {
  const tabs = await chrome.tabs.query({ url: [`${YKT_BASE}/*`] }).catch(() => []);
  for (const tab of tabs || []) {
    try {
      const value = new URL(String(tab?.url || '')).searchParams.get('university_id');
      if (value && String(value).trim()) return String(value).trim();
    } catch { /* ignore malformed tab URL */ }
  }
  return '';
}

async function waitYktTabReady(tabId, timeoutMs = 12000) {
  const id = Number(tabId || 0);
  if (!Number.isFinite(id) || id <= 0) return false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (!tab?.id) return false;
    if (tab.status === 'complete' && String(tab.url || '').startsWith(YKT_BASE)) return true;
    await new Promise((resolve) => setTimeout(resolve, 160));
  }
  return false;
}

async function fetchYktCoursewareProgress(cid, coursewareIds, requestTabId, universityId, platformId = '3') {
  const courseId = String(cid || '').trim();
  const schoolId = String(universityId || '').trim();
  const actualPlatformId = String(platformId || '3').trim() || '3';
  const ids = [...new Set((Array.isArray(coursewareIds) ? coursewareIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  if (!courseId || !ids.length) return {};
  const tabId = Number(requestTabId || 0);
  if (!Number.isFinite(tabId) || tabId <= 0 || !(await waitYktTabReady(tabId))) {
    throw new Error('雨课堂请求页面未就绪');
  }
  const csrfToken = await getYktCsrfToken();
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (actualCid, newIds, suppliedUniversityId, suppliedPlatformId, suppliedCsrfToken) => {
      const pickUniversityId = (source, depth = 0) => {
        if (!source || typeof source !== 'object' || depth > 5) return '';
        const direct = source.university_id ?? source.universityId;
        if (direct !== null && direct !== undefined && String(direct).trim()) return String(direct).trim();
        for (const value of Object.values(source)) {
          const found = pickUniversityId(value, depth + 1);
          if (found) return found;
        }
        return '';
      };
      const urlParams = new URL(location.href).searchParams;
      let actualUniversityId = String(suppliedUniversityId || urlParams.get('university_id') || '').trim();
      let actualPlatformIdArg = String(suppliedPlatformId || urlParams.get('platform_id') || '3').trim() || '3';
      let actualCsrfToken = String(suppliedCsrfToken || '').trim();
      if (!actualCsrfToken) {
        const csrfMatch = document.cookie.match(/(?:^|;\s*)(?:csrftoken|csrf_token)=([^;]*)/i);
        actualCsrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
      }
      if (!actualUniversityId) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const courseResponse = await fetch(`${location.origin}/v2/api/web/courses/list?identity=2`, {
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
            headers: {
              accept: 'application/json, text/plain, */*',
              'xt-agent': 'web',
              xtbz: 'ykt'
            }
          });
          clearTimeout(timeoutId);
          const courseJson = await courseResponse.json();
          const courseList = Array.isArray(courseJson?.data?.list) ? courseJson.data.list : [];
          const matchedCourse = courseList.find((item) => String(item?.classroom_id || '') === String(actualCid));
          actualUniversityId = pickUniversityId(matchedCourse) || pickUniversityId(courseJson?.data);
          if (!actualPlatformIdArg || actualPlatformIdArg === '3') {
            actualPlatformIdArg = String((matchedCourse?.platform_id ?? matchedCourse?.platformId ?? actualPlatformIdArg) || '3');
          }
        } catch { /* send the progress request below so its response exposes the missing requirement */ }
      }
      const numericCid = /^\d+$/.test(actualCid) ? Number(actualCid) : actualCid;
      const referrer = `${location.origin}/v2/web/studentLog/${encodeURIComponent(actualCid)}?university_id=${encodeURIComponent(actualUniversityId)}&platform_id=${encodeURIComponent(actualPlatformIdArg)}&classroom_id=${encodeURIComponent(actualCid)}&content_url=`;
      const requestHeaders = {
        accept: 'application/json, text/plain, */*',
        'cache-control': 'no-cache',
        'classroom-id': actualCid,
        'content-type': 'application/json;charset=UTF-8',
        pragma: 'no-cache',
        'x-client': 'web',
        'xt-agent': 'web',
        xtbz: 'ykt'
      };
      if (actualUniversityId) {
        requestHeaders['university-id'] = actualUniversityId;
        requestHeaders['uv-id'] = actualUniversityId;
      }
      if (actualCsrfToken) requestHeaders['x-csrftoken'] = actualCsrfToken;
      const response = await fetch(`${location.origin}/mooc-api/v1/lms/learn/course/pub_new_pro`, {
        headers: requestHeaders,
        referrer,
        body: JSON.stringify({ cid: numericCid, new_id: newIds }),
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        cache: 'no-store',
        priority: 'high'
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return { success: false, error_code: response.status, msg: text || `HTTP ${response.status}`, data: {} };
      }
    },
    args: [courseId, ids, schoolId, actualPlatformId, csrfToken]
  });
  const data = execution?.result || {};
  if (data?.success !== true) {
    throw new Error(String(data?.detail || data?.msg || data?.errmsg || `HTTP ${data?.error_code || '请求失败'}`));
  }
  if (!data?.data || typeof data.data !== 'object') return {};
  return data.data;
}

function normalizeYktVideoProgress(progressRecord, leafId) {
  const record = progressRecord && typeof progressRecord === 'object' ? progressRecord : null;
  if (!record) return null;
  const totalDone = Number(record.total_done);
  const leafKey = String(leafId || '').trim();
  let ratio = NaN;
  if (leafKey && record[leafKey] !== null && record[leafKey] !== undefined) ratio = Number(record[leafKey]);
  if (!Number.isFinite(ratio)) {
    if (totalDone === 1) ratio = 1;
    else if (totalDone === -1 || totalDone === 0) ratio = 0;
  }
  ratio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
  return { totalDone, ratio };
}

async function fetchYktExamPaper(courseId, examId, sharedTabId = null) {
  const cid = String(courseId || '').trim();
  const eid = String(examId || '').trim();
  if (!eid) return null;

  const LOCK_MSG_RE = /同一时间只允许打开一份试卷|如需打开新的试卷，请在封面处跳转/;
  const MAX_ATTEMPTS = 4;

  const visitTransAndWaitRedirect = async () => {
    if (!cid || !Number.isFinite(Number(sharedTabId)) || Number(sharedTabId) <= 0) return false;
    const transUrl = `${YKT_BASE}/v2/web/trans/${encodeURIComponent(cid)}/${encodeURIComponent(eid)}`;
    try {
      await chrome.tabs.update(Number(sharedTabId), { url: transUrl });
      const start = Date.now();
      while (Date.now() - start < 8000) {
        await new Promise((resolve) => setTimeout(resolve, 180));
        const tab = await chrome.tabs.get(Number(sharedTabId));
        const currentUrl = String(tab?.url || '');
        if (currentUrl.includes('examination.xuetangx.com/')) return true;
        if (tab?.status === 'complete' && currentUrl.includes('/v2/web/trans/')) return false;
      }
      return false;
    } catch {
      return false;
    }
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Navigation establishes the exam session; request immediately after the redirect is observed.
    await visitTransAndWaitRedirect();

    try {
      const res = await fetch(`${YKT_EXAM_BASE}/exam_room/show_paper?exam_id=${encodeURIComponent(eid)}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' },
        cache: 'no-store'
      });
      if (Number(res.status) === 401 || Number(res.status) === 403) return null;

      const text = await res.text();
      const data = JSON.parse(String(text || '{}'));
      if (Number(data?.errcode) === 0) return data?.data || null;

      const errText = `${String(data?.errmsg || '')} ${String(data?.message || '')}`;
      if (!LOCK_MSG_RE.test(errText) || attempt >= MAX_ATTEMPTS) {
        return null;
      }
    } catch {
      if (attempt >= MAX_ATTEMPTS) return null;
    }

    await new Promise((r) => setTimeout(r, 240));
  }

  return null;
}

function renderYktExamProblemsHtml(problemList) {
  const list = Array.isArray(problemList) ? problemList : [];
  if (!list.length) return '';
  return list.map((p, i) => {
    const typeText = String(p?.TypeText || p?.Type || '题目类型').trim();
    const rawOptions = Array.isArray(p?.Options) ? p.Options : [];
    return globalThis.BjtuHomeworkUi.questionDetailHtml({
      index: Number(p?.index) || i + 1,
      typeText,
      score: p?.Score,
      bodyHtml: globalThis.BjtuHomeworkUi.sanitizeRichHtml(p?.Body || ''),
      options: rawOptions.map((option) => ({
        key: option?.key ?? option?.Key ?? '',
        valueHtml: globalThis.BjtuHomeworkUi.sanitizeRichHtml(
          option?.value ?? option?.Value ?? (typeof option === 'string' ? option : '')
        )
      })),
      emptyBodyHtml: '<span style="color:#999;">无题目内容</span>',
      escape: escapeHtml
    });
  }).join('');
}

async function loadDeferredYktHomeworkDetails(courseId, kind) {
  const cid = String(courseId || '').trim();
  const groupKind = String(kind || '').trim();
  if (!cid || !['done', 'overdue'].includes(groupKind)) return;
  const loadVersion = Number(window.platformLoadVersion?.ykt || 0);
  const isCancelled = () => (
    !isPlatformEnabled('ykt')
    || loadVersion !== Number(window.platformLoadVersion?.ykt || 0)
  );
  if (isCancelled()) return;
  window.yktDeferredDetailLoadPromises ||= {};
  const promiseKey = `${cid}:${groupKind}`;
  if (window.yktDeferredDetailLoadPromises[promiseKey]) return window.yktDeferredDetailLoadPromises[promiseKey];

  const run = (async () => {
    let items = Array.isArray(window.yktMatchedHomeworkByCourseId?.[cid])
      ? window.yktMatchedHomeworkByCourseId[cid]
      : [];
    if (!items.length && cid.startsWith('ykt-')) {
      const classroomId = cid.slice(4);
      const standalone = (window.yktStandaloneCourses || []).find((course) => String(course?.classroom_id || '') === classroomId);
      items = Array.isArray(standalone?.homeworks) ? standalone.homeworks : [];
    }
    const targets = items.filter((hw) => {
      if (Number(hw?.__actype) !== 5) return false;
      if (!['deferred', 'failed', ''].includes(String(hw?.exam_detail_state || '').trim())) return false;
      return groupKind === 'done' ? isYktHomeworkDone(hw) : isYktHomeworkOverdue(hw);
    });
    if (!targets.length) return;

    targets.forEach((hw) => { hw.exam_detail_state = 'queued'; });
    rerenderAllHomeworkAreas();
    renderYktStandaloneCourses();

    let requestTabId = null;
    let requestTabCreated = false;
    const ensureRequestTab = async () => {
      if (isCancelled()) return null;
      if (requestTabId) {
        const current = await chrome.tabs.get(requestTabId).catch(() => null);
        if (current?.id) return requestTabId;
        requestTabId = null;
        requestTabCreated = false;
      }
      const existingTabs = await chrome.tabs.query({ url: [`${YKT_BASE}/*`] }).catch(() => []);
      if (isCancelled()) return null;
      let tab = (existingTabs || []).find((item) => item?.id && item.status === 'complete' && item.active === false);
      if (!tab) {
        tab = await chrome.tabs.create({ url: YKT_REQUEST_PAGE_URL, active: false });
        void groupBjtuOpenedTab(tab?.id);
        requestTabCreated = true;
      }
      if (isCancelled()) {
        if (requestTabCreated && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
        return null;
      }
      requestTabId = Number(tab?.id || 0) || null;
      return requestTabId;
    };

    try {
      for (const hw of targets) {
        if (isCancelled()) return;
        hw.exam_detail_state = 'loading';
        rerenderAllHomeworkAreas();
        renderYktStandaloneCourses();
        const detailKey = String(hw?.detail_cache_key || '').trim();
        try {
          if (Number(hw?.__actype) === 5) {
            const tabId = await ensureRequestTab();
            if (isCancelled()) return;
            let paper = tabId ? await fetchYktExamPaper(hw?.course_id || hw?.classroom_id, hw?.exam_id || '', tabId) : null;
            if (!isCancelled() && !paper && tabId && !(await chrome.tabs.get(tabId).catch(() => null))) {
              requestTabId = null;
              const retryTabId = await ensureRequestTab();
              if (isCancelled()) return;
              paper = retryTabId ? await fetchYktExamPaper(hw?.course_id || hw?.classroom_id, hw?.exam_id || '', retryTabId) : null;
            }
            if (paper?.title) hw.title = paper.title;
            hw.exam_problems = Array.isArray(paper?.problems) ? paper.problems : [];
          }
          hw.exam_detail_state = 'done';
          if (detailKey) {
            window.yktDetailCacheByKey[detailKey] = {
              state: 'done', title: hw.title,
              exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : [],
              promise: null
            };
          }
        } catch {
          hw.exam_detail_state = 'failed';
          if (detailKey) window.yktDetailCacheByKey[detailKey] = { ...(window.yktDetailCacheByKey[detailKey] || {}), state: 'failed', promise: null };
        }
        rerenderAllHomeworkAreas();
        renderYktStandaloneCourses();
      }
    } finally {
      if (requestTabCreated && requestTabId) {
        try { await chrome.tabs.remove(requestTabId); } catch { /* ignore */ }
      }
    }
  })().finally(() => { delete window.yktDeferredDetailLoadPromises[promiseKey]; });
  window.yktDeferredDetailLoadPromises[promiseKey] = run;
  return run;
}

function renderYktHomeworkItems(courseId, items) {
  const list = (items || []).filter((item) => {
    const actype = Number(item?.__actype);
    if (actype === 14) return window.showYktClassroomActivities === true;
    if (actype === 9) return window.showYktAnnouncements === true;
    return true;
  });
  if (!list.length) return '';
  return list.map((it, idx) => {
    const done = isYktHomeworkDone(it);
    const overdue = !done && isYktHomeworkOverdue(it);
    const progress = Number(it?.progress ?? 0);
    const problemCount = Number(it?.problem_count ?? 0);
    const progressText = problemCount > 0 ? `${progress}/${problemCount}` : '';
    const isVideoActivity = Number(it?.__actype) === 15;
    const progressHtml = isVideoActivity
      ? globalThis.BjtuHomeworkUi.progressHtml({
          ratio: it?.video_progress_ratio,
          loading: !!it?.video_progress_loading,
          escape: escapeHtml,
          color: '#5096f5'
        })
      : (progressText ? `<div style="font-size:12px;color:#666;">进度：${escapeHtml(progressText)}</div>` : '');
    const hasScore = it?.score !== null && it?.score !== undefined && String(it.score) !== '';
    const palette = globalThis.BjtuHomeworkUi.homeworkPalette({ done, overdue });
    const actionText = globalThis.BjtuHomeworkUi.actionLabel(
      'ykt',
      done ? 'view' : (Number(it?.__actype) === 15 ? 'learn' : 'submit')
    );
    const titleScoreBadge = globalThis.BjtuHomeworkUi.scoreBadgeHtml({
      userScore: hasScore ? it.score : null,
      totalScore: hasScore ? it.total_score : null,
      escape: escapeHtml
    });
    const deadline = it?.end || it?.deadline || '';
    const yktIdSeed = String(it?.id || it?.courseware_id || it?.classroom_id || idx).trim();
    const expandKey = `ykt:${yktIdSeed}`;
    const expanded = isHomeworkDetailExpanded(courseId, expandKey);
    const actype = Number(it?.__actype);
    const isClassroomActivity = actype === 14;
    const activityTypeLabel = YKT_ACTIVITY_TYPE_LABELS[actype] || '';
    const isExam = actype === 5;
    const examDetail = isExam ? renderYktExamProblemsHtml(it?.exam_problems || []) : '';
    let detailStatusHtml = '';
    if (isExam && !examDetail) {
      const state = String(it?.exam_detail_state || '').trim();
      if (state === 'loading') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>${globalThis.BjtuHomeworkUi.text.detailLoading}</div>`;
      } else if (state === 'queued') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;${globalThis.BjtuHomeworkUi.spinnerPhaseStyle()}"></span>${globalThis.BjtuHomeworkUi.text.detailQueued}</div>`;
      } else if (state === 'failed') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:#b45309;">${globalThis.BjtuHomeworkUi.text.detailFailed}</div>`;
      }
    }
    const detailExpandable = examDetail
      ? renderExpandableHtml(examDetail, globalThis.BjtuHomeworkUi.detailOptions({
          emptyHtml: '<span style="color:#999;">无题目内容</span>',
          baseBg: done ? 'rgba(232,245,233,0.75)' : 'rgba(255,243,224,0.78)',
          flatDisplay: true,
          courseId,
          expandKey,
          expanded
        }))
      : '';
    return globalThis.BjtuHomeworkUi.renderHomeworkCard({
      done,
      background: palette.background,
      border: palette.border,
      titleHtml: globalThis.BjtuHomeworkUi.titleHtml({ typeLabel: activityTypeLabel, typeHref: it.link, title: it.title || '雨课堂作业', color: palette.foreground, href: it.link, escape: escapeHtml }),
      metaHtml: `${globalThis.BjtuHomeworkUi.deadlineMetaHtml({
        deadline: isClassroomActivity ? '' : deadline,
        formatted: isClassroomActivity ? '' : formatYktDateTime(it?.end),
        startTime: it?.create_time ?? '',
        startFormatted: formatYktDateTime(it?.create_time),
        done,
        overdue,
        loading: !!Number(it?.__loading),
        showCountdown: !isClassroomActivity,
        escape: escapeHtml
      })}${progressHtml}`,
      actionsHtml: `${titleScoreBadge ? `<div style="font-size:12px;line-height:1;">${titleScoreBadge}</div>` : ''}${globalThis.BjtuHomeworkUi.renderActionLink({ href: it.link, label: actionText, color: palette.action, escape: escapeHtml })}`,
      detailHtml: `${detailExpandable ? `<div style="margin-top:3px;border-top:1px dashed ${palette.border}40;padding-top:0;">${detailExpandable}</div>` : ''}${detailStatusHtml}`
    });
  }).join('');
}

function renderYktStandaloneCourses() {
  removeYktLoginSection();
  clearYktStandaloneCards();
  const courses = window.yktStandaloneCourses || [];
  if (!courses.length) {
    updateCourseListEmptyPlaceholder();
    return;
  }

  const baseOrder = Number(courseListDiv.dataset.orderBase || 100000);
  courses.forEach((c, idx) => {
    const courseId = `ykt-${String(c.classroom_id || idx)}`;
    const courseLink = yktCourseLink(c.classroom_id);
    const teacherName = String(c.teacher_name || '').trim();
    const subText = `${teacherName ? `${teacherName} · ` : ''}${String(c.name || '').trim()}`;
    const card = globalThis.BjtuCourseCardUi.createCourseCard({
      courseId,
      className: 'ykt-standalone-card',
      order: baseOrder + idx,
      titleHtml: `<a href="${courseLink}" target="_blank" rel="noopener noreferrer" style="color:#5096f5;text-decoration:none;line-height:1.3;">${escapeHtml(c.course_name || c.name || '雨课堂课程')}</a>`,
      metaHtml: `<div style="font-size:12px;color:#666;line-height:1.35;">${escapeHtml(subText)}</div>`,
      actionsHtml: '<button class="btn" style="background:#9C27B0;display:none;" data-action="videos">回放下载</button>'
    });
    courseListDiv.appendChild(card);

    if (!window.courseHomeworkData[courseId]) {
      window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    }
    renderHomeworkList(courseId);

    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    window.yktMatchedHomeworkByCourseId[courseId] = c.homeworks || [];

    renderHomeworkList(courseId);
  });
  updateCourseListEmptyPlaceholder();
}

function buildYktEntryHomeworks(entry, acts) {
  const homeworksRaw = (Array.isArray(acts) ? acts : []).map((a) => {
    const isExam = Number(a?.__actype) === 5;
    const isCard = Number(a?.__actype) === 15;
    const isClassroomActivity = Number(a?.__actype) === 14;
    const examId = a?.courseware_id ?? a?.exam_id ?? a?.examId ?? a?.id ?? '';
    const coursewareId = a?.courseware_id;
    const leafId = a?.content?.leaf_id ?? a?.leaf_id ?? '';
    const detailKey = isExam ? `5:${String(a?.course_id || entry.classroomId)}:${String(examId || '')}` : '';
    const cache = detailKey ? window.yktDetailCacheByKey[detailKey] : null;
    return {
      title: a?.title || '雨课堂作业',
      end: getYktActivityDeadline(a),
      type: a?.type,
      done: (a?.view && a?.view?.done) !== undefined ? !!(a?.view && a?.view?.done) : undefined,
      unfinished: a?.unfinished,
      progress: a?.progress,
      problem_count: a?.problem_count,
      score: a?.score,
      total_score: a?.total_score,
      attend_status: a?.attend_status,
      is_finished: a?.is_finished,
      create_time: a?.create_time,
      link: isExam
        ? yktExamLink(a?.course_id || entry.classroomId, coursewareId)
        : (isClassroomActivity
            ? yktClassroomReportLink(entry.classroomId, coursewareId, a?.id)
            : (isCard && String(leafId || '').trim()
            ? yktVideoStudentLink(entry.classroomId, leafId)
            : yktHomeworkLink(entry.classroomId, coursewareId, a?.id))),
      courseware_id: coursewareId,
      leaf_id: leafId,
      video_total_done: undefined,
      video_progress_ratio: undefined,
      video_progress_loading: isCard && !!String(coursewareId || '').trim(),
      id: a?.id,
      exam_id: examId,
      __actype: a?.__actype,
      exam_problems: Array.isArray(cache?.exam_problems) ? cache.exam_problems : [],
      exam_detail_state: cache?.state === 'done' ? 'done' : (cache?.state === 'failed' ? 'failed' : ''),
      detail_cache_key: detailKey,
      course_id: a?.course_id || entry.classroomId,
      classroom_id: entry.classroomId
    };
  });
  const seen = new Set();
  return homeworksRaw.filter((homework) => {
    const key = `${homework.classroom_id}-${homework.courseware_id}-${homework.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadYktCoursesAndHomework(courses, loadVersion = 0) {
  const isStale = () => (
    !isPlatformEnabled('ykt')
    || !!(loadVersion && loadVersion !== (window.platformLoadVersion?.ykt || 0))
  );
  if (isStale()) return;
  if (!isPlatformEnabled('ykt')) {
    clearPlatformData('ykt');
    window.yktHomeworkLoadingByCourse = {};
    window.yktHomeworkPendingTypesByCourse = {};
    rerenderAllHomeworkAreas();
    return;
  }
  setPlatformLoginState('ykt', 'checking');
  ensureYktSection();
  const strictMatchMap = new Map();

  let listResp;
  try {
    listResp = await fetchYktJson(YKT_COURSE_LIST_API);
  } catch {
    if (isStale()) return;
    renderYktNeedLoginMessage();
    return;
  }

  if (isStale()) return;
  if (Number(listResp?.errcode) !== 0) {
    window.platformLoadedOnce.ykt = true;
    renderYktNeedLoginMessage();
    return;
  }

  window.yktMatchedHomeworkByCourseId = {};
  window.yktStandaloneCourses = [];
  window.yktMatchedCourseLinkByCourseId = {};
  window.yktCourseGroupsSnapshot = [];
  window.yktHomeworkLoadingByCourse = {};
  window.yktHomeworkPendingTypesByCourse = {};

  setPlatformLoginState('ykt', 'online');
  window.platformLoadedOnce.ykt = true;
  removeYktLoginSection();

  const yktCourses = listResp?.data?.list || [];
  const requestedActypes = [
    ...(window.showYktClassroomActivities ? [14] : []),
    15,
    5,
    ...(window.showYktAnnouncements ? [9] : [])
  ];
  const openTabUniversityId = await getYktUniversityIdFromOpenTabs();
  const entries = [];
  const boundCourseIds = new Set();

  for (const item of yktCourses) {
    const classroomId = item?.classroom_id;
    if (!classroomId) continue;
    const name = String(item?.name || '');
    const courseName = String(item?.course?.name || item?.name || '').trim();
    const strictToken = normalizeTail10Token(item?.university_course_series_id || '');
    const matched = strictToken ? strictMatchMap.get(strictToken) : null;
    const boundCourseId = matched?.courseId ? String(matched.courseId) : '';

    const entry = {
      item,
      classroomId: String(classroomId),
      universityId: pickYktUniversityId(item, listResp?.data) || openTabUniversityId,
      platformId: String(item?.platform_id ?? item?.platformId ?? '3'),
      boundCourseId,
      name,
      courseName,
      strictToken,
      homeworks: []
    };
    entries.push(entry);

    window.yktCourseGroupsSnapshot.push({
      token: strictToken || '',
      strictToken,
      name,
      teacher_name: item?.teacher?.name || '',
      classroom_id: item?.classroom_id,
      course_name: courseName || '雨课堂课程',
      homeworks: []
    });

    if (boundCourseId) {
      if (!window.yktMatchedHomeworkByCourseId[boundCourseId]) window.yktMatchedHomeworkByCourseId[boundCourseId] = [];
      window.yktMatchedCourseLinkByCourseId[boundCourseId] = yktCourseLink(item?.classroom_id);
      window.yktHomeworkLoadingByCourse[boundCourseId] = true;
      window.yktHomeworkPendingTypesByCourse[boundCourseId] = requestedActypes.map((actype) => YKT_ACTIVITY_TYPE_LABELS[actype]);
      boundCourseIds.add(boundCourseId);
    } else {
      const sid = `ykt-${String(classroomId)}`;
      window.yktHomeworkLoadingByCourse[sid] = true;
      window.yktHomeworkPendingTypesByCourse[sid] = requestedActypes.map((actype) => YKT_ACTIVITY_TYPE_LABELS[actype]);
      window.yktStandaloneCourses.push({
        name,
        teacher_name: item?.teacher?.name || '',
        classroom_id: item?.classroom_id,
        course_name: item?.course?.name || item?.name || '雨课堂课程',
        homeworks: []
      });
    }
  }

  boundCourseIds.forEach((cid) => renderHomeworkList(cid));
  renderYktStandaloneCourses();
  let completedCourseLoads = 0;
  setPlatformContentLoadProgress('ykt', 0, entries.length);
  const detailQueue = [];
  let yktExamSharedTabId = null;
  let yktExamSharedTabCreated = false;
  let yktExamSharedTabPromise = null;
  const ensureYktExamSharedTab = async () => {
    if (isStale() || !isPlatformEnabled('ykt')) return null;
    if (yktExamSharedTabPromise) return yktExamSharedTabPromise;
    yktExamSharedTabPromise = (async () => {
      if (isStale() || !isPlatformEnabled('ykt')) return null;
      if (yktExamSharedTabId) {
        const current = await chrome.tabs.get(yktExamSharedTabId).catch(() => null);
        if (current?.id) return yktExamSharedTabId;
        yktExamSharedTabId = null;
        yktExamSharedTabCreated = false;
      }
      const existingTabs = await chrome.tabs.query({ url: [`${YKT_BASE}/*`] }).catch(() => []);
      if (isStale() || !isPlatformEnabled('ykt')) return null;
      let tab = (existingTabs || []).find((item) => item?.id && item.status === 'complete' && item.active === false);
      yktExamSharedTabCreated = false;
      if (!tab) {
        tab = await chrome.tabs.create({ url: YKT_REQUEST_PAGE_URL, active: false });
        void groupBjtuOpenedTab(tab?.id);
        yktExamSharedTabCreated = true;
      }
      if (isStale() || !isPlatformEnabled('ykt')) {
        if (yktExamSharedTabCreated && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
        return null;
      }
      yktExamSharedTabId = Number(tab?.id || 0) || null;
      return yktExamSharedTabId;
    })().finally(() => { yktExamSharedTabPromise = null; });
    return yktExamSharedTabPromise;
  };

  const getCurrentBoundCourseId = (entry) => String(entry?.boundCourseId || '');

  const rerenderEntryCard = (entry) => {
    if (isStale()) return;
    const boundCourseId = getCurrentBoundCourseId(entry);
    if (boundCourseId) {
      renderHomeworkList(boundCourseId);
    } else {
      renderHomeworkList(`ykt-${entry.classroomId}`);
    }
  };
  const courseTasks = entries.map(async (entry, idx) => {
    if (isStale()) return;
    const acts = [];
    const updateIncrementalResult = (actype) => {
      entry.homeworks = buildYktEntryHomeworks(entry, acts);
      const snap = window.yktCourseGroupsSnapshot[idx];
      if (snap) snap.homeworks = entry.homeworks;
      const standaloneId = `ykt-${entry.classroomId}`;
      const remaining = window.yktHomeworkPendingTypesByCourse[standaloneId]
        || requestedActypes.map((item) => YKT_ACTIVITY_TYPE_LABELS[item]);
      const displayIds = [standaloneId, entry.boundCourseId, getCurrentBoundCourseId(entry)].filter(Boolean);
      displayIds.forEach((courseId) => {
        window.yktHomeworkPendingTypesByCourse[courseId] = (window.yktHomeworkPendingTypesByCourse[courseId] || remaining)
          .filter((label) => label !== YKT_ACTIVITY_TYPE_LABELS[actype]);
      });
      rematchExternalByVeCourses('ykt');
      rerenderAllHomeworkAreas();
      renderYktStandaloneCourses();
    };
    await Promise.allSettled(requestedActypes.map(async (actype) => {
      try {
        const url = `${YKT_BASE}/v2/api/web/logs/learn/${encodeURIComponent(String(entry.classroomId))}?actype=${actype}&page=0&offset=100`;
        const response = await fetchYktJson(url);
        if (isStale()) return;
        const hasExplicitError = (response?.errcode !== undefined && Number(response.errcode) !== 0)
          || response?.success === false;
        if (!hasExplicitError && Array.isArray(response?.data?.activities)) {
          acts.push(...response.data.activities.map((activity) => ({ ...activity, __actype: actype })));
        }
      } finally {
        if (!isStale()) updateIncrementalResult(actype);
      }
    }));
    if (isStale()) return;

    const actype15CoursewareIds = acts
      .filter((a) => Number(a?.__actype) === 15)
      .map((a) => a?.courseware_id)
      .filter((id) => String(id || '').trim());
    const progressCid = String(entry.classroomId || '').trim();
    const coursewareProgressPromise = actype15CoursewareIds.length ? (async () => {
      try {
        let requestTabId = await ensureYktExamSharedTab();
        if (isStale() || !isPlatformEnabled('ykt')) return {};
        try {
          return await fetchYktCoursewareProgress(
            progressCid,
            actype15CoursewareIds,
            requestTabId,
            entry.universityId,
            entry.platformId
          );
        } catch (error) {
          const requestTab = requestTabId ? await chrome.tabs.get(requestTabId).catch(() => null) : null;
          if (!requestTab?.id) {
            if (isStale() || !isPlatformEnabled('ykt')) return {};
            yktExamSharedTabId = null;
            requestTabId = await ensureYktExamSharedTab();
            if (isStale() || !isPlatformEnabled('ykt')) return {};
            return await fetchYktCoursewareProgress(
              progressCid,
              actype15CoursewareIds,
              requestTabId,
              entry.universityId,
              entry.platformId
            );
          } else {
            throw error;
          }
        }
      } catch (error) {
        console.warn('[bjtu] ykt pub_new_pro failed:', String(error?.message || error));
        return {};
      }
    })() : Promise.resolve({});

    const homeworks = buildYktEntryHomeworks(entry, acts);

    entry.homeworks = homeworks;
    const snap = window.yktCourseGroupsSnapshot[idx];
    if (snap) snap.homeworks = homeworks;

    window.yktHomeworkLoadingByCourse[`ykt-${entry.classroomId}`] = false;
    if (entry.boundCourseId) window.yktHomeworkLoadingByCourse[entry.boundCourseId] = false;
    const currentBound = getCurrentBoundCourseId(entry);
    if (currentBound) window.yktHomeworkLoadingByCourse[currentBound] = false;

    rematchExternalByVeCourses('ykt');
    rerenderAllHomeworkAreas();
    renderYktStandaloneCourses();

    const coursewareProgress = await coursewareProgressPromise;
    homeworks.forEach((hw) => {
      if (Number(hw?.__actype) !== 15) return;
      const videoProgress = normalizeYktVideoProgress(
        coursewareProgress?.[String(hw?.courseware_id || '')],
        hw?.leaf_id
      );
      hw.video_progress_loading = false;
      hw.video_total_done = videoProgress ? videoProgress.totalDone : undefined;
      hw.video_progress_ratio = videoProgress ? videoProgress.ratio : undefined;
    });
    if (actype15CoursewareIds.length && !isStale()) {
      rematchExternalByVeCourses('ykt');
      rerenderAllHomeworkAreas();
      renderYktStandaloneCourses();
    }

    let queuedChanged = false;
    homeworks.forEach((hw) => {
      const actype = Number(hw?.__actype);
      if (actype !== 5 || !String(hw?.exam_id || '').trim()) return;
      const displayCourseId = getCurrentBoundCourseId(entry) || entry.boundCourseId || `ykt-${entry.classroomId}`;
      const detailGroupAlreadyOpen = isYktHomeworkDone(hw)
        ? !!window.courseShowDoneById?.[displayCourseId]
        : (isYktHomeworkOverdue(hw) ? !!window.courseShowOverdueById?.[displayCourseId] : false);
      if (!window.autoLoadAllHomeworkDetails && !isYktHomeworkPending(hw) && !detailGroupAlreadyOpen) {
        if (!hw.exam_detail_state) hw.exam_detail_state = 'deferred';
        return;
      }
      if (!hw.exam_detail_state) {
        hw.exam_detail_state = 'queued';
        queuedChanged = true;
      }
      detailQueue.push({ entry, hw });
    });
    if (queuedChanged) rerenderEntryCard(entry);
  });

  const trackedCourseTasks = courseTasks.map((task) => task.finally(() => {
    if (isStale()) return;
    completedCourseLoads += 1;
    setPlatformContentLoadProgress('ykt', completedCourseLoads, entries.length);
  }));
  await Promise.allSettled(trackedCourseTasks);
  if (detailQueue.length) await new Promise((resolve) => setTimeout(resolve, 80));

  for (const task of detailQueue) {
    if (isStale()) {
      if (yktExamSharedTabCreated && yktExamSharedTabId) {
        try { await chrome.tabs.remove(yktExamSharedTabId); } catch { /* ignore */ }
        yktExamSharedTabId = null;
      }
      return;
    }
    const { entry, hw } = task;
    const actype = Number(hw?.__actype);
    const detailKey = String(hw?.detail_cache_key || '').trim();
    const cache = detailKey ? window.yktDetailCacheByKey[detailKey] : null;

    if (cache?.state === 'done') {
      if (cache.title) hw.title = cache.title;
      hw.exam_problems = Array.isArray(cache.exam_problems) ? cache.exam_problems : [];
      hw.exam_detail_state = 'done';
      rerenderEntryCard(entry);
      continue;
    }

    if (cache?.state === 'loading' && cache?.promise) {
      hw.exam_detail_state = 'loading';
      await cache.promise.catch(() => {});
      const latest = window.yktDetailCacheByKey[detailKey] || {};
      if (latest.title) hw.title = latest.title;
      hw.exam_problems = Array.isArray(latest.exam_problems) ? latest.exam_problems : [];
      hw.exam_detail_state = latest.state === 'done' ? 'done' : 'failed';
      rerenderEntryCard(entry);
      continue;
    }

    hw.exam_detail_state = 'loading';
    rerenderEntryCard(entry);

    try {
      if (detailKey) {
        window.yktDetailCacheByKey[detailKey] = {
          ...(window.yktDetailCacheByKey[detailKey] || {}),
          state: 'loading',
          title: hw.title,
          exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : []
        };
      }

      const tabId = await ensureYktExamSharedTab();
      if (isStale() || !isPlatformEnabled('ykt')) return;
      let p = fetchYktExamPaper(hw?.course_id || entry.classroomId, hw?.exam_id || '', tabId);
      if (detailKey) window.yktDetailCacheByKey[detailKey].promise = p;
      let examPaper = await p;
      if (!isStale() && isPlatformEnabled('ykt') && !examPaper && tabId && !(await chrome.tabs.get(tabId).catch(() => null))) {
        yktExamSharedTabId = null;
        const retryTabId = await ensureYktExamSharedTab();
        if (isStale() || !isPlatformEnabled('ykt')) return;
        p = fetchYktExamPaper(hw?.course_id || entry.classroomId, hw?.exam_id || '', retryTabId);
        if (detailKey) window.yktDetailCacheByKey[detailKey].promise = p;
        examPaper = await p;
      }
      if (examPaper?.title) hw.title = examPaper.title;
      hw.exam_problems = Array.isArray(examPaper?.problems) ? examPaper.problems : [];

      hw.exam_detail_state = 'done';
      if (detailKey) {
        window.yktDetailCacheByKey[detailKey] = {
          ...(window.yktDetailCacheByKey[detailKey] || {}),
          state: 'done',
          title: hw.title,
          exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : [],
          promise: null
        };
      }
    } catch {
      hw.exam_detail_state = 'failed';
      if (detailKey) {
        window.yktDetailCacheByKey[detailKey] = {
          ...(window.yktDetailCacheByKey[detailKey] || {}),
          state: 'failed',
          promise: null
        };
      }
    }

    rerenderEntryCard(entry);
  }

  if (yktExamSharedTabCreated && yktExamSharedTabId) {
    try { await chrome.tabs.remove(yktExamSharedTabId); } catch { /* ignore */ }
  }
}

function scheduleYktLoad(courses, loadVersion = 0) {
  if (!isPlatformEnabled('ykt')) return Promise.resolve();
  const list = Array.isArray(courses) ? courses : [];
  if (!window.__yktLoadSerialPromise) window.__yktLoadSerialPromise = Promise.resolve();
  window.__yktLoadSerialPromise = window.__yktLoadSerialPromise
    .catch(() => {})
    .then(() => loadYktCoursesAndHomework(list, loadVersion));
  return window.__yktLoadSerialPromise;
}

// 供 qwen 模块（service worker）经 app 页面消息桥调用的雨课堂接口
async function waitYktPageDataReady(timeoutMs = 120000) {
  if (String(window.platformLoginState?.ykt || '') !== 'online') return false;
  if (typeof window.waitForPlatformDataReady === 'function') {
    const ready = await window.waitForPlatformDataReady('ykt', timeoutMs);
    if (!ready) return false;
  }
  const pending = window.__yktLoadSerialPromise;
  if (pending && typeof pending.then === 'function') await pending.catch(() => {});
  return String(window.platformLoginState?.ykt || '') === 'online';
}

async function yktPageCourseList() {
  if (String(window.platformLoginState?.ykt || '') === 'online') await waitYktPageDataReady();
  const listResp = await fetchYktJson(YKT_COURSE_LIST_API);
  if (Number(listResp?.errcode) !== 0) {
    return { ok: false, loggedIn: false, courses: [], message: '未登录或会话已失效' };
  }
  const yktCourses = Array.isArray(listResp?.data?.list) ? listResp.data.list : [];
  const courses = yktCourses
    .map((item) => ({
      classroomId: String(item?.classroom_id || '').trim(),
      name: String(item?.name || '').trim(),
      courseName: String(item?.course?.name || item?.name || '').trim(),
      teacher: String(item?.teacher?.name || '').trim(),
      universityId: pickYktUniversityId(item, listResp?.data) || ''
    }))
    .filter((course) => course.classroomId);
  return { ok: true, loggedIn: true, courses };
}

function stripYktLeafId(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[循环引用]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => stripYktLeafId(item, seen));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'leaf_id' || key === 'leafId') continue;
    output[key] = stripYktLeafId(child, seen);
  }
  return output;
}

function yktHomeworkForPageApi(homework) {
  const source = homework && typeof homework === 'object' ? homework : {};
  const output = stripYktLeafId(source);
  output.done = isYktHomeworkDone(source);
  output.overdue = isYktHomeworkOverdue(source);
  if (Number(source?.__actype ?? source?.actype) === 15) {
    const rawRatio = source?.video_progress_ratio;
    let ratio = rawRatio === null || rawRatio === undefined ? NaN : Number(rawRatio);
    if (!Number.isFinite(ratio)) {
      const totalDone = Number(source?.video_total_done);
      ratio = totalDone === 1 ? 1 : 0;
    }
    output.progress = Math.max(0, Math.min(1, ratio));
    delete output.video_progress_ratio;
    delete output.video_total_done;
    delete output.video_progress_loading;
  }
  return output;
}

async function yktPageCourseHomework(classroomId) {
  const cid = String(classroomId || '').trim();
  if (!cid) return { ok: false, classroomId: '', homework: [], message: '缺少 classroomId' };
  if (String(window.platformLoginState?.ykt || '') === 'online') {
    const ready = await waitYktPageDataReady();
    if (!ready) return { ok: false, loggedIn: false, classroomId: cid, homework: [], message: '雨课堂未登录或数据未加载完毕' };
    const snapshot = (Array.isArray(window.yktCourseGroupsSnapshot) ? window.yktCourseGroupsSnapshot : [])
      .find((course) => String(course?.classroom_id || '') === cid);
    if (snapshot) {
      return {
        ok: true,
        loggedIn: true,
        ready: true,
        classroomId: cid,
        homework: (Array.isArray(snapshot.homeworks) ? snapshot.homeworks : []).map(yktHomeworkForPageApi)
      };
    }
  }
  const actypes = [14, 15, 5, 9];
  const urls = actypes.map((actype) => `${YKT_BASE}/v2/api/web/logs/learn/${encodeURIComponent(cid)}?actype=${actype}&page=0&offset=100`);
  const settled = await Promise.allSettled(urls.map((url) => fetchYktJson(url)));
  const acts = [];
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const lr = result.value;
    const hasError = (lr?.errcode !== undefined && Number(lr.errcode) !== 0) || lr?.success === false;
    if (!hasError && Array.isArray(lr?.data?.activities)) {
      acts.push(...lr.data.activities.map((a) => ({ ...a, __actype: actypes[index] })));
    }
  });
  const homework = acts.map((a) => {
    const isExam = Number(a?.__actype) === 5;
    const isCard = Number(a?.__actype) === 15;
    const isClassroomActivity = Number(a?.__actype) === 14;
    const examId = a?.courseware_id ?? a?.exam_id ?? a?.examId ?? a?.id ?? '';
    const coursewareId = a?.courseware_id;
    const leafId = a?.content?.leaf_id ?? a?.leaf_id ?? '';
    return {
      ...a,
      __actype: Number(a?.__actype),
      id: a?.id,
      title: a?.title || '雨课堂作业',
      end: getYktActivityDeadline(a),
      type: a?.type,
      actype: Number(a?.__actype),
      activityType: YKT_ACTIVITY_TYPE_LABELS[Number(a?.__actype)] || '',
      done: (a?.view && a?.view?.done) !== undefined ? !!(a?.view && a?.view?.done) : undefined,
      unfinished: a?.unfinished,
      progress: a?.progress,
      problem_count: a?.problem_count,
      score: a?.score,
      total_score: a?.total_score,
      attend_status: a?.attend_status,
      is_finished: a?.is_finished,
      create_time: a?.create_time,
      link: isExam
        ? yktExamLink(a?.course_id || cid, coursewareId)
        : (isClassroomActivity
            ? yktClassroomReportLink(cid, coursewareId, a?.id)
            : (isCard && String(leafId || '').trim()
            ? yktVideoStudentLink(cid, leafId)
            : yktHomeworkLink(cid, coursewareId, a?.id))),
      courseware_id: coursewareId,
      leaf_id: leafId,
      classroom_id: cid,
      detail_content: a?.content ?? null,
      view: a?.view ?? null
    };
  });
  const videoCoursewareIds = homework
    .filter((item) => Number(item?.__actype) === 15)
    .map((item) => item?.courseware_id)
    .filter((id) => String(id || '').trim());
  if (videoCoursewareIds.length) {
    try {
      const listResp = await fetchYktJson(YKT_COURSE_LIST_API);
      const courses = Array.isArray(listResp?.data?.list) ? listResp.data.list : [];
      const course = courses.find((item) => String(item?.classroom_id || '') === cid);
      const requestTabId = await ensureYktExamSharedTab();
      const progressMap = await fetchYktCoursewareProgress(
        cid,
        videoCoursewareIds,
        requestTabId,
        pickYktUniversityId(course, listResp?.data),
        String(course?.platform_id ?? course?.platformId ?? '3')
      );
      homework.forEach((item) => {
        if (Number(item?.__actype) !== 15) return;
        const progress = normalizeYktVideoProgress(
          progressMap?.[String(item?.courseware_id || '')],
          item?.leaf_id
        );
        item.video_total_done = progress?.totalDone;
        item.video_progress_ratio = progress?.ratio;
      });
    } catch (error) {
      console.warn('[bjtu] ykt page api progress failed:', String(error?.message || error));
    }
  }
  const successfulResponses = settled.filter((result) => result.status === 'fulfilled'
    && !((result.value?.errcode !== undefined && Number(result.value.errcode) !== 0) || result.value?.success === false));
  if (!successfulResponses.length) {
    return { ok: false, loggedIn: false, classroomId: cid, homework: [], message: '雨课堂未登录或会话已失效' };
  }
  return {
    ok: true,
    loggedIn: true,
    classroomId: cid,
    homework: homework.map(yktHomeworkForPageApi)
  };
}

async function yktPageAssignmentSnapshot() {
  if (typeof globalThis.isPlatformEnabled === 'function' && !globalThis.isPlatformEnabled('ykt')) {
    throw Object.assign(new Error('雨课堂未启用，请先调用 ykt.login()'), { code: 'LOGIN_REQUIRED' });
  }
  if (String(window.platformLoginState?.ykt || '') !== 'online') {
    throw Object.assign(new Error('雨课堂未登录，请先调用 ykt.login()'), { code: 'LOGIN_REQUIRED' });
  }
  const ready = await waitYktPageDataReady();
  if (!ready) throw Object.assign(new Error('雨课堂数据尚未加载完毕，请先调用 ykt.login()'), { code: 'LOGIN_REQUIRED' });
  return {
    courses: (Array.isArray(window.yktCourseGroupsSnapshot) ? window.yktCourseGroupsSnapshot : []).map((course) => ({
      classroomId: String(course?.classroom_id || '').trim(),
      courseName: String(course?.course_name || course?.name || '').trim(),
      teacher: String(course?.teacher_name || '').trim(),
      homework: (Array.isArray(course?.homeworks) ? course.homeworks : []).map(yktHomeworkForPageApi)
    }))
  };
}

async function yktPageLogin(args = {}) {
  const platform = 'ykt';
  const enabled = typeof isPlatformEnabled === 'function' ? isPlatformEnabled(platform) : true;
  if (enabled) {
    return globalThis.getEnabledPlatformLoginResult(platform);
  } else if (typeof togglePlatformSelection === 'function') {
    try { togglePlatformSelection(platform, { interactive: true }); } catch {}
  }
  return await waitForPlatformLoginResult(platform, Number(args?.timeoutMs) || 120000);
}

globalThis.BjtuYktPageApi = Object.freeze({
  courseList: () => yktPageCourseList(),
  courseHomework: (args) => yktPageCourseHomework(String(args?.classroomId || '').trim()),
  assignmentSnapshot: () => yktPageAssignmentSnapshot(),
  login: (args) => yktPageLogin(args)
});

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'PAGE_API' || message?.payload?.module !== 'ykt') return false;
    const api = globalThis.BjtuYktPageApi;
    const fn = api && typeof api[String(message.payload?.fn || '')] === 'function' ? api[String(message.payload.fn)] : null;
    if (!fn) {
      sendResponse({ ok: false, error: '雨课堂页面接口不存在' });
      return true;
    }
    Promise.resolve(fn(message.payload?.args || {})).then(
      (value) => sendResponse({ ok: true, value }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error) })
    );
    return true;
  });
}
