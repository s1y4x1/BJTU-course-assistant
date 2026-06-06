async function portalLoginAutoLoginInjected(context) {
  // md5() is provided globally by the md5.js content script declared in manifest.json.
  if (typeof md5 !== 'function') {
    return { ok: false, reason: 'md5-missing', message: '全局 md5 函数不可用（md5.js content script 未加载）' };
  }
  // Verify Tesseract is loaded; if not, the function will return early so the caller can try ISOLATED world
  if (typeof globalThis.Tesseract !== 'object' || typeof globalThis.Tesseract.createWorker !== 'function') {
    return { ok: false, reason: 'tesseract-missing', message: 'Tesseract OCR 未加载' };
  }

  const root = document.body || document.documentElement;
  if (!root) return { ok: false, reason: 'no-root' };

  const old2 = document.getElementById('__bjtu_login_modal__');
  if (old2) return { ok: false, reason: 'modal-already-shown' };
  const old3 = document.getElementById('__bjtu_auto_login_overlay__');
  if (old3) return { ok: false, reason: 'auto-overlay-already-shown' };

  if (window.__bjtu_portal_login_running__) {
    return { ok: false, reason: 'already-running' };
  }
  window.__bjtu_portal_login_running__ = true;
  const _resetRunningFlag = () => { try { window.__bjtu_portal_login_running__ = false; } catch {} };
  try { window.addEventListener('pagehide', _resetRunningFlag, { once: true }); } catch {}

  // Pre-computed values from background.js (MAIN world compat)
  const tesseractWorkerUrl = context._tesseractWorkerUrl;
  const tesseractCoreUrl = context._tesseractCoreUrl;
  const tesseractLangUrl = context._tesseractLangUrl;
  const portalModalUrl = context._portalModalUrl;
  const autoCaptchaEnabled = context._autoCaptchaEnabled;
  const hasChrome = typeof chrome !== 'undefined' && !!chrome?.storage?.local;

  let username = String(context?.username || '').trim();
  let passcode = String(context?.passcode || '').trim();
  let passwordMd5 = String(context?.passwordMd5 || '').trim();
  const autoCode = String(context?.autoCode || '').trim();
  const fromExtension = !!context?.fromExtension;
  const originalRequestedUsername = String(context?.username || '').trim();
  const accountHistory = (Array.isArray(context?.accountHistory) ? context.accountHistory : [])
    .map((it) => ({
      userId: String(it?.userId || '').trim(),
      loginName: String(it?.loginName || it?.userId || '').trim(),
      userName: String(it?.userName || '').trim(),
      roleName: String(it?.roleName || '').trim(),
      passwordMd5: String(it?.passwordMd5 || '').trim(),
      quickUsername: String(it?.quickUsername || it?.username || '').trim()
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

  const findAccountRecord = (userId) => {
    const uid = String(userId || '').trim();
    if (!uid) return null;
    return accountHistory.find((it) => it.userId === uid || it.loginName === uid) || null;
  };

  async function saveLoginAccountPatch(userId, patch = {}) {
    const uid = String(userId || '').trim();
    if (!uid || !hasChrome) return;
    try {
      const key = 'loginAccountHistory';
      const raw = await chrome.storage.local.get(key);
      const list = Array.isArray(raw?.[key]) ? raw[key] : [];
      const idx = list.findIndex((it) => String(it?.userId || '').trim() === uid || String(it?.loginName || '').trim() === uid);
      const prev = idx >= 0 ? list[idx] : {};
      const record = {
        ...prev,
        userId: String(prev.userId || uid).trim(),
        loginName: String(patch.loginName || prev.loginName || uid).trim(),
        userName: String(patch.userName || prev.userName || '').trim(),
        roleName: String(patch.roleName || prev.roleName || '').trim(),
        passwordMd5: String(patch.passwordMd5 || prev.passwordMd5 || '').trim(),
        quickUsername: String(patch.quickUsername || patch.username || prev.quickUsername || '').trim(),
        lastLoginAt: Date.now()
      };
      if (idx >= 0) list.splice(idx, 1);
      list.unshift(record);
      await chrome.storage.local.set({ [key]: list });
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
    const fetchWithTimeout = (url, timeoutMs = 5000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { credentials: 'include', signal: controller.signal })
        .finally(() => clearTimeout(timeoutId));
    };
    let infoRes;
    try {
      infoRes = await fetchWithTimeout(`/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${encodeURIComponent(id)}`);
    } catch {
      return '';
    }
    let infoText = '';
    try { infoText = await infoRes.text(); } catch { return ''; }
    if ((infoText || '').includes('login-page')) return '';
    const studentUrl = `/ve/back/coursePlatform/coursePlatform.shtml?method=studentInfo&stuId=${encodeURIComponent(id)}`;
    const teacherUrl = `/ve/back/coursePlatform/coursePlatform.shtml?method=personInfo&teacherId=${encodeURIComponent(id)}`;
    const urls = (infoText || '').includes('学生') ? [studentUrl, teacherUrl] : [teacherUrl, studentUrl];
    for (const u of urls) {
      let res;
      try {
        res = await fetchWithTimeout(u);
      } catch {
        continue;
      }
      let text = '';
      try { text = await res.text(); } catch { continue; }
      const m = String(text || '').match(/(?:id|name)=["']oldpassword["'][^>]*value=["']([^"']+)["']/i)
        || String(text || '').match(/value=["']([^"']+)["'][^>]*(?:id|name)=["']oldpassword["']/i);
      if (m?.[1]) return m[1];
    }
    return '';
  }

  async function fetchAndSavePasswordMd5(userId) {
    const id = String(userId || '').trim();
    if (!id) return '';
    let found = '';
    try {
      found = await fetchPasswordMd5ByUserId(id);
    } catch {
      found = '';
    }
    if (found) {
      await saveLoginAccountPatch(id, { passwordMd5: found });
    }
    return found;
  }

  async function tryQuickUsernameLogin(quickUsername) {
    const quick = String(quickUsername || '').trim();
    if (!quick) return false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`/ve/s.shtml?loginType=2&login=main_2&username=${encodeURIComponent(quick)}`, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      });
      const text = await res.text();
      return looksLikeLoginSuccess(text) || String(text || '').includes('index.shtml?method=index&type=qxkt');
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function startAuxiliaryLoginForPassword(original) {
    const target = String(original || '').trim();
    if (!target) return false;
    const quick = String(findAccountRecord(target)?.quickUsername || '').trim();
    flowState.originalUsername = target;
    flowState.useAux = true;
    flowState.forceRetry = true;
    flowState.retryCount = 0;
    passcode = '';

    if (quick) {
      if (await tryQuickUsernameLogin(quick)) {
        flowState.currentUsername = quick;
        flowState.auxQuickUsername = quick;
        writeFlowState(flowState);
        location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';
        return true;
      }
    }

    username = '8888';
    passwordMd5 = md5('Bjtu@8888');
    flowState.currentUsername = '8888';
    flowState.passwordMd5 = passwordMd5;
    writeFlowState(flowState);
    return false;
  }

  const pageHtmlAtStart = document.documentElement?.outerHTML || '';
  const alertMsgAtStart = parseAlertMsg(pageHtmlAtStart);
  const onLoginPageAtStart = isLikelyLoginPageHtml(pageHtmlAtStart, location.href);
  const pageHtmlLower = String(pageHtmlAtStart || '').toLowerCase();
  const sessionEnded = pageHtmlLower.includes('<title>会话结束</title>')
    && pageHtmlLower.includes('<strong><font style="font-size:16px">会话结束,请退出系统')
    && pageHtmlLower.includes('重新登录');
  const flowState = readFlowState();
  flowState.mode = flowState.mode || (fromExtension ? 'extension' : 'page');
  flowState.retryCount = Number.isFinite(Number(flowState.retryCount))
    ? Math.max(0, Number(flowState.retryCount))
    : 0;
  flowState.retryCount = Math.min(MAX_AUTO_RETRY_ROUNDS, flowState.retryCount);
  // lastAttemptTs: timestamp of last automatic/manual submit attempt (ms)
  flowState.lastAttemptTs = Number(flowState.lastAttemptTs || 0) || 0;
  if (originalRequestedUsername && !flowState.originalUsername) {
    flowState.originalUsername = originalRequestedUsername;
  }
  if (!flowState.currentUsername && username) {
    flowState.currentUsername = username;
  }
  if (!passwordMd5) {
    passwordMd5 = String(flowState.passwordMd5 || findAccountRecord(username)?.passwordMd5 || '').trim();
  }

  if (!onLoginPageAtStart && !sessionEnded) {
    const original = String(flowState.originalUsername || '').trim();
    const current = String(flowState.currentUsername || '').trim();
    if (original && flowState.useAux && current && current !== original) {
      const foundPwd = await fetchAndSavePasswordMd5(original);
      try {
        const exitController = new AbortController();
        const exitTimeout = setTimeout(() => exitController.abort(), 3000);
        try {
          await fetch('/ve/Exit_2.jsp', { credentials: 'include', cache: 'no-store', signal: exitController.signal });
        } finally {
          clearTimeout(exitTimeout);
        }
      } catch {}
      flowState.currentUsername = original;
      flowState.useAux = false;
      flowState.passwordMd5 = foundPwd || '';
      flowState.forceRetry = true;
      flowState.retryCount = 0;
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

  function binarizeToCanvas(img, threshold = 160, scale = 2) {
    const w = Math.max(1, img.naturalWidth || img.width || 1);
    const h = Math.max(1, img.naturalHeight || img.height || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i];
      const g = imgData.data[i + 1];
      const b = imgData.data[i + 2];
      const gray = (0.299 * r + 0.587 * g + 0.114 * b);
      const v = gray < threshold ? 0 : 255;
      imgData.data[i] = v;
      imgData.data[i + 1] = v;
      imgData.data[i + 2] = v;
      imgData.data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  function preprocessToCanvas(img) {
    return binarizeToCanvas(img, 160, 2);
  }

  async function loadImageFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function blobToDataUrl(blob) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('blob-read-failed'));
      reader.readAsDataURL(blob);
    });
  }

  function getTessResultData(result) {
    return result?.data && typeof result.data === 'object' ? result.data : (result || {});
  }

  // Tesseract worker 单例：每次识别都新建 worker 会消耗整个 8s 预算（冷启动 1.5-3s × 3 次重试），
  // 导致后续调用超时失败。跨调用复用同一个 worker，恢复旧版行为。
  let cachedTessWorkerPromise = null;
  async function getTessWorker() {
    if (cachedTessWorkerPromise) return cachedTessWorkerPromise;
    cachedTessWorkerPromise = (async () => {
      const T = globalThis.Tesseract;
      if (!T || typeof T.createWorker !== 'function') {
        return null;
      }
      const baseOptions = {
        logger: () => {},
        workerPath: tesseractWorkerUrl || (hasChrome ? chrome.runtime.getURL('vendor/tesseract/worker.min.js') : null),
        corePath: tesseractCoreUrl || (hasChrome ? chrome.runtime.getURL('vendor/tesseract/tesseract-core-simd.wasm.js') : null),
        langPath: tesseractLangUrl || (hasChrome ? chrome.runtime.getURL('vendor/tesseract') : null)
      };
      if (!baseOptions.workerPath) return null;
      let worker = null;
      const optionVariants = [
        { ...baseOptions, workerBlobURL: true },
        { ...baseOptions, workerBlobURL: false }
      ];
      for (const options of optionVariants) {
        try {
          worker = await T.createWorker('eng', 1, options);
          break;
        } catch (e) {
          try { console.warn('[bjtu] ocr: createWorker failed (workerBlobURL=' + options.workerBlobURL + '):', String(e?.message || e)); } catch {}
        }
      }
      if (!worker) {
        cachedTessWorkerPromise = null;
        return null;
      }
      try {
        if (worker.setParameters) {
          await worker.setParameters({
            tessedit_char_whitelist: '0123456789',
            tessedit_pageseg_mode: '7'
          });
        }
      } catch {}
      return worker;
    })();
    return cachedTessWorkerPromise;
  }

  async function autoRecognizeCaptchaCode() {
    const overallTimeoutMs = 12000;
    const t0 = Date.now();
    let timeoutHandle = null;
    const overallTimer = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('ocr-overall-timeout')), overallTimeoutMs);
    });
    const work = (async () => {
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

      const pageImg = document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
      let img = pageImg;
      if (!pageImg) {
        try { console.warn('[bjtu] ocr: captcha img not found'); } catch {}
        return { code: '', confidence: null, imageSrc: '', source: '' };
      }
      try {
        const captchaUrl = new URL(String(pageImg.getAttribute('src') || pageImg.src || 'GetImg'), location.href);
        captchaUrl.searchParams.set('t', String(Date.now()));
        const res = await fetch(captchaUrl.toString(), {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
        });
        const blob = await res.blob();
        img = await loadImageFromBlob(blob);
        recognizedImgSrc = await blobToDataUrl(blob);
      } catch (e) {
        try { console.warn('[bjtu] ocr: captcha fetch/decode failed, fallback to page image:', String(e?.message || e)); } catch {}
      }
      if (img === pageImg) {
        const ok = await waitImageReady(img, 5000);
        if (!ok) {
          try { console.warn('[bjtu] ocr: captcha img not ready after 5s, naturalWidth=', img.naturalWidth, 'complete=', img.complete); } catch {}
          return { code: '', confidence: null, imageSrc: '', source: '' };
        }
        recognizedImgSrc = String(img?.src || '');
      }

      if ('TextDetector' in window) {
        try {
          const detector = new window.TextDetector();
          for (const cnv of [binarizeToCanvas(img, 160, 2), binarizeToCanvas(img, 160, 1)]) {
            try {
              const result = await detector.detect(cnv);
              const joined = (result || []).map(r => String(r.rawValue || '')).join('');
              c = String(joined || '').replace(/\D/g, '').slice(0, 4);
              if (/^\d{4}$/.test(c)) {
                return { code: c, confidence: null, imageSrc: recognizedImgSrc, source: 'text-detector' };
              }
            } catch {
              // try next canvas
            }
          }
        } catch (e) {
          try { console.warn('[bjtu] ocr: TextDetector path failed:', String(e?.message || e)); } catch {}
        }
      }

      let worker = null;
      try {
        worker = await getTessWorker();
      } catch (e) {
        try { console.warn('[bjtu] ocr: getTessWorker failed:', String(e?.message || e)); } catch {}
      }
      if (!worker) {
        try { console.warn('[bjtu] ocr: no tesseract worker available (Tesseract not loaded or createWorker failed)'); } catch {}
        return { code: '', confidence: null, imageSrc: recognizedImgSrc, source: '' };
      }

      const thresholds = [180, 160, 140, 120];
      for (const thr of thresholds) {
        let data;
        try {
          const canvas = binarizeToCanvas(img, thr, 2);
          data = await Promise.race([
            worker.recognize(canvas),
            new Promise((_, reject) => setTimeout(() => reject(new Error('ocr-recognize-timeout')), 6000))
          ]);
        } catch (e) {
          try { console.warn('[bjtu] ocr: tesseract recognize failed (thr=' + thr + '):', String(e?.message || e)); } catch {}
          continue;
        }
        const tessData = getTessResultData(data);
        const digits = String(tessData?.text || '').replace(/\D/g, '').slice(0, 4);
        if (/^\d{4}$/.test(digits)) {
          recognizedFrom = 'tesseract';
          recognizedConfidence = Number.isFinite(Number(tessData?.confidence))
            ? Math.max(0, Math.min(100, Number(tessData.confidence)))
            : null;
          return { code: digits, confidence: recognizedConfidence, imageSrc: recognizedImgSrc, source: recognizedFrom };
        }
      }
      // Scale-1 fallback
      try {
        const canvas = binarizeToCanvas(img, 160, 1);
        const data = await Promise.race([
          worker.recognize(canvas),
          new Promise((_, reject) => setTimeout(() => reject(new Error('ocr-recognize-timeout')), 6000))
        ]);
        const tessData = getTessResultData(data);
        const digits = String(tessData?.text || '').replace(/\D/g, '').slice(0, 4);
        if (/^\d{4}$/.test(digits)) {
          recognizedFrom = 'tesseract';
          recognizedConfidence = Number.isFinite(Number(tessData?.confidence))
            ? Math.max(0, Math.min(100, Number(tessData.confidence)))
            : null;
          return { code: digits, confidence: recognizedConfidence, imageSrc: recognizedImgSrc, source: recognizedFrom };
        }
      } catch (e) {
        try { console.warn('[bjtu] ocr: tesseract recognize failed (scale=1):', String(e?.message || e)); } catch {}
      }

      try { console.warn('[bjtu] ocr: no 4-digit match after all attempts, elapsed=', Date.now() - t0, 'ms'); } catch {}
      return { code: '', confidence: null, imageSrc: recognizedImgSrc, source: '' };
    })();
    try {
      return await Promise.race([work, overallTimer]);
    } catch (e) {
      try { console.warn('[bjtu] ocr: overall timeout, elapsed=', Date.now() - t0, 'ms, err=', String(e?.message || e)); } catch {}
      return { code: '', confidence: null, imageSrc: '', source: '' };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  let pendingSwitchTarget = '';
  try {
    const alertMsg = alertMsgAtStart;
    const lastDefaultTryUser = String(sessionStorage.getItem(LAST_DEFAULT_TRY_USER_KEY) || '').trim();
    if (alertMsg && isCaptchaErrorMessage(alertMsg)) {
      passcode = '';
      flowState.forceRetry = Number(flowState.retryCount || 0) < MAX_AUTO_RETRY_ROUNDS;
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
      try { sessionStorage.removeItem(LAST_DEFAULT_TRY_USER_KEY); } catch {}
      if (await startAuxiliaryLoginForPassword(originalRequestedUsername)) {
        return { ok: true, pendingSwitch: { targetUsername: originalRequestedUsername, ts: Date.now() } };
      }
    } else if (alertMsg && isCredentialErrorMessage(alertMsg)) {
      const current = String(flowState.currentUsername || username || '').trim();
      if (current === '8888') {
        username = '8888';
        passcode = '';
        passwordMd5 = md5('Bjtu@8888');
        flowState.currentUsername = '8888';
        flowState.useAux = true;
        flowState.forceRetry = Number(flowState.retryCount || 0) < MAX_AUTO_RETRY_ROUNDS;
      } else if (current) {
        const refreshed = await fetchAndSavePasswordMd5(current);
        if (refreshed && refreshed !== passwordMd5) {
          username = current;
          passwordMd5 = refreshed;
          passcode = '';
          flowState.currentUsername = current;
          flowState.passwordMd5 = refreshed;
          flowState.forceRetry = Number(flowState.retryCount || 0) < MAX_AUTO_RETRY_ROUNDS;
        } else if (originalRequestedUsername && current === originalRequestedUsername) {
          pendingSwitchTarget = originalRequestedUsername;
          if (await startAuxiliaryLoginForPassword(originalRequestedUsername)) {
            return { ok: true, pendingSwitch: { targetUsername: originalRequestedUsername, ts: Date.now() } };
          }
        } else {
          passwordMd5 = '';
          flowState.passwordMd5 = '';
          flowState.forceRetry = false;
          await saveLoginAccountPatch(current, { passwordMd5: '' });
        }
      }
    }
    writeFlowState(flowState);
  } catch {
    // ignore
  }

  let loginController = null;
  let cancelTriggered = false;

  if (!username || !passcode) {
    const mask = document.createElement('div');
    mask.id = '__bjtu_login_modal__';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2147483646;display:flex;align-items:center;justify-content:center;';
    let modalHtml = '';
    try {
      const res = await fetch(portalModalUrl || (hasChrome ? chrome.runtime.getURL('portal-modal.html') : ''), { cache: 'no-store' });
      modalHtml = await res.text();
    } catch (e) {
      return { ok: false, reason: 'modal-template-load-failed', message: String(e?.message || e) };
    }
    if (!modalHtml) return { ok: false, reason: 'modal-template-empty' };
    mask.innerHTML = modalHtml;
    root.appendChild(mask);

    const userInput = mask.querySelector('#__bjtu_u');
    const codeInput = mask.querySelector('#__bjtu_c');
    const btnClose = mask.querySelector('#__bjtu_close__');
    const statusEl = mask.querySelector('#__bjtu_status__');
    const histEl = mask.querySelector('#__bjtu_hist__');
    const quickEl = mask.querySelector('#__bjtu_quick__');
    const captchaImgEl = mask.querySelector('#__bjtu_modal_captcha__');
    if (captchaImgEl) captchaImgEl.addEventListener('click', () => { refreshCaptchaInPage(); statusEl.textContent = '验证码已刷新，正在识别…'; autoRecognizeAndFill(); });


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
        const badge = account.quickUsername ? '<span style="font-size:10px;color:#047857;background:#d1fae5;border:1px solid #a7f3d0;border-radius:999px;padding:1px 5px;margin-left:4px;">免验证码</span>' : '';
        btn.innerHTML = `<span style="font-weight:700;color:#0f172a;">${escapeHtml(title || account.userId)}${badge}</span><span style="font-size:11px;color:#64748b;">${escapeHtml(account.userId)}</span>`;
        btn.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid #dbeafe;background:#eff6ff;border-radius:8px;padding:7px 8px;margin-bottom:6px;cursor:pointer;text-align:left;';
        btn.addEventListener('click', async () => {
          userInput.value = account.userId;
          normalizeUserInput();
          username = String(userInput.value || '').trim();
          passwordMd5 = String(account.passwordMd5 || '').trim();
          statusEl.textContent = `已选择 ${title || account.userId}，正在登录…`;
          if (account.quickUsername) {
            statusEl.textContent = `已选择 ${title || account.userId}，正在免验证码登录…`;
            if (await tryQuickUsernameLogin(account.quickUsername)) {
              window.location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';
              return;
            }
            statusEl.textContent = '免验证码登录失败，改用验证码登录…';
          }
          doLoginSubmit().then((r) => { if (r && typeof gotResolve === 'function') gotResolve(r); });
        });
        quickEl.appendChild(btn);
      });
    };
    renderQuickLoginList();

    let tryCount = 0;
    const maxTry = MAX_AUTO_RETRY_ROUNDS;
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
      const srcBefore = String(img.src || '');
      try { img.click(); } catch {}
      // 仅当 click() 未能触发页面换图时，再用 ?t=Date.now() 强制刷新一次
      Promise.resolve().then(() => {
        try {
          if (String(img.src || '') === srcBefore) {
            const u = new URL(srcBefore, location.origin);
            u.searchParams.set('t', String(Date.now()));
            img.src = u.toString();
          }
        } catch {}
      });
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

    const autoRecognizeAndFill = async () => {
      if (!autoCaptchaEnabled) {
        if (statusEl) statusEl.textContent = '验证码识别已关闭，请手动输入';
        return;
      }
      let img = document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
      if (!img) {
        try {
          refreshCaptchaInPage();
          await new Promise((r) => setTimeout(r, 600));
        } catch {}
        img = document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
      }
      if (!img) {
        if (statusEl) statusEl.textContent = '当前验证码未显示，请先点击刷新验证码';
        return;
      }
      try {
        if (typeof waitImageReady === 'function') await waitImageReady(img, 5000);
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
      try {
        const ocrRes = await autoRecognizeCaptchaCode();
        const c = String(ocrRes?.code || '').trim();
        if (/^\d{4}$/.test(c)) {
          codeInput.value = c;
          if (statusEl) statusEl.textContent = `已自动识别验证码 ${c}，请确认后点击登录`;
          try { pushHist(String(ocrRes?.imageSrc || img?.src || ''), c); } catch {}
        } else {
          try { pushHist(String(img?.src || ''), '识别失败'); } catch {}
          if (statusEl) statusEl.textContent = '验证码识别失败，请手动输入';
        }
      } catch (e) {
        try { console.warn('[bjtu] autoRecognizeAndFill failed:', String(e?.message || e)); } catch {}
        if (statusEl) statusEl.textContent = '验证码识别出错，请手动输入';
      }
    };
    autoRecognizeAndFill();

    const doLoginSubmit = async () => {
      username = String(userInput.value || '').trim();
      passcode = String(codeInput.value || '').replace(/\D/g, '').slice(0, 4);
      if (!username) {
        statusEl.textContent = '请先输入账号';
        return;
      }
      try { sessionStorage.setItem(LAST_LOGIN_USERNAME_KEY, username); } catch {}

      statusEl.textContent = '正在验证账号…';
      statusEl.style.color = '#0f766e';
      statusEl.style.background = '#ecfeff';
      statusEl.style.borderColor = '#a5f3fc';

      const STUCK_TIMEOUT_MS = 15000;
      const stuckTimer = setTimeout(() => {
        statusEl.textContent = '登录请求处理超时，请重试';
        statusEl.style.color = '#dc2626';
      }, STUCK_TIMEOUT_MS);

      try {
        try {
          const u = encodeURIComponent(username);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          let checkRes, checkData;
          try {
            checkRes = await fetch(`/ve/back/coursePlatform/coursePlatform.shtml?method=getUserInfo&userId=${u}`, { signal: controller.signal });
            const bodyText = await Promise.race([
              checkRes.text(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('getUserInfo-body-timeout')), 5000))
            ]);
            const s = String(bodyText || '{}').trim();
            checkData = JSON.parse(s.startsWith('{}') ? s.slice(2) : s);
          } finally {
            clearTimeout(timeoutId);
          }
          if (checkData && String(checkData.STATUS) === '4') {
            statusEl.textContent = '该账号无效或不存在，已回退旧账号';
            statusEl.style.color = '#dc2626';
            statusEl.style.background = '#fef2f2';
            statusEl.style.borderColor = '#fecaca';
            username = String(context?.username || existingUser?.value || '').trim();
            userInput.value = username;
            try { sessionStorage.setItem(LAST_LOGIN_USERNAME_KEY, username); } catch {}
            return;
          }
        } catch (e) {
          try { console.warn('[bjtu] getUserInfo check failed:', String(e?.message || e)); } catch {}
        }

        if (!passcode) {
          if (!autoCaptchaEnabled) {
            statusEl.textContent = '验证码识别已关闭，请手动输入';
            return;
          }
          const baseRetry = Math.max(0, Number(flowState.retryCount || 0));
          while (tryCount < maxTry && !passcode) {
            tryCount++;
            const currentRound = Math.min(maxTry, baseRetry + tryCount);
            statusEl.textContent = `正在识别验证码 (${currentRound}/${maxTry})…`;
            const img = document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]');
            if (!img) {
              statusEl.textContent = '当前验证码未显示，请先点击刷新验证码';
              return;
            }
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
              pushHist(lastRecognizedImageSrc || img?.src || '', c);
              break;
            }
            pushHist(img?.src || '', '识别失败');
            if (tryCount < maxTry) {
              statusEl.textContent = `验证码识别失败，正在刷新 (${tryCount}/${maxTry})…`;
              refreshCaptchaInPage();
              await waitImageReady(img, 2800);
              await new Promise((r) => setTimeout(r, 180));
            }
          }
        }

        if (!passcode) {
          statusEl.textContent = '验证码识别失败，请手动输入';
          return;
        }

        statusEl.textContent = '登录中…';
        return {
          u: username,
          c: passcode,
          recognizedCode: lastRecognizedCode || passcode,
          recognizedConfidence: lastRecognizedConfidence,
          recognizedImageSrc: lastRecognizedImageSrc || String(document.querySelector('img[src*="GetImg"], img#imgcode, img#passcodeImg, img[alt*="验证码"]')?.src || '')
        };
      } finally {
        clearTimeout(stuckTimer);
      }
    };

    const handleEnter = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (e.target && typeof e.target.blur === 'function') {
          try { e.target.blur(); } catch {}
        }
        doLoginSubmit().then((result) => { if (result) gotResolve(result); });
      }
    };
    userInput.addEventListener('keydown', handleEnter);
    codeInput.addEventListener('keydown', handleEnter);

    let gotResolve = null;
    const got = await new Promise((resolve) => {
      gotResolve = resolve;
      mask.addEventListener('click', (e) => {
        if (e.target === mask) btnClose.click();
      });
      btnClose.addEventListener('click', () => {
        flowState.forceRetry = false;
        writeFlowState(flowState);
        resolve({ closed: true });
      });

      const hintLogin = mask.querySelector('#__bjtu_hint_login__');
      if (hintLogin) {
        hintLogin.addEventListener('click', (e) => {
          e.preventDefault();
          doLoginSubmit().then((result) => { if (result) resolve(result); });
        });
      }
      const hintRefresh = mask.querySelector('#__bjtu_hint_refresh__');
      if (hintRefresh) {
        hintRefresh.addEventListener('click', (e) => {
          e.preventDefault();
          refreshCaptchaInPage();
        });
      }

      if (sessionEnded && statusEl) {
        statusEl.textContent = '会话已结束，请重新登录';
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
    amask.id = '__bjtu_auto_login_overlay__';
    amask.style.cssText = 'position:fixed;inset:0;background:transparent;z-index:2147483647;display:flex;align-items:center;justify-content:center;pointer-events:none;';
    amask.innerHTML = `
      <div style="width:min(520px,88vw);background:#fff;border:1px solid #e8edf5;border-radius:12px;box-shadow:0 18px 42px rgba(0,0,0,.25);padding:14px;pointer-events:auto;">
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
          <button id="__bjtu_cancel_submit__" style="background:#dc2626;color:#fff;border:0;border-radius:6px;padding:6px 18px;font-size:13px;font-weight:600;cursor:pointer;">取消</button>
        </div>
        <style>@keyframes __bjtu_spin{to{transform:rotate(360deg)}}</style>
      </div>
    `;
    root.appendChild(amask);
    const btnCancel = amask.querySelector('#__bjtu_cancel_submit__');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        if (cancelTriggered) return;
        cancelTriggered = true;
        flowState.forceRetry = false;
        writeFlowState(flowState);
        try { sessionStorage.setItem(SUPPRESS_AUTO_START_ONCE_KEY, '1'); } catch {}
        try { amask.remove(); } catch {}
        if (loginController) {
          try { loginController.abort(); } catch {}
        }
        location.href = 'http://123.121.147.7:88/ve/Exit_2.jsp';
      }, { once: true });
    }
    await new Promise(r => setTimeout(r, 700));
    if (cancelTriggered) return { ok: false, reason: 'cancelled' };
  }

      const cleanupOverlays = () => {
        try { const m = document.getElementById('__bjtu_login_modal__'); if (m) m.remove(); } catch {}
        try { const a = amask; if (a && a.remove) a.remove(); } catch {}
        try { window.removeEventListener('beforeunload', cleanupOverlays); } catch {}
        try { window.removeEventListener('pagehide', cleanupOverlays); } catch {}
      };
      try { window.addEventListener('beforeunload', cleanupOverlays, { once: true }); } catch {}
      try { window.addEventListener('pagehide', cleanupOverlays, { once: true }); } catch {}

  if (!username) return { ok: false, reason: 'empty-username' };
  if (!passcode) {
    if (autoCaptchaEnabled) {
      const ocrRes = await autoRecognizeCaptchaCode();
      passcode = String(ocrRes?.code || '').trim();
    }
  }
  if (!passcode) return { ok: false, reason: 'empty-passcode' };
  if (!passwordMd5) {
    passwordMd5 = String(findAccountRecord(username)?.passwordMd5 || '').trim();
  }
  if (!passwordMd5) {
    passwordMd5 = await fetchAndSavePasswordMd5(username);
  }
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
  if (username && passwordMd5 && username !== '8888') {
    await saveLoginAccountPatch(username, { passwordMd5 });
  }

  await new Promise(r => setTimeout(r, 150));

  loginController = new AbortController();
  const params = new URLSearchParams();
  params.append('login', 'main_2');
  params.append('qxkt_type', '');
  params.append('qxkt_url', '');
  params.append('username', username);
  params.append('password', passwordMd5);
  params.append('passcode', passcode);
  try { if (typeof cleanupOverlays === 'function') cleanupOverlays(); } catch {}
  let loginRes = null;
  try {
    loginRes = await fetch('http://123.121.147.7:88/ve/s.shtml', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      credentials: 'include',
      signal: loginController.signal,
      redirect: 'follow'
    });
  } catch (e) {
    if (cancelTriggered || (loginController && loginController.signal.aborted)) {
      return { ok: false, reason: 'cancelled' };
    }
    try { console.error('[bjtu] login fetch failed:', e); } catch {}
    throw e;
  }
  if (cancelTriggered) return { ok: false, reason: 'cancelled' };
  try {
    const finalUrl = String(loginRes?.url || '').trim();
    const looksLikeLoginPage = /Login_2\.jsp|Timeout\.jsp|s\.shtml/i.test(finalUrl);
    if (finalUrl && !looksLikeLoginPage) {
      location.href = finalUrl;
    } else {
      location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';
    }
  } catch {
    location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';
  }

  flowState.currentUsername = username;
  if (username === '8888') flowState.useAux = true;
  flowState.retryCount = Math.min(MAX_AUTO_RETRY_ROUNDS, Number(flowState.retryCount || 0) + 1);
  // record timestamp of this submit attempt so subsequent loads can decide recency
  flowState.lastAttemptTs = Date.now();
  flowState.forceRetry = flowState.retryCount < MAX_AUTO_RETRY_ROUNDS;
  writeFlowState(flowState);

  return {
    ok: true,
    pendingSwitch: pendingSwitchTarget
      ? { targetUsername: pendingSwitchTarget, ts: Date.now() }
      : null
  };
}
