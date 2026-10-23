// Preparation only: historical input fingerprints, never product execution/network.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const prefix='docs/reports/KB02-HUMAN-AUDIT-20261023-';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const paths=[
 'docs/handoffs/KB02-HUMAN-20261023-task.md',
 'docs/reports/KB02-SEMANTIC-AUDIT-20261023-fixtures.json',
 'docs/reports/KB02-SEMANTIC-AUDIT-20261023-provider-trace.jsonl',
 'docs/reports/KB02-REGION-AUDIT-20261023-long-checkpoint.json',
 'docs/reports/KB02-REGION-AUDIT-20261023-long-readback.json',
 'docs/reports/KB02-REGION-AUDIT-20261023-long-semantic-review.json',
 'docs/reports/KB02-REGION-AUDIT-20261023-provider-trace.jsonl',
];
const files=paths.map(path=>({path,sha256:sha(fs.readFileSync(path))}));
const trace=fs.readFileSync(paths[2],'utf8').trim().split(/\r?\n/).map(JSON.parse);
assert.deepEqual(trace.map(r=>r.sequence),[204,205,206,207,208,209]);
const cp=JSON.parse(fs.readFileSync(paths[3],'utf8'));
assert.equal(cp.completedChunks.length,14);
assert.ok(cp.plan.pages.length>0);
const output={status:'PREPARATION_ONLY_NO_PRODUCT_EXECUTION',head:'28b6d144a07d03d4e85fc8cc766027a763012c0e',realCalls:0,realCumulative:219,prompt:'15/24',engineeringApproved:false,files,fixtures:[{id:'original-boundary',extractSequence:204,planSequence:205,reviewSequence:206,use:'Replay extraction/plan only; reviewer third request forbidden; inspect malformed independent theme then human repair or unresolved.'},{id:'independent-ai-positive',extractSequence:207,planSequence:208,reviewSequence:209,use:'Replay extraction/plan only; former invalid review must not block candidate; starts wholly unreviewed.'},{id:'long-original',checkpoint:paths[3],use:'Historical 14 source blocks; compare actual units/memberIds by subject/date/value, never use fixed page count as quality oracle.'}],newSyntheticCases:['legacy draft: no review metadata, duplicate fact strings, question without locator','legacy workflow: update and synthesis pending without metadata','zero-write prepared manifest','partially-written manifest with actual matching disk record','manifest claiming writtenIds but missing disk record','two-tab stale approval plus editing','update input draft change after preview, target change, workflow patch'],constraints:['No scripts running against unfinished product','No services or network during preparation','No change to old fixtures or historical reports','Builder freeze then main-agent release required for engineering and isolated HTTP/UI','Synthetic transactions in isolated temporary roots only; no real workspace manipulation']};
fs.writeFileSync(prefix+'preparation.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({pass:true,realCalls:0,historicalFiles:files.length,engineeringApproved:false}));
