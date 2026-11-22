import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RawStore } from '../../services/raw/store.ts';
import { RawStateStore } from '../../services/raw/state.ts';
import { WikiStore } from '../../services/wiki/store.ts';
import { DraftStore } from '../../services/wiki/drafts.ts';
import { WikiCommitService } from '../../services/wiki/commits.ts';
import { KnowledgeWorkflowStore } from '../../services/wiki/knowledge-workflows.ts';
import type { ExtractedPage } from '../../services/llm/service.ts';
import type { ReviewUnit } from '../../services/wiki/human-review.ts';

/** Explicit offline synthetic candidate; no Provider or private user assets. */
export async function r13Fixture(
  options: {
    root?: string;
    types?: Array<'concept' | 'business_process'>;
    longAi?: boolean;
    humanLength?: number;
    humanOnly?: number[];
  } = {},
) {
  const root = options.root ?? (await mkdtemp(path.join(os.tmpdir(), 'r13-merge-20261029-')));
  const raws = new RawStore(root),
    states = new RawStateStore(root),
    drafts = new DraftStore(root);
  await Promise.all([raws.initialize(), states.initialize(), drafts.initialize()]);
  const wiki = new WikiStore(root, raws);
  await wiki.initialize();
  const rules = await wiki.schema(),
    draftRules = {
      types: rules.types.map((t) => t.id),
      categories: rules.categories.map((c) => c.id),
      knowledge_status: rules.enums.knowledge_status,
      confidence: rules.enums.confidence,
      source_level: rules.enums.source_level,
      review_status: rules.enums.review_status,
    };
  const types = options.types ?? ['concept', 'concept', 'business_process'];
  const quotes = types.map((type, i) =>
    options.humanOnly?.includes(i)
      ? '异常负责人尚未确认？'
      : type === 'concept'
        ? '【离线虚构】补货是按需求补充库存。'
        : '【离线虚构】店长提交补货单，库管审核后形成安排单，尚未发货。',
  );
  let body = '';
  const starts = quotes.map((quote, i) => {
    body += `第${i + 1}条离线夹具：\n`;
    const start = body.length;
    body += quote + '\n';
    return start;
  });
  const raw = await raws.create({
    title: 'R13离线合并验收资料',
    sourceType: 'note',
    sourceName: '明确离线工程夹具，不代表真实企业',
    tags: ['离线夹具'],
    body,
  });
  const units: ReviewUnit[] = quotes.map((quote, i) => ({
    id: `unit-${i + 1}`,
    kind: options.humanOnly?.includes(i) ? 'question' : 'fact',
    origin: 'legacy',
    text: quote,
    memberIds: [],
    records: [{ id: `fact-${i + 1}`, text: quote, evidenceIds: ['shared'] }],
    evidence: [{ id: 'shared', rawId: raw.id, quote, start: starts[i], end: starts[i] + quote.length, chunkIndex: 0 }],
    sourceLabel: '明确离线夹具原文',
  }));
  const pages: ExtractedPage[] = types.map((type, i) => ({
    title: `${type === 'concept' ? '补货概念' : '补货流程'}${i + 1}`,
    type,
    category: 'supply_chain',
    one_line_definition: `第${i + 1}条原始说明`,
    source_facts: units[i].kind === 'fact' ? [{ text: quotes[i], evidenceIds: ['shared'] }] : [],
    source_evidence: units[i].evidence.map((e) => ({ ...e, occurrences: 1 })),
    ai_organized: [],
    ai_inferences: [],
    open_questions: units[i].kind === 'question' ? [quotes[i]] : [],
    related_pages: [],
    provenance: [{ chunkIndex: 0, start: starts[i], end: starts[i] + quotes[i].length }],
    templateFields: {
      [type === 'concept' ? 'definition' : 'steps']: {
        evidenceIds: units[i].kind === 'fact' ? ['shared'] : [],
        humanText: options.humanLength ? '人'.repeat(options.humanLength) : `原页${i + 1}人工说明。`,
        ...(units[i].kind === 'fact'
          ? {
              aiContent: {
                text: options.longAi ? (i === 0 ? '甲' : '乙').repeat(4000) : `第${i + 1}条AI整理：${quotes[i]}`,
                factIds: [`fact-${i + 1}`],
                evidenceIds: ['shared'],
                ...(i === 1 ? { humanEdited: true as const } : {}),
              },
            }
          : {}),
      },
    },
  }));
  const draft = await drafts.create({
    raw,
    body,
    jobId: randomUUID(),
    rules: draftRules,
    outcome: {
      document: {
        title: 'R13离线来源',
        main_topic: '补货',
        summary: '明确离线夹具，仅核合并保全。',
        source_level: 'D',
      },
      pages,
      reviewBasis: { units, pageUnitIds: units.map((unit) => [unit.id]) },
      provider: { name: 'offline-fixture', model: 'no-provider' },
      rulesVersion: 'r13-local-v1',
      callCount: 0,
      chunkCount: 1,
      chunkCoverage: [{ index: 0, start: 0, end: body.length }],
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: ['明确离线工程夹具；未调用真实模型。'],
    },
  });
  await states.set(raw.id, { status: 'pending_confirmation', draftId: draft.id, reason: 'R13 offline merge fixture' });
  const commits = new WikiCommitService({ root, wikiStore: wiki, drafts, rawStates: states, rawStore: raws });
  await commits.initialize();
  const workflows = new KnowledgeWorkflowStore(root, wiki, raws);
  await workflows.initialize();
  return {
    root,
    raw,
    body,
    raws,
    states,
    wiki,
    drafts,
    draft,
    commits,
    workflows,
    rules: draftRules,
    clean: () => rm(root, { recursive: true, force: true }),
  };
}
