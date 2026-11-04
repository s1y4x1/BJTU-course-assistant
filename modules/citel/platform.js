(function initBjtuCitelPlatform(global) {
  'use strict';

  const BASE = 'https://citel.bjtu.edu.cn/mlsv3/';
  const TYPES = Object.freeze({ workshop: '互评', programming: '编程练习', resource: '文件', url: '网页地址', forum: '讨论区' });
  const DEFAULT_TYPES = Object.freeze(['workshop', 'programming']);
  let env = null;
  let courses = [];
  let serial = 0;
  let loginDialog = null;
  let loginPromise = null;
  const expanded = new Set();
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  const text = (node) => String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const error = (message, code = '') => Object.assign(new Error(message), { code });
  const assertCurrent = (version) => { if (version !== serial) throw error('CITEL 加载已取消', 'cancelled'); };
  const loginRequired = () => error('CITEL 未登录或登录已失效', 'LOGIN_REQUIRED');

  function safeUrl(value, base = BASE) {
    try {
      const url = new URL(value, base);
      return url.origin === new URL(BASE).origin && url.pathname.startsWith('/mlsv3/') ? url.href : '';
    } catch { return ''; }
  }

  function isLoginPage(doc) {
    const info = text(doc.querySelector('.logininfo'));
    return !!doc.querySelector('input[name="logintoken"], form#login')
      || /未登录|尚未登录|没有登录|not logged in|log in|登录无效|invalid login/i.test(info);
  }

  function readSesskey(html) {
    const match = String(html).match(/["']sesskey["']\s*:\s*["']([^"']+)["']/)
      || String(html).match(/[?&]sesskey=([a-zA-Z0-9]+)/);
    return match?.[1] || '';
  }

  function hasProfile(doc) {
    return [...doc.querySelectorAll('.logininfo a[href]')].some((link) => {
      const url = safeUrl(link.getAttribute('href'));
      return /\/user\/(profile|view)\.php(?:\?|$)/.test(url);
    });
  }

  async function request(path, version, options = {}) {
    assertCurrent(version);
    const url = safeUrl(path);
    if (!url) throw error('CITEL 请求地址无效');
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options, signal: AbortSignal.timeout(30000) });
    assertCurrent(version);
    if (!response.ok) throw error(`CITEL 请求失败（HTTP ${response.status}）`);
    const html = await response.text();
    assertCurrent(version);
    return html;
  }

  async function page(path, version) {
    const html = await request(path, version);
    const doc = parse(html);
    if (isLoginPage(doc)) throw loginRequired();
    const notice = text(doc.querySelector('.errorcode, .errorbox, [data-rel="fatalerror"]'));
    if (notice) throw error(notice);
    return { html, doc };
  }

  async function authenticate(username, password, version) {
    username = String(username || '').trim();
    if (!username) throw error('请输入 CITEL 用户名');
    global.BjtuCitelParticipants?.clear();
    const login = parse(await request('login/index.php', version));
    const token = login.querySelector('input[name="logintoken"]')?.value;
    if (!token) {
      if (hasProfile(login) && !isLoginPage(login)) return;
      throw error('CITEL 登录页未找到 logintoken');
    }
    const body = new URLSearchParams({ username, password: password || `${username}@Bjtu`, anchor: '', rememberusername: '1', logintoken: token });
    const html = await request('login/index.php', version, { method: 'POST', body });
    const doc = parse(html);
    if (isLoginPage(doc) || /登录无效|invalid login/i.test(text(doc.body))) {
      throw error(text(doc.querySelector('.loginerrors, #loginerrormessage, .alert-danger, [role="alert"]')) || 'CITEL 登录无效，请检查用户名和密码', 'LOGIN_REQUIRED');
    }
    // A successful POST may redirect; validate the authenticated home separately.
    const home = await page(BASE, version);
    if (!hasProfile(home.doc) || !readSesskey(home.html)) throw loginRequired();
    await chrome.storage.local.set({ citelUsername: username });
  }

  // Moodle's Chinese dates are not reliably accepted by Date.parse. All dates on
  // this Beijing platform are interpreted in Asia/Shanghai, independent of OS TZ.
  function parseDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})(?:\s*日)?[\s\S]*?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      let hour = Number(match[4]);
      if (/下午|PM/i.test(raw) && hour < 12) hour += 12;
      if (/上午|AM/i.test(raw) && hour === 12) hour = 0;
      const pad = (n) => String(n).padStart(2, '0');
      const result = Date.parse(`${match[1]}-${pad(match[2])}-${pad(match[3])}T${pad(hour)}:${match[5]}:${match[6] || '00'}+08:00`);
      return Number.isFinite(result) ? result : 0;
    }
    if (!raw || !/\d{4}/.test(raw)) return 0;
    const result = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}\s*$|GMT|UTC/.test(raw) ? raw : `${raw} GMT+0800`);
    return Number.isFinite(result) ? result : 0;
  }

  function readDates(root) {
    const rows = [...(root?.querySelectorAll('tr, [data-region="activity-date"], .activity-dates > div, [data-region="activity-dates"] > div') || [])];
    const lines = (rows.length ? rows.map(text) : [text(root)]).filter(Boolean);
    const find = (label, discount = false) => {
      for (const line of lines) {
        if (!discount && /折扣|discount/i.test(line)) continue;
        const found = line.match(label);
        if (!found) continue;
        const value = parseDate(line.slice(found.index + found[0].length));
        if (value) return value;
      }
      return 0;
    };
    return {
      startTime: find(/开始提交|开启时间|开放时间|开始时间|opens?|submission open(?:s| from)?/i),
      deadline: find(/提交截止|关闭时间|截止时间|closes?|submission deadline/i),
      assessmentEnd: find(/评分结束|评估结束|assessment end/i),
      discountTime: find(/折扣(?:时间)?|discount(?: time)?/i, true)
    };
  }

  function parseActivities(doc, courseUrl, types) {
    const seen = new Set();
    return [...doc.querySelectorAll('li.activity')].flatMap((node) => {
      const link = node.querySelector('a.aalink, .aalink[href]');
      const url = safeUrl(link?.getAttribute('href') || '', courseUrl);
      const type = url.match(/\/mod\/([^/]+)\//)?.[1];
      const id = url ? new URL(url).searchParams.get('id') : '';
      if (!id || !TYPES[type] || !types.has(type) || seen.has(`${type}:${id}`)) return [];
      seen.add(`${type}:${id}`);
      const titleNode = (node.querySelector('.instancename') || link)?.cloneNode(true);
      titleNode?.querySelectorAll('.accesshide, .sr-only').forEach((n) => n.remove());
      return [{ id, type, typeLabel: TYPES[type], title: text(titleNode) || TYPES[type], url,
        ...readDates(node.querySelector('[data-region="activity-dates"], .activity-dates')), description: '', done: false,
        statusKnown: false, actionable: type === 'workshop' || type === 'programming' }];
    });
  }

  async function loadTask(task, version) {
    if (!task.actionable) return;
    const { doc } = await page(task.url, version);
    if (task.type === 'workshop') {
      const own = doc.querySelector('.ownsubmission');
      task.done = !!own?.querySelector('.submission-summary');
      if (!task.done && !/您还没有提交您的作品|添加提交/.test(text(own))) throw error('互评页面缺少明确的本人提交状态');
      task.description = text(doc.querySelector('#intro, .generalbox .no-overflow'));
      const dates = readDates(doc.querySelector('[data-region="activity-dates"], .activity-dates'));
      for (const field of ['startTime', 'deadline', 'assessmentEnd']) if (dates[field]) task[field] = dates[field];
    } else {
      const description = doc.querySelector('#description');
      task.description = text(description);
      task.descriptionHtml = description?.innerHTML || '';
      const dates = readDates(doc.querySelector('#time-table'));
      Object.assign(task, dates);
      const resultUrl = [...doc.querySelectorAll('.nav-item a.nav-link[href]')]
        .map((link) => safeUrl(link.getAttribute('href'), task.url))
        .find((url) => url && new URL(url).pathname === '/mlsv3/mod/programming/result.php');
      if (!resultUrl) throw error('编程练习页面未找到结果链接');
      // A programming result can legitimately contain .errorbox/.errorcode
      // (for example compiler errors). Those are submission results, not a
      // failed Moodle page request, and must not leave its status unknown.
      const result = parse(await request(resultUrl, version));
      if (isLoginPage(result)) throw loginRequired();
      task.done = !/找不到您的程序/.test(text(result.body));
    }
    task.statusKnown = true;
  }

  async function pool(items, callback) {
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (index < items.length) await callback(items[index++]);
    }));
  }

  async function enrolledCourses(version, stored) {
    let home;
    try { home = await page(BASE, version); } catch (e) {
      const autoLoginUsername = stored.citelLoginUsername || stored.citelUsername;
      if (e.code !== 'LOGIN_REQUIRED' || !autoLoginUsername || stored.citelAutoLoginOnExpiry === false) throw e;
      await authenticate(autoLoginUsername, '', version);
      home = await page(BASE, version);
    }
    const sesskey = readSesskey(home.html);
    if (!hasProfile(home.doc) || !sesskey) throw loginRequired();
    const profile = [...home.doc.querySelectorAll('.logininfo a[href]')]
      .map((link) => safeUrl(link.getAttribute('href')))
      .find((url) => /\/user\/(profile|view)\.php(?:\?|$)/.test(url));
    global.BjtuCitelParticipants?.setAccount(profile);
    const result = [];
    const ids = new Set();
    let offset = 0;
    for (;;) {
      const body = JSON.stringify([{ index: 0, methodname: 'core_course_get_enrolled_courses_by_timeline_classification',
        args: { classification: 'all', limit: 100, offset, sort: 'fullname', customfieldname: '', customfieldvalue: '' } }]);
      const response = JSON.parse(await request(`lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_course_get_enrolled_courses_by_timeline_classification`, version,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
      const entry = response?.[0];
      if (entry?.error) throw error(entry.exception?.message || 'CITEL 课程列表请求失败', /notloggedin|requires?login|invalidsesskey/.test(entry.exception?.errorcode || '') ? 'LOGIN_REQUIRED' : '');
      if (!Array.isArray(entry?.data?.courses)) throw error('CITEL 课程列表响应格式无效');
      const batch = entry.data.courses;
      let added = 0;
      for (const course of batch) {
        const id = String(course.id || '');
        if (!id || ids.has(id)) continue;
        ids.add(id); added++;
        result.push({ id, name: text(parse(course.fullname || course.shortname || '').body),
          url: safeUrl(course.viewurl || `course/view.php?id=${encodeURIComponent(id)}`), tasks: [], detailLoaded: false });
      }
      if (!added || batch.length < 100) break;
      offset = Number(entry.data.nextoffset) > offset ? Number(entry.data.nextoffset) : offset + batch.length;
    }
    return result;
  }

  function status(task) {
    if (!task.actionable) return 'resource';
    if (!task.statusKnown) return 'unknown';
    return task.done ? 'submitted' : (task.deadline && task.deadline <= Date.now() ? 'overdue' : 'pending');
  }

  function clearCards() {
    env?.courseList?.querySelectorAll('.citel-standalone-card, .citel-login-notice').forEach((n) => n.remove());
    if (env?.courseList) global.BjtuCitelParticipants?.bind(env.courseList);
  }
  const formatTime = (value) => value ? new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }) : '无期限';

  function renderTask(task, course) {
    const state = status(task);
    const done = state === 'submitted';
    const overdue = state === 'overdue' || (!done && task.deadline > 0 && task.deadline <= Date.now());
    const palette = global.BjtuHomeworkUi.homeworkPalette({ done, overdue });
    return global.BjtuHomeworkUi.renderHomeworkCard({
      done, overdue, deadline: task.deadline, className: 'citel-task',
      background: palette.background, border: palette.border,
      headClass: 'citel-task-head', mainClass: 'citel-task-main', actionsClass: 'homework-card-actions citel-task-actions',
      titleHtml: global.BjtuHomeworkUi.titleHtml({ title: task.title, typeLabel: task.typeLabel, href: task.url, typeHref: task.url, color: palette.foreground, escape }),
      metaHtml: global.BjtuHomeworkUi.deadlineMetaHtml({ deadline: task.deadline, formatted: formatTime(task.deadline), startTime: task.startTime, startFormatted: formatTime(task.startTime), done, overdue,
        showCountdown: task.actionable, escape,
        extraTimes: [
          {label:'评分结束', value:task.assessmentEnd, formatted:formatTime(task.assessmentEnd)},
          {label:'折扣时间', value:task.discountTime, formatted:formatTime(task.discountTime)}
        ] }),
      attributes: `data-citel-status="${state}"`,
      actionsHtml: global.BjtuHomeworkUi.renderActionLink({ href: task.url, label: task.actionable ? '前往CITEL提交' : '查看', color: palette.action, className: 'btn', escape }),
      detailHtml: renderDetail(task, course)
    });
  }

  function renderDetail(task, course) {
    let description = escape(task.description || '');
    if (task.descriptionHtml) {
      const fragment = global.BjtuInertHtml.parseFragment(task.descriptionHtml);
      fragment.querySelectorAll('[src],[href]').forEach((node) => {
        for (const attribute of ['src', 'href']) {
          const value = node.getAttribute(attribute);
          if (value) {
            try { node.setAttribute(attribute, new URL(value, task.url).href); }
            catch { node.removeAttribute(attribute); }
          }
        }
      });
      const container = fragment.ownerDocument.createElement('div');
      container.append(fragment);
      description = global.BjtuHomeworkUi.sanitizeRichHtml(container.innerHTML);
    }
    const detail = `${description ? `<div class="citel-task-detail${task.descriptionHtml ? '' : ' citel-task-detail-text'}">${description}</div>` : ''}${task.loadError ? `<div class="citel-error">详情加载失败：${escape(task.loadError)}</div>` : ''}`;
    const courseId = `citel-${course.id}`;
    const expandKey = `citel:${task.type}:${task.id}`;
    return env?.renderExpandable ? env.renderExpandable(detail, { courseId, expandKey, expanded: env.isDetailExpanded?.(courseId, expandKey), hideWhenEmpty: true }) : detail;
  }

  function renderCourses() {
    if (!env?.courseList) return;
    const animationSelector = '.citel-standalone-card .hw-card-item';
    const animations = global.BjtuColors?.captureAnimations(env.courseList, animationSelector);
    clearCards();
    courses.forEach((course, index) => {
      const pending = course.tasks.filter((t) => ['pending', 'unknown', 'resource'].includes(status(t)))
        .sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity));
      const group = (kind) => {
        const tasks = course.tasks.filter((t) => status(t) === kind);
        if (!tasks.length) return '';
        const key = `${course.id}:${kind}`;
        const open = expanded.has(key), groupKind = kind === 'submitted' ? 'done' : 'overdue';
        const labels = global.BjtuHomeworkUi.toggleLabels(groupKind);
        const side = '<span class="homework-toggle-side" aria-hidden="true"><span class="homework-toggle-line"></span><span class="homework-toggle-arrow"></span><span class="homework-toggle-line"></span></span>';
        return `<div class="homework-toggle-row homework-toggle-row--${groupKind}"><button type="button" class="btn homework-toggle-btn ${open ? 'is-expanded homework-toggle-btn--up' : 'homework-toggle-btn--down'}" data-citel-toggle="${escape(key)}" data-count="${tasks.length}" data-collapsed-text="${escape(labels.collapsed)}" data-expanded-text="${escape(labels.expanded)}" aria-expanded="${open}">${side}<span class="homework-toggle-label">${escape(open ? labels.expanded : labels.collapsed)} (${tasks.length})</span>${side}</button></div><div class="homework-group homework-group--${groupKind}${open ? '' : ' is-hidden'}" data-citel-group="${escape(key)}" data-expanded="${open ? '1' : '0'}" aria-hidden="${!open}">${tasks.map((task) => renderTask(task, course)).join('')}</div>`;
      };
      const content = pending.map((task) => renderTask(task, course)).join('') + group('overdue') + group('submitted');
      const loadingHtml = global.BjtuHomeworkUi.typeLoadingHtml(course.pendingTypeLabels || [], { escape });
      const card = global.BjtuCourseCardUi.createCourseCard({
        courseId: `citel-${course.id}`, className: 'citel-standalone-card', order: 260000 + index,
        rank: pending.some((t) => t.actionable) ? 0 : course.tasks.some((t) => status(t) === 'overdue') ? 2 : course.tasks.length ? 4 : 7,
        titleHtml: `<a href="${escape(course.url)}" target="_blank" rel="noopener noreferrer">${escape(course.name)}</a>`,
        metaHtml: global.BjtuCitelParticipants?.renderEntrances(course.id) || '',
        contentHtml: `${loadingHtml}${course.loadError ? `<div class="citel-error">${escape(course.loadError)}</div>` : ''}${content || (course.detailLoaded ? '暂无所选类型活动' : '')}`,
        headerClass: 'citel-course-head', identityClass: 'course-card-identity', homeworkClass: 'homework-area', includeResultArea: false, wrapActions: false
      });
      env.courseList.appendChild(card);
      global.BjtuCitelParticipants?.bind(card);
    });
    if (animations) global.BjtuColors.restoreAnimations(env.courseList, animations, animationSelector);
    env.updateEmpty?.(); env.sortCourseCards?.(); env.scheduleCache?.(); env.updateCountdowns?.();
  }
  function render() { return global.preserveCoursePlatformScroll ? global.preserveCoursePlatformScroll(renderCourses) : renderCourses(); }

  async function load() {
    const version = ++serial;
    env?.setLoaded?.(false); env?.setState?.('checking');
    try {
      const stored = await chrome.storage.local.get(['citelActivityTypes', 'citelUsername', 'citelLoginUsername', 'citelAutoLoginOnExpiry']);
      const types = new Set(Array.isArray(stored.citelActivityTypes) ? stored.citelActivityTypes : DEFAULT_TYPES);
      const result = await enrolledCourses(version, stored);
      assertCurrent(version); courses = result;
      const selectedTypes = Object.keys(TYPES).filter((type) => types.has(type));
      const progress = new Map(courses.map((course) => [course.id, 0]));
      for (const course of courses) course.pendingTypeLabels = selectedTypes.map((type) => TYPES[type]);
      const report = (course, value) => {
        assertCurrent(version); progress.set(course.id, value);
        env?.setProgress?.([...progress.values()].reduce((a, b) => a + b, 0), courses.length);
      };
      env?.setState?.('online'); env?.setProgress?.(0, courses.length); render();
      await pool(courses, async (course) => {
        try {
          const { doc } = await page(course.url, version);
          const tasks = parseActivities(doc, course.url, types);
          for (let typeIndex = 0; typeIndex < selectedTypes.length; typeIndex++) {
            const type = selectedTypes[typeIndex];
            const typedTasks = tasks.filter((task) => task.type === type);
            for (let taskIndex = 0; taskIndex < typedTasks.length; taskIndex++) {
              const task = typedTasks[taskIndex];
              try { await loadTask(task, version); } catch (e) {
                if (e.code === 'cancelled' || e.code === 'LOGIN_REQUIRED') throw e;
                task.loadError = e.message;
              }
              assertCurrent(version); course.tasks.push(task);
              report(course, (typeIndex + (taskIndex + 1) / typedTasks.length) / selectedTypes.length); render();
            }
            course.pendingTypeLabels = course.pendingTypeLabels.filter((label) => label !== TYPES[type]);
            report(course, (typeIndex + 1) / selectedTypes.length); render();
          }
          course.detailLoaded = true;
        } catch (e) {
          if (e.code === 'cancelled' || e.code === 'LOGIN_REQUIRED') throw e;
          course.loadError = e.message; course.pendingTypeLabels = [];
        }
        report(course, 1); render();
      });
      assertCurrent(version); env?.setLoaded?.(true); render();
    } catch (e) {
      if (e.code === 'cancelled' || version !== serial) return;
      if (e.code === 'LOGIN_REQUIRED') {
        const interactive = !!global.platformInteractiveLoginPending?.citel;
        // Invalidate peer workers before the core offline handler clears data.
        serial++; courses = []; clearCards(); global.BjtuCitelParticipants?.clear(); env?.setState?.('offline');
        if (e.message !== 'CITEL 未登录或登录已失效') env?.toast?.(e.message, 'error', 4500);
        if (interactive) void openLogin();
      } else {
        serial++; env?.setLoaded?.(false); env?.setProgress?.(0, 0);
        env?.toast?.(`CITEL 加载失败：${e.message}`, 'error', 4500);
        if (global.platformLoginState?.citel !== 'online') env?.setState?.('offline');
      }
    }
  }

  async function login(args = {}) {
    const version = ++serial;
    await authenticate(args.username, args.password, version);
    if (typeof global.isPlatformEnabled === 'function' && !global.isPlatformEnabled('citel')) {
      global.togglePlatformSelection('citel', { interactive: false });
      await global.platformLoadPromises?.citel;
    } else if (typeof global.triggerExternalPlatformLoad === 'function') {
      await global.triggerExternalPlatformLoad('citel', true);
    } else await load();
    return { loggedIn: global.platformLoginState?.citel === 'online', ready: !!global.platformLoadedOnce?.citel, loginState: global.platformLoginState?.citel };
  }

  function openLogin() {
    if (loginPromise) return loginPromise;
    loginPromise = (async () => {
      const stored = await chrome.storage.local.get(['citelUsername', 'citelLoginUsername']);
      const dialog = document.createElement('dialog');
      loginDialog = dialog; dialog.className = 'citel-login-dialog version-modal-card platform-qr-login-card';
      dialog.setAttribute('aria-labelledby', 'citel-login-title');
      dialog.innerHTML = `<div class="version-modal-header"><div class="citel-login-title" id="citel-login-title">登录 CITEL</div><button type="button" class="btn version-close-btn" data-citel-cancel aria-label="关闭" title="关闭">×</button></div><div class="platform-qr-login-body citel-login-body"><form class="citel-login-form"><label>用户名<input name="username" autocomplete="username" required value="${escape(stored.citelLoginUsername || stored.citelUsername || '')}"></label><label>密码<input name="password" type="password" autocomplete="current-password" placeholder="留空使用 用户名@Bjtu"></label><p class="citel-login-tip">密码仅用于本次登录，不保存。</p><p class="citel-error" role="alert"></p><button type="submit" class="btn citel-login-submit">登录</button></form></div>`;
      document.body.appendChild(dialog); dialog.showModal();
      dialog.querySelector('input[name="username"]')?.focus();
      await new Promise((resolve) => {
        dialog.addEventListener('close', resolve, { once: true });
        dialog.querySelector('[data-citel-cancel]').addEventListener('click', () => { serial++; dialog.close(); });
        dialog.addEventListener('cancel', () => { serial++; });
        let backdropPressed = false;
        const isBackdrop = (event) => {
          const rect = dialog.getBoundingClientRect();
          return event.target === dialog
            && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
        };
        dialog.addEventListener('pointerdown', (event) => { backdropPressed = isBackdrop(event); });
        dialog.addEventListener('pointerup', (event) => {
          if (backdropPressed && isBackdrop(event)) { serial++; dialog.close(); }
          backdropPressed = false;
        });
        dialog.querySelector('form').addEventListener('submit', async (event) => {
          event.preventDefault(); const button = dialog.querySelector('[type="submit"]');
          button.disabled = true;
          try {
            const data = new FormData(event.target);
            const result = await login({ username: data.get('username'), password: data.get('password') });
            if (!result.loggedIn) throw error('CITEL 登录或加载失败，请重试');
            dialog.close();
          } catch (e) { dialog.querySelector('[role="alert"]').textContent = e.message; }
          finally { button.disabled = false; }
        });
      });
      dialog.remove(); loginDialog = null;
    })().finally(() => { loginPromise = null; });
    return loginPromise;
  }

  async function ready() {
    if (global.platformLoginState?.citel !== 'online') throw loginRequired();
    if (global.waitForPlatformDataReady && !await global.waitForPlatformDataReady('citel', 120000)) throw error('CITEL 课程与活动尚未加载完毕');
  }
  const pageApi = {
    ...global.BjtuCitelParticipants?.pageApi,
    status: () => ({ loginState: global.platformLoginState?.citel || 'unselected', loggedIn: global.platformLoginState?.citel === 'online', loaded: !!global.platformLoadedOnce?.citel }),
    async courseList() { await ready(); return courses.map(({ id, name, url, tasks, loadError }) => ({ courseId: id, name, url, taskCount: tasks.length, loadError })); },
    async homework_of_(args) {
      await ready(); const course = courses.find((c) => c.id === String(args?.courseId || ''));
      if (!course) throw error('课程ID无效，请先调用 citel.courseList');
      return { courseId: course.id, name: course.name, loadError: course.loadError,
        homework: course.tasks.map((task) => ({ ...task, status: status(task), overdue: status(task) === 'overdue', actionUrl: task.url })) };
    },
    async login(args = {}) {
      if (global.platformLoginState?.citel === 'online' && global.platformLoadedOnce?.citel) return { ok: true };
      try {
        if (args.username) await login(args);
        else await openLogin();
        if (global.platformLoginState?.citel === 'online' && global.platformLoadedOnce?.citel) return { ok: true };
      } catch (e) {
        if (e.code !== 'cancelled') env?.toast?.(e.message, 'error', 4500);
      }
      return { ok: false, message: '登录失败' };
    }
  };

  global.BjtuCitelPlatform = {
    init(context) {
      env = context;
      global.BjtuCitelParticipants?.init({page: (path) => page(path, serial), ready, getCourses: () => courses});
      env.courseList?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-citel-toggle]');
        if (!button) return;
        const key = button.dataset.citelToggle;
        const open = !expanded.has(key);
        open ? expanded.add(key) : expanded.delete(key);
        const group = button.closest('.citel-standalone-card')?.querySelector(`[data-citel-group="${CSS.escape(key)}"]`);
        if (!group || !env.animateHomeworkGroupVisibility) { render(); return; }
        button.classList.toggle('is-expanded', open);
        button.classList.toggle('homework-toggle-btn--up', open);
        button.classList.toggle('homework-toggle-btn--down', !open);
        button.setAttribute('aria-expanded', String(open));
        button.querySelector('.homework-toggle-label').textContent = `${open ? button.dataset.expandedText : button.dataset.collapsedText} (${button.dataset.count})`;
        group.dataset.expanded = open ? '1' : '0';
        group.setAttribute('aria-hidden', String(!open));
        void env.animateHomeworkGroupVisibility(group, open);
        env.scheduleCache?.();
      });
    },
    load, render, login, openLogin,
    clear() { serial++; courses = []; expanded.clear(); if (!global.isPlatformEnabled?.('citel')) loginDialog?.close(); clearCards(); global.BjtuCitelParticipants?.clear(); env?.setProgress?.(0, 0); },
    getCourses: () => courses,
    async fetchBackgroundCourses(stored = {}) {
      const version = ++serial;
      // Offscreen documents only expose chrome.runtime; keep settings and writes
      // in the worker, and never initiate an unattended credential login here.
      const result = await enrolledCourses(version, { ...stored, citelAutoLoginOnExpiry: false });
      const types = new Set(Array.isArray(stored.citelActivityTypes) ? stored.citelActivityTypes : DEFAULT_TYPES);
      await pool(result, async (course) => {
        const { doc } = await page(course.url, version);
        course.tasks = parseActivities(doc, course.url, types);
        for (const task of course.tasks) await loadTask(task, version);
      });
      return result;
    },
    restore(value) { courses = Array.isArray(value) ? value : []; },
    themeColor: '#F98012',
    // Pure parsers are also used by offline fixture tests.
    parsers: Object.freeze({ parseDate, readDates, parseActivities, readSesskey, isLoginPage, hasProfile, status })
  };
  global.BjtuCitelPageApi = Object.freeze(pageApi);
  if (typeof document !== 'undefined' && global.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!env || message?.type !== 'PAGE_API' || message?.payload?.module !== 'citel') return false;
      const fn = Object.hasOwn(pageApi, message.payload.fn) ? pageApi[message.payload.fn] : null;
      Promise.resolve().then(() => {
        if (typeof fn !== 'function') throw error('CITEL 页面接口不存在');
        return fn(message.payload.args || {});
      }).then((value) => sendResponse({ ok: true, value }), (e) => sendResponse({ ok: false, error: e.message, code: e.code || '' }));
      return true;
    });
  }
})(globalThis);
