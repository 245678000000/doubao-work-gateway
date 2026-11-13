import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPanel} from '../server.mjs';
const port=async s=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port;},close=s=>new Promise(r=>s.close(r));
test('管理 HTTP：备份显式确认、JSON 预览后导入、节点掩码和批量范围约束',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-manage-'));await writeFile(join(root,'panel-management.key'),'dw-admin-'+'b'.repeat(64));await writeFile(join(root,'probe-model.key'),'sk-local-'+'c'.repeat(48));
 const row={id:'A',name:'测试账号',provider:'doubaowork',enabled:true,hasCredentials:true,desktop:false,pluginIdentity:'fixture:A',pluginSecret:{cookieHeader:'sessionid=FIXTURE_SECRET'}};let patches=0,imports=0;
 const mock=createServer(async(req,res)=>{let value;
  if(req.url==='/api/accounts/export')value={accounts:[row]};
  else if(req.url==='/api/accounts/import'){imports++;value={total:1,added:1,updated:0,skipped:0,failed:0};}
  else if(req.url==='/api/accounts/A'&&req.method==='PATCH'){patches++;value={ok:true};}
  else if(req.url==='/api/accounts')value={accounts:[row,{id:'OTHER',provider:'other',enabled:true,hasCredentials:true}]};
  else{res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,data:value}));
 });
 const upstreamPort=await port(mock),probe=createServer(),p=await port(probe);await close(probe);
 const panel=await createPanel({dir:root,upstreamPort,port:p,timer:false});panel.server.listen(p,'127.0.0.1');await once(panel.server,'listening');const origin='http://127.0.0.1:'+p;
 const req=(path,data,headers={})=>fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{'X-Doubao-Panel':'1',...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
 try{
  assert.equal((await req('/api/backup/export',{ids:['A']})).status,400);
  const exported=await req('/api/backup/export',{ids:['A'],confirmSecrets:true});assert.equal(exported.status,200);assert.equal(exported.headers.get('cache-control'),'no-store');assert.equal((await exported.json()).accounts[0].id,'A');
  assert.equal((await req('/api/backup/preview',{version:2,accounts:[row]},{Origin:'https://foreign.test'})).status,403);
  const preview=await(await req('/api/backup/preview',{version:2,accounts:[{...row,id:'B',pluginIdentity:'fixture:B'}]})).json();assert.equal(preview.total,1);assert(!JSON.stringify(preview).includes('FIXTURE_SECRET'));assert.equal(imports,0);
  assert.equal((await req('/api/backup/import',{token:preview.token,duplicates:'skip'})).status,200);assert.equal(imports,1);
  assert.equal((await req('/api/accounts/batch',{ids:['OTHER'],action:'pause'})).status,404);assert.equal(patches,0);
  assert.equal((await req('/api/accounts/batch',{ids:['A'],action:'pause'})).status,200);assert.equal(patches,1);
  const n=await(await req('/api/nodes/preview',{nodes:[{name:'测试节点',baseUrl:'https://example.test/v1',apiKey:'sk-FIXTURE_KEY'}]})).json();assert(!JSON.stringify(n).includes('sk-FIXTURE_KEY'));assert.equal((await req('/api/nodes/import',{token:n.token})).status,200);
  assert(!JSON.stringify(await(await req('/api/nodes')).json()).includes('sk-FIXTURE_KEY'));
  assert.equal((await req('/api/nodes/export',{includeKeys:true})).status,400);assert(!JSON.stringify(await(await req('/api/nodes/export',{})).json()).includes('sk-FIXTURE_KEY'));
 }finally{await panel.dispose();await close(panel.server);await close(mock);await rm(root,{recursive:true,force:true});}
});
