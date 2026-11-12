import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readAdditionalResearch} from '../../services/news/additional-research.ts';
import {readResearchSources} from '../../services/news/research-sources.ts';
import {normalizedTitle,normalizedUrl} from '../../services/news/normalize.ts';

const now=new Date('2026-11-12T06:00:00.000Z');
const nbs='https://www.stats.gov.cn/sj/zxfbhjd/';
const pwc='https://www.pwccn.com/zh/';
const pwcList=pwc+'industries/retail-and-consumer.html';
const niq='https://nielseniq.cn/';
const niqList=niq+'global/zh/insights/consumer-packaged-goods/';
const niqDetail=niq+'global/zh/insights/analysis/2026/independent-review/';
const niqPdf=niq+'wp-content/uploads/sites/9/2026/11/independent-review.pdf';
const nbsDetail=id=>nbs+'202610/t20261019_'+id+'.html';
const pwcDetail=id=>pwc+'industries/retail-and-consumer/publications/'+id+'.html';
const pwcPdf=id=>pwc+'retail-and-consumer/'+id+'.pdf';
const html=text=>new Response(text,{headers:{'content-type':'text/html'}});
const pdf=bytes=>new Response(bytes,{headers:{'content-type':'application/pdf'}});
const down=()=>new Response(null,{status:503});
const statCard=(id,title,date)=>'<li><a href="'+nbsDetail(id)+'">'+title+'</a><span>'+date+'</span></li>';
const statTitle=id=>'2026年社会消费品零售总额 '+id;
const body=text=>'<div class="trs_editor_view TRS_Editor">'+text+'</div>';
const retail='2026年9月份，限额以上单位粮油食品类商品零售额同比增长5.1%，1—9月份累计同比增长3.2%。';
const nbsTable='<table><tr><th>指标</th><th colspan="2">9月</th><th colspan="2">1—9月</th></tr>'+
  '<tr><td></td><td>绝对量（亿元）</td><td>同比（%）</td><td>绝对量（亿元）</td><td>同比（%）</td></tr>'+
  '<tr><td>限额以上粮油食品类</td><td>100</td><td>5.1</td><td>900</td><td>3.2</td></tr></table>';
const survey='调查时间：2026年7月至8月。针对中国消费者的公开调查显示，52%的受访者更重视食品营养，饮料购买者倾向低糖和小规格。样本覆盖八个城市的家庭，快消商品通过商超、便利店以及线上零售渠道购买。'.repeat(5);
function makePdf(texts){
  const utf=s=>[...s].map(x=>x.charCodeAt(0).toString(16).padStart(4,'0')).join('').toUpperCase();
  const codes=[...new Set(texts.filter(Boolean).join(''))].map(utf);
  const cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'+codes.length+' beginbfchar\n'+codes.map(x=>'<'+x+'> <'+x+'>').join('\n')+'\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  const stream=x=>'<< /Length '+Buffer.byteLength(x,'latin1')+' >>\nstream\n'+x+'\nendstream';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids ['+texts.map((_,i)=>(6+i*2)+' 0 R').join(' ')+'] /Count '+texts.length+' >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fixture /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 500 >>',stream(cmap)];
  for(const [i,text] of texts.entries()){
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+(7+i*2)+' 0 R >>');
    const content=text
      ? 'BT /F1 10 Tf 14 TL 20 700 Td '+text.match(/.{1,70}/gu).map(line=>'<'+utf(line)+'> Tj').join(' T* ')+' ET'
      : 'q 200 0 0 200 20 250 cm BI /W 1 /H 1 /BPC 8 /CS /G ID \x80 EI Q';
    objects.push(stream(content));
  }
  let data='%PDF-1.5\n';
  const offsets=[];
  for(const [i,obj] of objects.entries()){
    offsets.push(Buffer.byteLength(data,'latin1'));
    data+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';
  }
  const xref=Buffer.byteLength(data,'latin1');
  return Buffer.from(data+'xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n','latin1');
}
const longPdf=makePdf([...Array(21).fill('目录'),survey]);
const imagePdf=makePdf([null,null,null]);
const collection=rows=>'<collection-v3 filter1="'+JSON.stringify({listItemCollection:rows}).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"></collection-v3>';
async function withFetch(routes,job){
  const previous=globalThis.fetch,requests=[],unexpected=[];
  globalThis.fetch=async input=>{
    const url=String(input);
    requests.push(url);
    if(routes[url])return routes[url]();
    unexpected.push(url);
    return down();
  };
  try{
    const result=await job();
    assert.deepEqual(unexpected,[]);
    return {requests,result};
  }finally{globalThis.fetch=previous;}
}

