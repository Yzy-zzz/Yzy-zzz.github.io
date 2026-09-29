import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const username = process.argv[2];
const repository = process.argv[3] || (username && `${username}.github.io`);
if (!username || !/^[A-Za-z0-9-]+$/.test(username) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
  console.error('用法：npm run configure:pages -- GitHub用户名 [仓库名]');
  process.exit(1);
}
const userSite = repository.toLowerCase() === `${username}.github.io`.toLowerCase();
const root = userSite ? '/' : `/${repository}/`;
const url = `https://${username.toLowerCase()}.github.io${userSite ? '' : '/' + repository}`;
const file = fileURLToPath(new URL('../_config.yml', import.meta.url));
const config = (await readFile(file, 'utf8')).replace(/^url:.*$/m, `url: ${url}`).replace(/^root:.*$/m, `root: ${root}`);
await writeFile(file, config, 'utf8');
console.log(`已设置博客地址：${url}`);
