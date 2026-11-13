// Run on the desktop login computer. Never prints account credentials.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {resolveRuntime} from './platform.mjs';
import {assertPrivate} from './private-files.mjs';
import {createCloudSync} from './cloud-sync.mjs';
try{
 const paths=await resolveRuntime(),keyPath=join(paths.state,'panel-management.key');await assertPrivate(keyPath);
 const admin=(await readFile(keyPath,'utf8')).trim();if(!/^dw-admin-[a-f0-9]{64}$/.test(admin))throw Error('本机管理凭据格式异常。');
 const port=Number(process.env.DW_UPSTREAM_PORT||43861);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('本机核心端口配置异常。');
 const sync=createCloudSync({configPath:resolve(process.env.DW_CLOUD_CONFIG||join(paths.project,'.cloud-target.json')),request:async path=>{
  let r;try{r=await fetch('http://127.0.0.1:'+port+path,{headers:{Authorization:'Bearer '+admin},redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw Error('本机核心暂未连接，请先启动项目。');}
  if(!r.ok)throw Error('本机账号读取未成功。');const value=await r.json();if(value.success===false)throw Error('本机账号读取未成功。');return value.data||value;
 }});
 const result=await sync.sync();console.log('云端同步完成：新增 '+result.added+'，更新 '+result.updated+'。');
}catch(error){console.error(error.code==='ENOENT'?'请先配置私有云端连接，并启动本机管理台。':error.message||'同步结果待核对，请检查两端账号列表。');process.exitCode=1;}
