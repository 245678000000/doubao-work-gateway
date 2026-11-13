import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {dayTime,validTime,same} from '../core.mjs';
import {keyName,customKey,publicKey,readableKey} from '../keys.mjs';
import {jsonShape,label,selectedIds,validId,parseAccountBackup} from '../transfers.mjs';
import {normalizeProviderError} from './protocol.mjs';
import {onFailure,restore,routable} from './account-state.mjs';

const fail=(status,message,type)=>Object.assign(new Error(message),{status,type});
const digest=v=>createHash('sha256').update(v).digest('hex');
const modelId=m=>typeof m==='string'&&/^[\w.:/%+\-]{1,160}$/.test(m);
const cleanModels=ms=>[...new Set(Array.isArray(ms)?ms.filter(modelId):[])].slice(0,100);
const friendly=(v,max=64)=>label(v).slice(0,max);
const freshKey=()=> 'sk-dw-'+randomBytes(32).toString('base64url');
const BAD_NAMES=new Set(['__proto__','constructor','prototype']);
export function normalizeSession(s){
 const raw=Array.isArray(s?.cookies)?s.cookies.filter(c=>c?.path==='/'&&['doubao.com','www.doubao.com'].includes(String(c.domain).replace(/^\./,''))&&(!c.expires||c.expires<0||c.expires>Date.now()/1000)).map(c=>c.name+'='+c.value).join('; '):s?.cookieHeader;
 if(typeof raw!=='string'||raw.length>32000||/[^\x20-\x7e]/.test(raw))throw fail(400,'豆包网页登录快照格式有误。');
 const pairs=new Map();
 for(const part of raw.split(';')){
  const m=/^\s*([!#$%&'*+.^_\x60|~A-Za-z0-9-]+)=([\x21-\x3a\x3c-\x7e]*)\s*$/.exec(part);
  if(!m)throw fail(400,'豆包网页登录快照格式有误。');
  pairs.set(m[1],m[2]);
 }
 if(!pairs.get('sessionid')&&!pairs.get('sessionid_ss'))throw fail(400,'登录快照缺少豆包会话。');
 const session={cookieHeader:[...pairs].map(([k,v])=>k+'='+v).join('; ')};
 for(const k of ['deviceId','webId','fingerprint','clientVersion','userAgent','channel','chromiumVersion'])
  if(typeof s[k]==='string'&&s[k].length<=512&&/^[\x20-\x7e]+$/.test(s[k]))session[k]=s[k];
 return session;
}

function backupRows(value){
 jsonShape(value);
 if(value?.version===2)return parseAccountBackup(value).map(a=>({
  id:a.id,name:a.name,session:normalizeSession(a.pluginSecret),identity:'',enabled:true,auto:false,alias:'',
 }));
 if(value?.schema!=='doubao-work-accounts/v1'||value.version!==3||!Array.isArray(value.accounts)||value.accounts.length<1||value.accounts.length>20)throw fail(400,'请选择豆包工作账号备份，每次 1–20 个账号。');
 const ids=new Set();
 return value.accounts.map(a=>{
  if(a?.provider!=='doubaowork'||!validId(a.id)||ids.has(a.id))throw fail(400,'账号备份中有重复、无效或非豆包工作账号。');
  ids.add(a.id);
  return {id:a.id,name:friendly(a.name)||'豆包工作账号',session:normalizeSession(a.session),identity:'',
   enabled:a.enabled!==false,auto:a.auto===true,alias:friendly(a.alias,32)};
 });
}

export async function createNativeServices({store,client,now=Date.now,bootstrapKey}){
 await store.mutate(d=>{
  if(!d.keys.some(k=>k.builtIn)){
   const key=readableKey(bootstrapKey)?bootstrapKey:freshKey();
   d.keys.push({id:randomUUID(),name:'默认 Key',key,hash:digest(key),enabled:true,builtIn:true,createdAt:now(),allowedModels:[]});
  }
 });
 const busy=new Set(),quarantined=new Set(),previews=new Map();
 let cursor=0,ticking=false,closed=false;
 const find=(list,id)=>{
  if(!validId(id))throw fail(400,'账号标识无效。');
  const a=list.find(a=>a.id===id);if(!a)throw fail(404,'未找到这个豆包工作账号。');return a;
 };
 const pkey=k=>publicKey(k,k.builtIn?k.key:undefined);
 const keyFor=(rows,id)=>{const k=rows.find(k=>k.id===id);if(!k)throw fail(404,'未找到此 Key。');return k;};
 const keys={
  defaultKey:()=>store.snapshot().keys.find(k=>k.builtIn).key,
  list:()=>({keys:store.snapshot().keys.map(pkey)}),
  authenticate(token){
   if(!readableKey(token))return null;
   const hash=digest(token);const k=store.snapshot().keys.find(row=>row.enabled&&same(hash,row.hash));
   return k?{id:k.id,allowedModels:k.allowedModels}:null;
  },
  create(input){
   if(Object.keys(input).some(k=>!['name','key','requestId'].includes(k)))throw fail(400,'Key 创建参数包含不支持的字段。');
   const name=keyName(input.name),requested=customKey(input.key),id=input.requestId;
   if(typeof id!=='string'||!/^[\w-]{16,80}$/.test(id))throw fail(400,'请重新打开创建窗口。');
   const fingerprint=digest(JSON.stringify([name,requested]));
   return store.mutate(d=>{
    d.requests=d.requests.filter(r=>r.at>now()-900000);
    const prior=d.requests.find(r=>r.id===id);
    if(prior){if(prior.fingerprint!==fingerprint)throw fail(409,'创建内容已变化，请重新打开窗口。');return {created:pkey(keyFor(d.keys,prior.keyId))};}
    if(d.keys.length>=256||d.requests.length>=128)throw fail(429,'Key 数量或近期创建次数已达上限。');
    const key=requested||freshKey(),hash=digest(key);
    if(d.keys.some(k=>same(k.hash,hash)))throw fail(409,'这把 Key 已存在。');
    const row={id:randomUUID(),key,hash,name,enabled:true,createdAt:now(),allowedModels:[]};
    d.keys.push(row);d.requests.push({id,fingerprint,keyId:row.id,at:now()});return {created:pkey(row)};
   });
  },
  update({id,name,enabled}){
   const patch={};
   if(name!==undefined)patch.name=keyName(name);
   if(enabled!==undefined){if(typeof enabled!=='boolean')throw fail(400,'Key 状态应为开关值。');patch.enabled=enabled;}
   if(!Object.keys(patch).length)throw fail(400,'请选择需要更新的字段。');
   return store.mutate(d=>{const k=keyFor(d.keys,id);if(k.builtIn)throw fail(409,'默认 Key 请保留；客户端可另建 Key。');Object.assign(k,patch);return {updated:pkey(k)};});
  },
  reveal:id=>({key:keyFor(store.snapshot().keys,id).key}),
 };
 const date=()=>dayTime(new Date(now()));
 const ready=a=>routable(a,now())&&!a.verificationRestored&&!quarantined.has(a.id);
 const exposed=(a,scheduler)=>{
  const attempt=scheduler.attempted[a.id],today=attempt?.day===date().day;
  return {id:a.id,name:a.alias||a.name,sourceName:a.name,alias:a.alias,enabled:a.enabled,auto:a.auto,
   available:!quarantined.has(a.id)&&(a.state==='ready'||a.state==='rate_limited'),imported:!a.identity,routable:ready(a),state:a.state,
   retestPending:a.verificationRestored===true,upstreamCode:a.upstreamCode||0,failureAt:a.failureAt||0,
   lastRequestId:a.lastRequestId||'',checked:today&&['claimed','done'].includes(attempt.status),
   checkinAt:today?attempt.at:0,attempt:today?attempt.status:'',checkinStatus:'',
   plan:a.plan||'',quota:a.quota||[],quotaState:a.quotaState||'unknown',models:a.models||[]};
 };
 const catalog=(accounts=store.snapshot().accounts)=>cleanModels(accounts.filter(a=>a.enabled).flatMap(a=>a.models||[]));
 const classify=e=>normalizeProviderError(e,{httpStatus:e?.status||502});
 async function failed(account,error,requestId,{retest=false}={}){
  const e=classify(error);
  if(e.state){
   quarantined.add(account.id);
   await store.mutate(d=>{
   const a=find(d.accounts,account.id);
    if(a.epoch===account.epoch){
     Object.assign(a,onFailure(a,{upstream_code:e.upstream_code,status:e.status,retryAfterMs:error?.retryAfterMs},{now:now(),requestId}));
     if(retest||account.state==='needs_verification')Object.assign(a,{state:'needs_verification',retryAt:0,verificationRestored:false});
    }
   });
   quarantined.delete(account.id);
  }
  return e;
 }
 async function importCookies(input,{expectedId,signal}={}){
  const session=normalizeSession(input);
  let info,models=[],catalogState='unknown';
  try{info=await client.identity(session,{signal});}catch(e){throw classify(e);}
  const identity=info?.identity;
  if(typeof identity!=='string'||!identity||identity.length>256||/[\x00-\x1f\x7f]/.test(identity))throw fail(502,'豆包未确认账号身份。');
  const existing=store.snapshot().accounts;
  const target=expectedId?find(existing,expectedId):existing.find(a=>a.identity===identity);
  if(target?.identity&&target.identity!==identity)throw fail(409,'登录的账号与所选账号不同。');
  // Identity alone must not clear a chat challenge or trigger extra requests on a paused account.
  if(target?.state!=='needs_verification'&&!target?.verificationRestored&&client.models){
   try{models=cleanModels(await client.models(session,{signal}));catalogState='ok';}catch(e){const n=classify(e);if(n.state){if(target)await failed(target,n,randomUUID());throw n;}}
  }
  signal?.throwIfAborted();
  return store.mutate(d=>{
   signal?.throwIfAborted();
   const verified=d.accounts.find(a=>a.identity===identity);
   const a=expectedId?find(d.accounts,expectedId):verified;
   if((a?.identity&&a.identity!==identity)||(verified&&verified.id!==a?.id))throw fail(409,'此身份已经关联到其他账号。');
   if(a&&busy.has(a.id))throw fail(409,'账号正在执行任务，请结束后再更新登录。');
   const preserved=a?.state==='needs_verification'||a?.verificationRestored;
   const row={id:a?.id||randomUUID(),identity,name:friendly(info.name)||'豆包工作账号',alias:a?.alias||'',session,
    enabled:a?.enabled??true,auto:a?.auto??false,epoch:randomUUID(),
    state:preserved?a.state:'ready',verificationRestored:preserved&&a.verificationRestored===true,
    models:catalogState==='ok'?models:a?.models||[],catalogState};
   if(preserved)for(const k of ['upstreamCode','failureAt','failureType','lastRequestId','restoredAt'])if(a[k]!==undefined)row[k]=a[k];
   if(a)Object.assign(a,row);else{if(d.accounts.length>=200)throw fail(409,'账号数已达上限。');d.accounts.push(row);}
   return {id:row.id,name:row.alias||row.name,updated:!!a};
  });
 }
 function purge(){for(const [token,p] of previews)if(p.until<=now())previews.delete(token);}
 function preview(value){
  const rows=backupRows(value),current=store.snapshot().accounts;
  purge();if(previews.size>=3)previews.delete(previews.keys().next().value);
  const token=randomUUID(),expiresAt=now()+600000;
  previews.set(token,{rows,until:expiresAt});
  const accounts=rows.map(a=>({id:a.id,name:a.name,duplicate:current.some(b=>b.id===a.id)}));
  return {token,expiresAt,total:rows.length,duplicates:accounts.filter(a=>a.duplicate).length,accounts};
 }
 async function commit({token,duplicates}){
  if(!['skip','update'].includes(duplicates))throw fail(400,'请选择重复账号处理方式。');
  purge();const item=previews.get(token);if(!item)throw fail(409,'预览已过期，请重新选择文件。');
  previews.delete(token);
  return store.mutate(d=>applyRows(d,item.rows,duplicates));
 }
 function applyRows(d,rows,duplicates){
  const result={total:rows.length,added:0,updated:0,skipped:0,failed:0};
  for(const a of rows){
   const existing=d.accounts.find(b=>b.id===a.id);
   // A file does not prove identity. Never replace a verified session with an unverified backup.
   if(existing&&(duplicates==='skip'||existing.identity||busy.has(a.id))){result.skipped++;continue;}
   if(!existing&&d.accounts.length>=200){result.failed++;continue;}
   const row={...a,epoch:randomUUID(),state:'needs_login',models:[]};
   if(existing){Object.assign(existing,row);result.updated++;}else{d.accounts.push(row);result.added++;}
  }
  return result;
 }
 async function migrateLegacy(input){
  const rows=[];
  for(let i=0;i<input.accounts.length;i+=20)rows.push(...backupRows({schema:'doubao-work-accounts/v1',version:3,accounts:input.accounts.slice(i,i+20)}));
  return store.mutate(d=>{
   const pristine=d.accounts.length===0;
   const result=applyRows(d,rows,'skip');
   if(pristine){d.scheduler.enabled=input.scheduler.enabled;d.scheduler.time=input.scheduler.time;
    d.scheduler.attempted=Object.fromEntries(Object.entries(input.scheduler.attempted).filter(([id])=>rows.some(r=>r.id===id)));}
   return result;
  });
 }
 async function verifyImported(id,options={}){
  const a=find(store.snapshot().accounts,id);
  if(a.identity||a.state!=='needs_login')throw fail(409,'请选择待核验的备份账号。');
  return importCookies(a.session,{expectedId:id,signal:options.signal});
 }
 function exportAccounts(ids){
  if(ids!==undefined)selectedIds(ids);
  const all=store.snapshot().accounts,rows=ids?ids.map(id=>find(all,id)):all;
  if(rows.length<1||rows.length>20)throw fail(400,'每份备份可包含 1–20 个账号。');
  const out={schema:'doubao-work-accounts/v1',version:3,exportedAt:now(),accounts:rows.map(({id,name,alias,enabled,auto,session})=>({provider:'doubaowork',id,name,alias,enabled,auto,session}))};
  jsonShape(out);return out;
 }
 async function changeAccounts(ids,patch){
  selectedIds(ids);
  return store.mutate(d=>{for(const id of ids)Object.assign(find(d.accounts,id),patch);return {completed:ids.length,unknown:0,notAttempted:0};});
 }
 async function quota(id,{signal}={}){
  if(!client.quota)throw fail(503,'额度查询尚未接入。');
  const a=find(store.snapshot().accounts,id);
  if(!ready(a))throw fail(409,'该账号目前未就绪。');
  if(busy.has(id))throw fail(409,'该账号正在处理另一请求。');
  busy.add(id);
  try{
   const data=await client.quota(a.session,{signal});
   await store.mutate(d=>{const x=find(d.accounts,id);if(x.epoch===a.epoch){x.plan=friendly(data?.plan);x.quota=(Array.isArray(data?.windows)?data.windows:[]).slice(0,8).map(q=>({label:friendly(q.label),view:friendly(q.view)}));x.quotaState='ok';}});
   return {ok:true};
  }catch(e){throw await failed(a,e,randomUUID());}finally{busy.delete(id);}
 }
 async function checkin(id,trigger='manual',{signal}={}){
  if(!client.checkin)throw fail(503,'签到尚未接入。');
  const state=store.snapshot(),a=find(state.accounts,id),{day,time}=date(),old=state.scheduler.attempted[id];
  if(!ready(a))throw fail(409,'该账号目前未就绪，签到已暂停。');
  if(busy.has(id))throw fail(409,'该账号正在处理另一请求。');
  if(trigger==='schedule'&&(!state.scheduler.enabled||!a.auto||time<state.scheduler.time||old?.day===day))return {status:'skipped',message:'当前无需自动签到。'};
  if(old?.day===day&&['done','claimed'].includes(old.status))return {status:'done',message:'今日已签到。'};
  const queryOnly=old?.day===day&&old.reserved===true;
  busy.add(id);
  try{
   await store.mutate(d=>{d.scheduler.attempted=Object.fromEntries(Object.entries(d.scheduler.attempted).filter(([,v])=>v.day===day));d.scheduler.attempted[id]={day,at:now(),status:'submitting',reserved:queryOnly};});
   let status;
   try{
    const result=await client.checkin(a.session,{signal,queryOnly,async reserve(){
     if(queryOnly||date().day!==day)throw fail(409,'领取日期已变化或已有提交记录。');
     await store.mutate(d=>{
      const x=d.scheduler.attempted[id],current=find(d.accounts,id);
      if(x?.day!==day||x.reserved||!ready(current)||date().day!==day)throw fail(409,'签到状态已变化。');
      x.reserved=true;
     });
    }});
    status=['claimed','done','inactive','ineligible','pending'].includes(result?.status)?result.status:'unknown';
   }catch(e){const n=await failed(a,e,randomUUID());status=n.state==='needs_verification'?'captcha':'unknown';}
   await store.mutate(d=>{
    const x=d.scheduler.attempted[id];if(x?.day===day)Object.assign(x,{status,at:now()});
    d.records.unshift({name:a.alias||a.name,at:now(),source:trigger,outcome:status});d.records=d.records.slice(0,60);
   });
   return {status,message:{done:'今日签到已由豆包确认。',claimed:'签到成功，已回查确认。',inactive:'此账号当前没有每日签到活动。',ineligible:'今日任务尚未满足领取条件。',pending:'领取结果待确认，未重复提交。',captcha:'需要在豆包官网完成验证，已暂停该账号。',unknown:'结果待核对。'}[status]};
  }finally{busy.delete(id);}
 }
 async function tick({signal}={}){
  if(closed||ticking||!client.checkin)return;
  const s=store.snapshot(),{day,time}=date();if(!s.scheduler.enabled||time<s.scheduler.time)return;
  ticking=true;
  try{for(const a of s.accounts){if(closed||signal?.aborted)break;if(a.auto&&ready(a)&&!busy.has(a.id)&&s.scheduler.attempted[a.id]?.day!==day)await checkin(a.id,'schedule',{signal}).catch(()=>{});}}
  finally{ticking=false;}
 }
 function select(model,{id,retest=false}={}){
  const list=store.snapshot().accounts.filter(a=>a.enabled);
  if(retest){
   const a=find(list,id);
   if(!a.verificationRestored||a.state!=='ready'||!a.models.includes(model)||busy.has(id))throw fail(409,'该账号当前没有可执行的验证复测。');
   return a;
  }
  const eligible=list.filter(a=>a.models.includes(model));
  const readyRows=eligible.filter(a=>ready(a));
  const free=readyRows.filter(a=>!busy.has(a.id));
  if(free.length)return free[cursor++%free.length];
  if(readyRows.length)throw fail(429,'可用账号正在处理请求。','accounts_busy');
  if(eligible.some(a=>a.state==='needs_verification'))throw normalizeProviderError({code:710022004});
  if(eligible.some(a=>a.verificationRestored))throw fail(409,'请先在面板完成指定账号的人工复测。','verification_retest_pending');
  if(eligible.some(a=>a.state==='rate_limited'))throw normalizeProviderError({},{httpStatus:429});
  throw fail(503,'该模型目前没有就绪的豆包工作账号。','no_available_account');
 }
 async function* chat(body,{signal,requestId,id,retest=false}={}){
  if(closed||!client.chat)throw fail(503,'豆包工作转发尚未就绪。','upstream_unavailable');
  const a=select(body.model,{id,retest});busy.add(a.id);
  let produced=false;
  try{
   if(retest)await store.mutate(d=>{
    const x=find(d.accounts,a.id);
    if(!x.verificationRestored||x.epoch!==a.epoch||!x.enabled)throw fail(409,'验证复测状态已变化。');
    // Reserve before sending. Interrupted/crashed probes remain paused.
    x.verificationRestored=false;x.state='needs_verification';
   });
   for await(const delta of client.chat(a.session,body,{signal})){
    signal?.throwIfAborted();
    if(typeof delta?.content==='string'&&delta.content){produced=true;yield {content:delta.content};}
    else if(typeof delta?.reasoning_content==='string'&&delta.reasoning_content)yield {reasoning_content:delta.reasoning_content};
   }
   signal?.throwIfAborted();
   if(!produced)throw fail(502,'豆包工作未返回文本。');
   if(retest)await store.mutate(d=>{const x=find(d.accounts,a.id);if(x.epoch===a.epoch){x.state='ready';x.upstreamCode=0;x.failureType='';x.retryAt=0;}});
  }catch(e){if(signal?.aborted)throw e;throw await failed(a,e,requestId,{retest});}
  finally{busy.delete(a.id);}
 }
 return {
  keys,importCookies,verifyImported,migrateLegacy,preview,commit,exportAccounts,changeAccounts,quota,checkin,tick,catalog,chat,
  capabilities:{chat:!!client.chat,quota:!!client.quota,checkin:!!client.checkin},
  async restore(id,confirmed){
   if(busy.has(id))throw fail(409,'账号正在处理请求。');
   return store.mutate(d=>{const a=find(d.accounts,id);if(!a.enabled)throw fail(409,'请先启用该账号。');Object.assign(a,restore(a,{confirmed,now:now()}));return {ok:true};});
  },
  setSchedule({enabled,time}){
   if(typeof enabled!=='boolean'||!validTime(time))throw fail(400,'请选择有效的北京时间。');
   return store.mutate(d=>{Object.assign(d.scheduler,{enabled,time});return {enabled,time};});
  },
  snapshot(){
   const d=store.snapshot(),{enabled,time}=d.scheduler;
   return {accounts:d.accounts.map(a=>exposed(a,d.scheduler)),models:catalog(d.accounts),records:d.records,scheduler:{enabled,time},
    updatedAt:now(),availability:{models:d.accounts.some(a=>a.catalogState==='ok')||!d.accounts.length,quota:!!client.quota,records:true}};
  },
  close(){closed=true;previews.clear();},
 };
}
