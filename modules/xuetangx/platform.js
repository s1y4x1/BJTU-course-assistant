(function initBjtuXuetangxPlatform(global) {
  'use strict';

  const BASE = 'https://www.xuetangx.com';
  const REQUEST_PAGE_URL = `${BASE}/`;
  const COURSE_LIST_URL = `${BASE}/api/v1/lms/user/user-courses`;
  const COURSE_STATUS_LABELS = Object.freeze({
    1: '正在上课',
    2: '即将开课',
    3: '已结课',
    4: '已退课'
  });
  const ACTIVITY_TYPES = Object.freeze({
    6: { label: '视频', path: 'video', action: 'learn' },
    7: { label: '图文', path: 'article', action: 'view' },
    8: { label: '直播', path: 'liveunit', action: 'view' },
    10: { label: '讨论', path: 'discussion', action: 'view' },
    11: { label: '作业', path: 'exercise', action: 'submit' },
    12: { label: '考试', path: 'exam', action: 'exam' }
  });
  const DEFAULT_VISIBLE_STATUSES = Object.freeze([1]);
  const DEFAULT_VISIBLE_ACTIVITY_TYPES = Object.freeze(Object.keys(ACTIVITY_TYPES).map(Number));
  const CHAPTER_LEAF_TYPE_TO_ACTIVITY_TYPE = Object.freeze({
    0: 6,
    2: 8,
    3: 7,
    4: 10,
    6: 11
  });
  const THEME_COLOR = '#1769fe';
  const helperTabIds = new Set();
  const expandedGroups = new Map();
  let env = null;
  let courses = [];
  let activeRequestTabId = null;
  let originTabPromise = null;
  let loadSerial = 0;
  let qrLoginCancelled = false;
  let qrLoginTabId = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const escape = (value) => env?.escape?.(String(value ?? '')) ?? String(value ?? '');

  function formatTime(value) {
    const timestamp = Number(value || 0);
    const date = new Date(timestamp);
    if (!timestamp || Number.isNaN(date.getTime())) return '无期限';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatProgress(value) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const percent = ratio * 100;
    if (percent >= 99.95) return '100%';
    if (percent >= 10) return `${percent.toFixed(1).replace(/\.0$/, '')}%`;
    return `${percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
  }

  function normalizeSchedule(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
  }

  function normalizeVisibleStatuses(value) {
    const source = Array.isArray(value) ? value : DEFAULT_VISIBLE_STATUSES;
    const statuses = [...new Set(source.map(Number).filter((item) => COURSE_STATUS_LABELS[item]))];
    return statuses.length ? statuses : [...DEFAULT_VISIBLE_STATUSES];
  }

  async function getVisibleStatuses() {
    const stored = await chrome.storage.local.get(['xuetangxCourseStatuses']).catch(() => ({}));
    return normalizeVisibleStatuses(stored.xuetangxCourseStatuses);
  }

  async function getVisibleActivityTypes() {
    const stored = await chrome.storage.local.get(['xuetangxActivityTypes']).catch(() => ({}));
    const source = Array.isArray(stored.xuetangxActivityTypes)
      ? stored.xuetangxActivityTypes
      : DEFAULT_VISIBLE_ACTIVITY_TYPES;
    return new Set(source.map(Number).filter((item) => ACTIVITY_TYPES[item]));
  }

  async function waitForTabComplete(tabId, timeoutMs = 20000) {
    const existing = await chrome.tabs.get(tabId).catch(() => null);
    if (existing?.status === 'complete') return existing;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Object.assign(new Error('学堂在线页面加载超时'), { code: 'tab-timeout' }));
      }, timeoutMs);
      const onUpdated = (updatedId, changeInfo, tab) => {
        if (updatedId !== tabId || changeInfo.status !== 'complete') return;
        cleanup();
        resolve(tab);
      };
      const onRemoved = (removedId) => {
        if (removedId !== tabId) return;
        cleanup();
        reject(Object.assign(new Error('学堂在线后台页面已关闭'), { code: 'tab-closed' }));
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  }

  async function ensureOriginTabOnce(serial) {
    if (serial !== loadSerial) throw Object.assign(new Error('学堂在线加载已取消'), { code: 'cancelled' });
    if (activeRequestTabId) {
      const tab = await chrome.tabs.get(Number(activeRequestTabId)).catch(() => null);
      if (tab?.id && String(tab.url || '').startsWith(`${BASE}/`)) {
        return tab.status === 'complete' ? tab : waitForTabComplete(tab.id);
      }
      activeRequestTabId = null;
    }
    const reusableTabs = await chrome.tabs.query({ url: [`${BASE}/*`] }).catch(() => []);
    const reusable = reusableTabs.find((tab) => tab?.id && tab.status === 'complete');
    if (reusable?.id) {
      activeRequestTabId = reusable.id;
      return reusable;
    }
    if (!originTabPromise) {
      originTabPromise = chrome.tabs.create({ url: REQUEST_PAGE_URL, active: false }).then(async (tab) => {
        if (!tab?.id) throw new Error('无法创建学堂在线请求页面');
        void groupBjtuOpenedTab(tab.id);
        helperTabIds.add(tab.id);
        activeRequestTabId = tab.id;
        return waitForTabComplete(tab.id);
      }).finally(() => {
        originTabPromise = null;
      });
    }
    return originTabPromise;
  }

  async function ensureOriginTab(serial) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (serial !== loadSerial) throw Object.assign(new Error('学堂在线加载已取消'), { code: 'cancelled' });
      try {
        return await ensureOriginTabOnce(serial);
      } catch (error) {
        lastError = error;
        activeRequestTabId = null;
        originTabPromise = null;
        if (!['tab-closed', 'tab-timeout'].includes(String(error?.code || '')) || attempt >= 2) throw error;
        await sleep(350 * (attempt + 1));
      }
    }
    throw lastError || new Error('无法打开学堂在线请求页面');
  }

  async function requestJson(url, serial, tabRetry = 0) {
    const tab = await ensureOriginTab(serial);
    let execution;
    try {
      execution = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [{ url: String(url) }],
        func: async ({ url: requestUrl }) => {
          const cookieMap = Object.fromEntries(document.cookie.split(';').map((part) => {
            const index = part.indexOf('=');
            if (index < 0) return [part.trim(), ''];
            return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
          }));
          const csrf = cookieMap.csrftoken || cookieMap.CSRF_TOKEN || cookieMap.x_csrftoken || '';
          const headers = {
            accept: 'application/json, text/plain, */*',
            'x-client': 'web',
            xtbz: 'xt'
          };
          if (csrf) headers['x-csrftoken'] = csrf;
          let lastResult = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const response = await fetch(requestUrl, {
                method: 'GET',
                headers,
                credentials: 'include',
                cache: 'no-store'
              });
              const text = await response.text();
              let data = null;
              try { data = JSON.parse(text); } catch {}
              lastResult = {
                ok: response.ok,
                status: response.status,
                responseUrl: response.url,
                data,
                text: data ? '' : text.slice(0, 500)
              };
              if (response.status !== 429 && response.status < 500) return lastResult;
            } catch (error) {
              lastResult = { ok: false, status: 0, error: String(error?.message || error) };
            }
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          }
          return lastResult;
        }
      });
    } catch (error) {
      if (!await chrome.tabs.get(tab.id).catch(() => null)) {
        activeRequestTabId = null;
        if (tabRetry < 2 && serial === loadSerial) {
          await sleep(350 * (tabRetry + 1));
          return requestJson(url, serial, tabRetry + 1);
        }
        throw Object.assign(new Error('学堂在线后台页面已关闭'), { code: 'tab-closed' });
      }
      throw error;
    }
    const result = execution?.[0]?.result;
    const hasStructuredApiError = !!result?.data && result.data.success === false;
    if ((!result?.ok && !hasStructuredApiError) || !result?.data) {
      const loginLike = [401, 403].includes(Number(result?.status))
        || /login|登录|<!doctype|<html/i.test(String(result?.text || result?.responseUrl || ''));
      const error = new Error(loginLike
        ? '未登录学堂在线'
        : `学堂在线请求失败${result?.status ? `（HTTP ${result.status}）` : ''}：${result?.error || result?.text || '响应不是 JSON'}`);
      error.code = loginLike ? 'not-logged-in' : 'request-failed';
      throw error;
    }
    return result.data;
  }

  function closeCreatedHelperTabs() {
    for (const tabId of [...helperTabIds]) {
      helperTabIds.delete(tabId);
      if (Number(activeRequestTabId) === Number(tabId)) activeRequestTabId = null;
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  function cancelQrLogin() {
    qrLoginCancelled = true;
    loadSerial += 1;
    hideQrLoginModal();
    void stopQrLoginSocket();
    closeCreatedHelperTabs();
    env?.setState?.('offline');
  }

  function getQrLoginModal() {
    let modal = document.getElementById('xuetangx-login-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'xuetangx-login-modal';
    modal.className = 'version-modal-mask platform-qr-login-mask xuetangx-login-mask';
    modal.innerHTML = `<div class="version-modal-card platform-qr-login-card xuetangx-login-card">
      <div class="version-modal-header">
        <div class="platform-qr-login-title xuetangx-login-title">登录学堂在线</div>
        <button type="button" class="btn version-close-btn" data-xuetangx-login-close title="关闭" aria-label="关闭">×</button>
      </div>
      <div class="platform-qr-login-body xuetangx-login-body">
        <div class="platform-qr-login-status xuetangx-login-status"><span class="spinner xuetangx-inline-spinner"></span> 正在获取登录二维码…</div>
        <img class="platform-qr-login-image xuetangx-login-qr" alt="学堂在线微信登录二维码" hidden>
        <div class="platform-qr-login-tip xuetangx-login-tip">请使用微信扫码登录</div>
      </div>
    </div>`;
    modal.addEventListener('click', (event) => {
      if (!event.target.closest('[data-xuetangx-login-close]')) return;
      cancelQrLogin();
    });
    modal.addEventListener('pointerdown', (event) => {
      modal.dataset.pointerStartedOnMask = event.target === modal ? '1' : '0';
    });
    modal.addEventListener('pointerup', (event) => {
      const shouldClose = event.target === modal && modal.dataset.pointerStartedOnMask === '1';
      delete modal.dataset.pointerStartedOnMask;
      if (shouldClose) cancelQrLogin();
    });
    document.body.appendChild(modal);
    return modal;
  }

  function showQrLoginModal(ticket = '') {
    const modal = getQrLoginModal();
    const image = modal.querySelector('.xuetangx-login-qr');
    const status = modal.querySelector('.xuetangx-login-status');
    if (ticket && image instanceof HTMLImageElement) {
      if (image.src !== ticket) image.src = ticket;
      image.hidden = false;
      if (status) status.textContent = '等待扫码确认…';
    } else {
      if (image instanceof HTMLImageElement) image.hidden = true;
      if (status) status.innerHTML = '<span class="spinner xuetangx-inline-spinner"></span> 正在获取登录二维码…';
    }
    modal.classList.add('show');
  }

  function hideQrLoginModal() {
    document.getElementById('xuetangx-login-modal')?.classList.remove('show');
  }

  async function startQrLoginSocket(tabId) {
    qrLoginTabId = Number(tabId) || null;
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const stateKey = '__bjtuXuetangxQrLoginState__';
        const socketKey = '__bjtuXuetangxQrLoginSocket__';
        try { globalThis[socketKey]?.close(); } catch {}
        const state = { status: 'connecting', ticket: '', loginid: null, expiresAt: 0, error: '' };
        globalThis[stateKey] = state;
        try {
          const socket = new WebSocket('wss://www.xuetangx.com/wsapp/');
          globalThis[socketKey] = socket;
          socket.addEventListener('open', () => {
            state.status = 'requesting';
            socket.send(JSON.stringify({ op: 'requestlogin', role: 'web', version: '1.4', purpose: 'login', xtbz: 'xt', 'x-client': 'web' }));
          });
          socket.addEventListener('message', (event) => {
            let message = null;
            try { message = JSON.parse(String(event.data || '')); } catch { return; }
            if (message?.op === 'requestlogin' && message.ticket) {
              state.status = 'waiting';
              state.ticket = String(message.ticket);
              state.loginid = message.loginid ?? null;
              state.expiresAt = Date.now() + Math.max(1, Number(message.expire_seconds) || 60) * 1000;
            } else if (message?.op === 'loginsuccess') {
              state.status = 'success';
              state.token = String(message.token || '');
              state.userId = message.u_id ?? message.UserID ?? null;
            }
          });
          socket.addEventListener('error', () => {
            if (state.status !== 'success') {
              state.status = 'error';
              state.error = '登录连接失败';
            }
          });
          socket.addEventListener('close', () => {
            if (state.status !== 'success') state.status = 'closed';
          });
          return true;
        } catch (error) {
          state.status = 'error';
          state.error = String(error?.message || error);
          return false;
        }
      }
    });
    return result?.[0]?.result === true;
  }

  async function readQrLoginState(tabId) {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const state = globalThis.__bjtuXuetangxQrLoginState__;
        return state ? { ...state } : null;
      }
    });
    return result?.[0]?.result || null;
  }

  async function stopQrLoginSocket() {
    const tabId = Number(qrLoginTabId || activeRequestTabId || 0);
    qrLoginTabId = null;
    if (!tabId) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try { globalThis.__bjtuXuetangxQrLoginSocket__?.close(); } catch {}
        delete globalThis.__bjtuXuetangxQrLoginSocket__;
        delete globalThis.__bjtuXuetangxQrLoginState__;
      }
    }).catch(() => {});
  }

  async function completeWechatLogin(tabId, token) {
    const sessionToken = String(token || '').trim();
    if (!sessionToken) throw new Error('学堂在线扫码登录未返回 token');
    const execution = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [sessionToken],
      func: async (s_s) => {
        const cookieMap = Object.fromEntries(document.cookie.split(';').map((part) => {
          const index = part.indexOf('=');
          if (index < 0) return [part.trim(), ''];
          const key = part.slice(0, index).trim();
          const raw = part.slice(index + 1);
          try { return [key, decodeURIComponent(raw)]; } catch { return [key, raw]; }
        }));
        const csrf = cookieMap.csrftoken || cookieMap.CSRF_TOKEN || cookieMap.x_csrftoken || '';
        const readDistinctId = () => {
          const candidates = [cookieMap.sensorsdata2015jssdkcross];
          try {
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index);
              if (/sensor|distinct/i.test(String(key || ''))) candidates.push(localStorage.getItem(key));
            }
          } catch {}
          for (const candidate of candidates) {
            if (!candidate) continue;
            let value = candidate;
            try { value = decodeURIComponent(value); } catch {}
            try {
              const parsed = JSON.parse(value);
              const found = parsed?.distinct_id ?? parsed?.distinctId ?? parsed?.props?.distinct_id;
              if (found) return String(found);
            } catch {}
            const matched = String(value).match(/(?:distinct_id|distinctId)["'=:\s]+([^"'&,}\s]+)/i);
            if (matched?.[1]) return matched[1];
          }
          return '';
        };
        const payload = {
          s_s,
          preset_properties: {
            '$timezone_offset': new Date().getTimezoneOffset(),
            '$screen_height': Number(globalThis.screen?.height || 0),
            '$screen_width': Number(globalThis.screen?.width || 0),
            '$lib': 'js',
            '$lib_version': '1.19.14',
            '$latest_traffic_source_type': '直接流量',
            '$latest_search_keyword': '未取到值_直接打开',
            '$latest_referrer': '',
            '$is_first_day': false,
            '$referrer': `${location.origin}/`,
            '$referrer_host': location.host,
            '$url': `${location.origin}/`,
            '$url_path': '/',
            '$title': document.title || '学堂在线 - 精品在线课程学习平台',
            '_distinct_id': readDistinctId()
          },
          page_name: '首页'
        };
        const headers = {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
          'x-client': 'web',
          xtbz: 'xt'
        };
        if (csrf) headers['x-csrftoken'] = csrf;
        try {
          const response = await fetch('https://www.xuetangx.com/api/v1/u/login/wx/', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            credentials: 'include',
            cache: 'no-store'
          });
          const text = await response.text();
          let data = null;
          try { data = JSON.parse(text); } catch {}
          return {
            ok: response.ok && data?.success !== false,
            status: response.status,
            data,
            message: data?.msg || data?.message || (data ? '' : text.slice(0, 300))
          };
        } catch (error) {
          return { ok: false, status: 0, message: String(error?.message || error) };
        }
      }
    });
    const result = execution?.[0]?.result;
    if (!result?.ok) {
      throw new Error(`学堂在线微信登录失败${result?.status ? `（HTTP ${result.status}）` : ''}${result?.message ? `：${result.message}` : ''}`);
    }
    return result.data;
  }

  async function waitForQrLogin(serial) {
    qrLoginCancelled = false;
    showQrLoginModal();
    while (serial === loadSerial && !qrLoginCancelled) {
      const tab = await ensureOriginTab(serial);
      showQrLoginModal();
      await startQrLoginSocket(tab.id);
      while (serial === loadSerial && !qrLoginCancelled) {
        const state = await readQrLoginState(tab.id).catch(() => null);
        if (!state) break;
        if (state.ticket) showQrLoginModal(state.ticket);
        if (state.status === 'success') {
          const status = document.querySelector('#xuetangx-login-modal .xuetangx-login-status');
          if (status) status.innerHTML = '<span class="spinner xuetangx-inline-spinner"></span> 正在完成登录…';
          await completeWechatLogin(tab.id, state.token);
          hideQrLoginModal();
          await stopQrLoginSocket();
          await chrome.tabs.reload(tab.id).catch(() => {});
          await waitForTabComplete(tab.id).catch(() => {});
          env?.toast?.('学堂在线登录成功', 'success');
          return true;
        }
        if (state.status === 'error' || state.status === 'closed' || (state.expiresAt && Date.now() >= state.expiresAt)) break;
        await sleep(500);
      }
      await stopQrLoginSocket();
      if (!qrLoginCancelled && serial === loadSerial) await sleep(500);
    }
    throw Object.assign(new Error('已取消学堂在线扫码登录'), { code: 'cancelled' });
  }

  function collectEvaluationLeaves(scoreData) {
    const map = new Map();
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const id = value?.score_info?.leaf_id ?? value?.id;
      const tagId = Number(value?.evaluation_tag?.id ?? value?.etag_info?.etag_id ?? 0);
      if (id && (tagId || value.score_info || value.time_info)) map.set(String(id), value);
      Object.values(value).forEach(visit);
    };
    visit(scoreData?.score_detail || []);
    return map;
  }

  function flattenEvaluationLeaves(scoreData) {
    const rows = [];
    const visit = (value, path = []) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, path));
        return;
      }
      const leafId = value?.score_info?.leaf_id ?? value?.id;
      const tagId = Number(value?.evaluation_tag?.id ?? value?.etag_info?.etag_id ?? 0);
      if (leafId && tagId) {
        const timeInfo = value.time_info || {};
        rows.push({
          id: leafId,
          name: value.name || value?.evaluation_tag?.name || value?.etag_info?.etag_name,
          leaf_type: value.type,
          start_time: timeInfo.start_time,
          score_deadline: timeInfo.score_deadline,
          end_time: timeInfo.end_time,
          is_locked: timeInfo.is_locked,
          chapterPath: path
        });
        return;
      }
      const nextPath = value.name ? [...path, String(value.name)] : path;
      Object.values(value).forEach((item) => visit(item, nextPath));
    };
    visit(scoreData?.score_detail || [], []);
    return rows;
  }

  function flattenChapterLeaves(root) {
    const rows = [];
    const walk = (node, path = []) => {
      if (!node || typeof node !== 'object') return;
      const nextPath = node.name ? [...path, String(node.name)] : path;
      for (const leaf of (Array.isArray(node.leaf_list) ? node.leaf_list : [])) {
        if (!leaf?.id || leaf.is_show === false) continue;
        rows.push({ ...leaf, chapterPath: nextPath });
      }
      for (const child of (Array.isArray(node.children) ? node.children : [])) walk(child, nextPath);
      for (const section of (Array.isArray(node.section_list) ? node.section_list : [])) walk(section, nextPath);
    };
    walk(root, []);
    return rows;
  }

  function activityType(leaf, evaluationLeaf) {
    const tagId = Number(evaluationLeaf?.evaluation_tag?.id ?? evaluationLeaf?.etag_info?.etag_id ?? 0);
    if (ACTIVITY_TYPES[tagId]) return { id: tagId, ...ACTIVITY_TYPES[tagId] };
    const chapterType = CHAPTER_LEAF_TYPE_TO_ACTIVITY_TYPE[Number(leaf?.leaf_type)];
    if (ACTIVITY_TYPES[chapterType]) return { id: chapterType, ...ACTIVITY_TYPES[chapterType] };
    const title = String(leaf?.name || '');
    if (/考试|考核/.test(title)) return { id: 12, ...ACTIVITY_TYPES[12] };
    if (/讨论/.test(title)) return { id: 10, ...ACTIVITY_TYPES[10] };
    if (/作业|测试|习题|练习/.test(title)) return { id: 11, ...ACTIVITY_TYPES[11] };
    const fallbackId = tagId || Number(leaf?.leaf_type) || -1;
    return { id: fallbackId, label: `活动${fallbackId > 0 ? ` ${fallbackId}` : ''}`, path: 'activity', action: 'view' };
  }

  function taskUrl(course, task) {
    return `${BASE}/learn/space/${encodeURIComponent(course.courseSign)}/${encodeURIComponent(course.sign)}/${encodeURIComponent(course.classroomId)}/${encodeURIComponent(task.path)}/${encodeURIComponent(task.id)}`;
  }

  function courseUrl(course) {
    return `${BASE}/learn/space/${encodeURIComponent(course.courseSign)}/${encodeURIComponent(course.sign)}/${encodeURIComponent(course.classroomId)}`;
  }

  function buildCourse(panel) {
    return {
      id: String(panel?.classroom_id || panel?.product_id || panel?.sku_id || ''),
      classroomId: String(panel?.classroom_id || ''),
      sign: String(panel?.sign || panel?.course_sign || ''),
      courseSign: String(panel?.course_sign || panel?.sign || ''),
      name: String(panel?.name || '学堂在线课程'),
      status: Number(panel?.status || 0),
      cover: String(panel?.cover || panel?.mobile_cover || ''),
      classStart: Number(panel?.class_start || 0),
      classEnd: Number(panel?.class_end || 0),
      teachers: [],
      tasks: [],
      totalSchedule: 0,
      score: null,
      detailLoaded: false,
      pendingTypeLabels: []
    };
  }

  function hydrateCourse(course, basicInfo, chapterResponse, scheduleResponse, evaluationResponse, visibleActivityTypes) {
    const teachers = basicInfo?.data?.teacher_list ?? basicInfo?.teacher_list ?? [];
    const chapterRoot = chapterResponse?.data?.course_chapter ?? chapterResponse?.course_chapter;
    const schedules = scheduleResponse?.data?.leaf_schedules ?? scheduleResponse?.leaf_schedules ?? {};
    const totalSchedule = scheduleResponse?.data?.total_schedule ?? scheduleResponse?.total_schedule ?? 0;
    const scoreData = evaluationResponse?.data ?? evaluationResponse ?? {};
    const evaluationLeaves = collectEvaluationLeaves(scoreData);
    const chapterLeaves = flattenChapterLeaves(chapterRoot);
    const leaves = chapterLeaves.length ? chapterLeaves : flattenEvaluationLeaves(scoreData);
    course.teachers = (Array.isArray(teachers) ? teachers : [])
      .map((teacher) => String(teacher?.name || '').trim()).filter(Boolean);
    course.totalSchedule = normalizeSchedule(totalSchedule);
    course.score = scoreData?.total_score_and_schedule || null;
    course.tasks = leaves.map((leaf) => {
      const evaluationLeaf = evaluationLeaves.get(String(leaf.id)) || {};
      const type = activityType(leaf, evaluationLeaf);
      const schedule = normalizeSchedule(schedules[String(leaf.id)] ?? evaluationLeaf?.schedule ?? 0);
      const timeInfo = evaluationLeaf?.time_info || {};
      const deadline = [timeInfo.score_deadline, leaf.score_deadline, timeInfo.end_time, leaf.end_time, course.classEnd]
        .map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
      const scoreInfo = evaluationLeaf?.score_info || {};
      const userScore = Number.isFinite(Number(scoreInfo.user_score)) ? Number(scoreInfo.user_score) : null;
      const totalScore = Number.isFinite(Number(scoreInfo.leaf_score)) ? Number(scoreInfo.leaf_score) : null;
      const hasFullScore = Number.isFinite(Number(userScore))
        && Number.isFinite(Number(totalScore))
        && Number(totalScore) > 0
        && Number(userScore) >= Number(totalScore);
      const discussionUnsubmitted = type.id === 10
        && !(deadline > 0 && deadline < Date.now())
        && !hasFullScore;
      const done = discussionUnsubmitted
        ? false
        : (type.id === 11
          ? false
          : (type.id === 6
            ? schedule >= 0.9995
            : (evaluationLeaf?.quiz_commit === true || evaluationLeaf?.is_done === true || schedule >= 0.9995)));
      return {
        id: String(leaf.id),
        chapterLeafId: String(leaf.id),
        leafInfoId: String(leaf.leafinfo_id ?? evaluationLeaf?.leafinfo_id ?? ''),
        title: String(leaf.name || type.label),
        typeId: type.id,
        typeLabel: type.label,
        path: type.path,
        action: type.action,
        chapterPath: Array.isArray(leaf.chapterPath) ? leaf.chapterPath : [],
        startTime: Number(timeInfo.start_time ?? leaf.start_time ?? 0) || 0,
        deadline,
        schedule,
        done,
        overdue: !done && deadline > 0 && deadline < Date.now(),
        userScore,
        totalScore,
        locked: timeInfo.is_locked === true || leaf.is_locked === true
      };
    }).filter((task) => visibleActivityTypes.has(task.typeId));
    if (!Object.keys(schedules || {}).length && course.tasks.length) {
      course.totalSchedule = course.tasks.reduce((sum, task) => sum + task.schedule, 0) / course.tasks.length;
    }
    course.detailLoaded = true;
    return course;
  }

  function formatExerciseProblem(problem, fallbackIndex) {
    const content = problem?.content || {};
    const index = Number(problem?.index) || fallbackIndex + 1;
    const typeText = String(content.TypeText || content.type_text || '题目').trim();
    const score = problem?.score ?? content.score ?? content.Score;
    const bodyHtml = global.BjtuHomeworkUi.sanitizeRichHtml(content.Body || content.body || '');
    const options = Array.isArray(content.Options) ? content.Options : [];
    const blanks = Array.isArray(content.Blanks) ? content.Blanks : [];
    const blankHtml = blanks.map((blank, blankIndex) => {
      const blankNumber = Number(blank?.Num) || blankIndex + 1;
      const blankScore = Number(blank?.Score);
      const parts = [
        `第${blankNumber}空`,
        Number.isFinite(blankScore) ? `${blankScore}分` : '',
        blank?.CaseSensitive === true ? '区分大小写' : '不区分大小写',
        blank?.FuzzyMatch === true ? '模糊匹配' : '精确匹配'
      ].filter(Boolean);
      return `<div class="homework-question-option">${escape(parts.join(' · '))}</div>`;
    }).join('');
    const user = problem?.user || {};
    const submissionParts = [];
    if (user.my_count !== undefined || user.count !== undefined) {
      submissionParts.push(`提交次数 ${escape(user.my_count ?? 0)}/${escape(user.count ?? 0)}`);
    }
    if (problem?.max_retry !== undefined && problem?.max_retry !== null) {
      submissionParts.push(`最大重试 ${escape(problem.max_retry)} 次`);
    }
    return global.BjtuHomeworkUi.questionDetailHtml({
      index,
      typeText,
      score,
      metaItems: submissionParts,
      bodyHtml,
      options: options.map((option) => ({
        key: option?.key ?? '',
        valueHtml: global.BjtuHomeworkUi.sanitizeRichHtml(option?.value ?? '')
      })),
      extraLinesHtml: blankHtml,
      escape
    });
  }

  function renderExerciseDetail(course, task, palette) {
    if (task.exerciseDetailLoading) {
      return `<div class="xuetangx-task-detail" style="border-top-color:${palette.border};"><span class="spinner xuetangx-inline-spinner" style="${global.BjtuHomeworkUi.spinnerPhaseStyle()}"></span> ${global.BjtuHomeworkUi.text.detailLoading}</div>`;
    }
    if (task.exerciseDetailError) {
      return `<div class="xuetangx-task-detail xuetangx-task-detail--error" style="border-top-color:${palette.border};">${escape(task.exerciseDetailError)}</div>`;
    }
    const problems = Array.isArray(task.exerciseProblems) ? task.exerciseProblems : [];
    if (!problems.length) return '';
    const contentHtml = problems.map(formatExerciseProblem).join('');
    const courseId = `xuetangx-${course.id}`;
    const expandKey = `xuetangx-exercise:${task.id}`;
    const expandable = env?.renderExpandable
      ? env.renderExpandable(contentHtml, global.BjtuHomeworkUi.detailOptions({
          hideWhenEmpty: true,
          baseBg: 'rgba(255,255,255,.28)',
          flatDisplay: true,
          courseId,
          expandKey,
          expanded: !!env.isDetailExpanded?.(courseId, expandKey)
        }))
      : contentHtml;
    return `<div class="xuetangx-task-detail" style="border-top-color:${palette.border};">${expandable}</div>`;
  }

  async function loadExerciseDetails(course, serial) {
    const tasks = course.tasks.filter((task) => task.typeId === 11 && task.chapterLeafId);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, tasks.length) }, async () => {
      while (cursor < tasks.length && serial === loadSerial) {
        const task = tasks[cursor++];
        task.exerciseDetailLoading = true;
        try {
          const leafInfo = await requestJson(
            `${BASE}/api/v1/lms/learn/leaf_info/${encodeURIComponent(course.classroomId)}/${encodeURIComponent(task.chapterLeafId)}/?sign=${encodeURIComponent(course.sign)}`,
            serial
          );
          if (leafInfo?.success === false) throw new Error(leafInfo?.msg || '作业叶节点接口返回失败');
          const exerciseTypeId = String(leafInfo?.data?.content_info?.leaf_type_id ?? '').trim();
          const exerciseSkuId = String(leafInfo?.data?.sku_id ?? '').trim();
          if (!exerciseTypeId || !exerciseSkuId) {
            throw new Error('作业叶节点响应缺少 leaf_type_id 或 sku_id');
          }
          task.exerciseTypeId = exerciseTypeId;
          task.exerciseSkuId = exerciseSkuId;
          const response = await requestJson(
            `${BASE}/api/v1/lms/exercise/get_exercise_list/${encodeURIComponent(exerciseTypeId)}/${encodeURIComponent(exerciseSkuId)}/`,
            serial
          );
          if (response?.success === false) throw new Error(response?.msg || '题目接口返回失败');
          task.exerciseProblems = Array.isArray(response?.data?.problems) ? response.data.problems : [];
          task.done = task.exerciseProblems.length > 0
            && task.exerciseProblems.every((problem) => Number(problem?.user?.my_count) > 0);
          task.overdue = !task.done && task.deadline > 0 && task.deadline < Date.now();
          task.exerciseDetailError = '';
        } catch (error) {
          if (error?.code === 'not-logged-in' || error?.code === 'cancelled') throw error;
          task.exerciseProblems = [];
          task.exerciseDetailError = `作业详情获取失败：${error?.message || error}`;
        } finally {
          task.exerciseDetailLoading = false;
        }
      }
    });
    await Promise.all(workers);
  }

  function clearCards() {
    env?.courseList?.querySelectorAll('.xuetangx-standalone-card').forEach((node) => node.remove());
    env?.updateEmpty?.();
  }

  function renderTask(course, task) {
    const palette = global.BjtuHomeworkUi.homeworkPalette({ done: task.done, overdue: task.overdue });
    const scoreVisible = task.done || Number(task.userScore) > 0;
    const score = global.BjtuHomeworkUi.scoreBadgeHtml({
      userScore: task.userScore,
      totalScore: task.totalScore,
      visible: scoreVisible,
      escape
    });
    const actionLabel = global.BjtuHomeworkUi.actionLabel('xuetangx', task.action, { lead: '去' });
    const chapter = task.chapterPath.filter(Boolean).slice(1).join(' / ');
    return global.BjtuHomeworkUi.renderHomeworkCard({
      done: task.done,
      className: 'xuetangx-task',
      background: palette.background,
      border: palette.border,
      headClass: 'xuetangx-task-head',
      mainClass: 'xuetangx-task-main',
      actionsClass: 'xuetangx-task-actions',
      titleHtml: global.BjtuHomeworkUi.titleHtml({ typeLabel: task.typeLabel, title: task.title, color: palette.foreground, href: taskUrl(course, task), escape, className: 'xuetangx-task-title' }),
      metaHtml: `${global.BjtuHomeworkUi.deadlineMetaHtml({ deadline: task.deadline, formatted: formatTime(task.deadline), done: task.done, overdue: task.overdue, escape })}${chapter ? `<div class="xuetangx-task-meta">${escape(chapter)}</div>` : ''}
        ${global.BjtuHomeworkUi.progressHtml({ ratio: task.schedule, escape, color: THEME_COLOR })}`,
      actionsHtml: `${score}${global.BjtuHomeworkUi.renderActionLink({
        href: taskUrl(course, task),
        label: actionLabel,
        color: palette.action,
        className: 'btn xuetangx-go-btn',
        escape
      })}`,
      detailHtml: task.typeId === 11 ? renderExerciseDetail(course, task, palette) : ''
    });
  }

  function renderToggle(courseId, kind, expanded, count) {
    const labels = global.BjtuHomeworkUi.toggleLabels(kind);
    const label = expanded ? labels.expanded : labels.collapsed;
    return `<div class="homework-toggle-row homework-toggle-row--${kind}">
      <button class="btn homework-toggle-btn ${expanded ? 'is-expanded homework-toggle-btn--up' : 'homework-toggle-btn--down'}" data-xuetangx-action="toggle-${kind}" data-course-id="${escape(courseId)}" data-count="${escape(count)}" data-collapsed-text="${escape(labels.collapsed)}" data-expanded-text="${escape(labels.expanded)}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
        <span class="homework-toggle-label">${escape(label)} (${escape(count)})</span>
        <span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>
      </button>
    </div>`;
  }

  function render() {
    if (!env?.courseList) return;
    clearCards();
    const baseOrder = Number(env.courseList.dataset.orderBase || 100000) + 140000;
    courses.forEach((course, index) => {
      const pending = course.tasks.filter((task) => !task.done && !task.overdue);
      const overdue = course.tasks.filter((task) => task.overdue);
      const done = course.tasks.filter((task) => task.done);
      const expanded = expandedGroups.get(course.id) || { overdue: false, done: false };
      const taskSections = `${pending.map((task) => renderTask(course, task)).join('')}
        ${overdue.length ? renderToggle(course.id, 'overdue', expanded.overdue, overdue.length) : ''}
        ${overdue.length ? `<div class="homework-group homework-group--overdue ${expanded.overdue ? '' : 'is-hidden'}" data-homework-group="overdue" aria-hidden="${expanded.overdue ? 'false' : 'true'}">${overdue.map((task) => renderTask(course, task)).join('')}</div>` : ''}
        ${done.length ? renderToggle(course.id, 'done', expanded.done, done.length) : ''}
        ${done.length ? `<div class="homework-group homework-group--done ${expanded.done ? '' : 'is-hidden'}" data-homework-group="done" aria-hidden="${expanded.done ? 'false' : 'true'}">${done.map((task) => renderTask(course, task)).join('')}</div>` : ''}`;
      const typeLoadingHtml = global.BjtuHomeworkUi.typeLoadingHtml(course.pendingTypeLabels, { escape });
      const score = course.score;
      const scoreText = score
        ? ` · 成绩 ${escape(score.user_score ?? 0)}${score.title ? `（${escape(score.title)}）` : ''}`
        : '';
      const meta = `${course.teachers.length ? escape(course.teachers.join(' / ')) : '教师信息加载中'} · ${escape(COURSE_STATUS_LABELS[course.status] || '未知状态')} · 总进度 ${escape(formatProgress(course.totalSchedule))}${scoreText}`;
      const card = global.BjtuCourseCardUi.createCourseCard({
        courseId: `xuetangx-${course.id}`,
        className: 'xuetangx-standalone-card',
        order: baseOrder + index,
        rank: pending.length ? 0 : (overdue.length ? 2 : (done.length ? 4 : 7)),
        titleHtml: `<a href="${escape(courseUrl(course))}" target="_blank" rel="noopener noreferrer">${escape(course.name)}</a>`,
        metaHtml: `<div class="xuetangx-course-meta">${meta}</div>`,
        contentHtml: `${typeLoadingHtml}${course.detailLoaded
          ? (course.loadError
            ? `<span class="xuetangx-empty">课程详情加载失败：${escape(course.loadError)}</span>`
            : (taskSections.trim() || '<span class="xuetangx-empty">暂无学习活动</span>'))
          : ''}`,
        headerClass: 'xuetangx-course-head',
        identityClass: 'xuetangx-course-identity',
        homeworkClass: 'homework-area xuetangx-homework-area',
        includeResultArea: false,
        wrapActions: false
      });
      env.courseList.appendChild(card);
    });
    env.updateEmpty?.();
    env.sortCourseCards?.();
    env.scheduleCache?.();
    setTimeout(() => env.updateCountdowns?.(), 0);
  }

  async function loadCourseDetails(course, serial, visibleActivityTypes) {
    const query = `cid=${encodeURIComponent(course.classroomId)}&sign=${encodeURIComponent(course.sign)}`;
    const [basic, chapter, schedule, evaluation] = await Promise.all([
      requestJson(`${BASE}/api/v1/lms/product/get_product_basic_info/?sign=${encodeURIComponent(course.sign)}`, serial),
      requestJson(`${BASE}/api/v1/lms/kg/kg_learn_chapter/?${query}`, serial),
      requestJson(`${BASE}/api/v1/lms/learn/course/schedule?${query}`, serial),
      requestJson(`${BASE}/api/v1/lms/learn/get_evaluation_detail/?${query}`, serial)
    ]);
    if (serial !== loadSerial) return;
    const endedError = (response) => course.status === 3
      && response?.success === false
      && Number(response?.error_code) === 80013;
    const failed = [basic, evaluation].find((response) => response?.success === false)
      || [chapter, schedule].find((response) => response?.success === false && !endedError(response));
    if (failed) throw new Error(failed.msg || '学堂在线课程详情接口返回失败');
    hydrateCourse(
      course,
      basic,
      endedError(chapter) ? { data: { course_chapter: null }, success: true } : chapter,
      endedError(schedule) ? { data: { leaf_schedules: {}, total_schedule: 0 }, success: true } : schedule,
      evaluation,
      visibleActivityTypes
    );
    course.pendingTypeLabels = [];
    render();
    await loadExerciseDetails(course, serial);
  }

  async function load() {
    const serial = ++loadSerial;
    env?.setState?.('checking');
    env?.setProgress?.(0, 0);
    clearCards();
    try {
      const [visibleStatuses, visibleActivityTypes] = await Promise.all([
        getVisibleStatuses(),
        getVisibleActivityTypes()
      ]);
      const response = await requestJson(COURSE_LIST_URL, serial);
      if (serial !== loadSerial) return;
      if (response?.success !== true || !response?.data || !Array.isArray(response.data.product_list)) {
        const error = new Error(response?.msg || '未登录学堂在线');
        error.code = 'not-logged-in';
        throw error;
      }
      courses = response.data.product_list
        .filter((panel) => visibleStatuses.includes(Number(panel?.status)))
        .map(buildCourse).filter((course) => course.id && course.classroomId && course.sign);
      const visibleTypeLabels = [...visibleActivityTypes]
        .map((typeId) => ACTIVITY_TYPES[typeId]?.label).filter(Boolean);
      courses.forEach((course) => { course.pendingTypeLabels = [...visibleTypeLabels]; });
      env?.setLoaded?.(true);
      env?.setState?.('online');
      env?.setProgress?.(0, courses.length);
      render();

      let completed = 0;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, courses.length) }, async () => {
        while (cursor < courses.length && serial === loadSerial) {
          const index = cursor++;
          try {
            await loadCourseDetails(courses[index], serial, visibleActivityTypes);
          } catch (error) {
            if (error?.code === 'not-logged-in' || error?.code === 'cancelled') throw error;
            courses[index].detailLoaded = true;
            courses[index].loadError = String(error?.message || error);
            courses[index].pendingTypeLabels = [];
          } finally {
            if (serial === loadSerial) {
              completed += 1;
              env?.setProgress?.(completed, courses.length);
              render();
            }
          }
        }
      });
      await Promise.all(workers);
      if (serial !== loadSerial) return;
      env?.setProgress?.(courses.length, courses.length);
      env?.setLoaded?.(true);
      env?.setState?.('online');
      render();
      closeCreatedHelperTabs();
    } catch (error) {
      if (serial !== loadSerial || error?.code === 'cancelled') return;
      courses = [];
      clearCards();
      env?.setLoaded?.(false);
      if (error?.code === 'not-logged-in') {
        env?.setState?.('checking');
        try {
          await waitForQrLogin(serial);
          if (serial === loadSerial && !qrLoginCancelled) return load();
        } catch (loginError) {
          if (loginError?.code !== 'cancelled' && serial === loadSerial) {
            hideQrLoginModal();
            await stopQrLoginSocket();
            closeCreatedHelperTabs();
            env?.toast?.(`学堂在线扫码登录失败：${loginError?.message || loginError}`, 'error');
            env?.setState?.('offline');
          }
        }
      } else {
        env?.setState?.('checking');
        env?.toast?.(`学堂在线加载失败：${error?.message || error}`, 'error');
        setTimeout(() => {
          if (serial === loadSerial && global.isPlatformEnabled?.('xuetangx')) void load();
        }, 1200);
      }
    }
  }

  function handleClick(event) {
    const button = event.target instanceof Element ? event.target.closest('[data-xuetangx-action]') : null;
    if (!(button instanceof HTMLElement)) return;
    const course = courses.find((item) => item.id === String(button.dataset.courseId || ''));
    if (!course || button.dataset.animating === '1') return;
    const kind = button.dataset.xuetangxAction === 'toggle-done' ? 'done' : 'overdue';
    const state = expandedGroups.get(course.id) || { overdue: false, done: false };
    const expanded = !state[kind];
    expandedGroups.set(course.id, { ...state, [kind]: expanded });
    const card = button.closest('.xuetangx-standalone-card');
    const group = card?.querySelector(`.homework-group[data-homework-group="${kind}"]`);
    if (!(group instanceof HTMLElement) || typeof env?.animateHomeworkGroupVisibility !== 'function') {
      render();
      return;
    }
    const count = String(button.dataset.count || '');
    const text = expanded ? button.dataset.expandedText : button.dataset.collapsedText;
    const label = button.querySelector('.homework-toggle-label');
    if (label) label.textContent = `${text} (${count})`;
    button.classList.toggle('is-expanded', expanded);
    button.classList.toggle('homework-toggle-btn--up', expanded);
    button.classList.toggle('homework-toggle-btn--down', !expanded);
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.dataset.animating = '1';
    group.dataset.expanded = expanded ? '1' : '0';
    group.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    env.animateHomeworkGroupVisibility(group, expanded);
    setTimeout(() => { delete button.dataset.animating; }, 240);
  }

  chrome.tabs?.onRemoved?.addListener?.((tabId) => {
    helperTabIds.delete(tabId);
    if (Number(activeRequestTabId) === Number(tabId)) activeRequestTabId = null;
  });

  global.BjtuXuetangxPlatform = {
    init(options) {
      env = options;
      env.courseList?.addEventListener('click', handleClick);
    },
    load,
    render,
    clear() {
      loadSerial += 1;
      qrLoginCancelled = true;
      courses = [];
      expandedGroups.clear();
      clearCards();
      env?.setProgress?.(0, 0);
      hideQrLoginModal();
      void stopQrLoginSocket();
      closeCreatedHelperTabs();
      activeRequestTabId = null;
      originTabPromise = null;
    },
    getCourses: () => courses,
    restore(value) {
      courses = Array.isArray(value) ? value : [];
    },
    themeColor: THEME_COLOR
  };

  /* ================= qwen 页面桥（service worker 经 app 页面调用） ================= */

  async function ensureXuetangxLoaded() {
    if (Array.isArray(courses) && courses.length) return;
    try {
      await load();
    } catch {
      /* 忽略触发失败，交由读取方判断 loaded */
    }
  }

  function xuetangxPageCourseList() {
    return {
      loaded: Array.isArray(courses) && courses.length > 0,
      loginState: String(globalThis.platformLoginState?.xuetangx || 'checking'),
      courses: (Array.isArray(courses) ? courses : []).map((course) => ({
        classroomId: String(course?.classroomId || course?.id || ''),
        name: String(course?.name || ''),
        sign: String(course?.sign || course?.courseSign || ''),
        teachers: Array.isArray(course?.teachers) ? course.teachers : [],
        status: Number(course?.status || 0),
        totalSchedule: Number(course?.totalSchedule || 0),
        score: Number(course?.score || 0),
        taskCount: Array.isArray(course?.tasks) ? course.tasks.length : 0
      }))
    };
  }

  async function xuetangxPageHomeworkOf(classroomId) {
    const key = String(classroomId || '').trim();
    if (!key) return { ok: false, message: '缺少参数 classroomId，请先调用 xuetangx.courseList 获取教室ID' };
    await ensureXuetangxLoaded();
    const course = (Array.isArray(courses) ? courses : []).find((c) => String(c?.classroomId || c?.id || '') === key) || null;
    if (!course) return { ok: false, message: `教室ID无效：${key} 不在学堂在线课程列表中，请先调用 xuetangx.courseList 获取有效ID` };
    return {
      ok: true,
      classroomId: String(course?.classroomId || course?.id || ''),
      name: String(course?.name || ''),
      teachers: Array.isArray(course?.teachers) ? course.teachers : [],
      totalSchedule: Number(course?.totalSchedule || 0),
      score: Number(course?.score || 0),
      homework: (Array.isArray(course?.tasks) ? course.tasks : []).map((task) => ({
        id: task?.id,
        chapterLeafId: task?.chapterLeafId,
        title: task?.title,
        typeId: Number(task?.typeId || 0),
        typeLabel: String(task?.typeLabel || ''),
        startTime: task?.startTime,
        deadline: task?.deadline,
        schedule: Number(task?.schedule || 0),
        done: !!task?.done,
        overdue: !!task?.overdue,
        userScore: Number(task?.userScore || 0),
        totalScore: Number(task?.totalScore || 0),
        locked: !!task?.locked,
        action: task?.action
      }))
    };
  }

  async function xuetangxPageLoginStatus() {
    const state = String(globalThis.platformLoginState?.xuetangx || 'checking');
    return { loginState: state, loggedIn: state === 'online', loaded: Array.isArray(courses) && courses.length > 0 };
  }

  async function xuetangxPageLogin(args = {}) {
    const platform = 'xuetangx';
    const enabled = typeof globalThis.isPlatformEnabled === 'function' ? globalThis.isPlatformEnabled(platform) : true;
    if (enabled) {
      if (typeof globalThis.triggerExternalPlatformLoad === 'function') {
        try { globalThis.triggerExternalPlatformLoad(platform, true); } catch {}
      }
    } else if (typeof globalThis.togglePlatformSelection === 'function') {
      try { globalThis.togglePlatformSelection(platform, { interactive: true }); } catch {}
    }
    return await waitForPlatformLoginResult(platform, Number(args?.timeoutMs) || 120000);
  }

  globalThis.BjtuXuetangxPageApi = Object.freeze({
    courseList: () => xuetangxPageCourseList(),
    homework_of_: (args) => xuetangxPageHomeworkOf(String(args?.classroomId || args?.courseId || '').trim()),
    loginStatus: () => xuetangxPageLoginStatus(),
    login: (args) => xuetangxPageLogin(args)
  });

  if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'PAGE_API' || message?.payload?.module !== 'xuetangx') return false;
      const api = globalThis.BjtuXuetangxPageApi;
      const fn = api && typeof api[String(message.payload?.fn || '')] === 'function' ? api[String(message.payload.fn)] : null;
      if (!fn) {
        sendResponse({ ok: false, error: 'XUETANGX 页面接口不存在' });
        return true;
      }
      Promise.resolve(fn(message.payload?.args || {})).then(
        (value) => sendResponse({ ok: true, value }),
        (error) => sendResponse({ ok: false, error: String(error?.message || error), code: String(error?.code || '') })
      );
      return true;
    });
  }
})(globalThis);
