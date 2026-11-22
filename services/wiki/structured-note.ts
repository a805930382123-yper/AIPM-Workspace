/** KB03 v1 is a draft-only contract. No model markup is executed. */
export const STRUCTURED_NOTE_LIMITS = {
  sections: 32,
  blocks: 128,
  items: 128,
  columns: 16,
  rows: 128,
  nodes: 128,
  edges: 256,
  factIds: 128,
  id: 160,
  title: 300,
  text: 8000,
  reason: 2000,
  serializedChars: 1_000_000,
} as const;
export const NOTE_ROLES = ['source_supported', 'reorganized', 'supplementary', 'needs_verification'] as const;
export type NoteRole = (typeof NOTE_ROLES)[number];
export type NoteAttribution = {
  role: NoteRole;
  factIds: string[];
  reason?: string;
  sourceBoundary?: { rawId: string; start: number; end: number; category: 'ambiguous' | 'source_note' | 'question' };
};
export type NoteText = NoteAttribution & { text: string };
export type NoteBlock =
  | (NoteText & { type: 'paragraph' })
  | { type: 'list'; items: NoteText[] }
  | { type: 'table'; title: string; headings: string[]; rows: (NoteAttribution & { cells: string[] })[] }
  | {
      type: 'path_diagram';
      title: string;
      nodes: (NoteText & { id: string })[];
      edges: (NoteAttribution & { from: string; to: string; text: string })[];
    }
  | (NoteText & { type: 'callout'; title: string });
