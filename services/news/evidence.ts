import type { NewsItem } from './types.ts';

export function newsEvidenceLabel(item:NewsItem) {
  if(item.research) return item.research.kind;
  if(item.evidenceKind==='article_excerpt') return '来源正文摘录，非全文';
  return item.sourceId==='karpathy-youtube'?'视频简介':'来源摘要，未核验原文';
}
