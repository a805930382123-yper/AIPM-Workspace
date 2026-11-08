export type NewsSectionName = 'fmcg' | 'ai';
export type NewsItem = {id:string;title:string;sourceId:string;sourceName:string;url:string;publishedAt:string|null;fetchedAt:string;excerpt:string;evidenceKind:'article_excerpt'|'source_summary';research?:{kind:string;dataPeriod:string|null;pdfUrl?:string;pageRange?:string};analysis?:{fact:string;whyItMatters:string;possibleImpact:string}};
export type SourceHealth = {name:string;checkedAt:string;status:'ok'|'empty'|'failed';error?:string};
export type NewsSection = {contentVersion?:'research-v1';status:'running'|'ready'|'source_only'|'empty'|'failed'|'interrupted';attempt:number;startedAt:string;finishedAt?:string;error?:string;sources:SourceHealth[];items:NewsItem[]};
export type NewsEdition = {schemaVersion:1;date:string;updatedAt:string;sections:Partial<Record<NewsSectionName,NewsSection>>;legacyFmcg?:NewsSection};
export type SourceResult = {items:NewsItem[];sources:SourceHealth[]};
