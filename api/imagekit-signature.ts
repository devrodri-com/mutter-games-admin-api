// /api/imagekit-signature.ts

import { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const allowedOrigins = [
    "https://muttergames.com",
    "https://www.muttergames.com"
  ];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://muttergames.com');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    return res.status(500).json({ error: "Faltan variables de entorno." });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const expire = timestamp + 600; // 10 minutos de validez
  const token = crypto.randomBytes(16).toString('hex');

  const signature = crypto
    .createHmac('sha1', privateKey)
    .update(token + String(expire))
    .digest('hex');

  console.log("🔒 Firma generada:", {
    signature,
    token,
    expire,
    publicKey: !!publicKey,
    privateKey: !!privateKey,
    urlEndpoint: !!process.env.IMAGEKIT_URL_ENDPOINT,
  });
  return res.status(200).json({
    signature,
    token,
    expire,
    publicKey,
  });
}