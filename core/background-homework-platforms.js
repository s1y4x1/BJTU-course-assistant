(function (global) {
  'use strict';

  function deadline(value) {
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(value);
    return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : (Date.parse(String(value).replace(/-/g, '/')) || 0);
  }

  function item(platform, courseName, title, end, done, detail, actionUrl) {
    const time = deadline(end);
    if (done || (time && time <= Date.now())) return null;
    courseName = String(courseName || '').replace(/\s+/g, ' ').trim();
    title = String(title || '').replace(/\s+/g, ' ').trim();
    return { key: `${courseName}|${title}|${time}`, platform: global.BjtuHomeworkReminders.labels[platform],
      courseName, title, deadline: time, detail: global.BjtuHomeworkReminders.plainText(detail), actionUrl };
  }

  async function ykt(settings) {
    await ensureYktDirectRequestHeaders();
    const response = await fetchYktJson(YKT_COURSE_LIST_API);
    if (Number(response.errcode) !== 0 || !Array.isArray(response.data?.list)) throw new Error(response.errmsg || '雨课堂登录已失效');
    const types = settings.yktActivityTypes || [14, 15, 5, 9];
    const groups = await Promise.all(response.data.list.map(async (course) => {
      const cid = String(course.classroom_id);
      const activities = (await Promise.all(types.map(async (type) => {
        const result = await fetchYktJson(`${YKT_BASE}/v2/api/web/logs/learn/${encodeURIComponent(cid)}?actype=${type}&page=0&offset=100`);
        if (Number(result.errcode) !== 0 || !Array.isArray(result.data?.activities)) throw new Error(result.errmsg || '雨课堂作业加载失败');
        return result.data.activities.map((a) => ({ ...a, __actype: Number(type) }));
      }))).flat();
      const videos = activities.filter((a) => a.__actype === 15);
      const progress = videos.length ? await fetchYktCoursewareProgress(cid, videos.map((a) => a.courseware_id), pickYktUniversityId(course, response.data)) : {};
      const classroomReports = await Promise.all(activities.filter((a) => a.__actype === 14 && a.courseware_id).map(async (a) => {
        const report = await fetchYktClassroomReport(a.courseware_id);
        return { monitorOnly: true, classroomReportKey: `${cid}|${a.courseware_id}`, classroomReportSignature: report.signature,
          platform: '雨课堂', courseName: course.course?.name || course.name || '', title: a.title || '课堂',
          actionUrl: yktClassroomReportLink(cid, a.courseware_id, a.id) };
      }));
      return activities.map((a) => {
        const leaf = a.content?.leaf_id ?? a.leaf_id;
        const video = a.__actype === 15 ? normalizeYktVideoProgress(progress[String(a.courseware_id)], leaf) : null;
        if (a.__actype === 15 && !video) throw new Error('雨课堂未返回线上学习完成进度');
        const hw = { ...a, done: a.view?.done, video_progress_ratio: video?.ratio, video_total_done: video?.totalDone };
        const url = a.__actype === 5 ? yktExamLink(a.course_id || cid, a.courseware_id)
          : a.__actype === 14 ? yktClassroomReportLink(cid, a.courseware_id, a.id)
          : a.__actype === 15 && leaf ? yktVideoStudentLink(cid, leaf) : yktHomeworkLink(cid, a.courseware_id, a.id);
        return item('ykt', course.course?.name || course.name || '', a.title || '雨课堂作业',
          getYktActivityDeadline(a), isYktHomeworkDone(hw) || (a.__actype === 14 && a.is_finished),
          typeof a.content === 'string' ? a.content : a.content?.content || a.content?.description || '', url);
      }).filter(Boolean).concat(classroomReports);
    }));
    return groups.flat();
  }

  async function mrjzy() {
    const today = new Date(); today.setHours(23, 59, 59, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const endTime = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())} 23:59:59`;
    const response = await postMrjzyForm(MRJZY_WORK_LIST_API, { start: 0, num: 12, beginTime: '1990-01-01 00:00:00', endTime, limit: 1 });
    if (Number(response.data?.code) !== 200 || !Array.isArray(response.data.data)) throw new Error(response.data?.desc || '每日交作业登录已失效');
    const works = response.data.data;
    const detailsByWorkId = new Map();
    const assignments = (await Promise.all(works.map(async (work) => {
      const result = await postMrjzyForm(MRJZY_WORK_DETAIL_API, { workId: work.workId });
      if (Number(result.data?.code) !== 200) throw new Error(result.data?.desc || '每日交作业详情获取失败');
      detailsByWorkId.set(work.workId, result.data.data ?? null);
      return item('mrjzy', work.divClass || work.className || '', work.workDetail || work.title || '作业',
        work.workRemark || work.endTime || work.end || work.deadline, Number(work.submit || 0) > 0,
        result.data.data?.work?.workDetail || result.data.data?.workDetail || '',
        `${MRJZY_WEB_BASE}/#/studentsSubmitWork?id=${encodeURIComponent(work.workId)}`);
    }))).filter(Boolean);
    const groups = buildMrjzyCourseGroups(works, detailsByWorkId);
    await global.BjtuHomeworkReminders.update(async () => {
      const key = 'popupFullscreenCourseCache';
      const stored = await chrome.storage.local.get(key);
      const cache = stored[key] || {};
      await chrome.storage.local.set({ [key]: {
        ...cache,
        savedAt: Date.now(),
        mrjzySnapshotUpdatedAt: Date.now(),
        mrjzyCourseGroupsSnapshot: groups,
        mrjzyStandaloneCourses: groups,
        mrjzyMatchedHomeworkByCourseId: {},
        platformLoginState: { ...cache.platformLoginState, mrjzy: 'online' },
        platformLoginChecked: { ...cache.platformLoginChecked, mrjzy: true },
        platformLoadedOnce: { ...cache.platformLoadedOnce, mrjzy: true },
        platformNeedLogin: { ...cache.platformNeedLogin, mrjzy: false }
      } });
    });
    return assignments;
  }

  async function jlgj() {
    const response = await fetchJlgjJson(JLGJ_GROUP_LIST_API);
    if (!response.ok || response.unauthorized) throw new Error(response.message || '接龙管家登录已失效');
    const groups = extractJlgjData(response.data);
    const list = Array.isArray(groups) ? groups : groups?.Data;
    if (!Array.isArray(list)) throw new Error('接龙管家班级列表无效');
    return (await Promise.all(list.map(async (group) => {
      const threads = await fetchJlgjJson(`${JLGJ_API_BASE}/api/Thread/GroupThreads?pageIndex=1&pageSize=20&groupId=${encodeURIComponent(group.Id)}&groupListType=0`);
      if (!threads.ok || threads.unauthorized) throw new Error(threads.message || '接龙管家作业列表获取失败');
      const data = extractJlgjData(threads.data);
      const works = Array.isArray(data) ? data : data?.Data;
      if (!Array.isArray(works)) throw new Error('接龙管家作业列表无效');
      return (await Promise.all(works.map(async (work) => {
        const id = String(work.ThreadStrId || '');
        const result = await fetchJlgjJson(`${JLGJ_API_BASE}/api/Homework/HomeworkDetail?threadId=${encodeURIComponent(id)}`);
        if (!result.ok || result.unauthorized) throw new Error(result.message || '接龙管家作业详情获取失败');
        const detail = result.data?.Data?.Data || result.data?.Data;
        if (!detail) throw new Error('接龙管家未返回作业详情');
        const content = (detail.Thread?.ThreadBody || []).map((part) => part.Text?.Content || '').join('\n');
        return item('jlgj', group.Name || '', work.Subject || work.GroupName || '接龙作业', detail.Homework?.EndTime,
          [true, 1, '1', 'true'].includes(work.IsAttend), content, `https://i.jielong.com/h/${id}`);
      }))).filter(Boolean);
    }))).flat();
  }

  async function mooc(settings) {
    const request = (action, payload = {}) => global.BjtuMoocBackground.handleRequest({ action, payload });
    const courses = await request('course-list');
    const types = new Set(settings.moocActivityTypes || ['hw', 'quiz', 'exam']);
    return (await Promise.all(courses.map(async (course) => {
      const result = await request('course-detail', { tid: Number(course.termPanel?.id) });
      const term = result.result?.mocTermDto || result.mocTermDto;
      if (!term) throw new Error('中国大学MOOC未返回课程详情');
      const url = `https://www.icourse163.org/learn/${encodeURIComponent(course.schoolPanel?.shortName || 'COURSE')}-${course.id}?tid=${term.id}`;
      const works = (term.chapters || []).flatMap((chapter) => [
        ...(chapter.homeworks || []).map((entry) => ({ test: entry.test, type: 'hw' })),
        ...(chapter.quizs || []).map((entry) => ({ test: entry.test, type: 'quiz' })),
        ...(chapter.exam?.objectTestVo ? [{ test: chapter.exam.objectTestVo, type: 'exam' }] : []),
        ...(chapter.lessons || []).flatMap((lesson) => (lesson.units || []).map((unit) => ({ test: unit, type: { 1:'video', 3:'document', 6:'discussion' }[unit.contentType] })))
      ]).filter(({ test, type }) => test?.id && types.has(type));
      return (await Promise.all(works.map(async ({ test, type }) => {
        const done = test.userScore !== null && test.userScore !== undefined && String(test.userScore) !== '';
        let detail = '';
        if (!done && type === 'quiz') detail = (await request('quiz-info', { tid: test.id })).result?.description || '';
        if (!done && type === 'hw') detail = (await request('homework-paper', { tid: test.id })).result?.tname || '';
        const hash = type === 'hw' ? 'hw' : type === 'exam' ? 'examObject' : 'quiz';
        const actionUrl = ['hw', 'quiz', 'exam'].includes(type) ? `${url}#/learn/${hash}?id=${test.id}`
          : `${url}#/learn/content?${new URLSearchParams({ type: String(test.contentType), id: String(test.id), ...(test.contentId == null ? {} : { cid: String(test.contentId) }) })}`;
        return item('mooc', course.name || term.courseName || '', test.name || '作业', test.deadline, done, detail, actionUrl);
      }))).filter(Boolean);
    }))).flat();
  }

  async function xuetangx() {
    const courses = await global.BjtuXuetangxPlatform.fetchBackgroundCourses();
    return courses.flatMap((course) => course.tasks.map((task) => {
      if (task.exerciseDetailError) throw new Error(task.exerciseDetailError);
      return item('xuetangx', course.name, task.title, task.deadline, task.done,
        task.description || task.content || '',
        `https://www.xuetangx.com/learn/space/${encodeURIComponent(course.courseSign)}/${encodeURIComponent(course.sign)}/${encodeURIComponent(course.classroomId)}/${encodeURIComponent(task.path)}/${encodeURIComponent(task.id)}`);
    })).filter(Boolean);
  }

  global.BjtuBackgroundHomeworkPlatforms = { ykt, mrjzy, jlgj, mooc, xuetangx };
})(globalThis);
