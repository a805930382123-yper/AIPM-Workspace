import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as apiBarrel from '../app/api.ts';
import * as clientMod from '../app/api/client.ts';
import * as meetingMod from '../app/api/meeting.ts';
import * as wikiMod from '../app/api/wiki.ts';
import * as rawMod from '../app/api/raw.ts';
import * as automationMod from '../app/api/automation.ts';
import * as workItemsMod from '../app/api/work-items.ts';
import * as llmMod from '../app/api/llm.ts';
import * as promptMod from '../app/api/prompt.ts';

const EXPECTED_RUNTIME_EXPORTS = [
  'ApiError',
  'PROMPT_VARIABLE_HINT',
  'acknowledgeReminder',
  'answerCitation',
  'api',
  'apiForm',
  'askKnowledge',
  'automationCandidates',
  'automationKnowledgeHealth',
  'automationLintSnapshot',
  'automationReminders',
  'automationRun',
  'automationRuns',
  'automationSchedules',
  'automationStatus',
  'automationTime',
  'bytesText',
  'cancelAutomationRun',
  'cancelDraftPreparation',
  'cancelExtract',
  'changeAutomationPause',
  'changeCandidateDisposition',
  'changePdfCleanup',
  'changeRawPdfJob',
  'changeRawTranslation',
  'clearLlmConfig',
  'confirmCandidates',
  'confirmDraft',
  'confirmKnowledgeWorkflow',
  'createPrompt',
  'createPromptFeedback',
  'createWorkItem',
  'currentInspection',
  'currentKnowledgeAnswer',
  'dateText',
  'decideInspection',
  'deletePrompt',
  'deletePromptFeedback',
  'deleteRaw',
  'discardDraft',
  'discardKnowledgeWorkflow',
  'draftInspection',
  'draftView',
  'drafts',
  'duplicateCandidates',
  'editAutomationSchedule',
  'editStructuredNote',
  'exportPromptFeedback',
  'extractionJob',
  'finishDraftReview',
  'formatLabels',
  'getInspection',
  'getPdfCleanup',
  'getRaw',
  'getRawBodyHistory',
  'getRawPdf',
  'getRawPdfPage',
  'getWeeklyReview',
  'inspectionEvidence',
  'jobStageLabels',
  'knowledgeAnswer',
  'knowledgeWorkflow',
  'knowledgeWorkflows',
  'llmConfig',
  'markDraftQuestions',
  'moveDraftUnits',
  'moveWorkflowUnits',
  'parseRawMedia',
  'parseRawMediaBatch',
  'patchDraft',
  'patchKnowledgeWorkflow',
  'pdfOriginalPageUrl',
  'prepareDraftChange',
  'promptChangeSourceLabels',
  'promptDetail',
  'promptExportUrl',
  'promptFeedback',
  'promptList',
  'promptSchema',
  'promptSourceLabels',
  'promptVersion',
  'promptVersions',
  'rawMedia',
  'rawProcessing',
  'rawReferences',
  'rawStatusLabels',
  'rawTranslation',
  'readPipelineSettings',
  'reconcileExtractionStorage',
  'regenerateWeeklyReview',
  'renderPrompt',
  'retryCandidate',
  'reviewDraftPage',
  'reviewStructuredNote',
  'reviewWorkflowPage',
  'runAutomationTask',
  'saveKnowledgeAnswer',
  'saveLlmConfig',
  'savePageDecision',
  'savePipelineSettings',
  'saveRawBody',
  'saveWeeklyReview',
  'setDraftDeferred',
  'snoozeReminder',
  'sourceLabels',
  'startDraftReview',
  'startExtract',
  'startInspection',
  'startSynthesisWorkflow',
  'startUpdateWorkflow',
  'startWorkAnalysis',
  'startWorkBasisReview',
  'startWorkflowReview',
  'supplementCandidate',
  'testLlmConfig',
  'testReminderNotification',
  'updatePrompt',
  'updatePromptFeedback',
  'updateReminderSettings',
  'updateWeeklyReviewSettings',
  'updateWorkItem',
  'uploadWorkScreenshot',
  'weeklyReviewExportUrl',
  'weeklyReviewMarkdown',
  'weeklyReviews',
  'wikiCommit',
  'workAnalysisRuns',
  'workItem',
  'workItems',
  'workScreenshotUrl',
].sort();

