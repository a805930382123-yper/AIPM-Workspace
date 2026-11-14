import { kb02StructuredOutput } from '../llm/openai-structured.ts';
import { validateSchema, type JsonSchemaNode } from '../llm/schema-validator.ts';
import type { PdfUnit } from '../wiki/pdf-input.ts';
import type { PdfTopicItem, PdfWrittenBlock } from '../wiki/render.ts';

type WritingItem = Pick<PdfTopicItem, 'id' | 'page' | 'origin' | 'kind' | 'text' | 'mergedInto'> & { unitId: string };
type WritingTopic = { id: string; title: string; items: WritingItem[] };
export type WritingRequest = { stage: 'pdf_topic_write'; topics: WritingTopic[] };
type Disposition = { action: 'included' | 'duplicate' | 'metadata' | 'promotion'; reason: string | null }
  & ({ blockIndex: number | null; blockIndexes?: never } | { blockIndexes: number[]; blockIndex?: never });
export type WritingResult = { topics: Record<string, { blocks: Array<{ kind: 'fact'; text: string }>; coverage: Record<string, Disposition> }> };
type WritingMembers = ReadonlyMap<string, WritingItem[]>;

export class PdfWritingError extends Error {
  readonly code = 'PDF_TOPIC_WRITE_INVALID';
  constructor(readonly reason: string) { super('主题写作结果未通过依据校验，已保留此前完成批次。'); }
}

export function writingBatches(items: Array<PdfTopicItem & { topic?: string; unitId?: string }>) {
  const topics = new Map<string, WritingItem[]>();
  for (const item of items) {
    if (!item.topic || item.decision === 'skip' || item.table || !['content', 'visuals'].includes(item.kind)) continue;
    const rows = topics.get(item.topic) ?? [];
    const { id, unitId, page, origin, kind, text, mergedInto } = item;
    rows.push({ id, unitId: unitId ?? id, page, origin, kind, text, ...(mergedInto ? { mergedInto } : {}) });
    topics.set(item.topic, rows);
  }
  const payload = (topics: WritingTopic[]): WritingRequest => ({ stage: 'pdf_topic_write', topics });
  const fits = (topics: WritingTopic[]) => topics.length <= 4 && topics.reduce((sum, topic) => sum + topic.items.length, 0) <= 48
    && Buffer.byteLength(JSON.stringify(payload(topics))) <= 24 * 1024;
  const batches: WritingRequest[] = [];
  let batch: WritingTopic[] = [];
  let number = 0;
  for (const [title, items] of topics) {
    const topic = { id: 't' + ++number, title, items };
    if (fits([...batch, topic])) {
      batch.push(topic);
      continue;
    }
    if (batch.length) batches.push(payload(batch));
    batch = [];
    let part: WritingTopic = { ...topic, items: [] };
    let partNumber = 1;
    for (const item of items) {
      if (!fits([{ ...part, items: [...part.items, item] }])) {
        if (!part.items.length) throw new PdfWritingError('input_unit_too_large');
        batches.push(payload([part]));
        part = { ...topic, id: topic.id + '-' + ++partNumber, items: [] };
      }
      part.items.push(item);
    }
    batch.push(part);
  }
  if (batch.length) batches.push(payload(batch));
  return batches;
}

export function longWritingBatches(items: Array<PdfTopicItem & { topic?: string }>, originalTopics: ReadonlyMap<string, string | undefined>) {
  const packs: Array<{ key: string; input: PdfTopicItem & { unitId: string; topic: string }; members: WritingItem[] }> = [];
  let last: typeof packs[number] | undefined;
  for (const { id, topic, decision, table, page, origin, kind, text } of items) {
    if (decision === 'skip') continue;
    if (!topic || table || !['content', 'visuals'].includes(kind)) {
      last = undefined;
      continue;
    }
    const key = JSON.stringify([topic, originalTopics.get(id), page, origin, kind]);
    const member = { id, unitId: id, page, origin, kind, text };
    const bytes = Buffer.byteLength(text);
    if (bytes > 4096) throw new PdfWritingError('input_unit_too_large');
    if (last?.key === key && Buffer.byteLength(last.input.text) + bytes + 2 <= 4096) {
      last.input.text += '\n\n' + text;
      last.members.push(member);
    } else {
      last = { key, input: { ...member, id: 'g-' + id, decision: 'keep', topic }, members: [member] };
      packs.push(last);
    }
  }
  return {
    requests: writingBatches(packs.map(pack => pack.input)),
    members: new Map(packs.map(pack => [pack.input.id, pack.members])),
  };
}

