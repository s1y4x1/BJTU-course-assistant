(async function () {
  const result = document.getElementById('operationResult');
  const copy = document.getElementById('copyResult');
  copy.addEventListener('click', () => navigator.clipboard.writeText(result.textContent));
  try {
    const id = new URLSearchParams(location.search).get('request');
    const key = `omniboxOperation:${id}`;
    const stored = await chrome.storage.session.get(key);
    const code = stored[key];
    if (typeof code !== 'string') throw new Error('操作请求不存在或已执行，请从地址栏重新调用。');
    await chrome.storage.session.remove(key);
    document.getElementById('operationCode').textContent = code;
    if (!await globalThis.__bjtuApiReady) throw new Error('请先安装「扩展接口」模块');
    const value = await globalThis.BjtuApiPage.executeCode(code, 'app');
    result.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'undefined';
  } catch (error) {
    result.textContent = `执行失败：${String(error?.message || error)}`;
  } finally {
    document.getElementById('operationLoading').hidden = true;
    result.hidden = false;
    copy.disabled = false;
  }
})();
