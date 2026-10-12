const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { workerMain } = require('./bounded.cjs');

async function exercise(root, scenario, esmToml) {
  const local = createRequire(path.join(root, 'package.json'));
  const vercel = createRequire(local.resolve('@vercel/node'));
  const buildUtilsEntry = vercel.resolve('@vercel/build-utils');
  const buildUtils = createRequire(buildUtilsEntry);
  const parentEntry = buildUtils.resolve('@vercel/python-analysis');
  const parent = createRequire(parentEntry);
  const consumer = vercel('@vercel/build-utils');
  assert.equal(typeof consumer.isPythonEntrypoint, 'function');
  // Loading the real consumer must bind the exact parent whose exports run.
  assert.ok(require.cache[parentEntry], 'real build-utils must load python-analysis');
  const api = require.cache[parentEntry].exports;
  assert.equal(api, buildUtils('@vercel/python-analysis'));
  const toml = esmToml ?? parent('smol-toml');
  const receipt = { consumer: buildUtilsEntry, parent: parentEntry,
    dependency: parent.resolve('smol-toml'), parentBinding: 'actual CommonJS require.cache',
    targetBinding: esmToml ? 'native ESM import export' : 'CommonJS require export' };
  const lock = 'version = 1\n[[package]]\nname = "synthetic-package"\nversion = "1.2.3"\nsource = { registry = "https://pypi.org/simple" }\n' +
    'wheels = [{ url = "https://files.pythonhosted.org/synthetic.whl" }]\ndependencies = [{ name = "synthetic-dependency" }]\n';
  if (scenario.endsWith('parent-roundtrip')) {
    assert.deepEqual(api.parseUvLock(lock, 'uv.lock'), { version: 1, packages: [{
      name: 'synthetic-package', version: '1.2.3',
      source: Object.assign(Object.create(null), { registry: 'https://pypi.org/simple' }),
      wheels: [{ url: 'https://files.pythonhosted.org/synthetic.whl' }],
      dependencies: [Object.assign(Object.create(null), { name: 'synthetic-dependency' })],
    }] });
    const manifest = api.createMinimalManifest({ name: 'synthetic-app', version: '1.0.0',
      requiresPython: '>=3.12', dependencies: ['synthetic-package==1.2.3'] });
    assert.deepEqual(manifest, { project: { name: 'synthetic-app', version: '1.0.0',
      'requires-python': '>=3.12', dependencies: ['synthetic-package==1.2.3'],
      classifiers: ['Private :: Do Not Upload'] } });
    assert.deepEqual(toml.parse(api.stringifyManifest(manifest)), Object.assign(Object.create(null), {
      project: Object.assign(Object.create(null), manifest.project),
    }));
    assert.deepEqual(api.createMinimalManifest(), { project: { name: 'app', version: '0.1.0',
      dependencies: [], classifiers: ['Private :: Do Not Upload'] } });
    assert.throws(() => api.parseUvLock('version = "unterminated', 'uv.lock'),
      error => error.code === 'PYTHON_UV_LOCK_PARSE_ERROR' && error.path === 'uv.lock');
    return receipt;
  }
  assert.ok(['cjs-flat-valid', 'esm-smol-flat-valid', 'cjs-flat-malformed', 'esm-smol-flat-malformed'].includes(scenario));
  const count = 64000;
  const lines = Array.from({ length: count }, (_, index) => `k${index} = 1`);
  const input = lines.join('\n') + '\n';
  if (scenario.endsWith('malformed')) {
    assert.throws(() => api.parseUvLock(input + 'broken = "unterminated', 'synthetic-uv.lock'),
      error => error.code === 'PYTHON_UV_LOCK_PARSE_ERROR' && error.path === 'synthetic-uv.lock');
    assert.throws(() => toml.parse(input + 'broken = "unterminated'), /Unterminated|string/i);
  } else {
    // The parent really parses this flat document, then filters its uv packages.
    assert.deepEqual(api.parseUvLock('version = 1\n' + input, 'synthetic-uv.lock'), { version: 1, packages: [] });
    const parsed = toml.parse(input);
    assert.equal(Object.keys(parsed).length, count);
    assert.equal(parsed.k0, 1);
    assert.equal(parsed[`k${count - 1}`], 1);
  }
  return { ...receipt, inputBytes: input.length, count };
}

module.exports = { exercise };
if (require.main === module) workerMain(exercise);
