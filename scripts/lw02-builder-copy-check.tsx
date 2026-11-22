import React from 'react';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgeMaintenanceReview } from '../app/pages/KnowledgeMaintenanceReview';
const session = JSON.parse(await readFile(process.argv[2], 'utf8'));
const view = await (await fetch(session.api + '/api/drafts/ec7e1a40-7034-48a5-a0c0-033ed6cd897a')).json();
const render = (v: any) =>
  renderToStaticMarkup(
    <KnowledgeMaintenanceReview
      view={v}
      body="合成原文"
      onView={() => {}}
      onBack={() => {}}
      onOpenRaw={() => {}}
      onCommitted={async () => {}}
    />,
  );
const qa = render(view);
assert(qa.includes('问答成果基于既有资料，回答不构成新来源'));
assert(qa.includes('差异、全部真实依据及待核问题'));
assert(!qa.includes('来源笔记只记录本份资料'));
const raw = render({
  ...view,
  input: undefined,
  rawId: 'synthetic',
  rawTitle: '合成资料',
  source: { body: '合成来源笔记' },
});
assert(raw.includes('来源笔记只记录本份资料，主题页积累跨来源知识。'));
assert(raw.includes('差异、来源笔记及待核问题'));
await writeFile(
  'docs/reports/LW02-20261101-evidence/builder-copy-check.json',
  JSON.stringify(
    {
      success: true,
      checks: ['QA说明不新增来源', 'QA确认核对全部真实依据', 'Raw原文保持'],
      product: 'app/pages/KnowledgeMaintenanceReview.tsx',
    },
    null,
    2,
  ),
);
console.log('QA/Raw文案分支 3/3 passed');
