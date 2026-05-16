async function portalLoginAutoLoginInjected(context) {
  const root = document.body || document.documentElement;
  if (!root) return { ok: false, reason: 'no-root' };

  const old = document.getElementById('__bjtu_login_modal__');
  if (old) old.remove();

  let username = String(context?.username || '').trim();
  const fromExtension = !!context?.fromExtension;
  const accountHistory = (Array.isArray(context?.accountHistory) ? context.accountHistory : [])
    .map((it) => ({
      userId: String(it?.userId || '').trim(),
      userName: String(it?.userName || '').trim(),
      roleName: String(it?.roleName || '').trim()
    }))
    .filter((it) => it.userId);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function isLikelyLoginPageHtml(html, resUrl = '') {
    const t = String(html || '');
    const u = String(resUrl || '');
    if (u.includes('/ve/Login_2.jsp')) return true;
    if (t.includes('login-page')) return true;
    if (/name=["']username["']/i.test(t)) return true;
    if (t.includes('登录系统')) return true;
    return false;
  }

  function isLoginSuccess(text) {
    return String(text || '').includes('index.shtml?method=index&type=qxkt');
  }

  const pageHtmlAtStart = document.documentElement?.outerHTML || '';

  if (!isLikelyLoginPageHtml(pageHtmlAtStart, location.href)) {
    return { ok: true, reason: 'non-login-page' };
  }

  // If username is provided, attempt automatic login
  if (username) {
    try {
      const loginUrl = `/ve/s.shtml?loginType=2&login=main_2&username=${encodeURIComponent(username)}`;
      const res = await fetch(loginUrl, { credentials: 'include' });
      const text = await res.text();
      if (isLoginSuccess(text)) {
        window.location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';
        return { ok: true };
      }
    } catch {
      // Fall through to manual input
    }
  }

  // Show simple login modal
  const mask = document.createElement('div');
  mask.id = '__bjtu_login_modal__';
  mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2147483646;display:flex;align-items:center;justify-content:center;';
  mask.innerHTML = `
    <div style="width:min(760px,92vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;border:1px solid #e8edf5;border-radius:14px;box-shadow:0 18px 42px rgba(0,0,0,.25);padding:14px 14px 12px;pointer-events:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-shrink:0;">
        <div style="font-size:16px;font-weight:700;color:#1f2937;">课程助手登录</div>
        <button id="__bjtu_close__" aria-label="关闭" title="关闭" style="border:1px solid #cbd5e1;background:#fff;border-radius:999px;width:24px;height:24px;line-height:20px;font-size:16px;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;">×</button>
      </div>
      <div style="margin-top:10px;">
        <input id="__bjtu_u" placeholder="账号" style="width:100%;padding:10px 12px;box-sizing:border-box;margin-bottom:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
        <div id="__bjtu_quick__" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(132px, 1fr));gap:8px;"></div>
      </div>
    </div>
  `;
  root.appendChild(mask);

  const userInput = mask.querySelector('#__bjtu_u');
  const btnClose = mask.querySelector('#__bjtu_close__');
  const quickEl = mask.querySelector('#__bjtu_quick__');

  const existingUser = document.querySelector('input[name="username"], input#username, input[name="userId"]');
  userInput.value = String(username || existingUser?.value || '').trim();
  userInput.setAttribute('inputmode', 'numeric');
  userInput.setAttribute('pattern', '[0-9]*');
  const normalizeUserInput = () => {
    const normalized = String(userInput.value || '').replace(/\D/g, '');
    if (userInput.value !== normalized) userInput.value = normalized;
  };
  normalizeUserInput();
  userInput.addEventListener('input', normalizeUserInput);

  const renderQuickLoginList = () => {
    if (!quickEl) return;
    quickEl.innerHTML = '';
    if (!accountHistory.length) {
      const empty = document.createElement('div');
      empty.textContent = '暂无登录记录';
      empty.style.cssText = 'grid-column:1/-1;font-size:12px;color:#94a3b8;line-height:1.6;';
      quickEl.appendChild(empty);
      return;
    }
    accountHistory.forEach((account) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const title = `${account.roleName || ''}${account.userName || account.userId}`.trim();
      btn.innerHTML = `<span style="font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(title || account.userId)}</span><span style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(account.userId)}</span>`;
      btn.style.cssText = 'width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid #dbeafe;background:#eff6ff;border-radius:10px;padding:8px 10px;cursor:pointer;text-align:left;min-height:46px;justify-content:center;';
      btn.addEventListener('click', () => {
        if (finish) finish({ ok: true, username: account.userId, jumpUrl: `/ve/s.shtml?loginType=2&login=main_2&username=${encodeURIComponent(account.userId)}` });
      });
      quickEl.appendChild(btn);
    });
  };
  renderQuickLoginList();

  let finish = null;
  const got = await new Promise((resolve) => {
    finish = resolve;
    mask.addEventListener('click', (e) => {
      if (e.target === mask) btnClose.click();
    });
    btnClose.addEventListener('click', () => {
      resolve({ closed: true });
    });
    const handleEnter = (e) => {
      if (e.key === 'Enter') {
        const uid = String(userInput.value || '').trim();
        if (!uid) return;
        if (finish) finish({ ok: true, username: uid, jumpUrl: `/ve/s.shtml?loginType=2&login=main_2&username=${encodeURIComponent(uid)}` });
      }
    };
    userInput.addEventListener('keydown', handleEnter);
  });

  if (got?.closed) {
    mask.remove();
    return { ok: false, reason: 'modal-closed' };
  }

  mask.remove();

  if (got?.jumpUrl) {
    window.location.href = got.jumpUrl;
    return { ok: true };
  }

  // Redirect to main page after successful login
  window.location.href = 'http://123.121.147.7:88/ve/back/core/main/index.shtml?method=index&type=qxkt';

  return { ok: true };
}
