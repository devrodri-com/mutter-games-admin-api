import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Project } from 'ts-morph';
import { discoverPythonPackage } from '@vercel/python-analysis';
import { braceExpand, match } from 'minimatch';
import Ajv from 'ajv';
import uri from 'fast-uri';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('@vercel/node'));
const buildUtilsRequire = createRequire(builderRequire.resolve('@vercel/build-utils'));
const pythonRequire = createRequire(buildUtilsRequire.resolve('@vercel/python-analysis'));
const staticRequire = createRequire(builderRequire.resolve('@vercel/static-config'));
const ajvRequire = createRequire(staticRequire.resolve('ajv'));
// static-config's generic FromSchema declaration triggers TS2321 with TS 5.9.
// Validate the actual external export at runtime and keep every result unknown.
const staticConfig: unknown = builderRequire('@vercel/static-config');
assert.ok(staticConfig && typeof staticConfig === 'object' && 'getConfig' in staticConfig
  && typeof staticConfig.getConfig === 'function');
const getConfig = staticConfig.getConfig;

test('tooling tests resolve the actual builder minimatch and Ajv URI consumers', () => {
  assert.equal(pythonRequire.resolve('minimatch'), require.resolve('minimatch'));
  assert.equal(pythonRequire('minimatch').braceExpand, braceExpand);
  assert.equal(buildUtilsRequire('@vercel/python-analysis').discoverPythonPackage, discoverPythonPackage);
  assert.equal(staticRequire.resolve('ajv'), require.resolve('ajv'));
  assert.equal(ajvRequire.resolve('fast-uri'), require.resolve('fast-uri'));
  assert.equal(ajvRequire('ajv/dist/runtime/uri').default, uri);
  assert.equal(new Ajv().opts.uriResolver, uri);
  assert.equal(builderRequire.resolve('@vercel/static-config'), require.resolve('@vercel/static-config'));
});

test('real minimatch preserves builder include/exclude matching and expansion limits', () => {
  const paths = ['api/admin/products.ts', 'api/internal/reconcile.ts', 'api/admin/products.js',
    'api/admin/products.test.ts', 'src/admin/products.ts'];
  const included = match(paths, 'api/{admin,internal}/*.{ts,js}');
  assert.deepEqual(included, paths.slice(0, 4));
  assert.deepEqual(match(included, '!**/*.test.ts'), paths.slice(0, 3));
  assert.deepEqual(braceExpand('api/{admin,internal}/v{1..2}.ts'), [
    'api/admin/v1.ts', 'api/admin/v2.ts', 'api/internal/v1.ts', 'api/internal/v2.ts',
  ]);
  assert.equal(braceExpand('{1..1000}', { braceExpandMax: 8 }).length, 8);
  assert.deepEqual(braceExpand('api/{unfinished.ts'), ['api/{unfinished.ts']);
});

test('real builder workspace discovery traverses synthetic manifests and honors brace exclusions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mutter-tooling-workspace-'));
  try {
    await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "synthetic-root"\nversion = "1.0.0"\n'
      + '[tool.uv.workspace]\nmembers = ["apps/{catalog,admin}"]\nexclude = ["apps/{admin,legacy}"]\n');
    for (const name of ['catalog', 'admin']) {
      const directory = join(root, 'apps', name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'pyproject.toml'), `[project]\nname = "synthetic-${name}"\nversion = "1.0.0"\n`);
      const discovered = await discoverPythonPackage({ entrypointDir: directory, rootDir: root });
      assert.equal(discovered.manifest?.data.project?.name, `synthetic-${name}`);
      assert.equal(discovered.workspaceManifest?.data.project?.name,
        name === 'catalog' ? 'synthetic-root' : 'synthetic-admin');
    }
    await assert.rejects(discoverPythonPackage({ entrypointDir: dirname(root), rootDir: root }),
      /outside of repository root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Exercise the three repaired parser paths through minimatch, not a copied parser.
// Each input is <= 4,003 characters. Child memory/time are bounded; the comma
// case uses a small stack to expose recursion without a large exhaustion input.
for (const scenario of ['nested', 'rewrite', 'comma'] as const) {
  test(`brace-expansion regression through minimatch: ${scenario}`, () => {
    const child = spawnSync(process.execPath, [
      '--max-old-space-size=96', ...(scenario === 'comma' ? ['--stack-size=256'] : []), '-e',
      `const assert = require('node:assert/strict');
       const { braceExpand } = require(process.argv[1]);
       const scenario = process.argv[2];
       if (scenario === 'nested') {
         const input = '{'.repeat(1100) + 'a,b' + '}'.repeat(1100);
         assert.deepEqual(braceExpand(input), [input]);
       } else if (scenario === 'rewrite') {
         const input = '{a}' + '}'.repeat(1100) + ',z}';
         assert.deepEqual(braceExpand(input), [input]);
       } else {
         const input = '{' + '{a},'.repeat(1000) + 'b}';
         const output = braceExpand(input);
         assert.equal(output.length, 1001);
         assert(output.slice(0, -1).every(item => item === '{a}'));
         assert.equal(output.at(-1), 'b');
       }
       process.stdout.write('consumer-regression-pass');`,
      pythonRequire.resolve('minimatch'), scenario,
    ], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      env: { PATH: dirname(process.execPath), LANG: 'C', TZ: 'UTC' },
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, 'consumer-regression-pass');
  });
}

test('the URI resolver actually used by Ajv canonicalizes encoded scheme-relative hosts', () => {
  for (const host of ['//%41.example/schema', '//A.example/schema', '//a.example/schema']) {
    assert.equal(uri.parse(host).host, 'a.example');
    assert.equal(uri.normalize(host), '//a.example/schema');
    assert.equal(uri.equal(host, '//a.example/schema'), true);
  }
  assert.equal(uri.equal('//a.example/schema', '//other.example/schema'), false);
  assert.equal(uri.resolve('https://a.example/config/', '../schema#limit'), 'https://a.example/schema#limit');
});

test('real static-config extraction validates function config with its installed Ajv', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const valid = '/synthetic-valid.ts';
  const invalid = '/synthetic-invalid.ts';
  project.createSourceFile(valid, 'export const config = { maxDuration: 60, architecture: "x86_64", regions: ["iad1"] };');
  project.createSourceFile(invalid, 'export const config = { maxDuration: { value: 60 }, architecture: "wrong" };');
  const config: unknown = getConfig(project, valid);
  assert.deepEqual(config, { maxDuration: 60, architecture: 'x86_64', regions: ['iad1'] });
  assert.throws(() => getConfig(project, invalid), /Invalid data/);

  const schema = {
    type: 'object',
    definitions: { duration: { type: 'number', minimum: 1, maximum: 60 } },
    properties: { maxDuration: { $ref: '#/definitions/duration' } },
    required: ['maxDuration'],
  } as const;
  const boundedConfig: unknown = getConfig(project, valid, schema);
  assert.deepEqual(boundedConfig, { maxDuration: 60, architecture: 'x86_64', regions: ['iad1'] });
  const tooLong = '/synthetic-too-long.ts';
  project.createSourceFile(tooLong, 'export const config = { maxDuration: 61 };');
  assert.throws(() => getConfig(project, tooLong, schema), /Invalid data/);
});
