const DEFAULT_POPUP_WIDTH_PX = 500;
const DEFAULT_POPUP_HEIGHT_PX = 600;
const MIN_POPUP_WIDTH_PX = 360;
const MAX_POPUP_WIDTH_PX = 800;
const MIN_POPUP_HEIGHT_PX = 420;
const MAX_POPUP_HEIGHT_PX = 600;
const SIDE_PANEL_LAST_VIEW_KEY = 'sidePanelLastView';
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
  const sidePanelView = new URLSearchParams(location.search).get('view') === 'sidepanel';
  let qwenFrame = null;
  let qwenAvailable = false;
  const ensureQwenFrame = () => {
    if (qwenFrame instanceof HTMLIFrameElement) return qwenFrame;
    qwenFrame = document.createElement('iframe');
    qwenFrame.id = 'qwen-side-panel-frame';
    qwenFrame.className = 'side-panel-frame';
    qwenFrame.title = '千问助手';
    qwenFrame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads allow-modals');
    qwenFrame.src = chrome.runtime.getURL('modules/qwen/chat.html?view=sidepanel');
    qwenFrame.hidden = true;
    frame.after(qwenFrame);
    return qwenFrame;
  };
  const showSidePanelView = async (view) => {
    const showQwen = sidePanelView && view === 'qwen' && qwenAvailable;
    frame.hidden = showQwen;
    if (showQwen) ensureQwenFrame().hidden = false;
    else if (qwenFrame instanceof HTMLIFrameElement) qwenFrame.hidden = true;
    if (sidePanelView) await chrome.storage.local.set({ [SIDE_PANEL_LAST_VIEW_KEY]: showQwen ? 'qwen' : 'course' });
  };
  try {
    if (!sidePanelView) {
      const size = await chrome.storage.local.get(['popupWidthPx', 'popupHeightPx']);
      applyPopupSize(size);
    } else {
      // 边栏宽度由浏览器决定，铺满即可。
      document.documentElement.style.setProperty('--popup-width', '100%');
      document.documentElement.style.setProperty('--popup-height', '100vh');
      const [stored, qwenResponse] = await Promise.all([
        chrome.storage.local.get(SIDE_PANEL_LAST_VIEW_KEY),
        fetch(chrome.runtime.getURL('modules/qwen/module.json'), { cache: 'no-store' }).catch(() => null)
      ]);
      qwenAvailable = qwenResponse?.ok === true;
      await showSidePanelView(stored?.[SIDE_PANEL_LAST_VIEW_KEY] === 'qwen' ? 'qwen' : 'course');
    }
  } catch {
    applyPopupSize();
  }

  // keep iframe pinned to popup-mode app page
  try {
    frame.src = chrome.runtime.getURL('app/app.html?popup=1' + (sidePanelView ? '&view=sidepanel' : ''));
  } catch (e) {
    // ignore
  }

  // 两个页面始终保留在各自 iframe 中；切换只改变可见性，不销毁千问会话页面。
  window.addEventListener('message', (event) => {
    if (event?.data?.type !== 'BJTU_SIDE_PANEL_TOGGLE') return;
    void (async () => {
      try {
        const target = event?.data?.target === 'course' ? 'course' : 'qwen';
        if (target === 'qwen' && !qwenAvailable) return;
        await showSidePanelView(target);
      } catch {
        // 保持当前边栏页面。
      }
    })();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (sidePanelView) return;
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
