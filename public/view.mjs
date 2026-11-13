// Shared presentation logic. No credentials, DOM dependencies or remote requests.
export const isReady = a => a.enabled && a.available && a.routable;
export const needsAttention = a => !a.available || (a.enabled && !a.routable) || ['pending','unknown','submitting','error','captcha'].includes(a.attempt);
export function filterAccounts(accounts, query='', filter='all') {
  const q=query.trim().toLocaleLowerCase();
  return accounts.filter(a=>(!q || [a.name,a.sourceName,a.plan].some(v=>String(v||'').toLocaleLowerCase().includes(q))) &&
    (filter==='ready'?isReady(a):filter==='attention'?needsAttention(a):true));
}
export function summary(accounts) {
  return {total:accounts.length,ready:accounts.filter(isReady).length,signed:accounts.filter(a=>a.checked).length,
    auto:accounts.filter(a=>a.auto&&a.enabled&&a.available).length,attention:accounts.filter(needsAttention).length};
}
export function scheduleLabel(scheduler, accounts, at=Date.now()) {
  if(!scheduler.enabled)return '自动签到未开启';
  if(!summary(accounts).auto)return '请先选择签到账号';
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at);
  const pending=accounts.some(a=>a.auto&&a.enabled&&a.available&&!a.checked&&!a.attempt);
  if(time>=scheduler.time&&pending)return '等待本轮检查';
  return (time<scheduler.time?'今天 ':'明天 ')+scheduler.time;
}
export function modelTitle(id) {
  return id.replace(/^(person|enterprise)-/,'').replace(/-\d{6,8}$/,'').replace(/v(\d+)-(\d+)(?=-|$)/,'v$1.$2').split('-').map(w=>({deepseek:'DeepSeek',doubao:'豆包',gpt:'GPT',claude:'Claude',gemini:'Gemini',kimi:'Kimi',flash:'Flash',pro:'Pro',sonnet:'Sonnet',opus:'Opus'}[w]||w)).join(' ');
}
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
export function curlExample(base, model) {
  const body=JSON.stringify({model,messages:[{role:'user',content:'请只回复 OK'}],stream:true});
  return `curl --no-buffer ${quote(base+'/chat/completions')} \\\n  -H "Authorization: Bearer $DOUBAO_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d ${quote(body)}`;
}
