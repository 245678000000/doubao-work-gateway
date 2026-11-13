import {randomUUID, timingSafeEqual} from 'node:crypto';
import {securePrivate} from './private-files.mjs';
import {open, rename, readFile, unlink} from 'node:fs/promises';

export const PROVIDER = 'doubaowork';
export const SHANGHAI = 'Asia/Shanghai';
const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone:SHANGHAI, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', hourCycle:'h23',
});
export function dayTime(at = new Date()) {
  const p = Object.fromEntries(calendar.formatToParts(at).map(({type,value})=>[type,value]));
  return {day:`${p.year}-${p.month}-${p.day}`, time:`${p.hour}:${p.minute}`};
}
export const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const same = (a,b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const clip = (x,n=160) => typeof x === 'string' ? x.slice(0,n) : '';
export function viewAccounts(list, settings, usage) {
  return (Array.isArray(list) ? list : []).filter(a=>a?.provider === PROVIDER && typeof a.id === 'string').map(a=>{
    const balance = usage?.find(r=>r.id===a.id);
    const daily = a.dailyCheckin;
    const sourceName=clip(a.displayName||a.name||'豆包工作账号',64);
    const alias=Object.hasOwn(settings.aliases||{},a.id)?clip(settings.aliases[a.id],32):'';
    return {id:a.id, name:alias||sourceName, sourceName, alias, enabled:a.enabled===true,
      available:(a.hasCredentials===true||a.available===true) && a.needsRelogin!==true,
      routable:a.chatSupported!==false && a.needsRelogin!==true, checked:a.checkedInToday===true, checkinAt:Number(a.checkinAt)||0,
      checkinStatus:clip(daily?.status||daily?.outcome,40),
      auto:settings.accounts[a.id]===true,
      plan:clip(balance?.usage?.subscription?.planName,60),
      quota: (Array.isArray(balance?.usage?.windows)?balance.usage.windows:[]).slice(0,8).map(w=>({label:clip(w.label,64),view:clip(w.view,64)})),
      quotaState:balance?.error?'error':balance?.usage?'ok':'unknown'};
  });
}
export function dueAccounts(settings, accounts, at=new Date()) {
  const {day,time}=dayTime(at);
  if (!settings.enabled || time<settings.time) return [];
  return accounts.filter(a=>a.auto && a.enabled && a.available && !a.checked
    && settings.attempted[a.id]?.day !== day);
}
export function checkinView(result) {
  const row = result?.results?.[0];
  const outcome = row?.claim?.outcome;
  if (outcome === 'done') return {status:'done', message:'今日已领取，已由上游确认。'};
  if (outcome === 'claimed') return {status:'claimed', message:'签到成功，已回查确认。'};
  if (outcome === 'pending' || /pending|waiting/.test(row?.claim?.status||'')) return {status:'pending', message:'领取结果待确认；本轮不重复提交。'};
  if (outcome === 'inactive' || outcome === 'ineligible') return {status:'inactive', message:'上游未开放可领取的每日奖励。'};
  if (outcome === 'captcha') return {status:'captcha', message:'上游需要人工验证。'};
  return {status:'error', message:'上游未确认签到，请在桌面网关检查账号状态。'};
}
export const emptySettings = () => ({enabled:false,time:'09:30',accounts:{},attempted:{},aliases:{}});
export async function readSettings(path) {
  try {
    const s=JSON.parse(await readFile(path,'utf8'));
    if (typeof s.enabled!=='boolean' || !validTime(s.time) || !s.accounts || !s.attempted ||
      [s.accounts,s.attempted].some(x=>typeof x!=='object'||Array.isArray(x))) throw Error('签到配置损坏');
    if (s.aliases===undefined) s.aliases={};
    if (!s.aliases || typeof s.aliases!=='object' || Array.isArray(s.aliases) ||
      Object.entries(s.aliases).some(([k,v])=>['__proto__','constructor','prototype'].includes(k)||typeof v!=='string'||v.length>32)) throw Error('账号备注配置损坏');
    return s;
  } catch (error) {
    if (error.code==='ENOENT') return emptySettings();
    throw error;
  }
}
export async function atomic(path,value) {
  const temp=path+'.'+randomUUID()+'.tmp';
  const file=await open(temp,'wx',0o600);
  try { await securePrivate(temp); await file.writeFile(JSON.stringify(value,null,2)+'\n'); await file.sync(); }
  catch(error){ await file.close(); await unlink(temp).catch(()=>{}); throw error; }
  await file.close();
  try { await rename(temp,path); } catch(error){ await unlink(temp).catch(()=>{}); throw error; }
}
