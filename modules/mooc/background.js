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

let moocOriginTabPromise = null;
let moocActiveRequestTabId = null;
const moocHelperTabIds = new Set();
const moocHelperCloseTimers = new Map();
const moocHelperLeases = new Set();
let moocOperationGeneration = 0;

function scheduleMoocHelperTabClose(tabId, delayMs = 120000) {
  if (!moocHelperTabIds.has(tabId)) return;
  if (moocHelperLeases.size > 0) return;
  const oldTimer = moocHelperCloseTimers.get(tabId);
  if (oldTimer) clearTimeout(oldTimer);
  const timer = setTimeout(() => {
    moocHelperCloseTimers.delete(tabId);
    moocHelperTabIds.delete(tabId);
    if (Number(moocActiveRequestTabId) === Number(tabId)) moocActiveRequestTabId = null;
    chrome.tabs.remove(tabId).catch(() => {});
  }, delayMs);
  moocHelperCloseTimers.set(tabId, timer);
}

function closeMoocHelperTab(tabId) {
  if (!moocHelperTabIds.has(tabId)) return;
  const timer = moocHelperCloseTimers.get(tabId);
  if (timer) clearTimeout(timer);
  moocHelperCloseTimers.delete(tabId);
  moocHelperTabIds.delete(tabId);
  if (Number(moocActiveRequestTabId) === Number(tabId)) moocActiveRequestTabId = null;
  chrome.tabs.remove(tabId).catch(() => {});
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === 'complete') return current;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      reject(Object.assign(new Error('中国大学MOOC页面加载超时'), { code: 'tab-timeout' }));
    }, timeoutMs);
    const onUpdated = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(tab);
    };
    const onRemoved = (removedId) => {
      if (removedId !== tabId) return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      reject(Object.assign(new Error('中国大学MOOC后台页面已关闭'), { code: 'tab-closed' }));
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

async function ensureMoocOriginTabOnce() {
  if (moocActiveRequestTabId) {
    const activeTab = await chrome.tabs.get(Number(moocActiveRequestTabId)).catch(() => null);
    if (activeTab?.id && String(activeTab.url || '').startsWith('https://www.icourse163.org/')) {
      return activeTab.status === 'complete' ? activeTab : waitForTabComplete(activeTab.id);
    }
    moocActiveRequestTabId = null;
  }
  const existingTabs = await chrome.tabs.query({ url: ['https://www.icourse163.org/*'] }).catch(() => []);
  const reusableTab = (existingTabs || []).find((tab) => tab?.id && tab.status === 'complete');
  if (reusableTab?.id) {
    moocActiveRequestTabId = reusableTab.id;
    return reusableTab;
  }
  if (!moocOriginTabPromise) {
    moocOriginTabPromise = chrome.tabs.create({
      url: 'https://www.icourse163.org/',
      active: false
    }).then((tab) => {
      if (!tab?.id) throw new Error('无法创建中国大学MOOC请求页面');
      moocHelperTabIds.add(tab.id);
      moocActiveRequestTabId = tab.id;
      return waitForTabComplete(tab.id);
    }).finally(() => {
      moocOriginTabPromise = null;
    });
  }
  return moocOriginTabPromise;
}

async function ensureMoocOriginTab() {
  const generation = moocOperationGeneration;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (generation !== moocOperationGeneration) {
      throw Object.assign(new Error('中国大学MOOC加载已取消'), { code: 'cancelled' });
    }
    try {
      const tab = await ensureMoocOriginTabOnce();
      if (generation !== moocOperationGeneration) {
        closeMoocHelperTab(tab.id);
        throw Object.assign(new Error('中国大学MOOC加载已取消'), { code: 'cancelled' });
      }
      return tab;
    } catch (error) {
      lastError = error;
      moocActiveRequestTabId = null;
      moocOriginTabPromise = null;
      if (!['tab-closed', 'tab-timeout'].includes(String(error?.code || ''))) throw error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError || new Error('无法打开中国大学MOOC后台页面');
}

async function acquireMoocHelperLease() {
  const tab = await ensureMoocOriginTab();
  const leaseId = crypto.randomUUID();
  moocHelperLeases.add(leaseId);
  const timer = moocHelperCloseTimers.get(tab.id);
  if (timer) clearTimeout(timer);
  moocHelperCloseTimers.delete(tab.id);
  return { leaseId, tabId: tab.id };
}

function releaseMoocHelperLease(leaseId) {
  const id = String(leaseId || '').trim();
  if (id) moocHelperLeases.delete(id);
  if (moocHelperLeases.size > 0) return;
  if (moocActiveRequestTabId && moocHelperTabIds.has(Number(moocActiveRequestTabId))) {
    closeMoocHelperTab(Number(moocActiveRequestTabId));
  }
}

async function handleMoocRequest(action, payload) {
  const tab = await ensureMoocOriginTab();
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
      const isRetryable = (result) => result?.code === 'rate-limit'
        || Number(result?.status) >= 500
        || /并发|频繁|稍后|繁忙|busy|limit|too many/i.test(String(result?.message || ''));
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
          if (result?.ok || (!isRetryable(result) && result?.code !== 'network')) return result;
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
            if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 1000));
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
            if (answerResponse.ok) answerData = await answerResponse.json();
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
            if (response.ok) return { ok: true, data: await response.json() };
            if (response.status !== 429 && response.status < 500) return { ok: false, message: `GinsMooc HTTP ${response.status}` };
          } catch {
            lastStatus = 0;
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
    if (result?.code === 'not-logged-in') closeMoocHelperTab(tab.id);
    throw Object.assign(new Error(result?.message || '中国大学MOOC请求失败'), { code: result?.code || '' });
  }
  scheduleMoocHelperTabClose(tab.id);
  return result.data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'MOOC_ACQUIRE_HELPER_TAB') {
    acquireMoocHelperLease()
      .then((lease) => sendResponse({ ok: true, ...lease }))
      .catch((error) => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'MOOC_RELEASE_HELPER_TAB') {
    releaseMoocHelperLease(message?.leaseId);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'MOOC_RELEASE_HELPER_TABS') {
    moocOperationGeneration += 1;
    moocHelperLeases.clear();
    [...moocHelperTabIds].forEach((tabId) => closeMoocHelperTab(tabId));
    moocActiveRequestTabId = null;
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'MOOC_CANCEL_PENDING') {
    moocOperationGeneration += 1;
    moocHelperLeases.clear();
    [...moocHelperTabIds].forEach((tabId) => closeMoocHelperTab(tabId));
    moocActiveRequestTabId = null;
    moocOriginTabPromise = null;
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'MOOC_LOGIN_STATUS') {
    (async () => {
      const preferredTabId = Number(message?.tabId || 0);
      let tab = null;
      if (preferredTabId) {
        const preferred = await chrome.tabs.get(preferredTabId).catch(() => null);
        if (preferred?.id && String(preferred.url || '').startsWith('https://www.icourse163.org/')) {
          tab = preferred.status === 'complete' ? preferred : await waitForTabComplete(preferred.id);
          moocActiveRequestTabId = preferred.id;
        }
      }
      if (!tab) tab = await ensureMoocOriginTab();
      const cookie = await chrome.cookies.get({ url: 'https://www.icourse163.org/', name: 'STUDY_SESS' });
      const loggedIn = !!String(cookie?.value || '').trim();
      if (!loggedIn) closeMoocHelperTab(tab.id);
      else scheduleMoocHelperTabClose(tab.id);
      sendResponse({
        ok: true,
        loggedIn,
        tabId: Number(tab?.id || 0) || null,
        temporaryTab: moocHelperTabIds.has(tab.id)
      });
    })().catch((error) => {
      sendResponse({ ok: false, loggedIn: false, message: String(error?.message || error) });
    });
    return true;
  }

  if (message?.type === 'MOOC_REQUEST') {
    handleMoocRequest(String(message.action || ''), message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({
        ok: false,
        code: String(error?.code || ''),
        message: String(error?.message || error || '中国大学MOOC请求失败')
      }));
    return true;
  }

});

chrome.tabs.onRemoved.addListener((tabId) => {
  const timer = moocHelperCloseTimers.get(tabId);
  if (timer) clearTimeout(timer);
  moocHelperCloseTimers.delete(tabId);
  moocHelperTabIds.delete(tabId);
  if (Number(moocActiveRequestTabId) === Number(tabId)) moocActiveRequestTabId = null;
});
})();
