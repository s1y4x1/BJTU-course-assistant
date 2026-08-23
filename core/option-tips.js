(function initBjtuOptionTips(global) {
  'use strict';

  const POPOVER_ID = 'option-tip-popover';
  let popover = null;
  let activeTrigger = null;

  function positionPopover() {
    if (!(activeTrigger instanceof HTMLElement) || !popover || popover.hidden) return;
    const margin = 8;
    const gap = 7;
    const triggerRect = activeTrigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - popoverRect.width - margin);
    const left = Math.min(Math.max(margin, triggerRect.left), maxLeft);
    const below = triggerRect.bottom + gap;
    const above = triggerRect.top - popoverRect.height - gap;
    const top = below + popoverRect.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, above);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function showPopover(trigger) {
    activeTrigger = trigger;
    if (!popover) return;
    popover.textContent = String(trigger?.dataset?.tip || '');
    popover.hidden = false;
    positionPopover();
  }

  function hidePopover(trigger) {
    if (activeTrigger !== trigger) return;
    activeTrigger = null;
    if (!popover) return;
    popover.hidden = true;
  }

  function ensurePopover() {
    if (popover) return;
    popover = document.createElement('div');
    popover.id = POPOVER_ID;
    popover.className = 'option-tip-popover';
    popover.setAttribute('role', 'tooltip');
    popover.hidden = true;
    document.body.appendChild(popover);
    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', positionPopover, true);
  }

  // 将 .tip 文本转换为 ℹ️ 触发器与悬浮气泡；可重复调用，仅处理尚未转换的 .tip。
  function setup() {
    ensurePopover();
    document.querySelectorAll('.tip').forEach((tip) => {
      if (tip.closest('.ui-order-editor')) return;
      const text = String(tip.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        tip.remove();
        return;
      }
      const trigger = document.createElement('span');
      trigger.className = 'option-tip-trigger';
      trigger.textContent = 'ℹ️';
      trigger.dataset.tip = text;
      trigger.tabIndex = 0;
      trigger.setAttribute('role', 'img');
      trigger.setAttribute('aria-label', `提示：${text}`);
      trigger.setAttribute('aria-describedby', POPOVER_ID);
      trigger.addEventListener('mouseenter', () => showPopover(trigger));
      trigger.addEventListener('mouseleave', () => hidePopover(trigger));
      trigger.addEventListener('focus', () => showPopover(trigger));
      trigger.addEventListener('blur', () => hidePopover(trigger));
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      const explicitTarget = String(tip.dataset.tipTarget || '').trim();
      let target = explicitTarget
        ? document.querySelector(explicitTarget)
        : tip.previousElementSibling;
      if (!explicitTarget && target instanceof HTMLElement && !target.matches('label')) {
        target = target.querySelector(':scope > label:last-of-type') || target;
      }
      if (target instanceof HTMLElement && (
        explicitTarget
        || target.matches('label, .popup-size-editor')
        || target.querySelector(':scope > label, :scope > button')
      )) {
        target.appendChild(trigger);
        tip.remove();
      } else {
        tip.replaceWith(trigger);
      }
    });
  }

  global.BjtuOptionTips = { setup };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setup(), { once: true });
  } else {
    setup();
  }
})(globalThis);
