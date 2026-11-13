import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountTransfer,parseAccountBackup} from '../transfers.mjs';
const account=(id,name='测试账号')=>({id,name,provider:'doubaowork',desktop:false,pluginIdentity:'fixture:'+id,pluginSecret:{cookieHeader:'sessionid=FIXTURE_SECRET'},proxy:null});
test('账号 JSON 先预览后提交，重复默认跳过，预览不回显登录凭据',async()=>{
 let imports=0;const f=createAccountTransfer({request:async(path,{body}={})=>{
  if(path==='/api/accounts/export')return {accounts:[account('A')]};
  assert.equal(path,'/api/accounts/import');imports++;assert.deepEqual(body.accounts.map(a=>a.id),['B']);return {total:1,added:1,updated:0,skipped:0,failed:0};
 }});
 const preview=await f.preview({version:2,accounts:[account('A'),account('B')]});
 assert.equal(preview.total,2);assert.equal(preview.duplicates,1);assert(!JSON.stringify(preview).includes('FIXTURE_SECRET'));assert.equal(imports,0);
 const result=await f.commit({token:preview.token,duplicates:'skip'});assert.equal(result.added,1);assert.equal(result.skipped,1);assert.equal(imports,1);
 await assert.rejects(f.commit({token:preview.token,duplicates:'skip'}),e=>e.status===409);
});
test('账号文件校验提供商、完整凭据、文件内重复和危险 JSON 字段',()=>{
 for(const value of [{version:1,accounts:[account('A')]},{version:2,accounts:[]},{version:2,accounts:[account('A'),account('A')]},{version:2,accounts:[{...account('A'),provider:'other'}]},{version:2,accounts:[{...account('A'),desktop:true}]},{version:2,accounts:[{...account('A'),pluginSecret:{}}]},JSON.parse('{"version":2,"accounts":[],"__proto__":{}}')])assert.throws(()=>parseAccountBackup(value),e=>e.status===400);
});
test('导出仅含选中豆包账号与登录快照，不迁移任意代理配置',async()=>{
 const f=createAccountTransfer({request:async()=>({accounts:[{...account('A'),proxy:{url:'http://foreign.test'},unexpected:'discard'},account('B'),{...account('C'),provider:'other'}]})});
 const result=await f.export(['A']);assert.equal(result.schema,'doubao-work-accounts/v1');assert.equal(result.accounts.length,1);assert.equal(result.accounts[0].pluginSecret.cookieHeader,'sessionid=FIXTURE_SECRET');assert.equal(result.accounts[0].proxy,null);assert.equal(result.accounts[0].unexpected,undefined);
 await assert.rejects(f.export(['missing']),e=>e.status===409);await assert.rejects(f.export(['A','A']),e=>e.status===400);
});
test('预览十分钟失效、重复策略提交时重新核对；未知结果只尝试一次',async()=>{
 let now=0,posts=0,existing=[];const f=createAccountTransfer({now:()=>now,request:async(path)=>{if(path.endsWith('/export'))return {accounts:existing};posts++;throw Error('FIXTURE_SECRET');}});
 const a=await f.preview({version:2,accounts:[account('A')]});now=600001;await assert.rejects(f.commit({token:a.token,duplicates:'update'}),e=>e.status===409);assert.equal(posts,0);
 const b=await f.preview({version:2,accounts:[account('A')]});existing=[account('A')];assert.equal((await f.commit({token:b.token,duplicates:'skip'})).skipped,1);assert.equal(posts,0);
 const c=await f.preview({version:2,accounts:[account('A')]});await assert.rejects(f.commit({token:c.token,duplicates:'update'}),e=>e.status===502&&!e.message.includes('FIXTURE_SECRET'));assert.equal(posts,1);await assert.rejects(f.commit({token:c.token,duplicates:'update'}),e=>e.status===409);assert.equal(posts,1);
});
test('导入账号标识与其他提供商冲突时停止，不覆盖其他账号',async()=>{
 const f=createAccountTransfer({request:async()=>({accounts:[{...account('A'),provider:'other'}]})});
 await assert.rejects(f.preview({version:2,accounts:[account('A')]}),e=>e.status===409);
});
