(function() {
  if (globalThis.__bjtuJlgjCaptureInstalled) return;
  globalThis.__bjtuJlgjCaptureInstalled = true;

  const dataStore = {
    complete: false,
    userGroupPages: { ok: false, status: 0, data: null },
    partialGroups: [],
    threads: {},
    details: {},
    ts: Date.now()
  };
  globalThis.__bjtuJlgjData = dataStore;

  let lastAuth = '';
  let lastPayload = '';
  let lastMode = '';
  let syncToken = 0;

  const rawOpen = XMLHttpRequest.prototype.open;
  const rawSend = XMLHttpRequest.prototype.send;
  const rawSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const rawFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
  const API_BASE = 'https://i-api.jielong.com';

  const touch = () => { dataStore.ts = Date.now(); };

  const toAbsUrl = (url) => {
    try {
      return new URL(String(url || ''), location.origin);
    } catch {
      return null;
    }
  };

  const isUserGroupPagesUrl = (u) => {
    if (!u) return false;
    if (u.pathname !== '/api/UserGroup/UserGroupPages') return false;
    const pageIndex = String(u.searchParams.get('pageIndex') || '').trim();
    const pageSize = String(u.searchParams.get('pageSize') || '').trim();
    if (!pageIndex && !pageSize) return true;
    return pageIndex === '1' && pageSize === '20';
  };

  const parseJsonSafe = (text) => {
    try {
      return JSON.parse(String(text || ''));
    } catch {
      return null;
    }
  };

  const getGroupsFromPayload = (payload) => {
    const d = payload && payload.Data;
    if (Array.isArray(d && d.Data)) return d.Data;
    return Array.isArray(d) ? d : [];
  };

  const getThreadsFromPayload = (payload) => {
    const d = payload && payload.Data;
    if (Array.isArray(d && d.Data)) return d.Data;
    return Array.isArray(d) ? d : [];
  };

  const captureHeaders = (k, v) => {
    const key = String(k || '').toLowerCase();
    if (key === 'authorization') lastAuth = String(v || '');
    if (key === 'x-api-request-payload') lastPayload = String(v || '');
    if (key === 'x-api-request-mode') lastMode = String(v || '');
  };

  const fetchWithCapturedHeaders = (url) => {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      rawOpen.call(xhr, 'GET', url, true);
      if (lastAuth) rawSetRequestHeader.call(xhr, 'authorization', lastAuth);
      if (lastPayload) rawSetRequestHeader.call(xhr, 'x-api-request-payload', lastPayload);
      if (lastMode) rawSetRequestHeader.call(xhr, 'x-api-request-mode', lastMode);
      xhr.onload = () => {
        const status = Number(xhr.status || 0);
        const ok = status >= 200 && status < 300;
        const data = parseJsonSafe(xhr.responseText);
        resolve({ ok, status, data });
      };
      xhr.onerror = () => resolve({ ok: false, status: 0, data: null });
      rawSend.call(xhr);
    });
  };

  const syncFromUserGroupPages = async (groupPagesStatus, groupPagesPayload) => {
    const currentToken = ++syncToken;
    dataStore.complete = false;
    dataStore.userGroupPages = {
      ok: Number(groupPagesStatus) >= 200 && Number(groupPagesStatus) < 300,
      status: Number(groupPagesStatus || 0),
      data: groupPagesPayload || null
    };
    dataStore.threads = {};
    dataStore.details = {};
    touch();

    if (!dataStore.userGroupPages.ok || !groupPagesPayload) {
      dataStore.complete = true;
      touch();
      return;
    }

    const groups = getGroupsFromPayload(groupPagesPayload);
    dataStore.partialGroups = groups.map((g) => ({
      Id: String(g && g.Id || '').trim(),
      Name: String(g && g.Name || '').trim(),
      token: String(g && (g.Token || g.TokenStr || g.GroupToken || '')).trim()
    })).filter((g) => g.Id || g.Name || g.token);
    touch();
    if (!groups.length) {
      dataStore.complete = true;
      touch();
      return;
    }

    const threadTasks = groups.map(async (g) => {
      const groupId = String(g && g.Id || '').trim();
      if (!groupId) return;

      const threadsResp = await fetchWithCapturedHeaders(`${API_BASE}/api/Thread/GroupThreads?pageIndex=1&pageSize=20&groupId=${encodeURIComponent(groupId)}&groupListType=0`);
      if (syncToken !== currentToken) return;
      dataStore.threads[groupId] = threadsResp;
      touch();

      if (!threadsResp.ok || !threadsResp.data) return;
      const threads = getThreadsFromPayload(threadsResp.data);
      if (!threads.length) return;

      const detailTasks = threads.map(async (t) => {
        const threadId = String(t && t.ThreadStrId || '').trim();
        if (!threadId) return;
        const detailResp = await fetchWithCapturedHeaders(`${API_BASE}/api/Homework/HomeworkDetail?threadId=${encodeURIComponent(threadId)}`);
        if (syncToken !== currentToken) return;
        dataStore.details[threadId] = {
          ...detailResp,
          __author: String(t && t.Author || '').trim(),
          __groupName: String(t && (t.GroupName || t.GroupDynamicName) || '').trim()
        };
        touch();
      });

      await Promise.allSettled(detailTasks);
    });

    await Promise.allSettled(threadTasks);
    if (syncToken !== currentToken) return;
    dataStore.complete = true;
    touch();
  };

  const onUserGroupPagesResponse = (url, status, text) => {
    const parsed = parseJsonSafe(text);
    if (!parsed) {
      syncFromUserGroupPages(status, null);
      return;
    }
    syncFromUserGroupPages(status, parsed);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(k, v) {
    captureHeaders(k, v);
    return rawSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    try {
      this.__bjtuReqUrl = String(url || '');
    } catch {
      this.__bjtuReqUrl = '';
    }
    return rawOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    try {
      this.addEventListener('loadend', function() {
        try {
          const u = toAbsUrl(this.__bjtuReqUrl || '');
          if (!isUserGroupPagesUrl(u)) return;
          onUserGroupPagesResponse(String(u.href || this.__bjtuReqUrl || ''), Number(this.status || 0), String(this.responseText || ''));
        } catch {
          // ignore
        }
      }, { once: true });
    } catch {
      // ignore
    }
    return rawSend.apply(this, args);
  };

  if (rawFetch) {
    globalThis.fetch = async (...args) => {
      const res = await rawFetch(...args);
      try {
        const reqUrl = String(args && args[0] && (args[0].url || args[0]) || '');
        const u = toAbsUrl(reqUrl);
        if (isUserGroupPagesUrl(u)) {
          const text = await res.clone().text();
          onUserGroupPagesResponse(String(u.href || reqUrl), Number(res.status || 0), text);
        }
      } catch {
        // ignore
      }
      return res;
    };
  }
})();
