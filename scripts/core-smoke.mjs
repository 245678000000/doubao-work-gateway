// Real platform core + signed provider pack, empty accounts, no model generation.
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {startGateway,requestControl} from '../launcher.mjs';
const free=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const manifest=JSON.parse(await readFile(resolve('.local/ci-runtime/manifest.json'),'utf8')),root=await mkdtemp(join(tmpdir(),'dw-core-smoke-'));let gateway;
try{
 const core=await free(),panel=await free();gateway=await startGateway({env:{...process.env,DW_RUNTIME_ROOT:root,DW_CORE_BIN:manifest.core,DW_PROVIDER_PACK:manifest.plugin,DW_UPSTREAM_PORT:String(core),DW_PANEL_PORT:String(panel)}});
 const r=await fetch('http://127.0.0.1:'+panel+'/api/snapshot',{headers:{'X-Doubao-Panel':'1'}});if(!r.ok)throw Error('实际核心面板快照未通过。');const snapshot=await r.json();if(snapshot.accounts.length!==0)throw Error('CI 应为空账号池。');
 if((await fetch('http://127.0.0.1:'+panel+'/api/snapshot')).status!==403)throw Error('来源保护检查未通过。');
 await requestControl(gateway.paths,'stop');await gateway.closed;console.log('Real core startup / provider / scoped key / panel / stop passed:',process.platform);
}finally{await gateway?.stop();await rm(root,{recursive:true,force:true});}
