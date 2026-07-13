const YKT_LOGIN_LINK_HTML = '<a href="https://www.yuketang.cn/web" target="_blank" rel="noopener noreferrer" style="color:#5096f5; text-decoration:none; font-weight:600;">雨课堂</a>';
const YKT_LOGIN_REQUIRED_HTML = `如需查看${YKT_LOGIN_LINK_HTML}作业，请前往登录`;
const YKT_BASE = 'https://www.yuketang.cn';
const YKT_EXAM_BASE = 'https://examination.xuetangx.com';
const YKT_COURSE_LIST_API = `${YKT_BASE}/v2/api/web/courses/list?identity=2`;
const YKT_HEADERS = {
  'uv-id': '0',
  'xt-agent': 'web',
  xtbz: 'ykt',
  Accept: 'application/json, text/plain, */*'
};
const YKT_WECHAT_QR_LOGIN_URL = 'https://open.weixin.qq.com/connect/qrconnect?appid=wxda8c70bb118d342b&scope=snsapi_login&redirect_uri=https://www.yuketang.cn/api/v3/user/login/wechat-web-callback';
const YKT_WECHAT_LOGIN_SUCCESS_URL_PREFIX = 'https://www.yuketang.cn/authorize/wx-qrlogin?success=1';
let yktLoginAssistRetryTimer = null;
let yktLoginAssistPollTimer = null;
let yktLoginAssistChecking = false;
let yktLoginAssistPopupWindowId = null;
let yktLoginAssistPopupTabId = null;
let yktLoginIframeLoadCount = 0;
let yktLoginIframeOpenedAt = 0;

// Platform-specific functions extracted from app.js. Shared helpers remain global.

function isYktHomeworkDone(hw) {
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
  return !isYktHomeworkDone(hw) && !isDeadlinePassed(hw?.end);
}

function isYktHomeworkOverdue(hw) {
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

function scheduleYktLoginAssistRecheck(delayMs = 500) {
  if (yktLoginAssistRetryTimer) {
    clearTimeout(yktLoginAssistRetryTimer);
    yktLoginAssistRetryTimer = null;
  }
  yktLoginAssistRetryTimer = setTimeout(() => {
    yktLoginAssistRetryTimer = null;
    if (!window.platformInteractiveLoginPending?.ykt && !isPlatformEnabled('ykt')) return;
    completeExternalLoginAssist('ykt', true);
  }, Math.max(120, Number(delayMs) || 500));
}

function stopYktLoginAssistWatcher() {
  if (yktLoginAssistPollTimer) {
    clearInterval(yktLoginAssistPollTimer);
    yktLoginAssistPollTimer = null;
  }
  yktLoginAssistChecking = false;
}

function isYktLoginSuccessUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  return u.startsWith(YKT_WECHAT_LOGIN_SUCCESS_URL_PREFIX);
}

async function checkYktLoginAssistPopupUrl() {
  if (!window.platformInteractiveLoginPending?.ykt) return false;
  if (!yktLoginAssistPopupTabId) return false;
  try {
    const tab = await chrome.tabs.get(Number(yktLoginAssistPopupTabId));
    const currentUrl = String(tab?.url || '').trim();
    if (isYktLoginSuccessUrl(currentUrl)) {
      closeYktLoginAssistPopup(false);
      scheduleYktLoginAssistRecheck(250);
      return true;
    }
  } catch {
    // popup may be closed by user
    yktLoginAssistPopupWindowId = null;
    yktLoginAssistPopupTabId = null;
    window.platformInteractiveLoginPending.ykt = false;
    stopYktLoginAssistWatcher();
  }
  return false;
}

