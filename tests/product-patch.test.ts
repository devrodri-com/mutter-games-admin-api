import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { parsePatch, patchProduct, productVersion } from '../api/_lib/product-patch';
test('rejects legacy snapshots, publication in edits, invalid types and extra fields',()=>{
 for(const body of [{active:true,title:'old'},{version:'1:0',intent:'edit',changes:{active:true}},{version:'1:0',intent:'edit',changes:{stockTotal:-1}},{version:'1:0',intent:'edit',changes:{unknown:'x'}}])assert.throws(()=>parsePatch(body));
 assert.equal(parsePatch({version:'1:0',intent:'publication',changes:{active:false}}).changes.active,false);
});
test('atomic stale edit after deactivation preserves fields and images',async()=>{
 assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
 const app=initializeApp({projectId:'demo-mutter-r1'},'admin-regression');const db=getFirestore(app);const ref=db.collection('products').doc('admin-concurrency');
 try{
  await ref.set({title:'Legacy',active:true,description:'original',images:['https://example.invalid/original','https://example.invalid/second'],unknownField:{keep:42}});
  const version=productVersion(await ref.get());
  await patchProduct(db,ref.id,{version,intent:'publication',changes:{active:false}});
  await assert.rejects(patchProduct(db,ref.id,{version,intent:'edit',changes:{description:'stale'}}),{status:409});
  const current=await ref.get();assert.equal(current.data()?.active,false);assert.equal(current.data()?.description,'original');
  await patchProduct(db,ref.id,{version:productVersion(current),intent:'edit',changes:{description:'fresh'}});
  assert.deepEqual((await ref.get()).data()?.unknownField,{keep:42});assert.deepEqual((await ref.get()).data()?.images,['https://example.invalid/original','https://example.invalid/second']);assert.equal((await ref.get()).data()?.title,'Legacy');
  await patchProduct(db,ref.id,{version:productVersion(await ref.get()),intent:'edit',changes:{images:['https://example.invalid/second','https://example.invalid/original'],variants:[{title:{es:'Legacy option',en:'Legacy option'},label:{es:'Color',en:'Color'},options:[{value:'Rojo',priceUSD:123,stock:3,variantId:'red'}]}]}});
  const edited=(await ref.get()).data();assert.deepEqual(edited?.images,['https://example.invalid/second','https://example.invalid/original']);assert.equal(edited?.variants[0].title.es,'Legacy option');assert.equal(edited?.priceUSD,123);assert.equal(edited?.stockTotal,3);assert.equal(edited?.active,false);assert.deepEqual(edited?.unknownField,{keep:42});
  const latest=productVersion(await ref.get());const results=await Promise.allSettled([patchProduct(db,ref.id,{version:latest,intent:'edit',changes:{description:'writer1'}}),patchProduct(db,ref.id,{version:latest,intent:'edit',changes:{description:'writer2'}})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 }finally{await ref.delete();await db.terminate();await deleteApp(app);}
});
