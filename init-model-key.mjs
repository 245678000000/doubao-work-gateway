import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {writePrivate,assertPrivate} from './private-files.mjs';
export async function initModelKey({dir,port=43861,fetchImpl=fetch,attempts=40,signal}={}){
 if(!dir||!Number.isInteger(port)||port<1024||port>65535)throw Error('请通过项目启动入口准备运行目录与端口。');
 const path=join(dir,'probe-model.key'),url='http://127.0.0.1:'+port;
 await assertPrivate(join(dir,'panel-management.key'));
 const admin=(await readFile(join(dir,'panel-management.key'),'utf8')).trim();
 if(!/^dw-admin-[0-9a-f]{64}$/.test(admin))throw Error('本机管理密钥格式错误。');
 const headers={Authorization:'Bearer '+admin,'Content-Type':'application/json'};
 const request=(route,options={})=>fetchImpl(url+route,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(4000)]):AbortSignal.timeout(4000),...options});
 let ready=false;
 for(let i=0;i<attempts;i++){signal?.throwIfAborted();try{const r=await request('/api/keys',{headers});if(r.ok){await r.body?.cancel();ready=true;break;}}catch{}await sleep(250,undefined,{signal});}
 if(!ready)throw Error('本机网关未就绪，请查看私有核心日志。');
 let current='';try{await assertPrivate(path);current=(await readFile(path,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;}
 if(current){
  if(!/^sk-local-[0-9a-f]{48}$/.test(current))throw Error('本机模型密钥格式错误。');
  const r=await request('/v1/models',{headers:{Authorization:'Bearer '+current}});if(!r.ok)throw Error('本机模型密钥与网关不匹配。');await r.body?.cancel();
 }else{
  const key='sk-local-'+randomBytes(24).toString('hex');let r,value;
  try{r=await request('/api/keys',{method:'POST',headers,body:JSON.stringify({name:'豆包工作默认模型 Key',key,allowedProviders:['doubaowork']})});value=await r.json();}
  catch{throw Error('模型 Key 创建结果待核对，请检查核心后再启动。');}
  if(!r.ok||value?.data?.created?.enabled!==true||value.data.created.allowedProviders?.join(',')!=='doubaowork')throw Error('网关未确认受限模型 Key，请检查豆包工作插件状态。');
  await writePrivate(path,key);
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await initModelKey({dir:process.env.DW_STATE_DIR,port:Number(process.env.DW_UPSTREAM_PORT||43861)});
