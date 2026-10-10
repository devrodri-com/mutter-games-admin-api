import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { CreateRequest } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeDemoAdmin, installCredentialCutover, admitFixtureAccount, cleanupCredentialAccounts } from './helpers/credential-fixture';
import { createNativeSession, requireCredentialSession } from '../api/_lib/credential-session';
import { object, type CredentialRoles } from '../api/_lib/credential-access-state';

function request(method: string, token: string, body: unknown = {}, id?: string): VercelRequest {
  const query: VercelRequest['query'] = id ? { id } : {};
  return Object.assign(new IncomingMessage(new Socket()), { method, query, cookies: {}, body,
    headers: { origin: 'http://127.0.0.1:5277', authorization: `Bearer ${token}` } });
}
async function invoke(handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>, req: VercelRequest) {
  let body: unknown;
  const raw = new ServerResponse(req);
  const res: VercelResponse = Object.assign(raw, { status(value: number) { raw.statusCode = value; return res; },
    json(value: unknown) { body = value; return res; }, send(value: unknown) { body = value; return res; },
    redirect(value: number | string, url?: string) { raw.statusCode = typeof value === 'number' ? value : 302; raw.setHeader('Location', url ?? String(value)); return res; } });
  await handler(req, res);
  return { status: raw.statusCode, body };
}

