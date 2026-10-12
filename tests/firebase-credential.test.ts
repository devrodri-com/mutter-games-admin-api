import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const probe = fileURLToPath(new URL('./helpers/firebase-credential-probe.ts', import.meta.url));
const scenarios = [
  'pkcs8', 'pkcs8-escaped', 'pkcs1', 'invalid-pem', 'truncated-pem', 'public-key',
  'missing-project', 'missing-email', 'missing-key',
] as const;

for (const scenario of scenarios) {
  test(`real Firebase credential consumer without emulator: ${scenario}`, () => {
    // A fresh process prevents a pre-existing default app or emulator signer from
    // skipping the credential.cert() branch in the production initialization.
    const result = spawnSync(process.execPath, ['--import', 'tsx', probe, scenario], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { PATH: process.env.PATH },
      encoding: 'utf8', timeout: 30_000, maxBuffer: 16_384,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0, result.stdout);
    const receipt: unknown = JSON.parse(result.stdout);
    assert.deepEqual(receipt, { scenario, passed: true, networkAttempts: 0 });
    assert.doesNotMatch(result.stdout, /BEGIN .*KEY|eyJ[a-zA-Z0-9_-]*\./);
  });
}
