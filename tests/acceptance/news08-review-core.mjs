import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {test} from 'node:test';
import {setTimeout as wait} from 'node:timers/promises';
import {NewsService,shanghaiDate} from '../../services/news/service.ts';

const base=path.resolve('node_modules/.cache/news08-review');
await mkdir(base,{recursive:true});
const now=new Date('2026-11-09T16:30:00.000Z');
const stamp=now.toISOString();
const day=offset=>shanghaiDate(new Date(+now-offset*86400000));
const d=day(0);
const research=(id,extra={})=>({
  id,title:'快消研究 '+id,url:'https://example.invalid/'+id,publishedAt:day(40),
  fetchedAt:stamp,excerpt:'已收录的隔离正文 '+id,sourceName:'隔离来源',sourceId:'worldpanel',
  evidenceKind:'article_excerpt',research:{kind:'官方正文摘录',dataPeriod:null},...extra,
});
const fmcg=(items,status='source_only',extra={})=>({
  items,status,contentVersion:'research-v1',attempt:1,startedAt:stamp,finishedAt:stamp,
  sources:[],...extra,
});
const ai={
  items:[research('ai',{sourceId:'aihot',evidenceKind:'source_summary',analysis:{fact:'AI事实',whyItMatters:'说明',possibleImpact:'影响'}})],
  status:'ready',attempt:1,startedAt:stamp,finishedAt:stamp,sources:[],
};
async function setup(){
  const root=await mkdtemp(path.join(base,'service-'));
  const news=path.join(root,'state/news');
  await mkdir(news,{recursive:true});
  const file=date=>path.join(news,date+'.json');
  const put=async(date,sections,extra={})=>{
    const bytes=JSON.stringify({schemaVersion:1,date,updatedAt:stamp,sections,...extra})+'\n';
    await writeFile(file(date),bytes);
    return bytes;
  };
  let sourceCalls=0,providerCalls=0;
  const make=readSources=>new NewsService({
    root,clock:()=>now,aiEnabled:false,
    readSources:async (...args)=>{sourceCalls++;if(!readSources)throw Error('Unexpected source call');return readSources(...args);},
    providerFactory:async()=>{providerCalls++;throw Error('Unexpected provider');},
  });
  return {file,put,make,calls:()=>[sourceCalls,providerCalls]};
}
const picked=view=>view.recentFmcg.map(row=>[row.date,row.item.id]);

test('today leads unchanged; two historical dates fill 3 slots in order with URL and title deduplication',async()=>{
  assert.equal(d,'2026-11-10');
  const {file,put,make,calls}=await setup();
  const newest=[
    research('z-original-order',{title:'本期　零售研究！',url:'https://example.invalid/today?utm_source=direct#a'}),
    research('a-remains-second'),
  ];
  const recentA=research('old-a',{title:'昨日 超市',fetchedAt:'2026-11-09T04:17:00.000Z'});
  const recentB=research('old-b',{url:'https://example.invalid/old-b?gclid=advert'});
  const recentC=research('old-c',{fetchedAt:'2026-11-08T05:14:00.000Z'});
  const cached=[
    [d,await put(d,{fmcg:fmcg(newest,'source_only',{shortageReasons:['真实采集只有2条']}),ai})],
    [day(1),await put(day(1),{fmcg:fmcg([
      research('dup-today-url',{url:'https://example.invalid/today?fbclid=other#b'}),
      recentA,research('dup-recent-title',{title:'昨日超市。'}),recentB,
    ])})],
    [day(2),await put(day(2),{fmcg:fmcg([
      research('dup-today-title',{title:'本期零售研究'}),
      research('dup-recent-url',{url:'https://example.invalid/old-b#x'}),recentC,research('would-be-sixth'),
    ])})],
  ];
  const service=make();
  const views=await Promise.all([service.today(),service.today(),service.ensure(),make().ensure()]);
  for(const view of views){
    assert.deepEqual(view.edition.sections.fmcg.items,newest);
    assert.deepEqual(view.edition.sections.ai,ai);
    assert.deepEqual(picked(view),[[day(1),'old-a'],[day(1),'old-b'],[day(2),'old-c']]);
    assert.deepEqual(view.recentFmcg.map(row=>row.item),[recentA,recentB,recentC]);
    assert.deepEqual(view.edition.sections.fmcg.shortageReasons,['真实采集只有2条']);
    assert.equal('recentFmcg' in view.edition,false);
  }
  for(const [date,bytes] of cached) assert.equal(await readFile(file(date),'utf8'),bytes);
  assert.deepEqual(calls(),[0,0]);
});

