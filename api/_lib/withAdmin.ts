// api/_lib/withAdmin.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAdmin } from './verifyAdmin';
import { handleCors, setCorsHeaders } from './cors';

/**
 * Wrapper to standardize all admin endpoints:
 * - Verifies Firebase ID token
 * - Extracts admin/superadmin role
 * - Handles 401/403 automatically
 * - Wraps internal handler with clean API
 *
 * Usage:
 * export default withAdmin(async ({ req, res, uid, role }) => {
 *   // assertAdmin(role) or assertSuperadmin(role)
 *   // your logic...
 *   res.status(200).json({ ok: true });
 * });
 */
export default function withAdmin(
  handler: (ctx: {
    req: VercelRequest;
    res: VercelResponse;
    uid: string;
    role: 'admin' | 'superadmin';
  }) => Promise<any>
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (handleCors(req, res)) {
      return;
    }
    setCorsHeaders(req, res);

    try {
      const { uid, isSuperadmin } = await verifyAdmin(req as any);
      const role: 'admin' | 'superadmin' = isSuperadmin ? 'superadmin' : 'admin';
      return handler({ req, res, uid, role });
    } catch (err: any) {
      if (err instanceof Response) {
        return res.status(err.status || 500).json({ error: err.statusText || 'Error' });
      }
      return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
    }
  };
}