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

  function throwOperationFailure(value, fallbackMessage) {
    if (!value || typeof value !== 'object' || value.ok !== false) return value;
    const code = String(value.code || '').trim();
    const message = String(value.message || fallbackMessage || '操作失败');
    if (code === 'LOGIN_REQUIRED' || value.loggedIn === false) {
      throw Object.assign(new Error(message), { code: 'LOGIN_REQUIRED' });
    }
    throw Object.assign(new Error(message), code ? { code } : {});
  }

  function compactPlatformStatus(value) {
    const source = value && typeof value === 'object' ? value : {};
    const loginState = String(source.loginState || '').toLowerCase();
    const loggedIn = typeof source.loggedIn === 'boolean'
      ? source.loggedIn
      : loginState === 'online';
    const loaded = typeof source.loaded === 'boolean'
      ? source.loaded
      : (typeof source.snapshotLoaded === 'boolean' ? source.snapshotLoaded : loggedIn);
    return { loggedIn, loaded };
  }

  function compactVeResource(item) {
    const source = item && typeof item === 'object' ? item : {};
    const baseName = String(source.name || '').trim();
    const extName = String(source.extName || '').trim().replace(/^\./, '');
    const name = extName && !baseName.toLowerCase().endsWith(`.${extName.toLowerCase()}`)
      ? `${baseName}.${extName}`
      : baseName;
    return {
      id: String(source.rpId || '').trim(),
      name,
      size: source.sizeMb ?? source.size ?? '',
      url: String(source.url || '').trim()
    };
  }

  function compactAcademicScore(row) {
    const source = row && typeof row === 'object' ? row : {};
    return {
      academicYear: String(source.academicYear || ''),
      courseCode: String(source.courseCode || ''),
      courseName: String(source.courseName || ''),
      credit: String(source.credit || ''),
      score: String(source.score || ''),
      bonusScore: String(source.bonusScore || ''),
      teacher: String(source.teacher || ''),
      details: String(source.details || '')
    };
  }

  function compactAcademicExam(row) {
    const source = row && typeof row === 'object' ? row : {};
    return {
      exam: String(source.exam || ''),
      course: String(source.course || ''),
      courseCode: String(source.courseCode || ''),
      startAt: Number(source.startAt || 0),
      timeLocation: String(source.timeLocation || ''),
      method: String(source.method || ''),
      remarks: String(source.remarks || ''),
      registration: String(source.registration || ''),
      status: String(source.status || '')
    };
  }

  function yktTypeLabel(value) {
    return ({ 14: '课堂', 15: '线上学习', 5: '试卷', 9: '公告' })[Number(value)] || '';
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
    semesters: { fn: 'loadSemesters', type: 'ACADEMIC_SEMESTERS' },
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

  function academicScoreSemesters(args) {
    const semesters = Array.isArray(args) ? args : (args?.semesters ?? args?.zxjxjhh);
    if (semesters !== undefined && !Array.isArray(semesters)) {
      throw new TypeError('semesters 必须是学期列表');
    }
    return semesters;
  }

  async function loadAcademicScoreRows(args) {
    const semesters = academicScoreSemesters(args);
    return throwOperationFailure(await academicInvoke(
      'scores',
      semesters === undefined ? {} : semesters,
      120000
    ), '成绩获取失败');
  }

  async function loadAcademicScoreStatistics(args) {
    const value = await loadAcademicScoreRows(args);
    const calculator = requireGlobal('BjtuAcademicScoreStatistics');
    const rows = Array.isArray(value?.rows) ? value.rows : [];
    const overall = calculator.calculate(rows);
    if (!overall) throw new Error('所选学期没有可参与计算的课程成绩');
    const selectedSemesters = Array.isArray(value?.selectedSemesters) ? value.selectedSemesters : [];
    const semesters = selectedSemesters.map((semester) => {
      const label = String(semester?.label || '').trim();
      return {
        label,
        zxjxjhh: String(semester?.zxjxjhh || ''),
        statistics: calculator.calculate(rows.filter((row) => String(row?.academicYear || '').trim() === label))
      };
    });
    return { overall, semesters };
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

  // ===== 作业截止提醒（reminder.*）辅助 =====
  function normalizeReminderMinutes(value, fallback = [120]) {
    const source = Array.isArray(value) ? value : fallback;
    if (!Array.isArray(source)) return [];
    return [...new Set(source.map(Number)
      .filter((minutes) => Number.isFinite(minutes) && minutes >= 1 && minutes <= 525600)
      .map((minutes) => Math.round(minutes)))]
      .sort((a, b) => b - a);
  }

  async function loadReminderPoints() {
    const stored = await chrome.storage.local.get(['homeworkReminderMinutes']).catch(() => ({}));
    return normalizeReminderMinutes(stored?.homeworkReminderMinutes, [120]);
  }

  function requireReminderMinutes(args) {
    const raw = Array.isArray(args) || typeof args === 'number' || typeof args === 'string'
      ? args
      : args?.minutes;
    if (raw === undefined || raw === null || (!Array.isArray(raw) && String(raw).trim() === '')) {
      throw new Error('缺少参数 minutes（提前的分钟数或数组）');
    }
    const values = Array.isArray(raw) ? raw : [raw];
    if (!values.length) throw new Error('minutes 数组不能为空');
    const minutes = values.map((value) => Math.round(Number(value)));
    if (minutes.some((value) => !Number.isFinite(value) || value < 1 || value > 525600)) {
      throw new Error('minutes 中的每一项都必须是 1~525600 之间的数字');
    }
    return [...new Set(minutes)];
  }

  function createQwenNotificationId() {
    const suffix = typeof global.crypto?.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `bjtu-qwen-notification:${suffix}`;
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

  // ===== app 页面依赖（pageInvoke）守卫 =====
  // 仅边栏/独立页打开而未打开课程助手页面时，先发系统通知询问用户是否打开。
  const APP_PAGE_ASK_KEY = 'appPageOpenAsk';
  const APP_PAGE_ASK_ID = 'bjtu-open-app-page';

  async function isAppPageOpen() {
    try {
      const url = chrome.runtime.getURL('app/app.html');
      const tabs = await chrome.tabs.query({ url: `${url}*` }).catch(() => []);
      return tabs.length > 0;
    } catch {
      return true; // 无法查询时不阻塞操作
    }
  }

  async function waitForAppPageReady(tabId, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error('课程助手页面被关闭');
      if (tab.status === 'complete') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('课程助手页面加载超时');
  }

  async function ensureAppPageReadyForPageApi() {
    if (await isAppPageOpen()) return;
    await chrome.storage.session.set({ [APP_PAGE_ASK_KEY]: { id: APP_PAGE_ASK_ID, answer: null } }).catch(() => {});
    try {
      chrome.notifications.create(APP_PAGE_ASK_ID, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/128.png'),
        title: '需要打开课程助手',
        message: '当前操作需要在课程助手页面中执行，是否立即打开？',
        buttons: [{ title: '打开' }, { title: '取消' }],
        priority: 2,
        requireInteraction: true
      }, () => void chrome.runtime.lastError);
    } catch {
      throw Object.assign(new Error('该操作需要在课程助手页面中执行，请先打开课程助手'), { code: 'APP_PAGE_REQUIRED' });
    }
    let open = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const stored = await chrome.storage.session.get([APP_PAGE_ASK_KEY]).catch(() => ({}));
      const answer = stored?.[APP_PAGE_ASK_KEY]?.answer;
      if (answer === null || answer === undefined) continue;
      open = answer === true;
      break;
    }
    try { chrome.notifications.clear(APP_PAGE_ASK_ID, () => void chrome.runtime.lastError); } catch {}
    if (!open) {
      throw Object.assign(new Error('用户取消打开课程助手页面，操作未执行'), { code: 'USER_DENIED' });
    }
    const appUrl = chrome.runtime.getURL('app/app.html');
    const tab = await (globalThis.BjtuTabs?.create
      ? globalThis.BjtuTabs.create({ url: appUrl, active: true })
      : chrome.tabs.create({ url: appUrl, active: true })).catch(() => null);
    if (!tab?.id) throw new Error('无法打开课程助手页面');
    await waitForAppPageReady(tab.id);
  }

  if (typeof chrome === 'object' && chrome?.notifications?.onButtonClicked) {
    chrome.notifications.onButtonClicked.addListener(async (nid, index) => {
      if (nid !== APP_PAGE_ASK_ID) return;
      await chrome.storage.session.set({ [APP_PAGE_ASK_KEY]: { id: nid, answer: index === 0 } }).catch(() => {});
    });
    chrome.notifications.onClicked.addListener(async (nid) => {
      if (nid !== APP_PAGE_ASK_ID) return;
      await chrome.storage.session.set({ [APP_PAGE_ASK_KEY]: { id: nid, answer: true } }).catch(() => {});
    });
  }

  // 经扩展 app 页面的消息桥调用平台页面级接口（学生列表/课件/回放/归档/雨课堂等）。
  // 注意：这些功能依赖页面上下文；未打开课程助手页面时会先询问用户是否打开。
  async function pageInvoke(module, fn, args, timeoutMs = 90000) {
    await ensureAppPageReadyForPageApi();
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

  function buildAssignmentItem(key, courseName, title, type, status, deadline, actionUrl) {
    const item = {
      key: String(key || ''),
      courseName: String(courseName || ''),
      title: String(title || ''),
      status: String(status || 'pending'),
      deadline: Number(deadline) || 0,
      actionUrl: String(actionUrl || '')
    };
    if (type && type !== 'all') item.type = String(type);
    return item;
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
        '**返回示例**：{"terms":[{"xqCode":"2025-2026-1","xqName":"2025-2026学年第一学期","beginDate":"...","endDate":"..."}],"recommended":"2025-2026-1"}'
      ].join('\n'),
      async run() {
        const core = await veHomework();
        const terms = await core.fetchTerms();
        const recommended = core.chooseTermCode(terms);
        return {
          terms: (Array.isArray(terms) ? terms : []).map((term) => ({
            xqCode: String(term?.xqCode || term?.xq_code || ''),
            xqName: String(term?.xqName || term?.xq_name || ''),
            beginDate: String(term?.beginDate || term?.begin_date || ''),
            endDate: String(term?.endDate || term?.end_date || '')
          })),
          recommended
        };
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
        '**返回示例**：[{"id":"...","name":"高等数学"}]',
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
          name: core.getCourseName(course)
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
        '**返回示例**：[{"id":"...","title":"作业标题","type":"作业","status":"pending","startTime":0,"deadline":1767225600000,"submittedAt":0,"score":"","attachments":[],"submittedCount":0}]'
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
        const now = Date.now();
        return (Array.isArray(list) ? list : []).map((homework) => {
          const done = core.isHomeworkDone(homework);
          const deadline = core.parseDeadline(homework?.end_time ?? homework?.endTime ?? '');
          const overdue = !done && deadline > 0 && deadline < now;
          const attachments = homework?.attachments ?? homework?.attachmentList ?? homework?.files ?? [];
          return {
            id: String(core.homeworkKey(homework) || ''),
            title: String(homework?.title || homework?.workTitle || homework?.courseNoteTitle || '未命名作业').trim(),
            type: veSubTypeLabel(homework?.subType ?? homework?.sub_type),
            status: computeAssignmentStatus(done, overdue),
            startTime: core.parseDeadline(homework?.open_date ?? homework?.openDate ?? homework?.start_time ?? homework?.startTime ?? ''),
            deadline,
            submittedAt: core.parseDeadline(homework?.submittedAt ?? homework?.submit_time ?? homework?.submitTime ?? homework?.subTime ?? homework?.sub_time ?? ''),
            score: homework?.score ?? homework?.lastScore ?? homework?.last_score ?? homework?.homeworkScore ?? homework?.workScore ?? '',
            attachments: serialize(Array.isArray(attachments) ? attachments : []),
            submittedCount: Math.max(0, Number(homework?.submitCount ?? homework?.submit_count ?? homework?.subCount ?? homework?.submitNum ?? homework?.submittedCount ?? 0) || 0)
          };
        });
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
        '**返回示例**：{"submitted":true}'
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
        const result = await core.submitHomework(courseId, homework, content, directFileList);
        if (result?.submitted !== true) throw new Error(String(result?.message || '作业提交失败'));
        return { submitted: true };
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
        '**返回示例**：{"total":1,"items":[{"key":"...","courseName":"课程名","title":"作业标题","type":"作业","status":"pending","deadline":1234567890000,"actionUrl":"..."}]}'
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
              core.getCourseName(course), title, type, st, deadline,
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
        '**返回示例**：[{"groupName":"组名","stuNo":"学号","stuName":"姓名","className":"班级"}]'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        const value = await pageInvoke('ve', 'students', { courseId }, 120000);
        return Array.isArray(value?.students) ? value.students : [];
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
        '**返回示例**：[{"id":"原始rpId","name":"课件名.pdf","size":"2.30MB","url":"https://..."}]'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        const { core, course } = await findVeCourseById(courseId);
        const courseNum = String(course?.course_num || course?.courseNum || course?.courseNo || course?.course_id || courseId).trim();
        const fzId = String(course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '').trim();
        if (!courseNum || !fzId) throw new Error(`课程ID无效：${courseId} 缺少课件所需参数（课程号/课序号）`);
        const payload = await pageInvoke('ve', 'coursewareItems', { courseNum, xkhId: fzId }, 120000);
        if (payload?.loginRequired === true) throw loginRequiredError();
        if (payload?.aborted === true) throw new Error('课件获取已取消');
        return (Array.isArray(payload?.items) ? payload.items : []).map(compactVeResource);
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
        '**返回示例**：[{"id":"原始rpId","name":"归档名.pdf","size":"2.30MB","url":"https://..."}]'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        await assertCourseIdOf('ve', courseId);
        const payload = await pageInvoke('ve', 'archiveItems', { courseId }, 120000);
        if (payload?.loginRequired === true) throw loginRequiredError();
        if (payload?.aborted === true) throw new Error('归档资源获取已取消');
        return (Array.isArray(payload?.items) ? payload.items : []).map(compactVeResource);
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
        '**返回示例**：[{"classroomId":"...","courseName":"课程名","teacher":"老师","universityId":"..."}]'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('ykt', 'courseList', {}, 120000);
        if (value?.loggedIn === false) throw Object.assign(new Error('雨课堂未登录，请先调用 ykt.login 完成登录后再获取课程列表'), { code: 'LOGIN_REQUIRED' });
        return Array.isArray(value?.courses) ? value.courses : [];
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
        '**返回示例**：[{"id":"...","title":"作业名","type":"线上学习","status":"pending","startTime":1760000000000,"deadline":1767225600000,"progress":0.75,"score":90,"totalScore":100,"link":"https://..."}]。线上学习的 progress 为扩展根据内部任务标识获取的 0~1 进度，结果不暴露 leaf_id。'
      ].join('\n'),
      async run(args) {
        const classroomId = String(args?.classroomId || '').trim();
        await assertCourseIdOf('ykt', classroomId, 'classroomId');
        const value = throwOperationFailure(
          await pageInvoke('ykt', 'courseHomework', { classroomId }, 120000),
          '雨课堂作业获取失败'
        );
        return (Array.isArray(value?.homework) ? value.homework : []).map((item) => ({
          id: String(item?.id ?? item?.courseware_id ?? ''),
          title: String(item?.title || '未命名作业'),
          type: String(item?.activityType || yktTypeLabel(item?.__actype ?? item?.actype)),
          status: computeAssignmentStatus(item?.done === true, item?.overdue === true),
          startTime: parseDeadline(item?.create_time ?? item?.startTime ?? item?.start_time),
          deadline: parseDeadline(item?.end ?? item?.deadline),
          progress: Number(item?.progress ?? 0) || 0,
          score: item?.score ?? '',
          totalScore: item?.total_score ?? item?.totalScore ?? '',
          link: String(item?.link || '')
        }));
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
        '**返回示例**：{"total":1,"items":[{"key":"ykt:...:...","courseName":"课程名","title":"作业名","type":"试卷","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
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
              `ykt:${cid}:${h?.id}`, String(course?.courseName || ''),
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
        const value = throwOperationFailure(await academicInvoke('currentAccount'), '教务系统账号信息获取失败');
        const { ok: _ok, accounts, ...rest } = value && typeof value === 'object' ? value : {};
        return {
          ...rest,
          accounts: (Array.isArray(accounts) ? accounts : []).map(({
            updatedAt: _updatedAt,
            lastLoginAt: _lastLoginAt,
            ...account
          }) => account)
        };
      }
    },
    {
      module: 'academic',
      name: 'academic.semesters',
      label: '教务学期列表',
      summary: '获取教务系统实际提供的学期及查询参数',
      doc: [
        '## academic.semesters —— 教务学期列表',
        '',
        '读取教务系统页面实际提供的学期列表，而不是使用固定学期。返回的 zxjxjhh 可用于 academic.scores 和 academic.exams；课表查询时 academic.schedule 会把相同值作为 xnxq 发送。需要教务系统已登录。',
        '',
        '**调用示例**：`academic.semesters()`',
        '',
        '**返回示例**：`{"currentZxjxjhh":"2025-2026-2-2","semesters":[{"label":"2025-2026-2","zxjxjhh":"2025-2026-2-2"},{"label":"2024-2025-2","zxjxjhh":"2024-2025-2-2"}]}`。currentZxjxjhh 优先通过当前成绩的“学年”匹配，当前没有成绩时使用本科生院当前学期；academic.scores 和 academic.exams 可直接接收这些 zxjxjhh。'
      ].join('\n'),
      async run() {
        const value = throwOperationFailure(await academicInvoke('semesters', undefined, 120000), '教务学期列表获取失败');
        return {
          currentZxjxjhh: String(value?.currentZxjxjhh || ''),
          semesters: (Array.isArray(value?.semesters) ? value.semesters : []).map((item) => ({
            label: String(item?.label || ''),
            zxjxjhh: String(item?.zxjxjhh || '')
          }))
        };
      }
    },
    {
      module: 'academic',
      name: 'academic.GPA',
      label: '平均学分绩点',
      summary: '按一个或多个学期计算平均学分绩点',
      doc: [
        '## academic.GPA —— 平均学分绩点',
        '',
        '按学分加权计算一个或多个学期的平均学分绩点。需要教务系统已登录。不传参数时计算当前学期；可传入 academic.semesters 返回的多个 zxjxjhh。百分制和五级制成绩按北京交通大学现行换算规则计算，二级制成绩不参与。',
        '',
        '**参数**：可选的 zxjxjhh 列表，例如 `["2025-2026-2-2","2024-2025-2-2"]`。也可传 `{semesters: [...]}`。',
        '',
        '**调用示例**：`academic.GPA()`；`academic.GPA(["2024-2025-2-2","2023-2024-1-2"])`',
        '',
        '**返回值**：单学期仍返回数值；传入多个学期时返回各学期结果和全部所选课程合并计算的 overallGPA。',
        '',
        '**多学期返回示例**：`{"semesters":[{"label":"2024-2025-2","zxjxjhh":"2024-2025-2-2","GPA":3.72}],"overallGPA":3.68}`'
      ].join('\n'),
      async run(args) {
        const result = await loadAcademicScoreStatistics(args);
        if (result.semesters.length <= 1) return result.overall.averageGpa;
        return {
          semesters: result.semesters.map((item) => ({
            label: item.label,
            zxjxjhh: item.zxjxjhh,
            GPA: item.statistics?.averageGpa ?? null
          })),
          overallGPA: result.overall.averageGpa
        };
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
        '按学期查询教务系统成绩。需要教务系统已登录。不传参数时获取当前学期成绩；传入多学期前可先调用 academic.semesters 获取页面当前实际提供的 zxjxjhh。',
        '',
        '**参数**：zxjxjhh 列表，例如 `["2025-2026-2-2","2024-2025-2-2"]`。也接受 academic.semesters 返回的 label，但不接受虚拟的当前学期字符串。列表中包含 currentZxjxjhh 时先获取当前学期成绩；包含其他学期时只获取一次完整历年成绩表，再按表格“学年”列筛选。某学期没有成绩时会正常返回空结果。',
        '',
        '**调用示例**：`academic.scores()`；`academic.scores(["2024-2025-2-2","2023-2024-1-2"])`；`academic.semesters().then(({semesters}) => academic.scores(semesters.map(item => item.zxjxjhh)))`',
        '',
        '**返回示例**：`[{"academicYear":"2024-2025-2","courseCode":"MATH1001","courseName":"高等数学","credit":"4","score":"95","bonusScore":"","teacher":"张老师","details":""}]`'
      ].join('\n'),
      async run(args) {
        const value = await loadAcademicScoreRows(args);
        return (Array.isArray(value?.rows) ? value.rows : []).map(compactAcademicScore);
      }
    },
    {
      module: 'academic',
      name: 'academic.weightedAverageScore',
      label: '加权平均成绩',
      summary: '按一个或多个学期计算加权平均成绩',
      doc: [
        '## academic.weightedAverageScore —— 加权平均成绩',
        '',
        '按学分加权计算一个或多个学期的平均成绩。需要教务系统已登录。不传参数时计算当前学期；可传入 academic.semesters 返回的多个 zxjxjhh。五级制成绩按北京交通大学现行规则换算为百分制，二级制成绩不参与。',
        '',
        '**参数**：可选的 zxjxjhh 列表，例如 `["2025-2026-2-2","2024-2025-2-2"]`。也可传 `{semesters: [...]}`。',
        '',
        '**调用示例**：`academic.weightedAverageScore()`；`academic.weightedAverageScore(["2024-2025-2-2","2023-2024-1-2"])`',
        '',
        '**返回值**：单学期仍返回数值；传入多个学期时返回各学期结果和全部所选课程合并计算的 overallWeightedAverageScore。',
        '',
        '**多学期返回示例**：`{"semesters":[{"label":"2024-2025-2","zxjxjhh":"2024-2025-2-2","weightedAverageScore":88.6}],"overallWeightedAverageScore":87.9}`'
      ].join('\n'),
      async run(args) {
        const result = await loadAcademicScoreStatistics(args);
        if (result.semesters.length <= 1) return result.overall.weightedAverageScore;
        return {
          semesters: result.semesters.map((item) => ({
            label: item.label,
            zxjxjhh: item.zxjxjhh,
            weightedAverageScore: item.statistics?.weightedAverageScore ?? null
          })),
          overallWeightedAverageScore: result.overall.weightedAverageScore
        };
      }
    },
    {
      module: 'academic',
      name: 'academic.exams',
      label: '考试查询',
      summary: '按一个或多个学期获取教务系统考试安排',
      doc: [
        '## academic.exams —— 考试查询',
        '',
        '按学期查询教务系统考试安排。需要教务系统已登录。不传参数时查询当前学期；可传入 academic.semesters 返回的多个 zxjxjhh。',
        '',
        '**参数**：zxjxjhh 列表，例如 `["2025-2026-2-2","2024-2025-2-2"]`。',
        '',
        '**调用示例**：`academic.exams()`；`academic.exams(["2024-2025-2-2"])`',
        '',
        '**返回示例**：[{"exam":"期末考试","course":"MATH1001 高等数学","courseCode":"MATH1001","startAt":1768006800000,"timeLocation":"2026-01-10 09:00 教室","method":"闭卷","remarks":"","registration":"已报名","status":"正常"}]'
      ].join('\n'),
      async run(args) {
        const zxjxjhh = Array.isArray(args) ? args : args?.zxjxjhh;
        const value = throwOperationFailure(await academicInvoke('exams', zxjxjhh === undefined ? {} : { zxjxjhh }, 120000), '考试安排获取失败');
        return (Array.isArray(value?.results) ? value.results : []).flatMap((result) => (
          (Array.isArray(result?.rows) ? result.rows : []).map((row) => ({
            ...compactAcademicExam(row),
            semester: String(result?.label || ''),
            zxjxjhh: String(result?.zxjxjhh || '')
          }))
        ));
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
        '按学期查询教务系统课表，需要教务系统已登录。不传 xnxq 时优先查询当前学期，并同时合并选课课表页面声明的学期；可传入 academic.semesters 返回的多个 zxjxjhh 值作为 xnxq。扩展会自动识别选课课表所属学期，同一学期同时存在两种课表时以本学期课表为准。',
        '',
        '**参数**：{"xnxq":["2025-2026-2-2"]}',
        '',
        '**调用示例**：`academic.schedule()`；`academic.schedule({xnxq: ["2024-2025-2-2"]})`',
        '',
        '**返回示例**：`[{"semester":"2025-2026-2","xnxq":"2025-2026-2-2","rows":[],"weeks":[1,2],"currentWeek":1,"weekLabels":{},"termName":"2025-2026-2"}]`'
      ].join('\n'),
      async run(args) {
        const xnxq = args?.xnxq;
        if (xnxq !== undefined && !Array.isArray(xnxq)) throw new Error('xnxq 必须是学期列表');
        const value = throwOperationFailure(await academicInvoke('schedule', {
          ...(xnxq === undefined ? {} : { xnxq }),
          includeSelection: xnxq === undefined
        }, 120000), '课表获取失败');
        return (Array.isArray(value?.results) ? value.results : []).map((result) => ({
          semester: String(result?.label || ''),
          xnxq: String(result?.xnxq || ''),
          source: result?.type === 'selection' ? 'selection' : 'semester',
          rows: Array.isArray(result?.rows) ? result.rows : [],
          weeks: Array.isArray(result?.weeks) ? result.weeks : [],
          currentWeek: Number(result?.currentWeek || 0),
          weekLabels: result?.weekLabels && typeof result.weekLabels === 'object' ? result.weekLabels : {},
          termName: String(result?.termName || '')
        }));
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
        '**参数**：{"studentId":"学号，可选；省略时使用当前或最近保存的账号","password":"身份证号后六位，可选；省略时使用已保存密码"}',
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
        const value = await casInvoke('currentAccount');
        if (!value || typeof value !== 'object') return value;
        const { ok: _ok, accounts, ...rest } = value;
        return {
          ...rest,
          accounts: (Array.isArray(accounts) ? accounts : []).map(({
            updatedAt: _updatedAt,
            lastLoginAt: _lastLoginAt,
            ...account
          }) => account)
        };
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
        '获取 BJTU 邮件系统监控的启用状态、检查间隔与最近一次检查结果（含收件箱总数与未读数）。',
        '',
        '**调用示例**：`mail.status()`',
        '',
        '**返回示例**：{"enabled":true,"intervalMinutes":10,"status":{"status":"ok","total":363,"unreadCount":7,"checkedAt":1723456789012}}'
      ].join('\n'),
      async run() {
        const result = await mailInvoke('status');
        if (!result || typeof result !== 'object') return result;
        const { listLimit: _listLimit, casLoginName: _casLoginName, ...status } = result;
        return status;
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
        '**参数**：{"limit":"可选；省略时固定返回最近 10 条；传入 0、空字符串或 null 时返回全部邮件；正整数表示返回最近指定条数"}',
        '',
        '**调用示例**：`mail.inbox()`；`mail.inbox({limit: 20})`；`mail.inbox({limit: 0})`',
        '',
        '**返回示例**：{"rows":[{"id":"...","subject":"...","from":"\\"张三\\" <xx@bjtu.edu.cn>","to":"...","summary":"...","sentDate":"...","receivedDate":"2026-08-19 16:18:49","read":false,"attached":true,"threadMessageCount":1}],"total":363,"unreadCount":7}'
      ].join('\n'),
      async run(args) {
        const hasLimit = !!args && Object.prototype.hasOwnProperty.call(args, 'limit');
        const requestedLimit = hasLimit ? args.limit : 10;
        const returnAll = requestedLimit === null
          || String(requestedLimit).trim() === ''
          || Number(requestedLimit) === 0;
        const payload = { limit: returnAll ? null : requestedLimit };
        const result = await mailInvoke('inbox', payload);
        if (result?.ok === false) {
          throw Object.assign(
            new Error(String(result?.message || '收件箱读取失败')),
            { code: String(result?.code || '') }
          );
        }
        return {
          rows: (Array.isArray(result?.rows) ? result.rows : []).map((row) => ({
            id: String(row?.id || ''),
            subject: String(row?.subject || ''),
            from: String(row?.from || row?.sender || ''),
            to: String(row?.to || ''),
            summary: String(row?.summary || ''),
            sentDate: String(row?.sentDate || ''),
            receivedDate: String(row?.receivedDate || ''),
            read: row?.read === true,
            attached: row?.attached === true,
            threadMessageCount: Number(row?.threadMessageCount || 0)
          })),
          total: Math.max(0, Number(result?.total || 0) || 0),
          unreadCount: Math.max(0, Number(result?.unreadCount || 0) || 0)
        };
      }
    },
    {
      module: 'mail',
      name: 'mail.user',
      label: '邮箱用户信息',
      summary: '获取邮箱地址与姓名',
      doc: [
        '## mail.user —— 邮箱用户信息',
        '',
        '通过 user:getAttrs 接口获取当前邮箱账号的邮箱地址（email）与姓名（true_name）。未登录时会自动通过 CAS 使用已保存的账号密码登录邮箱。',
        '',
        '**调用示例**：`mail.user()`',
        '',
        '**返回示例**：{"email":"24281271@bjtu.edu.cn","trueName":"苏义新","ou":"student"}'
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
        '直接读取 app.html 已加载的中国大学MOOC课程缓存，不会打开或请求 MOOC 页面。平台未启用或未登录时，请先调用 mooc.login()。',
        '',
        '**调用示例**：`mooc.courseList()`',
        '',
        '**返回示例**：`[{"id":"...","name":"课程名","schoolName":"学校","url":"https://...","taskCount":3,"loaded":true}]`'
      ].join('\n'),
      async run() {
        return pageInvoke('mooc', 'courseList', {}, 120000);
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
        '**返回示例**：{"loggedIn":true,"loaded":true}'
      ].join('\n'),
      async run() {
        return compactPlatformStatus(await pageInvoke('mooc', 'status', {}, 60000));
      }
    },
    {
      module: 'mooc',
      name: 'mooc.assignments_of_',
      label: 'MOOC 课程作业',
      summary: '从缓存读取指定中国大学MOOC课程的作业',
      doc: [
        '## mooc.assignments_of_ —— MOOC 课程作业',
        '',
        '直接筛选 app.html 已加载的指定课程作业缓存，不会打开或请求 MOOC 页面。平台未启用或未登录时，请先调用 mooc.login()。',
        '',
        '**参数**：`{"courseId":"课程ID，必填","status":"all|pending|submitted|overdue，默认 all","type":"all|单元作业|单元测试|考试，默认 all"}`',
        '',
        '**调用示例**：`mooc.assignments_of_({courseId: "xxx", status: "pending"})`',
        '',
        '**返回示例**：`[{"id":"...","title":"作业名","type":"单元作业","startTime":0,"deadline":1234567890000,"status":"pending","actionUrl":"https://..."}]`'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId，请先调用 mooc.courseList 获取课程ID');
        return pageInvoke('mooc', 'assignments_of_', {
          courseId,
          status: String(args?.status || 'all'),
          type: String(args?.type || 'all')
        }, 120000);
      }
    },
    {
      module: 'mooc',
      name: 'mooc.teachers_of_',
      label: 'MOOC 课程教师',
      summary: '从缓存读取指定中国大学MOOC课程的教师列表',
      doc: [
        '## mooc.teachers_of_ —— MOOC 课程教师',
        '',
        '直接读取 app.html 已加载的指定课程教师缓存，不会打开或请求 MOOC 页面。courseId 可先调用 mooc.courseList 获取。',
        '',
        '**参数**：`{"courseId":"课程ID，必填"}`',
        '',
        '**调用示例**：`mooc.teachers_of_({courseId: "xxx"})`',
        '',
        '**返回示例**：`[{"name":"老师","url":"https://www.icourse163.org/u/..."}]`'
      ].join('\n'),
      async run(args) {
        const courseId = String(args?.courseId || '').trim();
        if (!courseId) throw new Error('缺少参数 courseId，请先调用 mooc.courseList 获取课程ID');
        return pageInvoke('mooc', 'teachers_of_', { courseId }, 120000);
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
        '**返回示例**：{"total":1,"items":[{"key":"mooc:...:...","courseName":"课程名","title":"作业名","type":"单元作业","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
      ].join('\n'),
      async run(args) {
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
        '**返回示例**：[{"version":"4.0.0_fast","label":"4.0.0 Fast（原内置模型，推荐）","installed":true,"selected":true},{"version":"omis.onnx","label":"omis.onnx（CAS 验证码识别模型）","installed":true,"selected":false}]'
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
        return models;
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
        '**返回示例**：[{"classNum":"...","divClass":"课程名","teacherName":"老师","homeworkCount":3}]'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('mrjzy', 'courseList', {}, 120000);
        if (String(value?.loginState || '') !== 'online') throw Object.assign(new Error('每日交作业未登录，请先调用 mrjzy.login 完成登录后再获取课程列表'), { code: 'LOGIN_REQUIRED' });
        return Array.isArray(value?.courses) ? value.courses : [];
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
        '**返回示例**：[{"id":"...","title":"作业名","startTime":0,"deadline":1767225600000,"status":"pending","link":"https://..."}]'
      ].join('\n'),
      async run(args) {
        const classNum = String(args?.classNum || '').trim();
        if (!classNum) throw new Error('缺少参数 classNum，请先调用 mrjzy.courseList 获取班级号');
        const value = throwOperationFailure(await pageInvoke('mrjzy', 'homework_of_', { classNum }, 120000), '每日交作业作业获取失败');
        const now = Date.now();
        return (Array.isArray(value?.homework) ? value.homework : []).map((item) => {
          const deadline = parseDeadline(item?.end ?? item?.deadline);
          return {
            id: String(item?.workId ?? item?.id ?? ''),
            title: String(item?.title || ''),
            startTime: parseDeadline(item?.workTime ?? item?.startTime),
            deadline,
            status: computeAssignmentStatus(item?.done === true, item?.done !== true && deadline > 0 && deadline < now),
            link: String(item?.link || '')
          };
        });
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
        '**返回示例**：{"total":1,"items":[{"key":"mrjzy:...:...","courseName":"课程名","title":"作业名","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
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
                `mrjzy:${classNum}:${h?.workId}`, String(course?.divClass || ''),
                String(h?.title || ''), '', st, deadline, String(h?.link || '')
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
        '**返回示例**：{"loggedIn":true,"loaded":true}'
      ].join('\n'),
      async run() {
        return compactPlatformStatus(await pageInvoke('mrjzy', 'status', {}, 60000));
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
        '**返回示例**：[{"groupId":"...","name":"群组名","teacherName":"老师","homeworkCount":2}]'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('jlgj', 'courseList', {}, 120000);
        if (String(value?.loginState || '') !== 'online') throw Object.assign(new Error('接龙管家未登录，请先调用 jlgj.login 完成登录后再获取课程列表'), { code: 'LOGIN_REQUIRED' });
        return Array.isArray(value?.courses) ? value.courses : [];
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
        '**返回示例**：[{"id":"...","title":"作业名","content":"作业说明","deadline":1767225600000,"status":"pending","link":"https://..."}]'
      ].join('\n'),
      async run(args) {
        const groupId = String(args?.groupId || '').trim();
        if (!groupId) throw new Error('缺少参数 groupId，请先调用 jlgj.courseList 获取群组ID');
        const value = throwOperationFailure(await pageInvoke('jlgj', 'homework_of_', { groupId }, 120000), '接龙管家作业获取失败');
        const now = Date.now();
        return (Array.isArray(value?.homework) ? value.homework : []).map((item) => {
          const deadline = parseDeadline(item?.end ?? item?.deadline);
          return {
            id: String(item?.threadId ?? item?.id ?? ''),
            title: String(item?.title || ''),
            content: String(item?.content || ''),
            deadline,
            status: computeAssignmentStatus(item?.done === true, item?.done !== true && deadline > 0 && deadline < now),
            link: String(item?.link || '')
          };
        });
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
        '**返回示例**：{"total":1,"items":[{"key":"jlgj:...:...","courseName":"群组名","title":"作业名","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
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
                `jlgj:${groupId}:${h?.threadId}`, String(course?.name || ''),
                String(h?.title || ''), '', st, deadline, String(h?.link || '')
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
        '**返回示例**：{"loggedIn":true,"loaded":true}'
      ].join('\n'),
      async run() {
        return compactPlatformStatus(await pageInvoke('jlgj', 'status', {}, 60000));
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
        '**返回示例**：[{"classroomId":"...","name":"课程名","sign":"...","status":1,"totalSchedule":10,"score":90,"taskCount":5}]'
      ].join('\n'),
      async run() {
        const value = await pageInvoke('xuetangx', 'courseList', {}, 120000);
        if (String(value?.loginState || '') !== 'online') throw Object.assign(new Error('学堂在线未登录，请先调用 xuetangx.login 完成登录后再获取课程列表'), { code: 'LOGIN_REQUIRED' });
        return (Array.isArray(value?.courses) ? value.courses : []).map((course) => ({
          classroomId: String(course?.classroomId || ''),
          name: String(course?.name || ''),
          sign: String(course?.sign || ''),
          status: Number(course?.status || 0),
          totalSchedule: Number(course?.totalSchedule || 0),
          score: Number(course?.score || 0),
          taskCount: Number(course?.taskCount || 0)
        }));
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
        '**返回示例**：[{"id":"...","title":"任务名","type":"视频","startTime":1760000000000,"deadline":1767225600000,"progress":0.5,"status":"pending","userScore":0,"totalScore":100,"locked":false,"action":"https://..."}]'
      ].join('\n'),
      async run(args) {
        const classroomId = String(args?.classroomId || '').trim();
        if (!classroomId) throw new Error('缺少参数 classroomId，请先调用 xuetangx.courseList 获取教室ID');
        const value = throwOperationFailure(await pageInvoke('xuetangx', 'homework_of_', { classroomId }, 120000), '学堂在线任务获取失败');
        return (Array.isArray(value?.homework) ? value.homework : []).map((item) => ({
          id: String(item?.id ?? ''),
          title: String(item?.title || ''),
          type: String(item?.typeLabel || ''),
          startTime: parseDeadline(item?.startTime),
          deadline: parseDeadline(item?.deadline),
          progress: Number(item?.schedule ?? item?.progress ?? 0) || 0,
          status: computeAssignmentStatus(item?.done === true, item?.overdue === true),
          userScore: Number(item?.userScore || 0),
          totalScore: Number(item?.totalScore || 0),
          locked: item?.locked === true,
          action: String(item?.action || item?.link || '')
        }));
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
        '**返回示例**：{"total":1,"items":[{"key":"xuetangx:...:...","courseName":"课程名","title":"任务名","type":"作业","status":"pending","deadline":1234567890000,"actionUrl":"https://..."}]}'
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
                `xuetangx:${classroomId}:${h?.id}`, String(course?.name || ''),
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
      name: 'xuetangx.teachers_of_',
      label: '学堂在线课程教师',
      summary: '从缓存读取指定学堂在线课程的教师列表',
      doc: [
        '## xuetangx.teachers_of_ —— 学堂在线课程教师',
        '',
        '直接读取 app.html 已加载的指定课程教师缓存。classroomId 可先调用 xuetangx.courseList 获取。',
        '',
        '**参数**：`{"classroomId":"教室ID，必填"}`',
        '',
        '**调用示例**：`xuetangx.teachers_of_({classroomId: "xxx"})`',
        '',
        '**返回示例**：`["老师"]`'
      ].join('\n'),
      async run(args) {
        const classroomId = String(args?.classroomId || '').trim();
        if (!classroomId) throw new Error('缺少参数 classroomId，请先调用 xuetangx.courseList 获取教室ID');
        const value = await pageInvoke('xuetangx', 'courseList', {}, 120000);
        if (String(value?.loginState || '') !== 'online') {
          throw Object.assign(new Error('学堂在线未登录，请先调用 xuetangx.login 完成登录后再获取教师'), { code: 'LOGIN_REQUIRED' });
        }
        const course = (Array.isArray(value?.courses) ? value.courses : [])
          .find((item) => String(item?.classroomId || '') === classroomId);
        if (!course) throw new Error(`教室ID无效：${classroomId} 不在学堂在线缓存课程列表中，请先调用 xuetangx.courseList 获取有效ID`);
        return (Array.isArray(course?.teachers) ? course.teachers : [])
          .map((name) => String(name || '').trim())
          .filter(Boolean);
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
        '**返回示例**：{"loggedIn":true,"loaded":true}'
      ].join('\n'),
      async run() {
        return compactPlatformStatus(await pageInvoke('xuetangx', 'status', {}, 60000));
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
      summary: '按模块名和操作名批量查询操作说明（Markdown）',
      doc: [
        '## qwen.getDoc —— 查询操作说明',
        '',
        '按模块名和操作名查询详细使用说明（Markdown）。module 和 name 均可传单个字符串、字符串列表或省略；多份说明使用分隔线连接。在执行任何操作前，应先调用本操作查询其说明。',
        '',
        '**参数**：`{"module":"模块名或模块名列表","name":"不含模块前缀的操作名或操作名列表"}`。两个参数都不传时返回本操作自己的说明；只传 module 时返回这些模块的所有操作；只传 name 时返回所有模块中与这些名称匹配的操作；两者都传时按 module × name 两两匹配并跳过不存在的操作。',
        '',
        '**调用示例**：`qwen.getDoc()`；`qwen.getDoc({module: "ve"})`；`qwen.getDoc({name: "login"})`；`qwen.getDoc({module: ["ve","ykt","academic"], name: ["login","assignments"]})`',
        '',
        '**返回示例**：`"## ve.login —— 智慧课程平台登录\\n……\\n\\n---\\n\\n## ve.assignments —— 作业查询\\n……"`'
      ].join('\n'),
      async run(args) {
        const normalizeSelectors = (value, label) => {
          if (value === undefined || value === null || value === '') return [];
          const source = Array.isArray(value) ? value : [value];
          const selectors = [];
          const seen = new Set();
          for (const item of source) {
            if (typeof item !== 'string') throw new Error(`${label} 必须是字符串或字符串列表`);
            const selector = item.trim();
            if (!selector || seen.has(selector)) continue;
            seen.add(selector);
            selectors.push(selector);
          }
          return selectors;
        };

        let modules = normalizeSelectors(args?.module, 'module');
        let names = normalizeSelectors(args?.name, 'name');
        if (!modules.length && !names.length) {
          modules = ['qwen'];
          names = ['getDoc'];
        }

        let matches;
        if (modules.length && names.length) {
          matches = modules.flatMap((module) => names.map((name) => (
            OPERATIONS.find((item) => item.name === `${module}.${name}`)
          )).filter(Boolean));
        } else if (modules.length) {
          matches = modules.flatMap((module) => (
            OPERATIONS.filter((item) => String(item.module || '') === module)
          ));
        } else {
          matches = names.flatMap((name) => OPERATIONS.filter((item) => (
            String(item.name || '').split('.').slice(1).join('.') === name
          )));
        }

        if (!matches.length) {
          const moduleText = modules.length ? `module=${modules.join(',')}` : '';
          const nameText = names.length ? `name=${names.join(',')}` : '';
          throw new Error(`未找到匹配的操作：${[moduleText, nameText].filter(Boolean).join('，')}`);
        }
        return matches.map((operation) => operation.doc).join('\n\n---\n\n');
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
        '**返回示例**：{"mode":"system"}'
      ].join('\n'),
      async run() {
        const stored = await chrome.storage.local.get(['themeMode']).catch(() => ({}));
        const mode = ['light', 'dark'].includes(String(stored?.themeMode))
          ? String(stored.themeMode)
          : 'system';
        return { mode };
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
        '**返回示例**：{"mode":"dark"}'
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
        return { mode };
      }
    },
    {
      module: 'reminder',
      name: 'reminder.send',
      label: '发送系统通知',
      summary: '使用浏览器系统通知 API 发送 basic、image、list 或 progress 通知',
      doc: [
        '## reminder.send —— 发送系统通知',
        '',
        '发送一条浏览器系统通知。除 notificationId 和 replaceExisting 外，其余参数会作为 Chrome NotificationOptions 直接传入；未指定 iconUrl 时使用扩展图标。',
        '',
        '**必填参数**：`title`（标题）、`message`（正文）。',
        '',
        '**通用可选参数**：`notificationId`、`replaceExisting`、`type`（basic/image/list/progress，默认 basic）、`iconUrl`、`contextMessage`、`priority`（-2~2）、`eventTime`、`buttons`（最多两个）、`requireInteraction`、`silent`。',
        '',
        '**类型专用参数**：image 可传 `imageUrl`；list 可传 `items: [{title, message}]`；progress 可传 `progress`（0~100）。浏览器还会接收其支持的其他 NotificationOptions 字段。',
        '',
        '**调用示例**：`reminder.send({title: "课程提醒", message: "高等数学将在 30 分钟后开始", requireInteraction: true})`',
        '',
        '**进度通知示例**：`reminder.send({notificationId: "download-1", replaceExisting: true, type: "progress", title: "正在下载", message: "模型资源", progress: 45})`',
        '',
        '**返回示例**：`{"notificationId":"bjtu-qwen-notification:..."}`'
      ].join('\n'),
      async run(args) {
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error('参数必须是通知选项对象');
        }
        if (!Object.prototype.hasOwnProperty.call(args, 'title')) throw new Error('缺少参数 title');
        if (!Object.prototype.hasOwnProperty.call(args, 'message')) throw new Error('缺少参数 message');
        const {
          notificationId: requestedId,
          replaceExisting = false,
          ...notificationOptions
        } = args;
        const notificationId = String(requestedId || '').trim() || createQwenNotificationId();
        notificationOptions.type = String(notificationOptions.type || 'basic').trim().toLowerCase();
        if (!['basic', 'image', 'list', 'progress'].includes(notificationOptions.type)) {
          throw new Error('type 仅支持 basic / image / list / progress');
        }
        const createNotification = requireGlobal('BjtuSystemNotifications')?.create;
        if (typeof createNotification !== 'function') throw new Error('系统通知功能未就绪');
        const createdId = await createNotification(
          notificationId,
          notificationOptions,
          'qwen-operation',
          replaceExisting === true
        );
        return { notificationId: createdId };
      }
    },
    {
      module: 'reminder',
      name: 'reminder.get',
      label: '获取提醒时间点',
      summary: '获取作业截止提醒的全部提前时间点（分钟）',
      doc: [
        '## reminder.get —— 获取提醒时间点',
        '',
        '获取作业截止提醒的全部提前时间点（分钟），按分钟数降序排列。',
        '',
        '**调用示例**：`reminder.get()`',
        '',
        '**返回示例**：{"points":[1440,120,30]}'
      ].join('\n'),
      async run() {
        return { points: await loadReminderPoints() };
      }
    },
    {
      module: 'reminder',
      name: 'reminder.set',
      label: '设置提醒时间点',
      summary: '整体替换作业截止提醒的提前时间点列表',
      doc: [
        '## reminder.set —— 设置提醒时间点',
        '',
        '整体替换作业截止提醒的提前时间点。minutes 为提前分钟数组，取值 1~525600，保存时自动去重、取整并按降序排列。',
        '',
        '**参数**：{"minutes":"提前分钟数组，必填，如 [1440, 120, 30]"}',
        '',
        '**调用示例**：`reminder.set({minutes: [1440, 30]})`',
        '',
        '**返回示例**：{"points":[1440,30]}'
      ].join('\n'),
      async run(args) {
        const raw = args?.minutes;
        if (!Array.isArray(raw)) throw new Error('缺少参数 minutes（提前分钟数组）');
        if (!raw.length) throw new Error('minutes 不能为空；如需删除全部请改用各时间点的 removePoint');
        const points = normalizeReminderMinutes(raw, null);
        if (!points.length) throw new Error('minutes 中没有合法值（需为 1~525600 的数字）');
        await chrome.storage.local.set({ homeworkReminderMinutes: points });
        return { points };
      }
    },
    {
      module: 'reminder',
      name: 'reminder.add',
      label: '添加提醒时间点',
      summary: '新增一个或多个作业截止提醒的提前时间点',
      doc: [
        '## reminder.add —— 添加提醒时间点',
        '',
        '新增一个或多个提前提醒时间点（分钟），自动去重；已存在的时间点列入 unchanged。',
        '',
        '**参数**：可直接传提前分钟数组，也可传 `{"minutes": 数字或数组}`；每项为 1~525600。',
        '',
        '**调用示例**：`reminder.add({minutes: 30})`；`reminder.add([1440, 30])`',
        '',
        '**返回示例**：{"points":[1440,120,30],"added":[1440,30],"unchanged":[]}'
      ].join('\n'),
      async run(args) {
        const minutes = requireReminderMinutes(args);
        const points = await loadReminderPoints();
        const existing = new Set(points);
        const added = normalizeReminderMinutes(minutes.filter((value) => !existing.has(value)), []);
        const unchanged = normalizeReminderMinutes(minutes.filter((value) => existing.has(value)), []);
        const next = normalizeReminderMinutes([...points, ...added], points);
        if (added.length) await chrome.storage.local.set({ homeworkReminderMinutes: next });
        return { points: next, added, unchanged };
      }
    },
    {
      module: 'reminder',
      name: 'reminder.del',
      label: '删除提醒时间点',
      summary: '删除一个或多个作业截止提醒的提前时间点',
      doc: [
        '## reminder.del —— 删除提醒时间点',
        '',
        '删除一个或多个提前提醒时间点（分钟），自动去重；不存在的时间点列入 missing。',
        '',
        '**参数**：可直接传提前分钟数组，也可传 `{"minutes": 数字或数组}`。',
        '',
        '**调用示例**：`reminder.del({minutes: 120})`；`reminder.del([120, 30])`',
        '',
        '**返回示例**：{"points":[1440],"removed":[120,30],"missing":[]}'
      ].join('\n'),
      async run(args) {
        const minutes = requireReminderMinutes(args);
        const points = await loadReminderPoints();
        const removed = minutes.filter((value) => points.includes(value));
        const missing = minutes.filter((value) => !points.includes(value));
        const targets = new Set(removed);
        const next = points.filter((item) => !targets.has(item));
        if (removed.length) await chrome.storage.local.set({ homeworkReminderMinutes: next });
        return { points: next, removed, missing };
      }
    },
    {
      module: 'reminder',
      name: 'reminder.enabled',
      label: '后台作业监控开关',
      summary: '读取或切换「后台监控未交作业并发送系统通知」开关',
      doc: [
        '## reminder.enabled —— 后台作业监控开关',
        '',
        '无参调用返回「后台监控未交作业并发送系统通知」当前开关状态；传入 true/false 直接切换。',
        '',
        '**参数**：{"enabled":"可选，true 开启 / false 关闭；省略时仅读取"}',
        '',
        '**调用示例**：`reminder.enabled()`；`reminder.enabled({enabled: false})`；`reminder.enabled(false)` 也接受直接传布尔值',
        '',
        '**返回示例**：{"enabled":false}'
      ].join('\n'),
      async run(args) {
        let raw = typeof args === 'boolean'
          ? args
          : (args && Object.prototype.hasOwnProperty.call(args, 'enabled') ? args.enabled : undefined);
        if (raw === undefined || raw === null || String(raw).trim() === '') {
          const stored = await chrome.storage.local.get(['homeworkReminderEnabled']).catch(() => ({}));
          return { enabled: stored?.homeworkReminderEnabled !== false };
        }
        if (typeof raw !== 'boolean') {
          if (!['true', 'false'].includes(String(raw).trim().toLowerCase())) {
            throw new Error('enabled 仅支持布尔值 true / false');
          }
          raw = String(raw).trim().toLowerCase() === 'true';
        }
        await chrome.storage.local.set({ homeworkReminderEnabled: raw });
        return { enabled: raw };
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
    { id: 'theme', label: '外观', operations: OPERATIONS.filter((op) => op.module === 'theme') },
    { id: 'reminder', label: '作业截止提醒', operations: OPERATIONS.filter((op) => op.module === 'reminder') },
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

  // 非模块区块与操作分组的对应关系：「外观」即外观颜色模式，「作业截止提醒」即提醒设置。
  const SECTION_GROUP_IDS = {
    appearance: 'theme',
    reminders: 'reminder'
  };

  // 分组顺序遵循选项页「排序」编辑器（ui-order-groups）：
  // 先按「扩展选项模块」的区块顺序，遇到「平台显示与加载」（platforms）时按「平台」顺序展开其中的课程平台分组，
  // 「外观」（appearance）、「作业截止提醒」（reminders）分别对应 theme、reminder 分组，
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
      } else if (SECTION_GROUP_IDS[sectionId]) {
        push(SECTION_GROUP_IDS[sectionId]);
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