const keyed = (properties: Record<string, JsonSchemaNode>): JsonSchemaNode => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const decisionSchema = keyed({
  action: { type: 'string', enum: ['included', 'duplicate', 'metadata', 'promotion'] },
  blockIndex: { type: ['integer', 'null'], minimum: 0 },
  reason: { type: ['string', 'null'], minLength: 1, maxLength: 240 },
});
const packDecisionSchema = keyed({
  action: decisionSchema.properties!.action,
  blockIndexes: { type: 'array', maxItems: 48, items: { type: 'integer', minimum: 0 } },
  reason: decisionSchema.properties!.reason,
});
const coveredBlocks = (item: Disposition) => item.blockIndexes ?? (typeof item.blockIndex === 'number' ? [item.blockIndex] : []);
const chapterReference = /^(\s*第[一二三四五六七八九十百零〇\d]+章\s*[「“][^」”]+[」”][，,、\s]+)(\d+(?:\.\d+)+)(\s*[「“]([^」”]+)[」”])/u;
const numberedHeading = /^\s*(\d+(?:\.\d+)+)\s+([^\r\n]+?)\s*$/u;
const layoutTitle = (title: string) => title.normalize('NFKC').replace(/\s+/gu, '').replace(/[。.]$/u, '');
const headingKey = (number: string, title: string) => JSON.stringify([number, layoutTitle(title)]);
const eraDimension = /(\d+(?:\.\d+)+)\s*时代(?:对应)?的?\s*[「“]([^」”]+)[」”]/gu;
const openingDimension = /^\s*[「“]([^」”]+)[」”]/u;

export function pdfWritingLayout(items: Array<Pick<PdfTopicItem, 'id' | 'page' | 'origin' | 'text'>>) {
  const coverTitles = new Map<number, Set<string>>();
  const sectionTitles = new Map<number, Set<string>>();
  const contents = new Set<number>();
  const metadata = new Set<string>();
  const lastText = new Map<number, string>();
  for (const { id, page, origin, text } of items) {
    if (origin !== 'image') continue;
    const cover = /^封面标题[：:]([^。]+)。(?:副标题[：:]([^。]+)。)?(?:页面(?:上方|下方|顶部|底部)显示[“「][^”」\d]+[”」](?:和[“「][^”」\d]+[”」])?标识。)?$/u.exec(text);
    const section = /^本页为[“「]([^”」]+)[”」][，,]副标题为[“「]([^”」]+)[”」]。?$/u.exec(text);
    const pageSection = /^第(\d+)页[，,]\s*([^。]{2,16})。/u.exec(text);
    if (/^目录[（(]第\d+页[）)][：:]?$/u.test(text)) contents.add(page);
    if (cover && !protectedFacts(cover[1].replace(/^(?:19|20)\d{2}年?\s*(?=\p{Script=Han})/u, '')).size
      && (!cover[2] || !protectedFacts(cover[2]).size)) {
      metadata.add(id);
      const titles = coverTitles.get(page) ?? new Set<string>();
      titles.add(layoutTitle(cover[1]));
      coverTitles.set(page, titles);
    }
    const titles = sectionTitles.get(page) ?? new Set<string>();
    if (section) for (const title of section.slice(1)) if (!protectedFacts(title).size) titles.add(layoutTitle(title));
    if (pageSection && Number(pageSection[1]) === page && /^(?:序言|前言|引言|寄语)(?:与寄语)?$/u.test(pageSection[2])) {
      titles.add(layoutTitle(pageSection[2]));
    }
    if (titles.size) sectionTitles.set(page, titles);
  }
  for (const { id, page, origin, text } of items) {
    if (origin !== 'text') continue;
    lastText.set(page, id);
    const title = layoutTitle(text);
    if (coverTitles.get(page)?.has(title) || sectionTitles.get(page)?.has(title)) metadata.add(id);
  }
  return { metadata, contents, lastText };
}

