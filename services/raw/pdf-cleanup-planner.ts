import type { PdfUnit } from '../wiki/pdf-input.ts';
import type { PdfPresentationGroup } from '../wiki/render.ts';
import { longWritingBatches, writingBatches } from './pdf-topic-writing.ts';
import {
  LONG_REVISION,
  CLEAN_UNITS,
  CLEAN_BYTES,
  INDEX_TOPICS,
  type Decision,
  type Assignment,
  type Fragment,
  type Job,
  type WireUnit,
  type PresentationUnit,
  type IndexBasis,
  type ShapeRequest,
  type PresentationMapping,
  nameKey,
  evidenceKey,
  CleanupError,
  payloadBytes,
} from './pdf-cleanup-types.ts';
import { shapeError } from './pdf-cleanup-schemas.ts';

export function batchesFor(units: WireUnit[]): WireUnit[][] {
  const batches: WireUnit[][] = [];
  let batch: WireUnit[] = [];
  let bytes = 0;
  for (const unit of units) {
    const size = Buffer.byteLength(JSON.stringify(unit)) + 1;
    if (
      batch.length &&
      (batch.length === CLEAN_UNITS || bytes + size > CLEAN_BYTES || unit.page - batch[0].page >= 4)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(unit);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function validateBatch(
  units: WireUnit[],
  decisions: Decision[],
  source: 'checkpoint' | 'provider' = 'checkpoint',
) {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  if (decisions.length !== units.length || byId.size !== units.length || units.some((unit) => !byId.has(unit.id))) {
    throw new CleanupError('PDF_CLEANUP_COVERAGE', '整理必须为本批每个输入单元提供唯一处置和理由。', 502);
  }
  return decisions.map((decision) => {
    const item = unitById.get(decision.id)!;
    if (
      decision.table &&
      (['inference', 'question'].includes(item.kind) ||
        (decision.table.role !== 'note' &&
          !item.text
            .replace(/^\s*\|/u, '')
            .replace(/\|\s*$/u, '')
            .includes('|')))
    ) {
      throw new CleanupError('PDF_CLEANUP_TABLE', '只能从原有分列文字识别表头或表行，推断和问题须独立保留。', 502);
    }
    if (decision.decision !== 'merge') return decision;
    const target = byId.get(decision.mergedInto!);
    if (target?.decision === 'keep' && target.topic === decision.topic && !decision.table && !target.table) {
      const targetUnit = unitById.get(target.id)!;
      if (evidenceKey(item) === evidenceKey(targetUnit)) return decision;
      if (
        source === 'provider' &&
        item.origin !== targetUnit.origin &&
        evidenceKey({ ...item, origin: targetUnit.origin }) === evidenceKey(targetUnit)
      ) {
        const separate = { ...decision };
        delete separate.mergedInto;
        return { ...separate, decision: 'keep' as const, reason: '跨来源依据文字相同，保留两份来源，未执行归并。' };
      }
    }
    throw new CleanupError('PDF_CLEANUP_DUPLICATE', '重复归并目标未知或有不同内容；不同数值、口径和脚注须保留。', 502);
  });
}

export function decisionsFor(job: Job, units: WireUnit[]) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const canonical = new Map(job.index.map((item) => [item.topic, item.title]));
  const byKey = new Map<string, string>();
  const targets = new Map<string, string>();
  const ordered = job.batches.flat().map((decision) => {
    const unit = byId.get(decision.id);
    if (!unit) throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '已保存的整理单元与当前页理解不匹配。');
    if (decision.decision === 'skip') return { ...unit, ...decision };
    const topic = canonical.get(decision.topic!) ?? decision.topic!;
    if (decision.decision === 'merge') return { ...unit, ...decision, topic };
    // Identical table rows can be measurements under different headers, units or conditions.
    const key = JSON.stringify([topic, evidenceKey(unit), decision.table ? unit.id : null]);
    const kept = byKey.get(key);
    if (kept) {
      targets.set(decision.id, kept);
      return {
        ...unit,
        ...decision,
        topic,
        decision: 'merge' as const,
        mergedInto: kept,
        reason: '与已保留单元内容相同；此处的原页依据一并保留。',
      };
    }
    byKey.set(key, decision.id);
    return { ...unit, ...decision, topic };
  });
  return ordered.map((item) =>
    item.mergedInto && targets.has(item.mergedInto) ? { ...item, mergedInto: targets.get(item.mergedInto) } : item,
  );
}

export function writingPlan(job: Job, items: ReturnType<typeof decisionsFor>) {
  return (job.promptRevision ?? 1) >= LONG_REVISION
    ? longWritingBatches(items, new Map(job.batches.flat().map((item) => [item.id, item.topic])))
    : { requests: writingBatches(items), members: undefined };
}

export function displayFor(job: Job, units: WireUnit[]) {
  const original = decisionsFor({ ...job, index: [] }, units);
  const fragments = new Map<string, Fragment[]>();
  for (const item of original) {
    if (item.decision === 'skip' || item.table || ['inference', 'question'].includes(item.kind)) continue;
    const spans: Fragment[] = [];
    const ordinal = /^\s*\d+[.、]\s+(?=\D)/u.exec(item.text)?.[0].trimEnd().length ?? 0;
    let start = 0;
    const delimiters = item.text.matchAll(/(?:[。；;！？!?]+|\.(?=\s|$)|[\r\n]+)+/gu);
    for (const match of delimiters) {
      const end = match.index + match[0].length;
      if (end === ordinal || !item.text.slice(start, end).trim()) continue;
      spans.push({ id: item.id + '-s' + (spans.length + 1), unitId: item.id, start, end });
      start = end;
    }
    if (start < item.text.length && item.text.slice(start).trim()) {
      spans.push({ id: item.id + '-s' + (spans.length + 1), unitId: item.id, start, end: item.text.length });
    } else if (spans.length) spans[spans.length - 1].end = item.text.length;
    if (spans.length > 1) fragments.set(item.id, spans);
  }
  const canonical = new Map(job.index.map(({ topic, title }) => [topic, title]));
  const items = original.flatMap((item) => {
    const spans = fragments.get(item.id);
    const target = item.mergedInto && fragments.get(item.mergedInto);
    const matching = !item.mergedInto || (spans?.length ?? 0) === (target ? target.length : 0);
    const decision = matching ? item.decision : ('keep' as const);
    const mergedInto = matching ? item.mergedInto : undefined;
    if (!spans)
      return [{ ...item, decision, mergedInto, indexKey: item.topic, topic: canonical.get(item.topic!) ?? item.topic }];
    return spans.map((span, i) => {
      const targetId = matching && target ? target[i].id : undefined;
      const indexKey = targetId ?? span.id;
      return {
        ...item,
        ...span,
        text: item.text.slice(span.start, span.end),
        decision,
        mergedInto: targetId,
        indexKey,
        topic: canonical.get(indexKey) ?? item.topic,
      };
    });
  });
  const locations = [...fragments.values()].flat();
  if (job.fragments !== undefined && JSON.stringify(job.fragments) !== JSON.stringify(locations)) {
    throw new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '保存的整理片段位置与原页依据不匹配。');
  }
  return { items, locations };
}

