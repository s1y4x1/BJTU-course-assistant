/* 操作注册表：将各模块常用操作暴露给 AI 调用。
 * 每个操作包含名称（module.name）、说明（Markdown）、以及可序列化的执行器。
 * 执行器运行在 Service Worker 环境，可访问各模块的 global API 或转发消息。
 */
(function initBjtuQwenOperations(global) {
  'use strict';

  const LOGIN_REQUIRED_MESSAGE = '未登录智慧课程平台，请先登录后再试。';

  function loginRequiredError() {
    return Object.assign(new Error(LOGIN_REQUIRED_MESSAGE), { code: 'LOGIN_REQUIRED' });
  }

  function requireGlobal(name) {
    const value = global[name];
    if (value == null) {
      throw Object.assign(new Error(`模块 ${name} 未安装或未就绪`), { code: 'MODULE_UNAVAILABLE' });
    }
    return value;
  }

  function serialize(value, depth = 0) {
    if (value == null || typeof value !== 'object') {
      if (typeof value === 'function' || typeof value === 'symbol') return undefined;
      return value;
    }
    if (value instanceof Error) return `[Error] ${value.message}`;
    if (depth > 6) return '[深度受限]';
    if (Array.isArray(value)) {
      return value.map((item) => serialize(item, depth + 1)).filter((item) => item !== undefined);
    }
    const output = {};
    for (const key of Object.keys(value)) {
      if (key === 'signal' || key === 'abortController') continue;
      const child = serialize(value[key], depth + 1);
      if (child === undefined) continue;
      output[key] = child;
    }
    return output;
  }

  // 将操作结果格式化为给大模型看的内容：仅输出 result 本身；
  // 顶层字符串直接原样返回（非 JSON 更直观）；结构化数据用 JSON 风格输出，
  // 但字符串内的特殊字符不转义，含换行符的字符串用三引号包裹。
  function formatResult(value, depth = 0) {
    if (value === null || value === undefined) return 'null';
    const type = typeof value;
    if (type === 'string') {
      const text = String(value);
      if (depth === 0) return text;
      return /[\r\n]/.test(text) ? `"""${text}"""` : `"${text}"`;
    }
    if (type === 'number' || type === 'boolean') return String(value);
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      const items = value.map((item) => `${childIndent}${formatResult(item, depth + 1)}`);
      return `[\n${items.join(',\n')}\n${indent}]`;
    }
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    const entries = keys.map((key) => {
      const keyText = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? key
        : formatResult(key, depth + 1);
      return `${childIndent}${keyText}: ${formatResult(value[key], depth + 1)}`;
    });
    return `{\n${entries.join(',\n')}\n${indent}}`;
  }

  // 去掉结果中冗余的 ok 字段（识别器等底层结果常带 ok 标记）。
  function withoutOk(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'ok')) {
      const { ok, ...rest } = value;
      return rest;
    }
    return value;
  }

  function compactLoginResult(value) {
    const result = value && typeof value === 'object' ? value : {};
    const loginState = String(result.loginState || '').toLowerCase();
    const ok = typeof result.ok === 'boolean'
      ? result.ok
      : (typeof result.loggedIn === 'boolean' ? result.loggedIn : (loginState ? loginState === 'online' : true));
    if (ok) return { ok: true };
    return {
      ok: false,
      message: String(result.message || '登录失败')
    };
  }

  async function sendRuntimeMessage(message) {
    if (typeof chrome !== 'object' || !chrome?.runtime?.sendMessage) {
      throw new Error('当前环境不支持消息通信');
    }
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome?.runtime?.lastError;
          if (error) {
            reject(new Error(String(error.message || '消息发送失败')));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function veHomework() {
    return requireGlobal('BjtuVeHomeworkCore');
  }

  async function getEnabledOperationSet() {
    try {
      const stored = await chrome?.storage?.local?.get?.(['qwenEnabledOperations']) || {};
      const list = stored?.qwenEnabledOperations;
      return Array.isArray(list) ? new Set(list.map((item) => String(item).trim())) : null;
    } catch {
      return null;
    }
  }

  let moduleAvailabilityCache = null;
  async function getModuleAvailability() {
    if (moduleAvailabilityCache) return moduleAvailabilityCache;
    let availability = {};
    try {
      const registry = global.BjtuModuleRegistry;
      if (registry && typeof registry?.ready?.then === 'function') {
        const resolved = await registry.ready;
        availability = resolved || {};
      }
    } catch {
      availability = {};
    }
    moduleAvailabilityCache = availability;
    return availability;
  }

  const ACADEMIC_DIRECT = {
    currentAccount: { fn: 'getContext', type: 'ACADEMIC_GET_CONTEXT' },
    scores: { fn: 'loadScores', type: 'ACADEMIC_LOAD_SCORES' },
    scoreSemesters: { fn: 'loadScoreSemesters', type: 'ACADEMIC_SCORE_SEMESTERS' },
    exams: { fn: 'loadExams', type: 'ACADEMIC_LOAD_EXAMS' },
    schedule: { fn: 'loadSchedule', type: 'ACADEMIC_LOAD_SCHEDULE' },
    login: { fn: 'loginWithPassword', type: 'ACADEMIC_LOGIN_WITH_PASSWORD' },
    loginSaved: { fn: 'loginSavedAccount', type: 'ACADEMIC_SWITCH_ACCOUNT' }
  };

  async function academicInvoke(kind, args, timeoutMs = 90000) {
    const direct = ACADEMIC_DIRECT[kind];
    const internals = typeof requireGlobal === 'function' ? requireGlobal('BjtuAcademicSystemInternals') : null;
    const fn = internals?.[direct?.fn];
    if (typeof fn === 'function') return fn(args);
    return sendRuntimeMessage({ type: direct?.type, payload: args }, timeoutMs);
  }

  const CAS_DIRECT = {
    currentAccount: { fn: 'getContext', type: 'CAS_GET_CONTEXT' },
    login: { fn: 'loginWithPassword', type: 'CAS_LOGIN_WITH_PASSWORD' },
    loginSaved: { fn: 'loginSavedAccount', type: 'CAS_SWITCH_ACCOUNT' },
    autoLogin: { fn: 'autoLoginSavedAccount', type: 'CAS_AUTO_LOGIN' }
  };

  async function casInvoke(kind, args, timeoutMs = 120000) {
    const direct = CAS_DIRECT[kind];
    const internals = typeof requireGlobal === 'function' ? requireGlobal('BjtuCasSystemInternals') : null;
    const fn = internals?.[direct?.fn];
    if (typeof fn === 'function') return fn(args);
    if (!direct?.type) throw new Error('模块 BjtuCasSystemInternals 未安装或未就绪');
    return sendRuntimeMessage({ type: direct.type, payload: args }, timeoutMs);
  }

  const MAIL_DIRECT = {
    status: { fn: 'getContext', type: 'MAIL_GET_CONTEXT' },
    inbox: { fn: 'checkNow', type: 'MAIL_LOAD_THREADS' },
    user: { fn: 'getUserInfo', type: 'MAIL_GET_USER_INFO' }
  };

  async function mailInvoke(kind, args, timeoutMs = 240000) {
    const direct = MAIL_DIRECT[kind];
    const internals = typeof requireGlobal === 'function' ? requireGlobal('BjtuMailSystemInternals') : null;
    const fn = internals?.[direct?.fn];
    if (typeof fn === 'function') return fn(args);
    return sendRuntimeMessage({ type: direct?.type, payload: args }, timeoutMs);
  }

  // 轮询等待登录完成；超时返回 null。
  async function waitForLoginPoll(check, { timeoutMs = 180000, intervalMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let value = null;
      try {
        value = await check();
        if (value) return value;
      } catch {
        // 单次探测失败继续轮询
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  const VE_GET_USER_INFO_URL = 'http://123.121.147.7:88/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo';

  // 智慧课程平台会话检测：getUserInfo 返回 loginName 即视为已登录。
  async function vePortalAccount() {
    const core = requireGlobal('BjtuVeHomeworkCore');
    const { text } = await core.requestText(VE_GET_USER_INFO_URL, {
      method: 'GET', timeoutMs: 8000,
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });
    const data = JSON.parse(String(text || '').trim());
    const loginName = String(data?.result?.loginName || '').trim();
    if (!loginName) return null;
    return { loginName, userName: String(data?.result?.userName || '') };
  }

  async function casLoginServiceVe() {
    let existing = null;
    try { existing = await vePortalAccount(); } catch { existing = null; }
    if (existing) return { ok: true, service: 've', alreadyLoggedIn: true, ...existing };
    const tab = await globalThis.BjtuTabs.create({
      url: 'http://123.121.147.7:88/oauth/api/user/thirdLogin', active: true
    });
    const account = await waitForLoginPoll(() => vePortalAccount());
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    if (!account) throw new Error('等待智慧课程平台登录超时，请在打开的标签页中完成 CAS 登录后重试');
    return { ok: true, service: 've', ...account };
  }

  async function casLoginServiceAcademic() {
    const internals = requireGlobal('BjtuAcademicSystemInternals');
    const probe = await internals.probeLoginState().catch(() => ({ loggedIn: false }));
    if (probe?.loggedIn) return { ok: true, service: 'academic', alreadyLoggedIn: true };
    await sendRuntimeMessage({ type: 'START_ACADEMIC_MIS_LOGIN', payload: {} }, 30000);
    const verified = await waitForLoginPoll(async () => {
      const state = await internals.probeLoginState();
      return state?.loggedIn === true ? true : null;
    });
    if (!verified) throw new Error('等待教务系统登录超时，请在打开的标签页中完成 CAS 登录后重试');
    const context = await internals.getContext().catch(() => null);
    const studentId = String(context?.studentId || '');
    const account = (Array.isArray(context?.accounts) ? context.accounts : [])
      .find((item) => item.loginName === studentId) || null;
    return { ok: true, service: 'academic', studentId, userName: String(account?.userName || '') };
  }

  async function resolveMailSidWithCasFallback() {
    const mailInternals = requireGlobal('BjtuMailSystemInternals');
    try {
      const sid = await mailInternals.resolveMailSid();
      if (sid) return { sid, headless: true };
    } catch {
      // CAS 未登录时走下方流程
    }
    let headless = false;
    try {
      const casInternals = requireGlobal('BjtuCasSystemInternals');
      const context = await casInternals.getContext();
      const account = (Array.isArray(context?.accounts) ? context.accounts : [])
        .find((item) => item.hasPassword);
      if (account) {
        const result = await casInternals.loginSavedAccount({ loginName: account.loginName });
        headless = result?.ok !== false;
      }
    } catch {
      headless = false;
    }
    try {
      const sid = await mailInternals.resolveMailSid();
      return { sid, headless };
    } catch {
      return null;
    }
  }

  async function casLoginServiceMail() {
    const mailInternals = requireGlobal('BjtuMailSystemInternals');
    const resolved = await resolveMailSidWithCasFallback();
    if (resolved?.sid) return { ok: true, service: 'mail', sid: resolved.sid, viaSavedPassword: resolved.headless === true };
    const tab = await globalThis.BjtuTabs.create({
      url: 'https://mis.bjtu.edu.cn/osys_sso_email/', active: true
    });
    const sid = await waitForLoginPoll(() => mailInternals.resolveMailSid().catch(() => null));
    if (!sid) throw new Error('等待邮箱登录超时，请在打开的标签页中完成 CAS 登录后重试');
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    return { ok: true, service: 'mail', sid };
  }

  async function moocInvoke(args, timeoutMs = 120000) {
    const bg = typeof requireGlobal === 'function' ? requireGlobal('BjtuMoocBackground') : null;
    const fn = bg?.handleRequest;
    if (typeof fn === 'function') {
      try {
        const data = await fn(args);
        return data;
      } catch (error) {
        return { ok: false, code: String(error?.code || ''), message: String(error?.message || error || '中国大学MOOC请求失败') };
      }
    }
    return sendRuntimeMessage({ type: 'MOOC_REQUEST', payload: args }, timeoutMs);
  }

  // 经扩展 app 页面的消息桥调用平台页面级接口（学生列表/课件/回放/归档/雨课堂等）。
  // 注意：这些功能依赖页面上下文，需要已打开 app 页面且相关平台已登录。
  async function pageInvoke(module, fn, args, timeoutMs = 90000) {
    const response = await sendRuntimeMessage({ type: 'PAGE_API', payload: { module, fn, args: args || {} } }, timeoutMs);
    if (!response?.ok) {
      throw Object.assign(new Error(String(response?.error || `${module}.${fn} 调用失败`)), { code: response?.code || '' });
    }
    return response.value;
  }

  function parseDeadline(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 && value < 1e12 ? value * 1000 : value;
    }
    const ms = Date.parse(String(value).replace(/-/g, '/'));
    return Number.isFinite(ms) ? ms : 0;
  }

  function normalizeAssignmentStatus(value) {
    const s = String(value ?? 'all').trim().toLowerCase();
    if (s === 'submitted' || s === 'done' || s === 'completed' || s === '已交' || s === '已提交') return 'submitted';
    if (s === 'pending' || s === '未交' || s === 'unsubmitted' || s === 'todo') return 'pending';
    if (s === 'overdue' || s === '逾期' || s === 'expired') return 'overdue';
    return 'all';
  }

  function computeAssignmentStatus(done, overdue) {
    if (done) return 'submitted';
    if (overdue) return 'overdue';
    return 'pending';
  }

  function buildAssignmentItem(key, platform, courseName, title, type, status, deadline, actionUrl) {
    return {
      key: String(key || ''),
      platform: String(platform || ''),
      courseName: String(courseName || ''),
      title: String(title || ''),
      type: String(type || 'all'),
      status: String(status || 'pending'),
      deadline: Number(deadline) || 0,
      actionUrl: String(actionUrl || '')
    };
  }

  const VE_SUBTYPE_LABELS = { 0: '作业', 1: '课程报告', 2: '实验' };

  function veSubTypeLabel(subType) {
    return VE_SUBTYPE_LABELS[Number(subType ?? 0)] || '作业';
  }

  function veUploadedFilesPayload(items) {
    const records = Array.isArray(items) ? items : [];
    const fileList = [];
    for (const item of records) {
      const fileName = String(item?.fileName || '').trim();
      const visitName = String(item?.visitName || '').trim();
      const fileSize = Math.max(0, Number(item?.fileSize || 0) || 0);
      if (!visitName || !fileName) continue;
      const dot = fileName.lastIndexOf('.');
      const fileNameNoExt = dot > 0 && dot < fileName.length - 1 ? fileName.slice(0, dot) : fileName;
      const fileExtName = dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1) : '';
      fileList.push({
        fileNameNoExt: encodeURIComponent(fileNameNoExt),
        fileExtName,
        fileSize: String(fileSize),
        visitName,
        pid: '',
        ftype: 'insert'
      });
    }
    return { fileList };
  }

  function veAssignmentActionUrl(course, courseId, subType) {
    const courseToPage = ({ 0: 10460, 1: 10461, 2: 10462 })[Number(subType ?? 0)] || 10460;
    const courseNum = course?.course_num || course?.courseNum || course?.courseNo || course?.course_id || courseId;
    const fzId = course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '';
    const xqCode = course?.xq_code || course?.xqCode || '';
    return `${global.BjtuVeHomeworkCore?.BASE_VE || ''}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=${courseToPage}&courseId=${encodeURIComponent(courseNum)}&cId=${encodeURIComponent(courseId)}&xknId=${encodeURIComponent(fzId)}&xkhId=${encodeURIComponent(fzId)}&xqCode=${encodeURIComponent(xqCode)}`;
  }

  function yktIsHomeworkDone(hw) {
    if (Number(hw?.__actype ?? hw?.actype) === 15) {
      const taskProgress = Number(hw?.progress);
      if (Number.isFinite(taskProgress)) return taskProgress >= 0.9995;
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
    if (hw?.done != null) return !!hw?.done;
    if (hw?.unfinished != null) return Number(hw?.unfinished) === 0;
    return false;
  }

  async function findVeCourseById(courseId) {
    const core = await veHomework();
    const terms = await core.fetchTerms();
    const xqCode = core.chooseTermCode(terms);
    const courses = await core.fetchCourses(xqCode);
    const target = String(courseId || '').trim();
    const course = (Array.isArray(courses) ? courses : []).find((c) => String(core.getCourseId(c) || '') === target) || null;
    return { core, xqCode, courses: Array.isArray(courses) ? courses : [], course };
  }

  // 校验“针对某课程/班级 id”的操作参数：id 缺失或不在当前课程列表中时报错并说明如何获取有效 id。
  async function assertCourseIdOf(module, id, idLabel = 'courseId') {
    const value = String(id || '').trim();
    if (!value) throw new Error(`缺少参数 ${idLabel}，请先调用 ${module}.courseList 获取有效ID`);
    if (module === 've') {
      const found = await findVeCourseById(value);
      if (!found?.course) throw new Error(`课程ID无效：${value} 不在当前学期课程列表中，请先调用 ve.courseList 获取有效ID`);
    } else if (module === 'mooc') {
      try {
        const data = await moocInvoke({ action: 'course-list' }, 120000);
        const known = (Array.isArray(data?.data) ? data.data : []).map((c) => String(c?.id ?? c?.courseId ?? '').trim()).filter(Boolean);
        if (known.length && !known.includes(value)) throw new Error(`课程ID无效：${value} 不在中国大学MOOC课程列表中，请先调用 mooc.courseList 获取有效ID`);
      } catch (error) {
        if (error?.message && String(error?.message).startsWith('课程ID无效')) throw error;
      }
    } else if (module === 'ykt') {
      try {
        const data = await pageInvoke('ykt', 'courseList', {}, 120000);
        if (data?.loggedIn === false) throw Object.assign(new Error('雨课堂未登录，请先调用 ykt.login'), { code: 'LOGIN_REQUIRED' });
        const known = (Array.isArray(data?.courses) ? data.courses : []).map((c) => String(c?.classroomId || '').trim()).filter(Boolean);
        if (known.length && !known.includes(value)) throw new Error(`班级ID无效：${value} 不在雨课堂课程列表中，请先调用 ykt.courseList 获取有效ID`);
      } catch (error) {
        if (isLoginRequiredError(error)) throw error;
        if (error?.message && String(error?.message).startsWith('班级ID无效')) throw error;
      }
    }
  }

  const OPERATIONS = [
    {
      module: 've',
      name: 've.currentUser',
      label: '当前登录用户',
      summary: '获取智慧课程平台当前登录账号的用户信息',
      doc: [
        '## ve.currentUser —— 当前登录用户',
        '',
        '获取智慧课程平台当前登录账号的信息。',
        '',
        '**调用示例**：`ve.currentUser()`',
        '',
        '**返回示例**：{"userId":"...","userName":"张三","loginName":"zhangsan","roleCode":"student","roleName":"学生"}',
        '未登录时返回 {"ok":false,"code":"LOGIN_REQUIRED"}。'
      ].join('\n'),
      async run() {
        const core = await veHomework();
        const user = await core.fetchCurrentUserInfo();
        if (!user) throw loginRequiredError();
        return serialize(user);
      }
    },
    {
      module: 've',
name: 've.accounts',
      label: '登录历史账号',
      summary: '列出智慧课程平台登录历史中的账号',
      doc: [
        '## ve.accounts —— 登录历史账号',
        '',
        '列出智慧课程平台登录历史中的账号（不含密码等敏感字段），并按最近登录时间排序。',
        '',
        '**调用示例**：`ve.accounts()`',
        '',
        '**返回示例**：[{"loginName":"zhangsan","userName":"张三","roleName":"学生","lastLoginAt":1735689600000}]'
      ].join('\n'),
      async run() {
        const store = requireGlobal('BjtuAccountStore');
        const stored = await chrome.storage.local.get('loginAccountHistory');
        const history = Array.isArray(stored?.loginAccountHistory) ? stored.loginAccountHistory : [];
        const detailById = new Map();
        for (const record of history) {
          const loginName = String(record?.loginName || record?.userId || '').trim();
          if (!loginName || detailById.has(loginName)) continue;
          const item = await store.get(loginName).catch(() => null);
          detailById.set(loginName, item || null);
        }
        return history
          .map((record) => {
            const loginName = String(record?.loginName || record?.userId || '').trim();
            const detail = detailById.get(loginName) || {};
            return {
              loginName,
              userName: String(detail?.userName || record?.userName || ''),
              roleName: String(detail?.roleName || record?.roleName || ''),
              quickUsername: String(detail?.quickUsername || ''),
              lastLoginAt: Number(record?.lastLoginAt || 0) || 0
            };
          })
          .filter((item) => item.loginName);
      }
    },
    {
      module: 've',
      name: 've.terms',
      label: '学期列表',
      summary: '获取智慧课程平台学期列表，并返回当前学期代码',
      doc: [
        '## ve.terms —— 学期列表',
        '',
        '获取智慧课程平台当前的学期列表，并给出建议使用的学期代码。',
        '',
        '**调用示例**：`ve.terms()`',
        '',
        '**返回示例**：{"terms":[{"xqCode":"2025-2026-1","xqName":"2025-2026学年第一学期","currentFlag":2}],"recommended":"2025-2026-1"}'
      ].join('\n'),
      async run() {
        const core = await veHomework();
        const terms = await core.fetchTerms();
        const recommended = core.chooseTermCode(terms);
        return { terms: serialize(terms), recommended };
      }
    },
    {
      module: 've',
      name: 've.courseList',
      label: '课程列表',
      summary: '获取智慧课程平台的课程列表',
      doc: [
        '## ve.courseList —— 课程列表',
        '',
        '获取智慧课程平台的课程列表。若不传 xqCode 则自动使用当前学期。',
        '',
        '**参数**：{"xqCode":"可选，学期代码，如 2025-2026-1"}',
        '',
        '**调用示例**：`ve.courseList()`',
        '',
        '**返回示例**：[{"id":"...","name":"高等数学","teacherName":"..."}]',
        '返回的每一项至少包含 id（课程ID）、name（课程名）。'
      ].join('\n'),
      async run(args) {
        const core = await veHomework();
        let xqCode = String(args?.xqCode || '').trim();
        if (!xqCode) {
          const terms = await core.fetchTerms();
          xqCode = core.chooseTermCode(terms);
        }
        const courses = await core.fetchCourses(xqCode);
        return (Array.isArray(courses) ? courses : []).map((course) => ({
          id: core.getCourseId(course),
          name: core.getCourseName(course),
          teacherName: String(course?.teacher_name || course?.teacherName || course?.fzr || ''),
          courseNum: String(course?.course_num || course?.courseNum || course?.course_id || '')
        }));
      }
    },
    {
      module: 've',
      name: 've.assignments_of_',
      label: '课程作业',
      summary: '获取指定智慧课程平台课程的作业列表',
      doc: [
        '## ve.assignments_of_ —— 课程作业',
        '',
        '获取指定课程的作业列表（含已交/未交）。courseId 为课程ID，可先调用 ve.courseList 获取。若有已交作业的成绩暂未公布，会临时公布成绩、重新获取结果，并在返回前立即取消公布。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.assignments_of_({courseId: "xxx"})`；也可直接按课程名组合调用：`ve.assignments_of_({ courseId: ve.courseList().find(item => item.name === "高等数学").id })`',
        '',
        '**返回示例**：[{"id":"...","title":"作业标题","end_time":"2026-01-01 00:00:00","subStatus":"未提交"}]'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        const core = await veHomework();
        let list = await core.fetchCourseHomework(courseId);
        const unpublishedIds = typeof core.getUnpublishedDoneScoreHomeworkIds === 'function'
          ? core.getUnpublishedDoneScoreHomeworkIds(list)
          : [];
        if (unpublishedIds.length && typeof core.setHomeworkScoreDisplayStatus === 'function') {
          const openedIds = [];
          let primaryError = null;
          let closeError = null;
          try {
            for (const homeworkId of unpublishedIds) {
              await core.setHomeworkScoreDisplayStatus(homeworkId, 1);
              openedIds.push(homeworkId);
            }
            list = await core.fetchCourseHomework(courseId, { previousList: list });
          } catch (error) {
            primaryError = error;
          } finally {
            const results = await Promise.allSettled(openedIds.map((homeworkId) => (
              core.setHomeworkScoreDisplayStatus(homeworkId, 2)
            )));
            const rejected = results.find((result) => result.status === 'rejected');
            if (rejected) closeError = rejected.reason;
          }
          if (primaryError) throw primaryError;
          if (closeError) throw new Error(`取消公布作业成绩失败：${String(closeError?.message || closeError)}`);
        }
        return serialize(list);
      }
    },
    {
      module: 've',
      name: 've.uploadFile',
      label: '上传文件',
      summary: '向智慧课程平台上传文件并返回下载链接和可直接提交的 fileList',
      doc: [
        '## ve.uploadFile —— 上传文件',
        '',
        '向智慧课程平台上传文件，直接返回可下载链接和可原样传给 ve.submitAssignment 的 fileList。不提供文件内容来源时，会直接触发 app.html 的 #file-input（与点击 #drop-zone 相同），支持选择多个本地文件。上传过程会显示在 #file-list 中。',
        '',
        '**参数**：不传参数时由用户选择本地文件，可用 accept 限制文件类型；也可传 fileName，并从 text/content（文本）、base64/dataBase64、bytes（0~255 数组）或 url 四种可序列化来源中选择一种；mimeType 可选。使用 url 时若省略 fileName，会从 URL 推断。',
        '',
        '**调用示例**：`ve.uploadFile()`；`ve.uploadFile({accept:".pdf,.doc,.docx"})`；`ve.uploadFile({fileName:"answer.txt", text:"作业内容", mimeType:"text/plain"})`',
        '',
        '**返回示例**：`{"files":[{"fileName":"answer.txt","fileSize":12,"mimeType":"text/plain","downloadUrl":"http://..."}],"fileList":[{"fileNameNoExt":"answer","fileExtName":"txt","fileSize":"12","visitName":"...","pid":"","ftype":"insert"}]}`。无论上传一个还是多个文件，均返回这一结构。'
      ].join('\n'),
      async run(args) {
        return pageInvoke('ve', 'uploadFile', args || {}, 120000);
      }
    },
    {
      module: 've',
      name: 've.uploadedFiles',
      label: '获取已上传文件',
      summary: '获取智慧课程平台可直接提交的已上传文件 fileList',
      doc: [
        '## ve.uploadedFiles —— 获取已上传文件',
        '',
        '获取扩展本地保存的智慧课程平台已上传文件，返回可直接传给 ve.submitAssignment 的 fileList。',
        '',
        '**路径映射**：visitName 中的 `W:\\Root\\` 路径前缀就是 `http://123.121.147.7:8081/rp`；将其后的反斜杠改为正斜杠即可得到对应的 HTTP 文件地址。',
        '',
        '**调用示例**：`ve.uploadedFiles()`',
        '',
        '**返回示例**：`{"fileList":[{"fileNameNoExt":"%E4%BD%9C%E4%B8%9A","fileExtName":"pdf","fileSize":"12345","visitName":"W:\\\\Root\\\\example.pdf","pid":"","ftype":"insert"}]}`'
      ].join('\n'),
      async run() {
        const current = await pageInvoke('ve', 'uploadedFiles', { includePrivate: true }).catch(() => []);
        if (Array.isArray(current) && current.length) return veUploadedFilesPayload(current);
        const stored = await chrome.storage.local.get('savedUploadedFiles').catch(() => ({}));
        return veUploadedFilesPayload((Array.isArray(stored?.savedUploadedFiles) ? stored.savedUploadedFiles : []).map((item) => ({
          fileName: String(item?.fileName || '').trim(),
          fileSize: Math.max(0, Number(item?.fileSize || 0) || 0),
          url: String(item?.url || '').trim(),
          visitName: String(item?.visitName || '').trim()
        })));
      }
    },
    {
      module: 've',
      name: 've.submitAssignment',
      label: '提交作业',
      summary: '向智慧课程平台指定课程提交作业正文和已上传附件',
      doc: [
        '## ve.submitAssignment —— 提交作业',
        '',
        '提交智慧课程平台作业。assignmentId 可从 ve.assignments_of_ 获取；附件可直接使用 ve.uploadFile 返回的 fileList，无需再调用 ve.uploadedFiles。正文与附件至少提供一项。',
        '',
        '**参数**：{"courseId":"课程ID，必填","assignmentId":"作业ID，必填","content":"正文，可选","fileList":"ve.uploadFile 返回的 fileList 数组，可选"}',
        '',
        '**调用示例**：`const uploaded = await ve.uploadFile(); return ve.submitAssignment({courseId: "xxx", assignmentId: "yyy", content: "作业正文", fileList: uploaded.fileList})`',
        '',
        '**返回示例**：{"submitted":true,"courseId":"xxx","assignmentId":"yyy","fileCount":1}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        const assignmentId = String(args?.assignmentId || '').trim();
        const content = String(args?.content || '');
        const directFileList = (Array.isArray(args?.fileList) ? args.fileList : []).map((item) => ({
          fileNameNoExt: String(item?.fileNameNoExt || '').trim(),
          fileExtName: String(item?.fileExtName || '').trim(),
          fileSize: String(Math.max(0, Number(item?.fileSize || 0) || 0)),
          visitName: String(item?.visitName || '').trim(),
          pid: '',
          ftype: 'insert',
          __homeworkFileListReady: true
        })).filter((item) => item.fileNameNoExt && item.visitName);
        await assertCourseIdOf('ve', courseId);
        if (!assignmentId) throw new Error('缺少参数 assignmentId');
        if (!content.trim() && !directFileList.length) throw new Error('作业正文与附件不能同时为空');
        const core = await veHomework();
        const assignments = await core.fetchCourseHomework(courseId);
        const homework = assignments.find((item) => String(core.homeworkKey(item) || '') === assignmentId);
        if (!homework) throw new Error(`作业ID无效：${assignmentId} 不在该课程作业列表中`);
        return core.submitHomework(courseId, homework, content, directFileList);
      }
    },
    {
      module: 've',
      name: 've.assignments',
      label: '全平台作业查询',
      summary: '按状态与类型查询智慧课程平台所有课程的作业',
      doc: [
        '## ve.assignments —— 全平台作业查询',
        '',
        '直接筛选 ve.login 完成后 app.html 已加载的当前学期作业，不会重新请求课程或作业。平台未启用或未完成登录时，请先调用 ve.login()。status：all（全部，默认）/ pending（未交）/ submitted（已交）/ overdue（逾期）。type：all（默认）/ 作业 / 课程报告 / 实验。',
        '',
        '**参数**：{"status":"all|pending|submitted|overdue，默认 all","type":"all|作业|课程报告|实验，默认 all"}',
        '',
        '**调用示例**：`ve.assignments({status: "pending", type: "作业"})`',
        '',
        '**返回示例**：{"total":1,"items":[{"key":"...","platform":"智慧课程平台","courseName":"课程名","title":"作业标题","type":"作业","status":"pending","deadline":1234567890000,"actionUrl":"..."}]}'
      ].join('\n'),
      async run(args) {
        const status = normalizeAssignmentStatus(args?.status);
        const typeFilter = String(args?.type ?? 'all').trim();
        const core = await veHomework();
        const snapshot = await pageInvoke('ve', 'assignmentSnapshot', {}, 120000);
        const courses = Array.isArray(snapshot?.courses) ? snapshot.courses : [];
        const now = Date.now();
        const items = [];
        for (const entry of courses.slice(0, 60)) {
          const course = entry?.course || {};
          const courseId = core.getCourseId(course);
          if (!courseId) continue;
          for (const hw of (Array.isArray(entry?.homework) ? entry.homework : [])) {
            const type = veSubTypeLabel(hw?.subType ?? hw?.sub_type);
            if (typeFilter !== 'all' && type !== typeFilter) continue;
            const done = core.isHomeworkDone(hw);
            const deadline = core.parseDeadline(hw?.end_time ?? hw?.endTime ?? '');
            const overdue = !done && deadline > 0 && deadline < now;
            const st = computeAssignmentStatus(done, overdue);
            if (status !== 'all' && st !== status) continue;
            const title = String(hw?.title || hw?.workTitle || hw?.courseNoteTitle || '未命名作业').trim();
            items.push(buildAssignmentItem(
              `ve:${courseId}:${hw?.id ?? hw?.noteId ?? hw?.upId ?? title}`,
              '智慧课程平台', core.getCourseName(course), title, type, st, deadline,
              veAssignmentActionUrl(course, courseId, hw?.subType ?? hw?.sub_type)
            ));
          }
        }
        return { total: items.length, items: items.slice(0, 300) };
      }
    },
    {
      module: 've',
      name: 've.login',
      label: '智慧课程平台登录',
      summary: '按需启用并登录智慧课程平台（可指定账号）',
      doc: [
        '## ve.login —— 智慧课程平台登录',
        '',
        '平台尚未启用时会启用并触发登录；平台已经启用时不会重复启用或登录。省略账号时使用当前账号；指定账号与当前会话账号不同时仍会切换账号。操作会等待密码/验证码/错误恢复弹窗关闭，并等待智慧课程平台的作业全部加载完毕后再返回。',
        '',
        '**参数**：`{"account":"可选，账号；省略时使用当前填写的账号"}`',
        '',
        '**调用示例**：`ve.login()` 使用当前账号；`ve.login({account: "2428xxxx"})` 切换到指定账号并登录',
        '',
        '指定账号时会等待密码/验证码弹窗关闭，并返回该目标账号本次是否登录成功；已有的其他账号会话不会被当作成功。',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run(args) {
        const account = String(args?.account || args?.loginName || '').trim();
        const result = await pageInvoke('ve', 'login', { account, auto: true });
        return compactLoginResult(result);
      }
    },
    {
      module: 've',
name: 've.teachers_of_',
      label: '课程老师列表',
      summary: '获取智慧课程平台指定课程的老师与助教列表',
      doc: [
        '## ve.teachers_of_ —— 课程老师列表',
        '',
        '获取指定课程的老师与助教列表（含 userType：1=任课教师 2=助教）。courseId 可先调用 ve.courseList 获取。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.teachers_of_({courseId: "xxx"})`',
        '',
        '**返回示例**：[{"userName":"张三","loginName":"zhangsan","userType":"1"}]'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        const core = await veHomework();
        const list = await core.fetchCourseTeachers(courseId);
        return serialize(list);
      }
    },
    {
      module: 've',
      name: 've.students_of_',
      label: '课程学生列表',
      summary: '获取智慧课程平台指定课程的学生列表',
      doc: [
        '## ve.students_of_ —— 课程学生列表',
        '',
        '获取指定课程的学生列表。courseId 可先调用 ve.courseList 获取。需要已打开助手页面并登录智慧课程平台。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.students_of_({courseId: "xxx"})`',
        '',
        '**返回示例**：{"students":[{"groupName":"组名","stuNo":"学号","stuName":"姓名","className":"班级"}],"total":60}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        return pageInvoke('ve', 'students', { courseId }, 120000);
      }
    },
    {
      module: 've',
      name: 've.courseware_of_',
      label: '课件列表',
      summary: '获取智慧课程平台指定课程的课件列表',
      doc: [
        '## ve.courseware_of_ —— 课件列表',
        '',
        '获取指定课程的课件列表，每个课件均直接附带真实下载链接（无需再单独获取）。courseId 可先调用 ve.courseList 获取。需要已打开助手页面并登录。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.courseware_of_({courseId: "xxx"})`',
        '',
        '**返回示例**：{"loginRequired":false,"items":[{"id":"...","name":"课件名","extName":"pdf","rpId":"...","sizeMb":2.3,"url":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        const { core, course } = await findVeCourseById(courseId);
        const courseNum = String(course?.course_num || course?.courseNum || course?.courseNo || course?.course_id || courseId).trim();
        const fzId = String(course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '').trim();
        if (!courseNum || !fzId) throw new Error(`课程ID无效：${courseId} 缺少课件所需参数（课程号/课序号）`);
        return pageInvoke('ve', 'coursewareItems', { courseNum, xkhId: fzId }, 120000);
      }
    },
    {
      module: 've',
      name: 've.replay_of_',
      label: '课程回放列表',
      summary: '获取智慧课程平台指定课程的回放列表',
      doc: [
        '## ve.replay_of_ —— 课程回放列表',
        '',
        '获取指定课程的回放列表及实际视频地址。每项按视角返回 student（学生）、teacher（老师）、courseware（课件）链接。courseId 可先调用 ve.courseList 获取。需要已打开助手页面并登录。',
        '',
        '**参数**：{"courseId":"课程ID，必填","views":["student","teacher","courseware"],"forceReload":false}。views 可省略，默认获取全部三种视角；也可传入其中一项或多项，并兼容中文“学生”“老师”“课件”。',
        '',
        '**调用示例**：`ve.replay_of_({courseId: "xxx"})`；只查看学生和课件视角：`ve.replay_of_({courseId: "xxx", views: ["student", "courseware"]})`',
        '',
        '**返回示例**：[{"name":"回放名","teacherName":"老师","startTime":"...","endTime":"...","links":{"student":"https://...","teacher":"https://...","courseware":"https://..."}}]。不再返回内部 videoId。'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        const { course } = await findVeCourseById(courseId);
        const courseNum = String(course?.course_num || course?.courseNum || course?.courseNo || course?.course_id || courseId).trim();
        const fzId = String(course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '').trim();
        if (!courseNum || !fzId) throw new Error(`课程ID无效：${courseId} 缺少回放所需参数（课程号/课序号）`);
        return pageInvoke('ve', 'replayItemsWithLinks', {
          courseId,
          courseNum,
          xkhId: fzId,
          views: args?.views ?? args?.type,
          forceReload: args?.forceReload === true
        });
      }
    },
    {
      module: 've',
      name: 've.archive_of_',
      label: '课程归档列表',
      summary: '获取智慧课程平台指定课程的归档资源列表',
      doc: [
        '## ve.archive_of_ —— 课程归档列表',
        '',
        '获取指定课程的归档资源列表，每个资源均直接附带真实下载链接（无需再单独获取）。courseId 可先调用 ve.courseList 获取。需要已打开助手页面并登录。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.archive_of_({courseId: "xxx"})`',
        '',
        '**返回示例**：{"loginRequired":false,"items":[{"name":"归档名","extName":"pdf","rpId":"...","url":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        return pageInvoke('ve', 'archiveItems', { courseId }, 120000);
      }
    },
    {
      module: 'ykt',
      name: 'ykt.courseList',
      label: '雨课堂课程列表',
      summary: '获取雨课堂的课程列表',
      doc: [
        '## ykt.courseList —— 雨课堂课程列表',
        '',
        '获取雨课堂当前账号的课程列表。需要已打开助手页面并在 yuketang.cn 登录。',
        '',
        '**调用示例**：`ykt.courseList()`',
        '',
        '**返回示例**：{"courses":[{"classroomId":"...","courseName":"课程名","teacher":"老师","universityId":"..."}]}'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('ykt', 'courseList', {}, 120000);
        if (value?.loggedIn === false) return { ok: false, code: 'LOGIN_REQUIRED', message: '雨课堂未登录，请先调用 ykt.login 完成登录后再获取课程列表' };
        return value;
      }
    },
    {
      module: 'ykt',
      name: 'ykt.assignments_of_',
      label: '雨课堂课程作业',
      summary: ' 获取雨课堂指定课程的作业列表',
      doc: [
        '## ykt.assignments_of_ —— 雨课堂课程作业',
        '',
        '根据 classroomId 获取雨课堂指定课程的作业/活动列表。classroomId 可先调用 ykt.courseList 获取。需要已打开助手页面并在 yuketang.cn 登录。',
        '',
        '**参数**：{"classroomId":"班级ID，必填"}',
        '',
        '**调用示例**：`ykt.assignments_of_({classroomId: "xxx"})`',
        '',
        '**返回示例**：{"classroomId":"xxx","homework":[{"id":"...","title":"作业名","actype":15,"activityType":"线上学习","end":"时间","progress":0.75,"done":false,"score":90,"link":"https://..."}]}。线上学习的 progress 为扩展根据内部任务标识获取的 0~1 进度，结果不暴露 leaf_id。'
      ].join('\n'),
      async run(args) {
        const classroomId = String(args?.classroomId || '').trim();
        await assertCourseIdOf('ykt', classroomId, 'classroomId');
        return pageInvoke('ykt', 'courseHomework', { classroomId }, 120000);
      }
    },
    {
      module: 'ykt',
      name: 'ykt.assignments',
      label: '全平台作业查询',
      summary: '按状态与类型查询雨课堂所有课程的作业',
      doc: [
        '## ykt.assignments —— 全平台作业查询',
        '',
        '直接筛选 ykt.login 完成后 app.html 已加载的雨课堂作业，不会重新请求课程或作业。平台未启用或未完成登录时，请先调用 ykt.login()。线上学习任务优先依据扩展获取的 0~1 进度判断：进度完成即为 submitted；仅未完成且超过截止时间时才是 overdue。status：all（默认）/ pending（未交）/ submitted（已交）/ overdue（逾期）。type：all（默认）/ 课堂 / 线上学习 / 试卷 / 公告。',
        '',
        '**参数**：{"status":"all|pending|submitted|overdue，默认 all","type":"all|课堂|线上学习|试卷|公告，默认 all"}',
        '',
        '**调用示例**：`ykt.assignments({status: "pending", type: "试卷"})`',
        '',
        '**返回示例**：{"total":1,"items":[{"key":"ykt:...:...","platform":"雨课堂","courseName":"课程名","title":"作业名","type":"试卷","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const status = normalizeAssignmentStatus(args?.status);
        const typeFilter = String(args?.type ?? 'all').trim();
        const snapshot = await pageInvoke('ykt', 'assignmentSnapshot', {}, 120000);
        const courses = Array.isArray(snapshot?.courses) ? snapshot.courses : [];
        const now = Date.now();
        const items = [];
        for (const course of courses.slice(0, 60)) {
          const cid = String(course?.classroomId || '').trim();
          if (!cid) continue;
          const homework = Array.isArray(course?.homework) ? course.homework : [];
          for (const h of homework) {
            const type = String(h?.activityType || '').trim() || 'all';
            if (typeFilter !== 'all' && type !== typeFilter) continue;
            const isClassroomActivity = Number(h?.__actype ?? h?.actype) === 14;
            const deadline = isClassroomActivity ? 0 : parseDeadline(h?.end);
            const done = yktIsHomeworkDone(h);
            const overdue = isClassroomActivity
              ? (!done && h?.is_finished === true)
              : (!done && deadline > 0 && deadline < now);
            const st = computeAssignmentStatus(done, overdue);
            if (status !== 'all' && st !== status) continue;
            items.push(buildAssignmentItem(
              `ykt:${cid}:${h?.id}`, '雨课堂', String(course?.courseName || ''),
              String(h?.title || ''), type, st, deadline, String(h?.link || '')
            ));
          }
        }
        return { total: items.length, items: items.slice(0, 300) };
      }
    },
    {
      module: 'ykt',
      name: 'ykt.login',
      label: '雨课堂登录',
      summary: '按需启用并触发雨课堂登录流程',
      doc: [
        '## ykt.login —— 雨课堂登录',
        '',
        '雨课堂尚未启用时才启用并触发登录流程；已经启用时直接返回当前状态，不重复加载或弹出扫码/授权窗口。',
        '',
        '**调用示例**：`ykt.login()`',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run() {
        return compactLoginResult(await pageInvoke('ykt', 'login', { timeoutMs: Number.POSITIVE_INFINITY }));
      }
    },
    {
      module: 'academic',
      name: 'academic.currentAccount',
      label: '教务系统当前账号',
      summary: '获取教务系统当前登录账号及监控配置',
      doc: [
        '## academic.currentAccount —— 教务系统当前账号',
        '',
        '获取教务系统当前登录的学号、已保存账号与各项监控开关状态。',
        '',
        '**调用示例**：`academic.currentAccount()`',
        '',
        '**返回示例**：{"studentId":"...","accounts":[{"studentId":"...","userName":"张三","hasPassword":true}],"monitorEnabled":true}'
      ].join('\n'),
      async run() {
        return academicInvoke('currentAccount');
      }
    },
    {
      module: 'academic',
      name: 'academic.scoreSemesters',
      label: '成绩学期列表',
      summary: '获取教务系统成绩页面实际提供的学期及 zxjxjhh 参数',
      doc: [
        '## academic.scoreSemesters —— 成绩学期列表',
        '',
        '读取教务系统历年成绩页面上的 #zxjxjhh 下拉框，返回当前页面实际提供的学期，而不是使用固定学期列表。需要教务系统已登录。',
        '',
        '**调用示例**：`academic.scoreSemesters()`',
        '',
        '**返回示例**：`{"currentZxjxjhh":"2025-2026-2-2","semesters":[{"label":"2025-2026-2","zxjxjhh":"2025-2026-2-2"},{"label":"2024-2025-2","zxjxjhh":"2024-2025-2-2"}]}`。currentZxjxjhh 通过本学期成绩任意一行的“学年”匹配页面 option 得出；academic.scores 可直接接收这些 zxjxjhh。'
      ].join('\n'),
      async run() {
        return academicInvoke('scoreSemesters', undefined, 120000);
      }
    },
    {
      module: 'academic',
      name: 'academic.scores',
      label: '成绩查询',
      summary: '按一个或多个学期获取教务系统成绩',
      doc: [
        '## academic.scores —— 成绩查询',
        '',
        '按学期查询教务系统成绩。需要教务系统已登录。不传参数时获取当前学期成绩；传入多学期前可先调用 academic.scoreSemesters 获取页面当前实际提供的 zxjxjhh。',
        '',
        '**参数**：zxjxjhh 列表，例如 `["2025-2026-2-2","2024-2025-2-2"]`。也接受 academic.scoreSemesters 返回的 label，但不接受虚拟的当前学期字符串。列表中包含 currentZxjxjhh 时先获取当前学期成绩；包含其他学期时只获取一次完整历年成绩表，再按表格“学年”列筛选。某学期没有成绩时会正常返回空结果。',
        '',
        '**调用示例**：`academic.scores()`；`academic.scores(["2024-2025-2-2","2023-2024-1-2"])`；`academic.scoreSemesters().then(({semesters}) => academic.scores(semesters.map(item => item.zxjxjhh)))`',
        '',
        '**返回示例**：`{"rows":[{"academicYear":"2024-2025-2","courseName":"高等数学","score":"95","credit":"4"}],"selectedSemesters":["2024-2025-2"],"count":1}`'
      ].join('\n'),
      async run(args) {
        const semesters = Array.isArray(args) ? args : args?.semesters;
        return academicInvoke('scores', semesters === undefined ? {} : { semesters }, 120000);
      }
    },
    {
      module: 'academic',
      name: 'academic.exams',
      label: '考试查询',
      summary: '获取教务系统最新考试安排',
      doc: [
        '## academic.exams —— 考试查询',
        '',
        '查询教务系统最新考试安排。需要教务系统已登录。',
        '',
        '**调用示例**：`academic.exams()`',
        '',
        '**返回示例**：{"exams":[{"courseName":"高等数学","examTime":"2026-01-10 09:00"}]}'
      ].join('\n'),
      async run() {
        return academicInvoke('exams', undefined, 120000);
      }
    },
    {
      module: 'academic',
      name: 'academic.schedule',
      label: '课表查询',
      summary: '获取教务系统课表',
      doc: [
        '## academic.schedule —— 课表查询',
        '',
        '查询教务系统课表。支持“本学期课表”和“选课课表”，需要教务系统已登录。',
        '',
        '**参数**：{"scheduleType":"可选，semester（本学期课表，默认）或 selection（选课课表）"}',
        '',
        '**调用示例**：`academic.schedule({scheduleType: "selection"})`',
        '',
        '**返回示例**：{"rows":[{"courseName":"高等数学","weekDay":1,"startSection":1}],"currentWeek":1}'
      ].join('\n'),
      async run(args) {
        const sourceType = String(args?.scheduleType || 'semester').trim();
        const aliases = new Map([
          ['semester', 'semester'],
          ['本学期课表', 'semester'],
          ['selection', 'selection'],
          ['选课课表', 'selection']
        ]);
        const scheduleType = aliases.get(sourceType);
        if (!scheduleType) throw new Error('scheduleType 仅支持 semester（本学期课表）或 selection（选课课表）');
        return academicInvoke('schedule', { scheduleType }, 120000);
      }
    },
    {
      module: 'academic',
      name: 'academic.login',
      label: '教务系统登录',
      summary: '使用当前账号或指定学号及其传入/已保存密码登录教务系统',
      doc: [
        '## academic.login —— 教务系统登录',
        '',
        '登录教务系统。studentId 可省略，此时优先使用当前账号，其次使用最近保存的账号。传入 password 时使用该密码；省略 password 时自动读取所选账号已保存的密码，如果没有可用账号或密码则报错。',
        '',
        '**参数**：{"studentId":"学号，可选；省略时使用当前或最近保存的账号","password":"身份证后六位，可选；省略时使用已保存密码"}',
        '',
        '**调用示例**：`academic.login()`；`academic.login({studentId: "xxx"})`；`academic.login({studentId: "xxx", password: "123456"})`',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run(args) {
        let studentId = String(args?.studentId || '').trim();
        const password = String(args?.password || '');
        if (!studentId) {
          const context = await academicInvoke('currentAccount');
          studentId = String(context?.studentId || context?.accounts?.[0]?.studentId || '').trim();
        }
        if (!studentId) throw new Error('没有当前或已保存的教务系统账号，请传入 studentId');
        const result = password
          ? await academicInvoke('login', { studentId, password }, 60000)
          : await academicInvoke('loginSaved', { studentId }, 60000);
        if (result?.ok === false) throw new Error(String(result?.message || '使用已保存密码登录失败'));
        return compactLoginResult(result);
      }
    },
    {
      module: 'cas',
      name: 'cas.currentAccount',
      label: '统一身份认证当前账号',
      summary: '获取 CAS 统一身份认证的当前账号与已保存账号列表',
      doc: [
        '## cas.currentAccount —— 统一身份认证当前账号',
        '',
        '获取 CAS 统一身份认证的当前偏好账号与已保存账号列表（含是否已保存密码）。',
        '',
        '**调用示例**：`cas.currentAccount()`',
        '',
        '**返回示例**：{"loginName":"24281271","accounts":[{"loginName":"24281271","userName":"苏义新","hasPassword":true}]}'
      ].join('\n'),
      async run() {
        return casInvoke('currentAccount');
      }
    },
    {
      module: 'cas',
      name: 'cas.profile',
      label: '统一身份认证个人信息',
      summary: '获取 CAS 个人信息页中的姓名与电子邮箱',
      doc: [
        '## cas.profile —— 统一身份认证个人信息',
        '',
        'GET https://cas.bjtu.edu.cn/profile/ 并解析其中的姓名与电子邮箱。需要 CAS 已登录；未登录时返回 LOGIN_REQUIRED。',
        '',
        '**调用示例**：`cas.profile()`',
        '',
        '**返回示例**：{"userName":"苏义新","email":"24281271@bjtu.edu.cn"}'
      ].join('\n'),
      async run() {
        const internals = requireGlobal('BjtuCasSystemInternals');
        if (typeof internals?.fetchProfile !== 'function') {
          throw Object.assign(new Error('模块 BjtuCasSystemInternals 未安装或未就绪'), { code: 'MODULE_UNAVAILABLE' });
        }
        const profile = await internals.fetchProfile().catch(() => null);
        if (!profile) {
          return { ok: false, code: 'LOGIN_REQUIRED', message: 'CAS 未登录，请先调用 cas.login 完成登录后再获取个人信息' };
        }
        return profile;
      }
    },
    {
      module: 'cas',
      name: 'cas.login',
      label: '统一身份认证登录',
      summary: '使用传入或已保存的账号密码登录 CAS（自动识别验证码）',
      doc: [
        '## cas.login —— 统一身份认证登录',
        '',
        '登录 CAS 统一身份认证。loginName 可省略，此时优先使用当前偏好账号，其次使用最近保存的可登录账号。传入 password 时使用该密码；省略时使用该账号已保存的密码。验证码由本地模型自动识别，需要先在「本地验证码识别」中安装 MIS 资源。',
        '',
        '**参数**：{"loginName":"学号/账号，可选","password":"密码，可选；省略时使用已保存密码"}',
        '',
        '**调用示例**：`cas.login()`；`cas.login({loginName: "xxx"})`；`cas.login({loginName: "xxx", password: "xxx"})`',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run(args) {
        let loginName = String(args?.loginName || '').trim();
        const password = String(args?.password ?? '');
        if (!loginName) {
          const context = await casInvoke('currentAccount');
          loginName = String(context?.loginName
            || context?.accounts?.find((account) => account.hasPassword)?.loginName || '').trim();
        }
        if (!loginName) throw new Error('没有当前或已保存的 CAS 账号，请传入 loginName');
        const result = password
          ? await casInvoke('login', { loginName, password })
          : await casInvoke('loginSaved', { loginName });
        if (result?.ok === false) {
          throw Object.assign(new Error(String(result?.message || 'CAS 登录失败')), { code: String(result?.code || '') });
        }
        return compactLoginResult(result);
      }
    },
    {
      module: 'cas',
      name: 'cas.loginService',
      label: '通过 CAS 登录服务',
      summary: '通过 CAS 单点登录智慧课程平台/教务系统/邮箱',
      doc: [
        '## cas.loginService —— 通过 CAS 登录服务',
        '',
        '通过 CAS 单点登录对应服务：打开该服务的 SSO 入口页，等待用户在新标签页完成 CAS 登录后返回。若会话已存在则直接返回 alreadyLoggedIn=true，不会重复打开页面；mail 服务还会先尝试用已保存的 CAS 账号密码无头登录。',
        '',
        '**参数**：{"service":"ve（智慧课程平台）| academic（教务系统）| mail（邮箱），必填"}',
        '',
        '**调用示例**：`cas.loginService({service: "ve"})`；`cas.loginService({service: "academic"})`；`cas.loginService({service: "mail"})`',
        '',
        '**返回示例**：{"ok":true,"service":"ve","loginName":"z24281271","userName":"苏义新"}；{"ok":true,"service":"academic","studentId":"24281271"}；{"ok":true,"service":"mail","sid":"...","viaSavedPassword":true}'
      ].join('\n'),
      async run(args) {
        const service = String(args?.service || '').trim().toLowerCase();
        const aliases = new Map([
          ['ve', 've'], ['portal', 've'], ['智慧课程平台', 've'],
          ['academic', 'academic'], ['jwxt', 'academic'], ['教务系统', 'academic'],
          ['mail', 'mail'], ['email', 'mail'], ['邮箱', 'mail'], ['邮件系统', 'mail']
        ]);
        const key = aliases.get(service);
        if (!key) throw new Error('service 仅支持 ve / academic / mail');
        if (key === 've') return casLoginServiceVe();
        if (key === 'academic') return casLoginServiceAcademic();
        return casLoginServiceMail();
      }
    },
    {
      module: 'mail',
      name: 'mail.status',
      label: '邮件监控状态',
      summary: '获取邮件监控开关、检查间隔与最近一次检查结果',
      doc: [
        '## mail.status —— 邮件监控状态',
        '',
        '获取 BJTU 邮件系统监控的启用状态、检查间隔、加载条数设置与最近一次检查结果（含收件箱总数与未读数）。casLoginName 为当前关联的 CAS 账号。',
        '',
        '**调用示例**：`mail.status()`',
        '',
        '**返回示例**：{"enabled":true,"intervalMinutes":10,"listLimit":10,"status":{"status":"ok","total":363,"unreadCount":7,"checkedAt":1723456789012},"casLoginName":"24281271"}'
      ].join('\n'),
      async run() {
        return mailInvoke('status');
      }
    },
    {
      module: 'mail',
      name: 'mail.inbox',
      label: '收件箱检测',
      summary: '立即检测收件箱并返回最近邮件列表、总数与未读数',
      doc: [
        '## mail.inbox —— 收件箱检测',
        '',
        '立即触发一次邮件检测（忽略监控开关），返回最近邮件列表、收件箱总数与未读数。未登录时会自动通过 CAS 使用已保存的账号密码登录邮箱；若没有已保存的 CAS 账号密码则报错。',
        '',
        '**参数**：{"limit":"可选，加载条数；0 原样传递给接口；留空/省略时使用选项页「加载条数」设置（该设置为空则返回全部邮件）"}',
        '',
        '**调用示例**：`mail.inbox()`；`mail.inbox({limit: 20})`；`mail.inbox({limit: 0})`',
        '',
        '**返回示例**：{"rows":[{"id":"...","subject":"...","from":"\\"张三\\" <xx@bjtu.edu.cn>","receivedDate":"2026-08-19 16:18:49","read":false,"attached":true}],"total":363,"unreadCount":7,"count":10,"changes":0,"checkedAt":1723456789012}'
      ].join('\n'),
      async run(args) {
        const payload = {};
        if (args?.limit !== undefined && args?.limit !== null && String(args.limit).trim() !== '') {
          payload.limit = args.limit;
        }
        const result = await mailInvoke('inbox', payload);
        if (result?.ok === false) {
          throw Object.assign(
            new Error(String(result?.message || '收件箱读取失败')),
            { code: String(result?.code || '') }
          );
        }
        return withoutOk(result) || {};
      }
    },
    {
      module: 'mail',
      name: 'mail.user',
      label: '邮箱用户信息',
      summary: '获取邮箱地址与姓名（user:getAttrs）',
      doc: [
        '## mail.user —— 邮箱用户信息',
        '',
        '通过 user:getAttrs 接口获取当前邮箱账号的邮箱地址（email）与姓名（true_name）。未登录时会自动通过 CAS 使用已保存的账号密码登录邮箱。',
        '',
        '**调用示例**：`mail.user()`',
        '',
        '**返回示例**：{"ok":true,"email":"24281271@bjtu.edu.cn","trueName":"苏义新","ou":"student"}'
      ].join('\n'),
      async run() {
        const result = await mailInvoke('user');
        if (result?.ok === false) {
          throw Object.assign(
            new Error(String(result?.message || '读取邮箱用户信息失败')),
            { code: String(result?.code || '') }
          );
        }
        return withoutOk(result) || {};
      }
    },
    {
      module: 'mooc',
      name: 'mooc.courseList',
      label: 'MOOC 课程列表',
      summary: '获取中国大学MOOC课程列表',
      doc: [
        '## mooc.courseList —— MOOC 课程列表',
        '',
        '获取中国大学MOOC（中国大学MOOC）当前账号的课程列表。需要已在 icourse163.org 登录。',
        '',
        '**调用示例**：`mooc.courseList()`',
        '',
        '**返回示例**：{"courses":[{"courseId":"...","courseName":"..."}]}'
      ].join('\n'),
      async run() {
        const cookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'STUDY_SESS' }).catch(() => null);
        if (!String(cookie?.value || '').trim()) return { ok: false, code: 'LOGIN_REQUIRED', message: '中国大学MOOC未登录，请先调用 mooc.login 完成登录后再获取课程列表' };
        return moocInvoke({ action: 'course-list' }, 120000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.detail_of_',
      label: 'MOOC 课程详情',
      summary: '获取中国大学MOOC课程详情',
      doc: [
        '## mooc.detail_of_ —— MOOC 课程详情',
        '',
        '获取中国大学MOOC课程详情（含章节列表）。courseId 可先调用 mooc.courseList 获取。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`mooc.detail_of_({courseId: "xxx"})`',
        '',
        '**返回示例**：{"detail":{...}}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('mooc', courseId);
        return moocInvoke({ action: 'course-detail', courseId }, 120000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.quizPaper_of_',
      label: 'MOOC 测验试卷',
      summary: '获取中国大学MOOC测验试卷',
      doc: [
        '## mooc.quizPaper_of_ —— MOOC 测验试卷',
        '',
        '获取中国大学MOOC测验试卷。courseId 可先调用 mooc.courseList 获取。',
        '',
        '**参数**：{"courseId":"课程ID，必填","contentType":1,"可选测验类型，1=随堂测 2=测验 3=考试 4=练习 5=作业"}',
        '',
        '**调用示例**：`mooc.quizPaper_of_({courseId: "xxx"})`',
        '',
        '**返回示例**：{"papers":[...]}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('mooc', courseId);
        return moocInvoke({ action: 'quiz-paper', courseId, contentType: Number(args?.contentType) || undefined }, 120000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.status',
      label: 'MOOC 登录状态',
      summary: '检查中国大学MOOC登录状态',
      doc: [
        '## mooc.status —— MOOC 登录状态',
        '',
        '检查当前是否已登录中国大学MOOC。',
        '',
        '**调用示例**：`mooc.status()`',
        '',
        '**返回示例**：{"loggedIn":true}'
      ].join('\n'),
      async run() {
        const cookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'STUDY_SESS' }).catch(() => null);
        return { loggedIn: !!String(cookie?.value || '').trim(), tabId: null, temporaryTab: false };
      }
    },
    {
      module: 'mooc',
      name: 'mooc.assignments',
      label: '全平台作业查询',
      summary: '按状态与类型查询中国大学MOOC所有课程的作业',
      doc: [
        '## mooc.assignments —— 全平台作业查询',
        '',
        '筛选 app.html 已加载的中国大学MOOC作业，不会为查询作业自动打开或请求 MOOC 页面。平台未启用或未完成登录时，请先调用 mooc.login()。status：all（默认）/ pending（未交）/ submitted（已交）/ overdue（逾期）。type：all（默认）/ 单元作业 / 单元测试 / 考试。',
        '',
        '**参数**：{"status":"all|pending|submitted|overdue，默认 all","type":"all|单元作业|单元测试|考试，默认 all"}',
        '',
        '**调用示例**：`mooc.assignments({status: "pending", type: "单元作业"})`',
        '',
        '**返回示例**：{"total":1,"items":[{"key":"mooc:...:...","platform":"中国大学MOOC","courseName":"课程名","title":"作业名","type":"单元作业","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const cookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'STUDY_SESS' }).catch(() => null);
        if (!String(cookie?.value || '').trim()) {
          return { ok: false, code: 'LOGIN_REQUIRED', message: '中国大学MOOC未登录，请先调用 mooc.login 完成登录后再查询作业' };
        }
        const value = await pageInvoke('mooc', 'assignments', { status: String(args?.status || 'all'), type: String(args?.type || 'all') }, 240000);
        return { ...value };
      }
    },
    {
      module: 'captcha',
      name: 'captcha.recognize',
      label: '验证码识别',
      summary: '识别验证码图片',
      doc: [
        '## captcha.recognize —— 验证码识别',
        '',
        '识别验证码图片，返回识别结果。图片须为可访问的 URL。支持两类识别模型：Tesseract OCR 模型与 omis.onnx（CAS 验证码识别模型）。',
        '',
        '**参数**：{"imageUrl":"图片URL，必填","model":"可选。指定 omis/cas/omis.onnx 时使用 omis.onnx 模型识别（返回 expression/answer）；指定其他值时按 Tesseract OCR 模型版本处理（如 4.0.0_fast，返回 passcode）；省略时使用默认验证码识别（omis.onnx）"}',
        '',
        '**调用示例**：`captcha.recognize({imageUrl: "https://...", model: "omis.onnx"})` 或 `captcha.recognize({imageUrl: "https://...", model: "4.0.0_fast"})`',
        '',
        '**返回示例**：{"passcode":"1234"}'
      ].join('\n'),
      async run(args) {
        const imageUrl = String(args?.imageUrl || '').trim();
        if (!imageUrl) throw new Error('缺少参数 imageUrl');
        const model = String(args?.model || '').trim();
        const lowerModel = model.toLowerCase();
        const isOmis = /^(omis|omis\.onnx|cas|mis)$/.test(lowerModel);
        const recognizer = requireGlobal('BjtuCaptchaRecognizer');
        if (isOmis && typeof recognizer?.recognizeMisCaptcha === 'function') {
          const blob = await (await fetch(imageUrl)).blob();
          return withoutOk(recognizer.recognizeMisCaptcha(blob));
        }
        if (model && typeof recognizer?.recognize === 'function') {
          const blob = await (await fetch(imageUrl)).blob();
          return withoutOk(recognizer.recognize(blob, model));
        }
        if (typeof recognizer?.recognizeMisCaptcha === 'function') {
          const blob = await (await fetch(imageUrl)).blob();
          return withoutOk(recognizer.recognizeMisCaptcha(blob));
        }
        return withoutOk(sendRuntimeMessage({ type: 'MIS_CAPTCHA_RECOGNIZE', payload: { imageUrl } }, 60000));
      }
    },
    {
      module: 'captcha',
      name: 'captcha.models',
      label: '获取已安装模型',
      summary: '列出验证码识别已安装的 OCR 模型',
      doc: [
        '## captcha.models —— 获取已安装模型',
        '',
        '列出验证码识别可用模型（Tesseract OCR 与 omis.onnx）及其安装状态，并标识当前选中的 Tesseract 模型。',
        '',
        '**调用示例**：`captcha.models()`',
        '',
        '**返回示例**：{"selected":"4.0.0_fast","models":[{"version":"4.0.0_fast","label":"4.0.0 Fast（原内置模型，推荐）","installed":true,"selected":true},{"version":"omis.onnx","label":"omis.onnx（CAS 验证码识别模型）","installed":true,"selected":false}]}'
      ].join('\n'),
      async run() {
        const assets = requireGlobal('BjtuCaptchaAssets');
        const versions = await assets.getModelVersions();
        const selected = await assets.getSelectedModelVersion();
        const models = [];
        for (const key of Object.keys(versions || {})) {
          const definition = versions[key];
          const cached = await assets.getCachedModel(key).catch(() => null);
          models.push({
            version: key,
            label: definition?.label || key,
            installed: Boolean(cached),
            selected: key === selected
          });
        }
        const misAssets = global.BjtuMisAssets;
        if (misAssets && typeof misAssets.getMisAssetsStatus === 'function') {
          let misInstalled = false;
          try {
            const status = await misAssets.getMisAssetsStatus();
            misInstalled = status?.files?.['omis.onnx'] === 'installed';
          } catch {
            // 状态读取失败时按未安装处理
          }
          models.push({
            version: 'omis.onnx',
            label: 'omis.onnx（CAS 验证码识别模型）',
            installed: misInstalled,
            selected: false
          });
        }
        return { selected, models };
      }
    },
    {
      module: 'campusnet',
      name: 'campusnet.status',
      label: '校园网重连状态',
      summary: '获取校园网自动重连的启用状态与最近结果',
      doc: [
        '## campusnet.status —— 校园网重连状态',
        '',
        '获取校园网自动重连的启用状态、账号、间隔与最近一次检查结果。',
        '',
        '**调用示例**：`campusnet.status()`',
        '',
        '**返回示例**：{"enabled":true,"account":"zhangsan","intervalSeconds":60,"status":{"status":"online","message":"已经在线。","account":"zhangsan"}}'
      ].join('\n'),
      async run() {
        const stored = await chrome.storage.local.get([
          'campusNetworkReconnectEnabled',
          'campusNetworkReconnectAccount',
          'campusNetworkReconnectIntervalSeconds',
          'campusNetworkReconnectNotifyOnSuccess',
          'campusNetworkReconnectStatus'
        ]).catch(() => ({}));
        return {
          enabled: stored?.campusNetworkReconnectEnabled === true,
          account: String(stored?.campusNetworkReconnectAccount || ''),
          intervalSeconds: Number(stored?.campusNetworkReconnectIntervalSeconds || 0) || 0,
          notifyOnSuccess: stored?.campusNetworkReconnectNotifyOnSuccess !== false,
          status: stored?.campusNetworkReconnectStatus || null
        };
      }
    },
    {
      module: 'campusnet',
      name: 'campusnet.reconnect',
      label: '触发校园网重连',
      summary: '启用校园网自动重连并立即触发一次认证检查',
      doc: [
        '## campusnet.reconnect —— 触发校园网重连',
        '',
        '开启校园网自动重连（若未启用）并立即触发一次认证检查。需要账号与密码已在校园网设置中保存。',
        '',
        '**调用示例**：`campusnet.reconnect()`',
        '',
        '**返回示例**：{"triggered":true,"status":"success","message":"Portal协议认证成功！","checkedAt":1723456789012}'
      ].join('\n'),
      async run() {
        await chrome.storage.local.set({ campusNetworkReconnectEnabled: true }).catch(() => {});
        const service = requireGlobal('BjtuCampusNetworkReconnect');
        if (typeof service?.restart === 'function') {
          const status = await Promise.resolve(service.restart());
          return {
            triggered: true,
            status: String(status?.status || 'triggered'),
            message: String(status?.message || '已触发校园网重连'),
            checkedAt: status?.checkedAt || null
          };
        }
        return { ok: false, message: '校园网重连模块未就绪' };
      }
    },
    {
      module: 'mrjzy',
      name: 'mrjzy.courseList',
      label: '每日交作业课程列表',
      summary: '获取每日交作业当前账号的课程列表',
      doc: [
        '## mrjzy.courseList —— 每日交作业课程列表',
        '',
        '获取每日交作业平台当前账号的课程（班级）列表。需要已打开助手页面并在 zuoye.lulufind.com 登录。',
        '',
        '**调用示例**：`mrjzy.courseList()`',
        '',
        '**返回示例**：{"loaded":true,"loginState":"online","courses":[{"classNum":"...","divClass":"课程名","teacherName":"老师","homeworkCount":3}]}'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('mrjzy', 'courseList', {}, 120000);
        if (String(value?.loginState || '') === 'offline') return { ok: false, code: 'LOGIN_REQUIRED', message: '每日交作业未登录，请先调用 mrjzy.login 完成登录后再获取课程列表' };
        return value;
      }
    },
    {
      module: 'mrjzy',
      name: 'mrjzy.assignments_of_',
      label: '每日交作业课程作业',
      summary: '根据 classNum 获取每日交作业指定班级的作业列表',
      doc: [
        '## mrjzy.assignments_of_ —— 每日交作业课程作业',
        '',
        '根据 classNum（班级号）获取每日交作业指定班级的作业列表。classNum 可先调用 mrjzy.courseList 获取。需要已打开助手页面并登录。',
        '',
        '**参数**：{"classNum":"班级号，必填"}',
        '',
        '**调用示例**：`mrjzy.assignments_of_({classNum: "xxx"})`',
        '',
        '**返回示例**：{"classNum":"xxx","divClass":"课程名","teacherName":"老师","homework":[{"workId":"...","title":"作业名","end":"时间","done":false,"link":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const classNum = String(args?.classNum || '').trim();
        if (!classNum) throw new Error('缺少参数 classNum，请先调用 mrjzy.courseList 获取班级号');
        return pageInvoke('mrjzy', 'homework_of_', { classNum }, 120000);
      }
    },
    {
      module: 'mrjzy',
      name: 'mrjzy.assignments',
      label: '全平台作业查询',
      summary: '按状态查询每日交作业所有班级的作业',
      doc: [
        '## mrjzy.assignments —— 全平台作业查询',
        '',
        '遍历每日交作业当前账号所有班级，按提交状态查询作业。本平台不区分作业类型，type 仅支持 all。status：all（默认）/ pending（未交）/ submitted（已交）/ overdue（逾期）。',
        '',
        '**参数**：{"status":"all|pending|submitted|overdue，默认 all","type":"all，本平台仅支持 all"}',
        '',
        '**调用示例**：`mrjzy.assignments({status: "pending"})`',
        '',
        '**返回示例**：{"total":1,"items":[{"key":"mrjzy:...:...","platform":"每日交作业","courseName":"课程名","title":"作业名","type":"all","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const status = normalizeAssignmentStatus(args?.status);
        const courseList = await pageInvoke('mrjzy', 'courseList', {}, 120000);
        if (String(courseList?.loginState || '') === 'offline') {
          return { ok: false, code: 'LOGIN_REQUIRED', message: '每日交作业未登录，请先调用 mrjzy.login 完成登录后再查询作业' };
        }
        const courses = Array.isArray(courseList?.courses) ? courseList.courses : [];
        const now = Date.now();
        const items = [];
        for (const course of courses.slice(0, 60)) {
          const classNum = String(course?.classNum || '').trim();
          if (!classNum) continue;
          try {
            const data = await pageInvoke('mrjzy', 'homework_of_', { classNum }, 120000);
            if (isLoginRequiredValue(data)) throw Object.assign(new Error('每日交作业需要登录'), { code: 'LOGIN_REQUIRED' });
            const homework = Array.isArray(data?.homework) ? data.homework : [];
            for (const h of homework) {
              const deadline = parseDeadline(h?.end);
              const done = h?.done === true;
              const overdue = !done && deadline > 0 && deadline < now;
              const st = computeAssignmentStatus(done, overdue);
              if (status !== 'all' && st !== status) continue;
              items.push(buildAssignmentItem(
                `mrjzy:${classNum}:${h?.workId}`, '每日交作业', String(course?.divClass || ''),
                String(h?.title || ''), 'all', st, deadline, String(h?.link || '')
              ));
            }
          } catch (error) {
            if (isLoginRequiredError(error)) throw error;
            // 单个班级失败不阻断查询
          }
        }
        return { total: items.length, items: items.slice(0, 300) };
      }
    },
    {
      module: 'mrjzy',
      name: 'mrjzy.status',
      label: '每日交作业登录状态',
      summary: '检查每日交作业登录状态',
      doc: [
        '## mrjzy.status —— 每日交作业登录状态',
        '',
        '检查当前是否已登录每日交作业平台。',
        '',
        '**调用示例**：`mrjzy.status()`',
        '',
        '**返回示例**：{"loginState":"online","loggedIn":true}'
      ].join('\n'),
      async run() {
        return pageInvoke('mrjzy', 'status', {}, 60000);
      }
    },
    {
      module: 'mrjzy',
      name: 'mrjzy.login',
      label: '每日交作业登录',
      summary: '按需启用并触发每日交作业登录流程',
      doc: [
        '## mrjzy.login —— 每日交作业登录',
        '',
        '每日交作业尚未启用时才启用并触发登录流程；已经启用时直接返回当前状态，不重复加载或弹出扫码/授权窗口。',
        '',
        '**调用示例**：`mrjzy.login()`',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run() {
        return compactLoginResult(await pageInvoke('mrjzy', 'login', { timeoutMs: Number.POSITIVE_INFINITY }));
      }
    },
    {
      module: 'jlgj',
      name: 'jlgj.courseList',
      label: '接龙管家课程列表',
      summary: '获取接龙管家当前账号的课程列表',
      doc: [
        '## jlgj.courseList —— 接龙管家课程列表',
        '',
        '获取接龙管家平台当前账号的群组（课程）列表。需要已打开助手页面并在 i.jielong.com 登录。',
        '',
        '**调用示例**：`jlgj.courseList()`',
        '',
        '**返回示例**：{"loaded":true,"loginState":"online","courses":[{"groupId":"...","name":"群组名","teacherName":"老师","homeworkCount":2}]}'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('jlgj', 'courseList', {}, 120000);
        if (String(value?.loginState || '') === 'offline') return { ok: false, code: 'LOGIN_REQUIRED', message: '接龙管家未登录，请先调用 jlgj.login 完成登录后再获取课程列表' };
        return value;
      }
    },
    {
      module: 'jlgj',
      name: 'jlgj.assignments_of_',
      label: '接龙管家课程作业',
      summary: '根据 groupId 获取接龙管家指定群组的作业列表',
      doc: [
        '## jlgj.assignments_of_ —— 接龙管家课程作业',
        '',
        '根据 groupId（群组ID）获取接龙管家指定群组的作业列表。groupId 可先调用 jlgj.courseList 获取。需要已打开助手页面并登录。',
        '',
        '**参数**：{"groupId":"群组ID，必填"}',
        '',
        '**调用示例**：`jlgj.assignments_of_({groupId: "xxx"})`',
        '',
        '**返回示例**：{"groupId":"xxx","name":"群组名","teacherName":"老师","homework":[{"threadId":"...","title":"作业名","done":false,"link":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const groupId = String(args?.groupId || '').trim();
        if (!groupId) throw new Error('缺少参数 groupId，请先调用 jlgj.courseList 获取群组ID');
        return pageInvoke('jlgj', 'homework_of_', { groupId }, 120000);
      }
    },
    {
      module: 'jlgj',
      name: 'jlgj.assignments',
      label: '全平台作业查询',
      summary: '按状态查询接龙管家所有群组的作业',
      doc: [
        '## jlgj.assignments —— 全平台作业查询',
        '',
        '遍历接龙管家当前账号所有群组，按提交状态查询作业。本平台不区分作业类型，type 仅支持 all。status：all（默认）/ pending（未交）/ submitted（已交）/ overdue（逾期，截止时间已过且未交）。',
        '',
        '**参数**：{"status":"all|pending|submitted|overdue，默认 all","type":"all，本平台仅支持 all"}',
        '',
        '**调用示例**：`jlgj.assignments({status: "pending"})`',
        '',
        '**返回示例**：{"total":1,"items":[{"key":"jlgj:...:...","platform":"接龙管家","courseName":"群组名","title":"作业名","type":"all","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const status = normalizeAssignmentStatus(args?.status);
        const courseList = await pageInvoke('jlgj', 'courseList', {}, 120000);
        if (String(courseList?.loginState || '') === 'offline') {
          return { ok: false, code: 'LOGIN_REQUIRED', message: '接龙管家未登录，请先调用 jlgj.login 完成登录后再查询作业' };
        }
        const courses = Array.isArray(courseList?.courses) ? courseList.courses : [];
        const now = Date.now();
        const items = [];
        for (const course of courses.slice(0, 60)) {
          const groupId = String(course?.groupId || '').trim();
          if (!groupId) continue;
          try {
            const data = await pageInvoke('jlgj', 'homework_of_', { groupId }, 120000);
            if (isLoginRequiredValue(data)) throw Object.assign(new Error('接龙管家需要登录'), { code: 'LOGIN_REQUIRED' });
            const homework = Array.isArray(data?.homework) ? data.homework : [];
            for (const h of homework) {
              const done = h?.done === true;
              const deadline = parseDeadline(h?.end);
              const overdue = !done && deadline > 0 && deadline < now;
              const st = computeAssignmentStatus(done, overdue);
              if (status !== 'all' && st !== status) continue;
              items.push(buildAssignmentItem(
                `jlgj:${groupId}:${h?.threadId}`, '接龙管家', String(course?.name || ''),
                String(h?.title || ''), 'all', st, deadline, String(h?.link || '')
              ));
            }
          } catch (error) {
            if (isLoginRequiredError(error)) throw error;
            // 单个群组失败不阻断查询
          }
        }
        return { total: items.length, items: items.slice(0, 300) };
      }
    },
    {
      module: 'jlgj',
      name: 'jlgj.status',
      label: '接龙管家登录状态',
      summary: '检查接龙管家登录状态',
      doc: [
        '## jlgj.status —— 接龙管家登录状态',
        '',
        '检查当前是否已登录接龙管家平台。',
        '',
        '**调用示例**：`jlgj.status()`',
        '',
        '**返回示例**：{"loginState":"online","loggedIn":true}'
      ].join('\n'),
      async run() {
        return pageInvoke('jlgj', 'status', {}, 60000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.login',
      label: 'MOOC 登录',
      summary: '按需启用并触发中国大学MOOC登录流程',
      doc: [
        '## mooc.login —— MOOC 登录',
        '',
        '中国大学MOOC尚未启用时才启用并触发登录流程；已经启用时直接返回当前状态，不重复加载或弹出登录窗口。',
        '',
        '**调用示例**：`mooc.login()`',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run() {
        return compactLoginResult(await pageInvoke('mooc', 'login', { timeoutMs: Number.POSITIVE_INFINITY }));
      }
    },
    {
      module: 'jlgj',
      name: 'jlgj.login',
      label: '接龙管家登录',
      summary: '按需启用并触发接龙管家登录流程',
      doc: [
        '## jlgj.login —— 接龙管家登录',
        '',
        '接龙管家尚未启用时才启用并触发登录流程；已经启用时直接返回当前状态，不重复加载或弹出扫码/授权窗口。',
        '',
        '**调用示例**：`jlgj.login()`',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run() {
        return compactLoginResult(await pageInvoke('jlgj', 'login', { timeoutMs: Number.POSITIVE_INFINITY }));
      }
    },
    {
      module: 'xuetangx',
      name: 'xuetangx.courseList',
      label: '学堂在线课程列表',
      summary: '获取学堂在线当前账号的课程列表',
      doc: [
        '## xuetangx.courseList —— 学堂在线课程列表',
        '',
        '获取学堂在线当前账号的课程列表。需要已打开助手页面并在 www.xuetangx.com 登录。',
        '',
        '**调用示例**：`xuetangx.courseList()`',
        '',
        '**返回示例**：{"loaded":true,"loginState":"online","courses":[{"classroomId":"...","name":"课程名","teachers":["老师"],"taskCount":5}]}'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('xuetangx', 'courseList', {}, 120000);
        if (String(value?.loginState || '') === 'offline') return { ok: false, code: 'LOGIN_REQUIRED', message: '学堂在线未登录，请先调用 xuetangx.login 完成登录后再获取课程列表' };
        return value;
      }
    },
    {
      module: 'xuetangx',
      name: 'xuetangx.assignments_of_',
      label: '学堂在线课程作业',
      summary: '根据 classroomId 获取学堂在线指定课程的任务列表',
      doc: [
        '## xuetangx.assignments_of_ —— 学堂在线课程任务',
        '',
        '根据 classroomId 获取学堂在线指定课程的任务/作业列表。classroomId 可先调用 xuetangx.courseList 获取。需要已打开助手页面并登录。',
        '',
        '**参数**：{"classroomId":"教室ID，必填"}',
        '',
        '**调用示例**：`xuetangx.assignments_of_({classroomId: "xxx"})`',
        '',
        '**返回示例**：{"classroomId":"xxx","name":"课程名","homework":[{"id":"...","title":"任务名","typeLabel":"视频","done":false,"deadline":1234567890000}]}'
      ].join('\n'),
      async run(args) {
        const classroomId = String(args?.classroomId || '').trim();
        if (!classroomId) throw new Error('缺少参数 classroomId，请先调用 xuetangx.courseList 获取教室ID');
        return pageInvoke('xuetangx', 'homework_of_', { classroomId }, 120000);
      }
    },
    {
      module: 'xuetangx',
      name: 'xuetangx.assignments',
      label: '全平台作业查询',
      summary: '按状态与类型查询学堂在线所有课程的任务',
      doc: [
        '## xuetangx.assignments —— 全平台作业查询',
        '',
        '遍历学堂在线当前账号所有课程，按提交状态与类型查询任务。status：all（默认）/ pending（未交）/ submitted（已交）/ overdue（逾期）。type：all（默认）/ 视频 / 图文 / 直播 / 讨论 / 作业 / 考试。',
        '',
        '**参数**：{"status":"all|pending|submitted|overdue，默认 all","type":"all|视频|图文|直播|讨论|作业|考试，默认 all"}',
        '',
        '**调用示例**：`xuetangx.assignments({status: "pending", type: "作业"})`',
        '',
        '**返回示例**：{"total":1,"items":[{"key":"xuetangx:...:...","platform":"学堂在线","courseName":"课程名","title":"任务名","type":"作业","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
      ].join('\n'),
      async run(args) {
        const status = normalizeAssignmentStatus(args?.status);
        const typeFilter = String(args?.type ?? 'all').trim();
        const courseList = await pageInvoke('xuetangx', 'courseList', {}, 120000);
        if (String(courseList?.loginState || '') === 'offline') {
          return { ok: false, code: 'LOGIN_REQUIRED', message: '学堂在线未登录，请先调用 xuetangx.login 完成登录后再查询作业' };
        }
        const courses = Array.isArray(courseList?.courses) ? courseList.courses : [];
        const items = [];
        for (const course of courses.slice(0, 60)) {
          const classroomId = String(course?.classroomId || '').trim();
          if (!classroomId) continue;
          try {
            const data = await pageInvoke('xuetangx', 'homework_of_', { classroomId }, 120000);
            if (isLoginRequiredValue(data)) throw Object.assign(new Error('学堂在线需要登录'), { code: 'LOGIN_REQUIRED' });
            const homework = Array.isArray(data?.homework) ? data.homework : [];
            for (const h of homework) {
              const type = String(h?.typeLabel || '').trim() || 'all';
              if (typeFilter !== 'all' && type !== typeFilter) continue;
              const deadline = parseDeadline(h?.deadline);
              const done = !!h?.done;
              const overdue = !!h?.overdue;
              const st = computeAssignmentStatus(done, overdue);
              if (status !== 'all' && st !== status) continue;
              items.push(buildAssignmentItem(
                `xuetangx:${classroomId}:${h?.id}`, '学堂在线', String(course?.name || ''),
                String(h?.title || ''), type, st, deadline, String(h?.link || '')
              ));
            }
          } catch (error) {
            if (isLoginRequiredError(error)) throw error;
            // 单个课程失败不阻断查询
          }
        }
        return { total: items.length, items: items.slice(0, 300) };
      }
    },
    {
      module: 'xuetangx',
      name: 'xuetangx.status',
      label: '学堂在线登录状态',
      summary: '检查学堂在线登录状态',
      doc: [
        '## xuetangx.status —— 学堂在线登录状态',
        '',
        '检查当前是否已登录学堂在线平台。',
        '',
        '**调用示例**：`xuetangx.status()`',
        '',
        '**返回示例**：{"loginState":"online","loggedIn":true}'
      ].join('\n'),
      async run() {
        return pageInvoke('xuetangx', 'status', {}, 60000);
      }
    },
    {
      module: 'xuetangx',
      name: 'xuetangx.login',
      label: '学堂在线登录',
      summary: '按需启用并触发学堂在线登录流程',
      doc: [
        '## xuetangx.login —— 学堂在线登录',
        '',
        '学堂在线尚未启用时才启用并触发登录流程；已经启用时直接返回当前状态，不重复加载或弹出扫码/授权窗口。',
        '',
        '**调用示例**：`xuetangx.login()`',
        '',
        '**返回示例**：{"ok":true}'
      ].join('\n'),
      async run() {
        return compactLoginResult(await pageInvoke('xuetangx', 'login', { timeoutMs: Number.POSITIVE_INFINITY }));
      }
    },
    {
      module: 'qwen',
      name: 'qwen.listOperations',
      label: '列出全部操作',
      summary: '列出可按模块分组的所有可用操作名',
      doc: [
        '## qwen.listOperations —— 列出全部操作',
        '',
        '列出所有可用操作，按模块分组为字典。外层键为模块（如 ve/academic/mooc/ykt/captcha/qwen），内层为操作名→ 简要中文描述。针对某课程的操作用“_of_”结尾。',
        '',
        '**调用示例**：`qwen.listOperations()`',
        '',
        '**返回示例**：{"ve":{"courseList":"获取智慧课程平台的课程列表","assignments":"按状态与类型查询全部作业"},"ykt":{"courseList":"获取雨课堂课程列表","assignments":"按状态与类型查询全部作业"}}'
      ].join('\n'),
      async run() {
        const enabledSet = await getEnabledOperationSet();
        const availability = await getModuleAvailability();
        const operations = {};
        for (const op of OPERATIONS) {
          if (op.hiddenFromPrompt === true) continue;
          const module = String(op.module || '');
          if (availability[module] === false) continue;
          if (enabledSet && !enabledSet.has(op.name) && !String(op.name).startsWith('qwen.')) continue;
          const key = String(op.name).split('.').slice(1).join('.');
          if (!operations[module]) operations[module] = {};
          operations[module][key] = op.summary || op.name;
        }
        return operations;
      }
    },
    {
      module: 'qwen',
      name: 'qwen.getDoc',
      label: '查询操作说明',
      summary: '查询指定操作的使用说明（Markdown）',
      doc: [
        '## qwen.getDoc —— 查询操作说明',
        '',
        '查询指定操作的详细使用说明（Markdown）。在执行任何操作前，应先调用本操作查询其说明。',
        '',
        '**参数**：{"name":"操作名，必填，如 ve.courseList"}',
        '',
        '**调用示例**：`qwen.getDoc({name: "ve.courseList"})`',
        '',
        '**返回示例**："## ve.courseList —— 课程列表\n……"'
      ].join('\n'),
      async run(args) {
        const name = String(args?.name || '').trim();
        if (!name) throw new Error('缺少参数 name');
        const op = OPERATIONS.find((item) => item.name === name);
        if (!op) throw new Error(`未找到操作：${name}`);
        return op.doc;
      }
    },
    {
      module: 'theme',
      name: 'theme.get',
      label: '获取外观颜色模式',
      summary: '获取扩展当前外观颜色模式（light/dark/system）',
      doc: [
        '## theme.get —— 获取外观颜色模式',
        '',
        '获取扩展当前的外观颜色模式。未设置时为 system（跟随系统）。',
        '',
        '**调用示例**：`theme.get()`',
        '',
        '**返回示例**：{"ok":true,"mode":"system"}'
      ].join('\n'),
      async run() {
        const stored = await chrome.storage.local.get(['themeMode']).catch(() => ({}));
        const mode = ['light', 'dark'].includes(String(stored?.themeMode))
          ? String(stored.themeMode)
          : 'system';
        return { ok: true, mode };
      }
    },
    {
      module: 'theme',
      name: 'theme.set',
      label: '设置外观颜色模式',
      summary: '设置扩展外观颜色模式，所有扩展页面立即应用',
      doc: [
        '## theme.set —— 设置外观颜色模式',
        '',
        '设置扩展的外观颜色模式，所有扩展页面会立即应用。',
        '',
        '**参数**：{"mode":"必填，light（亮色）/ dark（暗色）/ system（跟随系统）"}',
        '',
        '**调用示例**：`theme.set({mode: "dark"})`；`theme.set({mode: "system"})`',
        '',
        '**返回示例**：{"ok":true,"mode":"dark"}'
      ].join('\n'),
      async run(args) {
        const key = String(args?.mode ?? '').trim();
        const aliases = {
          light: 'light', 亮色: 'light', 浅色: 'light',
          dark: 'dark', 暗色: 'dark', 深色: 'dark',
          system: 'system', 系统: 'system', auto: 'system', 跟随系统: 'system'
        };
        const mode = aliases[key] || aliases[key.toLowerCase()];
        if (!mode) throw new Error('mode 仅支持 light / dark / system');
        await chrome.storage.local.set({ themeMode: mode });
        return { ok: true, mode };
      }
    },
    {
      module: 'qwen',
      name: 'qwen.reminder',
      label: '作业截止提醒设置',
      summary: '查询/切换后台作业监控开关，添加或删除提前提醒时间点',
      doc: [
        '## qwen.reminder —— 作业截止提醒设置',
        '',
        '控制「后台监控未交作业并发送系统通知」开关，以及提前提醒时间点的增删。时间点以提前分钟数表示（1~525600），保存后自动去重并按分钟数降序排列。',
        '',
        '**参数**：{"action":"get（默认，仅查询）/ setEnabled / addPoint / removePoint","enabled":"action=setEnabled 时必填，true/false","minutes":"action=addPoint/removePoint 时必填，提前的分钟数"}',
        '',
        '**调用示例**：`qwen.reminder()`；`qwen.reminder({action: "setEnabled", enabled: true})`；`qwen.reminder({action: "addPoint", minutes: 30})`；`qwen.reminder({action: "removePoint", minutes: 120})`',
        '',
        '**返回示例**：{"ok":true,"enabled":true,"points":[1440,120,30]}；action=addPoint 额外返回 {"added":true}；action=removePoint 额外返回 {"removed":true}'
      ].join('\n'),
      async run(args) {
        const normalizeMinutesList = (value, fallback) => {
          const source = Array.isArray(value) ? value : fallback;
          return [...new Set(source.map(Number)
            .filter((minutes) => Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600)
            .map((minutes) => Math.round(minutes)))]
            .sort((a, b) => b - a);
        };
        const action = String(args?.action || 'get').trim().toLowerCase() || 'get';
        const stored = await chrome.storage.local.get([
          'homeworkReminderEnabled', 'homeworkReminderMinutes'
        ]).catch(() => ({}));
        const enabledFallback = stored?.homeworkReminderEnabled !== false;
        let enabled = stored?.homeworkReminderEnabled !== false;
        let points = normalizeMinutesList(stored?.homeworkReminderMinutes, [120]);
        const result = { ok: true, enabled, points };
        if (['get', 'status', '查询', ''].includes(action)) return result;
        if (['setenabled', 'enabled', 'set', '设置开关'].includes(action)) {
          const raw = args?.enabled;
          if (typeof raw !== 'boolean' && !['true', 'false'].includes(String(raw).trim().toLowerCase())) {
            throw new Error('action=setEnabled 时必须传入布尔值 enabled');
          }
          enabled = typeof raw === 'boolean' ? raw : String(raw).trim().toLowerCase() === 'true';
          await chrome.storage.local.set({ homeworkReminderEnabled: enabled });
          return { ...result, enabled };
        }
        const minutesRaw = args?.minutes;
        if (minutesRaw === undefined || minutesRaw === null || String(minutesRaw).trim() === '') {
          throw new Error(`${action} 需要传入 minutes（提前的分钟数）`);
        }
        const minutes = Math.round(Number(minutesRaw));
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) {
          throw new Error('minutes 必须是 1~525600 之间的整数');
        }
        if (['addpoint', 'add', '增加', '添加'].includes(action)) {
          if (points.includes(minutes)) {
            return { ...result, added: false, message: `提前 ${minutes} 分钟的时间点已存在` };
          }
          points = normalizeMinutesList([...points, minutes], points);
          await chrome.storage.local.set({ homeworkReminderMinutes: points });
          return { ...result, points, added: true };
        }
        if (['removepoint', 'remove', 'delete', '删除', '移除'].includes(action)) {
          if (!points.includes(minutes)) {
            return { ...result, removed: false, message: `提前 ${minutes} 分钟的时间点不存在` };
          }
          points = points.filter((item) => item !== minutes);
          await chrome.storage.local.set({ homeworkReminderMinutes: points });
          return { ...result, points, removed: true };
        }
        throw new Error('action 仅支持 get / setEnabled / addPoint / removePoint');
      }
    }
  ];

  const OPERATION_GROUPS = [
    { id: 've', label: '智慧课程平台', operations: OPERATIONS.filter((op) => op.module === 've') },
    { id: 'academic', label: '教务系统', operations: OPERATIONS.filter((op) => op.module === 'academic') },
    { id: 'cas', label: 'CAS 统一身份认证', operations: OPERATIONS.filter((op) => op.module === 'cas') },
    { id: 'mail', label: 'BJTU 邮件系统', operations: OPERATIONS.filter((op) => op.module === 'mail') },
    { id: 'mooc', label: '中国大学MOOC', operations: OPERATIONS.filter((op) => op.module === 'mooc') },
    { id: 'ykt', label: '雨课堂', operations: OPERATIONS.filter((op) => op.module === 'ykt') },
    { id: 'mrjzy', label: '每日交作业', operations: OPERATIONS.filter((op) => op.module === 'mrjzy') },
    { id: 'jlgj', label: '接龙管家', operations: OPERATIONS.filter((op) => op.module === 'jlgj') },
    { id: 'xuetangx', label: '学堂在线', operations: OPERATIONS.filter((op) => op.module === 'xuetangx') },
    { id: 'campusnet', label: '校园网重连', operations: OPERATIONS.filter((op) => op.module === 'campusnet') },
    { id: 'captcha', label: '本地验证码识别', operations: OPERATIONS.filter((op) => op.module === 'captcha') },
    { id: 'theme', label: '外观颜色模式', operations: OPERATIONS.filter((op) => op.module === 'theme') },
    { id: 'qwen', label: '通义千问元操作', operations: OPERATIONS.filter((op) => op.module === 'qwen') }
  ];

  function allOperations() {
    return OPERATIONS.slice();
  }

  function findOperation(name) {
    return OPERATIONS.find((op) => op.name === name) || null;
  }

  const LOGIN_GUARDED_PLATFORMS = new Set(['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx']);
  const PLATFORM_ENABLED_DEFAULTS = Object.freeze({
    ve: true,
    ykt: false,
    mrjzy: false,
    jlgj: false,
    mooc: false,
    xuetangx: false
  });
  const PLATFORM_LABELS = Object.freeze({
    ve: '智慧课程平台',
    ykt: '雨课堂',
    mrjzy: '每日交作业',
    jlgj: '接龙管家',
    mooc: '中国大学MOOC',
    xuetangx: '学堂在线'
  });

  async function assertAssignmentsPlatformEnabled(op) {
    const platform = String(op?.module || '');
    const shortName = String(op?.name || '').split('.').slice(1).join('.');
    if (shortName !== 'assignments' || !Object.hasOwn(PLATFORM_ENABLED_DEFAULTS, platform)) return;
    const stored = await chrome.storage.local.get(['platformEnabled']).catch(() => ({}));
    const configured = stored?.platformEnabled?.[platform];
    const enabled = typeof configured === 'boolean' ? configured : PLATFORM_ENABLED_DEFAULTS[platform];
    if (enabled) return;
    throw Object.assign(
      new Error(`${PLATFORM_LABELS[platform] || platform}未启用，请先调用 ${platform}.login()`),
      { code: 'LOGIN_REQUIRED' }
    );
  }

  function operationNeedsPlatformLogin(op) {
    if (!LOGIN_GUARDED_PLATFORMS.has(String(op?.module || ''))) return false;
    const shortName = String(op?.name || '').split('.').slice(1).join('.');
    return !['login', 'status', 'accounts'].includes(shortName);
  }

  function isLoginRequiredValue(value) {
    return String(value?.code || '') === 'LOGIN_REQUIRED'
      || value?.loggedIn === false
      || String(value?.loginState || '').toLowerCase() === 'offline';
  }

  function isLoginRequiredError(error) {
    return error?.loginRequired === true
      || String(error?.code || '') === 'LOGIN_REQUIRED'
      || String(error?.message || '') === 'LOGIN_REQUIRED';
  }

  const PLATFORM_GROUP_IDS = ['ve', 'ykt', 'mrjzy', 'jlgj', 'mooc', 'xuetangx'];

  // 分组顺序遵循选项页「排序」编辑器（ui-order-groups）：
  // 先按「扩展选项模块」的区块顺序，遇到「平台显示与加载」（platforms）时按「平台」顺序展开其中的课程平台分组，
  // 其余（未出现在两块中的）分组按默认顺序追加到末尾。
  async function orderedGroups() {
    const stored = await chrome.storage.local.get(['optionsSectionOrder', 'platformOrder']).catch(() => ({}));
    const sectionOrder = Array.isArray(stored?.optionsSectionOrder) ? stored.optionsSectionOrder.map(String) : [];
    const platformOrder = Array.isArray(stored?.platformOrder) ? stored.platformOrder.map(String) : [];
    const byId = new Map(OPERATION_GROUPS.map((group) => [group.id, group]));
    const ordered = [];
    const seen = new Set();
    const push = (id) => {
      const groupId = String(id || '');
      if (byId.has(groupId) && !seen.has(groupId)) {
        seen.add(groupId);
        ordered.push(byId.get(groupId));
      }
    };
    for (const sectionId of sectionOrder) {
      if (sectionId === 'platforms') {
        platformOrder.forEach(push);
        PLATFORM_GROUP_IDS.forEach(push);
      } else if (sectionId.startsWith('module:')) {
        push(sectionId.slice('module:'.length));
      }
    }
    OPERATION_GROUPS.forEach((group) => push(group.id));
    return ordered;
  }

  async function runOperation(name, args, options = {}) {
    const op = findOperation(name);
    if (!op) throw new Error(`未找到操作：${name}`);
    if (!String(op.name).startsWith('qwen.')) {
      const enabledSet = await getEnabledOperationSet();
      if (enabledSet && !enabledSet.has(op.name)) {
        return { ok: false, name, error: `操作「${op.name}」已被禁止调用，请先在「操作」面板中启用它。` };
      }
    }
    try {
      await assertAssignmentsPlatformEnabled(op);
      if (op.requiresAuthorization === true) {
        if (typeof options?.authorize !== 'function') {
          throw Object.assign(new Error(`操作「${op.name}」需要用户授权`), { code: 'AUTHORIZATION_REQUIRED' });
        }
        const decision = await options.authorize({
          name: op.name,
          label: op.label,
          message: typeof op.authorizationMessage === 'function'
            ? op.authorizationMessage(args || {})
            : `是否允许执行操作「${op.label || op.name}」？`
        });
        if (decision !== 'allow' && decision !== 'always') {
          throw Object.assign(new Error(`用户拒绝执行操作「${op.label || op.name}」`), { code: 'USER_DENIED' });
        }
      }
      const result = await op.run(args || {}, options);
      if (operationNeedsPlatformLogin(op)) {
        if (isLoginRequiredValue(result)) {
          throw Object.assign(new Error(String(result?.message || `${op.module} 需要登录`)), { code: 'LOGIN_REQUIRED' });
        }
      }
      return { ok: true, name, result };
    } catch (error) {
      return {
        ok: false,
        name,
        error: String(error?.message || error),
        code: String(error?.code || '')
      };
    }
  }

  async function executeCode(mode, code) {
    const normalizedMode = String(mode || '').trim().toLowerCase();
    const source = String(code || '');
    if (!['sandbox', 'app', 'background'].includes(normalizedMode)) {
      return { ok: false, name: `code.${normalizedMode || 'unknown'}`, code: 'INVALID_EXECUTION_MODE', error: '代码执行环境无效' };
    }
    if (!source.trim()) {
      return { ok: false, name: `code.${normalizedMode}`, code: 'EMPTY_CODE', error: 'JavaScript 代码为空' };
    }
    try {
      const result = await pageInvoke('qwen', 'executeJs', { code: source, mode: normalizedMode }, 45000);
      return { ok: true, name: `code.${normalizedMode}`, result };
    } catch (error) {
      return {
        ok: false,
        name: `code.${normalizedMode}`,
        error: String(error?.message || error),
        code: String(error?.code || 'CODE_EXECUTION_FAILED')
      };
    }
  }

  global.BjtuQwenOperations = {
    groups: async () => {
      const availability = await getModuleAvailability();
      return (await orderedGroups())
        .filter((group) => availability[group.id] !== false)
        .map((group) => ({ ...group, operations: group.operations.map((op) => op.name) }));
    },
    groupsDetailed: async () => {
      const availability = await getModuleAvailability();
      return (await orderedGroups())
        .filter((group) => availability[group.id] !== false)
        .map((group) => ({
          ...group,
          operations: group.operations.map((op) => ({ name: op.name, label: op.label, summary: op.summary }))
        }));
    },
    list: allOperations,
    get: findOperation,
    docs: (name) => {
      const op = findOperation(name);
      return op ? { name: op.name, module: op.module, label: op.label, summary: op.summary, doc: op.doc } : null;
    },
    formatResult,
    executeCode,
    run: runOperation
  };
})(globalThis);
