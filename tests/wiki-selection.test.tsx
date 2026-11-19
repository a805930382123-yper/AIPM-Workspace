import assert from 'node:assert/strict';import test from 'node:test';import {JSDOM} from 'jsdom';
import type { WikiLintResult } from '../app/api.ts';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),{window}=dom;
for(const [name,value]of Object.entries({window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,HTMLTextAreaElement:window.HTMLTextAreaElement,HTMLSelectElement:window.HTMLSelectElement,Event:window.Event,MouseEvent:window.MouseEvent,CustomEvent:window.CustomEvent,Node:window.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{WikiPage}=await import('../app/pages/WikiPage.tsx');
window.HTMLElement.prototype.scrollIntoView = () => {};
const a={id:'wiki-a',title:'虚构指标甲',type:'metric',category:'metric',aliases:[],tags:[],sources:[],body:'甲正文20%',revision:1,created:'2026-10-01',updated:'2026-10-01',knowledge_status:'needs_verification',review_status:'unreviewed',confidence:'low',source_level:'D',links:[]},b={...a,id:'wiki-b',title:'虚构指标乙',body:'乙正文30%'},schema={types:[{id:'metric',label:'指标'}],categories:[{id:'metric',label:'指标'}],pageTemplates:{},enums:{knowledge_status:['needs_verification'],confidence:['low'],source_level:['D'],review_status:['unreviewed']},sourcePolicy:{levels:[],guidance:''}};
const reply=(data:unknown,status=200)=>({ok:status<300,status,text:async()=>JSON.stringify(data)}) as Response;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const tick=(ms=0)=>new Promise(r=>setTimeout(r,ms));
async function wait(check:()=>boolean,label:string){for(let i=0;i<100;i++){if(check())return;await act(async()=>{await tick(10);});}assert.fail('Timeout '+label);}
async function click(target:HTMLElement|undefined|null){assert(target);await act(async()=>{target.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));await tick();});}
async function input(target:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{const proto=target instanceof window.HTMLTextAreaElement?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(target,value);target.dispatchEvent(new window.Event('input',{bubbles:true}));await tick();});}
async function harness(options:{initialOpenId?:string;initialA?:ReturnType<typeof deferred<Response>>}={}){
 const calls:Array<{url:string;method:string}>=[],pending:Array<ReturnType<typeof deferred<Response>>>=[],nativeFetch=globalThis.fetch;
 let intercept:(url:string,method:string)=>Promise<Response>|undefined=(url)=>url==='/api/wiki/wiki-a'?options.initialA?.promise:undefined;
 globalThis.fetch=async(url,init={})=>{const route=String(url),method=init.method??'GET';calls.push({url:route,method});const overridden=intercept(route,method);if(overridden)return overridden;
  if(route==='/api/wiki/schema')return reply(schema);if(route.startsWith('/api/raw?')||route.startsWith('/api/drafts?')||route==='/api/knowledge/workflows'||route.startsWith('/api/audits?'))return reply({items:[]});
  if(route.startsWith('/api/wiki?')){const q=new URL(route,'http://localhost/').searchParams.get('q')??'';const items=q==='乙'?[b]:q==='无匹配'?[]:[a,b];return reply({items,categoryCounts:{metric:items.length}});}
  if(route==='/api/wiki/wiki-a')return reply(a);if(route==='/api/wiki/wiki-b')return reply(b);return reply({error:{message:'隔离未知页面'}},404);
 };
 const container=window.document.getElementById('root')!,root=createRoot(container),details=()=>container.querySelector('.wiki-detail')?.textContent??'',item=(title:string)=>[...container.querySelectorAll<HTMLButtonElement>('.wiki-list-item')].find(x=>x.textContent!.includes(title));
 await act(async()=>{root.render(createElement(WikiPage,{onOpenRaw:()=>{},onChanged:()=>{},initialOpenId:options.initialOpenId}));await tick();});
 return {container,calls,details,item,intercept:(next:typeof intercept)=>{intercept=next;},defer:()=>{const d=deferred<Response>();pending.push(d);return d;},search:async(value:string)=>input(container.querySelector<HTMLInputElement>('[aria-label="搜索 Wiki"]')!,value),clean:async()=>{for(const d of pending)d.resolve(reply(a));options.initialA?.resolve(reply(a));await act(async()=>{root.unmount();await tick();});globalThis.fetch=nativeFetch;}};
}

