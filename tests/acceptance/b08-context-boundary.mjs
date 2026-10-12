import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHarness,expect,rawInput,wikiInput,fileSnapshot} from './b08-harness.mjs';
import {reply,brief} from './b08-fixtures.mjs';
const h=await createHarness(reply);const result={provider:'independent fake',dataRoot:h.dataRoot};
try{
 const s=await h.start();const r=await expect(s,'/api/raw','POST',rawInput('多段背景预算','预算隔离来源。'),201);const ids=[];
 for(let i=0;i<5;i++){const body=Array.from({length:100},()=>brief.goal+'：'+String(i).repeat(70)).join('\n\n');const w=await expect(s,'/api/wiki','POST',wikiInput('多段订货'+i,[r.id],body),201);ids.push(w.id);}
 const before=await fileSnapshot(path.join(h.dataRoot,'knowledge'));const out=await expect(s,'/api/prompt-ai/generate','POST',{brief,relatedWikiIds:ids},201);result.budget=out.contextBudget;result.used=out.relatedWiki.map(x=>({id:x.id,used:x.usedChars}));result.knowledgeUnchanged=JSON.stringify(before)===JSON.stringify(await fileSnapshot(path.join(h.dataRoot,'knowledge')));
 assert.ok(out.relatedWiki.every(x=>x.usedChars<=3000),'Every excerpt must fit 3000 including separators');assert.ok(out.contextBudget.used<=12000,'Total must fit 12000 including separators');result.result='PASS';
}catch(e){result.result='FAIL';result.error=String(e);}finally{await h.close();result.closed=true;await fs.writeFile('docs/reports/B08-repair1-context-boundary'+(process.argv[2]?'-'+process.argv[2]:'')+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.result!=='PASS')process.exitCode=1;}
