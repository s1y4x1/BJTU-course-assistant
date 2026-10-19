(function initHomeworkReminders(global) {
  'use strict';

  const labels = Object.freeze({ ve: '智慧课程平台', ykt: '雨课堂', mrjzy: '每日交作业', jlgj: '接龙管家', mooc: '中国大学MOOC', xuetangx: '学堂在线' });
  const keys = Object.freeze({ snapshot: 'homeworkReminderSnapshot', observed: 'homeworkReminderObserved', notified: 'homeworkReminderNotified' });
  const notificationPrefix = 'bjtu-homework-reminder:';

  function platformState(value) {
    return Object.fromEntries(Object.keys(labels).filter((id) => value?.[id] && typeof value[id] === 'object')
      .map((id) => [id, structuredClone(value[id])]));
  }

  function scope(root, platform, account = '', create = false) {
    if (!labels[platform] || (platform === 've' && !account)) return null;
    if (create && !root[platform]) root[platform] = {};
    if (platform !== 've') return root[platform] || null;
    if (create && !root.ve[account]) root.ve[account] = {};
    return root.ve?.[account] || null;
  }

  function snapshots(root) {
    return Object.keys(labels).flatMap((platform) => platform === 've'
      ? Object.entries(root.ve || {}).map(([account, entry]) => ({ platform, account, entry }))
      : root[platform] ? [{ platform, account: '', entry: root[platform] }] : []);
  }

  function replaceSnapshot(root, platform, account, items, updatedAt) {
    const entry = scope(root, platform, account, true);
    if (entry) Object.assign(entry, { updatedAt, items });
  }

  function readState(stored) {
    const state = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, platformState(stored[key])]));
    const accounts = stored[keys.snapshot]?.accounts;
    if (!accounts) return state;
    const notificationsByTask = new Map();
    for (const [key, value] of Object.entries(stored[keys.notified] || {})) {
      const split = key.lastIndexOf('|');
      const task = key.slice(0, split);
      if (!notificationsByTask.has(task)) notificationsByTask.set(task, []);
      notificationsByTask.get(task).push([key.slice(split), value]);
    }
    // Reshape the currently persisted account-first data once, preserving reminders
    // for offline accounts. Subsequent writes contain only the platform-first schema.
    for (const [account, entry] of Object.entries(accounts).sort((a, b) => Number(a[1].updatedAt) - Number(b[1].updatedAt))) {
      for (const [platform, label] of Object.entries(labels)) {
        const items = (entry.items || []).filter((item) => item.platform === label);
        if (!items.length) continue;
        const scopedAccount = platform === 've' ? account : '';
        const normalized = items.map((item) => ({ ...item, key: item.key.startsWith(`${label}|`) ? item.key.slice(label.length + 1) : item.key }));
        replaceSnapshot(state.snapshot, platform, scopedAccount, normalized, entry.updatedAt);
        const observed = scope(state.observed, platform, scopedAccount, true);
        const notified = scope(state.notified, platform, scopedAccount, true);
        items.forEach((item, index) => {
          const oldKey = `${account}|${item.key}`;
          const newKey = normalized[index].key;
          const observation = stored[keys.observed]?.[oldKey];
          if (observation && Number(observation.lastSeenAt) >= Number(observed[newKey]?.lastSeenAt || 0)) observed[newKey] = observation;
          for (const [suffix, value] of notificationsByTask.get(oldKey) || []) {
            const notificationKey = `${newKey}${suffix}`;
            if (Number(value.notifiedAt) >= Number(notified[notificationKey]?.notifiedAt || 0)) notified[notificationKey] = value;
          }
        });
      }
    }
    return state;
  }

  async function update(callback) {
    return navigator.locks.request('bjtu-homework-reminders', async () => {
      const stored = await chrome.storage.local.get(Object.values(keys));
      const state = readState(stored);
      const result = await callback(state);
      const changes = {};
      for (const [name, key] of Object.entries(keys)) {
        if (JSON.stringify(state[name]) !== JSON.stringify(stored[key] || {})) changes[key] = state[name];
      }
      if (Object.keys(changes).length) await chrome.storage.local.set(changes);
      return result;
    });
  }

  function notificationId(kind, platform, account, key) {
    let hash = 2166136261;
    for (const character of String(key)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return `${notificationPrefix}${kind}:${platform}:${platform === 've' ? `${encodeURIComponent(account)}:` : ''}${(hash >>> 0).toString(36)}`;
  }

  function notificationTarget(id) {
    if (!String(id).startsWith(notificationPrefix)) return null;
    const [kind, platform, account] = String(id).slice(notificationPrefix.length).split(':');
    if (!['deadline', 'new'].includes(kind) || !labels[platform]) return null;
    return { platform, account: platform === 've' ? decodeURIComponent(account || '') : '' };
  }

  function selectedVeAccount(stored) {
    const account = String(stored.homeworkReminderAccount || '').trim();
    const latest = Array.isArray(stored.loginAccountHistory) ? stored.loginAccountHistory[0] : null;
    return account || String(latest?.loginName || latest?.userId || '').trim();
  }

  function plainText(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return String(value || '').replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => entity[0] === '#'
        ? String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
        : entities[entity.toLowerCase()]).trim();
  }

  global.BjtuHomeworkReminders = { labels, keys, scope, snapshots, replaceSnapshot, update, notificationId, notificationTarget, plainText, selectedVeAccount };
})(globalThis);