test('EDGE Wiki repeated selected clicks keep loaded detail and do not start redundant reads',async()=>{
 const f=await harness();try{await wait(()=>f.details().includes(a.body),'A detail');const before=f.calls.filter(c=>c.url==='/api/wiki/wiki-a').length;for(let i=0;i<3;i++){await click(f.item(a.title));assert(f.details().includes(a.body));}assert.equal(f.calls.filter(c=>c.url==='/api/wiki/wiki-a').length,before);}finally{await f.clean();}
});
test('EDGE Wiki selected clicks during initial load preserve the existing request and eventually show detail',async()=>{
 const loading=deferred<Response>(),f=await harness({initialA:loading});try{await wait(()=>!!f.item(a.title)&&f.calls.some(c=>c.url==='/api/wiki/wiki-a'),'pending A');await click(f.item(a.title));await click(f.item(a.title));assert.equal(f.details(),'');assert.equal(f.calls.filter(c=>c.url==='/api/wiki/wiki-a').length,1);await act(async()=>{loading.resolve(reply(a));await tick();});await wait(()=>f.details().includes(a.body),'loaded A');}finally{await f.clean();}
});
test('EDGE Wiki A→B→A ignores a delayed B response and same-item clicks do not clear the restored A',async()=>{
 const f=await harness();try{await wait(()=>f.details().includes(a.body),'A');const delayed=f.defer();f.intercept(url=>url==='/api/wiki/wiki-b'?delayed.promise:undefined);await click(f.item(b.title));await wait(()=>f.calls.some(c=>c.url==='/api/wiki/wiki-b'),'B requested');await click(f.item(a.title));await wait(()=>f.details().includes(a.body),'A restored');await act(async()=>{delayed.resolve(reply(b));await tick();});assert(f.details().includes(a.body));assert(!f.details().includes(b.body));await click(f.item(a.title));assert(f.details().includes(a.body));}finally{await f.clean();}
});
test('EDGE Wiki click same item exits editing and keeps its loaded reading content',async()=>{
 const f=await harness();try{await wait(()=>f.details().includes(a.body),'A');await click([...f.container.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent==='编辑'));assert(f.container.querySelector('form'));await click(f.item(a.title));assert.equal(f.container.querySelector('form'),null);assert(f.details().includes(a.body));}finally{await f.clean();}
});
test('EDGE Wiki ordinary search retains matching current selection, selects another result and clears safely',async()=>{
 const f=await harness();try{await wait(()=>f.details().includes(a.body),'A');await f.search('甲');await wait(()=>f.calls.some(c=>c.url.startsWith('/api/wiki?')&&new URL(c.url,'http://localhost/').searchParams.get('q')==='甲')&&f.container.querySelectorAll('.wiki-list-item').length===2,'matching list response');assert(f.details().includes(a.body));await f.search('乙');await wait(()=>f.container.querySelectorAll('.wiki-list-item').length===1&&f.details().includes(b.body),'B filtered');await click(f.item(b.title));assert(f.details().includes(b.body));await f.search('');await wait(()=>f.container.querySelectorAll('.wiki-list-item').length===2,'cleared list');assert(f.details().includes(b.body));await f.search('无匹配');await wait(()=>f.container.querySelectorAll('.wiki-list-item').length===0&&f.details()==='','empty search');await f.search('');await wait(()=>f.details().includes(a.body),'A after clear');}finally{await f.clean();}
});
test('EDGE Wiki selected click invalidates an older refresh response without clearing the current detail',async()=>{
 const f=await harness();try{await wait(()=>f.details().includes(a.body),'A');const stale=f.defer();f.intercept(url=>url==='/api/wiki/wiki-a'?stale.promise:undefined);const before=f.calls.length;await act(async()=>{window.dispatchEvent(new window.CustomEvent('wiki:refresh'));await tick();});await wait(()=>f.calls.length>before,'refresh requested');await click(f.item(a.title));assert(f.details().includes(a.body));await act(async()=>{stale.resolve(reply({...a,body:'迟到刷新不应覆盖'}));await tick();});assert(f.details().includes(a.body));assert(!f.details().includes('迟到刷新'));}finally{await f.clean();}
});
test('EDGE Wiki selected click invalidates an older save/readback and returns from edit to current detail',async()=>{
 const f=await harness();try{await wait(()=>f.details().includes(a.body),'A');const save=f.defer();let saving=false;f.intercept((url,method)=>{if(url==='/api/wiki/wiki-a'&&method==='PUT'){saving=true;return save.promise;}if(url==='/api/wiki/wiki-a'&&saving)return Promise.resolve(reply({...a,body:'迟到保存读回',revision:2}));return undefined;});await click([...f.container.querySelectorAll<HTMLButtonElement>('button')].find(x=>x.textContent==='编辑'));const form=f.container.querySelector('form')!;await act(async()=>{form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();});await wait(()=>saving,'save pending');await click(f.item(a.title));assert(f.details().includes(a.body));await act(async()=>{save.resolve(reply({...a,revision:2}));await tick();await tick();});assert(f.details().includes(a.body));assert(!f.details().includes('迟到保存读回'));assert.equal(f.container.querySelector('form'),null);}finally{await f.clean();}
});
for(const id of ['wiki-b','missing-wiki'])test(`EDGE Wiki recent-open ${id} remains readable or reports missing explicitly`,async()=>{
 const f=await harness({initialOpenId:id});try{if(id==='wiki-b'){await wait(()=>f.details().includes(b.body),'recent B');await wait(()=>!!f.item(b.title),'B listed');await click(f.item(b.title));assert(f.details().includes(b.body));}else{await wait(()=>/已不存在或无法读取|隔离未知页面/u.test(f.container.querySelector('[role="alert"]')?.textContent??''),'missing recent');await wait(()=>f.container.querySelectorAll('.wiki-list-item').length===2,'list after missing recent');assert(f.calls.some(c=>c.url==='/api/wiki/missing-wiki'));assert.equal(f.details(),'');assert(!f.details().includes(a.body));}}finally{await f.clean();}
});

