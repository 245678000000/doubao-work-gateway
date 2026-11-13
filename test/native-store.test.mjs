import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../native/store.mjs';
test('独立加密存储：私有会话不落明文，重启保留账号，认证失败不清空',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dw-native-store-'));let store;
 try{store=await openStore({dir});await store.mutate(s=>s.accounts.push({id:'A',state:'ready',session:{cookies:[{name:'sessionid',value:'FIXTURE_COOKIE_SECRET'}]}}));
  const path=join(dir,'native-vault.json'),text=await readFile(path,'utf8');assert(!text.includes('FIXTURE_COOKIE_SECRET'));assert(!text.includes('sessionid'));await store.close();
  store=await openStore({dir});assert.equal(store.snapshot().accounts[0].state,'ready');assert.equal(store.snapshot().accounts[0].session.cookies[0].value,'FIXTURE_COOKIE_SECRET');await store.close();
  const data=JSON.parse(text);data.tag=Buffer.alloc(16).toString('base64');await writeFile(path,JSON.stringify(data));await assert.rejects(openStore({dir}),/认证|损坏/);assert.equal(JSON.parse(await readFile(path,'utf8')).tag,data.tag);
 }finally{await store?.close();await rm(dir,{recursive:true,force:true});}
});