test('empty and full today, Shanghai D-30/D-31 and 365-day bounds, corrupt and unsuccessful history',async()=>{
  const {file,put,make,calls}=await setup();
  await put(d,{fmcg:fmcg([],'empty'),ai});
  const eligible=[
    research('364days',{publishedAt:day(364)}),
    research('valid-second'),research('valid-third'),research('valid-fourth'),research('valid-fifth'),
  ];
  const bad=[
    research('too-old',{publishedAt:day(365)}),
    research('future-date',{publishedAt:day(-1)}),
    research('future-time',{publishedAt:'2026-11-09T16:31:00Z'}),
    research('unknown',{publishedAt:null}),
  ];
  await put(day(9),{fmcg:fmcg(bad)});
  await put(day(30),{fmcg:fmcg(eligible)});
  await put(day(31),{fmcg:fmcg([research('outside-history')])});
  await put(day(2),{fmcg:fmcg([research('failed')],'failed')});
  await put(day(3),{fmcg:fmcg([research('abandoned')],'running')});
  await put(day(4),{fmcg:fmcg([research('legacy-in-sections')],'ready',{contentVersion:undefined})});
  await put(day(5),{},{legacyFmcg:fmcg([research('legacy-separate')],'ready',{contentVersion:undefined})});
  await put(day(6),{fmcg:fmcg([research('empty-edition')],'empty')});
  await writeFile(file(day(1)),'{damaged');
  const service=make();
  const view=await service.today();
  assert.deepEqual(picked(view),eligible.map(x=>[day(30),x.id]));
  assert.equal(await readFile(file(day(1)),'utf8'),'{damaged');
  assert.ok((await service.history()).errors.some(s=>s.includes(day(1))));
  assert.deepEqual((await service.edition(day(31))).sections.fmcg.items.map(x=>x.id),['outside-history']);
  const five=Array.from({length:5},(_,i)=>research('today-'+i));
  await put(d,{fmcg:fmcg(five),ai});
  const full=await service.today();
  assert.deepEqual(full.recentFmcg,[]);
  assert.deepEqual(full.edition.sections.fmcg.items,five);
  assert.deepEqual(calls(),[0,0]);
});

test('missing, failed, interrupted and active today preserve recent items without reading sources on GET',async()=>{
  const {put,make,calls}=await setup();
  const saved=research('history-item');
  await put(day(1),{fmcg:fmcg([saved]),ai});
  const service=make();
  const missing=await service.today();
  assert.equal(missing.edition,null);
  assert.deepEqual(picked(missing),[[day(1),saved.id]]);
  for(const [status,expected] of [['failed','failed'],['running','interrupted']]){
    await put(d,{fmcg:fmcg([],status,{error:'固定当日错误'}),ai:{...ai,items:[],status:'failed'}});
    const view=await service.today();
    assert.equal(view.edition.sections.fmcg.status,expected);
    assert.equal(view.edition.sections.fmcg.error,'固定当日错误');
    assert.deepEqual(picked(view),[[day(1),saved.id]]);
    assert.deepEqual(view.fallbacks.ai.section,ai);
  }
  assert.deepEqual(calls(),[0,0]);
  await put(d,{ai});
  const source=Promise.withResolvers();
  const generating=make(()=>source.promise);
  try{
    const running=await generating.ensure();
    assert.equal(running.edition.sections.fmcg.status,'running');
    assert.deepEqual(picked(running),[[day(1),saved.id]]);
  }finally{source.resolve({items:[],sources:[{name:'isolated',status:'empty',checkedAt:stamp}]});}
  let settled;
  for(let i=0;i<60;i++){
    settled=await generating.today();
    if(settled.edition.sections.fmcg.status!=='running')break;
    await wait(20);
  }
  assert.equal(settled.edition.sections.fmcg.status,'empty');
  assert.deepEqual(picked(settled),[[day(1),saved.id]]);
  assert.deepEqual(calls(),[1,0]);
});
