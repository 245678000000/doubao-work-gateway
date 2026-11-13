import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {ensurePrivateDir,assertPrivate,writePrivate} from '../private-files.mjs';
import {atomic} from '../core.mjs';
const FORMAT='doubao-work-vault/v1',opened=new Set();
const empty=()=>({schema:1,accounts:[],keys:[],scheduler:{enabled:false,time:'09:30',attempted:{}},records:[],requests:[]});
function validate(value){
 if(value?.schema!==1||!Array.isArray(value.accounts)||value.accounts.length>200||!Array.isArray(value.keys)||value.keys.length>256||!value.scheduler||!Array.isArray(value.records)||!Array.isArray(value.requests))throw Error('原生存储结构异常，原文件保留。');
 const text=JSON.stringify(value);if(Buffer.byteLength(text)>2*1024*1024)throw Error('私有存储超过 2 MB 上限，请先整理记录。');
 const stack=[[value,0]];let count=0;while(stack.length){const [v,depth]=stack.pop();if(++count>50000||depth>20)throw Error('私有存储结构过深。');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))throw Error('私有存储含不支持的字段。');stack.push([x,depth+1]);}}
 return text;
}
function decode(value,key){
 try{
  if(value?.format!==FORMAT||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error();
  for(const k of ['nonce','tag','payload'])if(typeof value[k]!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value[k]))throw Error();
  const nonce=Buffer.from(value.nonce,'base64'),tag=Buffer.from(value.tag,'base64');if(nonce.length!==12||tag.length!==16)throw Error();
  const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(Buffer.from(JSON.stringify([FORMAT,value.revision])));decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(Buffer.from(value.payload,'base64')),decipher.final()]);const data=JSON.parse(plain.toString());plain.fill(0);validate(data);return data;
 }catch{throw Error('原生存储认证失败或文件损坏，原文件保留。');}
}
export async function openStore({dir}={}){
 if(typeof dir!=='string'||!dir)throw Error('请指定私有状态目录。');dir=resolve(dir);if(opened.has(dir))throw Error('此原生存储已经在当前进程打开。');opened.add(dir);
 let key;
 try{
  await ensurePrivateDir(dir);const keyPath=join(dir,'native-vault.key'),file=join(dir,'native-vault.json');let encrypted;
  try{await assertPrivate(file);if((await lstat(file)).size>3*1024*1024)throw Error();encrypted=JSON.parse(await readFile(file,'utf8'));if(!encrypted||typeof encrypted!=='object'||Array.isArray(encrypted))throw Error();}catch(e){if(e.code!=='ENOENT')throw Error('原生存储文件读取异常或损坏，原文件保留。');}
  try{await assertPrivate(keyPath);if((await lstat(keyPath)).size!==32)throw Error('原生主密钥长度异常。');key=await readFile(keyPath);}catch(e){if(e.code!=='ENOENT')throw e;if(encrypted)throw Error('原生主密钥缺失，原存储文件保留。');key=randomBytes(32);await writePrivate(keyPath,key);}
  if(key.length!==32)throw Error('原生主密钥长度异常。');
  let data=encrypted?decode(encrypted,key):empty(),revision=encrypted?.revision||0,pending=Promise.resolve(),closed=false;
  async function save(next){const text=validate(next),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce),rev=revision+1;cipher.setAAD(Buffer.from(JSON.stringify([FORMAT,rev])));const bytes=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);await atomic(file,{format:FORMAT,revision:rev,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload:bytes.toString('base64')});revision=rev;data=next;}
  if(!encrypted)await save(data);
  return {
   snapshot(){if(closed)throw Error('原生存储已经关闭。');return structuredClone(data);},
   mutate(fn){if(closed)return Promise.reject(Error('原生存储已经关闭。'));const task=pending.then(async()=>{const draft=structuredClone(data);const result=await fn(draft);await save(draft);return result;});pending=task.catch(()=>{});return task;},
   async close(){if(closed)return;closed=true;await pending;key.fill(0);data=null;opened.delete(dir);},
  };
 }catch(error){key?.fill(0);opened.delete(dir);throw error;}
}
