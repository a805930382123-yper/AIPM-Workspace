import {synthesisFixture} from './acceptance/SYN01-FIX-20261026-fake.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {storageFixture} from './support/kb02-storage-fixture.ts';
import {storageHttp} from './support/kb02-storage-http.ts';
import {WikiStore} from '../services/wiki/store.ts';
import {KnowledgeWorkflowStore} from '../services/wiki/knowledge-workflows.ts';

const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
for(const [name,value]of Object.entries({window:w,document:w.document,navigator:w.navigator,HTMLElement:w.HTMLElement,HTMLInputElement:w.HTMLInputElement,HTMLTextAreaElement:w.HTMLTextAreaElement,HTMLSelectElement:w.HTMLSelectElement,MouseEvent:w.MouseEvent,Event:w.Event,Node:w.Node,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
const {act,createElement}=await import('react'),{createRoot}=await import('react-dom/client'),{DraftReviewPage}=await import('../app/pages/DraftReviewPage.tsx'),{KnowledgeWorkflowPage}=await import('../app/pages/KnowledgeWorkflowPage.tsx');
const nativeFetch=globalThis.fetch;
const buttons=(label:string)=>[...w.document.querySelectorAll('button')].filter(b=>b.textContent?.trim()===label);
async function tick(check:()=>boolean,label:string){const deadline=performance.now()+6000;while(performance.now()<deadline){await act(async()=>{await new Promise(r=>setTimeout(r,15));});if(check())return;}assert.fail('Human UI timeout: '+label+' '+w.document.body.textContent?.slice(0,500));}
async function click(button:HTMLButtonElement|undefined){assert(button);assert(!button.disabled);await act(async()=>{button.click();await new Promise(r=>setTimeout(r,0));});}
async function change(element:HTMLInputElement|HTMLSelectElement,value:string){await act(async()=>{const proto=element instanceof w.HTMLSelectElement?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(element,value);element.dispatchEvent(new w.Event('change',{bubbles:true}));if(element instanceof w.HTMLInputElement)element.dispatchEvent(new w.Event('input',{bubbles:true}));});}

test('RAWUX01 maintenance React + real HTTP preserves edits and requires a fresh explicit selection and overall confirmation', async () => {
  const f = await storageFixture();
  f.succeed();
  const original = f.provider.complete;
  f.provider.complete = async request => {
    const response = await original(request);
    if (!request.user.includes('请对下列全部已验证事实规划知识页')) return response;
    const plan = JSON.parse(response.text), page = plan.pages[0];
    plan.pages = [
      { ...page, title: '目标门店', factUnitIds: page.factUnitIds.slice(0, 1) },
      { ...page, title: '铺货率', factUnitIds: page.factUnitIds.slice(1) },
    ];
    const text = JSON.stringify(plan);
    return { ...response, text, bytes: Buffer.byteLength(text) };
  };
  const h = await storageHttp(f, f.runner, { knowledge: true });
  let root: ReturnType<typeof createRoot> | undefined, committed = 0;
  const commitCalls: Array<{url:string; body:any}> = [];
  const legacyApprovals: string[] = [];
  globalThis.fetch = (url, init) => {
    if (String(url).endsWith('/confirm')) commitCalls.push({url:String(url),body:JSON.parse(String(init?.body))});
    if (/\/review\/(pages|structured-note)/.test(String(url))) legacyApprovals.push(String(url));
    return nativeFetch(String(url).startsWith('/api/') ? h.base + url : url, init);
  };
  try {
    const job = await f.wait((await f.start()).job.id);
    assert.equal(job.status, 'completed');
    assert.ok(job.draftId);
    const draftId = job.draftId, readDraft = async () => (await f.drafts.get(draftId))!;
    const wiki = new WikiStore(f.root, f.rawStore);
    const stage = (request: (typeof f.requests)[number]) => request.system.startsWith('知识维护提议')
      ? 'maintenance' : request.user.includes('请对下列全部已验证事实规划知识页') ? 'planning' : 'extraction';
    assert.deepEqual(f.requests.map(stage), ['extraction', 'planning', 'maintenance']);
    const mount = async () => {
      root = createRoot(w.document.getElementById('root')!);
      await act(async () => root!.render(createElement(DraftReviewPage, {
        draftId, onBack: () => {}, onOpenRaw: () => {}, onCommitted: async () => { committed++; },
      })));
      await tick(() => checks().length === 2, 'two outcome choices');
    };
    const confirm = () => [...w.document.querySelectorAll('button')].find(b => b.textContent?.startsWith('确认所选成果入库'))!;
    const checks = () => [...w.document.querySelectorAll<HTMLInputElement>('input[aria-label^="选择入库 "]')];
    await mount();
    await tick(() => Boolean(w.document.querySelector('.draft-raw-preview')?.textContent), 'Raw preview loaded');
    assert.equal(w.document.querySelector('.draft-raw-preview')?.textContent, f.raw.body);
    assert.equal(w.document.querySelector('.draft-raw-preview')?.getAttribute('contenteditable'), null);
    assert(confirm().disabled);
    assert(checks().every(check => !check.disabled && !check.checked));
    await act(async () => { checks()[0].click(); checks()[1].click(); });
    assert.equal(confirm().disabled, false);
    assert.deepEqual((await readDraft()).maintenance!.changes.map(c => c.decision), ['defer', 'defer']);
    const initial = await readDraft(), unit = initial.humanReview!.units[0];
    const assignment = () => w.document.querySelector<HTMLSelectElement>(`select[aria-label="归属 ${unit.id}"]`)!;
    await change(assignment(), '');
    await tick(() => assignment().value === '' && !confirm().disabled, 'optional unresolved assignment persisted');
    assert.equal((await readDraft()).humanReview!.assignments[unit.id], null);
    await click(buttons('编辑主题成果')[0]);
    const title = w.document.querySelector<HTMLInputElement>('.outcome-edit input')!;
    await change(title, '人工确认的新主题');
    assert(confirm().disabled);
    await click(buttons('保存成果编辑')[0]);
    await tick(() => !w.document.querySelector('.outcome-edit') && !confirm().disabled, 'edited outcome saved');
    const edited = (await readDraft()).maintenance!.changes;
    assert.equal(edited[0].candidate.title, '人工确认的新主题');
    assert(edited.every(c => c.approval === undefined));
    await act(async () => root!.unmount());
    root = undefined;
    await mount();
    assert(w.document.body.textContent!.includes('人工确认的新主题'));
    assert(confirm().disabled);
    await act(async () => { checks()[0].click(); checks()[1].click(); });
    const current = await readDraft();
    assert.equal(commitCalls.length, 0);
    assert.deepEqual(await wiki.list(), []);
    await click(confirm());
    await tick(() => committed === 1, 'explicit formal commit');
    assert.equal(commitCalls.length, 1);
    assert.equal(commitCalls[0].url, '/api/drafts/'+draftId+'/confirm');
    assert.equal(commitCalls[0].body.baseRevision, current.revision);
    assert.equal(commitCalls[0].body.outcomeDigest, f.drafts.outcomeDigest(current));
    assert.deepEqual(legacyApprovals, []);
    assert.equal((await readDraft()).status, 'confirmed');
    const formal = await wiki.list();
    assert.equal(formal.length, 3);
    assert(formal.some(page => page.type === 'source' && page.sources.includes(f.raw.id)));
    assert(formal.some(page => page.title === '人工确认的新主题' && page.sources.includes(f.raw.id)));
    assert(formal.some(page => page.title === '铺货率' && page.sources.includes(f.raw.id)));
    assert.deepEqual(f.requests.map(stage), ['extraction', 'planning', 'maintenance']);
    const raw = await f.rawStore.get(f.raw.id);
    assert.equal(raw?.body, f.raw.body);
    assert.equal(raw?.bodySha256, f.raw.bodySha256);
  } finally {
    if (root) await act(async () => root!.unmount());
    globalThis.fetch = nativeFetch;
    await h.close();
    await f.clean();
  }
});

test('HUMAN synthesis React + real HTTP shows immutable proposals, unresolved blocks, corrected content needs new single-page review',async()=>{
 const f=await storageFixture(),h=await storageHttp(f,f.runner,{knowledge:true});let root:ReturnType<typeof createRoot>|undefined,done=0;
 globalThis.fetch=(url,init)=>nativeFetch(String(url).startsWith('/api/')?h.base+url:url,init);
 try{const second=await f.rawStore.create({title:'第二来源',sourceType:'report',sourceName:'虚构',tags:[],body:'目标门店120家。'}),wiki=new WikiStore(f.root,f.rawStore);await wiki.initialize();const service=new KnowledgeWorkflowStore(f.root,wiki,f.rawStore);await service.initialize();const flow=await service.createSynthesis({rawIds:[f.raw.id,second.id],provider:{name:'fake',model:'ui',complete:async request=>({text:JSON.stringify(synthesisFixture(request,{title:'综合预览',category:'metric',suggestedAdditions:[],conflicts:[],agreement:[],inferences:['待人工核对的推断'],openQuestions:[]})),bytes:1,finishReason:'stop'})}});
  root=createRoot(w.document.getElementById('root')!);await act(async()=>root!.render(createElement(KnowledgeWorkflowPage,{workflowId:flow.id,onBack:()=>{},onDone:async()=>{done++;}})));await tick(()=>buttons('确认本页主题与完整归属').length===1,'workflow review');
  assert(w.document.body.textContent!.includes('待人工核对的推断'));const select=w.document.querySelector<HTMLSelectElement>('select[aria-label^="归属 "]')!;await change(select,'');await tick(()=>w.document.body.textContent!.includes('未解决 1 项'),'workflow unresolved');await click(buttons('确认写入')[0]);assert.equal(done,0);assert.match(w.document.body.textContent!,/解决所有未解决项/);
  await change(w.document.querySelector<HTMLSelectElement>('select[aria-label^="归属 "]')!,flow.id);await tick(()=>w.document.body.textContent!.includes('未解决 0 项'),'workflow resolved');await click(buttons('确认本页主题与完整归属')[0]);await tick(()=>w.document.body.textContent!.includes('本页已审查'),'single review');await click(buttons('确认写入')[0]);await tick(()=>done===1,'workflow formal commit');assert.equal((await service.get(flow.id))!.status,'confirmed');
 }finally{if(root)await act(async()=>root!.unmount());globalThis.fetch=nativeFetch;await h.close();await f.clean();}
});
