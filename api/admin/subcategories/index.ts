// api/admin/subcategories/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb, adminAuth } from '../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../_lib/cors';

type CreateSubcategoryPayload = {
  categoryId: string;
  name: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) {
    return;
  }
  setCorsHeaders(req, res);

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    if (req.method === 'GET') {
      const categoryId = req.query.categoryId as string | undefined;

      let query = adminDb.collection('subcategories') as admin.firestore.Query;

      if (categoryId) {
        query = query.where('categoryId', '==', categoryId);
      }

      const snapshot = await query.get();
      const subcategories = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return res.status(200).json({ subcategories });
    }

    if (req.method === 'POST') {
      const payload =
        typeof req.body === 'string' ? (JSON.parse(req.body) as CreateSubcategoryPayload) : (req.body as CreateSubcategoryPayload);

      if (!payload?.categoryId?.trim()) {
        return res.status(400).json({ error: 'categoryId es requerido' });
      }

      if (!payload?.name?.trim()) {
        return res.status(400).json({ error: 'name es requerido' });
      }

      const docData = {
        categoryId: payload.categoryId.trim(),
        name: payload.name.trim(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await adminDb.collection('subcategories').add(docData);

      const categoryDocRef = adminDb.collection('categories').doc(docData.categoryId);
      await categoryDocRef
        .collection('subcategories')
        .doc(docRef.id)
        .set({
          name: docData.name,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      return res.status(201).json({ id: docRef.id, created: true });
    }
  } catch (error) {
    console.error('Error en subcategories handler:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
