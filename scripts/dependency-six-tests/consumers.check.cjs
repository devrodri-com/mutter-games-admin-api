const path = require('node:path');
const { test } = require('node:test');
const { boundedCase } = require('./bounded.cjs');

const root = path.resolve(__dirname, '../..');
for (const scenario of ['multipart-valid-file', 'multipart-field-cr', 'multipart-field-lf',
  'multipart-file-cr', 'multipart-file-lf', 'multipart-field-encoded-cr',
  'multipart-field-encoded-lf', 'multipart-file-encoded-cr', 'multipart-file-encoded-lf']) {
  boundedCase(test, 'busboy.cjs', root, scenario);
}
for (const scenario of ['cjs-parent-roundtrip', 'cjs-flat-valid', 'cjs-flat-malformed']) {
  boundedCase(test, 'toml.cjs', root, scenario);
}
for (const scenario of ['esm-runtime-cjs-parent-roundtrip', 'esm-smol-flat-valid', 'esm-smol-flat-malformed']) {
  boundedCase(test, 'toml.mjs', root, scenario);
}
