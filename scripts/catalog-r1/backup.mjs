// Private, read-only export. No remote writes; never store credentials.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { cert } = require('firebase-admin/app');
const output = process.argv[2];
if (!output?.startsWith('/Users/lolo/PrivateBackups/mutter-catalog-r1-')) throw Error('Private destination required');
process.umask(0o077);
mkdirSync(output, { recursive: true, mode: 0o700 });
const team = 'team_zgY1367CSDsN9mxaF6EXpe3f';
const project = 'prj_yDpdKjGlllr9Xs0EisirMiWCj62T';
const vc = path => JSON.parse(execFileSync('/Users/lolo/.volta/tools/image/packages/vercel/bin/vercel', ['api', `${path}?teamId=${team}`, '--raw'], { encoding:'utf8', timeout:30000, stdio:['ignore','pipe','pipe'] }));
const envs = vc(`/v9/projects/${project}/env`).envs;
const value = key => { const e=envs.find(e=>e.key===key && e.target.includes('production')); if(!e) throw Error('Missing required configuration'); return vc(`/v9/projects/${project}/env/${e.id}`).value; };
const projectId = value('FIREBASE_PROJECT_ID');
if(projectId !== 'mutter-games') throw Error('Project mismatch');
const credential = cert({projectId,clientEmail:value('FIREBASE_CLIENT_EMAIL'),privateKey:value('FIREBASE_PRIVATE_KEY').replace(/\\n/g,'\n')});
const token = (await credential.getAccessToken()).access_token;
console.log('Authenticated read-only export for mutter-games/(default)');
const headers = {Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const root = `projects/${projectId}/databases/(default)/documents`;
const start = new Date().toISOString();
const save = (name,data) => writeFileSync(`${output}/${name}`, JSON.stringify(data,null,2), {mode:0o600});
async function read(path, body) {
 const r=await fetch(`https://firestore.googleapis.com/v1/${path}`, {method:body?'POST':'GET',headers, signal:AbortSignal.timeout(30000), ...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok) {const e=new Error(`Firestore read HTTP ${r.status}`);e.status=r.status;throw e;}return r.json();
}
const manifest = {startedAt:start,projectId,database:'(default)',atomic:false,semantics:'Paginated concurrent export; second pass checks updateTime and complete path set. Not PITR.',failures:[],counts:{},hashes:{}};
try { const metadata=await read(`projects/${projectId}/databases/(default)`); save('database-metadata.json',metadata);manifest.pitr=metadata.pointInTimeRecoveryEnablement ?? 'UNSPECIFIED'; }catch(e){manifest.pitr=`NOT_VERIFIABLE_HTTP_${e.status}`;}
try {const backups=await read(`projects/${projectId}/locations/-/backups`);save('backups-metadata.json',backups);manifest.backups='METADATA_READ';}catch(e){manifest.backups=`NOT_VERIFIABLE_HTTP_${e.status}`;}
async function scanCollection(path, results) {
 let pageToken;
 do {
  const qs=new URLSearchParams({pageSize:'100',showMissing:'true',...(pageToken?{pageToken}:{})});
  const page=await read(`${path}?${qs}`);
  for(const d of page.documents??[]) {
   results.push(d);
   let token;
   do {
    const subs=await read(`${d.name}:listCollectionIds`, {pageSize:100,...(token?{pageToken:token}:{})});
    for(const c of subs.collectionIds??[]) await scanCollection(`${d.name}/${c}`,results);
    token=subs.nextPageToken;
   }while(token);
  }
  pageToken=page.nextPageToken;
 }while(pageToken);
}
const documents=[];
try {
 for(const name of ['products','categories','subcategories']) await scanCollection(`${root}/${name}`,documents);
 save('catalog-firestore.json',documents);
 const again=[];for(const name of ['products','categories','subcategories']) await scanCollection(`${root}/${name}`,again);
 const versions=docs=>docs.map(d=>[d.name,d.updateTime??'MISSING']).sort((a,b)=>a[0].localeCompare(b[0]));
 manifest.stableAcrossPasses=JSON.stringify(versions(documents))===JSON.stringify(versions(again));
 save('second-pass-versions.json',versions(again));
 const counts={true:0,false:0,absent:0,null:0,string:0,number:0,other:0};const legacy=[];
 for(const d of documents.filter(d=>d.name.split('/documents/')[1].split('/').length===2 && d.name.includes('/documents/products/') && d.fields)) {
  const a=d.fields.active;const cls=a===undefined?'absent':a.booleanValue===true?'true':a.booleanValue===false?'false':'nullValue' in a?'null':'stringValue' in a?'string':'integerValue' in a||'doubleValue' in a?'number':'other';counts[cls]++;if(!['true','false'].includes(cls))legacy.push(d.name);
 }
 manifest.counts=counts;manifest.documents=documents.length;manifest.catalogComplete=true;save('publication-impact-private.json',{counts,legacy});
 const key=value('IMAGEKIT_PRIVATE_KEY');
 const ikHeaders={Authorization:`Basic ${Buffer.from(`${key}:`).toString('base64')}`};
 const files=[];
 for(let skip=0;;skip+=100){const r=await fetch(`https://api.imagekit.io/v1/files?limit=100&skip=${skip}`,{headers:ikHeaders});if(!r.ok)throw Error(`ImageKit list HTTP ${r.status}`);const batch=await r.json();if(!Array.isArray(batch))throw Error('Invalid ImageKit list');files.push(...batch);if(batch.length<100)break;}
 save('imagekit-metadata-private.json',files);
 manifest.images={status:'PENDING_ORIGINAL_COPY',metadataRecords:files.length,nextStep:'Run backup-images.mjs against this private directory'};
 manifest.protectionComplete=false;
}catch(e){manifest.failures.push(e instanceof Error?e.message:'Backup failed');manifest.catalogComplete??=false;}
manifest.finishedAt=new Date().toISOString();
for(const [name,data] of [['catalog-firestore.json',documents]])manifest.hashes[name]=createHash('sha256').update(JSON.stringify(data,null,2)).digest('hex');
save('manifest.json',manifest);console.log(JSON.stringify(manifest));
if(manifest.failures.length)process.exitCode=1;
