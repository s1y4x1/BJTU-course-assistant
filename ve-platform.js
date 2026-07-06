const BASE = 'http://123.121.147.7:88';
const BASE_VE = `${BASE}/ve/`;
const VE_LOGIN_LINK_HTML = `<a href="${BASE_VE}" target="_blank" rel="noopener noreferrer" style="color:#1565c0; text-decoration:none; font-weight:600;">智慧课程平台</a>`;
const VE_LOGIN_REQUIRED_HTML = `如需查看${VE_LOGIN_LINK_HTML}作业，请前往登录`;

// Platform-specific functions extracted from app.js. Shared helpers remain global.

function parseVeJson(text) {
  const s = String(text || '{}').trim();
  if (s === '{}') return {};
  return JSON.parse(s.startsWith('{}') ? s.slice(2) : s);
}

async function resumeVeAfterAccountSwitchFailure() {
  resetAccountSwitchInterruption();
  if (!isPlatformEnabled('ve')) return;
  try {
    await loadCourses();
  } catch {
    // ignore
  } finally {
    window.syncRightColumnResizer?.();
  }
}

async function fetchCurrentVeUserInfo() {
  try {
    const url = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=getUserInfo`;
    const { text, res } = await fetchText(url, {
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });
    if (isLikelyLoginPageHtml(text, res?.url)) return null;
    const data = parseVeJson(text);
    if (String(data?.STATUS) !== '0' || !data?.result) return null;
    return data.result;
  } catch {
    return null;
  }
}

function fetchCurrentVeUserInfoOnce() {
  if (!currentVeUserInfoPromise) {
    currentVeUserInfoPromise = fetchCurrentVeUserInfo()
      .finally(() => { currentVeUserInfoPromise = null; });
  }
  return currentVeUserInfoPromise;
}

async function refreshCurrentVeAccountFromSession({
  reloadCourses = false,
  reloadResourceSpace = false
} = {}) {
  if (!isPlatformEnabled('ve')) return null;
  const info = await fetchCurrentVeUserInfoOnce();
  if (!info) return null;
  const userId = String(info.loginName || info.userId || '').trim();
  if (!userId) return null;
  return syncAccountInfoAndReloadVeCourses({
    userId,
    reloadCourses,
    reloadResourceSpace,
    knownUserInfo: info
  });
}

async function reloadVePlatformFromSession({
  reloadCourses = true,
  reloadResourceSpace = true
} = {}) {
  if (!isPlatformEnabled('ve')) return null;
  const synced = await refreshCurrentVeAccountFromSession({ reloadCourses, reloadResourceSpace });
  if (synced) return synced;
  const tasks = [];
  if (reloadCourses) tasks.push(loadCourses().catch(() => {}));
  if (reloadResourceSpace) tasks.push(loadResourceSpaceForCurrentAccount().catch(() => {}));
  await Promise.allSettled(tasks);
  return null;
}

async function syncAccountInfoAndReloadVeCourses({
  userId = '',
  reloadCourses = true,
  reloadResourceSpace = true,
  knownUserInfo = null
} = {}) {
  if (reloadCourses) prioritizeAccountSwitch();

  const finalUser = String(userId || usernameInput.value || lastValidUsername || '').trim();
  if (knownUserInfo) {
    await globalThis.BjtuAccountLogin?.ensureCurrentAccountStored?.(knownUserInfo).catch(() => null);
  }
  const localInfo = await getLocalAccountInfo(finalUser);
  const info = knownUserInfo
    ? {
        ...(localInfo || {}),
        ...knownUserInfo,
        loginName: String(knownUserInfo.loginName || localInfo?.loginName || finalUser).trim(),
        passwordMd5: String(localInfo?.passwordMd5 || '').trim(),
        quickUsername: String(localInfo?.quickUsername || '').trim()
      }
    : localInfo;

  if (finalUser) {
    usernameInput.value = finalUser;
    await setLocal('username', finalUser);
    lastValidUsername = finalUser;
    isLoginSessionValid = true;
  }
  pendingUsernameChange = null;
  renderLoginAccountHistorySelect(finalUser);
  updateJsessionidState();
  resetAccountSwitchInterruption();

  const roleName = String(info?.roleName || '').trim();
  window.isTeacherAccount = /教师|老师|助教/.test(roleName);
  window.currentAccountLoginName = String(info?.loginName || finalUser).trim();
  setWelcomeMessage(info);

  if (finalUser) await rememberLoggedInAccount(finalUser, info);

  const reloadPromises = [syncJsessionidToUi().catch(() => {})];
  if (reloadCourses && isPlatformEnabled('ve')) {
    window.__headerQrUrl = '';
    reloadPromises.push(loadCourses().catch(() => {}));
  }
  if (reloadResourceSpace) {
    reloadPromises.push(loadResourceSpaceForCurrentAccount().catch(() => {}));
  }
  await Promise.allSettled(reloadPromises);
  return { userId: finalUser, info, accountMismatch: false };
}

function startVeStartupAccountInfoLoad() {
  if (!isPlatformEnabled('ve')) return Promise.resolve(null);
  return refreshCurrentVeAccountFromSession({
    reloadCourses: false,
    reloadResourceSpace: false
  }).catch(() => null);
}

async function restartVePlatformForLoginExpired(reason = '登录已失效，正在重启智慧课程平台…') {
  if (window.veLoginExpiredRestartPromise) return window.veLoginExpiredRestartPromise;
  showToast(reason, 'info', 2200);
  window.veLoginExpiredRestartPromise = (async () => {
    try {
      abortAllCoursewareReplayFetches();
      window.platformEnabled.ve = false;
      window.platformLoadedOnce.ve = false;
      window.currentVeCourseList = [];
      setPlatformLoginState('ve', 'offline');
      refreshPlatformLoginTip();
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();

      await new Promise((resolve) => setTimeout(resolve, 80));
      window.platformEnabled.ve = true;
      window.platformLoadedOnce.ve = false;
      setPlatformLoginState('ve', 'checking');
      refreshPlatformLoginTip();
      await loadAutoLoadCourseResourcesSetting();
      await reloadVePlatformFromSession({ reloadCourses: true, reloadResourceSpace: true });
    } finally {
      setTimeout(() => { window.veLoginExpiredRestartPromise = null; }, 600);
    }
  })();
  return window.veLoginExpiredRestartPromise;
}

function getVeCourseSeq10(course) {
  const fzId = course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '';
  const fromFzId = normalizeTail10Token(fzId);
  if (fromFzId) return fromFzId;
  const fallback = course?.course_num || course?.courseNum || course?.courseNo || course?.course_id || course?.courseId || course?.id || course?.cId || '';
  return normalizeTail10Token(fallback);
}

function collectVeFzIdTail10Map(courses) {
  const m = new Map();
  (courses || []).forEach((course) => {
    const courseId = course.id || course.cId || course.courseId || course.course_id;
    const fzId = course?.fz_id || course?.fzId || course?.xkhId || course?.xkh_id || '';
    const seq10 = normalizeTail10Token(fzId);
    if (courseId && seq10) {
      m.set(seq10, { courseId, fzId });
    }
  });
  return m;
}

async function fetchResourceSpaceListRaw(rows = 10, searchName = '') {
  const url = `${BASE_VE}back/resourceSpace.shtml?method=resourceSpaceList`;
  const safeRows = String(Math.max(1, Number(rows) || 10));
  const encodedSearch = encodeURIComponent(encodeURIComponent(normalizeResourceSearchKeyword(searchName)));
  const body = `type=1&rows=${safeRows}&searchName=${encodedSearch}`;
  const { text, res } = await fetchText(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body
  });
  if (isLikelyLoginPageHtml(text, res?.url)) return { loginRequired: true, total: 0, result: [] };
  if (String(text || '').trim() === '{}') return { loginRequired: false, total: 0, result: [] };
  let data = null;
  try { data = parseVeJson(text); } catch { data = null; }
  if (!data || typeof data !== 'object') return { loginRequired: true, total: 0, result: [] };
  const total = Number(data.total || 0);
  const result = Array.isArray(data.result) ? data.result : [];
  return { loginRequired: false, total, result };
}

async function loadResourceSpaceForCurrentAccount(searchName = resourceSpaceSearchKeyword) {
  if (!resourceSpaceSection || !resourceSpaceList) return;
  const keyword = normalizeResourceSearchKeyword(searchName);
  resourceSpaceSearchKeyword = keyword;
  if (resourceSearchInput instanceof HTMLInputElement && resourceSearchInput.value !== keyword) {
    resourceSearchInput.value = keyword;
  }
  const loadVersion = ++window.resourceSpaceLoadVersion;
  const isStale = () => loadVersion !== window.resourceSpaceLoadVersion;

  setResourceSpaceStatus(keyword ? `资源空间加载中（搜索：${keyword}）…` : '资源空间加载中…');
  resourceSpaceList.innerHTML = '';
  window.resourceDownloadTasks = {};
  resetResourceDownloadBatch();
  updateResourceDownloadTotals();

  try {
    const firstRows = 10;
    let payload = await fetchResourceSpaceListRaw(firstRows, keyword);
    if (isStale()) return;

    if (payload.loginRequired) {
      window.resourceSpaceItems = [];
      window.resourceSpaceSelected = new Set();
      window.resourceDownloadTasks = {};
      resetResourceDownloadBatch();
      setResourceSpaceCount(0);
      setResourceSpaceStatus('未登录或登录已失效，请先登录智慧课程平台', 'warning');
      renderResourceSpaceList();
      handleLoginRequired(() => {
        loadResourceSpaceForCurrentAccount(searchName);
      }, null, '登录已失效，请输入账号登录');
      return;
    }

    const normalizeResourceItems = (result) => (Array.isArray(result) ? result : []).map((it, idx) => {
      const rpId = String(it?.rpId || it?.id || `${idx}-${it?.rpName || ''}`).trim();
      return {
        id: rpId || String(idx),
        name: String(it?.rpName || it?.name || '未命名文件').trim(),
        extName: String(it?.extName || it?.rpPrix || '').trim(),
        url: normalizeResourceUrl(it?.resUrl || it?.downloadUrl || ''),
        inputTime: String(it?.inputTime || it?.createTime || '').trim(),
        sizeMb: formatResourceSizeMb(it?.rpSize),
        sizeMbRaw: Number(it?.rpSize)
      };
    }).filter((it) => !!it.url);

    let normalized = normalizeResourceItems(payload.result);

    if (payload.total > firstRows) {
      window.resourceSpaceItems = normalized;
      window.resourceSpaceSelected = new Set();
      window.resourceDownloadTasks = {};
      resetResourceDownloadBatch();
      setResourceSpaceCount(normalized.length, 'loaded');
      setResourceSpaceStatus(`已加载 ${normalized.length} 个资源文件，正在继续加载…`);
      renderResourceSpaceList();

      payload = await fetchResourceSpaceListRaw(payload.total, keyword);
      if (isStale()) return;
      normalized = normalizeResourceItems(payload.result);
    }

    window.resourceSpaceItems = normalized;
    window.resourceSpaceSelected = new Set();
    window.resourceDownloadTasks = {};
    resetResourceDownloadBatch();
    setResourceSpaceCount(normalized.length);
    setResourceSpaceStatus('');
    renderResourceSpaceList();
  } catch (err) {
    if (isStale()) return;
    window.resourceSpaceItems = [];
    window.resourceSpaceSelected = new Set();
    window.resourceDownloadTasks = {};
    resetResourceDownloadBatch();
    setResourceSpaceCount(0);
    setResourceSpaceStatus(`资源空间加载失败: ${String(err?.message || err)}`, 'error');
    renderResourceSpaceList();
  }
}

async function fetchVeTeacherIdByCourse(courseId) {
  const courseIdPart = String(courseId || '').trim();
  if (!courseIdPart) return [];
  // POST: getAssistantForCourse，courseId 为课程 id（非 course_num）
  const url = `${BASE_VE}back/course/courseAssistantInfo.shtml?method=getAssistantForCourse`;
  const postBody = new URLSearchParams({ courseId: courseIdPart });
  try {
    const { text } = await fetchText(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString()
    });
    const data = JSON.parse(text);
    if (data?.result && Array.isArray(data.result) && data.result.length) {
      return data.result;
    }
  } catch {
    // ignore
  }
  return [];
}

function updateVeTeacherMetaUi(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const meta = window.veTeacherMetaByCourseId?.[cid] || {};
  const teachers = Array.isArray(meta.teachers) ? meta.teachers : [];

  document.querySelectorAll('.ve-teacher-pop').forEach((pop) => {
    if (!(pop instanceof HTMLElement)) return;
    if (String(pop.dataset.courseId || '').trim() !== cid) return;
    pop.innerHTML = renderVeTeacherMetaPopHtml(meta, teachers);
  });
}

function renderVeTeacherMetaPopHtml(meta, teachers) {
  if (meta.loading) {
    return '<div style="font-size:12px; color:#64748b;"><span class="spinner" style="width:10px;height:10px;border-width:1px;border-color:#2563eb;border-top-color:transparent;"></span> 正在获取教师信息…</div>';
  }
  if (!teachers.length) {
    return '<div style="font-size:12px; color:#64748b;">未查询到教师/助教信息</div>';
  }

  const rows = teachers.map((t) => {
    const userName = escapeHtml(String(t?.userName || '')).trim() || '-';
    const loginName = escapeHtml(String(t?.loginName || '')).trim() || '-';
    const userType = String(t?.userType || '').trim();
    const role = userType === '1' ? '任课教师' : (userType === '2' ? '助教' : '其他');
    const action = loginName !== '-' && loginName
      ? `<button type="button" class="ve-switch-teacher-btn" data-action="switch-teacher-account" data-teacher-id="${loginName}">切换至此账号</button>`
      : '<span style="font-size:11px;color:#999;">-</span>';
    return `<tr><td>${userName}</td><td>${loginName}</td><td>${role}</td><td>${action}</td></tr>`;
  }).join('');

  return `
    <table class="ve-course-teacher-table" style="font-size:12px;">
      <thead><tr><th>姓名</th><th>教职工号/助教号</th><th>角色</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function hydrateVeTeacherMeta(courseId, courseNum, fzId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const existing = window.veTeacherMetaByCourseId[cid] || {};
  if (existing.loading) return;
  if (existing.loaded && existing.teachers?.length) {
    updateVeTeacherMetaUi(cid);
    return;
  }
  window.veTeacherMetaByCourseId[cid] = { ...existing, loading: true };
  updateVeTeacherMetaUi(cid);
  try {
    const teachers = await fetchVeTeacherIdByCourse(cid);
    // teachers: [{userName,loginName,userType}] where userType "1"=任课教师 "2"=助教
    const firstTeacher = Array.isArray(teachers) ? teachers.find((t) => t.userType === '1') || teachers[0] : null;
    window.veTeacherMetaByCourseId[cid] = {
      teacherId: String(firstTeacher?.loginName || '').trim(),
      teachers,
      loading: false,
      loaded: true
    };
  } catch {
    window.veTeacherMetaByCourseId[cid] = { teacherId: '', teachers: [], loading: false, loaded: true };
  }
  updateVeTeacherMetaUi(cid);
}

function normalizeVeReplayScheduleItem(item, index = 0) {
  const raw = item && typeof item === 'object' ? item : {};
  const videoId = String(raw.videoId || raw.params?.videoId || '').trim();
  const classBeginTime = String(raw.classBeginTime || '').trim();
  const classEndTime = String(raw.classEndTime || '').trim();
  const courseBetween = String(raw.courseBetween || '').trim();
  return {
    ...raw,
    rpId: videoId,
    videoId,
    rpName: courseBetween || [classBeginTime, classEndTime].filter(Boolean).join(' - ') || ('第 ' + (index + 1) + ' 次课程'),
    roomName: String(raw.classRoom || raw.roomName || '').trim(),
    teacherId: String(raw.teacherId || '').trim(),
    teacherName: String(raw.teacherName || '').trim(),
    courseNum: String(raw.courseNum || '').trim(),
    content: String(raw.content || '').trim()
  };
}

async function fetchVeReplaySchedule(courseId, { forceReload = false } = {}) {
  const cid = String(courseId || '').trim();
  if (!cid) return [];
  const existing = window.veReplayScheduleByCourseId?.[cid];
  if (!forceReload && existing?.loaded) return Array.isArray(existing.list) ? existing.list : [];
  if (!forceReload && existing?.promise) return existing.promise;

  const task = (async () => {
    try {
      const url = BASE_VE + 'back/rp/common/teachCalendar.shtml?method=toDisplyTeachCourses&courseId=' + encodeURIComponent(cid);
      const { text, res } = await fetchText(url, {
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01' },
        signal: window.globalVeAbortController?.signal
      });
      if (isLikelyLoginPageHtml(text, res?.url)) throw new Error('LOGIN_REQUIRED');
      const data = parseVeJson(text);
      if (String(data?.STATUS) !== '0') {
        const message = String(data?.message || data?.ERRMSG || '').trim();
        if (/没有|暂无|无回放|无数据/.test(message)) {
          window.veReplayScheduleByCourseId[cid] = { list: [], loaded: true, error: false, promise: null };
          return [];
        }
        throw new Error(message || '获取回放失败');
      }
      const list = (Array.isArray(data?.courseSchedList) ? data.courseSchedList : [])
        .map((item, index) => ({
          ...normalizeVeReplayScheduleItem(item, index),
          queriedCourseId: cid
        }));
      window.veReplayScheduleByCourseId[cid] = { list, loaded: true, error: false, promise: null };
      return list;
    } catch (error) {
      window.veReplayScheduleByCourseId[cid] = { list: [], loaded: false, error: true, promise: null };
      throw error;
    }
  })();
  window.veReplayScheduleByCourseId[cid] = { list: [], loaded: false, error: false, promise: task };
  return task;
}

function formatVeClassNumber(n) {
  return String(Math.max(1, Math.min(99, Number(n) || 1))).padStart(2, '0');
}

function buildVeXkhPrefix(courseNum, fzId) {
  const raw = String(fzId || '').trim();
  if (raw.length > 2) return raw.slice(0, -2);
  return String(courseNum || '').trim();
}

async function fetchVeCourseTeachersByCourseNum(courseNum, fzId, onUpdate = null) {
  const courseIdPart = String(courseNum || '').trim();
  if (!courseIdPart) return { rows: [], error: false, permissionDenied: false };

  const prefix = buildVeXkhPrefix(courseIdPart, fzId);
  const rows = [];
  const seen = new Set();
  const controllers = new Map();
  let stopAt = Number.POSITIVE_INFINITY;
  let nextClassNo = 1;
  let firstError = null;
  let permissionDenied = false;
  const maxClassNo = 99;
  const workerCount = 6;

  const visibleRows = () => rows
    .filter((row) => Number(row.classNo || 0) <= stopAt)
    .sort((a, b) => Number(a.classNo || 0) - Number(b.classNo || 0))
    .map(({ teacherName, teacherId, roomName, xkhId }) => ({ teacherName, teacherId, roomName, xkhId }));
  const emit = (done = false) => {
    if (typeof onUpdate === 'function') {
      onUpdate(visibleRows(), { done, error: !!firstError, permissionDenied });
    }
  };
  const markStop = (classNo) => {
    stopAt = Math.min(stopAt, Number(classNo));
    controllers.forEach((controller, key) => {
      if (Number(key) > stopAt) {
        try { controller.abort(); } catch {}
      }
    });
  };
  const denyPermission = () => {
    permissionDenied = true;
    stopAt = 0;
    controllers.forEach((controller) => {
      try { controller.abort(); } catch {}
    });
  };

  const fetchOne = async (classNo) => {
    if (classNo > stopAt || permissionDenied) return;
    const xkhId = prefix + formatVeClassNumber(classNo);
    const controller = new AbortController();
    controllers.set(classNo, controller);
    try {
      const url = BASE_VE + '/back/course/courseInfo.shtml?method=queryRecordResourceForCourseList';
      const body = new URLSearchParams({ courseId: courseIdPart, xkhId });
      const { text, res } = await fetchText(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01'
        },
        body: body.toString()
      });
      if (String(text || '').trim() === '{}') {
        denyPermission();
        return;
      }
      if (isLikelyLoginPageHtml(text, res?.url)) {
        markStop(classNo);
        return;
      }
      let data;
      try { data = parseVeJson(text); } catch {
        markStop(classNo);
        return;
      }
      if (String(data?.STATUS) !== '0') {
        markStop(classNo);
        return;
      }
      const item = Array.isArray(data?.result) && data.result.length ? data.result[0] : null;
      const teacherName = String(item?.teacherName || '').trim();
      const teacherId = String(item?.teacherId || '').trim();
      const roomName = String(item?.roomName || '').trim();
      if (!teacherName && !teacherId && !roomName) {
        markStop(classNo);
        return;
      }
      const key = [teacherId, teacherName, roomName].join('__');
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ teacherName, teacherId, roomName, xkhId, classNo });
        emit(false);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        if (!firstError) firstError = error;
        markStop(classNo);
      }
    } finally {
      controllers.delete(classNo);
    }
  };

  const worker = async () => {
    while (!permissionDenied) {
      const classNo = nextClassNo;
      nextClassNo += 1;
      if (classNo > maxClassNo || classNo > stopAt) return;
      await fetchOne(classNo);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  emit(true);
  return { rows: visibleRows(), error: !!firstError, permissionDenied };
}

function renderVeCourseTeachersPopHtml(meta) {
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const tableHtml = rows.length
    ? (() => {
      const body = renderVeCourseTeacherRowsHtml(rows);
      return `
        <table class="ve-course-teacher-table">
          <thead><tr><th>xkhId</th><th>教师姓名</th><th>工号</th><th>教室</th><th>操作</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      `;
    })()
    : '';

  if (meta.loading) {
    if (tableHtml) {
      return `${tableHtml}<div class="ve-course-teacher-loading"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span><span>正在获取更多同课教师…</span></div>`;
    }
    return '<div class="ve-course-teacher-loading"><span class="spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span><span>正在获取同课教师…</span></div>';
  }

  if (meta.permissionDenied) {
    return '<div class="ve-course-teacher-loading warning">学生账号无权限</div>';
  }

  if (meta.error) {
    if (tableHtml) {
      return `${tableHtml}<div class="ve-course-teacher-loading warning">获取同课教师失败，已显示部分结果</div>`;
    }
    return '<div class="ve-course-teacher-loading warning">获取同课教师失败，请稍后重试</div>';
  }

  if (meta.noReplay) {
    return '<div style="font-size:12px; color:#64748b;">无法获取无回放课程的同课教师</div>';
  }

  if (!tableHtml) {
    return '<div style="font-size:12px; color:#64748b;">未查询到同课其他教师</div>';
  }
  return tableHtml;
}

function renderVeCourseTeacherRowsHtml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((it) => {
    const xkhId = String(it?.xkhId || '');
    const xkhSuffix = xkhId.length >= 10 ? xkhId.slice(-10) : (xkhId || '-');
    const teacherName = escapeHtml(String(it?.teacherName || '')) || '-';
    const teacherId = escapeHtml(String(it?.teacherId || '')) || '-';
    const roomName = escapeHtml(String(it?.roomName || '')) || '-';
    const teacherIdRaw = String(it?.teacherId || '').trim();
    const action = teacherIdRaw
      ? `<button type="button" class="ve-switch-teacher-btn" data-action="switch-teacher-account" data-teacher-id="${escapeHtml(teacherIdRaw)}">切换至此账号</button>`
      : '<button type="button" class="ve-switch-teacher-btn" disabled style="opacity:.6;">切换至此账号</button>';
    return `<tr><td>${escapeHtml(xkhSuffix)}</td><td>${teacherName}</td><td>${teacherId}</td><td>${roomName}</td><td>${action}</td></tr>`;
  }).join('');
}

