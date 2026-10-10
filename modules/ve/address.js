(function initVeAddress(global) {
  'use strict';
  if (global.BjtuVeAddress) return;
  const key = 'veDecimalAddressEnabled';
  let enabled = false;
  const documentValues = new WeakMap();
  const replace = (value) => typeof value === 'string'
    ? value.replace(enabled ? /\b123\.121\.147\.7\b/g : /\b2071565063\b/g, enabled ? '2071565063' : '123.121.147.7')
    : value;
  const ready = chrome.storage.local.get(key).then((data) => {
    enabled = data[key] === true;
    refreshDocument();
  });
  global.BjtuVeAddress = { replace, ready, get enabled() { return enabled; } };

  const fetchOriginal = global.fetch;
  global.fetch = async function (input, options) {
    await ready;
    if (typeof input === 'string') input = replace(input);
    else if (input instanceof URL) input = replace(input.href);
    else if (input instanceof Request && replace(input.url) !== input.url) {
      input = new Request(replace(input.url), input);
    }
    return fetchOriginal.call(this, input, options);
  };
  if (global.XMLHttpRequest) {
    const openOriginal = global.XMLHttpRequest.prototype.open;
    global.XMLHttpRequest.prototype.open = function (method, url, ...args) {
      return openOriginal.call(this, method, replace(String(url)), ...args);
    };
  }
  if (global.open) {
    const openOriginal = global.open;
    global.open = function (url, ...args) { return openOriginal.call(this, replace(url), ...args); };
  }
  if (global.navigator?.clipboard?.writeText) {
    const clipboard = global.navigator.clipboard;
    const writeOriginal = clipboard.writeText;
    clipboard.writeText = (text) => writeOriginal.call(clipboard, replace(text));
  }
  // Keep callback and Promise signatures of the Chrome APIs unchanged.
  for (const [api, method, index] of [
    [chrome.tabs, 'create', 0], [chrome.tabs, 'update', 1],
    [chrome.windows, 'create', 0], [chrome.downloads, 'download', 0]
  ]) {
    const original = api[method];
    api[method] = function (...args) {
      const optionsIndex = method === 'update' && typeof args[0] === 'object' ? 0 : index;
      const options = args[optionsIndex];
      if (options?.url) {
        args[optionsIndex] = { ...options, url: Array.isArray(options.url) ? options.url.map(replace) : replace(options.url) };
      }
      return original.apply(this, args);
    };
  }

  function refreshDocument(root = global.document?.documentElement, descendants = true) {
    if (!root) return;
    const documentValue = (node, name, current) => {
      let values = documentValues.get(node);
      const saved = values?.get(name);
      const original = saved?.rewritten === current ? saved.original : current;
      const next = enabled ? original.replace(/\b123\.121\.147\.7\b/g, '2071565063') : original;
      if (next !== original) {
        if (!values) documentValues.set(node, values = new Map());
        values.set(name, { original, rewritten: next });
      } else values?.delete(name);
      return next;
    };
    const rewriteNode = (node) => {
      const element = node.nodeType === 1 ? node : node.parentElement;
      // Help text describes the literal addresses, not an address to open.
      if (element?.closest('.tip, .option-tip-trigger, .option-tip-popover')) return;
      if (node.nodeType === 3) {
        if (node.parentElement?.closest('script, style, textarea')) return;
        const next = documentValue(node, '', node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      } else if (node.nodeType === 1) {
        for (const attribute of Array.from(node.attributes)) {
          const next = documentValue(node, attribute.name, attribute.value);
          if (next !== attribute.value) node.setAttribute(attribute.name, next);
        }
      }
    };
    rewriteNode(root);
    if (!descendants) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) rewriteNode(walker.currentNode);
  }
  if (global.document) {
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach((node) => refreshDocument(node));
        else refreshDocument(record.target, false);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[key]) return;
    enabled = changes[key].newValue === true;
    refreshDocument();
  });
})(globalThis);
