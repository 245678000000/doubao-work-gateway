import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveRuntime,coreCandidates,browserCandidates} from '../platform.mjs';
test('跨平台候选路径：Mac 应用包、Windows server、Linux server 与独立浏览器',()=>{
 assert(coreCandidates('/runtime','darwin').some(p=>p.endsWith('Agent2API.app/Contents/MacOS/agent2api')));
 assert(coreCandidates('C:\\runtime','win32').includes('C:\\runtime\\agent2api-server.exe'));
 assert(coreCandidates('/runtime','linux').includes('/runtime/agent2api-server'));
 const win=browserCandidates('win32','C:\\Users\\Tester',{'PROGRAMFILES':'C:\\Program Files','LOCALAPPDATA':'C:\\Users\\Tester\\AppData\\Local'});
 assert(win.some(b=>b.id==='chrome'&&b.path==='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
 assert(win.some(b=>b.id==='edge'&&b.path.endsWith('msedge.exe')));
 assert(browserCandidates('linux','/home/test',{}).some(b=>b.path==='/usr/bin/google-chrome'));
});
test('统一运行目录保持旧提示和环境变量优先级，拒绝无效提示',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dw-platform-')),project=join(root,'project with spaces');await mkdir(project);
 try{assert.equal((await resolveRuntime({project,env:{}})).root,join(project,'.local'));
  await writeFile(join(project,'.runtime-root'),join(root,'existing')+'\n');assert.equal((await resolveRuntime({project,env:{}})).root,join(root,'existing'));
  assert.equal((await resolveRuntime({project,env:{DW_RUNTIME_ROOT:join(root,'override')}})).root,join(root,'override'));
  await writeFile(join(project,'.runtime-root'),'$(printf not-executed)');await assert.rejects(resolveRuntime({project,env:{}}));
 }finally{await rm(root,{recursive:true,force:true});}
});
