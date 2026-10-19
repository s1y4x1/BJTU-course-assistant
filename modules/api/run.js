(async function () {
  const output = document.getElementById('consoleOutput');
  const input = document.getElementById('commandInput');
  const execute = document.getElementById('executeCommand');
  const status = document.getElementById('consoleStatus');
  const commandHistory = [];
  let historyIndex = 0;
  let draft = '';
  let running = false;
  const help = [
    'api.operationList()                 获取操作列表',
    'help ve.login ykt.assignments       获取指定操作说明',
    "api.getDocs({module:'ve'})          获取模块操作说明",
    'reminder.enabled(true)             开启提醒',
    'reminder.enabled(false)            关闭提醒',
    'clear                             清空显示记录',
    '',
    '支持 JavaScript、布尔值、数组、对象，以及 模块.操作名 键名:值 的简写。',
    'Enter 执行，Shift+Enter 换行；单行输入时 ↑/↓ 切换本页历史。',
    '操作仍受扩展接口启用状态和平台登录要求约束。每条命令独立执行。'
  ].join('\n');

  function commandCode(command) {
    const docs = /^help(?:\s+([\s\S]+)|\(([\s\S]*)\))$/i.exec(command);
    if (docs) {
      const names = [...new Set(String(docs[1] ?? docs[2]).split(/[\s,]+/).filter(Boolean))];
      if (!names.length || names.some((name) => !/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(name))) throw new Error('请输入操作名，例如 help ve.login ykt.assignments');
      return `Promise.all([${names.map((name) => {
        const [module, operation] = name.split('.');
        return `api.getDocs(${JSON.stringify({ module, name: operation })})`;
      }).join(',')}]).then(docs => docs.join("\\n\\n---\\n\\n"))`;
    }
    const operation = /^([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)(?:\s+([\s\S]+))?$/.exec(command);
    if (!operation) return command;
    const args = String(operation[2] || '').trim();
    if (!args) return `${operation[1]}()`;
    const shorthand = !/^(?:[\[{"'`]|true\b|false\b|null\b|[-+\d])/.test(args) && args.includes(':');
    return `${operation[1]}(${shorthand ? `{${args}}` : args})`;
  }

  function clearOutput() {
    if (running) return;
    output.replaceChildren();
    status.textContent = '已清空显示记录';
    input.focus();
  }

  async function run(command) {
    command = String(command || '').trim();
    if (!command || running) return;
    if (command === 'clear') { input.value = ''; clearOutput(); return; }
    if (commandHistory.at(-1) !== command) commandHistory.push(command);
    if (commandHistory.length > 100) commandHistory.shift();
    historyIndex = commandHistory.length;
    draft = '';
    input.value = '';
    document.getElementById('consoleWelcome')?.remove();
    const entry = document.createElement('article');
    entry.className = 'console-entry';
    entry.innerHTML = '<div class="console-entry-command"><span class="console-prompt">BJTUCA&gt;</span><pre></pre></div><div class="console-entry-loading"><span class="options-page-spinner"></span>执行中…</div>';
    entry.querySelector('pre').textContent = command;
    output.appendChild(entry);
    output.scrollTop = output.scrollHeight;
    running = true;
    execute.disabled = true;
    document.getElementById('clearConsole').disabled = true;
    status.textContent = '正在执行…';
    const started = performance.now();
    let text;
    try {
      if (command === 'help') text = help;
      else {
        if (!await globalThis.__bjtuApiReady) throw new Error('请先安装「扩展接口」模块');
        const value = await globalThis.BjtuApiPage.executeCode(commandCode(command), 'app');
        text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'undefined';
      }
      status.textContent = '执行完成';
    } catch (error) {
      entry.classList.add('is-error');
      text = `执行失败：${String(error?.message || error)}`;
      status.textContent = '执行失败，可修改命令后重试';
    } finally {
      const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 48;
      entry.querySelector('.console-entry-loading').remove();
      const result = document.createElement('pre');
      result.className = 'console-entry-result';
      result.textContent = text;
      const meta = document.createElement('div');
      meta.className = 'console-entry-meta';
      const elapsed = document.createElement('span');
      elapsed.textContent = `${((performance.now() - started) / 1000).toFixed(2)} s`;
      const size = document.createElement('span');
      size.className = 'file-size-emphasis';
      const bytes = new TextEncoder().encode(text).byteLength;
      size.textContent = globalThis.BjtuFileSizeEmphasis.formatBytes(bytes);
      globalThis.BjtuFileSizeEmphasis.applyBytes(size, bytes);
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '复制';
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(text).then(() => { status.textContent = '已复制结果'; }, () => { status.textContent = '复制失败'; });
      });
      meta.append(elapsed, size, copy);
      entry.append(result, meta);
      if (follow) output.scrollTop = output.scrollHeight;
      running = false;
      execute.disabled = false;
      document.getElementById('clearConsole').disabled = false;
      input.focus();
    }
  }

  document.getElementById('consoleForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void run(input.value);
  });
  document.getElementById('clearConsole').addEventListener('click', clearOutput);
  document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => {
    input.value = button.dataset.command;
    input.focus();
  }));
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void run(input.value);
    } else if (['ArrowUp', 'ArrowDown'].includes(event.key) && !input.value.includes('\n')) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      if (historyIndex === commandHistory.length) draft = input.value;
      historyIndex = Math.max(0, Math.min(commandHistory.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
      input.value = historyIndex === commandHistory.length ? draft : commandHistory[historyIndex] || '';
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  input.focus();
  const id = new URLSearchParams(location.search).get('request');
  if (!id) return;
  const key = `omniboxOperation:${id}`;
  const stored = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  history.replaceState(null, '', location.pathname);
  if (typeof stored[key] === 'string') await run(stored[key]);
  else status.textContent = '地址栏请求已执行或已失效，请输入新命令。';
})();
