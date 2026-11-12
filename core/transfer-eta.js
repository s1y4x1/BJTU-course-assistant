(() => {
  'use strict';

  function create(render, format) {
    const windowMs = 3000;
    let points = [], timer, activeSince, lastMovingAt, previousLoaded, remaining, speed, lastText;
    function paint() {
      clearTimeout(timer);
      timer = null;
      const now = performance.now();
      const cutoff = now - windowMs;
      while (points.length && points[0].at <= cutoff) points.shift();
      const stalled = now - lastMovingAt >= windowMs;
      const recentSpeed = points.reduce((sum, point) => sum + point.bytes, 0) * 1000
        / Math.max(1, Math.min(windowMs, now - activeSince));
      const rate = now - lastMovingAt <= 500 && speed > 0 ? speed : recentSpeed;
      const text = remaining === 0 ? '' : stalled ? '∞' : remaining == null || !rate ? '—' : format(remaining / rate);
      if (text !== lastText) { lastText = text; render(text); }
      if (remaining !== 0 && !stalled) timer = setTimeout(paint, 250);
    }
    return (active, loaded, total, currentSpeed) => {
      const now = performance.now();
      remaining = !active ? 0 : total > 0 ? Math.max(0,total - loaded) : null;
      speed = currentSpeed;
      if (remaining === 0) {
        activeSince = undefined; points = [];
      } else if (activeSince === undefined) {
        activeSince = lastMovingAt = now; points = [];
      } else if (loaded > previousLoaded) {
        lastMovingAt = now;
        const bytes = loaded - previousLoaded, point = points.at(-1);
        if (point && Math.floor(point.at / 100) === Math.floor(now / 100)) {
          point.at = now; point.bytes += bytes;
        }
        else points.push({at:now,bytes});
      }
      previousLoaded = loaded;
      paint();
    };
  }

  globalThis.BjtuTransferEta = {create};
})();
