'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { glob, FileBlob } = require('@vercel/build-utils');
const evidence = require('../api-packaging-evidence.cjs');
const root = path.resolve(__dirname, '../..');

// Tests below exercise byte preservation and archive boundaries only. The CI
// packaging step separately captures all twelve outputs from the real builder.
function failingStream() {
  const stream = new EventEmitter();
  stream.destroy = () => { stream.emit('close'); };
  setImmediate(() => stream.emit('error', new Error('synthetic stream failure')));
  return stream;
}
async function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mutter-packaging-evidence-'));
  const folder = path.join(temporary, 'output');
  const sources = Object.keys(await glob('api/**/*.ts', root));
  const entries = sources.filter(name => !name.split('/').some(part => part.startsWith('_') || part.startsWith('.')) && !name.endsWith('.d.ts')).sort();
  const state = evidence.begin(folder, root, sources);
  return { folder, state, entries, close: () => fs.rmSync(temporary, { recursive: true, force: false }) };
}
test('materializer preserves legacy stream bytes and detects output, source and file-set tampering', async () => {
  const f = await fixture();
  try {
    for (const entrypoint of f.entries) {
      const handler = entrypoint.replace(/\.ts$/, '.js');
      await evidence.preserve(f.state, entrypoint, { handler, runtime: 'nodejs', files: {
        [handler]: new FileBlob({ data: Buffer.from('synthetic emitted bytes\n') }),
      } });
    }
    const finished = evidence.finish(f.state);
    assert.equal(finished.functions, 12);
    const checked = evidence.verify(f.folder, root);
    assert.equal(checked.status, 'PACKAGING_BYTES_VERIFIED');
    assert.equal(checked.remoteRuntime, 'NOT_VERIFIED');
    assert.equal(checked.deployableRelease, false);
    const file = path.join(f.folder, f.state.functions[0].files[0].path);
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, 'changed');
    assert.throws(() => evidence.verify(f.folder, root));
    fs.writeFileSync(file, original);
    const unexpected = path.join(f.folder, 'unexpected.js');
    fs.writeFileSync(unexpected, 'extra');
    assert.throws(() => evidence.verify(f.folder, root), /additional emitted file set/);
    fs.unlinkSync(unexpected);
    const manifest = path.join(f.folder, 'manifest.json');
    const bytes = fs.readFileSync(manifest);
    const value = JSON.parse(bytes);
    value.source.files[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(manifest, JSON.stringify(value));
    assert.throws(() => evidence.verify(f.folder, root), /source or installed builder changed/);
    fs.writeFileSync(manifest, bytes);
    fs.symlinkSync(file, path.join(f.folder, 'linked.js'));
    assert.throws(() => evidence.verify(f.folder, root), /symlink forbidden/);
  } finally { f.close(); }
});
test('materializer refuses traversal before any emitted file is written', async () => {
  const f = await fixture();
  try {
    await assert.rejects(evidence.preserve(f.state, f.entries[0], {
      handler: '../escape.js', runtime: 'nodejs', files: { '../escape.js': new FileBlob({ data: Buffer.from('unsafe') }) },
    }), /Unsafe output path/);
    assert.deepEqual(fs.readdirSync(f.folder), []);
  } finally { f.close(); }
});
test('materializer preserves stream errors as failure and cannot finalize a partial function set', async () => {
  const f = await fixture();
  try {
    const handler = f.entries[0].replace(/\.ts$/, '.js');
    await assert.rejects(evidence.preserve(f.state, f.entries[0], {
      handler, runtime: 'nodejs', files: { [handler]: { toStream: failingStream } },
    }), /synthetic stream failure/);
    assert.throws(() => evidence.finish(f.state), /twelve actual API functions required/);
  } finally { f.close(); }
});
