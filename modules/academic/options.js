(function initAcademicOptionsModule(global) {
  'use strict';

  const DEFAULT_MONITOR_INTERVAL_MINUTES = 1;
  const DEFAULT_CLASS_REMINDER_LEAD_MINUTES = 10;
  const MAX_INTERVAL_MINUTES = 525600;
  const ASSESSMENT_SCRIPT_ID = 'assessment-satisfied';
  const ASSESSMENT_SCRIPT_STORAGE_KEY = 'academicAssessmentExternalScriptEnabled';
  const ASSESSMENT_SCRIPT_PATH = 'modules/academic/external/assessment-satisfied.user.js';
  const ASSESSMENT_SCRIPT_URL = 'https://update.greasyfork.org/scripts/537626/BJTU%20%E5%8C%97%E4%BA%AC%E4%BA%A4%E9%80%9A%E5%A4%A7%E5%AD%A6%20%E4%B8%80%E9%94%AE%E8%AF%84%E6%95%99%E4%B8%BA%E2%80%9C%E9%9D%9E%E5%B8%B8%E6%BB%A1%E6%84%8F%E2%80%9D%E5%B9%B6%E5%A1%AB%E5%86%99%E4%B8%BB%E8%A7%82%E6%84%8F%E8%A7%81.user.js';
  const DEFAULTS = Object.freeze({
    academicScoreMonitorEnabled: false,
    academicExamMonitorEnabled: false,
    academicClassReminderEnabled: false,
    academicClassReminderLeadMinutes: DEFAULT_CLASS_REMINDER_LEAD_MINUTES,
    academicScoreMonitorIntervalMinutes: DEFAULT_MONITOR_INTERVAL_MINUTES,
    academicScheduleType: 'semester',
    academicScheduleWeek: 'all'
  });

  let initialized = false;
  let context = null;
  let scheduleData = null;
  let setMessage = () => {};
  let assessmentScriptInstalled = false;
  let assessmentScriptEnabled = false;
  let assessmentScriptBusy = false;
  let assessmentScriptReady = false;

  const element = (id) => document.getElementById(id);
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload })
    .catch((error) => ({ ok: false, message: String(error?.message || error) }));

  async function getUpdaterManager() {
    const ready = await global.__bjtuUpdaterReady;
    const manager = ready && global.BjtuUpdaterModuleManager;
    if (!manager?.requestDirectory || !manager?.managedFileExists
        || !manager?.writeManagedFile || !manager?.readManagedFile || !manager?.removeManagedFile) {
      throw new Error('更新组件不可用，无法管理外部脚本');
    }
    return manager;
  }

  function setAssessmentScriptStatus(text, error = false) {
    const status = element('academicAssessmentScriptStatus');
    if (!(status instanceof HTMLElement)) return;
    status.textContent = String(text || '');
    status.classList.toggle('error', error);
  }

  function formatExternalScriptBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    return `${parseFloat((bytes / 1024).toFixed(2))} KB`;
  }

  function setAssessmentScriptProgress({ visible = true, loaded = 0, total = 0, label = '正在下载…' } = {}) {
    const container = element('academicAssessmentScriptProgress');
    const bar = element('academicAssessmentScriptProgressBar');
    const labelElement = container?.querySelector('.academic-external-script-progress-label');
    if (!(container instanceof HTMLElement) || !(bar instanceof HTMLElement)) return;
    container.hidden = !visible;
    if (labelElement instanceof HTMLElement) labelElement.textContent = label;
    if (!visible) {
      container.classList.remove('is-indeterminate');
      bar.style.width = '0';
      return;
    }
    const determinate = Number(total) > 0;
    container.classList.toggle('is-indeterminate', !determinate);
    bar.style.width = determinate ? `${Math.min(100, Number(loaded) / Number(total) * 100)}%` : '';
  }

  function renderAssessmentScriptState() {
    const checkbox = element('academicAssessmentScriptEnabled');
    const download = element('academicAssessmentScriptDownload');
    const checkUpdate = element('academicAssessmentScriptCheckUpdate');
    const deleteButton = element('academicAssessmentScriptDelete');
    if (checkbox instanceof HTMLInputElement) {
      checkbox.disabled = assessmentScriptBusy || !assessmentScriptReady;
      checkbox.checked = assessmentScriptEnabled;
    }
    if (download instanceof HTMLButtonElement) {
      download.hidden = assessmentScriptInstalled;
      download.disabled = assessmentScriptBusy || !assessmentScriptReady;
      download.textContent = assessmentScriptBusy ? '处理中…' : '下载';
    }
    if (checkUpdate instanceof HTMLButtonElement) {
      checkUpdate.hidden = !assessmentScriptInstalled;
      checkUpdate.disabled = assessmentScriptBusy;
    }
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.hidden = !assessmentScriptInstalled;
      deleteButton.disabled = assessmentScriptBusy || assessmentScriptEnabled;
    }
    if (!assessmentScriptBusy) {
      setAssessmentScriptStatus(assessmentScriptInstalled ? '已下载' : '未下载');
    }
  }

  async function runtimeAssessmentScriptExists() {
    try {
      return (await fetch(chrome.runtime.getURL(ASSESSMENT_SCRIPT_PATH), { cache: 'no-store' })).ok;
    } catch {
      return false;
    }
  }

  async function refreshAssessmentScriptState() {
    const stored = await chrome.storage.local.get([ASSESSMENT_SCRIPT_STORAGE_KEY]);
    let directoryReady = false;
    try {
      const manager = await getUpdaterManager();
      directoryReady = await manager.managedFileExists(ASSESSMENT_SCRIPT_PATH);
    } catch {
      // Runtime visibility is enough to display an already installed script.
    }
    assessmentScriptInstalled = directoryReady || await runtimeAssessmentScriptExists();
    assessmentScriptEnabled = assessmentScriptInstalled && stored[ASSESSMENT_SCRIPT_STORAGE_KEY] === true;
    if (!assessmentScriptInstalled && stored[ASSESSMENT_SCRIPT_STORAGE_KEY] === true) {
      assessmentScriptEnabled = false;
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
    }
    assessmentScriptReady = true;
    renderAssessmentScriptState();
  }

  function validateAssessmentScript(source) {
    const text = String(source || '');
    if (text.length < 500 || text.length > 500000
        || !text.includes('// ==UserScript==')
        || !/@match\s+https:\/\/aa\.bjtu\.edu\.cn\/teaching_assessment\/stu\*/.test(text)
        || !text.includes('一键非常满意')
        || !text.includes('function autoSelect()')) {
      throw new Error('下载内容不是预期的一键评教脚本');
    }
    return text;
  }

  async function reloadAcademicOptionsPage() {
    const currentTab = await chrome.tabs.getCurrent().catch(() => null);
    const standalone = /\/modules\/academic\/options\.html$/i.test(location.pathname);
    const result = await send('RELOAD_EXTENSION_AND_OPEN_APP', {
      reopenApp: true,
      source: ASSESSMENT_SCRIPT_ID,
      sourceTabId: Number(currentTab?.id) || null,
      targetPath: standalone ? 'modules/academic/options.html' : 'options/options.html'
    });
    if (!result?.ok) throw new Error(result?.message || '无法重新加载扩展');
  }

  async function fetchAssessmentScript(onProgress) {
    const response = await fetch(ASSESSMENT_SCRIPT_URL, { cache: 'no-store', redirect: 'follow' });
    if (!response.ok) throw new Error(`GreasyFork 下载失败：HTTP ${response.status}`);
    const total = Math.max(0, Number(response.headers.get('content-length') || 0));
    if (!response.body?.getReader) {
      const text = await response.text();
      onProgress?.({ loaded: new TextEncoder().encode(text).byteLength, total });
      return validateAssessmentScript(text);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return validateAssessmentScript(new TextDecoder().decode(bytes));
  }

  async function downloadAssessmentScript({ enableAfterDownload = false } = {}) {
    if (assessmentScriptBusy || assessmentScriptInstalled) return;
    assessmentScriptBusy = true;
    assessmentScriptEnabled = enableAfterDownload;
    renderAssessmentScriptState();
    setAssessmentScriptStatus('正在请求扩展目录写入权限…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      setAssessmentScriptStatus('正在从 GreasyFork 下载…');
      setAssessmentScriptProgress({ visible: true });
      const source = await fetchAssessmentScript(({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setAssessmentScriptProgress({
          visible: true,
          loaded,
          total,
          label: `正在下载：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      await manager.writeManagedFile(root, ASSESSMENT_SCRIPT_PATH, new TextEncoder().encode(source));
      assessmentScriptInstalled = true;
      assessmentScriptEnabled = enableAfterDownload;
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: enableAfterDownload });
      setAssessmentScriptProgress({ visible: false });
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      if (enableAfterDownload) {
        setAssessmentScriptStatus('已下载，正在启用并重新加载扩展…');
        await reloadAcademicOptionsPage();
      } else {
        setMessage('「注入一键评教按钮」已下载');
      }
    } catch (error) {
      assessmentScriptBusy = false;
      assessmentScriptEnabled = false;
      setAssessmentScriptProgress({ visible: false });
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本下载失败：${String(error?.message || error)}`, false);
    }
  }

  async function setAssessmentScriptEnabled(enabled) {
    if (assessmentScriptBusy || !assessmentScriptReady) return;
    if (enabled && !assessmentScriptInstalled) {
      await downloadAssessmentScript({ enableAfterDownload: true });
      return;
    }
    assessmentScriptBusy = true;
    assessmentScriptEnabled = enabled;
    renderAssessmentScriptState();
    if (enabled) {
      try {
        await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: true });
        assessmentScriptBusy = false;
        renderAssessmentScriptState();
        setAssessmentScriptStatus('正在启用并重新加载扩展…');
        await reloadAcademicOptionsPage();
      } catch (error) {
        await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
        assessmentScriptEnabled = false;
        assessmentScriptBusy = false;
        renderAssessmentScriptState();
        setAssessmentScriptStatus(String(error?.message || error), true);
      }
      return;
    }

    try {
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
      const result = await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      if (!result?.ok) throw new Error(result?.message || '脚本注销失败');
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      setMessage('已停用「注入一键评教按钮」，可点击「删除」卸载');
    } catch (error) {
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: true });
      assessmentScriptEnabled = true;
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本停用失败：${String(error?.message || error)}`, false);
    }
  }

  async function deleteAssessmentScript() {
    if (assessmentScriptBusy || !assessmentScriptInstalled || assessmentScriptEnabled) return;
    assessmentScriptBusy = true;
    renderAssessmentScriptState();
    setAssessmentScriptStatus('正在删除…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      await manager.removeManagedFile(root, ASSESSMENT_SCRIPT_PATH);
      await chrome.storage.local.set({ [ASSESSMENT_SCRIPT_STORAGE_KEY]: false });
      await send('SYNC_OPTIONAL_CONTENT_SCRIPTS');
      assessmentScriptInstalled = false;
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      setAssessmentScriptStatus('已删除，正在重新加载扩展…');
      await reloadAcademicOptionsPage();
    } catch (error) {
      assessmentScriptBusy = false;
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`外部脚本删除失败：${String(error?.message || error)}`, false);
    }
  }

  async function checkAssessmentScriptUpdate() {
    if (assessmentScriptBusy || !assessmentScriptInstalled) return;
    assessmentScriptBusy = true;
    renderAssessmentScriptState();
    setAssessmentScriptStatus('正在检查更新…');
    try {
      const manager = await getUpdaterManager();
      const root = await manager.requestDirectory();
      const current = await (await manager.readManagedFile(root, ASSESSMENT_SCRIPT_PATH)).text();
      setAssessmentScriptProgress({ visible: true, label: '正在从 GreasyFork 检查更新…' });
      const latest = await fetchAssessmentScript(({ loaded, total }) => {
        const percent = total > 0 ? `${Math.round(loaded / total * 100)}% · ` : '';
        setAssessmentScriptProgress({
          visible: true,
          loaded,
          total,
          label: `正在检查：${percent}${formatExternalScriptBytes(loaded)}${total > 0 ? ` / ${formatExternalScriptBytes(total)}` : ''}`
        });
      });
      const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').trim();
      if (normalize(current) === normalize(latest)) {
        assessmentScriptBusy = false;
        setAssessmentScriptProgress({ visible: false });
        renderAssessmentScriptState();
        setAssessmentScriptStatus('已下载（已是最新）');
        return;
      }
      await manager.writeManagedFile(root, ASSESSMENT_SCRIPT_PATH, new TextEncoder().encode(latest));
      assessmentScriptBusy = false;
      setAssessmentScriptProgress({ visible: false });
      renderAssessmentScriptState();
      setAssessmentScriptStatus(assessmentScriptEnabled
        ? '已下载（已更新，重新启用后生效）'
        : '已下载（已更新）');
      setMessage(assessmentScriptEnabled
        ? '一键评教脚本已更新，请取消勾选后重新启用'
        : '一键评教脚本已更新');
    } catch (error) {
      assessmentScriptBusy = false;
      setAssessmentScriptProgress({ visible: false });
      renderAssessmentScriptState();
      setAssessmentScriptStatus(String(error?.message || error), true);
      setMessage(`检查外部脚本更新失败：${String(error?.message || error)}`, false);
    }
  }

  function isRetryableAcademicLoadFailure(result) {
    const status = Number(result?.status || result?.httpStatus || 0);
    const message = String(result?.message || result?.error || '');
    return status === 503 || /(?:^|\D)503(?:\D|$)/i.test(message) || /Failed to fetch/i.test(message);
  }

  async function sendAcademicLoadWithRetry(type, payload, label, notify = false) {
    while (true) {
      const result = await send(type, payload);
      if (!isRetryableAcademicLoadFailure(result)) return result;
      if (notify) setMessage(`${label}暂时不可用，1 秒后自动重试…`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  function normalizeMinutes(value, fallback) {
    const minutes = Math.round(Number(value));
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_INTERVAL_MINUTES
      ? minutes
      : fallback;
  }

  function intervalParts(value, fallback) {
    const minutes = normalizeMinutes(value, fallback);
    for (const unit of [1440, 60]) {
      if (minutes % unit === 0) return { value: minutes / unit, unit };
    }
    return { value: minutes, unit: 1 };
  }

  function setIntervalEditor(prefix, value, fallback) {
    const parts = intervalParts(value, fallback);
    const input = element(`${prefix}Value`);
    const select = element(`${prefix}Unit`);
    if (input instanceof HTMLInputElement) input.value = String(parts.value);
    if (select instanceof HTMLSelectElement) select.value = String(parts.unit);
  }

  function readIntervalEditor(prefix, fallback) {
    const value = Number(element(`${prefix}Value`)?.value);
    const unit = Number(element(`${prefix}Unit`)?.value);
    return normalizeMinutes(value * unit, fallback);
  }

  function bindIntervalEditor(prefix, key, fallback, label) {
    const save = async () => {
      const minutes = readIntervalEditor(prefix, fallback);
      await chrome.storage.local.set({ [key]: minutes });
      setIntervalEditor(prefix, minutes, fallback);
      setMessage(`已将${label}设为 ${minutes} 分钟`);
    };
    element(`${prefix}Value`)?.addEventListener('change', save);
    element(`${prefix}Unit`)?.addEventListener('change', save);
  }

  function updateDisabledState() {
    const monitorEnabled = ['academicScoreMonitorEnabled', 'academicExamMonitorEnabled', 'academicClassReminderEnabled']
      .some((id) => element(id)?.checked);
    const monitorEditor = element('academicScoreMonitorIntervalEditor');
    monitorEditor?.classList.toggle('is-disabled', !monitorEnabled);
    monitorEditor?.querySelectorAll('input,select').forEach((control) => {
      control.disabled = !monitorEnabled;
    });
    const reminderEnabled = element('academicClassReminderEnabled')?.checked === true;
    const reminderEditor = element('academicClassReminderLeadEditor');
    reminderEditor?.classList.toggle('is-disabled', !reminderEnabled);
    reminderEditor?.querySelectorAll('input,select').forEach((control) => {
      control.disabled = !reminderEnabled;
    });
  }

  function renderAccounts(value) {
    const select = element('academicAccountSelect');
    if (!(select instanceof HTMLSelectElement)) return;
    const accounts = Array.isArray(value?.accounts) ? value.accounts : [];
    const selected = String(value?.studentId || '');
    select.replaceChildren();
    if (!accounts.length) {
      select.append(new Option('暂无已保存账号', ''));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    for (const account of accounts) {
      const id = String(account?.studentId || '');
      const option = new Option([id, account?.userName].filter(Boolean).join(' '), id);
      option.disabled = !account?.hasPassword && id !== selected;
      select.append(option);
    }
    select.value = accounts.some((account) => String(account?.studentId) === selected)
      ? selected
      : String(accounts[0]?.studentId || '');
  }

  function renderCheckedAt(target, value) {
    if (!(target instanceof HTMLTimeElement)) return;
    const date = new Date(Number(value || 0));
    target.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
  }

  function renderEmptyDataStatus(target, bodyId, loadingId, message) {
    if (!(target instanceof HTMLElement)) return;
    const loading = element(loadingId);
    if (loading instanceof HTMLElement && loading.style.display !== 'none') {
      target.style.display = 'none';
      target.textContent = '';
      return;
    }
    const empty = element(bodyId)?.childElementCount === 0;
    target.style.display = empty ? 'block' : 'none';
    target.textContent = empty ? message : '';
  }

  function renderMonitorStatus(status) {
    const target = element('academicSystemStatus');
    if (!(target instanceof HTMLElement) || !status) return;
    if (status.status === 'error') {
      target.style.display = 'block';
      target.textContent = `成绩检查失败：${status.error || '未知错误'}`;
    } else if (status.status === 'complete' || status.status === 'ok') {
      renderEmptyDataStatus(target, 'academicScoreTableBody', 'academicScoreLoading', '暂无成绩数据');
      renderCheckedAt(element('academicScoreCheckedAt'), status.checkedAt);
    }
  }

  function renderExamStatus(status) {
    const target = element('academicExamStatus');
    if (!(target instanceof HTMLElement)) return;
    if (!status) {
      renderEmptyDataStatus(target, 'academicExamTableBody', 'academicExamLoading', '暂无考试信息');
      return;
    }
    if (status.status === 'error') {
      target.style.display = 'block';
      target.textContent = `考试信息检查失败：${status.error || '未知错误'}`;
    } else if (status.status === 'retrying') {
      target.style.display = 'none';
      target.textContent = '';
    } else if (status.status === 'complete' || status.status === 'ok') {
      renderEmptyDataStatus(target, 'academicExamTableBody', 'academicExamLoading', '暂无考试信息');
      renderCheckedAt(element('academicExamCheckedAt'), status.checkedAt);
    } else {
      target.style.display = 'none';
      target.textContent = '';
    }
  }

  function renderScores(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const body = element('academicScoreTableBody');
    if (body instanceof HTMLElement) body.replaceChildren();
    element('academicScoreLoading').style.display = 'none';
    element('academicScoreCount').textContent = `共 ${list.length} 项`;
    element('academicScoreTableWrap').style.display = list.length ? 'block' : 'none';
    for (const row of list) {
      const tr = document.createElement('tr');
      [row.sequence, row.academicYear, row.course, row.credit, row.score, row.bonusScore, row.teacher]
        .forEach((value) => {
          const td = document.createElement('td');
          td.textContent = String(value || '-');
          tr.appendChild(td);
        });
      const detailsCell = document.createElement('td');
      if (row.details) {
        const details = document.createElement('details');
        details.className = 'academic-score-details';
        const summary = document.createElement('summary');
        summary.textContent = '详情';
        const content = document.createElement('div');
        content.textContent = String(row.details);
        details.append(summary, content);
        detailsCell.appendChild(details);
      } else {
        detailsCell.textContent = '-';
      }
      tr.appendChild(detailsCell);
      body?.appendChild(tr);
    }
    renderEmptyDataStatus(element('academicSystemStatus'), 'academicScoreTableBody', 'academicScoreLoading', '暂无成绩数据');
  }

  function renderExams(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const body = element('academicExamTableBody');
    if (body instanceof HTMLElement) body.replaceChildren();
    element('academicExamLoading').style.display = 'none';
    element('academicExamCount').textContent = `共 ${list.length} 项`;
    element('academicExamTableWrap').style.display = list.length ? 'block' : 'none';
    const groupSizes = new Map();
    list.forEach((row) => groupSizes.set(row.exam, (groupSizes.get(row.exam) || 0) + 1));
    const renderedGroups = new Set();
    for (const row of list) {
      const tr = document.createElement('tr');
      const sequence = document.createElement('td');
      sequence.textContent = String(row.sequence || '-');
      tr.appendChild(sequence);
      if (!renderedGroups.has(row.exam)) {
        renderedGroups.add(row.exam);
        const exam = document.createElement('td');
        exam.className = 'academic-exam-group-cell';
        exam.rowSpan = groupSizes.get(row.exam) || 1;
        exam.textContent = String(row.exam || '-');
        tr.appendChild(exam);
      }
      const course = document.createElement('td');
      course.textContent = String(row.course || '-');
      tr.appendChild(course);
      const timeLocation = document.createElement('td');
      const lines = String(row.timeLocation || '-').split(/\n+/).filter(Boolean);
      const timeLine = document.createElement('div');
      timeLine.className = 'academic-exam-time-line';
      const timeText = document.createElement('span');
      timeText.textContent = lines[0] || '-';
      timeLine.appendChild(timeText);
      if (Number(row.startAt || 0) > Date.now()) {
        const countdown = document.createElement('span');
        countdown.className = 'deadline-countdown academic-exam-countdown';
        countdown.dataset.deadline = String(row.startAt);
        timeLine.appendChild(countdown);
      }
      timeLocation.appendChild(timeLine);
      if (lines.length > 1) {
        const location = document.createElement('div');
        location.textContent = lines.slice(1).join(' ');
        timeLocation.appendChild(location);
      }
      tr.appendChild(timeLocation);
      [row.method, row.remarks, row.registration, row.status, row.operation].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = String(value || '-');
        tr.appendChild(td);
      });
      body?.appendChild(tr);
    }
    renderEmptyDataStatus(element('academicExamStatus'), 'academicExamTableBody', 'academicExamLoading', '暂无考试信息');
    global.updateAllCountdowns?.();
  }

  function occupiedScheduleWeeks(rows) {
    return new Set((Array.isArray(rows) ? rows : []).flatMap((row) => (
      (Array.isArray(row?.days) ? row.days : []).flatMap((courses) => (
        (Array.isArray(courses) ? courses : []).flatMap((course) => (
          Array.isArray(course?.weeks) ? course.weeks : []
        ))
      ))
    )).map(Number));
  }

  function renderScheduleWeekOptions(data, preferredValue = 'all') {
    const select = element('academicScheduleWeek');
    if (!(select instanceof HTMLSelectElement)) return;
    const currentWeek = Number(data?.currentWeek || 0);
    const labels = data?.weekLabels && typeof data.weekLabels === 'object' ? data.weekLabels : {};
    const occupied = occupiedScheduleWeeks(data?.rows);
    const selection = data?.type === 'selection';
    select.replaceChildren(new Option('全部', 'all'));
    for (const week of Array.isArray(data?.weeks) ? data.weeks : []) {
      const status = selection
        ? (occupied.has(Number(week)) ? '(有课)' : '')
        : String(labels[week] || '').replaceAll('（', '(').replaceAll('）', ')');
      select.append(new Option(`第${week}周${status}${Number(week) === currentWeek ? '(本周)' : ''}`, String(week)));
    }
    select.value = [...select.options].some((option) => option.value === String(preferredValue))
      ? String(preferredValue)
      : 'all';
    const button = element('academicScheduleCurrentWeekBtn');
    if (button instanceof HTMLButtonElement) {
      button.disabled = currentWeek <= 0;
      button.textContent = select.value === String(currentWeek) ? '全部' : '本周';
    }
  }

  function appendScheduleCourse(cell, course) {
    const item = document.createElement('div');
    item.className = 'academic-schedule-course';
    for (const [className, value] of [
      ['academic-schedule-course-code', course?.courseCode || '-'],
      ['academic-schedule-course-name', course?.name || '-'],
      ['academic-schedule-course-detail', [course?.weekText, course?.teacher].filter(Boolean).join(' · ')],
      ['academic-schedule-course-location', course?.location || '-']
    ]) {
      const line = document.createElement('div');
      line.className = className;
      line.textContent = String(value);
      item.appendChild(line);
    }
    if (course?.selectionStatus) {
      const status = document.createElement('span');
      status.className = 'academic-schedule-selection-status';
      status.textContent = String(course.selectionStatus);
      item.appendChild(status);
    }
    cell.appendChild(item);
  }

  function renderSchedule() {
    const rows = Array.isArray(scheduleData?.rows) ? scheduleData.rows : [];
    const selected = element('academicScheduleWeek')?.value;
    const selectedWeek = selected === 'all' ? 0 : Number(selected || 0);
    const body = element('academicScheduleTableBody');
    body?.replaceChildren();
    let courseCount = 0;
    for (const row of rows) {
      const tr = document.createElement('tr');
      const periodCell = document.createElement('td');
      periodCell.className = 'academic-schedule-period';
      const period = document.createElement('strong');
      period.textContent = String(row?.period || '-');
      const time = document.createElement('span');
      time.textContent = String(row?.time || '');
      periodCell.append(period, time);
      tr.appendChild(periodCell);
      for (let day = 0; day < 7; day += 1) {
        const td = document.createElement('td');
        const courses = (Array.isArray(row?.days?.[day]) ? row.days[day] : [])
          .filter((course) => !selectedWeek || (
            Array.isArray(course?.weeks)
            && course.weeks.some((week) => Number(week) === selectedWeek)
          ));
        courseCount += courses.length;
        courses.forEach((course) => appendScheduleCourse(td, course));
        tr.appendChild(td);
      }
      body?.appendChild(tr);
    }
    const visible = rows.length > 0 && (!selectedWeek || courseCount > 0);
    element('academicScheduleLoading').style.display = 'none';
    element('academicScheduleTableWrap').style.display = visible ? 'block' : 'none';
    element('academicScheduleEmpty').style.display = visible ? 'none' : 'block';
    element('academicScheduleEmpty').textContent = selectedWeek ? `第${selectedWeek}周暂无课程` : '暂无课表数据';
  }

  async function refreshContext() {
    const result = await send('ACADEMIC_GET_CONTEXT');
    if (result?.ok) context = result;
    const studentId = element('academicStudentId');
    if (studentId instanceof HTMLInputElement && document.activeElement !== studentId) {
      studentId.value = String(context?.studentId || '');
    }
    element('academicScoreMonitorEnabled').checked = context?.monitorEnabled === true;
    element('academicExamMonitorEnabled').checked = context?.examMonitorEnabled === true;
    element('academicClassReminderEnabled').checked = context?.classReminderEnabled === true;
    renderAccounts(context);
    renderMonitorStatus(context?.monitorStatus);
    renderExamStatus(context?.examMonitorStatus);
    updateDisabledState();
    return context;
  }

  async function loadSchedule() {
    element('academicScheduleLoading').style.display = 'flex';
    element('academicScheduleEmpty').style.display = 'none';
    element('academicScheduleTableWrap').style.display = 'none';
    element('academicScheduleStatus').style.display = 'none';
    element('academicScheduleStatus').textContent = '';
    const type = element('academicScheduleType')?.value === 'selection' ? 'selection' : 'semester';
    const result = await sendAcademicLoadWithRetry(
      'ACADEMIC_LOAD_SCHEDULE',
      { scheduleType: type },
      '课表服务'
    );
    if (!result?.ok) {
      element('academicScheduleLoading').style.display = 'none';
      element('academicScheduleEmpty').style.display = 'block';
      element('academicScheduleStatus').style.display = 'block';
      element('academicScheduleStatus').textContent = result?.code === 'not-logged-in'
        ? '教务系统未登录'
        : `课表读取失败：${result?.message || '未知错误'}`;
      return result;
    }
    scheduleData = result;
    if (result.weekSource === 'bksy') {
      element('academicScheduleStatus').style.display = 'block';
      element('academicScheduleStatus').textContent = '智慧课程平台周次接口未登录，当前周数使用本科生院教学服务平台';
    }
    const stored = await chrome.storage.local.get(['academicScheduleWeek']);
    renderScheduleWeekOptions(result, element('academicScheduleWeek')?.value || stored.academicScheduleWeek || 'all');
    renderSchedule();
    return result;
  }

  async function loadScores() {
    element('academicScoreLoading').style.display = 'flex';
    element('academicScoreTableWrap').style.display = 'none';
    element('academicSystemStatus').style.display = 'none';
    const result = await sendAcademicLoadWithRetry('ACADEMIC_LOAD_SCORES', undefined, '成绩服务');
    if (!result?.ok) {
      element('academicScoreLoading').style.display = 'none';
      element('academicSystemStatus').style.display = 'block';
      element('academicSystemStatus').textContent = result?.code === 'not-logged-in'
        ? '教务系统未登录，请输入账号密码或通过 MIS 登录'
        : `成绩读取失败：${result?.message || '未知错误'}`;
      return result;
    }
    renderScores(result.rows);
    renderCheckedAt(element('academicScoreCheckedAt'), result.checkedAt);
    await refreshContext();
    return result;
  }

  async function loadExams() {
    element('academicExamLoading').style.display = 'flex';
    element('academicExamTableWrap').style.display = 'none';
    element('academicExamStatus').style.display = 'none';
    element('academicExamStatus').textContent = '';
    const result = await sendAcademicLoadWithRetry('ACADEMIC_LOAD_EXAMS', undefined, '考试信息服务', false);
    if (!result?.ok) {
      element('academicExamLoading').style.display = 'none';
      element('academicExamStatus').style.display = 'block';
      element('academicExamStatus').textContent = result?.code === 'not-logged-in'
        ? '教务系统未登录'
        : `考试信息读取失败：${result?.message || '未知错误'}`;
      return result;
    }
    renderExams(result.rows);
    renderCheckedAt(element('academicExamCheckedAt'), result.checkedAt);
    await refreshContext();
    return result;
  }

  function loadAll() {
    return Promise.allSettled([loadSchedule(), loadExams(), loadScores()]);
  }

  function bindEvents() {
    element('academicAssessmentScriptDownload')?.addEventListener('click', () => {
      void downloadAssessmentScript();
    });
    element('academicAssessmentScriptCheckUpdate')?.addEventListener('click', () => {
      void checkAssessmentScriptUpdate();
    });
    element('academicAssessmentScriptDelete')?.addEventListener('click', () => {
      void deleteAssessmentScript();
    });
    element('academicAssessmentScriptEnabled')?.addEventListener('change', (event) => {
      void setAssessmentScriptEnabled(event.currentTarget.checked === true);
    });
    element('academicLoginBtn')?.addEventListener('click', async () => {
      const button = element('academicLoginBtn');
      const studentId = String(element('academicStudentId')?.value || '').trim();
      const password = String(element('academicPassword')?.value || '').trim();
      if (!studentId || !password) return setMessage('请输入学号和身份证号后六位', false);
      button.disabled = true;
      try {
        const result = await send('ACADEMIC_LOGIN_WITH_PASSWORD', { studentId, password });
        if (!result?.ok) throw new Error(result?.message || '登录失败');
        element('academicPassword').value = '';
        await refreshContext();
        await loadAll();
        setMessage(`教务系统账号 ${studentId} 登录成功`);
      } catch (error) {
        setMessage(`教务系统登录失败：${String(error?.message || error)}`, false);
      } finally {
        button.disabled = false;
      }
    });
    element('academicPassword')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        element('academicLoginBtn')?.click();
      }
    });
    element('academicStudentId')?.addEventListener('change', (event) => {
      chrome.storage.local.set({ academicSystemStudentId: String(event.currentTarget.value || '').trim() });
    });
    element('academicAccountSelect')?.addEventListener('change', async (event) => {
      const select = event.currentTarget;
      const studentId = String(event.currentTarget.value || '').trim();
      if (!studentId) return;
      select.disabled = true;
      element('academicStudentId').value = studentId;
      setMessage(`正在切换至教务系统账号 ${studentId}…`);
      try {
        const result = await send('ACADEMIC_SWITCH_ACCOUNT', { studentId });
        if (!result?.ok) {
          setMessage(`切换教务系统账号失败：${result?.message || '未知错误'}`, false);
          await refreshContext();
          return;
        }
        await refreshContext();
        setMessage(`已切换至教务系统账号 ${studentId}`);
        void loadAll();
      } catch (error) {
        setMessage(`切换教务系统账号失败：${String(error?.message || error)}`, false);
        await refreshContext();
      } finally {
        select.disabled = false;
      }
    });
    element('bindAcademicSystemBtn')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      const result = await send('START_ACADEMIC_MIS_LOGIN');
      if (!result?.ok) {
        event.currentTarget.disabled = false;
        setMessage(`打开 MIS 失败：${result?.message || '未知错误'}`, false);
      } else {
        setMessage('已打开 MIS，请完成教务系统登录');
      }
    });
    for (const [id, key, enabledText, disabledText] of [
      ['academicScoreMonitorEnabled', 'academicScoreMonitorEnabled', '已启用本学期成绩监控', '已关闭本学期成绩监控'],
      ['academicExamMonitorEnabled', 'academicExamMonitorEnabled', '已启用考试信息监控', '已关闭考试信息监控'],
      ['academicClassReminderEnabled', 'academicClassReminderEnabled', '已启用上课前通知', '已关闭上课前通知']
    ]) {
      element(id)?.addEventListener('change', async (event) => {
        await chrome.storage.local.set({ [key]: event.currentTarget.checked });
        updateDisabledState();
        setMessage(event.currentTarget.checked ? enabledText : disabledText);
      });
    }
    element('academicScheduleType')?.addEventListener('change', async (event) => {
      await chrome.storage.local.set({ academicScheduleType: event.currentTarget.value });
      await loadSchedule();
    });
    element('academicScheduleWeek')?.addEventListener('change', (event) => {
      const selectedWeek = String(event.currentTarget.value || 'all');
      const button = element('academicScheduleCurrentWeekBtn');
      button.textContent = selectedWeek === String(scheduleData?.currentWeek || '') ? '全部' : '本周';
      renderSchedule();
      chrome.storage.local.set({ academicScheduleWeek: selectedWeek }).catch(() => {});
    });
    element('academicScheduleCurrentWeekBtn')?.addEventListener('click', () => {
      const select = element('academicScheduleWeek');
      const currentWeek = Number(scheduleData?.currentWeek || 0);
      select.value = currentWeek > 0 && select.value !== String(currentWeek) ? String(currentWeek) : 'all';
      select.dispatchEvent(new Event('change'));
    });
    bindIntervalEditor('academicScoreMonitorInterval', 'academicScoreMonitorIntervalMinutes',
      DEFAULT_MONITOR_INTERVAL_MINUTES, '教务信息检查间隔');
    bindIntervalEditor('academicClassReminderLead', 'academicClassReminderLeadMinutes',
      DEFAULT_CLASS_REMINDER_LEAD_MINUTES, '上课前通知提前时间');
  }

  function bindMessages() {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'ACADEMIC_DATA_UPDATED') {
        const payload = message.payload || {};
        if (payload.kind === 'score' || payload.kind === 'scores') {
          renderScores(payload.rows);
          renderCheckedAt(element('academicScoreCheckedAt'), payload.checkedAt);
        } else if (payload.kind === 'exam' || payload.kind === 'exams') {
          renderExams(payload.rows);
          renderCheckedAt(element('academicExamCheckedAt'), payload.checkedAt);
        }
      } else if (message?.type === 'ACADEMIC_SYSTEM_STATUS') {
        const status = message.payload || {};
        if (status.status === 'mis-login-done') {
          element('bindAcademicSystemBtn').disabled = false;
          refreshContext().then(loadAll);
          setMessage(`已通过 MIS 登录教务系统：${status.studentId || ''}${status.userName ? ` ${status.userName}` : ''}`);
        } else if (status.status === 'mis-login-cancelled') {
          element('bindAcademicSystemBtn').disabled = false;
          setMessage('已取消通过 MIS 登录教务系统', false);
        } else {
          refreshContext();
        }
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const key of ['academicScoreMonitorEnabled', 'academicExamMonitorEnabled', 'academicClassReminderEnabled']) {
        if (changes[key] && element(key)) element(key).checked = changes[key].newValue === true;
      }
      if (changes.academicScoreMonitorIntervalMinutes) {
        setIntervalEditor('academicScoreMonitorInterval', changes.academicScoreMonitorIntervalMinutes.newValue,
          DEFAULT_MONITOR_INTERVAL_MINUTES);
      }
      if (changes.academicClassReminderLeadMinutes) {
        setIntervalEditor('academicClassReminderLead', changes.academicClassReminderLeadMinutes.newValue,
          DEFAULT_CLASS_REMINDER_LEAD_MINUTES);
      }
      if (changes.academicSystemStudentId && element('academicStudentId')) {
        element('academicStudentId').value = String(changes.academicSystemStudentId.newValue || '');
      }
      if (changes.academicScoreMonitorStatus) renderMonitorStatus(changes.academicScoreMonitorStatus.newValue);
      if (changes.academicExamMonitorStatus) renderExamStatus(changes.academicExamMonitorStatus.newValue);
      if (changes[ASSESSMENT_SCRIPT_STORAGE_KEY] && !assessmentScriptBusy) {
        assessmentScriptEnabled = assessmentScriptInstalled
          && changes[ASSESSMENT_SCRIPT_STORAGE_KEY].newValue === true;
        renderAssessmentScriptState();
      }
      updateDisabledState();
    });
  }

  async function init(options = {}) {
    if (initialized) return true;
    initialized = true;
    setMessage = typeof options.setMessage === 'function' ? options.setMessage : setMessage;
    const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
    element('academicScoreMonitorEnabled').checked = stored.academicScoreMonitorEnabled === true;
    element('academicExamMonitorEnabled').checked = stored.academicExamMonitorEnabled === true;
    element('academicClassReminderEnabled').checked = stored.academicClassReminderEnabled === true;
    element('academicScheduleType').value = stored.academicScheduleType === 'selection' ? 'selection' : 'semester';
    setIntervalEditor('academicScoreMonitorInterval', stored.academicScoreMonitorIntervalMinutes,
      DEFAULT_MONITOR_INTERVAL_MINUTES);
    setIntervalEditor('academicClassReminderLead', stored.academicClassReminderLeadMinutes,
      DEFAULT_CLASS_REMINDER_LEAD_MINUTES);
    bindEvents();
    bindMessages();
    updateDisabledState();
    void refreshAssessmentScriptState();
    await refreshContext();
    await send('ACADEMIC_PRELOAD_ACCOUNT');
    void loadAll();
    return true;
  }

  async function reset() {
    await chrome.storage.local.set(DEFAULTS);
    if (!initialized) return;
    element('academicScoreMonitorEnabled').checked = false;
    element('academicExamMonitorEnabled').checked = false;
    element('academicClassReminderEnabled').checked = false;
    element('academicScheduleType').value = 'semester';
    element('academicScheduleWeek').value = 'all';
    setIntervalEditor('academicScoreMonitorInterval', DEFAULT_MONITOR_INTERVAL_MINUTES,
      DEFAULT_MONITOR_INTERVAL_MINUTES);
    setIntervalEditor('academicClassReminderLead', DEFAULT_CLASS_REMINDER_LEAD_MINUTES,
      DEFAULT_CLASS_REMINDER_LEAD_MINUTES);
    updateDisabledState();
    if (scheduleData) {
      renderScheduleWeekOptions(scheduleData, 'all');
      renderSchedule();
    }
  }

  global.BjtuAcademicOptions = { init, reset, loadAll };
  global.BjtuOptionsModules?.register('academic', global.BjtuAcademicOptions);
})(globalThis);
