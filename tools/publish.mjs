import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGitHubClient } from './github-client.mjs';

const blogDir = fileURLToPath(new URL('../', import.meta.url));
const username = 'Yzy-zzz';
const repository = 'Yzy-zzz.github.io';
const repoPath = `/repos/${username}/${repository}`;

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: blogDir, encoding: 'utf8', windowsHide: true,
    stdio: capture ? 'pipe' : 'inherit',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
  });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')} 执行失败。`);
  return capture ? result.stdout.trim() : '';
}

try {
  if (!process.argv.includes('--check-auth')) {
    run(process.execPath, [path.join(blogDir, 'tools', 'import-notes.mjs')]);
    run(process.execPath, [path.join(blogDir, 'node_modules', 'hexo-cli', 'bin', 'hexo'), 'clean']);
    run(process.execPath, [path.join(blogDir, 'node_modules', 'hexo-cli', 'bin', 'hexo'), 'generate', '--bail']);
    run(process.execPath, [path.join(blogDir, 'tools', 'verify-build.mjs')]);
  }
  const request = await getGitHubClient(username);
  let repo = await request('GET', repoPath, undefined, true);
  if (process.argv.includes('--check-auth')) {
    console.log(`GitHub 登录可用：${username}；目标仓库${repo ? '已存在' : '尚未创建'}。`);
    process.exit(0);
  }
  const localRepo = existsSync(path.join(blogDir, '.git'));
  if (repo && repo.size > 0 && !localRepo) throw new Error('目标仓库已有内容。请先确认仓库内容并建立本地关联，避免覆盖已有站点。');
  if (!repo) {
    repo = await request('POST', '/user/repos', {
      name: repository, description: 'Sketch、网络测量与系统研究的论文阅读笔记',
      homepage: 'https://yzy-zzz.github.io', private: false, auto_init: false
    });
    console.log(`已创建仓库：${repo.html_url}`);
  }
  if (!localRepo) run('git', ['init', '--initial-branch=main']);
  const expectedRemote = `https://github.com/${username}/${repository}.git`;
  const remotes = run('git', ['remote'], true).split(/\r?\n/);
  if (remotes.includes('origin')) {
    const remote = run('git', ['remote', 'get-url', 'origin'], true);
    if (remote.toLowerCase() !== expectedRemote.toLowerCase()) throw new Error(`origin 与目标仓库不一致：${remote}`);
  } else run('git', ['remote', 'add', 'origin', expectedRemote]);
  const branch = run('git', ['symbolic-ref', '--short', 'HEAD'], true);
  if (branch !== 'main') throw new Error(`当前分支是 ${branch}，请切换到 main 后发布。`);
  run('git', ['add', '.']);
  const changes = run('git', ['status', '--porcelain'], true);
  if (changes) run('git', ['commit', '-m', 'Publish paper reading blog']);
  run('git', ['push', '-u', 'origin', 'main']);
  const pages = await request('GET', repoPath + '/pages', undefined, true);
  if (!pages) await request('POST', repoPath + '/pages', { build_type: 'workflow' });
  else if (pages.build_type !== 'workflow') await request('PUT', repoPath + '/pages', { build_type: 'workflow' });
  console.log('已推送并启用 GitHub Pages。自动发布进度：');
  console.log(`https://github.com/${username}/${repository}/actions`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
