import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import { createRequire } from 'node:module';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { patchProduct, productVersion, ProductPatchError } from '../api/_lib/product-patch';

test('real Admin transactions use installed gRPC and preserve holds under contention', async () => {
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
    const require = createRequire(import.meta.url);
    const firestoreRequire = createRequire(require.resolve('@google-cloud/firestore'));
    const gaxRequire = createRequire(firestoreRequire.resolve('google-gax'));
    const metadata: unknown = gaxRequire('@grpc/grpc-js/package.json');
    assert.ok(metadata && typeof metadata === 'object' && 'version' in metadata);
    assert.equal(metadata.version, '1.14.5');
    const app = initializeApp({ projectId: 'demo-mutter-admin-transport' }, 'transport-regression');
    const db = getFirestore(app);
    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const ref = db.doc('products/transport-synthetic');
    const untouched = db.doc('products/transport-unrelated');
    try {
        const holds = { 'synthetic-held-reservation': { expiresAt: 1, lines: [{ slot: 'base', identity: 'base', quantity: 2 }] } };
        await ref.set({ active: true, title: 'Synthetic', priceUSD: 100, stockTotal: 5, variants: [], webReservations: holds });
        await untouched.set({ title: 'Unrelated synthetic', stockTotal: 17 });
        const before = await untouched.get();
        const version = productVersion(await ref.get());
        const results = await Promise.allSettled([
            patchProduct(db, ref.id, { version, intent: 'edit', changes: { stockTotal: 4 } }),
            patchProduct(db, ref.id, { version, intent: 'edit', changes: { stockTotal: 3 } }),
        ]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        const rejected = results.find(result => result.status === 'rejected');
        assert.ok(rejected?.status === 'rejected');
        const reason: unknown = rejected.reason;
        assert.ok(reason instanceof ProductPatchError);
        assert.equal(reason.status, 409);
        const current = await ref.get();
        assert.deepEqual(current.get('webReservations'), holds);
        assert.ok([3, 4].includes(current.get('stockTotal')));
        await assert.rejects(patchProduct(db, ref.id, {
            version: productVersion(current), intent: 'edit', changes: { stockTotal: 1 },
        }), { status: 409 });
        const afterRejected = await ref.get();
        assert.deepEqual(afterRejected.data(), current.data());
        assert.deepEqual(afterRejected.updateTime, current.updateTime);
        const after = await untouched.get();
        assert.deepEqual(after.data(), before.data());
        assert.deepEqual(after.updateTime, before.updateTime);

        // V8 observes the actual installed transport; no SDK replacement or REST fallback.
        const coverage = await session.post('Profiler.takePreciseCoverage');
        const grpcClient = coverage.result.find(script => script.url.endsWith('/@grpc/grpc-js/build/src/client.js'));
        assert.ok(grpcClient, 'installed gRPC client must execute');
        assert.ok(grpcClient.functions.some(fn => fn.functionName === 'makeUnaryRequest' && fn.ranges.some(range => range.count > 0)),
            'real unary transport must execute during the production transactions');
    } finally {
        await session.post('Profiler.stopPreciseCoverage');
        session.disconnect();
        await ref.delete();
        await untouched.delete();
        await db.terminate();
        await deleteApp(app);
    }
});
