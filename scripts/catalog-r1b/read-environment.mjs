// Authorized read-only calls; never serializes credentials or account identities.
import { execFileSync } from 'node:child_process';
import { cert } from 'firebase-admin/app';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const out = '/Users/lolo/PrivateBackups/mutter-catalog-r1b-20260909';
mkdirSync(out, { recursive: true, mode: 0o700 });
const team = 'team_zgY1367CSDsN9mxaF6EXpe3f';
const vc = path => JSON.parse(execFileSync('/Users/lolo/.volta/tools/image/packages/vercel/bin/vercel', ['api', `${path}?teamId=${team}`, '--raw'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
const save = (name, data) => writeFileSync(`${out}/${name}`, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
try {
  const project = 'prj_yDpdKjGlllr9Xs0EisirMiWCj62T';
  const envs = vc(`/v9/projects/${project}/env`).envs;
  const value = key => vc(`/v9/projects/${project}/env/${envs.find(e => e.key === key && e.target.includes('production')).id}`).value;
  const projectId = value('FIREBASE_PROJECT_ID');
  if (projectId !== 'mutter-games') throw Error('Project mismatch');
  const credential = cert({ projectId, clientEmail: value('FIREBASE_CLIENT_EMAIL'), privateKey: value('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n') });
  const access = (await credential.getAccessToken()).access_token;
  const read = async path => { const r = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(30000) }); return { status: r.status, data: r.ok ? await r.json() : null }; };
  const release = await read('projects/mutter-games/releases/cloud.firestore');
  const current = release.data?.rulesetName ? await read(release.data.rulesetName) : null;
  const source = current?.data?.source?.files?.[0]?.content;
  const summary = { date: new Date().toISOString(), projectId, releaseStatus: release.status, rulesStatus: current?.status, sha256: source ? createHash('sha256').update(source).digest('hex') : null };
  if (current?.data) save('effective-rules-readback.json', current.data);
  save('rules-readback-summary.json', summary); console.log(JSON.stringify(summary));
} catch { console.error('Rules read failed; response and credentials withheld.'); process.exitCode = 1; }
try {
  const project = 'prj_MMfug8FP68f5DcbqzmNngveqn1si';
  const envs = vc(`/v9/projects/${project}/env`).envs;
  const candidates = envs.filter(e => /MP.*ACCESS_TOKEN/.test(e.key));
  const seen = new Set(); const results = [];
  for (const candidate of candidates) {
    const token = vc(`/v9/projects/${project}/env/${candidate.id}`).value;
    if (seen.has(token)) { results.push({ key: candidate.key, sameCredentialAsEarlier: true }); continue; }
    seen.add(token);
    const response = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    const account = response.ok ? await response.json() : null;
    results.push({ key: candidate.key, targets: candidate.target, status: response.status, site: account?.site_id ?? null, verifiedTestUser: Array.isArray(account?.tags) && account.tags.includes('test_user'), responseType: account?.user_type ?? null });
  }
  const summary = { date: new Date().toISOString(), results, preferencesCreated: 0, integrationVerified: false };
  save('mp-mode-readback.json', summary); console.log(JSON.stringify(summary));
} catch { console.error('MP mode read failed; response and credentials withheld.'); process.exitCode = 1; }
