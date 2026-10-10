import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeDemoAdmin, installCredentialCutover, admitFixtureAccount, cleanupCredentialAccounts } from './helpers/credential-fixture';
import type { CredentialRoles } from '../api/_lib/credential-access-state';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function request(method: string, token?: string, body: unknown = {}, id?: string): VercelRequest {
  const query: VercelRequest['query'] = id ? { id } : {};
  return Object.assign(new IncomingMessage(new Socket()), {
    method, headers: { origin: 'http://127.0.0.1:5277', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    query, cookies: {}, body,
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
  const app = initializeDemoAdmin();
  const auth = getAuth(app);
  const db = getFirestore(app);
  db.settings({ projectId: 'demo-mutter-auth-compat' });
  const { verifyAdmin } = await import('../api/_lib/verifyAdmin');
  const { default: users } = await import('../api/admin/users/index');
  const { default: user } = await import('../api/admin/users/[id]/index');
  const { default: imagekit } = await import('../api/imagekit-signature');
  const { default: clients } = await import('../api/admin/clients/index');
  const ownedUsers = new Set<string>();
  const passwords = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const createdDocuments = new Set<string>();
  const admittedUsers = new Set<string>();
  const control = db.doc('operations/webStockCutover');

  async function admit(uid: string, roles: CredentialRoles): Promise<string> {
    const issued = await admitFixtureAccount(auth, db, uid, roles);
    admittedUsers.add(uid);
    refreshTokens.set(uid, issued.refreshToken);
    return issued.token;
  }

  async function createUser(claims: Record<string, unknown> = {}): Promise<string> {
    const uid = `synthetic-compat-${randomUUID()}`, password = `synthetic-${randomUUID()}`;
    const record = await auth.createUser({ uid, email: `${uid}@example.invalid`, password });
    passwords.set(uid, password);
    ownedUsers.add(record.uid);
    await auth.setCustomUserClaims(record.uid, claims);
    return record.uid;
  }

  async function signIn(uid: string): Promise<string> {
    const account = await auth.getUser(uid);
    const password = passwords.get(uid);
    assert.ok(account.email && password);
    const response = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password, returnSecureToken: true }),
    });
    assert.equal(response.status, 200);
    const payload: unknown = await response.json();
    assert.ok(isRecord(payload) && typeof payload.idToken === 'string' && typeof payload.refreshToken === 'string');
    refreshTokens.set(uid, payload.refreshToken);
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
    await installCredentialCutover(db);
    const operatorId = await createUser({ admin: true, superadmin: true });
    const operatorPasswordToken = await signIn(operatorId);
    const operatorToken = await admit(operatorId, { admin: true, superadmin: true });
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
      await rejectAtBoundary(await signIn(subjectId), 403);
      const admin = await verifyAdmin(request('GET', await admit(subjectId, { admin: true, superadmin: false })));
      assert.equal(admin.uid, subjectId);
      assert.equal(admin.isAdmin, true);
      assert.equal(admin.isSuperadmin, false);
      await auth.setCustomUserClaims(subjectId, { superadmin: true });
      await rejectAtBoundary(await signIn(subjectId), 403);
      const superadmin = await verifyAdmin(request('GET', await admit(subjectId, { admin: false, superadmin: true })));
      assert.equal(superadmin.uid, subjectId);
      assert.equal(superadmin.isAdmin, false);
      assert.equal(superadmin.isSuperadmin, true);
    });

    await t.test('capability renewal preserves verified access; ordinary password stays contained', async () => {
      const refreshToken = refreshTokens.get(operatorId);
      assert.ok(refreshToken);
      const result = await fetch('http://127.0.0.1:9198/securetoken.googleapis.com/v1/token?key=synthetic', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      });
      assert.equal(result.status, 200);
      const renewed: unknown = await result.json();
      assert.ok(isRecord(renewed) && typeof renewed.id_token === 'string');
      assert.equal((await verifyAdmin(request('GET', renewed.id_token))).uid, operatorId);
      await rejectAtBoundary(operatorPasswordToken, 403);
      await rejectAtBoundary(await signIn(operatorId), 403);
    });

    await t.test('revoked token fails SDK revocation and the real authorization boundary', async () => {
      const uid = await createUser({ admin: true });
      const token = await admit(uid, { admin: true, superadmin: false });
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
      const token = await admit(uid, { admin: true, superadmin: false });
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
      const password = `synthetic-${randomUUID()}`;
      const created = await call(users, request('POST', operatorToken, {
        email, password, nombre: 'Synthetic compatibility user', rol: 'admin',
      }));
      assert.equal(created.status, 201);
      assert.ok(isRecord(created.body) && typeof created.body.id === 'string');
      const uid = created.body.id;
      passwords.set(uid, password);
      ownedUsers.add(uid);
      createdDocuments.add(uid);
      assert.deepEqual((await auth.getUser(uid)).customClaims, { admin: true, superadmin: false });
      await rejectAtBoundary(await signIn(uid), 403);
      const beforeRoleChange = await admit(uid, { admin: true, superadmin: false });
      assert.equal((await verifyAdmin(request('GET', beforeRoleChange))).isSuperadmin, false);
      const updated = await call(user, request('PATCH', operatorToken, { rol: 'superadmin' }, uid));
      assert.equal(updated.status, 200);
      assert.deepEqual((await auth.getUser(uid)).customClaims, { admin: true, superadmin: true });
      await rejectAtBoundary(await signIn(uid), 403);
      assert.equal((await verifyAdmin(request('GET', beforeRoleChange))).isSuperadmin, false);
      // Changing global role metadata cannot expand a pinned session. This
      // explicit authority fixture models a separately authorized role change.
      assert.equal((await verifyAdmin(request('GET', await admit(uid, { admin: true, superadmin: true })))).isSuperadmin, true);
      assert.equal((await db.doc(`adminUsers/${uid}`).get()).data()?.rol, 'superadmin');
      const deleted = await call(user, request('DELETE', operatorToken, {}, uid));
      assert.equal(deleted.status, 200);
      ownedUsers.delete(uid);
      assert.equal((await db.doc(`adminUsers/${uid}`).get()).exists, false);
      await assert.rejects(auth.getUser(uid), (error: unknown) => isRecord(error) && error.code === 'auth/user-not-found');
    });

    await t.test('real Admin clients GET requires the pinned operator capability and preserves the same UID data', async () => {
      const ref = db.doc(`clients/${subjectId}`), data = { uid: subjectId, name: 'Synthetic retained client', orderIds: ['retained-order'] };
      await ref.set(data);
      try {
        assert.equal((await call(clients, request('GET', operatorPasswordToken))).status, 403);
        const result = await call(clients, request('GET', operatorToken));
        assert.equal(result.status, 200);
        assert.ok(isRecord(result.body) && Array.isArray(result.body.clients));
        assert.ok(result.body.clients.some((client: unknown) => isRecord(client) && client.id === subjectId && client.uid === subjectId));
        assert.deepEqual((await ref.get()).data(), data);
      } finally { await ref.delete(); }
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
    await cleanupCredentialAccounts(db, admittedUsers);
    await db.doc('operations/credentialAccessCutover').delete();
    await control.delete();
    await db.terminate();
    await deleteApp(app);
  }
});