function updateVeCourseTeachersPopUi(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const meta = window.veCourseTeachersMetaByCourseId?.[cid] || { rows: [], loading: false, loaded: false, error: false };
  const rows = Array.isArray(meta.rows) ? meta.rows : [];
  const rowsHash = rows.map((it) => `${String(it?.teacherId || '')}|${String(it?.teacherName || '')}|${String(it?.roomName || '')}|${String(it?.xkhId || '')}`).join('||');

  document.querySelectorAll('.ve-course-teacher-pop').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    if (String(el.dataset.courseId || '').trim() !== cid) return;

    let tableWrap = el.querySelector('.ve-course-teacher-table-wrap');
    let statusLine = el.querySelector('.ve-course-teacher-status-line');
    let statusSpinner = el.querySelector('.ve-course-teacher-status-spinner');
    let statusText = el.querySelector('.ve-course-teacher-status-text');
    if (!(tableWrap instanceof HTMLElement) || !(statusLine instanceof HTMLElement) || !(statusText instanceof HTMLElement)) {
      el.innerHTML = `
        <div class="ve-course-teacher-table-wrap"></div>
        <div class="ve-course-teacher-loading ve-course-teacher-status-line" style="display:none;">
          <span class="spinner ve-course-teacher-status-spinner" style="width:10px; height:10px; border-width:1px; border-color:#2563eb; border-top-color:transparent;"></span>
          <span class="ve-course-teacher-status-text"></span>
        </div>
      `;
      tableWrap = el.querySelector('.ve-course-teacher-table-wrap');
      statusLine = el.querySelector('.ve-course-teacher-status-line');
      statusSpinner = el.querySelector('.ve-course-teacher-status-spinner');
      statusText = el.querySelector('.ve-course-teacher-status-text');
      el.dataset.rowsHash = '';
    }
    if (!(tableWrap instanceof HTMLElement) || !(statusLine instanceof HTMLElement) || !(statusText instanceof HTMLElement)) return;

    const prevHash = String(el.dataset.rowsHash || '');
    if (prevHash !== rowsHash) {
      if (!rows.length) {
        tableWrap.innerHTML = '';
      } else {
        const tbody = renderVeCourseTeacherRowsHtml(rows);
        tableWrap.innerHTML = `
          <table class="ve-course-teacher-table">
            <thead><tr><th>课程号</th><th>教师姓名</th><th>工号</th><th>教室</th><th>操作</th></tr></thead>
            <tbody>${tbody}</tbody>
          </table>
        `;
      }
      el.dataset.rowsHash = rowsHash;
    }

    statusLine.classList.remove('warning');
    statusLine.style.display = 'none';
    if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'inline-block';

    if (meta.loading) {
      statusLine.style.display = 'flex';
      statusText.textContent = rows.length ? '正在获取更多同课教师…' : '正在获取同课教师…';
      return;
    }
    if (meta.permissionDenied) {
      statusLine.style.display = 'flex';
      statusLine.classList.add('warning');
      if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'none';
      statusText.textContent = '学生账号无权限';
      return;
    }
    if (meta.error) {
      statusLine.style.display = 'flex';
      statusLine.classList.add('warning');
      if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'none';
      statusText.textContent = rows.length ? '获取同课教师失败，已显示部分结果' : '获取同课教师失败，请稍后重试';
      return;
    }
    if (meta.noReplay) {
      statusLine.style.display = 'flex';
      if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'none';
      statusText.textContent = '无法获取无回放课程的同课教师';
      return;
    }
    if (!rows.length) {
      statusLine.style.display = 'flex';
      if (statusSpinner instanceof HTMLElement) statusSpinner.style.display = 'none';
      statusText.textContent = '未查询到同课其他教师';
    }
  });
}

