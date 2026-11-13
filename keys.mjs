import {randomBytes,createHash} from 'node:crypto';
import {PROVIDER,clip,same} from './core.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const validId=id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const scoped=k=>k&&Array.isArray(k.allowedProviders)&&k.allowedProviders.length===1&&k.allowedProviders[0]===PROVIDER;
export const readableKey=key=>typeof key==='string'&&/^[A-Za-z0-9_-]{16,256}$/.test(key);
export function keyName(value){
  if(typeof value!=='string'||!value.trim()||value.length>40||/[\x00-\x1f\x7f]/.test(value))throw fail(400,'名称请填写 1–40 字的单行文字。');
  return value.trim();
}
export function customKey(value){
  if(value===undefined||value==='')return '';
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(value))throw fail(400,'自定义 Key 请使用 32–128 位字母、数字、下划线或短横线，不含空格。');
  return value;
}
export function publicKey(entry,modelKey){
  const readable=readableKey(entry.key);
  return {id:entry.id,name:clip(entry.name,40)||'未命名 Key',enabled:entry.enabled===true,createdAt:Number(entry.createdAt)||0,
    masked:readable?entry.key.slice(0,6)+'••••••••'+entry.key.slice(-4):'密钥待检查',
    builtIn:same(entry.key,modelKey),readable,
    allowedModels:(Array.isArray(entry.allowedModels)?entry.allowedModels:[]).filter(m=>typeof m==='string').map(m=>clip(m,160)).slice(0,100)};
}
export function createKeyManager({request,modelKey,management,now=Date.now}){
  let pending=Promise.resolve();const creations=new Map();
  const locked=fn=>{const task=pending.then(fn);pending=task.catch(()=>{});return task;};
  async function all(){
    const data=await request('/api/keys');
    if(!Array.isArray(data?.keys))throw fail(502,'Key 列表格式异常，请稍后刷新。');
    return data.keys;
  }
  const visible=k=>scoped(k)&&validId(k.id)&&!same(k.key,management);
  async function target(id){
    if(!validId(id))throw fail(400,'Key 标识无效。');
    const entry=(await all()).find(k=>k.id===id&&visible(k));
    if(!entry)throw fail(404,'未找到这个豆包工作 Key。');
    return entry;
  }
  async function create(data){
    if(Object.keys(data).some(k=>!['name','key','requestId'].includes(k)))throw fail(400,'创建参数包含未支持的字段。');
    const name=keyName(data.name),provided=customKey(data.key),id=data.requestId;
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(id))throw fail(400,'请重新打开创建窗口后提交。');
    const fingerprint=createHash('sha256').update(JSON.stringify([name,provided])).digest('hex');
    for(const [id,item] of creations)if(item.done&&now()-item.at>15*60_000)creations.delete(id);
    const previous=creations.get(id);
    if(previous){if(previous.fingerprint!==fingerprint)throw fail(409,'表单内容已变更，请重新打开创建窗口。');return previous.promise;}
    if(creations.size>=128)throw fail(429,'近期创建操作较多，请稍后再试。');
    const item={fingerprint,at:now(),done:false,promise:null};
    item.promise=locked(async()=>{
      const rows=await all(),key=provided||'sk-dw-'+randomBytes(32).toString('base64url');
      if(same(key,management)||same(key,modelKey)||rows.some(k=>same(k.key,key)))throw fail(409,'这把 Key 已存在或属于保留密钥，请使用另一把。');
      let created;
      try{
        const result=await request('/api/keys',{method:'POST',body:{name,key,allowedProviders:[PROVIDER],allowedModels:[]}});
        const id=result?.created?.id;
        created=(await all()).find(k=>k.id===id&&visible(k)&&same(k.key,key)&&k.enabled===true&&k.name===name&&Array.isArray(k.allowedModels)&&k.allowedModels.length===0);
        if(!created)throw Error('Key readback mismatch');
      }catch{throw fail(502,'创建结果待核对，请先刷新 Key 列表。此提交不会自动重复创建。');}
      return {created:publicKey(created,modelKey)};
    }).finally(()=>{item.done=true;item.at=now();});
    creations.set(id,item);return item.promise;
  }
  return {
    async list(){return {keys:(await all()).filter(visible).map(k=>publicKey(k,modelKey))};},
    create,
    update:data=>locked(async()=>{
      if(Object.keys(data).some(k=>!['id','name','enabled'].includes(k)))throw fail(400,'仅支持修改名称或启用状态。');
      if(data.name===undefined&&data.enabled===undefined)throw fail(400,'请选择需要修改的内容。');
      const patch={};if(data.name!==undefined)patch.name=keyName(data.name);
      if(data.enabled!==undefined){if(typeof data.enabled!=='boolean')throw fail(400,'启用状态应为开关值。');patch.enabled=data.enabled;}
      const before=await target(data.id);
      if(same(before.key,modelKey))throw fail(409,'默认 Key 用于面板连接，请保留；可为客户端另建 Key。');
      await request('/api/keys/'+encodeURIComponent(data.id),{method:'PATCH',body:patch});
      const after=await target(data.id);
      if(Object.entries(patch).some(([k,v])=>after[k]!==v)||JSON.stringify(after.allowedModels)!==JSON.stringify(before.allowedModels))throw fail(502,'更新结果待核对，请刷新列表。');
      return {updated:publicKey(after,modelKey)};
    }),
    async reveal(id){const k=await target(id);if(!readableKey(k.key))throw fail(409,'这把 Key 当前待检查，请创建新的 Key。');return {key:k.key};},
  };
}
