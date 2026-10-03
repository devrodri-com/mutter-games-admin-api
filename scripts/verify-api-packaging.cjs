require('./braces-remediation/control.cjs').inspect(require('node:path').resolve(__dirname, '..'));
// Installed builder only: no linking, env pull, npm install or deployment.
const { build } = require('@vercel/node');
const { glob } = require('@vercel/build-utils');
const assert = require('node:assert/strict');
(async () => {
  const files = await glob('api/**/*.ts', process.cwd());
  const entries = Object.keys(files).filter(name => !name.split('/').some(part => part.startsWith('_') || part.startsWith('.')) && !name.endsWith('.d.ts')).sort();
  assert.equal(entries.length, 12);
  for (const entrypoint of entries) {
    const { output } = await build({ files, entrypoint, workPath: process.cwd(), config: {}, meta: { isDev: true } });
    assert.ok(output.files[entrypoint.replace(/\.ts$/, '.js')]);
    if (entrypoint === 'api/admin/products/[id]/index.ts') assert.ok(output.files['api/_lib/product-patch.js']);
    console.log(JSON.stringify({ entrypoint, handler: output.handler, runtime: output.runtime, tracedFiles: Object.keys(output.files).length }));
  }
  console.log('Packaged all 12 API functions; no deployment.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
