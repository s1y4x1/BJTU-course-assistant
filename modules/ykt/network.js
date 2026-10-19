function isYktHomeworkDone(hw) {
  const actype = Number(hw?.__actype ?? hw?.actype);
  if (actype === 14) return hw?.attend_status === true;
  if (actype === 5) return Number(hw?.unfinished) === 0;
  if (actype === 15) {
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


const YKT_BASE = 'https://www.yuketang.cn';
const YKT_EXAM_BASE = 'https://examination.xuetangx.com';
const YKT_COURSE_LIST_API = `${YKT_BASE}/v2/api/web/courses/list?identity=2`;
const YKT_HEADER_RULE_ID = 914308;
const YKT_EXAM_HEADER_RULE_ID = 914311;
const YKT_HEADERS = {
  'uv-id': '0',
  'xt-agent': 'web',
  xtbz: 'ykt',
  Accept: 'application/json, text/plain, */*'
};
const YKT_ACTIVITY_TYPE_LABELS = Object.freeze({
  14: '课堂',
  15: '线上学习',
  5: '考试',
  9: '公告'
});

let yktHeaderRulePromise = null;
let yktHeaderRuleReady = false;

async function fetchYktClassroomReport(lessonId) {
  const response = await fetchYktJson(`${YKT_BASE}/api/v3/classroom-report/student/detail?lesson_id=${encodeURIComponent(String(lessonId))}`);
  if (!response?.data || (response.errcode !== undefined && Number(response.errcode) !== 0) || response.success === false) {
    throw new Error(response?.errmsg || response?.message || '课堂报告获取失败');
  }
  const report = Object.fromEntries(['problem', 'quiz'].map((key) => [key,
    Array.isArray(response.data[key]?.studentList) ? response.data[key].studentList : []]));
  const canonical = (value) => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(report))));
  return { ...report, signature: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
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

async function ensureYktDirectRequestHeaders() {
  if (!chrome?.declarativeNetRequest?.updateSessionRules) return false;
  if (yktHeaderRuleReady) return true;
  if (yktHeaderRulePromise) return yktHeaderRulePromise;
  yktHeaderRulePromise = chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [YKT_HEADER_RULE_ID, YKT_EXAM_HEADER_RULE_ID],
    addRules: [
      {
        id: YKT_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: YKT_BASE },
            { header: 'Referer', operation: 'set', value: `${YKT_BASE}/v2/web/index` }
          ]
        },
        condition: {
          regexFilter: '^https://www\\.yuketang\\.cn/mooc-api/v1/lms/learn/course/pub_new_pro(?:[?#]|$)',
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['xmlhttprequest']
        }
      },
      {
        id: YKT_EXAM_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: YKT_BASE },
            { header: 'Referer', operation: 'set', value: `${YKT_BASE}/v2/web/` }
          ]
        },
        condition: {
          regexFilter: '^https://www\\.yuketang\\.cn/v/exam/gen_token(?:[?#]|$)',
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['xmlhttprequest']
        }
      }
    ]
  }).then(() => {
    yktHeaderRuleReady = true;
    return true;
  }).catch((error) => {
    console.warn('[bjtu] ykt request header rule failed:', String(error?.message || error));
    return false;
  }).finally(() => {
    yktHeaderRulePromise = null;
  });
  return yktHeaderRulePromise;
}

async function getYktCsrfToken() {
  if (!chrome?.cookies?.getAll) return '';
  const cookies = await chrome.cookies.getAll({ url: `${YKT_BASE}/` }).catch(() => []);
  const csrfCookie = (cookies || []).find((cookie) => {
    const name = String(cookie?.name || '').toLowerCase();
    return name === 'csrftoken' || name === 'csrf_token';
  });
  const value = String(csrfCookie?.value || '').trim();
  try { return decodeURIComponent(value); } catch { return value; }
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

async function fetchYktCoursewareProgress(cid, coursewareIds, universityId) {
  const courseId = String(cid || '').trim();
  const schoolId = String(universityId || '').trim();
  const ids = [...new Set((Array.isArray(coursewareIds) ? coursewareIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))];
  if (!courseId || !ids.length) return {};
  await ensureYktDirectRequestHeaders();
  const csrfToken = await getYktCsrfToken();
  const requestHeaders = {
    Accept: 'application/json, text/plain, */*',
    'Cache-Control': 'no-cache',
    'classroom-id': courseId,
    'Content-Type': 'application/json;charset=UTF-8',
    Pragma: 'no-cache',
    'x-client': 'web',
    'xt-agent': 'web',
    xtbz: 'ykt'
  };
  if (schoolId) {
    requestHeaders['university-id'] = schoolId;
    requestHeaders['uv-id'] = schoolId;
  }
  if (csrfToken) requestHeaders['x-csrftoken'] = csrfToken;
  const response = await fetch(`${YKT_BASE}/mooc-api/v1/lms/learn/course/pub_new_pro`, {
    headers: requestHeaders,
    body: JSON.stringify({ cid: /^\d+$/.test(courseId) ? Number(courseId) : courseId, new_id: ids }),
    method: 'POST',
    credentials: 'include',
    cache: 'no-store'
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, error_code: response.status, msg: text || `HTTP ${response.status}`, data: {} };
  }
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
