import { randomUUID } from 'node:crypto';
import { renderInputTemplateFields } from './template-fields.ts';
import { assertRawNotMeeting, assertRawsNotMeeting } from '../meeting/source-policy.ts';
import { assertNoKnownSecret, type LlmProvider } from '../llm/provider.ts';
import { buildEvidenceLocatorCatalog } from '../llm/locators.ts';
import { WikiError, type SourceLevel } from './store.ts';
import { DraftStore } from './drafts.ts';
import { type KnowledgeWorkflow, type WorkflowContext, type WorkflowUpdateInput, sha } from './workflow-types.ts';
import {
  updateEvidenceDirectory,
  assertUpdateTarget,
  updateExistingLocators,
  validateEvidence,
  actualRawSha,
} from './workflow-evidence.ts';
import { call } from './workflow-provider.ts';
import { workflowReview, assertInput, templateSnapshot } from './workflow-review.ts';

export async function createUpdate(ctx: WorkflowContext, args: WorkflowUpdateInput) {
  if (args.draft.structuredNote !== undefined)
    throw new WikiError('STRUCTURED_NOTE_CONFIRM_UNAVAILABLE', '结构化笔记尚未开放确认', 409);
  assertRawNotMeeting(args.raw);
  for (const id of args.target.sources) assertRawNotMeeting(await ctx.raws.get(id));
  if (args.draft.id !== args.draftId || args.draft.rawId !== args.raw?.id || args.target.id !== args.targetWikiId)
    throw new WikiError('EVIDENCE_INVALID', '更新来源、草稿或目标绑定不一致。', 409);
  if (args.draft.revision !== args.baseRevision)
    throw new WikiError('DRAFT_REVISION_CONFLICT', '提取草稿已变化，请刷新后重新选择更新。', 409, {
      currentRevision: args.draft.revision,
    });
  if (!args.raw || actualRawSha(args.raw) !== args.raw.bodySha256 || args.raw.bodySha256 !== args.draft.rawSha256)
    throw new WikiError('RAW_CHANGED', '原文已变化或校验值与实际正文不一致，不能生成更新预览。', 409);
  const page = args.draft.pages.find((item: any) => item.pageId === args.pageId);
  if (!page) throw new WikiError('PAGE_NOT_FOUND', '提取草稿中没有这条建议。', 404);
  const evidenceDirectory = updateEvidenceDirectory(page, args.raw);
  const drafts = new DraftStore(ctx.root),
    stored = await drafts.get(args.draftId);
  if (!stored || stored.revision !== args.baseRevision || JSON.stringify(stored) !== JSON.stringify(args.draft))
    throw new WikiError('INPUT_REVIEW_CHANGED', '更新输入必须是当前持久化草稿。', 409);
  const inputDigest = await drafts.assertReviewed(stored, args.raw.body);
  const inputTemplateFields = templateSnapshot(stored, page);
  await assertUpdateTarget(ctx, args.target);
  const existingLocators = updateExistingLocators(args.target);
  assertNoKnownSecret({ page, evidenceDirectory, existingLocators }, args.provider.secrets);
  const user = JSON.stringify({
    existing: {
      wikiId: args.target.id,
      title: args.target.title,
      type: args.target.type,
      category: args.target.category,
      body: args.target.body,
      revision: args.target.revision,
      sources: args.target.sources,
      locators: existingLocators,
    },
    newSource: {
      rawId: args.raw.id,
      rawTitle: args.raw.title,
      body: args.raw.body,
      facts: page.source_facts,
      evidence: evidenceDirectory,
      organized: page.ai_organized,
      inferences: page.ai_inferences,
      questions: page.open_questions,
      ...(inputTemplateFields
        ? {
            templateFields: inputTemplateFields,
            templateFieldsPreview: renderInputTemplateFields(inputTemplateFields),
          }
        : {}),
    },
  });
  const output = await call(
    args.provider,
    '你是知识更新建议器。newSource.templateFields若存在，是已审候选的来源整理快照：人工归位摘录、人工说明与AI整理各自保留标签和出处。它们不是新增原始事实；不得仅凭人工说明或AI整理生成事实建议，事实建议仍须由newSource.facts及其evidence支持。快照在确认后独立保留，不要求模型合并或覆盖旧模板字段。只输出一个合法 JSON 对象，不输出 Markdown、代码围栏或前后说明。输出字段严格为 suggestedAdditions、conflicts、inferences、openQuestions、agreement；五个字段都必须出现且为数组。结构示例：{"suggestedAdditions":[],"conflicts":[],"inferences":[],"openQuestions":[],"agreement":[]}。每个 suggestedAdditions/conflicts 元素严格只包含 text、evidenceId 两个字段；每个 agreement 元素严格只包含 text、evidenceId、existingLocatorId 三个字段。evidenceId只能选newSource.evidence中已经校验且属于选中建议的id；existingLocatorId只能选existing.locators中绑定本次旧Wiki及revision的id，两侧ID不可互换。不得猜测、补造或沿用其他目标/旧版本的ID。只围绕被选中的知识建议与指定旧 Wiki 进行更新，不从其他主题补充内容。不得返回或计算quote/rawId/start/end。没有支持证据则不生成事实建议。newSource.facts 中没有可支持的建议时，suggestedAdditions 可为空数组。agreement仅表达两侧都支持的最小共同命题：逐断言判断，复合句中每项断言均须两侧支持，不能因共同支持一部分便把其余部分也称共同观点。新来源未提及不等于新来源同意。旧侧独有内容保留existing，不生成agreement；新侧独有且有证据的内容进入suggestedAdditions。无法证明一致则agreement为空，可记录待确认问题，不用“均/双方/两侧”等措辞扩大支持。正反例：旧侧“目标门店100家”和新侧“目标门店总数为100家”可得共同命题“目标门店100家”；旧侧还说“门店数不等于销量”而新侧未提及，则不能写“双方均强调门店数不等于销量”，也不能附在共同的门店数或计算公式后面；旧20%与新30%必须列conflicts，保留两种数值及口径；“不知道/未上线/将来建议”不能改为肯定事实。选中双侧原文只是定位约束，仍必须核对每个断言的语义支持。保留旧 Wiki 原内容，不把未确认推断写成事实。遇到两侧不一致，分别保留各自陈述、数值和时间/统计口径；口径或可比性未确认时明确标为待确认，不判定一致、不自行计算或调和。推断与待确认问题用字符串数组表达。',
    user,
    'evidence-id',
  );
  for (const field of ['suggestedAdditions', 'conflicts', 'agreement'])
    output[field] = output[field].map((item: { text: string; evidenceId: string; existingLocatorId?: string }) => {
      const evidence = evidenceDirectory.find((entry) => entry.id === item.evidenceId);
      if (!evidence) throw new WikiError('EVIDENCE_INVALID', '更新建议选择未知或非本条建议的证据ID。', 502);
      if (field === 'agreement' && !existingLocators.some((entry) => entry.id === item.existingLocatorId))
        throw new WikiError('EVIDENCE_INVALID', '一致观点未选择本次旧Wiki版本的有效定位ID。', 502);
      // Internal double-sided bindings are checked above; keep persisted evidence/UI contracts unchanged.
      return {
        text: item.text,
        rawId: evidence.rawId,
        quote: evidence.quote,
        start: evidence.start,
        end: evidence.end,
      };
    });
  await assertUpdateTarget(ctx, args.target);
  assertNoKnownSecret(output, args.provider.secrets);
  validateEvidence(output, [args.raw]);
  const record: KnowledgeWorkflow = {
    reviewProtocolVersion: 1,
    id: randomUUID(),
    kind: 'update',
    status: 'pending_confirmation',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: { name: args.provider.name, model: args.provider.model },
    rawSnapshots: [{ id: args.raw.id, title: args.raw.title, bodySha256: args.raw.bodySha256 }],
    targetWikiId: args.target.id,
    baseRevision: args.target.revision,
    baseWiki: args.target,
    inputDraft: {
      draftId: args.draftId,
      pageId: args.pageId,
      revision: args.draft.revision,
      reviewContentDigest: inputDigest,
    },
    ...(inputTemplateFields ? { inputTemplateFields } : {}),
    sections: {
      existing: args.target.body,
      newSource: args.raw.body,
      suggestedAdditions: output.suggestedAdditions.map((x: any) => x.text),
      conflicts: output.conflicts.map((x: any) => x.text),
      inferences: output.inferences,
      openQuestions: output.openQuestions,
      agreement: output.agreement.map((x: any) => x.text),
      sourceList: [{ id: args.raw.id, title: args.raw.title, source_level: stored.source.source_level as SourceLevel }],
    },
    evidence: [
      ...output.suggestedAdditions.map((x: any) => ({ section: 'suggestedAdditions', ...x })),
      ...output.conflicts.map((x: any) => ({ section: 'conflicts', ...x })),
      ...output.agreement.map((x: any) => ({ section: 'agreement', ...x })),
    ],
    title: args.target.title,
    category: args.target.category,
    sources: [...new Set([...args.target.sources, args.raw.id])],
  };
  record.humanReview = workflowReview(
    record,
    stored.humanReview!.units.filter((u) => stored.humanReview!.assignments[u.id] === args.pageId),
  );
  await assertInput(ctx, record);
  return ctx.save(record);
}

