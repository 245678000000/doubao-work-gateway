// Fetch only pinned official release assets into ignored CI runtime storage.
import {mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),version='3.4.2',windows=process.platform==='win32';
if(!['win32','linux'].includes(process.platform)||process.arch!=='x64')throw Error('此 CI 核心准备脚本用于 Windows / Linux x64。');
const dir=resolve('.local/ci-runtime');await mkdir(dir,{recursive:true});
const asset=windows?'agent2api-server-windows-amd64.zip':'agent2api-server-linux-amd64.tar.gz';
const plugin='agent2api-providers-'+version+(windows?'-x86_64-pc-windows-msvc.zip':'-x86_64-unknown-linux-gnu.zip');
async function download(repo,name){const r=await fetch('https://github.com/'+repo+'/releases/download/v'+version+'/'+name,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('官方依赖下载未完成：'+name);const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>200*1024*1024)throw Error('依赖大小超出预期。');await writeFile(join(dir,name),bytes);return bytes;}
const bytes=await download('aimod-cc/Agent2API',asset),checksum=await download('aimod-cc/Agent2API',asset+'.sha256');
const expected=checksum.toString().match(/\b[0-9a-f]{64}\b/i)?.[0]?.toLowerCase();if(!expected||createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('转发核心 SHA-256 校验失败。');
await download('Agent2Builder/agent2api-providers-releases',plugin);
if(windows)await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop';Expand-Archive -LiteralPath $env:DW_CI_ARCHIVE -DestinationPath $env:DW_CI_RUNTIME -Force"],{env:{...process.env,DW_CI_ARCHIVE:join(dir,asset),DW_CI_RUNTIME:dir},windowsHide:true});
else await run('tar',['-xzf',join(dir,asset),'-C',dir]);
const core=join(dir,'agent2api-server'+(windows?'.exe':''));if(!windows)await chmod(core,0o755);
await writeFile(join(dir,'manifest.json'),JSON.stringify({core,plugin:join(dir,plugin),version}));
console.log('Pinned core and provider pack prepared:',process.platform,version);
