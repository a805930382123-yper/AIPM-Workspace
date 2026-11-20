import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {test} from 'node:test';
import {NewsService} from '../../services/news/service.ts';
import {readNewsSources} from '../../services/news/sources.ts';
import {textPdf} from '../support/news-pdf-fixture.ts';

const cache = path.resolve('node_modules/.cache/news07-review');
await mkdir(cache,{recursive:true});
const now = new Date('2026-11-09T04:30:00Z');
const date = '2026-11-09';
const prior = '2026-11-08';
const wp = 'https://worldpanelbynumerator.com';
const niq = 'https://nielseniq.cn';
const wpList = wp + '/language/chinese-simplified';
const niqList = niq + '/global/zh/insights/consumer-packaged-goods/';
const niqCatalogs = [
  niq + '/wp-json/wp/v2/insight?industries=663&per_page=12&page=1&_fields=link,title,date_gmt',
  niq + '/wp-json/wp/v2/insight?topics=345&per_page=12&page=1&_fields=link,title,date_gmt',
];
const aiURL = 'https://aihot.news/api/v1/items?mode=selected&window=24h&limit=5';
const body = '消费者研究显示快消销售额同比增长8.2%。' + '研究覆盖零售渠道、品牌及消费行为。'.repeat(10);
const html = text => new Response(text,{headers:{'content-type':'text/html'}});
const unavailable = () => new Response(null,{status:503});
const wpCard = ([slug,title,d]) => '<div class="blog-post-title"><div class="post-meta"><div class="small-text">' +
  (d ?? 'November 4, 2026') + '</div></div><a href="/insights/' + slug + '">' + title + '</a></div>';
const item = (id,title,url) => ({
  id,title,url,sourceId:'worldpanel',sourceName:'Worldpanel',publishedAt:'2026-11-03',
  fetchedAt:now.toISOString(),excerpt:body,evidenceKind:'article_excerpt',
});
const aiRow = (id,title,url='https://example.invalid/'+id) => ({
  id,title,links:{original:url},publishedAt:'2020-01-01T00:00:00Z',summary:'固定来源摘要',
});
const section = (status,items=[],extra={}) => ({
  status,items,attempt:1,startedAt:now.toISOString(),sources:[],...extra,
});
const editionFile = (root,day) => path.join(root,'state/news',day+'.json');
async function seed(root,day,sections) {
  await mkdir(path.dirname(editionFile(root,day)),{recursive:true});
  await writeFile(editionFile(root,day),JSON.stringify({schemaVersion:1,date:day,updatedAt:now.toISOString(),sections}));
}

async function fixture(name,config) {
  const root = await mkdtemp(path.join(cache,name+'-'));
  const requests = [], unexpected = [], calls = [];
  let completed = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (niqCatalogs.includes(url)) return Response.json([]);
    if (url === wpList) return html(config.wp.map(wpCard).join(''));
    if (url === niqList) return config.niq ? html(config.niq.map(row=>{
      const [slug,title]=Array.isArray(row)?row:[row,'消费者快消研究 '+row];
      return '<a class="niq-card-link" href="/global/zh/insights/analysis/2026/' + slug + '/">' +
        '<span class="niq-insight-title">' + title + '</span><time datetime="2026-11-04"></time></a>';
    }).join('')) : unavailable();
    if (url === aiURL) return Response.json({items:config.ai ?? []});
    if (url.startsWith(wp+'/insights/')) {
      const slug = new URL(url).pathname.split('/').at(-1);
      if (config.fail?.includes(slug)) return unavailable();
      return html('<div class="article w-richtext"><p>' + (config.blank?.includes(slug) ? '仅下载报告' : body) + '</p></div>');
    }
    if (url.startsWith(niq+'/global/zh/insights/analysis/2026/')) {
      const slug = new URL(url).pathname.split('/').at(-2);
      return html('<a href="/wp-content/uploads/sites/9/2026/11/' + slug + '.pdf">下载报告</a>');
    }
    if (url.startsWith(niq+'/wp-content/uploads/sites/9/')) {
      return config.validPdf
        ? new Response(textPdf(['报告封面','消费者研究显示销售额同比增长8.2%。'+body.repeat(2)]),{headers:{'content-type':'application/pdf'}})
        : unavailable();
    }
    unexpected.push(url);
    throw Error('Unexpected request in fixture');
  };
  const deps = {
    root,clock:()=>now,aiEnabled:!!config.analyze,
    readSources:async (section,now,exclusions,ids)=>{
      calls.push(section);
      return readNewsSources(section,now,exclusions,ids??(section==='fmcg'?new Set(['worldpanel','niq']):undefined));
    },
    providerFactory:async()=>({
      model:'fixed',name:'fixed',complete:async ({user})=>{
        completed++;
        const rows = JSON.parse(user).items;
        const text = JSON.stringify({items:[{id:rows[1].id,fact:'事实',whyItMatters:'原因',possibleImpact:'影响'}]});
        return {text,finishReason:'stop',bytes:Buffer.byteLength(text)};
      },
    }),
  };
  try {
    if (config.history) await seed(root,prior,{fmcg:section('source_only',config.history,{contentVersion:'research-v1'})});
    const service = new NewsService(deps);
    const old = config.history ? await readFile(editionFile(root,prior),'utf8') : null;
    await service.ensure();
    let result;
    for (let i=0;i<160;i++) {
      result = await service.today();
      if (Object.values(result.edition.sections).every(row=>row.status!=='running')) break;
      await wait(20);
    }
    assert.ok(Object.values(result.edition.sections).every(row=>row.status!=='running'));
    assert.deepEqual(unexpected,[]);
    const before = await readFile(editionFile(root,date),'utf8');
    await Promise.all([service.ensure(),service.ensure(),new NewsService(deps).ensure()]);
    assert.equal(await readFile(editionFile(root,date),'utf8'),before);
    if (old !== null) assert.equal(await readFile(editionFile(root,prior),'utf8'),old);
    assert.deepEqual([...calls].sort(),['ai','fmcg']);
    const evidence = {result,requests,calls,completed};
    await writeFile(path.join(cache,name+'.json'),JSON.stringify(evidence,null,2));
    return evidence;
  } finally {
    globalThis.fetch = oldFetch;
  }
}

