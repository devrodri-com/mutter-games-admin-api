import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors } from './_lib/cors';
// Retired writer: every purchase now uses the authenticated catalog checkout
// on the storefront. Old bundles must reload; accepting their totals is unsafe.
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res))
        return;
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    return res.status(409).json({ code: 'UPDATE_REQUIRED', error: 'Actualizá la página para continuar con una compra segura.' });
}
