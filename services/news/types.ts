export type NewsSectionName = 'fmcg' | 'ai';
export type NewsSavedRaw = {section:NewsSectionName;itemId:string} & (
  {status:'saved'|'missing'|'pending';rawId:string} | {status:'error';message:string;rawId?:never}
);
export type NewsItem = {id:string;title:string;sourceId:string;sourceName:string;url:string;author?:string;publishedAt:string|null;fetchedAt:string;excerpt:string;evidenceKind:'article_excerpt'|'source_summary';research?:{kind:string;dataPeriod:string|null;pdfUrl?:string;pageRange?:string};analysis?:{fact:string;whyItMatters:string;possibleImpact:string}};
export type NewsCheckMode = 'all' | 'failed';
export type SourceExclusions = {urls:Set<string>;titles:Set<string>;pdfs?:Set<string>};
export type SourceError = {
  type:'timeout'|'network'|'tls'|'http'|'parse'|'unknown';
  stage:'list'|'detail'|'pdf'|'parse';
  message:string;
  httpStatus?:number;
};
export type SourceDiagnosis = {
  startedAt:string;finishedAt:string;elapsedMs:number;lastSuccessAt?:string;
  outcome:'ok'|'empty'|'partial'|'failed';
  counts:{candidates:number;qualified:number;duplicates:number;rejected:number;failed:number};
  error?:SourceError;
};
export type SourceHealth = {name:string;checkedAt:string;status:'ok'|'empty'|'failed';error?:string;sourceId?:string;homepage?:string;diagnosis?:SourceDiagnosis};
export type NewsSection = {contentVersion?:'research-v1';status:'running'|'ready'|'source_only'|'empty'|'failed'|'interrupted';attempt:number;startedAt:string;finishedAt?:string;error?:string;sources:SourceHealth[];items:NewsItem[];sourceItems?:NewsItem[];shortageReasons?:string[];checkMessage?:string};
export type NewsEdition = {schemaVersion:1;date:string;updatedAt:string;sections:Partial<Record<NewsSectionName,NewsSection>>;legacyFmcg?:NewsSection;researchOverflow?:NewsItem[]};
export type SourceResult = {items:NewsItem[];sources:SourceHealth[];shortageReasons?:string[]};

export type NewsTranslationResult = {items:Array<{itemId:string;title:string;excerpt:string}>;failedIds:string[]};

const translationSourceIds = new Set([
  'openai-cookbook', 'anthropic-engineering', 'huggingface-blog', 'simon-prompt-engineering',
  'karpathy-github', 'karpathy-blog', 'karpathy-youtube', 'karpathy-x',
]);

export function isNewsTranslationSource(sourceId: string): boolean {
  return translationSourceIds.has(sourceId);
}

export function needsChineseTranslation(text: string): boolean {
  const prose = text.replace(/https?:\/\/\S+/gu, '');
  return /[a-z]/iu.test(prose) && !/\p{Script=Han}/u.test(prose);
}

export function needsNewsTranslation(item: Pick<NewsItem, 'sourceId' | 'title' | 'excerpt'>): boolean {
  return isNewsTranslationSource(item.sourceId) && (needsChineseTranslation(item.title) || needsChineseTranslation(item.excerpt));
}
