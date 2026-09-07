(function initBjtuAcademicCacheStore(global) {
  'use strict';

  const KEY = 'academicDataCache';
  const LEGACY_PREFIX = 'academicDataCache:';
  const WRITE_LOCK = 'bjtu-academic-data-cache';
  let writeQueue = Promise.resolve();

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isAccountCache(value) {
    return isObject(value) && (
      typeof value.studentId === 'string'
      || Array.isArray(value.academicSemesterOptions)
      || Object.hasOwn(value, 'scheduleCache')
      || Object.hasOwn(value, 'scoresCache')
      || Object.hasOwn(value, 'examsCache')
    );
  }

  function addCache(collection, studentId, cache) {
    const id = String(studentId || cache?.studentId || '').trim();
    if (!id || !isAccountCache(cache)) return false;
    const existing = collection[id];
    if (!existing || Number(cache.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      collection[id] = cache;
      return true;
    }
    return false;
  }

  function readCollectionValue(value) {
    const collection = {};
    if (isAccountCache(value)) {
      addCache(collection, value.studentId, value);
      return collection;
    }
    if (!isObject(value)) return collection;
    for (const [studentId, cache] of Object.entries(value)) addCache(collection, studentId, cache);
    return collection;
  }

  function withWriteLock(callback) {
    return global.navigator?.locks?.request
      ? global.navigator.locks.request(WRITE_LOCK, callback)
      : callback();
  }

  async function readAllUnlocked() {
    const [localValues, sessionValues] = await Promise.all([
      chrome.storage.local.get(null),
      chrome.storage.session.get(null).catch(() => ({}))
    ]);
    const collection = readCollectionValue(localValues?.[KEY]);
    const legacyLocalKeys = Object.keys(localValues || {}).filter((key) => key.startsWith(LEGACY_PREFIX));
    const legacySessionKeys = Object.keys(sessionValues || {}).filter((key) => key === KEY || key.startsWith(LEGACY_PREFIX));
    let migrationNeeded = isAccountCache(localValues?.[KEY]);

    for (const key of legacyLocalKeys) {
      migrationNeeded = addCache(collection, key.slice(LEGACY_PREFIX.length), localValues[key]) || migrationNeeded;
    }
    for (const key of legacySessionKeys) {
      const fallbackId = key.startsWith(LEGACY_PREFIX) ? key.slice(LEGACY_PREFIX.length) : '';
      migrationNeeded = addCache(collection, fallbackId, sessionValues[key]) || migrationNeeded;
    }
    if (legacyLocalKeys.length || legacySessionKeys.length) migrationNeeded = true;

    if (migrationNeeded) {
      await chrome.storage.local.set({ [KEY]: collection });
      if (legacyLocalKeys.length) await chrome.storage.local.remove(legacyLocalKeys);
      if (legacySessionKeys.length) await chrome.storage.session.remove(legacySessionKeys).catch(() => {});
    }
    return collection;
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
      await chrome.storage.local.set({ [KEY]: collection });
      return next;
    }));
    writeQueue = task.catch(() => {});
    return task;
  }

  global.BjtuAcademicCacheStore = Object.freeze({
    key: KEY,
    readAll,
    get: async (studentId) => (await readAll())[String(studentId || '').trim()] || null,
    set: (studentId, cache) => update(studentId, () => cache),
    remove: (studentId) => update(studentId, () => null),
    update
  });
})(globalThis);
