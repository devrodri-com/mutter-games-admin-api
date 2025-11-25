// api/admin/products/[id]/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb } from '../../../_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from '../../../_lib/cors';
import { verifyAdmin } from '../../../_lib/verifyAdmin';

type VariantOption = {
  value: string;
  priceUSD: number;
  stock?: number;
};

type Variant = {
  label: { es: string; en: string };
  options: VariantOption[];
};

type UpdateProductPayload = {
  title?: { es?: string; en?: string };
  description?: string;
  slug?: string;
  category?: { id?: string; name?: string };
  subcategory?: { id?: string; name?: string; categoryId?: string };
  tipo?: string;
  defaultDescriptionType?: string;
  extraDescriptionTop?: string;
  extraDescriptionBottom?: string;
  descriptionPosition?: 'top' | 'bottom';
  active?: boolean;
  images?: string[];
  allowCustomization?: boolean;
  customName?: string;
  customNumber?: string;
  priceUSD?: number;
  variants?: Variant[];
  sku?: string;
  stockTotal?: number;
  [key: string]: any;
};

const normalizeVariants = (variants: Variant[]) => {
  const normalized: Variant[] = variants.map((variant) => ({
    label: {
      es: variant.label?.es?.trim() || '',
      en: variant.label?.en?.trim() || '',
    },
    options: (variant.options || []).map((option) => ({
      value: option.value?.trim() || '',
      priceUSD: Number(option.priceUSD),
      stock: Number.isFinite(option.stock) ? Number(option.stock) : 0,
    })),
  }));

  const optionPrices = normalized
    .flatMap((variant) => variant.options.map((option) => option.priceUSD))
    .filter((price) => Number.isFinite(price) && price >= 0);

  const priceUSD = optionPrices.length ? Math.min(...optionPrices) : undefined;

  const stockTotal = normalized
    .flatMap((variant) => variant.options.map((option) => option.stock || 0))
    .reduce((sum, stock) => sum + (Number.isFinite(stock) ? stock : 0), 0);

  return { normalized, priceUSD, stockTotal };
};

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
      return res.status(200).json({ product: { id: snap.id, ...data } });
    }

    if (req.method === 'PATCH') {
      const payloadRaw =
        typeof req.body === 'string' ? (JSON.parse(req.body) as UpdateProductPayload) : (req.body as UpdateProductPayload);

      if (!payloadRaw || typeof payloadRaw !== 'object') {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const updateData: UpdateProductPayload = { ...payloadRaw };

      if (payloadRaw.variants) {
        const { normalized, priceUSD, stockTotal } = normalizeVariants(payloadRaw.variants);

        updateData.variants = normalized;
        if (Number.isFinite(priceUSD)) {
          updateData.priceUSD = priceUSD;
        }
        updateData.stockTotal = stockTotal;
      }

      updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

      await adminDb.collection('products').doc(productId).update(updateData);

      return res.status(200).json({ id: productId, updated: true });
    }

    if (req.method === 'DELETE') {
      const docRef = adminDb.collection('products').doc(productId);
      const snap = await docRef.get();

      if (!snap.exists) {
        return res.status(404).json({ error: 'Product not found' });
      }

      await docRef.delete();

      return res.status(200).json({ id: productId, deleted: true });
    }
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message || 'Unauthorized' });
    }
    console.error('Error en producto handler:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
