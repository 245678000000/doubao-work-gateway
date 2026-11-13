import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {openStore} from './store.mjs';
import {createNativeServices} from './services.mjs';
import {createModelHandler} from './model-api.mjs';
import {createNativePanel} from './panel.mjs';
import {createDoubaoClient} from './doubao-client.mjs';
import {ingress} from '../ingress.mjs';

export async function startNative({dir,tmpRoot=join(dir,'browser-tmp'),modelPort=43861,panelPort=43862,
 client=createDoubaoClient(),publicOrigin,proxyToken,bootstrapKey,timer=true,now=Date.now,browserLoginOptions,cloudConfigPath,cloudFetch}){
 for(const p of [modelPort,panelPort])if(!Number.isInteger(p)||p<0||p>65535||p>0&&p<1024)throw Error('网关端口有误。');
 if(modelPort&&modelPort===panelPort)throw Error('面板与模型 API 需要不同端口。');
 // Validate cloud configuration before writing data or listening.
 const remote=publicOrigin?ingress({port:panelPort,publicOrigin,proxyToken}):null;
 if(proxyToken&&!remote)throw Error('云端反代凭据需要配套 HTTPS 地址。');
 const store=await openStore({dir:resolve(dir)}),abort=new AbortController();
 let services,panel,modelServer,panelServer,tick,interval,stopping;
 const sockets=new Set();
 function listen(server,port){
  server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
  server.on('clientError',(_e,s)=>s.destroy());
  server.requestTimeout=30000;server.headersTimeout=15000;server.maxHeadersCount=60;
  return new Promise((ok,bad)=>{server.once('error',bad);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',bad);ok();});});
 }
 const portOf=server=>server?.address()?.port;
 const origin=server=>'http://127.0.0.1:'+portOf(server);
 function stop(){
  if(stopping)return stopping;
  stopping=(async()=>{
   clearInterval(interval);abort.abort();services?.close();
   const listeners=[modelServer,panelServer].filter(Boolean).map(s=>new Promise(r=>s.close(r)));
   for(const socket of sockets)socket.destroy();
   try{await panel?.dispose();await tick;await Promise.all(listeners);}
   finally{client.close?.();await store.close();}
  })();return stopping;
 }
 try{
  services=await createNativeServices({store,client,now,bootstrapKey});
  modelServer=createServer(createModelHandler({services,shutdown:abort.signal,
   accepts:req=>req.headers.host==='127.0.0.1:'+portOf(modelServer)||!!remote?.accepts(req)}));
  // Keep both listeners gated until startup succeeds.
  await listen(modelServer,modelPort);
  panel=await createNativePanel({dir,tmpRoot,services,originForPort:()=>portOf(panelServer),modelOrigin:()=>origin(modelServer),publicOrigin,proxyToken,shutdown:abort.signal,
   browserLoginOptions,cloudConfigPath,cloudFetch});
  panelServer=createServer(panel.handler);
  await listen(panelServer,panelPort);
  if(timer){interval=setInterval(()=>{if(!tick)tick=services.tick({signal:abort.signal}).catch(()=>{}).finally(()=>{tick=null;});},25000);interval.unref();}
  return {services,stop,modelOrigin:origin(modelServer),panelOrigin:origin(panelServer),modelPort:portOf(modelServer),panelPort:portOf(panelServer)};
 }catch(e){await stop();throw e;}
}
