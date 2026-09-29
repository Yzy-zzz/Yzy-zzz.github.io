# 论文阅读博客

Hexo + NexT 静态博客，站点地址为 https://yzy-zzz.github.io。

## 日常使用

在 PowerShell 中进入本目录：

```powershell
cd D:\AAA_paper\blog
npm.cmd run dev
```

浏览器打开 http://localhost:4000。使用 Ctrl+C 结束预览。

修改原目录中的笔记后，重新运行 `npm.cmd run dev`，或执行以下命令重新同步并生成静态网页：

```powershell
npm.cmd run update
npm.cmd run check
```

`public` 是生成的静态网页目录，可以交给任何静态网站托管服务。GitHub Actions 会从仓库中的已导入文章重新构建，不依赖你电脑上的原始目录。

## 文章来源与元信息

`notes.config.json` 默认导入上一级目录中的 Markdown，以及 `paper_notes` 中的 Markdown。`assets` 中的同名笔记不会重复导入。

自动导入会提取首个标题，设置创建及更新时间、英文文章地址、分类、标签与摘要；原文档保留在原目录。文章副本位于 `source/_posts`。修改内容时请编辑原文档，导入脚本会阻止覆盖被手动修改的副本。

若要手动指定某篇文章的元信息，在 `notes.meta.json` 中使用相对源文件路径作为键，例如：

```json
{
  "FlowLog_论文笔记.md": {
    "title": "FlowLog：字节级流量监控",
    "slug": "flowlog",
    "date": "2026-05-23T18:33:19+08:00",
    "tags": ["Sketch", "可编程网络"],
    "categories": ["论文阅读"]
  }
}
```

数学公式通过 MathJax 在构建时生成 SVG。Mermaid 在浏览器中绘制，渲染器会为流程图节点文字补充必要的引号，以兼容带括号的节点。已有远程图床图片继续使用原链接；本地图片会复制进站点图片目录。

## GitHub Pages 发布

目标仓库：`Yzy-zzz/Yzy-zzz.github.io`。发布脚本通过 Git Credential Manager 复用已有 GitHub 登录，凭据只用于 GitHub 请求，不会写进项目。

```powershell
npm.cmd run publish
```

脚本会同步笔记、构建检查、在仓库不存在时创建公开仓库、提交并推送 `main`，然后启用 GitHub Pages 的 GitHub Actions 发布。

若没有可用登录，可在 GitHub 网页手动建立上述空仓库，再运行：

```powershell
git init --initial-branch=main
git add .
git commit -m "Publish paper reading blog"
git remote add origin https://github.com/Yzy-zzz/Yzy-zzz.github.io.git
git push -u origin main
```

随后在仓库 `Settings → Pages → Source` 中选择 `GitHub Actions`。发布进度见 https://github.com/Yzy-zzz/Yzy-zzz.github.io/actions。

仅提交当前博客项目目录。`.gitignore` 已排除依赖、npm 缓存与构建产物。

## 配置与依赖

- `_config.yml`：站点名称、语言、URL 与 Markdown 渲染。
- `_config.next.yml`：主题、目录、搜索与 Mermaid。
- `source/_data/styles.styl`：阅读排版样式。
- `.github/workflows/pages.yml`：自动构建与发布。

新电脑安装 Node.js 24 和 Git 后，在本目录运行 `npm.cmd ci`。已提交的 `source/_posts` 可直接构建；若要同步原笔记，请把原目录放回项目上一级，或修改 `notes.config.json` 的 `root`。