test('Admin role/create/delete lifecycle restricts real sessions before Auth and preserves business data on partial failures', async t => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  process.env.CORS_ALLOW_ORIGIN = 'http://127.0.0.1:5277';
  const app = initializeDemoAdmin(), auth = getAuth(app), db = getFirestore(app);
  const { default: userHandler } = await import('../api/admin/users/[id]/index');
  const { default: usersHandler } = await import('../api/admin/users/index');
  const owned = new Set<string>(), pendingOnly = new Set<string>(), businessPaths = new Set<string>();
  const actualFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== '127.0.0.1') throw new Error('Nonlocal synthetic transport forbidden');
    return actualFetch(input, init);
  };
  async function account(roles: CredentialRoles) {
    const uid = `lifecycle-${randomUUID()}`, password = `Synthetic-${randomUUID()}`, email = `${uid}@example.invalid`;
    await auth.createUser({ uid, email, password }); owned.add(uid);
    await auth.setCustomUserClaims(uid, roles);
    await db.doc(`adminUsers/${uid}`).set({ uid, email, nombre: 'Synthetic', rol: roles.superadmin ? 'superadmin' : 'admin', activo: true });
    const issued = await admitFixtureAccount(auth, db, uid, roles);
    return { uid, email, password, ...issued };
  }
  async function ruleRead(uid: string, token: string) {
    return fetch(`http://127.0.0.1:8188/v1/projects/demo-mutter-r1/databases/(default)/documents/adminUsers/${uid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  async function refreshed(refreshToken: string) {
    const response = await fetch('http://127.0.0.1:9198/securetoken.googleapis.com/v1/token?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    assert.equal(response.status, 200);
    const value: unknown = await response.json();
    assert.ok(object(value) && typeof value.id_token === 'string');
    return value.id_token;
  }
  async function nativeToken(email: string, password: string) {
    const signed = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    assert.equal(signed.status, 200); const value: unknown = await signed.json();
    assert.ok(object(value) && typeof value.idToken === 'string');
    return value.idToken;
  }
  async function blocked(uid: string, token: string) {
    const claims = await auth.verifyIdToken(token, true);
    await assert.rejects(requireCredentialSession(auth, db, claims, 'admin'), { code: 'RECOVERY_REQUIRED' });
    assert.equal((await invoke(userHandler, request('GET', token, {}, uid))).status, 403);
    assert.equal((await ruleRead(uid, token)).status, 403);
  }
  async function preserveBusiness(uid: string) {
    const paths = [`products/${uid}`, `clients/${uid}`, `carts/${uid}`, `orders/${uid}`];
    for (const path of paths) {
      await db.doc(path).set({ uid, active: true, stockTotal: 3, title: 'Catalog retained', items: [{ id: 'synthetic', quantity: 1 }] });
      businessPaths.add(path);
    }
    const before = await Promise.all(paths.map(path => db.doc(path).get()));
    return async () => {
      const after = await Promise.all(paths.map(path => db.doc(path).get()));
      assert.deepEqual(after.map(row => ({ data: row.data(), updateTime: row.updateTime })), before.map(row => ({ data: row.data(), updateTime: row.updateTime })));
    };
  }
  try {
    await installCredentialCutover(db);
    await db.doc('operations/webStockCutover').set({ schema: 1, state: 'open', revision: 'synthetic-lifecycle-open', updatedAt: new Date() });
    const operator = await account({ admin: true, superadmin: true });
    await t.test('demotion contains the original capability and the real refreshed token', async () => {
      const subject = await account({ admin: true, superadmin: true }), preserved = await preserveBusiness(subject.uid);
      assert.equal((await ruleRead(subject.uid, subject.token)).status, 200);
      const before = await db.doc(`credentialAccess/${subject.uid}`).get();
      const result = await invoke(userHandler, request('PATCH', operator.token, { rol: 'admin' }, subject.uid));
      assert.equal(result.status, 200);
      const protectedState = await db.doc(`credentialAccess/${subject.uid}`).get();
      assert.equal(protectedState.get('status'), 'PENDING');
      assert.equal(protectedState.get('uid'), subject.uid);
      assert.equal(protectedState.get('recoveryEmail'), before.get('recoveryEmail'));
      assert.equal(protectedState.get('channelEvidenceSha256'), before.get('channelEvidenceSha256'));
      assert.deepEqual(protectedState.get('roles'), { admin: true, superadmin: false });
      assert.deepEqual((await auth.getUser(subject.uid)).customClaims, { admin: true, superadmin: false });
      await blocked(subject.uid, subject.token);
      const renewed = await refreshed(subject.refreshToken);
      // Firebase retains the higher-priority session claim: the protected gate,
      // not a fixture that erases it, must revoke its administrative effect.
      assert.equal((await auth.verifyIdToken(renewed, true)).superadmin, true);
      await blocked(subject.uid, renewed); await preserved();
    });
    await t.test('Auth claim failure leaves the protected restriction committed', async () => {
      const subject = await account({ admin: true, superadmin: true }), preserved = await preserveBusiness(subject.uid);
      const failure = mock.method(auth, 'setCustomUserClaims', async () => { throw new Error('Synthetic Auth interruption'); });
      let result;
      try { result = await invoke(userHandler, request('PATCH', operator.token, { rol: 'admin' }, subject.uid)); }
      finally { failure.mock.restore(); }
      assert.equal(result.status, 503);
      assert.equal((await db.doc(`credentialAccess/${subject.uid}`).get()).get('status'), 'PENDING');
      assert.equal((await auth.getUser(subject.uid)).customClaims?.superadmin, true);
      await blocked(subject.uid, subject.token); await blocked(subject.uid, await refreshed(subject.refreshToken)); await preserved();
    });
    await t.test('failed Auth deletion blocks Rules and SDK while retaining UID, channel and data', async () => {
      const subject = await account({ admin: true, superadmin: true }), preserved = await preserveBusiness(subject.uid);
      const before = await db.doc(`credentialAccess/${subject.uid}`).get();
      const failure = mock.method(auth, 'deleteUser', async () => { throw new Error('Synthetic delete interruption'); });
      let result;
      try { result = await invoke(userHandler, request('DELETE', operator.token, {}, subject.uid)); }
      finally { failure.mock.restore(); }
      assert.equal(result.status, 503);
      assert.equal((await auth.getUser(subject.uid)).uid, subject.uid);
      assert.equal((await db.doc(`adminUsers/${subject.uid}`).get()).exists, true);
      const state = await db.doc(`credentialAccess/${subject.uid}`).get();
      assert.equal(state.get('status'), 'PENDING'); assert.deepEqual(state.get('roles'), { admin: false, superadmin: false });
      assert.equal(state.get('recoveryEmail'), before.get('recoveryEmail')); assert.equal(state.get('channelEvidenceSha256'), before.get('channelEvidenceSha256'));
      await blocked(subject.uid, subject.token); await preserved();
    });
    await t.test('a profile role increase cannot expand an existing session capability', async () => {
      const subject = await account({ admin: true, superadmin: false });
      const result = await invoke(userHandler, request('PATCH', operator.token, { rol: 'superadmin' }, subject.uid));
      assert.equal(result.status, 200);
      const state = await db.doc(`credentialAccess/${subject.uid}`).get();
      assert.equal(state.get('status'), 'PENDING'); assert.deepEqual(state.get('roles'), { admin: true, superadmin: false });
      await blocked(subject.uid, subject.token); await blocked(subject.uid, await refreshed(subject.refreshToken));
    });
    await t.test('creation keeps independently unverified metadata pending and blocks privileged native bootstrap', async () => {
      const email = `created-${randomUUID()}@example.invalid`, password = `Synthetic-${randomUUID()}`;
      const actualCreateUser = auth.createUser.bind(auth);
      const observe = mock.method(auth, 'createUser', async (properties: CreateRequest) => {
        assert.equal(typeof properties.uid, 'string'); assert.ok(properties.uid);
        const prepared = await db.doc(`credentialAccess/${properties.uid}`).get();
        assert.equal(prepared.get('status'), 'PENDING');
        assert.equal(prepared.get('channelStatus'), 'UNVERIFIED');
        assert.deepEqual(prepared.get('roles'), { admin: true, superadmin: false });
        const created = await actualCreateUser(properties); owned.add(created.uid);
        // Try the actual ordinary sign-in in the interval before the handler
        // sets Auth role claims. The protected reservation must already deny it.
        const claims = await auth.verifyIdToken(await nativeToken(email, password), true);
        assert.equal(claims.admin, undefined);
        await assert.rejects(createNativeSession(auth, db, claims), { code: 'RECOVERY_REQUIRED' });
        return created;
      });
      let result;
      try { result = await invoke(usersHandler, request('POST', operator.token, { email, password, nombre: 'Created', rol: 'admin' })); }
      finally { observe.mock.restore(); }
      assert.equal(result.status, 201); assert.ok(object(result.body) && typeof result.body.id === 'string');
      const uid = result.body.id; owned.add(uid);
      const state = await db.doc(`credentialAccess/${uid}`).get();
      assert.equal(state.get('uid'), uid); assert.equal(state.get('status'), 'PENDING');
      assert.equal(state.get('recoveryEmail'), null); assert.equal(state.get('channelStatus'), 'UNVERIFIED');
      assert.deepEqual(state.get('roles'), { admin: true, superadmin: false });
      const token = await nativeToken(email, password);
      const claims = await auth.verifyIdToken(token, true);
      await assert.rejects(createNativeSession(auth, db, claims), { code: 'RECOVERY_REQUIRED' });
      await blocked(uid, token);
    });
    await t.test('failed Auth creation exposes its retained pending operation and creates no admitted account', async () => {
      const failure = mock.method(auth, 'createUser', async (properties: CreateRequest) => {
        assert.ok(properties.uid); pendingOnly.add(properties.uid);
        const state = await db.doc(`credentialAccess/${properties.uid}`).get();
        assert.equal(state.get('status'), 'PENDING'); assert.equal(state.get('channelStatus'), 'UNVERIFIED');
        throw new Error('Synthetic create interruption');
      });
      let result;
      try { result = await invoke(usersHandler, request('POST', operator.token, { email: `partial-${randomUUID()}@example.invalid`, password: `Synthetic-${randomUUID()}`, rol: 'admin' })); }
      finally { failure.mock.restore(); }
      assert.equal(result.status, 503); assert.ok(object(result.body) && typeof result.body.id === 'string');
      const uid = result.body.id;
      assert.equal(result.body.credentialAccess, 'PENDING'); assert.ok(pendingOnly.has(uid));
      await assert.rejects(auth.getUser(uid), { code: 'auth/user-not-found' });
      assert.equal((await db.doc(`adminUsers/${uid}`).get()).exists, false);
      const sessions = await db.collection('credentialSessions').where('uid', '==', uid).get();
      assert.equal(sessions.empty, true);
      assert.equal((await db.doc(`credentialAccess/${uid}`).get()).get('status'), 'PENDING');
    });
    await t.test('malformed role/body/id cannot mutate protected access or create accounts', async () => {
      const subject = await account({ admin: true, superadmin: true });
      const before = await db.doc(`credentialAccess/${subject.uid}`).get();
      for (const body of [{ rol: 'owner' }, { activo: 'false' }, { nombre: 42 }, { admin: true }]) {
        assert.equal((await invoke(userHandler, request('PATCH', operator.token, body, subject.uid))).status, 400);
      }
      assert.equal((await invoke(userHandler, request('DELETE', operator.token, {}, '../other'))).status, 400);
      const after = await before.ref.get(); assert.deepEqual(after.data(), before.data());
      assert.ok(after.updateTime && before.updateTime && after.updateTime.isEqual(before.updateTime));
    });
  } finally {
    globalThis.fetch = actualFetch; mock.restoreAll();
    for (const uid of owned) { await auth.deleteUser(uid); await db.doc(`adminUsers/${uid}`).delete(); }
    for (const path of businessPaths) await db.doc(path).delete();
    await cleanupCredentialAccounts(db, owned);
    await cleanupCredentialAccounts(db, pendingOnly);
    await db.terminate(); await deleteApp(app);
  }
});
