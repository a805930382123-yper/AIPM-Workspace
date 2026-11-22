import type { PdfPageService } from '../raw/pdf-pages.ts';
import type { DraftRecord } from './drafts.ts';

export type PdfDraftInput = {
  startPage: number;
  endPage: number;
  pageCount: number;
  assetId: string;
  assetSha256: string;
  basisDigest: string;
};
export type PdfEvidence = {
  unitId: string;
  page: number;
  resultSha256: string;
  text: string;
} & ({ kind: 'image' } | { kind: 'text'; start: number; end: number });
type PdfStoredLocator =
  Omit<Extract<PdfEvidence, { kind: 'image' }>, 'text'> | Omit<Extract<PdfEvidence, { kind: 'text' }>, 'text'>;
export type PdfDerivation = PdfDraftInput & {
  rawId: string;
  evidence: PdfStoredLocator[];
};
type PageInput = Awaited<ReturnType<PdfPageService['cleanupInput']>>;
export type PdfUnit = PdfEvidence & { section: 'content' | 'visuals' | 'inference' | 'question' };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9-]{36}$/iu.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
export function validPdfInput(value: unknown): value is PdfDraftInput {
  return (
    object(value) &&
    integer(value.startPage) &&
    integer(value.endPage) &&
    integer(value.pageCount) &&
    value.startPage >= 1 &&
    value.endPage >= value.startPage &&
    value.endPage <= value.pageCount &&
    uuid(value.assetId) &&
    digest(value.assetSha256) &&
    digest(value.basisDigest)
  );
}
function validLocator(value: unknown, binding: PdfDraftInput): boolean {
  return (
    object(value) &&
    integer(value.page) &&
    value.page >= binding.startPage &&
    value.page <= binding.endPage &&
    typeof value.unitId === 'string' &&
    value.unitId.startsWith('p' + value.page + '-') &&
    /^p\d+-(?:text|content|visuals|inference|question)-\d+$/u.test(value.unitId) &&
    digest(value.resultSha256)
  );
}
export function validPdfEvidence(value: unknown, binding: PdfDraftInput): value is PdfEvidence {
  return (
    object(value) &&
    validLocator(value, binding) &&
    typeof value.text === 'string' &&
    !!value.text.trim() &&
    (value.kind === 'image'
      ? value.start === undefined && value.end === undefined
      : value.kind === 'text' &&
        integer(value.start) &&
        integer(value.end) &&
        value.start >= 0 &&
        value.end - value.start === value.text.length)
  );
}
export function validPdfDerivation(value: unknown): value is PdfDerivation {
  if (!object(value)) return false;
  const { rawId, evidence } = value;
  return (
    validPdfInput(value) &&
    uuid(rawId) &&
    Array.isArray(evidence) &&
    evidence.length > 0 &&
    evidence.every(
      (locator) =>
        validLocator(locator, value) &&
        (locator.kind === 'image'
          ? locator.start === undefined && locator.end === undefined
          : locator.kind === 'text' &&
            integer(locator.start) &&
            integer(locator.end) &&
            locator.start >= 0 &&
            locator.end > locator.start),
    ) &&
    new Set(evidence.map((locator) => locator.unitId)).size === evidence.length
  );
}

export function withPdfDerivation(
  previous: PdfDerivation[] | undefined,
  draft: DraftRecord,
  pages: DraftRecord['pages'],
): PdfDerivation[] {
  const binding = draft.pdfInput!;
  const existing = previous?.find((item) => item.rawId === draft.rawId && item.basisDigest === binding.basisDigest);
  const locators = new Map(existing?.evidence.map((item) => [item.unitId, item]));
  for (const page of pages) {
    for (const { text: _text, ...locator } of page.pdfEvidence ?? []) {
      locators.set(locator.unitId, locator);
    }
  }
  return [
    ...(previous ?? []).filter((item) => item !== existing),
    { ...binding, rawId: draft.rawId, evidence: [...locators.values()] },
  ];
}

/** Stable page-local units preserve literal text ranges and keep image interpretations separate. */
export function pdfPageUnits(input: PageInput): PdfUnit[] {
  return input.pages.flatMap((page) => {
    const units: PdfUnit[] = [];
    const prefix = 'p' + page.page + '-';
    const locator = { page: page.page, resultSha256: page.resultSha256 };
    if (page.textStart !== null) {
      const pageStart = page.textStart;
      const text = input.raw.body.slice(pageStart, page.textEnd!);
      for (const line of text.matchAll(/[^\r\n]+/gu)) {
        for (const segment of line[0].matchAll(/[\s\S]{1,1000}/gu)) {
          const value = segment[0].trim();
          if (!value) continue;
          const start = pageStart + line.index + segment.index + segment[0].indexOf(value);
          units.push({
            ...locator,
            unitId: prefix + 'text-' + (units.length + 1),
            kind: 'text',
            section: 'content',
            text: value,
            start,
            end: start + value.length,
          });
        }
      }
    }
    const result = page.understanding;
    const sections = [
      ['content', result.content],
      ['visuals', result.visuals],
      ['inference', result.inference],
      ['question', result.questions.join('\n')],
    ] as const;
    for (const [section, content] of sections) {
      let count = 0;
      for (const line of content.matchAll(/[^\r\n]+/gu)) {
        for (const segment of line[0].matchAll(/[\s\S]{1,1000}/gu)) {
          const value = segment[0].trim();
          if (value)
            units.push({ ...locator, unitId: prefix + section + '-' + ++count, kind: 'image', section, text: value });
        }
      }
    }
    return units;
  });
}

export async function assertPdfEvidence(root: string, record: DraftRecord, pages: DraftRecord['pages']): Promise<void> {
  if (!record.pdfInput) return;
  const [{ PdfPageService }, { RawStore }, { AssetStore }] = await Promise.all([
    import('../raw/pdf-pages.ts'),
    import('../raw/store.ts'),
    import('../raw/assets.ts'),
  ]);
  const pdf = new PdfPageService({
    root,
    raws: new RawStore(root),
    assets: new AssetStore(root),
    provider: async () => undefined,
  });
  const binding = record.pdfInput;
  const current = await pdf.cleanupInput(record.rawId, binding.startPage, binding.endPage);
  if (
    current.raw.bodySha256 !== record.rawSha256 ||
    current.binding.basisDigest !== binding.basisDigest ||
    current.binding.assetId !== binding.assetId ||
    current.binding.assetSha256 !== binding.assetSha256 ||
    current.binding.pageCount !== binding.pageCount
  ) {
    throw Object.assign(Error('PDF 原件或页级理解结果已变化，请重新整理。'), {
      code: 'PDF_EVIDENCE_CHANGED',
      status: 409,
    });
  }
  const catalog = new Map(
    pdfPageUnits(current).map(({ section: _section, ...evidence }) => [evidence.unitId, evidence]),
  );
  for (const page of pages) {
    if (
      !page.pdfEvidence?.length ||
      page.pdfEvidence.some((evidence) => {
        const item = catalog.get(evidence.unitId);
        return (
          !item ||
          evidence.page !== item.page ||
          evidence.resultSha256 !== item.resultSha256 ||
          evidence.kind !== item.kind ||
          evidence.text !== item.text ||
          (evidence.kind === 'text' &&
            (item.kind !== 'text' || evidence.start !== item.start || evidence.end !== item.end))
        );
      })
    ) {
      throw Object.assign(Error('草稿引用了不匹配的 PDF 页证据，请重新整理。'), {
        code: 'PDF_EVIDENCE_CHANGED',
        status: 409,
      });
    }
  }
}
