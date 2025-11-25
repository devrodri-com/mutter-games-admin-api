// api/_lib/cors.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';

const raw = process.env.CORS_ALLOW_ORIGIN || '';

// Ejemplo de uso en Vercel:
// CORS_ALLOW_ORIGIN=https://muttergames.com,https://www.muttergames.com

const allowedOrigins = raw
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function normalizeOrigin(origin?: string | string[] | null): string | null {
  if (!origin) return null;
  return Array.isArray(origin) ? origin[0] : origin;
}

function isOriginAllowed(origin?: string | string[] | null): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.includes(normalized);
}

export function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const origin = normalizeOrigin(req.headers.origin);
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // Para navegadores: origin explícitamente no permitido
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PATCH,PUT,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization'
  );
  res.setHeader('Vary', 'Origin');
}

export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  setCorsHeaders(req, res);
  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  // Si el origen no está permitido, cortamos con 403
  if (!isOriginAllowed(req.headers.origin)) {
    res.status(403).json({ error: 'CORS: origin not allowed' });
    return true;
  }
  return false;
}