test('LINT02 renders the scan states, all rule filters and precise grouped locations', async () => {
  const f = await harness();
  try {
    const scan = f.defer();
    const finding = (code: string, id: string | null, location: WikiLintResult['findings'][number]['location'], message = '合成检查说明。') => ({
      code, objectId: id, pageTitle: id ? '两页同名' : null,
      file: id ? `knowledge/wiki/${id}.md` : 'knowledge/audit/missing-wiki.json', message, location,
    });
    const line = '  - 文件中的原行 [[缺失目标]]';
    const shared = '这条事实没有可定位的证据。';
    const brokenMessage = '链接“缺失目标”没有可打开的 Wiki。';
    const result: WikiLintResult = {
      generatedAt: '2026-11-19', wikiFilesSha256: 'fixture-only',
      findings: [
        finding('SOURCE_MISSING', 'wiki-b', { scope: 'page', line: 5 }),
        finding('BROKEN_WIKI_LINK', 'wiki-a', { scope: 'line', line: 18, text: line }, brokenMessage),
        finding('BROKEN_WIKI_LINK', 'wiki-a', { scope: 'line', line: 19, text: line }, brokenMessage),
        finding('SOURCE_MISSING', 'wiki-a', { scope: 'page', line: 5 }),
        finding('UNSOURCED_FACT', 'wiki-a', { scope: 'line', line: 20, text: '- 合成事实一' }, shared),
        finding('UNSOURCED_FACT', 'wiki-a', { scope: 'line', line: 21, text: '- 合成事实二' }, shared),
        finding('OPEN_AUDIT', null, { scope: 'page', line: 1 }),
      ],
      summary: { SOURCE_MISSING: 2, BROKEN_WIKI_LINK: 2, UNSOURCED_FACT: 2, OPEN_AUDIT: 1 },
    };
    const byText = (value: string) => [...f.container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === value);
    const panel = f.container.querySelector('#wiki-view-lint')!;
    const groups = () => [...panel.querySelectorAll<HTMLElement>('.lint-page-group')];
    f.intercept(url => url === '/api/wiki-lint' ? scan.promise : undefined);
    await click(byText('结构检查（Lint）'));
    assert.match(panel.textContent!, /正在检查知识库/u);
    assert.equal(byText('重新检查')?.disabled, true);
    await act(async () => { scan.resolve(reply(result)); await tick(); });
    assert.match(panel.textContent!, /共 7 个问题 · 涉及 2 个 Wiki 页面/u);
    assert.deepEqual(groups().map(group => group.dataset.wikiId), ['wiki-a', 'wiki-b', undefined]);
    assert.ok(groups().every(group => group.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') === 'false'));
    assert.equal(groups()[0].querySelector('.lint-page-count')?.textContent, '5 条');
    assert.deepEqual([...groups()[0].querySelectorAll('.lint-type-count')].map(badge => badge.textContent), ['断开的 Wiki 链接 2', '缺少有效来源 1', '事实缺少可定位证据 2']);
    assert.ok(groups()[0].querySelector('.lint-edit-button'));
    assert.equal(groups()[2].querySelector('.lint-edit-button'), null);
    assert.match(groups()[2].textContent!, /无法编辑/u);
    const ruleFilters = [...panel.querySelectorAll<HTMLButtonElement>('.lint-filters button')];
    assert.equal(ruleFilters.length, 12);
    for (const button of ruleFilters.slice(1)) {
      await click(button);
      assert.equal(button.getAttribute('aria-pressed'), 'true');
      assert.ok(panel.querySelector('.lint-rule-guide')?.textContent?.includes('修复建议'));
    }
    assert.match(panel.textContent!, /显示 0 \/ 7 条问题/u);
    await click(ruleFilters.find(button => button.textContent?.startsWith('断开的 Wiki 链接')));
    assert.match(panel.textContent!, /显示 2 \/ 7 条问题/u);
    assert.deepEqual(groups().map(group => group.dataset.wikiId), ['wiki-a']);
    await click(groups()[0].querySelector<HTMLButtonElement>('.lint-page-toggle'));
    assert.equal(groups()[0].querySelector('pre')?.textContent, line);
    assert.match(groups()[0].textContent!, /L18.*断开的 Wiki 链接/u);
    assert.match(groups()[0].querySelector('.lint-finding-meta')?.textContent ?? '', /knowledge\/wiki\/wiki-a\.md.*BROKEN_WIKI_LINK/u);
    assert.deepEqual([...groups()[0].querySelectorAll('.lint-findings li p')].map(row => row.textContent), [brokenMessage, brokenMessage]);
    await click(ruleFilters[0]);
    assert.match(groups()[0].textContent!, /页面属性.*缺少有效来源/u);
    assert.match(groups()[0].querySelector('.lint-group-notes')?.textContent ?? '', /这条事实没有可定位的证据。/u);
    assert.equal(groups()[0].textContent!.split(shared).length - 1, 1);
    assert.deepEqual([...groups()[0].querySelectorAll('.lint-findings pre')].map(row => row.textContent), [line, line, '- 合成事实一', '- 合成事实二']);

    f.intercept(url => url === '/api/wiki-lint' ? Promise.resolve(reply({ error: { message: '合成读取失败。' } }, 503)) : undefined);
    await click(byText('重新检查'));
    assert.match(panel.querySelector('[role="alert"]')?.textContent ?? '', /结构检查失败.*合成读取失败/u);
    assert.match(panel.textContent!, /上次检查结果.*共 7 个问题/u);
    f.intercept(url => url === '/api/wiki-lint' ? Promise.resolve(reply({ ...result, findings: [], summary: {} })) : undefined);
    await click(byText('重新检查'));
    assert.equal(panel.querySelector('[role="alert"]'), null);
    assert.match(panel.querySelector('.lint-notice-clean')?.textContent ?? '', /没有发现结构问题/u);
    assert.equal(groups().length, 0);
  } finally { await f.clean(); }
});

test('LINT02 collapsed same-title cards open the correct fresh editor and save only on submit', async () => {
  const f = await harness();
  try {
    await wait(() => f.details().includes(a.body), 'initial Wiki');
    const lintResult: WikiLintResult = {
      generatedAt: '2026-11-19', wikiFilesSha256: 'fixture-only', summary: { DUPLICATE_TITLE: 2 },
      findings: [a, b].map(item => ({
        code: 'DUPLICATE_TITLE', objectId: item.id, pageTitle: a.title, file: `knowledge/wiki/${item.id}.md`,
        message: '测试同名', location: { scope: 'page', line: 1 },
      })),
    };
    const freshA = { ...a, revision: 3, body: '点击 Lint 编辑用的甲最新版。' };
    const freshB = { ...b, title: a.title, revision: 6, body: '同名页乙正文。' };
    f.intercept((url, method) => {
      if (url === '/api/wiki-lint') return Promise.resolve(reply(lintResult));
      if (url === '/api/wiki/wiki-a') return Promise.resolve(reply(freshA));
      if (url === '/api/wiki/wiki-b') return Promise.resolve(reply({ ...freshB, revision: method === 'PUT' ? 7 : 6 }));
    });
    const editor = () => f.container.querySelector<HTMLFormElement>('.wiki-editor');
    const tab = f.container.querySelector<HTMLButtonElement>('#wiki-tab-lint');
    const cardButton = (id: string) => f.container.querySelector<HTMLButtonElement>(`.lint-page-group[data-wiki-id="${id}"] .lint-edit-button`);
    const writes = () => f.calls.filter(call => call.method !== 'GET');
    await click(tab);
    await click(cardButton(a.id));
    await wait(() => editor()?.querySelector('textarea')?.value === freshA.body, 'fresh editor A');
    assert.equal(window.document.activeElement, editor()?.closest('.wiki-detail-panel'));
    await click(editor()?.querySelector<HTMLButtonElement>('[aria-label="取消编辑"]'));
    assert.equal(editor(), null);
    assert.deepEqual(writes(), []);
    await click(tab);
    await click(cardButton(b.id));
    await wait(() => editor()?.querySelector('textarea')?.value === freshB.body, 'same title editor B');
    assert.deepEqual(writes(), []);
    await act(async () => { editor()!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); });
    assert.deepEqual(writes(), [{ url: '/api/wiki/wiki-b', method: 'PUT' }]);
  } finally { await f.clean(); }
});
