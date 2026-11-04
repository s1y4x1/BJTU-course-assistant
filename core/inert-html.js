(function installBjtuInertHtml(global) {
  'use strict';

  // Chromium checks event attributes against CSP even in detached documents.
  // Remove them BEFORE invoking the browser parser. Tokenize whole attributes
  // so quoted values, comments and raw-text fields are not accidentally edited.
  function withoutEventAttributes(source) {
    const tags = /<!--[^]*?(?:-->|$)|<\/?([a-z][^\t\n\f\r />]*)(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    const rawText = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
    let result = '', offset = 0, match;
    while ((match = tags.exec(source))) {
      result += source.slice(offset, match.index);
      const tag = match[0];
      if (!match[1] || tag.startsWith('</')) {
        result += tag;
      } else {
        const nameEnd = 1 + match[1].length;
        result += tag.slice(0, nameEnd) + tag.slice(nameEnd).replace(
          /([^\t\n\f\r />=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\t\n\f\r >]*))?/g,
          (attribute, name) => /^on/i.test(name) ? '' : attribute
        );
      }
      offset = tags.lastIndex;
      const name = String(match[1] || '').toLowerCase();
      if (!tag.startsWith('</') && rawText.has(name)) {
        const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi');
        close.lastIndex = offset;
        const end = name === 'plaintext' ? null : close.exec(source);
        const rawEnd = end ? end.index : source.length;
        result += source.slice(offset, rawEnd);
        offset = tags.lastIndex = rawEnd;
      }
    }
    return result + source.slice(offset);
  }

  // Lazy, no browsing context or network loads; each call returns fresh nodes.
  let inertDocument;
  function parseFragment(value) {
    inertDocument ||= document.implementation.createHTMLDocument('');
    const template = inertDocument.createElement('template');
    template.innerHTML = withoutEventAttributes(String(value ?? ''));
    return template.content;
  }

  // Read-only parsing, NOT a sanitizer: never adopt these nodes into the page
  // without sanitizing first (e.g. BjtuHomeworkUi.sanitizeRichHtml).
  global.BjtuInertHtml = Object.freeze({ parseFragment });
})(globalThis);
