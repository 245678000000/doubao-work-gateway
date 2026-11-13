import {randomUUID} from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const validId=id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
export function selectedIds(ids){if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw fail(400,'请选择 1–20 个不同的账号。');return ids;}
export const label=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,64):'';
export function jsonShape(value){
 const stack=[[value,0]];let count=0;
 while(stack.length){const [v,depth]=stack.pop();if(++count>20000||depth>12)throw fail(400,'JSON 结构过深或字段过多。');
  if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw fail(400,'JSON 含不支持的字段。');stack.push([x,depth+1]);}
 }
 if(Buffer.byteLength(JSON.stringify(value))>512*1024)throw fail(413,'JSON 文件请控制在 512 KB 以内。');
}
export function parseAccountBackup(value){
 jsonShape(value);
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==2||(value.schema!==undefined&&value.schema!=='doubao-work-accounts/v1')||!Array.isArray(value.accounts)||!value.accounts.length||value.accounts.length>20)throw fail(400,'请选择豆包账号备份 JSON（version: 2），每次 1–20 个账号。');
 const identities=new Set(),ids=new Set();
 return value.accounts.map(a=>{
  if(!a||a.provider!=='doubaowork'||a.desktop===true||!validId(a.id)||typeof a.pluginIdentity!=='string'||!a.pluginIdentity||a.pluginIdentity.length>256||/[\u0000-\u001f\u007f]/.test(a.pluginIdentity)||typeof a.pluginSecret?.cookieHeader!=='string'||!a.pluginSecret.cookieHeader||/[\r\n\u0000]/.test(a.pluginSecret.cookieHeader))throw fail(400,'文件中存在其他提供商、桌面账号或不完整的豆包登录快照。');
  if(ids.has(a.id)||identities.has(a.pluginIdentity))throw fail(400,'文件内有重复账号，请先合并后导入。');ids.add(a.id);identities.add(a.pluginIdentity);
  // Import only the fields needed by the Doubao provider; never apply proxies or custom providers.
  const row={id:a.id,name:label(a.name)||'豆包工作账号',nickname:label(a.nickname),provider:'doubaowork',desktop:false,pluginIdentity:a.pluginIdentity,pluginSecret:a.pluginSecret,proxy:null};
  for(const k of ['pluginPublic','pluginLedger.dailyCheckin','pluginLedger.doubaowork-models'])if(a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))row[k]=a[k];
  return row;
 });
}
export function createAccountTransfer({request,now=Date.now}){
 const previews=new Map();let busy=false;
 const current=async()=>{const result=await request('/api/accounts/export');if(!Array.isArray(result?.accounts))throw fail(502,'账号快照读取异常，请稍后刷新。');return result.accounts;};
 const checkConflicts=(rows,existing)=>{if(rows.some(a=>existing.some(b=>(b.id===a.id||b.pluginIdentity===a.pluginIdentity)&&(b.provider!=='doubaowork'||b.desktop===true))))throw fail(409,'账号标识与其他类型账号冲突，请检查备份来源；现有账号保持原样。');};
 const duplicate=(a,list)=>list.some(b=>b.id===a.id||b.pluginIdentity===a.pluginIdentity);
 const purge=()=>{for(const [id,p] of previews)if(p.expiresAt<=now())previews.delete(id);};
 return {
  async preview(value){const rows=parseAccountBackup(value),existing=await current();checkConflicts(rows,existing);purge();if(previews.size>=3)previews.delete(previews.keys().next().value);
   const token=randomUUID(),expiresAt=now()+10*60_000;previews.set(token,{rows,expiresAt});
   const accounts=rows.map(a=>({id:a.id,name:a.name,duplicate:duplicate(a,existing)}));
   return {token,expiresAt,total:accounts.length,duplicates:accounts.filter(a=>a.duplicate).length,accounts};
  },
  async commit({token,duplicates}={}){
   if(!['skip','update'].includes(duplicates))throw fail(400,'请选择跳过或更新重复账号。');
   if(busy)throw fail(409,'已有账号正在导入，请稍后核对结果。');purge();const preview=previews.get(token);if(!preview)throw fail(409,'导入预览已失效，请重新选择文件。');
   busy=true;previews.delete(token);
   try{const existing=await current();checkConflicts(preview.rows,existing);const rows=preview.rows.filter(a=>duplicates==='update'||!duplicate(a,existing)),skipped=preview.rows.length-rows.length;
    if(!rows.length)return {total:preview.rows.length,added:0,updated:0,skipped,failed:0};
    let result;try{result=await request('/api/accounts/import',{method:'POST',body:{version:2,accounts:rows},ms:40_000});}catch{throw fail(502,'导入结果待核对，请先刷新账号列表；本次预览已结束，不会自动重试。');}
    const counts=Object.fromEntries(['added','updated','skipped','failed'].map(k=>[k,result?.[k]]));
    if(Object.values(counts).some(n=>!Number.isInteger(n)||n<0)||Object.values(counts).reduce((a,b)=>a+b,0)!==rows.length)throw fail(502,'导入报告待核对，请刷新账号列表；不会自动重试。');
    return {total:preview.rows.length,...counts,skipped:skipped+counts.skipped};
   }finally{busy=false;}
  },
  async export(ids){if(ids!==undefined)selectedIds(ids);if(busy)throw fail(409,'账号正在导入，请完成后再导出备份。');const list=await current(),rows=list.filter(a=>a.provider==='doubaowork'&&a.desktop!==true&&(!ids||ids.includes(a.id)));if(ids&&rows.length!==ids.length)throw fail(409,'部分账号已变化，请刷新后重新选择。');
   const accounts=parseAccountBackup({version:2,accounts:rows});return {schema:'doubao-work-accounts/v1',version:2,exportedAt:now(),accounts};
  },
  clear(){previews.clear();},
 };
}
