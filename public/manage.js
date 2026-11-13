// Account backups and connection profiles. No third-party scripts or network targets.
export function mountManagement({api,act,show,load,getSnapshot,renderAccounts}){
 const $=id=>document.getElementById(id),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const selected=new Set();let visible=[],importKind='accounts',previewToken='',exportKind='accounts',exportIds,editingNode='',nodeRows=[],importReading=false;
 const dialog=id=>{if(!$(id).open)$(id).showModal();};
 function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})),a=el('a');a.href=url;a.download=name+'-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function selection(){
  const all=getSnapshot()?.accounts||[];for(const id of selected)if(!all.some(a=>a.id===id))selected.delete(id);
  $('selection-count').textContent=selected.size?'已选择 '+selected.size+' 个账号':'未选择账号';
  for(const id of ['run-batch','export-selected','clear-selection'])$(id).disabled=!selected.size;
  $('select-visible').checked=!!visible.length&&visible.every(a=>selected.has(a.id));$('select-visible').indeterminate=visible.some(a=>selected.has(a.id))&&!$('select-visible').checked;
 }
 function decorateAccount(article,top,a){
  article.classList.toggle('is-selected',selected.has(a.id));const box=el('input');box.type='checkbox';box.checked=selected.has(a.id);box.setAttribute('aria-label','选择 '+a.name);box.className='account-select';
  box.addEventListener('change',()=>{if(box.checked&&selected.size>=20){box.checked=false;show('每次最多选择 20 个账号。',true);return;}box.checked?selected.add(a.id):selected.delete(a.id);article.classList.toggle('is-selected',box.checked);selection();});top.prepend(box);
 }
 function afterAccounts(items){visible=items;selection();$('node-current-base').textContent=getSnapshot()?.apiBase||'正在读取地址…';}
 $('select-visible').addEventListener('change',()=>{if($('select-visible').checked){for(const a of visible){if(selected.size>=20)break;selected.add(a.id);}}else for(const a of visible)selected.delete(a.id);renderAccounts();});
 $('clear-selection').addEventListener('click',()=>{selected.clear();renderAccounts();});
 $('account-sort').addEventListener('change',renderAccounts);
 function openImport(kind){importKind=kind;previewToken='';$('import-file').value='';$('import-file-name').textContent='选择 JSON 文件';$('import-title').textContent=kind==='accounts'?'导入账号 JSON':'导入接口节点 JSON';$('import-description').textContent=kind==='accounts'?'支持原生版和旧版账号备份。每次最多 20 个，仅接入豆包工作；导入后需逐个核验。':'支持 doubao-work-nodes/v1，每次最多 50 个。重复节点会更新；文件未含 Key 时保留原 Key。节点配置与账号登录分开。';for(const id of ['import-preview','import-error','import-result'])$(id).hidden=true;$('confirm-import').disabled=true;$('import-duplicates').value='skip';dialog('import-dialog');}
 async function readFile(file){if(!file||importReading)return;previewToken='';$('confirm-import').disabled=true;$('import-preview').hidden=true;$('import-result').hidden=true;$('import-error').hidden=true;$('import-file-name').textContent=file.name;if(file.size>512*1024){$('import-file').value='';$('import-error').hidden=false;$('import-error').textContent='JSON 文件请控制在 512 KB 以内。';return;}
  previewToken='';$('confirm-import').disabled=true;$('import-preview').hidden=true;$('import-error').hidden=true;$('import-result').hidden=true;$('import-file-name').textContent=file.name;
  importReading=true;await act($('import-file'),async()=>{let value;try{value=JSON.parse(await file.text());}catch{throw Error('JSON 格式不正确，请检查文件；内容未展示，也未导入。');}
   const data=await api(importKind==='accounts'?'/api/backup/preview':'/api/nodes/preview',value);previewToken=data.token;$('import-summary').textContent=data.total+' 个'+(importKind==='accounts'?'账号':'节点')+' · '+data.duplicates+' 个重复';
   $('duplicate-choice').hidden=importKind!=='accounts'||!data.duplicates;const rows=$('import-rows');rows.replaceChildren();
   for(const item of data.accounts||data.nodes){const row=el('div','preview-row'),info=el('div');info.append(el('strong','',item.name));if(item.baseUrl)info.append(el('small','',item.baseUrl));row.append(info,el('span','badge '+(item.duplicate?'':'yes'),item.duplicate?'已存在':'新增'));rows.append(row);}
   $('import-preview').hidden=false;
  },false,$('import-error'));importReading=false;$('import-file').value='';$('confirm-import').disabled=!previewToken;
 }
 $('import-file').addEventListener('change',()=>{void readFile($('import-file').files?.[0]);});
 const zone=$('import-file').closest('.file-zone');for(const event of ['dragover','dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.toggle('drag-over',event==='dragover');if(event==='drop')void readFile(e.dataTransfer?.files?.[0]);});
 $('confirm-import').addEventListener('click',async()=>{if(!previewToken)return;const token=previewToken;previewToken='';$('import-preview').hidden=true;$('import-result').hidden=false;$('import-result').textContent='正在导入，请等待结果…';
  const ok=await act($('confirm-import'),async()=>{const result=await api(importKind==='accounts'?'/api/backup/import':'/api/nodes/import',{token,duplicates:$('import-duplicates').value});
   const text='导入完成：新增 '+result.added+'，更新 '+result.updated+(importKind==='accounts'?'，跳过 '+result.skipped+'，失败 '+result.failed:'')+'。';$('import-result').hidden=false;$('import-result').textContent=text;$('import-preview').hidden=true;await load();if(importKind==='nodes')await loadNodes();return text;
  },false,$('import-error'));if(!ok)$('import-result').hidden=true;$('confirm-import').disabled=true;
 });
 function updateExport(){const hasSecrets=exportKind==='accounts'||$('export-with-key').checked;$('export-ack-label').hidden=!hasSecrets;$('export-ack').required=hasSecrets;$('export-ack-label').querySelector('strong').textContent=exportKind==='accounts'?'我了解此文件含有账号登录凭据':'我了解此文件含有完整 API Key';}
 function openExport(kind,ids,current=false){exportKind=kind;exportIds=ids;$('export-title').textContent=kind==='accounts'?'导出账号备份':'导出接口节点';$('export-description').textContent=kind==='accounts'?(ids?'仅导出所选 '+ids.length+' 个账号。':'导出当前全部豆包工作账号。')+'不包含签到计划和管理员密钥。':'节点文件包含地址与模型 ID；默认不包含 Key。账号登录状态不在此文件中。';$('export-ack').checked=false;$('export-with-key').checked=false;$('export-with-key-label').hidden=kind!=='nodes';$('node-export-target-label').hidden=kind!=='nodes'||!!ids;$('node-export-target').value=current?'current':'saved';$('export-error').hidden=true;updateExport();dialog('export-dialog');}
 $('export-with-key').addEventListener('change',()=>{$('export-ack').checked=false;updateExport();});
 $('export-form').addEventListener('submit',event=>{event.preventDefault();$('export-error').hidden=true;void act($('confirm-export'),async()=>{
  const includeKeys=$('export-with-key').checked,confirmSecrets=$('export-ack').checked;if((exportKind==='accounts'||includeKeys)&&!confirmSecrets)throw Error('请先确认文件包含敏感凭据。');
  const payload=exportKind==='accounts'?{ids:exportIds,confirmSecrets}:{ids:exportIds,current:!exportIds&&$('node-export-target').value==='current',includeKeys,confirmSecrets};
  const data=await api(exportKind==='accounts'?'/api/backup/export':'/api/nodes/export',payload);download(data,exportKind==='accounts'?'doubao-accounts':'doubao-nodes');$('export-dialog').close();return exportKind==='accounts'||includeKeys?'JSON 已下载。文件含凭据，请存放到可信位置。':'节点 JSON 已下载，不含 API Key。';
 },false,$('export-error'));});
 $('import-accounts').addEventListener('click',()=>openImport('accounts'));$('export-accounts').addEventListener('click',()=>openExport('accounts'));
 $('export-selected').addEventListener('click',()=>openExport('accounts',[...selected]));$('import-nodes').addEventListener('click',()=>openImport('nodes'));$('export-nodes').addEventListener('click',()=>openExport('nodes',undefined,true));$('export-current-node').addEventListener('click',()=>openExport('nodes',undefined,true));
 const actionNames={enable:'启用转发',pause:'暂停转发','auto-on':'加入自动签到','auto-off':'移出自动签到'};let batch;
 $('run-batch').addEventListener('click',()=>{batch={ids:[...selected],action:$('batch-action').value};$('batch-description').textContent='对所选 '+batch.ids.length+' 个账号执行「'+actionNames[batch.action]+'」。'+(batch.action==='auto-on'?'每日计划总开关保持原样。':'其他账号保持原样。');$('batch-error').hidden=true;dialog('batch-dialog');});
 $('confirm-batch').addEventListener('click',()=>act($('confirm-batch'),async()=>{const r=await api('/api/accounts/batch',batch);$('batch-dialog').close();await load();return {text:'已完成 '+r.completed+' 个；待核对 '+r.unknown+' 个，未尝试 '+r.notAttempted+' 个。',warn:r.unknown>0||r.notAttempted>0};},false,$('batch-error')));
 function openNode(node){editingNode=node?.id||'';$('node-dialog-title').textContent=node?'编辑接口节点':'添加接口节点';$('node-name').value=node?.name||'';$('node-url').value=node?.baseUrl||'';$('node-key').value='';$('node-models').value=(node?.models||[]).join('\n');$('node-error').hidden=true;dialog('node-dialog');}
 $('add-node').addEventListener('click',()=>openNode());$('node-dialog').addEventListener('close',()=>{$('node-key').value='';});
 $('node-form').addEventListener('submit',event=>{event.preventDefault();$('node-error').hidden=true;void act($('save-node'),async()=>{const node={name:$('node-name').value.trim(),baseUrl:$('node-url').value.trim(),models:$('node-models').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),...(editingNode?{id:editingNode}:{}),...($('node-key').value?{apiKey:$('node-key').value}:{})};const p=await api('/api/nodes/preview',{schema:'doubao-work-nodes/v1',version:1,nodes:[node]});await api('/api/nodes/import',{token:p.token});$('node-dialog').close();await loadNodes();return '节点配置已保存。';},false,$('node-error'));});
 async function loadNodes(){
  $('nodes-error').hidden=true;try{nodeRows=(await api('/api/nodes')).nodes;$('node-count').textContent=String(nodeRows.length);const list=$('nodes-list');list.replaceChildren();
   if(!nodeRows.length){const n=el('div','empty node-empty');n.append(el('strong','','还没有保存的节点'),el('p','','导出当前网关配置，或导入已有 JSON。节点与账号各自独立。'));list.append(n);}
   for(const n of nodeRows){const row=el('article','node-row'),info=el('div','node-info'),title=el('div','node-title');title.append(el('strong','',n.name),el('span','badge',n.models.length+' 个模型'));info.append(title,el('code','',n.baseUrl),el('small','',n.hasKey?'Key 已保存 · '+n.masked:'未保存 Key · 可在客户端填写'));const actions=el('div','node-actions');for(const [name,fn] of [['复制地址',()=>navigator.clipboard.writeText(n.baseUrl).then(()=>show('节点地址已复制。'))],['编辑',()=>openNode(n)],['导出',()=>openExport('nodes',[n.id])]]){const b=el('button','secondary small',name);b.type='button';b.addEventListener('click',()=>act(b,fn,false));actions.append(b);}row.append(info,actions);list.append(row);}
  }catch(error){$('nodes-error').hidden=false;$('nodes-error').textContent=error.message;}
 }
 $('refresh-nodes').addEventListener('click',()=>act($('refresh-nodes'),loadNodes,false));
 return {decorateAccount,afterAccounts,loadNodes};
}
