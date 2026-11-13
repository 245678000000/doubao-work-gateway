import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startNative} from '../native/gateway.mjs';

test('独立双端口：验证暂停持久化、明确复测、不接力；API Key 不具备管理权限',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dw-native-'));
 let app,calls=[],challenged=true;
 const client={
  identity:async s=>({identity:s.cookieHeader.endsWith('alpha')?'alpha':'bravo',name:'测试账号'}),
  models:async()=>['test-model'],
  async *chat(s){calls.push(s.cookieHeader);if(challenged)throw {upstream_code:710022004};yield {content:'测试通过'};}
 };
 t.after(async()=>{await app?.stop();await rm(root,{recursive:true,force:true});});
 const start=()=>startNative({dir:root,modelPort:0,panelPort:0,client,timer:false});
 app=await start();
 const panel=(path,body)=>fetch(app.panelOrigin+path,{method:body===undefined?'GET':'POST',headers:{'X-Doubao-Panel':'1',...(body===undefined?{}:{Origin:app.panelOrigin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
 const key=(await (await panel('/api/key',{})).json()).key;
 assert.equal((await fetch(app.modelOrigin+'/api/key',{headers:{Authorization:'Bearer '+key}})).status,404);
 const a=await app.services.importCookies({cookieHeader:'sessionid=alpha'});
 const b=await app.services.importCookies({cookieHeader:'sessionid=bravo'});
 const ask=(stream=false)=>fetch(app.modelOrigin+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'test-model',messages:[{role:'user',content:'ping'}],stream})});
 const first=await ask();
 assert.equal(first.status,429);
 assert.equal((await first.json()).error.code,710022004);
 assert.deepEqual(calls,['sessionid=alpha']);
 let state=(await (await panel('/api/snapshot')).json()).accounts;
 assert.equal(state.find(x=>x.id===a.id).state,'needs_verification');
 assert.equal(state.find(x=>x.id===b.id).state,'ready');
 assert(!JSON.stringify(state).includes('sessionid'));
 await app.stop();app=await start();
 assert.equal((await (await panel('/api/snapshot')).json()).accounts.find(x=>x.id===a.id).state,'needs_verification');
 assert.equal((await panel('/api/verification/restore',{id:a.id,confirmed:false})).status,400);
 assert.equal((await panel('/api/verification/restore',{id:a.id,confirmed:true})).status,200);
 challenged=false;
 assert.equal((await ask()).status,200);
 assert.deepEqual(calls,['sessionid=alpha','sessionid=bravo']);
 const retest=await panel('/api/verification/retest',{id:a.id,model:'test-model'});
 assert.equal(retest.status,200);
 assert.deepEqual(calls,['sessionid=alpha','sessionid=bravo','sessionid=alpha']);
 assert.equal((await panel('/api/verification/retest',{id:a.id,model:'test-model'})).status,409);
 const stream=await ask(true);
 assert.match(await stream.text(),/data: \[DONE\]/);
});

test('流中触发验证：返回错误事件，不发送 DONE；该账号立即停止选路',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dw-native-stream-'));
 let calls=0;
 const app=await startNative({dir:root,modelPort:0,panelPort:0,timer:false,client:{
  identity:async()=>({identity:'fixture:stream',name:'测试'}),models:async()=>['fixture'],
  async *chat(){calls++;yield {content:'partial'};throw {code:0,error:{code:710022004}};},
 }});
 t.after(async()=>{await app.stop();await rm(root,{recursive:true,force:true});});
 const {id}=await app.services.importCookies({cookieHeader:'sessionid=fixture'});
 const ask=()=>fetch(app.modelOrigin+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+app.services.keys.defaultKey(),'Content-Type':'application/json'},body:JSON.stringify({model:'fixture',stream:true,messages:[{role:'user',content:'ping'}]})});
 const r=await ask();assert.equal(r.status,200);
 const text=await r.text();assert.match(text,/partial/);assert.match(text,/event: error/);assert.match(text,/710022004/);assert(!text.includes('[DONE]'));
 assert.equal(app.services.snapshot().accounts.find(a=>a.id===id).state,'needs_verification');
 assert.equal((await ask()).status,429);assert.equal(calls,1);
});
