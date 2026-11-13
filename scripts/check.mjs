import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const dir of ['.','native','public','scripts','test'])for(const name of await readdir(join(root,dir))){
 if(!/\.(?:mjs|js)$/.test(name))continue;
 const p=spawnSync(process.execPath,['--check',join(root,dir,name)],{stdio:'inherit',windowsHide:true});
 if(p.status!==0)process.exit(p.status||1);
}
