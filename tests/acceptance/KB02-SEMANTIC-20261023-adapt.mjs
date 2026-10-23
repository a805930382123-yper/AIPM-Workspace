import fs from 'node:fs/promises';
async function edit(file,fn){const old=await fs.readFile(file,'utf8'),next=fn(old);if(old!==next)await fs.writeFile(file,next);}
const files=['kb02-planning-attribution','kb02-pipeline','kb02-planning-budget','kb02-extraction-contract','kb02-final-classification','kb02-planning-fields','kb02-planning-context','kb02-classification-priority','kb02-r2'];
for(const name of files)await edit(`tests/${name}.test.ts`,s=>{
 s="import { semanticReviewReply } from './support/semantic-review.ts';\n"+s;
 s=s.replaceAll('kb02-atoms-planning-11','kb02-atoms-planning-12');
 // Preserve request logs and fault hooks; only the added review request gets this answer.
 s=s.replace(/(requests|requestLog)\.push\((request|r)\);/g,'$1.push($2); { const review = semanticReviewReply($2); if (review) return review; }');
 return s;
});
await edit('tests/support/kb02-storage-fixture.ts',s=>"import { semanticReviewReply } from './semantic-review.ts';\n"+s.replace('await hook?.(request);','await hook?.(request);\n    const review = semanticReviewReply(request); if (review) return review;'));
await edit('tests/support/fake-llm.ts',s=>"import { semanticReviewReply } from './semantic-review.ts';\n"+s.replace('} else reply = current(request);','} else { const review = semanticReviewReply(request); reply = review ? { kind: \'content\', content: review.text } : current(request); }'));
for(const name of ['llm','kb02-edge-extraction'])await edit(`tests/${name}.test.ts`,s=>s.replaceAll('kb02-atoms-planning-11','kb02-atoms-planning-12'));
await edit('tests/llm.test.ts',s=>s.replaceAll("await writeFile(path.join(temporary, 'kb02-planning.schema.json')", "await writeFile(path.join(temporary, 'kb02-semantic-review.schema.json'), await readFile(path.join(rulesDir, 'kb02-semantic-review.schema.json'), 'utf8'), 'utf8');\n    await writeFile(path.join(temporary, 'kb02-planning.schema.json')").replaceAll("await writeFile(path.join(drifted, 'kb02-planning.schema.json')", "await writeFile(path.join(drifted, 'kb02-semantic-review.schema.json'), await readFile(path.join(rulesDir, 'kb02-semantic-review.schema.json'), 'utf8'), 'utf8');\n    await writeFile(path.join(drifted, 'kb02-planning.schema.json')"));
