import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertPrivate,ensurePrivateDir} from '../private-files.mjs';
import {createNodeProfiles} from '../nodes.mjs';
test('接口节点 JSON 先预览后导入，列表掩码、默认导出不携带 Key',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-nodes-'));try{
  await ensurePrivateDir(root);const path=join(root,'nodes.json'),nodes=await createNodeProfiles({path});
  const p=await nodes.preview({schema:'doubao-work-nodes/v1',nodes:[{name:'新加坡豆包',baseUrl:'https://example.test:13443/v1/',apiKey:'sk-FIXTURE_KEY',models:['flash']}]});
  assert.equal(p.total,1);assert(!JSON.stringify(p).includes('sk-FIXTURE_KEY'));assert.equal((await nodes.list()).nodes.length,0);
  const result=await nodes.commit(p.token);assert.equal(result.added,1);const list=await nodes.list();assert.equal(list.nodes[0].baseUrl,'https://example.test:13443/v1');assert(!JSON.stringify(list).includes('sk-FIXTURE_KEY'));await assertPrivate(path);if(process.platform!=='win32')assert.equal((await stat(path)).mode&0o777,0o600);
  assert.equal((await nodes.export({})).nodes[0].apiKey,undefined);assert.equal((await nodes.export({includeKeys:true})).nodes[0].apiKey,'sk-FIXTURE_KEY');
  const again=await createNodeProfiles({path});assert.equal((await again.list()).nodes.length,1);assert(!JSON.stringify(await again.list()).includes('sk-FIXTURE_KEY'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('无 Key 的节点文件更新时保留原 Key；非法地址和错类文件不写入',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-nodes-'));try{
  await ensurePrivateDir(root);const path=join(root,'nodes.json'),nodes=await createNodeProfiles({path});
  const p=await nodes.preview({nodes:[{name:'本机',baseUrl:'http://127.0.0.1:43861/v1',apiKey:'sk-KEEP_KEY',models:['flash']}]});await nodes.commit(p.token);
  const exported=await nodes.export({}),again=await nodes.preview(exported);assert.equal(again.duplicates,1);await nodes.commit(again.token);assert.equal((await nodes.export({includeKeys:true})).nodes[0].apiKey,'sk-KEEP_KEY');
  const before=await readFile(path,'utf8');
  for(const data of [{schema:'doubao-work-accounts/v1',version:2,accounts:[]},{nodes:[{name:'远端',baseUrl:'http://example.test/v1'}]},{nodes:[{name:'带凭据',baseUrl:'https://a:b@example.test/v1'}]},{nodes:[{name:'查询',baseUrl:'https://example.test/v1?key=secret'}]},{nodes:[{name:'换行',baseUrl:'https://example.test/v1',apiKey:'bad\nkey'}]}])await assert.rejects(nodes.preview(data),e=>e.status===400);
  assert.equal(await readFile(path,'utf8'),before);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('损坏的节点配置停止读取，不静默清空已有文件',async()=>{
 const {writeFile}=await import('node:fs/promises'),root=await mkdtemp(join(tmpdir(),'dw-nodes-bad-'));try{const path=join(root,'nodes.json');await writeFile(path,'{}',{mode:0o600});await assert.rejects(createNodeProfiles({path}),e=>e.status===409);assert.equal(await readFile(path,'utf8'),'{}');}finally{await rm(root,{recursive:true,force:true});}
});
