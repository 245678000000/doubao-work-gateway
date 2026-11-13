import {filterAccounts,summary,scheduleLabel,modelTitle,curlExample,isReady} from './view.mjs';
const $=id=>document.getElementById(id);
const titles={overview:'工作台',checkin:'自动签到',api:'接口接入'};
const statusNames={claimed:'本次领取',done:'今日已领取',success:'本次领取',already:'此前已领取',pending:'待确认',submitting:'已提交待核对',unknown:'待核对',inactive:'活动未开放',ineligible:'条件未满足',captcha:'需人工验证',error:'待检查',failed:'未成功'};
const success=new Set(['claimed','done','success','already']);
const formatTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const shortTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dateTime=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'});
const via={manual:'手动签到',single:'手动签到',schedule:'定时签到',makeup:'补签',startup:'启动补签'};
let snapshot=null,dirty=false,loading=false,working=false,filter='all',aliasId='';
let loginState=null,loginRefreshing=false,loginNotified='';
let keyRows=null,keysLoading=false,keyEditId='',keyRequestId='',keyStateTarget=null;
const e=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function icon(name){const n=document.createElementNS('http://www.w3.org/2000/svg','svg'),u=document.createElementNS(n.namespaceURI,'use');u.setAttribute('href','#i-'+name);n.setAttribute('aria-hidden','true');n.append(u);return n;}
const pill=(text,cls='')=>e('span','badge '+cls,text);
function empty(title,detail='',action){const n=e('div','empty');n.append(e('strong','',title));if(detail)n.append(e('p','',detail));if(action)n.append(action);return n;}
const stamp=at=>Number.isFinite(at)&&at>0?formatTime.format(at):'时间未记录';
function show(text,bad=false){const n=$('notice');n.hidden=!text;n.textContent=text||'';n.classList.toggle('bad',bad);}
async function api(route,data){
  const response=await fetch(route,{method:data===undefined?'GET':'POST',cache:'no-store',credentials:'same-origin',
    headers:{'X-Doubao-Panel':'1',...(data===undefined?{}:{'Content-Type':'application/json'})},
    body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(46_000)});
  const payload=await response.json();
  if(!response.ok)throw Error(payload.error||'请求未成功，请稍后重试。');
  return payload;
}
function button(text,action,cls='secondary small',name){const b=e('button',cls);b.type='button';if(name)b.append(icon(name));b.append(document.createTextNode(text));b.addEventListener('click',()=>act(b,action));return b;}
function toggle(labelText,checked,action,aria=labelText){
  const label=e('label','toggle'),input=e('input');input.type='checkbox';input.checked=checked;input.setAttribute('aria-label',aria);
  input.addEventListener('change',async()=>{const value=input.checked;const ok=await act(input,()=>action(value));if(!ok)input.checked=!value;});
  label.append(input,e('span'));if(labelText)label.append(document.createTextNode(labelText));return label;
}
async function act(control,action,refresh=true,errorNode){
  if(working)return false;
  working=true;const oldDisabled=control.disabled,children=[...control.childNodes];control.disabled=true;control.setAttribute('aria-busy','true');
  if(control.tagName==='BUTTON'&&!control.classList.contains('icon-button'))control.textContent='处理中…';
  try{
    const result=await action();
    if(result?.text)show(result.text,result.warn);else if(typeof result==='string')show(result);
    if(refresh)await load();return true;
  }catch(error){const message=error?.name==='TimeoutError'?'响应超时，请刷新核对结果后再操作。':error?.message||'操作失败，请稍后重试。';show(message,true);if(errorNode){errorNode.hidden=false;errorNode.textContent=message;}return false;}
  finally{control.disabled=oldDisabled;control.removeAttribute('aria-busy');if(control.tagName==='BUTTON')control.replaceChildren(...children);working=false;}
}
async function copy(text,message){await navigator.clipboard.writeText(text);return message;}
function addDialog(){$('login-help').showModal();void refreshLogin();}
function renderLogin(data){
  loginState=data;
  const select=$('login-browser'),previous=select.value;
  if(JSON.stringify(data.browsers)!==select.dataset.choices){
    select.dataset.choices=JSON.stringify(data.browsers);
    select.replaceChildren(...data.browsers.map(b=>{const option=e('option','',b.name);option.value=b.id;return option;}));
    if(!data.browsers.length){const option=e('option','','未检测到 Chrome / Edge');option.value='';select.append(option);}
    if(data.browsers.some(b=>b.id===previous))select.value=previous;
  }
  select.disabled=data.active;
  $('launch-login').disabled=data.active||!data.browsers.length;
  $('native-login').disabled=data.active||!data.nativeAvailable;
  $('cancel-login').hidden=!data.active||['success','cancelled','expired','error'].includes(data.state);
  $('cancel-login').disabled=data.state==='importing';
  const labels={idle:'准备登录',starting:'正在打开',waiting:'等待登录',importing:'正在核验',success:data.updated?'登录已更新':'接入成功',cancelled:'已取消',expired:'已超时',error:'需要检查'};
  const badge=$('login-state-badge');badge.textContent=labels[data.state]||'准备登录';badge.className='badge '+(data.state==='success'?'yes':['error','expired'].includes(data.state)?'warn':'');
  $('login-status').textContent=data.message+(data.accountName?' 账号：'+data.accountName:'');
  const remaining=Math.max(0,Math.ceil((data.expiresAt-Date.now())/60_000));
  $('login-expiry').textContent=data.active&&data.state==='waiting'?'约 '+remaining+' 分钟后结束本次等待。关闭此提示不影响登录。':data.state==='success'?(data.active?'正在关闭临时窗口…':'临时会话已结束，可以继续添加下一个账号。'):'';
  const stage={starting:0,waiting:1,importing:2,success:3}[data.state]??-1;
  for(const [i,id] of ['login-step-open','login-step-auth','login-step-save'].entries()){
    $(id).classList.toggle('done',i<stage);$(id).classList.toggle('current',i===stage);
  }
}
async function refreshLogin(){
  if(loginRefreshing)return;loginRefreshing=true;
  try{
    const data=await api('/api/login-status');renderLogin(data);
    if(data.state==='success'&&!data.active&&loginNotified!==data.id){
      if(await load()){loginNotified=data.id;show((data.accountName?data.accountName+'：':'')+data.message);}
    }
  }catch(error){$('login-status').textContent=error.message;}
  finally{loginRefreshing=false;}
}
function openAlias(a){aliasId=a.id;$('alias-input').value=a.alias||'';$('alias-original').textContent='豆包名称：'+a.sourceName;$('alias-error').hidden=true;$('alias-dialog').showModal();$('alias-input').focus();}
function accountState(a){return !a.enabled?'转发已暂停':isReady(a)?'可用':'需检查登录';}
function renderAccounts(){
  if(!snapshot)return;
  const list=$('accounts'),items=filterAccounts(snapshot.accounts,$('account-search').value,filter);list.replaceChildren();
  $('account-result').textContent=items.length===snapshot.accounts.length?'':'显示 '+items.length+' / '+snapshot.accounts.length+' 个';
  if(!snapshot.accounts.length){list.append(empty('接入第一个豆包工作账号','在浏览器完成登录，账号会自动出现在这里。',button('添加账号',addDialog,'secondary','plus')));return;}
  if(!items.length){list.append(empty('没有匹配的账号','换个关键词，或者切换到「全部账号」。',button('清除筛选',()=>{$('account-search').value='';setFilter('all');},'secondary')));return;}
  for(const a of items){
    const article=e('article','account'),top=e('div','account-top'),name=e('div','account-name'),line=e('div','name-line'),badges=e('div','badges');
    const edit=button('',()=>openAlias(a),'icon-button','edit');edit.setAttribute('aria-label','设置 '+a.name+' 的备注');edit.title='设置备注';
    line.append(e('strong','',a.name),edit);name.append(line,e('small','',[a.plan||'豆包工作账号',a.alias?'原名称：'+a.sourceName:'独立账号'].join(' · ')));
    badges.append(pill(accountState(a),isReady(a)?'yes':!a.available?'warn':''),pill(a.checked?'今日已签到':statusNames[a.attempt||a.checkinStatus]||'今日待签',a.checked?'yes':a.attempt?'warn':''));
    top.append(e('div','avatar',Array.from(a.name)[0]||'豆'),name,badges);
    const quota=e('div','quota');
    if(snapshot.availability?.quota===false)quota.append(e('span','quota-note','额度暂未同步，请稍后刷新'));
    else if(a.quota.length)for(const q of a.quota){const group=e('div','quota-item');group.append(e('small','',q.label),e('b','',q.view));quota.append(group);}
    else quota.append(e('span','quota-note',a.quotaState==='error'?'额度查询未成功，请点击「更新额度」':a.quotaState==='ok'?'豆包暂未返回分项额度':'点击「更新额度」查看当前余额'));
    const bottom=e('div','account-bottom'),options=e('div','account-options'),actions=e('div','account-actions');
    options.append(toggle('参与转发',a.enabled,v=>api('/api/enable',{id:a.id,enabled:v}).then(()=>v?'已启用该账号转发。':'该账号已暂停转发，自动签到也会跳过它。'),'允许 '+a.name+' 参与转发'),
      toggle('自动签到',a.auto,v=>api('/api/auto',{id:a.id,enabled:v}).then(()=>v?(snapshot.scheduler.enabled?'已将该账号加入每日计划。':'已选择该账号；请在「自动签到」页面开启并保存每日计划。'):'已关闭该账号自动签到。'),'为 '+a.name+' 自动签到'));
    actions.append(button('更新额度',()=>api('/api/quota',{id:a.id}).then(r=>r.ok?'额度已更新。':{text:'豆包尚未返回可用额度，请稍后再查。',warn:true}),'secondary small','refresh'));
    const sign=button(a.checked?'今日已签':['pending','unknown','submitting'].includes(a.attempt)?'回查签到':'签到',()=>api('/api/checkin',{id:a.id}).then(r=>({text:r.message,warn:!['done','claimed'].includes(r.status)})),a.checked?'secondary small':'primary small',a.checked?'check':'calendar');
    sign.disabled=a.checked||!a.available;if(a.checked)sign.title='今日已由豆包确认领取';else if(!a.available)sign.title='请先重新登录该账号';actions.append(sign);
    bottom.append(options,actions);article.append(top,quota,bottom);list.append(article);
  }
}
function renderSchedule(){
  const data=snapshot,s=summary(data.accounts),label=scheduleLabel(data.scheduler,data.accounts,data.updatedAt);
  if(!dirty){$('global-toggle').checked=data.scheduler.enabled;$('schedule-time').value=data.scheduler.time;}
  $('schedule-badge').textContent=data.scheduler.enabled?'每日计划已开启':'每日计划已关闭';$('schedule-badge').className='badge '+(data.scheduler.enabled?'yes':'');
  $('schedule-next').textContent=data.scheduler.enabled?label+' · 当前 '+s.auto+' 个账号符合自动签到条件':'开启并保存后，每天 '+data.scheduler.time+' 开始检查选中的账号。';
  $('auto-count').textContent=s.auto+' 个符合条件';
  const list=$('schedule-accounts');list.replaceChildren();
  for(const a of data.accounts){const row=e('div','schedule-account'),name=e('div','account-name');name.append(e('strong','',a.name),e('small','',!a.available?'登录待检查，将跳过':!a.enabled?'转发已暂停，将跳过':!a.auto?'尚未加入每日计划':a.checked?'今日已签，下次按计划检查':'可参与每日计划'));row.append(e('div','avatar',Array.from(a.name)[0]||'豆'),name,toggle('',a.auto,v=>api('/api/auto',{id:a.id,enabled:v}).then(()=>v?'已加入签到账号列表。':'已移出签到账号列表。'),'为 '+a.name+' 自动签到'));list.append(row);}
  if(!data.accounts.length)list.append(empty('先接入一个账号','返回工作台，点击「添加账号」。'));
}
function renderRecords(){
  const list=$('records');list.replaceChildren();
  if(snapshot.availability?.records===false){list.append(empty('签到记录暂未同步','账号状态仍可查看，稍后点击右上角刷新。'));return;}
  const filter=$('record-filter').value,rows=snapshot.records.filter(r=>filter==='all'||(filter==='success'?success.has(r.outcome):!success.has(r.outcome)));
  for(const r of rows){const row=e('div','record'),detail=e('div'),mark=e('span','record-mark'),words=e('div');mark.append(icon(success.has(r.outcome)?'check':'clock'));words.append(e('strong','',r.name||'豆包工作账号'),e('small','',[stamp(r.at),via[r.source]||'签到'].join(' · ')));detail.append(mark,words);row.append(detail,pill(statusNames[r.outcome]||'结果待确认',success.has(r.outcome)?'yes':'warn'));list.append(row);}
  if(!rows.length)list.append(empty(snapshot.records.length?'没有这类记录':'还没有签到记录',snapshot.records.length?'选择「全部结果」查看其他记录。':'完成一次签到后，结果会记录在这里。'));
}
function renderModels(){
  const list=$('models');list.replaceChildren();
  if(snapshot.availability?.models===false){list.append(e('li','empty','模型目录暂未同步，请稍后刷新。'));return;}
  const query=$('model-search').value.toLocaleLowerCase().trim(),items=snapshot.models.filter(id=>(id+' '+modelTitle(id)).toLocaleLowerCase().includes(query));
  for(const id of items){const row=e('li','model-row'),mark=e('span','model-icon'),detail=e('div'),b=button('复制 ID',()=>copy(id,'模型 ID 已复制。'),'secondary small');mark.append(icon('code'));detail.append(e('strong','',modelTitle(id)),e('code','',id));b.setAttribute('aria-label','复制模型 '+id);row.append(mark,detail,b);list.append(row);}
  if(!items.length)list.append(e('li','empty',snapshot.models.length?'没有匹配的模型，请换个关键词。':'暂无模型，请先接入有效的豆包工作账号。'));
}
function updateExample(){const id=$('example-model').value;$('curl-example').textContent=id?curlExample(snapshot.apiBase,id):'接入有效账号后，这里会生成对应的调用示例。';$('copy-curl').disabled=!id;}
function render(data){
  const h=$('health');h.className='health on';h.querySelector('span').textContent='本机网关在线';
  const s=summary(data.accounts);$('m-total').textContent=String(s.total);$('m-accounts').textContent=String(s.ready);$('m-attention').textContent=String(s.attention);$('m-models').textContent=data.availability?.models===false?'—':String(data.models.length);
  $('account-count').textContent=String(s.total);$('model-count').textContent=data.availability?.models===false?'—':String(data.models.length);
  $('m-checkin').textContent=String(s.signed);$('daily-total').textContent='/ '+s.total+' 个账号';$('daily-progress').max=s.total||1;$('daily-progress').value=s.signed;
  $('daily-caption').textContent=s.total===0?'添加账号，开始管理每日签到':s.signed===s.total?'今天的签到已经完成':'以豆包确认的领取状态为准';
  $('daily-result').textContent=s.total===0?'等待接入':s.signed===s.total?'全部完成':(s.total-s.signed)+' 个尚未确认';
  $('next-run').textContent=scheduleLabel(data.scheduler,data.accounts,data.updatedAt);$('today').textContent=dateTime.format(data.updatedAt)+' · 北京时间';$('date-chip').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(data.updatedAt);
  $('sync-time').textContent=shortTime.format(data.updatedAt)+' 更新';
  $('api-base').textContent=data.apiBase;$('quick-base').textContent=data.apiBase;
  renderAccounts();renderSchedule();renderRecords();renderModels();
  const select=$('example-model'),previous=select.value,exampleModels=data.models.filter(id=>!/(?:image|video|tts|embedding)/i.test(id));select.replaceChildren(...exampleModels.map(id=>{const o=e('option','',id);o.value=id;return o;}));
  if(exampleModels.includes(previous))select.value=previous;else select.value=exampleModels.find(id=>/deepseek.*flash/.test(id))||exampleModels[0]||'';
  updateExample();
  if(Object.values(data.availability||{}).includes(false))show('部分数据暂未同步。账号连接正常，可稍后刷新额度、记录或模型目录。',true);
}
async function load(notify=false){
  if(loading)return false;
  loading=true;$('refresh').disabled=true;
  try{snapshot=await api('/api/snapshot');render(snapshot);if(notify&&!Object.values(snapshot.availability||{}).includes(false))show('数据已刷新。');return true;}
  catch(error){const h=$('health');h.className='health bad';h.querySelector('span').textContent='网关待连接';$('sync-time').textContent='同步中断';
    if(snapshot)show(error.message+' 当前展示的是上次同步的数据。',true);
    else{$('accounts').replaceChildren(empty('网关还未就绪','请运行 start.command 后点击右上角刷新。'));$('records').replaceChildren(empty('等待网关连接'));$('schedule-accounts').replaceChildren(empty('等待账号同步'));$('models').replaceChildren(e('li','empty','网关未连接'));show(error.message,true);}return false;
  }finally{loading=false;$('refresh').disabled=false;}
}
function openKeyDialog(key){
  keyEditId=key?.id||'';keyRequestId=crypto.randomUUID();
  $('key-form').reset();$('key-name').value=key?.name||'';$('key-form-error').hidden=true;$('key-custom-details').open=false;
  $('key-dialog-title').textContent=key?'修改 Key 名称':'创建 API Key';$('key-submit').textContent=key?'保存名称':'创建 Key';
  $('key-dialog-hint').textContent=key?'只修改名称，Key 内容与调用权限保持原样。':'每个客户端使用一把独立的 Key，后续可分别停用。';
  $('key-create-options').hidden=!!key;$('key-dialog').showModal();$('key-name').focus();
}
function confirmKeyState(key){
  keyStateTarget={id:key.id,enabled:!key.enabled};
  $('key-state-title').textContent=key.enabled?'停用这把 Key？':'重新启用这把 Key？';
  $('key-state-message').textContent=key.enabled?'「'+key.name+'」停用后，使用它的后续调用将被拒绝。已开始的请求可能继续；其他 Key 不受影响。':'「'+key.name+'」启用后，可以继续使用原 Key 调用豆包工作模型。';
  $('key-state-submit').textContent=key.enabled?'确认停用':'确认启用';$('key-state-error').hidden=true;$('key-state-dialog').showModal();
}
function renderKeys(){
  if(!keyRows)return;const list=$('keys-list');list.replaceChildren();$('key-count').textContent=String(keyRows.length);
  if(!keyRows.length){list.append(empty('还没有豆包工作 Key','创建一把 Key，用于连接你的客户端。'));return;}
  for(const key of keyRows){
    const row=e('article','key-row'),details=e('div','key-info'),heading=e('div','key-heading'),meta=e('div','key-meta'),actions=e('div','key-actions');
    heading.append(e('strong','',key.name),pill(key.enabled?'已启用':'已停用',key.enabled?'yes':''));if(key.builtIn)heading.append(pill('默认 · 保留'));
    meta.append(e('code','',key.masked),e('span','',key.allowedModels.length?'限定 '+key.allowedModels.length+' 个模型':'豆包工作 · 全部模型'),e('span','',key.createdAt?stamp(key.createdAt)+' 创建':'时间未记录'));
    details.append(heading,meta);row.append(details);
    const copyKey=button('复制 Key',async()=>{const {key:value}=await api('/api/keys/reveal',{id:key.id});return copy(value,'Key 已复制，请仅粘贴到你信任的客户端。');},'secondary small','copy');copyKey.disabled=!key.readable;actions.append(copyKey);
    if(!key.builtIn){actions.append(button('改名',()=>openKeyDialog(key),'secondary small','edit'),button(key.enabled?'停用':'启用',()=>confirmKeyState(key),'secondary small'));}
    else{const note=e('span','key-protected','用于面板连接');actions.append(note);}
    row.append(actions);list.append(row);
  }
}
async function loadKeys(){
  if(keysLoading)return false;keysLoading=true;$('refresh-keys').disabled=true;
  try{const data=await api('/api/keys');keyRows=data.keys;renderKeys();$('keys-error').hidden=true;return true;}
  catch(error){$('keys-error').hidden=false;$('keys-error').textContent=error.message+(keyRows?' 当前保留的是上次读取的列表。':'');if(!keyRows)$('keys-list').replaceChildren(empty('Key 列表暂未就绪','稍后点击刷新重试。'));return false;}
  finally{keysLoading=false;$('refresh-keys').disabled=false;}
}
function setFilter(value){filter=value;for(const b of document.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b.dataset.filter===value));renderAccounts();}
function page(){show('');const hash=location.hash.slice(1),key=Object.hasOwn(titles,hash)?hash:'overview';$('breadcrumb').textContent=titles[key];for(const p of Object.keys(titles))$(p).hidden=p!==key;for(const a of document.querySelectorAll('nav a'))a.dataset.page===key?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current');if(key==='api')void loadKeys();}
function setTheme(value){document.documentElement.dataset.theme=value;$('theme').setAttribute('aria-label',value==='dark'?'切换浅色模式':'切换深色模式');try{localStorage.setItem('dw-theme',value);}catch{}}
try{setTheme(localStorage.getItem('dw-theme')==='dark'?'dark':'light');}catch{setTheme('light');}
$('create-key').addEventListener('click',()=>openKeyDialog());$('refresh-keys').addEventListener('click',()=>loadKeys());
$('key-form').addEventListener('input',()=>{keyRequestId=crypto.randomUUID();$('key-form-error').hidden=true;});
$('key-dialog').addEventListener('close',()=>{$('key-custom').value='';$('key-name').value='';keyEditId='';keyRequestId='';});
$('key-form').addEventListener('submit',event=>{event.preventDefault();$('key-form-error').hidden=true;act($('key-submit'),async()=>{
  if(keyEditId)await api('/api/keys/update',{id:keyEditId,name:$('key-name').value});
  else await api('/api/keys/create',{name:$('key-name').value,key:$('key-custom').value,requestId:keyRequestId});
  const edited=!!keyEditId;$('key-dialog').close();await loadKeys();return edited?'Key 名称已保存。':'Key 已创建。点击列表里的「复制 Key」接入客户端。';
},false,$('key-form-error'));});
$('key-state-form').addEventListener('submit',event=>{event.preventDefault();$('key-state-error').hidden=true;act($('key-state-submit'),async()=>{
  const next=keyStateTarget;await api('/api/keys/update',next);$('key-state-dialog').close();await loadKeys();return next.enabled?'Key 已启用。':'Key 已停用，其他 Key 不受影响。';
},false,$('key-state-error'));});
$('theme').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
window.addEventListener('hashchange',page);
$('refresh').addEventListener('click',()=>load(true));$('add').addEventListener('click',addDialog);
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>$(b.dataset.close).close());
for(const b of document.querySelectorAll('[data-filter]'))b.addEventListener('click',()=>setFilter(b.dataset.filter));
$('account-search').addEventListener('input',renderAccounts);$('model-search').addEventListener('input',()=>snapshot&&renderModels());$('record-filter').addEventListener('change',()=>snapshot&&renderRecords());$('example-model').addEventListener('change',updateExample);
$('schedule').addEventListener('input',()=>{dirty=true;$('schedule-dirty').textContent='有未保存的更改';});
$('schedule').addEventListener('submit',event=>{event.preventDefault();act($('schedule').querySelector('button'),async()=>{const enabled=$('global-toggle').checked;await api('/api/schedule',{enabled,time:$('schedule-time').value});dirty=false;$('schedule-dirty').textContent='计划已保存';return enabled?'每日计划已开启，仅处理已选择且有效的账号。':'每日计划已关闭。';});});
$('alias-form').addEventListener('submit',event=>{event.preventDefault();$('alias-error').hidden=true;act($('alias-form').querySelector('[type=submit]'),async()=>{await api('/api/alias',{id:aliasId,alias:$('alias-input').value});$('alias-dialog').close();return '账号备注已保存。';},true,$('alias-error'));});
$('launch-login').addEventListener('click',async()=>{
  await act($('launch-login'),async()=>{renderLogin(await api('/api/login',{mode:'browser',browserId:$('login-browser').value}));},false,$('login-status'));
  void refreshLogin();
});
$('cancel-login').addEventListener('click',async()=>{
  await act($('cancel-login'),async()=>{renderLogin(await api('/api/login/cancel',{}));},false,$('login-status'));
  void refreshLogin();
});
$('native-login').addEventListener('click',()=>act($('native-login'),async()=>{const r=await api('/api/login',{mode:'native'});$('login-status').textContent=r.message;return r.message;},false,$('login-status')));
$('login-refresh').addEventListener('click',()=>act($('login-refresh'),async()=>{const ok=await load();$('login-status').textContent=ok?'账号列表已更新，已接入 '+snapshot.accounts.length+' 个豆包工作账号。':'网关暂未连接，请检查启动终端。';},false));
for(const id of ['copy-base','copy-quick-base'])$(id).addEventListener('click',()=>act($(id),()=>copy($('api-base').textContent,'Base URL 已复制。'),false));
$('copy-key').addEventListener('click',()=>act($('copy-key'),async()=>{const {key}=await api('/api/key',{});return copy(key,'模型 Key 已复制，请勿公开分享。');},false));
$('copy-curl').addEventListener('click',()=>act($('copy-curl'),()=>copy($('curl-example').textContent,'调用示例已复制。运行前请设置 DOUBAO_API_KEY。'),false));
page();void load();void refreshLogin();
setInterval(()=>{if(!document.hidden&&($('login-help').open||loginState?.active))void refreshLogin();},2000);
setInterval(()=>{if(!document.hidden&&!working&&!document.activeElement?.closest('.account,.schedule-account')){void load();if(location.hash==='#api'&&!document.querySelector('dialog[open]'))void loadKeys();}},30_000);
