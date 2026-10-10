import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import type { VercelResponse } from '@vercel/node';
import { initializeDemoAdmin, installCredentialCutover, admitFixtureAccount, cleanupCredentialAccounts } from './helpers/credential-fixture';

test('every Admin writer is contained by central cutover; authenticated reads and reservations survive', async () => {
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
    process.env.CORS_ALLOW_ORIGIN = 'http://127.0.0.1:5277';
    // Auth uses the emulator's declared demo project; Firestore has an isolated
    // demo namespace so the maintenance document cannot race other test files.
    const app = initializeDemoAdmin();
    const db = getFirestore(app), auth = getAuth(app);
    db.settings({ projectId: 'demo-mutter-admin-cutover' });
    const user = await auth.createUser({ uid: 'synthetic-release-admin', email: 'synthetic-release-admin@example.invalid', password: 'synthetic-cutover-password' });
    await auth.setCustomUserClaims(user.uid, { admin: true, superadmin: true });
    const signed = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'synthetic-cutover-password', returnSecureToken: true }),
    });
    const body: unknown = await signed.json();
    if (!body || typeof body !== 'object' || !('idToken' in body) || typeof body.idToken !== 'string') throw new Error('Missing demo token');
    const oldPasswordToken = body.idToken;
    await auth.verifyIdToken(oldPasswordToken, true);
    await installCredentialCutover(db);
    const token = (await admitFixtureAccount(auth, db, user.uid, { admin: true, superadmin: true })).token;
    const routes = [
        ['admin/products/index', 'POST'], ['admin/products/[id]/index', 'PATCH'], ['admin/products/[id]/index', 'DELETE'],
        ['admin/categories/index', 'POST'], ['admin/categories/[id]/index', 'PATCH'], ['admin/categories/[id]/index', 'DELETE'],
        ['admin/subcategories/index', 'POST'], ['admin/subcategories/[id]/index', 'DELETE'],
        ['admin/users/index', 'POST'], ['admin/users/[id]/index', 'PATCH'], ['admin/users/[id]/index', 'DELETE'],
        ['admin/clients/[id]/index', 'DELETE'], ['imagekit-signature', 'GET'],
    ];
    async function call(route: string, method: string, authorization = token) {
        const { default: handler } = await import(`../api/${route}.ts`);
        const req = Object.assign(new IncomingMessage(new Socket()), { method, url: `/api/${route}`, cookies: {},
            headers: { origin: process.env.CORS_ALLOW_ORIGIN, authorization: `Bearer ${authorization}`, 'x-mutter-release-action': 'read-smoke' },
            query: { id: 'p', categoryId: 'c' }, body: {} });
        let output: unknown; const raw = new ServerResponse(req);
        const res: VercelResponse = Object.assign(raw, {
            status(code: number) { raw.statusCode = code; return res; },
            json(value: unknown) { output = value; return res; }, send(value: unknown) { output = value; return res; },
            redirect(statusOrUrl: number | string, url?: string) { raw.statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 302; raw.setHeader('Location', typeof statusOrUrl === 'string' ? statusOrUrl : url ?? ''); return res; },
        });
        await handler(req, res);
        return { status: res.statusCode, body: output };
    }
    const hold = { 'synthetic-live-reservation': { expiresAt: 1, lines: [{ slot: 'base', identity: 'base', quantity: 1 }] } };
    try {
        assert.equal((await call('admin/products/index', 'POST', oldPasswordToken)).status, 403);
        await db.doc('operations/webStockCutover').delete();
        await db.doc('products/p').set({ stockTotal: 5, webReservations: hold });
        const original = await db.doc('products/p').get();
        for (const state of ['missing', 'closed', 'reconciling', 'malformed']) {
            if (state !== 'missing') await db.doc('operations/webStockCutover').set({ schema: 1, state: state === 'malformed' ? 'open' : state, revision: 'synthetic-closed-control', updatedAt: state === 'malformed' ? null : Timestamp.now() });
            for (const [route, method] of routes) {
                const result = await call(route, method);
                assert.equal(result.status, 503, `${state} ${method} ${route}: ${JSON.stringify(result.body)}`);
            }
            assert.equal((await call('admin/products/index', 'GET')).status, 200);
            assert.equal((await call('admin/products/[id]/index', 'GET')).status, 200);
        }
        assert.equal((await call('admin/products/index', 'POST', 'invalid')).status, 401);
        assert.equal((await auth.getUser(user.uid)).uid, user.uid);
        const after = await db.doc('products/p').get();
        assert.deepEqual(after.data(), original.data()); assert.deepEqual(after.updateTime, original.updateTime);
        const paths = (await db.listCollections()).map(collection => collection.id).sort();
        assert.deepEqual(paths, ['credentialAccess', 'credentialSessions', 'operations', 'products']);
        await db.doc('operations/webStockCutover').set({ schema: 1, state: 'open', revision: 'synthetic-reopened-control', updatedAt: Timestamp.now() });
        assert.deepEqual((await db.doc('products/p').get()).data(), original.data());
        // Open writer passes maintenance and reaches the existing payload validator.
        assert.equal((await call('admin/products/index', 'POST')).status, 400);
    } finally { await auth.deleteUser(user.uid); await cleanupCredentialAccounts(db, [user.uid]);
        await db.doc('operations/credentialAccessCutover').delete(); await db.terminate(); await deleteApp(app); }
});
