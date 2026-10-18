(function installVeNativeVideoLayout() {
  'use strict';

  const isCoursePage = (url) => url.pathname === '/ve/back/coursePlatform/coursePlatform.shtml'
    && url.searchParams.get('method') === 'toCoursePlatform';
  let coursePage = isCoursePage(new URL(location.href));
  try { coursePage ||= isCoursePage(new URL(window.top.location.href)); } catch {}
  if (!coursePage) return;

  const preferenceKey = 'bjtuca-ve-native-three-screen';
  let enabled = sessionStorage.getItem(preferenceKey) === '1';
  const wrappedFunctions = new WeakSet();
  const players = new Set();
  let activeOwner = null;
  let ownerSequence = 0;
  const timerOwners = new Map();
  const listeners = new WeakMap();
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;

  function run(owner, fn, receiver, args = []) {
    if (owner.disposed) return;
    const previous = activeOwner;
    activeOwner = owner;
    try { return Reflect.apply(fn, receiver, args); } finally { activeOwner = previous; }
  }

  for (const [start, stop, repeating] of [['setTimeout', 'clearTimeout', false], ['setInterval', 'clearInterval', true]]) {
    const nativeStart = window[start];
    const nativeStop = window[stop];
    window[start] = function (callback, delay, ...args) {
      const owner = activeOwner;
      if (!owner || typeof callback !== 'function') return nativeStart.call(window, callback, delay, ...args);
      const id = nativeStart.call(window, (...values) => {
        if (!repeating) { owner.timers.delete(id); timerOwners.delete(id); }
        return run(owner, callback, window, values);
      }, delay, ...args);
      owner.timers.set(id, nativeStop);
      timerOwners.set(id, owner);
      return id;
    };
    window[stop] = function (id) {
      timerOwners.get(id)?.timers.delete(id);
      timerOwners.delete(id);
      return nativeStop.call(window, id);
    };
  }

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (!activeOwner || !listener) return nativeAdd.call(this, type, listener, options);
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const entries = listeners.get(this) || [];
    const existing = entries.find((item) => item.type === type && item.listener === listener && item.capture === capture);
    if (existing) return nativeAdd.call(this, type, existing.wrapped, options);
    const owner = activeOwner;
    const wrapped = function (event) {
      return run(owner, typeof listener === 'function' ? listener : listener.handleEvent,
        typeof listener === 'function' ? this : listener, [event]);
    };
    const entry = { target: this, type, listener, capture, wrapped, owner };
    entries.push(entry);
    listeners.set(this, entries);
    owner.listeners.add(entry);
    return nativeAdd.call(this, type, wrapped, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const entries = listeners.get(this);
    const index = entries?.findIndex((item) => item.type === type && item.listener === listener && item.capture === capture) ?? -1;
    if (index < 0) return nativeRemove.call(this, type, listener, options);
    const [entry] = entries.splice(index, 1);
    entry.owner.listeners.delete(entry);
    return nativeRemove.call(this, type, entry.wrapped, options);
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    const owner = activeOwner;
    if (owner) {
      owner.requests.add(this);
      nativeAdd.call(this, 'loadend', () => owner.requests.delete(this), { once: true });
    }
    return nativeSend.apply(this, args);
  };

  const jqueryHooks = new WeakSet();
  function hookJquery() {
    const jquery = window.jQuery;
    if (!jquery?.event?.add || jqueryHooks.has(jquery.event.add)) return;
    const original = jquery.event.add;
    const wrapped = function (element, types, handler, ...args) {
      const owner = activeOwner;
      if (!owner) return original.call(this, element, types, handler, ...args);
      const fn = typeof handler === 'function' ? handler : handler.handler;
      const callback = function (...values) { return run(owner, fn, this, values); };
      callback.guid = fn.guid ||= jquery.guid++;
      owner.jqueryTargets.add(element);
      const namespaced = types.match(/\S+/g).map((type) => `${type}.${owner.namespace}`).join(' ');
      return original.call(this, element, namespaced,
        typeof handler === 'function' ? callback : { ...handler, handler: callback,
          namespace: [handler.namespace, owner.namespace].filter(Boolean).join('.') }, ...args);
    };
    jqueryHooks.add(wrapped);
    jquery.event.add = wrapped;
  }

  function disposeOwner(owner) {
    owner.disposed = true;
    owner.requests.forEach((request) => request.abort());
    owner.requests.clear();
    owner.timers.forEach((clear, id) => { clear.call(window, id); timerOwners.delete(id); });
    owner.timers.clear();
    owner.jqueryTargets.forEach((element) => window.jQuery(element).off(`.${owner.namespace}`));
    owner.jqueryTargets.clear();
    owner.listeners.forEach((entry) => {
      nativeRemove.call(entry.target, entry.type, entry.wrapped, entry.capture);
      const entries = listeners.get(entry.target);
      const index = entries?.indexOf(entry) ?? -1;
      if (index >= 0) entries.splice(index, 1);
    });
    owner.listeners.clear();
    if (window.onresize === owner.resizeAfter) window.onresize = owner.resizeBefore;
  }

  function playerArguments(args, position) {
    const options = { ...args[0] };
    const urls = [options.teacherVideoUrl, options.studentVideoUrl, options.courseVideoUrl];
    if (enabled && urls.every((url) => typeof url === 'string' && url && !url.includes('无录像文件'))) {
      // The native three-stream constructor must receive no `noVideo` argument.
      options.publicRpType = '1,2,3';
      options.isMobile = 'no';
    }
    if (Number.isFinite(position)) options.initGoTime = position;
    return [options, ...args.slice(1)];
  }

  function initialize(record, position) {
    record.owner = {
      disposed: false, timers: new Map(), listeners: new Set(), jqueryTargets: new Set(), requests: new Set(),
      namespace: `bjtucaVideo${++ownerSequence}`,
      resizeBefore: window.onresize
    };
    try {
      const args = playerArguments(record.args, position);
      record.api = run(record.owner, () => record.newTarget
        ? Reflect.construct(record.target, args, record.newTarget)
        : Reflect.apply(record.target, record.receiver, args));
      record.owner.resizeAfter = window.onresize;
      record.setting = enabled;
    } catch (error) {
      record.owner.resizeAfter = window.onresize;
      disposeOwner(record.owner);
      throw error;
    }
  }

  function createPlayer(target, receiver, args, newTarget) {
    const record = { target, receiver, args: [{ ...args[0] }, ...args.slice(1)], newTarget };
    initialize(record);
    if (!record.api || typeof record.api !== 'object') { disposeOwner(record.owner); return record.api; }
    players.add(record);
    const methods = new Map();
    return new Proxy(record.api, {
      get(_target, key) {
        const value = Reflect.get(record.api, key, record.api);
        if (typeof value !== 'function') return value;
        if (!methods.has(key)) methods.set(key, (...values) => {
          try { return run(record.owner, record.api[key], record.api, values); }
          finally {
            if (key === 'disconnectStream') { disposeOwner(record.owner); players.delete(record); }
          }
        });
        return methods.get(key);
      },
      set(_target, key, value) { return Reflect.set(record.api, key, value, record.api); }
    });
  }

  function rebuild(record) {
    const element = document.getElementById(record.args[0].element);
    const oldVideos = [...(element?.querySelectorAll('video') || [])];
    const first = oldVideos[0];
    const state = first && { time: first.currentTime, paused: first.paused,
      volume: first.volume, muted: first.muted, rate: first.playbackRate };
    try {
      run(record.owner, () => {
        record.api.stopVideo?.();
        oldVideos.forEach((video) => video.pause());
        record.api.disconnectStream?.();
      });
    } finally { disposeOwner(record.owner); }
    initialize(record, state?.time);
    if (!state) return;
    const owner = record.owner;
    const videos = [...(element?.querySelectorAll('video') || [])];
    run(owner, () => {
      let pending = videos.length;
      const ready = () => {
        if (--pending || owner.disposed) return;
        run(owner, () => state.paused ? record.api.stopVideo?.() : record.api.playVideo?.());
      };
      videos.forEach((video) => {
        video.volume = state.volume;
        video.muted = state.muted;
        video.playbackRate = state.rate;
        if (video.readyState >= 3) ready();
        else video.addEventListener('canplay', ready, { once: true });
      });
    });
  }

  function hookPlayer() {
    hookJquery();
    const original = window.jydH5Player;
    if (typeof original !== 'function' || wrappedFunctions.has(original)) return;
    const wrapped = new Proxy(original, {
      apply(target, receiver, args) { return createPlayer(target, receiver, args); },
      construct(target, args, newTarget) { return createPlayer(target, null, args, newTarget); }
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
    players.forEach((record) => { if (record.setting !== enabled) rebuild(record); });
  });
})();
