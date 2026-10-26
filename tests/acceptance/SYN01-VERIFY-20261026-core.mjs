import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha,readJson,sourceFreeze,fakeOutput} from './SYN01-PREP-20261025-core.mjs';
import {synthesisFixture} from './SYN01-FIX-20261026-fake.ts';
import {RawStore} from '../../services/raw/store.ts';
import {assertNoKnownSecret} from '../../services/llm/provider.ts';
import {containsKnownSecret} from '../../services/llm/config.ts';
export {sha,readJson};
export const P='docs/reports/SYN01-VERIFY-20261026-',CARD='docs/handoffs/SYN01-VERIFY-20261026-task.md';
export const must=(ok,code)=>{if(!ok){const error=new Error(code);error.code=code;error.status=409;throw error;}};
export async function durable(file,value){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}}
export function scanSafe(value,secrets){if(typeof value==='string'){must(!containsKnownSecret(value,secrets),'SECRET_OUTPUT_WITHHELD');let parsed;try{parsed=JSON.parse(value);}catch{return;}if(parsed!==value)scanSafe(parsed,secrets);}else if(Array.isArray(value))value.forEach(x=>scanSafe(x,secrets));else if(value&&typeof value==='object')for(const[key,item]of Object.entries(value)){scanSafe(key,secrets);scanSafe(item,secrets);}}
export async function optional(file){try{return await readJson(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function freeze(){const snapshot=await sourceFreeze();for(const name of await fs.readdir('tests/acceptance'))if(name.startsWith('SYN01-VERIFY-20261026-'))snapshot.files.push({path:'tests/acceptance/'+name,sha256:sha(await fs.readFile('tests/acceptance/'+name))});snapshot.files.push({path:'tests/acceptance/SYN01-FIX-20261026-fake.ts',sha256:sha(await fs.readFile('tests/acceptance/SYN01-FIX-20261026-fake.ts'))});snapshot.files.push({path:CARD,sha256:sha(await fs.readFile(CARD))});snapshot.files.sort((a,b)=>a.path.localeCompare(b.path));return {files:snapshot.files,sha256:sha(snapshot.files)};}
export async function prepare(mode='real'){
  must(['real','fake'].includes(mode),'MODE_DENIED');const root=await fs.mkdtemp(path.resolve('.scratch-SYN01-VERIFY-20261026-')),raws=new RawStore(root);await raws.initialize();
  const fixture=await readJson('tests/acceptance/SYN01-PREP-20261025-fixtures.json'),samples=[];
  for(const item of fixture.raws){const raw=await raws.create({title:item.title,body:item.body,sourceType:'report',sourceName:'SYN01虚构隔离fixture',tags:['SYN01-isolated']});samples.push({id:raw.id,title:raw.title,bodySha256:raw.bodySha256});}
  const frozen=await freeze();await durable(path.join(root,'freeze.json'),frozen);
  const session={id:randomUUID(),root,mode,samples,freezeSha256:frozen.sha256,cardSha256:sha(await fs.readFile(CARD)),sequence:244,maxCalls:1,knowledgeBefore:243,promptUsed:15};await durable(path.join(root,'session.json'),session);return session;
}
export async function sessionAt(root){root=path.resolve(root);must(path.dirname(root)===process.cwd()&&path.basename(root).startsWith('.scratch-SYN01-VERIFY-20261026-'),'ISOLATED_ROOT_REQUIRED');must(!(await fs.lstat(root)).isSymbolicLink(),'SYMLINK_ROOT_DENIED');const s=await readJson(path.join(root,'session.json'));must(s.root===root&&['fake','real'].includes(s.mode)&&s.sequence===244&&s.maxCalls===1&&s.knowledgeBefore===243&&s.promptUsed===15,'SESSION_INVALID');return s;}
export class Engine{
  constructor(session){this.s=session;this.configReads=0;this.sent=0;this.secrets=[];}
  async bindings(){const raws=new RawStore(this.s.root),samples=[];for(const saved of this.s.samples){const raw=await raws.get(saved.id);must(raw&&raw.title===saved.title&&raw.bodySha256===saved.bodySha256&&!raw.origin,'INPUT_BINDING_DRIFT');samples.push(saved);}must((await freeze()).sha256===this.s.freezeSha256,'SOURCE_FREEZE_DRIFT');return {samples,freezeSha256:this.s.freezeSha256,cardSha256:this.s.cardSha256};}
  async arm(file,exactSha){must(!(await optional(path.join(this.s.root,'attempt-244.json'))),'ATTEMPT_LIMIT');must(!(await optional(path.join(this.s.root,'armed.json'))),'ALREADY_ARMED');const bytes=await fs.readFile(file);must(sha(bytes)===exactSha,'RELEASE_SHA_DRIFT');const r=JSON.parse(bytes);must(r.released===true&&r.issuedBy==='main'&&r.sessionId===this.s.id&&r.mode===this.s.mode&&r.sequence===244&&r.maxCalls===1&&Number.isFinite(Date.parse(r.issuedAt)),'RELEASE_INVALID');must(JSON.stringify(r.bindings)===JSON.stringify(await this.bindings()),'RELEASE_BINDING_DRIFT');await durable(path.join(this.s.root,'armed.json'),{file:path.resolve(file),sha256:exactSha});return {armed:true,sequence:244};}
  async release(){const armed=await optional(path.join(this.s.root,'armed.json'));must(armed,'NO_RELEASE');const bytes=await fs.readFile(armed.file);must(sha(bytes)===armed.sha256,'RELEASE_SHA_DRIFT');const r=JSON.parse(bytes);must(r.sessionId===this.s.id&&r.released===true&&r.sequence===244&&r.maxCalls===1&&JSON.stringify(r.bindings)===JSON.stringify(await this.bindings()),'RELEASE_BINDING_DRIFT');return armed;}
  async provider(){
    await this.release();must(!(await optional(path.join(this.s.root,'attempt-244.json'))),'ATTEMPT_LIMIT');const engine=this;let actual,reserved=false;
    return {get attemptReserved(){return reserved;},get name(){return actual?.name??(engine.s.mode==='fake'?'fake':'openai-compatible');},get model(){return actual?.model??'pending-config';},get secrets(){return engine.secrets;},async complete(request){
      must(request.purpose==='knowledge'&&request.system.startsWith('你是多来源知识综合助手。'),'SYNTHESIS_ONLY');const input=JSON.parse(request.user);must(input.synthesis_format_version===1&&Array.isArray(input.raws)&&input.raws.length===2&&input.raws.every((raw,index)=>raw.id===engine.s.samples[index].id&&raw.title===engine.s.samples[index].title&&raw.bodySha256===engine.s.samples[index].bodySha256&&sha(raw.body)===raw.bodySha256),'FIXED_V1_REQUEST_REQUIRED');const armed=await engine.release();
      // Exclusive immutable pending reservation survives failed calls and process death.
      try{await durable(path.join(engine.s.root,'attempt-244.json'),{sequence:244,status:'pending-counts-if-unknown',at:new Date().toISOString(),sessionId:engine.s.id,releaseSha256:armed.sha256,requestSha256:sha(request)});}catch(error){if(error.code==='EEXIST')must(false,'ATTEMPT_LIMIT');throw error;}
      reserved=true;await durable(path.join(engine.s.root,'request-244.json'),{sequence:244,request});
      let response;
      if(engine.s.mode==='fake'){engine.sent++;response={text:JSON.stringify(synthesisFixture(request,fakeOutput(input.raws))),finishReason:'stop',bytes:0};}
      else{
        engine.configReads++;const {loadLlmConfig}=await import('../../services/llm/config.ts'),{OpenAiCompatibleProvider}=await import('../../services/llm/provider.ts');const config=await loadLlmConfig({filePath:path.resolve('.env.local')});actual=new OpenAiCompatibleProvider(config);engine.secrets=[...actual.secrets];assertNoKnownSecret(request,engine.secrets);engine.safeProvider={host:new URL(config.baseUrl).host,model:config.model};assertNoKnownSecret(engine.safeProvider,engine.secrets);engine.sent++;response=await actual.complete(request);
      }
      await durable(path.join(engine.s.root,'response-244.private.json'),response);return response;
    }};
  }
  async finish(result){await durable(path.join(this.s.root,'result-244.json'),{sequence:244,...result});}
  async status(){const attempt=await optional(path.join(this.s.root,'attempt-244.json')),result=await optional(path.join(this.s.root,'result-244.json'));return {sessionId:this.s.id,root:this.s.root,mode:this.s.mode,armed:!!(await optional(path.join(this.s.root,'armed.json'))),attempt,result,realCalls:this.s.mode==='real'&&attempt?1:0,fakeCalls:this.s.mode==='fake'&&attempt?1:0,knowledgeUsed:243+(this.s.mode==='real'&&attempt?1:0),promptUsed:15,configReads:this.configReads,sentThisProcess:this.sent,safeProvider:this.safeProvider??null};}
  async export(raws,wiki){const files=['request-244.json','candidate-original.json'];const artifacts={};for(const file of files){const value=await optional(path.join(this.s.root,file));if(value)artifacts[file]=value;}const response=await optional(path.join(this.s.root,'response-244.private.json'));if(response){must(this.s.mode==='fake'||this.secrets.length>0,'CURRENT_SECRET_SCAN_REQUIRED');scanSafe(response,this.secrets);artifacts.response=response;}const output={status:await this.status(),raws:await raws.list(),wiki:await wiki.allRecords(),artifacts};scanSafe(output,this.secrets);return output;}
}