export function indexRequest(labels: string[], offset: number, index: Assignment[], samples: Map<string, IndexBasis>) {
  const payload: Extract<ShapeRequest, { stage: 'pdf_topic_index' }> = {
    stage: 'pdf_topic_index',
    topics: [],
    existing: [],
    basis: [],
    existingBasis: [],
  };
  for (const topic of labels.slice(offset, offset + INDEX_TOPICS)) {
    payload.topics.push(topic);
    payload.basis.push(samples.get(topic)!);
    if (payloadBytes(payload) <= CLEAN_BYTES) continue;
    payload.topics.pop();
    payload.basis.pop();
    break;
  }
  if (!payload.topics.length) throw new CleanupError('PDF_CLEANUP_INDEX', '单个完整主题样本超出索引请求容量。', 422);
  const terms = (value: string) =>
    (nameKey(value).match(/[a-z\d]+|[\p{Script=Han}]+/gu) ?? []).flatMap((word) =>
      /^[a-z\d]+$/u.test(word)
        ? [word]
        : Array.from(word)
            .slice(1)
            .map((letter, i) => word[i] + letter),
    );
  const relevant = new Set(payload.basis.flatMap((item) => terms(item.topic + ' ' + item.samples[0].text)));
  const candidates = new Map<string, { sample: WireUnit; score: number }>();
  for (const { topic, title } of index) {
    const sample = samples.get(topic)!.samples[0];
    const score = [...new Set(terms(title + ' ' + sample.text))].filter((term) => relevant.has(term)).length;
    if (score && score > (candidates.get(title)?.score ?? 0)) candidates.set(title, { sample, score });
  }
  for (const [topic, { sample }] of [...candidates].sort((a, b) => b[1].score - a[1].score).slice(0, INDEX_TOPICS)) {
    payload.existing.push(topic);
    payload.existingBasis.push({ topic, samples: [sample] });
    // Leave room for a related earlier label when a new-only batch would use all of the budget.
    while (payload.existing.length === 1 && payload.topics.length > 1 && payloadBytes(payload) > CLEAN_BYTES) {
      payload.topics.pop();
      payload.basis.pop();
    }
    if (payloadBytes(payload) <= CLEAN_BYTES) continue;
    payload.existing.pop();
    payload.existingBasis.pop();
  }
  return payload;
}

