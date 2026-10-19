const MRJZY_API_BASE = 'https://lulu.lulufind.com';
const MRJZY_WEB_BASE = 'https://zuoye.lulufind.com';
const MRJZY_WORK_LIST_API = `${MRJZY_API_BASE}/mrzy/mrzypc/findWorkNewVersion`;
const MRJZY_WORK_DETAIL_API = `${MRJZY_API_BASE}/mrzy/mrzypc/getWorkDetail`;

const MRJZY_HEADER_RULE_ID = 914306;

let mrjzyHeaderRulePromise = null;

function ensureMrjzyRequestHeaderRule() {
  if (mrjzyHeaderRulePromise) return mrjzyHeaderRulePromise;
  if (!chrome.declarativeNetRequest?.updateSessionRules) return Promise.resolve(false);
  mrjzyHeaderRulePromise = chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [MRJZY_HEADER_RULE_ID],
    addRules: [{
      id: MRJZY_HEADER_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: MRJZY_WEB_BASE },
          { header: 'Referer', operation: 'set', value: `${MRJZY_WEB_BASE}/` }
        ]
      },
      condition: {
        regexFilter: '^https://lulu\\.lulufind\\.com/mrzy/mrzypc/(?:findWorkNewVersion|getWorkDetail)(?:\\?.*)?$',
        resourceTypes: ['xmlhttprequest'],
        requestMethods: ['post']
      }
    }]
  }).then(() => true).catch((error) => {
    mrjzyHeaderRulePromise = null;
    throw error;
  });
  return mrjzyHeaderRulePromise;
}

async function postMrjzyForm(url, paramsObj, runtimeCtx = null) {
  const MRJZY_SIGN_SALT = 'IF75D4U19LKLDAZSMPN5ATQLGBFEJL4VIL2STVDBNJJTO6LNOGB265CR40I4AL13';
  const throwIfCancelled = () => {
    if (runtimeCtx?.cancelled) {
      throw Object.assign(new Error('每日交作业加载已取消'), { code: 'cancelled' });
    }
  };
  throwIfCancelled();
  await ensureMrjzyRequestHeaderRule();

  const normalizeMrjzyParams = (obj) => {
    const out = {};
    Object.keys(obj || {}).forEach((k) => {
      const v = obj[k];
      if (v === undefined) return;
      out[k] = String(v);
    });
    return out;
  };

  const toBodyRaw = (obj) => Object.entries(obj || {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(String(k))}=${encodeURIComponent(String(v ?? ''))}`)
    .join('&');

  const toBase64Utf8 = (s) => {
    try {
      return btoa(unescape(encodeURIComponent(String(s || ''))));
    } catch {
      return btoa(String(s || ''));
    }
  };

  const buildMrjzySign = (obj) => {
    const normalized = normalizeMrjzyParams(obj || {});
    const payload = JSON.stringify(normalized || {});
    return md5(`${toBase64Utf8(payload)}${MRJZY_SIGN_SALT}`);
  };

  const getCookieValueLoose = async (domain, names) => {
    try {
      const all = await chrome.cookies.getAll({ domain });
      if (!all || !all.length) return '';
      all.sort((a, b) => (b.path || '').length - (a.path || '').length);
      const nameSet = new Set((names || []).map((n) => String(n || '').toLowerCase()));
      const hit = all.find((c) => nameSet.has(String(c?.name || '').toLowerCase()));
      return String(hit?.value || '').trim();
    } catch {
      return '';
    }
  };

  const sign = buildMrjzySign(paramsObj || {});
  const token = await getCookieValueLoose('lulu.lulufind.com', ['Teacher-Token', 'Token'])
    || await getCookieValueLoose('zuoye.lulufind.com', ['Teacher-Token', 'Token']);

  const normalizedParams = normalizeMrjzyParams(paramsObj || {});
  const bodyRaw = toBodyRaw(normalizedParams);
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/x-www-form-urlencoded',
    Pragma: 'no-cache'
  };
  if (sign) headers.sign = sign;
  if (token) headers.token = token;

  throwIfCancelled();
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers,
    body: bodyRaw,
    signal: runtimeCtx?.controller?.signal
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }

  return { res, data, text };
}
