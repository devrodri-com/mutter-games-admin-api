import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { VercelResponse } from '@vercel/node';

function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown): string { assert.equal(typeof value, 'string'); return String(value); }

test('real Auth sessions at every Admin destination; derived-session residual is explicit', async t => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  process.env.CORS_ALLOW_ORIGIN = 'http://127.0.0.1:5277';
  const app = initializeApp({ projectId: 'demo-mutter-r1' });
  const auth = getAuth(app), db = getFirestore(app);
  db.settings({ projectId: 'demo-mutter-session-boundary' });
  const { verifyAdmin } = await import('../api/_lib/verifyAdmin');
  const uid = `synthetic-boundary-${randomUUID()}`;
  const email = `${uid}@example.invalid`, password = `synthetic-${randomUUID()}`;
  async function post(action: string, body: unknown) {
    const result = await fetch(`http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:${action}?key=synthetic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(result.status, 200, action); return object(await result.json());
  }
  function request(token: string, method = 'GET') {
    return Object.assign(new IncomingMessage(new Socket()), { method, cookies: {}, query: { id: 'p', categoryId: 'c' },
      headers: { origin: process.env.CORS_ALLOW_ORIGIN, authorization: `Bearer ${token}`, 'x-sign-in-provider': 'password' },
      body: { admin: true, firebase: { sign_in_provider: 'password' } } });
  }
  async function invoke(route: string, method: string, token: string) {
    const { default: handler } = await import(`../api/${route}.ts`);
    const req = request(token, method), raw = new ServerResponse(req);
    const res: VercelResponse = Object.assign(raw, {
      status(code: number) { raw.statusCode = code; return res; }, json() { return res; }, send() { return res; },
      redirect(statusOrUrl: number | string, url?: string) { raw.statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 302; raw.setHeader('Location', url ?? String(statusOrUrl)); return res; },
    });
    await handler(req, res);
    assert.equal(raw.getHeader('Access-Control-Allow-Origin'), process.env.CORS_ALLOW_ORIGIN);
    return raw.statusCode;
  }
  const routes: [string, string[]][] = [
    ['admin/products/index', ['GET', 'POST']], ['admin/products/[id]/index', ['GET', 'PATCH', 'DELETE']],
    ['admin/categories/index', ['GET', 'POST']], ['admin/categories/[id]/index', ['PATCH', 'DELETE']],
    ['admin/subcategories/index', ['GET', 'POST']], ['admin/subcategories/[id]/index', ['DELETE']],
    ['admin/users/index', ['GET', 'POST']], ['admin/users/[id]/index', ['GET', 'PATCH', 'DELETE']],
    ['admin/clients/index', ['GET']], ['admin/clients/[id]/index', ['DELETE']],
    ['imagekit-signature', ['GET']],
  ];
  try {
    await auth.createUser({ uid });
    await auth.setCustomUserClaims(uid, { admin: true, superadmin: true });
    const signed = await post('signInWithCustomToken', { token: await auth.createCustomToken(uid), returnSecureToken: true });
    const custom = text(signed.idToken);
    const refreshed = await fetch('http://127.0.0.1:9198/securetoken.googleapis.com/v1/token?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: text(signed.refreshToken) }),
    });
    assert.equal(refreshed.status, 200);
    const renewed = text(object(await refreshed.json()).id_token);
    for (const token of [custom, renewed]) assert.equal((await auth.verifyIdToken(token, true)).firebase.sign_in_provider, 'custom');
    await t.test('new and renewed custom sessions cannot reach reads, writers or upload signing', async () => {
      for (const state of ['open', 'closed']) {
        await db.doc('operations/webStockCutover').set({ schema: 1, state, revision: 'synthetic-session-boundary', updatedAt: new Date() });
        for (const token of [custom, renewed]) for (const [route, methods] of routes) for (const method of methods) {
          assert.equal(await invoke(route, method, token), 403, `${state} ${method} ${route}`);
        }
      }
      assert.deepEqual((await db.listCollections()).map(c => c.id), ['operations']);
    });
    await t.test('characterization: custom can link password and regain the same UID/roles; operational closure required', async () => {
      await post('update', { idToken: custom, email, password, returnSecureToken: true });
      const ordinary = await post('signInWithPassword', { email, password, returnSecureToken: true });
      const token = text(ordinary.idToken), decoded = await auth.verifyIdToken(token, true);
      assert.equal(decoded.uid, uid); assert.equal(decoded.firebase.sign_in_provider, 'password');
      assert.equal(decoded.admin, true);
      assert.equal((await verifyAdmin(request(token))).uid, uid);
      // Password changes through a custom session are another derived credential.
      const changed = `synthetic-changed-${randomUUID()}`;
      const reissued = await post('signInWithCustomToken', { token: await auth.createCustomToken(uid), returnSecureToken: true });
      await post('update', { idToken: text(reissued.idToken), password: changed, returnSecureToken: true });
      const changedLogin = await post('signInWithPassword', { email, password: changed, returnSecureToken: true });
      assert.equal((await verifyAdmin(request(text(changedLogin.idToken)))).uid, uid);
      const refresh = await fetch('http://127.0.0.1:9198/securetoken.googleapis.com/v1/token?key=synthetic', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: text(changedLogin.refreshToken) }),
      });
      assert.equal(refresh.status, 200);
      assert.equal((await verifyAdmin(request(text(object(await refresh.json()).id_token)))).uid, uid);
    });
  } finally { await auth.deleteUser(uid); await db.terminate(); await deleteApp(app); }
});
