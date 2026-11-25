import { withoutInheritedEmbeddings } from '../support/isolated-embedding-env.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, writeFile} from 'node:fs/promises';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import {build, preview} from 'vite';
import {pdfFixture} from '../support/pdf01-fixture.ts';
import {synthesisFixture} from './pdf02-synthesis-fixture.ts';
import {longFixture} from './pdf02-long-fixture.ts';

const spanCase = process.argv.includes('--spans');
const r3 = process.argv.includes('--r3');
const synthesis = r3 || process.argv.includes('--synthesis') ? synthesisFixture : null;
const long = process.argv.includes('--long') ? longFixture : null;
const root = await mkdtemp(path.join(os.tmpdir(), long ? 'pdf02-long-' : r3 ? 'pdf03-browser-' : synthesis ? 'pdf02-synthesis-' : spanCase ? 'pdf02-spans-' : 'pdf02-consolidation-'));
const envDir = await mkdtemp(path.join(os.tmpdir(), 'pdf02-empty-env-'));
const outDir = path.join(root, 'app-dist');
const vite = {configFile:false as const, root:process.cwd(), envDir, plugins:[react()], build:{outDir,emptyOutDir:true}};
await build(vite);

const original = '2027 North pilot: 173 stores.';
const restatement = '2027 North pilot covered 173 stores.';
const differentYear = '2028 North pilot: 181 stores.';
const differentSample = '2027 North pilot: 173 stores, urban only.';
const merchants = '2027 active merchants: 43.';
const shoppers = '2027 active shoppers: 960.';
const pdf = path.join(root, '合成覆盖规模.pdf');
const spans = {
  native:'Pilot reached 173 stores in North in 2027; merchants reached 61.',
  common:'🧭 Pilot covered 173 stores in North in 2027;',
  users:'new users totalled 875.',
  active:'Active merchants totalled 43.',
  coverageTitle:'北区试点覆盖',usersTitle:'新增用户',merchantsTitle:'商户规模',
};
const mixed = `${spans.common} ${spans.users} ${spans.active}`;
const fixtureBytes = long?.pdf() ?? synthesis?.pdf() ?? (spanCase ? Buffer.from(pdfFixture(['text','scan'], () => spans.native).toString('latin1').replaceAll('[0 0 200 200]','[0 0 900 200]'),'latin1')
  : pdfFixture(['text','scan','vector'], () => original));
await writeFile(pdf, fixtureBytes);
const scan = r3 ? path.join(root,'合成扫描样本.pdf') : undefined;
if(scan)await writeFile(scan,pdfFixture(['scan']));
const fixtures = {pdf,original,restatement,differentYear,differentSample,merchants,shoppers,title:'北区试点覆盖',...(spanCase?{spans:{...spans,mixed}}:{}),...(synthesis?{synthesis:synthesis.fixture}:{}),...(scan?{scan}:{}),...(long?{long:long.fixture}:{})};
const outputs = long?.outputs ?? synthesis?.outputs ?? (spanCase ? ['Decorative logo.',mixed] : ['Decorative logo.', `${restatement}\n${differentYear}`, `${differentSample}\n${merchants}\n${shoppers}`]);
type Unit = {id:string;page:number;text:string;origin:'text'|'image';kind:string;topic?:string;unitId?:string;start?:number;end?:number};
const calls:Array<{stage:string;page?:number;units?:Unit[];topics?:unknown[];basis?:unknown;bytes:number}> = [];
let failWriting = r3;

