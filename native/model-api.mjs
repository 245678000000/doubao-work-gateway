import {randomUUID} from 'node:crypto';
import {once} from 'node:events';

const fail=(status,message,type='invalid_request_error')=>Object.assign(Error(message),{status,type});
export function sendJson(res,status,value){
 if(res.destroyed)return;
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(value));
}
export async function readJson(req,limit=262144){
 if((req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='application/json')throw fail(415,'请使用 application/json。');
 if(Number(req.headers['content-length'])>limit)throw fail(413,'请求体过大。');
 const chunks=[];let len=0;
 for await(const c of req.iterator({destroyOnReturn:false})){len+=c.length;if(len>limit){req.resume();throw fail(413,'请求体过大。');}chunks.push(c);}
 let v;try{v=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'JSON 请求格式有误。');}
 if(!v||typeof v!=='object'||Array.isArray(v))throw fail(400,'请提交 JSON 对象。');
 return v;
}
export function parseChat(v){
 if(typeof v.model!=='string'||!v.model||v.model.length>160)throw fail(400,'请提供模型 ID。');
 if(v.stream!==undefined&&typeof v.stream!=='boolean')throw fail(400,'stream 应为布尔值。');
 if(v.tools!==undefined||v.functions!==undefined||v.tool_choice!==undefined||v.response_format&&v.response_format.type!=='text'||v.n!==undefined&&v.n!==1)
  throw fail(400,'此版本仅支持单路纯文本；工具调用和结构化输出尚未接入。');
 if(!Array.isArray(v.messages)||v.messages.length<1||v.messages.length>100)throw fail(400,'请提供 1–100 条消息。');
 const messages=v.messages.map(m=>{
  if(!['system','developer','user','assistant'].includes(m?.role)||m.tool_calls)throw fail(400,'此版本仅支持文本对话角色。');
  const c=m.content;
  const content=Array.isArray(c)&&c.every(p=>p?.type==='text'&&typeof p.text==='string')?c.map(p=>p.text).join('\n'):c;
  if(typeof content!=='string')throw fail(400,'消息正文须为文本。');
  return {role:m.role,content};
 });
 if(!messages.some(m=>m.role==='user'&&m.content.trim()))throw fail(400,'至少需要一条非空用户消息。');
 return {model:v.model,messages,stream:v.stream===true};
}
function envelope(e,id){
 const status=Number.isInteger(e?.status)&&e.status>=400&&e.status<=599?e.status:502;
 const known=typeof e?.type==='string';
 const code=e?.upstream_code;
 return {status,body:{error:{message:known?e.message:'豆包工作请求未完成，请检查网关及账号状态。',
  type:known?e.type:'upstream_error',...(Number.isSafeInteger(code)?{code,upstream_code:code}:{}),request_id:id}}};
}
export function createModelHandler({services,accepts,shutdown}){
 return async(req,res)=>{
  const id='dw-'+randomUUID();
  res.setHeader('X-Request-Id',id);
  const stop=new AbortController(),signal=shutdown?AbortSignal.any([shutdown,stop.signal]):stop.signal;
  const disconnect=()=>{if(!res.writableEnded)stop.abort();};
  res.once('close',disconnect);
  try{
   if(!accepts(req)||req.headers.origin||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'模型接口不接受此请求来源。');
   if(!['/v1/models','/v1/chat/completions'].includes(req.url))throw fail(404,'未找到该模型接口。');
   const match=/^Bearer ([A-Za-z0-9_-]{16,256})$/i.exec(req.headers.authorization||''),key=match&&services.keys.authenticate(match[1]);
   if(!key)throw fail(401,'API Key 无效或已停用。','invalid_api_key');
   const ids=services.catalog().filter(m=>!key.allowedModels.length||key.allowedModels.includes(m));
   if(req.method==='GET'&&req.url==='/v1/models')return sendJson(res,200,{object:'list',data:ids.map(id=>({id,object:'model',owned_by:'doubaowork'}))});
   if(req.method!=='POST'||req.url!=='/v1/chat/completions')throw fail(405,'请求方法有误。');
   const body=parseChat(await readJson(req));
   if(!ids.includes(body.model))throw fail(404,'模型未接入或不在此 Key 的可用范围内。','model_not_found');
   const idInfo={id:'chatcmpl-'+id,created:Math.floor(Date.now()/1000),model:body.model};
   const chunk=(delta,finish_reason=null)=>({...idInfo,object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]});
   async function write(v){signal.throwIfAborted();if(!res.write('data: '+JSON.stringify(v)+'\n\n'))await once(res,'drain',{signal});}
   let text='',reasoning='',size=0;
   for await(const delta of services.chat(body,{signal,requestId:id})){
    if((size+=(delta.content||delta.reasoning_content).length)>16*1024*1024)throw fail(502,'输出超过网关大小限制。','upstream_error');
    if(!body.stream){text+=delta.content||'';reasoning+=delta.reasoning_content||'';continue;}
    if(!res.headersSent){
     res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
     await write(chunk({role:'assistant'}));
    }
    await write(chunk(delta));
   }
   signal.throwIfAborted();
   if(!size)throw fail(502,'豆包工作未返回文本。','upstream_empty_response');
   if(body.stream){await write(chunk({},'stop'));res.end('data: [DONE]\n\n');}
   else sendJson(res,200,{...idInfo,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:text,...(reasoning?{reasoning_content:reasoning}:{})},finish_reason:'stop'}]});
  }catch(e){
   if(signal.aborted||res.destroyed){res.destroy();return;}
   const err=envelope(e,id);
   if(res.headersSent)res.end('event: error\ndata: '+JSON.stringify(err.body)+'\n\n');
   else sendJson(res,err.status,err.body);
  }finally{res.removeListener('close',disconnect);}
 };
}
