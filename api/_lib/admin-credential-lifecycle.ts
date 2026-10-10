import type { Firestore } from 'firebase-admin/firestore';
import { CredentialAccessError, parseAccount, parseCutover, validUid, type CredentialAccount,
  type CredentialRoles } from './credential-access-state';

export type AdministrativeRole = 'admin' | 'superadmin';
export function administrativeRoles(role: AdministrativeRole): CredentialRoles {
  return { admin: true, superadmin: role === 'superadmin' };
}
export function administrativeUid(value: unknown): value is string {
  return validUid(value) && value !== '.' && value !== '..';
}
/** Restrict first: Auth mutation or profile-write failure must never leave the
 * previous session usable through either Rules or SDK destinations. */
export async function restrictAdministrativeAccess(db: Firestore, uid: string,
  action: 'ROLE_CHANGE' | 'ACCOUNT_DELETE' | 'ACCOUNT_INACTIVE', requestedRole?: AdministrativeRole): Promise<void> {
  if (!administrativeUid(uid)) throw new CredentialAccessError(400, 'INVALID_USER', 'Usuario inválido.');
  await db.runTransaction(async tx => {
    const accountRef = db.doc(`credentialAccess/${uid}`);
    const [controlSnapshot, accountSnapshot] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(accountRef),
    ]);
    const control = parseCutover(controlSnapshot.data());
    const desired = requestedRole ? administrativeRoles(requestedRole) : { admin: false, superadmin: false };
    if (accountSnapshot.exists) {
      const current = parseAccount(accountSnapshot.data());
      if (!current || current.uid !== uid || current.epoch !== control.epoch) {
        throw new CredentialAccessError(503, 'ADMIN_ACCESS_STATE_UNAVAILABLE', 'No pudimos comprobar el acceso de esa cuenta.');
      }
      // A role mutation never promotes an already issued capability. Any later
      // increase requires the separately approved protected-role treatment.
      tx.update(accountRef, { status: 'PENDING', roles: {
        admin: current.roles.admin && desired.admin, superadmin: current.roles.superadmin && desired.superadmin,
      }, restrictionAction: action, restrictedAtMs: Date.now(), requestedAdministrativeRole: requestedRole ?? null });
    } else {
      const pending: CredentialAccount = { schema: 1, uid, epoch: control.epoch, status: 'PENDING', recoveryEmail: null,
        channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: { admin: false, superadmin: false } };
      tx.create(accountRef, { ...pending, restrictionAction: action, restrictedAtMs: Date.now(), requestedAdministrativeRole: requestedRole ?? null });
    }
  });
}
/** An authenticated superadmin's creation request defines the legitimate role,
 * but it supplies neither a recovered channel nor an administrative session. */
export async function initializePendingAdministrator(db: Firestore, uid: string, role: AdministrativeRole): Promise<void> {
  if (!administrativeUid(uid)) throw new CredentialAccessError(400, 'INVALID_USER', 'Usuario inválido.');
  await db.runTransaction(async tx => {
    const accountRef = db.doc(`credentialAccess/${uid}`);
    const [controlSnapshot, accountSnapshot] = await Promise.all([
      tx.get(db.doc('operations/credentialAccessCutover')), tx.get(accountRef),
    ]);
    const control = parseCutover(controlSnapshot.data());
    if (accountSnapshot.exists) throw new CredentialAccessError(503, 'ADMIN_ACCESS_STATE_EXISTS', 'No pudimos completar el acceso de esa cuenta.');
    const pending: CredentialAccount = { schema: 1, uid, epoch: control.epoch, status: 'PENDING', recoveryEmail: null,
      channelStatus: 'UNVERIFIED', channelEvidenceSha256: null, roles: administrativeRoles(role) };
    tx.create(accountRef, { ...pending, restrictionAction: 'ACCOUNT_CREATE', restrictedAtMs: Date.now() });
  });
}
