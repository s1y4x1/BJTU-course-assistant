(function initMrjzyBackground(global) {
  'use strict';

  const LOGIN_URL = 'https://api-prod.lulufind.com/api/v1/auth/smslogin';
  const ALL_USERS_URL = 'https://api-prod.lulufind.com/mrzy/v1/user/alluser';
  const ACCOUNTS_KEY = 'mrjzyAccounts';
  const ACCOUNT_REVISION_KEY = 'mrjzyAccountRevision';
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;
  const pending = new Map();
  let accountWritePromise = Promise.resolve();

  function normalizeIdentities(value) {
    return (Array.isArray(value) ? value : []).map((identity) => {
      const openId = String(identity?.openId || '').trim();
      if (!openId) return null;
      return {
        openId,
        userName: String(identity?.userRealName || identity?.userName || '').trim(),
        schoolName: String(identity?.school?.schoolName || identity?.schoolName || '').trim(),
        classes: (Array.isArray(identity?.groups) ? identity.groups : Array.isArray(identity?.classes) ? identity.classes : [])
          .map((group) => ({
            classId: String(group?.classId || '').trim(),
            classNum: String(group?.classNum || '').trim(),
            name: String(group?.divClass || group?.name || '').trim()
          }))
          .filter((group) => group.classId || group.classNum || group.name)
      };
    }).filter(Boolean);
  }

  function normalizeAccount(phone, source = {}) {
    const id = String(phone || source?.phone || '').trim();
    return {
      phone: id,
      password: String(source?.password || ''),
      userName: String(source?.userName || ''),
      selectedOpenId: String(source?.selectedOpenId || ''),
      selectedClassId: String(source?.selectedClassId || ''),
      identities: normalizeIdentities(source?.identities),
      updatedAt: Number(source?.updatedAt || 0),
      lastLoginAt: Number(source?.lastLoginAt || 0)
    };
  }

  async function getAccounts() {
    const stored = await chrome.storage.local.get(ACCOUNTS_KEY);
    const source = stored?.[ACCOUNTS_KEY] && typeof stored[ACCOUNTS_KEY] === 'object'
      ? stored[ACCOUNTS_KEY]
      : {};
    const accounts = {};
    for (const [phone, value] of Object.entries(source)) {
      const account = normalizeAccount(phone, value);
      if (account.phone) accounts[account.phone] = account;
    }
    return accounts;
  }

  async function saveCredentials(phone, password, patch = {}) {
    const id = String(phone || '').trim();
    const secret = String(password || '');
    if (!id || !secret) return { ok: false, changed: false, account: null };
    const write = accountWritePromise.then(async () => {
      const accounts = await getAccounts();
      const previous = accounts[id] || normalizeAccount(id);
      const changed = previous.password !== secret
        || (!!patch.userName && previous.userName !== String(patch.userName))
        || (Array.isArray(patch.identities) && JSON.stringify(previous.identities) !== JSON.stringify(normalizeIdentities(patch.identities)));
      const account = normalizeAccount(id, {
        ...previous,
        ...patch,
        password: secret,
        updatedAt: Date.now(),
        lastLoginAt: Date.now()
      });
      accounts[id] = account;
      await chrome.storage.local.set({
        [ACCOUNTS_KEY]: accounts,
        [ACCOUNT_REVISION_KEY]: Date.now()
      });
      return { ok: true, changed, account };
    });
    accountWritePromise = write.catch(() => {});
    return write;
  }

  async function saveSelectedIdentity(phone, selectedOpenId, selectedClassId = '') {
    const id = String(phone || '').trim();
    const openId = String(selectedOpenId || '').trim();
    if (!id || !openId) return false;
    const write = accountWritePromise.then(async () => {
      const accounts = await getAccounts();
      const previous = accounts[id];
      if (!previous?.password) return false;
      accounts[id] = normalizeAccount(id, {
        ...previous,
        selectedOpenId: openId,
        selectedClassId: String(selectedClassId || '').trim(),
        updatedAt: Date.now()
      });
      await chrome.storage.local.set({
        [ACCOUNTS_KEY]: accounts,
        [ACCOUNT_REVISION_KEY]: Date.now()
      });
      return true;
    });
    accountWritePromise = write.catch(() => {});
    return write;
  }

  function decodeRequestBody(requestBody) {
    const raw = requestBody?.raw;
    if (!Array.isArray(raw) || !raw.length) return null;
    try {
      const chunks = raw.map((part) => new Uint8Array(part?.bytes || []));
      const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const bytes = new Uint8Array(length);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      });
      const data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      const phone = String(data?.phone || data?.mobile || '').trim();
      const password = String(data?.password || '');
      return phone && password ? { phone, password, capturedAt: Date.now() } : null;
    } catch {
      return null;
    }
  }

  function remember(details, credentials) {
    const requestId = String(details?.requestId || '');
    if (!requestId || !credentials) return;
    pending.set(requestId, { ...credentials, tabId: Number(details?.tabId ?? -1) });
    setTimeout(() => pending.delete(requestId), 120000);
  }

  async function verifyExternalLogin(credentials) {
    const response = await fetch(LOGIN_URL, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone: credentials.phone, password: credentials.password })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || Number(data?.code) !== 200) return false;
    const accounts = Array.isArray(data?.data?.accounts) ? data.data.accounts : [];
    const loginAccount = accounts.find((item) => String(item?.token || '').trim()) || null;
    const token = String(loginAccount?.token || '').trim();
    let identities = loginAccount?.user ? [loginAccount.user] : [];
    if (token) {
      const usersResponse = await fetch(ALL_USERS_URL, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          token,
          Authorization: `Bearer ${token}`
        }
      }).catch(() => null);
      const usersData = await usersResponse?.json().catch(() => null);
      if (usersResponse?.ok && Number(usersData?.code) === 200 && Array.isArray(usersData?.data?.users)) {
        identities = usersData.data.users;
      }
    }
    const userName = String(loginAccount?.user?.userRealName || '').trim();
    await saveCredentials(credentials.phone, credentials.password, {
      userName,
      identities
    });
    await global.BjtuPageToast?.show(
      credentials.tabId,
      `每日交作业登录成功，已保存账号 ${credentials.phone} 的密码`,
      'success'
    ).catch(() => {});
    return true;
  }

  if (chrome.webRequest?.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.addListener((details) => {
      if (String(details?.method || '').toUpperCase() !== 'POST') return;
      if (Number(details?.tabId ?? -1) < 0) return;
      if (String(details?.initiator || '') === EXTENSION_ORIGIN) return;
      remember(details, decodeRequestBody(details.requestBody));
    }, { urls: [`${LOGIN_URL}*`] }, ['requestBody']);
  }

  if (chrome.webRequest?.onCompleted) {
    chrome.webRequest.onCompleted.addListener((details) => {
      const requestId = String(details?.requestId || '');
      const credentials = pending.get(requestId);
      pending.delete(requestId);
      if (!credentials || Number(details?.statusCode || 0) < 200 || Number(details?.statusCode || 0) >= 300) return;
      void verifyExternalLogin(credentials).catch(() => {});
    }, { urls: [`${LOGIN_URL}*`] });
  }

  if (chrome.webRequest?.onErrorOccurred) {
    chrome.webRequest.onErrorOccurred.addListener((details) => {
      pending.delete(String(details?.requestId || ''));
    }, { urls: [`${LOGIN_URL}*`] });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'MRJZY_PASSWORD_LOGIN_SUCCESS') {
      const phone = String(message.payload?.phone || '').trim();
      const password = String(message.payload?.password || '');
      void saveCredentials(phone, password, {
        userName: String(message.payload?.userName || ''),
        identities: message.payload?.identities
      })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message?.type === 'MRJZY_SELECTED_IDENTITY') {
      void saveSelectedIdentity(message.payload?.phone, message.payload?.openId, message.payload?.classId)
        .then((ok) => sendResponse({ ok }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message?.type === 'MRJZY_GET_SAVED_CREDENTIAL') {
      const phone = String(message.loginName || message.phone || '').trim();
      void getAccounts()
        .then((accounts) => {
          const account = accounts[phone];
          sendResponse({ ok: !!account?.password, account: account?.password ? account : null });
        })
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message?.type === 'MRJZY_GET_SAVED_ACCOUNTS') {
      void getAccounts()
        .then((accounts) => sendResponse({
          ok: true,
          accounts: Object.values(accounts)
            .filter((account) => !!account.password)
            .sort((a, b) => Number(b.lastLoginAt || b.updatedAt || 0) - Number(a.lastLoginAt || a.updatedAt || 0))
            .map((account) => ({
              phone: account.phone,
              userName: account.userName,
              selectedOpenId: account.selectedOpenId,
              selectedClassId: account.selectedClassId,
              identities: account.identities,
              updatedAt: account.updatedAt,
              lastLoginAt: account.lastLoginAt
            }))
        }))
        .catch((error) => sendResponse({ ok: false, accounts: [], error: String(error?.message || error) }));
      return true;
    }
    return false;
  });
})(globalThis);
