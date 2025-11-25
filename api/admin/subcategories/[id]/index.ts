// api/admin/subcategories/[id]/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb } from '../../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../../_lib/cors';
import { verifyAdmin } from '../../../_lib/verifyAdmin';

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
    await verifyAdmin(req);

    await adminDb.collection('subcategories').doc(subcategoryId).delete();

    const categoryDocRef = adminDb.collection('categories').doc(categoryIdParam);
    await categoryDocRef.collection('subcategories').doc(subcategoryId).delete();

    return res.status(200).json({ id: subcategoryId, deleted: true });
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message || 'Unauthorized' });
    }
    console.error('Error eliminando subcategory:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
