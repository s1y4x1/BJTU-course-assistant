(function initBjtuMarkdown(global) {
  'use strict';

  const boundContainers = new WeakSet();
  const highlighted = new Map();
  const vendorStatus = new Map();
  const vendorActivations = new Map();
  let highlightedBytes = 0;
  const vendorEntries = [['katex','katex','katex.min.js'], ['hljs','highlight','highlight.min.js']];
  function loadExtensionScript(path) {
    if (global.BjtuModuleRegistry?.loadScript) return global.BjtuModuleRegistry.loadScript(path);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.onload = resolve;
      script.onerror = () => reject(new Error('无法加载 Markdown 组件：' + path));
      document.head.append(script);
    });
  }
  async function loadVendor(name, directory, file) {
    if (global[name]) { vendorStatus.set(name, true); return; }
    if (!global.chrome?.runtime?.getURL) { vendorStatus.set(name,false); return; }
    const css = base => name !== 'katex' ? Promise.resolve() : new Promise((resolve,reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL(base + 'katex.min.css');
      link.onload = resolve; link.onerror = () => { link.remove(); reject(new Error('无法加载 KaTeX 样式')); };
      document.head.append(link);
    });
    const base = `UI/vendor/${directory}/`;
    try {
      await css(base);
      await loadExtensionScript(base + file);
      vendorStatus.set(name,!!global[name]);
    } catch { vendorStatus.set(name,false); }
  }
  const ready = typeof document === 'undefined' ? Promise.resolve()
    : Promise.all(vendorEntries.map(([name,directory,file]) => loadVendor(name,directory,file)));
  function missingVendors() {
    return vendorEntries.filter(([name]) => vendorStatus.get(name) === false).map(([name]) => name);
  }

  function renderMath(text, displayMode) {
    return global.katex.renderToString(text, {
      displayMode, throwOnError:false, trust:false, strict:'ignore',
      maxExpand:1000, maxSize:20, output:'htmlAndMathml'
    });
  }

  function activateVendor(id) {
    const entry = vendorEntries.find(([, directory]) => directory === id);
    if (!entry || typeof document === 'undefined') return Promise.resolve(false);
    const [name] = entry;
    if (vendorActivations.has(name)) return vendorActivations.get(name);
    const activation = ready.then(async () => {
      if (vendorStatus.get(name) !== true) await loadVendor(...entry);
      if (vendorStatus.get(name) !== true) return false;
      for (const node of document.querySelectorAll(`[data-bjtu-md-vendor="${name}"]`)) {
        if (name === 'hljs') {
          const code = node.querySelector('.bjtu-md-codeblock > code');
          if (!code) continue;
          code.innerHTML = highlightCode(code.textContent, node.dataset.language || '');
        } else {
          node.innerHTML = renderMath(node.dataset.bjtuMdMath || '', node.dataset.bjtuMdDisplay === 'true');
          node.classList.remove('bjtu-md-math-source');
        }
        delete node.dataset.bjtuMdVendor;
        delete node.dataset.bjtuMdMath;
        delete node.dataset.bjtuMdDisplay;
      }
      return true;
    }).finally(() => vendorActivations.delete(name));
    vendorActivations.set(name, activation);
    return activation;
  }

  const vendorPrompts = {
    katex: { label: 'KaTeX', feature: '数学公式', id: 'katex' },
    hljs: { label: 'Highlight.js', feature: '代码高亮', id: 'highlight' }
  };

  function observeMissingVendors() {
    const missing = new Set(missingVendors());
    if (!missing.size || !document.body || !global.IntersectionObserver) return;
    const selector = '[data-bjtu-md-vendor]:not([data-bjtu-md-no-prompt])';
    const observed = new Set(), visible = new Set();
    let promptOpen = false;
    const showNext = () => {
      if (promptOpen || document.visibilityState !== 'visible') return;
      const target = [...visible].find(element => element.isConnected && missing.has(element.dataset.bjtuMdVendor)
        && vendorStatus.get(element.dataset.bjtuMdVendor) !== true);
      if (!target) return;
      const name = target.dataset.bjtuMdVendor;
      missing.delete(name);
      for (const element of observed) if (element.dataset.bjtuMdVendor === name) watch(element, false);
      if (!missing.size) {
        mutations.disconnect();
        intersection.disconnect();
        document.removeEventListener('visibilitychange', showNext);
      }
      promptOpen = true;
      void (async () => {
        if (!global.BjtuMarkdownVendorInstaller) await loadExtensionScript('UI/markdown-vendor-options.js');
        await global.BjtuMarkdownVendorInstaller.prompt(vendorPrompts[name]);
      })().catch(error => console.warn('[bjtu] 无法打开 Markdown 组件下载界面:', error)).finally(() => {
        promptOpen = false;
        showNext();
      });
    };
    const intersection = new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (!observed.has(target)) continue;
        if (isIntersecting) visible.add(target);
        else visible.delete(target);
      }
      showNext();
    });
    function watch(element, added) {
      if (added && missing.has(element.dataset.bjtuMdVendor)) {
        observed.add(element);
        intersection.observe(element);
      } else if (!added && observed.delete(element)) {
        intersection.unobserve(element);
        visible.delete(element);
      }
    }
    const mutations = new MutationObserver(records => {
      for (const record of records) for (const node of [...record.removedNodes, ...record.addedNodes]) {
        if (node.nodeType !== 1) continue;
        const added = node.isConnected;
        if (node.matches(selector)) watch(node, added);
        node.querySelectorAll(selector).forEach(element => watch(element, added));
      }
    });
    document.querySelectorAll(selector).forEach(element => watch(element, true));
    mutations.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', showNext);
  }
  if (global.chrome?.runtime?.getURL && typeof document !== 'undefined') {
    global.chrome.storage?.onChanged?.addListener((changes, area) => {
      const versions = changes.markdownVendorVersions;
      if (area !== 'local' || !versions) return;
      for (const [name, id] of vendorEntries) {
        if (versions.newValue?.[id]?.version && versions.newValue[id] !== versions.oldValue?.[id] && vendorStatus.get(name) !== true) {
          void activateVendor(id).catch(error => console.warn('[bjtu] 无法即时加载 Markdown 组件:', error));
        }
      }
    });
    void ready.then(() => {
      if (document.body) observeMissingVendors();
      else document.addEventListener('DOMContentLoaded', observeMissingVendors, { once: true });
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function renderCodeBlock(text, languageInfo = '', { promptForHighlight = true } = {}) {
    const language = String(languageInfo || '').trim().split(/\s+/)[0];
    const label = language || '代码';
    const attribute = language ? ` data-language="${escapeHtml(language)}"` : '';
    const code = String(text ?? '');
    const needsHighlight = !global.hljs && code.trim() && code.length <= 65536 &&
      !/^(?:plain(?:text)?|text|txt|none|nohighlight)$/i.test(language);
    const pending = needsHighlight ? ' data-bjtu-md-vendor="hljs"' + (promptForHighlight ? '' : ' data-bjtu-md-no-prompt') : '';
    return `<div class="bjtu-md-codeblock-wrap"${attribute}${pending}><div class="bjtu-md-codeblock-toolbar"><span class="bjtu-md-codeblock-language">${escapeHtml(label)}</span><button type="button" class="bjtu-md-codeblock-copy" title="复制代码">复制</button></div><pre class="bjtu-md-codeblock"><code class="hljs">${highlightCode(text, language)}</code></pre></div>`;
  }
  function highlightCode(value, language = '') {
    const text = String(value || ''), engine = global.hljs;
    if (!engine || text.length > 65536) return escapeHtml(text);
    const key = language + '\0' + text;
    if (highlighted.has(key)) return highlighted.get(key);
    const hint = String(language).toLowerCase(), alias = {app:'javascript',background:'javascript',sandbox:'javascript'}[hint] || hint;
    const html = alias ? (engine.getLanguage(alias) ? engine.highlight(text, {language:alias,ignoreIllegals:true}).value : escapeHtml(text))
      : engine.highlightAuto(text, ['javascript','python','json','xml','bash','sql'].filter(name => engine.getLanguage(name))).value;
    const size = key.length + html.length;
    if (size <= 524288) {
      highlighted.set(key, html); highlightedBytes += size;
      while (highlighted.size > 64 || highlightedBytes > 524288) {
        const [oldKey, oldHtml] = highlighted.entries().next().value;
        highlighted.delete(oldKey); highlightedBytes -= oldKey.length + oldHtml.length;
      }
    }
    return html;
  }

  function createRenderer(markedApi = global.marked) {
    const renderer = new markedApi.Renderer();
    const safeUrl = (href, protocols) => {
      try {
        const url = new URL(href, global.location.href);
        return protocols.includes(url.protocol) ? url.href : '';
      } catch { return ''; }
    };
    renderer.html = ({text}) => /^<br\s*\/?\s*>$/i.test(String(text).trim()) ? '<br>' : escapeHtml(text);
    renderer.link = function({href, title, tokens}) {
      const text = this.parser.parseInline(tokens || []), url = safeUrl(href, ['http:', 'https:', 'mailto:']);
      return url ? `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    };
    renderer.image = ({href, title, text}) => {
      const url = safeUrl(href, ['http:', 'https:']);
      return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(text || '')}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">` : escapeHtml(text || '');
    };
    renderer.codespan = ({text}) => `<code class="bjtu-md-inline-code" role="button" tabindex="0" title="点击复制">${escapeHtml(text)}</code>`;
    renderer.code = ({text, lang}) => renderCodeBlock(text, lang);
    return renderer;
  }

  function createParser({preserveWhitespace = false, math = true, renderer = createRenderer()} = {}) {
    if (preserveWhitespace) {
      // Render source whitespace, not the formatting newlines added by the
      // default HTML renderer. The host uses white-space: break-spaces.
      renderer.space = ({raw, afterTable, afterBlock}) => escapeHtml(
        afterTable ? raw.replace(/^\n{1,2}/, '')
          : afterBlock ? raw.replace(/^\n/, '')
            : raw
      );
      renderer.paragraph = function({tokens, raw, text}) {
        return this.parser.parseInline(tokens) + (raw.startsWith(text) ? escapeHtml(raw.slice(text.length)) : '');
      };
      renderer.br = ({raw}) => escapeHtml(raw.replace(/\\(?=\n)/g, ''));
      const codeSpan = renderer.codespan;
      renderer.codespan = function(token) {
        const ticks = token.raw.match(/^`+/)?.[0].length || 0;
        return codeSpan.call(this, {...token, text:ticks ? token.raw.slice(ticks, -ticks) : token.text});
      };
      const listItem = renderer.listitem;
      renderer.listitem = function(token) { return listItem.call(this, token).replace(/\n$/, ''); };
      renderer.list = function({ordered, start, items}) {
        const tag = ordered ? 'ol' : 'ul', attribute = ordered && start !== 1 ? ` start="${Number(start)}"` : '';
        return `<${tag}${attribute}>${items.map(item => this.listitem(item)).join('')}</${tag}>`;
      };
      for (const name of ['heading', 'blockquote', 'hr', 'table']) {
        const render = renderer[name];
        renderer[name] = function(token) { return render.call(this, token).replace(/\n$/, ''); };
      }
    }
    const parser = new global.marked.Marked({gfm:true, breaks:true, renderer});
    if (preserveWhitespace) parser.use({hooks:{
      // A preserved final LF alone does not create a final line box.
      postprocess: html => /\n[ \t]*$/.test(html)
        ? html + '<span aria-hidden="true" style="display:inline-block;width:0;height:1px"></span>'
        : html,
      processAllTokens(tokens) {
        const blockTypes = new Set(['heading', 'list', 'code', 'blockquote', 'table', 'hr', 'html', 'bjtuMathBlock']);
        function markBlockSpaces(items) {
          for (let index = 0; index < items.length; index++) {
            const token = items[index];
            const previous = items[index - 1], next = items[index + 1];
            // Block tokens already lay out their own lines. The blank lines that
            // surround them in the source should not add another visible line.
            if (token.type === 'space') {
              if (previous?.type === 'table' && next) token.afterTable = true;
              else if (blockTypes.has(previous?.type) || blockTypes.has(next?.type)) token.afterBlock = true;
            }
            if (token.tokens) markBlockSpaces(token.tokens);
            for (const item of token.items || []) if (item.tokens) markBlockSpaces(item.tokens);
          }
        }
        markBlockSpaces(tokens); return tokens;
      }
    }});
    if (math) {
      const renderMathToken = token => {
        if (global.katex && vendorStatus.get('katex') !== false) return renderMath(token.text, token.display);
        const tag = token.type === 'bjtuMathBlock' ? 'div' : 'span';
        return `<${tag} class="bjtu-md-math-source" data-bjtu-md-vendor="katex" data-bjtu-md-math="${escapeHtml(token.text)}" data-bjtu-md-display="${token.display}">${escapeHtml(token.raw)}</${tag}>`;
      };
      parser.use({extensions:[{
        name:'bjtuMathBlock', level:'block',
        start:source => source.search(/(?:^|\n) {0,3}(?:\$\$|\\\[)/),
        tokenizer(source) {
          const match = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?=[ \t]*(?:\n|$))/.exec(source);
          if (match) return {type:'bjtuMathBlock', raw:match[0], text:match[1] ?? match[2], display:true};
        },
        renderer:renderMathToken
      }, {
        name:'bjtuMathInline', level:'inline',
        start:source => source.search(/\$|\\[([]/),
        tokenizer(source) {
          const display = /^\$\$([\s\S]+?)\$\$/.exec(source);
          if (display) return {type:'bjtuMathInline', raw:display[0], text:display[1], display:true};
          const match = /^(?:\\\(([\s\S]+?)\\\)|\$(?!\$)((?:\\.|[^$\\\n])+?)\$(?!\$))/.exec(source);
          if (match) return {type:'bjtuMathInline', raw:match[0], text:match[1] ?? match[2], display:false};
        },
        renderer:renderMathToken
      }]});
    }
    return parser;
  }

  async function copyText(text, target) {
    const value = String(text || '');
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    if (target instanceof HTMLButtonElement) {
      const previous = target.textContent;
      target.textContent = '已复制';
      setTimeout(() => { if (target.isConnected) target.textContent = previous; }, 900);
    } else if (target instanceof HTMLElement) {
      target.classList.add('bjtu-copy-success');
      target.dataset.copyFeedback = '已复制';
      setTimeout(() => {
        target.classList.remove('bjtu-copy-success');
        delete target.dataset.copyFeedback;
      }, 900);
    }
  }

  function bindCopy(container, { onError } = {}) {
    if (!(container instanceof HTMLElement) || boundContainers.has(container)) return;
    boundContainers.add(container);
    const handle = (target, event) => {
      const inline = target.closest('.bjtu-md-inline-code');
      if (inline instanceof HTMLElement && container.contains(inline)) {
        event?.preventDefault();
        void copyText(inline.textContent || '', inline).catch(onError);
        return true;
      }
      const button = target.closest('.bjtu-md-codeblock-copy');
      if (!(button instanceof HTMLButtonElement) || !container.contains(button)) return false;
      const code = button.closest('.bjtu-md-codeblock-wrap')?.querySelector(':scope > .bjtu-md-codeblock > code');
      void copyText(code?.textContent || '', button).catch(onError);
      return true;
    };
    container.addEventListener('click', (event) => {
      if (event.target instanceof Element) handle(event.target, event);
    });
    container.addEventListener('keydown', (event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches('.bjtu-md-inline-code')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      handle(event.target, event);
    });
  }

  const createChatParser = (options={}) => createParser({...options,preserveWhitespace:true});
  global.BjtuMarkdown = Object.freeze({ ready, activateVendor, escapeHtml, renderCodeBlock, highlightCode, createRenderer, createParser, createChatParser, copyText, bindCopy, missingVendors });
})(globalThis);
