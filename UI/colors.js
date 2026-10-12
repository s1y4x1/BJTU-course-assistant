(function initBjtuColors(global) {
  'use strict';

  const storageKey = 'colorSettings';
  const gradientKey = 'homeworkDeadlineGradientEnabled';
  const marqueeKey = 'homeworkMarqueeEnabled';
  const defaults = Object.freeze({
    button: '#1976d2', courseCard: '#ffffff', fileCard: '#ffffff',
    pendingCard: '#fff5e6', overdueCard: '#ffe6e6', doneCard: '#e6ffe6',
    resource: '#1e3a8a', replay: '#9c27b0', assessment: '#0f766e', archive: '#0369a1',
    copy: '#45a049', download: '#1e3a8a', teacherPendingCard: '#dbeafe', teacherOverdueCard: '#ede9fe'
  });
  const labels = {
    button: '操作按钮', courseCard: '课程卡片', fileCard: '文件卡片',
    pendingCard: '未交作业', overdueCard: '逾期作业', doneCard: '已交作业',
    resource: '资源下载', replay: '回放下载', assessment: '课程考核记录表下载', archive: '归档下载',
    copy: '复制', download: '下载', teacherPendingCard: '未了作业（教师）', teacherOverdueCard: '过时作业（教师）'
  };
  let settings = {};
  let gradientEnabled = true;
  let marqueeEnabled = true;
  const reportedExpiredCards = new WeakSet();

  function normalize(value) {
    return Object.fromEntries(Object.keys(defaults)
      .filter((key) => /^#[0-9a-f]{6}$/i.test(String(value?.[key] || '')))
      .map((key) => [key, value[key].toLowerCase()]));
  }

  function interpolate(from, to, weight) {
    const channels = [1, 3, 5].map((offset) => {
      const a = parseInt(from.slice(offset, offset + 2), 16);
      const b = parseInt(to.slice(offset, offset + 2), 16);
      return Math.round(a + (b - a) * weight).toString(16).padStart(2, '0');
    });
    return `#${channels.join('')}`;
  }

  function deadlineTime(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return NaN;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const n = Number(raw);
      return n > 0 ? (n < 1e12 ? n * 1000 : n) : NaN;
    }
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : Date.parse(raw.replace(/-/g, '/'));
  }

  function urgency(deadline, now = Date.now()) {
    const time = deadlineTime(deadline);
    return Number.isFinite(time) ? Math.pow(2, -Math.max(0, time - now) / 86400000) : 0;
  }

  function foreground(color) {
    const values = [1, 3, 5].map((offset) => {
      const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    const luminance = values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    return luminance > 0.179 ? '#111827' : '#f8fafc';
  }

  function setProperty(element, name, value) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }

  function darkVersion(color) {
    // HSL: keep hue and saturation, reduce only lightness (YUV clipping can shift hue).
    const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
    const min = Math.min(...channels);
    const max = Math.max(...channels);
    const range = max - min;
    const lightness = (max + min) / 2;
    const saturation = range ? range / (1 - Math.abs(2 * lightness - 1)) : 0;
    const darkLightness = Math.min(lightness, 0.24);
    const chroma = (1 - Math.abs(2 * darkLightness - 1)) * saturation;
    const offset = darkLightness - chroma / 2;
    return '#' + channels.map((value) => Math.round(255 * (range ? offset + chroma * (value - min) / range : darkLightness)).toString(16).padStart(2, '0')).join('');
  }

  function refreshCards(cards = document.querySelectorAll('.hw-card-item')) {
    const now = Date.now();
    const expiredCourseIds = new Set();
    cards.forEach((card) => {
      const done = card.dataset.homeworkDone === '1';
      const teacher = card.dataset.homeworkTeacher === '1';
      const time = deadlineTime(card.dataset.homeworkDeadline);
      const expired = !done && Number.isFinite(time) && time <= now;
      const overdue = card.dataset.homeworkOverdue === '1' || expired;
      if (expired && card.dataset.homeworkOverdue !== '1' && !reportedExpiredCards.has(card)) {
        reportedExpiredCards.add(card);
        const courseId = card.closest('.file-item[data-course-rankable="1"]')?.dataset.courseId;
        if (courseId) expiredCourseIds.add(courseId);
      }
      const active = gradientEnabled && !teacher && card.dataset.homeworkGradient !== '0'
        && !done && !overdue && Number.isFinite(time) && time > now;
      const key = teacher ? (overdue ? 'teacherOverdueCard' : 'teacherPendingCard')
        : done ? 'doneCard' : overdue ? 'overdueCard' : 'pendingCard';
      const c = !teacher && !done && !overdue ? urgency(card.dataset.homeworkDeadline, now) : 0;
      const effects = marqueeEnabled && !teacher && !done && !overdue && Number.isFinite(time) && time > now;
      const period = effects ? Math.log2(1 + (time - now) / 3600000) : 0;
      const background = active
        ? interpolate(settings.pendingCard || defaults.pendingCard, settings.overdueCard || defaults.overdueCard, c)
        : settings[key] || defaults[key];
      const action = darkVersion(background);
      setProperty(card, '--homework-card-background', background);
      setProperty(card, '--homework-card-action', action);
      setProperty(card, '--homework-card-title', foreground(background) === '#111827' ? action : '#f8fafc');
      setProperty(card, '--homework-card-foreground', foreground(background));
      setProperty(card, '--homework-card-border', action);
      setProperty(card, '--homework-card-breathe-background', interpolate(background, action, 0.025 + 0.055 * c));
      setProperty(card, '--homework-urgency', c.toFixed(4));
      setProperty(card, '--homework-marquee-opacity', (0.28 + 0.72 * c).toFixed(4));
      setProperty(card, '--homework-marquee-period', `${period}s`);
      setProperty(card, '--homework-breathe-period', `${period}s`);
      setProperty(card, '--homework-blink-period', `${period}s`);
      card.classList.toggle('homework-deadline-gradient', active);
      card.classList.toggle('homework-pending', !teacher && !done && !overdue);
      card.classList.toggle('homework-marquee', effects);
    });
    if (expiredCourseIds.size) {
      document.dispatchEvent(new CustomEvent('bjtu-homework-expired', { detail: { courseIds: [...expiredCourseIds] } }));
    }
  }

  function refreshEditor() {
    document.querySelectorAll('[data-component-color]').forEach((input) => {
      const key = input.dataset.componentColor;
      const value = settings[key] || defaults[key];
      if (document.activeElement !== input) input.value = value;
      input.closest('label').querySelector('button').hidden = !settings[key];
    });
    const toggle = document.getElementById('homeworkDeadlineGradientEnabled');
    if (toggle) toggle.checked = gradientEnabled;
    const marqueeToggle = document.getElementById('homeworkMarqueeEnabled');
    if (marqueeToggle) marqueeToggle.checked = marqueeEnabled;
  }

  function apply(value = settings, gradient = gradientEnabled, marquee = marqueeEnabled) {
    settings = normalize(value);
    gradientEnabled = gradient !== false;
    marqueeEnabled = marquee !== false;
    Object.keys(defaults).forEach((key) => {
      document.documentElement.toggleAttribute(`data-custom-color-${key.toLowerCase()}`, !!settings[key]);
      if (settings[key] || ['resource', 'replay', 'assessment', 'archive', 'copy', 'download'].includes(key)) {
        const color = settings[key] || defaults[key];
        setProperty(document.documentElement, `--bjtu-color-${key}`, color);
        setProperty(document.documentElement, `--bjtu-color-${key}-foreground`, ['button', 'resource', 'replay', 'assessment', 'archive', 'copy', 'download'].includes(key) ? '#ffffff' : foreground(color));
      } else {
        document.documentElement.style.removeProperty(`--bjtu-color-${key}`);
        document.documentElement.style.removeProperty(`--bjtu-color-${key}-foreground`);
      }
    });
    refreshCards();
    refreshEditor();
  }

  function init() {
    const grid = document.getElementById('componentColorGrid');
    if (grid) {
      grid.innerHTML = Object.keys(defaults).map((key) => `<label class="component-color-item"><span>${labels[key]}</span><input type="color" data-component-color="${key}" value="${defaults[key]}" aria-label="${labels[key]}颜色"><button class="font-size-default" type="button" data-reset-color="${key}" hidden>默认</button></label>`).join('');
      grid.addEventListener('input', (event) => {
        const key = event.target.dataset.componentColor;
        if (!key) return;
        apply({ ...settings, [key]: event.target.value });
        void chrome.storage.local.set({ [storageKey]: { ...settings } });
      });
      grid.addEventListener('click', (event) => {
        const key = event.target.dataset.resetColor;
        if (!key) return;
        event.preventDefault();
        const next = { ...settings };
        delete next[key];
        apply(next);
        void chrome.storage.local.set({ [storageKey]: next });
      });
      document.getElementById('homeworkDeadlineGradientEnabled').addEventListener('change', (event) => {
        apply(settings, event.target.checked);
        void chrome.storage.local.set({ [gradientKey]: gradientEnabled });
      });
      document.getElementById('homeworkMarqueeEnabled').addEventListener('change', (event) => {
        apply(settings, gradientEnabled, event.target.checked);
        void chrome.storage.local.set({ [marqueeKey]: marqueeEnabled });
      });
    }
    refreshEditor();
    refreshCards();
    const pendingCards = new Set();
    let scheduled = false;
    new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'attributes' && record.target.matches('.hw-card-item')) pendingCards.add(record.target);
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches('.hw-card-item')) pendingCards.add(node);
          node.querySelectorAll('.hw-card-item').forEach((card) => pendingCards.add(card));
        });
      });
      if (!pendingCards.size || scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        refreshCards([...pendingCards].filter((card) => card.isConnected));
        pendingCards.clear();
      });
    }).observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-homework-done', 'data-homework-overdue', 'data-homework-deadline', 'data-homework-teacher', 'data-homework-gradient']
    });
    setInterval(refreshCards, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshCards();
    });
  }

  global.BjtuColors = Object.freeze({ storageKey, gradientKey, marqueeKey, defaults, normalize, interpolate, deadlineTime, urgency, apply });
  void chrome.storage.local.get([storageKey, gradientKey, marqueeKey]).then((stored) => apply(stored[storageKey] || {}, stored[gradientKey] !== false, stored[marqueeKey] !== false));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes[storageKey] && !changes[gradientKey] && !changes[marqueeKey])) return;
    apply(changes[storageKey] ? (changes[storageKey].newValue || {}) : settings,
      changes[gradientKey] ? changes[gradientKey].newValue !== false : gradientEnabled,
      changes[marqueeKey] ? changes[marqueeKey].newValue !== false : marqueeEnabled);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(globalThis);
