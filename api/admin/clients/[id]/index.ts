// api/admin/clients/[id]/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import withAdmin from '../../../_lib/withAdmin';
import { adminDb } from '../../../_lib/firebaseAdmin';
import { assertAdmin } from '../../../_lib/permissions';
import { handleCors, setCorsHeaders } from '../../../_lib/cors';

// DELETE → Remove a client (admin + superadmin)

async function handler({
  req,
  res,
  uid,
  role,
}: {
  req: VercelRequest;
  res: VercelResponse;
  uid: string;
  role: 'admin' | 'superadmin';
}) {
  if (handleCors(req, res)) {
    return;
  }
  setCorsHeaders(req, res);

  const clientId = req.query.id as string;

  if (!clientId) {
    return res.status(400).json({ error: 'Missing client id' });
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin + superadmin can delete clients
  assertAdmin(role);

  try {
    await adminDb.collection('clients').doc(clientId).delete();

    return res.status(200).json({ id: clientId, deleted: true });
  } catch (err: any) {
    console.error('Error deleting client:', err);
    return res.status(500).json({ error: err?.message || 'Internal error' });
  }
}

export default withAdmin(handler);