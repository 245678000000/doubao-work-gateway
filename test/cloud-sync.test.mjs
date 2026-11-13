import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writePrivate,securePrivate} from '../private-files.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createCloudSync} from '../cloud-sync.mjs';
const target={origin:'https://cloud.example.test:13443',user:'fixture',password:'FIXTURE_PASSWORD'};
const rows=[{id:'A',provider:'doubaowork',pluginSecret:{cookies:'FIXTURE_COOKIE'}},{id:'B',provider:'doubaowork'},{id:'C',provider:'other'},{id:'D',provider:'doubaowork',desktop:true}];
async function setup(fetchImpl=async()=>({ok:true,json:async()=>({added:1,updated:0,skipped:0,failed:0})})){
 const dir=await mkdtemp(join(tmpdir(),'dw-sync-')),configPath=join(dir,'config.json');
 await writePrivate(configPath,JSON.stringify(target));
 return {configPath,sync:createCloudSync({configPath,request:async p=>{assert.equal(p,'/api/accounts/export');return {accounts:rows};},fetchImpl}),done:()=>rm(dir,{recursive:true,force:true})};
}
test('云端私有配置只暴露目标地址，拒绝明文、带路径与开放权限',async()=>{
 const f=await setup();try{
  assert.deepEqual(await f.sync.status(),{configured:true,origin:target.origin});
  assert(!JSON.stringify(await f.sync.status()).includes(target.password));
  for(const patch of [{origin:'http://cloud.example.test'},{origin:target.origin+'/'},{origin:target.origin+'/path'},{origin:target.origin+'?x=1'},{user:'bad:name'},{password:'bad\nvalue'}]){
   await writeFile(f.configPath,JSON.stringify({...target,...patch}));assert.equal((await f.sync.status()).configured,false);
   await assert.rejects(f.sync.sync(),e=>e.status===409);
  }
  await writeFile(f.configPath,JSON.stringify(target));if(process.platform==='win32')await promisify(execFile)('icacls.exe',[f.configPath,'/grant','*S-1-1-0:R'],{windowsHide:true});else await chmod(f.configPath,0o644);assert.equal((await f.sync.status()).configured,false);
 }finally{await f.done();}
});
test('自动同步仅提交选中豆包账号，HTTPS 认证、不跟随重定向、脱敏返回',async()=>{
 let submits=0;const f=await setup(async(url,options)=>{
  submits++;assert.equal(url,target.origin+'/api/accounts/import');assert.equal(options.redirect,'error');assert.equal(options.headers.Origin,target.origin);assert.equal(options.headers['X-Doubao-Panel'],'1');
  assert.equal(options.headers.Authorization,'Basic '+Buffer.from(target.user+':'+target.password).toString('base64'));
  assert.deepEqual(JSON.parse(options.body),{version:2,accounts:[rows[0]]});
  return {ok:true,json:async()=>({added:1,updated:0,skipped:0,failed:0,secret:'FIXTURE_COOKIE'})};
 });try{
  const result=await f.sync.sync(['A']);assert.deepEqual(result,{origin:target.origin,added:1,updated:0});assert.equal(submits,1);
  for(const ids of [['C'],['D'],['missing'],['A','missing']])await assert.rejects(f.sync.sync(ids),e=>e.status===409);
  assert.equal(submits,1);
 }finally{await f.done();}
});
test('同步现有账号过滤其他提供商；未知结果不重试、不回显远端详情',async()=>{
 let count=0;const f=await setup(async(_url,o)=>{count++;assert.deepEqual(JSON.parse(o.body).accounts,rows.slice(0,2));throw Error('FIXTURE_PASSWORD');});
 try{await assert.rejects(f.sync.sync(),e=>e.status===502&&!e.message.includes('FIXTURE_PASSWORD'));assert.equal(count,1);}finally{await f.done();}
 for(const result of [{added:0,updated:0,failed:0,skipped:0},{added:1,updated:0,failed:1,skipped:0},{added:1,updated:0,failed:0,skipped:1}]){
  const g=await setup(async()=>({ok:true,json:async()=>result}));try{await assert.rejects(g.sync.sync(['A']),e=>e.status===502);}finally{await g.done();}
 }
});
test('同步互斥，完成后释放；无重复自动提交',async()=>{
 let release,started;const gate=new Promise(r=>release=r),began=new Promise(r=>started=r);let submits=0;
 const f=await setup(async()=>{submits++;started();await gate;return {ok:true,json:async()=>({added:1,updated:0,failed:0,skipped:0})};});
 try{const p=f.sync.sync(['A']);await began;await assert.rejects(f.sync.sync(['A']),e=>e.status===409);release();await p;assert.equal(submits,1);await f.sync.sync(['A']);assert.equal(submits,2);}finally{release();await f.done();}
});
