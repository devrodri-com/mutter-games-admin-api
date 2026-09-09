// Bounded GET-only library search and HEAD readback for the 126 R1 gaps.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const source = '/Users/lolo/PrivateBackups/mutter-catalog-r1-20260908';
const out = '/Users/lolo/PrivateBackups/mutter-catalog-r1b-20260909';
const gaps = JSON.parse(readFileSync(`${source}/image-correspondence-private.json`)).filter(r => r.status === 'URL_ORIGINAL_COPIED_METADATA_MISSING');
if (gaps.length !== 126) throw Error('Unexpected input');
const team = 'team_zgY1367CSDsN9mxaF6EXpe3f'; const project = 'prj_yDpdKjGlllr9Xs0EisirMiWCj62T';
const vc = path => JSON.parse(execFileSync('/Users/lolo/.volta/tools/image/packages/vercel/bin/vercel', ['api', `${path}?teamId=${team}`, '--raw'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
try {
  const entry = vc(`/v9/projects/${project}/env`).envs.find(e => e.key === 'IMAGEKIT_PRIVATE_KEY' && e.target.includes('production'));
  const credential = vc(`/v9/projects/${project}/env/${entry.id}`).value;
  const results = []; const startedAt = new Date().toISOString();
  for (let offset = 0; offset < gaps.length; offset += 4) {
    const batch = await Promise.all(gaps.slice(offset, offset + 4).map(async gap => {
      const url = new URL(gap.url);
      if (url.protocol !== 'https:' || url.hostname !== 'ik.imagekit.io' || url.search) throw Error('Unexpected source URL');
      const name = decodeURIComponent(url.pathname.split('/').at(-1));
      const query = new URLSearchParams({ searchQuery: `name = ${JSON.stringify(name)}`, limit: '100' });
      const response = await fetch(`https://api.imagekit.io/v1/files?${query}`, { headers: { Authorization: `Basic ${Buffer.from(`${credential}:`).toString('base64')}` }, signal: AbortSignal.timeout(15000) });
      const matches = response.ok ? await response.json() : null;
      url.searchParams.set('tr', 'orig-true');
      const delivery = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(15000) });
      return { owner: gap.owner, url: gap.url, sha256: gap.sha256, libraryStatus: response.status, matches, truncated: Array.isArray(matches) && matches.length >= 100, deliveryStatus: delivery.status, contentType: delivery.headers.get('content-type'), contentLength: delivery.headers.get('content-length'), etag: delivery.headers.get('etag'), lastModified: delivery.headers.get('last-modified') };
    }));
    results.push(...batch);
    if (batch.some(r => r.libraryStatus === 403 || r.libraryStatus === 429)) break;
  }
  const summary = { startedAt, finishedAt: new Date().toISOString(), expected: 126, checked: results.length, library200: results.filter(r => r.libraryStatus === 200).length, emptySearch: results.filter(r => Array.isArray(r.matches) && r.matches.length === 0).length, nonemptySearch: results.filter(r => Array.isArray(r.matches) && r.matches.length > 0).length, delivery200: results.filter(r => r.deliveryStatus === 200).length, truncated: results.filter(r => r.truncated).length, protectionComplete: false, headIsNotOriginalIdentityProof: true };
  for (const [name, value] of [['image-gap-readback-private.json', results], ['image-gap-readback-summary.json', summary]]) writeFileSync(`${out}/${name}`, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(summary));
} catch { console.error('Bounded image read failed; credentials and private response withheld.'); process.exitCode = 1; }
