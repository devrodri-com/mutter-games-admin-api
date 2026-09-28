// api/admin/products/[id]/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteProduct, patchProduct, productVersion, ProductPatchError } from '../../../_lib/product-patch';
import { WebReservationError } from '../../../_lib/web-reservations';
import { adminDb } from '../../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../../_lib/cors';
import { verifyAdmin } from '../../../_lib/verifyAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) {
    return;
  }
  setCorsHeaders(req, res);

  if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const productId = Array.isArray(id) ? id[0] : id;

  if (!productId) {
    return res.status(400).json({ error: 'Missing product id' });
  }

  try {
    await verifyAdmin(req);

    if (req.method === 'GET') {
      const docRef = adminDb.collection('products').doc(productId);
      const snap = await docRef.get();

      if (!snap.exists) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const data = snap.data();
      return res.status(200).json({ product: { ...data, id: snap.id, version: productVersion(snap) } });
    }

    if (req.method === 'PATCH') {
      let payload: unknown;
      try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { return res.status(400).json({error:'Payload inválido.'}); }
      return res.status(200).json(await patchProduct(adminDb, productId, payload));
    }

    if (req.method === 'DELETE') {
      return res.status(200).json(await deleteProduct(adminDb, productId));
    }
  } catch (error: unknown) {
    if (error instanceof ProductPatchError || error instanceof WebReservationError) return res.status(error.status).json({ error: error.message });
    if (error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403)) {
      return res.status(error.status).json({error:'Unauthorized'});
    }
    return res.status(500).json({error:'No se pudo completar la operación.'});
  }
}
