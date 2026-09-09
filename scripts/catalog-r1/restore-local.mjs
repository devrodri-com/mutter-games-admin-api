// No credentials, no SDK defaults, no triggers, and only the loopback emulator.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const directory=process.argv[2];
if(!directory?.startsWith('/Users/lolo/PrivateBackups/mutter-catalog-r1-'))throw Error('Private backup required');
if(Object.keys(process.env).some(k=>/^(FIREBASE_PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS|MP_ACCESS_TOKEN)$/.test(k)))throw Error('Credential-free restore required');
const origin='http://127.0.0.1:8188';const original='projects/mutter-games/databases/(default)';const target='projects/demo-mutter-restore/databases/(default)';
const documents=JSON.parse(readFileSync(`${directory}/catalog-firestore.json`,'utf8'));
const manifest=JSON.parse(readFileSync(`${directory}/manifest.json`,'utf8'));
if(!manifest.catalogComplete)throw Error('Incomplete catalog export');
const sha=value=>createHash('sha256').update(value).digest('hex');
if(sha(readFileSync(`${directory}/catalog-firestore.json`))!==manifest.hashes['catalog-firestore.json'])throw Error('Catalog hash mismatch');
function translate(value,from,to){if(Array.isArray(value))return value.map(v=>translate(v,from,to));if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='referenceValue'&&typeof v==='string'?v.replace(from,to):translate(v,from,to)]));}
const canonical=value=>JSON.stringify(sort(value));
function sort(value){if(Array.isArray(value))return value.map(sort);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])]));}
async function local(path,body){const r=await fetch(`${origin}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Local restore HTTP ${r.status}`);return r.json();}
const persisted=documents.filter(d=>d.fields);
// create-only precondition: never overwrite even another local recovery run.
if(!process.argv.includes('--verify-only')) for(let i=0;i<persisted.length;i+=200)await local(`/v1/${target}/documents:commit`,{writes:persisted.slice(i,i+200).map(d=>({update:{name:d.name.replace(original,target),fields:translate(d.fields,original,target)},currentDocument:{exists:false}}))});
let verified=0;
for(let i=0;i<persisted.length;i+=20)await Promise.all(persisted.slice(i,i+20).map(async d=>{const restored=await local(`/v1/${d.name.replace(original,target)}`);if(canonical(translate(restored.fields,target,original))!==canonical(d.fields))throw Error('Restored field/type mismatch');verified++;}));
for(const missing of documents.filter(d=>!d.fields)){const r=await fetch(`${origin}/v1/${missing.name.replace(original,target)}`);if(r.status!==404)throw Error('Missing parent was not preserved');}
const correspondence=JSON.parse(readFileSync(`${directory}/image-correspondence-private.json`,'utf8'));
let imageCount=0;
for(const file of readdirSync(`${directory}/originals`)){if(!/^[a-f0-9]{64}$/.test(file))throw Error('Unexpected original filename');if(sha(readFileSync(`${directory}/originals/${file}`))!==file)throw Error('Original hash mismatch');imageCount++;}
for(const match of correspondence.filter(m=>['COPIED','URL_ORIGINAL_COPIED_METADATA_MISSING'].includes(m.status))){const bytes=readFileSync(`${directory}/originals/${match.sha256}`);if(bytes.length!==match.bytes || sha(bytes)!==match.sha256)throw Error('Image correspondence mismatch');}
const result={verifiedAt:new Date().toISOString(),project:'demo-mutter-restore',endpoint:origin,documentsVerified:verified,missingParentRecords:documents.length-persisted.length,fieldsAndTypes:'ALL_PERSISTED_DOCUMENTS_VERIFIED',references:'Project prefix translated to demo and reversed for full equality check',originalFilesVerified:imageCount,imageReferencesVerified:correspondence.filter(m=>['COPIED','URL_ORIGINAL_COPIED_METADATA_MISSING'].includes(m.status)).length,missingImages:correspondence.filter(m=>!['COPIED','URL_ORIGINAL_COPIED_METADATA_MISSING'].includes(m.status)).length,metadataMissingImages:correspondence.filter(m=>m.status==='URL_ORIGINAL_COPIED_METADATA_MISSING').length,productionWrites:0,sourceUpdateTimes:'Retained in export; emulator assigns new updateTime on restore'};
writeFileSync(`${directory}/restore-verification.json`,JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
