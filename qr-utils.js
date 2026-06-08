// Shared QR utilities used by both app.js (MRZY login, resource upload) and course-qr.js (header QR tooltip)

function convertVisitNameToUrl(visitName) {
  const raw = String(visitName || '').trim();
  if (!raw) return '';
  let path = raw.replace(/^W:\\Root\\?/i, '');
  path = path.replace(/\\/g, '/');
  if (!path.startsWith('/')) path = '/' + path;
  return `${BASE}${path}`.replace(/([^:]\/\/+)\/\/+?/g, '$1/');
}

function buildQrImageUrl(content, size = 220) {
  const text = String(content || '').trim();
  if (!text) return '';
  const safeSize = Math.max(120, Number(size) || 220);
  if (typeof qrcode !== 'function') {
    throw new Error('本地二维码库未加载');
  }

  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const moduleCount = Number(qr.getModuleCount() || 0);
  if (!moduleCount) {
    throw new Error('二维码数据无效');
  }

  const marginModules = 2;
  const pixelPerModule = Math.max(2, Math.floor(safeSize / (moduleCount + marginModules * 2)));
  const canvasSize = (moduleCount + marginModules * 2) * pixelPerModule;
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('二维码画布创建失败');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.fillStyle = '#000000';

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const x = (col + marginModules) * pixelPerModule;
      const y = (row + marginModules) * pixelPerModule;
      ctx.fillRect(x, y, pixelPerModule, pixelPerModule);
    }
  }

  return canvas.toDataURL('image/png');
}

(async function initDownloadQRTooltips() {
  try {
    const { linkQrEnabled } = await chrome.storage.local.get(['linkQrEnabled']);
    if (linkQrEnabled === false) return;
  } catch {
    // allow on error
  }
  if (typeof qrcode !== 'function') return;

  const TOOLTIP_ID = '__bjtu_qr_tooltip__';
  let tooltip = document.getElementById(TOOLTIP_ID);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.style.cssText = 'position:fixed;z-index:99999;padding:8px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);display:none;pointer-events:none;flex-direction:column;align-items:center;';
    document.body.appendChild(tooltip);

    const qrImg = document.createElement('img');
    qrImg.style.cssText = 'display:block;width:130px;height:130px;image-rendering:pixelated;';
    tooltip.appendChild(qrImg);
  }

  const qrImg = tooltip.querySelector('img');
  let hideTimer = null;

  const maybeShow = (link) => {
    const url = link.href;
    if (!url || url === '#' || /^javascript:/i.test(url)) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const rect = link.getBoundingClientRect();

    try {
      qrImg.src = buildQrImageUrl(url, 130);
    } catch (e) {
      qrImg.alt = 'QR失败';
      qrImg.style.display = 'none';
      qrImg.src = '';
    }
    qrImg.style.display = 'block';
    tooltip.style.display = 'flex';
    let top = rect.bottom + 8;
    let left = rect.left;
    const tRect = tooltip.getBoundingClientRect();
    if (left + tRect.width > window.innerWidth - 4) left = window.innerWidth - tRect.width - 4;
    if (top + tRect.height > window.innerHeight - 4) top = rect.top - tRect.height - 4;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  };

  const maybeHide = (fromLink, toNode) => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (toNode && (fromLink.contains(toNode) || (tooltip.style.display !== 'none' && tooltip.contains(toNode)))) return;
    hideTimer = setTimeout(() => { tooltip.style.display = 'none'; }, 80);
  };

  document.addEventListener('mouseover', (e) => {
    const link = e.target.closest('a.resource-url, a.url-link, .video-links a, a[href*="batchDownload"]');
    if (!link) return;
    if (link.closest('#' + TOOLTIP_ID)) return;
    maybeShow(link);
  }, true);

  document.addEventListener('mouseout', (e) => {
    const link = e.target.closest('a.resource-url, a.url-link, .video-links a, a[href*="batchDownload"]');
    if (!link) return;
    maybeHide(link, e.relatedTarget);
  }, true);

  window.addEventListener('scroll', () => { tooltip.style.display = 'none'; }, { passive: true });
  window.addEventListener('resize', () => { tooltip.style.display = 'none'; }, { passive: true });
})();
