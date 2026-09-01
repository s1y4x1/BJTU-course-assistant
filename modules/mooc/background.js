(function initBjtuMoocBackground() {
  'use strict';

  const MOOC_ORIGIN = 'https://www.icourse163.org';
  const MOOC_HEADER_RULE_ID = 914307;
  const MOOC_API = {
    courseList: `${MOOC_ORIGIN}/web/j/learnerCourseRpcBean.getMyLearnedCoursePanelList.rpc`,
    courseDetail: `${MOOC_ORIGIN}/web/j/courseBean.getLastLearnedMocTermDto.rpc`,
    quizPaper: `${MOOC_ORIGIN}/web/j/mocQuizRpcBean.getOpenQuizPaperDto.rpc`,
    homeworkPaper: `${MOOC_ORIGIN}/web/j/mocQuizRpcBean.getOpenHomeworkPaperDto.rpc`,
    submit: `${MOOC_ORIGIN}/web/j/mocQuizRpcBean.submitAnswers.rpc`,
    answer: 'https://ginnnnnn.top/api/mooc/test/'
  };
  let headerRulePromise = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isConcurrencyLimited = (result) => result?.code === 'rate-limit'
    || Number(result?.status) === 429
    || /并发|频繁|稍后|繁忙|busy|limit|too many/i.test(String(result?.message || ''));

  async function ensureMoocHeaderRule() {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return;
    if (!headerRulePromise) {
      headerRulePromise = chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [MOOC_HEADER_RULE_ID],
        addRules: [{
          id: MOOC_HEADER_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: MOOC_ORIGIN },
              { header: 'Referer', operation: 'set', value: `${MOOC_ORIGIN}/` }
            ]
          },
          condition: {
            requestDomains: ['www.icourse163.org'],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['xmlhttprequest']
          }
        }]
      }).catch((error) => {
        headerRulePromise = null;
        throw error;
      });
    }
    await headerRulePromise;
  }

  async function getCookie(name) {
    const cookie = await chrome.cookies.get({ url: `${MOOC_ORIGIN}/`, name }).catch(() => null);
    return String(cookie?.value || '').trim();
  }

  function normalizeGinsAnswer(data) {
    if (Number(data?.status) === 500 && /系统异常/.test(String(data?.msg || ''))) {
      return { ok: false, code: 'gins-system-error', message: 'GinsMooc系统异常' };
    }
    return { ok: true, data };
  }

  async function parseRpcResponse(response) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: 'auth', status: response.status, message: `中国大学MOOC请求被拒绝（HTTP ${response.status}）` };
    }
    if (!response.ok) {
      return {
        ok: false,
        code: response.status === 429 ? 'rate-limit' : 'http',
        status: response.status,
        message: `HTTP ${response.status} ${response.statusText}`
      };
    }
    const responseUrl = String(response.url || '');
    if (/\/passport\/|\/login(?:[/?#]|$)/i.test(responseUrl)) {
      return { ok: false, code: 'auth', message: '中国大学MOOC登录已失效' };
    }
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      if (/登录|passport|doOAuth|login/i.test(text)) {
        return { ok: false, code: 'auth', message: '中国大学MOOC登录已失效' };
      }
      return { ok: false, code: 'invalid-response', message: '中国大学MOOC接口未返回有效 JSON' };
    }
    if (Number(data?.code) === -1002) {
      return { ok: false, message: data?.message || '中国大学MOOC拒绝了当前请求' };
    }
    if (data?.code !== undefined && Number(data.code) !== 0) {
      const message = data?.message || `接口返回错误 ${data.code}`;
      const auth = /未登录|登录失效|请登录|not.?login/i.test(message) || Number(data.code) === -1001;
      return {
        ok: false,
        code: auth ? 'auth' : (/并发|频繁|稍后|繁忙|limit|too many/i.test(message) ? 'rate-limit' : 'api'),
        message
      };
    }
    return { ok: true, data };
  }

  async function moocFetch(url, init = {}) {
    await ensureMoocHeaderRule();
    return fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json, text/plain, */*', ...(init.headers || {}) }
    });
  }

  async function postJson(url, body, csrfKey) {
    let result = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const response = await moocFetch(`${url}?csrfKey=${encodeURIComponent(csrfKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: JSON.stringify(body || {})
        });
        result = await parseRpcResponse(response);
      } catch (error) {
        result = { ok: false, code: 'network', message: String(error?.message || error) };
      }
      if (result?.ok || !isConcurrencyLimited(result)) return result;
      if (attempt < 7) await sleep(Math.min(750 * (2 ** attempt), 8000));
    }
    return result || { ok: false, message: '请求失败' };
  }

  async function fetchCoursePage(payload) {
    let target;
    try {
      target = new URL(String(payload?.url || ''), `${MOOC_ORIGIN}/`);
    } catch {
      throw new Error('无效的中国大学MOOC课程地址');
    }
    if (target.origin !== MOOC_ORIGIN || !target.pathname.startsWith('/learn/')) {
      throw new Error('无效的中国大学MOOC课程地址');
    }
    const response = await moocFetch(target.href, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' }
    });
    if (response.status === 401 || response.status === 403 || /\/passport\/|\/login(?:[/?#]|$)/i.test(String(response.url || ''))) {
      throw Object.assign(new Error('中国大学MOOC登录已失效'), { code: 'auth' });
    }
    if (!response.ok) throw new Error(`课程主页 HTTP ${response.status}`);
    const html = await response.text();
    const match = html.match(/window\.teachers\s*=\s*(\[[\s\S]*?\])\s*;?/);
    if (!match) return [];
    const teachers = [];
    const teacherPattern = /\{[\s\S]*?\bname\s*:\s*(['"])(.*?)\1[\s\S]*?\bhref\s*:\s*(['"])(.*?)\3[\s\S]*?\}/g;
    for (const teacherMatch of match[1].matchAll(teacherPattern)) {
      const name = String(teacherMatch[2] || '').trim();
      if (name) teachers.push({ name, href: String(teacherMatch[4] || '').trim() });
    }
    return teachers;
  }

  async function fetchCourseList(csrfKey) {
    let pageSize = 8;
    for (let pass = 0; pass < 2; pass += 1) {
      const response = await moocFetch(`${MOOC_API.courseList}?csrfKey=${encodeURIComponent(csrfKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ type: '10', p: '1', psize: String(pageSize), courseType: '1' }).toString()
      });
      const result = await parseRpcResponse(response);
      if (!result.ok) return result;
      const total = Number(result.data?.result?.pagination?.totleCount || 0);
      if (pass === 0 && total > pageSize) {
        pageSize = total;
        continue;
      }
      return { ok: true, data: Array.isArray(result.data?.result?.result) ? result.data.result.result : [] };
    }
    return { ok: true, data: [] };
  }

  async function fetchGinsAnswer(tid) {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const response = await fetch(MOOC_API.answer + tid, { cache: 'no-store' });
        lastStatus = response.status;
        if (response.ok) return normalizeGinsAnswer(await response.json());
        if (response.status !== 429) return { ok: false, message: `GinsMooc HTTP ${response.status}` };
      } catch {
        return { ok: false, code: 'network', message: 'GinsMooc 网络请求失败' };
      }
      if (attempt < 7) await sleep(Math.min(750 * (2 ** attempt), 8000));
    }
    return { ok: false, code: 'rate-limit', message: lastStatus ? `GinsMooc HTTP ${lastStatus}` : 'GinsMooc 网络请求失败' };
  }

  async function completeTask(payload, csrfKey) {
    const tid = Number(payload?.tid || 0);
    const type = String(payload?.taskType || 'quiz');
    if (!tid) return { ok: false, message: '无效的作业编号' };
    let paper = null;
    let correctIds = [];
    if (type === 'hw') {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await postJson(MOOC_API.homeworkPaper, { tid, withStdAnswerAndAnalyse: false }, csrfKey);
        if (response.ok && response.data?.result) {
          paper = response.data.result;
          break;
        }
        if (!isConcurrencyLimited(response)) return response;
        if (attempt < 9) await sleep(Math.min(750 * (attempt + 1), 3000));
      }
      if (!paper) return { ok: false, message: '获取作业失败（并发限制）' };
      paper.answers = (paper.subjectiveQList || []).map((question) => ({
        qid: question.id,
        type: question.type,
        content: {
          content: (question.judgeDtos || []).map((item) => item.msg).join('\n'),
          attachments: []
        }
      }));
    } else {
      const answerResponse = await fetchGinsAnswer(String(tid));
      if (!answerResponse.ok && answerResponse.code === 'gins-system-error') return answerResponse;
      const paperResponse = await postJson(MOOC_API.quizPaper, { tid }, csrfKey);
      if (!paperResponse.ok || !paperResponse.data?.result) {
        return paperResponse.ok ? { ok: false, message: '试卷数据为空' } : paperResponse;
      }
      paper = paperResponse.data.result;
      correctIds = (answerResponse.data?.data?.questionList || []).flatMap((question) =>
        (question.optionList || []).filter((option) => option.answer).map((option) => option.id)
      );
      const correctSet = new Set(correctIds);
      paper.answers = (paper.objectiveQList || []).map((question) => ({
        qid: question.id,
        type: question.type,
        optIds: (question.optionDtos || []).filter((option) => correctSet.has(option.id)).map((option) => option.id),
        time: Math.floor(Date.now() / 1000)
      }));
    }
    const submitResponse = await postJson(MOOC_API.submit, { paperDto: paper, preview: false }, csrfKey);
    if (!submitResponse.ok) return submitResponse;
    return { ok: true, data: { response: submitResponse.data, paper, correctIds } };
  }

  async function handleMoocRequest(action, payload) {
    if (action === 'course-page') return fetchCoursePage(payload);
    if (action === 'gins-answer') {
      const tid = String(payload?.tid || '').replace(/[^0-9]/g, '');
      if (!tid) throw new Error('无效的作业编号');
      const result = await fetchGinsAnswer(tid);
      if (!result.ok) throw Object.assign(new Error(result.message || 'GinsMooc请求失败'), { code: result.code || '' });
      return result.data;
    }

    const loggedIn = await getCookie('STUDY_SESS');
    if (!loggedIn) throw Object.assign(new Error('未登录中国大学MOOC'), { code: 'not-logged-in' });
    const csrfKey = await getCookie('NTESSTUDYSI');
    if (!csrfKey) throw Object.assign(new Error('无法读取中国大学MOOC的 NTESSTUDYSI Cookie'), { code: 'missing-csrf' });

    let result;
    if (action === 'course-list') result = await fetchCourseList(csrfKey);
    else if (action === 'course-detail') result = await postJson(MOOC_API.courseDetail, { termId: Number(payload?.tid) }, csrfKey);
    else if (action === 'quiz-paper') result = await postJson(MOOC_API.quizPaper, { tid: Number(payload?.tid) }, csrfKey);
    else if (action === 'homework-paper') result = await postJson(MOOC_API.homeworkPaper, { tid: Number(payload?.tid), withStdAnswerAndAnalyse: false }, csrfKey);
    else if (action === 'submit') result = await postJson(MOOC_API.submit, { paperDto: payload?.paperDto, preview: false }, csrfKey);
    else if (action === 'complete-task') result = await completeTask(payload, csrfKey);
    else result = { ok: false, message: '不支持的中国大学MOOC操作' };

    if (!result?.ok) {
      const code = result?.code === 'auth' ? 'not-logged-in' : String(result?.code || '');
      throw Object.assign(new Error(result?.message || '中国大学MOOC请求失败'), { code });
    }
    return result.data;
  }

  globalThis.BjtuMoocBackground = {
    handleRequest: async (args) => handleMoocRequest(String(args?.action || ''), args?.payload || {}),
    status: async () => ({
      ok: true,
      loggedIn: !!(await getCookie('STUDY_SESS')),
      tabId: null,
      temporaryTab: false
    })
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'MOOC_LOGIN_STATUS') {
      getCookie('STUDY_SESS').then(
        (cookie) => sendResponse({ ok: true, loggedIn: !!cookie, tabId: null, temporaryTab: false }),
        (error) => sendResponse({ ok: false, loggedIn: false, message: String(error?.message || error) })
      );
      return true;
    }
    if (message?.type === 'MOOC_REQUEST') {
      handleMoocRequest(String(message.action || ''), message.payload || {}).then(
        (data) => sendResponse({ ok: true, data }),
        (error) => sendResponse({
          ok: false,
          code: String(error?.code || ''),
          message: String(error?.message || error || '中国大学MOOC请求失败')
        })
      );
      return true;
    }
    return false;
  });
})();
