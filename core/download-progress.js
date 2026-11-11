(() => {
  'use strict';
  const channel = new BroadcastChannel('bjtu-extension-downloads');
  const tasks = new Map();
  const cancels = new Map();
  function publish(task) { channel.postMessage({type:'progress', task:{...task}}); }
  channel.onmessage = ({data}) => {
    if (data?.type === 'request-progress') for (const task of tasks.values()) publish(task);
    if (data?.type === 'cancel-progress' && cancels.has(data.id)) {
      const cancel = cancels.get(data.id);
      void Promise.resolve().then(cancel).catch(error => {
        channel.postMessage({type:'cancel-progress-error',id:data.id,error:String(error?.message || error)});
      });
    }
  };
  function begin({name, source, total = 0, path = '', cancel}) {
    const id = crypto.randomUUID();
    const task = {id,name,source,path,total,loaded:0,speed:0,cancellable:typeof cancel === 'function'};
    let lastSent = -Infinity, pending, sampleAt = performance.now(), sampleLoaded = 0;
    tasks.set(id,task); publish(task);
    if (task.cancellable) cancels.set(id,cancel);
    const flush = () => {
      pending = null;
      if (!tasks.has(id)) return;
      lastSent = performance.now(); publish(task);
    };
    return {
      update(loaded, total = task.total, detail = {}) {
        if (!tasks.has(id)) return;
        const now = performance.now();
        task.loaded = loaded; task.total = total; Object.assign(task,detail);
        if (now - sampleAt >= 350) {
          task.speed = Math.max(0,(loaded - sampleLoaded) * 1000 / (now - sampleAt));
          sampleAt = now; sampleLoaded = loaded;
        }
        if (now - lastSent >= 150) { clearTimeout(pending); flush(); }
        else if (!pending) pending = setTimeout(flush,150 - (now - lastSent));
      },
      finish() {
        clearTimeout(pending);
        cancels.delete(id);
        if (tasks.delete(id)) channel.postMessage({type:'progress-ended',id});
      }
    };
  }
  globalThis.BjtuDownloadProgress = {begin};
  addEventListener('pagehide', event => {
    if (event.persisted) return;
    for (const id of tasks.keys()) channel.postMessage({type:'progress-ended',id});
    tasks.clear();
    cancels.clear();
    channel.close();
  });
})();
