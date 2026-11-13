import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNativeServices} from '../native/services.mjs';
import {openStore} from '../native/store.mjs';

test('签到不重领：先持久预约，超时重启后自动跳过，手动回查只读',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'dw-scheduler-'));
 let store,svc,queries=0,claims=0;
 t.after(async()=>{await store?.close();await rm(dir,{recursive:true,force:true});});
 const now=()=>Date.parse('2026-11-13T10:00:00+08:00');
 const client={identity:async()=>({identity:'fixture',name:'示例'}),models:async()=>['fixture'],
  async checkin(_s,{queryOnly,reserve}){
   queries++;
   if(queryOnly)return {status:'pending'};
   await reserve();claims++;throw Error('fixture timeout');
  }};
 const open=async()=>{store=await openStore({dir});svc=await createNativeServices({store,client,now});};
 await open();
 const {id}=await svc.importCookies({cookieHeader:'sessionid=FIXTURE_ONLY'});
 await svc.changeAccounts([id],{auto:true});
 await svc.setSchedule({enabled:true,time:'09:30'});
 await svc.tick();
 assert.equal(claims,1);assert.equal(queries,1);
 assert.equal(svc.snapshot().accounts[0].attempt,'unknown');
 await store.close();await open();
 await svc.tick();
 assert.equal(queries,1);
 assert.equal((await svc.checkin(id)).status,'pending');
 assert.equal(queries,2);assert.equal(claims,1);
});
