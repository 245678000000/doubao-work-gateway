import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startGateway,requestControl} from '../launcher.mjs';
const freePort=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
test('统一启动：单进程模型 API、面板与认证停止，无外部核心',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-launch-'));let gateway;
 try{
  const corePort=await freePort(),panelPort=await freePort();
  gateway=await startGateway({env:{...process.env,DW_RUNTIME_ROOT:root,DW_UPSTREAM_PORT:String(corePort),DW_PANEL_PORT:String(panelPort)},log:()=>{}});
  const r=await fetch('http://127.0.0.1:'+panelPort+'/api/snapshot',{headers:{'X-Doubao-Panel':'1'}});assert.equal(r.status,200);assert.equal((await r.json()).accounts.length,0);
  assert.equal((await requestControl(gateway.paths,'status')).backend,'native');
  await assert.rejects(requestControl(gateway.paths,'stop','WRONG_TOKEN'));
  assert.equal((await requestControl(gateway.paths,'status')).backend,'native');
  assert.equal((await requestControl(gateway.paths,'stop')).ok,true);await gateway.closed;await assert.rejects(access(join(root,'state','launcher.lock')));await assert.rejects(fetch('http://127.0.0.1:'+panelPort+'/'));
 }finally{await gateway?.stop();await rm(root,{recursive:true,force:true});}
});
test('端口冲突时不启动或停止其他服务，失败后释放自己的锁',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-port-')),foreign=createServer();foreign.listen(0,'127.0.0.1');await once(foreign,'listening');
 try{const p=foreign.address().port;await assert.rejects(startGateway({env:{...process.env,DW_RUNTIME_ROOT:root,DW_UPSTREAM_PORT:String(p),DW_PANEL_PORT:String(await freePort())},log:()=>{}}),/已被占用/);assert(foreign.listening);await assert.rejects(access(join(root,'state','launcher.lock')));}finally{await new Promise(r=>foreign.close(r));await rm(root,{recursive:true,force:true});}
});
