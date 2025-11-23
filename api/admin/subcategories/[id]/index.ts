// api/admin/subcategories/[id]/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb, adminAuth } from '../../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../../_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) {
    return;
  }
  setCorsHeaders(req, res);

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, categoryId } = req.query;
  const subcategoryId = Array.isArray(id) ? id[0] : id;
  const categoryIdParam = Array.isArray(categoryId) ? categoryId[0] : categoryId;

  if (!subcategoryId) {
    return res.status(400).json({ error: 'Missing subcategory id' });
  }

  if (!categoryIdParam) {
    return res.status(400).json({ error: 'Missing categoryId query parameter' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const tokenString = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!tokenString) {
      return res.status(401).json({ error: 'Unauthorized: missing bearer token' });
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(tokenString);
    } catch {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
    const claims = decodedToken as { [key: string]: any };
    const isAdmin = claims.admin === true || claims.superadmin === true;
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin role required' });
    }

    await adminDb.collection('subcategories').doc(subcategoryId).delete();

    const categoryDocRef = adminDb.collection('categories').doc(categoryIdParam);
    await categoryDocRef.collection('subcategories').doc(subcategoryId).delete();

    return res.status(200).json({ id: subcategoryId, deleted: true });
  } catch (error) {
    console.error('Error eliminando subcategory:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
