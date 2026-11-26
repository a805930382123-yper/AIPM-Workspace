import dictionary from '../../config/fmcg-synonyms.json' with { type: 'json' };

export const TOKENIZER_VERSION = 'intl-zh-v2';
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stopWords = new Set('的 了 在 是 和 与 吗 呢 怎么 如何 什么 请问 有 哪些 以及 根据 关于'.split(' '));
const generic = new Set(
  '业务 市场 领域 影响 情况 数据 资料 政策 渠道 门店 销售 产品 方案 策略 工作 目标 通过 主要 有效 说明 指标 信息 分析 今年 明年 去年 当前 进行 内容 多少 有没有 是否 能够 需要 方式 标准 变化 事实 推断 知识 and or not near'.split(
    ' ',
  ),
);
const questionFillers = new Set('哪里 怎样 何时 谁 哪个 哪 多久 到底 通常 俩 都 些 啥 把 一 先 再'.split(' '));
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
const storefrontNames = new Set([...['ka', 'gt', 'cvs', '折扣店', '会员店'].flatMap((key) => synonyms.get(key) ?? [])]);
const storefrontPattern = protect(storefrontNames);
const literalStorefront = /^[\p{Script=Han}]{0,12}?(?:超市|卖场|商场|店)(?!面|铺|员|长)/u;

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
  const groups = new Map<string, { terms: string[]; generic: boolean; coverageWeight: number }>();
  for (const text of inputs) {
    for (const token of tokenize(text, queryPattern)) {
      const alternatives = synonyms.get(token);
      const key = alternatives?.[0] ?? token;
      if (!groups.has(key)) {
        const isGeneric = !alternatives && generic.has(token);
        groups.set(key, {
          terms: alternatives ?? [token],
          generic: isGeneric,
          coverageWeight: isGeneric || questionFillers.has(token) ? 0 : token.length,
        });
      }
      if (groups.size === MAX_GROUPS) break;
    }
    if (groups.size === MAX_GROUPS) break;
  }
  const queryGroups = [...groups.values()]
    .map(({ terms, generic, coverageWeight }) => ({
      generic,
      coverageWeight,
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

const areaQuestion =
  /^(?:(?:店面|门店|店铺|营业|营运|经营|单店)?面积(?:有?多大|多少|几平米|几平方米)?|(?:占地|店面|铺面)?(?:有?多大|多大面积|有?(?:多少|几)(?:平方米|平米|平方))|占地(?:面积|多少))$/u;
const hoursQuestion =
  /^(?:多长时间营业|(?:营业|运营)(?:时长|时间(?:有?多长|(?:从)?几点到几点)?|多久|多长时间|多少小时|几个小时|(?:到|从)?几点(?:到几点)?|到什么时候)|(?:开门|关门|打烊)(?:时间|到几点)|(?:从)?几点(?:开门|关门|打烊|开店|闭店|营业)?(?:到几点(?:营业|关门|打烊)?)?|几点开门几点关门|什么时间(?:开门|营业|打烊)|开多久|开几个小时|(?:是不是|是否)?全天营业)$/u;
const operating = '(?:营业|运营|开门|关门|打烊|闭店)';
const duration = '(?:(?:[0-9]+(?:\\.[0-9]+)?|[一二三四五六七八九十]+)\\s*小时|全天|通宵)';
const clock = '(?:[0-2]?\\d:[0-5]\\d|[0-2]?\\d\\s*点(?:半|\\d{1,2}分)?)';
const areaValue = String.raw`(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[两一二三四五六七八九十百千万]+)`;
const areaEvidence = new RegExp(
  String.raw`(?:(?:营业|营运|经营|门店|单店|店铺|店面|铺面|建筑)?面积|占地(?:面积)?|店面|铺面)\s*(?:[=:<>≤≥]|约|大约|为|有|在|一般|通常|平均|小于|超过|不超过|大于|不足|介于|达)*\s*${areaValue}\s*(?:[~—–至到-]\s*${areaValue}\s*)?(?:平方米|平米|m2(?!\d)|平(?:方)?(?=左右|上下|以内|以上|以下|之内|[^\p{L}\p{N}]|$))`,
  'u',
);
const hoursEvidence = new RegExp(
  `${duration}\\s*(?:连续|对外|正常)?${operating}|${operating}(?:时长|时间)?[ :为约每天每日从]*${duration}(?!\\s*[内前后])|${operating}(?:时间|时段)?[ :为每天每日从]*${clock}|${clock}\\s*(?:[-–—至到]\\s*${clock}\\s*)?${operating}`,
  'u',
);

// A store and each requested fact must be explicit before switching away from lexical coverage.
export function buildStoreFactQuery(title: string) {
  const text = title
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/^(?:请问|我想了解|想了解)\s*/u, '');
  const known = text.match(storefrontPattern)?.find((name) => text.startsWith(name) && storefrontNames.has(name));
  const entity = known ?? text.match(literalStorefront)?.[0];
  if (!entity) return;
  const facts = text
    .slice(entity.length)
    .replace(/\s+/gu, '')
    .replace(/[吗呢?。]+$/u, '')
    .split(/[,;、]|以及|和/u)
    .filter(Boolean)
    .map((clause) => clause.replace(/^(?:的|一般|通常|平时|日常|平均|大概|大约|每天|每日|每家|门店|单店)+/u, ''));
  const area = facts.some((fact) => areaQuestion.test(fact));
  const hours = facts.some((fact) => hoursQuestion.test(fact));
  if (!facts.length || facts.some((fact) => !areaQuestion.test(fact) && !hoursQuestion.test(fact))) return;
  const cues = [
    ...(area ? ['面积', '占地', '铺面', '店面', '平方米', '平米'] : []),
    ...(hours ? ['营业', '运营', '开门', '关门', '打烊', '闭店'] : []),
  ];
  const entityTerms = (known ? (synonyms.get(known) ?? [known]) : [entity]).map((name) =>
    tokenizeForFts(name).join(' '),
  );
  const namesEntity = (tokens: string) => entityTerms.some((term) => (' ' + tokens + ' ').includes(' ' + term + ' '));
  return {
    match: `(${entityTerms.map((term) => '"' + term + '"').join(' OR ')}) AND body_tokens:(${buildFtsQuery(cues).match})`,
    hasEvidence(rawText: string, titleTokens: string, aliases: string[]) {
      const pageNamesEntity =
        namesEntity(titleTokens) || aliases.some((name) => namesEntity(tokenizeForFts(name).join(' ')));
      return rawText
        .normalize('NFKC')
        .toLowerCase()
        .split(/[\n。!?;]/u)
        .some((sentence) => {
          let sameStore = pageNamesEntity;
          // A comma can carry the subject into the next clause. Keep thousands separators in the value.
          return sentence.split(/(?<!\d),|,(?!\d{3}(?:\D|$))/u).some((clause) => {
            const facts = [
              { match: areaEvidence.exec(clause), requested: area },
              { match: hoursEvidence.exec(clause), requested: hours },
            ].sort((a, b) => (a.match?.index ?? clause.length) - (b.match?.index ?? clause.length));
            if (!facts[0].match) {
              const mentioned = clause
                .trim()
                .replace(/^[-*]\s*/u, '')
                .match(literalStorefront)?.[0];
              if (mentioned) sameStore = entityTerms.includes(tokenizeForFts(mentioned).join(' '));
              return false;
            }
            let end = 0;
            return facts.some(({ match, requested }) => {
              if (!match) return false;
              const subject = clause
                .slice(end, match.index)
                .trim()
                .replace(/^(?:[-*]|\d+\.|以及|和|并|且)\s*/u, '')
                .replace(/(?:的|一般|通常|平时|每天|每日|\s)+$/u, '');
              end = match.index + match[0].length;
              // A page name can supply an omitted subject. An explicit subject in the fact takes precedence.
              if (subject && !/^(?:门店|单店|店铺|店面|铺面)$/u.test(subject)) {
                sameStore = entityTerms.includes(tokenizeForFts(subject).join(' '));
              }
              return sameStore && requested;
            });
          });
        });
    },
  };
}
