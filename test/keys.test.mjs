import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKeyManager,keyName,customKey,publicKey} from '../keys.mjs';
const modelKey='sk-local-'+'a'.repeat(48),management='dw-admin-'+'b'.repeat(64);
const id=n=>'request-fixture-'+String(n).padStart(4,'0');
function setup(){
 const rows=[{id:'base',name:'默认',key:modelKey,enabled:true,createdAt:1,allowedProviders:['doubaowork'],allowedModels:[]},
  {id:'other',name:'其他',key:'OTHER_PROVIDER_SECRET_VALUE'.repeat(2),enabled:true,allowedProviders:['other'],allowedModels:[]},
  {id:'admin',name:'管理',key:management,enabled:true,allowedProviders:[],allowedModels:[]},
  {id:'wide',name:'跨提供商',key:'WIDE_SCOPE_SECRET_VALUE'.repeat(2),enabled:true,allowedProviders:['doubaowork','other'],allowedModels:[]}];
 let submits=0,failCreate=false,mismatch=false,failList=false;const calls=[];
 const request=async(path,options={})=>{
  calls.push({path,method:options.method||'GET'});
  if(path==='/api/keys'&&!options.method){if(failList)throw Error('SECRET_DETAILS');return {keys:structuredClone(rows)};}
  if(path==='/api/keys'&&options.method==='POST'){
   submits++;assert.deepEqual(options.body.allowedProviders,['doubaowork']);assert.deepEqual(options.body.allowedModels,[]);
   const created={...options.body,id:'key'+submits,createdAt:Date.now(),enabled:true};rows.push(created);
   if(failCreate)throw Error('SECRET_DETAILS');
   return {created:{...created,id:mismatch?'wrong-id':created.id},keys:rows};
  }
  if(options.method==='PATCH'){
   const item=rows.find(k=>k.id===path.split('/').at(-1));assert(item);Object.assign(item,options.body);return {keys:rows};
  }
  throw Error('unexpected route');
 };
 return {rows,calls,manager:createKeyManager({request,modelKey,management}),get submits(){return submits;},set failCreate(v){failCreate=v;},set mismatch(v){mismatch=v;},set failList(v){failList=v;}};
}
test('Key 名称与自定义内容校验，留空由服务端随机生成',()=>{
 assert.equal(keyName('  日常脚本  '),'日常脚本');assert.equal(customKey(''),'');assert.equal(customKey(undefined),'');assert.equal(customKey('sk-custom-'+'x'.repeat(32)),'sk-custom-'+'x'.repeat(32));
 for(const bad of ['',null,12,'x'.repeat(41),'a\nb','  '])assert.throws(()=>keyName(bad),e=>e.status===400);
 for(const bad of [null,12,[],'short','x'.repeat(129),'x'.repeat(31)+' ','x'.repeat(31)+'\n','x'.repeat(31)+'中'])assert.throws(()=>customKey(bad),e=>e.status===400);
});
test('Key 列表只暴露豆包范围和掩码，不泄漏完整值',async()=>{
 const f=setup();f.rows.push({id:'broken',name:'待检查',key:'enc1:FIXTURE_CIPHERTEXT',enabled:true,allowedProviders:['doubaowork']});
 const d=await f.manager.list();assert.deepEqual(d.keys.map(k=>k.id),['base','broken']);assert.equal(d.keys[0].builtIn,true);assert.equal(d.keys[1].readable,false);
 const raw=JSON.stringify(d);for(const k of f.rows)assert(!raw.includes(k.key));assert(!raw.includes('OTHER_PROVIDER'));assert(!Object.hasOwn(d.keys[0],'key'));
 assert.equal(publicKey(f.rows[0],modelKey).masked,'sk-loc••••••••aaaa');
});
test('随机与自定义 Key 固定豆包权限，重入提交只创建一把',async()=>{
 const f=setup(),payload={name:'客户端 A',requestId:id(1)};
 const [a,b]=await Promise.all([f.manager.create(payload),f.manager.create(payload)]);assert.deepEqual(a,b);assert.equal(f.submits,1);assert.equal(a.created.enabled,true);
 const secret=(await f.manager.reveal(a.created.id)).key;assert.match(secret,/^sk-dw-[A-Za-z0-9_-]{43}$/);assert(!JSON.stringify(a).includes(secret));
 const c=await f.manager.create({name:'客户端 B',key:'sk-custom-'+'c'.repeat(32),requestId:id(2)});assert.equal((await f.manager.reveal(c.created.id)).key,'sk-custom-'+'c'.repeat(32));
 assert.equal(f.submits,2);await assert.rejects(f.manager.create({...payload,name:'内容已变'}),e=>e.status===409);
});
test('保留密钥、重复值、越界 scope 与额外参数均不创建',async()=>{
 const f=setup();
 for(const key of [modelKey,management,f.rows[1].key])await assert.rejects(f.manager.create({name:'重复',key,requestId:id(key.length)}),e=>e.status===409);
 for(const extra of [{allowedProviders:[]},{allowedModels:[]},{enabled:false},{role:'admin'}])await assert.rejects(f.manager.create({name:'越界',requestId:id(8),...extra}),e=>e.status===400);
 await assert.rejects(f.manager.create({name:'无提交标识'}),e=>e.status===400);assert.equal(f.submits,0);
});
test('启停、改名保持 Key 和模型范围不变；默认 Key 受保护',async()=>{
 const f=setup(),{created}=await f.manager.create({name:'脚本',requestId:id(1)});f.rows.find(k=>k.id===created.id).allowedModels=['flash'];
 const before=await f.manager.reveal(created.id);await f.manager.update({id:created.id,enabled:false});let row=(await f.manager.list()).keys.find(k=>k.id===created.id);assert.equal(row.enabled,false);
 await f.manager.update({id:created.id,name:'新名称',enabled:true});row=(await f.manager.list()).keys.find(k=>k.id===created.id);assert.equal(row.name,'新名称');assert.equal(row.enabled,true);assert.deepEqual(row.allowedModels,['flash']);assert.deepEqual(await f.manager.reveal(created.id),before);
 await assert.rejects(f.manager.update({id:'base',enabled:false}),e=>e.status===409);await assert.rejects(f.manager.update({id:created.id,enabled:'yes'}),e=>e.status===400);
 await assert.rejects(f.manager.update({id:created.id,allowedProviders:[]}),e=>e.status===400);
 for(const id of ['other','admin','wide','missing']){await assert.rejects(f.manager.reveal(id),e=>e.status===404);await assert.rejects(f.manager.update({id,enabled:false}),e=>e.status===404);}
 for(const id of ['__proto__','../admin',{},''])await assert.rejects(f.manager.reveal(id),e=>e.status===400);
});
test('创建结果未知或回读不一致时明确提示且不自动重试',async()=>{
 for(const mode of ['failCreate','mismatch']){
  const f=setup();f[mode]=true;const payload={name:'未知结果',requestId:id(1)};
  for(let i=0;i<2;i++)await assert.rejects(f.manager.create(payload),e=>e.status===502&&e.message.includes('待核对')&&!e.message.includes('SECRET_DETAILS'));
  assert.equal(f.submits,1);assert.equal((await f.manager.list()).keys.length,2);
 }
});
