// Local lifecycle fixture. No provider requests or real account credentials.
import {createServer} from 'node:http';
const key=process.env.AGENT2API_PROXY_API_KEY;let modelKey='';
const server=createServer(async(req,res)=>{
 let value;
 if(req.url==='/v1/models'){
  if(req.headers.authorization!=='Bearer '+modelKey){res.writeHead(401);return res.end('{}');}value={data:[]};
 }else{
  if(req.headers.authorization!=='Bearer '+key){res.writeHead(403);return res.end('{}');}
  if(req.url==='/api/plugins')value={packs:[{enabled:true,host:{running:true},providers:[{id:'doubaowork',enabled:true,loaded:true}]}]};
  else if(req.url==='/api/keys'&&req.method==='POST'){let body='';for await(const c of req)body+=c;const data=JSON.parse(body);modelKey=data.key;value={created:{...data,enabled:true}};}
  else if(req.url==='/api/keys')value={keys:[]};
  else if(req.url==='/api/accounts')value={accounts:[]};
  else if(req.url==='/api/accounts/usage/snapshot')value={results:[]};
  else if(req.url.startsWith('/api/checkin-records'))value={records:[]};
  else{res.writeHead(404);return res.end('{}');}
 }
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/v1/models'?value:{success:true,data:value}));
});
server.listen(Number(process.env.AGENT2API_PROXY_PORT),'127.0.0.1');process.once('SIGTERM',()=>server.close());