export type StructuredNote = {
  version: 1;
  orientation: string;
  sections: { id: string; title: string; question: string; blocks: NoteBlock[] }[];
};
export type NoteExclusion = { kind: 'fact' | 'question'; id: string; reason: string };
export type NoteReviewMetadata = {
  version: 1;
  generatedNoteDigest: string;
  generatedSections: { id: string; blockCount: number }[];
  contentDigest: string;
  exclusions: NoteExclusion[];
  questionIds: string[];
  humanQuestions: string[];
};
export type NoteApproval = {
  version: 1;
  digest: string;
  at: string;
  warningsAcknowledged: true;
  historicalReportAcknowledged: true;
};
export function validNoteApproval(v: unknown): v is NoteApproval {
  return (
    object(v) &&
    keys(v, ['version', 'digest', 'at', 'warningsAcknowledged', 'historicalReportAcknowledged']) &&
    v.version === 1 &&
    typeof v.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(v.digest) &&
    typeof v.at === 'string' &&
    v.at.length <= 40 &&
    Number.isFinite(Date.parse(v.at)) &&
    v.warningsAcknowledged === true &&
    v.historicalReportAcknowledged === true
  );
}
export const noteReviewContent = (
  note: StructuredNote,
  exclusions: NoteExclusion[],
  questionIds: string[],
  humanQuestions: string[],
) => ({ note, exclusions, questionIds, humanQuestions });
export function noteFactIds(note: StructuredNote): string[] {
  return note.sections.flatMap((s) =>
    s.blocks.flatMap((b) =>
      b.type === 'list'
        ? b.items.flatMap((i) => i.factIds)
        : b.type === 'table'
          ? b.rows.flatMap((r) => r.factIds)
          : b.type === 'path_diagram'
            ? [...b.nodes, ...b.edges].flatMap((v) => v.factIds)
            : b.factIds,
    ),
  );
}
export function noteCoverage(
  note: StructuredNote,
  facts: string[],
  questions: string[],
  exclusions: NoteExclusion[] = [],
  questionIds: string[] = [],
) {
  const used = new Set(noteFactIds(note));
  return [
    ...facts.map((id) => ({ kind: 'fact' as const, id })),
    ...questions.map((id) => ({ kind: 'question' as const, id })),
  ].map((item) => ({
    ...item,
    status: (item.kind === 'fact' ? used.has(item.id) : questionIds.includes(item.id))
      ? ('referenced' as const)
      : exclusions.some((e) => e.kind === item.kind && e.id === item.id && !!e.reason.trim())
        ? ('excluded' as const)
        : ('uncovered' as const),
  }));
}
export function validNoteReview(v: unknown): v is NoteReviewMetadata {
  if (
    !object(v) ||
    !keys(v, [
      'version',
      'generatedNoteDigest',
      'generatedSections',
      'contentDigest',
      'exclusions',
      'questionIds',
      'humanQuestions',
    ]) ||
    v.version !== 1 ||
    ![v.generatedNoteDigest, v.contentDigest].every((x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x))
  )
    return false;
  if (
    !array(v.generatedSections, 32) ||
    !v.generatedSections.every(
      (s) =>
        object(s) &&
        keys(s, ['id', 'blockCount']) &&
        id(s.id) &&
        Number.isInteger(s.blockCount) &&
        Number(s.blockCount) > 0 &&
        Number(s.blockCount) <= 128,
    ) ||
    new Set(v.generatedSections.map((s) => (s as { id: string }).id)).size !== v.generatedSections.length
  )
    return false;
  if (
    !array(v.exclusions, 384, 0) ||
    !v.exclusions.every(
      (e) =>
        object(e) &&
        keys(e, ['kind', 'id', 'reason']) &&
        ['fact', 'question'].includes(String(e.kind)) &&
        id(e.id) &&
        text(e.reason, 2000),
    ) ||
    new Set(
      v.exclusions.map((e) => {
        const x = e as NoteExclusion;
        return x.kind + ':' + x.id;
      }),
    ).size !== v.exclusions.length
  )
    return false;
  return (
    array(v.questionIds, 128, 0) &&
    v.questionIds.every(id) &&
    new Set(v.questionIds).size === v.questionIds.length &&
    array(v.humanQuestions, 128, 0) &&
    v.humanQuestions.every((q) => text(q, 2000))
  );
}
export class StructuredNoteError extends Error {
  code = 'STRUCTURED_NOTE_INVALID';
  status = 400;
  constructor() {
    super('结构化笔记契约或来源事实引用无效。');
  }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
const id = (v: unknown): v is string => text(v, STRUCTURED_NOTE_LIMITS.id);
const array = (v: unknown, max: number, min = 1): v is unknown[] =>
  Array.isArray(v) && v.length >= min && v.length <= max;

/** The caller supplies an authoritative fact directory, never IDs claimed by the note. */
export function validStructuredNote(value: unknown, factIds: ReadonlySet<string>): value is StructuredNote {
  const lim = STRUCTURED_NOTE_LIMITS;
  const attribution = (v: Record<string, unknown>) => {
    if (
      !NOTE_ROLES.includes(v.role as NoteRole) ||
      !array(v.factIds, lim.factIds, 0) ||
      !v.factIds.every((x) => id(x) && factIds.has(x)) ||
      new Set(v.factIds).size !== v.factIds.length
    )
      return false;
    if ((v.role === 'source_supported' || v.role === 'reorganized') && !v.factIds.length) return false;
    if (v.role === 'supplementary' && v.factIds.length) return false;
    return v.role === 'needs_verification' ? text(v.reason, lim.reason) : v.reason === undefined;
  };
  const leaf = (v: unknown, fields: string[], prose: string[]) =>
    object(v) &&
    keys(v, [...fields, 'role', 'factIds'], ['reason', 'sourceBoundary']) &&
    (v.sourceBoundary === undefined ||
      (object(v.sourceBoundary) &&
        keys(v.sourceBoundary, ['rawId', 'start', 'end', 'category']) &&
        typeof v.sourceBoundary.rawId === 'string' &&
        Number.isInteger(v.sourceBoundary.start) &&
        Number.isInteger(v.sourceBoundary.end) &&
        Number(v.sourceBoundary.start) >= 0 &&
        Number(v.sourceBoundary.end) > Number(v.sourceBoundary.start) &&
        ['ambiguous', 'source_note', 'question'].includes(String(v.sourceBoundary.category)))) &&
    attribution(v) &&
    prose.every((k) => text(v[k], lim.text));
  if (
    !object(value) ||
    !keys(value, ['version', 'orientation', 'sections']) ||
    value.version !== 1 ||
    !text(value.orientation, lim.text) ||
    !array(value.sections, lim.sections)
  )
    return false;
  const sectionIds = new Set<string>();
  for (const section of value.sections) {
    if (
      !object(section) ||
      !keys(section, ['id', 'title', 'question', 'blocks']) ||
      !id(section.id) ||
      sectionIds.has(section.id) ||
      !text(section.title, lim.title) ||
      !text(section.question, lim.text) ||
      !array(section.blocks, lim.blocks)
    )
      return false;
    sectionIds.add(section.id);
    for (const block of section.blocks) {
      if (!object(block)) return false;
      switch (block.type) {
        case 'paragraph':
          if (!leaf(block, ['type', 'text'], ['text'])) return false;
          break;
        case 'callout':
          if (!leaf(block, ['type', 'title', 'text'], ['text']) || !text(block.title, lim.title)) return false;
          break;
        case 'list':
          if (
            !keys(block, ['type', 'items']) ||
            !array(block.items, lim.items) ||
            !block.items.every((item) => leaf(item, ['text'], ['text']))
          )
            return false;
          break;
        case 'table':
          if (
            !keys(block, ['type', 'title', 'headings', 'rows']) ||
            !text(block.title, lim.title) ||
            !array(block.headings, lim.columns) ||
            !block.headings.every((h) => text(h, lim.title)) ||
            !array(block.rows, lim.rows)
          )
            return false;
          for (const row of block.rows)
            if (
              !leaf(row, ['cells'], []) ||
              !object(row) ||
              !Array.isArray(row.cells) ||
              row.cells.length !== block.headings.length ||
              !row.cells.every((c) => text(c, lim.text))
            )
              return false;
          break;
        case 'path_diagram': {
          if (
            !keys(block, ['type', 'title', 'nodes', 'edges']) ||
            !text(block.title, lim.title) ||
            !array(block.nodes, lim.nodes) ||
            !array(block.edges, lim.edges, 0)
          )
            return false;
          const nodeIds = new Set<string>();
          for (const node of block.nodes) {
            if (!leaf(node, ['id', 'text'], ['text']) || !object(node) || !id(node.id) || nodeIds.has(node.id))
              return false;
            nodeIds.add(node.id);
          }
          for (const edge of block.edges)
            if (
              !leaf(edge, ['from', 'to', 'text'], ['text']) ||
              !object(edge) ||
              !nodeIds.has(edge.from as string) ||
              !nodeIds.has(edge.to as string)
            )
              return false;
          break;
        }
        default:
          return false;
      }
    }
  }
  return JSON.stringify(value).length <= lim.serializedChars;
}
export function parseStructuredNote(value: unknown, factIds: ReadonlySet<string>): StructuredNote {
  if (!validStructuredNote(value, factIds)) throw new StructuredNoteError();
  return structuredClone(value);
}

// Escaping happens before Markdown parsing; entities preserve literal newlines without new blocks.
const plain = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~\-])/g, '\\$1')
    .replace(/\r\n|\r|\n/g, '&#10;');
