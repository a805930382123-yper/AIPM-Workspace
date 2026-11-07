export type NewsSectionName = 'fmcg' | 'ai';
export type NewsItem = {id:string;title:string;sourceId:string;sourceName:string;url:string;publishedAt:string|null;fetchedAt:string;excerpt:string;evidenceKind:'article_excerpt'|'source_summary';analysis?:{fact:string;whyItMatters:string;possibleImpact:string}};
export type SourceHealth = {name:string;checkedAt:string;status:'ok'|'empty'|'failed';error?:string};
export type NewsSection = {status:'running'|'ready'|'source_only'|'empty'|'failed'|'interrupted';attempt:number;startedAt:string;finishedAt?:string;error?:string;sources:SourceHealth[];items:NewsItem[]};
export type NewsEdition = {schemaVersion:1;date:string;updatedAt:string;sections:Partial<Record<NewsSectionName,NewsSection>>};
export type SourceResult = {items:NewsItem[];sources:SourceHealth[]};
