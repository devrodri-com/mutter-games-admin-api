import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { deleteProduct, patchProduct, productVersion } from '../api/_lib/product-patch';

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/);
const app = initializeApp({ projectId: 'demo-mutter-r1' }, 'admin-web-reservations');
const db = getFirestore(app);
const references: DocumentReference[] = [];
const identity = JSON.stringify(['Color', 'Color', 'Rojo', 'red']);
const variants = (stock = 5) => [{
    label: { es: 'Color', en: 'Color' },
    options: [{ value: 'Rojo', variantId: 'red', priceUSD: 100, stock }],
}];
const reservation = (slot = '0:0', quantity = 2, expiresAt = Date.now() + 60000) => ({
    expiresAt, lines: [{ slot, identity: slot === 'base' ? 'base' : identity, quantity }],
});
async function seed(name: string, fields: Record<string, unknown> = {}) {
    const ref = db.doc(`products/admin-holds-${name}`);
    references.push(ref);
    await ref.set({
        title: 'Synthetic', active: true, priceUSD: 100, variants: variants(), stockTotal: 5,
        description: 'before', arbitraryMetadata: { preserve: ['exactly', 7] }, ...fields,
    });
    return ref;
}
async function edit(ref: DocumentReference, changes: Record<string, unknown>, version?: string) {
    return patchProduct(db, ref.id, {
        version: version ?? productVersion(await ref.get()), intent: 'edit', changes,
    });
}
before(async () => { await db.listCollections(); });
after(async () => {
    for (const ref of references) await ref.delete();
    await db.terminate();
    await deleteApp(app);
});

test('normal stock and descriptive edits preserve active holds and unrelated quantities', async () => {
    const webReservations = { 'opaque-one-12345678901234567890': reservation() };
    const ref = await seed('normal-edit', { webReservations });
    const unrelated = await seed('unrelated', { variants: variants(17), stockTotal: 17 });
    const untouched = (await unrelated.get()).data();
    await edit(ref, { description: 'after' });
    const described = (await ref.get()).data();
    assert.equal(described?.stockTotal, 5);
    assert.deepEqual(described?.variants, variants());
    await edit(ref, { variants: variants(4) });
    const updated = (await ref.get()).data();
    assert.equal(updated?.stockTotal, 4);
    assert.deepEqual(updated?.webReservations, webReservations);
    assert.deepEqual(updated?.arbitraryMetadata, { preserve: ['exactly', 7] });
    assert.deepEqual((await unrelated.get()).data(), untouched);
    await assert.rejects(edit(ref, { variants: variants(1) }), { status: 409 });
    assert.deepEqual((await ref.get()).data(), updated);
});

test('expired but unreconciled holds continue to protect stock and deletion', async () => {
    const webReservations = { 'opaque-expired-12345678901234567890': reservation('base', 2, 1) };
    const ref = await seed('expired', { variants: [], webReservations });
    await edit(ref, { stockTotal: 2 });
    const before = (await ref.get()).data();
    await assert.rejects(edit(ref, { stockTotal: 1 }), { status: 409 });
    await assert.rejects(deleteProduct(db, ref.id), { status: 409 });
    assert.deepEqual((await ref.get()).data(), before);
    // Only the server-owned removal makes the previous units available for Admin operations.
    await ref.update({ webReservations: {} });
    await edit(ref, { stockTotal: 0 });
    await deleteProduct(db, ref.id);
    assert.equal((await ref.get()).exists, false);
});

test('aggregate holds protect quantity across reservations and repeated lines', async () => {
    const combined = reservation();
    combined.lines.push({ slot: '0:0', identity, quantity: 1 });
    const ref = await seed('aggregate', {
        webReservations: { 'opaque-first-12345678901234567890': combined, 'opaque-second-12345678901234567890': reservation('0:0', 1) },
    });
    await assert.rejects(edit(ref, { variants: variants(3) }), { status: 409 });
    const beforeAggregateEdit = (await ref.get()).data();
    await assert.rejects(edit(ref, { stockTotal: 3 }), { status: 409 });
    assert.deepEqual((await ref.get()).data(), beforeAggregateEdit);
    await edit(ref, { stockTotal: 4 });
    await edit(ref, { variants: variants(4) });
    assert.equal((await ref.get()).data()?.stockTotal, 4);
});

