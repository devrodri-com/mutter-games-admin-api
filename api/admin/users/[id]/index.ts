import type { VercelRequest, VercelResponse } from '@vercel/node';
import withAdmin from '../../../_lib/withAdmin';
import { adminDb, adminAuth } from '../../../_lib/firebaseAdmin';
import { assertAdmin, assertSuperadmin } from '../../../_lib/permissions';
import { handleCors } from '../../../_lib/cors';
import { administrativeRoles, administrativeUid, restrictAdministrativeAccess, type AdministrativeRole } from '../../../_lib/admin-credential-lifecycle';
import { CredentialAccessError, object } from '../../../_lib/credential-access-state';

function patchBody(raw: unknown): { nombre?: string; activo?: boolean; rol?: AdministrativeRole } {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!object(value) || Object.keys(value).some(key => !['nombre', 'activo', 'rol'].includes(key))
    || (value.nombre !== undefined && (typeof value.nombre !== 'string' || value.nombre.length > 200))
    || (value.activo !== undefined && typeof value.activo !== 'boolean')
    || (value.rol !== undefined && value.rol !== 'admin' && value.rol !== 'superadmin')) {
    throw new CredentialAccessError(400, 'INVALID_USER_UPDATE', 'Revisá los datos del usuario.');
  }
  const result: { nombre?: string; activo?: boolean; rol?: AdministrativeRole } = {};
  if (typeof value.nombre === 'string') result.nombre = value.nombre;
  if (typeof value.activo === 'boolean') result.activo = value.activo;
  if (value.rol === 'admin' || value.rol === 'superadmin') result.rol = value.rol;
  if (Object.keys(result).length === 0) throw new CredentialAccessError(400, 'EMPTY_USER_UPDATE', 'No hay datos para actualizar.');
  return result;
}
async function handler({ req, res, role }: { req: VercelRequest; res: VercelResponse; uid: string; role: AdministrativeRole }) {
  if (handleCors(req, res)) return;
  const userId = req.query.id;
  if (!administrativeUid(userId)) return res.status(400).json({ error: 'Invalid user id' });
  if (!['GET', 'PATCH', 'DELETE'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' });
  try {
    const profileRef = adminDb.doc(`adminUsers/${userId}`);
    if (req.method === 'GET') {
      assertAdmin(role);
      const profile = await profileRef.get();
      if (!profile.exists) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json({ id: profile.id, ...profile.data() });
    }
    if (!(await profileRef.get()).exists) return res.status(404).json({ error: 'User not found' });
    if (req.method === 'DELETE') {
      assertSuperadmin(role);
      await restrictAdministrativeAccess(adminDb, userId, 'ACCOUNT_DELETE');
      await adminAuth.deleteUser(userId);
      await profileRef.delete();
      return res.status(200).json({ id: userId, deleted: true });
    }
    const payload = patchBody(req.body);
    if (payload.rol !== undefined) assertSuperadmin(role);
    if (payload.rol !== undefined || payload.activo === false) {
      await restrictAdministrativeAccess(adminDb, userId, payload.activo === false ? 'ACCOUNT_INACTIVE' : 'ROLE_CHANGE',
        payload.activo === false ? undefined : payload.rol);
    }
    if (payload.rol !== undefined) await adminAuth.setCustomUserClaims(userId, administrativeRoles(payload.rol));
    await profileRef.update({ ...payload, updatedAt: new Date().toISOString() });
    return res.status(200).json({ id: userId, updated: true,
      ...(payload.rol !== undefined || payload.activo === false ? { credentialAccess: 'PENDING' } : {}) });
  } catch (error: unknown) {
    if (error instanceof CredentialAccessError) return res.status(error.status).json({ code: error.code, error: error.message });
    if (error instanceof Response) return res.status(error.status).json({ error: error.statusText || 'Forbidden' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid user update' });
    return res.status(503).json({ code: 'ADMIN_UPDATE_INCOMPLETE', error: 'No pudimos completar el cambio. Conservamos el estado de acceso para resolverlo de forma segura.' });
  }
}
export default withAdmin(handler);
