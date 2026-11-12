import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {setTimeout as wait} from 'node:timers/promises';
import {NewsService,shanghaiDate} from '../../services/news/service.ts';

const base=path.resolve('node_modules/.cache/news09-review');
await mkdir(base,{recursive:true});
const now=new Date('2026-11-12T06:30:00.000Z');
const stamp=now.toISOString();
const day=offset=>shanghaiDate(new Date(+now-offset*86400000));
const d=day(0);
const item=(source,id,age=1,pdfUrl,extra={})=>({
  id,sourceId:source,sourceName:source,title:'中国快消研究 '+id,url:'https://example.invalid/'+id,
  publishedAt:day(age),fetchedAt:stamp,excerpt:'来源原始正文 '+id,evidenceKind:'article_excerpt',
  research:{kind:'官方正文摘录',dataPeriod:null,...(pdfUrl?{pdfUrl,pageRange:'第 22 页'}:{})},
  ...extra,
});
const edition=(items,status='source_only',extra={})=>({
  contentVersion:'research-v1',items,status,attempt:1,startedAt:stamp,finishedAt:stamp,sources:[],...extra,
});
const ai={
  items:[item('aihot','source-row',400,undefined,{evidenceKind:'source_summary'})],status:'source_only',
  attempt:1,startedAt:stamp,finishedAt:stamp,sources:[],
};
const health=names=>names.map(name=>({name,checkedAt:stamp,status:'ok'}));
const picks=view=>view.recentFmcg.map(row=>[row.date,row.item.id]);
async function setup(items=[],sources=health([...new Set(items.map(x=>x.sourceId))])){
  const root=await mkdtemp(path.join(base,'service-'));
  const news=path.join(root,'state/news');
  await mkdir(news,{recursive:true});
  const file=date=>path.join(news,date+'.json');
  const put=async(date,sections)=>{
    const bytes=JSON.stringify({schemaVersion:1,date,updatedAt:stamp,sections})+'\n';
    await writeFile(file(date),bytes);
    return bytes;
  };
  const calls=[];
  const make=()=>new NewsService({
    root,clock:()=>now,aiEnabled:false,
    readSources:async (section,clock,exclusions)=>{calls.push({section,clock,exclusions});return {items:structuredClone(items),sources:structuredClone(sources)};},
    providerFactory:async()=>{throw Error('Provider should never run');},
  });
  return {file,put,make,calls};
}
async function finish(service){
  await service.ensure();
  for(let i=0;i<100;i++){
    const view=await service.today();
    if(view.edition.sections.fmcg.status!=='running')return view;
    await wait(20);
  }
  throw Error('Isolated news generation timed out');
}

test('cap 2 per source after historical and joint-PDF deduplication, then fill to 5 from three sources',async()=>{
  const common='https://example.invalid/pdf/joint.pdf';
  const old='https://example.invalid/pdf/already-published.pdf';
  const unselected='https://example.invalid/pdf/from-capped-source.pdf';
  const {file,put,make,calls}=await setup([
    item('worldpanel','wp1',1,common+'?utm_source=first'),
    item('worldpanel','wp2',2),
    item('worldpanel','wp-over-cap',3,unselected),
    item('pwc','pwc-joint-dup',4,common+'#other'),
    item('pwc','pwc1',5,unselected),
    item('pwc','pwc2',6),
    item('nbs','nbs-historical-pdf',7,old+'?utm_medium=repeat'),
    item('nbs','nbs1',8),
    item('niq','niq-would-be-sixth',9),
  ]);
  await put(d,{ai});
  const historic=await put(day(1),{fmcg:edition([item('niq','old-other-title',30,old)])});
  const service=make(), view=await finish(service);
  assert.deepEqual(view.edition.sections.fmcg.items.map(x=>x.id),['wp1','wp2','pwc1','pwc2','nbs1']);
  assert.deepEqual(view.edition.sections.ai,ai);
  assert.deepEqual(view.recentFmcg,[]);
  assert.equal(await readFile(file(day(1)),'utf8'),historic);
  const bytes=await readFile(file(d),'utf8');
  await Promise.all([service.ensure(),service.ensure(),make().ensure()]);
  assert.equal(await readFile(file(d),'utf8'),bytes);
  assert.deepEqual(calls.map(x=>x.section),['fmcg']);
});

test('one available source yields two reports and retains actual failures and shortage',async()=>{
  const {put,make,calls}=await setup(Array.from({length:5},(_,i)=>item('nbs','stat'+i,i+1)),[
    ...health(['nbs']),{name:'pwc',checkedAt:stamp,status:'failed',error:'隔离的网络失败'},
    {name:'niq',checkedAt:stamp,status:'empty'},
  ]);
  await put(d,{ai});
  const section=(await finish(make())).edition.sections.fmcg;
  assert.equal(section.status,'source_only');
  assert.deepEqual(section.items.map(x=>x.id),['stat0','stat1']);
  assert.equal(section.sources.find(x=>x.name==='pwc').status,'failed');
  assert.ok(section.shortageReasons?.some(s=>/不足|限额|来源|上限/.test(s)));
  assert.equal(calls.length,1);
});

test('recent picks count current sources, ignore joint duplicate PDFs, and retain old cache and history bytes',async()=>{
  const joint='https://example.invalid/pdf/recent-joint.pdf';
  const nowPdf='https://example.invalid/pdf/current.pdf';
  const {file,put,make,calls}=await setup();
  const oldToday=[item('worldpanel','wp-old1'),item('worldpanel','wp-old2'),item('worldpanel','wp-old3',1,nowPdf)];
  const first=await put(d,{fmcg:edition(oldToday),ai});
  const prior=[
    item('worldpanel','prior-wp-should-not-fill'),
    item('pwc','prior-pwc-duplicate-current',2,nowPdf+'?gclid=other'),
    item('pwc','prior-pwc-unique',2,joint),
  ];
  const priorBytes=await put(day(1),{fmcg:edition(prior)});
  await put(day(2),{fmcg:edition([
    item('niq','older-niq-duplicate-prior',3,joint+'#alias'),
    item('niq','older-niq-unique',3),
    item('nbs','would-be-sixth',3),
  ])});
  const service=make(), view=await service.today();
  assert.deepEqual(view.edition.sections.fmcg.items,oldToday);
  assert.deepEqual(picks(view),[[day(1),'prior-pwc-unique'],[day(2),'older-niq-unique']]);
  assert.deepEqual((await service.edition(day(1))).sections.fmcg.items,prior);
  assert.equal(await readFile(file(d),'utf8'),first);
  assert.equal(await readFile(file(day(1)),'utf8'),priorBytes);
  const after=await service.ensure();
  assert.deepEqual(picks(after),picks(view));
  assert.deepEqual(calls,[]);
});
