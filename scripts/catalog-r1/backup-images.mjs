// Resume original-byte protection from the private catalog and ImageKit metadata.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const directory=process.argv[2];if(!directory?.startsWith('/Users/lolo/PrivateBackups/mutter-catalog-r1-'))throw Error('Private destination required');
process.umask(0o077);const save=(name,data)=>writeFileSync(`${directory}/${name}`,JSON.stringify(data,null,2),{mode:0o600});
const docs=JSON.parse(readFileSync(`${directory}/catalog-firestore.json`));const files=JSON.parse(readFileSync(`${directory}/imagekit-metadata-private.json`));const manifest=JSON.parse(readFileSync(`${directory}/manifest.json`));
const links=[];function walk(v,owner){if(!v||typeof v!=='object')return;if(typeof v.stringValue==='string'&&/^https?:/.test(v.stringValue))links.push({owner,url:v.stringValue});for(const x of Object.values(v))if(typeof x==='object'){if(Array.isArray(x))x.forEach(i=>walk(i,owner));else walk(x,owner);}}
docs.forEach(d=>walk(d.fields,d.name));
const matches=[];const needed=new Map();
for(const link of links){const u=new URL(link.url);if(u.hostname!=='ik.imagekit.io'){matches.push({...link,status:'EXTERNAL_ORIGINAL_NOT_BACKED_UP'});continue;}
 const f=files.find(f=>f.type==='file'&&(f.url===link.url || (typeof f.filePath==='string'&&decodeURIComponent(u.pathname).endsWith(f.filePath))));
 if(!f){matches.push({...link,status:'ORIGINAL_NOT_FOUND'});continue;}
 needed.set(f.fileId,f);matches.push({...link,fileId:f.fileId,filePath:f.filePath,status:'PENDING'});
}
mkdirSync(`${directory}/originals`,{recursive:true,mode:0o700});
const bytesManifest=new Map();const list=[...needed.values()];
for(let i=0;i<list.length;i+=8){await Promise.all(list.slice(i,i+8).map(async f=>{
 try{
  const url=new URL(f.url);if(url.protocol!=='https:'||url.hostname!=='ik.imagekit.io'||[...url.searchParams.keys()].some(k=>k!=='updatedAt')||url.pathname.includes('/tr:'))throw Error('Unverified original URL');
  url.searchParams.set('tr','orig-true'); // ImageKit's documented byte-for-byte original delivery.
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`HTTP_${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());if(typeof f.size==='number'&&f.size!==bytes.length)throw Error('Original size mismatch');
  const sha256=createHash('sha256').update(bytes).digest('hex');if(!existsSync(`${directory}/originals/${sha256}`))writeFileSync(`${directory}/originals/${sha256}`,bytes,{mode:0o600});
  bytesManifest.set(f.fileId,{sha256,bytes:bytes.length,status:'COPIED'});
 }catch(error){bytesManifest.set(f.fileId,{status:error instanceof Error?error.message:'DOWNLOAD_FAILED'});}
}));if(i%400===0)console.log(`Originals checked: ${Math.min(i+8,list.length)}/${list.length}`);}
for(const m of matches)if(m.fileId)Object.assign(m,bytesManifest.get(m.fileId));
save('image-correspondence-private.json',matches);manifest.images={listed:files.length,referenced:matches.length,uniqueReferenced:list.length,copied:[...bytesManifest.values()].filter(v=>v.status==='COPIED').length,missing:matches.filter(m=>m.status!=='COPIED').length,finishedAt:new Date().toISOString(),semantics:'Original URLs from ImageKit metadata with documented tr=orig-true to disable automatic optimization. Size verified against metadata; SHA256 verifies stored bytes. Metadata and downloads are not atomic.'};
manifest.failures=manifest.failures.filter(message=>!['Original URL not verified','Some original images could not be verified'].includes(message));if(manifest.images.missing)manifest.failures.push('Some original images could not be verified');
for(const filename of ['catalog-firestore.json','imagekit-metadata-private.json','image-correspondence-private.json','publication-impact-private.json','second-pass-versions.json'])manifest.hashes[filename]=createHash('sha256').update(readFileSync(`${directory}/${filename}`)).digest('hex');
save('manifest.json',manifest);console.log(JSON.stringify(manifest.images));if(manifest.images.missing)process.exitCode=1;
