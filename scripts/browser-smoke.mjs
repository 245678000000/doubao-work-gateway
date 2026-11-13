// CI-only protocol smoke: blank page, temporary profile, no credentials or provider traffic.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {availableBrowsers,launchIsolatedBrowser} from '../browser-login.mjs';
import {securePrivate} from '../private-files.mjs';
const [browser]=await availableBrowsers(process.platform,homedir(),{...process.env,DISPLAY:process.env.DISPLAY||':99'});
if(!browser)throw Error('CI runner 未找到 Chrome / Edge。');
const profile=await mkdtemp(join(tmpdir(),'dw-protocol-smoke-'));await securePrivate(profile,{directory:true});let handle;
try{
 handle=await launchIsolatedBrowser(browser,profile,{spawnProcess:(path,args,options)=>spawn(path,[...args.slice(0,-1),'--headless=new','about:blank'],options)});
 await handle.cookies();console.log('Browser pipe smoke passed:',process.platform,browser.name);
}finally{await handle?.dispose();await rm(profile,{recursive:true,force:true});}
