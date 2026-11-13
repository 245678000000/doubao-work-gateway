import {same} from './core.mjs';
export function ingress({port,publicOrigin,proxyToken}={}){
  const local='http://127.0.0.1:'+port;
  if(!publicOrigin){if(proxyToken)throw Error('反代凭据需要搭配 HTTPS 外部地址。');return {origin:local,host:'127.0.0.1:'+port,remote:false,accepts:req=>req.headers.host==='127.0.0.1:'+port};}
  let url;try{url=new URL(publicOrigin);}catch{throw Error('外部地址格式无效。');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.origin!==publicOrigin)throw Error('外部地址需为不含路径的 HTTPS Origin。');
  if(typeof proxyToken!=='string'||!/^[A-Za-z0-9_-]{48,128}$/.test(proxyToken))throw Error('云端模式需要专用反代凭据。');
  return {origin:url.origin,host:url.host,remote:true,accepts:req=>req.headers.host===url.host&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&same(req.headers['x-doubao-proxy-token'],proxyToken)};
}
