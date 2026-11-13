import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterAccounts,summary,scheduleLabel,modelTitle,curlExample} from '../public/view.mjs';
const rows=[
  {name:'日常',sourceName:'小豆',plan:'个人',enabled:true,available:true,routable:true,auto:true,checked:true},
  {name:'备用',sourceName:'Mac',enabled:true,available:false,routable:false,auto:true},
  {name:'团队',enabled:false,available:true,routable:true,auto:true},
  {name:'待确认',enabled:true,available:true,routable:true,auto:false,attempt:'pending'},
];
test('账号搜索同时匹配备注、原名称和计划，筛选可用与待处理',()=>{
 assert.equal(filterAccounts(rows,'小豆')[0].name,'日常');
 assert.equal(filterAccounts(rows,'mac')[0].name,'备用');
 assert.equal(filterAccounts(rows,'个人').length,1);
 assert.equal(filterAccounts(rows,'','ready').length,2);
 assert.equal(filterAccounts(rows,'','attention').length,2);
 assert.equal(filterAccounts(rows,'missing').length,0);
 assert.deepEqual(summary(rows),{total:4,ready:2,signed:1,auto:1,attention:2});
});
test('签到计划文字区分关闭、无账号、今天、明天和待运行',()=>{
 const settings={enabled:true,time:'09:30'};
 assert.equal(scheduleLabel({...settings,enabled:false},rows),'自动签到未开启');
 assert.equal(scheduleLabel(settings,[]),'请先选择签到账号');
 assert.equal(scheduleLabel(settings,rows,Date.parse('2026-11-13T01:29:00Z')),'今天 09:30');
 assert.equal(scheduleLabel(settings,rows,Date.parse('2026-11-13T01:31:00Z')),'明天 09:30');
 assert.equal(scheduleLabel(settings,[{...rows[0],checked:false}],Date.parse('2026-11-13T01:31:00Z')),'等待本轮检查');
 assert.equal(scheduleLabel(settings,[{...rows[0],checked:false,attempt:'pending'}],Date.parse('2026-11-13T01:31:00Z')),'明天 09:30');
});
test('模型标题仅做显示转换，调用示例保留准确 ID 并转义 shell 单引号',()=>{
 const id='person-deepseek-v4-1-flash-261017';
 assert.equal(modelTitle(id),'DeepSeek v4.1 Flash');
 const command=curlExample('http://127.0.0.1:43861/v1',id);
 assert(command.includes(id));assert(command.includes('$DOUBAO_API_KEY'));
 assert(command.includes('stream":true'));assert(command.includes('curl --no-buffer'));
 assert(curlExample('http://127.0.0.1/v1',"unusual'id").includes("unusual'\\''id"));
});
test('账号排序不改变原列表，待处理与可用优先语义一致',async()=>{
 const {sortAccounts}=await import('../public/view.mjs');const rows=[{id:'B',name:'乙',enabled:false,available:false},{id:'A',name:'甲',enabled:true,available:true,routable:true}];
 assert.deepEqual(sortAccounts(rows,'ready').map(a=>a.id),['A','B']);assert.deepEqual(sortAccounts(rows,'attention').map(a=>a.id),['B','A']);assert.deepEqual(rows.map(a=>a.id),['B','A']);
});