async function hydrateVeCourseTeachersMeta(courseId, courseNum, fzId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const cacheKey = buildVeXkhPrefix(courseNum, fzId).toUpperCase();
  const existing = window.veCourseTeachersMetaByCourseId?.[cid] || {};
  if (existing.loading) {
    updateVeCourseTeachersPopUi(cid);
    return existing.promise || Promise.resolve();
  }
  if (existing.loaded && !existing.permissionDenied) {
    updateVeCourseTeachersPopUi(cid);
    return Promise.resolve();
  }
  if (existing.permissionDenied && !window.isTeacherAccount) {
    updateVeCourseTeachersPopUi(cid);
    return Promise.resolve();
  }

  const cached = cacheKey ? window.veCourseTeachersCacheByPrefix?.[cacheKey] : null;
  if (cached && Array.isArray(cached.rows)) {
    window.veCourseTeachersMetaByCourseId[cid] = {
      rows: cached.rows,
      loading: false,
      loaded: true,
      error: false,
      noReplay: false,
      permissionDenied: false,
      promise: null
    };
    updateVeCourseTeachersPopUi(cid);
    return Promise.resolve();
  }

  const loadingMeta = { ...existing, rows: Array.isArray(existing.rows) ? existing.rows : [], loading: true, loaded: false, error: false, noReplay: false, permissionDenied: false, promise: null };
  window.veCourseTeachersMetaByCourseId[cid] = loadingMeta;
  updateVeCourseTeachersPopUi(cid);

  const p = fetchVeCourseTeachersByCourseNum(courseNum, fzId, (rows, state) => {
    const latest = window.veCourseTeachersMetaByCourseId?.[cid] || {};
    window.veCourseTeachersMetaByCourseId[cid] = {
      ...latest,
      rows: Array.isArray(rows) ? rows : [],
      loading: state?.done !== true,
      loaded: state?.done === true,
      error: !!state?.error,
      noReplay: !!state?.noReplay,
      permissionDenied: !!state?.permissionDenied,
      promise: latest.promise || null
    };
    updateVeCourseTeachersPopUi(cid);
  })
    .then((result) => {
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      if (cacheKey && !result?.error && !result?.permissionDenied && !result?.noReplay) {
        window.veCourseTeachersCacheByPrefix[cacheKey] = { rows };
      }
      window.veCourseTeachersMetaByCourseId[cid] = {
        rows,
        loading: false,
        loaded: true,
        error: !!result?.error,
        noReplay: !!result?.noReplay,
        permissionDenied: !!result?.permissionDenied,
        promise: null
      };
      updateVeCourseTeachersPopUi(cid);
    })
    .catch(() => {
      window.veCourseTeachersMetaByCourseId[cid] = { rows: [], loading: false, loaded: true, error: true, promise: null };
      updateVeCourseTeachersPopUi(cid);
    });

  window.veCourseTeachersMetaByCourseId[cid] = { ...loadingMeta, promise: p };
  return p;
}

async function switchToTeacherAccount(teacherId) {
  const tid = String(teacherId || '').trim();
  if (!tid) {
    showToast('教师/助教账号为空，无法切换', 'warning', 1600);
    return;
  }
  pendingUsernameChange = lastValidUsername ? { from: lastValidUsername, to: tid } : null;
  highPrioritySwitchTarget = tid;
  usernameInput.value = tid;
  await doLoginFlow();
}

async function fetchCoursewareItems(courseNum, fzId, externalAbortController = null) {
  const courseIdPart = String(courseNum || '').trim();
  const xkhIdPart = String(fzId || '').trim();
  if (!courseIdPart || !xkhIdPart) return { loginRequired: false, items: [] };

  // 注册 AbortController 以便账号/学期切换时中止
  if (externalAbortController instanceof AbortController) {
    window.activeCoursewareAbortControllers[courseIdPart] = externalAbortController;
  }
  // 合并全局 VE 中止信号
  const globalSignal = window.globalVeAbortController?.signal;
  const localSignal = externalAbortController instanceof AbortController ? externalAbortController.signal : undefined;
  const signal = globalSignal || localSignal;

  const buildCoursewareUrl = (useQuestionMark = true) => {
    const sep = useQuestionMark ? '?' : '&';
    return `${BASE_VE}back/coursePlatform/courseResource.shtml${sep}method=stuQueryUploadResourceForCourseList&courseId=${encodeURIComponent(courseIdPart)}&cId=${encodeURIComponent(courseIdPart)}&xkhId=${encodeURIComponent(xkhIdPart)}&xqCode=${encodeURIComponent(getCurrentXqCode())}&docType=1`;
  };

  let text = '';
  let res = null;
  try {
    ({ text, res } = await fetchText(buildCoursewareUrl(true), {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      },
      signal
    }));
  } catch (e) {
    if (signal?.aborted) return { loginRequired: false, items: [], aborted: true };
    throw e;
  }

  if (Number(res?.status || 0) === 404) {
    ({ text, res } = await fetchText(buildCoursewareUrl(false), {
      method: 'GET',
      headers: {
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      },
      signal
    }));
  }

  const isLoginRedirect = isLikelyLoginPageHtml(text, res?.url);
  const alertMsg = parseAlertMsg(text);
  const hasLoginKeywords = alertMsg?.includes('登录') || alertMsg?.includes('不合法') || String(text).includes('不合法') || String(text).includes('无权');

  if (isLoginRedirect || hasLoginKeywords) {
    return { loginRequired: true, items: [] };
  }

  let data = null;
  try { data = parseVeJson(text); } catch { data = null; }
  if (!data || typeof data !== 'object') return { loginRequired: false, items: [] };

  const response = (data?.response && typeof data.response === 'object') ? data.response : data;
  const list = Array.isArray(response?.resList) ? response.resList : [];

  const items = list.map((item, index) => {
    const rpName = String(item?.rpName || `课件-${index + 1}`).trim();
    const extName = normalizeResourceExt(String(item?.extName || '').trim());
    const urlRaw = String(item?.res_url || item?.resUrl || '').trim();
    const urlNorm = normalizeResourceUrl(urlRaw);
    const sizeMbRaw = Number(item?.rpSize);
    const name = extName && !/\.[a-zA-Z0-9_-]{1,16}$/.test(rpName) ? `${rpName}.${extName}` : rpName;
    const rpId = String(item?.rpId || '').trim();
    return {
      id: `cw-${rpId || `${courseIdPart}-${xkhIdPart}-${index}`}`,
      name,
      extName,
      url: urlNorm,
      rpId,
      courseId: String(courseIdPart || '').trim(),
      sizeMb: formatResourceSizeMb(sizeMbRaw),
      sizeMbRaw
    };
  });

  return { loginRequired: false, items };
}

async function loadCoursewareList(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const shouldRender = () => String(card.dataset.resultView || '').trim() === 'courseware';
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion) || (window.activeCoursewareAbortControllers[courseNum]?.signal?.aborted);

  setCoursewareButtonLoading(btn, true);
  setCourseCoursewareLoading(courseIdInt, true);
  toggleResultAreaAnimated(resultArea, true);
  card.dataset.resultView = 'courseware';
  resultArea.innerHTML = '<div class="spinner" style="border-color:#1e3a8a; border-top-color:transparent; display:inline-block;"></div> <span style="color:#666;">正在获取课件…</span>';
  syncCourseActionButtonText(card, 'courseware');

  const cwAbortController = new AbortController();

  try {
    const payload = await fetchCoursewareItems(courseNum, fzId, cwAbortController);
    if (isStale() || payload.aborted) {
      setCourseCoursewareLoading(courseIdInt, false);
      delete window.activeCoursewareAbortControllers[courseNum];
      return;
    }
    delete window.activeCoursewareAbortControllers[courseNum];
    if (payload.loginRequired) {
      setCourseCoursewareLoading(courseIdInt, false);
      if (payload.accountSwitched) {
        showToast('检测到当前账号已变更为 ' + payload.accountSwitched + '，正在切换并重新加载', 'info', 3000);
        try {
          await syncAccountInfoAndReloadVeCourses({ userId: payload.accountSwitched, reloadCourses: true, reloadResourceSpace: true });
        } catch { /* ignore */ }
        return;
      }
      if (shouldRender()) {
        resultArea.innerHTML = '<span class="error" style="color:#f44336;">[登录已失效，正在重启]</span>';
      }
      await restartVePlatformForLoginExpired('课件列表登录已失效，正在重启智慧课程平台…');
      return;
    }

    const html = buildCoursewareListHtml(courseIdInt, payload.items);
    syncCoursewareItemsIndex(courseIdInt, payload.items);
    window.coursewareCacheByCourseId[courseIdInt] = {
      html,
      items: payload.items,
      loaded: true
    };
    if (!payload.items.length) {
      btn.style.display = 'none';
      setCourseCoursewareState(courseIdInt, false);
      if (shouldRender()) {
        toggleResultAreaAnimated(resultArea, false);
        card.dataset.resultView = '';
      }
      return;
    }

    btn.style.display = '';
    setCourseCoursewareState(courseIdInt, true);
    if (shouldRender()) {
      resultArea.innerHTML = html;
    }
    startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
  } catch (e) {
    setCourseCoursewareLoading(courseIdInt, false);
    if (e?.name !== 'AbortError' && shouldRender()) {
      resultArea.innerHTML = `<span class="error">课件加载失败: ${escapeHtml(String(e?.message || e))}</span>`;
    }
  } finally {
    if (window.activeCoursewareAbortControllers[courseNum] === cwAbortController) {
      delete window.activeCoursewareAbortControllers[courseNum];
    }
    setCoursewareButtonLoading(btn, false);
    syncCoursewareButtonAvailability(btn, courseIdInt);
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  }
}

async function autoLoadCourseware(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  if (!btn || !card) return;
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  setCoursewareButtonLoading(btn, true);
  setCourseCoursewareLoading(courseIdInt, true);

  try {
    const payload = await fetchCoursewareItems(courseNum, fzId);
    if (isStale()) {
      setCourseCoursewareLoading(courseIdInt, false);
      return;
    }
    if (payload.loginRequired) {
      setCourseCoursewareLoading(courseIdInt, false);
      if (payload.accountSwitched) {
        showToast('检测到当前账号已变更为 ' + payload.accountSwitched + '，正在切换并重新加载', 'info', 3000);
        // 使用统一流程完成账号切换同步
        try {
          await syncAccountInfoAndReloadVeCourses({ userId: payload.accountSwitched, reloadCourses: true, reloadResourceSpace: true });
        } catch { /* ignore */ }
        return;
      }
      await restartVePlatformForLoginExpired('课件列表登录已失效，正在重启智慧课程平台…');
      return;
    }

    const html = buildCoursewareListHtml(courseIdInt, payload.items);
    syncCoursewareItemsIndex(courseIdInt, payload.items);
    window.coursewareCacheByCourseId[courseIdInt] = {
      html,
      items: payload.items,
      loaded: true
    };

    if (!payload.items.length) {
      btn.style.display = 'none';
      setCourseCoursewareState(courseIdInt, false);
      return;
    }

    btn.style.display = '';
    setCourseCoursewareState(courseIdInt, true);
  } catch {
    setCourseCoursewareLoading(courseIdInt, false);
  } finally {
    setCoursewareButtonLoading(btn, false);
    syncCoursewareButtonAvailability(btn, courseIdInt);
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  }
}

