'use strict';

// Hexo loads scripts/ as CommonJS plugins; command-line helpers live in tools/.
const MarkdownIt = require('markdown-it');
const mathjax = require('markdown-it-mathjax3');
const anchor = require('markdown-it-anchor');
const { highlight, escapeHTML } = require('hexo-util');

const parser = new MarkdownIt('default', hexo.config.markdown.render);
parser.use(mathjax);
parser.use(anchor, { level: [1, 2, 3, 4, 5, 6], tabIndex: false });
// Quote flowchart node labels that use [...] so parentheses, slashes, spaces
// and even nested brackets stay literal. Mermaid only accepts such text when
// it is wrapped in double quotes. Existing quoted labels are left untouched.
function quoteFlowchartLabels(content) {
  let out = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let k = i + 1;
      while (k < content.length && content[k] !== quote) k++;
      out += content.slice(i, k + 1);
      i = k + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < content.length && /[A-Za-z0-9_]/.test(content[j])) j++;
      const id = content.slice(i, j);
      if (content[j] === '[' && content[j + 1] !== '"') {
        let depth = 1;
        let k = j + 1;
        while (k < content.length && depth > 0) {
          if (content[k] === '[') depth++;
          else if (content[k] === ']') depth--;
          k++;
        }
        if (depth === 0) {
          const label = content.slice(j + 1, k - 1);
          out += `${id}["${label.replaceAll('"', '#quot;')}"]`;
          i = k;
          continue;
        }
      }
      out += id;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

parser.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0];
  if (language === 'mermaid') {
    const content = /^\s*(?:graph|flowchart)\s/m.test(token.content)
      ? quoteFlowchartLabels(token.content)
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
