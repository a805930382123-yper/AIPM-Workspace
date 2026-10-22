import type { EvidenceLocator } from './locators.ts';

export type KnowledgeAtom = { id: string; text: string; start: number; end: number; locatorIds: string[]; fragment: boolean };
/** Content-neutral boundaries: exact source text is retained, including negatives and qualifiers. */
export function buildKnowledgeAtoms(body: string, locators: EvidenceLocator[]): KnowledgeAtom[] {
  if (!locators.length) return [];
  const start = locators[0].start, end = locators.at(-1)!.end;
  const result: KnowledgeAtom[] = [];
  let cursor = start;
  for (let index = start; index < end; index++) {
    const natural = /[。！？!?；;\n]/u.test(body[index]);
    const bounded = index + 1 - cursor >= 512;
    if (!natural && !bounded && index !== end - 1) continue;
    // Never split a UTF-16 surrogate pair at the bounded fallback.
    if (bounded && /[\uD800-\uDBFF]/u.test(body[index]) && index + 1 < end) continue;
    const finish = index + 1;
    const text = body.slice(cursor, finish);
    if (text.length) {
      result.push({ id: `${locators[0].id.split('-')[0]}-a${String(result.length + 1).padStart(4, '0')}`, text, start: cursor, end: finish, locatorIds: locators.filter(item => item.start < finish && item.end > cursor).map(item => item.id), fragment: !natural || (cursor > 0 && !/[。！？!?；;\n]/u.test(body[cursor - 1])) });
    }
    cursor = finish;
  }
  return result;
}

export type CoverageDiagnostic = { facts: { missing: string[]; duplicate: string[]; unknown: string[] }; questions: { missing: string[]; duplicate: string[]; unknown: string[] }; duplicateTitles: string[] };
export function coverageDiagnostic(facts: string[], questions: string[], pages: Array<{ title: string; factIds: string[]; questionIds: string[] }>): CoverageDiagnostic {
  const group = (expected: string[], actual: string[]) => ({ missing: expected.filter(id => !actual.includes(id)), duplicate: [...new Set(actual.filter((id, index) => actual.indexOf(id) !== index))], unknown: [...new Set(actual.filter(id => !expected.includes(id)))] });
  const titles = pages.map(page => page.title.normalize('NFKC').trim().toLowerCase());
  // Report numeric page positions rather than model-controlled title text.
  return { facts: group(facts, pages.flatMap(page => page.factIds)), questions: group(questions, pages.flatMap(page => page.questionIds)), duplicateTitles: titles.flatMap((title, index) => titles.indexOf(title) === index ? [] : [`page-${index + 1}`]) };
}
export function hasCoverageErrors(value: CoverageDiagnostic) { return Object.values(value.facts).some(ids => ids.length) || Object.values(value.questions).some(ids => ids.length) || value.duplicateTitles.length > 0; }
export function validCoverageDiagnostic(value: unknown): value is CoverageDiagnostic {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const keys = (item: unknown, expected: string[]) => object(item) && Object.keys(item).length === expected.length && expected.every(key => Object.hasOwn(item, key));
  const ids = (item: unknown, max: number) => Array.isArray(item) && item.length <= max && item.every(id => typeof id === 'string' && /^[a-z0-9-]{1,64}$/u.test(id)) && new Set(item).size === item.length;
  if (!keys(value, ['facts', 'questions', 'duplicateTitles'])) return false;
  const diagnostic = value as CoverageDiagnostic;
  return keys(diagnostic.facts, ['missing','duplicate','unknown']) && keys(diagnostic.questions, ['missing','duplicate','unknown']) && Object.values(diagnostic.facts).every(item => ids(item, 12800)) && Object.values(diagnostic.questions).every(item => ids(item, 6400)) && ids(diagnostic.duplicateTitles, 50);
}
