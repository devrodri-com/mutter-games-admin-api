import {execFileSync} from 'node:child_process';
import {cert} from 'firebase-admin/app';
import {writeFileSync} from 'node:fs';
const root='/Users/lolo/PrivateBackups/mutter-catalog-r1-20260908';const team='team_zgY1367CSDsN9mxaF6EXpe3f';const project='prj_yDpdKjGlllr9Xs0EisirMiWCj62T';
const vc=path=>JSON.parse(execFileSync('/Users/lolo/.volta/tools/image/packages/vercel/bin/vercel',['api',`${path}?teamId=${team}`,'--raw'],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
try{
 const envs=vc(`/v9/projects/${project}/env`).envs;const value=key=>vc(`/v9/projects/${project}/env/${envs.find(e=>e.key===key&&e.target.includes('production')).id}`).value;
 const projectId=value('FIREBASE_PROJECT_ID');if(projectId!=='mutter-games')throw Error('Project mismatch');
 const credential=cert({projectId,clientEmail:value('FIREBASE_CLIENT_EMAIL'),privateKey:value('FIREBASE_PRIVATE_KEY').replace(/\\n/g,'\n')});const token=(await credential.getAccessToken()).access_token;
 const read=async path=>{const r=await fetch(`https://firebaserules.googleapis.com/v1/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});if(!r.ok)return {status:r.status};return {status:r.status,data:await r.json()};};
 const release=await read('projects/mutter-games/releases/cloud.firestore');const evidence={projectId,releaseStatus:release.status,rulesStatus:undefined};
 if(release.data?.rulesetName){const rules=await read(release.data.rulesetName);evidence.rulesStatus=rules.status;if(rules.data)writeFileSync(`${root}/effective-rules-private.json`,JSON.stringify(rules.data,null,2),{mode:0o600});}
 writeFileSync(`${root}/rules-read-status.json`,JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
}catch{console.error('Environment read failed; credentials and response withheld.');process.exitCode=1;}
