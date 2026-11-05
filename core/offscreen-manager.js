(function(global) {
  'use strict';
  if (global.BjtuOffscreenManager) return;
  const path = 'core/offscreen.html', url = chrome.runtime.getURL(path);
  const modules = new Set(['captcha', 'citel', 'chatroom']);
  let creating;
  async function ensureDocument() {
    if (!chrome.offscreen || !chrome.runtime.getContexts) throw new Error('当前浏览器不支持共享离屏任务。');
    if (creating) return creating;
    creating = (async () => {
      const contexts = (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']}))
        .filter(context => context.frameId == null || context.frameId === 0);
      if (contexts.some(context => context.documentUrl !== url))
        throw new Error('旧版离屏任务仍在运行，将等待其结束后重试。');
      if (!contexts.length) await chrome.offscreen.createDocument({
        url:path, reasons:['IFRAME_SCRIPTING','WEB_RTC','BLOBS','DOM_PARSER','WORKERS'],
        justification:'共享聊天室后台 WebRTC、验证码识别和 CITEL 页面解析；不采集屏幕或申请媒体权限'
      });
    })().finally(() => { creating = null; });
    return creating;
  }
  async function send(command, module) {
    if (!modules.has(module)) throw new Error('未知离屏模块。');
    if (command === 'release') {
      const contexts = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
      if (!contexts.some(context => context.documentUrl === url)) return {ok:true};
    }
    await ensureDocument();
    const result = await chrome.runtime.sendMessage({type:'BJTU_OFFSCREEN_HOST',command,module});
    if (!result?.ok) throw new Error(result?.error || '共享离屏宿主未就绪。');
    return result;
  }
  global.BjtuOffscreenManager = {
    url, ensure:module => send('ensure',module), reset:module => send('reset',module),
    release:module => send('release',module)
  };

  // Offscreen documents expose runtime only. Limit the bridge to our chat frame
  // and its storage namespace; never expose arbitrary Chrome API invocation.
  const chatUrl = chrome.runtime.getURL('modules/chatroom/chat.html');
  const keyAllowed = key => typeof key === 'string' && /^chatroom[A-Za-z0-9]*$/.test(key);
  const readOnly = new Set(['themeMode','animationMode','animationSpeed','fontSizeSettings','colorSettings','dateFormatSettings']);
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (message?.type !== 'BJTU_OFFSCREEN_STORAGE') return false;
    if (sender.id !== chrome.runtime.id || !sender.url ||
        sender.url.split('?')[0] !== chatUrl || new URL(sender.url).searchParams.get('background') !== '1') return false;
    void (async () => {
      const {method,value} = message;
      if (!['get','set'].includes(method) || !value) throw new Error('不支持的后台存储操作。');
      const keys = typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.keys(value);
      if (!keys.every(key => keyAllowed(key) || (method === 'get' && readOnly.has(key)))) throw new Error('后台存储键不在允许范围。');
      const result = await chrome.storage.local[method](value);
      respond({ok:true,value:result});
    })().catch(error => respond({ok:false,error:error.message}));
    return true;
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local') return;
    const filtered = Object.fromEntries(Object.entries(changes).filter(([key]) => keyAllowed(key) || readOnly.has(key)));
    if (Object.keys(filtered).length) void chrome.runtime.sendMessage({
      type:'BJTU_OFFSCREEN_STORAGE_CHANGED',changes:filtered,area
    }).catch(() => {});
  });
})(globalThis);
