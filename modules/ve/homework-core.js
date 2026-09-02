(function initVeHomeworkCore(global) {
  'use strict';

  const BASE = 'http://123.121.147.7:88';
  const BASE_VE = `${BASE}/ve/`;
  const FILE_BASE = 'http://123.121.147.7:8081';
  const DEFAULT_SESSION_ID = 'D571D57D255EA0BECF299C45D4C0468A';
  let runtimeSessionId = DEFAULT_SESSION_ID;

  function normalizeSessionId(value) {
    return String(value || '').trim();
  }

  function getSessionId() {
    return runtimeSessionId || DEFAULT_SESSION_ID;
  }

  function setSessionId(value) {
    const next = normalizeSessionId(value);
    if (next) runtimeSessionId = next;
    return getSessionId();
  }

  function updateSessionIdFromResponse(response) {
    try {
      return setSessionId(response?.headers?.get?.('sessionId') || response?.headers?.get?.('sessionid') || '');
    } catch {
      return getSessionId();
    }
  }

  function parseJson(text) {
    const source = String(text || '').trim();
    if (!source || source === '{}') return {};
    return JSON.parse(source.startsWith('{}') && source.length > 2 ? source.slice(2) : source);
  }

  function isLoginResponse(text, response) {
    const source = String(text || '');
    const url = String(response?.url || '');
    return /\/ve\/(?:Timeout|Login_2)\.jsp/i.test(url)
      || /<title>\s*一体化智慧教学平台\s*<\/title>/i.test(source)
      || /<title>\s*会话结束\s*<\/title>/i.test(source)
      || /会话结束[\s\S]*重新登录/i.test(source);
  }

  async function requestText(url, options = {}) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    const abort = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
      if (externalSignal.aborted) abort();
      else externalSignal.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(() => controller.abort('timeout'), Math.max(1000, Number(options.timeoutMs) || 30000));
    const requestOptions = { ...options };
    delete requestOptions.timeoutMs;
    const omitSessionId = requestOptions.omitSessionId === true;
    delete requestOptions.omitSessionId;
    const headers = {
      'Upgrade-Insecure-Requests': '1',
      ...(requestOptions.headers || {})
    };
    if (!omitSessionId) headers.sessionId = getSessionId();
    delete requestOptions.headers;
    try {
      const response = await fetch(url, {
        ...requestOptions,
        credentials: 'include',
        cache: 'no-store',
        headers,
        signal: controller.signal
      });
      updateSessionIdFromResponse(response);
      return { text: await response.text(), response };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', abort);
    }
  }

  function loginError() {
    return Object.assign(new Error('LOGIN_REQUIRED'), { loginRequired: true });
  }

  async function fetchCurrentUserInfo(options = {}) {
    const { text, response } = await requestText(
      `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo`,
      { ...options, headers: { Accept: 'application/json, text/javascript, */*; q=0.01', ...(options.headers || {}) } }
    );
    if (Number(response?.status || 0) >= 500) return null;
    if (isLoginResponse(text, response)) return null;
    const data = parseJson(text);
    return String(data?.STATUS) === '0' && data?.result ? data.result : null;
  }

  function normalizeTerms(rawList) {
    return (Array.isArray(rawList) ? rawList : []).map((item) => {
      const xqCode = String(item?.xqCode || item?.xq_code || item?.XQ_CODE || item?.XQCODE || '').trim();
      if (!xqCode) return null;
      return {
        xqId: String(item?.xqId || item?.xq_id || '').trim(),
        xqCode,
        xqName: String(item?.xqName || item?.CNAME || item?.xq_name || item?.name || xqCode).trim() || xqCode,
        currentFlag: Number(item?.currentFlag || item?.current_flag || 0) || 0,
        beginDate: String(item?.beginDate || item?.begin_date || '').trim(),
        endDate: String(item?.endDate || item?.end_date || '').trim()
      };
    }).filter(Boolean);
  }

  function chooseTermCode(terms, preferredCode = '') {
    const list = Array.isArray(terms) ? terms : [];
    const preferred = String(preferredCode || '').trim();
    if (preferred && list.some((item) => item.xqCode === preferred)) return preferred;
    return String(list.find((item) => Number(item.currentFlag) === 2)?.xqCode || list[0]?.xqCode || '').trim();
  }

  async function fetchTerms(options = {}) {
    const { text, response } = await requestText(
      `${BASE_VE}back/rp/common/teachCalendar.shtml?method=queryCurrentXq`,
      { ...options, headers: { Accept: 'application/json, text/javascript, */*; q=0.01', ...(options.headers || {}) } }
    );
    if (isLoginResponse(text, response)) throw loginError();
    const data = parseJson(text);
    return normalizeTerms(Array.isArray(data?.result) ? data.result : data?.RESULT);
  }

  async function fetchCourses(xqCode, options = {}) {
    const url = `${BASE_VE}back/coursePlatform/course.shtml?method=getCourseList&pagesize=100&page=1&xqCode=${encodeURIComponent(String(xqCode || ''))}`;
    const { text, response } = await requestText(url, {
      ...options,
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01', ...(options.headers || {}) }
    });
    if (Number(response?.status || 0) >= 500) throw loginError();
    if (isLoginResponse(text, response)) throw loginError();
    let data;
    try { data = parseJson(text); } catch { throw loginError(); }
    if (String(data?.STATUS) !== '0') {
      const message = String(data?.ERRMSG || data?.message || '课程接口返回异常');
      if (/登录|不合法/.test(message)) throw loginError();
      throw new Error(message);
    }
    return Array.isArray(data?.courseList) ? data.courseList : [];
  }

  function homeworkKey(homework) {
    return String(homework?.id ?? homework?.noteId ?? homework?.courseNoteId
      ?? homework?.upId ?? homework?.UPID ?? homework?.snId ?? homework?.noteSnId
      ?? homework?.workId ?? homework?.homeworkId ?? '').trim();
  }

  async function fetchCourseHomework(courseId, { previousList = [], signal, onTypeLoaded } = {}) {
    const cid = String(courseId || '').trim();
    const previousByKey = new Map((Array.isArray(previousList) ? previousList : [])
      .map((item) => [homeworkKey(item), item]).filter(([key]) => key));
    const merged = [];
    const seen = new Set();
    for (const subType of [0, 1, 2]) {
      const fetchPage = async (pageSize) => {
        const url = `${BASE_VE}back/coursePlatform/homeWork.shtml?method=getHomeWorkList&cId=${encodeURIComponent(cid)}&subType=${subType}&page=1&pagesize=${pageSize}`;
        const { text, response } = await requestText(url, {
          signal,
          headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
        });
        if (isLoginResponse(text, response)) throw loginError();
        return parseJson(text);
      };
      try {
        let data = await fetchPage(10);
        const total = Number(data?.total || 0);
        if (Number.isFinite(total) && total > 10) data = await fetchPage(total);
        if (String(data?.STATUS) !== '0') continue;
        const list = Array.isArray(data?.courseNoteList) ? data.courseNoteList : (Array.isArray(data?.list) ? data.list : []);
        list.forEach((homework) => {
          const key = homeworkKey(homework);
          if (key && seen.has(key)) return;
          if (key) seen.add(key);
          const previous = key ? previousByKey.get(key) : null;
          merged.push({
            ...homework,
            subType: homework?.subType ?? subType,
            ...(previous?.__attachmentKey ? { __attachmentKey: previous.__attachmentKey } : {})
          });
        });
      } catch (error) {
        if (error?.loginRequired || error?.message === 'LOGIN_REQUIRED') throw error;
      } finally {
        if (typeof onTypeLoaded === 'function') {
          await onTypeLoaded({
            subType,
            typeList: merged.filter((homework) => Number(homework?.subType ?? homework?.sub_type) === subType),
            list: [...merged]
          });
        }
      }
    }
    return merged;
  }

  async function fetchCourseTeachers(courseId, options = {}) {
    const { text, response } = await requestText(
      `${BASE_VE}back/course/courseAssistantInfo.shtml?method=getAssistantForCourse`,
      {
        ...options,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          ...(options.headers || {})
        },
        body: new URLSearchParams({ courseId: String(courseId || '') }).toString()
      }
    );
    if (isLoginResponse(text, response)) throw loginError();
    const data = parseJson(text);
    return Array.isArray(data?.result) ? data.result : [];
  }

  function normalizeAttachmentUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return path.startsWith('/rp/') ? `${FILE_BASE}${path}` : `${BASE}${path}`;
  }

  async function fetchHomeworkAttachments(course, homeworkList, options = {}) {
    const courseId = getCourseId(course);
    if (!courseId) return {};
    let teacherId = String(course?.teacher_id || course?.teacherId || course?.teacherid || '').trim();
    if (!teacherId) {
      const teachers = await fetchCourseTeachers(courseId, options).catch(() => []);
      teacherId = String((teachers.find((item) => String(item?.userType) === '1') || teachers[0])?.loginName || '').trim();
    }
    if (!teacherId) return {};

    const cache = {};
    const list = Array.isArray(homeworkList) ? homeworkList : [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(6, Math.max(1, list.length)) }, async () => {
      while (cursor < list.length) {
        const homework = list[cursor++];
        const noteId = String(homework?.id ?? homework?.noteId ?? homework?.courseNoteId ?? '').trim();
        const noteCourseId = String(homework?.course_id ?? homework?.courseId ?? homework?.cId ?? courseId).trim();
        const noteTeacherId = String(homework?.teacher_id ?? homework?.teacherId ?? teacherId).trim();
        if (!noteId || !noteCourseId || !noteTeacherId) continue;
        const key = `${noteId}|${noteCourseId}|${noteTeacherId}`;
        homework.__attachmentKey = key;
        const url = `${BASE_VE}back/coursePlatform/homeWork.shtml?method=queryStudentCourseNote&id=${encodeURIComponent(noteId)}&courseId=${encodeURIComponent(noteCourseId)}&teacherId=${encodeURIComponent(noteTeacherId)}`;
        try {
          const { text, response } = await requestText(url, {
            signal: options.signal,
            headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
          });
          if (isLoginResponse(text, response)) throw loginError();
          const data = parseJson(text);
          const picList = (Array.isArray(data?.picList) ? data.picList : []).map((item) => {
            const fileName = String(item?.file_name || item?.name || '').trim();
            const dot = fileName.lastIndexOf('.');
            return {
              fileName: fileName || '附件',
              fileNameNoExt: dot > 0 ? fileName.slice(0, dot) : (fileName || '附件'),
              sizeBytes: Math.max(0, Number(item?.pic_size || 0) || 0),
              url: normalizeAttachmentUrl(item?.url)
            };
          }).filter((item) => item.url);
          cache[key] = { loading: false, loaded: true, picList };
        } catch (error) {
          if (error?.loginRequired) throw error;
          cache[key] = { loading: false, loaded: true, picList: [] };
        }
      }
    });
    await Promise.all(workers);
    return cache;
  }

  function getCourseId(course) {
    return String(course?.id || course?.cId || course?.courseId || course?.course_id || '').trim();
  }

  function getCourseName(course) {
    return String(course?.name || course?.NAME || course?.courseName || course?.title || '未知课程').trim();
  }

  function parseDeadline(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
      const number = Number(value);
      return Number.isFinite(number) && number > 0 ? (number < 1e12 ? number * 1000 : number) : 0;
    }
    const timestamp = Date.parse(String(value).trim().replace(/\//g, '-').replace(/\./g, '-').replace('T', ' '));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function isHomeworkDone(homework) {
    const status = String(homework?.subStatus ?? homework?.sub_status ?? '').trim();
    const time = String(homework?.subTime ?? homework?.sub_time ?? '').trim();
    return (status && status !== '未提交') || !!time;
  }

  function getHomeworkPublishScoreId(homework) {
    return String(homework?.id ?? homework?.noteId ?? homework?.courseNoteId
      ?? homework?.snId ?? homework?.noteSnId ?? homework?.upId ?? '').trim();
  }

  function isHomeworkScoreUnpublished(homework) {
    const text = `${String(homework?.lastScore ?? homework?.last_score ?? '')} ${String(homework?.scoreStatus ?? homework?.score_status ?? '')}`;
    return /暂未公布/.test(text);
  }

  function getUnpublishedDoneScoreHomeworkIds(homeworkList) {
    const seen = new Set();
    const ids = [];
    for (const homework of Array.isArray(homeworkList) ? homeworkList : []) {
      if (!isHomeworkDone(homework) || !isHomeworkScoreUnpublished(homework)) continue;
      const id = getHomeworkPublishScoreId(homework);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  async function setHomeworkScoreDisplayStatus(homeworkId, isOpen, { signal } = {}) {
    const id = String(homeworkId || '').trim();
    if (!id) throw new Error('缺少作业 ID');
    const url = `${BASE_VE}back/rp/common/courseTeachTask.shtml?method=updateWorkScoreDisplyStatus&id=${encodeURIComponent(id)}&isOpen=${encodeURIComponent(String(isOpen))}`;
    const { text, response } = await requestText(url, {
      signal,
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });
    if (isLoginResponse(text, response)) throw loginError();
  }

  function splitUploadFileName(value) {
    const name = String(value || '').trim();
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return { fileNameNoExt: name, fileExtName: '' };
    return { fileNameNoExt: name.slice(0, dot), fileExtName: name.slice(dot + 1) };
  }

  function buildHomeworkUploadFile(entry) {
    const visitName = String(entry?.visitName || '').trim();
    if (!visitName) return null;
    const suppliedNameNoExt = String(entry?.fileNameNoExt || '').trim();
    if (entry?.__homeworkFileListReady === true && suppliedNameNoExt) {
      return {
        fileNameNoExt: suppliedNameNoExt,
        fileExtName: String(entry?.fileExtName || '').trim(),
        fileSize: String(Math.max(0, Number(entry?.fileSize || 0) || 0)),
        visitName,
        pid: '',
        ftype: 'insert'
      };
    }
    const parts = splitUploadFileName(entry?.fileName || entry?.name || '');
    return {
      fileNameNoExt: encodeURIComponent(parts.fileNameNoExt),
      fileExtName: parts.fileExtName,
      fileSize: String(Math.max(0, Number(entry?.fileSize || 0) || 0)),
      visitName,
      pid: '',
      ftype: 'insert'
    };
  }

  async function submitHomework(courseId, homework, content, uploadedFiles, options = {}) {
    const cid = String(courseId || '').trim();
    const upId = String(homework?.id ?? homework?.upId ?? homework?.upid ?? homework?.UPID ?? homework?.up_id ?? '').trim();
    if (!cid) throw new Error('缺少课程 ID');
    if (!upId) throw new Error('缺少作业 ID');
    const fileList = (Array.isArray(uploadedFiles) ? uploadedFiles : [])
      .map(buildHomeworkUploadFile)
      .filter(Boolean);
    const body = new URLSearchParams({
      method: 'sendStuHomeWorks',
      content: encodeURIComponent(String(content || '')),
      groupName: '',
      groupId: '',
      courseId: cid,
      contentType: '0',
      fz: String(homework?.is_fz ?? '0'),
      jxrl_id: '',
      fileList: JSON.stringify(fileList),
      upId,
      return_num: '0',
      isTeacher: '0'
    });
    const { text, response } = await requestText(`${BASE_VE}back/course/courseWorkInfo.shtml`, {
      signal: options.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: body.toString()
    });
    if (isLoginResponse(text, response) || (response?.redirected && String(response.url || '').includes('/ve/s.shtml'))) {
      throw loginError();
    }
    let data;
    try { data = parseJson(text); } catch { data = null; }
    if (String(data?.STATUS) === '0' || String(data?.flag || '').toLowerCase() === 'success') {
      return { submitted: true, courseId: cid, assignmentId: upId, fileCount: fileList.length, response: data };
    }
    throw new Error(String(data?.ERRMSG || data?.message || text || '提交失败'));
  }

  function collectPendingAssignments(courses, courseHomeworkData, { futureOnly = false } = {}) {
    const now = Date.now();
    const output = [];
    const seen = new Set();
    (Array.isArray(courses) ? courses : []).forEach((course) => {
      const courseId = getCourseId(course);
      const courseName = getCourseName(course);
      const courseNum = course?.course_num || course?.courseNum || course?.courseNo || course?.course_id || courseId;
      const fzId = course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '';
      const xqCode = course?.xq_code || course?.xqCode || '';
      const list = courseHomeworkData?.[courseId]?.list || [];
      list.forEach((homework) => {
        if (isHomeworkDone(homework)) return;
        const deadline = parseDeadline(homework?.end_time ?? homework?.endTime ?? '');
        if (deadline && deadline <= now) return;
        if (futureOnly && !deadline) return;
        const title = String(homework?.title || homework?.workTitle || homework?.courseNoteTitle || '未命名作业').trim();
        const subType = Number(homework?.subType ?? homework?.sub_type);
        const courseToPage = ({ 0: 10460, 1: 10461, 2: 10462 })[subType] || 10460;
        const actionUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=${courseToPage}&courseId=${encodeURIComponent(courseNum)}&cId=${encodeURIComponent(courseId)}&xknId=${encodeURIComponent(fzId)}&xkhId=${encodeURIComponent(fzId)}&xqCode=${encodeURIComponent(xqCode)}`;
        const key = `智慧课程平台|${courseName}|${title}|${deadline}`;
        if (seen.has(key)) return;
        seen.add(key);
        output.push({ key, platform: '智慧课程平台', courseName, title, deadline, actionUrl });
      });
    });
    return output;
  }

  global.BjtuVeHomeworkCore = Object.freeze({
    BASE,
    BASE_VE,
    DEFAULT_SESSION_ID,
    normalizeSessionId,
    getSessionId,
    setSessionId,
    updateSessionIdFromResponse,
    parseJson,
    isLoginResponse,
    requestText,
    fetchCurrentUserInfo,
    normalizeTerms,
    chooseTermCode,
    fetchTerms,
    fetchCourses,
    homeworkKey,
    fetchCourseHomework,
    fetchCourseTeachers,
    fetchHomeworkAttachments,
    getCourseId,
    getCourseName,
    parseDeadline,
    isHomeworkDone,
    getUnpublishedDoneScoreHomeworkIds,
    setHomeworkScoreDisplayStatus,
    buildHomeworkUploadFile,
    submitHomework,
    collectPendingAssignments
  });
})(globalThis);
