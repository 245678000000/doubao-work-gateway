import {readFile} from 'node:fs/promises';
import {assertPrivate} from './private-files.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createCloudSync({configPath,request,fetchImpl=fetch}){
 let busy=false;
 async function config(){
  try{
   await assertPrivate(configPath);
   const data=JSON.parse(await readFile(configPath,'utf8')),url=new URL(data.origin);
   if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.origin!==data.origin||typeof data.user!=='string'||!data.user||/[\r\n:]/.test(data.user)||typeof data.password!=='string'||!data.password||/[\r\n]/.test(data.password))throw Error();
   return data;
  }catch{throw fail(409,'本机助手尚未配置云端连接，请先完成私有连接配置。');}
 }
 return {
  async status(){try{const {origin}=await config();return {configured:true,origin};}catch{return {configured:false,origin:''};}},
  async sync(ids){
   if(busy)throw fail(409,'已有账号正在同步，请稍后核对结果。');busy=true;
   try{
    const target=await config(),data=await request('/api/accounts/export');
    const accounts=data?.accounts?.filter(a=>a.provider==='doubaowork'&&a.desktop!==true&&(!ids||ids.includes(a.id)));
    if(!accounts?.length||accounts.length>20||(ids&&accounts.length!==new Set(ids).size))throw fail(409,'未找到完整的豆包工作登录快照，请刷新本机账号。');
    let result;
    try{
     const r=await fetchImpl(target.origin+'/api/accounts/import',{method:'POST',redirect:'error',signal:AbortSignal.timeout(40_000),headers:{'Content-Type':'application/json',Origin:target.origin,'X-Doubao-Panel':'1',Authorization:'Basic '+Buffer.from(target.user+':'+target.password).toString('base64')},body:JSON.stringify({version:2,accounts})});
     if(!r.ok)throw Error();result=await r.json();
     if(result.failed!==0||result.skipped!==0||!Number.isInteger(result.added)||!Number.isInteger(result.updated)||result.added+result.updated!==accounts.length)throw Error();
    }catch{throw fail(502,'云端同步结果待核对。账号已保存在本机，请先刷新云端列表；无需重复登录。');}
    return {origin:target.origin,added:result.added,updated:result.updated};
   }finally{busy=false;}
  },
 };
}