export function confirmedPdfPageLabels(items: Array<Pick<PdfTopicItem, 'page' | 'origin' | 'text'>>) {
  const labels = new Map<number, Set<string>>();
  for (const item of items) {
    if (item.origin !== 'image') continue;
    const match = /^\s*(?:本页|页面)?\s*页码(?:为|是|[:：])?\s*(\d+)\s*[。.]?\s*$/u.exec(item.text);
    if (!match) continue;
    const page = labels.get(item.page) ?? new Set<string>();
    page.add(match[1]);
    labels.set(item.page, page);
  }
  return new Map([...labels].flatMap(([page, values]) => values.size === 1 ? [[page, [...values][0]] as const] : []));
}

export function adjacentPdfTextLines(units: PdfUnit[], raw: string) {
  const text = units.filter((unit): unit is PdfUnit & { kind: 'text' } => unit.kind === 'text');
  return new Map(text.flatMap((unit, i) => {
    const next = text[i + 1];
    return next?.page === unit.page && /^\r?\n$/u.test(raw.slice(unit.end, next.start)) ? [[unit.unitId, next.unitId] as const] : [];
  }));
}

function definitionKey(text: string) {
  const definition = /(?:^|[。；;])\s*(?:[^：:。\r\n\d]{0,12}(?:定义|释义))\s*[:：]?\s*(.+?)\s*(?:[:：]|指|为)\s*([^。；;]+)[。；;]?\s*$/u.exec(text);
  return definition && JSON.stringify([layoutTitle(definition[1]), layoutTitle(definition[2])]);
}

const quotaText = (text: string) => text.normalize('NFKC').replace(/(?<=\d)岁?\s*(?:至|到|[-–—~])\s*(?=\d)/gu, '~').replace(/\s+/gu, '');

export function writingFormat(request: WritingRequest, grouped = false) {
  return kb02StructuredOutput(request.stage, keyed({ topics: keyed(Object.fromEntries(request.topics.map(topic => [topic.id, keyed({
    blocks: { type: 'array', maxItems: grouped ? 48 : topic.items.length, items: keyed({ kind: { type: 'string', enum: ['fact'] }, text: { type: 'string', minLength: 1, maxLength: 2000 } }) },
    coverage: keyed(Object.fromEntries(topic.items.map(item => [item.id, grouped ? packDecisionSchema : decisionSchema]))),
  })]))) }));
}

