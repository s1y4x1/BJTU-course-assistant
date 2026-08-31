(function (global) {
  'use strict';

  const LOGIN_URL = 'https://aa.bjtu.edu.cn/client/login/';
  const INDEX_URL = 'https://aa.bjtu.edu.cn/client/index/';
  const SCORE_URL = 'https://aa.bjtu.edu.cn/score/scores/stu/view/';
  const EXAM_URL = 'https://aa.bjtu.edu.cn/examine/examplanstudent/stulist';
  const SCHEDULE_URLS = Object.freeze({
    semester: 'https://aa.bjtu.edu.cn/course_selection/courseselect/stuschedule/',
    selection: 'https://aa.bjtu.edu.cn/course_selection/courseselecttask/schedule/'
  });
  const BKSY_SEMESTER_URL = 'https://bksy.bjtu.edu.cn/Admin/SemesterHandler.ashx';
  const VE_WEEK_URL = 'http://123.121.147.7:88/ve/back/coursePlatform/course.shtml?method=getTimeList';
  const TRAINING_PROGRAM_URL = 'https://aa.bjtu.edu.cn/training/training/program/';
  const MIS_MODULE_URL = 'https://mis.bjtu.edu.cn/module/module/10/';
  const ACCOUNTS_KEY = 'academicSystemAccounts';
  const OBSOLETE_BINDING_KEYS = ['academicSystemBindings', 'academicSystemBindToastShown'];
  const STUDENT_ID_KEY = 'academicSystemStudentId';
  const MONITOR_KEY = 'academicScoreMonitorEnabled';
  const EXAM_MONITOR_KEY = 'academicExamMonitorEnabled';
  const CLASS_REMINDER_KEY = 'academicClassReminderEnabled';
  const CLASS_REMINDER_LEAD_KEY = 'academicClassReminderLeadMinutes';
  const CLASS_REMINDER_NOTIFIED_KEY = 'academicClassReminderNotified';
  const MONITOR_INTERVAL_KEY = 'academicScoreMonitorIntervalMinutes';
  const DEFAULT_MONITOR_INTERVAL_MINUTES = 1;
  const SNAPSHOTS_KEY = 'academicScoreSnapshots';
  const PENDING_NOTIFICATIONS_KEY = 'academicScorePendingNotifications';
  const STATUS_KEY = 'academicScoreMonitorStatus';
  const EXAM_SNAPSHOTS_KEY = 'academicExamSnapshots';
  const EXAM_PENDING_NOTIFICATIONS_KEY = 'academicExamPendingNotifications';
  const EXAM_STATUS_KEY = 'academicExamMonitorStatus';
  const ALARM_NAME = 'bjtu-academic-score-check';
  const NOTIFICATION_PREFIX = 'bjtu-academic-score:';
  const EXAM_NOTIFICATION_PREFIX = 'bjtu-academic-exam:';
  const CLASS_NOTIFICATION_PREFIX = 'bjtu-academic-class:';
  const LOGIN_HEADER_RULE_ID = 914304;
  const ACADEMIC_DATA_CACHE_KEY_PREFIX = 'academicDataCache:';
  const LEGACY_ACADEMIC_DATA_CACHE_KEY = 'academicDataCache';
  const ACADEMIC_SCORE_SOURCE_CACHE_KEY = 'academicScoreSourceCache';
  const ACADEMIC_CURRENT_EXAM_CACHE_KEY = 'academicCurrentExamCache';
  // Can be changed from the extension service worker console through
  // BjtuAcademicSystemInternals.notifyInitialScoreRows.
  let notifyInitialScoreRows = true;
  let notifyInitialExamRows = true;
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  async function fetchAcademicWith503Retry(url, options = {}) {
    const { on503, onRetry = on503, ...fetchOptions } = options;
    while (true) {
      let response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (error) {
        if (error?.name === 'AbortError' || !/Failed to fetch/i.test(String(error?.message || error))) {
          throw error;
        }
        if (typeof onRetry === 'function') await onRetry(error);
        await wait(1000);
        continue;
      }
      if (response.status !== 503) return response;
      try {
        await response.body?.cancel?.();
      } catch {
        // A locked or already-consumed response body must not stop the retry loop.
      }
      if (typeof on503 === 'function') await on503();
      await wait(1000);
    }
  }
  const misLoginTabs = new Set();
  const misLoginVerifyingTabs = new Set();
  const pendingCredentialsByTab = new Map();
  let scoreCheckPromise = null;
  let examCheckPromise = null;
  let classReminderCheckPromise = null;
  let academicSessionPromise = null;
  let academicAccountCache = null;
  let academicSessionAccount = null;
  let academicScoreSourceCache = null;
  let academicScoreSourcePromise = null;
  let academicCurrentExamCache = null;
  let academicCurrentExamPromise = null;
  let scoreProcessPromise = Promise.resolve();
  let examProcessPromise = Promise.resolve();
  let academicDataCacheUpdatePromise = Promise.resolve();
  let accountWritePromise = Promise.resolve();
  const ACADEMIC_OPTIONS_REQUEST_PORT = 'bjtu-academic-options-requests';
  const ACADEMIC_REQUEST_PRIORITY = Object.freeze({
    LOGIN: 300,
    SCHEDULE: 200,
    SHARED: 100,
    MONITOR: 0
  });
  const academicRequestJobs = [];
  const academicOptionsRequestPorts = new Map();
  let academicRequestJobSequence = 0;
  let academicRequestWorkerRunning = false;

  function hasBusyAcademicOptionsRequests() {
    return [...academicOptionsRequestPorts.values()].some(Boolean);
  }

  function canRunAcademicRequest(job) {
    return job?.priority !== ACADEMIC_REQUEST_PRIORITY.MONITOR || !hasBusyAcademicOptionsRequests();
  }

  function enqueueAcademicRequest(priority, task) {
    return new Promise((resolve, reject) => {
      academicRequestJobs.push({
        priority: Number(priority) || 0,
        sequence: academicRequestJobSequence += 1,
        task,
        resolve,
        reject
      });
      void runAcademicRequestWorker();
    });
  }

  async function runAcademicRequestWorker() {
    if (academicRequestWorkerRunning) return;
    academicRequestWorkerRunning = true;
    try {
      while (academicRequestJobs.length) {
        academicRequestJobs.sort((left, right) => (
          right.priority - left.priority || left.sequence - right.sequence
        ));
        const jobIndex = academicRequestJobs.findIndex(canRunAcademicRequest);
        if (jobIndex < 0) break;
        const [job] = academicRequestJobs.splice(jobIndex, 1);
        try {
          job.resolve(await job.task());
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      academicRequestWorkerRunning = false;
      if (academicRequestJobs.some(canRunAcademicRequest)) void runAcademicRequestWorker();
    }
  }

  function decodeHtmlEntities(value) {
    const named = {
      amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"'
    };
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      const token = String(entity || '').toLowerCase();
      if (token.startsWith('#x')) return String.fromCodePoint(parseInt(token.slice(2), 16));
      if (token.startsWith('#')) return String.fromCodePoint(parseInt(token.slice(1), 10));
      return Object.prototype.hasOwnProperty.call(named, token) ? named[token] : match;
    });
  }

  function textFromHtml(value, preserveLines = false) {
    let text = String(value || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    text = decodeHtmlEntities(text).replace(/\r/g, '');
    if (preserveLines) {
      return text.split('\n')
        .map((line) => line.replace(/[\t ]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function extractDataContent(html) {
    const match = String(html || '').match(/\bdata-content\s*=\s*(["'])([\s\S]*?)\1/i);
    return match ? textFromHtml(match[2], true) : '';
  }

  function normalizeScoreRow(row) {
    const source = row && typeof row === 'object' ? row : {};
    const normalized = {
      sequence: String(source.sequence || '').trim(),
      academicYear: String(source.academicYear || '').replace(/\s+/g, ' ').trim(),
      course: String(source.course || '').replace(/\s+/g, ' ').trim(),
      credit: String(source.credit || '').replace(/\s+/g, ' ').trim(),
      score: String(source.score || '').replace(/\s+/g, ' ').trim(),
      bonusScore: String(source.bonusScore || '').replace(/\s+/g, ' ').trim(),
      teacher: String(source.teacher || '').replace(/\s+/g, ' ').trim(),
      details: String(source.details || '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim()
    };
    const courseCode = normalized.course.match(/^[A-Z0-9]+/i)?.[0] || '';
    const courseName = normalized.course.slice(courseCode.length).trim() || normalized.course;
    normalized.courseCode = courseCode;
    normalized.courseName = courseName;
    normalized.key = `${normalized.academicYear}|${normalized.course}`;
    return normalized;
  }

  function parseScorePage(html) {
    const source = String(html || '');
    const table = [...source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
      .find((match) => /\bclass\s*=\s*["'][^"']*\btable-bordered\b/i.test(match[1])
        && /<th\b[^>]*>\s*学年\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*成绩\s*<\/th>/i.test(match[2]));
    const hasScoreTable = !!table;
    const tableHtml = table?.[2] || '';
    const rows = [];
    for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = rowMatch[1];
      const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length < 7) continue;
      const details = extractDataContent(cells[7] || rowHtml)
        || textFromHtml(cells[7] || '', true).replace(/^详情$/u, '');
      const row = normalizeScoreRow({
        sequence: textFromHtml(cells[0]),
        academicYear: textFromHtml(cells[1]),
        course: textFromHtml(cells[2]),
        credit: textFromHtml(cells[3]),
        score: textFromHtml(cells[4]),
        bonusScore: textFromHtml(cells[5]),
        teacher: textFromHtml(cells[6]),
        details
      });
      if (row.academicYear && row.course) rows.push(row);
    }
    return { hasScoreTable, rows };
  }

  function parseScoreSemesters(html) {
    const source = String(html || '');
    const select = [...source.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
      .find((match) => /\b(?:id|name)\s*=\s*["']zxjxjhh["']/i.test(match[1]));
    if (!select) return [];
    const semesters = [];
    const seen = new Set();
    for (const option of select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const value = attributeFromHtml(option[1], 'value');
      const label = textFromHtml(option[2]);
      if (!value || !label || seen.has(value)) continue;
      seen.add(value);
      semesters.push({ label, zxjxjhh: value });
    }
    return semesters;
  }

  function matchCurrentScoreSemester(rows, semesters) {
    const academicYear = String((Array.isArray(rows) ? rows : [])
      .find((row) => row?.academicYear)?.academicYear || '').trim();
    return (Array.isArray(semesters) ? semesters : [])
      .find((item) => String(item?.label || '').trim() === academicYear) || null;
  }

  function attributeFromHtml(value, name) {
    const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(value || '').match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
    return match ? decodeHtmlEntities(match[2]).trim() : '';
  }

  function normalizeExamRow(row) {
    const source = row && typeof row === 'object' ? row : {};
    const normalized = {
      id: String(source.id || '').trim(),
      sequence: String(source.sequence || '').trim(),
      exam: String(source.exam || '').replace(/\s+/g, ' ').trim(),
      course: String(source.course || '').replace(/\s+/g, ' ').trim(),
      courseCode: String(source.courseCode || '').replace(/\s+/g, ' ').trim(),
      startAt: Number(source.startAt || 0),
      timeLocation: String(source.timeLocation || '').replace(/\r/g, '')
        .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'),
      method: String(source.method || '').replace(/\s+/g, ' ').trim(),
      remarks: String(source.remarks || '').replace(/\s+/g, ' ').trim(),
      registration: String(source.registration || '').replace(/\s+/g, ' ').trim(),
      status: String(source.status || '').replace(/\s+/g, ' ').trim(),
      operation: String(source.operation || '').replace(/\s+/g, ' ').trim()
    };
    if (!normalized.startAt) normalized.startAt = parseExamStartAt(normalized.timeLocation);
    normalized.key = normalized.id || `${normalized.exam}|${normalized.courseCode || normalized.course}`;
    return normalized;
  }

  function parseExamStartAt(value) {
    const match = String(value || '').match(
      /(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})/
    );
    if (!match) return 0;
    const timestamp = new Date(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), 0, 0
    ).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function parseExamPage(html) {
    const source = String(html || '');
    const table = [...source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
      .find((match) => /\bclass\s*=\s*["'][^"']*\btable-bordered\b/i.test(match[1])
        && /<th\b[^>]*>\s*考试\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*时间地点\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*考试方式\s*<\/th>/i.test(match[2]));
    const hasExamTable = !!table;
    const rows = [];
    for (const rowMatch of String(table?.[2] || '').matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length < 8) continue;
      const courseCode = attributeFromHtml(cells[2], 'title');
      const courseText = textFromHtml(cells[2]);
      const timeLocation = textFromHtml(cells[3], true);
      const row = normalizeExamRow({
        id: attributeFromHtml(rowMatch[1], 'data-pk'),
        sequence: textFromHtml(cells[0]),
        exam: textFromHtml(cells[1]),
        courseCode,
        course: [courseCode, courseText].filter(Boolean).join(' '),
        startAt: parseExamStartAt(timeLocation),
        timeLocation,
        method: textFromHtml(cells[4]),
        remarks: textFromHtml(cells[5]),
        registration: textFromHtml(cells[6]),
        status: textFromHtml(cells[7]),
        operation: textFromHtml(cells[8] || '')
      });
      if (row.exam && row.course) rows.push(row);
    }
    return { hasExamTable, rows };
  }

  function parseScheduleWeeks(value) {
    const source = String(value || '').replace(/[，、]/g, ',');
    const body = source.match(/第\s*([\d\s,\-—~～至]+?)\s*周/u)?.[1] || '';
    const weeks = new Set();
    for (const part of body.split(',').map((item) => item.trim()).filter(Boolean)) {
      const range = part.match(/^(\d+)\s*(?:-|—|~|～|至)\s*(\d+)$/);
      if (range) {
        const begin = Number(range[1]);
        const end = Number(range[2]);
        for (let week = Math.min(begin, end); week <= Math.max(begin, end); week += 1) weeks.add(week);
      } else if (/^\d+$/.test(part)) {
        weeks.add(Number(part));
      }
    }
    if (/单周/u.test(source)) {
      for (const week of [...weeks]) if (week % 2 === 0) weeks.delete(week);
    } else if (/双周/u.test(source)) {
      for (const week of [...weeks]) if (week % 2 !== 0) weeks.delete(week);
    }
    return [...weeks].filter((week) => week > 0).sort((a, b) => a - b);
  }

  function parseScheduleCourseBlock(html) {
    const source = String(html || '');
    const headingHtml = source.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '';
    const headingLines = headingHtml
      .split(/<br\s*\/?\s*>/i)
      .map((item) => textFromHtml(item))
      .filter(Boolean);
    const nameMatch = source.match(/<span\b[^>]*style\s*=\s*["'][^"']*color\s*:\s*#?000[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const weekMatch = source.match(/<div\b[^>]*style\s*=\s*["'][^"']*max-width\s*:\s*120px[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const weekHtml = weekMatch?.[1] || '';
    const teacher = textFromHtml(weekHtml.match(/<i\b[^>]*>([\s\S]*?)<\/i>/i)?.[1] || '');
    const weekText = textFromHtml(weekHtml.replace(/<i\b[^>]*>[\s\S]*?<\/i>/gi, ''));
    const mutedMatches = [...source.matchAll(/<span\b[^>]*class\s*=\s*["'][^"']*\btext-muted\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)];
    const location = textFromHtml(mutedMatches.at(-1)?.[1] || '');
    const selectionStatus = textFromHtml(
      source.match(/<span\b[^>]*class\s*=\s*["'][^"']*\bgreen\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''
    );
    const name = textFromHtml(nameMatch?.[1] || '') || headingLines[1] || '';
    const visibleText = textFromHtml(source, true);
    const courseCode = visibleText.match(/\b[A-Z]\d{6}[A-Z]\b/i)?.[0]
      || headingLines.find((line) => line !== name && /^(?=.*\d)[A-Z0-9-]{6,}$/i.test(line))
      || '';
    if (!courseCode && !name) return null;
    return {
      courseCode,
      name,
      weekText,
      weeks: parseScheduleWeeks(weekText),
      teacher,
      location,
      selectionStatus
    };
  }

  function parseSchedulePage(html) {
    const source = String(html || '');
    const headingTermLabel = textFromHtml(
      [...source.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)]
        .find((match) => /\binline\b/i.test(attributeFromHtml(match[1], 'class'))
          && /\bdropdown-hover\b/i.test(attributeFromHtml(match[1], 'class')))?.[2] || ''
    ).match(/(\d{4}-\d{4}-[123])\s*学期/u)?.[1] || '';
    const termLabel = headingTermLabel
      || textFromHtml(source).match(/(\d{4}-\d{4}-[123])\s*学期\s*选课课表/u)?.[1]
      || source.match(/(\d{4}-\d{4}-[123])(?:\s|&nbsp;|&emsp;)*学期(?:\s|&nbsp;|&emsp;)*选课课表/u)?.[1]
      || '';
    const tables = [...source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)];
    const weekHeaderPattern = /(?:星期|周)[一二三四五六日]/u;
    const hasFullWeek = (text) => /(?:星期|周)一/u.test(text) && /(?:星期|周)日/u.test(text);
    const table = tables.find((match) => /\btable-bordered\b/i.test(match[1]) && hasFullWeek(match[2]))
      || tables.find((match) => weekHeaderPattern.test(match[2]) && /第\s*\d+\s*节/u.test(match[2]))
      || null;
    const rows = [];
    const allWeeks = new Set();
    for (const rowMatch of String(table?.[2] || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length < 8) continue;
      const periodText = textFromHtml(cells[0]);
      const period = periodText.match(/第\s*\d+\s*节/u)?.[0]?.replace(/\s+/g, '') || periodText;
      const time = periodText.match(/\[\s*([^\]]+)\s*\]/)?.[1]?.trim() || '';
      const days = cells.slice(1, 8).map((cell) => {
        const cellSource = String(cell || '');
        const commentedParts = cellSource
          .split(/<!--\s*处理主修和辅修记录，生成课表\s*-->/u)
          .slice(1);
        const parts = commentedParts.length > 0
          ? commentedParts
          : cellSource.split(/(?=<div\b[^>]*>\s*<span\b)/i).filter((part) => (
            /^\s*<div\b[^>]*>\s*<span\b/i.test(part)
          ));
        const courses = parts.map(parseScheduleCourseBlock).filter(Boolean);
        for (const course of courses) for (const week of course.weeks) allWeeks.add(week);
        return courses;
      });
      rows.push({ period, time, days });
    }
    return {
      hasScheduleTable: !!table,
      rows,
      weeks: [...allWeeks].sort((a, b) => a - b),
      termLabel
    };
  }

  function parseCurrentAccountPage(html) {
    const source = String(html || '');
    const table = [...source.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)]
      .find((match) => /\bclass\s*=\s*["'][^"']*\btable-bordered\b/i.test(match[1])
        && /<th\b[^>]*>\s*学生\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*专业\s*<\/th>/i.test(match[2])
        && /<th\b[^>]*>\s*培养方案\s*<\/th>/i.test(match[2]));
    if (!table) return null;
    for (const rowMatch of table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length < 2) continue;
      const student = textFromHtml(cells[1]);
      const match = student.match(/^(\S+)\s+(.+)$/u);
      if (!match) continue;
      return {
        studentId: String(match[1] || '').trim(),
        userName: String(match[2] || '').trim()
      };
    }
    return null;
  }

  function scoreFingerprint(row) {
    return JSON.stringify([
      row.academicYear, row.course, row.credit, row.score,
      row.bonusScore, row.teacher, row.details
    ]);
  }

  function examFingerprint(row) {
    return JSON.stringify([
      row.exam, row.course, row.courseCode, row.timeLocation, row.method,
      row.remarks, row.registration, row.status, row.operation
    ]);
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const ch of String(value || '')) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function formatScoreNotification(row) {
    return [
      `成绩：${row.score || '-'}`,
      `上课教师：${row.teacher || '-'}`,
      `学年：${row.academicYear || '-'}`,
      `学分：${row.credit || '-'}`,
      `序号：${row.sequence || '-'}`,
      `详细信息：${row.details || '-'}`
    ].join('\n');
  }

  function formatExamNotification(row) {
    return [
      `考试：${row.exam || '-'}`,
      `课程：${row.course || '-'}`,
      `时间地点：${row.timeLocation || '-'}`,
      `考试方式：${row.method || '-'}`,
      `备注：${row.remarks || '-'}`,
      `报名信息：${row.registration || '-'}`,
      `考试状态：${row.status || '-'}`,
      `操作：${row.operation || '-'}`
    ].join('\n');
  }

  async function broadcastStatus(payload) {
    const status = { ...payload, ts: Date.now() };
    try {
      chrome.runtime.sendMessage({ type: 'ACADEMIC_SYSTEM_STATUS', payload: status }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // No extension page may be open.
    }
  }

  async function showAcademicPageToast(tabId, message) {
    if (!tabId) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (content) => {
        const id = '__bjtu_academic_login_toast__';
        document.getElementById(id)?.remove();
        const toast = document.createElement('div');
        toast.id = id;
        toast.textContent = content;
        toast.style.cssText = [
          'position:fixed', 'left:50%', 'top:18px', 'transform:translateX(-50%)',
          'z-index:2147483647', 'background:#16a34a', 'color:#fff',
          'font:600 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif',
          'padding:10px 14px', 'border-radius:8px', 'box-shadow:0 10px 30px rgba(0,0,0,.22)'
        ].join(';');
        document.documentElement.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
      },
      args: [String(message || '')]
    }).catch(() => {});
  }

  async function getAcademicAccounts() {
    const stored = await chrome.storage.local.get([ACCOUNTS_KEY]);
    const rawAccounts = stored?.[ACCOUNTS_KEY] && typeof stored[ACCOUNTS_KEY] === 'object'
      ? stored[ACCOUNTS_KEY]
      : {};
    const accounts = {};
    for (const [studentId, source] of Object.entries(rawAccounts)) {
      const id = String(studentId || '').trim();
      if (!id) continue;
      accounts[id] = {
        studentId: id,
        userName: String(source?.userName || ''),
        password: String(source?.password || ''),
        updatedAt: Number(source?.updatedAt || 0),
        lastLoginAt: Number(source?.lastLoginAt || 0)
      };
    }
    return accounts;
  }
  async function saveAcademicAccount(studentId, patch = {}) {
    const id = String(studentId || '').trim();
    if (!id) throw new Error('学号为空');
    const write = accountWritePromise.then(async () => {
      const accounts = await getAcademicAccounts();
      const current = accounts[id] || { studentId: id, userName: '', password: '', updatedAt: 0, lastLoginAt: 0 };
      accounts[id] = {
        ...current,
        ...patch,
        studentId: id,
        userName: patch.userName === undefined ? String(current.userName || '') : String(patch.userName || ''),
        password: patch.password === undefined ? String(current.password || '') : String(patch.password || ''),
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts, [STUDENT_ID_KEY]: id });
      return accounts[id];
    });
    accountWritePromise = write.catch(() => {});
    return write;
  }
  async function clearAcademicCookies() {
    academicScoreSourceCache = null;
    academicScoreSourcePromise = null;
    academicCurrentExamCache = null;
    academicCurrentExamPromise = null;
    await chrome.storage.session.remove([
      LEGACY_ACADEMIC_DATA_CACHE_KEY,
      ACADEMIC_SCORE_SOURCE_CACHE_KEY,
      ACADEMIC_CURRENT_EXAM_CACHE_KEY
    ]).catch(() => {});
    const cookies = await chrome.cookies.getAll({ domain: 'aa.bjtu.edu.cn' }).catch(() => []);
    for (const cookie of (cookies || [])) {
      const host = String(cookie.domain || 'aa.bjtu.edu.cn').replace(/^\./, '');
      const path = String(cookie.path || '/');
      await chrome.cookies.remove({
        url: `https://${host}${path}`,
        name: cookie.name,
        storeId: cookie.storeId
      }).catch(() => null);
    }
  }

  async function installAcademicLoginHeaderRule() {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [LOGIN_HEADER_RULE_ID],
      addRules: [{
        id: LOGIN_HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: 'https://aa.bjtu.edu.cn' },
            { header: 'Referer', operation: 'set', value: LOGIN_URL }
          ]
        },
        condition: {
          regexFilter: '^https://aa\\.bjtu\\.edu\\.cn/client/login/?(?:\\?.*)?$',
          resourceTypes: ['xmlhttprequest'],
          requestMethods: ['post']
        }
      }]
    });
  }

  async function removeAcademicLoginHeaderRule() {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [LOGIN_HEADER_RULE_ID]
    }).catch(() => {});
  }

  function academicLoginCsrfToken(html) {
    for (const match of String(html || '').matchAll(/<input\b[^>]*>/gi)) {
      const tag = match[0];
      if (attributeFromHtml(tag, 'name') === 'csrfmiddlewaretoken') {
        return attributeFromHtml(tag, 'value');
      }
    }
    return '';
  }

  function academicLoginErrorMessage(html) {
    const source = String(html || '');
    for (const match of source.matchAll(/<([a-z][\w:-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const className = attributeFromHtml(match[2], 'class');
      if (!/(?:^|\s)(?:alert|error|help-block)(?:\s|$)/i.test(className)) continue;
      const message = textFromHtml(match[3]);
      if (message) return message;
    }
    return source.includes('密码错误，登录失败') ? '账号或密码错误' : '教务系统登录失败';
  }

  async function loginWithPassword(studentId, password) {
    const id = String(studentId || '').trim();
    const secret = String(password || '').trim();
    if (!id) throw new Error('请输入用户名（学号）');
    if (!secret) throw new Error('请输入密码（身份证号后 6 位）');
    if (secret.length !== 6) throw new Error('密码必须为 6 个字符');
    academicAccountCache = null;
    academicSessionAccount = null;
    await clearAcademicCookies();
    await installAcademicLoginHeaderRule();
    try {
      let result = { ok: false, message: 'CSRF Token 已失效，请重试' };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const page = await fetchAcademicWith503Retry(LOGIN_URL, {
          credentials: 'include', cache: 'no-store', redirect: 'follow'
        });
        if (!page.ok) {
          result = { ok: false, message: `登录页 HTTP ${page.status}` };
          break;
        }
        const pageHtml = await page.text();
        const csrf = academicLoginCsrfToken(pageHtml);
        if (!csrf) {
          result = { ok: false, message: '登录页中未找到 CSRF Token' };
          break;
        }
        const body = new URLSearchParams({
          csrfmiddlewaretoken: csrf,
          loginname: id,
          password: secret
        });
        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        };
        const csrfCookie = await chrome.cookies.get({ url: LOGIN_URL, name: 'csrftoken' }).catch(() => null);
        if (csrfCookie?.value) {
          try {
            headers['X-CSRFToken'] = decodeURIComponent(csrfCookie.value);
          } catch {
            headers['X-CSRFToken'] = String(csrfCookie.value);
          }
        }
        const response = await fetchAcademicWith503Retry(LOGIN_URL, {
          method: 'POST', body, headers, credentials: 'include', cache: 'no-store', redirect: 'follow'
        });
        const html = await response.text();
        if (response.url.startsWith(INDEX_URL) || html.includes('欢迎您，')) {
          result = { ok: true, url: response.url };
          break;
        }
        if (response.status === 403 && attempt === 0) continue;
        result = { ok: false, message: academicLoginErrorMessage(html) };
        break;
      }
      if (result.ok) {
        await saveAcademicAccount(id, { password: secret, lastLoginAt: Date.now() });
        await broadcastStatus({ status: 'login-done', studentId: id });
        scheduleAcademicChecks();
      } else {
        await broadcastStatus({ status: 'login-error', studentId: id, error: result.message });
      }
      return result;
    } finally {
      await removeAcademicLoginHeaderRule();
    }
  }

  async function loginSavedAcademicAccount(studentId) {
    const id = String(studentId || '').trim();
    const accounts = await getAcademicAccounts();
    const account = accounts[id];
    if (!account) throw new Error('未保存此教务系统账号');
    if (!account.password) throw new Error('此账号没有已保存的密码');
    return loginWithPassword(id, account.password);
  }
  function isLoginPageResponse(responseUrl, html) {
    return /\/client\/login\/?(?:[?#]|$)/i.test(String(responseUrl || ''))
      || /name\s*=\s*["']csrfmiddlewaretoken["']/i.test(String(html || ''))
        && /name\s*=\s*["']loginname["']/i.test(String(html || ''));
  }

  async function fetchCurrentAcademicAccount() {
    if (academicAccountCache) return academicAccountCache;
    const response = await fetchAcademicWith503Retry(TRAINING_PROGRAM_URL, {
      credentials: 'include', cache: 'no-store', redirect: 'follow'
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`培养方案页面 HTTP ${response.status}`);
    if (isLoginPageResponse(response.url, html)) return null;
    const account = parseCurrentAccountPage(html);
    if (!account?.studentId) throw new Error('培养方案页面中未找到当前学生信息');
    await saveAcademicAccount(account.studentId, { userName: account.userName });
    academicAccountCache = account;
    return account;
  }

  // 登录态探测：GET 培养方案页，未被重定向到登录页即视为已登录。
  async function probeAcademicLoginState() {
    try {
      const response = await fetchAcademicWith503Retry(TRAINING_PROGRAM_URL, {
        credentials: 'include', cache: 'no-store', redirect: 'follow'
      });
      const html = await response.text();
      if (!response.ok) return { ok: true, loggedIn: false };
      return { ok: true, loggedIn: !isLoginPageResponse(response.url, html) };
    } catch (error) {
      return { ok: false, loggedIn: false, message: String(error?.message || error) };
    }
  }

  async function ensureAcademicSession() {
    if (academicSessionAccount) return academicSessionAccount;
    if (academicSessionPromise) return academicSessionPromise;
    academicSessionPromise = (async () => {
      let account = academicAccountCache || await fetchCurrentAcademicAccount();
      if (account) {
        academicSessionAccount = account;
        return account;
      }
      const stored = await chrome.storage.local.get([STUDENT_ID_KEY, 'username']);
      const studentId = String(stored?.[STUDENT_ID_KEY] || stored?.username || '').trim();
      try {
        await loginSavedAcademicAccount(studentId);
      } catch {
        throw Object.assign(new Error('教务系统未登录，请输入账号密码或通过 MIS 登录'), { code: 'not-logged-in' });
      }
      academicAccountCache = null;
      account = await fetchCurrentAcademicAccount();
      if (!account) throw Object.assign(new Error('教务系统登录已失效'), { code: 'not-logged-in' });
      academicSessionAccount = account;
      return account;
    })().finally(() => { academicSessionPromise = null; });
    return academicSessionPromise;
  }

  function broadcastAcademicData(kind, rows, studentId, checkedAt) {
    try {
      chrome.runtime.sendMessage({
        type: 'ACADEMIC_DATA_UPDATED',
        payload: {
          kind,
          rows,
          studentId: String(studentId || ''),
          checkedAt: Number(checkedAt || Date.now())
        }
      }, () => { void chrome.runtime.lastError; });
    } catch {
      // No extension page may be open.
    }
  }

  async function fetchAcademicPage(url, label) {
    const account = await ensureAcademicSession();
    const response = await fetchAcademicWith503Retry(url, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      on503: label === '考试信息'
        ? () => chrome.storage.local.set({
          [EXAM_STATUS_KEY]: {
            status: 'retrying',
            error: '考试信息页面 HTTP 503',
            checkedAt: Date.now()
          }
        }).catch(() => {})
        : undefined
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`${label}页面 HTTP ${response.status}`);
    if (isLoginPageResponse(response.url, html)) {
      throw Object.assign(new Error('教务系统登录已失效'), { code: 'not-logged-in' });
    }
    return { html, account };
  }

  function scorePageUrl({ history = false, zxjxjhh = '' } = {}) {
    const url = new URL(SCORE_URL);
    if (history) {
      url.searchParams.set('ctype', 'ln');
      url.searchParams.set('perpage', '500');
      if (zxjxjhh) url.searchParams.set('zxjxjhh', String(zxjxjhh));
    }
    return url.href;
  }

  function fetchScorePage(options = {}) {
    return fetchAcademicPage(scorePageUrl(options), '成绩');
  }

  function academicPageUrl(baseUrl, parameter, value = '') {
    const url = new URL(baseUrl);
    const normalized = String(value || '').trim();
    if (normalized) url.searchParams.set(parameter, normalized);
    return url.href;
  }

  function fetchExamPage(zxjxjhh = '') {
    return fetchAcademicPage(academicPageUrl(EXAM_URL, 'zxjxjhh', zxjxjhh), '考试信息');
  }

  async function loadCurrentExamSource({ fresh = false } = {}) {
    if (!fresh && academicCurrentExamCache) return academicCurrentExamCache;
    if (academicCurrentExamPromise) return academicCurrentExamPromise;
    academicCurrentExamPromise = (async () => {
      const local = await chrome.storage.local.get([STUDENT_ID_KEY]);
      const expectedStudentId = String(local?.[STUDENT_ID_KEY] || '').trim();
      if (!fresh) {
        const stored = await chrome.storage.session.get(ACADEMIC_CURRENT_EXAM_CACHE_KEY);
        const cached = stored?.[ACADEMIC_CURRENT_EXAM_CACHE_KEY];
        if (cached && expectedStudentId && String(cached.studentId || '') === expectedStudentId) {
          return cached;
        }
      }
      const page = await fetchExamPage();
      const parsed = parseExamPage(page.html);
      if (!parsed.hasExamTable) throw new Error('考试信息页面中未找到考试表格');
      const source = {
        rows: parsed.rows,
        studentId: String(page.account?.studentId || expectedStudentId),
        checkedAt: Date.now()
      };
      await chrome.storage.session.set({ [ACADEMIC_CURRENT_EXAM_CACHE_KEY]: source });
      return source;
    })();
    try {
      academicCurrentExamCache = await academicCurrentExamPromise;
      return academicCurrentExamCache;
    } finally {
      academicCurrentExamPromise = null;
    }
  }

  async function fetchSchedulePage(type = 'semester', xnxq = '') {
    const normalizedType = type === 'selection' ? 'selection' : 'semester';
    const page = await fetchAcademicPage(
      academicPageUrl(SCHEDULE_URLS[normalizedType], 'xnxq', xnxq),
      '课表'
    );
    const parsed = parseSchedulePage(page.html);
    if (!parsed.hasScheduleTable && normalizedType === 'semester' && !String(xnxq || '').trim()) {
      throw new Error('课表页面中未找到课表');
    }
    return { ...parsed, account: page.account, type: normalizedType };
  }

  function localDateText(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

async function fetchVeWeekContext() {
    let text = '';
    let response = null;
    if (global.BjtuVeHomeworkCore?.requestText) {
      const result = await global.BjtuVeHomeworkCore.requestText(VE_WEEK_URL, {
        method: 'GET',
        timeoutMs: 8000,
        redirect: 'manual',
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
      });
      text = result?.text || '';
      response = result?.response || null;
    } else {
      response = await fetch(VE_WEEK_URL, {
        method: 'GET', credentials: 'include', cache: 'no-store',
        redirect: 'manual',
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01' },
        signal: AbortSignal.timeout(8000)
      });
      text = await response.text();
    }
    if (Number(response?.status || 0) === 302 || response?.type === 'opaqueredirect') {
      throw Object.assign(new Error('智慧课程平台周次接口要求重新登录'), { code: 've-week-redirect' });
    }
    if (!response?.ok) throw Object.assign(
      new Error(`智慧课程平台周次接口 HTTP ${response?.status || 0}`),
      { code: 've-week-http' }
    );
    const data = global.BjtuVeHomeworkCore?.parseJson
      ? global.BjtuVeHomeworkCore.parseJson(text)
      : JSON.parse(String(text || '').trim());
    const week = Number(data?.weekCode || 0);
    if (!week) throw Object.assign(
      new Error('智慧课程平台周次接口未返回周数'),
      { code: 've-week-empty' }
    );
    let termName = '';
    if (global.BjtuVeHomeworkCore?.fetchTerms) {
      const terms = await global.BjtuVeHomeworkCore.fetchTerms().catch(() => []);
      termName = String(terms.find((item) => Number(item?.currentFlag || 0) === 2)?.xqName || '').trim();
    }
    return {
      week,
      weeks: [week],
      weekLabels: { [week]: '本周' },
      termName,
      source: 've'
    };
  }

  async function fetchBksyWeekContext() {
    const response = await fetch(BKSY_SEMESTER_URL, {
      credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`本科生院周次接口 HTTP ${response.status}`);
    const year = text.match(/（\s*(\d{4}-\d{4})学年\s*）/u)?.[1] || '';
    const semester = text.match(/第([一二三])学期/u)?.[1] || '';
    const week = Number(text.match(/第\s*(\d+)\s*周/u)?.[1] || 0);
    if (!week) throw new Error('本科生院周次接口未返回周数');
    return {
      week,
      weeks: [],
      termName: [year, semester && `第${semester}学期`].filter(Boolean).join(''),
      source: 'bksy'
    };
  }

async function fetchCurrentWeekContext(scheduleWeeks = []) {
    let preferred = null;
    let warning = '';
    try {
      preferred = await fetchVeWeekContext();
    } catch (veError) {
      warning = String(veError?.message || veError || '智慧课程平台周次获取失败');
      try {
        preferred = await fetchBksyWeekContext();
      } catch (bksyError) {
        const fallbackMessage = String(bksyError?.message || bksyError || '本科生院周次获取失败');
        warning = `${warning}；${fallbackMessage}。当前显示全部课表`;
        preferred = { week: 0, weeks: [], weekLabels: {}, termName: '', source: 'schedule' };
      }
    }
    const weeks = new Set([
      ...(Array.isArray(scheduleWeeks) ? scheduleWeeks : []),
      ...(Array.isArray(preferred?.weeks) ? preferred.weeks : []),
      Number(preferred?.week || 0)
    ]);
    return {
      week: Number(preferred?.week || 0),
      weeks: [...weeks].filter((week) => week > 0).sort((a, b) => a - b),
      weekLabels: preferred?.weekLabels || {},
      termName: String(preferred?.termName || ''),
      source: String(preferred?.source || ''),
      warning
    };
  }

  async function notifyScoreChange(row, kind, studentId = '') {
    const titlePrefix = kind === 'new' ? '新增成绩' : '成绩更新';
    const notificationId = `${NOTIFICATION_PREFIX}${shortHash(`${studentId}|${kind}|${row.key}|${scoreFingerprint(row)}`)}`;
    if (global.BjtuSystemNotifications?.create) {
      await global.BjtuSystemNotifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `${titlePrefix}：${row.courseName || row.course}`,
        message: formatScoreNotification(row),
        priority: 2
      }, 'academic-score');
      return;
    }
    await new Promise((resolve, reject) => {
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: `${titlePrefix}：${row.courseName || row.course}`,
        message: formatScoreNotification(row),
        priority: 2
      }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || '创建成绩通知失败'));
        else resolve(notificationId);
      });
    });
  }

  async function notifyExamChange(row, kind, studentId = '') {
    const titlePrefix = kind === 'new' ? '新增考试' : '考试信息更新';
    const notificationId = `${EXAM_NOTIFICATION_PREFIX}${shortHash(`${studentId}|${kind}|${row.key}|${examFingerprint(row)}`)}`;
    const options = {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: `${titlePrefix}：${row.course || '-'}`,
      message: formatExamNotification(row),
      priority: 2
    };
    if (global.BjtuSystemNotifications?.create) {
      await global.BjtuSystemNotifications.create(notificationId, options, 'academic-exam');
      return;
    }
    await new Promise((resolve, reject) => {
      chrome.notifications.create(notificationId, options, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || '创建考试通知失败'));
        else resolve(notificationId);
      });
    });
  }

  function normalizeClassReminderLeadMinutes(value) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600 ? minutes : 10;
  }

  async function notifyUpcomingClass(course, row, startAt, studentId = '') {
    const notificationId = `${CLASS_NOTIFICATION_PREFIX}${shortHash([
      studentId, localDateText(startAt), row?.period, course?.courseCode, course?.name
    ].join('|'))}`;
    const options = {
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: `即将上课：${course?.name || course?.courseCode || '课程'}`,
      message: [
        `${row?.period || ''}${row?.time ? ` [${row.time}]` : ''}`,
        course?.teacher ? `教师：${course.teacher}` : '',
        course?.location ? `地点：${course.location}` : ''
      ].filter(Boolean).join('\n'),
      priority: 2
    };
    if (global.BjtuSystemNotifications?.create) {
      await global.BjtuSystemNotifications.create(notificationId, options, 'academic-class');
      return notificationId;
    }
    await new Promise((resolve, reject) => {
      chrome.notifications.create(notificationId, options, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message || '创建上课通知失败'));
        else resolve(notificationId);
      });
    });
    return notificationId;
  }

  async function checkUpcomingClasses() {
    if (classReminderCheckPromise) return classReminderCheckPromise;
    classReminderCheckPromise = (async () => {
      const stored = await chrome.storage.local.get([
        CLASS_REMINDER_KEY, CLASS_REMINDER_LEAD_KEY, CLASS_REMINDER_NOTIFIED_KEY
      ]);
      if (stored?.[CLASS_REMINDER_KEY] !== true) return { skipped: true };
      const schedule = await fetchSchedulePage('semester');
      const weekContext = await fetchCurrentWeekContext(schedule.weeks);
      const currentWeek = Number(weekContext.week || 0);
      const now = new Date();
      const dayIndex = now.getDay() - 1;
      if (currentWeek <= 0 || dayIndex < 0 || dayIndex > 6) return { skipped: true };
      const leadMs = normalizeClassReminderLeadMinutes(stored?.[CLASS_REMINDER_LEAD_KEY]) * 60000;
      const today = localDateText(now);
      const notified = stored?.[CLASS_REMINDER_NOTIFIED_KEY]
        && typeof stored[CLASS_REMINDER_NOTIFIED_KEY] === 'object'
        ? stored[CLASS_REMINDER_NOTIFIED_KEY]
        : {};
      const nextNotified = Object.fromEntries(Object.entries(notified).filter(([key]) => key.startsWith(`${today}|`)));
      for (const row of schedule.rows) {
        const startText = String(row?.time || '').split('-')[0]?.trim();
        const match = startText.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) continue;
        const startAt = new Date(now);
        startAt.setHours(Number(match[1]), Number(match[2]), 0, 0);
        if (now.getTime() < startAt.getTime() - leadMs || now.getTime() >= startAt.getTime()) continue;
        const courses = Array.isArray(row?.days?.[dayIndex]) ? row.days[dayIndex] : [];
        for (const course of courses) {
          if (!Array.isArray(course?.weeks) || !course.weeks.includes(currentWeek)) continue;
          const key = `${today}|${row?.period || ''}|${course?.courseCode || ''}|${course?.name || ''}`;
          if (nextNotified[key]) continue;
          await notifyUpcomingClass(course, row, startAt, schedule.account?.studentId || '');
          nextNotified[key] = Date.now();
        }
      }
      await chrome.storage.local.set({ [CLASS_REMINDER_NOTIFIED_KEY]: nextNotified });
      return { checked: true };
    })().finally(() => { classReminderCheckPromise = null; });
    return classReminderCheckPromise;
  }

  function normalizePendingScoreNotifications(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const [key, item] of Object.entries(source)) {
      const studentId = String(item?.studentId || '').trim();
      const kind = item?.kind === 'updated' ? 'updated' : 'new';
      const row = normalizeScoreRow(item?.row);
      if (!studentId || !row.academicYear || !row.course) continue;
      result[key] = { studentId, kind, row, createdAt: Number(item?.createdAt || Date.now()) };
    }
    return result;
  }

  async function flushPendingScoreNotifications(pendingOverride = null) {
    const stored = pendingOverride
      ? null
      : await chrome.storage.local.get([PENDING_NOTIFICATIONS_KEY]);
    const pending = normalizePendingScoreNotifications(
      pendingOverride || stored?.[PENDING_NOTIFICATIONS_KEY]
    );
    let changed = false;
    for (const [key, item] of Object.entries(pending)) {
      try {
        await notifyScoreChange(item.row, item.kind, item.studentId);
        delete pending[key];
        changed = true;
      } catch {
        // Keep failed notifications for the next alarm instead of losing them.
      }
    }
    if (changed || pendingOverride) {
      await chrome.storage.local.set({ [PENDING_NOTIFICATIONS_KEY]: pending });
    }
    return pending;
  }

  function updateAcademicDataCacheFromMonitor(kind, rows, studentId, checkedAt) {
    const id = String(studentId || '').trim();
    if (!id) return Promise.resolve();
    academicDataCacheUpdatePromise = academicDataCacheUpdatePromise.catch(() => {}).then(async () => {
      const key = `${ACADEMIC_DATA_CACHE_KEY_PREFIX}${id}`;
      const stored = await chrome.storage.local.get(key);
      const cache = stored?.[key];
      if (!cache || typeof cache !== 'object') return;
      const current = String(cache.scoreCurrentZxjxjhh || '').trim();
      const currentOption = (Array.isArray(cache.academicSemesterOptions) ? cache.academicSemesterOptions : [])
        .find((item) => String(item?.zxjxjhh || '') === current);
      const currentLabel = String(currentOption?.label || rows?.[0]?.academicYear || '').trim();
      if (kind === 'scores') {
        const preserved = currentLabel
          ? (Array.isArray(cache.scoresCache?.rows) ? cache.scoresCache.rows : [])
            .filter((row) => String(row?.academicYear || '').trim() !== currentLabel)
          : [];
        cache.scoresCache = { rows: [...preserved, ...rows], checkedAt };
      } else if (kind === 'exams' && current) {
        const byTerm = new Map((Array.isArray(cache.examsCache?.results) ? cache.examsCache.results : [])
          .map((item) => [String(item?.zxjxjhh || ''), item]));
        byTerm.set(current, {
          ...(byTerm.get(current) || {}),
          label: String(byTerm.get(current)?.label || currentLabel),
          zxjxjhh: current,
          rows
        });
        cache.examsCache = {
          ...(cache.examsCache || {}),
          currentZxjxjhh: current,
          results: [...byTerm.values()],
          checkedAt
        };
      }
      if (current) {
        cache.loadedSharedTerms = [...new Set([
          ...(Array.isArray(cache.loadedSharedTerms) ? cache.loadedSharedTerms : []),
          current
        ])];
      }
      cache.updatedAt = checkedAt;
      delete cache.writeToken;
      await chrome.storage.local.set({ [key]: cache });
    });
    return academicDataCacheUpdatePromise;
  }

  async function processScoreRowsInternal(rows, studentId = '', source = 'poll') {
    const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeScoreRow)
      .filter((row) => row.academicYear && row.course);
    const stored = await chrome.storage.local.get([
      SNAPSHOTS_KEY, PENDING_NOTIFICATIONS_KEY, STUDENT_ID_KEY, MONITOR_KEY, 'username'
    ]);
    const id = String(studentId || stored?.[STUDENT_ID_KEY] || stored?.username || 'default').trim() || 'default';
    const snapshots = stored?.[SNAPSHOTS_KEY] && typeof stored[SNAPSHOTS_KEY] === 'object'
      ? { ...stored[SNAPSHOTS_KEY] }
      : {};
    const previous = snapshots[id]?.rows && typeof snapshots[id].rows === 'object'
      ? snapshots[id].rows
      : null;
    const nextRows = Object.fromEntries(normalizedRows.map((row) => [row.key, row]));
    const changes = [];
    const notificationsEnabled = stored?.[MONITOR_KEY] === true;
    if (previous && notificationsEnabled) {
      for (const row of normalizedRows) {
        if (!previous[row.key]) changes.push({ kind: 'new', row });
        else if (scoreFingerprint(previous[row.key]) !== scoreFingerprint(row)) changes.push({ kind: 'updated', row });
      }
    } else if (!previous && notificationsEnabled && notifyInitialScoreRows) {
      for (const row of normalizedRows) changes.push({ kind: 'new', row });
    }
    const pending = normalizePendingScoreNotifications(stored?.[PENDING_NOTIFICATIONS_KEY]);
    for (const change of changes) {
      const pendingKey = shortHash(`${id}|${change.kind}|${change.row.key}|${scoreFingerprint(change.row)}`);
      pending[pendingKey] = {
        studentId: id,
        kind: change.kind,
        row: change.row,
        createdAt: Date.now()
      };
    }
    const checkedAt = Date.now();
    snapshots[id] = { rows: nextRows, updatedAt: checkedAt, source };
    await chrome.storage.local.set({
      [SNAPSHOTS_KEY]: snapshots,
      [PENDING_NOTIFICATIONS_KEY]: pending,
      [STUDENT_ID_KEY]: id,
      [STATUS_KEY]: { status: 'ok', studentId: id, count: normalizedRows.length, checkedAt }
    });
    await updateAcademicDataCacheFromMonitor('scores', normalizedRows, id, checkedAt);
    broadcastAcademicData('scores', normalizedRows, id, checkedAt);
    const remainingPending = await flushPendingScoreNotifications(pending);
    return {
      count: normalizedRows.length,
      changes: changes.length,
      pendingNotifications: Object.keys(remainingPending).length,
      baseline: !previous,
      rows: normalizedRows,
      studentId: id,
      checkedAt
    };
  }

  function processScoreRows(rows, studentId = '', source = 'poll') {
    const run = scoreProcessPromise.then(() => processScoreRowsInternal(rows, studentId, source));
    scoreProcessPromise = run.catch(() => {});
    return run;
  }

  function normalizePendingExamNotifications(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const [key, item] of Object.entries(source)) {
      const studentId = String(item?.studentId || '').trim();
      const kind = item?.kind === 'updated' ? 'updated' : 'new';
      const row = normalizeExamRow(item?.row);
      if (!studentId || !row.exam || !row.course) continue;
      result[key] = { studentId, kind, row, createdAt: Number(item?.createdAt || Date.now()) };
    }
    return result;
  }

  async function flushPendingExamNotifications(pendingOverride = null) {
    const stored = pendingOverride
      ? null
      : await chrome.storage.local.get([EXAM_PENDING_NOTIFICATIONS_KEY]);
    const pending = normalizePendingExamNotifications(
      pendingOverride || stored?.[EXAM_PENDING_NOTIFICATIONS_KEY]
    );
    let changed = false;
    for (const [key, item] of Object.entries(pending)) {
      try {
        await notifyExamChange(item.row, item.kind, item.studentId);
        delete pending[key];
        changed = true;
      } catch {
        // Keep failed notifications for the next alarm instead of losing them.
      }
    }
    if (changed || pendingOverride) {
      await chrome.storage.local.set({ [EXAM_PENDING_NOTIFICATIONS_KEY]: pending });
    }
    return pending;
  }

  async function processExamRowsInternal(rows, studentId = '', source = 'poll') {
    const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeExamRow)
      .filter((row) => row.exam && row.course);
    const stored = await chrome.storage.local.get([
      EXAM_SNAPSHOTS_KEY, EXAM_PENDING_NOTIFICATIONS_KEY, STUDENT_ID_KEY, EXAM_MONITOR_KEY, 'username'
    ]);
    const id = String(studentId || stored?.[STUDENT_ID_KEY] || stored?.username || 'default').trim() || 'default';
    const snapshots = stored?.[EXAM_SNAPSHOTS_KEY] && typeof stored[EXAM_SNAPSHOTS_KEY] === 'object'
      ? { ...stored[EXAM_SNAPSHOTS_KEY] }
      : {};
    const previous = snapshots[id]?.rows && typeof snapshots[id].rows === 'object'
      ? snapshots[id].rows
      : null;
    const nextRows = Object.fromEntries(normalizedRows.map((row) => [row.key, row]));
    const changes = [];
    const notificationsEnabled = stored?.[EXAM_MONITOR_KEY] === true;
    if (previous && notificationsEnabled) {
      for (const row of normalizedRows) {
        if (!previous[row.key]) changes.push({ kind: 'new', row });
        else if (examFingerprint(previous[row.key]) !== examFingerprint(row)) {
          changes.push({ kind: 'updated', row });
        }
      }
    } else if (!previous && notificationsEnabled && notifyInitialExamRows) {
      for (const row of normalizedRows) changes.push({ kind: 'new', row });
    }
    const pending = normalizePendingExamNotifications(stored?.[EXAM_PENDING_NOTIFICATIONS_KEY]);
    for (const change of changes) {
      const pendingKey = shortHash(`${id}|${change.kind}|${change.row.key}|${examFingerprint(change.row)}`);
      pending[pendingKey] = {
        studentId: id,
        kind: change.kind,
        row: change.row,
        createdAt: Date.now()
      };
    }
    const checkedAt = Date.now();
    snapshots[id] = { rows: nextRows, updatedAt: checkedAt, source };
    await chrome.storage.local.set({
      [EXAM_SNAPSHOTS_KEY]: snapshots,
      [EXAM_PENDING_NOTIFICATIONS_KEY]: pending,
      [STUDENT_ID_KEY]: id,
      [EXAM_STATUS_KEY]: { status: 'ok', studentId: id, count: normalizedRows.length, checkedAt }
    });
    await updateAcademicDataCacheFromMonitor('exams', normalizedRows, id, checkedAt);
    broadcastAcademicData('exams', normalizedRows, id, checkedAt);
    const remainingPending = await flushPendingExamNotifications(pending);
    return {
      count: normalizedRows.length,
      changes: changes.length,
      pendingNotifications: Object.keys(remainingPending).length,
      baseline: !previous,
      rows: normalizedRows,
      studentId: id,
      checkedAt
    };
  }

  function processExamRows(rows, studentId = '', source = 'poll') {
    const run = examProcessPromise.then(() => processExamRowsInternal(rows, studentId, source));
    examProcessPromise = run.catch(() => {});
    return run;
  }

  async function checkScores(source = 'poll', {
    force = false,
    priority = ACADEMIC_REQUEST_PRIORITY.MONITOR
  } = {}) {
    if (scoreCheckPromise) return scoreCheckPromise;
    scoreCheckPromise = enqueueAcademicRequest(priority, async () => {
      const settings = await chrome.storage.local.get([MONITOR_KEY]);
      if (!force && settings?.[MONITOR_KEY] !== true) return { skipped: true };
      try {
        await flushPendingScoreNotifications();
        const page = await fetchScorePage();
        const parsed = parseScorePage(page.html);
        if (!parsed.hasScoreTable) throw new Error('成绩页面中未找到成绩表格');
        return await processScoreRows(parsed.rows, page.account.studentId, source);
      } catch (error) {
        await chrome.storage.local.set({
          [STATUS_KEY]: {
            status: 'error', error: String(error?.message || error),
            code: String(error?.code || ''), checkedAt: Date.now()
          }
        }).catch(() => {});
        throw error;
      }
    }).finally(() => { scoreCheckPromise = null; });
    return scoreCheckPromise;
  }

  async function checkExams(source = 'poll', {
    force = false,
    priority = ACADEMIC_REQUEST_PRIORITY.MONITOR
  } = {}) {
    if (examCheckPromise) return examCheckPromise;
    examCheckPromise = enqueueAcademicRequest(priority, async () => {
      const settings = await chrome.storage.local.get([EXAM_MONITOR_KEY]);
      if (!force && settings?.[EXAM_MONITOR_KEY] !== true) return { skipped: true };
      try {
        await flushPendingExamNotifications();
        const current = await loadCurrentExamSource({ fresh: true });
        return await processExamRows(current.rows, current.studentId, source);
      } catch (error) {
        await chrome.storage.local.set({
          [EXAM_STATUS_KEY]: {
            status: 'error', error: String(error?.message || error),
            code: String(error?.code || ''), checkedAt: Date.now()
          }
        }).catch(() => {});
        throw error;
      }
    }).finally(() => { examCheckPromise = null; });
    return examCheckPromise;
  }

  function scheduleAcademicChecks() {
    checkScores('scheduled').catch(() => {});
    checkExams('scheduled').catch(() => {});
    checkUpcomingClasses().catch(() => {});
  }

  async function captureScoreTab(tabId) {
    const enabled = (await chrome.storage.local.get([MONITOR_KEY]))?.[MONITOR_KEY] === true;
    if (!enabled || !tabId) return;
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const details = (cell) => {
          const source = cell?.querySelector('[data-content]')?.getAttribute('data-content') || '';
          if (!source) return '';
          const holder = document.createElement('div');
          holder.innerHTML = source.replace(/<br\s*\/?\s*>/gi, '\n');
          return String(holder.textContent || '').split('\n').map((line) => clean(line)).filter(Boolean).join('\n');
        };
        const table = [...document.querySelectorAll('table.table-bordered')].find((candidate) => {
          const headings = [...candidate.querySelectorAll('th')].map((item) => clean(item.textContent));
          return headings.includes('学年') && headings.includes('成绩');
        });
        if (!table) return [];
        return [...table.querySelectorAll('tr')].map((tr) => {
          const cells = tr.querySelectorAll('td');
          if (cells.length < 7) return null;
          return {
            sequence: clean(cells[0].textContent), academicYear: clean(cells[1].textContent),
            course: clean(cells[2].textContent), credit: clean(cells[3].textContent),
            score: clean(cells[4].textContent), bonusScore: clean(cells[5].textContent),
            teacher: clean(cells[6].textContent), details: details(cells[7])
          };
        }).filter(Boolean);
      }
    }).catch(() => []);
    const rows = results?.[0]?.result;
    if (Array.isArray(rows)) {
      const account = await fetchCurrentAcademicAccount().catch(() => null);
      if (account?.studentId) await processScoreRows(rows, account.studentId, 'page');
    }
  }

  function normalizeMonitorIntervalMinutes(value) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600
      ? minutes
      : DEFAULT_MONITOR_INTERVAL_MINUTES;
  }

  async function ensureAlarm() {
    const stored = await chrome.storage.local.get([MONITOR_INTERVAL_KEY]).catch(() => ({}));
    const interval = normalizeMonitorIntervalMinutes(stored?.[MONITOR_INTERVAL_KEY]);
    const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);
    if (existing && Number(existing.periodInMinutes || 0) === interval) return existing;
    if (existing) await chrome.alarms.clear(ALARM_NAME).catch(() => false);
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: interval, periodInMinutes: interval });
    return chrome.alarms.get(ALARM_NAME).catch(() => null);
  }

  async function focusScorePage() {
    const tabs = await chrome.tabs.query({ url: ['https://aa.bjtu.edu.cn/score/scores/stu/view*'] }).catch(() => []);
    if (tabs.length) {
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return;
    }
    await globalThis.BjtuTabs.create({ url: SCORE_URL, active: true });
  }

  async function focusExamPage() {
    const tabs = await chrome.tabs.query({ url: [`${EXAM_URL}*`] }).catch(() => []);
    if (tabs.length) {
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      return;
    }
    await globalThis.BjtuTabs.create({ url: EXAM_URL, active: true });
  }

  function extractLoginCredentials(details) {
    if (String(details?.method || '').toUpperCase() !== 'POST' || details?.type !== 'main_frame') return null;
    try {
      const url = new URL(String(details?.url || ''));
      if (url.hostname !== 'aa.bjtu.edu.cn' || !/^\/client\/login\/?$/i.test(url.pathname)) return null;
    } catch {
      return null;
    }
    const formData = details?.requestBody?.formData || {};
    let studentId = String(formData.loginname?.[0] || '').trim();
    let password = String(formData.password?.[0] || '');
    if ((!studentId || !password) && details?.requestBody?.raw?.[0]?.bytes) {
      try {
        const body = new TextDecoder().decode(details.requestBody.raw[0].bytes);
        const params = new URLSearchParams(body);
        studentId = studentId || String(params.get('loginname') || '').trim();
        password = password || String(params.get('password') || '');
      } catch {
        // Ignore an unsupported request-body encoding.
      }
    }
    return studentId && password ? { studentId, password, capturedAt: Date.now() } : null;
  }

  async function cleanupObsoleteBindingData() {
    const accounts = await getAcademicAccounts();
    await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts });
    await chrome.storage.local.remove(OBSOLETE_BINDING_KEYS);
  }

  async function buildAcademicContext() {
    const stored = await chrome.storage.local.get([
      STUDENT_ID_KEY, MONITOR_KEY, EXAM_MONITOR_KEY, CLASS_REMINDER_KEY,
      CLASS_REMINDER_LEAD_KEY, MONITOR_INTERVAL_KEY,
      STATUS_KEY, EXAM_STATUS_KEY, 'username'
    ]);
    const accounts = await getAcademicAccounts();
    const studentId = String(stored?.[STUDENT_ID_KEY] || stored?.username || '').trim();
    const summaries = Object.values(accounts)
      .map((account) => ({
        studentId: account.studentId,
        userName: String(account.userName || ''),
        hasPassword: !!account.password,
        updatedAt: Number(account.updatedAt || 0),
        lastLoginAt: Number(account.lastLoginAt || 0)
      }))
      .sort((a, b) => Number(b.lastLoginAt || b.updatedAt || 0) - Number(a.lastLoginAt || a.updatedAt || 0));
    return {
      ok: true, studentId,
      accounts: summaries,
      monitorEnabled: stored?.[MONITOR_KEY] === true,
      examMonitorEnabled: stored?.[EXAM_MONITOR_KEY] === true,
      classReminderEnabled: stored?.[CLASS_REMINDER_KEY] === true,
      classReminderLeadMinutes: normalizeClassReminderLeadMinutes(stored?.[CLASS_REMINDER_LEAD_KEY]),
      monitorIntervalMinutes: normalizeMonitorIntervalMinutes(stored?.[MONITOR_INTERVAL_KEY]),
      monitorStatus: stored?.[STATUS_KEY] || null,
      examMonitorStatus: stored?.[EXAM_STATUS_KEY] || null
    };
  }

  async function loadAcademicSemesters({ fresh = false } = {}) {
    const cached = fresh ? null : await readAcademicDataCache();
    if (cached?.academicSemesterOptions?.length) {
      return {
        ok: true,
        currentZxjxjhh: String(cached.scoreCurrentZxjxjhh || ''),
        semesters: cached.academicSemesterOptions
      };
    }
    const source = await loadAcademicScoreSource({ fresh });
    return {
      ok: true,
      currentZxjxjhh: source.currentZxjxjhh,
      semesters: source.availableSemesters
    };
  }

  async function loadAcademicScoreSource({ fresh = false } = {}) {
    if (fresh) {
      if (academicScoreSourcePromise) await academicScoreSourcePromise.catch(() => {});
      academicScoreSourceCache = null;
      await chrome.storage.session.remove(ACADEMIC_SCORE_SOURCE_CACHE_KEY).catch(() => {});
    }
    if (academicScoreSourceCache) return academicScoreSourceCache;
    if (academicScoreSourcePromise) return academicScoreSourcePromise;
    academicScoreSourcePromise = (async () => {
      const local = await chrome.storage.local.get([STUDENT_ID_KEY]);
      const expectedStudentId = String(local?.[STUDENT_ID_KEY] || '').trim();
      const stored = await chrome.storage.session.get(ACADEMIC_SCORE_SOURCE_CACHE_KEY);
      const cached = stored?.[ACADEMIC_SCORE_SOURCE_CACHE_KEY];
      if (cached && expectedStudentId && String(cached.studentId || '') === expectedStudentId) {
        return cached;
      }
      const currentPage = await fetchScorePage();
      const currentParsed = parseScorePage(currentPage.html);
      if (!currentParsed.hasScoreTable) throw new Error('本学期成绩页面中未找到成绩表格');
      const historyPage = await fetchScorePage({ history: true });
      const historyParsed = parseScorePage(historyPage.html);
      if (!historyParsed.hasScoreTable) throw new Error('历年成绩页面中未找到成绩表格');
      const availableSemesters = parseScoreSemesters(historyPage.html);
      if (!availableSemesters.length) throw new Error('历年成绩页面中未找到学期列表');
      let currentSemester = matchCurrentScoreSemester(currentParsed.rows, availableSemesters);
      if (!currentSemester) {
        const currentContext = await fetchBksyWeekContext().catch(() => null);
        const year = String(currentContext?.termName || '').match(/\d{4}-\d{4}/)?.[0] || '';
        const semesterText = String(currentContext?.termName || '').match(/第([一二三123])学期/u)?.[1] || '';
        const semesterNumber = ({ 一: '1', 二: '2', 三: '3' })[semesterText] || semesterText;
        currentSemester = availableSemesters.find((item) => item.label === `${year}-${semesterNumber}`) || null;
      }
      const source = {
        currentRows: currentParsed.rows,
        historyRows: historyParsed.rows,
        availableSemesters,
        currentZxjxjhh: String(currentSemester?.zxjxjhh || ''),
        studentId: String(currentPage.account?.studentId || historyPage.account?.studentId || ''),
        checkedAt: Date.now()
      };
      await chrome.storage.session.set({ [ACADEMIC_SCORE_SOURCE_CACHE_KEY]: source });
      return source;
    })();
    try {
      academicScoreSourceCache = await academicScoreSourcePromise;
      return academicScoreSourceCache;
    } finally {
      academicScoreSourcePromise = null;
    }
  }

  async function readAcademicDataCache() {
    const local = await chrome.storage.local.get([STUDENT_ID_KEY]);
    const studentId = String(local?.[STUDENT_ID_KEY] || '').trim();
    if (!studentId) return null;
    const key = `${ACADEMIC_DATA_CACHE_KEY_PREFIX}${studentId}`;
    const localCache = await chrome.storage.local.get(key);
    return localCache?.[key] || null;
  }

  function cachedRequestedTerms(cache, args, parameter) {
    const requested = requestedAcademicTerms(args, parameter);
    const current = String(cache?.scoreCurrentZxjxjhh || '');
    return requested === null ? (current ? [current] : []) : requested;
  }

  function requestedAcademicTerms(args, parameter) {
    const provided = Array.isArray(args) ? args : args?.[parameter];
    if (provided !== undefined && !Array.isArray(provided)) {
      throw new TypeError(`${parameter} 必须是学期列表`);
    }
    if (provided === undefined) return null;
    const values = provided.map((item) => String(item || '').trim()).filter(Boolean);
    if (!values.length) throw new Error(`${parameter} 不能为空`);
    return [...new Set(values)];
  }

  async function resolveAcademicTerms(args, parameter) {
    const context = await loadAcademicSemesters();
    const requested = requestedAcademicTerms(args, parameter);
    const selectedValues = requested === null
      ? (context.currentZxjxjhh ? [context.currentZxjxjhh] : [])
      : requested;
    const byValue = new Map(context.semesters.map((item) => [String(item?.zxjxjhh || ''), item]));
    const selected = selectedValues.map((value) => byValue.get(value)).filter(Boolean);
    if (selected.length !== selectedValues.length) {
      const unknown = selectedValues.filter((value) => !byValue.has(value));
      throw new Error(`不可用的学期：${unknown.join('、')}`);
    }
    return { ...context, selected };
  }

  async function mapAcademicTerms(semesters, mapper) {
    const source = Array.isArray(semesters) ? semesters : [];
    const results = [];
    for (let index = 0; index < source.length; index += 1) {
      results.push(await mapper(source[index], index));
    }
    return results;
  }

  async function loadAcademicExams(args = {}) {
    const fresh = !Array.isArray(args) && args?.fresh === true;
    const cached = fresh ? null : await readAcademicDataCache();
    if (cached) {
      const terms = cachedRequestedTerms(cached, args, 'zxjxjhh');
      const loaded = new Set(Array.isArray(cached.loadedSharedTerms) ? cached.loadedSharedTerms : []);
      const results = (cached.examsCache?.results || []).filter((item) => terms.includes(item.zxjxjhh));
      if (terms.length && terms.every((term) => loaded.has(term)) && results.length === terms.length) {
        return {
          ok: true,
          currentZxjxjhh: String(cached.scoreCurrentZxjxjhh || ''),
          results,
          checkedAt: Number(cached.examsCache?.checkedAt || cached.updatedAt || Date.now())
        };
      }
    }
    const context = await resolveAcademicTerms(args, 'zxjxjhh');
    const results = await mapAcademicTerms(context.selected, async (semester) => {
      const isCurrent = semester.zxjxjhh === context.currentZxjxjhh;
      const parsed = isCurrent
        ? await loadCurrentExamSource({ fresh })
        : parseExamPage((await fetchExamPage(semester.zxjxjhh)).html);
      return {
        label: String(semester.label || ''),
        zxjxjhh: String(semester.zxjxjhh || ''),
        rows: isCurrent || parsed.hasExamTable ? parsed.rows : []
      };
    });
    return { ok: true, currentZxjxjhh: context.currentZxjxjhh, results, checkedAt: Date.now() };
  }

  async function loadAcademicSelectionSchedule(contextOverride = null) {
    const context = contextOverride || await loadAcademicSemesters();
    const selection = await fetchSchedulePage('selection');
    const selectionLabel = String(selection?.termLabel || '').trim();
    if (!selectionLabel) throw new Error('选课课表页面未返回所属学期');
    const selectionSemester = context.semesters.find((item) => String(item?.label || '') === selectionLabel)
      || { label: selectionLabel, zxjxjhh: `${selectionLabel}-2` };
    const isCurrent = selectionSemester.zxjxjhh === context.currentZxjxjhh;
    return {
      ok: true,
      currentXnxq: context.currentZxjxjhh,
      selectionSemester: { label: selectionSemester.label, xnxq: selectionSemester.zxjxjhh },
      selectionProbed: true,
      results: isCurrent ? [] : [{
        label: selectionLabel,
        xnxq: String(selectionSemester.zxjxjhh || ''),
        type: 'selection',
        rows: selection.rows,
        weeks: selection.weeks,
        currentWeek: 0,
        weekLabels: {},
        termName: selectionLabel,
        weekSource: 'selection',
        weekWarning: ''
      }],
      checkedAt: Date.now()
    };
  }

  async function loadAcademicSchedule(args = {}) {
    const providedSemesters = Array.isArray(args)
      ? args
      : (args?.semesters !== undefined ? args.semesters : args?.xnxq);
    if (providedSemesters !== undefined && !Array.isArray(providedSemesters)) {
      throw new TypeError('semesters 必须是学期列表');
    }
    const effectiveArgs = providedSemesters === undefined
      ? args
      : { ...(Array.isArray(args) ? {} : args), xnxq: providedSemesters };
    const fresh = !Array.isArray(args) && args?.fresh === true;
    const cached = fresh ? null : await readAcademicDataCache();
    if (cached) {
      const terms = cachedRequestedTerms(cached, effectiveArgs, 'xnxq');
      const loaded = new Set(Array.isArray(cached.loadedScheduleTerms) ? cached.loadedScheduleTerms : []);
      const includeSelection = effectiveArgs?.includeSelection === true;
      const selectionReady = !includeSelection || (
        cached.scheduleCache?.selectionProbed === true
        && cached.scheduleCache?.selectionSemester?.xnxq
      );
      const currentTerm = String(cached.scoreCurrentZxjxjhh || '');
      const cachedByTerm = new Map(
        (cached.scheduleCache?.results || []).map((item) => [String(item?.xnxq || ''), item])
      );
      const termsReady = terms.every((term) => (
        loaded.has(term)
        && (term !== currentTerm || cachedByTerm.get(term)?.type === 'semester')
      ));
      if (terms.length && termsReady && selectionReady) {
        const requested = new Set(terms);
        const results = (cached.scheduleCache?.results || []).filter((item) => (
          requested.has(item.xnxq) || (includeSelection && item.type === 'selection')
        ));
        return {
          ok: true,
          currentXnxq: String(cached.scoreCurrentZxjxjhh || ''),
          selectionSemester: cached.scheduleCache?.selectionSemester || null,
          selectionProbed: cached.scheduleCache?.selectionProbed === true,
          results,
          checkedAt: Number(cached.scheduleCache?.checkedAt || cached.updatedAt || Date.now())
        };
      }
    }
    const context = await resolveAcademicTerms(effectiveArgs, 'xnxq');
    const results = await mapAcademicTerms(context.selected, async (semester) => {
      const schedule = await fetchSchedulePage('semester', semester.zxjxjhh);
      const isCurrent = semester.zxjxjhh === context.currentZxjxjhh;
      const weekContext = isCurrent
        ? await fetchCurrentWeekContext(schedule.weeks)
        : {
            week: 0,
            weeks: schedule.weeks,
            weekLabels: {},
            termName: String(semester.label || ''),
            source: 'semester',
            warning: ''
          };
      return {
        label: String(semester.label || ''),
        xnxq: String(semester.zxjxjhh || ''),
        type: schedule.type,
        rows: schedule.rows,
        weeks: weekContext.weeks,
        currentWeek: weekContext.week,
        weekLabels: weekContext.weekLabels,
        termName: weekContext.termName || String(semester.label || ''),
        weekSource: weekContext.source,
        weekWarning: weekContext.warning
      };
    });
    const shouldProbeSelection = effectiveArgs?.includeSelection === true;
    const selectionResult = shouldProbeSelection
      ? await loadAcademicSelectionSchedule(context)
      : null;
    for (const selection of (selectionResult?.results || [])) {
      const existingIndex = results.findIndex((item) => item.xnxq === selection.xnxq);
      if (existingIndex >= 0) results[existingIndex] = selection;
      else results.push(selection);
    }
    return {
      ok: true,
      currentXnxq: context.currentZxjxjhh,
      selectionSemester: selectionResult?.selectionSemester || null,
      selectionProbed: shouldProbeSelection,
      results,
      checkedAt: Date.now()
    };
  }

  function requestedScoreSemesters(args) {
    const provided = Array.isArray(args) ? args : args?.semesters;
    if (provided !== undefined && !Array.isArray(provided)) {
      throw new TypeError('semesters 必须是学期列表');
    }
    if (provided === undefined) return null;
    const values = provided
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (!values.length) throw new Error('semesters 不能为空');
    return [...new Set(values)];
  }

  async function loadAcademicScores(args = {}) {
    const requested = requestedScoreSemesters(args);
    const fresh = !Array.isArray(args) && args?.fresh === true;
    const cached = fresh ? null : await readAcademicDataCache();
    if (cached) {
      const semesters = Array.isArray(cached.academicSemesterOptions) ? cached.academicSemesterOptions : [];
      const byValue = new Map(semesters.map((item) => [String(item?.zxjxjhh || ''), item]));
      const byLabel = new Map(semesters.map((item) => [String(item?.label || ''), item]));
      const selectedValues = requested === null
        ? [String(cached.scoreCurrentZxjxjhh || '')].filter(Boolean)
        : requested;
      const selected = selectedValues.map((item) => byValue.get(item) || byLabel.get(item)).filter(Boolean);
      const loaded = new Set(Array.isArray(cached.loadedSharedTerms) ? cached.loadedSharedTerms : []);
      if (selected.length === selectedValues.length && selected.every((item) => loaded.has(item.zxjxjhh))) {
        const labels = new Set(selected.map((item) => String(item.label || '')));
        const rows = (cached.scoresCache?.rows || []).filter((row) => labels.has(String(row?.academicYear || '')));
        return {
          ok: true,
          rows,
          count: rows.length,
          studentId: String(cached.studentId || ''),
          checkedAt: Number(cached.scoresCache?.checkedAt || cached.updatedAt || Date.now()),
          currentZxjxjhh: String(cached.scoreCurrentZxjxjhh || ''),
          selectedSemesters: selected,
          availableSemesters: semesters
        };
      }
    }
    const source = await loadAcademicScoreSource();
    const availableSemesters = source.availableSemesters;
    const currentZxjxjhh = source.currentZxjxjhh;
    const selectedValues = requested === null
      ? (currentZxjxjhh ? [currentZxjxjhh] : [])
      : requested;
    const byZxjxjhh = new Map(availableSemesters.map((item) => [item.zxjxjhh, item]));
    const byLabel = new Map(availableSemesters.map((item) => [item.label, item]));
    const selected = selectedValues.map((item) => byZxjxjhh.get(item) || byLabel.get(item)).filter(Boolean);
    if (requested !== null && selected.length !== selectedValues.length) {
      const unknown = selectedValues.filter((item) => !byZxjxjhh.has(item) && !byLabel.has(item));
      throw new Error(`不可用的成绩学期：${unknown.join('、')}`);
    }
    const wantsCurrent = requested === null || (!!currentZxjxjhh && selected.some((item) => item.zxjxjhh === currentZxjxjhh));
    const historical = selected.filter((item) => item.zxjxjhh !== currentZxjxjhh);
    const academicYears = new Set(historical.map((item) => item.label));
    const rows = [
      ...(wantsCurrent ? source.currentRows : []),
      ...source.historyRows.filter((row) => academicYears.has(String(row?.academicYear || '').trim()))
    ];

    return {
      ok: true,
      rows,
      count: rows.length,
      studentId: source.studentId,
      checkedAt: source.checkedAt,
      currentZxjxjhh,
      selectedSemesters: selected.map(({ label, zxjxjhh }) => ({ label, zxjxjhh })),
      availableSemesters
    };
  }

  if (typeof chrome === 'object' && chrome?.runtime?.onMessage) {
    chrome.runtime.onConnect.addListener((port) => {
      if (port?.name !== ACADEMIC_OPTIONS_REQUEST_PORT) return;
      academicOptionsRequestPorts.set(port, false);
      port.onMessage.addListener((message) => {
        if (message?.type !== 'busy') return;
        academicOptionsRequestPorts.set(port, message.value === true);
        if (message.value !== true) void runAcademicRequestWorker();
      });
      port.onDisconnect.addListener(() => {
        academicOptionsRequestPorts.delete(port);
        void runAcademicRequestWorker();
      });
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'ACADEMIC_LOGIN_WITH_PASSWORD') {
        enqueueAcademicRequest(ACADEMIC_REQUEST_PRIORITY.LOGIN, () => (
          loginWithPassword(message?.payload?.studentId, message?.payload?.password)
        ))
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'START_ACADEMIC_MIS_LOGIN') {
        (async () => {
          await clearAcademicCookies();
          const tab = await globalThis.BjtuTabs.create({ url: 'about:blank', active: true });
          if (!tab?.id) throw new Error('无法打开 MIS 登录页');
          misLoginTabs.add(tab.id);
          await chrome.tabs.update(tab.id, { url: MIS_MODULE_URL });
          sendResponse({ ok: true, tabId: tab.id });
        })().catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'ACADEMIC_CHECK_SCORES') {
        checkScores('manual', { priority: ACADEMIC_REQUEST_PRIORITY.SHARED })
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'ACADEMIC_LOAD_SCORES') {
        enqueueAcademicRequest(ACADEMIC_REQUEST_PRIORITY.SHARED, () => loadAcademicScores(message?.payload))
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      if (message?.type === 'ACADEMIC_SEMESTERS') {
        enqueueAcademicRequest(ACADEMIC_REQUEST_PRIORITY.SCHEDULE, () => loadAcademicSemesters(message?.payload))
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      if (message?.type === 'ACADEMIC_PRELOAD_ACCOUNT') {
        fetchCurrentAcademicAccount()
          .then((account) => sendResponse(account
            ? { ok: true, studentId: account.studentId, userName: account.userName }
            : { ok: false, code: 'not-logged-in', message: '教务系统未登录' }))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      if (message?.type === 'ACADEMIC_LOGIN_STATUS') {
        probeAcademicLoginState()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'ACADEMIC_LOAD_EXAMS') {
        enqueueAcademicRequest(ACADEMIC_REQUEST_PRIORITY.SHARED, () => loadAcademicExams(message?.payload))
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      if (message?.type === 'ACADEMIC_LOAD_SCHEDULE') {
        enqueueAcademicRequest(ACADEMIC_REQUEST_PRIORITY.SCHEDULE, () => loadAcademicSchedule(message?.payload))
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      if (message?.type === 'ACADEMIC_LOAD_SELECTION_SCHEDULE') {
        enqueueAcademicRequest(ACADEMIC_REQUEST_PRIORITY.SCHEDULE, () => loadAcademicSelectionSchedule())
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({
            ok: false,
            code: String(error?.code || ''),
            message: String(error?.message || error)
          }));
        return true;
      }
      if (message?.type === 'ACADEMIC_SWITCH_ACCOUNT') {
        enqueueAcademicRequest(ACADEMIC_REQUEST_PRIORITY.LOGIN, () => (
          loginSavedAcademicAccount(message?.payload?.studentId)
        ))
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      if (message?.type === 'ACADEMIC_GET_CONTEXT') {
        buildAcademicContext()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
        return true;
      }
      return false;
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      const url = String(changeInfo?.url || tab?.url || '');
      if (changeInfo.status === 'complete') {
        let parsed = null;
        try { parsed = new URL(url); } catch { parsed = null; }
        if (parsed?.hostname === 'aa.bjtu.edu.cn') {
          const onLoginPage = /^\/client\/login(?:\/|$)/i.test(parsed.pathname);
          const pending = pendingCredentialsByTab.get(tabId);
          if (pending && !onLoginPage) {
            pendingCredentialsByTab.delete(tabId);
            void (async () => {
              const accounts = await getAcademicAccounts();
              const wasSaved = !!accounts[pending.studentId];
              await saveAcademicAccount(pending.studentId, {
                password: pending.password,
                lastLoginAt: Date.now()
              });
              await fetchCurrentAcademicAccount().catch(() => null);
              await broadcastStatus({ status: 'credentials-saved', studentId: pending.studentId, silent: true });
              if (!wasSaved) {
                await showAcademicPageToast(tabId, `已保存教务系统账号 ${pending.studentId} 的登录密码`);
              }
            })().catch(() => {});
          } else if (pending && onLoginPage) {
            pendingCredentialsByTab.delete(tabId);
          }
          if (misLoginTabs.has(tabId) && !onLoginPage && !misLoginVerifyingTabs.has(tabId)) {
            misLoginVerifyingTabs.add(tabId);
            void (async () => {
              try {
                const account = await fetchCurrentAcademicAccount();
                if (!account || !misLoginTabs.delete(tabId)) return;
                await broadcastStatus({
                  status: 'mis-login-done', tabId,
                  studentId: account.studentId, userName: account.userName
                });
                await chrome.tabs.remove(tabId).catch(() => {});
                checkScores('mis-login', { force: true }).catch(() => {});
                checkExams('mis-login', { force: true }).catch(() => {});
              } finally {
                misLoginVerifyingTabs.delete(tabId);
              }
            })().catch(() => {});
            return;
          }
        }
      }
      if (changeInfo.status === 'complete' && /^https:\/\/aa\.bjtu\.edu\.cn\/score\/scores\/stu\/view(?:[?#]|$)/i.test(url)) {
        captureScoreTab(tabId).catch(() => {});
      }
      if (changeInfo.status === 'complete'
        && /^https:\/\/aa\.bjtu\.edu\.cn\/examine\/examplanstudent\/stulist(?:[?#]|$)/i.test(url)) {
        chrome.storage.local.get([EXAM_MONITOR_KEY]).then((stored) => {
          if (stored?.[EXAM_MONITOR_KEY] === true) checkExams('page').catch(() => {});
        }).catch(() => {});
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      pendingCredentialsByTab.delete(tabId);
      misLoginVerifyingTabs.delete(tabId);
      if (misLoginTabs.delete(tabId)) {
        broadcastStatus({ status: 'mis-login-cancelled', tabId }).catch(() => {});
      }
    });
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        const credentials = extractLoginCredentials(details);
        if (credentials && Number(details?.tabId ?? -1) >= 0) {
          pendingCredentialsByTab.set(Number(details.tabId), credentials);
        }
      },
      { urls: ['https://aa.bjtu.edu.cn/client/login/*'] },
      ['requestBody']
    );
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name === ALARM_NAME) scheduleAcademicChecks();
    });
    chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); scheduleAcademicChecks(); });
    chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); scheduleAcademicChecks(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local'
        || (!changes[MONITOR_KEY] && !changes[EXAM_MONITOR_KEY] && !changes[CLASS_REMINDER_KEY]
          && !changes[CLASS_REMINDER_LEAD_KEY] && !changes[MONITOR_INTERVAL_KEY])) return;
      void ensureAlarm();
      if (changes[MONITOR_KEY]) {
        if (changes[MONITOR_KEY].newValue === true) checkScores('enabled').catch(() => {});
        else chrome.storage.local.remove([PENDING_NOTIFICATIONS_KEY]).catch(() => {});
      }
      if (changes[EXAM_MONITOR_KEY]) {
        if (changes[EXAM_MONITOR_KEY].newValue === true) checkExams('enabled').catch(() => {});
        else chrome.storage.local.remove([EXAM_PENDING_NOTIFICATIONS_KEY]).catch(() => {});
      }
      if (changes[CLASS_REMINDER_KEY]) {
        if (changes[CLASS_REMINDER_KEY].newValue === true) checkUpcomingClasses().catch(() => {});
        else chrome.storage.local.remove([CLASS_REMINDER_NOTIFIED_KEY]).catch(() => {});
      } else if (changes[CLASS_REMINDER_LEAD_KEY]) {
        checkUpcomingClasses().catch(() => {});
      }
    });
    chrome.notifications.onClicked.addListener((notificationId) => {
      const id = String(notificationId || '');
      if (id.startsWith(NOTIFICATION_PREFIX)) focusScorePage().catch(() => {});
      else if (id.startsWith(EXAM_NOTIFICATION_PREFIX)) focusExamPage().catch(() => {});
      else if (id.startsWith(CLASS_NOTIFICATION_PREFIX)) {
        globalThis.BjtuTabs.create({ url: chrome.runtime.getURL('options/options.html'), active: true }).catch(() => {});
      }
      else return;
      chrome.notifications.clear(notificationId, () => void chrome.runtime.lastError);
    });
    void ensureAlarm();
    cleanupObsoleteBindingData().catch(() => {});
  }

  global.BjtuAcademicSystemInternals = {
    getContext: () => buildAcademicContext(),
    probeLoginState: () => probeAcademicLoginState(),
    loadScores: (args) => enqueueAcademicRequest(
      ACADEMIC_REQUEST_PRIORITY.SHARED,
      () => loadAcademicScores(args)
    ),
    loadSemesters: () => enqueueAcademicRequest(
      ACADEMIC_REQUEST_PRIORITY.SCHEDULE,
      () => loadAcademicSemesters()
    ),
    loadExams: (args) => enqueueAcademicRequest(
      ACADEMIC_REQUEST_PRIORITY.SHARED,
      () => loadAcademicExams(args)
    ),
    loadSchedule: (args) => enqueueAcademicRequest(
      ACADEMIC_REQUEST_PRIORITY.SCHEDULE,
      () => loadAcademicSchedule(args)
    ),
    loadSelectionSchedule: () => enqueueAcademicRequest(
      ACADEMIC_REQUEST_PRIORITY.SCHEDULE,
      () => loadAcademicSelectionSchedule()
    ),
    loginWithPassword: (args) => enqueueAcademicRequest(
      ACADEMIC_REQUEST_PRIORITY.LOGIN,
      () => loginWithPassword(args?.studentId, args?.password)
    ),
    loginSavedAccount: (args) => enqueueAcademicRequest(
      ACADEMIC_REQUEST_PRIORITY.LOGIN,
      () => loginSavedAcademicAccount(args?.studentId)
    ),
    extractLoginCredentials,
    parseCurrentAccountPage,
    normalizeScoreRow,
    parseScorePage,
    parseScoreSemesters,
    matchCurrentScoreSemester,
    scoreFingerprint,
    processScoreRows,
    flushPendingScoreNotifications,
    normalizeExamRow,
    parseExamPage,
    examFingerprint,
    processExamRows,
    flushPendingExamNotifications,
    parseScheduleWeeks,
    parseSchedulePage,
    get notifyInitialScoreRows() { return notifyInitialScoreRows; },
    set notifyInitialScoreRows(value) { notifyInitialScoreRows = value !== false; },
    get notifyInitialExamRows() { return notifyInitialExamRows; },
    set notifyInitialExamRows(value) { notifyInitialExamRows = value !== false; }
  };
})(globalThis);
