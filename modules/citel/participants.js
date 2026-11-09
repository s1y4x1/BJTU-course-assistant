(function initBjtuCitelParticipants(global) {
  'use strict';

  const BASE = 'https://citel.bjtu.edu.cn/mlsv3/';
  const cache = new Map();
  const pending = new Map();
  const bindings = new Set();
  let context = null;
  let generation = 0;
  let accountKey = '';
  const text = (node) => String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cancelled = () => Object.assign(new Error('CITEL 参与者加载已取消'), { code: 'cancelled' });
  function assertCurrent(version) { if (version !== generation) throw cancelled(); }

  function profileUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value, BASE);
      return url.origin === new URL(BASE).origin && /^\/mlsv3\/user\/(?:view|profile)\.php$/.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }

  // A missing participants table is an error, not an empty roster (e.g. login
  // redirects, permission failures). Only the dynamic participants table counts.
  function parseParticipants(doc) {
    const table = doc.querySelector('div.table-dynamic[data-table-handler="participants"]');
    if (!table) throw new Error('CITEL 页面未找到参与者列表，请检查登录状态或查看权限');
    const rawTotal = table.getAttribute('data-table-total-rows');
    const total = Number(rawTotal);
    if (!rawTotal?.trim() || !Number.isSafeInteger(total) || total < 0) throw new Error('CITEL 参与者总数无效');
    const people = new Map();
    for (const row of table.querySelectorAll('tbody tr')) {
      if (row.matches('.emptyrow') || row.querySelector('.emptyrow')) continue;
      const link = row.querySelector('.c0 a[href]');
      const name = text(link);
      const url = profileUrl(link?.getAttribute('href'));
      if (!name || !url) continue;
      const role = text(row.querySelector('.c1'));
      const group = text(row.querySelector('.c2'));
      const lastAccess = text(row.querySelector('.c3'));
      const id = new URL(url).searchParams.get('id');
      const key = id || url;
      const existing = people.get(key);
      if (existing) {
        if (role && !existing.roles.includes(role)) existing.roles.push(role);
        if (group && !existing.groups.includes(group)) existing.groups.push(group);
      } else people.set(key, { name, profileURL: url, roles: role ? [role] : [], groups: group ? [group] : [], lastAccess });
    }
    const teachers = [], students = [];
    for (const person of people.values()) {
      const role = person.roles.join(' / ');
      const item = Object.freeze({ name: person.name, profileURL: person.profileURL, role, group: person.groups.join(' / '), lastAccess: person.lastAccess });
      // Match roles independently: a participant can legitimately hold both.
      if (/教师|教師|老师|老師|助教|講師|teacher|lecturer|teaching\s*assistant|tutor/i.test(role)) teachers.push(item);
      if (/学生|學[生員]|student|learner/i.test(role)) students.push(item);
    }
    return { total, teachers: Object.freeze(teachers), students: Object.freeze(students) };
  }

  function init(options) {
    if (typeof options?.page !== 'function' || typeof options?.ready !== 'function' || typeof options?.getCourses !== 'function') {
      throw new TypeError('CITEL participants.init 需要 page、ready 和 getCourses 回调');
    }
    clear();
    context = options;
    accountKey = String(options.accountKey ?? '');
  }

  function clear() {
    generation++;
    cache.clear();
    pending.clear();
    for (const binding of [...bindings]) {
      if (!binding.wrap.isConnected) { binding.dispose(); continue; }
      binding.reset();
    }
  }

  function setAccount(value) {
    const next = String(value ?? '');
    if (next === accountKey) return;
    accountKey = next;
    clear();
  }

  async function load(courseId) {
    const id = String(courseId ?? '').trim();
    if (!/^\d+$/.test(id) || Number(id) <= 0) throw new Error('课程ID无效，请先调用 citel.courseList');
    if (!context) throw new Error('CITEL 参与者模块尚未初始化');
    const version = generation;
    const current = context;
    await current.ready();
    assertCurrent(version);
    if (!current.getCourses().some((course) => String(course.id ?? course.courseId) === id)) {
      throw new Error('课程ID无效，请先调用 citel.courseList');
    }
    if (cache.has(id)) return cache.get(id);
    if (pending.has(id)) return pending.get(id);
    const promise = (async () => {
      const read = async (perpage) => {
        const result = await current.page(`user/index.php?id=${encodeURIComponent(id)}&perpage=${perpage}`);
        assertCurrent(version);
        return parseParticipants(result.doc || result);
      };
      let result = await read(100);
      if (result.total > 100) result = await read(result.total);
      assertCurrent(version);
      cache.set(id, result);
      return result;
    })();
    pending.set(id, promise);
    try { return await promise; }
    finally { if (pending.get(id) === promise) pending.delete(id); }
  }

  // Return copies so API callers cannot mutate the shared UI cache.
  async function teachers_of_(args) { return (await load(args?.courseId)).teachers.map((item) => ({ ...item })); }
  async function students_of_(args) { return (await load(args?.courseId)).students.map((item) => ({ ...item })); }

  function renderEntrances(courseId) {
    const id = escape(courseId);
    const cached = cache.get(String(courseId ?? ''));
    const triggerText = (kind) => {
      const label = kind === 'teachers' ? '教师' : '学生';
      return cached ? `${cached[kind].length} ${label}` : label;
    };
    return `<div class="citel-participants-entries">${['teachers', 'students'].map((kind) => {
      const label = kind === 'teachers' ? '教师' : '学生';
      return `<span class="citel-participants-wrap" data-citel-participants="${kind}" data-course-id="${id}"><button type="button" class="citel-participants-trigger" aria-expanded="false">${triggerText(kind)}</button><span class="citel-participants-pop" role="region" aria-label="${label}列表" hidden><span class="citel-participants-status" role="status">悬停加载${label}列表…</span></span></span>`;
    }).join('<span class="citel-participants-sep" aria-hidden="true">·</span>')}</div>`;
  }

  // Both counts come from the same participants payload, so show them together
  // instead of updating only the hovered button.
  function updateCounts(container, result) {
    if (!container) return;
    for (const kind of ['teachers', 'students']) {
      const button = container.querySelector(`[data-citel-participants="${kind}"] .citel-participants-trigger`);
      if (button) button.textContent = `${result[kind].length} ${kind === 'teachers' ? '教师' : '学生'}`;
    }
  }

  // Moodle prints relative access times such as "1 天 13 小时" or "从未". A
  // smaller number means a more recent visit, so ascending order is 由近到远.
  function lastAccessRank(value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!raw) return Number.POSITIVE_INFINITY;
    if (/现在|刚刚|just\s*now|now/i.test(raw)) return 0;
    if (/从未|never|无(?:访问|记录)/i.test(raw)) return Number.POSITIVE_INFINITY;
    const units = { 年: 31536000, 个月: 2592000, 月: 2592000, 周: 604800, 天: 86400, 小时: 3600, 分钟: 60, 秒: 1 };
    const english = { year: 31536000, month: 2592000, week: 604800, day: 86400, hour: 3600, minute: 60, second: 1 };
    const pattern = /(\d+)\s*(个月|月|年|周|天|小时|分钟|秒|years?|months?|weeks?|days?|hours?|minutes?|seconds?)/gi;
    let total = 0;
    let matched = false;
    for (const match of raw.matchAll(pattern)) {
      const unit = match[2].toLowerCase();
      const seconds = units[unit] ?? english[unit.replace(/s$/, '')];
      if (!seconds) continue;
      matched = true;
      total += Number(match[1]) * seconds;
    }
    return matched ? total : Number.POSITIVE_INFINITY;
  }

  function tableHtml(items) {
    if (!items.length) return '<span class="citel-participants-status">暂无参与者</span>';
    const groups = new Map();
    for (const item of items) {
      const group = item.group || '—';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    const ordered = [...groups.entries()].map(([group, members]) => {
      members.sort((a, b) => lastAccessRank(a.lastAccess) - lastAccessRank(b.lastAccess)
        || a.name.localeCompare(b.name, 'zh-CN'));
      return { group, members, rank: lastAccessRank(members[0].lastAccess) };
    }).sort((a, b) => a.rank - b.rank || a.group.localeCompare(b.group, 'zh-CN'));
    const rows = [];
    for (const { group, members } of ordered) {
      members.forEach((item, index) => {
        const groupCell = index === 0 ? `<td rowspan="${members.length}">${escape(group)}</td>` : '';
        rows.push(`<tr><td><a href="${escape(item.profileURL)}" target="_blank" rel="noopener noreferrer">${escape(item.name)}</a></td>${groupCell}<td>${escape(item.lastAccess) || '—'}</td></tr>`);
      });
    }
    return `<table><thead><tr><th>姓名</th><th>小组</th><th>最近课程访问</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  function bind(root) {
    for (const binding of [...bindings]) if (!binding.wrap.isConnected) binding.dispose();
    root.querySelectorAll('[data-citel-participants]').forEach((wrap) => {
      if ([...bindings].some((binding) => binding.wrap === wrap)) return;
      const pop = wrap.querySelector('.citel-participants-pop');
      const trigger = wrap.querySelector('.citel-participants-trigger');
      const kind = wrap.dataset.citelParticipants;
      if (!pop || !trigger || !['teachers', 'students'].includes(kind)) return;
      let active = false, attempt = 0;
      const position = () => {
        if (!active) return;
        const rect = trigger.getBoundingClientRect();
        const box = pop.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, global.innerWidth - box.width - 8));
        const top = rect.bottom + box.height + 8 <= global.innerHeight
          ? rect.bottom : Math.max(8, rect.top - box.height);
        pop.style.left = `${left}px`; pop.style.top = `${top}px`;
      };
      const hide = () => {
        active = false; attempt++; pop.hidden = true; trigger.setAttribute('aria-expanded', 'false');
        global.removeEventListener('resize', position);
        global.removeEventListener('scroll', position, true);
      };
      const show = async () => {
        if (active) return;
        active = true;
        const token = ++attempt;
        pop.hidden = false; trigger.setAttribute('aria-expanded', 'true');
        pop.innerHTML = '<span class="citel-participants-status" role="status"><span class="spinner" aria-hidden="true"></span>正在加载参与人…</span>';
        position();
        global.addEventListener('resize', position);
        global.addEventListener('scroll', position, true);
        try {
          const result = await load(wrap.dataset.courseId);
          updateCounts(wrap.parentElement, result);
          if (!active || token !== attempt) return;
          pop.innerHTML = tableHtml(result[kind]);
        } catch (e) {
          if (!active || token !== attempt) return;
          pop.innerHTML = `<span class="citel-participants-status citel-participants-error" role="status">${escape(e.message)}；移开后重新悬停重试</span>`;
        }
        position();
      };
      const leave = () => { if (!wrap.contains(document.activeElement)) hide(); };
      const focusout = (event) => { if (!wrap.contains(event.relatedTarget)) hide(); };
      const keydown = (event) => { if (event.key === 'Escape') { hide(); event.stopPropagation(); } };
      const reset = () => {
        hide();
        const container = wrap.parentElement;
        if (container) {
          container.querySelectorAll('[data-citel-participants]').forEach((node) => {
            const button = node.querySelector('.citel-participants-trigger');
            if (button) button.textContent = node.dataset.citelParticipants === 'teachers' ? '教师' : '学生';
            const box = node.querySelector('.citel-participants-pop');
            if (box) box.innerHTML = '';
          });
        } else {
          trigger.textContent = kind === 'teachers' ? '教师' : '学生';
          pop.innerHTML = '';
        }
      };
      const dispose = () => {
        hide();
        wrap.removeEventListener('mouseenter', show); wrap.removeEventListener('mouseleave', leave);
        wrap.removeEventListener('focusin', show); wrap.removeEventListener('focusout', focusout);
        wrap.removeEventListener('keydown', keydown); bindings.delete(binding);
      };
      const binding = { wrap, reset, dispose };
      bindings.add(binding);
      wrap.addEventListener('mouseenter', show); wrap.addEventListener('mouseleave', leave);
      wrap.addEventListener('focusin', show); wrap.addEventListener('focusout', focusout);
      wrap.addEventListener('keydown', keydown);
    });
  }

  global.BjtuCitelParticipants = Object.freeze({ init, clear, setAccount, load, renderEntrances, bind,
    teachers_of_, students_of_, pageApi: Object.freeze({ teachers_of_, students_of_ }), parseParticipants });
})(globalThis);
