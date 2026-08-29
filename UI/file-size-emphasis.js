(function initFileSizeEmphasis(global) {
  'use strict';

  if (global.BjtuFileSizeEmphasis) return;

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (!value) return '0 B';
    const unit = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(unit)));
    return `${parseFloat((value / Math.pow(unit, index)).toFixed(2))} ${units[index]}`;
  }

  function buildMegabytesStyle(megabytes) {
    const mb = Number(megabytes);
    if (!Number.isFinite(mb) || mb <= 0) {
      return 'font-size:10px; font-weight:500; color:#94a3b8; text-shadow:none;';
    }
    const ratio = Math.max(0, Math.min(1, Math.log10(mb + 1) / Math.log10(1024 + 1)));
    const fontPx = (10 + ratio * 6).toFixed(2);
    const weight = Math.round(500 + ratio * 320);
    const shadowBlur = Math.max(0, (ratio - 0.18) * 5).toFixed(2);
    const shadowAlpha = Math.max(0, (ratio - 0.2) * 0.35);
    if (document.documentElement.dataset.colorScheme === 'dark') {
      const red = Math.round(182 + ratio * 73);
      const green = Math.round(194 + ratio * 61);
      const blue = Math.round(209 + ratio * 46);
      const shadow = shadowBlur === '0.00'
        ? 'none'
        : `0 1px ${shadowBlur}px rgba(255,255,255,${Math.min(1, shadowAlpha * 1.2).toFixed(2)})`;
      return `font-size:${fontPx}px; font-weight:${weight}; color:rgb(${red},${green},${blue}); text-shadow:${shadow};`;
    }
    const red = Math.round(148 - ratio * 118);
    const green = Math.max(18, red + 8);
    const blue = Math.max(28, red + 20);
    const shadow = shadowBlur === '0.00'
      ? 'none'
      : `0 1px ${shadowBlur}px rgba(15,23,42,${shadowAlpha.toFixed(2)})`;
    return `font-size:${fontPx}px; font-weight:${weight}; color:rgb(${red},${green},${blue}); text-shadow:${shadow};`;
  }

  function buildBytesStyle(bytes) {
    return buildMegabytesStyle(Math.max(0, Number(bytes) || 0) / (1024 * 1024));
  }

  function applyStyle(element, styleText) {
    if (!(element instanceof HTMLElement)) return;
    for (const property of ['font-size', 'font-weight', 'color', 'text-shadow']) {
      const value = String(styleText || '').match(new RegExp(`${property}:([^;]+)`))?.[1]?.trim();
      if (value) element.style.setProperty(property, value);
    }
  }

  function applyBytes(element, bytes) {
    applyStyle(element, buildBytesStyle(bytes));
  }

  function refresh(root = document) {
    root.querySelectorAll?.('[data-file-size-bytes], [data-file-size-mb]').forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const style = element.dataset.fileSizeBytes !== undefined
        ? buildBytesStyle(Number(element.dataset.fileSizeBytes || 0))
        : buildMegabytesStyle(Number(element.dataset.fileSizeMb || 0));
      applyStyle(element, style);
    });
  }

  global.BjtuFileSizeEmphasis = Object.freeze({
    formatBytes,
    buildMegabytesStyle,
    buildBytesStyle,
    applyStyle,
    applyBytes,
    refresh
  });
  global.addEventListener('bjtu-theme-change', () => refresh());
})(globalThis);
