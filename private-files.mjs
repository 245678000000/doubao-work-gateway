import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,lstat,chmod,open,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const run=promisify(execFile),cache=new Map();
const ps=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const inspectScript=`$ErrorActionPreference='Stop';$p=$env:DW_PRIVATE_PATH;$a=Get-Acl -LiteralPath $p;$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;@{sid=$sid;owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;rules=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object{@{identity=$_.IdentityReference.Value;allow=($_.AccessControlType -eq 'Allow');rights=[long]$_.FileSystemRights}})}|ConvertTo-Json -Compress -Depth 4`;
const secureScript=`$ErrorActionPreference='Stop';$p=$env:DW_PRIVATE_PATH;$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;$system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18');$dir=$env:DW_PRIVATE_KIND -eq 'directory';if($dir){$acl=New-Object System.Security.AccessControl.DirectorySecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{$acl=New-Object System.Security.AccessControl.FileSecurity;$inherit=[System.Security.AccessControl.InheritanceFlags]::None};$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($who in @($sid,$system)){$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($who,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $p -AclObject $acl;'PRIVATE_OK'`;
export function privateAcl(data){
 if(!data||typeof data.sid!=='string'||!Array.isArray(data.rules))return false;
 const allowed=new Set([data.sid,'S-1-5-18','S-1-5-32-544']);
 return allowed.has(data.owner)&&data.rules.some(r=>r.allow&&r.identity===data.sid)&&data.rules.every(r=>r.allow===false||r.allow===true&&allowed.has(r.identity));
}
async function powershell(script,path,directory=false){try{return (await run(ps,['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,DW_PRIVATE_PATH:resolve(path),DW_PRIVATE_KIND:directory?'directory':'file'},windowsHide:true,timeout:12000,maxBuffer:128*1024})).stdout.trim();}catch{throw Error('Windows 私有文件权限检查未完成，请检查当前用户对运行目录的控制权限。');}}
export async function assertPrivate(path,{directory=false}={}){
 const info=await lstat(path);if(info.isSymbolicLink()||!(directory?info.isDirectory():info.isFile()))throw Error('私有路径类型异常。');
 if(process.platform!=='win32'){if(info.mode&0o077)throw Error('私有文件或目录权限过宽。');return;}
 const key=resolve(path),sig=[info.ino,info.mtimeMs,info.ctimeMs,info.size].join(':'),old=cache.get(key);
 if(old?.sig===sig&&old.until>Date.now())return;
 const data=JSON.parse(await powershell(inspectScript,path));if(!privateAcl(data))throw Error('Windows 私有文件存在其他用户的访问权限，请使用 secure-cloud 或收紧目录 ACL。');
 cache.set(key,{sig,until:Date.now()+10000});if(cache.size>256)cache.delete(cache.keys().next().value);
}
export async function securePrivate(path,{directory=false}={}){
 if(process.platform==='win32'){if(await powershell(secureScript,path,directory)!=='PRIVATE_OK')throw Error('私有文件权限设置未完成。');cache.delete(resolve(path));}
 else await chmod(path,directory?0o700:0o600);
}
export async function ensurePrivateDir(path){await mkdir(path,{recursive:true,mode:0o700});await securePrivate(path,{directory:true});}
export async function writePrivate(path,value,{flag='wx'}={}){
 const file=await open(path,flag,0o600);try{await securePrivate(path);await file.writeFile(value);await file.sync();}catch(error){await file.close();if(flag==='wx')await unlink(path).catch(()=>{});throw error;}await file.close();
}