export function presentationBatches(decisions: ReturnType<typeof decisionsFor>) {
  const topics = new Map<string, PresentationUnit[]>();
  for (const { id, page, text, origin, kind, topic, decision, table, unitId, start, end } of decisions) {
    if (decision !== 'keep' || table || kind === 'inference' || kind === 'question') continue;
    const items = topics.get(topic!) ?? [];
    items.push({ id, page, text, origin, kind, topic: topic!, ...(unitId ? { unitId, start, end } : {}) });
    topics.set(topic!, items);
  }
  const batches: PresentationUnit[][] = [];
  let batch: PresentationUnit[] = [];
  const fits = (units: PresentationUnit[]) =>
    units.length <= CLEAN_UNITS && payloadBytes({ stage: 'pdf_presentation', units }) <= CLEAN_BYTES;
  for (const items of topics.values()) {
    if (items.length < 2) continue;
    if (fits([...batch, ...items])) {
      batch.push(...items);
      continue;
    }
    if (batch.length) batches.push(batch);
    batch = [];
    for (const unit of items) {
      if (!fits([...batch, unit])) {
        if (!batch.length) throw new CleanupError('PDF_CLEANUP_PRESENTATION', '单个完整单元超出展示请求容量。', 422);
        batches.push(batch);
        batch = [];
      }
      batch.push(unit);
    }
  }
  if (batch.length) batches.push(batch);
  return batches.flatMap((units) => {
    const counts = new Map<string, number>();
    for (const unit of units) counts.set(unit.topic, (counts.get(unit.topic) ?? 0) + 1);
    const eligible = units.filter((unit) => counts.get(unit.topic)! > 1);
    return eligible.length ? [eligible] : [];
  });
}

// These explicit checks only protect recognizable conditions. They do not establish semantic equivalence.
export function protectedTerms(value: string) {
  const text = nameKey(value)
    .replace(/^\d+[.、]\s+(?=\D)/u, '')
    .replace(/不\s+(?=包括|含)/gu, '不')
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/gu, '')
    .replace(/(?<=\d)\s*[-–—]\s*(?=\d)/gu, '~')
    .replace(/(?<=\d年)\s*\+/gu, '以上');
  const quantities = new Set(
    (
      text.match(
        /[+\-−]?\d+(?:\.\d+)?(?:\s*(?:个百分点|平方公里|万亿|[万亿千百]?(?:元|户|家|人|名|位|次|件|店|个)|[%‰年月日岁倍期周天万亿]|(?:(?:thousand|million|billion)(?:\s+(?:stores|households|people|users|merchants|shoppers|units|dollars))?|stores?|households?|people|users?|merchants?|shoppers?|units?|dollars?|percent|kg|km|usd)\b))?(?:\s*\+)?/giu,
      ) ?? []
    ).map((token) => token.replace(/\s+/gu, '')),
  );
  const conditions = new Set([
    ...[...quantities].filter((token) => /^(?:19|20)\d{2}$|[年月日]$/u.test(token)),
    ...(text.match(
      /(?:华[东南北中]|东北|西北|西南|全国|城市|农村|线上|线下|样本|实际|预测|预计|同比|环比|定性|定量|随机|分层|加权|访谈|问卷|抽样|面板|估算|不足|超过|至少|至多|不含|含税|未税|仅限|不包括|不适用|以下|以上)/gu,
    ) ?? []),
    ...(text.match(
      /\b(?:urban|rural|national|regional|north(?:ern)?|south(?:ern)?|east(?:ern)?|west(?:ern)?|only|excluding|estimate[ds]?|forecast|weighted|random|stratified|qualitative|quantitative|survey|interviews?|samples?)\b/gu,
    ) ?? []),
    ...(text.match(/(?:仅限|限于|不含|排除|样本限定|适用于|仅统计)[^，。；、,.!？;]{1,25}/gu) ?? []),
  ]);
  return { quantities, conditions };
}

