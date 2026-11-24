import dictionary from '../../config/fmcg-synonyms.json' with { type: 'json' };

export const TOKENIZER_VERSION = 'intl-zh-v2';
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stopWords = new Set('的 了 在 是 和 与 吗 呢 怎么 如何 什么 请问 有 哪些 以及 根据 关于'.split(' '));
const generic = new Set(
  '业务 市场 领域 影响 情况 数据 资料 政策 渠道 门店 销售 产品 方案 策略 工作 目标 通过 主要 有效 说明 指标 信息 分析 今年 明年 去年 当前 进行 内容 多少 有没有 是否 能够 需要 方式 标准 变化 事实 推断 知识 and or not near'.split(
    ' ',
  ),
);
const groups = dictionary.groups.map((terms) => terms.map((term) => term.toLowerCase()));
const synonyms = new Map(groups.flatMap((group) => group.map((term) => [term, group] as const)));
const compound = '[a-z0-9]+(?:-[a-z0-9]+)+';
const protect = (terms: Iterable<string>) =>
  new RegExp(
    '(' +
      [
        compound,
        ...[...terms]
          .sort((a, b) => b.length - a.length)
          .map((term) => {
            const escaped = term.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
            return /^[a-z0-9]/u.test(term) ? '(?<![a-z0-9])' + escaped + '(?![a-z0-9])' : escaped;
          }),
      ].join('|') +
      ')',
    'gu',
  );
// The editable dictionary expands queries only. Changes to these built-in index terms require a version bump.
const indexPattern = protect([...generic, '动销', '铺货', '毛利']);
const queryPattern = protect(new Set([...synonyms.keys(), ...generic, '动销', '铺货', '毛利']));
const isCompound = new RegExp('^' + compound + '$', 'u');

function tokenize(text: string, protectedPattern: RegExp): string[] {
  return text
    .toLowerCase()
    .split(protectedPattern)
    .flatMap((part, index) => {
      if (index % 2) return isCompound.test(part) ? [part, ...part.split('-')] : [part];
      return Array.from(segmenter.segment(part), ({ segment, isWordLike }) =>
        isWordLike && !stopWords.has(segment) ? segment : '',
      ).filter(Boolean);
    });
}
export function tokenizeForFts(text: string) {
  return tokenize(text, indexPattern);
}

// Limit expression depth for long extracts while keeping titles and tags ahead of body text.
const MAX_GROUPS = 72;
export function buildFtsQuery(inputs: string[]) {
  const groups = new Map<string, { terms: string[]; generic: boolean }>();
  for (const text of inputs) {
    for (const token of tokenize(text, queryPattern)) {
      const alternatives = synonyms.get(token);
      const key = alternatives?.[0] ?? token;
      if (!groups.has(key))
        groups.set(key, { terms: alternatives ?? [token], generic: !alternatives && generic.has(token) });
      if (groups.size === MAX_GROUPS) break;
    }
    if (groups.size === MAX_GROUPS) break;
  }
  const queryGroups = [...groups.values()]
    .map(({ terms, generic }) => ({
      generic,
      terms: [
        ...new Set(
          terms.map((term) => (isCompound.test(term) ? term : tokenizeForFts(term).join(' '))).filter(Boolean),
        ),
      ],
    }))
    .filter(({ terms }) => terms.length);
  const quote = (token: string) => '"' + token.replace(/"/g, '""') + '"';
  return { queryGroups, match: queryGroups.map(({ terms }) => '(' + terms.map(quote).join(' OR ') + ')').join(' OR ') };
}