function toggleCoursewareFromCache(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;

  const currentView = String(card.dataset.resultView || '').trim();
  const isOpen = isResultAreaOpen(resultArea);
  const cache = window.coursewareCacheByCourseId[courseIdInt];
  const replayCache = window.videoReplayCacheByCourseId?.[courseIdInt];
  const replayShadowArea = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);

  const moveVisibleReplayToShadowIfNeeded = () => {
    if (currentView !== 'replay') return;
    if (!replayCache?.linksFetching) return;
    if (!(replayShadowArea instanceof HTMLElement)) return;
    if (replayShadowArea.firstChild) return;
    if (!resultArea.firstChild) return;
    const frag = document.createDocumentFragment();
    while (resultArea.firstChild) {
      frag.appendChild(resultArea.firstChild);
    }
    replayShadowArea.appendChild(frag);
  };

  if (isOpen && currentView === 'courseware') {
    toggleResultAreaAnimated(resultArea, false);
    card.dataset.resultView = '';
    syncCourseActionButtonText(card, '');
    return;
  }

  if (cache?.loaded && cache?.html) {
    // If replay links are still resolving, preserve live replay DOM in shadow before replacing visible area.
    moveVisibleReplayToShadowIfNeeded();
    syncCoursewareItemsIndex(courseIdInt, cache.items || []);
    resultArea.innerHTML = cache.html;
    toggleResultAreaAnimated(resultArea, true);
    card.dataset.resultView = 'courseware';
    syncCourseActionButtonText(card, 'courseware');
    startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
    return;
  }

  // Ensure replay live DOM is not lost while loading when switching views.
  moveVisibleReplayToShadowIfNeeded();
  autoLoadCourseware(btn, courseIdInt, courseNum, fzId).then(() => {
    const latestCache = window.coursewareCacheByCourseId?.[courseIdInt];
    if (!latestCache?.loaded || !latestCache?.html) return;
    if (!Array.isArray(latestCache.items) || !latestCache.items.length) return;
    syncCoursewareItemsIndex(courseIdInt, latestCache.items || []);
    resultArea.innerHTML = latestCache.html;
    toggleResultAreaAnimated(resultArea, true);
    card.dataset.resultView = 'courseware';
    syncCourseActionButtonText(card, 'courseware');
    startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId);
  }).catch(() => {
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  });
}

async function fetchCoursewareRpUrl(rpId, { signal = null, onLinkExpired = null } = {}) {
  if (!rpId) return { url: '' };
  try {
    const postUrl = `${BASE_VE}back/resourceSpace.shtml`;
    const postBody = new URLSearchParams({ method: 'rpinfoDownloadUrl', rpId: String(rpId) });
    const referer = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10480`;

    const { text, res } = await fetchText(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      },
      body: postBody.toString(),
      signal: getCombinedAbortSignal(window.globalVeAbortController?.signal, signal)
    });

    if (isLikelyLoginPageHtml(text, res?.url)) {
      if (typeof onLinkExpired === 'function') onLinkExpired();
      return { url: '', loginExpired: true };
    }

    const data = parseVeJson(text);
    if (data.flag === true || String(data.STATUS) === '0') {
      const url = String(data.rpUrl || data.html || '').trim();
      if (url) return { url };
      if (typeof onLinkExpired === 'function') onLinkExpired();
      return { url: '', loginExpired: true };
    }
    if (data.flag === false) {
      if (typeof onLinkExpired === 'function') onLinkExpired();
      return { url: '', loginExpired: true };
    }
    if (typeof onLinkExpired === 'function') onLinkExpired();
    return { url: '', loginExpired: true };
  } catch (error) {
    if (error?.name === 'AbortError') return { url: '', aborted: true };
    if (typeof onLinkExpired === 'function') onLinkExpired();
    return { url: '', loginExpired: true };
  }
}

async function startCoursewareRpLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  const cache = window.coursewareCacheByCourseId?.[courseIdInt];
  const items = Array.isArray(cache?.items) ? cache.items : [];
  const rpItems = items.filter((it) => !it.url && it.rpId);
  if (!rpItems.length || cache?.rpLinksFetched || cache?.rpLinksFetching) return;

  if (isStale()) {
    if (cache) cache.rpLinksFetching = false;
    return;
  }

  if (!cache) return;
  cache.rpLinksFetching = true;

  const activeView = String(card.dataset.resultView || '').trim();
  const baseText = activeView === 'courseware' ? '收起' : '课件下载';
  btn.classList.add('courseware-link-progress');
  btn.style.setProperty('--courseware-progress', '0%');
  btn.innerHTML = `${baseText} <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#1e3a8a; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;
  const batchAbortController = new AbortController();

  const totalLinks = rpItems.length;
  let doneLinks = 0;
  const onOneLinkDone = () => {
    doneLinks += 1;
    const p = Math.max(0, Math.min(100, Math.round((doneLinks / totalLinks) * 100)));
    btn.style.setProperty('--courseware-progress', `${p}%`);
    if (doneLinks >= totalLinks) {
      btn.classList.remove('courseware-link-progress');
      btn.style.removeProperty('--courseware-progress');
    }
  };

  let loginHandled = false;
  let loginExpiredSeen = false;

  await Promise.allSettled(rpItems.map(async (item) => {
    if (batchAbortController.signal.aborted) return;
    const result = await fetchCoursewareRpUrl(item.rpId, {
      signal: batchAbortController.signal,
      onLinkExpired: () => {
        loginExpiredSeen = true;
        try { batchAbortController.abort(); } catch { /* ignore */ }
      }
    }).finally(onOneLinkDone);
    if (isStale()) return;
    const rpUrl = String(result?.url || '').trim();
    if (rpUrl) {
      item.url = rpUrl;
      const displayUrl = cleanRpUrl(rpUrl);
      const linkContainer = resultArea.querySelector(`[id="courseware-rp-link-${item.id.replace(/["\\]/g, '')}"]`);
      const linkRow = linkContainer?.closest('.resource-link-row');
      if (linkContainer) {
        linkContainer.outerHTML = `<a class="resource-url" href="${escapeHtml(rpUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl)}</a>`;
      }
      if (linkRow && !linkRow.querySelector(`button.resource-copy-btn`)) {
        const downloadBtn = linkRow.querySelector(`button.resource-download-btn`);
        const newCopyBtn = document.createElement('button');
        newCopyBtn.className = 'btn resource-copy-btn';
        newCopyBtn.dataset.action = 'resource-copy';
        newCopyBtn.dataset.resourceId = item.id;
        newCopyBtn.textContent = '复制';
        if (downloadBtn) {
          linkRow.insertBefore(newCopyBtn, downloadBtn);
        } else {
          linkRow.appendChild(newCopyBtn);
        }
      }
    } else if (result?.loginExpired) {
      loginExpiredSeen = true;
      try { batchAbortController.abort(); } catch { /* ignore */ }
      const linkContainer = resultArea.querySelector(`[id="courseware-rp-link-${item.id.replace(/["\\]/g, '')}"]`);
      if (linkContainer) {
        linkContainer.innerHTML = '<span class="error" style="color:#f44336;">[登录已失效，正在重启]</span>';
      }
      if (!loginHandled) {
        loginHandled = true;
        await restartVePlatformForLoginExpired('课件下载链接登录已失效，正在重启智慧课程平台…');
      }
    }
  }));

  if (loginExpiredSeen) {
    cache.rpLinksFetched = false;
    cache.rpLinksFetching = false;
    btn.classList.remove('courseware-link-progress');
    btn.style.removeProperty('--courseware-progress');
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
    return;
  }

  cache.rpLinksFetched = true;
  cache.rpLinksFetching = false;
  const currentView = String(card.dataset.resultView || '').trim();
  if (currentView === 'courseware') {
    const newHtml = buildCoursewareListHtml(courseIdInt, items);
    cache.html = newHtml;
    resultArea.innerHTML = newHtml;
  }
  btn.classList.remove('courseware-link-progress');
  btn.style.removeProperty('--courseware-progress');
  syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
}

async function autoLoadVideoLinks(btn, courseIdInt, courseNum, fzId, xqCode) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const currentView = String(card.dataset.resultView || '').trim();
  const shouldTouchVisibleArea = currentView === 'replay'
    || (!currentView && !isResultAreaOpen(resultArea));
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);

  const ensureReplayShadowArea = () => {
    let shadow = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);
    if (shadow instanceof HTMLElement) return shadow;
    shadow = document.createElement('div');
    shadow.className = 'replay-shadow-area';
    shadow.dataset.courseId = String(courseIdInt);
    shadow.style.display = 'none';
    card.appendChild(shadow);
    return shadow;
  };
  const replayShadowArea = ensureReplayShadowArea();

  btn.disabled = true;
  btn.style.opacity = '1';
  btn.style.pointerEvents = 'none';
  btn.classList.remove('replay-link-progress');
  btn.classList.add('replay-list-loading');
  btn.style.setProperty('--replay-progress', '0%');
  btn.innerHTML = `回放下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#9c27b0; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;

  if (shouldTouchVisibleArea) {
    toggleResultAreaAnimated(resultArea, false, { immediate: true });
  }
  setCourseReplayLoading(courseIdInt, true);

  try {
    const list = (await fetchVeReplaySchedule(courseIdInt)).filter((it) => !!it.rpId);
    if (isStale()) {
      btn.classList.remove('replay-list-loading');
      btn.classList.remove('replay-link-progress');
      btn.style.removeProperty('--replay-progress');
      setCourseReplayLoading(courseIdInt, false);
      return;
    }
    if (!list.length) {
      btn.classList.remove('replay-list-loading');
      btn.style.display = 'none';
      setCourseReplayState(courseIdInt, false);
      return;
    }

    const replayListHtml = list.map((item, index) => {
      const rpId = String(item.rpId || '');
      const title = [item.roomName, item.rpName || '未知时间'].filter(Boolean).join(' ');
      const linkContainerId = `video-link-${courseIdInt}-${index}`;
      const detailHtml = item.content
        ? renderExpandableHtml(
            escapeHtml(item.content),
            { hideWhenEmpty: true, expandText: '点击查看回放详情', collapseText: '点击收起回放详情', baseBg: 'rgba(243,229,245,0.42)' }
          )
        : '';
      return `
        <div style="margin-bottom: 10px; padding: 5px; background: #e1bee733; border-radius: 4px; border-left: 3px solid #9C27B0;" data-rp-id="${rpId}">
          <div style="font-weight: bold; color: #4a148c; font-size: 15px;">${escapeHtml(title)}</div>
          <div style="margin-top: 5px;">
            <div class="replay-content-area" data-rp-id="${rpId}">${detailHtml}</div>
            <div id="${linkContainerId}" class="video-links" style="font-size: 12px; color: #9C27B0; margin-top: 5px; font-weight: bold; word-break: break-all;">
              <span class="spinner" style="width: 10px; height: 10px; border-width: 1px; border-color: #9C27B0; border-top-color: transparent;"></span> 获取中…
            </div>
          </div>
        </div>
      `;
    }).join('');

    window.videoReplayCacheByCourseId[courseIdInt] = {
      html: replayListHtml,
      list,
      loaded: true,
      contentLoaded: true,
      contentMap: Object.fromEntries(list.map((item) => [
        String(item.rpId || ''),
        item.content
          ? renderExpandableHtml(
              escapeHtml(item.content),
              { hideWhenEmpty: true, expandText: '点击查看回放详情', collapseText: '点击收起回放详情', baseBg: 'rgba(243,229,245,0.42)' }
            )
          : ''
      ])),
      linksFetched: false,
      linksFetching: false
    };
    if (isStale()) {
      btn.classList.remove('replay-list-loading');
      btn.classList.remove('replay-link-progress');
      btn.style.removeProperty('--replay-progress');
      setCourseReplayLoading(courseIdInt, false);
      return;
    }
    // Keep replay list DOM in hidden shadow area so background parsing/updating won't override current visible view.
    replayShadowArea.innerHTML = replayListHtml;
    if (shouldTouchVisibleArea && currentView === 'replay') {
      resultArea.innerHTML = replayListHtml;
    }

    // List is ready: allow users to open/close replay panel immediately.
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    btn.classList.remove('replay-list-loading');
    btn.classList.remove('replay-link-progress');
    btn.style.removeProperty('--replay-progress');
    btn.textContent = '回放下载';
    setCourseReplayState(courseIdInt, true);

  } catch (error) {
    btn.classList.remove('replay-list-loading');
    btn.classList.remove('replay-link-progress');
    btn.style.removeProperty('--replay-progress');
    if (String(error?.message || error) === 'LOGIN_REQUIRED') {
      btn.disabled = false;
      btn.style.pointerEvents = 'auto';
      btn.textContent = '回放下载';
      setCourseReplayLoading(courseIdInt, false);
      await restartVePlatformForLoginExpired('回放列表登录已失效，正在重启智慧课程平台…');
    } else {
      btn.style.display = 'none';
      if (shouldTouchVisibleArea) toggleResultAreaAnimated(resultArea, false, { immediate: true });
      setCourseReplayState(courseIdInt, false);
    }
  }
}

async function startReplayLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const courseListVersion = getCourseListLoadVersionSnapshot();
  const isStale = () => isCourseListLoadStale(courseListVersion);
  const cache = window.videoReplayCacheByCourseId?.[courseIdInt];
  const list = Array.isArray(cache?.list) ? cache.list : [];
  if (!cache || !list.length || cache.linksFetched || cache.linksFetching) {
    flushPendingCourseCardSortIfIdle();
    return;
  }

  if (isStale()) {
    cache.linksFetching = false;
    setCourseReplayLoading(courseIdInt, false);
    flushPendingCourseCardSortIfIdle();
    return;
  }

  cache.linksFetching = true;
  const activeView = String(card.dataset.resultView || '').trim();
  const baseText = activeView === 'replay' ? '收起' : '回放下载';
  btn.classList.add('replay-link-progress');
  btn.style.setProperty('--replay-progress', '0%');
  btn.innerHTML = `${baseText} <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#9c27b0; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;
  const batchAbortController = new AbortController();

  const shadowArea = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);
  const shadowHasContent = (shadowArea instanceof HTMLElement) && !!String(shadowArea.innerHTML || '').trim();
  const workingArea = shadowHasContent ? shadowArea : resultArea;

  const totalLinks = list.length;
  let doneLinks = 0;
  const onOneLinkDone = () => {
    doneLinks += 1;
    const p = Math.max(0, Math.min(100, Math.round((doneLinks / totalLinks) * 100)));
    btn.style.setProperty('--replay-progress', `${p}%`);
    if (doneLinks >= totalLinks) {
      btn.classList.remove('replay-link-progress');
      btn.style.removeProperty('--replay-progress');
    }
  };

  let loginExpiredSeen = false;
  const linkResults = await Promise.allSettled(list.map((item, index) => {
    const linkContainerId = `video-link-${courseIdInt}-${index}`;
    if (batchAbortController.signal.aborted) return Promise.resolve(false);
    return fetchVideoLinkInternal(linkContainerId, item.rpId, courseNum, fzId, item.teacherId || '', {
      signal: batchAbortController.signal,
      onLinkExpired: () => {
        loginExpiredSeen = true;
        try { batchAbortController.abort(); } catch { /* ignore */ }
      }
    })
      .finally(onOneLinkDone);
  }));

  const hasLoginRequired = loginExpiredSeen || linkResults.some((result) => result.status === 'fulfilled' && result.value === 'LOGIN_REQUIRED');
  if (hasLoginRequired) {
    cache.linksFetching = false;
    cache.linksFetched = false;
    setCourseReplayLoading(courseIdInt, false);
    btn.classList.remove('replay-link-progress');
    btn.style.removeProperty('--replay-progress');
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
    flushPendingCourseCardSortIfIdle();
    return;
  }

  if (isStale()) {
    cache.linksFetching = false;
    setCourseReplayLoading(courseIdInt, false);
    btn.classList.remove('replay-link-progress');
    btn.style.removeProperty('--replay-progress');
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
    flushPendingCourseCardSortIfIdle();
    return;
  }

  cache.linksFetching = false;
  cache.linksFetched = true;
  const currentView = String(card.dataset.resultView || '').trim();
  const visibleHtml = String(resultArea.innerHTML || '').trim();
  const shadowHtml = (shadowArea instanceof HTMLElement) ? String(shadowArea.innerHTML || '').trim() : '';
  const workingHtml = String(workingArea.innerHTML || '').trim();
  // Only prefer visible area when replay view is active; otherwise visible area may be courseware content.
  const visibleReplayHtml = currentView === 'replay' ? visibleHtml : '';
  const finalHtml = visibleReplayHtml || shadowHtml || workingHtml || String(cache.html || '');
  cache.html = finalHtml;

  if (currentView === 'replay' && finalHtml) {
    resultArea.innerHTML = cache.html;
    toggleResultAreaAnimated(resultArea, true, { immediate: true });
  }
  btn.classList.remove('replay-link-progress');
  btn.style.removeProperty('--replay-progress');
  syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  flushPendingCourseCardSortIfIdle();
}

