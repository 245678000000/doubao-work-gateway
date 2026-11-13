import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile, mkdir, access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createKeyManager} from './keys.mjs';
import {BrowserLogin} from './browser-login.mjs';
import {PROVIDER,dayTime,viewAccounts,dueAccounts,checkinView,readSettings,atomic,validTime,clip,same} from './core.mjs';

const assets = new URL('./public/', import.meta.url);
const staticFiles = {'/':['index.html','text/html; charset=utf-8'], '/ui.js':['ui.js','text/javascript; charset=utf-8'], '/view.mjs':['view.mjs','text/javascript; charset=utf-8'], '/style.css':['style.css','text/css; charset=utf-8'], '/doubao-work-avatar.png':['doubao-work-avatar.png','image/png']};
const media = 'application/json; charset=utf-8';
const fail = (status,message) => Object.assign(new Error(message),{status});
const onDisk = fileURLToPath(new URL('./.local/state/',import.meta.url));

export async function createPanel({dir=onDisk, upstreamPort=43861,port=43862, timer=true, loginLauncher, browserLoginOptions={}}={}) {
  if (![upstreamPort,port].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||upstreamPort===port) throw Error('端口配置无效。');
  const root = resolve(dir);
  await mkdir(root,{recursive:true,mode:0o700});
  const management = (await readFile(join(root,'panel-management.key'),'utf8')).trim();
  const modelKey = (await readFile(join(root,'probe-model.key'),'utf8')).trim();
  if (!/^dw-admin-[0-9a-f]{64}$/.test(management) || !/^sk-local-[0-9a-f]{48}$/.test(modelKey)) throw Error('请先运行本机启动脚本准备测试密钥。');
  const upstream = 'http://127.0.0.1:'+upstreamPort;
  const origin = 'http://127.0.0.1:'+port;
  const settingsPath=join(root,'doubao-panel-settings.json');
  let settings=await readSettings(settingsPath);
  let pending=Promise.resolve();
  let ticking=false;
  const inflight=new Set();
  const loginBinary=resolve(root,'../runtime/DoubaoAccountLogin.app/Contents/MacOS/doubao-login');
  let loginProcess=null, loginStarting=false;
  async function nativeLoginAvailable() {
    if(loginLauncher) return true;
    return process.platform==='darwin' && await access(loginBinary,constants.X_OK).then(()=>true,()=>false);
  }
  async function openLogin() {
    if(browserLogin.status().active) throw fail(409,'请先完成或取消当前浏览器登录。');
    if(loginStarting || loginProcess?.exitCode===null) return {opened:false,message:'独立登录窗口已经打开，请在该窗口继续。'};
    loginStarting=true;
    try {
      if(!await nativeLoginAvailable()) throw fail(409,'请先运行项目里的 add-account.command，准备独立登录助手。');
      if(loginLauncher) await loginLauncher();
      else await new Promise((resolve,reject)=>{
        const child=spawn(loginBinary,[root],{stdio:'ignore',detached:true,shell:false});
        child.once('error',()=>{loginProcess=null;reject(fail(503,'登录窗口启动失败，请运行 add-account.command。'));});
        child.once('spawn',()=>{loginProcess=child;child.unref();resolve();});
        child.once('exit',()=>{if(loginProcess===child)loginProcess=null;});
      });
      return {opened:true,message:'独立登录窗口已打开。完成登录后，点击窗口顶部的接入按钮。'};
    } finally {loginStarting=false;}
  }
  const locked=fn=>{
    const next=pending.then(fn);
    pending=next.catch(()=>{});
    return next;
  };
  async function request(path,{method='GET',body,model=false,ms=9000}={}) {
    let response;
    try {
      response=await fetch(upstream+path,{
        method,redirect:'error',signal:AbortSignal.timeout(ms),
        headers:{Authorization:'Bearer '+(model?modelKey:management),...(body?{'Content-Type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined,
      });
    } catch { throw fail(503,'本机转发核心暂不可达，请检查桌面网关是否在运行。'); }
    if (!response.ok) throw fail(response.status===401||response.status===403?503:502,
      response.status===401||response.status===403?'本机管理授权未就绪，请用启动脚本重新启动网关。':'网关未返回可用结果，请在桌面网关检查。');
    const json=await response.json().catch(()=>{throw fail(502,'网关响应格式异常。');});
    if (json.success===false) throw fail(502,'网关操作未成功。');
    return json.success===true?json.data:json;
  }
  const keys=createKeyManager({request,modelKey,management});
  async function accounts() {
    const data=await request('/api/accounts');
    return viewAccounts(data?.accounts,settings,[]);
  }
  const browserLogin=new BrowserLogin({
    ...browserLoginOptions,tmpRoot:resolve(root,'../tmp'),
    async importAccount(cookies) {
      const before=await accounts();
      const result=await request('/api/accounts',{method:'POST',body:{provider:PROVIDER,cookies},ms:40_000});
      const id=result?.account?.id;
      if(typeof id!=='string')throw Error('账号核验结果异常。');
      const account=(await accounts()).find(a=>a.id===id&&a.available);
      if(!account)throw Error('账号尚未确认接入。');
      // The upstream plugin always returns created:true, including re-logins.
      return {name:account.name,updated:before.some(a=>a.id===id)};
    },
  });
  async function loginStatus(){
    return {...browserLogin.status(),browsers:await browserLogin.options(),nativeAvailable:await nativeLoginAvailable()};
  }
  async function checkin(id,trigger) {
    if (inflight.has(id)) throw fail(409,'这个账号已有一次签到正在处理。');
    inflight.add(id);
    try {
      const account=(await accounts()).find(a=>a.id===id);
      if (!account) throw fail(404,'未找到这个豆包工作账号。');
      if (!account.available) throw fail(409,'该账号当前不可用，请重新登录。');
      if (account.checked) return {status:'done',message:'今日已领取，未重复提交。'};
      const current=dayTime();
      const accepted=await locked(async()=>{
        if (trigger==='schedule' && !dueAccounts(settings,[{...account,auto:settings.accounts[id]===true}]).length) return false;
        const attempts=Object.fromEntries(Object.entries(settings.attempted).filter(([,r])=>r?.day===current.day));
        const next={...settings,attempted:{...attempts,[id]:{day:current.day,status:'submitting',trigger,at:Date.now()}}};
        await atomic(settingsPath,next); settings=next;
        return true;
      });
      if (!accepted) return {status:'skipped',message:'当前无需自动签到。'};
      let result;
      try {result=checkinView(await request('/api/accounts/checkin',{method:'POST',body:{id},ms:40_000}));}
      catch {result={status:'unknown',message:'请求结果待核对。自动调度今天不会再次提交。'};}
      await locked(async()=>{
        const next={...settings,attempted:{...settings.attempted,[id]:{day:current.day,status:result.status,trigger,at:Date.now()}}};
        await atomic(settingsPath,next); settings=next;
      });
      return result;
    } finally { inflight.delete(id); }
  }
  async function tick() {
    if (ticking || !settings.enabled || dayTime().time<settings.time) return;
    ticking=true;
    try {
      for (const a of dueAccounts(settings,await accounts())) {
        try { await checkin(a.id,'schedule'); } catch { process.stderr.write('一次定时签到未完成，请检查本机控制台。\n'); }
      }
    } catch { /* Wait for local gateway; no remote action was started. */ }
    finally { ticking=false; }
  }
  async function snapshot() {
    const [list,catalog,usage,records,plugins] = await Promise.all([
      request('/api/accounts'),request('/v1/models',{model:true}).catch(()=>null),
      request('/api/accounts/usage/snapshot').catch(()=>null),
      request('/api/checkin-records?provider=doubaowork&limit=60').catch(()=>null),
      request('/api/plugins'),
    ]);
    const providerReady=Array.isArray(plugins?.packs)&&plugins.packs.some(p=>p.enabled===true&&p.host?.running===true&&
      Array.isArray(p.providers)&&p.providers.some(v=>v.id===PROVIDER&&v.enabled===true&&v.loaded===true));
    if(!providerReady) throw fail(503,'豆包工作适配器尚未运行。账号数据保留在本机，请在底层网关的插件页重新启用已安装插件，再返回刷新。');
    const {day}=dayTime();
    const data=viewAccounts(list?.accounts,settings,usage?.results).map(a=>({
      ...a, attempt:settings.attempted[a.id]?.day===day ? settings.attempted[a.id].status : '',
    }));
    return {accounts:data, models:(Array.isArray(catalog?.data)?catalog.data:[]).filter(x=>x?.owned_by===PROVIDER&&typeof x.id==='string').map(x=>clip(x.id,160)),
      records:(Array.isArray(records?.records)?records.records:[]).filter(r=>r.providerId?r.providerId===PROVIDER:!r.provider||[PROVIDER,'豆包工作'].includes(r.provider)).map(r=>({at:Number(r.ts)||0,source:clip(r.source,25),
        outcome:clip(r.outcome,30),name:clip(r.accountName||r.name,60)})),
      scheduler:{enabled:settings.enabled,time:settings.time},apiBase:upstream+'/v1',
      updatedAt:Date.now(),loginAvailable:(await browserLogin.options()).length>0||await nativeLoginAvailable(),
      availability:{models:catalog!==null,quota:usage!==null,records:records!==null}};
  }
  function json(res,status,body){
    res.writeHead(status,{'Content-Type':media});
    res.end(JSON.stringify(body));
  }
  async function body(req) {
    if ((req.headers['content-type']||'').split(';')[0]!=='application/json') throw fail(415,'请求格式不正确。');
    const chunks=[]; let len=0;
    for await (const chunk of req) {len+=chunk.length; if(len>8192) throw fail(413,'请求体过大。'); chunks.push(chunk);}
    const value=JSON.parse(Buffer.concat(chunks).toString());
    if(!value||typeof value!=='object'||Array.isArray(value)) throw fail(400,'请求格式不正确。');
    return value;
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if(req.headers.host!=='127.0.0.1:'+port || req.headers['sec-fetch-site']==='cross-site')
        throw fail(403,'只接受本机面板请求。');
      const path=req.url;
      if(req.method==='GET' && Object.hasOwn(staticFiles,path)){
        const [file,mime]=staticFiles[path];
        res.writeHead(200,{'Content-Type':mime});
        createReadStream(new URL(file,assets)).on('error',()=>res.destroy()).pipe(res);
        return;
      }
      if (req.headers['x-doubao-panel']!=='1' || (req.headers.origin && req.headers.origin!==origin)) throw fail(403,'面板请求验证失败。');
      if(req.method==='GET'&&path==='/api/keys') return json(res,200,await keys.list());
      if(req.method==='GET'&&path==='/api/login-status') return json(res,200,await loginStatus());
      if(req.method==='GET'&&path==='/api/snapshot') return json(res,200,await snapshot());
      if(req.method!=='POST' || req.headers.origin!==origin) throw fail(403,'面板操作来源不匹配。');
      if(path==='/api/key') return json(res,200,{key:modelKey});
      const data=await body(req);
      if(path==='/api/keys/create')return json(res,200,await keys.create(data));
      if(path==='/api/keys/update')return json(res,200,await keys.update(data));
      if(path==='/api/keys/reveal')return json(res,200,await keys.reveal(data.id));
      if(path==='/api/login') {
        if(data.mode==='native')return json(res,200,await openLogin());
        if(data.mode!==undefined&&data.mode!=='browser')throw fail(400,'请选择浏览器登录或备用窗口。');
        if(data.browserId!==undefined&&!['chrome','edge'].includes(data.browserId))throw fail(400,'请选择已安装的 Chrome / Edge。');
        if(loginStarting||loginProcess?.exitCode===null)throw fail(409,'请先关闭备用登录窗口，再使用浏览器登录。');
        await browserLogin.start(data.browserId);
        return json(res,200,await loginStatus());
      }
      if(path==='/api/login/cancel') {await browserLogin.cancel();return json(res,200,await loginStatus());}
      if(path==='/api/schedule') {
        if(typeof data.enabled!=='boolean'||!validTime(data.time)) throw fail(400,'请选择有效的北京时间。');
        await locked(async()=>{const next={...settings,enabled:data.enabled,time:data.time}; await atomic(settingsPath,next); settings=next;});
        return json(res,200,{enabled:settings.enabled,time:settings.time});
      }
      if(!['/api/auto','/api/enable','/api/checkin','/api/quota','/api/alias'].includes(path)) throw fail(404,'未找到该操作。');
      const id=data.id;
      if(typeof id!=='string' || !/^[\w-]{1,128}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw fail(400,'账号标识无效。');
      if(!(await accounts()).some(a=>same(a.id,id))) throw fail(404,'未找到这个豆包工作账号。');
      if(path==='/api/alias') {
        if(typeof data.alias!=='string'||data.alias.length>32||/[\u0000-\u001f\u007f]/.test(data.alias)) throw fail(400,'备注名请使用 32 字以内的单行文字。');
        await locked(async()=>{const next={...settings,aliases:{...settings.aliases,[id]:data.alias.trim()}};await atomic(settingsPath,next);settings=next;});
        return json(res,200,{ok:true});
      }
      if(path==='/api/checkin') return json(res,200,await checkin(id,'manual'));
      if(path==='/api/quota'){
        const report=await request('/api/accounts/usage?id='+encodeURIComponent(id),{ms:30_000});
        return json(res,200,{ok:!!report?.results?.find(r=>r.id===id&&r.usage&&!r.error)});
      }
      if(typeof data.enabled!=='boolean') throw fail(400,'开关参数无效。');
      if(path==='/api/enable') await request('/api/accounts/'+encodeURIComponent(id),{method:'PATCH',body:{enabled:data.enabled}});
      else await locked(async()=>{
        const next={...settings,accounts:{...settings.accounts,[id]:data.enabled}};
        await atomic(settingsPath,next); settings=next;
      });
      return json(res,200,{ok:true});
    } catch(error){
      if(!res.headersSent) json(res,error.status??(error instanceof SyntaxError?400:500),{error:error.status?error.message:'处理失败，请刷新并重试。'});
      else res.end();
    }
  });
  server.on('clientError',(_error,socket)=>socket.destroy());
  const interval=timer?setInterval(()=>{void tick();},25_000):null;
  interval?.unref();
  const dispose=async()=>{clearInterval(interval);await browserLogin.dispose();};
  server.once('close',()=>{void dispose();});
  return {server,tick,dispose};
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const port=Number(process.env.DW_PANEL_PORT||43862);
  const {server,dispose}=await createPanel({dir:process.env.DW_STATE_DIR||onDisk,port});
  let stopping=false;
  async function stop(){if(stopping)return;stopping=true;server.close();server.closeIdleConnections();await dispose();}
  process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
  server.listen(port,'127.0.0.1',()=>console.log('豆包工作控制台：http://127.0.0.1:'+port));
}
