'use strict';
const fs = require('node:fs');
const path = require('node:path');

hexo.extend.generator.register('blog-local-assets', () => {
  const packageDir = path.join(hexo.base_dir, 'node_modules', 'hexo-generator-searchdb');
  return [
    { path: 'lib/search.js', data: fs.readFileSync(path.join(packageDir, 'dist', 'search.js')) },
    { path: 'lib/search-LICENSE.txt', data: fs.readFileSync(path.join(packageDir, 'LICENSE')) }
  ];
});
