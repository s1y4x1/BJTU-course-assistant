(function initApiOptions(global) {
  'use strict';

  let initialized = false;
  let setMessage = (...args) => global.BjtuOptionsMessage.show(...args);
  let saveTimer = null, saveRevision = 0, codeDirty = false;
  let saveQueue = Promise.resolve();

  function renderHistory() {
    const host = document.getElementById('apiExecutionHistory');
    if (!host || !global.BjtuExecutionHistory) return;
    const entries = global.BjtuExecutionHistory.read();
    host.replaceChildren();
    document.getElementById('apiExecutionHistoryClear').disabled = !entries.length;
    if (!entries.length) { host.textContent = '暂无执行记录'; return; }
    for (const entry of entries.slice().reverse()) {
      const details = document.createElement('details'); details.className = 'api-history-entry';
      const summary = document.createElement('summary');
      const stamp = global.BjtuDateTime?.format(entry.recordedAt) || new Date(entry.recordedAt).toLocaleString();
      summary.textContent = `${stamp} · ${entry.mode || '未知环境'} · ${entry.outcome?.ok === true ? '成功' : '失败'}${entry.source === 'startup' ? ' · 启动脚本' : ''}`;
      const code = document.createElement('pre'); code.textContent = entry.code || '未记录代码';
      const result = document.createElement('pre'); result.textContent = JSON.stringify(entry.outcome, null, 2) ?? '无结果';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'api-history-delete'; remove.textContent = '删除';
      remove.addEventListener('click', () => {
        try { global.BjtuExecutionHistory.remove(entry); }
        catch (error) { setMessage(`删除失败：${error.message}`, false); }
      });
      details.append(summary, code, result, remove); host.append(details);
    }
  }

  function updateStartup(config) {
    if (codeDirty) return;
    document.getElementById('apiStartupEnabled').checked = config?.enabled === true;
    if (!codeDirty) document.getElementById('apiStartupCode').value = typeof config?.code === 'string' ? config.code : '';
  }

  function flushStartupSave() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!codeDirty) return saveQueue;
    const revision = saveRevision;
    const config = { enabled:document.getElementById('apiStartupEnabled').checked, code:document.getElementById('apiStartupCode').value };
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      if (revision !== saveRevision) return;
      await chrome.storage.local.set({ apiStartupScript:config });
      if (revision === saveRevision) {
        codeDirty = false;
        document.getElementById('apiStartupStatus').textContent = '已自动保存，下次打开扩展全屏页面时生效';
      }
    }).catch(error => {
      document.getElementById('apiStartupStatus').textContent = `保存失败：${error.message}`;
    });
    return saveQueue;
  }

  async function initScriptAndHistory() {
    await global.__bjtuApiReady;
    const stored = await chrome.storage.local.get('apiStartupScript');
    updateStartup(stored.apiStartupScript);
    const code = document.getElementById('apiStartupCode'), enabled = document.getElementById('apiStartupEnabled');
    code.disabled = false; enabled.disabled = false;
    document.getElementById('apiStartupStatus').textContent = '编辑后自动保存';
    const schedule = (delay) => {
      saveRevision++; codeDirty = true;
      document.getElementById('apiStartupStatus').textContent = '正在保存…';
      clearTimeout(saveTimer); saveTimer = setTimeout(flushStartupSave, delay);
    };
    code.addEventListener('input', () => schedule(300));
    code.addEventListener('blur', flushStartupSave);
    enabled.addEventListener('change', () => schedule(0));
    global.addEventListener('pagehide', flushStartupSave);
    global.addEventListener('bjtu-execution-history-change', renderHistory);
    global.addEventListener('storage', event => {
      if (event.key === global.BjtuExecutionHistory?.storageKey || event.key === null) renderHistory();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.apiStartupScript) updateStartup(changes.apiStartupScript.newValue);
    });
    document.getElementById('apiExecutionHistoryClear').addEventListener('click', () => {
      try { global.BjtuExecutionHistory.clear(); }
      catch (error) { setMessage(`清空失败：${error.message}`, false); }
    });
    renderHistory();
  }

  async function refresh() {
    const response = await global.BjtuApiOperationsUi.refresh({ showLoading: true });
    if (response?.ok !== true) {
      setMessage(`操作加载失败：${response?.message || response?.error || '通信失败'}`, false);
    }
    return response;
  }

  function init(context) {
    if (initialized) return;
    initialized = true;
    setMessage = typeof context?.setMessage === 'function' ? context.setMessage : setMessage;
    document.addEventListener('bjtuApiOperationsPersisted', (event) => {
      const ok = event?.detail?.ok === true;
      setMessage(ok ? '已保存' : '保存失败', ok);
    });
    return Promise.all([refresh(), initScriptAndHistory()]).catch((error) => {
      setMessage(`操作加载失败：${String(error?.message || error)}`, false);
    });
  }

  async function reset() {
    clearTimeout(saveTimer); saveTimer = null; saveRevision++; codeDirty = false;
    await saveQueue;
    await chrome.storage.local.set({ apiStartupScript:{ enabled:false, code:'' } });
    const response = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          type: 'BJTUCA_OPERATION_SETTINGS_SET',
          payload: { enabledOperations: null, alwaysAllowedOperations: [] }
        }, (result) => {
          const error = chrome.runtime.lastError;
          resolve(error ? { ok: false, message: error.message } : (result || {}));
        });
      } catch (error) {
        resolve({ ok: false, message: String(error?.message || error) });
      }
    });
    if (response?.ok !== true) {
      setMessage(`重置失败：${response?.message || response?.error || '通信失败'}`, false);
      return;
    }
    if (initialized) await refresh();
  }

  global.BjtuApiOptions = { init, reset };
  global.BjtuOptionsModules?.register('api', global.BjtuApiOptions);

  // 独立页面自行启动；聚合选项页仍由 BjtuOptionsModules 统一初始化。
  const initStandalone = () => {
    if (document.body?.matches('.module-options-standalone[data-options-module="api"]')) {
      void init();
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStandalone, { once: true });
  } else {
    initStandalone();
  }
})(globalThis);
