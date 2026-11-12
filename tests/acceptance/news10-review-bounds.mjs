import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readNewResearch} from '../../services/news/new-research.ts';

const now=new Date('2026-11-12T09:53:00Z');
const directory='https://kpmg.com/cn/zh/industries/consumer-and-retail.html';
const detail='https://kpmg.com/cn/zh/insights/2026/09/independent-consumer-report.html';
const asset='https://kpmg.com/content/dam/kpmgsites/cn/pdf/zh/2026/09/independent.pdf.coredownload.inline.pdf';
const redirected=asset.replace('https://kpmg.com','https://assets.kpmg.com');
const press='https://china.mintel.com/press-centre/';
const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
const list=()=>html('<main><a href="'+detail+'">中国食品饮料消费报告</a></main>');
const report=()=>html('<script type="application/ld+json">{"datePublished":"2026-09-09","dateModified":"2026-10-10"}</script><main><a href="'+asset+'">公开报告</a></main>');

function makePdf(texts){
  const utf=text=>[...text].map(ch=>ch.charCodeAt(0).toString(16).padStart(4,'0')).join('').toUpperCase();
  const codes=[...new Set(texts.join(''))].map(utf);
  const cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'+codes.length+' beginbfchar\n'+codes.map(x=>'<'+x+'> <'+x+'>').join('\n')+'\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  const stream=body=>'<< /Length '+Buffer.byteLength(body)+' >>\nstream\n'+body+'\nendstream';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids ['+texts.map((_,i)=>(6+i*2)+' 0 R').join(' ')+'] /Count '+texts.length+' >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>',stream(cmap)];
  for(const [i,text] of texts.entries()){
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(7+i*2)+' 0 R >>');
    objects.push(stream('BT /F1 10 Tf 14 TL 20 700 Td '+text.match(/.{1,68}/gu).map(line=>'<'+utf(line)+'> Tj').join(' T* ')+' ET'));
  }
  let data='%PDF-1.5\n';
  const offsets=[];
  for(const [i,obj] of objects.entries()){
    offsets.push(Buffer.byteLength(data));
    data+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';
  }
  const xref=Buffer.byteLength(data);
  return Buffer.from(data+'xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
}
const good='中国消费者的食品饮料购买渠道发生变化。2026年上半年的公开样本显示，44.2%的受访者选择在便利店买饮料，该比例仅描述该调查样本。该研究覆盖不同城市的零售门店及线上渠道。';
const pdf=makePdf(['封面','目录。'+good,'中国服务消费同比增长5.3%，旅游和文娱渠道需求增长。',...Array(59).fill('附录'),good]);
async function run(pdfFetch,detailResponse=report){
  const original=globalThis.fetch,requests=[],unexpected=[];
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    requests.push({url,signal:init?.signal});
    if(url===directory)return list();
    if(url===detail)return detailResponse();
    if(url===press)return new Response(null,{status:503});
    if(url===asset||url===redirected)return pdfFetch(url,init.signal);
    unexpected.push(url);
    return new Response(null,{status:503});
  };
  try{
    const result=await readNewResearch(now,undefined,true);
    assert.deepEqual(unexpected,[]);
    return {result,requests};
  }finally{globalThis.fetch=original;}
}

test('KPMG follows both official asset hosts under one timeout and selects intact China FMCG sentences on page 63',async()=>{
  const timeouts=[],original=AbortSignal.timeout;
  AbortSignal.timeout=ms=>{timeouts.push(ms);return original(ms);};
  try{
    const {result,requests}=await run(url=>url===asset
      ? new Response(null,{status:302,headers:{location:redirected}})
      : new Response(pdf,{headers:{'content-type':'application/pdf'}}));
    assert.equal(result.items.length,1);
    const item=result.items[0];
    assert.equal(item.publishedAt,'2026-09-09');
    assert.equal(item.research.pageRange,'第 63 页');
    assert.match(item.excerpt,/44\.2%/);
    assert.match(item.excerpt,/仅描述该调查样本。/);
    assert.match(item.excerpt,/。$/);
    const chain=requests.filter(request=>request.url===asset||request.url===redirected);
    assert.deepEqual(chain.map(request=>request.url),[asset,redirected]);
    assert.equal(chain[0].signal,chain[1].signal);
    assert.equal(timeouts.filter(ms=>ms===60000).length,1);
    assert.ok(timeouts.filter(ms=>ms===12000).length>=2);
  }finally{AbortSignal.timeout=original;}
});

