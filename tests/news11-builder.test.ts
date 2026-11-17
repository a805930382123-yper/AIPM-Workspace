import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readNewsSources} from '../services/news/sources.ts';

test('失败来源的同标题候选在正文不合格后仍能补位，其他来源零请求',async t=>{
  const host='https://worldpanelbynumerator.com';
  const list=host+'/language/chinese-simplified';
  const shallow=host+'/insights/quality-rejected', supported=host+'/insights/quality-accepted';
  const title='中国食品零售趋势调研';
  const requests:string[]=[];
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async input=>{
    const url=String(input);
    requests.push(url);
    const html=(body:string)=>new Response(body,{headers:{'Content-Type':'text/html'}});
    if(url===list) return html([shallow,supported].map(detail=>
      `<div class="blog-post-title"><a href="${new URL(detail).pathname}">${title}</a>`+
      '<div class="post-meta"><span class="small-text">2026-11-16</span></div></div>').join(''));
    if(url===shallow) return html('<div class="article w-richtext"><p>内容过短</p></div>');
    if(url===supported) return html('<div class="article w-richtext"><p>'+'中国食品零售消费者调研显示食品销量同比增长 12%，调研覆盖多个零售渠道。'.repeat(8)+'</p></div>');
    assert.fail('未选来源被请求');
  };
  const result=await readNewsSources('fmcg',new Date('2026-11-17T04:00:00Z'),undefined,new Set(['worldpanel']));
  assert.deepEqual(requests,[list,shallow,supported]);
  assert.deepEqual(result.items.map(item=>item.url),[supported]);
  assert.deepEqual(result.sources.map(source=>source.sourceId),['worldpanel']);
  const diagnosis=result.sources[0].diagnosis;
  assert.equal(diagnosis?.outcome,'ok');
  assert.deepEqual(diagnosis?.counts,{candidates:2,qualified:1,duplicates:0,rejected:1,failed:0});
  assert.ok(diagnosis.lastSuccessAt);
});
