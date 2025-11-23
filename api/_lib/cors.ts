// api/_lib/cors.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';

export function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