test('KPMG rejects oversized streams and foreign redirect without a retry',async()=>{
  let cancelled=false;
  const large=await run(()=>new Response(new ReadableStream({
    pull(controller){controller.enqueue(new Uint8Array(6*1024*1024));},
    cancel(){cancelled=true;},
  }),{headers:{'content-type':'application/pdf'}}));
  assert.equal(cancelled,true);
  assert.equal(large.result.items.length,0);
  assert.equal(large.result.sources.find(source=>source.name==='KPMG').status,'failed');
  assert.equal(large.requests.filter(request=>request.url===asset).length,1);
  const foreign=await run(()=>new Response(null,{status:302,headers:{location:'https://example.invalid/report.pdf'}}));
  assert.equal(foreign.result.items.length,0);
  assert.equal(foreign.requests.filter(request=>request.url===asset).length,1);
});

test('KPMG body timeout aborts the original stream, without a second PDF request',async()=>{
  const observed=[],original=AbortSignal.timeout;
  let aborted=false;
  AbortSignal.timeout=ms=>{observed.push(ms);return original(ms===60000?20:ms);};
  try{
    const {result,requests}=await run((_url,signal)=>new Response(new ReadableStream({
      start(controller){
        const timer=setTimeout(()=>controller.close(),1000);
        signal.addEventListener('abort',()=>{
          clearTimeout(timer);
          aborted=true;
          controller.error(signal.reason);
        },{once:true});
      },
    }),{headers:{'content-type':'application/pdf'}}));
    assert.equal(aborted,true);
    assert.equal(result.items.length,0);
    assert.equal(result.sources.find(source=>source.name==='KPMG').status,'failed');
    assert.equal(requests.filter(request=>request.url===asset).length,1);
    assert.equal(observed.filter(ms=>ms===60000).length,1);
  }finally{AbortSignal.timeout=original;}
});

test('KPMG preserves an explicitly published month rather than dropping it or manufacturing a day',async()=>{
  const month=()=>html('<script type="application/ld+json">{"datePublished":"2026-09"}</script><a href="'+asset+'">公开报告</a>');
  const {result}=await run(()=>new Response(pdf,{headers:{'content-type':'application/pdf'}}),month);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].publishedAt,'2026-09');
});

async function readMintel(articleBody){
  const original=globalThis.fetch;
  const feed=press+'feed/', article=press+'independent-flavor/';
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url===directory)return new Response(null,{status:503});
    if(url===press)return html('<link rel="alternate" type="application/rss+xml" href="'+feed+'">');
    if(url===feed)return new Response('<rss><channel><item><title>中国食品风味报告</title><link>'+article+
      '</link><pubDate>Wed, 16 Sep 2026 16:30:00 +0000</pubDate><description>研究摘要</description></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}});
    if(url===article)return html('<main><h1>中国食品风味报告</h1><time>2026年9月17日</time><article><p>'+articleBody+'</p></article></main>');
    throw Error('Unexpected '+url);
  };
  try{
    return await readNewResearch(now,undefined,true);
  }finally{globalThis.fetch=original;}
}

test('Mintel uses the visible release day when RSS time crosses the Shanghai date boundary',async()=>{
  const {items}=await readMintel(('英敏特研究发现，中国消费者选择食品时更关注自然风味与场景。'+'来自食品购买研究的公开案例展示了饮料与零食的具体口味变化。').repeat(6));
  assert.equal(items.length,1);
  assert.equal(items[0].publishedAt,'2026-09-17');
});

test('Mintel does not treat a methodology illustration as a research finding',async()=>{
  const {items}=await readMintel(('食品饮料研究方法介绍。例如，可以先按年龄和居住地划分消费者样本，再比较受访者群体的购买偏好。'+
    '也可以先设定品牌数据库的过滤参数，再导出需要比较的产品类别。此处仅说明研究设计的步骤。').repeat(7));
  assert.equal(items.length,0);
});