const labels: Record<NoteRole, string> = {
  source_supported: '原文支持',
  reorganized: '整理归纳',
  supplementary: '补充知识，未经原文支持',
  needs_verification: '待核实',
};
function attribution(value: NoteAttribution): string {
  return `【${labels[value.role]}】${value.factIds.length ? ` 事实引用：${value.factIds.map(plain).join('、')}` : ''}${value.role === 'needs_verification' ? `；原因：${plain(value.reason!)}` : ''}`;
}
/** Pure, deterministic CommonMark. Tables deliberately use column-labelled row lists. */
export function renderStructuredNote(note: StructuredNote, gridTables = false): string {
  const out = ['# 结构化笔记', '', `知识定位：${plain(note.orientation)}`];
  for (const section of note.sections) {
    out.push('', `## ${plain(section.title)}`, '', `阅读问题：${plain(section.question)}`);
    for (const block of section.blocks) {
      out.push('');
      switch (block.type) {
        case 'paragraph':
          out.push(`${attribution(block)} ${plain(block.text)}`);
          break;
        case 'callout':
          out.push(`### 提醒：${plain(block.title)}`, '', `${attribution(block)} ${plain(block.text)}`);
          break;
        case 'list':
          for (const item of block.items) out.push(`- ${attribution(item)} ${plain(item.text)}`);
          break;
        case 'table':
          out.push(`### ${plain(block.title)}`, '');
          if (gridTables) {
            const cell = (v: string) => plain(v).replace(/\\\|/g, '&#124;');
            out.push(
              '| ' + [...block.headings.map(cell), '内容角色与证据'].join(' | ') + ' |',
              '| ' + [...block.headings, '角色'].map(() => '---').join(' | ') + ' |',
            );
            for (const row of block.rows)
              out.push('| ' + [...row.cells.map(cell), attribution(row).replace(/\\\|/g, '&#124;')].join(' | ') + ' |');
            break;
          }
          block.rows.forEach((row, i) => {
            out.push(`- 第 ${i + 1} 行 ${attribution(row)}`);
            row.cells.forEach((cell, j) => out.push(`  - ${plain(block.headings[j])}：${plain(cell)}`));
          });
          break;
        case 'path_diagram':
          out.push(`### ${plain(block.title)}`, '', '节点：', '');
          for (const node of block.nodes) out.push(`- ${plain(node.id)}：${plain(node.text)} ${attribution(node)}`);
          out.push('', '关系：', '');
          for (const edge of block.edges)
            out.push(`- ${plain(edge.from)} → ${plain(edge.to)}：${plain(edge.text)} ${attribution(edge)}`);
          break;
      }
    }
  }
  return out.join('\n') + '\n';
}
/** Paired with the restricted writer above; unrecognised input stays Markdown text. */
export function parseNoteGrid(
  lines: string[],
  start: number,
): { headings: string[]; rows: string[][]; end: number } | undefined {
  const split = (line: string) =>
    line.startsWith('| ') && line.endsWith(' |') ? line.slice(2, -2).split(' | ') : undefined;
  const headings = split(lines[start] ?? ''),
    separator = split(lines[start + 1] ?? '');
  if (
    !headings ||
    headings.length < 2 ||
    headings.length > 17 ||
    !separator ||
    separator.length !== headings.length ||
    separator.some((c) => c !== '---')
  )
    return;
  const rows: string[][] = [];
  let end = start + 2;
  while (end < lines.length && lines[end].startsWith('| ')) {
    const row = split(lines[end]);
    if (!row || row.length !== headings.length) return;
    rows.push(row);
    end++;
  }
  return rows.length ? { headings, rows, end } : undefined;
}
export const escapeNoteText = plain;
