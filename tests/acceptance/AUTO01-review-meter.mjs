// Independent AUTO01 adapter. No top-level I/O, configuration load or model request.
// This replaces the OLD product-freeze check under the newly authorized AUTO01
// release; it does not claim the historical LW runner supports the new version.
import fs from 'node:fs/promises';
import path from 'node:path';
import {LEDGER,REPO,entries,reserve,durable,sha} from '../support/lw-real-runner.mjs';
import {loadLlmConfig,containsKnownSecret} from '../../services/llm/config.ts';
import {OpenAiCompatibleProvider,assertNoKnownSecret,sanitizeProviderText} from '../../services/llm/provider.ts';

export async function approvedAuto01Provider(releaseFile, releaseSha) {
  const bytes=await fs.readFile(releaseFile), release=JSON.parse(bytes);
  if(sha(bytes)!==releaseSha || release.approved!==true || release.task!=='AUTO01'
    || release.ledger!==LEDGER || release.limit!==12 || ![1,2].includes(release.maxCalls)
    || !release.authorization || !Array.isArray(release.files) || !release.files.length)
    throw Error('AUTO01 release is not bound to the authorized two-call scope');
  for(const [file,digest] of release.files) {
    const resolved=path.resolve(REPO,file), relative=path.relative(REPO,resolved);
    if(relative.startsWith('..')||path.isAbsolute(relative)||sha(await fs.readFile(resolved))!==digest)
      throw Error('AUTO01 frozen product/tool SHA changed');
  }
  if(!release.files.some(([f])=>f==='tests/acceptance/AUTO01-review-meter.mjs'))
    throw Error('Release must bind this adapter');
  const rows=await entries(LEDGER);
  if(rows.length<8 || rows.some(r=>r.session!==release.originalSession||r.freeze!==release.originalFreeze))
    throw Error('Original LW ledger identity mismatch');
  const priorAuto=rows.filter(r=>r.auto01ReleaseSha);
  if(priorAuto.length) {
    if(release.correctsAttempt!==9||release.maxCalls!==1||rows.length!==9||priorAuto.length!==1
      ||priorAuto[0].sequence!==9||priorAuto[0].auto01ReleaseSha!==release.previousReleaseSha
      ||JSON.parse(await fs.readFile(path.join(LEDGER,'attempt-09.error.json'),'utf8')).code!=='LLM_NETWORK_ERROR')
      throw Error('AUTO01 requests already exist; no automatic retry or re-release');
  }
  if(rows.length+release.maxCalls>12) throw Error('Original LW budget insufficient');
  const config=await loadLlmConfig({filePath:release.configFile});
  if(config.model!==release.expectedModel||sha(config.baseUrl)!==release.expectedEndpointSha)
    throw Error('Authorized Provider identity changed');
  const provider=new OpenAiCompatibleProvider(config);
  await durable(releaseFile+'.config-read.json',{configReads:1,model:config.model,endpointSha:sha(config.baseUrl)});
  let sent=0, failed=false;
  return {...provider,name:provider.name,model:provider.model,cacheIdentity:provider.cacheIdentity,secrets:provider.secrets,
    complete:async request=>{
      if(failed||sent>=release.maxCalls) throw Error('AUTO01 stopped; no retry or excess request');
      assertNoKnownSecret(request.system,provider.secrets);
      assertNoKnownSecret(request.user,provider.secrets);
      const attempt=await reserve(LEDGER,{session:release.originalSession,freeze:release.originalFreeze,
        phase:'AUTO01-review',auto01ReleaseSha:releaseSha,auto01FilesSha:sha(JSON.stringify(release.files)),
        scope:sent===0?'maintenance-grouping':'target-reprepare'},0);
      sent++;
      const prefix=path.join(LEDGER,`attempt-${String(attempt.sequence).padStart(2,'0')}`);
      await durable(prefix+'.request.json',{system:request.system,user:request.user,structuredOutput:request.structuredOutput});
      const started=Date.now();
      try {
        const result=await provider.complete(request);
        const text=containsKnownSecret(result.text,provider.secrets)?'[redacted credential candidate]':result.text;
        await durable(prefix+'.result.json',{...result,text,elapsedMs:Date.now()-started});
        return result;
      } catch(error) {
        failed=true;
        await durable(prefix+'.error.json',{code:String(error.code??'UNKNOWN'),message:sanitizeProviderText(error.message,provider.secrets),elapsedMs:Date.now()-started});
        throw error;
      }
    }};
}
