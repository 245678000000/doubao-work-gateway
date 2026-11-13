import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertPrivate} from './private-files.mjs';
import {atomic} from './core.mjs';
import {jsonShape,label,validId} from './transfers.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
function parse(value){
 jsonShape(value);
 if(!value||typeof value!=='object'||(value.schema!==undefined&&value.schema!=='doubao-work-nodes/v1')||(value.version!==undefined&&value.version!==1)||!Array.isArray(value.nodes)||!value.nodes.length||value.nodes.length>50)throw fail(400,'请选择接口节点 JSON，每次 1–50 个节点；账号备份请在工作台导入。');
 const seen=new Set(),ids=new Set();return value.nodes.map(n=>{
  if(!n||typeof n.name!=='string'||!n.name.trim()||n.name.length>64||/[\u0000-\u001f\u007f]/.test(n.name)||typeof n.baseUrl!=='string')throw fail(400,'每个节点需要名称和 Base URL。');
  let url;try{url=new URL(n.baseUrl);}catch{throw fail(400,'节点 Base URL 格式不正确。');}
  if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw fail(400,'远端节点请使用 HTTPS；本机节点可使用 HTTP。地址中不要携带凭据或查询参数。');
  if(n.apiKey!==undefined&&(typeof n.apiKey!=='string'||n.apiKey.length>512||n.apiKey&&(!/^[\x21-\x7e]+$/.test(n.apiKey)||/["\\]/.test(n.apiKey))))throw fail(400,'节点 Key 请使用 512 字符以内的单行内容。');
  if(n.models!==undefined&&(!Array.isArray(n.models)||n.models.length>100||n.models.some(m=>typeof m!=='string'||!m||m.length>160||/[\u0000-\u001f\u007f]/.test(m))))throw fail(400,'模型请使用最多 100 个模型 ID。');
  if(n.id!==undefined&&n.id!=='current'){if(!validId(n.id)||ids.has(n.id))throw fail(400,'节点标识无效或重复。');ids.add(n.id);}
  const baseUrl=url.href.replace(/\/+$/,''),name=n.name.trim(),identity=name+'\n'+baseUrl;
  if(seen.has(identity))throw fail(400,'文件内有同名同地址的重复节点。');seen.add(identity);
  return {name,baseUrl,models:[...new Set(n.models||[])],...(n.apiKey!==undefined?{apiKey:n.apiKey}:{}),...(validId(n.id)&&n.id!=='current'?{id:n.id}:{})};
 });
}
const view=n=>({id:n.id,name:n.name,baseUrl:n.baseUrl,models:n.models,hasKey:!!n.apiKey,masked:n.apiKey?'•••• '+n.apiKey.slice(-4):'未保存 Key'});
export async function createNodeProfiles({path,now=Date.now}){
 let rows=[];
 try{await assertPrivate(path);const data=JSON.parse(await readFile(path,'utf8'));if(data?.schema!=='doubao-work-nodes/v1'||data.version!==1||!Array.isArray(data.nodes))throw Error();rows=data.nodes.length?parse(data):[];if(rows.some(n=>!n.id))throw Error();}catch(error){if(error.code!=='ENOENT')throw fail(409,'节点配置读取异常，请保留文件并检查格式与权限。');}
 let pending=Promise.resolve();const locked=fn=>{const p=pending.then(fn);pending=p.catch(()=>{});return p;},previews=new Map();
 const sameNode=(a,b)=>a.id&&a.id===b.id||a.name===b.name&&a.baseUrl===b.baseUrl;
 const purge=()=>{for(const [id,p] of previews)if(p.expiresAt<=now())previews.delete(id);};
 async function save(next){await atomic(path,{schema:'doubao-work-nodes/v1',version:1,nodes:next});rows=next;}
 return {
  async list(){return {nodes:rows.map(view)};},
  async preview(value){const nodes=parse(value);purge();if(previews.size>=3)previews.delete(previews.keys().next().value);const token=randomUUID(),expiresAt=now()+600_000;previews.set(token,{nodes,expiresAt});return {token,expiresAt,total:nodes.length,duplicates:nodes.filter(n=>rows.some(r=>sameNode(n,r))).length,nodes:nodes.map(n=>({...view(n),duplicate:rows.some(r=>sameNode(n,r))}))};},
  async commit(token){return locked(async()=>{purge();const p=previews.get(token);if(!p)throw fail(409,'节点预览已失效，请重新选择文件。');previews.delete(token);const next=structuredClone(rows);let added=0,updated=0;
   for(const n of p.nodes){const i=next.findIndex(r=>sameNode(n,r));if(i<0){next.push({...n,id:randomUUID(),apiKey:n.apiKey||''});added++;}else{next[i]={...next[i],...n,id:next[i].id,apiKey:n.apiKey===undefined?next[i].apiKey:n.apiKey};updated++;}}
   if(next.length>50)throw fail(409,'节点总数最多 50 个，请先整理已有配置。');await save(next);return {added,updated};});},
  async export({ids,includeKeys=false}={}){if(typeof includeKeys!=='boolean'||ids!==undefined&&(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>!validId(id))))throw fail(400,'节点导出参数不正确。');const list=rows.filter(n=>!ids||ids.includes(n.id));if(!list.length||ids&&list.length!==new Set(ids).size)throw fail(409,'请选择现有节点。');return {schema:'doubao-work-nodes/v1',version:1,exportedAt:now(),nodes:list.map(({apiKey,...n})=>({...n,...(includeKeys?{apiKey}:{} )}))};},
  async remove(id){if(!validId(id))throw fail(400,'节点标识无效。');return locked(async()=>{if(!rows.some(n=>n.id===id))throw fail(404,'节点已不存在。');await save(rows.filter(n=>n.id!==id));return {ok:true};});},
  clear(){previews.clear();},
 };
}
