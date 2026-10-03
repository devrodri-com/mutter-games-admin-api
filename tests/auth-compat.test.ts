import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { VercelRequest, VercelResponse } from '@vercel/node';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function request(method: string, token?: string, body: unknown = {}, id?: string): VercelRequest {
  return Object.assign(new IncomingMessage(new Socket()), {
    method, headers: { origin: 'http://127.0.0.1:5277', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    query: id ? { id } : {}, cookies: {}, body,
  });
}

async function call(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>,
  req: VercelRequest,
): Promise<{ status: number; body: unknown }> {
  let body: unknown;
  const raw = new ServerResponse(req);
  // Only adapt the Vercel HTTP response. Auth, handlers and Firestore stay real.
  const res: VercelResponse = Object.assign(raw, {
    status(code: number) { raw.statusCode = code; return res; },
    json(value: unknown) { body = value; return res; },
    send(value: unknown) { body = value; return res; },
    redirect(statusOrUrl: number | string, url?: string) {
      raw.statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      raw.setHeader('Location', typeof statusOrUrl === 'string' ? statusOrUrl : url ?? '');
      return res;
    },
  });
  await handler(req, res);
  return { status: raw.statusCode, body };
}

test('real Auth SDK and Admin consumers preserve claims, account state and local signing', async (t) => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/);
  process.env.CORS_ALLOW_ORIGIN = 'http://127.0.0.1:5277';
  const app = initializeApp({ projectId: 'demo-mutter-r1' });
  const auth = getAuth(app);
  const db = getFirestore(app);
  db.settings({ projectId: 'demo-mutter-auth-compat' });
  const { verifyAdmin } = await import('../api/_lib/verifyAdmin');
  const { default: users } = await import('../api/admin/users/index');
  const { default: user } = await import('../api/admin/users/[id]/index');
  const { default: imagekit } = await import('../api/imagekit-signature');
  const ownedUsers = new Set<string>();
  const createdDocuments = new Set<string>();
  const control = db.doc('operations/webStockCutover');

  async function createUser(claims: Record<string, unknown> = {}): Promise<string> {
    const record = await auth.createUser({ uid: `synthetic-compat-${randomUUID()}` });
    ownedUsers.add(record.uid);
    await auth.setCustomUserClaims(record.uid, claims);
    return record.uid;
  }

  async function signIn(uid: string): Promise<string> {
    const custom = await auth.createCustomToken(uid);
    const response = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    });
    assert.equal(response.status, 200);
    const payload: unknown = await response.json();
    assert.ok(isRecord(payload) && typeof payload.idToken === 'string');
    return payload.idToken;
  }

  async function rejectAtBoundary(token: string | undefined, status: number): Promise<void> {
    await assert.rejects(verifyAdmin(request('GET', token, { admin: true, superadmin: true })),
      (error: unknown) => isRecord(error) && error.status === status);
  }

  async function expectSdkRejection(token: string, code: string): Promise<void> {
    await assert.rejects(auth.verifyIdToken(token, true),
      (error: unknown) => isRecord(error) && error.code === code);
    await rejectAtBoundary(token, 401);
  }

  async function setControl(state: string): Promise<void> {
    await control.set({ schema: 1, state, revision: 'synthetic-auth-compat-control', updatedAt: new Date() });
  }

  try {
    await setControl('open');
    const operatorId = await createUser({ admin: true, superadmin: true });
    const operatorToken = await signIn(operatorId);
    const subjectId = await createUser();

    await t.test('missing/invalid tokens and untrusted role fields cannot authorize', async () => {
      await rejectAtBoundary(undefined, 401);
      await rejectAtBoundary('synthetic-invalid-token', 401);
      await rejectAtBoundary(await signIn(subjectId), 403);
      await auth.setCustomUserClaims(subjectId, { admin: 'true', superadmin: false });
      await rejectAtBoundary(await signIn(subjectId), 403);
    });

    await t.test('fresh real tokens preserve admin and superadmin claims', async () => {
      await auth.setCustomUserClaims(subjectId, { admin: true, superadmin: false });
      const admin = await verifyAdmin(request('GET', await signIn(subjectId)));
      assert.equal(admin.uid, subjectId);
      assert.equal(admin.isAdmin, true);
      assert.equal(admin.isSuperadmin, false);
      await auth.setCustomUserClaims(subjectId, { superadmin: true });
      const superadmin = await verifyAdmin(request('GET', await signIn(subjectId)));
      assert.equal(superadmin.uid, subjectId);
      assert.equal(superadmin.isAdmin, false);
      assert.equal(superadmin.isSuperadmin, true);
    });

    await t.test('revoked token fails SDK revocation and the real authorization boundary', async () => {
      const uid = await createUser({ admin: true });
      const token = await signIn(uid);
      const decoded = await auth.verifyIdToken(token, true);
      // Revocation precision is seconds. Cross the issued auth_time instead of
      // forging a timestamp or mocking SDK verification to force a rejection.
      const delay = Math.max(0, (decoded.auth_time + 1) * 1000 - Date.now() + 100);
      assert.ok(delay <= 2100);
      await setTimeout(delay);
      await auth.revokeRefreshTokens(uid);
      const record = await auth.getUser(uid);
      assert.ok(record.tokensValidAfterTime);
      assert.ok(Date.parse(record.tokensValidAfterTime) > decoded.auth_time * 1000);
      await expectSdkRejection(token, 'auth/id-token-revoked');
    });

    await t.test('disabled and deleted accounts are rejected by the installed SDK', async () => {
      const uid = await createUser({ admin: true });
      const token = await signIn(uid);
      await auth.updateUser(uid, { disabled: true });
      await expectSdkRejection(token, 'auth/user-disabled');
      await auth.updateUser(uid, { disabled: false });
      assert.equal((await auth.verifyIdToken(token, true)).uid, uid);
      await auth.deleteUser(uid);
      ownedUsers.delete(uid);
      await expectSdkRejection(token, 'auth/user-not-found');
    });

    await t.test('real users handlers create, change claims and delete a synthetic account', async () => {
      const email = `synthetic-${randomUUID()}@example.invalid`;
      const created = await call(users, request('POST', operatorToken, {
        email, password: `synthetic-${randomUUID()}`, nombre: 'Synthetic compatibility user', rol: 'admin',
      }));
      assert.equal(created.status, 201);
      assert.ok(isRecord(created.body) && typeof created.body.id === 'string');
      const uid = created.body.id;
      ownedUsers.add(uid);
      createdDocuments.add(uid);
      assert.deepEqual((await auth.getUser(uid)).customClaims, { admin: true, superadmin: false });
      assert.equal((await verifyAdmin(request('GET', await signIn(uid)))).isSuperadmin, false);
      const updated = await call(user, request('PATCH', operatorToken, { rol: 'superadmin' }, uid));
      assert.equal(updated.status, 200);
      assert.deepEqual((await auth.getUser(uid)).customClaims, { admin: true, superadmin: true });
      assert.equal((await verifyAdmin(request('GET', await signIn(uid)))).isSuperadmin, true);
      assert.equal((await db.doc(`adminUsers/${uid}`).get()).data()?.rol, 'superadmin');
      const deleted = await call(user, request('DELETE', operatorToken, {}, uid));
      assert.equal(deleted.status, 200);
      ownedUsers.delete(uid);
      assert.equal((await db.doc(`adminUsers/${uid}`).get()).exists, false);
      await assert.rejects(auth.getUser(uid), (error: unknown) => isRecord(error) && error.code === 'auth/user-not-found');
    });

    await t.test('ImageKit real handler signs only local synthetic inputs after authorization', async () => {
      process.env.IMAGEKIT_PUBLIC_KEY = 'synthetic-imagekit-public-key';
      process.env.IMAGEKIT_PRIVATE_KEY = 'synthetic-imagekit-private-key';
      const start = Math.floor(Date.now() / 1000);
      const result = await call(imagekit, request('GET', operatorToken));
      const end = Math.floor(Date.now() / 1000);
      assert.equal(result.status, 200);
      assert.ok(isRecord(result.body));
      const { token, expire, signature, publicKey } = result.body;
      assert.equal(typeof token, 'string');
      assert.equal(typeof expire, 'number');
      assert.ok(typeof token === 'string' && typeof expire === 'number');
      assert.match(token, /^[0-9a-f]{32}$/);
      assert.ok(expire >= start + 600 && expire <= end + 600);
      assert.equal(publicKey, 'synthetic-imagekit-public-key');
      assert.equal(signature, createHmac('sha1', 'synthetic-imagekit-private-key').update(token + String(expire)).digest('hex'));
      assert.equal((await call(imagekit, request('GET'))).status, 401);
      delete process.env.IMAGEKIT_PRIVATE_KEY;
      assert.equal((await call(imagekit, request('GET', operatorToken))).status, 500);
      process.env.IMAGEKIT_PRIVATE_KEY = 'synthetic-imagekit-private-key';
      for (const state of ['closed', 'reconciling']) {
        await setControl(state);
        assert.equal((await call(imagekit, request('GET', operatorToken))).status, 503);
      }
      await setControl('open');
    });
  } finally {
    delete process.env.IMAGEKIT_PUBLIC_KEY;
    delete process.env.IMAGEKIT_PRIVATE_KEY;
    for (const uid of ownedUsers) await auth.deleteUser(uid);
    for (const uid of createdDocuments) await db.doc(`adminUsers/${uid}`).delete();
    await control.delete();
    await db.terminate();
    await deleteApp(app);
  }
});
