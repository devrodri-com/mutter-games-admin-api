// api/_lib/verifyAdmin.ts

import { adminAuth } from './firebaseAdmin';
import type { VercelRequest } from '@vercel/node';

export interface VerifiedAdmin {
  uid: string;
  isAdmin: boolean;
  isSuperadmin: boolean;
  claims: Record<string, any>;
}

export async function verifyAdmin(req: VercelRequest): Promise<VerifiedAdmin> {
  const authHeader = req.headers.authorization || '';
  const tokenString = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!tokenString) {
    const err: any = new Error('Unauthorized: missing bearer token');
    err.status = 401;
    throw err;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(tokenString, true);
  } catch (err: any) {
    const e: any = new Error('Unauthorized: invalid or revoked token');
    e.status = 401;
    throw e;
  }

  const claims = decoded as any;
  const isAdmin = claims.admin === true || claims.superadmin === true;

  if (!isAdmin) {
    const e: any = new Error('Forbidden: insufficient permissions');
    e.status = 403;
    throw e;
  }

  return {
    uid: decoded.uid,
    isAdmin: !!claims.admin,
    isSuperadmin: !!claims.superadmin,
    claims,
  };
}
