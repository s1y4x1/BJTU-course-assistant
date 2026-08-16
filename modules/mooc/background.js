(function initBjtuMoocBackground() {
  'use strict';

const MOOC_API = {
  courseList: 'https://www.icourse163.org/web/j/learnerCourseRpcBean.getMyLearnedCoursePanelList.rpc',
  courseDetail: 'https://www.icourse163.org/web/j/courseBean.getLastLearnedMocTermDto.rpc',
  quizPaper: 'https://www.icourse163.org/web/j/mocQuizRpcBean.getOpenQuizPaperDto.rpc',
  homeworkPaper: 'https://www.icourse163.org/web/j/mocQuizRpcBean.getOpenHomeworkPaperDto.rpc',
  submit: 'https://www.icourse163.org/web/j/mocQuizRpcBean.submitAnswers.rpc',
  answer: 'https://ginnnnnn.top/api/mooc/test/'
};

async function resolveMoocRequestTab(tabId, pageUrl = '') {
  const id = Number(tabId || 0);
  if (id) {
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (tab?.id && String(tab.url || '').startsWith('https://www.icourse163.org/')) return tab;
  }
  const normalizedPageUrl = String(pageUrl || '').trim();
  if (normalizedPageUrl.startsWith('https://www.icourse163.org/')) {
    const exactTabs = await chrome.tabs.query({ url: [normalizedPageUrl] }).catch(() => []);
    const exactTab = (exactTabs || []).find((item) => item?.id && String(item.url || '') === normalizedPageUrl);
    if (exactTab?.id) return exactTab;
  }
  const tabs = await chrome.tabs.query({ url: ['https://www.icourse163.org/*'] }).catch(() => []);
  return (tabs || []).find((item) => item?.id && String(item.url || '').startsWith('https://www.icourse163.org/')) || null;
}

async function handleMoocRequest(action, payload, tabId, pageUrl = '') {
  const tab = await resolveMoocRequestTab(tabId, pageUrl);
  if (!tab?.id || !String(tab.url || '').startsWith('https://www.icourse163.org/')) {
    throw Object.assign(new Error('中国大学MOOC请求页面不可用'), { code: 'missing-tab' });
  }
  const csrfCookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'NTESSTUDYSI' }).catch(() => null);
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async (requestAction, requestPayload, api, providedCsrfKey) => {
      const getCookie = (name) => {
        const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : '';
      };
      if (requestAction === 'course-page') {
        try {
          const target = new URL(String(requestPayload?.url || ''), location.origin);
          if (target.origin !== location.origin || !target.pathname.startsWith('/learn/')) {
            return { ok: false, message: '无效的中国大学MOOC课程地址' };
          }
          const response = await fetch(target.href, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: { Accept: 'text/html,application/xhtml+xml' },
            referrer: location.href
          });
          if (!response.ok) return { ok: false, message: `课程主页 HTTP ${response.status}` };
          const html = await response.text();
          const match = html.match(/window\.teachers\s*=\s*(\[[\s\S]*?\])\s*;?/);
          if (!match) return { ok: true, data: [] };
          const teachers = [];
          const teacherPattern = /\{[\s\S]*?\bname\s*:\s*(['"])(.*?)\1[\s\S]*?\bhref\s*:\s*(['"])(.*?)\3[\s\S]*?\}/g;
          for (const teacherMatch of match[1].matchAll(teacherPattern)) {
            teachers.push({ name: teacherMatch[2], href: teacherMatch[4] });
          }
          return {
            ok: true,
            data: teachers.map((teacher) => ({
              name: String(teacher?.name || '').trim(),
              href: String(teacher?.href || '').trim()
            })).filter((teacher) => teacher.name)
          };
        } catch (error) {
          return { ok: false, message: String(error?.message || error || '课程教师解析失败') };
        }
      }
      const csrfKey = String(providedCsrfKey || getCookie('NTESSTUDYSI') || '').trim();
      if (!csrfKey) return { ok: false, code: 'missing-csrf', message: '无法读取中国大学MOOC的 NTESSTUDYSI Cookie' };
      const parseResponse = async (response) => {
        if (response.status === 401 || response.status === 403) return { ok: false, code: 'auth', status: response.status, message: `中国大学MOOC请求被拒绝（HTTP ${response.status}）` };
        if (!response.ok) return { ok: false, code: response.status === 429 ? 'rate-limit' : 'http', status: response.status, message: `HTTP ${response.status} ${response.statusText}` };
        const data = await response.json();
        if (Number(data?.code) === -1002) return { ok: false, message: data?.message || '中国大学MOOC拒绝了当前请求' };
        if (data?.code !== undefined && Number(data.code) !== 0) {
          const message = data?.message || `接口返回错误 ${data.code}`;
          return { ok: false, code: /并发|频繁|稍后|繁忙|limit|too many/i.test(message) ? 'rate-limit' : 'api', message };
        }
        return { ok: true, data };
      };
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isConcurrencyLimited = (result) => result?.code === 'rate-limit'
        || Number(result?.status) === 429
        || /并发|频繁|稍后|繁忙|busy|limit|too many/i.test(String(result?.message || ''));
      const normalizeGinsAnswer = (data) => {
        if (Number(data?.status) === 500 && /系统异常/.test(String(data?.msg || ''))) {
          return { ok: false, code: 'gins-system-error', message: 'GinsMooc系统异常' };
        }
        return { ok: true, data };
      };
      const postJson = async (url, body) => {
        let result = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            result = await fetch(`${url}?csrfKey=${encodeURIComponent(csrfKey)}`, {
              method: 'POST', credentials: 'include', cache: 'no-store',
              headers: { 'Content-Type': 'application/json;charset=UTF-8', Accept: 'application/json, text/plain, */*' },
              referrer: location.href, body: JSON.stringify(body || {})
            }).then(parseResponse);
          } catch (error) {
            result = { ok: false, code: 'network', message: String(error?.message || error) };
          }
          if (result?.ok || !isConcurrencyLimited(result)) return result;
          if (attempt < 7) await sleep(Math.min(750 * (2 ** attempt), 8000));
        }
        return result || { ok: false, message: '请求失败' };
      };

      if (requestAction === 'complete-task') {
        const tid = Number(requestPayload?.tid || 0);
        const type = String(requestPayload?.taskType || 'quiz');
        if (!tid) return { ok: false, message: '无效的作业编号' };
        let paper = null;
        let correctIds = [];
        if (type === 'hw') {
          for (let attempt = 0; attempt < 10; attempt++) {
            const paperResponse = await postJson(api.homeworkPaper, { tid, withStdAnswerAndAnalyse: false });
            if (paperResponse.ok && paperResponse.data?.result) {
              paper = paperResponse.data.result;
              break;
            }
            if (!isConcurrencyLimited(paperResponse)) break;
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
          let answerData = { data: { questionList: [] } };
          try {
            const answerResponse = await fetch(api.answer + tid, { cache: 'no-store' });
            if (answerResponse.ok) {
              const normalized = normalizeGinsAnswer(await answerResponse.json());
              if (!normalized.ok) return normalized;
              answerData = normalized.data;
            }
          } catch { /* submit with unmatched answers */ }
          const paperResponse = await postJson(api.quizPaper, { tid });
          if (!paperResponse.ok || !paperResponse.data?.result) return paperResponse.ok ? { ok: false, message: '试卷数据为空' } : paperResponse;
          paper = paperResponse.data.result;
          correctIds = (answerData.data?.questionList || []).flatMap((question) =>
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
        const submitResponse = await postJson(api.submit, { paperDto: paper, preview: false });
        if (!submitResponse.ok) return submitResponse;
        return { ok: true, data: { response: submitResponse.data, paper, correctIds } };
      }

      if (requestAction === 'course-list') {
        let pageSize = 8;
        for (let pass = 0; pass < 2; pass++) {
          const result = await fetch(`${api.courseList}?csrfKey=${encodeURIComponent(csrfKey)}`, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              Accept: 'application/json, text/plain, */*'
            },
            referrer: location.href,
            body: new URLSearchParams({ type: '10', p: '1', psize: String(pageSize), courseType: '1' }).toString()
          }).then(parseResponse);
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
      if (requestAction === 'course-detail') return postJson(api.courseDetail, { termId: Number(requestPayload?.tid) });
      if (requestAction === 'quiz-paper') return postJson(api.quizPaper, { tid: Number(requestPayload?.tid) });
      if (requestAction === 'homework-paper') return postJson(api.homeworkPaper, { tid: Number(requestPayload?.tid), withStdAnswerAndAnalyse: false });
      if (requestAction === 'submit') return postJson(api.submit, { paperDto: requestPayload?.paperDto, preview: false });
      if (requestAction === 'gins-answer') {
        const tid = String(requestPayload?.tid || '').replace(/[^0-9]/g, '');
        if (!tid) return { ok: false, message: '无效的作业编号' };
        let lastStatus = 0;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            const response = await fetch(api.answer + tid, { cache: 'no-store' });
            lastStatus = response.status;
            if (response.ok) {
              return normalizeGinsAnswer(await response.json());
            }
            if (response.status !== 429) return { ok: false, message: `GinsMooc HTTP ${response.status}` };
          } catch {
            lastStatus = 0;
            return { ok: false, message: 'GinsMooc 网络请求失败' };
          }
          if (attempt < 7) await sleep(Math.min(750 * (2 ** attempt), 8000));
        }
        return { ok: false, code: 'rate-limit', message: lastStatus ? `GinsMooc HTTP ${lastStatus}` : 'GinsMooc 网络请求失败' };
      }
      return { ok: false, message: '不支持的中国大学MOOC操作' };
    },
    args: [String(action || ''), payload || {}, MOOC_API, String(csrfCookie?.value || '')]
  });
  const result = results?.[0]?.result;
  if (!result?.ok) {
    throw Object.assign(new Error(result?.message || '中国大学MOOC请求失败'), { code: result?.code || '' });
  }
  return result.data;
}

  globalThis.BjtuMoocBackground = {
    handleRequest: async (args) => handleMoocRequest(
      String(args?.action || ''),
      args?.payload || {},
      Number(args?.tabId || 0),
      String(args?.pageUrl || '')
    ),
    loginStatus: async () => {
      const cookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'STUDY_SESS' }).catch(() => null);
      return { ok: true, loggedIn: !!String(cookie?.value || '').trim(), tabId: null, temporaryTab: false };
    }
  };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'MOOC_LOGIN_STATUS') {
    (async () => {
      const tabId = Number(message?.tabId || sender?.tab?.id || 0);
      if (tabId) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab?.id || !String(tab.url || '').startsWith('https://www.icourse163.org/')) {
          sendResponse({ ok: false, loggedIn: false, message: '中国大学MOOC页面不可用' });
          return;
        }
      }
      const cookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'STUDY_SESS' });
      sendResponse({ ok: true, loggedIn: !!String(cookie?.value || '').trim(), tabId: tabId || null, temporaryTab: false });
    })().catch((error) => {
      sendResponse({ ok: false, loggedIn: false, message: String(error?.message || error) });
    });
    return true;
  }

  if (message?.type === 'MOOC_REQUEST') {
    handleMoocRequest(String(message.action || ''), message.payload || {}, message.tabId || sender?.tab?.id, message.pageUrl || sender?.tab?.url || '')
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({
        ok: false,
        code: String(error?.code || ''),
        message: String(error?.message || error || '中国大学MOOC请求失败')
      }));
    return true;
  }

});

})();
