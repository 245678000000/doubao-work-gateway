import {createServer,createConnection} from 'node:net';
import {readFile,unlink,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {resolveRuntime} from './platform.mjs';
import {ensurePrivateDir,securePrivate,writePrivate,assertPrivate} from './private-files.mjs';
import {availableBrowsers} from './browser-login.mjs';
import {same} from './core.mjs';
import {startNative} from './native/gateway.mjs';

const loopback='127.0.0.1';
const freshNonce=()=>randomBytes(32).toString('hex');
function portValue(v,fallback){
 const n=v===undefined||v===''?fallback:Number(v);
 if(!Number.isInteger(n)||n<1024||n>65535)throw Error('端口请使用 1024–65535 之间的整数。');
 return n;
}
async function acquireLock(paths,nonce){
 const path=join(paths.state,'launcher.lock');
 try{await writePrivate(path,JSON.stringify({pid:process.pid,nonce,project:paths.project}));}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  await assertPrivate(path);
  const old=JSON.parse(await readFile(path,'utf8'));
  if(!Number.isInteger(old.pid)||old.pid<2||!old.nonce)throw Error('运行锁需核对，原文件保留。');
  let dead=false;try{process.kill(old.pid,0);}catch(error){if(error.code==='ESRCH')dead=true;else throw error;}
  if(!dead)throw Error('已有项目正在运行，请先正常停止。');
  // Never signal a PID or remove a lock whose owner changed.
  const current=JSON.parse(await readFile(path,'utf8'));
  if(current.nonce!==old.nonce)throw Error('运行锁已变化，请重试。');
  await unlink(path);return acquireLock(paths,nonce);
 }
 return async()=>{try{const old=JSON.parse(await readFile(path,'utf8'));if(old.nonce===nonce)await unlink(path);}catch{}};
}
async function secret(path,{optional=false}={}){
 try{
  const info=await lstat(path);if(info.size>4096)throw Error('凭据文件大小异常。');
  await assertPrivate(path);return (await readFile(path,'utf8')).trim();
 }catch(e){if(optional&&e.code==='ENOENT')return undefined;throw e;}
}
export async function startGateway({env=process.env,project,client,log=console.log}={}){
 if(Number(process.versions.node.split('.')[0])<22)throw Error('请先安装 Node.js 22 或更高版本。');
 const paths=await resolveRuntime({project,env});
 const modelPort=portValue(env.DW_UPSTREAM_PORT,43861),panelPort=portValue(env.DW_PANEL_PORT,43862);
 if(modelPort===panelPort)throw Error('模型 API 与面板端口需要不同。');
 await ensurePrivateDir(paths.state);await ensurePrivateDir(paths.tmp);
 const nonce=freshNonce(),release=await acquireLock(paths,nonce),meta=join(paths.state,'launcher-control.json');
 let app,control,metadataOwned=false,shutdown,resolveClosed;
 const closed=new Promise(r=>resolveClosed=r);
 async function stop(){
  if(shutdown)return shutdown;
  shutdown=(async()=>{
   let exitCode=0;
   try{control?.close();await app?.stop();}
   catch(e){exitCode=1;throw e;}
   finally{if(metadataOwned)await unlink(meta).catch(()=>{});await release();resolveClosed({exitCode});}
  })();return shutdown;
 }
 try{
  const proxyToken=env.DW_PROXY_TOKEN_FILE?await secret(resolve(env.DW_PROXY_TOKEN_FILE)):undefined;
  const bootstrapKey=await secret(join(paths.state,'probe-model.key'),{optional:true});
  const cloudConfigPath=resolve(env.DW_CLOUD_CONFIG||join(paths.project,'.cloud-target.json'));
  app=await startNative({dir:paths.state,tmpRoot:paths.tmp,modelPort,panelPort,client,publicOrigin:env.DW_PUBLIC_ORIGIN,
   proxyToken,bootstrapKey,cloudConfigPath});
  control=createServer(socket=>{
   socket.setTimeout(5000,()=>socket.destroy());
   let raw='';socket.on('error',()=>{});
   socket.on('data',async chunk=>{
    raw+=chunk.toString('utf8');if(raw.length>1024){socket.destroy();return;}
    if(!raw.includes('\n'))return;
    socket.removeAllListeners('data');socket.resume();
    const end=v=>socket.end(JSON.stringify(v)+'\n');
    let packet;
    try{packet=JSON.parse(raw);if(!same(packet.nonce,nonce)||!['status','stop'].includes(packet.action))throw Error();}
    catch{return end({error:'本机控制请求验证未通过。'});}
    if(packet.action==='status')return end({ok:true,state:'ready',backend:'native',url:app.panelOrigin,api:app.modelOrigin+'/v1'});
    socket.setTimeout(20000,()=>socket.destroy());
    try{await stop();end({ok:true});}catch{end({error:'网关停止结果待核对。'});}
   });
  });
  await new Promise((ok,bad)=>{control.once('error',bad);control.listen(0,loopback,()=>{control.removeListener('error',bad);ok();});});
  await unlink(meta).catch(e=>{if(e.code!=='ENOENT')throw e;});
  await writePrivate(meta,JSON.stringify({version:1,project:paths.project,port:control.address().port,nonce}));metadataOwned=true;
  log('豆包工作 · 独立网关：'+app.panelOrigin);
  log('模型 API：'+app.modelOrigin+'/v1 · Ctrl+C 或 npm stop 停止');
  return {...app,paths,closed,stop};
 }catch(e){await stop().catch(()=>{});if(e.code==='EADDRINUSE')throw Error('所选端口已被占用，现有服务未操作。');throw e;}
}
export async function requestControl(paths,action,overrideNonce){
 const file=join(paths.state,'launcher-control.json');await assertPrivate(file);
 const meta=JSON.parse(await readFile(file,'utf8'));
 if(meta.project!==paths.project||meta.version!==1||!Number.isInteger(meta.port)||meta.port<1024||meta.port>65535||!(/^[a-f0-9]{64}$/).test(meta.nonce))throw Error('运行控制记录不属于当前项目。');
 return new Promise((ok,bad)=>{
  const s=createConnection({host:loopback,port:meta.port});
  let raw='';s.setTimeout(25000,()=>s.destroy(Error('本机控制连接超时。')));
  s.on('error',()=>bad(Error('本机控制连接未完成，请检查启动终端。')));
  s.on('connect',()=>s.write(JSON.stringify({action,nonce:overrideNonce??meta.nonce})+'\n'));
  s.on('data',c=>{raw+=c;if(raw.length>4096)s.destroy(Error('本机控制响应过大。'));});
  s.on('end',()=>{try{const r=JSON.parse(raw);if(!r.ok)throw Error(r.error||'本机控制请求未完成。');ok(r);}catch(e){bad(e);}});
 });
}
async function main(){
 const action=process.argv[2]||'start',paths=await resolveRuntime();
 if(action==='migrate-legacy'){
  const {readLegacyAccounts}=await import('./native/migration.mjs');
  const {openStore}=await import('./native/store.mjs');
  const {createNativeServices}=await import('./native/services.mjs');
  const src=resolve(process.argv[3]||paths.state);
  await ensurePrivateDir(paths.state);
  const release=await acquireLock(paths,freshNonce());
  let vault;
  try{
   const data=await readLegacyAccounts({dir:src});
   const bootstrapKey=await secret(join(src,'probe-model.key'),{optional:true});
   vault=await openStore({dir:paths.state});
   const services=await createNativeServices({store:vault,client:{},bootstrapKey});
   console.log(JSON.stringify(await services.migrateLegacy(data)));
  }finally{try{await vault?.close();}finally{await release();}}
  return;
 }
 if(action==='doctor'){
  console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node,state:paths.state,backend:'native',browsers:(await availableBrowsers()).map(x=>x.name)},null,2));return;
 }
 if(action==='secure-cloud'){
  const file=resolve(process.env.DW_CLOUD_CONFIG||join(paths.project,'.cloud-target.json'));
  await securePrivate(file);await assertPrivate(file);console.log('本机云端连接配置已设为私有。');return;
 }
 if(['stop','status'].includes(action)){
  try{console.log(JSON.stringify(await requestControl(paths,action)));}
  catch(e){if(e.code==='ENOENT')console.log('当前没有本项目的运行记录。');else throw e;}return;
 }
 if(action!=='start')throw Error('请选择 start、stop、status 或 doctor。');
 const app=await startGateway();
 for(const name of ['SIGINT','SIGTERM','SIGHUP'])process.once(name,()=>{void app.stop().catch(()=>{process.exitCode=1;});});
 process.exitCode=(await app.closed).exitCode;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(e=>{console.error(e.message||'启动未完成。');process.exitCode=1;});
