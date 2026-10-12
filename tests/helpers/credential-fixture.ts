import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { mintCredentialSession } from '../../api/_lib/credential-session';
import type { CredentialAccount, CredentialRoles } from '../../api/_lib/credential-access-state';

export const credentialEpoch = 'synthetic-admin-suite-epoch';
export function initializeDemoAdmin() {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  return initializeApp({ projectId: 'demo-mutter-r1', credential: cert({ projectId: 'demo-mutter-r1',
    clientEmail: 'synthetic-loopback@demo-mutter-r1.iam.gserviceaccount.com', privateKey }) });
}
export async function installCredentialCutover(db: Firestore) {
  await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch: credentialEpoch, legacyCutoffMs: 1 });
}
/** A declared authority input for consumer tests, not evidence that a real mail
 * channel was recovered. The Store coupled matrix verifies that prerequisite. */
export async function admitFixtureAccount(auth: Auth, db: Firestore, uid: string, roles: CredentialRoles) {
  const user = await auth.getUser(uid); assert.ok(user.email);
  const account: CredentialAccount = { schema: 1, uid, epoch: credentialEpoch, status: 'RECOVERED',
    recoveryEmail: user.email, channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: '3'.repeat(64), roles };
  await db.doc(`credentialAccess/${uid}`).set(account);
  const issued = await mintCredentialSession(auth, db, account, 'RECOVERY_CHANNEL'); assert.ok(issued.customToken);
  const response = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: issued.customToken, returnSecureToken: true }),
  });
  assert.equal(response.status, 200);
  const value: unknown = await response.json();
  assert.ok(value && typeof value === 'object' && 'idToken' in value && typeof value.idToken === 'string'
    && 'refreshToken' in value && typeof value.refreshToken === 'string');
  return { token: value.idToken, refreshToken: value.refreshToken };
}
export async function cleanupCredentialAccounts(db: Firestore, uids: Iterable<string>) {
  for (const uid of uids) {
    await db.doc(`credentialAccess/${uid}`).delete();
    const sessions = await db.collection('credentialSessions').where('uid', '==', uid).get();
    for (const session of sessions.docs) await session.ref.delete();
  }
}
