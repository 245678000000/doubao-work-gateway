import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const dir = process.env.DW_STATE_DIR;
if (!dir) throw Error('请通过 start.command 启动。');
const path = join(dir,'probe-model.key');
const url = 'http://127.0.0.1:43861';
const admin = (await readFile(join(dir,'panel-management.key'),'utf8')).trim();
if (!/^dw-admin-[0-9a-f]{64}$/.test(admin)) throw Error('本机管理密钥格式错误。');
const headers = {Authorization:'Bearer '+admin, 'Content-Type':'application/json'};
let ready=false;
for(let i=0;i<40;i++){
  try {
    const res=await fetch(url+'/api/keys',{headers,redirect:'error',signal:AbortSignal.timeout(1200)});
    if(res.ok){await res.body?.cancel();ready=true;break;}
  }catch{}
  await setTimeout(500);
}
if(!ready) throw Error('本机网关未就绪，请查看启动日志。');
let current='';
try{ current=(await readFile(path,'utf8')).trim(); }catch(e){if(e.code!=='ENOENT')throw e;}
if(current){
  if(!/^sk-local-[0-9a-f]{48}$/.test(current)) throw Error('本机模型密钥格式错误。');
  const res=await fetch(url+'/v1/models',{headers:{Authorization:'Bearer '+current},redirect:'error',signal:AbortSignal.timeout(3000)});
  if(!res.ok)throw Error('本机模型密钥与网关不匹配。');
  await res.body?.cancel();
}else{
  const key='sk-local-'+randomBytes(24).toString('hex');
  const created=await fetch(url+'/api/keys',{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(4000),
    body:JSON.stringify({name:'豆包工作本机模型 Key',key,allowedProviders:['doubaowork']})});
  const value=await created.json();
  if(!created.ok||value?.data?.created?.enabled!==true||
     value.data.created.allowedProviders?.join(',')!=='doubaowork')throw Error('网关未创建受限模型密钥；请先确认豆包工作插件已启用。');
  await writeFile(path,key,{mode:0o600,flag:'wx'});
}
