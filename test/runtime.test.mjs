import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const canRun=spawnSync('zsh',['-c','true']).status===0;
async function fixture(fn){
 const root=await realpath(await mkdtemp(join(tmpdir(),'dw-paths-')));const project=join(root,'project with spaces');
 const {mkdir}=await import('node:fs/promises');await mkdir(project);
 await copyFile(new URL('../runtime-env.zsh',import.meta.url),join(project,'runtime-env.zsh'));
 const run=(override)=>{const env={...process.env,PROJECT:project};delete env.DW_RUNTIME_ROOT;if(override!==undefined)env.DW_RUNTIME_ROOT=override;
  return spawnSync('zsh',['-c','set -eu; source "$PROJECT/runtime-env.zsh"; print -r -- "$PROBE"'],{env,encoding:'utf8',cwd:root});};
 try{await fn({root,project,run});}finally{await rm(root,{recursive:true,force:true});}
}
test('全新检出默认使用项目内 .local，路径含空格仍可用',{skip:!canRun},()=>fixture(async({project,run})=>{
 const result=run();assert.equal(result.status,0);assert.equal(result.stdout.trim(),join(project,'.local'));
}));
test('本机迁移提示与显式环境变量保持原账号运行目录',{skip:!canRun},()=>fixture(async({root,project,run})=>{
 const migrated=join(root,'existing runtime');await writeFile(join(project,'.runtime-root'),migrated+'\n');
 assert.equal(run().stdout.trim(),migrated);assert.equal(run(join(root,'override')).stdout.trim(),join(root,'override'));
 assert.equal(run('relative-runtime').stdout.trim(),join(root,'relative-runtime'));
}));
test('无效迁移提示停止启动，不解释提示文件为 shell 代码',{skip:!canRun},()=>fixture(async({project,run})=>{
 await writeFile(join(project,'.runtime-root'),'relative/path\n');assert.notEqual(run().status,0);
 await writeFile(join(project,'.runtime-root'),'$(printf not-executed)\n');assert.notEqual(run().status,0);
}));
