import {createServer,createConnection} from 'node:net';
import {spawn,fork,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {access,readFile,unlink,open,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {resolveRuntime,coreCandidates,projectRoot} from './platform.mjs';
import {ensurePrivateDir,securePrivate,writePrivate,assertPrivate} from './private-files.mjs';
import {initModelKey} from './init-model-key.mjs';
import {availableBrowsers} from './browser-login.mjs';
const run=promisify(execFile),token=()=>randomBytes(32).toString('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const portValue=(value,fallback)=>{const n=Number(value||fallback);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('端口请使用 1024–65535 之间的整数。');return n;};
const exists=path=>access(path,process.platform==='win32'?constants.F_OK:constants.X_OK).then(()=>true,()=>false);
export async function findCore(paths,env=process.env){
 const candidates=env.DW_CORE_BIN?[resolve(env.DW_CORE_BIN)]:coreCandidates(paths.runtime);
 for(const path of candidates)if(await exists(path))return path;
 throw Error('缺少当前系统的转发核心。请按 README 准备匹配的 Agent2API 与提供商插件。');
}
async function free(port){await new Promise((ok,bad)=>{const s=createServer();s.once('error',()=>bad(Error('端口 '+port+' 已被占用；现有服务未操作。')));s.listen(port,'127.0.0.1',()=>s.close(ok));});}
async function acquireLock(paths,nonce){
 const path=join(paths.state,'launcher.lock');
 try{await writePrivate(path,JSON.stringify({pid:process.pid,nonce,project:paths.project}));}
 catch(e){if(e.code!=='EEXIST')throw e;let old;
  try{await assertPrivate(path);old=JSON.parse(await readFile(path,'utf8'));}catch{throw Error('运行锁记录待检查，请保留文件并确认是否已有项目启动。');}
  if(!Number.isInteger(old.pid)||old.pid<2||typeof old.nonce!=='string')throw Error('运行锁记录待检查。');
  try{process.kill(old.pid,0);}catch(error){if(error.code==='ESRCH'){await unlink(path);return acquireLock(paths,nonce);}}
  throw Error('已有项目正在运行或准备启动；请先正常停止原进程。');
 }
 return async()=>{try{const value=JSON.parse(await readFile(path,'utf8'));if(value.nonce===nonce)await unlink(path);}catch{}};
}
async function providerReady({paths,corePort,admin,packPath,signal}){
 const endpoint='http://127.0.0.1:'+corePort;
 const api=async(route,options={})=>{const r=await fetch(endpoint+route,{...options,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(options.body?45000:2000)]),headers:{Authorization:'Bearer '+admin,...options.headers}});if(!r.ok)throw Error('核心配置未完成。');const data=await r.json();if(data.success===false)throw Error('核心配置未完成。');return data.data||data;};
 let data;
 for(let i=0;i<60;i++){signal.throwIfAborted();try{data=await api('/api/plugins');break;}catch{}await sleep(250,undefined,{signal});}
 if(!data)throw Error('转发核心未就绪，请检查私有日志 gateway-core.log。');
 const ready=d=>d.packs?.some(p=>p.enabled&&p.host?.running&&p.providers?.some(v=>v.id==='doubaowork'&&v.enabled&&v.loaded));
 if(ready(data))return;
 if(data.packs?.some(p=>p.providers?.some(v=>v.id==='doubaowork')))throw Error('豆包工作插件已安装但尚未运行，请检查核心插件状态；未自动改动已有开关。');
 let info;try{info=await stat(packPath);}catch{throw Error('请将匹配系统的签名提供商 ZIP 放到运行目录 runtime/providers.zip，或设置 DW_PROVIDER_PACK。');}
 if(!info.isFile()||info.size>200*1024*1024)throw Error('提供商 ZIP 文件异常或超过 200 MB。');
 await api('/api/plugins/install',{method:'POST',headers:{'Content-Type':'application/zip'},body:await readFile(packPath)});
 for(let i=0;i<60;i++){if(ready(await api('/api/plugins')))return;await sleep(250,undefined,{signal});}
 throw Error('提供商安装后尚未就绪，请查看私有核心日志；不会连续重复安装。');
}
async function childStop(child,ipc=false){
 if(!child||child.exitCode!==null||child.signalCode)return;
 const exited=new Promise(r=>{child.once('exit',r);child.once('error',r);});
 if(ipc&&child.connected)try{child.send('doubao-work-shutdown',()=>{});}catch{}
 else child.kill('SIGTERM');
 await Promise.race([exited,sleep(ipc?7000:2500,undefined,{ref:false})]);
 if(child.exitCode===null&&!child.signalCode){child.kill('SIGKILL');await Promise.race([exited,sleep(1500,undefined,{ref:false})]);}
 if(child.exitCode===null&&!child.signalCode)throw Error('项目子进程仍在关闭，请核对运行终端。');
}
export async function startGateway({env=process.env,project=projectRoot,coreCommand,log=console.log}={}){
 const paths=await resolveRuntime({project,env}),corePort=portValue(env.DW_UPSTREAM_PORT,43861),panelPort=portValue(env.DW_PANEL_PORT,43862);
 if(corePort===panelPort)throw Error('核心与面板端口需分别设置。');
 if(Number(process.versions.node.split('.')[0])<22)throw Error('请先安装 Node.js 22 或更高版本。');
 const coreBinary=coreCommand?.path||await findCore(paths,env);
 await ensurePrivateDir(paths.state);await ensurePrivateDir(paths.tmp);
 const nonce=token(),release=await acquireLock(paths,nonce),metadata=join(paths.state,'launcher-control.json');
 let core,panel,control,coreLog,shutdownPromise,resolveClosed,exitCode=0;const abort=new AbortController();
 const closed=new Promise(r=>resolveClosed=r);
 async function stop(){if(shutdownPromise)return shutdownPromise;shutdownPromise=(async()=>{
  abort.abort();let issue;
  for(const [child,ipc] of [[panel,true],[core,false]])try{await childStop(child,ipc);}catch(error){issue=error;}
  control?.close();await coreLog?.close().catch(()=>{});
  await unlink(metadata).catch(()=>{});await release();resolveClosed({exitCode});
  if(issue)throw issue;
 })();return shutdownPromise;}
 const unexpected=()=>{if(!shutdownPromise){exitCode=1;void stop().catch(()=>{});}};
 try{
  await free(corePort);await free(panelPort);await unlink(metadata).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const managementPath=join(paths.state,'panel-management.key');let admin;
  try{await assertPrivate(managementPath);admin=(await readFile(managementPath,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;admin='dw-admin-'+token();await writePrivate(managementPath,admin);}
  if(!/^dw-admin-[0-9a-f]{64}$/.test(admin))throw Error('管理密钥格式异常，未覆盖已有文件。');
  const logPath=join(paths.state,'gateway-core.log');coreLog=await open(logPath,'a',0o600);await securePrivate(logPath);
  const uiDir=join(dirname(coreBinary),'ui'),hasUi=await stat(uiDir).then(s=>s.isDirectory(),()=>false);
  const childEnv={...env,AGENT2API_PROXY_HOME:paths.state,AGENT2API_PROXY_PORT:String(corePort),AGENT2API_HOST:'127.0.0.1',AGENT2API_SELF_UPDATE:'0',...(hasUi?{AGENT2API_UI_DIR:uiDir}:{}),AGENT2API_PROXY_API_KEY:admin,DW_STATE_DIR:paths.state,DW_UPSTREAM_PORT:String(corePort),DW_PANEL_PORT:String(panelPort),TMPDIR:paths.tmp,TMP:paths.tmp,TEMP:paths.tmp};
  core=spawn(coreBinary,coreCommand?.args||[],{env:childEnv,stdio:['ignore',coreLog.fd,coreLog.fd],windowsHide:true,shell:false});core.once('error',unexpected);core.once('exit',unexpected);
  await providerReady({paths,corePort,admin,packPath:env.DW_PROVIDER_PACK?resolve(env.DW_PROVIDER_PACK):join(paths.runtime,'providers.zip'),signal:abort.signal});
  await initModelKey({dir:paths.state,port:corePort,signal:abort.signal});
  panel=fork(join(paths.project,'server.mjs'),[],{env:childEnv,execArgv:[],stdio:['ignore','inherit','inherit','ipc'],windowsHide:true});panel.once('error',unexpected);panel.once('exit',unexpected);
  await new Promise((ok,bad)=>{const timeout=setTimeout(()=>bad(Error('管理面板启动超时，请检查终端提示。')),45000);const done=fn=>value=>{clearTimeout(timeout);fn(value);};panel.on('message',m=>{if(m?.type==='doubao-work-ready'&&m.port===panelPort)done(ok)();});panel.once('error',done(bad));panel.once('exit',done(()=>bad(Error('管理面板启动未完成。'))));});
  control=createServer(socket=>{socket.setTimeout(5000,()=>socket.destroy());let input='';socket.on('error',()=>{});socket.on('data',async chunk=>{input+=chunk;if(input.length>1024){socket.destroy();return;}if(!input.includes('\n'))return;socket.removeAllListeners('data');socket.resume();let packet;
   try{packet=JSON.parse(input);if(!same(packet.nonce,nonce)||!['status','stop'].includes(packet.action))throw Error();}catch{socket.end(JSON.stringify({error:'控制请求未通过。'})+'\n');return;}
   socket.setTimeout(20000,()=>socket.destroy());
   if(packet.action==='status'){socket.end(JSON.stringify({ok:true,state:'ready',url:'http://127.0.0.1:'+panelPort})+'\n');return;}
   try{await stop();socket.end(JSON.stringify({ok:true})+'\n');}catch{socket.end(JSON.stringify({error:'部分子进程关闭待核对。'})+'\n');}
  });});
  await new Promise((ok,bad)=>{control.once('error',bad);control.listen(0,'127.0.0.1',ok);});
  await writePrivate(metadata,JSON.stringify({version:1,project:paths.project,port:control.address().port,nonce}));
  log('豆包工作已启动：http://127.0.0.1:'+panelPort);log('停止：Ctrl+C 或在项目目录运行 npm stop。账号数据保留。');
  return {paths,closed,stop};
 }catch(error){await stop().catch(()=>{});throw error.name==='AbortError'?Error('转发核心启动中断，请查看私有日志 gateway-core.log。'):error;}
}
export async function requestControl(paths,action,overrideNonce){
 const file=join(paths.state,'launcher-control.json');await assertPrivate(file);let value;
 try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw Error('运行控制记录损坏，请检查项目运行终端。');}
 if(value.project!==paths.project||value.version!==1||!Number.isInteger(value.port)||value.port<1024||value.port>65535||!/^\w{64}$/.test(value.nonce))throw Error('运行控制记录不属于当前项目。');
 return new Promise((ok,bad)=>{const socket=createConnection({host:'127.0.0.1',port:value.port});let data='';socket.setTimeout(25000,()=>socket.destroy(Error('本机控制连接超时。')));socket.on('error',()=>bad(Error('本机控制连接未完成，请核对运行终端。')));socket.on('connect',()=>socket.write(JSON.stringify({action,nonce:overrideNonce||value.nonce})+'\n'));socket.on('data',c=>{data+=c;if(data.length>4096){socket.destroy();bad(Error('本机控制响应异常。'));}});socket.on('end',()=>{try{const result=JSON.parse(data);if(!result.ok)throw Error();ok(result);}catch{bad(Error('本机控制请求未通过。'));}});});
}
async function stopLegacy(paths){
 if(process.platform!=='darwin')return false;let pid;
 try{pid=Number((await readFile(join(paths.state,'doubao-gateway.pid'),'utf8')).trim());}catch(e){if(e.code==='ENOENT')return false;throw e;}
 if(!Number.isInteger(pid)||pid<2)throw Error('旧启动记录异常，未操作任何进程。');
 const cmd=await run('/bin/ps',['-p',String(pid),'-o','command=']).then(r=>r.stdout.trim(),()=> '');
 if(cmd!=='/bin/zsh '+join(paths.project,'start.command')&&cmd!=='zsh '+join(paths.project,'start.command'))throw Error('旧记录不是当前项目的启动进程，未操作其他程序。');
 process.kill(pid,'SIGTERM');return true;
}
async function main(){
 const action=process.argv[2]||'start',paths=await resolveRuntime();
 if(action==='secure-cloud'){const p=join(paths.project,'.cloud-target.json');await securePrivate(p);await assertPrivate(p);console.log('本机云端连接配置权限已收紧。');return;}
 if(action==='doctor'){const core=await findCore(paths).catch(()=>null);console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node,root:paths.root,core,browsers:(await availableBrowsers()).map(b=>b.name)},null,2));return;}
 if(action==='stop'||action==='status'){
  try{console.log(JSON.stringify(await requestControl(paths,action)));}
  catch(e){if(e.code==='ENOENT'){if(action==='stop'&&await stopLegacy(paths))console.log('已请求停止旧版本本机网关。');else console.log('本项目当前没有统一启动记录。');}else throw e;}return;
 }
 if(action!=='start')throw Error('请选择 start、stop、status、doctor 或 secure-cloud。');
 const gateway=await startGateway();for(const name of ['SIGINT','SIGTERM','SIGHUP'])process.once(name,()=>{void gateway.stop().catch(()=>{process.exitCode=1;});});const result=await gateway.closed;process.exitCode=result.exitCode;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(error=>{console.error(error.message||'启动未完成，请核对运行环境。');process.exitCode=1;});