test('NBS listing skips four historical candidates before pagination and preserves published text',async()=>{
  const old=[10,11,12,13];
  const historical={
    urls:new Set([normalizedUrl(nbsDetail(10)+'?utm_source=tracking#same'),normalizedUrl(nbsDetail(11))]),
    titles:new Set([normalizedTitle(statTitle(12)+'！'),normalizedTitle(statTitle(13))]),
    pdfs:new Set(),
  };
  const {result,requests}=await withFetch({
    [nbs]:()=>html(old.map(i=>statCard(i,statTitle(i),'2026-10-19')).join('')),
    [nbs+'index_1.html']:()=>html([
      statCard(21,statTitle('含汽车'),'2026-10-19'),
      statCard(22,statTitle('缺可核正文'),'2026-10-19'),
      statCard(23,statTitle('缺日期'),''),
    ].join('')),
    [nbs+'index_2.html']:()=>html('<li>目录暂缺下一项</li>'),
    [nbs+'index_3.html']:()=>html('<li>目录暂缺下一项</li>'),
    [nbsDetail(21)]:()=>html(body('<p>'+retail+'</p>'+nbsTable)),
    [nbsDetail(22)]:()=>html('<p>导航诱饵：粮油食品增长90%。</p>'+body('<p>只保留概览。</p>')),
    [nbsDetail(23)]:()=>html(body('<p>'+retail+'</p>')),
    [pwcList]:down,
  },()=>readAdditionalResearch(now,historical,true));
  assert.ok(old.every(i=>!requests.includes(nbsDetail(i))));
  assert.ok(requests.includes(nbs+'index_1.html'));
  assert.ok(requests.filter(x=>x.startsWith(nbs)&&x.includes('/t')).length<=4);
  const row=result.items.find(x=>x.sourceId==='nbs');
  assert.equal(result.items.length,1);
  assert.equal(row.publishedAt,'2026-10-19');
  assert.ok(row.excerpt.includes(retail));
  assert.match(row.research.kind,/宏观零售统计，非品牌销量/);
  assert.equal(result.sources.find(x=>x.name==='PwC').status,'failed');
});

test('NBS omits commentary and orphan table cells, retaining total and eligible channel context',async()=>{
  const total='2026年9月份，社会消费品零售总额42433亿元，同比增长1.1%。';
  const channel='按零售业态分，限额以上零售业单位中便利店、超市零售额同比分别增长5.2%、4.1%。';
  const {result}=await withFetch({
    [nbs]:()=>html([
      statCard(31,'专家解读：2026年社会消费品零售总额','2026-10-19'),
      statCard(32,'2026年8月份社会消费品零售总额增长2.0%','2026-09-15'),
      statCard(33,'2026年9月份社会消费品零售总额增长1.1%','2026-10-19'),
    ].join('')),
    [nbs+'index_1.html']:()=>html('<li>没有本批专题</li>'),
    [nbs+'index_2.html']:()=>html('<li>没有本批专题</li>'),
    [nbs+'index_3.html']:()=>html('<li>没有本批专题</li>'),
    [nbsDetail(31)]:()=>html(body('<p>'+retail+'</p>')),
    [nbsDetail(32)]:()=>html(body('<table><tr><td><p>粮油食品类</p></td><td><p>粮油食品同比99.9%</p></td></tr></table>')),
    [nbsDetail(33)]:()=>html(body('<p>'+total+'</p><p>'+channel+'</p>')),
  },()=>readAdditionalResearch(now));
  assert.deepEqual(result.items.map(x=>x.url),[nbsDetail(33)]);
  assert.ok(result.items[0].excerpt.includes(total));
  assert.ok(result.items[0].excerpt.includes(channel));
});

test('PwC dynamic collection keeps official month, scans past 20, rejects image-only, and respects PDF limit',async()=>{
  const rows=['image','long','extra'].map((slug,i)=>({
    collectionTitle:'中国消费者调查报告 '+slug,url:pwcDetail(slug),
    publishDate:'10月 2026',date:'Thu Oct '+(20-i)+' 00:00:00 UTC 2026',
  }));
  const {result,requests}=await withFetch({
    [nbs]:down,
    [pwcList]:()=>html(collection(rows)),
    ...Object.fromEntries(rows.map(({url},i)=>[url,()=>html('<a href="'+pwcPdf(['image','long','extra'][i])+'">公开PDF</a>')])),
    [pwcPdf('image')]:()=>pdf(imagePdf),
    [pwcPdf('long')]:()=>pdf(longPdf),
  },()=>readAdditionalResearch(now,undefined,true));
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].url,pwcDetail('long'));
  assert.equal(result.items[0].publishedAt,'2026-10');
  assert.equal(result.items[0].research.pageRange,'第 22 页');
  assert.match(result.items[0].research.kind,/受访者调查，非实际销量/);
  assert.match(result.items[0].excerpt,/52%的受访者/);
  assert.deepEqual(requests.filter(x=>x.endsWith('.pdf')),[pwcPdf('image'),pwcPdf('long')]);
});

test('NIQ scan remains limited to page 20 for the same page-22 material',async()=>{
  const {result,requests}=await withFetch({
    [nbs]:down,
    [pwcList]:down,
    'https://worldpanelbynumerator.com/language/chinese-simplified':down,
    [niqList]:()=>html('<a class="niq-card-link" href="'+niqDetail+'"><span class="niq-insight-title">中国消费者零售调研</span><time datetime="2026-10-19"></time></a>'),
    [niqDetail]:()=>html('<a href="'+niqPdf+'">公开PDF</a>'),
    [niqPdf]:()=>pdf(longPdf),
  },()=>readResearchSources(now));
  assert.equal(requests.filter(x=>x===niqPdf).length,1);
  assert.ok(requests.every(x=>!x.includes('pwccn.com')));
  assert.equal(result.items.length,0);
  assert.equal(result.sources.find(x=>x.name==='NIQ').status,'failed');
});
