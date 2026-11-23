export type MediaRouteStatus = 'skipped' | 'ocr_ready' | 'needs_vlm' | 'vlm_done' | 'failed';
export type VlmImageType =
  'flowchart' | 'comparison_table' | 'chart_or_ranking' | 'ui_screenshot' | 'text_excerpt' | 'mixed' | 'decorative';
export type VlmConfidence = 'high' | 'medium' | 'low';

export interface OcrQualityMetrics {
  effectiveCharCount: number;
  nonEmptyLineCount: number;
  shortLineRatio: number;
  gibberishRatio: number;
  layoutDispersion: number;
  chartSignalScore: number;
  avgConfidence: number | null;
  qualityScore: number;
}

export interface MediaArtifactResult {
  width?: number;
  height?: number;
  routeStatus: MediaRouteStatus;
  routeReasons: string[];
  metrics: OcrQualityMetrics;
  /** Internal diagnostics. Excluded from ordinary Raw reads and AI context. */
  ocrRawText: string;
  ocrCleanText?: string;
  vlmImageType?: VlmImageType;
  vlmSummary?: string;
  vlmMarkdown?: string;
  vlmConfidence?: VlmConfidence;
  vlmWarnings?: string[];
  vlmModel?: string;
  vlmParsedAt?: string;
  vlmError?: string;
}

export interface MediaArtifact extends MediaArtifactResult {
  mediaId: string;
  imageIndex: number;
  sourceUrl: string;
  /** Path to the existing original, relative to the data root. */
  localPath?: string;
  updatedAt: string;
}
