import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { firstDueAfter, isAutomationPlan, planWindow, samePlan } from '../../services/automation/schedule.ts';
import { WikiLintSnapshots } from '../../services/automation/tasks/wiki-lint.ts';
import { selectInspectionPages } from '../../services/automation/tasks/wiki-inspect.ts';

test('Shanghai weekly schedules match a day-by-day calendar oracle at month/year boundaries', () => {
  const date=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const isoWeek=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const day=86400000,week=day*7;
  for(const start of ['2026-12-31T00:29:00Z','2026-12-31T00:30:00Z','2028-02-28T00:31:00Z']){
    const now=Date.parse(start);
    for(let weekday=1;weekday<=7;weekday++){
      const plan={kind:'weekly',weekday,time:'08:30',timezone:'Asia/Shanghai'};
      assert(isAutomationPlan(plan));
      const candidate = Math.floor(now/day)*day+30*60000;
      let chosen=candidate;
      while(chosen<=now || !date.format(chosen).includes(isoWeek[weekday-1])) chosen+=day;
      assert.equal(firstDueAfter(plan,now),chosen);
      assert.deepEqual(planWindow(plan,chosen,chosen+3*week+1),{latest:chosen+3*week,next:chosen+4*week});
      assert(samePlan(plan,{...plan}));
      for(const invalid of [{weekday:0},{weekday:8},{weekday:1.5},{weekday:'1'},{time:'8:30'},{timezone:'UTC'}]) assert(!isAutomationPlan({...plan,...invalid}));
      assert(!samePlan(plan,{...plan,time:'08:31'}));
      assert(!samePlan(plan,{...plan,weekday:weekday===7?1:weekday+1}));
    }
  }
});

test('selection fills the budget after an oversized page, orders source changes first and counts JSON delimiters',()=>{
  const page=(id,updated,revision=1,body='x')=>({id,updated,revision,body});
  const base='2026-11-01T00:00:00.000Z',older='2026-10-01T00:00:00.000Z',later='2026-11-19T00:00:00.000Z';
  const pages=[page('old',older,2),page('derived',older),page('oversize',later,1,'x'.repeat(48001)),page('new',later),...Array.from({length:10},(_,i)=>page('fixed'+i,older))];
  const before=structuredClone(pages);
  const selected=selectInspectionPages(pages,{createdAt:base,readWiki:[page('old',older)]},new Set(['derived']));
  assert.deepEqual(selected.wikiIds,['derived','new','old','fixed0','fixed1','fixed2','fixed3','fixed4']);
  assert.equal(selected.skipped.length,pages.length-8);
  assert.deepEqual(pages,before);
  const first=page('a',older,1,'');
  first.body='x'.repeat(48000-JSON.stringify([first]).length);
  assert.equal(JSON.stringify([first]).length,48000);
  assert.deepEqual(selectInspectionPages([first],undefined,new Set()).wikiIds,['a']);
  first.body+='x';assert.deepEqual(selectInspectionPages([first],undefined,new Set()).wikiIds,[]);
});

test('lint retention keeps either of the two limits and reports corrupt snapshots independently',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kbmaint01-retention-'));
  const store=new WikiLintSnapshots(root), id=()=>randomUUID();
  const now=Date.parse('2026-11-20T00:00:00Z'), day=86400000;
  const write=async(when)=>{const runId=id();await store.save({runId,checkedAt:new Date(when).toISOString(),total:0,byCode:{},findings:[],diff:{isBaseline:true,previousRunId:null,addedCount:0,resolvedCount:0,unchangedCount:0,added:[],resolved:[]}});return runId;};
  const removed=await write(now-400*day),old=await write(now-399*day);
  for(let i=0;i<199;i++) await write(now-200*day+i);
  await store.prune(now);await assert.rejects(store.get(removed));assert.equal((await store.get(old)).runId,old);
  for(let i=0;i<202;i++) await write(now-2*day+i);
  const dir=path.join(root,'state/automation/wiki-lint');
  const invalid=id();await writeFile(path.join(dir,invalid+'.json'),'{');
  await store.prune(now);
  assert.equal((await readdir(dir)).length,203);
  assert(store.issues().some(x=>x.file.includes(invalid)));
});
