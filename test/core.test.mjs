import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dayTime, dueAccounts, viewAccounts, checkinView, emptySettings, atomic, readSettings,same} from '../core.mjs';

const rows = [
  {id:'A',provider:'doubaowork',name:'一号',available:true,enabled:true,cookie:'hidden'},
  {id:'B',provider:'doubaowork',name:'二号',available:true,enabled:true},
  {id:'C',provider:'other',name:'其它',available:true,enabled:true},
  {id:'D',provider:'doubaowork',name:'停用',available:true,enabled:false},
  {id:'E',provider:'doubaowork',name:'已签',available:true,enabled:true,checkedInToday:true},
];
test('北京时间跨日',()=>assert.deepEqual(dayTime(new Date('2026-11-13T16:05:00Z')),{day:'2026-11-14',time:'00:05'}));
test('只返回豆包账号且不外泄凭据',()=>{
 const v=viewAccounts(rows,emptySettings(),[]);
 assert.deepEqual(v.map(x=>x.id),['A','B','D','E']);
 assert(!JSON.stringify(v).includes('hidden'));
});
test('定时仅对已勾选、有效、尚未尝试账号生效',()=>{
 const s={...emptySettings(),enabled:true,time:'09:30',accounts:{A:true,C:true,D:true,E:true}};
 const v=viewAccounts(rows,s,[]);
 const at=new Date('2026-11-13T01:30:00Z');
 assert.deepEqual(dueAccounts(s,v,at).map(a=>a.id),['A']);
 assert.deepEqual(dueAccounts(s,v,new Date(at-60_000)),[]);
 s.attempted.A={day:'2026-11-13',status:'submitting'};
 assert.deepEqual(dueAccounts(s,v,at),[]);
 assert.equal(dueAccounts(s,v,new Date('2026-11-14T01:30:00Z')).length,1);
 s.enabled=false;
 assert.deepEqual(dueAccounts(s,v,at),[]);
});
test('已有、确认领取、待确认分别记录',()=>{
 for (const status of ['done','claimed','pending','inactive','captcha']) {
  assert.equal(checkinView({results:[{claim:{outcome:status}}]}).status,status);
 }
 assert.equal(checkinView({results:[{claim:{success:true}}]}).status,'error');
});
test('已尝试状态落盘跨重启，损坏时停止',async()=>{
 const d=await mkdtemp(join(tmpdir(),'doubao-test-'));
 try {
   const p=join(d,'state.json');
   assert.deepEqual(await readSettings(p),emptySettings());
   const s=emptySettings();
   s.attempted.A={day:'2026-11-13',status:'submitting'};
   await atomic(p,s);
   assert.deepEqual(await readSettings(p),s);
   await writeFile(p,'{}');
   await assert.rejects(()=>readSettings(p),/损坏/);
 } finally { await rm(d,{recursive:true,force:true}); }
});
test('密钥比较校验长度与内容',()=>{assert(same('abc','abc'));assert(!same('abc','abd'));assert(!same('a','你'));});

test('账号备注仅影响本机显示，不覆盖豆包原名称',()=>{
 const settings={...emptySettings(),aliases:{A:'日常使用'}};
 const view=viewAccounts(rows,settings,[]);
 assert.equal(view[0].name,'日常使用');assert.equal(view[0].sourceName,'一号');assert.equal(view[0].alias,'日常使用');
 assert.equal(view[1].name,'二号');assert.equal(view[1].alias,'');
});
test('旧版配置平滑升级，拒绝损坏的备注字段',async()=>{
 const d=await mkdtemp(join(tmpdir(),'doubao-alias-'));
 try{
  const p=join(d,'state.json'),old=emptySettings();delete old.aliases;await writeFile(p,JSON.stringify(old));
  assert.deepEqual((await readSettings(p)).aliases,{});
  for(const aliases of [[],null,{A:42},{A:'a'.repeat(33)}]){
   await writeFile(p,JSON.stringify({...old,aliases}));await assert.rejects(()=>readSettings(p),/损坏/);
  }
 }finally{await rm(d,{recursive:true,force:true});}
});