async function listen(server:http.Server) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return (server.address() as AddressInfo).port;
}
const reserve = async () => {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
};
const fake = http.createServer(async (req,res) => {
  try {
    assert.equal(req.url,'/v1/chat/completions');
    const chunks:Buffer[] = [];
    for await(const chunk of req) chunks.push(Buffer.from(chunk));
    const data = Buffer.concat(chunks);
    const wire = JSON.parse(data.toString('utf8'));
    const user = wire.messages.at(-1).content;
    const input = JSON.parse(Array.isArray(user) ? user[0].text : user);
    const bytes = Buffer.byteLength(JSON.stringify(input));
    let response:unknown;
    switch(input.stage) {
      case 'pdf_page_understanding':
        assert.match(user[1].image_url.url,/^data:image\/png;base64,/);
        calls.push({stage:input.stage,page:input.page,bytes});
        if(r3 && input.totalPages===3 && input.page===3)throw Error('Synthetic page 3 failure');
        const content = r3 && input.totalPages===1 ? 'The scanned page contains 42 entries.'
          : r3 && input.page===2 ? `${outputs[1]}\n${synthesis!.fixture.users}\n${synthesis!.fixture.promotion}` : outputs[input.page-1];
        response = {blank:false,content,visuals:'',inference:'',questions:[]};
        break;
      case 'pdf_cleanup': {
        const units = input.units as Unit[];
        calls.push({stage:input.stage,units,bytes});
        response = {decisions:Object.fromEntries(units.map(unit => [unit.id,long ? {decision:'keep',reason:'保留完整样本记录',topic:long.classify(unit.page)} : synthesis ? {decision:'keep',reason:'留完整证据交写作归属',topic:synthesis.classify(unit.text)} : unit.text==='Decorative logo.'
          ? {decision:'skip',reason:'保留在清理记录中的装饰标识'}
          : {decision:'keep',reason:'保留来源表述和统计条件',topic:unit.origin==='text'?'覆盖规模':'试点覆盖'},
        ]))};
        break;
      }
      case 'pdf_topic_index': {
        const topics = input.topics as string[];
        calls.push({stage:input.stage,topics,basis:input.basis,bytes});
        const assignments = long ? topics.map(topic => [topic,long.fixture.title]) : synthesis ? topics.map(topic => [topic,topic]) : spanCase ? input.basis.map(({topic,samples:[sample]}:{topic:string;samples:Unit[]}) => [topic,
          /stores/u.test(sample.text) ? spans.coverageTitle : /new users/u.test(sample.text) ? spans.usersTitle : spans.merchantsTitle,
        ]) : topics.map(topic => [topic,fixtures.title]);
        response = {assignments:Object.fromEntries(assignments)};
        break;
      }
      case 'pdf_topic_write':
        assert(long||synthesis,'Synthesis or long fixture must be selected for topic writing');
        calls.push({stage:input.stage,topics:input.topics,bytes});
        if(failWriting){failWriting=false;throw Error('Synthetic first writing failure');}
        response = {topics:(long??synthesis)!.writeTopics(input.topics)};
        break;
      case 'pdf_presentation': {
        const units = input.units as Unit[];
        calls.push({stage:input.stage,units,bytes});
        const representative = units.find(unit => spanCase ? unit.text===spans.common : unit.text===original);
        const member = units.find(unit => spanCase ? unit.origin==='text'&&unit.text.includes('173 stores') : unit.text===restatement);
        assert(representative,'Presentation fixture needs original and restatement in one request');
        assert(member,'Presentation fixture needs both source units in one request');
        response = {presentation:Object.fromEntries(units.map(unit => [unit.id,{
          representativeId:unit.id===member.id ? representative.id : null,
          reason:unit.id===member.id ? '同为 2027 年北区试点覆盖 173 家门店' : '保留原有信息与各自统计条件',
        }]))};
        break;
      }
      default: throw Error(`Unexpected synthetic stage ${input.stage}`);
    }
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}]}));
  } catch(error) {
    res.writeHead(400,{'content-type':'application/json'}).end(JSON.stringify({error:{message:error instanceof Error ? error.message : 'Synthetic response failed'}}));
  }
});
const fakePort = await listen(fake);
const config = path.join(root,'fake-provider.env');
await writeFile(config,`FMCG_LLM_BASE_URL=http://127.0.0.1:${fakePort}/v1\nFMCG_LLM_MODEL=fixture-consolidation\nFMCG_LLM_API_KEY=synthetic-test-only-consolidation\n`);
const apiPort = await reserve();
const port = await reserve();
const api = `http://127.0.0.1:${apiPort}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FMCG_|OPENAI_|ANTHROPIC_|GEMINI_|NODE_OPTIONS$|NODE_USE_ENV_PROXY$|(?:HTTPS?|ALL|NO)_PROXY$)/iu.test(key)));
const child = spawn(process.execPath,['--import','tsx','server/index.ts'],{
  cwd:process.cwd(), windowsHide:true, stdio:'inherit',
  env:withoutInheritedEmbeddings({...env,FMCG_DATA_DIR:root,FMCG_PORT:String(apiPort),FMCG_LLM_CONFIG_FILE:config}),
});
let ready = false;
for(let attempt=0;attempt<150&&child.exitCode===null;attempt++) {
  const response = await fetch(`${api}/api/health`).catch(() => null);
  if(response?.ok){ready=true;break;}
  await new Promise(resolve => setTimeout(resolve,100));
}
if(!ready){child.kill();fake.close();throw Error('Isolated product API did not start');}
const frontend = await preview({
  ...vite,
  plugins:[...vite.plugins, {name:'pdf-consolidation-fixture',configurePreviewServer(server){
    server.middlewares.use('/__control/counters',(_req,res) => res.setHeader('content-type','application/json').end(JSON.stringify({calls,realProviderCalls:0})));
    server.middlewares.use('/api/news',(_req,res) => {res.statusCode=503;res.end();});
  }}],
  preview:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':api}},
});
const session = {pid:process.pid,apiPid:child.pid,root,envDir,outDir,url:`http://127.0.0.1:${port}`,api,fixtures,provider:'fake-only'};
await writeFile(path.join(root,'isolated-session.json'),JSON.stringify(session,null,2));
console.log(JSON.stringify(session,null,2));
function close(){child.kill();frontend.httpServer.close();fake.close();}
process.on('SIGINT',close);
process.on('SIGTERM',close);
