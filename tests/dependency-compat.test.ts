import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { Gaxios } from 'gaxios';
import { Storage } from '@google-cloud/storage';
import { teenyRequest } from 'teeny-request';
import { makeUUID } from 'google-gax/build/src/util';
test('patched UUID stays compatible with real Google SDK consumers over loopback HTTP', async () => {
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const require = createRequire(import.meta.url);
  for (const consumer of ['firebase-admin', '@google-cloud/storage', 'gaxios', 'google-gax', 'teeny-request']) {
    const localRequire = createRequire(require.resolve(consumer));
    const metadata: unknown = localRequire('uuid/package.json');
    assert.ok(metadata && typeof metadata === 'object' && 'version' in metadata);
    assert.equal(metadata.version, '11.1.1');
  }
  assert.match(makeUUID(), uuidPattern);
  const captures: { contentType: string; body: string; client: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    captures.push({ contentType: String(req.headers['content-type'] ?? ''), body, client: String(req.headers['x-goog-api-client'] ?? '') });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ name: 'synthetic-file', size: '1' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await new Gaxios().request({ url, method: 'POST', timeout: 10000, multipart: [{ headers: { 'Content-Type': 'application/json' }, content: '{"synthetic":true}' }] });
    await new Promise<void>((resolve, reject) => teenyRequest({ uri: url, method: 'POST', headers: {}, timeout: 10000, multipart: [{ body: '{}' }, { body: Readable.from(['synthetic']) }] }, error => error ? reject(error) : resolve()));
    const storage = new Storage({ projectId: 'demo-mutter-r1', apiEndpoint: url });
    const [metadata] = await storage.bucket('synthetic').file('synthetic-file').getMetadata();
    assert.equal(metadata.name, 'synthetic-file');
    for (const capture of captures.slice(0, 2)) {
      const boundary = capture.contentType.split('boundary=')[1]; assert.match(boundary, uuidPattern); assert.ok(capture.body.includes(boundary));
    }
    assert.equal(captures.length, 3);
    assert.match(captures[2].client, /gccl-invocation-id\/[a-f0-9-]{36}/);
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
});