async function checkYktLoginAssistStatus() {
  if (yktLoginAssistChecking) return false;
  if (!isPlatformEnabled('ykt') && !window.platformInteractiveLoginPending?.ykt) return false;
  if (!window.platformInteractiveLoginPending?.ykt) return false;
  yktLoginAssistChecking = true;
  try {
    const resp = await fetchYktJson(YKT_COURSE_LIST_API);
    const ok = Number(resp?.errcode) === 0;
    if (ok) {
      closeYktLoginAssistPopup(false);
      scheduleYktLoginAssistRecheck(300);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    yktLoginAssistChecking = false;
  }
}

function startYktLoginAssistWatcher() {
  stopYktLoginAssistWatcher();
  yktLoginAssistPollTimer = setInterval(() => {
    void checkYktLoginAssistStatus();
    void checkYktLoginAssistPopupUrl();
  }, PLATFORM_LOGIN_ASSIST_POLL_INTERVAL_MS);
  void checkYktLoginAssistStatus();
  void checkYktLoginAssistPopupUrl();
}

function closeYktLoginAssistPopup(cancelPending = false) {
  const mask = document.getElementById('ykt-login-assist-mask');
  if (mask instanceof HTMLElement) {
    mask.style.display = 'none';
  }
  if (yktLoginAssistPopupWindowId) {
    chrome.windows.remove(Number(yktLoginAssistPopupWindowId)).catch(() => {});
  }
  yktLoginAssistPopupWindowId = null;
  yktLoginAssistPopupTabId = null;
  stopYktLoginAssistWatcher();
  if (cancelPending) {
    window.platformInteractiveLoginPending.ykt = false;
  }
}

function ensureYktLoginAssistPopup() {
  let mask = document.getElementById('ykt-login-assist-mask');
  if (mask instanceof HTMLElement) return mask;

  mask = document.createElement('div');
  mask.id = 'ykt-login-assist-mask';
  mask.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:1200',
    'background:rgba(15,23,42,0.45)',
    'align-items:center',
    'justify-content:center',
    'padding:12px'
  ].join(';');
  mask.innerHTML = `
    <div style="width:min(360px, 92vw); max-height:min(88vh, 560px); background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 14px 36px rgba(15,23,42,0.3); display:flex; flex-direction:column;">
      <div style="height:44px; display:flex; align-items:center; justify-content:space-between; padding:0 12px; border-bottom:1px solid #e5e7eb;">
        <div style="font-size:14px; font-weight:700; color:#0f172a;">登录雨课堂</div>
        <button type="button" data-action="close-ykt-login-assist" class="modal-close-btn" style="position:static; flex-shrink:0;" aria-label="关闭" title="关闭">×</button>
      </div>
      <div style="flex:1; padding:8px; background:#f8fafc;">
        <iframe id="ykt-login-assist-frame" title="登录雨课堂" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" style="width:100%; height:100%; border:0; border-radius:8px; background:#fff;"></iframe>
      </div>
    </div>
  `;
  document.body.appendChild(mask);

  const closeBtn = mask.querySelector('button[data-action="close-ykt-login-assist"]');
  if (closeBtn instanceof HTMLButtonElement) {
    closeBtn.addEventListener('click', () => closeYktLoginAssistPopup(true));
  }
  mask.addEventListener('mousedown', (e) => {
    mask.dataset.mdownMask = e.target === mask ? '1' : '0';
  });
  mask.addEventListener('mouseup', (e) => {
    if (e.target === mask && mask.dataset.mdownMask === '1') {
      closeYktLoginAssistPopup(true);
    }
    delete mask.dataset.mdownMask;
  });

  const frame = mask.querySelector('#ykt-login-assist-frame');
  if (frame instanceof HTMLIFrameElement) {
    frame.addEventListener('load', () => {
      if (mask.style.display === 'none') return;
      yktLoginIframeLoadCount += 1;
      void checkYktLoginAssistStatus();
    });
  }

  return mask;
}

