(function initExecutionHistory(global) {
  'use strict';
  if (global.BjtuExecutionHistory) return;
  const storageKey = 'llmExecutionHistory';
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }
  function write(entries) {
    localStorage.setItem(storageKey, JSON.stringify(entries.slice(-20)));
    global.dispatchEvent(new Event('bjtu-execution-history-change'));
  }
  function append(entry) {
    const entries = read(), last = entries.at(-1);
    if (last && last.mode === entry.mode && last.code === entry.code
      && JSON.stringify(last.outcome) === JSON.stringify(entry.outcome)) return;
    write([...entries, { recordedAt: Date.now(), ...entry }]);
  }
  function remove(entry) {
    const signature = JSON.stringify(entry);
    write(read().filter(item => JSON.stringify(item) !== signature));
  }
  global.BjtuExecutionHistory = Object.freeze({ storageKey, read, append, remove, clear: () => write([]) });
})(globalThis);
