require('./braces-remediation/control.cjs').inspect(require('node:path').resolve(__dirname, '..'));
// Installed builder only: no linking, env pull, npm install or deployment.
const { build } = require('@vercel/node');
const { glob } = require('@vercel/build-utils');
const assert = require('node:assert/strict');
const evidence = require('./api-packaging-evidence.cjs');
(async () => {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--evidence'), 'Expected optional --evidence <new absolute directory>');
  const files = await glob('api/**/*.ts', process.cwd());
  const entries = Object.keys(files).filter(name => !name.split('/').some(part => part.startsWith('_') || part.startsWith('.')) && !name.endsWith('.d.ts')).sort();
  assert.equal(entries.length, 12);
  const recorded = args.length ? evidence.begin(args[1], process.cwd(), Object.keys(files)) : null;
  for (const entrypoint of entries) {
    const { output } = await build({ files, entrypoint, workPath: process.cwd(), config: {}, meta: { isDev: true } });
    assert.ok(output.files[entrypoint.replace(/\.ts$/, '.js')]);
    if (entrypoint === 'api/admin/products/[id]/index.ts') assert.ok(output.files['api/_lib/product-patch.js']);
    if (recorded) await evidence.preserve(recorded, entrypoint, output);
    console.log(JSON.stringify({ entrypoint, handler: output.handler, runtime: output.runtime, tracedFiles: Object.keys(output.files).length }));
  }
  if (recorded) console.log(JSON.stringify({ packagingEvidence: evidence.finish(recorded) }));
  console.log('Packaged all 12 API functions; no deployment.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
