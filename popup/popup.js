const DEFAULT_POPUP_WIDTH_PX = 500;
const DEFAULT_POPUP_HEIGHT_PX = 600;
const MIN_POPUP_WIDTH_PX = 360;
const MAX_POPUP_WIDTH_PX = 800;
const MIN_POPUP_HEIGHT_PX = 420;
const MAX_POPUP_HEIGHT_PX = 600;
let currentPopupSize = {
  popupWidthPx: DEFAULT_POPUP_WIDTH_PX,
  popupHeightPx: DEFAULT_POPUP_HEIGHT_PX
};

function clampPopupDimension(value, fallback, min, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function applyPopupSize(size = {}) {
  const width = clampPopupDimension(size.popupWidthPx, DEFAULT_POPUP_WIDTH_PX, MIN_POPUP_WIDTH_PX, MAX_POPUP_WIDTH_PX);
  const height = clampPopupDimension(size.popupHeightPx, DEFAULT_POPUP_HEIGHT_PX, MIN_POPUP_HEIGHT_PX, MAX_POPUP_HEIGHT_PX);
  currentPopupSize = { popupWidthPx: width, popupHeightPx: height };
  document.documentElement.style.setProperty('--popup-width', `${width}px`);
  document.documentElement.style.setProperty('--popup-height', `${height}px`);
}

document.addEventListener('DOMContentLoaded', async () => {
  const frame = document.getElementById('popup-frame');
  try {
    const size = await chrome.storage.local.get(['popupWidthPx', 'popupHeightPx']);
    applyPopupSize(size);
  } catch {
    applyPopupSize();
  }

  // keep iframe pinned to popup-mode app page
  try {
    frame.src = chrome.runtime.getURL('app/app.html?popup=1');
  } catch (e) {
    // ignore
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes.popupWidthPx && !changes.popupHeightPx) return;
      applyPopupSize({
        popupWidthPx: changes.popupWidthPx ? changes.popupWidthPx.newValue : currentPopupSize.popupWidthPx,
        popupHeightPx: changes.popupHeightPx ? changes.popupHeightPx.newValue : currentPopupSize.popupHeightPx
      });
    });
  } catch {
    // ignore
  }
});
