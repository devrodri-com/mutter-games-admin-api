import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { adminDb, adminAuth } from '../../_lib/firebaseAdmin';
import withAdmin from '../../_lib/withAdmin';
import { assertAdmin, assertSuperadmin } from '../../_lib/permissions';
import { handleCors } from '../../_lib/cors';
import { administrativeRoles, initializePendingAdministrator, type AdministrativeRole } from '../../_lib/admin-credential-lifecycle';
import { CredentialAccessError, normalizeRecoveryEmail, object } from '../../_lib/credential-access-state';

function creationBody(raw: unknown): { email: string; password: string; nombre: string; rol: AdministrativeRole } {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!object(value) || Object.keys(value).some(key => !['email', 'password', 'nombre', 'rol'].includes(key))) {
    throw new CredentialAccessError(400, 'INVALID_USER_CREATE', 'Revisá los datos del usuario.');
  }
  const email = normalizeRecoveryEmail(value.email);
  if (!email || typeof value.password !== 'string' || value.password.length < 6 || value.password.length > 4096
    || (value.nombre !== undefined && (typeof value.nombre !== 'string' || value.nombre.length > 200))
    || (value.rol !== 'admin' && value.rol !== 'superadmin')) {
    throw new CredentialAccessError(400, 'INVALID_USER_CREATE', 'Revisá los datos del usuario.');
  }
  return { email, password: value.password, nombre: typeof value.nombre === 'string' ? value.nombre : '', rol: value.rol };
}
async function usersHandler({ req, res, role }: { req: VercelRequest; res: VercelResponse; uid: string; role: AdministrativeRole }) {
  if (handleCors(req, res)) return;
  let preparedUid: string | undefined;
  try {
    if (req.method === 'GET') {
      assertAdmin(role);
      const snapshot = await adminDb.collection('adminUsers').get();
      return res.status(200).json({ users: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    assertSuperadmin(role);
    const payload = creationBody(req.body);
    // Creation supplies metadata, never proof that the channel belongs to its holder.
    // Reserve access before Auth creates the identity so native bootstrap cannot
    // race an administrative account that still has no persistent role claims.
    const uid = randomUUID();
    await initializePendingAdministrator(adminDb, uid, payload.rol);
    preparedUid = uid;
    const user = await adminAuth.createUser({ uid, email: payload.email, password: payload.password, emailVerified: true, disabled: false });
    await adminAuth.setCustomUserClaims(user.uid, administrativeRoles(payload.rol));
    await adminDb.doc(`adminUsers/${user.uid}`).set({ email: payload.email, nombre: payload.nombre, rol: payload.rol,
      activo: true, uid: user.uid, createdAt: new Date().toISOString() });
    return res.status(201).json({ id: user.uid, email: payload.email, rol: payload.rol, credentialAccess: 'PENDING' });
  } catch (error: unknown) {
    if (error instanceof CredentialAccessError) return res.status(error.status).json({ code: error.code, error: error.message });
    if (error instanceof Response) return res.status(error.status).json({ error: error.statusText || 'Forbidden' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid user create' });
    return res.status(503).json({ code: 'ADMIN_CREATE_INCOMPLETE',
      ...(preparedUid ? { id: preparedUid, credentialAccess: 'PENDING' } : {}),
      error: 'No pudimos completar el alta. El acceso requiere resolver su estado protegido.' });
  }
}
export default withAdmin(usersHandler);
