'use strict';

// Hexo loads scripts/ as CommonJS plugins; command-line helpers live in tools/.
const MarkdownIt = require('markdown-it');
const mathjax = require('markdown-it-mathjax3');
const anchor = require('markdown-it-anchor');
const { highlight, escapeHTML } = require('hexo-util');

const parser = new MarkdownIt('default', hexo.config.markdown.render);
parser.use(mathjax);
parser.use(anchor, { level: [1, 2, 3, 4, 5, 6], tabIndex: false });
parser.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0];
  if (language === 'mermaid') {
    // Flowchart labels with parentheses need quotes in current Mermaid versions.
    const content = /^\s*(?:graph|flowchart)\s/m.test(token.content)
      ? token.content.replace(/\b([A-Za-z][A-Za-z0-9_]*)\[([^\]\n]+)\]/g, (match, id, label) => {
        if (label.startsWith('"') || label.startsWith('[')) return match;
        return `${id}["${label.replaceAll('"', '#quot;')}"]`;
      })
      : token.content;
    return `<pre><code class="mermaid">${escapeHTML(content)}</code></pre>\n`;
  }
  return highlight(token.content, {
    lang: language, autoDetect: false, gutter: false, wrap: true,
    hljs: false, tab: '  '
  }) + '\n';
};

function render(data, options) {
  return options?.inline ? parser.renderInline(data.text) : parser.render(data.text);
}
render.disableNunjucks = true;
for (const extension of ['md', 'markdown', 'mkd', 'mkdn', 'mdwn', 'mdtxt', 'mdtext']) {
  hexo.extend.renderer.register(extension, 'html', render, true);
}