// Deliberately check explicit written quantities and scope markers. Natural-language entailment needs review.
function protectedFacts(value: string, topicEvidence = false) {
  const facts = new Set<string>();
  let text = value.normalize('NFKC').toLowerCase();
  if (topicEvidence) {
    text = text.replace(/(?<![未不])(?:增加|上升)了?(?=\s*\d)/gu, '+')
      .replace(/(?<![\d.])(?:(高出|低于|低)\s*)?([+\-−]?\d+(?:\.\d+)?)\s*%\s*(?:至|到|[-–—~])\s*([+\-−]?\d+(?:\.\d+)?)\s*%\s*(以上|以下)?/gu,
        (_, direction: string | undefined, first: string, last: string, limit?: string) => {
          const endpoint = (number: string) => (number.startsWith('+') ? '+' : '') + Number(number.replace('−', '-'));
          const prefix = direction === '低' ? '低于' : direction ?? '';
          facts.add('percent_range:' + prefix + endpoint(first) + '~' + endpoint(last) + (limit ?? ''));
          return ' ';
        });
  }
  text = text
    .replace(/^\s*\d+[.、]\s+(?=\D)/u, '')
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/gu, '')
    .replace(/\bm\s*a\s*t\s*(\d(?:\s*\d){3})\b/giu, (_, digits: string) => 'mat' + digits.replace(/\s+/gu, ''))
    .replace(/\b(\d(?:\s+\d){3})(?=\s*年)/gu, (_, digits: string) => digits.replace(/\s+/gu, ''))
    .replace(/([一二三四五六七八九十]|\d+)\s*(?:至|到|[-–—~])\s*([一二三四五六七八九十]|\d+)\s*线(?!上|下)/gu,
      (_, first: string, last: string) => [first, last].map(value => /^\d+$/u.test(value) ? value : '零一二三四五六七八九十'.indexOf(value)).join('~') + '线')
    .replace(/(\d+)\s*岁?\s*(?:至|到|[-–—~])\s*(\d+)\s*岁/gu, '$1~$2岁')
    .replace(/(?<![\d.])\d+(?:[、，,和及]\s*\d+)+\s*(?:万亿|亿|万|个)/gu, list => {
      const unit = /(?:万亿|亿|万|个)$/u.exec(list)![0];
      return topicEvidence || unit === '个' ? list.replace(/\d+(?=[、，,和及])/gu, '$&' + unit) : list;
    })
    .replace(/(?<=\d)\s*[-–—]\s*(?=\d)/gu, '~')
    .replace(/(?<=\d年)\s*\+/gu, '以上');
  const numbers = /(?:(超过|超|高于|至少|不低于|不超过|至多|不足|低于|约|大约|增长|下降|>=|<=|[+\-−<>≈])\s*)?(\d+(?:\.\d+)?)(?:\s*(余|多))?(?:\s*(个百分点|百分点|(?:万亿|亿|万)?(?:美元|元|户|家|人|名|位|次|件|店|个)|万亿|[%‰年月日岁倍期周天万亿]|(?:stores?|households?|people|users?|merchants?|units?|percent|kg|km|usd)\b))?(?:\s*(以上|以下))?/giu;
  const qualifiers: Record<string, string> = {
    超过: '>', 超: '>', 高于: '>', 余: '>', 多: '>', 至少: '>=', 不低于: '>=', 以上: '>=',
    至多: '<=', 不超过: '<=', 以下: '<=', 不足: '<', 低于: '<', 约: '~', 大约: '~', '≈': '~', 增长: '+', 下降: '-', '−': '-',
  };
  for (const [, prefix, value, extra, unit, limit] of text.matchAll(numbers)) {
    const op = prefix || extra || limit || '';
    const scale = unit?.startsWith('万亿') ? 12 : unit?.startsWith('亿') ? 8 : unit?.startsWith('万') ? 4 : 0;
    const suffix = unit?.replace(/^(?:万亿|亿|万)/u, '') ?? '';
    const normalizedUnit = suffix === '个百分点' ? '百分点' : suffix === 'percent' ? '%' : suffix === 'usd' ? '美元' : suffix;
    const [whole, fraction = ''] = value.split('.');
    const digits = whole + fraction.padEnd(scale, '0');
    const point = whole.length + scale;
    const integer = digits.slice(0, point).replace(/^0+(?=\d)/u, '');
    const decimal = digits.slice(point).replace(/0+$/u, '');
    facts.add('quantity:' + (qualifiers[op] ?? op) + integer + (decimal ? '.' + decimal : '') + normalizedUnit);
  }
  for (const marker of text.match(/预计|预测|预估|实际|实测|同比|环比|(?<!确)定性|定量|抽样|加权|随机|分层|访谈|问卷|华[东南北中]|东北|西南|西北|全国|城乡|城镇|农村|线上|线下|含税|未税|仅限|不包括|不含|\b(?:forecast|projected|actual|urban|rural|north|south|east|west|only|qualitative|quantitative|weighted|random|stratified)\b/gu) ?? []) {
    const normalized = /^(预计|预测|预估|forecast|projected)$/u.test(marker) ? 'forecast' : /^(实际|实测|actual)$/u.test(marker) ? 'actual' : marker;
    facts.add('scope:' + normalized);
  }
  return facts;
}

