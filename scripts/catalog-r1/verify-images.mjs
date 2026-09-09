// Read-only second metadata pass and bounded recovery of references missing from the library.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const directory=process.argv[2];if(!directory?.startsWith('/Users/lolo/PrivateBackups/mutter-catalog-r1-'))throw Error('Private destination required');
process.umask(0o077);
const sha=v=>createHash('sha256').update(v).digest('hex');
const save=(name,value)=>writeFileSync(`${directory}/${name}`,JSON.stringify(value,null,2),{mode:0o600});
const old=JSON.parse(readFileSync(`${directory}/imagekit-metadata-private.json`));
const correspondence=JSON.parse(readFileSync(`${directory}/image-correspondence-private.json`));
const manifest=JSON.parse(readFileSync(`${directory}/manifest.json`));
const project='prj_yDpdKjGlllr9Xs0EisirMiWCj62T';const team='team_zgY1367CSDsN9mxaF6EXpe3f';
const vc=path=>JSON.parse(execFileSync('/Users/lolo/.volta/tools/image/packages/vercel/bin/vercel',['api',`${path}?teamId=${team}`,'--raw'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
const entry=vc(`/v9/projects/${project}/env`).envs.find(e=>e.key==='IMAGEKIT_PRIVATE_KEY'&&e.target.includes('production'));if(!entry)throw Error('Configuration unavailable');
const credential=vc(`/v9/projects/${project}/env/${entry.id}`).value;
const files=[];const startedAt=new Date().toISOString();
for(let skip=0;;skip+=100){const r=await fetch(`https://api.imagekit.io/v1/files?limit=100&skip=${skip}`,{headers:{Authorization:`Basic ${Buffer.from(`${credential}:`).toString('base64')}`},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Metadata HTTP ${r.status}`);const batch=await r.json();if(!Array.isArray(batch))throw Error('Invalid metadata');files.push(...batch);if(batch.length<100)break;}
const fingerprint=f=>JSON.stringify([f.fileId,f.filePath,f.size,f.updatedAt,f.versionInfo]);
const current=new Map(files.map(f=>[f.fileId,f]));const referenced=new Set(correspondence.filter(m=>m.fileId).map(m=>m.fileId));
const changed=old.filter(f=>referenced.has(f.fileId)&&fingerprint(f)!==fingerprint(current.get(f.fileId)??{})).map(f=>f.fileId);
save('imagekit-second-pass-private.json',files);
const missing=correspondence.filter(m=>m.status!=='COPIED');
for(let i=0;i<missing.length;i+=8)await Promise.all(missing.slice(i,i+8).map(async m=>{
 const u=new URL(m.url);if(u.protocol!=='https:'||u.hostname!=='ik.imagekit.io'||u.pathname.includes('/tr:'))throw Error('Unverified original origin');
 u.searchParams.set('tr','orig-true');
 try{const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(30000)});m.recoveryHttpStatus=r.status;
  if(!r.ok){m.status='ORIGINAL_NOT_FOUND';return;}
  const bytes=Buffer.from(await r.arrayBuffer());const contentType=r.headers.get('content-type')??'';if(!contentType.startsWith('image/')){m.status='ORIGINAL_RESPONSE_UNVERIFIED';return;}
  m.sha256=sha(bytes);m.bytes=bytes.length;m.contentType=contentType;m.status='URL_ORIGINAL_COPIED_METADATA_MISSING';
  if(!existsSync(`${directory}/originals/${m.sha256}`))writeFileSync(`${directory}/originals/${m.sha256}`,bytes,{mode:0o600});
 }catch{m.status='ORIGINAL_READ_FAILED';}
}));
save('image-correspondence-private.json',correspondence);
const result={startedAt,finishedAt:new Date().toISOString(),listed:files.length,referencedMetadataChanges:changed.length,changedFileIds:changed,unmatchedStatuses:Object.fromEntries([...new Set(missing.map(m=>m.status))].map(s=>[s,missing.filter(m=>m.status===s).length])),atomic:false};
save('image-verification-private.json',result);manifest.images.secondPass={...result,changedFileIds:undefined};
for(const name of ['image-correspondence-private.json','imagekit-second-pass-private.json','image-verification-private.json'])manifest.hashes[name]=sha(readFileSync(`${directory}/${name}`));save('manifest.json',manifest);
console.log(JSON.stringify({...result,changedFileIds:undefined}));if(changed.length||missing.some(m=>m.status!=='COPIED'))process.exitCode=1;
