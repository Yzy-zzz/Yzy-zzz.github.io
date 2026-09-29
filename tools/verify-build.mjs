import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const blogDir = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.join(blogDir, 'public');
const manifest = JSON.parse(await readFile(path.join(blogDir, '.notes-manifest.json'), 'utf8'));
const errors = [];
const exists = file => stat(file).then(() => true).catch(() => false);
for (const file of ['index.html', 'archives/index.html', 'categories/index.html', 'tags/index.html', 'search.json', 'css/main.css']) {
  if (!await exists(path.join(publicDir, file))) errors.push(`缺少生成文件：${file}`);
}
let mathPages = 0;
let mermaidPages = 0;
const search = JSON.parse(await readFile(path.join(publicDir, 'search.json'), 'utf8'));
if (search.length !== manifest.posts.length) errors.push('搜索索引文章数与导入清单不一致。');
for (const post of manifest.posts) {
  const file = path.join(publicDir, 'papers', post.slug, 'index.html');
  if (!await exists(file)) { errors.push(`缺少文章：${post.slug}`); continue; }
  const html = await readFile(file, 'utf8');
  if (post.math) {
    if (!html.includes('<mjx-container')) errors.push(`公式未渲染：${post.slug}`);
    else mathPages++;
  }
  if (post.mermaid) {
    if (!/class=["'][^"']*\bmermaid\b/.test(html)) errors.push(`Mermaid 标记未生成：${post.slug}`);
    else mermaidPages++;
  }
  if (/data-mjx-error|<merror|class=["']mjx-merror/.test(html)) errors.push(`公式存在渲染错误：${post.slug}`);
}

async function collect(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collect(file));
    else if (entry.name.endsWith('.html')) result.push(file);
  }
  return result;
}
const broken = new Set();
for (const file of await collect(publicDir)) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (/^(?:[a-z]+:|\/\/|#)/i.test(href)) continue;
    const clean = href.split(/[?#]/)[0];
    if (!clean) continue;
    let decoded;
    try { decoded = decodeURIComponent(clean); } catch { continue; }
    const target = clean.startsWith('/') ? path.join(publicDir, decoded.slice(1)) : path.resolve(path.dirname(file), decoded);
    if (!await exists(target) && !await exists(path.join(target, 'index.html'))) broken.add(href);
  }
}
for (const href of broken) errors.push(`本地链接不存在：${href}`);
if (!manifest.posts.length) errors.push('没有导入文章。');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`构建检查通过：${manifest.posts.length} 篇文章；${mathPages} 篇含已渲染公式；${mermaidPages} 篇含 Mermaid 图；本地资源与链接完整。`);