function openYktLoginAssistPopup(force = false) {
  if (!force && !isPlatformEnabled('ykt')) return;
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
    yktLoginIframeLoadCount = 0;
    yktLoginIframeOpenedAt = Date.now();
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
  setPlatformLoginState('ykt', 'offline');

  if (shouldOpenAssist) {
    openYktLoginAssistPopup(true);
    return;
  }

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

function renderYktExamProblemsHtml(problemList, done) {
  const list = Array.isArray(problemList) ? problemList : [];
  if (!list.length) return '';
  const baseBg = done ? 'rgba(220,252,231,0.52)' : 'rgba(255,237,213,0.52)';
  const borderColor = done ? 'rgba(22,163,74,0.32)' : 'rgba(234,88,12,0.32)';
  const typeColor = done ? '#166534' : '#9a3412';
  const textColor = done ? '#14532d' : '#7c2d12';
  return list.map((p, i) => {
    const typeText = String(p?.TypeText || p?.Type || '题目类型').trim();
    const bodyHtml = normalizeHomeworkContent(String(p?.Body || '').trim()) || '<span style="color:#999;">无题目内容</span>';
    return `
      <div style="padding:4px 6px; border:1px solid ${borderColor}; border-radius:5px; margin-top:4px; background:${baseBg};">
        <div style="font-size:12px; color:${typeColor}; font-weight:bold; line-height:1.35;">${i + 1}. ${escapeHtml(typeText)}</div>
        <div style="font-size:12px; color:${textColor}; margin-top:2px; line-height:1.4;">${bodyHtml}</div>
      </div>
    `;
  }).join('');
}

async function fetchYktCardDetList(cardId, classroomId) {
  const cid = String(cardId || '').trim();
  const classId = String(classroomId || '').trim();
  if (!cid || !classId) return null;
  const url = `${YKT_BASE}/v2/api/web/cards/detlist/${encodeURIComponent(cid)}?classroom_id=${encodeURIComponent(classId)}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        ...YKT_HEADERS
      },
      cache: 'no-store'
    });
    if (Number(res.status) === 401 || Number(res.status) === 403) return null;
    const text = await res.text();
    const data = JSON.parse(String(text || '{}'));
    if (Number(data?.errcode) !== 0) return null;
    return Array.isArray(data?.data?.problem_results) ? data.data.problem_results : [];
  } catch {
    return null;
  }
}

async function loadDeferredYktHomeworkDetails(courseId, kind) {
  const cid = String(courseId || '').trim();
  const groupKind = String(kind || '').trim();
  if (!cid || !['done', 'overdue'].includes(groupKind)) return;
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
      if (requestTabId) {
        const current = await chrome.tabs.get(requestTabId).catch(() => null);
        if (current?.id) return requestTabId;
        requestTabId = null;
        requestTabCreated = false;
      }
      const existingTabs = await chrome.tabs.query({ url: [`${YKT_BASE}/*`] }).catch(() => []);
      let tab = (existingTabs || []).find((item) => item?.id && item.status === 'complete' && item.active === false);
      if (!tab) {
        tab = await chrome.tabs.create({ url: `${YKT_BASE}/web`, active: false });
        requestTabCreated = true;
      }
      requestTabId = Number(tab?.id || 0) || null;
      return requestTabId;
    };

    try {
      for (const hw of targets) {
        hw.exam_detail_state = 'loading';
        rerenderAllHomeworkAreas();
        renderYktStandaloneCourses();
        const detailKey = String(hw?.detail_cache_key || '').trim();
        try {
          if (Number(hw?.__actype) === 5) {
            const tabId = await ensureRequestTab();
            let paper = tabId ? await fetchYktExamPaper(hw?.course_id || hw?.classroom_id, hw?.exam_id || '', tabId) : null;
            if (!paper && tabId && !(await chrome.tabs.get(tabId).catch(() => null))) {
              requestTabId = null;
              const retryTabId = await ensureRequestTab();
              paper = retryTabId ? await fetchYktExamPaper(hw?.course_id || hw?.classroom_id, hw?.exam_id || '', retryTabId) : null;
            }
            if (paper?.title) hw.title = paper.title;
            hw.exam_problems = Array.isArray(paper?.problems) ? paper.problems : [];
          } else if (Number(hw?.__actype) === 15) {
            const results = await fetchYktCardDetList(hw?.courseware_id || '', hw?.classroom_id || '');
            hw.problem_results = Array.isArray(results) ? results : [];
          }
          hw.exam_detail_state = 'done';
          if (detailKey) {
            window.yktDetailCacheByKey[detailKey] = {
              state: 'done', title: hw.title,
              exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : [],
              problem_results: Array.isArray(hw.problem_results) ? hw.problem_results : [],
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

function extractYktProblemDetailHtml(problemItem) {
  const lines = [];
  const shapes = Array.isArray(problemItem?.slide?.Shapes) ? problemItem.slide.Shapes : [];
  shapes.forEach((shape) => {
    const paragraphs = Array.isArray(shape?.Paragraphs) ? shape.Paragraphs : [];
    paragraphs.forEach((p) => {
      const ls = Array.isArray(p?.Lines) ? p.Lines : [];
      ls.forEach((l) => {
        const html = String(l?.Html || '').trim();
        if (html) lines.push(html);
      });
    });
  });
  return lines.join('');
}

function renderYktCardProblemResultsHtml(problemResults, done) {
  const list = Array.isArray(problemResults) ? problemResults : [];
  if (!list.length) return '';
  const baseBg = done ? 'rgba(220,252,231,0.52)' : 'rgba(255,237,213,0.52)';
  const borderColor = done ? 'rgba(22,163,74,0.32)' : 'rgba(234,88,12,0.32)';
  const titleColor = done ? '#166534' : '#9a3412';
  const textColor = done ? '#14532d' : '#7c2d12';

  return list.map((it, idx) => {
    const detailRawHtml = extractYktProblemDetailHtml(it);
    const detailHtml = normalizeHomeworkContent(detailRawHtml) || '<span style="color:#999;">无作业详情</span>';
    return `
      <div style="padding:4px 6px; border:1px solid ${borderColor}; border-radius:5px; margin-top:4px; background:${baseBg};">
        <div style="font-size:12px; color:${titleColor}; font-weight:bold; line-height:1.35;">第${idx + 1}题</div>
        <div style="font-size:12px; color:${textColor}; margin-top:2px; line-height:1.4;">${detailHtml}</div>
      </div>
    `;
  }).join('');
}

function renderYktHomeworkItems(courseId, items) {
  const list = items || [];
  if (!list.length) return '';
  return list.map((it, idx) => {
    const done = isYktHomeworkDone(it);
    const overdue = !done && isYktHomeworkOverdue(it);
    const progress = Number(it?.progress ?? 0);
    const problemCount = Number(it?.problem_count ?? 0);
    const progressText = problemCount > 0 ? `${progress}/${problemCount}` : '';
    const hasScore = it?.score !== null && it?.score !== undefined && String(it.score) !== '';
    const totalScoreFromItem = Number(it?.total_score);
    const problemResults = Array.isArray(it?.problem_results) ? it.problem_results : [];
    const sumGot = problemResults.reduce((acc, pr) => {
      const v = Number(pr?.problem_result?.score);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
    const sumFull = problemResults.reduce((acc, pr) => {
      const v = Number(pr?.score);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
    const derivedHasScore = Number(it?.__actype) === 15 && problemResults.length > 0 && (sumFull > 0 || sumGot > 0);
    const scoreText = hasScore
      ? `${it.score}/${it?.total_score ?? ''}`
      : (derivedHasScore
          ? `${sumGot}/${sumFull > 0 ? sumFull : (Number.isFinite(totalScoreFromItem) ? totalScoreFromItem : '')}`
          : '');
    const bgColor = done ? '#e8f5e9' : (overdue ? '#ffebee' : '#fff3e0');
    const borderColor = done ? '#4caf50' : (overdue ? '#ef4444' : '#ff9800');
    const titleColor = done ? '#2e7d32' : (overdue ? '#b91c1c' : '#e65100');
    const detailBtnColor = done ? '#2E7D32' : (overdue ? '#b91c1c' : '#E65100');
    const actionText = done ? '去雨课堂查看' : '去雨课堂提交';
    const statusHtml = done ? '<span class="homework-status-done">(已提交)</span>' : (overdue ? '<span class="homework-status-overdue">(已逾期)</span>' : '');
    const titleScoreBadge = scoreText ? `<span style="font-weight:bold; color:#E91E63; white-space:nowrap;">[${escapeHtml(scoreText)}]</span>` : '';
    const deadline = it?.end || it?.deadline || '';
    const countdownSpan = (!done && !overdue && !Number(it?.__loading) && deadline) ? `<span class="deadline-countdown" data-deadline="${escapeHtml(String(deadline))}" style="margin-left:4px; font-weight:normal; color:#e65100"></span>` : '';
    const yktIdSeed = String(it?.id || it?.courseware_id || it?.classroom_id || idx).trim();
    const expandKey = `ykt:${yktIdSeed}`;
    const expanded = isHomeworkDetailExpanded(courseId, expandKey);
    const actype = Number(it?.__actype);
    const isExam = actype === 5;
    const isCard = actype === 15;
    const examDetail = isExam
      ? renderYktExamProblemsHtml(it?.exam_problems || [], done)
      : (isCard ? renderYktCardProblemResultsHtml(it?.problem_results || [], done) : '');
    let detailStatusHtml = '';
    if ((isExam || isCard) && !examDetail) {
      const state = String(it?.exam_detail_state || '').trim();
      if (state === 'loading') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;"></span>正在获取作业详情…</div>`;
      } else if (state === 'queued') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:${done ? '#166534' : '#9a3412'}; display:flex; align-items:center; gap:6px;"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:${done ? '#16a34a' : '#ea580c'}; border-top-color:transparent;"></span>正在排队等待…</div>`;
      } else if (state === 'failed') {
        detailStatusHtml = `<div style="margin-top:6px; font-size:12px; color:#b45309;">作业详情获取失败，可稍后重试</div>`;
      }
    }
    const detailExpandable = examDetail
      ? renderExpandableHtml(examDetail, {
          emptyHtml: '<span style="color:#999;">无题目内容</span>',
          expandText: '点击查看作业详情',
          collapseText: '点击收起作业详情',
          baseBg: done ? 'rgba(232,245,233,0.75)' : 'rgba(255,243,224,0.78)',
          flatDisplay: true,
          courseId,
          expandKey,
          expanded
        })
      : '';
    return `
    <div class="hw-card-item" data-homework-done="${done ? '1' : '0'}" style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:6px; padding:8px; margin-top:8px;">
      <div style="display:flex; justify-content:space-between; align-items:start; gap:8px;">
        <div>
          <div style="font-weight:bold; color:${titleColor};">${escapeHtml(it.title || '雨课堂作业')}</div>
          <div style="font-size:12px; color:#666;">截止: <span style="font-weight:700; color:#000;">${escapeHtml(formatYktDateTime(it.end))}</span> ${statusHtml}${countdownSpan}</div>
          <div style="font-size:12px; color:#666;">${progressText ? `进度: ${escapeHtml(progressText)}` : ''}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${titleScoreBadge ? `<div style="font-size:12px; line-height:1;">${titleScoreBadge}</div>` : ''}
          <a class="btn" href="${it.link}" target="_blank" rel="noopener noreferrer" style="background:${detailBtnColor}; padding: 2px 6px; font-size: 12px; text-decoration:none; color:#fff;">${actionText}</a>
        </div>
      </div>
      ${detailExpandable ? `<div style="margin-top:3px; border-top:1px dashed ${borderColor}40; padding-top:0;">${detailExpandable}</div>` : ''}
      ${detailStatusHtml}
    </div>
  `;
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
    const card = document.createElement('div');
    card.className = 'file-item ykt-standalone-card';
    card.style.backgroundColor = '#fff';
    card.id = `course-${courseId}`;
    card.dataset.courseId = String(courseId || '');
    card.dataset.courseRankable = '1';
    card.dataset.order = String(baseOrder + idx);
    card.dataset.rank = '7';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${courseLink}" target="_blank" rel="noopener noreferrer" style="color:#5096f5; text-decoration:none; line-height:1.3;">${escapeHtml(c.course_name || c.name || '雨课堂课程')}</a></strong></div>
          <div style="font-size:12px; color:#666; line-height:1.35;">${escapeHtml(subText)}</div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px;">
          <button class="btn" style="background:#9C27B0; display:none;" data-action="videos">回放下载</button>
        </div>
      </div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
        <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
    `;
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

async function loadYktCoursesAndHomework(courses, loadVersion = 0) {
  const isStale = () => !!(loadVersion && loadVersion !== (window.platformLoadVersion?.ykt || 0));
  if (isStale()) return;
  if (!isPlatformEnabled('ykt')) {
    clearPlatformData('ykt');
    window.yktHomeworkLoadingByCourse = {};
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

  setPlatformLoginState('ykt', 'online');
  window.platformLoadedOnce.ykt = true;
  removeYktLoginSection();

  const yktCourses = listResp?.data?.list || [];
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
      boundCourseIds.add(boundCourseId);
    } else {
      const sid = `ykt-${String(classroomId)}`;
      window.yktHomeworkLoadingByCourse[sid] = true;
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
  const detailQueue = [];
  let yktExamSharedTabId = null;
  let yktExamSharedTabCreated = false;
  const ensureYktExamSharedTab = async () => {
    if (yktExamSharedTabId) {
      const current = await chrome.tabs.get(yktExamSharedTabId).catch(() => null);
      if (current?.id) return yktExamSharedTabId;
      yktExamSharedTabId = null;
      yktExamSharedTabCreated = false;
    }
    const existingTabs = await chrome.tabs.query({ url: [`${YKT_BASE}/*`] }).catch(() => []);
    let tab = (existingTabs || []).find((item) => item?.id && item.status === 'complete' && item.active === false);
    yktExamSharedTabCreated = false;
    if (!tab) {
      tab = await chrome.tabs.create({ url: `${YKT_BASE}/web`, active: false });
      yktExamSharedTabCreated = true;
    }
    yktExamSharedTabId = Number(tab?.id || 0) || null;
    return yktExamSharedTabId;
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
    const actypes = [15, 5];
    const urls = actypes.map((actype) => `${YKT_BASE}/v2/api/web/logs/learn/${encodeURIComponent(String(entry.classroomId))}?actype=${actype}&page=0&offset=100`);
    const logSettled = await Promise.allSettled(urls.map((u) => fetchYktJson(u)));
    if (isStale()) return;

    const acts = [];
    logSettled.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const lr = r.value;
      if (Number(lr?.errcode) === 0 && Array.isArray(lr?.data?.activities)) {
        acts.push(...lr.data.activities.map((a) => ({ ...a, __actype: actypes[i] })));
      }
    });

    const homeworksRaw = acts.map((a) => {
      const isExam = Number(a?.__actype) === 5;
      const isCard = Number(a?.__actype) === 15;
      const examId = a?.courseware_id ?? a?.exam_id ?? a?.examId ?? a?.id ?? '';
      const detailKey = isExam
        ? `5:${String(a?.course_id || entry.classroomId)}:${String(examId || '')}`
        : (isCard ? `15:${String(entry.classroomId)}:${String(a?.courseware_id || '')}` : '');
      const cache = detailKey ? window.yktDetailCacheByKey[detailKey] : null;
      const hw = {
        title: a?.title || '雨课堂作业',
        end: getYktActivityDeadline(a),
        type: a?.type,
        done: (a?.view && a?.view?.done) !== undefined ? !!(a?.view && a?.view?.done) : undefined,
        unfinished: a?.unfinished,
        progress: a?.progress,
        problem_count: a?.problem_count,
        score: a?.score,
        total_score: a?.total_score,
        link: isExam
          ? yktExamLink(a?.course_id || entry.classroomId, a?.courseware_id)
          : yktHomeworkLink(entry.classroomId, a?.courseware_id, a?.id),
        courseware_id: a?.courseware_id,
        id: a?.id,
        exam_id: examId,
        __actype: a?.__actype,
        exam_problems: Array.isArray(cache?.exam_problems) ? cache.exam_problems : [],
        problem_results: Array.isArray(cache?.problem_results) ? cache.problem_results : [],
        exam_detail_state: cache?.state === 'done' ? 'done' : (cache?.state === 'failed' ? 'failed' : ''),
        detail_cache_key: detailKey,
        course_id: a?.course_id || entry.classroomId,
        classroom_id: entry.classroomId
      };
      return hw;
    });

    const seen = new Set();
    const homeworks = homeworksRaw.filter((h) => {
      const key = `${h.classroom_id}-${h.courseware_id}-${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    entry.homeworks = homeworks;
    const snap = window.yktCourseGroupsSnapshot[idx];
    if (snap) snap.homeworks = homeworks;

    window.yktHomeworkLoadingByCourse[`ykt-${entry.classroomId}`] = false;
    if (entry.boundCourseId) window.yktHomeworkLoadingByCourse[entry.boundCourseId] = false;
    const currentBound = getCurrentBoundCourseId(entry);
    if (currentBound) window.yktHomeworkLoadingByCourse[currentBound] = false;

    rerenderAllHomeworkAreas();
    renderYktStandaloneCourses();

    let queuedChanged = false;
    homeworks.forEach((hw) => {
      const actype = Number(hw?.__actype);
      if (actype !== 5 && actype !== 15) return;
      if (actype === 5 && !String(hw?.exam_id || '').trim()) return;
      if (actype === 15 && !String(hw?.courseware_id || '').trim()) return;
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

  await Promise.allSettled(courseTasks);
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
      hw.problem_results = Array.isArray(cache.problem_results) ? cache.problem_results : [];
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
      hw.problem_results = Array.isArray(latest.problem_results) ? latest.problem_results : [];
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
          exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : [],
          problem_results: Array.isArray(hw.problem_results) ? hw.problem_results : []
        };
      }

      if (actype === 5) {
        const tabId = await ensureYktExamSharedTab();
        let p = fetchYktExamPaper(hw?.course_id || entry.classroomId, hw?.exam_id || '', tabId);
        if (detailKey) window.yktDetailCacheByKey[detailKey].promise = p;
        let examPaper = await p;
        if (!examPaper && tabId && !(await chrome.tabs.get(tabId).catch(() => null))) {
          yktExamSharedTabId = null;
          const retryTabId = await ensureYktExamSharedTab();
          p = fetchYktExamPaper(hw?.course_id || entry.classroomId, hw?.exam_id || '', retryTabId);
          if (detailKey) window.yktDetailCacheByKey[detailKey].promise = p;
          examPaper = await p;
        }
        if (examPaper?.title) hw.title = examPaper.title;
        hw.exam_problems = Array.isArray(examPaper?.problems) ? examPaper.problems : [];
      } else {
        const p = fetchYktCardDetList(hw?.courseware_id || '', entry.classroomId);
        if (detailKey) window.yktDetailCacheByKey[detailKey].promise = p;
        const problemResults = await p;
        hw.problem_results = Array.isArray(problemResults) ? problemResults : [];
      }

      hw.exam_detail_state = 'done';
      if (detailKey) {
        window.yktDetailCacheByKey[detailKey] = {
          ...(window.yktDetailCacheByKey[detailKey] || {}),
          state: 'done',
          title: hw.title,
          exam_problems: Array.isArray(hw.exam_problems) ? hw.exam_problems : [],
          problem_results: Array.isArray(hw.problem_results) ? hw.problem_results : [],
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