test('directory history exclusions precede detail budget, five Worldpanel items and direct AIHOT order',async()=>{
  const historical = [
    ['old-url','中国快消 URL 新标题'],['old-title','中国快消　年度研究！'],
    ['old-three','中国快消 历史三'],['old-four','中国快消 历史四'],
  ];
  const history = [
    item('u','不相同标题',wp+'/insights/old-url?utm_source=history#top'),
    item('t','中国快消年度研究',wp+'/insights/earlier-title'),
    ...historical.slice(2).map(([slug,title])=>item(slug,title,wp+'/insights/'+slug)),
  ];
  const fresh = Array.from({length:5},(_,i)=>['new-'+i,(i<2?'中国':'全球')+'快消研究'+i,'November '+(3-i%3)+', 2026']);
  const ai = [
    aiRow('x','旧日期但源排第一'),aiRow('dupe1','重复标题','https://example.invalid/same'),
    aiRow('dupe2','重复标题','https://example.invalid/same'),aiRow('a','无本地关键词'),aiRow('b','第五条'),aiRow('c','第六条'),
  ];
  const {result,requests,completed} = await fixture('history',{wp:[...historical,...fresh],history,ai});
  const expected = fresh.map(([slug])=>wp+'/insights/'+slug).sort();
  assert.deepEqual(requests.filter(url=>url.startsWith(wp+'/insights/')).sort(),expected);
  assert.deepEqual(result.edition.sections.fmcg.items.map(row=>row.url).sort(),expected);
  assert.ok(result.edition.sections.fmcg.items.slice(0,2).every(row=>row.title.startsWith('中国')));
  assert.deepEqual(result.edition.sections.ai.items.map(row=>row.title),ai.slice(0,5).map(row=>row.title));
  assert.equal(requests.filter(url=>url===aiURL).length,1);
  assert.equal(completed,0);
});

test('failed same-title replacement, date gate, body failures and actual request limits',async()=>{
  const wpRows = [
    ['expired','中国快消过期','November 4, 2024'],
    ['future','中国快消未来','November 12, 2026'],
    ['broken-first','中国快消　重点！','November 8, 2026'],
    ['replacement','中国快消重点','November 7, 2026'],
    ['duplicate','中国快消重点。','November 6, 2026'],
    ['no-body','中国快消空壳','November 5, 2026'],
    ...Array.from({length:9},(_,i)=>['global-'+i,'全球快消合格或失败'+i]),
  ];
  const {result,requests,completed} = await fixture('bounded',{
    wp:wpRows,niq:Array.from({length:12},(_,i)=>'niq-'+i),
    fail:['broken-first',...Array.from({length:9},(_,i)=>'global-'+i).filter(x=>!['global-0','global-2'].includes(x))],
    blank:['no-body'],
    ai:[aiRow('a','先到第一'),aiRow('b','先到第二'),aiRow('c','先到第三'),aiRow('d','先到第四'),aiRow('e','先到第五')],analyze:true,
  });
  const fmcg = result.edition.sections.fmcg;
  assert.equal(fmcg.status,'source_only');
  assert.deepEqual(fmcg.items.map(row=>row.url.split('/').at(-1)),['replacement','global-0','global-2']);
  assert.ok(requests.indexOf(wp+'/insights/broken-first')<requests.indexOf(wp+'/insights/replacement'));
  assert.equal(requests.filter(url=>url.startsWith(wp+'/insights/')).length,8);
  assert.ok(requests.filter(url=>url.startsWith(niq+'/global/zh/insights/analysis/')).length<=8);
  assert.equal(requests.filter(url=>url.endsWith('.pdf')).length,2);
  assert.ok(!requests.some(url=>/\/(?:expired|future|duplicate)$/.test(url)));
  assert.equal(result.edition.sections.ai.items.length,1);
  assert.equal(result.edition.sections.ai.items[0].title,'先到第二');
  assert.equal(completed,1);
});

