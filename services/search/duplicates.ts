import type { WikiRecord } from '../wiki/store.ts';

export type DuplicateCandidate = {
  wiki: WikiRecord;
  score: number;
  matches: Array<{ dimension: 'title' | 'aliases' | 'category' | 'tags' | 'content'; score: number; reason: string }>;
};

const norm = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '');
const grams = (value: string) => {
  const text = norm(value);
  if (!text) return new Set<string>();
  if (text.length <= 2) return new Set([text]);
  return new Set(Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2)));
};
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common++;
  return common / (a.size + b.size - common);
};

/** Heuristic only: each returned score is a review hint, never an identity decision. */
export function findDuplicateCandidates(input: {
  title: string; aliases?: string[]; category: string; tags?: string[]; content: string;
}, pages: WikiRecord[]): DuplicateCandidate[] {
  const title = norm(input.title);
  const aliases = (input.aliases ?? []).map(norm).filter(Boolean);
  const tags = new Set((input.tags ?? []).map(norm).filter(Boolean));
  const bodyGrams = grams(input.content);
  const candidates = pages.map(wiki => {
    const wikiTitle = norm(wiki.title);
    const wikiAliases = wiki.aliases.map(norm);
    const matches: DuplicateCandidate['matches'] = [];
    const titleSimilarity = overlap(grams(title), grams(wikiTitle));
    const titleScore = title && title === wikiTitle ? 1
      : title && wikiAliases.includes(title) ? 0.92
        : aliases.some(alias => alias === wikiTitle || wikiAliases.includes(alias)) ? 0.92
          : titleSimilarity >= 0.82 ? titleSimilarity : 0;
    if (titleScore) matches.push({ dimension: titleScore >= 0.9 && title !== wikiTitle ? 'aliases' : 'title', score: titleScore, reason: titleScore >= 0.9 && title !== wikiTitle ? '建议标题与既有别名重合' : titleScore >= 0.9 ? '标题规范化后完全相同' : '标题部分相似' });
    const aliasScore = Math.max(title && wikiAliases.includes(title) ? 1 : 0, ...aliases.map(alias => wikiAliases.includes(alias) ? 1 : wikiTitle === alias ? 0.95 : 0));
    if (aliasScore) matches.push({ dimension: 'aliases', score: aliasScore, reason: '建议标题或别名与既有别名重合' });
    const categoryScore = norm(input.category) === norm(wiki.category) ? 1 : 0;
    if (categoryScore) matches.push({ dimension: 'category', score: 0.08, reason: '分类相同（单独命中权重很低）' });
    const commonTags = [...tags].filter(tag => wiki.tags.map(norm).includes(tag));
    const tagScore = tags.size ? commonTags.length / new Set([...tags, ...wiki.tags.map(norm)]).size : 0;
    if (tagScore) matches.push({ dimension: 'tags', score: tagScore * 0.2, reason: `共享标签：${commonTags.join('、')}` });
    const contentScore = overlap(bodyGrams, grams(wiki.body));
    if (contentScore >= 0.4) matches.push({ dimension: 'content', score: contentScore, reason: `正文二元片段相似度 ${(contentScore * 100).toFixed(0)}%` });
    const effectiveContentScore = contentScore >= 0.4 ? contentScore : 0;
    const score = Math.min(1, Math.max(titleScore * 0.72, aliasScore * 0.78, effectiveContentScore * 0.68) + categoryScore * 0.04 + tagScore * 0.16);
    return { wiki, score, matches };
  }).filter(candidate => candidate.matches.length > 0)
    .sort((a, b) => b.score - a.score || a.wiki.title.localeCompare(b.wiki.title, 'zh-CN'));
  return candidates.slice(0, 10);
}
