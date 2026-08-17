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

  async function sendRuntimeMessage(message, timeoutMs = 90000) {
    if (typeof chrome !== 'object' || !chrome?.runtime?.sendMessage) {
      throw new Error('当前环境不支持消息通信');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('操作超时')), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timer);
          const error = chrome?.runtime?.lastError;
          if (error) {
            reject(new Error(String(error.message || '消息发送失败')));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        clearTimeout(timer);
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

  const ACADEMIC_DIRECT = {
    currentAccount: { fn: 'getContext', type: 'ACADEMIC_GET_CONTEXT' },
    scores: { fn: 'loadScores', type: 'ACADEMIC_LOAD_SCORES' },
    exams: { fn: 'loadExams', type: 'ACADEMIC_LOAD_EXAMS' },
    schedule: { fn: 'loadSchedule', type: 'ACADEMIC_LOAD_SCHEDULE' },
    login: { fn: 'loginWithPassword', type: 'ACADEMIC_LOGIN_WITH_PASSWORD' }
  };

  async function academicInvoke(kind, args, timeoutMs = 90000) {
    const direct = ACADEMIC_DIRECT[kind];
    const internals = typeof requireGlobal === 'function' ? requireGlobal('BjtuAcademicSystemInternals') : null;
    const fn = internals?.[direct?.fn];
    if (typeof fn === 'function') return fn(args);
    return sendRuntimeMessage({ type: direct?.type, payload: args }, timeoutMs);
  }

  async function moocInvoke(args, timeoutMs = 120000) {
    const bg = typeof requireGlobal === 'function' ? requireGlobal('BjtuMoocBackground') : null;
    const fn = bg?.handleRequest;
    if (typeof fn === 'function') {
      try {
        const data = await fn(args);
        return { ok: true, data };
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
      label: '账号列表',
      summary: '列出智慧课程平台本地保存的所有账号',
      doc: [
        '## ve.accounts —— 账号列表',
        '',
        '列出智慧课程平台本地保存的所有账号（不含密码等敏感字段）。',
        '',
        '**调用示例**：`ve.accounts()`',
        '',
        '**返回示例**：[{"loginName":"zhangsan","userName":"张三","roleName":"学生"}]'
      ].join('\n'),
      async run() {
        const store = requireGlobal('BjtuAccountStore');
        const accounts = await store.getAll();
        return (Array.isArray(accounts) ? accounts : []).map((item) => ({
          loginName: String(item?.loginName || item?.userId || ''),
          userName: String(item?.userName || ''),
          roleName: String(item?.roleName || ''),
          quickUsername: String(item?.quickUsername || ''),
          hasPassword: !!(item?.password || item?.passwordEncoded || item?.passwordPlain)
        }));
      }
    },
    {
      module: 've',
      name: 've.terms',
      label: '学期列表',
      summary: '获取智慧课程平台学期列表并选定期',
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
      name: 've.courses',
      label: '课程列表',
      summary: '获取智慧课程平台的课程列表',
      doc: [
        '## ve.courses —— 课程列表',
        '',
        '获取智慧课程平台的课程列表。若不传 xqCode 则自动使用当前学期。',
        '',
        '**参数**：{"xqCode":"可选，学期代码，如 2025-2026-1"}',
        '',
        '**调用示例**：`ve.courses()`',
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
      name: 've.courseHomework',
      label: '课程作业',
      summary: '获取指定智慧课程平台课程的全部作业',
      doc: [
        '## ve.courseHomework —— 课程作业',
        '',
        '获取指定课程的作业列表（含已交/未交）。需要先调用 ve.courses 获取课程 id。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.courseHomework({courseId: "xxx"})`',
        '',
        '**返回示例**：[{"id":"...","title":"作业标题","end_time":"2026-01-01 00:00:00","subStatus":"未提交"}]'
      ].join('\n'),
      async run(args) {
        const core = await veHomework();
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        const list = await core.fetchCourseHomework(courseId);
        return serialize(list);
      }
    },
    {
      module: 've',
      name: 've.pendingAssignments',
      label: '待办作业汇总',
      summary: '汇总智慧课程平台所有课程中未提交且未逾期的作业',
      doc: [
        '## ve.pendingAssignments —— 待办作业汇总',
        '',
        '遍历当前学期所有课程，汇总尚未提交且未逾期的作业，按截止时间排序。',
        '',
        '**参数**：{"futureOnly":true,"可选，默认 true，只返回有截止时间的未提交作业"}',
        '',
        '**调用示例**：`ve.pendingAssignments()`',
        '',
        '**返回示例**：[{"key":"...","platform":"智慧课程平台","courseName":"课程名","title":"作业标题","deadline":1234567890000,"actionUrl":"..."}]'
      ].join('\n'),
      async run(args) {
        const core = await veHomework();
        const terms = await core.fetchTerms();
        const xqCode = core.chooseTermCode(terms);
        const courses = await core.fetchCourses(xqCode);
        const data = {};
        for (const course of (Array.isArray(courses) ? courses : []).slice(0, 60)) {
          const courseId = core.getCourseId(course);
          if (!courseId) continue;
          try {
            const list = await core.fetchCourseHomework(courseId);
            data[courseId] = { list, course: serialize(course) };
          } catch (error) {
            if (error?.loginRequired || error?.message === 'LOGIN_REQUIRED') throw loginRequiredError();
          }
        }
        const pending = core.collectPendingAssignments(courses, data, { futureOnly: args?.futureOnly !== false });
        return { total: pending.length, items: pending };
      }
    },
    {
      module: 've',
      name: 've.login',
      label: '登录账号',
      summary: '使用本地保存的账号凭据登录智慧课程平台',
      doc: [
        '## ve.login —— 登录账号',
        '',
        '使用本地保存的账号凭据登录智慧课程平台。账号需存在于本地账号列表。',
        '',
        '**参数**：{"loginName":"登录名，必填"}',
        '',
        '**调用示例**：`ve.login({loginName: "zhangsan"})`',
        '',
        '**返回示例**：{"ok":true,"userName":"张三"}。失败时 ok 为 false 并带 message。'
      ].join('\n'),
      async run(args) {
        const loginService = requireGlobal('BjtuVeLoginService');
        const loginName = String(args?.loginName || '').trim();
        if (!loginName) throw new Error('缺少参数 loginName');
        const result = await loginService.login({ loginName, allowStoredCredentials: true });
        const userName = String(result?.userInfo?.userName || '');
        return { ok: !!result?.ok, message: String(result?.message || ''), userName };
      }
    },
    {
      module: 've',
      name: 've.teachers',
      label: '课程老师列表',
      summary: '获取智慧课程平台指定课程的老师与助教列表',
      doc: [
        '## ve.teachers —— 课程老师列表',
        '',
        '获取指定课程的老师与助教列表（含 userType：1=任课教师 2=助教）。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.teachers({courseId: "xxx"})`',
        '',
        '**返回示例**：[{"userName":"张三","loginName":"zhangsan","userType":"1"}]'
      ].join('\n'),
      async run(args) {
        const core = await veHomework();
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        return serialize(await core.fetchCourseTeachers(courseId));
      }
    },
    {
      module: 've',
      name: 've.students',
      label: '课程学生列表',
      summary: '获取智慧课程平台指定课程的学生列表',
      doc: [
        '## ve.students —— 课程学生列表',
        '',
        '获取指定课程的学生列表。需要已打开助手页面并登录智慧课程平台。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.students({courseId: "xxx"})`',
        '',
        '**返回示例**：{"students":[{"groupName":"组名","stuNo":"学号","stuName":"姓名","className":"班级"}],"total":60}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        return pageInvoke('ve', 'students', { courseId }, 120000);
      }
    },
    {
      module: 've',
      name: 've.coursewareList',
      label: '课件列表',
      summary: '获取智慧课程平台指定课程的课件列表',
      doc: [
        '## ve.coursewareList —— 课件列表',
        '',
        '获取指定课程的课件列表。courseNum 为课程号，xkhId 为课序号（可先调用 ve.courses 获取）。需要已打开助手页面并登录。',
        '',
        '**参数**：{"courseNum":"课程号，必填","xkhId":"课序号，必填"}',
        '',
        '**调用示例**：`ve.coursewareList({courseNum: "xxx", xkhId: "yyy"})`',
        '',
        '**返回示例**：[{"id":"...","name":"课件名","extName":"pdf","rpId":"...","sizeMb":2.3}]'
      ].join('\n'),
      async run(args) {
        const courseNum = String(args?.courseNum || '').trim();
        const xkhId = String(args?.xkhId || '').trim();
        if (!courseNum || !xkhId) throw new Error('缺少参数 courseNum 或 xkhId');
        return pageInvoke('ve', 'coursewareItems', { courseNum, xkhId }, 120000);
      }
    },
    {
      module: 've',
      name: 've.coursewareUrl',
      label: '课件下载链接',
      summary: '获取智慧课程平台课件的真实下载链接',
      doc: [
        '## ve.coursewareUrl —— 课件下载链接',
        '',
        '根据课件的 rpId 获取真实下载链接。需要已打开助手页面并登录。',
        '',
        '**参数**：{"rpId":"课件 rpId，必填"}',
        '',
        '**调用示例**：`ve.coursewareUrl({rpId: "xxx"})`',
        '',
        '**返回示例**：{"url":"https://...","loginExpired":false}'
      ].join('\n'),
      async run(args) {
        const rpId = String(args?.rpId || '').trim();
        if (!rpId) throw new Error('缺少参数 rpId');
        return pageInvoke('ve', 'coursewareUrl', { rpId }, 120000);
      }
    },
    {
      module: 've',
      name: 've.replayList',
      label: '课程回放列表',
      summary: '获取智慧课程平台指定课程的回放列表',
      doc: [
        '## ve.replayList —— 课程回放列表',
        '',
        '获取指定课程的回放/直播日程列表。需要已打开助手页面并登录。',
        '',
        '**参数**：{"courseId":"课程ID，必填","forceReload":false,"可选，是否强制重新拉取"}',
        '',
        '**调用示例**：`ve.replayList({courseId: "xxx"})`',
        '',
        '**返回示例**：[{"rpId":"...","videoId":"...","rpName":"回放名","teacherName":"老师","content":"内容"}]'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        return pageInvoke('ve', 'replaySchedule', { courseId, forceReload: args?.forceReload === true }, 120000);
      }
    },
    {
      module: 've',
      name: 've.archiveList',
      label: '课程归档列表',
      summary: '获取智慧课程平台指定课程的归档资源列表',
      doc: [
        '## ve.archiveList —— 课程归档列表',
        '',
        '获取指定课程的归档资源列表。需要已打开助手页面并登录。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.archiveList({courseId: "xxx"})`',
        '',
        '**返回示例**：{"items":[{"name":"归档名","extName":"pdf","rpId":"..."}],"loginRequired":false}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        return pageInvoke('ve', 'archiveItems', { courseId }, 120000);
      }
    },
    {
      module: 've',
      name: 've.archiveDownloadUrl',
      label: '归档打包下载链接',
      summary: '获取智慧课程平台指定课程归档的打包下载链接',
      doc: [
        '## ve.archiveDownloadUrl —— 归档打包下载链接',
        '',
        '获取指定课程全部归档资源的打包下载链接。需要已打开助手页面并登录。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`ve.archiveDownloadUrl({courseId: "xxx"})`',
        '',
        '**返回示例**：{"url":"https://.../batchDownloadFiles?courseId=xxx"}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        const url = await pageInvoke('ve', 'archiveDownloadUrl', { courseId }, 60000);
        return { url };
      }
    },
    {
      module: 'ykt',
      name: 'ykt.courseList',
      label: '雨课堂课程列表',
      summary: '获取雨课堂（yuketang）当前账号的课程列表',
      doc: [
        '## ykt.courseList —— 雨课堂课程列表',
        '',
        '获取雨课堂当前账号的课程列表。需要已打开助手页面并在 yuketang.cn 登录。',
        '',
        '**调用示例**：`ykt.courseList()`',
        '',
        '**返回示例**：{"ok":true,"courses":[{"classroomId":"...","courseName":"课程名","teacher":"老师","universityId":"..."}]}'
      ].join('\n'),
      async run() {
        return pageInvoke('ykt', 'courseList', {}, 120000);
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
        '**返回示例**：{"ok":true,"studentId":"...","accounts":[{"studentId":"...","userName":"张三","hasPassword":true}],"monitorEnabled":true}'
      ].join('\n'),
      async run() {
        return academicInvoke('currentAccount');
      }
    },
    {
      module: 'academic',
      name: 'academic.scores',
      label: '成绩查询',
      summary: '获取教务系统最新成绩',
      doc: [
        '## academic.scores —— 成绩查询',
        '',
        '查询教务系统最新成绩。需要教务系统已登录。',
        '',
        '**调用示例**：`academic.scores()`',
        '',
        '**返回示例**：{"ok":true,"scores":[{"courseName":"高等数学","score":95,"credits":4}]}'
      ].join('\n'),
      async run() {
        return academicInvoke('scores', undefined, 120000);
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
        '**返回示例**：{"ok":true,"exams":[{"courseName":"高等数学","examTime":"2026-01-10 09:00"}]}'
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
        '查询教务系统当前课表。需要教务系统已登录。',
        '',
        '**参数**：{"scheduleType":"可选，semester 或 week"}',
        '',
        '**调用示例**：`academic.schedule()`',
        '',
        '**返回示例**：{"ok":true,"rows":[{"courseName":"高等数学","weekDay":1,"startSection":1}],"currentWeek":1}'
      ].join('\n'),
      async run(args) {
        return academicInvoke('schedule', { scheduleType: String(args?.scheduleType || '') }, 120000);
      }
    },
    {
      module: 'academic',
      name: 'academic.login',
      label: '教务系统登录',
      summary: '使用学号密码登录教务系统',
      doc: [
        '## academic.login —— 教务系统登录',
        '',
        '使用学号和身份证后六位登录教务系统。',
        '',
        '**参数**：{"studentId":"学号，必填","password":"身份证后六位，必填，6 个字符"}',
        '',
        '**调用示例**：`academic.login({studentId: "xxx", password: "123456"})`',
        '',
        '**返回示例**：{"ok":true,"studentId":"..."}'
      ].join('\n'),
      async run(args) {
        const studentId = String(args?.studentId || '').trim();
        const password = String(args?.password || '');
        if (!studentId || !password) throw new Error('缺少参数 studentId 或 password');
        return academicInvoke('login', { studentId, password }, 60000);
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
        '**返回示例**：{"ok":true,"courses":[{"courseId":"...","courseName":"..."}]}'
      ].join('\n'),
      async run() {
        return moocInvoke({ action: 'course-list' }, 120000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.courseDetail',
      label: 'MOOC 课程详情',
      summary: '获取中国大学MOOC课程详情',
      doc: [
        '## mooc.courseDetail —— MOOC 课程详情',
        '',
        '获取中国大学MOOC课程详情（含章节列表）。',
        '',
        '**参数**：{"courseId":"课程ID，必填"}',
        '',
        '**调用示例**：`mooc.courseDetail({courseId: "xxx"})`',
        '',
        '**返回示例**：{"ok":true,"detail":{...}}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        return moocInvoke({ action: 'course-detail', courseId }, 120000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.quizPaper',
      label: 'MOOC 测验试卷',
      summary: '获取中国大学MOOC测验试卷',
      doc: [
        '## mooc.quizPaper —— MOOC 测验试卷',
        '',
        '获取中国大学MOOC测验试卷。',
        '',
        '**参数**：{"courseId":"课程ID，必填","contentType":1,"可选测验类型，1=随堂测 2=测验 3=考试 4=练习 5=作业"}',
        '',
        '**调用示例**：`mooc.quizPaper({courseId: "xxx"})`',
        '',
        '**返回示例**：{"ok":true,"papers":[...]}'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId');
        return moocInvoke({ action: 'quiz-paper', courseId, contentType: Number(args?.contentType) || undefined }, 120000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.loginStatus',
      label: 'MOOC 登录状态',
      summary: '检查中国大学MOOC登录状态',
      doc: [
        '## mooc.loginStatus —— MOOC 登录状态',
        '',
        '检查当前是否已登录中国大学MOOC。',
        '',
        '**调用示例**：`mooc.loginStatus()`',
        '',
        '**返回示例**：{"loggedIn":true}'
      ].join('\n'),
      async run() {
        const cookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'STUDY_SESS' }).catch(() => null);
        return { ok: true, loggedIn: !!String(cookie?.value || '').trim(), tabId: null, temporaryTab: false };
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
        '识别验证码图片，返回识别文本。图片须为可访问的 URL。',
        '',
        '**参数**：{"imageUrl":"图片URL，必填"}',
        '',
        '**调用示例**：`captcha.recognize({imageUrl: "https://..."})`',
        '',
        '**返回示例**：{"ok":true,"text":"1234"}'
      ].join('\n'),
      async run(args) {
        const imageUrl = String(args?.imageUrl || '').trim();
        if (!imageUrl) throw new Error('缺少参数 imageUrl');
        const recognizer = requireGlobal('BjtuCaptchaRecognizer');
        if (typeof recognizer?.recognizeMisCaptcha === 'function') {
          const blob = await (await fetch(imageUrl)).blob();
          return recognizer.recognizeMisCaptcha(blob);
        }
        return sendRuntimeMessage({ type: 'MIS_CAPTCHA_RECOGNIZE', payload: { imageUrl } }, 60000);
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
        '列出所有可按模块分组操作名（仅名称，不含详细说明）。',
        '',
        '**调用示例**：`qwen.listOperations()`',
        '',
        '**返回示例**：{"groups":[{"module":"ve","label":"智慧课程平台","operations":["ve.courses"]}]}'
      ].join('\n'),
      async run() {
        const enabledSet = await getEnabledOperationSet();
        const groups = OPERATION_GROUPS.map((group) => ({
          module: group.id,
          label: group.label,
          operations: group.operations
            .map((op) => op.name)
            .filter((name) => !enabledSet || enabledSet.has(name) || String(name).startsWith('qwen.'))
        })).filter((group) => group.operations.length > 0);
        return { groups };
      }
    },
    {
      module: 'qwen',
      name: 'qwen.getOperationDocs',
      label: '查询操作说明',
      summary: '查询指定操作的使用说明（Markdown）',
      doc: [
        '## qwen.getOperationDocs —— 查询操作说明',
        '',
        '查询指定操作的详细使用说明（Markdown）。在执行任何操作前，应先调用本操作查询其说明。',
        '',
        '**参数**：{"name":"操作名，必填，如 ve.courses"}',
        '',
        '**调用示例**：`qwen.getOperationDocs({name: "ve.courses"})`',
        '',
        '**返回示例**：{"name":"ve.courses","module":"ve","doc":"## ve.courses —— ..."}'
      ].join('\n'),
      async run(args) {
        const name = String(args?.name || '').trim();
        if (!name) throw new Error('缺少参数 name');
        const op = OPERATIONS.find((item) => item.name === name);
        if (!op) throw new Error(`未找到操作：${name}`);
        return { name: op.name, module: op.module, doc: op.doc };
      }
    }
  ];

  const OPERATION_GROUPS = [
    { id: 've', label: '智慧课程平台', operations: OPERATIONS.filter((op) => op.module === 've') },
    { id: 'academic', label: '教务系统', operations: OPERATIONS.filter((op) => op.module === 'academic') },
    { id: 'mooc', label: '中国大学MOOC', operations: OPERATIONS.filter((op) => op.module === 'mooc') },
    { id: 'ykt', label: '雨课堂', operations: OPERATIONS.filter((op) => op.module === 'ykt') },
    { id: 'captcha', label: '本地验证码识别', operations: OPERATIONS.filter((op) => op.module === 'captcha') },
    { id: 'qwen', label: '通义千问元操作', operations: OPERATIONS.filter((op) => op.module === 'qwen') }
  ];

  function allOperations() {
    return OPERATIONS.slice();
  }

  function findOperation(name) {
    return OPERATIONS.find((op) => op.name === name) || null;
  }

  async function runOperation(name, args, options = {}) {
    const op = findOperation(name);
    if (!op) throw new Error(`未找到操作：${name}`);
    try {
      const result = await op.run(args || {}, options);
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

  global.BjtuQwenOperations = {
    groups: () => OPERATION_GROUPS.map((group) => ({ ...group, operations: group.operations.map((op) => op.name) })),
    list: allOperations,
    get: findOperation,
    docs: (name) => {
      const op = findOperation(name);
      return op ? { name: op.name, module: op.module, label: op.label, summary: op.summary, doc: op.doc } : null;
    },
    run: runOperation
  };
})(globalThis);