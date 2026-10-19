const JLGJ_API_BASE = 'https://i-api.jielong.com';
const JLGJ_WEB_BASE = 'https://i.jielong.com/my-class';
const JLGJ_GROUP_LIST_API = `${JLGJ_API_BASE}/api/UserGroup/UserGroupPages?pageIndex=1&pageSize=20`;

async function getJlgjAuthHeaders() {
  try {
    const cookieSets = await Promise.all([
      chrome.cookies.getAll({ url: 'https://i.jielong.com/' }),
      chrome.cookies.getAll({ url: 'https://i-api.jielong.com/' })
    ]);
    const cookies = cookieSets.flat();
    const tokenCookie = (cookies || []).find((cookie) => String(cookie?.name || '').toLowerCase() === 'token');
    let token = String(tokenCookie?.value || '').trim();
    try { token = decodeURIComponent(token); } catch { /* Keep the raw cookie value. */ }
    token = token.replace(/^['"]|['"]$/g, '').replace(/^Bearer\s+/i, '').trim();
    return { authorization: token ? `Bearer ${token}` : '', token };
  } catch {
    return { authorization: '', token: '' };
  }
}

function extractJlgjData(payload) {
  if (payload && payload.Data !== undefined) return payload.Data;
  if (payload && payload.data !== undefined) return payload.data;
  return null;
}

function isJlgjUnauthorizedPayload(payload) {
  const type = String(payload?.Type ?? payload?.type ?? '').trim();
  const dataText = String(payload?.Data ?? payload?.data ?? '').trim();
  return type === '100000' || /请先授权登录小程序/i.test(dataText);
}

async function fetchJlgjJson(url) {
  const headers = { Accept: 'application/json, text/plain, */*' };
  const auth = await getJlgjAuthHeaders();
  if (!auth.authorization) {
    return { ok: false, status: 401, data: null, unauthorized: true, message: '接龙管家登录 token 不存在' };
  }
  headers.authorization = auth.authorization;

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      unauthorized: false,
      message: String(error?.message || error)
    };
  }
  const text = await res.text();
  try {
    const data = JSON.parse(String(text || '{}'));
    const unauthorized = Number(res.status || 0) === 401 || Number(res.status || 0) === 403 || isJlgjUnauthorizedPayload(data);
    return { ok: res.ok, status: Number(res.status || 0), data, unauthorized };
  } catch {
    return { ok: false, status: Number(res.status || 0), data: null, raw: text, unauthorized: Number(res.status || 0) === 401 || Number(res.status || 0) === 403 };
  }
}
