// api/orders.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb, adminAuth } from './_lib/firebaseAdmin';
import { handleCors, setCorsHeaders } from './_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) {
    return;
  }
  setCorsHeaders(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verificar token Firebase (usuario normal, no admin)
    const authHeader = req.headers.authorization || '';
    const tokenString = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!tokenString) {
      return res.status(401).json({ error: 'Unauthorized: missing bearer token' });
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(tokenString, true);
    } catch {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }

    // Obtener uid del token (no confiar en el body)
    const uid = decodedToken.uid;

    // Parsear payload
    const payload =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Validaciones mínimas del payload
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    // Validar items
    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      return res.status(400).json({ error: 'items is required and must be a non-empty array' });
    }

    // Validar total (totalUSD o total)
    const total = payload.totalUSD ?? payload.total;
    if (total === undefined || !Number.isFinite(total) || total < 0) {
      return res.status(400).json({ error: 'totalUSD or total is required and must be a valid number >= 0' });
    }

    // Validar shippingData si existe
    if (payload.shippingData) {
      if (typeof payload.shippingData !== 'object') {
        return res.status(400).json({ error: 'shippingData must be an object' });
      }
      // Si shippingData tiene name, validar que exista
      if ('name' in payload.shippingData && !payload.shippingData.name?.trim()) {
        return res.status(400).json({ error: 'shippingData.name is required if shippingData is provided' });
      }
      // Si shippingData tiene address, validar que exista
      if ('address' in payload.shippingData && !payload.shippingData.address?.trim()) {
        return res.status(400).json({ error: 'shippingData.address is required if shippingData is provided' });
      }
    }

    // Crear orden en Firestore con Admin SDK
    const orderData = {
      ...payload,
      uid, // Forzar uid del token, no del body
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await adminDb.collection('orders').add(orderData);

    return res.status(201).json({ id: docRef.id });
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message || 'Unauthorized' });
    }
    console.error('Error creando orden:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
