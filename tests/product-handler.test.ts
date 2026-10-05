import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import type {VercelResponse} from '@vercel/node';
test('real product handler: authentication, single PATCH, legacy rejection and conflict',async()=>{
 assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
 process.env.CORS_ALLOW_ORIGIN='http://127.0.0.1:5277';
 const email=`synthetic-handler-${randomUUID()}@example.invalid`;let createdUid:string|undefined;
 const app=initializeApp({projectId:'demo-mutter-r1'});const db=getFirestore(app);const auth=getAuth(app);
 const {default:handler}=await import('../api/admin/products/[id]/index');
 async function call(method:string,body:unknown,token?:string){
  const req=Object.assign(new IncomingMessage(new Socket()),{method,headers:{origin:'http://127.0.0.1:5277',...(token?{authorization:`Bearer ${token}`}:{})},query:{id:'handler-product'},cookies:{},body});
  let output:unknown;const raw=new ServerResponse(req);
  // External Vercel HTTP adapter only; the real handler/auth/Firestore execute below.
  const res: VercelResponse=Object.assign(raw,{
   status(code:number){raw.statusCode=code;return res;},
   json(value:unknown){output=value;return res;},
   send(value:unknown){output=value;return res;},
   redirect(statusOrUrl:number|string,url?:string){raw.statusCode=typeof statusOrUrl==='number'?statusOrUrl:302;raw.setHeader('Location',typeof statusOrUrl==='string'?statusOrUrl:url??'');return res;}
  });
  await handler(req,res);return {status:res.statusCode,body:output};
 }
 try{
  await db.doc('operations/webStockCutover').set({schema:1,state:'open',revision:'synthetic-admin-handler-open',updatedAt:new Date()});
  assert.equal((await call('PATCH',{})).status,401);assert.equal((await call('PATCH',{},'invalid')).status,401);
  const signup=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'synthetic-handler-password',returnSecureToken:true})});
  const user: unknown=await signup.json();
  if(!user||typeof user!=='object'||!('localId' in user)||typeof user.localId!=='string'||!('idToken' in user)||typeof user.idToken!=='string')throw Error('Invalid synthetic signup response');
  assert.equal(signup.status,200);createdUid=user.localId;
  try { await auth.verifyIdToken(user.idToken,true); } catch(error) { throw new Error('Synthetic auth verification: '+(error instanceof Error?error.message:'unknown')); }
  assert.equal((await call('GET',{},user.idToken)).status,403);
  await auth.setCustomUserClaims(user.localId,{admin:true});
  const signIn=await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'synthetic-handler-password',returnSecureToken:true})});
  const admin: unknown=await signIn.json();
  if(!admin||typeof admin!=='object'||!('idToken' in admin)||typeof admin.idToken!=='string')throw Error('Invalid synthetic sign-in response');
  await db.collection('products').doc('handler-product').set({active:true,title:'Legacy',description:'before',unknown:42,images:['https://example.invalid/image']});
  // Detect an accidentally permissive emulator config: this authenticated client cannot edit catalog.
  const denied = await fetch('http://127.0.0.1:8188/v1/projects/demo-mutter-r1/databases/(default)/documents/products/handler-product?updateMask.fieldPaths=active', {
   method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.idToken}`},body:JSON.stringify({fields:{active:{booleanValue:true}}})
  });
  assert.equal(denied.status,403);
  const get=await call('GET',{},admin.idToken);assert.equal(get.status,200);
  const response=get.body;
  if(!response||typeof response!=='object'||!('product' in response)||!response.product||typeof response.product!=='object'||!('version' in response.product)||typeof response.product.version!=='string')throw Error('Missing product version');
  const version=response.product.version;
  assert.equal((await call('PATCH',{active:true,title:'old'},admin.idToken)).status,428);
  assert.equal((await call('PATCH',{version,intent:'publication',changes:{active:false}},admin.idToken)).status,200);
  assert.equal((await call('PATCH',{version,intent:'edit',changes:{description:'stale'}},admin.idToken)).status,409);
  const persisted=(await db.collection('products').doc('handler-product').get()).data();assert.equal(persisted?.active,false);assert.equal(persisted?.description,'before');assert.equal(persisted?.unknown,42);
  const webReservations = {'opaque-handler-reservation-12345':{expiresAt:1,lines:[{slot:'base',identity:'base',quantity:1}]}};
  await db.collection('products').doc('handler-product').update({stockTotal:1,webReservations});
  assert.equal((await call('DELETE',{},user.idToken)).status,403);
  assert.equal((await call('DELETE',{},admin.idToken)).status,409);
  assert.deepEqual((await db.collection('products').doc('handler-product').get()).data()?.webReservations,webReservations);
  await db.collection('products').doc('handler-product').update({webReservations:{}});
  assert.equal((await call('DELETE',{},admin.idToken)).status,200);
  assert.equal((await db.collection('products').doc('handler-product').get()).exists,false);
 }finally{if(createdUid)await auth.deleteUser(createdUid);await db.terminate();await deleteApp(app);}
});
