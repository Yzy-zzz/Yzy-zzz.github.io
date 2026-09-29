import { spawnSync } from 'node:child_process';

export async function getGitHubClient(username) {
  let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    const result = spawnSync('git', ['-c', 'credential.interactive=false', 'credential', 'fill'], {
      input: `protocol=https\nhost=github.com\nusername=${username}\n\n`,
      encoding: 'utf8', timeout: 15000, windowsHide: true,
      env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' }
    });
    if (result.status === 0) token = result.stdout.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  }
  if (!token) throw new Error('没有可用的 GitHub 登录凭据。请先通过 Git Credential Manager 或 GitHub CLI 登录，再运行发布。');
  async function request(method, endpoint, body, allowNotFound = false) {
    const response = await fetch(`https://api.github.com${endpoint}`, {
      method, headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'paper-reading-blog',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
    });
    const data = response.status === 204 ? null : await response.json();
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${response.status}：${data?.message || response.statusText}`);
    return data;
  }
  const user = await request('GET', '/user');
  if (user.login.toLowerCase() !== username.toLowerCase()) throw new Error(`已登录账号是 ${user.login}，与目标账号 ${username} 不一致。`);
  return request;
}