function toggleReplayFromCache(btn, courseIdInt) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  if (!btn || !card || !resultArea) return;
  const cache = window.videoReplayCacheByCourseId[courseIdInt];
  const currentView = String(card.dataset.resultView || '').trim();
  const isOpen = isResultAreaOpen(resultArea);
  const shadowArea = card.querySelector(`.replay-shadow-area[data-course-id="${String(courseIdInt)}"]`);
  const moveShadowNodesToVisible = () => {
    if (!(shadowArea instanceof HTMLElement)) return false;
    if (!shadowArea.firstChild) return false;
    const frag = document.createDocumentFragment();
    while (shadowArea.firstChild) {
      frag.appendChild(shadowArea.firstChild);
    }
    resultArea.innerHTML = '';
    resultArea.appendChild(frag);
    return true;
  };

  if (isOpen && currentView === 'replay') {
    toggleResultAreaAnimated(resultArea, false);
    card.dataset.resultView = '';
    syncCourseActionButtonText(card, '');
    return;
  }

  if (!cache?.html) {
    if (btn.disabled) return;
    const courseNum = String(btn.dataset.courseNum || courseIdInt || '').trim();
    const fzId = String(btn.dataset.fzId || '').trim();
    const xqCode = String(btn.dataset.xqCode || getCurrentXqCode() || '').trim();
    autoLoadVideoLinks(btn, courseIdInt, courseNum, fzId, xqCode).then(() => {
      const latestCache = window.videoReplayCacheByCourseId?.[courseIdInt];
      if (latestCache?.html && String(card.dataset.resultView || '').trim() !== 'replay') {
        toggleReplayFromCache(btn, courseIdInt);
      }
    }).catch(() => {});
    return;
  }

  if (cache?.linksFetching) {
    const shadowHtml = (shadowArea instanceof HTMLElement) ? String(shadowArea.innerHTML || '') : '';
    if (shadowHtml.trim()) {
      // Move live DOM nodes to avoid race windows where late updates are written into shadow then lost.
      moveShadowNodesToVisible();
    } else if (cache?.html) {
      resultArea.innerHTML = cache.html;
    }
  } else if (!cache?.linksFetched && moveShadowNodesToVisible()) {
    // If list is ready but link fetching just started, prefer moving shadow nodes to avoid duplicate IDs.
  } else if (cache?.html) {
    resultArea.innerHTML = cache.html;
  }
  toggleResultAreaAnimated(resultArea, true);
  card.dataset.resultView = 'replay';
  syncCourseActionButtonText(card, 'replay');

  const courseNum = String(btn.dataset.courseNum || '').trim();
  const fzId = String(btn.dataset.fzId || '').trim();
  startReplayLinkFetchIfNeeded(btn, courseIdInt, courseNum, fzId).catch(() => {});
}

async function loadCourses() {
  try { console.debug && console.debug('loadCourses entry', Date.now()); } catch (e) {}
  try { console.debug && console.debug(new Error('loadCourses stack').stack); } catch (e) {}
  // 立即中止所有进行中的课件/回放请求
  abortAllCoursewareReplayFetches();
  const courseLoadVersion = bumpPlatformLoadVersion('ve');
  window.courseListLoadVersion = courseLoadVersion;
  window.homeworkNoteAttachmentCacheByKey = {};
  window.homeworkAttachmentItemsById = {};
  window.homeworkAttachmentItemsByCourseId = {};

  if (courseLoadingStatus) courseLoadingStatus.style.display = 'none';
  setPlatformLoginState('ve', isPlatformEnabled('ve') ? 'checking' : 'checking');
  try {
    if (!isPlatformEnabled('ve')) {
      window.currentVeCourseList = [];
      window.platformLoadedOnce.ve = false;
      if (courseLoadVersion !== window.courseListLoadVersion) return;
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    const url = `${BASE_VE}back/coursePlatform/course.shtml?method=getCourseList&pagesize=100&page=1&xqCode=${encodeURIComponent(await ensureCurrentXqCode())}`;
    const { text } = await fetchText(url, {
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
    });

    let data;
    try { data = JSON.parse(text); } catch {
      // probably redirected / html
      isLoginSessionValid = false;
      setPlatformLoginState('ve', 'offline');
      if (usernameInput.value.trim()) {
        handleLoginRequired(() => {
          loadCourses();
        }, null, '请输入账号登录');
      }
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    if (String(data.STATUS) !== '0') {
      const msg = data.ERRMSG || data.message || '课程接口返回异常';
      if (String(msg).includes('不合法') || String(msg).includes('登录')) {
        isLoginSessionValid = false;
        setPlatformLoginState('ve', 'offline');
        if (usernameInput.value.trim()) {
          handleLoginRequired(() => {
            loadCourses();
          }, null, '请输入账号登录');
        }
        renderCourseList([]);
        rematchExternalByVeCourses();
        rerenderAllHomeworkAreas();
        if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
        if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
        if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
        return;
      }
      setPlatformLoginState('ve', 'offline');
      showToast('课程加载失败: ' + msg, 'error');
      renderCourseList([]);
      rematchExternalByVeCourses();
      rerenderAllHomeworkAreas();
      if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
      if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
      if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
      return;
    }

    const list = data.courseList || [];
    window.currentVeCourseList = Array.isArray(list) ? list : [];
    window.platformLoadedOnce.ve = true;
    setPlatformLoginState('ve', 'online');
    if (courseLoadVersion !== window.courseListLoadVersion) return;
    rematchExternalByVeCourses();
    renderCourseList(list);
    rerenderAllHomeworkAreas();
    if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
    if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
    if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
  } catch (e) {
    setPlatformLoginState('ve', 'offline');
    const errMsg = String(e?.message || '');
    const likelyLoginInvalid = /Failed to fetch/i.test(errMsg);
    if (likelyLoginInvalid) {
      isLoginSessionValid = false;
      if (usernameInput.value.trim()) {
        handleLoginRequired(() => {
          loadCourses();
        }, null, '请输入账号登录');
      }
    } else {
      showToast('课程加载失败: ' + errMsg, 'error');
    }
    renderCourseList([]);
    rematchExternalByVeCourses();
    rerenderAllHomeworkAreas();
    if (isPlatformEnabled('ykt')) renderYktStandaloneCourses();
    if (isPlatformEnabled('mrjzy')) renderMrjzyStandaloneCourses();
    if (isPlatformEnabled('jlgj')) renderJlgjStandaloneCourses();
  } finally {
    if (courseLoadVersion === window.courseListLoadVersion && courseLoadingStatus) courseLoadingStatus.style.display = 'none';
  }
}

function bindCourseCardActionButtons(root = courseListDiv) {
  if (!(root instanceof HTMLElement)) return;
  const cards = root.classList.contains('file-item')
    ? [root]
    : Array.from(root.querySelectorAll('.file-item'));
  cards.forEach((card) => {
    if (!(card instanceof HTMLElement)) return;
    let courseId = String(card.dataset.courseId || '').trim();
    if (!courseId) {
      const id = String(card.id || '').trim();
      courseId = id.startsWith('course-') ? id.slice('course-'.length) : '';
    }
    if (!courseId) return;

    const meta = card.querySelector('.ve-course-num-wrap');
    const courseNumRaw = String(
      card.querySelector('button[data-action="courseware"]')?.dataset?.courseNum ||
      card.querySelector('button[data-action="videos"]')?.dataset?.courseNum ||
      meta?.dataset?.courseNum ||
      courseId
    ).trim();
    const fzId = String(
      card.querySelector('button[data-action="courseware"]')?.dataset?.fzId ||
      card.querySelector('button[data-action="videos"]')?.dataset?.fzId ||
      meta?.dataset?.fzId ||
      ''
    ).trim();

    const btnCourseware = card.querySelector('button[data-action="courseware"]');
    if (btnCourseware instanceof HTMLElement && btnCourseware.__courseActionBound !== true) {
      btnCourseware.dataset.courseNum = courseNumRaw;
      btnCourseware.dataset.fzId = fzId;
      btnCourseware.__courseActionBound = true;
      btnCourseware.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleCoursewareFromCache(btnCourseware, courseId, courseNumRaw, fzId);
      });
    }

    const btnVideos = card.querySelector('button[data-action="videos"]');
    if (btnVideos instanceof HTMLElement && btnVideos.__courseActionBound !== true) {
      btnVideos.dataset.courseNum = courseNumRaw;
      btnVideos.dataset.fzId = fzId;
      btnVideos.__courseActionBound = true;
      btnVideos.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleReplayFromCache(btnVideos, courseId);
      });
    }

    const btnAssessment = card.querySelector('button[data-action="assessment"]');
    if (btnAssessment instanceof HTMLButtonElement && btnAssessment.__courseActionBound !== true) {
      const assessmentUrl = getCourseAssessmentWorkbookUrl(courseId);
      if (assessmentUrl) btnAssessment.dataset.qrUrl = assessmentUrl;
      btnAssessment.__courseActionBound = true;
      btnAssessment.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        downloadCourseAssessmentWorkbook(courseId);
      });
    }

    const btnArchive = card.querySelector('button[data-action="archive"]');
    if (btnArchive instanceof HTMLButtonElement && btnArchive.__courseActionBound !== true) {
      btnArchive.__courseActionBound = true;
      btnArchive.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleCourseArchive(btnArchive, courseId);
      });
    }
    if (btnArchive instanceof HTMLButtonElement) {
      const archiveCache = window.archiveCacheByCourseId?.[String(courseId || '').trim()];
      const archiveKnownEmpty = archiveCache?.loaded && (!Array.isArray(archiveCache.items) || !archiveCache.items.length);
      btnArchive.style.display = archiveKnownEmpty ? 'none' : '';
    }
  });
}