export function readWriting(request: WritingRequest, value: unknown, raw?: string, pageLabels?: ReadonlyMap<number, string>,
  nextTextLine?: ReadonlyMap<string, string>, members?: WritingMembers, layout?: ReturnType<typeof pdfWritingLayout>, topicEvidence = false): WritingResult {
  const schema = writingFormat(request, !!members).schema;
  if (validateSchema(value, schema).length) throw new PdfWritingError('invalid_shape');
  if (raw) {
    const objects: Array<Set<string> | null> = [];
    for (const [token, name, colon] of raw.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|[{}\[\]]/gsu)) {
      if (token === '{') objects.push(new Set());
      else if (token === '[') objects.push(null);
      else if (token === '}' || token === ']') objects.pop();
      else if (colon) {
        const keys = objects.at(-1)!;
        const key = JSON.parse(name) as string;
        if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new PdfWritingError('invalid_key');
        keys.add(key);
      }
    }
  }
  const written = value as WritingResult;
  for (const topic of request.topics) {
    const { blocks, coverage } = written.topics[topic.id];
    const byBlock = blocks.map(() => ({ sources: [] as WritingItem[], included: false }));
    const topicSources = topic.items.flatMap(item => members?.get(item.id) ?? [item]);
    // Identify structural ordinals using matching chapter references or a cross-origin copy of the indexed title.
    const references = new Set(topicSources.flatMap(item => {
      const reference = chapterReference.exec(item.text);
      return reference ? [headingKey(reference[2], reference[4])] : [];
    }));
    const headings = new Set(topicSources.flatMap(item => {
      const heading = numberedHeading.exec(item.text);
      if (!heading || /^(?:[%‰]|(?:万亿|万|亿)?(?:美元|元|户|家|人|倍)|(?:kg|km|usd)\b)/iu.test(heading[2])) return [];
      const key = headingKey(heading[1], heading[2]);
      const corroborated = layoutTitle(heading[2]) === layoutTitle(topic.title) && topicSources.some(other => {
        if (other.origin === item.origin || other.page !== item.page) return false;
        const duplicate = numberedHeading.exec(other.text);
        return duplicate && headingKey(duplicate[1], duplicate[2]) === key;
      });
      return references.has(key) || corroborated ? [key] : [];
    }));
    const facts = (text: string) => {
      const heading = numberedHeading.exec(text);
      if (heading && headings.has(headingKey(heading[1], heading[2]))) return protectedFacts(heading[2], topicEvidence);
      const reference = chapterReference.exec(text);
      return protectedFacts(reference && headings.has(headingKey(reference[2], reference[4]))
        ? reference[1] + reference[3] + text.slice(reference[0].length) : text, topicEvidence);
    };
    const eraById = new Map<string, { era: string; dimension: string; inherited: boolean }>();
    let previous: WritingItem | undefined;
    let era: string | undefined;
    for (const item of topicSources) {
      const explicit = [...item.text.matchAll(eraDimension)];
      const span = /-s(\d+)$/u.exec(item.id)?.[1];
      const priorSpan = previous && /-s(\d+)$/u.exec(previous.id)?.[1];
      if (!previous || previous.unitId !== item.unitId || previous.page !== item.page || previous.origin !== item.origin
        || !span || !priorSpan || Number(span) !== Number(priorSpan) + 1 || !/[;；]\s*$/u.test(previous.text)) era = undefined;
      if (explicit.length === 1) {
        era = explicit[0][1];
        eraById.set(item.id, { era, dimension: explicit[0][2], inherited: false });
      } else if (!explicit.length && era) {
        const dimension = openingDimension.exec(item.text)?.[1];
        if (dimension) eraById.set(item.id, { era, dimension, inherited: true });
        else era = undefined;
      } else era = undefined;
      previous = item;
    }
    for (const item of topic.items) {
      const { action, reason } = coverage[item.id];
      const indexes = coveredBlocks(coverage[item.id]);
      const sources = members?.get(item.id) ?? [item];
      if (action === 'included' || action === 'duplicate') {
        if (!indexes.length || new Set(indexes).size !== indexes.length || indexes.some(index => !byBlock[index])
          || (action === 'duplicate' && !reason?.trim())) throw new PdfWritingError('invalid_coverage');
        if (topicEvidence) continue;
        for (const index of indexes) {
          byBlock[index].sources.push(...sources);
          byBlock[index].included ||= action === 'included';
        }
        continue;
      }
      if (indexes.length || !reason?.trim()) throw new PdfWritingError('invalid_omission');
      if (topicEvidence) continue;
      for (const item of sources) {
        const text = layoutTitle(item.text);
        const title = layoutTitle(topic.title);
        const chapter = /^第[一二三四五六七八九十百零〇\d]+[章节篇][:：、]?(.+)$/u.exec(text);
        const about = /^关于([\p{L}·]{2,24})$/u.exec(text);
        const fieldLabel = /^(?:数据|研究|样本|品类|渠道|地域)(?:来源|说明|范围)$/u.test(text);
        const substantive = /是|为|达到|增长|下降|提供|导致|采用|包括|表示|拥有|旗下|成立|收购/u;
        const shortTitle = text === title && text.length <= 30 && /(?:规模|范围|概况|说明|目录|索引)$/u.test(text);
        const titleOnly = (chapter?.[1] === title || (blocks.length > 0 && (shortTitle || !!about && title.includes(about[1]))))
          && !substantive.test(chapter?.[1] ?? text) && !facts(chapter?.[1] ?? text).size;
        const columnLabels = item.text.trim().replace(/^(?:本页|页面)(?:以|用)[一二三四五六七八九十\d]+列表格(?:呈现|展示|列出)/u, '')
          .replace(/[。；;.]$/u, '').split(/[\s、，,和及]+/u);
        const tableLayout = columnLabels.length >= 2 && columnLabels.every(label => /^(?:执行时间|调查时间|样本条件|样本量|数据来源|指标名称|指标释义|计量单位)$/u.test(label));
        const isMetadata = layout?.metadata.has(item.id) || fieldLabel || titleOnly || tableLayout
          || /^\s*(?:(?:(?:本页|页面)(?:标注|标有)[“「][^”」\d]{1,35}[”」][,，]\s*)?(?:本页|页面)?\s*页码(?:为|是|[:：])?\s*\d+|(?:页面)?(?:左上角|右上角|左下角|右下角|页眉|页脚)(?:有|为|显示|展示)\s*[^，,。；;\d]{1,45}(?:标识|标志|logo)|关于我们|logo|page\s+\d+)\s*[。.]?\s*$/iu.test(item.text);
        if (!isMetadata && (protectedFacts(item.text).size || substantive.test(text) || /创立|总部|数据来源/u.test(item.text))) {
          throw new PdfWritingError('protected_omission');
        }
        if (action === 'metadata' && !isMetadata) throw new PdfWritingError('invalid_metadata');
      }
    }
    const checkedBlocks: Array<{ factsBySource: Map<string, Set<string>>; proposed: Set<string> }> = [];
    let topicFacts: Set<string> | undefined;
    for (const [index, block] of blocks.entries()) {
      const { sources, included } = topicEvidence ? { sources: topicSources, included: true } : byBlock[index];
      if (!block.text.trim() || !sources.length || !included) {
        throw new PdfWritingError('missing_block_evidence');
      }
      const peopleSample = sources.some(item => /样本量\s*n\s*=/iu.test(item.text)) && sources.some(item => /(?:年龄.{0,25}(?:岁|男女)|受访者|参与者)/u.test(item.text));
      const blockFacts = (text: string) => facts(peopleSample ? text
        .replace(/\bn\s*=\s*(\d+)(?=[\s。.;；,，]|$)/giu, '$1人')
        .replace(/(\d+)位(?=为?[\p{L}]{0,12}(?:用户|受访者|参与者))/gu, '$1人') : text);
      const factsBySource = new Map(topicFacts ? [] : sources.map(item => {
        let text = item.text;
        if (item.origin === 'image') {
          if (layout?.contents.has(item.page)) text = text.replace(/^0\d\s+(?=[^：:]+[：:])/u, '');
          text = text.replace(/(?<=[。；;])\s*(?:本页|页面)?页码(?:为|是|[:：])?\s*\d+[。.]?\s*$/u, '');
        }
        const trailing = item.origin === 'text' && /^(.*?)\s+(\d+)\s*$/su.exec(text);
        if (trailing && (pageLabels?.get(item.page) === trailing[2]
          || (layout?.lastText.get(item.page) === item.id && !pageLabels?.has(item.page) && Number(trailing[2]) === item.page))) {
          const definition = definitionKey(trailing[1]);
          if (definition && sources.some(other => other.origin === 'image' && other.page === item.page
            && definitionKey(other.text) === definition)) text = trailing[1];
        }
        if (item.origin === 'text' && /\d\s*(?:万亿|万|亿)?美\s*$/u.test(text)) {
          const next = nextTextLine?.get(item.unitId);
          if (next && sources.some(other => other.unitId === next && other.origin === 'text' && /^\s*元/u.test(other.text))) text = text.trimEnd() + '元';
        }
        const quota = peopleSample && item.origin === 'text' && /^([^\r\n]*\p{Script=Han}[^\r\n]*)\s+(\d+)\s+(\d+(?:\.\d+)?%)$/u.exec(text);
        if (quota) {
          const label = quota[1].trim().split(/\s+/u).at(-1)!;
          const withUnit = quotaText(label + quota[2] + '人(' + quota[3] + ')');
          if (sources.some(other => other.origin === 'image' && other.page === item.page
            && quotaText(other.text).includes(withUnit))) text = quota[1] + ' ' + quota[2] + '人 ' + quota[3];
        }
        return [item.id, blockFacts(text)] as const;
      }));
      const provided = topicFacts ?? new Set([...factsBySource.values()].flatMap(source => [...source]));
      if (topicEvidence) topicFacts = provided;
      const text = block.text.replace(eraDimension, (full, version: string, dimension: string) => {
        const anchors = sources.flatMap(item => {
          const anchor = eraById.get(item.id);
          return anchor?.dimension === dimension ? [anchor] : [];
        });
        if (!anchors.length) {
          if (sources.some(item => openingDimension.exec(item.text)?.[1] === dimension)) throw new PdfWritingError('era_scope_changed');
          return full;
        }
        if (!anchors.some(anchor => anchor.era === version)) throw new PdfWritingError('era_scope_changed');
        return anchors.some(anchor => anchor.era === version && !anchor.inherited) ? full : full.slice(version.length);
      });
      const proposed = blockFacts(text);
      if ([...proposed].some(fact => !provided.has(fact)) || (!members && [...provided].some(fact => !proposed.has(fact)))) {
        throw new PdfWritingError('protected_facts_changed');
      }
      if (!topicEvidence) checkedBlocks.push({ factsBySource, proposed });
    }
    if (members && !topicEvidence) for (const item of topic.items) {
      const covered = coveredBlocks(coverage[item.id]).map(index => checkedBlocks[index]);
      const proposed = new Set(covered.flatMap(block => [...block.proposed]));
      for (const source of members.get(item.id)!) {
        if (covered.some(block => [...block.factsBySource.get(source.id)!].some(fact => !proposed.has(fact)))) {
          throw new PdfWritingError('protected_facts_changed');
        }
      }
    }
  }
  return written;
}

export function writtenBlocks(batches: WritingRequest[], results: WritingResult[], members?: WritingMembers, topicEvidence = false) {
  const output = new Map<string, PdfWrittenBlock[]>();
  for (const [index, result] of results.entries()) {
    for (const { id, title } of batches[index].topics) {
      const { blocks, coverage } = result.topics[id];
      const target = output.get(title) ?? [];
      target.push(...blocks.map(({ text }, blockIndex) => ({ text,
        sourceIds: topicEvidence ? [] : Object.keys(coverage).filter(id => coveredBlocks(coverage[id]).includes(blockIndex))
          .flatMap(id => members?.get(id)?.map(item => item.id) ?? [id]) })));
      output.set(title, target);
    }
  }
  return output;
}
