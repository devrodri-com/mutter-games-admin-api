// No provider requests: real Firebase Admin HttpClient against loopback only.
// Every parser case runs in a separate memory/time-bounded process, including
// the 252-byte boundary regression that can hang the affected dependency.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

async function exercise(root, scenario) {
  const local = createRequire(path.join(root, 'package.json'));
  const adminEntry = local.resolve('firebase-admin');
  const admin = createRequire(adminEntry);
  const Busboy = admin('@fastify/busboy');
  const boundary = scenario.includes('long-boundary') ? 'a'.repeat(252) : 'synthetic-boundary';
  const header = scenario.includes('proto') ? '__proto__: safe\r\n' : scenario.includes('constructor') ? 'constructor: safe\r\n' : '';
  const preamble = scenario.includes('long-boundary') ? 'b'.repeat(1024) + '\r\n' : '';
  const body = preamble + `--${boundary}\r\n${header}Content-Disposition: form-data; name="sample"\r\n\r\nvalue\r\n--${boundary}--\r\n`;
  if (scenario.startsWith('sdk-')) {
    const http = require('node:http');
    const { once } = require('node:events');
    const server = http.createServer((req, res) => {
      assert.equal(req.method, 'GET');
      assert.equal(req.url, '/synthetic');
      res.writeHead(200, { 'content-type': `multipart/mixed; boundary=${boundary}` });
      res.end(body);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      // Resolve the actual installed consumer; no copied parser or HTTP mock.
      const { HttpClient } = require(path.join(path.dirname(adminEntry), 'utils/api-request.js'));
      const result = await new HttpClient().send({ method: 'GET', url: `http://127.0.0.1:${server.address().port}/synthetic` });
      assert.equal(result.status, 200);
      assert.deepEqual(result.multipart.map(bytes => bytes.toString()), ['value']);
      assert.throws(() => result.data, /Unable to parse multipart/);
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } else if (scenario === 'normal-form') {
    const parser = new Busboy({ headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    const fields = [];
    parser.on('field', (name, value) => fields.push([name, value]));
    const finished = new Promise((resolve, reject) => { parser.on('finish', resolve); parser.on('error', reject); });
    parser.end(body);
    await finished;
    assert.deepEqual(fields, [['sample', 'value']]);
  } else if (scenario === 'field-limit') {
    const parser = new Busboy({ headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, limits: { fieldSize: 3 } });
    const fields = [];
    parser.on('field', (name, value, nameTruncated, valueTruncated) => fields.push({ name, value, valueTruncated }));
    const finished = new Promise((resolve, reject) => { parser.on('finish', resolve); parser.on('error', reject); });
    parser.end(body);
    await finished;
    assert.deepEqual(fields, [{ name: 'sample', value: 'val', valueTruncated: true }]);
  } else {
    const parser = new Busboy.Dicer({ boundary });
    const parts = [];
    const errors = [];
    parser.on('part', part => {
      const chunks = [];
      part.on('data', chunk => chunks.push(chunk));
      part.on('end', () => parts.push(Buffer.concat(chunks).toString()));
      part.on('error', error => errors.push(error.message));
    });
    parser.on('error', error => errors.push(error.message));
    const finished = new Promise(resolve => parser.on('finish', resolve));
    parser.end(scenario === 'truncated' ? body.slice(0, body.lastIndexOf('--')) : body);
    await finished;
    if (scenario === 'truncated') assert.ok(errors.length > 0, 'truncated multipart must report an error');
    else { assert.deepEqual(errors, []); assert.deepEqual(parts, ['value']); }
  }
  console.log(JSON.stringify({ scenario, root, firebaseAdmin: admin('../package.json').version, busboy: admin('@fastify/busboy/package.json').version, consumer: adminEntry }));
}

if (process.argv[2] === '--case') {
  exercise(path.resolve(process.argv[3]), process.argv[4]).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { test } = require('node:test');
  const roots = process.argv.slice(2);
  if (roots.length === 0) roots.push(process.cwd());
  for (const root of roots) {
    for (const scenario of ['normal-form', 'field-limit', 'dicer-normal', 'dicer-proto', 'dicer-constructor', 'dicer-long-boundary', 'truncated', 'sdk-normal', 'sdk-proto', 'sdk-constructor', 'sdk-long-boundary']) {
      test(`${path.resolve(root)} / ${scenario}`, () => {
        const result = spawnSync(process.execPath, ['--max-old-space-size=192', __filename, '--case', root, scenario], {
          timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 1024 * 1024,
          env: { PATH: process.env.PATH, LANG: 'C' },
        });
        assert.equal(result.error, undefined, `${result.error?.message}\n${result.stderr}`);
        assert.equal(result.status, 0, result.stderr);
        const receipt = JSON.parse(result.stdout.trim());
        console.log(JSON.stringify(receipt));
      });
    }
  }
}
