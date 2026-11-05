(function initBjtuMarkdown(global) {
  'use strict';

  const boundContainers = new WeakSet();

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function renderCodeBlock(text, languageInfo = '') {
    const language = String(languageInfo || '').trim().split(/\s+/)[0];
    const label = language || '代码';
    const attribute = language ? ` data-language="${escapeHtml(language)}"` : '';
    return `<div class="bjtu-md-codeblock-wrap"${attribute}><div class="bjtu-md-codeblock-toolbar"><span class="bjtu-md-codeblock-language">${escapeHtml(label)}</span><button type="button" class="bjtu-md-codeblock-copy" title="复制代码">复制</button></div><pre class="bjtu-md-codeblock"><code>${escapeHtml(String(text || ''))}</code></pre></div>`;
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

  function createParser({preserveWhitespace = false, math = false} = {}) {
    const renderer = createRenderer();
    if (preserveWhitespace) {
      // Render source whitespace, not the formatting newlines added by the
      // default HTML renderer. The host uses white-space: break-spaces.
      renderer.space = ({raw}) => escapeHtml(raw);
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
    if (math) {
      const renderMath = token => global.katex.renderToString(token.text, {
        displayMode:token.display, throwOnError:false, trust:false, strict:'ignore',
        maxExpand:1000, maxSize:20, output:'htmlAndMathml'
      });
      parser.use({extensions:[{
        name:'bjtuMathBlock', level:'block',
        start:source => source.search(/(?:^|\n) {0,3}(?:\$\$|\\\[)/),
        tokenizer(source) {
          const match = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?=[ \t]*(?:\n|$))/.exec(source);
          if (match) return {type:'bjtuMathBlock', raw:match[0], text:match[1] ?? match[2], display:true};
        },
        renderer:renderMath
      }, {
        name:'bjtuMathInline', level:'inline',
        start:source => source.search(/\$|\\[([]/),
        tokenizer(source) {
          const display = /^\$\$([\s\S]+?)\$\$/.exec(source);
          if (display) return {type:'bjtuMathInline', raw:display[0], text:display[1], display:true};
          const match = /^(?:\\\(([\s\S]+?)\\\)|\$(?!\$)((?:\\.|[^$\\\n])+?)\$(?!\$))/.exec(source);
          if (match) return {type:'bjtuMathInline', raw:match[0], text:match[1] ?? match[2], display:false};
        },
        renderer:renderMath
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

  global.BjtuMarkdown = Object.freeze({ escapeHtml, renderCodeBlock, createRenderer, createParser, copyText, bindCopy });
})(globalThis);
