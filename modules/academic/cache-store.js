(function initBjtuAcademicCacheStore(global) {
  'use strict';

  const KEYS = Object.freeze({
    schedule: 'academicScheduleCache',
    scores: 'academicScoreCache',
    exams: 'academicExamCache'
  });
  const WRITE_LOCK = 'bjtu-academic-data-cache';
  let writeQueue = Promise.resolve();
  let obsoleteKeysCleared = false;

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function splitAccount(cache) {
    return {
      schedule: {
        updatedAt: cache.updatedAt,
        writeToken: cache.writeToken,
        scheduleCurrentXnxq: cache.scheduleCurrentXnxq,
        scheduleCache: cache.scheduleCache,
        loadedScheduleTerms: cache.loadedScheduleTerms
      },
      scores: {
        academicSemesterOptions: cache.academicSemesterOptions,
        scoreCurrentZxjxjhh: cache.scoreCurrentZxjxjhh,
        scoresCache: cache.scoresCache,
        loadedSharedTerms: cache.loadedSharedTerms,
        monitor: cache.scoreMonitor
      },
      exams: { examsCache: cache.examsCache, monitor: cache.examMonitor }
    };
  }

  function splitCollection(collection) {
    const result = { schedule: {}, scores: {}, exams: {} };
    for (const [id, cache] of Object.entries(collection)) {
      const parts = splitAccount(cache);
      for (const kind of Object.keys(KEYS)) result[kind][id] = parts[kind];
    }
    return Object.fromEntries(Object.entries(KEYS).map(([kind, key]) => [key, result[kind]]));
  }

  function mergeCollection(stored) {
    const collection = {};
    for (const [kind, key] of Object.entries(KEYS)) {
      const part = stored?.[key];
      if (!isObject(part)) continue;
      for (const [id, value] of Object.entries(part)) {
        if (!isObject(value)) continue;
        const { monitor, ...data } = value;
        collection[id] = { ...(collection[id] || {}), ...data, studentId: id };
        if (kind === 'scores') collection[id].scoreMonitor = monitor;
        if (kind === 'exams') collection[id].examMonitor = monitor;
      }
    }
    return collection;
  }

  function withWriteLock(callback) {
    return global.navigator?.locks?.request
      ? global.navigator.locks.request(WRITE_LOCK, callback)
      : callback();
  }

  async function readAllUnlocked() {
    if (!obsoleteKeysCleared) {
      const stored = await chrome.storage.local.get(null);
      const obsolete = Object.keys(stored).filter((key) => (
        key === 'academicDataCache'
        || key.startsWith('academicDataCache:')
        || key === 'academicScoreSnapshots'
        || key === 'academicExamSnapshots'
        || key === 'academicScoresCache'
        || key === 'academicExamsCache'
      ));
      if (obsolete.length) await chrome.storage.local.remove(obsolete);
      const session = await chrome.storage.session.get(null).catch(() => ({}));
      const obsoleteSession = Object.keys(session).filter((key) => (
        key === 'academicDataCache' || key.startsWith('academicDataCache:')
        || key === 'academicScoreSnapshots' || key === 'academicExamSnapshots'
      ));
      if (obsoleteSession.length) await chrome.storage.session.remove(obsoleteSession);
      obsoleteKeysCleared = true;
      return mergeCollection(stored);
    }
    return mergeCollection(await chrome.storage.local.get(Object.values(KEYS)));
  }

  function readAll() {
    return withWriteLock(readAllUnlocked);
  }

  function update(studentId, updater) {
    const id = String(studentId || '').trim();
    if (!id) return Promise.resolve(null);
    const task = writeQueue.catch(() => {}).then(() => withWriteLock(async () => {
      const collection = await readAllUnlocked();
      const next = await updater(collection[id] || null);
      if (next === undefined) return collection[id] || null;
      if (next === null) delete collection[id];
      else collection[id] = next;
      await chrome.storage.local.set(splitCollection(collection));
      return next;
    }));
    writeQueue = task.catch(() => {});
    return task;
  }

  global.BjtuAcademicCacheStore = Object.freeze({
    keys: KEYS,
    readAll,
    get: async (studentId) => (await readAll())[String(studentId || '').trim()] || null,
    set: (studentId, cache) => update(studentId, () => cache),
    remove: (studentId) => update(studentId, () => null),
    update
  });
})(globalThis);
