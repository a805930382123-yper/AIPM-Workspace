import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const report=JSON.parse(await fs.readFile('docs/reports/FULL3-20261014-real-http.json','utf8'));
const source=await fs.readFile('tests/acceptance/full3-20261014-real-http.mjs','utf8');
const rawA=source.match(/const rawA='((?:\\.|[^'])*)';/u)?.[1]?.replace(/\\n/gu,'\n');
assert.ok(rawA);
const proposal=report.artifacts.audit,accepted=report.artifacts.auditResolved;
assert.ok(proposal && accepted);
const draft=proposal.draft,audit=proposal.audit;
const checks={
 correctionExactly50To20:draft.replacement===audit.anchor.text.replace('50%','20%'),
 arithmeticSupported:rawA.includes('20÷100=20%')&&draft.replacement.includes('20%'),
 quotesVerbatimAndBoundToSnapshot:draft.evidence.length>0&&draft.evidence.every(e=>rawA.includes(e.quote)&&draft.rawSnapshots.some(s=>s.rawId===e.rawId)),
 manualNotePreserved:draft.replacement.includes('## 人工备注\n待确认异常审批负责人。'),
 noUnsupportedSalesOrBusinessClaim:!draft.replacement.includes('销售额')&&!draft.replacement.includes('利润')&&!draft.replacement.includes('AI已上线'),
 rationaleExplainsCorrectionAndBoundary:draft.rationale.includes('20÷100=20%')&&draft.rationale.includes('人工备注')&&draft.rationale.includes('不采用销售额口径'),
 initiallyPending:proposal.audit.status==='open'&&draft.status==='pending',
 explicitAcceptRecorded:accepted.decision==='accepted'&&accepted.audit.status==='resolved'&&accepted.audit.decisionHistory.some(d=>d.draftId===draft.id&&d.decision==='accepted'&&d.wikiRevision===2)
};
const result={at:new Date().toISOString(),scope:'Independent evidence and semantic review of one artificial Audit case only',reviewerProviderCalls:0,result:Object.values(checks).every(Boolean)?'PASS':'FAIL',model:report.model,auditId:audit.id,draftId:draft.id,wikiId:audit.wikiId,rawId:draft.rawSnapshots[0].rawId,checks,limitations:['Source is the artificial fixture rawA in the live runner; no user data or credentials read.','No independent new API/browser/restart run. Final Wiki bytes are not contained in auditResolved; this reviewer signs semantic proposal and acceptance receipt only.','Audit comment supplies correct answer20%; this does not prove unprompted error discovery or other task quality.']};
await fs.writeFile('docs/reports/FULL3-20261014-standards-quality-audit.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
