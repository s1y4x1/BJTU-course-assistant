// Shared QR utilities used by both app.js (MRJZY login, resource upload) and course-qr.js (header QR tooltip)

const QR_MIN_DISPLAY_SIZE = 90;
const QR_MIN_MODULE_SIZE = 2;
const QR_QUIET_ZONE_MODULES = 4;

function convertVisitNameToUrl(visitName) {
  const raw = String(visitName || '').trim();
  if (!raw) return '';
  let path = raw.replace(/^W:\\Root\\?/i, '');
  path = path.replace(/\\/g, '/');
  if (!path.startsWith('/')) path = '/' + path;
  if (path.startsWith('/rp/')) return `${FILE_BASE || 'http://123.121.147.7:8081'}${path}`.replace(/([^:]\/\/+)\/\/+?/g, '$1/');
  return `${BASE}${path}`.replace(/([^:]\/\/+)\/\/+?/g, '$1/');
}

function buildQrImageData(content, size = QR_MIN_DISPLAY_SIZE) {
  const text = String(content || '').trim();
  if (!text) return '';
  const safeSize = Math.max(QR_MIN_DISPLAY_SIZE, Number(size) || QR_MIN_DISPLAY_SIZE);
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

  const contentSize = Math.max(safeSize, moduleCount * QR_MIN_MODULE_SIZE);
  const pixelPerModule = contentSize / moduleCount;
  const quietZoneSize = QR_QUIET_ZONE_MODULES * QR_MIN_MODULE_SIZE;
  const displaySize = contentSize + quietZoneSize * 2;
  const pathParts = [];
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) continue;
      pathParts.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${displaySize} ${displaySize}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${pathParts.join('')}" transform="translate(${quietZoneSize} ${quietZoneSize}) scale(${pixelPerModule})" fill="black"/></svg>`;

  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    moduleCount,
    pixelPerModule,
    contentSize,
    quietZoneSize,
    displaySize
  };
}

function buildQrImageUrl(content, size = QR_MIN_DISPLAY_SIZE) {
  return buildQrImageData(content, size).url;
}

function applyQrImageToElement(image, content, size = QR_MIN_DISPLAY_SIZE, resizeRelativeParent = false) {
  if (!(image instanceof HTMLImageElement)) throw new Error('二维码图片元素无效');
  const qrImage = buildQrImageData(content, size);
  image.src = qrImage.url;
  image.style.width = `${qrImage.displaySize}px`;
  image.style.height = `${qrImage.displaySize}px`;
  if (resizeRelativeParent) {
    const parent = image.parentElement;
    if (parent instanceof HTMLElement && getComputedStyle(parent).position === 'relative') {
      parent.style.width = `${qrImage.displaySize}px`;
      parent.style.height = `${qrImage.displaySize}px`;
    }
  }
  return qrImage;
}

(async function initDownloadQRTooltips() {
  window.__linkQrEnabled = true;
  try {
    const { linkQrEnabled } = await chrome.storage.local.get(['linkQrEnabled']);
    window.__linkQrEnabled = linkQrEnabled !== false;
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

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.linkQrEnabled) return;
      window.__linkQrEnabled = changes.linkQrEnabled.newValue === undefined
        ? true
        : !!changes.linkQrEnabled.newValue;
      if (!window.__linkQrEnabled) tooltip.style.display = 'none';
    });
  } catch {
    // ignore
  }

  const getQrUrl = (link) => {
    const explicit = link?.dataset?.qrUrl;
    if (explicit) return String(explicit || '').trim();
    return String(link?.href || '').trim();
  };

  const maybeShow = (link) => {
    if (!window.__linkQrEnabled) return;
    const url = getQrUrl(link);
    if (!url || url === '#' || /^javascript:/i.test(url)) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const rect = link.getBoundingClientRect();

    try {
      applyQrImageToElement(qrImg, url, 130);
    } catch (e) {
      qrImg.alt = 'QR失败';
      qrImg.style.display = 'none';
      qrImg.src = '';
      tooltip.style.display = 'none';
      return;
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
    if (!window.__linkQrEnabled) return;
    if (!(e.target instanceof Element)) return;
    const link = e.target.closest('a.resource-url, a.url-link, .video-links a, a[href*="batchDownload"], [data-qr-url]');
    if (!link) return;
    if (link.closest('#' + TOOLTIP_ID)) return;
    maybeShow(link);
  }, true);

  document.addEventListener('mouseout', (e) => {
    if (!(e.target instanceof Element)) return;
    const link = e.target.closest('a.resource-url, a.url-link, .video-links a, a[href*="batchDownload"], [data-qr-url]');
    if (!link) return;
    maybeHide(link, e.relatedTarget);
  }, true);

  window.addEventListener('scroll', () => { tooltip.style.display = 'none'; }, { passive: true });
  window.addEventListener('resize', () => { tooltip.style.display = 'none'; }, { passive: true });
})();
