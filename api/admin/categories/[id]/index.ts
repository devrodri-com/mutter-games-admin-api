// api/admin/categories/[id]/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb } from '../../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../../_lib/cors';
import { verifyAdmin } from '../../../_lib/verifyAdmin';

type UpdateCategoryPayload = {
  name?: {
    es?: string;
    en?: string;
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) {
    return;
  }
  setCorsHeaders(req, res);

  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const categoryId = Array.isArray(id) ? id[0] : id;

  if (!categoryId) {
    return res.status(400).json({ error: 'Missing category id' });
  }

  try {
    await verifyAdmin(req);

    if (req.method === 'PATCH') {
      const payload =
        typeof req.body === 'string' ? (JSON.parse(req.body) as UpdateCategoryPayload) : (req.body as UpdateCategoryPayload);

      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const docRef = adminDb.collection('categories').doc(categoryId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        return res.status(404).json({ error: 'Category not found' });
      }

      const currentData = docSnap.data();
      const updateData: Record<string, any> = {};

      if (payload.name) {
        const currentName = (currentData?.name as { es?: string; en?: string }) || {};
        const newName: { es: string; en: string } = {
          es: payload.name.es !== undefined ? payload.name.es.trim() : currentName.es || '',
          en: payload.name.en !== undefined ? payload.name.en.trim() : currentName.en || '',
        };

        if (!newName.es.trim()) {
          return res.status(400).json({ error: 'name.es no puede estar vacío' });
        }

        updateData.name = newName;
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      await docRef.update(updateData);

      return res.status(200).json({ id: categoryId, updated: true });
    }

    if (req.method === 'DELETE') {
      await adminDb.collection('categories').doc(categoryId).delete();

      return res.status(200).json({ id: categoryId, deleted: true });
    }
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message || 'Unauthorized' });
    }
    console.error('Error en category handler:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}

