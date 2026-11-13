import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPanel} from '../server.mjs';
import {readSettings,dayTime} from '../core.mjs';

const makePort=async s=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port;};
const close=s=>new Promise(r=>s.close(()=>r()));
test('本机桥接：双账号、边界、调度持久化和去重',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-panel-'));
 const management='dw-admin-'+'1'.repeat(64), model='sk-local-'+'2'.repeat(48);
 await writeFile(join(root,'panel-management.key'),management);
 await writeFile(join(root,'probe-model.key'),model);
 const rows=[{id:'A',name:'甲',provider:'doubaowork',hasCredentials:true,enabled:true,chatSupported:true,secret:'SENSITIVE'},
  {id:'B',name:'乙',provider:'doubaowork',hasCredentials:true,enabled:true,chatSupported:true},
  {id:'C',name:'其他',provider:'other',hasCredentials:true,enabled:true}];
 const claimed=[];let opened=0,failModels=false,failRecords=false,providerRunning=true;
 const mock=createServer(async(req,res)=>{
  const isModel=req.url==='/v1/models';
  if(req.headers.authorization!=='Bearer '+(isModel?model:management)){res.writeHead(401);return res.end();}
  let value;
  if(isModel){if(failModels){res.writeHead(503);return res.end();}value={data:[{id:'flash',owned_by:'doubaowork'},{id:'other',owned_by:'other'}]};}
  else if(req.url==='/api/accounts')value={accounts:rows};
  else if(req.url==='/api/plugins')value={packs:[{enabled:true,host:{running:providerRunning},providers:[{id:'doubaowork',enabled:true,loaded:providerRunning}]}]};
  else if(req.url==='/api/accounts/checkin'){
   let buffer=''; for await(const c of req)buffer+=c;
   const {id}=JSON.parse(buffer); claimed.push(id); value={results:[{claim:{outcome:'claimed'}}]};
  }else if(req.url.startsWith('/api/checkin-records?')){if(failRecords){res.writeHead(503);return res.end();}value={records:[{ts:1,provider:'豆包工作',providerId:'doubaowork',outcome:'already'},{ts:2,provider:'其他',providerId:'other',outcome:'already',name:'not-doubao'}]};}
  else if(req.url==='/api/accounts/usage/snapshot')value={results:[]};
  else{res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(isModel?value:{success:true,data:value}));
 });
 const upstreamPort=await makePort(mock);
 const probe=createServer(); const port=await makePort(probe); await close(probe);
 const panel=await createPanel({dir:root,upstreamPort,port,timer:false,loginLauncher:async()=>{opened++;await new Promise(r=>setTimeout(r,50));}}); panel.server.listen(port,'127.0.0.1');await once(panel.server,'listening');
 const origin='http://127.0.0.1:'+port;
 const request=(path,data,headers={})=>fetch(origin+path,{method:data===undefined?'GET':'POST',
  headers:{'x-doubao-panel':'1',...(data===undefined?{}:{origin,'content-type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
 try{
  assert.equal((await fetch(origin+'/api/snapshot')).status,403);
  assert.equal((await request('/api/snapshot',undefined,{origin:'https://example.org'})).status,403);
  assert.equal((await request('/api/key',{}, {origin:'https://example.org'})).status,403);
  assert.equal((await request('/api/login',{}, {origin:'https://example.org'})).status,403);
  assert.equal((await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json','x-doubao-panel':'1'},body:'{}'})).status,403);
  assert.equal((await request('/api/checkin',{id:'C'})).status,404);
  assert.equal((await request('/api/checkin',{id:'__proto__'})).status,400);
  const summary=await (await request('/api/snapshot')).json();
  assert.deepEqual(summary.accounts.map(x=>[x.id,x.available]),[['A',true],['B',true]]);
  assert.deepEqual(summary.models,['flash']);assert(!JSON.stringify(summary).includes('SENSITIVE'));
  assert.equal(summary.records[0].at,1);assert.equal(summary.records.length,1);assert.equal(summary.scheduler.enabled,false);
  assert.equal(summary.loginAvailable,true);assert(summary.updatedAt>0);assert.deepEqual(summary.availability,{models:true,quota:true,records:true});
  assert.equal((await request('/api/alias',{id:'A',alias:'日常账号'})).status,200);
  const after=await (await request('/api/snapshot')).json();
  assert.equal(after.accounts[0].name,'日常账号');assert.equal(after.accounts[0].sourceName,'甲');
  assert.equal((await readSettings(join(root,'doubao-panel-settings.json'))).aliases.A,'日常账号');
  for(const data of [{id:'C',alias:'其他'},{id:'A',alias:'x'.repeat(33)},{id:'A',alias:'bad\nname'},{id:'A',alias:5}])assert((await request('/api/alias',data)).status>=400);
  assert.equal((await request('/api/alias',{id:'A',alias:''})).status,200);
  const loginResults=await Promise.all([request('/api/login',{mode:'native'}),request('/api/login',{mode:'native'})]);
  assert(loginResults.every(r=>r.status===200));assert.equal(opened,1);
  failModels=true;failRecords=true;
  const partial=await (await request('/api/snapshot')).json();
  assert.equal(partial.accounts.length,2);assert.equal(partial.availability.models,false);assert.equal(partial.availability.records,false);
  failModels=false;failRecords=false;
  providerRunning=false;
  const missingProvider=await request('/api/snapshot');assert.equal(missingProvider.status,503);assert((await missingProvider.json()).error.includes('适配器尚未运行'));
  providerRunning=true;
  for(const path of ['/','/style.css','/ui.js','/view.mjs','/doubao-work-avatar.png']){const r=await fetch(origin+path);assert.equal(r.status,200);assert(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));}
  assert.deepEqual(await (await request('/api/key',{})).json(),{key:model});
  assert.equal((await request('/api/auto',{id:'A',enabled:true})).status,200);
  assert.equal((await request('/api/schedule',{enabled:true,time:dayTime().time})).status,200);
  await panel.tick();await panel.tick();
  assert.deepEqual(claimed,['A']);
  assert.equal((await readSettings(join(root,'doubao-panel-settings.json'))).attempted.A.status,'claimed');
 }finally{await close(panel.server);await close(mock);await rm(root,{recursive:true,force:true});}
});

test('浏览器接入 API：核验后刷新、同账号去重、隔离凭据与来源校验',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-browser-api-')),dir=join(root,'state');
 const {mkdir}=await import('node:fs/promises');await mkdir(dir);
 await writeFile(join(dir,'panel-management.key'),'dw-admin-'+'3'.repeat(64));
 await writeFile(join(dir,'probe-model.key'),'sk-local-'+'4'.repeat(48));
 const rows=[];let submits=0,closeCount=0,broken=false;
 const fixtureCookie={name:'sessionid',value:'FIXTURE_ONLY_SECRET',domain:'.doubao.com',path:'/'};
 const mock=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+'dw-admin-'+'3'.repeat(64)){res.writeHead(401);return res.end();}
  let value;
  if(req.url==='/api/accounts'&&req.method==='POST'){
   let text='';for await(const c of req)text+=c;const payload=JSON.parse(text);assert.deepEqual(payload,{provider:'doubaowork',cookies:[fixtureCookie]});submits++;
   if(!rows.length)rows.push({id:'FIXTURE_ID',name:'测试账号',provider:'doubaowork',hasCredentials:true,enabled:false});
   value={account:{id:broken?'wrong-id':'FIXTURE_ID'},created:true,secret:'FIXTURE_ONLY_SECRET'};
  }else if(req.url==='/api/accounts')value={accounts:rows};
  else{res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:value}));
 });
 const upstreamPort=await makePort(mock),probe=createServer(),port=await makePort(probe);await close(probe);
 const panel=await createPanel({dir,upstreamPort,port,timer:false,browserLoginOptions:{pollMs:10,discover:async()=>[{id:'chrome',name:'Google Chrome',path:'/FIXTURE_BROWSER'}],launch:async()=>({cookies:async()=>[fixtureCookie],dispose:async()=>{closeCount++;}})}});
 panel.server.listen(port,'127.0.0.1');await once(panel.server,'listening');const origin='http://127.0.0.1:'+port;
 const request=(path,data,headers={})=>fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{'x-doubao-panel':'1',...(data===undefined?{}:{origin,'content-type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
 async function terminal(){for(let i=0;i<50;i++){const data=await(await request('/api/login-status')).json();assert(!JSON.stringify(data).includes('FIXTURE_ONLY_SECRET'));assert(!JSON.stringify(data).includes('/FIXTURE_BROWSER'));if(!data.active)return data;await new Promise(r=>setTimeout(r,10));}throw Error('fixture timed out');}
 try{
  assert.equal((await fetch(origin+'/api/login-status')).status,403);
  assert.equal((await request('/api/login-status',undefined,{origin:'https://foreign.example'})).status,403);
  for(const payload of [{browserId:'/bin/sh'},{browserId:[]},{mode:'unknown'}])assert.equal((await request('/api/login',payload)).status,400);
  assert.equal((await request('/api/login/cancel',{}, {origin:'https://foreign.example'})).status,403);
  assert.equal((await request('/api/login',{browserId:'chrome'})).status,200);let status=await terminal();assert.equal(status.state,'success');assert.equal(status.updated,false);assert.equal(rows.length,1);assert.equal(submits,1);
  await request('/api/alias',{id:'FIXTURE_ID',alias:'保留备注'});
  await request('/api/login',{});status=await terminal();assert.equal(status.updated,true);assert.equal(status.accountName,'保留备注');assert.equal(rows.length,1);assert.equal(submits,2);assert.equal(rows[0].enabled,false);
  broken=true;await request('/api/login',{});status=await terminal();assert.equal(status.state,'error');assert.equal(submits,3);assert.equal(closeCount,3);
  assert.equal((await request('/api/login/cancel',{})).status,200);
 }finally{await panel.dispose();await close(panel.server);await close(mock);await rm(root,{recursive:true,force:true});}
});

test('Key 管理 HTTP 路由：来源校验、固定范围、按需复制与默认 Key 保护',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-key-api-')),management='dw-admin-'+'5'.repeat(64),model='sk-local-'+'6'.repeat(48);
 await writeFile(join(root,'panel-management.key'),management);await writeFile(join(root,'probe-model.key'),model);
 const rows=[{id:'base',name:'默认 Key',key:model,enabled:true,allowedProviders:['doubaowork'],allowedModels:[]}];let posts=0;
 const mock=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+management){res.writeHead(401);return res.end();}
  let value;
  if(req.url==='/api/keys'&&req.method==='GET')value={keys:rows};
  else if(req.url==='/api/keys'&&req.method==='POST'){
   let text='';for await(const c of req)text+=c;const data=JSON.parse(text);assert.deepEqual(data.allowedProviders,['doubaowork']);
   posts++;const created={...data,id:'generated',enabled:true,createdAt:Date.now()};rows.push(created);value={created,keys:rows};
  }else if(req.url==='/api/keys/generated'&&req.method==='PATCH'){
   let text='';for await(const c of req)text+=c;Object.assign(rows[1],JSON.parse(text));value={keys:rows};
  }else{res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:value}));
 });
 const upstreamPort=await makePort(mock),probe=createServer(),port=await makePort(probe);await close(probe);
 const panel=await createPanel({dir:root,upstreamPort,port,timer:false});panel.server.listen(port,'127.0.0.1');await once(panel.server,'listening');
 const origin='http://127.0.0.1:'+port;
 const request=(path,data,headers={})=>fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{'x-doubao-panel':'1',...(data===undefined?{}:{origin,'content-type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
 try{
  assert.equal((await fetch(origin+'/api/keys')).status,403);
  for(const route of ['/api/keys/create','/api/keys/update','/api/keys/reveal']){
   assert.equal((await request(route,{}, {origin:'https://foreign.example'})).status,403);
   assert.equal((await request(route,{}, {'sec-fetch-site':'cross-site'})).status,403);
  }
  const initial=await(await request('/api/keys')).json();assert.equal(initial.keys.length,1);assert(!JSON.stringify(initial).includes(model));
  const payload={name:'集成测试',requestId:'fixture-create-request-01'};
  const a=await(await request('/api/keys/create',payload)).json();assert.equal(a.created.name,payload.name);assert.equal(posts,1);assert(!JSON.stringify(a).includes(rows[1].key));
  const copy=await request('/api/keys/reveal',{id:a.created.id});assert.equal(copy.headers.get('cache-control'),'no-store');assert.deepEqual(await copy.json(),{key:rows[1].key});
  await request('/api/keys/create',payload);assert.equal(posts,1);
  assert.equal((await request('/api/keys/update',{id:'generated',enabled:false})).status,200);assert.equal(rows[1].enabled,false);
  assert.equal((await request('/api/keys/update',{id:'base',enabled:false})).status,409);
  assert.equal((await request('/api/keys/create',{...payload,allowedProviders:[]})).status,400);
  assert.equal((await request('/api/keys/reveal',{id:'missing'})).status,404);
 }finally{await panel.dispose();await close(panel.server);await close(mock);await rm(root,{recursive:true,force:true});}
});