function autoLoadCourseResourcesForCard(card) {
  if (!isAutoLoadCourseResourcesEnabled()) return;
  if (!(card instanceof HTMLElement)) return;
  let courseId = String(card.dataset.courseId || '').trim();
  if (!courseId) {
    const id = String(card.id || '').trim();
    courseId = id.startsWith('course-') ? id.slice('course-'.length) : '';
  }
  if (!courseId || /^(ykt|mrjzy|jlgj|mooc)-/.test(courseId)) return;

  const meta = card.querySelector('.ve-course-num-wrap');
  const btnCourseware = card.querySelector('button[data-action="courseware"]');
  const btnVideos = card.querySelector('button[data-action="videos"]');
  const btnArchive = card.querySelector('button[data-action="archive"]');
  const courseNumRaw = String(btnCourseware?.dataset?.courseNum || btnVideos?.dataset?.courseNum || meta?.dataset?.courseNum || courseId).trim();
  const fzId = String(btnCourseware?.dataset?.fzId || btnVideos?.dataset?.fzId || meta?.dataset?.fzId || '').trim();
  const xqCode = String(btnVideos?.dataset?.xqCode || getCurrentXqCode() || '').trim();

  if (btnCourseware instanceof HTMLElement && !window.coursewareCacheByCourseId?.[courseId]?.loaded) {
    autoLoadCourseware(btnCourseware, courseId, courseNumRaw, fzId).catch(() => {});
  }
  if (btnVideos instanceof HTMLElement && !window.videoReplayCacheByCourseId?.[courseId]?.loaded) {
    autoLoadVideoLinks(btnVideos, courseId, courseNumRaw, fzId, xqCode).catch(() => {});
  }
  if (btnArchive instanceof HTMLButtonElement && !window.archiveCacheByCourseId?.[courseId]?.loaded) {
    toggleCourseArchive(btnArchive, courseId, { render: false }).catch(() => {});
  }
}

function autoLoadCourseResourcesForRenderedCourses() {
  if (!isAutoLoadCourseResourcesEnabled() || !courseListDiv) return;
  courseListDiv.querySelectorAll('.file-item[id^="course-"]').forEach((card) => {
    autoLoadCourseResourcesForCard(card);
  });
}

function renderCourseList(courses) {
  courseListDiv.innerHTML = '';
  const homeworkLoadPromises = [];
  if (!courses || !courses.length) {
    window.veHomeworkLoadPromise = Promise.resolve([]);
    if (isPlatformEnabled('mooc') && window.platformLoadedOnce?.mooc) window.BjtuMoocPlatform?.render();
    updateCourseListEmptyPlaceholder();
    return;
  }

  courses.forEach(course => {
    const card = document.createElement('div');
    card.className = 'file-item';
    card.style.backgroundColor = '#fff';
    const courseId = course.id || course.cId || course.courseId || course.course_id;
    const courseNumRaw = course.course_num || course.courseNum || course.courseNo || course.course_id || courseId;
    const courseNum = getVeCourseSeq10(course) || String(courseNumRaw || '');
    const fzId = course.fz_id || course.fzId || course.xkhId || course.xkh_id || '';
    const xqCode = course.xq_code || course.xqCode || getCurrentXqCode();
    const courseName = course.name || course.NAME || course.courseName || course.title || '未知课程';
    const teacherName = course.teacher_name || course.teacherName || '';
    const teacherLabel = String(teacherName || '').trim() || '教师';
    const coursePlatformUrl = `${BASE_VE}back/coursePlatform/coursePlatform.shtml?method=toCoursePlatform&courseToPage=10460&courseId=${encodeURIComponent(courseNumRaw || '')}&cId=${encodeURIComponent(courseId || '')}&xknId=${encodeURIComponent(fzId || '')}&xkhId=${encodeURIComponent(fzId || '')}&xqCode=${encodeURIComponent(xqCode || getCurrentXqCode())}`;

    card.id = `course-${courseId}`;
    card.dataset.courseRankable = '1';
    card.dataset.order = String(courses.indexOf(course));
    card.dataset.rank = '7';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div class="course-card-title"><strong><a href="${coursePlatformUrl}" target="_blank" rel="noopener noreferrer" style="color:#1565c0; text-decoration:none;">${escapeHtml(courseName)}</a></strong></div>
          <div style="font-size:12px; color:#666; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="ve-teacher-wrap" data-course-id="${escapeHtml(String(courseId || ''))}">
              <span class="ve-teacher-name">${escapeHtml(teacherLabel)}</span>
              <span class="ve-teacher-pop" data-course-id="${escapeHtml(String(courseId || ''))}">
                <div style="font-size:12px; color:#64748b;">悬停加载教师信息…</div>
              </span>
            </span>
            <span>·</span>
            <span class="ve-course-num-wrap" data-course-id="${escapeHtml(String(courseId || ''))}" data-course-num="${escapeHtml(String(courseNumRaw || ''))}" data-fz-id="${escapeHtml(String(fzId || ''))}">
              <span class="ve-course-num-text">${escapeHtml(String(courseNum || ''))}</span>
              <span class="ve-course-teacher-pop" data-course-id="${escapeHtml(String(courseId || ''))}"><div style="font-size:12px; color:#64748b;">悬停加载同课教师…</div></span>
            </span>
          </div>
        </div>
        <div class="course-actions" style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn" style="background:#1e3a8a;" data-action="courseware">课件下载</button>
          <button class="btn" style="background:#9C27B0;" data-action="videos">回放下载</button>
          <button class="btn" style="background:#0f766e; max-width:220px; white-space:normal; line-height:1.25; padding:6px 8px; display:none;" data-action="assessment" data-course-id="${escapeHtml(String(courseId || ''))}">课程考核记录表下载</button>
          <button class="btn" style="background:#0369a1; max-width:220px; white-space:normal; line-height:1.25; padding:6px 8px; display:none;" data-action="archive" data-course-id="${escapeHtml(String(courseId || ''))}">归档下载</button>
        </div>
      </div>
      <div class="result-area" style="margin-top:6px; display:none; padding-top:6px; border-top:1px dashed #eee;"></div>
        <div id="homework-area-${courseId}" class="homework-area" style="margin-top:6px; padding-top:6px; border-top:1px dashed #eee; font-size:13px; color:#666;"></div>
    `;
    courseListDiv.appendChild(card);

    // bind actions
    const btnCourseware = card.querySelector('button[data-action="courseware"]');
    const btnVideos = card.querySelector('button[data-action="videos"]');
    const btnAssessment = card.querySelector('button[data-action="assessment"]');
    const btnArchive = card.querySelector('button[data-action="archive"]');
    if (btnCourseware) {
      btnCourseware.dataset.courseNum = String(courseNumRaw || '');
      btnCourseware.dataset.fzId = String(fzId || '');
      btnCourseware.__courseActionBound = true;
      btnCourseware.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleCoursewareFromCache(btnCourseware, courseId, courseNumRaw, fzId);
      });
      if (isAutoLoadCourseResourcesEnabled()) {
        setCoursewareButtonLoading(btnCourseware, true);
      }
    }
    if (btnVideos) {
      btnVideos.dataset.courseNum = String(courseNumRaw || '');
      btnVideos.dataset.fzId = String(fzId || '');
      btnVideos.dataset.xqCode = String(xqCode || '');
      btnVideos.__courseActionBound = true;
      btnVideos.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleReplayFromCache(btnVideos, courseId);
      });
      if (isAutoLoadCourseResourcesEnabled()) {
        // Show replay-loading animation immediately after card renders.
        btnVideos.disabled = true;
        btnVideos.style.opacity = '1';
        btnVideos.style.pointerEvents = 'none';
        btnVideos.classList.remove('replay-link-progress');
        btnVideos.classList.add('replay-list-loading');
        btnVideos.style.setProperty('--replay-progress', '0%');
        btnVideos.innerHTML = `回放下载 <span class="spinner" style="display:inline-block; width:10px; height:10px; margin-left:4px; border-width:2px; border-color:#9c27b0; border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;
      }
    }
    if (btnAssessment) {
      const assessmentUrl = getCourseAssessmentWorkbookUrl(courseId);
      if (assessmentUrl) btnAssessment.dataset.qrUrl = assessmentUrl;
      btnAssessment.__courseActionBound = true;
      btnAssessment.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        downloadCourseAssessmentWorkbook(courseId);
      });
      updateAssessmentButtonVisibility(courseId);
    }
    if (btnArchive) {
      btnArchive.__courseActionBound = true;
      btnArchive.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleCourseArchive(btnArchive, courseId);
      });
      updateArchiveButtonVisibility(courseId);
    }

    hydrateVeTeacherMeta(courseId, courseNumRaw, fzId).catch(() => {});

    // Prioritize homework fetching before replay link prefetch.
  updateCourseListEmptyPlaceholder();
    const hwPromise = checkHomework(courseId);
    homeworkLoadPromises.push(hwPromise);
    if (btnCourseware) {
      hwPromise.finally(() => {
        // Balance the initial preloading spinner before entering actual auto-load phase.
        setCoursewareButtonLoading(btnCourseware, false);
        if (isAutoLoadCourseResourcesEnabled()) {
          autoLoadCourseware(btnCourseware, courseId, courseNumRaw, fzId).catch(() => {});
        }
      });
    }
    if (btnArchive) {
      hwPromise.finally(() => {
        if (isAutoLoadCourseResourcesEnabled()) {
          toggleCourseArchive(btnArchive, courseId, { render: false }).catch(() => {});
        }
      });
    }
    if (btnVideos) {
      hwPromise.finally(() => {
        if (isAutoLoadCourseResourcesEnabled()) {
          autoLoadVideoLinks(btnVideos, courseId, courseNumRaw, fzId, xqCode);
        }
      });
    }
  });
  window.veHomeworkLoadPromise = Promise.allSettled(homeworkLoadPromises);
  if (isPlatformEnabled('mooc') && window.platformLoadedOnce?.mooc) window.BjtuMoocPlatform?.render();

}

function getHomeworkTeacherId(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return '';
  const cached = String(window.veTeacherMetaByCourseId?.[cid]?.teacherId || '').trim();
  if (cached) return cached;
  const list = Array.isArray(window.currentVeCourseList) ? window.currentVeCourseList : [];
  const found = list.find((it) => String(it?.id || it?.cId || it?.courseId || it?.course_id || '').trim() === cid) || null;
  return String(found?.teacher_id || found?.teacherId || found?.teacherid || '').trim();
}

async function ensureHomeworkTeacherId(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return '';
  let teacherId = getHomeworkTeacherId(cid);
  if (teacherId) return teacherId;

  const card = document.getElementById(`course-${cid}`);
  const wrap = card?.querySelector('.ve-course-num-wrap');
  const courseNum = String(wrap?.dataset?.courseNum || '').trim();
  if (!courseNum) return '';

  await hydrateVeTeacherMeta(cid, courseNum, '');
  teacherId = String(window.veTeacherMetaByCourseId?.[cid]?.teacherId || '').trim();
  return teacherId;
}

function renderHomeworkAttachments(hw, borderColor = '#ff9800', backgroundColor = '') {
  const key = String(hw?.__attachmentKey || '').trim();
  if (!key) return '';
  const cache = window.homeworkNoteAttachmentCacheByKey?.[key] || null;
  const list = Array.isArray(cache?.picList) ? cache.picList : [];
  if (!list.length) return '';

  const courseId = String(hw?.__courseId || '').trim();
  const normalizedBorderColor = String(borderColor || '').toLowerCase();
  const isTeacherMode = !!window.isTeacherAccount;
  const softBg = backgroundColor || (isTeacherMode
    ? (normalizedBorderColor.includes('a78bfa') ? 'rgba(237,233,254,0.72)' : 'rgba(219,234,254,0.72)')
    : (normalizedBorderColor.includes('4caf50')
      ? 'rgba(232,245,233,0.72)'
      : (normalizedBorderColor.includes('ef4444') || normalizedBorderColor.includes('b91c1c') || normalizedBorderColor.includes('f44336')
        ? 'rgba(254,242,242,0.78)'
        : 'rgba(255,243,224,0.72)')));

  const rows = list.map((it, idx) => {
    const fileNameNoExt = String(it?.fileNameNoExt || '').trim() || `附件${idx + 1}`;
    const sizeBytes = Math.max(0, Number(it?.sizeBytes || 0) || 0);
    const sizeText = formatSize(sizeBytes);
    const sizeStyle = buildHomeworkAttachmentSizeStyle(sizeBytes);
    const url = String(it?.url || '').trim();
    if (!url) return '';
    const resourceId = `hwatt-${encodeURIComponent(key)}-${idx}`;
    const checked = window.resourceSpaceSelected.has(resourceId) ? 'checked' : '';
    const item = {
      id: resourceId,
      name: fileNameNoExt,
      extName: '',
      url,
      courseId,
      sizeMbRaw: sizeBytes / (1024 * 1024),
      sizeMb: sizeText
    };
    registerHomeworkAttachmentItem(courseId, item);
    return `
      <div class="file-item" data-resource-id="${escapeHtml(resourceId)}" style="padding:6px 8px; border:1px solid ${borderColor}; border-radius:6px; background:${softBg}; margin-top:6px;">
        <div class="resource-row-title" style="margin-bottom:4px; cursor:pointer;">
          <input type="checkbox" data-action="resource-check" data-resource-id="${escapeHtml(resourceId)}" ${checked} style="margin:0 4px 0 0;">
          <span style="color:#111827; font-weight:700;">${escapeHtml(fileNameNoExt)}</span>
          <span class="file-size-emphasis" data-file-size-bytes="${sizeBytes}" style="${sizeStyle}">${escapeHtml(sizeText)}</span>
        </div>
        <div class="resource-link-row">
          <a class="resource-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
          <div style="display:flex; align-items:center; gap:6px; margin-left:auto;">
            <button class="btn resource-copy-btn" data-action="resource-copy" data-resource-id="${escapeHtml(resourceId)}">复制</button>
            <button class="btn resource-download-btn" data-action="resource-download" data-resource-id="${escapeHtml(resourceId)}">下载</button>
          </div>
        </div>
        <div class="resource-download-progress" style="display:none;">
          <div class="progress-bar-container"><div class="progress-bar"></div></div>
          <div class="resource-download-meta">
            <span class="resource-dl-status"></span>
            <span class="resource-dl-size"></span>
            <span class="resource-dl-speed"></span>
            <span class="resource-dl-eta"></span>
          </div>
        </div>
      </div>
    `;
  }).filter(Boolean).join('');

  if (!rows) return '';
  return `<div style="margin-top:6px;">${rows}</div>`;
}

