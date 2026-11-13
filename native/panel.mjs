import {createReadStream} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ingress} from '../ingress.mjs';
import {createNodeProfiles} from '../nodes.mjs';
import {BrowserLogin} from '../browser-login.mjs';
import {createCloudSync} from '../cloud-sync.mjs';
import {readJson,sendJson,parseChat} from './model-api.mjs';

const assets=new URL('../public/',import.meta.url);
const files={'/':['index.html','text/html; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],
 '/ui.js':['ui.js','text/javascript; charset=utf-8'],'/manage.js':['manage.js','text/javascript; charset=utf-8'],
 '/view.mjs':['view.mjs','text/javascript; charset=utf-8'],'/doubao-work-avatar.png':['doubao-work-avatar.png','image/png']};
const fail=(status,message)=>Object.assign(Error(message),{status});
export async function createNativePanel({dir,tmpRoot,services,originForPort,modelOrigin,publicOrigin,proxyToken,shutdown,
 browserLoginOptions={},cloudConfigPath,cloudFetch}){
 const nodes=await createNodeProfiles({path:join(dir,'doubao-node-profiles.json')});
 const gateway=()=>ingress({port:originForPort(),publicOrigin,proxyToken});
 const apiBase=()=> (publicOrigin||modelOrigin())+'/v1';
 const cloudSync=cloudConfigPath?createCloudSync({configPath:cloudConfigPath,fetchImpl:cloudFetch,
  exportAccounts:services.exportAccounts}):null;
 const login=new BrowserLogin({...browserLoginOptions,tmpRoot,
  async importAccount(cookies,{destination,expectedId}={}){
   const account=await services.importCookies({cookies},{expectedId,signal:shutdown});
   if(destination==='cloud'){
    const r=await cloudSync.sync([account.id]);
    return {...account,cloudSynced:true,cloudOrigin:r.origin};
   }
   return account;
  },
 });
 async function loginStatus(){
  const remote=!!publicOrigin;
  return {...login.status(),platform:process.platform,browsers:remote?[]:await login.options(),nativeAvailable:false,
   mode:remote?'cloud':'local',cloud:remote?undefined:cloudSync?await cloudSync.status():{configured:false},
   ...(remote?{message:'在本机面板完成浏览器登录，再将账号备份导入云端。'}:{})};
 }
 async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  const g=gateway(),path=req.url;
  const send=v=>sendJson(res,200,v);
  try{
   if(!g.accepts(req)||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'只接受受信任的面板入口。');
   if(req.method==='GET'&&Object.hasOwn(files,path)){
    const [file,type]=files[path];res.writeHead(200,{'Content-Type':type});
    createReadStream(new URL(file,assets)).on('error',()=>res.destroy()).pipe(res);return;
   }
   if(req.headers['x-doubao-panel']!=='1'||req.headers.origin&&req.headers.origin!==g.origin)throw fail(403,'面板请求验证失败。');
   if(req.method==='GET'){
    if(path==='/api/snapshot')return send({...services.snapshot(),capabilities:services.capabilities,native:true,apiBase:apiBase(),deployment:g.remote?'cloud':'local',loginAvailable:!g.remote&&(await login.options()).length>0});
    if(path==='/api/login-status')return send(await loginStatus());
    if(path==='/api/keys')return send(services.keys.list());
    if(path==='/api/nodes')return send(await nodes.list());
    throw fail(404,'未找到此面板接口。');
   }
   if(req.method!=='POST'||req.headers.origin!==g.origin)throw fail(403,'面板操作来源不匹配。');
   const d=await readJson(req,['/api/backup/preview','/api/nodes/preview','/api/accounts/import'].includes(path)?524288:8192);
   switch(path){
    case '/api/key':return send({key:services.keys.defaultKey()});
    case '/api/keys/create':return send(await services.keys.create(d));
    case '/api/keys/update':return send(await services.keys.update(d));
    case '/api/keys/reveal':return send(services.keys.reveal(d.id));
    case '/api/backup/preview':return send(services.preview(d));
    case '/api/backup/import':return send(await services.commit(d));
    case '/api/backup/export':
     if(d.confirmSecrets!==true)throw fail(400,'请确认备份包含登录资料，仅保存到可信位置。');
     return send(services.exportAccounts(d.ids));
    case '/api/accounts/import':{
     if(!g.remote)throw fail(404,'此入口仅用于已认证的云端迁入。');
     const p=services.preview(d);return send(await services.commit({token:p.token,duplicates:'skip'}));
    }
    case '/api/accounts/verify-import':return send(await services.verifyImported(d.id,{signal:shutdown}));
    case '/api/nodes/preview':return send(await nodes.preview(d));
    case '/api/nodes/import':return send(await nodes.commit(d.token));
    case '/api/nodes/remove':return send(await nodes.remove(d.id));
    case '/api/nodes/export':
     if(d.includeKeys!==undefined&&typeof d.includeKeys!=='boolean'||d.includeKeys&&d.confirmSecrets!==true)throw fail(400,'如需导出完整 Key，请先确认。');
     if(d.current===true)return send({schema:'doubao-work-nodes/v1',version:1,exportedAt:Date.now(),nodes:[{name:'豆包工作 · 当前网关',baseUrl:apiBase(),models:services.catalog(),...(d.includeKeys?{apiKey:services.keys.defaultKey()}:{})}]});
     return send(await nodes.export(d));
    case '/api/accounts/batch':{
     const patch={'enable':{enabled:true},pause:{enabled:false},'auto-on':{auto:true},'auto-off':{auto:false}};
     if(!Object.hasOwn(patch,d.action))throw fail(400,'请选择有效批量操作。');
     return send(await services.changeAccounts(d.ids,patch[d.action]));
    }
    case '/api/enable':
    case '/api/auto':
     if(typeof d.enabled!=='boolean')throw fail(400,'请选择有效开关。');
     await services.changeAccounts([d.id],{[path==='/api/auto'?'auto':'enabled']:d.enabled});return send({ok:true});
    case '/api/alias':
     if(typeof d.alias!=='string'||d.alias.length>32||/[\x00-\x1f\x7f]/.test(d.alias))throw fail(400,'备注请使用 32 字以内的单行文字。');
     await services.changeAccounts([d.id],{alias:d.alias.trim()});return send({ok:true});
    case '/api/quota':return send(await services.quota(d.id,{signal:shutdown}));
    case '/api/checkin':return send(await services.checkin(d.id,'manual',{signal:shutdown}));
    case '/api/schedule':return send(await services.setSchedule(d));
    case '/api/cloud-sync':
     if(g.remote||!cloudSync)throw fail(409,'请先配置本机云端连接。');
     return send(await cloudSync.sync());
    case '/api/login':
     if(g.remote)throw fail(409,'请在本机打开独立浏览器登录，再将账号备份导入云端。');
     if(d.mode!==undefined&&d.mode!=='browser'||d.browserId!==undefined&&!['chrome','edge'].includes(d.browserId)||d.destination!==undefined&&!['local','cloud'].includes(d.destination))
      throw fail(400,'请选择 Chrome / Edge 和有效的保存位置。');
     if(d.destination==='cloud'&&!(await cloudSync?.status())?.configured)throw fail(409,'请先配置本机云端连接。');
     if(d.expectedId!==undefined&&!services.snapshot().accounts.some(a=>a.id===d.expectedId))throw fail(404,'未找到要更新的账号。');
     await login.start(d.browserId,{destination:d.destination||'local',expectedId:d.expectedId,manual:typeof d.expectedId==='string'});return send(await loginStatus());
    case '/api/login/confirm':await login.confirm(d.id);return send(await loginStatus());
    case '/api/login/cancel':await login.cancel();return send(await loginStatus());
    case '/api/verification/restore':return send(await services.restore(d.id,d.confirmed));
    case '/api/verification/retest':{
     const requestId='dw-'+randomUUID(),body=parseChat({model:d.model,messages:[{role:'user',content:'请只回复 OK'}]});
     res.setHeader('X-Request-Id',requestId);
     const disconnect=new AbortController(),stop=()=>{if(!res.writableEnded)disconnect.abort();};
     res.once('close',stop);
     try{
      const signal=shutdown?AbortSignal.any([shutdown,disconnect.signal]):disconnect.signal;
      for await(const _ of services.chat(body,{signal,requestId,id:d.id,retest:true})){/* diagnostic: omit reply contents */}
      return send({ok:true,requestId});
     }finally{res.removeListener('close',stop);}
    }
    default:throw fail(404,'未找到该面板操作。');
   }
  }catch(e){
   if(!res.headersSent){const status=Number.isInteger(e?.status)&&e.status>=400&&e.status<=599?e.status:500;
    sendJson(res,status,{error:status===500?'处理未完成，请检查网关状态。':e.message,...(e.upstream_code?{upstream_code:e.upstream_code}:{})});}
   else res.destroy();
  }
 }
 return {handler,async dispose(){nodes.clear();await login.dispose();}};
}