export function checkedPresentation(
  units: PresentationUnit[],
  mappings: PresentationMapping[],
  rawText: string,
  rawUnits: Map<string, PdfUnit & { kind: 'text' }>,
) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const byMapping = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const proposed = new Map<string, PdfPresentationGroup>();
  for (const [index, { id, representativeId, reason }] of mappings.entries()) {
    const field = '$.presentation[' + index + ']';
    if (!reason.trim()) throw shapeError('pdf_presentation', field + '.reason', 'blank_reason');
    if (representativeId === null) continue;
    if (
      representativeId === id ||
      !byId.has(representativeId) ||
      byId.get(id)!.topic !== byId.get(representativeId)!.topic ||
      byMapping.get(representativeId)?.representativeId !== null
    ) {
      throw shapeError('pdf_presentation', field + '.representativeId', 'invalid_representative');
    }
    const group = proposed.get(representativeId) ?? { representativeId, memberIds: [], reason: reason.trim() };
    group.memberIds.push(id);
    proposed.set(representativeId, group);
  }
  const groups: PdfPresentationGroup[] = [];
  const parallel: PdfPresentationGroup[] = [];
  for (const group of proposed.values()) {
    const representative = protectedTerms(byId.get(group.representativeId)!.text);
    const members = group.memberIds.map((id) => byId.get(id)!);
    const spans = members
      .flatMap((unit) => {
        const source = rawUnits.get(unit.unitId ?? unit.id);
        return source
          ? [
              {
                page: source.page,
                start: source.start + (unit.start ?? 0),
                end: source.start + (unit.end ?? source.text.length),
                text: unit.text,
              },
            ]
          : [];
      })
      .sort((a, b) => a.start - b.start);
    const onePassage =
      spans.length === members.length &&
      spans.length > 1 &&
      spans.every((span, i) => {
        if (!i) return true;
        const previous = spans[i - 1];
        if (previous.page !== span.page || previous.end > span.start) return false;
        const gap = rawText.slice(previous.end, span.start);
        if (!gap) return true;
        // A single line break can continue an explicit list or a split negation.
        return (
          /^\r?\n$/u.test(gap) &&
          (/、\s*$/u.test(previous.text) ||
            /[（(][^）)]*[,，]\s*$/u.test(previous.text) ||
            (/不\s*$/u.test(previous.text) && /^\s*(?:包括|含)/u.test(span.text)))
        );
      });
    const evidence = onePassage
      ? [rawText.slice(spans[0].start, spans[spans.length - 1].end)]
      : members.map((unit) => unit.text);
    if (
      evidence.some((text) => {
        const member = protectedTerms(text);
        return (
          [...member.quantities].some((term) => !representative.quantities.has(term)) ||
          member.conditions.size !== representative.conditions.size ||
          [...member.conditions].some((term) => !representative.conditions.has(term))
        );
      })
    ) {
      parallel.push({ ...group, reason: '原单元的数值、单位或条件未被代表文字完整保留，继续并列展示。' });
    } else groups.push(group);
  }
  return { groups, parallel };
}

export function verifyPresentation(job: Job, batches: PresentationUnit[][], complete = false) {
  const state = job.presentation;
  if (!state && !complete) return;
  const error = () => new CleanupError('PDF_CLEANUP_BASIS_CHANGED', '主题展示检查点与当前整理单元不匹配。');
  if (!state || state.completedBatches > batches.length || (complete && state.completedBatches !== batches.length))
    throw error();
  const positions = new Map(
    batches
      .slice(0, state.completedBatches)
      .flatMap((batch, index) => batch.map((unit) => [unit.id, JSON.stringify([index, unit.topic])] as const)),
  );
  const used = new Set<string>();
  for (const { representativeId, memberIds } of [...state.groups, ...state.parallel]) {
    const position = positions.get(representativeId);
    if (!position) throw error();
    for (const id of [representativeId, ...memberIds]) {
      if (used.has(id) || positions.get(id) !== position) throw error();
      used.add(id);
    }
  }
}