function getHomeworkSubmitCountValue(hw) {
  const raw = hw?.submitCount ?? hw?.submit_count ?? hw?.subCount ?? hw?.submitNum ?? hw?.submittedCount ?? '';
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function shouldShowCourseAssessmentButton(courseId) {
  if (!window.isTeacherAccount) return false;
  const list = window.courseHomeworkData?.[courseId]?.list || [];
  if (!Array.isArray(list) || !list.length) return false;
  return list.some((hw) => getHomeworkSubmitCountValue(hw) > 0);
}

function updateAssessmentButtonVisibility(courseId) {
  const btn = document.querySelector(`button[data-action="assessment"][data-course-id="${CSS.escape(String(courseId || ''))}"]`);
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.style.display = shouldShowCourseAssessmentButton(courseId) ? '' : 'none';
}

function updateArchiveButtonVisibility(courseId) {
  const btn = document.querySelector(`button[data-action="archive"][data-course-id="${CSS.escape(String(courseId || ''))}"]`);
  if (!(btn instanceof HTMLButtonElement)) return;
  const cache = window.archiveCacheByCourseId?.[String(courseId || '').trim()];
  const knownEmpty = cache?.loaded && (!Array.isArray(cache.items) || !cache.items.length);
  btn.style.display = knownEmpty ? 'none' : '';
}

function getCourseAssessmentWorkbookUrl(courseId) {
  const cid = String(courseId || '').trim();
  return cid ? `${BASE_VE}back/coursePlatform/homeWork.shtml?method=exportProcessAssessmentList&cId=${encodeURIComponent(cid)}` : '';
}

function downloadCourseAssessmentWorkbook(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid || !window.isTeacherAccount) return;
  const url = getCourseAssessmentWorkbookUrl(cid);
  try {
    chrome.downloads.download({
      url,
      filename: sanitizeDownloadFileName(`课程考核记录表-${cid}.xls`, '课程考核记录表.xls'),
      saveAs: false
    }, () => {
      const err = chrome.runtime?.lastError?.message || '';
      if (err) showToast('课程考核记录表下载失败：' + err, 'error', 3000);
    });
  } catch (error) {
    showToast('课程考核记录表下载失败：' + String(error?.message || error), 'error', 3000);
  }
}

function getCourseArchiveDownloadUrl(courseId) {
  const cid = String(courseId || '').trim();
  return cid ? `${BASE_VE}back/materialArchiving/MaterialArchivingIndex.shtml?method=batchDownloadFiles&courseId=${encodeURIComponent(cid)}` : '';
}

function buildCourseArchiveHtml(courseId, items) {
  const cid = String(courseId || '').trim();
  const batchUrl = getCourseArchiveDownloadUrl(cid);
  const batchButton = `<button class="btn" style="background:#0369a1; padding:3px 8px; margin-left:auto; font-size:11px; line-height:1.2;" data-action="archive-batch-download" data-course-id="${escapeHtml(cid)}" data-qr-url="${escapeHtml(batchUrl)}">打包下载</button>`;
  return buildCoursewareListHtml(cid, items, batchButton);
}

async function fetchCourseArchiveItems(courseId) {
  const cid = String(courseId || '').trim();
  const url = `${BASE_VE}back/materialArchiving/MaterialArchivingIndex.shtml?method=queryMaterialArchivingByCourseId&course_id=${encodeURIComponent(cid)}`;
  const { text, res } = await fetchText(url, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01' },
    signal: window.globalVeAbortController?.signal
  });
  if (isLikelyLoginPageHtml(text, res?.url)) return { loginRequired: true, items: [] };
  const data = parseVeJson(text);
  const rawItems = Array.isArray(data?.result?.[0]?.resList) ? data.result[0].resList : [];
  const items = rawItems.map((raw, index) => ({
    id: `archive-${cid}-${String(raw?.id ?? index)}`,
    sourceId: raw?.id,
    courseId: cid,
    name: String(raw?.name || `归档资源-${index + 1}`).trim(),
    rpName: String(raw?.name || '').trim(),
    extName: String(raw?.res_ext_name || '').trim(),
    rpId: String(raw?.uuid || '').trim(),
    examineStatus: raw?.examine_status,
    resNo: raw?.res_no,
    url: ''
  }));

  return { loginRequired: false, items };
}

