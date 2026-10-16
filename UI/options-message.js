(function initOptionsMessage(global) {
  'use strict';

  const states = new WeakMap();

  function cancelTimer(state) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  function hide(message, state) {
    cancelTimer(state);
    message.classList.remove('show');
  }

  function scheduleHide(message, state) {
    cancelTimer(state);
    if (!state.persistent && !state.hovered) {
      state.timer = setTimeout(() => hide(message, state), state.delay);
    }
  }

  function show(text, ok = true, options = {}) {
    const message = document.getElementById('msg');
    if (!(message instanceof HTMLElement)) return;
    let state = states.get(message);
    if (!state) {
      state = { timer: null, hovered: false };
      states.set(message, state);
      message.title = '点击复制通知内容并关闭';
      message.setAttribute('role', 'status');
      message.setAttribute('aria-live', 'polite');
      message.addEventListener('click', () => {
        hide(message, state);
        if (state.text) {
          try { global.navigator.clipboard.writeText(state.text).catch(() => {}); } catch {}
        }
      });
      message.addEventListener('mouseenter', () => {
        state.hovered = true;
        cancelTimer(state);
      });
      message.addEventListener('mouseleave', () => {
        state.hovered = false;
        scheduleHide(message, state);
      });
    }
    cancelTimer(state);
    state.text = String(text || '');
    state.persistent = options.persistent === true;
    state.delay = ok ? 1800 : 3200;
    message.textContent = state.text;
    const type = options.type === 'info' ? 'info' : (ok ? 'ok' : 'err');
    message.className = `${type} show`;
    if (options.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'toast-spinner';
      message.appendChild(spinner);
    }
    scheduleHide(message, state);
  }

  global.BjtuOptionsMessage = { show };
})(globalThis);
