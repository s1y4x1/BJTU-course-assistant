(function initDeadlineCountdown(global) {
  'use strict';

  const STYLE_STORAGE_KEY = 'deadlineCountdownStyle';
  const DEFAULT_STYLE = 'seven-seg';
  let countdownStyle = DEFAULT_STYLE;

  const segmentMap = {
    0: 'abcdef',
    1: 'bc',
    2: 'abged',
    3: 'abgcd',
    4: 'fgbc',
    5: 'afgcd',
    6: 'afgcde',
    7: 'abc',
    8: 'abcdefg',
    9: 'abfgcd'
  };

  function escapeAttribute(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderSevenSegmentChar(char) {
    if (char === ':') return '<span class="seven-seg-colon" aria-hidden="true"></span>';
    const active = segmentMap[char] || '';
    const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    return `<span class="seven-seg-digit" aria-hidden="true">${segments.map((segment) => `<span class="seg seg-${segment}${active.includes(segment) ? ' on' : ''}"></span>`).join('')}</span>`;
  }

  function renderSevenSegmentTime(text) {
    const value = String(text || '');
    return `<span class="seven-seg-display" role="img" aria-label="${escapeAttribute(value)}">${value.split('').map(renderSevenSegmentChar).join('')}</span>`;
  }

  function normalizeStyle(value) {
    return ['normal', 'seven-seg', 'none'].includes(value) ? value : DEFAULT_STYLE;
  }

  function renderNormalTime(text) {
    const value = String(text || '');
    return `<span class="deadline-countdown-normal" role="timer" aria-label="${escapeAttribute(value)}">${escapeAttribute(value)}</span>`;
  }

  function renderCountdownTime(text) {
    return countdownStyle === 'normal' ? renderNormalTime(text) : renderSevenSegmentTime(text);
  }

  function syncCountdownPrefix(span, visible) {
    const previous = span.previousElementSibling;
    const existing = previous?.classList?.contains('deadline-countdown-prefix') ? previous : null;
    if (!visible) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const prefix = document.createElement('span');
    prefix.className = 'deadline-countdown-prefix';
    prefix.textContent = '剩';
    span.before(prefix);
  }

  function updateAllCountdowns() {
    document.querySelectorAll('.deadline-countdown').forEach((span) => {
      const normalStyle = countdownStyle === 'normal';
      span.classList.toggle('deadline-countdown--normal', normalStyle);
      if (countdownStyle === 'none') {
        syncCountdownPrefix(span, false);
        span.innerHTML = '';
        span.style.display = 'none';
        return;
      }
      const deadline = span.dataset.deadline;
      if (!deadline) {
        syncCountdownPrefix(span, false);
        return;
      }
      const timestamp = typeof global.parseDeadlineToTs === 'function'
        ? global.parseDeadlineToTs(deadline)
        : Number(deadline || 0);
      if (!timestamp) {
        syncCountdownPrefix(span, false);
        return;
      }
      const difference = timestamp - Date.now();
      if (difference <= 0) {
        syncCountdownPrefix(span, false);
        if (span.innerHTML !== '') {
          span.innerHTML = '';
          span.style.fontFamily = 'inherit';
          span.style.fontSize = 'inherit';
        }
        span.style.display = 'none';
        return;
      }

      span.style.display = '';
      syncCountdownPrefix(span, true);
      const days = Math.floor(difference / 86400000);
      const hours = Math.floor(difference / 3600000) % 24;
      const minutes = Math.floor(difference / 60000) % 60;
      const seconds = Math.floor(difference / 1000) % 60;
      const pad = (value) => String(value).padStart(2, '0');
      const nextHtml = renderCountdownTime(`${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
      if (span.innerHTML !== nextHtml) span.innerHTML = nextHtml;
    });
  }

  async function loadStyle() {
    try {
      const stored = await chrome.storage.local.get([STYLE_STORAGE_KEY]);
      countdownStyle = normalizeStyle(stored?.[STYLE_STORAGE_KEY]);
    } catch {
      countdownStyle = DEFAULT_STYLE;
    }
    updateAllCountdowns();
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[STYLE_STORAGE_KEY]) return;
    countdownStyle = normalizeStyle(changes[STYLE_STORAGE_KEY].newValue);
    updateAllCountdowns();
  });

  global.renderSevenSegmentTime = renderSevenSegmentTime;
  global.renderDeadlineCountdownTime = renderCountdownTime;
  global.updateAllCountdowns = updateAllCountdowns;
  if (global.__deadlineCountdownTimer) clearInterval(global.__deadlineCountdownTimer);
  global.__deadlineCountdownTimer = setInterval(updateAllCountdowns, 1000);
  void loadStyle();
})(globalThis);
