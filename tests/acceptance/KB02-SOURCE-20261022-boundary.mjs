import fs from 'node:fs/promises';
let p='services/llm/knowledge-extraction.ts',s=await fs.readFile(p,'utf8');s=s.replace('    // The stored plan keeps original IDs;', "    if(Object.keys(current.plan.document).sort().join(',')!=='main_topic,summary,title')throw new LlmError('LLM_CHECKPOINT_CORRUPT','检查点文档结构不合法，已拒绝恢复。',409);\n    // The stored plan keeps original IDs;");await fs.writeFile(p,s);
p='tests/kb02-source-assignment.test.ts';s=await fs.readFile(p,'utf8');s=s.replace("(cp:ExtractionCheckpoint)=>{cp.plan!.pages[0].type='unknown';}","(cp:ExtractionCheckpoint)=>{cp.plan!.pages[0].type='unknown';},(cp:ExtractionCheckpoint)=>{(cp.plan!.document as any).unknown='x';}");
s+=`
for(const extra of [0,1])test('SOURCE complete unit/context/feedback payload at 192KiB '+(extra?'plus one byte rejects before call':'is accepted'),async()=>{
 const source=await synthetic('选中事实。',()=>true),f=await run(source);try{
 const input=buildKnowledgePlanningInput(source.raw.body,f.cp.completedChunks,catalogs(source.raw.body)),diagnostic=coverageDiagnostic([],[],[]);
 const target=192*1024+extra,base=Buffer.byteLength(JSON.stringify({...input,coverageFeedback:diagnostic}),'utf8'),needed=target-base,count=Math.ceil((needed+1)/67);
 diagnostic.facts.unknown=Array.from({length:count},(_,i)=>('u'+String(i).padStart(4,'0')).padEnd(64,'x'));
 let excess=Buffer.byteLength(JSON.stringify({...input,coverageFeedback:diagnostic}),'utf8')-target;
 for(let i=count-1;excess>0;i--){const cut=Math.min(excess,diagnostic.facts.unknown[i].length-5);diagnostic.facts.unknown[i]=diagnostic.facts.unknown[i].slice(0,-cut||undefined);excess-=cut;}
 assert.equal(Buffer.byteLength(JSON.stringify({...input,coverageFeedback:diagnostic}),'utf8'),target);
 f.cp.lastError={code:'LLM_PLAN_COVERAGE_INVALID',message:'隔离边界',at:new Date().toISOString(),diagnostic};const before=structuredClone(f.cp);
 if(extra){await assert.rejects(f.run(true),{code:'LLM_PLANNING_TOO_LARGE'});assert.equal(f.requests.length,0);assert.deepEqual(f.cp,before);}else{await f.run(true);assert.equal(f.requests.length,1);assert.equal(Buffer.byteLength(f.requests[0].user.split('\\n').at(-1)!,'utf8'),target);}
 }finally{await f.clean();}
});
`;
await fs.writeFile(p,s);
