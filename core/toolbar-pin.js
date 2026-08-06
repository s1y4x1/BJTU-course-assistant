(function initToolbarPinReminder() {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome?.runtime?.id) return;

  const REMINDER_KEY = 'toolbarPinReminderEnabled';
  const isOnboarding = new URLSearchParams(String(location.search || '')).get('onboardPin') === '1';
  const MODAL_ID = '__bjtu_toolbar_pin_modal__';
  let pinPollTimer = 0;

  async function queryPinnedState() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_ACTION_PINNED_STATE' });
      return { ok: !!res?.ok, supported: !!res?.supported, pinned: !!res?.pinned };
    } catch {
      return { ok: false, supported: false, pinned: false };
    }
  }

  function openExtensionsPage() {
    const isEdge = /Edg\//i.test(String(navigator.userAgent || ''));
    const scheme = isEdge ? 'edge://' : 'chrome://';
    chrome.tabs.create({ url: `${scheme}extensions/?id=${chrome.runtime.id}` }).catch(() => {
      chrome.tabs.create({ url: 'about:extensions' }).catch(() => {});
    });
  }

  function showToast(message, type = 'success', duration = 3000) {
    try {
      if (typeof globalThis.showToast === 'function') {
        globalThis.showToast(message, type, duration);
      } else if (document.getElementById('toast-container')) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = String(message || '');
        toast.style.whiteSpace = 'pre-line';
        container.appendChild(toast);
        if (duration > 0) {
          setTimeout(() => {
            toast.style.animation = 'fadeOutUp 0.25s ease-in forwards';
            toast.addEventListener('animationend', () => toast.remove());
          }, duration);
        }
      }
    } catch {
      // ignore
    }
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'version-modal-mask toolbar-pin-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="version-modal-card toolbar-pin-card">
        <div class="version-modal-header">
          <div id="${MODAL_ID}-title" class="version-download-title"></div>
          <button type="button" class="btn version-close-btn ${MODAL_ID}-close" title="关闭" aria-label="关闭">×</button>
        </div>
        <div class="toolbar-pin-body">
          <ol class="toolbar-pin-steps">
            <li>点击浏览器右上角的<b>拼图图标</b>（扩展程序菜单）。</li>
            <li>在列表中找到「BJTU 课程助手」。</li>
            <li>点击其右侧的<b>图钉图标</b>，将其固定到工具栏。</li>
          </ol>
          <div class="toolbar-pin-status"></div>
        </div>
        <div class="toolbar-pin-actions">
          <button type="button" class="btn toolbar-pin-goto">去固定</button>
          <button type="button" class="btn toolbar-pin-later">稍后再说</button>
          <button type="button" class="btn toolbar-pin-never">不再提醒</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector(`.${MODAL_ID}-close`)?.addEventListener('click', () => closeModal());
    modal.querySelector('.toolbar-pin-goto')?.addEventListener('click', () => {
      openExtensionsPage();
      setPinStatus('固定后将自动关闭本提示。');
    });
    modal.querySelector('.toolbar-pin-later')?.addEventListener('click', () => closeModal());
    modal.querySelector('.toolbar-pin-never')?.addEventListener('click', async () => {
      try { await chrome.storage.local.set({ [REMINDER_KEY]: false }); } catch {}
      closeModal();
      showToast('已关闭提醒，可在扩展选项中重新开启', 'info', 3000);
    });
    return modal;
  }

  function setPinStatus(text) {
    const modal = document.getElementById(MODAL_ID);
    const status = modal?.querySelector('.toolbar-pin-status');
    if (status instanceof HTMLElement) status.textContent = String(text || '');
  }

  function startPinWatch(onPinned) {
    stopPinWatch();
    pinPollTimer = setInterval(async () => {
      const state = await queryPinnedState();
      if (state.pinned) {
        stopPinWatch();
        onPinned?.();
      }
    }, 2000);
  }

  function stopPinWatch() {
    if (pinPollTimer) {
      clearInterval(pinPollTimer);
      pinPollTimer = 0;
    }
  }

  function openModal({ title, showNever = true }) {
    const modal = ensureModal();
    modal.querySelector(`#${MODAL_ID}-title`).textContent = String(title || '将扩展固定到浏览器工具栏');
    const neverBtn = modal.querySelector('.toolbar-pin-never');
    if (neverBtn) neverBtn.style.display = showNever ? '' : 'none';
    modal.style.display = 'flex';
    setPinStatus('');
    startPinWatch(async () => {
      closeModal();
      showToast('已固定到工具栏 ✅');
    });
  }

  function closeModal() {
    stopPinWatch();
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
  }

  async function run() {
    try {
      await globalThis.__bjtuAppReadyCheck?.() || undefined;
    } catch {
      // ignore
    }
    if (isOnboarding) {
      // 首次安装引导：无论如何都弹出指导页面
      await new Promise((resolve) => setTimeout(resolve, 800));
      openModal({ title: '将扩展固定到浏览器工具栏', showNever: false });
      return;
    }
    const stored = await chrome.storage.local.get([REMINDER_KEY]).catch(() => ({}));
    if (stored[REMINDER_KEY] === false) return;
    const state = await queryPinnedState();
    if (!state.supported || state.pinned) return;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    openModal({ title: '扩展尚未固定到工具栏', showNever: true });
  }

  window.addEventListener('beforeunload', stopPinWatch);
  document.addEventListener('DOMContentLoaded', () => { void run(); });
  if (document.readyState !== 'loading') void run();
})();
