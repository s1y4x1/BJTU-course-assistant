(function installVeNativeVideoLayout() {
  'use strict';

  const isCoursePage = (url) => url.pathname === '/ve/back/coursePlatform/coursePlatform.shtml'
    && url.searchParams.get('method') === 'toCoursePlatform';
  let coursePage = isCoursePage(new URL(location.href));
  try { coursePage ||= isCoursePage(new URL(window.top.location.href)); } catch {}
  if (!coursePage) return;

  const preferenceKey = 'bjtuca-ve-native-three-screen';
  const positionKey = `bjtuca-ve-video-position:${location.href}`;
  let enabled = sessionStorage.getItem(preferenceKey) === '1';
  let initializedSetting = null;
  const wrappedFunctions = new WeakSet();

  function playerArguments(args) {
    initializedSetting = enabled;
    const options = { ...args[0] };
    const urls = [options.teacherVideoUrl, options.studentVideoUrl, options.courseVideoUrl];
    if (enabled && urls.every((url) => typeof url === 'string' && url && !url.includes('无录像文件'))) {
      // The native three-stream constructor must receive no `noVideo` argument.
      options.publicRpType = '1,2,3';
      options.isMobile = 'no';
    }
    const position = sessionStorage.getItem(positionKey);
    if (position !== null) {
      options.initGoTime = Number(position);
      sessionStorage.removeItem(positionKey);
    }
    return [options, ...args.slice(1)];
  }

  function hookPlayer() {
    const original = window.jydH5Player;
    if (typeof original !== 'function' || wrappedFunctions.has(original)) return;
    const wrapped = new Proxy(original, {
      apply(target, receiver, args) { return Reflect.apply(target, receiver, playerArguments(args)); },
      construct(target, args, newTarget) { return Reflect.construct(target, playerArguments(args), newTarget); }
    });
    wrappedFunctions.add(wrapped);
    window.jydH5Player = wrapped;
  }

  document.addEventListener('load', (event) => {
    if (event.target instanceof HTMLScriptElement) hookPlayer();
  }, true);
  hookPlayer();

  document.addEventListener('bjtu-ve-native-layout', (event) => {
    enabled = event.detail === true;
    sessionStorage.setItem(preferenceKey, enabled ? '1' : '0');
    hookPlayer();
    if (initializedSetting === null || initializedSetting === enabled) return;
    const time = document.getElementById('jyd-video1')?.currentTime;
    if (Number.isFinite(time)) sessionStorage.setItem(positionKey, String(time));
    initializedSetting = enabled;
    // Native instances own HLS streams, timers and closed-over `noVideo` state;
    // reload their frame rather than leave old instances and handlers running.
    location.reload();
  });
})();
