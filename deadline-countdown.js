(function initDeadlineCountdown(global) {
  'use strict';

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
    return `<span class="deadline-countdown-label">剩</span><span class="seven-seg-display" role="img" aria-label="${escapeAttribute(value)}">${value.split('').map(renderSevenSegmentChar).join('')}</span>`;
  }

  function updateAllCountdowns() {
    document.querySelectorAll('.deadline-countdown').forEach((span) => {
      const deadline = span.dataset.deadline;
      if (!deadline) return;
      const timestamp = typeof global.parseDeadlineToTs === 'function'
        ? global.parseDeadlineToTs(deadline)
        : Number(deadline || 0);
      if (!timestamp) return;
      const difference = timestamp - Date.now();
      if (difference <= 0) {
        if (span.innerHTML !== '') {
          span.innerHTML = '';
          span.style.fontFamily = 'inherit';
          span.style.fontSize = 'inherit';
        }
        span.style.display = 'none';
        return;
      }

      span.style.display = '';
      const days = Math.floor(difference / 86400000);
      const hours = Math.floor(difference / 3600000) % 24;
      const minutes = Math.floor(difference / 60000) % 60;
      const seconds = Math.floor(difference / 1000) % 60;
      const pad = (value) => String(value).padStart(2, '0');
      const nextHtml = renderSevenSegmentTime(`${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
      if (span.innerHTML !== nextHtml) span.innerHTML = nextHtml;
    });
  }

  global.renderSevenSegmentTime = renderSevenSegmentTime;
  global.updateAllCountdowns = updateAllCountdowns;
  if (global.__deadlineCountdownTimer) clearInterval(global.__deadlineCountdownTimer);
  global.__deadlineCountdownTimer = setInterval(updateAllCountdowns, 1000);
})(globalThis);
