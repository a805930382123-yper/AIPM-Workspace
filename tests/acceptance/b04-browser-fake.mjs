// Independent HTTP fixture for browser acceptance; never a real Provider result.
import http from 'node:http';
let mode='success',callCount=0;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/control'){mode=url.searchParams.get('mode')||'success';res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({fixture:'independent-fake',mode,callCount}));return;}
  if(req.method!=='POST'||url.pathname!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  const parts=[];for await(const b of req)parts.push(b);
  const request=JSON.parse(Buffer.concat(parts).toString('utf8'));
  const user=request.messages.find(x=>x.role==='user').content;
  const rawId=/rawId 填 "([0-9a-f-]{36})"/.exec(user)?.[1];
  const body=user.split('<<<\n')[1]?.split('\n>>>')[0]||'';
  const quote=body.split(/\r?\n/).find(x=>x.trim())||'fixture';
  callCount++;
  if(mode==='auth'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'independent fixture authentication rejected'}}));return;}
  if(mode==='slow')await new Promise(r=>setTimeout(r,12000));
  const title=/- 标题：(.*)/.exec(user)?.[1]||'独立验收';
  const page=(label,index)=>({title:title+'-'+label,type:'concept',category:'channel',one_line_definition:label+'的独立测试定义',source_facts:[{text:quote,evidenceIds:['e'+index]}],ai_organized:['这是明确标注的独立fake整理'],ai_inferences:['这是待人工审阅的fake推断'],related_pages:[],open_questions:['需要人工确认'],source_evidence:[{id:'e'+index,rawId,quote}]});
  const value={document:{title:title+'-来源摘要',main_topic:'独立fake审核测试',summary:'仅测试人工审核门禁，不代表真实AI输出。'},suggested_pages:[page('渠道概念',1),page('库存概念',2)]};
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{role:'assistant',content:mode==='invalid'?'not-json':JSON.stringify(value)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20}}));
});
server.listen(4336,'127.0.0.1',()=>console.log('Independent browser fake Provider ready on 4336'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
