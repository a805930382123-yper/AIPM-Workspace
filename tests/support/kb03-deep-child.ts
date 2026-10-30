/** Real subprocess for restart evidence, TEMP data and parent-owned fake Provider only. */
import { RawStore } from '../../services/raw/store.ts';
import { RawStateStore } from '../../services/raw/state.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { ExtractionRunner, ExtractionJobStore } from '../../services/llm/jobs.ts';
import { LLMService } from '../../services/llm/service.ts';
import { loadExtractionRules } from '../../services/llm/rules.ts';
import { storageHttp } from './kb02-storage-http.ts';
const [root,endpoint]=process.argv.slice(2);
const rawStore=new RawStore(root),rawStates=new RawStateStore(root),drafts=new DraftStore(root),jobs=new ExtractionJobStore(root);
await Promise.all([rawStore.initialize(),rawStates.initialize(),drafts.initialize(),jobs.initialize()]);
const provider={name:'fake',model:'budget-model',complete:async(request:unknown)=>{
  const result=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});if(!result.ok)throw Error('fake failure');return result.json();
}};
const runner=new ExtractionRunner({root,rawStore,rawStates,drafts,jobs,provider:()=>provider,llm:new LLMService('rules'),rulesDir:'rules',draftRules:async()=>{const b=await loadExtractionRules('rules');return {types:['metric'],categories:['metric'],...b.fmcg.enums} as any;}});
await runner.reconcile();
const http=await storageHttp({root,rawStore,rawStates,drafts,jobs,provider,runner} as any,runner);
process.send?.({base:http.base});