test('held variant cannot be removed, renamed, reassigned, or moved, while price edit works', async () => {
    const ref = await seed('identities', { webReservations: { 'opaque-identity-12345678901234567890': reservation() } });
    const original = (await ref.get()).data();
    const renamed = variants(); renamed[0].options[0].value = 'Azul';
    const relabelled = variants(); relabelled[0].label.es = 'Tono';
    const changedId = variants(); changedId[0].options[0].variantId = 'other';
    const moved = [renamed[0], variants()[0]];
    for (const next of [[], renamed, relabelled, changedId, moved]) {
        await assert.rejects(edit(ref, { variants: next }), { status: 409 });
        assert.deepEqual((await ref.get()).data(), original);
    }
    const repriced = variants(); repriced[0].options[0].priceUSD = 120;
    await edit(ref, { variants: repriced });
    assert.equal((await ref.get()).data()?.priceUSD, 120);
    const base = await seed('base-identity', { variants: [], webReservations: { 'opaque-base-12345678901234567890': reservation('base') } });
    await assert.rejects(edit(base, { variants: variants() }), { status: 409 });
});

test('reservation metadata is server-owned and malformed metadata fails closed', async () => {
    const malformed: unknown[] = [
        null, [], { 'opaque-malformed-1234567890': null }, { 'opaque-malformed-1234567890': { expiresAt: 1, lines: [] } },
        { 'opaque-malformed-1234567890': { ...reservation(), expiresAt: '1' } },
        { 'opaque-malformed-1234567890': { ...reservation(), extra: true } },
        { 'opaque-malformed-1234567890': { expiresAt: 1, lines: [{ slot: '00:0', identity, quantity: 1 }] } },
        { 'opaque-malformed-1234567890': { expiresAt: 1, lines: [{ slot: '0:0', identity, quantity: -1 }] } },
        { 'opaque-malformed-1234567890': { expiresAt: 1, lines: [{ slot: '0:0', identity, quantity: 1.5 }] } },
    ];
    for (const [index, webReservations] of malformed.entries()) {
        const ref = await seed(`malformed-${index}`, { webReservations });
        const before = (await ref.get()).data();
        await assert.rejects(edit(ref, { description: 'unsafe' }), { status: 409 });
        await assert.rejects(deleteProduct(db, ref.id), { status: 409 });
        assert.deepEqual((await ref.get()).data(), before);
    }
    const ref = await seed('client-fields', { webReservations: { 'opaque-client-12345678901234567890': reservation() } });
    await assert.rejects(edit(ref, { webReservations: {} }), { status: 400 });
    await assert.rejects(edit(ref, { webCatalogVersion: '1:2' }), { status: 400 });
});

test('catalog version ignores reservation churn but changes on catalog edit and confirmed decrement', async () => {
    const ref = await seed('version');
    const version = productVersion(await ref.get());
    // These fixtures represent writes owned by checkout. This test checks Admin's version contract.
    await ref.update({ webCatalogVersion: version, webReservations: { 'opaque-version-12345678901234567890': reservation() } });
    assert.equal(productVersion(await ref.get()), version);
    await ref.update({ webReservations: { 'opaque-version-12345678901234567890': reservation('0:0', 3) } });
    assert.equal(productVersion(await ref.get()), version);
    await edit(ref, { variants: variants(4) }, version);
    const afterEdit = await ref.get();
    assert.equal(afterEdit.get('webCatalogVersion'), undefined);
    assert.notEqual(productVersion(afterEdit), version);
    await assert.rejects(edit(ref, { description: 'stale' }, version), { status: 409 });
    const currentVersion = productVersion(afterEdit);
    await ref.update({ webCatalogVersion: currentVersion });
    await ref.update({
        variants: variants(1), stockTotal: 1, webReservations: {}, webCatalogVersion: FieldValue.delete(),
    });
    await assert.rejects(edit(ref, { variants: variants(4) }, currentVersion), { status: 409 });
    assert.equal((await ref.get()).data()?.stockTotal, 1);
});

test('concurrent delete and catalog writes preserve holds; concurrent stale writes admit only one', async () => {
    const webReservations = { 'opaque-concurrent-12345678901234567890': reservation() };
    const ref = await seed('concurrent', { webReservations });
    const version = productVersion(await ref.get());
    const results = await Promise.allSettled([
        deleteProduct(db, ref.id), edit(ref, { variants: variants(4) }, version),
        edit(ref, { description: 'concurrent' }, version),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results.slice(1).filter(result => result.status === 'fulfilled').length, 1);
    const actual = await ref.get();
    assert.equal(actual.exists, true);
    assert.deepEqual(actual.data()?.webReservations, webReservations);
});

test('legacy products without holds retain their exact missing stock and arbitrary metadata', async () => {
    const ref = await seed('legacy-preserve');
    await ref.update({ variants: [], stockTotal: FieldValue.delete(), webReservations: FieldValue.delete() });
    await edit(ref, { description: 'legacy edited' });
    const actual = (await ref.get()).data();
    assert.equal(actual?.stockTotal, undefined);
    assert.equal(actual?.webReservations, undefined);
    assert.deepEqual(actual?.arbitraryMetadata, { preserve: ['exactly', 7] });
    await deleteProduct(db, ref.id);
    assert.equal((await ref.get()).exists, false);
});