test('empty due to directory date gate, distinct from unavailable source',async()=>{
  const {result,requests,completed} = await fixture('empty',{
    wp:[['expired','中国快消过期','November 4, 2024'],['future','中国快消未来','November 12, 2026']],
    ai:[{id:'bad',title:'失效链接',summary:'坏格式',links:{original:'javascript:alert(1)'}}],
  });
  assert.equal(result.edition.sections.fmcg.status,'empty');
  assert.equal(result.edition.sections.fmcg.items.length,0);
  assert.equal(result.edition.sections.ai.status,'failed');
  assert.equal(result.edition.sections.ai.items.length,0);
  assert.deepEqual([...requests].sort(),[wpList,niqList,...niqCatalogs,aiURL].sort());
  assert.equal(completed,0);
});

test('already cached research-v1 and AI edition without diagnostics stays byte-identical',async()=>{
  const root=await mkdtemp(path.join(cache,'cache-only-'));
  const sections={
    fmcg:section('source_only',[item('old','旧快消研究',wp+'/insights/old')],{contentVersion:'research-v1'}),
    ai:section('source_only'),
  };
  await seed(root,date,sections);
  const before=await readFile(editionFile(root,date),'utf8');
  let reads=0;
  const service=new NewsService({
    root,clock:()=>now,aiEnabled:false,readSources:async()=>{reads++;throw Error('unexpected read');},
    providerFactory:async()=>{throw Error('unexpected provider');},
  });
  const views=await Promise.all([service.today(),service.ensure(),service.ensure()]);
  assert.ok(views.every(view=>JSON.stringify(view.edition.sections)===JSON.stringify(sections)));
  assert.equal(reads,0);
  assert.equal(await readFile(editionFile(root,date),'utf8'),before);
});

test('two successful NIQ PDFs plus a third skipped for budget are not extraction failures',async()=>{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf=pdfjs.getDocument({data:new Uint8Array(textPdf(['报告封面','消费者研究显示销售额同比增长8.2%。'+body.repeat(2)])),useSystemFonts:true});
  try {
    const d=await pdf.promise;
    const plain=(await (await d.getPage(2)).getTextContent()).items.map(x=>x.str).join(' ');
    assert.ok(plain.length>=200&&/\d+(?:\.\d+)?\s*%/.test(plain),plain);
  } finally { await pdf.destroy(); }
  const {result,requests}=await fixture('pdf-reason',{
    wp:[['wp-good','全球快消研究']],niq:['one','two','three'],validPdf:true,
  });
  const fmcg=result.edition.sections.fmcg;
  const niqItems=fmcg.items.filter(x=>x.sourceId==='niq');
  assert.equal(niqItems.length,2);
  assert.ok(niqItems.every(x=>x.research?.pageRange==='第 2 页'));
  assert.equal(requests.filter(x=>x.endsWith('.pdf')).length,2);
  const reasons=fmcg.shortageReasons.filter(x=>x.startsWith('NIQ'));
  assert.ok(reasons.some(x=>/PDF.*(?:预算|上限)/.test(x)));
  assert.ok(reasons.every(x=>!/失败/.test(x)),reasons.join(' '));
  assert.equal(fmcg.sources.find(x=>x.name==='NIQ').error,undefined);
});

test('reaching exactly eight detail attempts with no unvisited candidate is not a budget cause',async()=>{
  const {result,requests}=await fixture('exact-eight',{
    wp:Array.from({length:8},(_,i)=>['detail-'+i,'中国快消研究'+i]),
    fail:[2,3,4,5,6,7].map(i=>'detail-'+i),
  });
  assert.equal(requests.filter(x=>x.startsWith(wp+'/insights/')).length,8);
  const reasons=result.edition.sections.fmcg.shortageReasons.filter(x=>x.startsWith('Worldpanel'));
  assert.ok(reasons.every(x=>!/预算|上限/.test(x)),reasons.join(' '));
});

test('one duplicate discarded during final two-source selection is visible as a shortage reason',async()=>{
  const {result}=await fixture('cross-source',{
    wp:[['shared','中国消费者快消　报告！'],['wp-two','全球快消二'],['wp-three','全球快消三']],
    niq:[['shared','中国消费者快消报告'],['niq-two','中国消费者快消另篇研究']],validPdf:true,
  });
  const fmcg=result.edition.sections.fmcg;
  assert.equal(fmcg.items.length,4);
  assert.ok(fmcg.sources.every(x=>x.status==='ok'&&!x.error));
  assert.ok(fmcg.shortageReasons.some(x=>/重复/.test(x)),fmcg.shortageReasons.join(' '));
});
