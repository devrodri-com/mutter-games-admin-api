// api/_lib/verifyAdmin.ts

import { adminAuth, adminDb } from './firebaseAdmin';
import type { VercelRequest } from '@vercel/node';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { assertCutoverOpen } from './release-cutover';
import { requireCredentialSession } from './credential-session';

export interface VerifiedAdmin {
  uid: string;
  isAdmin: boolean;
  isSuperadmin: boolean;
  claims: DecodedIdToken;
}

class AdminAuthorizationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function verifyAdmin(req: VercelRequest, forceWriter = false): Promise<VerifiedAdmin> {
  const authHeader = req.headers.authorization;
  const tokenString = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!tokenString) {
    throw new AdminAuthorizationError(401, 'Unauthorized: missing bearer token');
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(tokenString, true);
  } catch {
    throw new AdminAuthorizationError(401, 'Unauthorized: invalid or revoked token');
  }

  const claims = decoded;
  const admission = await requireCredentialSession(adminAuth, adminDb, claims, 'admin');
  const isAdmin = admission.admin || admission.superadmin;

  if (!isAdmin) {
    throw new AdminAuthorizationError(403, 'Forbidden: insufficient permissions');
  }

  // Every Admin writer uses this boundary, including Auth mutations. A signature
  // GET explicitly opts in because it grants an upload capability.
  if (forceWriter || req.method !== 'GET') await assertCutoverOpen(adminDb);

  return {
    uid: decoded.uid,
    isAdmin: admission.admin,
    isSuperadmin: admission.superadmin,
    claims,
  };
}
