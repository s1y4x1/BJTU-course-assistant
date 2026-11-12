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

  function countdownText(deadline, now = Date.now()) {
    if (countdownStyle === 'none' || !deadline) return '';
    const timestamp = typeof global.parseDeadlineToTs === 'function'
      ? global.parseDeadlineToTs(deadline)
      : Number(deadline || 0);
    const difference = timestamp - now;
    if (!Number.isFinite(difference) || difference <= 0) return '';
    const days = Math.floor(difference / 86400000);
    const hours = Math.floor(difference / 3600000) % 24;
    const minutes = Math.floor(difference / 60000) % 60;
    const seconds = Math.floor(difference / 1000) % 60;
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  function renderCountdownHtml(deadline) {
    const text = countdownText(deadline);
    const content = text ? renderCountdownTime(text) : '';
    const prefix = content ? '<span class="deadline-countdown-prefix">剩</span>' : '';
    const normalClass = countdownStyle === 'normal' ? ' deadline-countdown--normal' : '';
    return `${prefix}<span class="deadline-countdown${normalClass}" data-deadline="${escapeAttribute(deadline)}"${content ? '' : ' style="display:none"'}>${content}</span>`;
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

  function updateDisplay(span, text, normal) {
    const display = span.firstElementChild;
    const previous = display?.getAttribute('aria-label') || '';
    const expectedClass = normal ? 'deadline-countdown-normal' : 'seven-seg-display';
    if (!display?.classList.contains(expectedClass) || (!normal && display.children.length !== text.length)) {
      span.innerHTML = renderCountdownTime(text);
      return;
    }
    if (previous === text) return;
    display.setAttribute('aria-label',text);
    if (normal) {
      if (display.firstChild?.nodeType === 3) display.firstChild.data = text;
      else display.textContent = text;
      return;
    }
    for (let i = 0; i < text.length; i++) {
      if (text[i] === previous[i] || text[i] === ':') continue;
      const active = segmentMap[text[i]], old = segmentMap[previous[i]] || '';
      const segments = display.children[i].children;
      for (let j = 0; j < segments.length; j++) {
        const part = String.fromCharCode(97 + j);
        const on = active.includes(part);
        if (on !== old.includes(part)) segments[j].classList.toggle('on',on);
      }
    }
  }

  function updateAllCountdowns(root = document) {
    const now = Date.now();
    root.querySelectorAll('.deadline-countdown').forEach((span) => {
      const normalStyle = countdownStyle === 'normal';
      if (span.classList.contains('deadline-countdown--normal') !== normalStyle) {
        span.classList.toggle('deadline-countdown--normal', normalStyle);
      }
      const text = countdownText(span.dataset.deadline,now);
      if (!text) {
        syncCountdownPrefix(span, false);
        if (span.firstChild) span.replaceChildren();
        if (span.style.display !== 'none') span.style.display = 'none';
        return;
      }

      if (span.style.display) span.style.display = '';
      syncCountdownPrefix(span, true);
      updateDisplay(span,text,normalStyle);
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
  global.renderDeadlineCountdownHtml = renderCountdownHtml;
  global.updateAllCountdowns = updateAllCountdowns;
  if (global.__deadlineCountdownTimer) clearInterval(global.__deadlineCountdownTimer);
  global.__deadlineCountdownTimer = setInterval(() => { if (!document.hidden) updateAllCountdowns(); },1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateAllCountdowns(); });
  void loadStyle();
})(globalThis);
