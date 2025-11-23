// api/admin/categories/route.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb, adminAuth } from '../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../_lib/cors';

type CreateCategoryPayload = {
  name: {
    es: string;
    en?: string;
  };
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
      const snapshot = await adminDb.collection('categories').get();
      const categories = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return res.status(200).json({ categories });
    }

    if (req.method === 'POST') {
      const payload =
        typeof req.body === 'string' ? (JSON.parse(req.body) as CreateCategoryPayload) : (req.body as CreateCategoryPayload);

      if (!payload?.name?.es?.trim()) {
        return res.status(400).json({ error: 'name.es es requerido' });
      }

      const docData = {
        name: {
          es: payload.name.es.trim(),
          en: payload.name.en?.trim() || '',
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await adminDb.collection('categories').add(docData);

      return res.status(201).json({ id: docRef.id, created: true });
    }
  } catch (error) {
    console.error('Error en categories handler:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
// TODO: review categories endpoint

