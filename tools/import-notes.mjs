import { readdir, readFile, writeFile, mkdir, stat, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { load as loadYaml } from 'js-yaml';

const blogDir = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(path.join(blogDir, 'notes.config.json'), 'utf8'));
const overrides = JSON.parse(await readFile(path.join(blogDir, 'notes.meta.json'), 'utf8'));
const rootDir = path.resolve(blogDir, config.root);
const postDir = path.join(blogDir, 'source', '_posts');
const manifestPath = path.join(blogDir, '.notes-manifest.json');
const previous = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return { posts: [] };
});
const previousBySource = new Map(previous.posts.map(post => [post.source, post]));
const hash = value => createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const within = (base, target) => {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
const quote = value => JSON.stringify(value);
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const formatDate = value => new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).format(new Date(value));

async function writeChanged(file, content) {
  const old = await readFile(file, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (old === content) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
  return true;
}

function splitFrontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) return { data: {}, body: text };
  return { data: loadYaml(match[1]) || {}, body: text.slice(match[0].length) };
}

function getSlug(filename) {
  return path.basename(filename, '.md')
    .replace(/[_ -]*(?:论文阅读笔记|论文分析报告|论文笔记|阅读笔记|技术解读|reading_notes).*$/i, '')
    .normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getExcerpt(body) {
  const preferred = body.split(/^#{1,4}\s*(?:一句话总结|摘要(?:与核心贡献)?|摘要\s*\(Abstract\)).*$/im)[1];
  const candidates = (preferred || body).split(/\n\s*\n/);
  const paragraph = candidates.find(value => {
    const line = value.trim();
    return line.length >= 25 && !/^(?:#|>|\||[-*+]\s|\d+\.|```|~~~|\$\$|---)/.test(line);
  }) || '论文阅读笔记，包含研究背景、方法解析、实验结果与讨论。';
  const text = paragraph.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return escapeHtml(text.slice(0, 170) + (text.length > 170 ? '…' : ''));
}

function inferTags(source, body) {
  const preview = (source + '\n' + body.slice(0, 6000)).toLowerCase();
  const tags = [];
  if (/sketch/.test(preview)) tags.push('Sketch');
  if (/滑动窗口|sliding.window|rolling.out/.test(preview)) tags.push('滑动窗口');
  if (/cardinality|基数估计|基数测量|超点/.test(preview)) tags.push('基数估计');
  if (/filter|过滤器/.test(preview)) tags.push('过滤器');
  if (/p4|可编程交换机|可编程数据平面/.test(preview)) tags.push('可编程网络');
  if (/smartnic|dpu/.test(preview)) tags.push('SmartNIC');
  if (/隐私|privacy|安全|censorship/.test(preview)) tags.push('网络安全');
  return tags.length ? tags : ['网络测量'];
}

const files = [];
for (const directory of config.directories) {
  const location = path.resolve(rootDir, directory);
  if (!within(rootDir, location) || within(blogDir, location)) throw new Error(`不允许导入此目录：${directory}`);
  let entries;
  try { entries = await readdir(location, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const fullPath = path.join(location, entry.name);
    const source = slash(path.relative(rootDir, fullPath));
    const text = (await readFile(fullPath, 'utf8')).replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
    const parsed = splitFrontMatter(text);
    const metadata = { ...parsed.data, ...overrides[source] };
    const heading = /^#\s+(.+)$/m.exec(parsed.body);
    const title = metadata.title || (heading ? heading[1].replace(/[*`]/g, '').trim() : path.basename(entry.name, '.md'));
    const slug = metadata.slug || previousBySource.get(source)?.slug || getSlug(entry.name);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`请在 notes.meta.json 为 ${source} 设置英文 slug。`);
    const info = await stat(fullPath);
    const prior = previousBySource.get(source);
    const date = metadata.date ? formatDate(metadata.date) : prior?.date || formatDate(new Date(Math.min(info.birthtimeMs || info.mtimeMs, info.mtimeMs)));
    const updated = metadata.updated ? formatDate(metadata.updated) : formatDate(info.mtime);
    let body = parsed.body;
    if (heading && body.slice(0, heading.index).trim() === '') body = body.slice(heading.index + heading[0].length).trimStart();
    const category = /Geedge/i.test(source) ? '网络安全' : /Agentic|SmartNIC_SLM/i.test(source) ? '网络与 AI' : config.defaultCategory;
    files.push({ source, fullPath, title, slug, date, updated, body, metadata, category });
  }
}
files.sort((a, b) => a.source.localeCompare(b.source, 'en'));
if (!files.length) throw new Error(`没有找到 Markdown。请检查 notes.config.json 的 root：${rootDir}`);
const slugs = new Set();
for (const post of files) {
  if (slugs.has(post.slug)) throw new Error(`文章路径重复：${post.slug}。请通过 notes.meta.json 指定不同 slug。`);
  slugs.add(post.slug);
}
const byPath = new Map(files.map(post => [path.resolve(post.fullPath), post]));
const linkPattern = /(!?\[[^\]\n]*\])\((<[^>]+>|[^\s)]+)(\s+["'][^\n]*?["'])?\)/g;
let changed = 0;
const manifestPosts = [];
for (const post of files) {
  const links = [...post.body.matchAll(linkPattern)];
  const replacements = new Map();
  for (const match of links) {
    const href = match[2].replace(/^<|>$/g, '');
    if (/^(?:[a-z]+:|\/|#)/i.test(href)) continue;
    let decoded;
    try { decoded = decodeURIComponent(href.split('#')[0]); } catch { continue; }
    const target = path.resolve(path.dirname(post.fullPath), decoded);
    if (!within(rootDir, target)) continue;
    const linkedPost = byPath.get(target);
    if (linkedPost) {
      replacements.set(match[0], `${match[1]}(/papers/${linkedPost.slug}/${href.includes('#') ? '#' + href.split('#')[1] : ''}${match[3] || ''})`);
    } else if (match[1].startsWith('!') && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(target)) {
      const targetInfo = await stat(target).catch(() => null);
      if (!targetInfo?.isFile()) { console.warn(`图片不存在：${post.source} → ${href}`); continue; }
      const assetName = hash(slash(path.relative(rootDir, target))).slice(0, 10) + path.extname(target).toLowerCase();
      const assetDir = path.join(blogDir, 'source', 'images', 'notes', post.slug);
      await mkdir(assetDir, { recursive: true });
      await copyFile(target, path.join(assetDir, assetName));
      replacements.set(match[0], `${match[1]}(/images/notes/${post.slug}/${assetName}${match[3] || ''})`);
    }
  }
  const body = post.body.replace(linkPattern, value => replacements.get(value) || value);
  const tags = post.metadata.tags || inferTags(post.source, body);
  const categories = post.metadata.categories || [post.category];
  const content = [
    '---', 'layout: post', `title: ${quote(post.title)}`, `date: ${quote(post.date)}`,
    `updated: ${quote(post.updated)}`, `permalink: papers/${post.slug}/`,
    `categories: ${quote(categories)}`, `tags: ${quote(tags)}`,
    `excerpt: ${quote(post.metadata.excerpt || getExcerpt(body))}`,
    'disableNunjucks: true', 'comments: false', '---', '', body.trim(), ''
  ].join('\n');
  const destination = path.join(postDir, post.slug + '.md');
  const oldContent = await readFile(destination, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  const prior = previousBySource.get(post.source);
  if (oldContent !== null && !prior) throw new Error(`目标文章已存在，未覆盖：${destination}`);
  if (oldContent !== null && prior?.outputHash && hash(oldContent.replaceAll('\r\n', '\n')) !== prior.outputHash) {
    throw new Error(`导入副本已被手动修改：${destination}。请先把修改合并回原笔记，再运行同步。`);
  }
  if (await writeChanged(destination, content)) changed++;
  manifestPosts.push({ source: post.source, slug: post.slug, title: post.title, date: post.date, updated: post.updated,
    math: /\$[^\n$]+\$|\$\$/m.test(body), mermaid: /^\s*```mermaid/m.test(body),
    outputHash: hash(content), sourceHash: hash(await readFile(post.fullPath)) });
}
for (const oldPost of previous.posts) {
  if (slugs.has(oldPost.slug)) continue;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(oldPost.slug)) throw new Error('旧导入清单中有无效路径。');
  const destination = path.join(postDir, oldPost.slug + '.md');
  const content = await readFile(destination, 'utf8').catch(() => null);
  if (content !== null && hash(content.replaceAll('\r\n', '\n')) === oldPost.outputHash) await unlink(destination);
}
await writeChanged(manifestPath, JSON.stringify({ version: 1, posts: manifestPosts }, null, 2) + '\n');
console.log(`已同步 ${files.length} 篇文章，更新 ${changed} 篇。原 Markdown 保留在 ${rootDir}`);
