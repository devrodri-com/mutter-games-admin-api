// api/admin/products/migrate-sort-key.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from '../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../_lib/cors';
import { verifyAdmin } from '../../_lib/verifyAdmin';

function normalizeSortKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) {
    return;
  }
  setCorsHeaders(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await verifyAdmin(req);

    const snapshot = await adminDb.collection('products').get();
    let updatedCount = 0;

    let batch = adminDb.batch();
    let batchCount = 0;
    const BATCH_SIZE = 500;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // Solo actualizar si no tiene sortKey
      if (!data.sortKey) {
        const title = (data.title as { es?: string; en?: string }) || {};
        const titleText = title.es || title.en || '';
        
        if (titleText) {
          const sortKey = normalizeSortKey(titleText);
          batch.update(doc.ref, { sortKey });
          batchCount++;
          updatedCount++;

          // Firestore limita los batches a 500 operaciones
          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = adminDb.batch();
            batchCount = 0;
          }
        }
      }
    }

    // Commit del batch final si hay operaciones pendientes
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`✅ Migración completada: ${updatedCount} productos actualizados con sortKey`);

    return res.status(200).json({
      success: true,
      updated: updatedCount,
      total: snapshot.size,
    });
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message || 'Unauthorized' });
    }
    console.error('Error en migración de sortKey:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}