export async function createSynthesis(ctx: WorkflowContext, args: { rawIds: string[]; provider: LlmProvider }) {
  const ids = [...new Set(args.rawIds)];
  if (ids.length < 2) throw new WikiError('SYNTHESIS_REQUIRES_TWO_SOURCES', '综合至少需要两条不同 Raw 来源。');
  const raws = await Promise.all(ids.map((id) => ctx.raws.get(id)));
  if (raws.some((raw) => !raw)) throw new WikiError('INVALID_SOURCE', '所选来源中包含不存在的 Raw。', 404);
  const entries = raws as NonNullable<(typeof raws)[number]>[];
  assertRawsNotMeeting(entries);
  if (entries.some((raw) => actualRawSha(raw) !== raw.bodySha256))
    throw new WikiError('RAW_HASH_MISMATCH', '至少一条Raw的frontmatter校验值与实际正文不一致，未生成综合草稿。', 409);
  const schema = await ctx.wiki.schema();
  const input = entries.map((raw) => {
    const binding = sha(JSON.stringify([raw.id, raw.bodySha256]));
    // Keep the shared catalog's default size/count limits and complete Raw coverage.
    const locators = buildEvidenceLocatorCatalog(raw.body, {
      index: 0,
      start: 0,
      end: raw.body.length,
      text: raw.body,
    }).map(({ start, end, text }, index) => ({ id: `raw-${binding}-${index + 1}`, start, end, text }));
    return {
      id: raw.id,
      title: raw.title,
      sourceType: raw.sourceType,
      sourceName: raw.sourceName,
      author: raw.author,
      publishedAt: raw.publishedAt,
      url: raw.url,
      body: raw.body,
      bodySha256: raw.bodySha256,
      locators,
    };
  });
  const output = await call(
    args.provider,
    '你是多来源知识综合助手。sourceLevels必须逐一包含每个输入Raw的rawId及source_level初判，按sourcePolicy和该Raw元数据判级，来源未知或无可判断身份为D。每个Raw恰好一次，禁止串ID或用其他来源身份抬高等级；URL、格式或自称权威不构成核验。等级可人工修改，不代表内容已核实。只输出一个合法JSON对象，不输出代码围栏或前后说明。严格只含九个必填字段，空数组也必须出现：{"sourceLevels":[{"rawId":"输入Raw ID","source_level":"A/B/C/D"}],"synthesis_format_version":1,"title":"综合标题","category":"请求提供的分类id","suggestedAdditions":[],"conflicts":[],"agreement":[],"inferences":[],"openQuestions":[]}。synthesis_format_version必须为数值1；category只能选输入categories中的id，不能写label或自行命名。suggestedAdditions/conflicts/agreement每项严格只含{text,rawId,locatorId}，text非空且最多4000字符，rawId与locatorId必须同时来自输入中同一Raw的当前locators，不得猜测、跨来源或沿用旧正文ID。不得返回或计算quote/start/end。只根据完整原文整理，每条只陈述所附来源支持的最小断言；定位目录只保证原文位置，不证明语义。共同观点需跨来源支持，并分别列出各来源的支持条目；冲突两方各自列证，分别保留各自数值、时间和统计口径，不静默覆盖、平均或调和。未知、未来建议、尚未上线与收益未知不得写成已证事实；推断和待确认问题分别写入inferences/openQuestions字符串数组。没有证据支持则不输出事实条目，不把未提及当作同意。请逐一检查所有输入来源的核心事实及与其含义相关的限制，不只提取显眼数字：否定、条件、适用范围、时间、未知或未证实状态、未来建议等重要限定，必须实际写入输出section的text或字符串正文，不能仅因quote包含原文就视为已表达，不能因为与主数字无关而静默略去。允许忠实概括、同义整理，不要求逐句抄写非实质文本。未来计划或建议、尚未实施、效果或收益未知须保留原限定：有跨来源支持时分别写入agreement，否则保留在对应单源suggestedAdditions；仍待确认的问题单列openQuestions，不把未知变成答案，不把可能原因变成事实。每条有证据text的每个断言都必须由本条所附Raw独立支持，另一条引用不能替本条补支持。通用正例：共同命题分别写“来源甲记载该规则适用于指定范围”“来源乙记载该规则适用于指定范围”，各自附本来源引用；冲突分别写“来源甲记载统计采用周口径”“来源乙记载统计采用月口径”，由分栏和并列体现冲突。反例：只引甲却写“乙也采用该规则”或“与乙的月口径不同”，即使另一条引用乙也不合格。输出前自检：重要限定是否实际进入语义正文；每条的每个断言是否有本条Raw支持；冲突双方是否分别保留；未知、待确认与推断是否分开。这是本次生成的自检要求，不是服务器已证明语义正确。',
    JSON.stringify({
      sourcePolicy: schema.sourcePolicy,
      synthesis_format_version: 1,
      categories: schema.categories.map(({ id, label }) => ({ id, label })),
      raws: input,
    }),
    'synthesis-locator-v1',
  );
  if (
    typeof output.title !== 'string' ||
    !output.title.trim() ||
    output.title.trim().length > 300 ||
    /[\r\n]/u.test(output.title) ||
    typeof output.category !== 'string' ||
    !schema.categories.some((item) => item.id === output.category)
  ) {
    throw new WikiError('LLM_SCHEMA_INVALID', 'Provider 返回的综合标题或分类不符合 Wiki Schema，未生成草稿。', 502);
  }
  if (
    output.sourceLevels.length !== ids.length ||
    new Set(output.sourceLevels.map((item: { rawId: string }) => item.rawId)).size !== ids.length ||
    output.sourceLevels.some((item: { rawId: string }) => !ids.includes(item.rawId))
  )
    throw new WikiError('LLM_SCHEMA_INVALID', '综合来源等级必须逐一对应本次Raw，未创建草稿。', 502);
  const existing = await ctx.wiki.allRecords(),
    draftStore = new DraftStore(ctx.root),
    reviewedDrafts = (await draftStore.list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const sourceList: KnowledgeWorkflow['sections']['sourceList'] = [];
  for (const raw of entries) {
    const source = existing.find(
      (page) => page.type === 'source' && page.sources.length === 1 && page.sources[0] === raw.id,
    );
    const reviewed = reviewedDrafts.find(
      (draft) =>
        draft.rawId === raw.id &&
        draft.rawSha256 === raw.bodySha256 &&
        draft.status !== 'discarded' &&
        (draft.status === 'confirmed' ||
          (draft.humanReview &&
            draft.pages.every((page) =>
              draft.humanReview!.approvals.some(
                (approval) => approval.pageId === page.pageId && approval.digest === draftStore.contentDigest(draft),
              ),
            ))),
    );
    if (reviewed?.humanReview) await draftStore.assertReviewed(reviewed, raw.body);
    sourceList.push({
      id: raw.id,
      title: raw.title,
      source_level: (source?.source_level ??
        reviewed?.source.source_level ??
        output.sourceLevels.find((item: { rawId: string }) => item.rawId === raw.id).source_level) as SourceLevel,
      ...(source ? { existingSourceId: source.id } : {}),
    });
  }
  const directories = new Map(
    input.map((raw) => [raw.id, new Map(raw.locators.map((locator) => [locator.id, locator]))]),
  );
  for (const field of ['suggestedAdditions', 'conflicts', 'agreement'])
    output[field] = output[field].map((item: { text: string; rawId: string; locatorId: string }) => {
      const locator = directories.get(item.rawId)?.get(item.locatorId);
      const body = entries.find((raw) => raw.id === item.rawId)?.body;
      if (
        !locator ||
        body === undefined ||
        !Number.isSafeInteger(locator.start) ||
        !Number.isSafeInteger(locator.end) ||
        locator.start < 0 ||
        locator.end <= locator.start ||
        locator.end > body.length ||
        body.slice(locator.start, locator.end) !== locator.text
      ) {
        throw new WikiError('EVIDENCE_INVALID', '综合建议未选择当前指定Raw的有效定位ID，未生成草稿。', 502);
      }
      return { text: item.text, rawId: item.rawId, quote: locator.text, start: locator.start, end: locator.end };
    });
  assertNoKnownSecret(output, args.provider.secrets);
  validateEvidence(output, entries);
  const record: KnowledgeWorkflow = {
    reviewProtocolVersion: 1,
    id: randomUUID(),
    kind: 'synthesis',
    status: 'pending_confirmation',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: { name: args.provider.name, model: args.provider.model },
    rawSnapshots: entries.map((raw) => ({ id: raw.id, title: raw.title, bodySha256: raw.bodySha256 })),
    title: output.title,
    category: output.category,
    sources: ids,
    source_level: sourceList.reduce<SourceLevel>(
      (level, source) => ('ABCD'.indexOf(source.source_level!) > 'ABCD'.indexOf(level) ? source.source_level! : level),
      'A',
    ),
    sections: {
      suggestedAdditions: output.suggestedAdditions.map((x: any) => x.text),
      conflicts: output.conflicts.map((x: any) => x.text),
      inferences: output.inferences,
      openQuestions: output.openQuestions,
      agreement: output.agreement.map((x: any) => x.text),
      sourceList,
    },
    evidence: [
      ...output.suggestedAdditions.map((x: any) => ({ section: 'suggestedAdditions', ...x })),
      ...output.conflicts.map((x: any) => ({ section: 'conflicts', ...x })),
      ...output.agreement.map((x: any) => ({ section: 'agreement', ...x })),
    ],
  };
  record.humanReview = workflowReview(record);
  return ctx.save(record);
}
