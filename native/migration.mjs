// Optional, offline, read-only migration. No legacy program is started.
import {createDecipheriv,createHash} from 'node:crypto';
import {readFile,lstat,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';

import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {assertPrivate,securePrivate} from '../private-files.mjs';
import {validId,label} from '../transfers.mjs';
import {readSettings,dayTime} from '../core.mjs';
import {normalizeSession} from './services.mjs';

function decode(ciphertext,key){
 if(typeof ciphertext!=='string'||!/^enc1:[A-Za-z0-9+/_-]+={0,2}$/.test(ciphertext)||ciphertext.length>131072)throw Error('不支持此旧库账号加密格式。');
 const b=Buffer.from(ciphertext.slice(5),'base64url');
 if(b.length<29)throw Error('旧库账号密文异常。');
 const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
 c.setAuthTag(b.subarray(-16));
 const plain=Buffer.concat([c.update(b.subarray(12,-16)),c.final()]);
 try{return JSON.parse(plain.toString('utf8'));}finally{plain.fill(0);}
}
async function fileInfo(path,{optional=false,max=64*1024*1024}={}){
 try{
  const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('旧库文件类型或大小有误。');
  await assertPrivate(path);return s;
 }catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
}
// File Provider hydration can change inode/ctime without changing source bytes.
const sig=s=>s?[s.size,s.mtimeMs].join(':'):'missing';
async function contentHash(path){
 const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);
 return h.digest('hex');
}

export async function readLegacyAccounts({dir,now=Date.now}){
 const {DatabaseSync}=await import('node:sqlite');
 const src=resolve(dir),tmp=await mkdtemp(join(tmpdir(),'dw-read-legacy-'));
 let key,db;
 try{
  await securePrivate(tmp,{directory:true});
  const keyFile=join(src,'account.key');
  await fileInfo(keyFile,{max:32});
  key=await readFile(keyFile);if(key.length!==32)throw Error('旧库主密钥有误。');
  const names=['agent2api.db','agent2api.db-wal'];
  const before=await Promise.all(names.map((name,i)=>fileInfo(join(src,name),{optional:!!i})));
  for(let i=0;i<names.length;i++)if(before[i])await copyFile(join(src,names[i]),join(tmp,names[i]));
  const after=await Promise.all(names.map((name,i)=>fileInfo(join(src,name),{optional:!!i})));
  if(before.some((s,i)=>sig(s)!==sig(after[i])))throw Error('旧库正在变化，请先停止旧网关后重新迁移。');
  for(let i=0;i<names.length;i++)if(before[i]){
   const name=names[i],copy=await contentHash(join(tmp,name)),source=await contentHash(join(src,name));
   if(copy!==source)throw Error('旧库读取期间发生变化，未导入。');
  }
  db=new DatabaseSync(join(tmp,names[0]));
  const rows=db.prepare("SELECT id, enabled, data FROM accounts WHERE provider = 'doubaowork' LIMIT 201").all();
  if(rows.length>200)throw Error('迁移账号超过 200 个。');
  const settings=await readSettings(join(src,'doubao-panel-settings.json'));
  const time=now(),day=dayTime(new Date(time)).day,attempted={};
  const accounts=rows.map(row=>{
   if(!validId(row.id))throw Error('旧库账号标识无效。');
   const legacy=decode(row.data,key);
   if(legacy.id!==row.id||legacy.provider!=='doubaowork'||legacy.desktop===true)throw Error('旧库含有非网页登录账号。');
   const s=legacy.pluginSecret;
   // Older web sessions may use the Cookie header or an array of root cookies.
   const session=normalizeSession(Array.isArray(s?.cookies)&&!s.cookieHeader?s:{...s,cookies:undefined});
   const old=settings.attempted[row.id],checked=Number(legacy.checkinAt);
   if(old?.day===day&&Number.isFinite(old.at)&&['submitting','claimed','done','pending','unknown','inactive','error','captcha'].includes(old.status))
    attempted[row.id]={day,at:old.at,status:old.status,reserved:true};
   if(Number.isFinite(checked)&&checked>0&&dayTime(new Date(checked)).day===day)attempted[row.id]={day,at:checked,status:'done',reserved:true};
   return {id:row.id,provider:'doubaowork',session,name:label(legacy.nickname||legacy.name)||'豆包工作账号',
    alias:label(settings.aliases[row.id]).slice(0,32),auto:settings.accounts[row.id]===true,enabled:row.enabled===1};
  });
  return {accounts,scheduler:{enabled:settings.enabled,time:settings.time,attempted}};
 }catch(e){
  if(e.code==='ERR_OSSL_EVP_BAD_DECRYPT'||/authenticate|bad decrypt/i.test(e.message))throw Error('旧库密文认证失败，原文件保留。');
  throw e;
 }finally{db?.close();key?.fill(0);await rm(tmp,{recursive:true,force:true});}
}