test('app/api.ts barrel preserves the exact 130 runtime exports and leaks neither readResponse nor api/index.ts', () => {
  const actualKeys = Object.keys(apiBarrel).sort();
  assert.equal(actualKeys.length, 130);
  assert.deepEqual(actualKeys, EXPECTED_RUNTIME_EXPORTS);
  assert.equal('readResponse' in apiBarrel, false);
  assert.equal('apiText' in apiBarrel, false);
  assert.equal('readResponse' in clientMod, false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'app/api/index.ts')), false);
});

test('all app/api submodules stay under 40 KiB and 800 lines with type-only services imports', () => {
  const apiFiles = [
    'app/api.ts',
    'app/api/client.ts',
    'app/api/meeting.ts',
    'app/api/wiki.ts',
    'app/api/raw.ts',
    'app/api/automation.ts',
    'app/api/work-items.ts',
    'app/api/llm.ts',
    'app/api/prompt.ts',
  ];
  for (const rel of apiFiles) {
    const abs = path.join(process.cwd(), rel);
    const stat = fs.statSync(abs);
    const text = fs.readFileSync(abs, 'utf8');
    const lines = text.split('\n').length;
    assert.ok(stat.size < 40 * 1024, `${rel} size ${stat.size} must be < 40 KiB`);
    assert.ok(lines < 800, `${rel} lines ${lines} must be < 800`);
    assert.doesNotMatch(text, /['"]\.\.\/services\//, `${rel} must not use ../services/`);
    assert.doesNotMatch(text, /\bimport\s+(?!type\b)[^;]*services\//, `${rel} must only import type from services/`);
    assert.doesNotMatch(text, /\bexport\s+(?!type\b)[^;]*services\//, `${rel} must only export type from services/`);
  }
});

test('individual app/api submodules expose expected exports and helpers work cleanly', async () => {
  assert.equal(typeof meetingMod, 'object');
  assert.equal(typeof wikiMod, 'object');
  assert.equal(clientMod.api, apiBarrel.api);
  assert.equal(rawMod.sourceLabels, apiBarrel.sourceLabels);
  assert.equal(automationMod.automationTime, apiBarrel.automationTime);
  assert.equal(workItemsMod.workItems, apiBarrel.workItems);
  assert.equal(llmMod.rawStatusLabels, apiBarrel.rawStatusLabels);
  assert.equal(promptMod.PROMPT_VARIABLE_HINT, apiBarrel.PROMPT_VARIABLE_HINT);

  assert.equal(apiBarrel.bytesText(), '未记录');
  assert.equal(apiBarrel.bytesText(512), '512 B');
  assert.equal(apiBarrel.bytesText(1536), '1.5 KiB');
  assert.equal(apiBarrel.bytesText(2 * 1024 * 1024), '2.00 MiB');

  assert.equal(apiBarrel.dateText(), '未填写');
  assert.ok(apiBarrel.dateText('2026-10-01T00:00:00Z').length > 0);

  assert.equal(apiBarrel.automationTime(null), '—');
  assert.ok(apiBarrel.automationTime('2026-10-01T08:30:00Z').includes('2026'));

  const err = new apiBarrel.ApiError('conflict', 'REVISION_CONFLICT', 409, { expected: 2 });
  assert.equal(err.name, 'ApiError');
  assert.equal(err.message, 'conflict');
  assert.equal(err.code, 'REVISION_CONFLICT');
  assert.equal(err.status, 409);
  assert.deepEqual(err.details, { expected: 2 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { code: 'BAD_INPUT', message: '参数无效', details: { field: 'name' } } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () => apiBarrel.api('/api/test'),
      (caught: unknown) =>
        caught instanceof apiBarrel.ApiError &&
        caught.code === 'BAD_INPUT' &&
        caught.status === 400 &&
        caught.message === '参数无效',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