async function startCourseArchiveLinkFetch(btn, courseId) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  const cid = String(courseId || '').trim();
  const cache = window.archiveCacheByCourseId?.[cid];
  const linkItems = Array.isArray(cache?.items) ? cache.items.filter((item) => item.rpId && !item.url) : [];
  if (!(btn instanceof HTMLButtonElement) || !card || !resultArea || !cache || !linkItems.length || cache.linksFetching) return;

  cache.linksFetching = true;
  btn.disabled = true;
  btn.classList.remove('archive-list-loading');
  btn.classList.add('archive-link-progress');
  btn.style.setProperty('--archive-progress', '0%');
  btn.innerHTML = `收起 <span class="spinner" style="display:inline-block;width:10px;height:10px;margin-left:4px;border-width:2px;border-color:#0369a1;border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;

  let completed = 0;
  let loginRequired = false;
  await Promise.all(linkItems.map(async (item) => {
    if (loginRequired) return;
    const result = await fetchCoursewareRpUrl(item.rpId);
    if (result?.loginExpired) loginRequired = true;
    else item.url = String(result?.url || '').trim();
    completed += 1;
    btn.style.setProperty('--archive-progress', `${Math.round((completed / linkItems.length) * 100)}%`);
  }));

  cache.linksFetching = false;
  btn.disabled = false;
  btn.classList.remove('archive-link-progress');
  btn.style.removeProperty('--archive-progress');
  if (loginRequired) {
    cache.linksFetched = false;
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
    await restartVePlatformForLoginExpired('归档资源链接登录已失效，正在重启智慧课程平台…');
    return;
  }

  cache.linksFetched = true;
  cache.html = buildCourseArchiveHtml(cid, cache.items);
  syncArchiveItemsIndex(cid, cache.items);
  if (String(card.dataset.resultView || '').trim() === 'archive') resultArea.innerHTML = cache.html;
  syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
}

async function toggleCourseArchive(btn, courseId, { render = true } = {}) {
  const card = btn?.closest('.file-item');
  const resultArea = card?.querySelector('.result-area');
  const cid = String(courseId || '').trim();
  if (!(btn instanceof HTMLButtonElement) || !card || !resultArea || !cid) return;
  const activeView = String(card.dataset.resultView || '').trim();
  const replayCache = window.videoReplayCacheByCourseId?.[cid];
  const replayShadowArea = card.querySelector(`.replay-shadow-area[data-course-id="${cid}"]`);
  const preservePendingReplayDom = () => {
    if (activeView !== 'replay' || !replayCache?.linksFetching) return;
    if (!(replayShadowArea instanceof HTMLElement) || replayShadowArea.firstChild || !resultArea.firstChild) return;
    const fragment = document.createDocumentFragment();
    while (resultArea.firstChild) fragment.appendChild(resultArea.firstChild);
    replayShadowArea.appendChild(fragment);
  };
  if (render && activeView === 'archive' && isResultAreaOpen(resultArea)) {
    toggleResultAreaAnimated(resultArea, false);
    card.dataset.resultView = '';
    syncCourseActionButtonText(card, '');
    return;
  }

  const cache = window.archiveCacheByCourseId[cid];
  if (cache?.loaded) {
    if (!Array.isArray(cache.items) || !cache.items.length) {
      btn.style.display = 'none';
      return;
    }
    if (!render) return;
    preservePendingReplayDom();
    syncArchiveItemsIndex(cid, cache.items || []);
    resultArea.innerHTML = cache.html;
    card.dataset.resultView = 'archive';
    toggleResultAreaAnimated(resultArea, true);
    syncCourseActionButtonText(card, 'archive');
    startCourseArchiveLinkFetch(btn, cid).catch(() => {});
    return;
  }
  if (cache?.loading) return;

  window.archiveCacheByCourseId[cid] = { loading: true, loaded: false, items: [], html: '' };
  btn.disabled = true;
  btn.classList.add('archive-list-loading');
  btn.innerHTML = `归档下载 <span class="spinner" style="display:inline-block;width:10px;height:10px;margin-left:4px;border-width:2px;border-color:#0369a1;border-top-color:transparent;${spinnerPhaseDelayStyle()}"></span>`;
  try {
    const payload = await fetchCourseArchiveItems(cid);
    if (payload.loginRequired) {
      delete window.archiveCacheByCourseId[cid];
      await restartVePlatformForLoginExpired('归档资源登录已失效，正在重启智慧课程平台…');
      return;
    }
    if (!payload.items.length) {
      window.archiveCacheByCourseId[cid] = { loading: false, loaded: true, items: [], html: '' };
      syncArchiveItemsIndex(cid, []);
      btn.style.display = 'none';
      return;
    }
    const html = buildCourseArchiveHtml(cid, payload.items);
    window.archiveCacheByCourseId[cid] = { loading: false, loaded: true, items: payload.items, html };
    syncArchiveItemsIndex(cid, payload.items);
    if (render) {
      preservePendingReplayDom();
      resultArea.innerHTML = html;
      card.dataset.resultView = 'archive';
      toggleResultAreaAnimated(resultArea, true);
      await startCourseArchiveLinkFetch(btn, cid);
    }
  } catch (error) {
    delete window.archiveCacheByCourseId[cid];
    showToast('归档列表加载失败：' + String(error?.message || error), 'error', 3000);
  } finally {
    btn.disabled = false;
    btn.classList.remove('archive-list-loading');
    btn.classList.remove('archive-link-progress');
    btn.style.removeProperty('--archive-progress');
    syncCourseActionButtonText(card, String(card.dataset.resultView || '').trim());
  }
}

function downloadCourseArchive(courseId) {
  const cid = String(courseId || '').trim();
  if (!cid) return;
  const url = getCourseArchiveDownloadUrl(cid);
  try {
    chrome.downloads.download({
      url,
      saveAs: false
    }, () => {
      const err = chrome.runtime?.lastError?.message || '';
      if (err) showToast('打包下载失败：' + err, 'error', 3000);
    });
  } catch (error) {
    showToast('打包下载失败：' + String(error?.message || error), 'error', 3000);
  }
}

async function prefetchHomeworkAttachments(courseId, list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) {
    window.homeworkAttachmentPendingByCourse[courseId] = false;
    return;
  }

  window.homeworkAttachmentPendingByCourse[courseId] = true;
  try {
    const teacherId = await ensureHomeworkTeacherId(courseId);
    if (!teacherId) return;
    let changed = false;

    await Promise.all(items.map(async (hw) => {
      const noteId = String(hw?.id ?? hw?.noteId ?? hw?.courseNoteId ?? '').trim();
      const noteCourseId = String(hw?.course_id ?? hw?.courseId ?? hw?.cId ?? courseId).trim();
      const noteTeacherId = String(hw?.teacher_id ?? hw?.teacherId ?? teacherId).trim();
      if (!noteId || !noteCourseId || !noteTeacherId) return;

      const key = buildHomeworkAttachmentKey(noteId, noteCourseId, noteTeacherId);
      hw.__attachmentKey = key;

      const cached = window.homeworkNoteAttachmentCacheByKey[key];
      if (cached?.loading || cached?.loaded) return;
      window.homeworkNoteAttachmentCacheByKey[key] = { loading: true, loaded: false, picList: [] };

      const detailUrl = `${BASE_VE}back/coursePlatform/homeWork.shtml?method=queryStudentCourseNote&id=${encodeURIComponent(noteId)}&courseId=${encodeURIComponent(noteCourseId)}&teacherId=${encodeURIComponent(noteTeacherId)}`;
      try {
        const { text } = await fetchText(detailUrl, {
          headers: { Accept: 'application/json, text/javascript, */*; q=0.01' }
        });
        let detailData = null;
        try { detailData = JSON.parse(String(text || '{}')); } catch { detailData = null; }
        const picListRaw = Array.isArray(detailData?.picList) ? detailData.picList : [];
        const picList = picListRaw.map((it) => {
          const fileNameRaw = String(it?.file_name || it?.name || '').trim();
          const fileNameNoExt = stripFileExtension(fileNameRaw) || fileNameRaw || '附件';
          const sizeBytes = Math.max(0, Number(it?.pic_size || 0) || 0);
          const url = normalizeHomeworkAttachmentUrl(it?.url || '');
          return { fileName: fileNameRaw || fileNameNoExt, fileNameNoExt, sizeBytes, url };
        }).filter((it) => !!it.url);
        window.homeworkNoteAttachmentCacheByKey[key] = { loading: false, loaded: true, picList };
        if (picList.length > 0) changed = true;
      } catch {
        window.homeworkNoteAttachmentCacheByKey[key] = { loading: false, loaded: true, picList: [] };
      }
    }));

    if (changed) renderHomeworkList(courseId);
  } finally {
    window.homeworkAttachmentPendingByCourse[courseId] = false;
  }
}

async function checkHomework(courseId) {
  const area = document.getElementById(`homework-area-${courseId}`);
  if (!area) return false;
  const hasMatchedExternal = ((window.yktMatchedHomeworkByCourseId?.[courseId] || []).length > 0)
    || ((window.mrjzyMatchedHomeworkByCourseId?.[courseId] || []).length > 0)
    || ((window.jlgjMatchedHomeworkByCourseId?.[courseId] || []).length > 0);
  if (!hasMatchedExternal && !String(area.innerHTML || '').trim()) {
    area.innerHTML = '<div class="spinner" style="border-color:#2196F3; border-top-color:transparent; display:inline-block;"></div> 正在获取作业…';
  }
  try {
    const subTypes = [0, 1, 2];
    const mergedList = [];
    const seenKeys = new Set();
    const getHwKey = (hw) => {
      const key = String(
        hw?.id ?? hw?.noteId ?? hw?.courseNoteId ??
        hw?.upId ?? hw?.UPID ?? hw?.snId ?? hw?.noteSnId ??
        hw?.workId ?? hw?.homeworkId ?? ''
      ).trim();
      return key;
    };
    const previousHomeworkByKey = new Map(
      (window.courseHomeworkData?.[courseId]?.list || [])
        .map((hw) => [getHwKey(hw), hw])
        .filter(([key]) => !!key)
    );
    for (const subType of subTypes) {
      const payload = { page: 1, pagesize: 10 };
      try {
        const fetchPage = async () => {
          const url = `${BASE_VE}back/coursePlatform/homeWork.shtml?method=getHomeWorkList&cId=${encodeURIComponent(courseId)}&subType=${subType}&page=${payload.page}&pagesize=${payload.pagesize}`;
          const { text, res } = await fetchText(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01' } });
          if (isLikelyLoginPageHtml(text, res?.url) || (res && res.redirected && /\/ve\/(?:Timeout|Login_2)\.jsp/i.test(String(res.url || '')))) {
            const err = new Error('LOGIN_REQUIRED');
            err.loginRequired = true;
            throw err;
          }
          return JSON.parse(text);
        };
        let data = await fetchPage();
        const total = Number(data?.total || 0);
        if (Number.isFinite(total) && total > payload.pagesize) {
          payload.pagesize = total;
          data = await fetchPage();
        }
        if (String(data.STATUS) !== '0') continue;
        const list = data.courseNoteList || data.list || [];
        list.forEach((hw) => {
          const key = getHwKey(hw);
          if (key) {
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
          }
          const previousHomework = key ? previousHomeworkByKey.get(key) : null;
          mergedList.push({
            ...hw,
            subType: hw?.subType ?? subType,
            ...(previousHomework?.__attachmentKey
              ? { __attachmentKey: previousHomework.__attachmentKey }
              : {})
          });
        });
      } catch (error) {
        if (error?.loginRequired || String(error?.message || '') === 'LOGIN_REQUIRED') throw error;
        // continue with other subTypes
      }
    }
    const list = mergedList;
    window.courseHomeworkData[courseId] = { list, showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    renderHomeworkList(courseId);
    // Concurrently fetch attachments; homework score lookup uses returned list fields only.
    const attachmentPrefetchPromise = prefetchHomeworkAttachments(courseId, list);
    attachmentPrefetchPromise.finally(() => {
      recomputeCourseHomeworkState(courseId);
    }).catch(() => {});
    if (typeof backgroundHomeworkRefreshMode !== 'undefined' && backgroundHomeworkRefreshMode) {
      await attachmentPrefetchPromise;
    }
    return true;
  } catch (e) {
    if (e?.loginRequired || String(e?.message || '') === 'LOGIN_REQUIRED') {
      await restartVePlatformForLoginExpired('作业列表登录已失效，正在重启智慧课程平台…');
      return false;
    }
    console.error(`[VE] fetch error for ${courseId}: ${e.message}`);
    window.courseHomeworkData[courseId] = { list: [], showOverdue: !!window.courseShowOverdueById[courseId], showDone: !!window.courseShowDoneById[courseId] };
    renderHomeworkList(courseId);
    return false;
  }
}

function getHomeworkPublishScoreId(hw) {
  return String(hw?.id ?? hw?.noteId ?? hw?.courseNoteId ?? hw?.snId ?? hw?.noteSnId ?? hw?.upId ?? '').trim();
}

function isHomeworkScoreUnpublished(hw) {
  const text = `${String(hw?.lastScore ?? hw?.last_score ?? '')} ${String(hw?.scoreStatus ?? hw?.score_status ?? '')}`;
  return /暂未公布/.test(text);
}

function getUnpublishedDoneScoreHomeworkIds(courseId) {
  if (window.isTeacherAccount) return [];
  const list = window.courseHomeworkData?.[courseId]?.list || [];
  if (!Array.isArray(list) || !list.length) return [];
  const seen = new Set();
  const ids = [];
  list.forEach((hw) => {
    if (!isNativeHomeworkDone(hw)) return;
    if (!isHomeworkScoreUnpublished(hw)) return;
    const id = getHomeworkPublishScoreId(hw);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

function renderForcePublishScoreButton(courseId) {
  const state = window.homeworkScoreForcePublishStateByCourse?.[courseId] || {};
  const ids = Array.isArray(state.ids) && state.ids.length ? state.ids : getUnpublishedDoneScoreHomeworkIds(courseId);
  if (!ids.length) return '';
  const running = !!state.running;
  const progress = Math.max(0, Math.min(100, Number(state.progress || 0) || 0));
  return `<div class="force-score-publish-row" data-course-id="${escapeHtml(String(courseId))}"><button class="btn force-score-publish-btn ${running ? 'force-score-publish-progress' : ''}" data-action="force-publish-scores" data-course-id="${escapeHtml(String(courseId))}" ${running ? 'disabled' : ''} style="--force-score-progress:${progress}%;">强制公布获取成绩，随后立即取消公布</button></div>`;
}

function updateForcePublishScoreButtonState(courseId) {
  const btn = courseListDiv?.querySelector?.(`button[data-action="force-publish-scores"][data-course-id="${CSS.escape(String(courseId || ''))}"]`);
  if (!(btn instanceof HTMLButtonElement)) return;
  const state = window.homeworkScoreForcePublishStateByCourse?.[courseId] || {};
  const running = !!state.running;
  const progress = Math.max(0, Math.min(100, Number(state.progress || 0) || 0));
  btn.disabled = running;
  btn.classList.toggle('force-score-publish-progress', running);
  btn.style.setProperty('--force-score-progress', `${progress}%`);
}

async function setHomeworkScoreDisplayStatus(homeworkId, isOpen, signal = null) {
  const id = String(homeworkId || '').trim();
  if (!id) return;
  const url = `${BASE_VE}back/rp/common/courseTeachTask.shtml?method=updateWorkScoreDisplyStatus&id=${encodeURIComponent(id)}&isOpen=${encodeURIComponent(String(isOpen))}`;
  const { text, res } = await fetchText(url, {
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01' },
    signal
  });
  if (isLikelyLoginPageHtml(text, res?.url)) throw new Error('LOGIN_REQUIRED');
}

async function forcePublishScoresThenRestore(courseId, btn = null) {
  const cid = String(courseId || '').trim();
  if (!cid || window.isTeacherAccount) return;
  const previousIds = window.homeworkScoreForcePublishStateByCourse?.[cid]?.ids || [];
  const ids = getUnpublishedDoneScoreHomeworkIds(cid);
  const targetIds = ids.length ? ids : (Array.isArray(previousIds) ? previousIds : []);
  if (!targetIds.length) {
    showToast('没有暂未公布成绩的已交作业', 'info', 1600);
    return;
  }
  const state = { running: true, progress: 0, ids: targetIds };
  window.homeworkScoreForcePublishStateByCourse[cid] = state;
  updateForcePublishScoreButtonState(cid);
  if (btn instanceof HTMLButtonElement) btn.disabled = true;

  const totalSteps = targetIds.length * 2 + 1;
  let doneSteps = 0;
  const openedIds = [];
  const closedIds = new Set();
  const tick = () => {
    doneSteps += 1;
    state.progress = Math.min(100, (doneSteps / totalSteps) * 100);
    updateForcePublishScoreButtonState(cid);
  };

  try {
    for (const id of targetIds) {
      await setHomeworkScoreDisplayStatus(id, 1, window.globalVeAbortController?.signal || null);
      openedIds.push(id);
      tick();
    }
    const refreshed = await checkHomework(cid);
    if (refreshed === false) return;
    tick();
    for (const id of targetIds) {
      await setHomeworkScoreDisplayStatus(id, 2, window.globalVeAbortController?.signal || null);
      closedIds.add(id);
      tick();
    }
    state.progress = 100;
    showToast('已获取暂未公布作业成绩，并取消公布', 'success', 2200);
  } catch (error) {
    if (String(error?.message || error) === 'LOGIN_REQUIRED') {
      await restartVePlatformForLoginExpired('获取作业成绩时登录已失效，正在重启智慧课程平台…');
    } else {
      showToast('强制公布获取成绩失败：' + String(error?.message || error), 'error', 3200);
    }
  } finally {
    const leftOpenIds = openedIds.filter((id) => !closedIds.has(id));
    if (leftOpenIds.length) {
      await Promise.allSettled(leftOpenIds.map((id) => setHomeworkScoreDisplayStatus(id, 2, window.globalVeAbortController?.signal || null)));
    }
    state.running = false;
    state.progress = 100;
    updateForcePublishScoreButtonState(cid);
  }
}

async function fetchHomeworkScore(upId, snId) {
  if (!upId || !snId) return null;
  const url = `${BASE_VE}back/course/courseWorkInfo.shtml?method=piGaiDiv&upId=${encodeURIComponent(upId)}&id=${encodeURIComponent(snId)}&uLevel=1`;
  const { text, res } = await fetchText(url, {
    headers: {
      Accept: 'text/html, */*; q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE_VE}back/course/courseWorkInfo.shtml`
    }
  });

  // login invalid / redirected html (avoid false positives)
  if (isLikelyLoginPageHtml(text, res?.url) || (res && res.redirected && String(res.url || '').includes('/ve/s.shtml'))) {
    throw new Error('LOGIN_REQUIRED');
  }

  // match oldScore similarly to python implementation
  const m1 = String(text || '').match(/(?:id|name)=["']oldScore["'][^>]*value=["']([^"']*)["']/i);
  if (m1?.[1] !== undefined) return m1[1];
  const m2 = String(text || '').match(/value=["']([^"']*)["'][^>]*(?:id|name)=["']oldScore["']/i);
  if (m2?.[1] !== undefined) return m2[1];
  return null;
}

async function prefetchCourseScores(courseId) {
  if (window.homeworkScorePendingByCourse[courseId]) return;
  const nativeList = window.courseHomeworkData[courseId]?.list || [];
  const tasks = [];
  nativeList.forEach((hw) => {
    const isDone = isNativeHomeworkDone(hw);
    if (!isDone) return;
    const upId = hw.id ?? hw.upId ?? hw.upid ?? hw.UPID ?? hw.up_id ?? '';
    const snId = hw.snId ?? hw.snid ?? hw.SNID ?? hw.noteSnId ?? hw.note_sn_id ?? '';
    if (!upId || !snId) return;

    const scoreStatus = hw.lastScore ?? hw.last_score ?? hw.scoreStatus ?? hw.score_status ?? hw.lastScoreText ?? hw.last_score_text ?? '';
    const obtainedScore = hw.lastScore ?? hw.oldScore ?? hw.old_score ?? hw.finalScore ?? hw.final_score ?? '';
    const pendingText = `${String(scoreStatus || '').trim()} ${String(obtainedScore || '').trim()}`;
    if (!/暂未公布/.test(pendingText)) return;

    const key = buildHomeworkScoreKey(upId, snId);
    if (window.homeworkScoreCacheByKey[key] !== undefined) return;
    tasks.push({ key, upId, snId });
  });

  if (!tasks.length) return;

  window.homeworkScorePendingByCourse[courseId] = true;
  const results = await Promise.allSettled(
    tasks.map(async (t) => {
      const score = await fetchHomeworkScore(t.upId, t.snId);
      return { key: t.key, score };
    })
  );
  window.homeworkScorePendingByCourse[courseId] = false;

  let hasLoginRequired = false;
  results.forEach((result) => {
    if (result.status === 'rejected') {
      const err = result.reason;
      if (String(err && err.message) === 'LOGIN_REQUIRED') {
        hasLoginRequired = true;
      }
      return;
    }
    const { key, score } = result.value;
    if (score === null || score === undefined || score === '') {
      window.homeworkScoreCacheByKey[key] = '未批改';
    } else {
      window.homeworkScoreCacheByKey[key] = String(score);
    }
  });

  if (hasLoginRequired) {
    handleLoginRequired(() => prefetchCourseScores(courseId), null, VE_LOGIN_REQUIRED_HTML);
    return;
  }
  renderHomeworkList(courseId);
}
