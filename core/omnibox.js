/* 地址栏 bjtuca + Tab：搜索本地课程、未交作业，或打开扩展页面。 */
(function () {
  const labels = { ve: '智慧课程平台', ykt: '雨课堂', mrjzy: '每日交作业',
    jlgj: '接龙管家', mooc: '中国大学MOOC', xuetangx: '学堂在线' };
  const pages = [
    { title: '课程助手', url: chrome.runtime.getURL('app/app.html') },
    { title: '扩展选项 设置', url: chrome.runtime.getURL('options/options.html') }
  ];
  let generation = 0;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  function safeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/.test(url.protocol) || pages.some((page) => page.url === url.href) ? url.href : '';
    } catch { return ''; }
  }
  async function search(text) {
    const stored = await chrome.storage.local.get(['popupFullscreenCourseCache', 'homeworkReminderSnapshot']);
    const cache = stored.popupFullscreenCourseCache || {};
    const results = [...pages, ...(cache.searchIndex || []).map((item) => ({
      ...item, context: `${labels[item.platform] || item.platform} · ${item.kind === 'homework' ? item.courseName || '作业' : '课程'}`
    }))];
    const snapshot = stored.homeworkReminderSnapshot || {};
    for (const [platform, label] of Object.entries(labels)) {
      const scopes = platform === 've' ? Object.entries(snapshot.ve || {}) : [['', snapshot[platform]]];
      for (const [account, entry] of scopes) {
        for (const item of entry?.items || []) results.push({ kind: 'homework', title: item.title,
          context: `${label}${account ? `(${account})` : ''} · ${item.courseName || ''}`, url: item.actionUrl });
      }
    }
    const kind = /^(课程|作业)(?:\s|$)/.exec(text)?.[1];
    const words = (kind ? text.slice(kind.length) : text).trim().toLowerCase().split(/\s+/).filter(Boolean);
    const seen = new Set();
    return results.filter((item) => {
      item.url = safeUrl(item.url);
      const key = `${item.url}|${item.title}`;
      if (!item.url || seen.has(key) || (kind && item.kind !== (kind === '课程' ? 'course' : 'homework'))) return false;
      const haystack = `${item.title} ${item.context || ''}`.toLowerCase();
      if (!words.every((word) => haystack.includes(word))) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }
  chrome.omnibox.onInputStarted.addListener(() => {
    generation++;
    void chrome.omnibox.setDefaultSuggestion({ description: '搜索缓存的课程、作业；可输入「课程 关键词」「作业 关键词」或「设置」' });
  });
  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    const revision = ++generation;
    void search(text.trim()).then((items) => {
      if (revision !== generation) return;
      void chrome.omnibox.setDefaultSuggestion({ description: items.length
        ? `打开首项：${escape(items[0].title)}；可选择下方结果`
        : '暂无匹配缓存，回车打开课程助手；可输入「课程 关键词」「作业 关键词」或「设置」' });
      suggest(items.map((item) => ({ content: item.url,
        description: `<match>${escape(item.title)}</match>${item.context ? ` <dim>${escape(item.context)}</dim>` : ''}` })));
    }).catch(() => { if (revision === generation) suggest([]); });
  });
  chrome.omnibox.onInputCancelled.addListener(() => { generation++; });
  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    generation++;
    void (async () => {
      const url = safeUrl(text) || (await search(text.trim()))[0]?.url || pages[0].url;
      if (disposition === 'currentTab') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id != null) {
          await chrome.tabs.update(tab.id, { url });
          await globalThis.BjtuTabs.group(tab.id);
          return;
        }
      }
      await globalThis.BjtuTabs.create({ url, active: disposition !== 'newBackgroundTab' });
    })().catch((error) => console.warn('[bjtu] omnibox navigation failed:', error));
  });
})();
