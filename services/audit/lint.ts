import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { RawStore } from '../raw/store.ts';
import type { AuditService } from './service.ts';

export type LintCode = 'BROKEN_WIKI_LINK' | 'ORPHAN_WIKI' | 'INDEX_MISSING' | 'FRONTMATTER_MISSING' | 'SOURCE_MISSING' | 'KNOWLEDGE_STATUS_MISSING' | 'CONFIDENCE_MISSING' | 'SOURCE_LEVEL_MISSING' | 'UNSOURCED_FACT' | 'OPEN_AUDIT' | 'DUPLICATE_TITLE';
export type LintFinding = { code: LintCode; objectId: string | null; pageTitle: string | null; file: string; message: string; location: { scope: 'page' | 'line'; line: number; column?: number; text?: string } };
type Page = { id: string; title: string; aliases: string[]; type: string; sources: string[]; body: string; bodyOffset: number; text: string; file: string; front: Record<string, unknown> | null };
const linkRe = /\[\[([^\]]+)\]\]/gu;
const sectionRe = /^ {0,3}(#{1,6})[ \t]*(来源事实|Source Facts|来源证据|Source Evidence)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/gmu;
const headingRe = /^ {0,3}(#{1,6})(?:[ \t]|$)/u;
const evidenceRefRe = /[（(]证据\s+([^）)]+)[）)]/gu;
const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s_\-·、，,。.；;：:（）()【】\[\]]+/gu, '');
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function rawExcerpt(rawBody: string | undefined, start: number, end: number) {
  if (!rawBody || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > rawBody.length) return;
  const excerpt = rawBody.slice(start, end);
  return excerpt.trim() ? excerpt : undefined;
}
function evidenceQuotes(excerpt: string) {
  // B04 displays a 90-character prefix plus an ellipsis while offsets retain the full Raw span.
  return excerpt.length > 90 ? [excerpt, `${excerpt.slice(0, 90)}…`] : [excerpt];
}
function sourceEvidence(body: string, offset: number, headingDepth: number, rawBodies: Map<string, string>) {
  const entries = new Map<string, { coordinates: string; allowsBareRef: boolean } | null>();
  const record = (id: string, start: number, end: number, rawIds: string[], allowsBareRef = false) => {
    const prev = entries.get(id);
    const coordinates = JSON.stringify([start, end, [...rawIds].sort()]);
    entries.set(id, rawIds.length && (prev === undefined || prev?.coordinates === coordinates)
      ? { coordinates, allowsBareRef: allowsBareRef || Boolean(prev?.allowsBareRef) } : null);
  };
  while (offset < body.length) {
    const newline = body.indexOf('\n', offset);
    const lineEnd = newline < 0 ? body.length : newline;
    const line = body.slice(offset, lineEnd).replace(/\r$/u, '');
    const heading = headingRe.exec(line);
    if (heading && heading[1]!.length <= headingDepth) break;
    let next = lineEnd + 1;
    const entry = /^[ \t]*[-*][ \t]*([^｜|\s]+)[ \t]*[｜|][ \t]*原文[ \t]*\[(\d+)[ \t]*,[ \t]*(\d+)\)[ \t]*[：:]/u.exec(line);
    if (entry) {
      const [, id, startText, endText] = entry;
      const start = Number(startText), end = Number(endText);
      const quoteStart = offset + entry[0].length;
      const padding = /^[ \t]*/u.exec(line.slice(entry[0].length))![0].length;
      const matched: string[] = [];
      for (const [rawId, rawBody] of rawBodies) {
        const excerpt = rawExcerpt(rawBody, start, end);
        if (!excerpt) continue;
        for (const quote of evidenceQuotes(excerpt)) {
          const displayStart = body.slice(quoteStart, quoteStart + padding + quote.length).indexOf(quote);
          if (displayStart < 0) continue;
          const quoteEnd = quoteStart + displayStart + quote.length;
          const after = /^[ \t]*(?:\r?\n|$)/u.exec(body.slice(quoteEnd));
          if (!after) continue;
          matched.push(rawId);
          // The Raw bytes determine the quote boundary, including embedded Markdown and empty lines.
          next = Math.max(next, quoteEnd + after[0].length);
          break;
        }
      }
      record(id!, start, end, matched);
    } else {
      const bibliography = /^[ \t]*[-*][ \t]+《[^》]+》[^\r\n]*?\bRaw[ \t]+([0-9a-f-]{36})[ \t]*[，,][ \t]*证据[ \t]+(.+)$/iu.exec(line);
      if (bibliography) {
        const rawId = bibliography[1]!;
        for (const [, id, startText, endText] of bibliography[2]!.matchAll(/(?:^|[、，,][ \t]*)([\w.-]+)[ \t]*[（(]原文[ \t]*\[(\d+)[ \t]*,[ \t]*(\d+)\)[）)](?=[ \t]*(?:[、，,。.]|$))/gu)) {
          const start = Number(startText), end = Number(endText);
          record(id!, start, end, rawExcerpt(rawBodies.get(rawId), start, end) ? [rawId] : [], true);
        }
      }
    }
    offset = next;
  }
  return entries;
}
function substantiveFacts(body: string, baseOffset: number, headingDepth: number) {
  const facts: Array<{ text: string; offset: number }> = [];
  let paragraph: string[] = [];
  let paragraphOffset = 0, offset = baseOffset, listIndent = 0;
  const flush = () => {
    if (paragraph.length) facts.push({ text: paragraph.join(' '), offset: paragraphOffset });
    paragraph = [];
    listIndent = 0;
  };
  for (const line of body.slice(baseOffset).split(/\r?\n/u)) {
    const trimmed = line.trim();
    const lineOffset = offset;
    offset += line.length + (body.startsWith('\r\n', offset + line.length) ? 2 : 1);
    const heading = headingRe.exec(line);
    if (heading && heading[1]!.length <= headingDepth) break;
    const marker = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/u.exec(line);
    const text = marker ? line.slice(marker[0].length).trim() : trimmed;
    if (heading || !text || /^(?:待确认[:：]|(?:待确认|暂无|无)[。！!]?\s*$|N\/?A$)/iu.test(text)) {
      flush();
      continue;
    }
    // Generated bullets may leave a citation-only suffix on the following unindented line.
    if (!marker && /^[（(]证据\s+[^）)]+[）)]$/u.test(text)) {
      if (paragraph.length) paragraph.push(text);
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (marker || (listIndent && indent < listIndent)) flush();
    if (!paragraph.length) paragraphOffset = lineOffset + (marker?.[0].length ?? indent);
    paragraph.push(text);
    if (marker) listIndent = marker[0].length;
  }
  flush(); return facts;
}
async function mdFiles(dir: string): Promise<string[]> { const entries = await readdir(dir, { withFileTypes: true }).catch(() => []); return (await Promise.all(entries.map(e => e.isDirectory() ? mdFiles(path.join(dir, e.name)) : e.name.toLowerCase().endsWith('.md') ? [path.join(dir, e.name)] : []))).flat(); }

export class WikiLint {
  constructor(private root: string, private raws: RawStore, private audits: AuditService) {}
  async inspect() {
    const wikiDir = path.join(this.root, 'knowledge', 'wiki'); const files = await mdFiles(wikiDir); const indexFile = path.join(wikiDir, 'index.md');
    const pages: Page[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8'); if (path.resolve(file) === path.resolve(indexFile)) continue;
      let front: Record<string, unknown> | null = null; let body = text; let bodyOffset = 0;
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
      if (match) { try { const parsed = yaml.load(match[1]!) as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) front = parsed as Record<string, unknown>; } catch { /* broken YAML remains visible */ } bodyOffset = match[0].length; body = text.slice(bodyOffset); }
      const title = typeof front?.title === 'string' ? front.title : /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? path.basename(file, '.md');
      const id = typeof front?.id === 'string' ? front.id : path.basename(file, '.md');
      pages.push({ id, title, aliases: Array.isArray(front?.aliases) ? front.aliases.filter((x): x is string => typeof x === 'string') : [], type: typeof front?.type === 'string' ? front.type : '', sources: Array.isArray(front?.sources) ? front.sources.filter((x): x is string => typeof x === 'string') : [], body, bodyOffset, text, file, front });
    }
    const findings: LintFinding[] = [];
    const add = (code: LintCode, page: Page | undefined, file: string, message: string, offset = 0, scope: 'page' | 'line' = 'page') => {
      const fileText = page?.text ?? '';
      const location: LintFinding['location'] = { scope, line: lineAt(fileText, offset) };
      if (scope === 'line') {
        const start = fileText.lastIndexOf('\n', offset - 1) + 1;
        const end = fileText.indexOf('\n', offset);
        location.text = fileText.slice(start, end < 0 ? fileText.length : end).replace(/\r$/u, '').slice(0, 120);
      }
      findings.push({ code, objectId: page?.id ?? null, pageTitle: page?.title ?? null, file: path.relative(this.root, file).replace(/\\/g, '/'), message, location });
    };
    const names = new Map<string, Page[]>();
    for (const page of pages) for (const name of [page.title, ...page.aliases, page.id]) { const key = norm(name); names.set(key, [...(names.get(key) ?? []), page]); }
    const outgoing = new Map<string, number>(); const incoming = new Set<string>();
    for (const page of pages) {
      const textForLinks = page.body; let match: RegExpExecArray | null;
      while ((match = linkRe.exec(textForLinks))) {
        const rawTarget = match[1]!.split(/[|#]/, 1)[0]!.trim(); const candidates = [...new Set([...(names.get(norm(rawTarget)) ?? []), ...(names.get(norm(path.basename(rawTarget))) ?? [])])];
        if (/^raw:/i.test(rawTarget)) continue;
        if (candidates.length !== 1) add('BROKEN_WIKI_LINK', page, page.file, candidates.length ? `Wiki 链接“${rawTarget}”匹配到多个页面。` : `Wiki 链接“${rawTarget}”没有目标页面。`, page.bodyOffset + match.index, 'line');
        else { outgoing.set(page.id, (outgoing.get(page.id) ?? 0) + 1); incoming.add(candidates[0]!.id); }
      }
    }
    for (const page of pages) {
      const fileText = page.text;
      if (!page.front) add('FRONTMATTER_MISSING', page, page.file, '页面缺少或无法解析 YAML Frontmatter。');
      for (const key of ['knowledge_status', 'confidence', 'source_level'] as const) if (typeof page.front?.[key] !== 'string' || !String(page.front[key]).trim()) {
        const code: LintCode = key === 'knowledge_status' ? 'KNOWLEDGE_STATUS_MISSING' : key === 'confidence' ? 'CONFIDENCE_MISSING' : 'SOURCE_LEVEL_MISSING'; add(code, page, page.file, `Frontmatter 缺少 ${key}。`);
      }
      const rawBodies = new Map<string, string>();
      let missingRaw = false;
      for (const rawId of page.sources) {
        const raw = await this.raws.get(rawId);
        if (raw) rawBodies.set(rawId, raw.body);
        else missingRaw = true;
      }
      if (!page.sources.length || missingRaw) add('SOURCE_MISSING', page, page.file, !page.sources.length ? 'sources 为空或缺失。' : '一个或多个 sources 未映射到现存 Raw。', Math.max(0, fileText.indexOf('sources:')));
      if (['verified', 'source_supported'].includes(String(page.front?.knowledge_status)) && !rawBodies.size) add('UNSOURCED_FACT', page, page.file, '页面声明来源支持/已验证，但没有有效 Raw 来源。');
      const headers = [...page.body.matchAll(sectionRe)];
      const sectionHeader = headers.find(header => ['来源事实', 'Source Facts'].includes(header[2]!));
      if (sectionHeader) {
        const sectionStart = sectionHeader.index + sectionHeader[0].length;
        const evidenceHeader = headers.find(header => ['来源证据', 'Source Evidence'].includes(header[2]!));
        const evidenceById = evidenceHeader && sourceEvidence(page.body, evidenceHeader.index + evidenceHeader[0].length, evidenceHeader[1]!.length, rawBodies);
        for (const fact of substantiveFacts(page.body, sectionStart, sectionHeader[1]!.length)) {
          const refs = [...fact.text.matchAll(evidenceRefRe)].flatMap(m => m[1]!.split(/[、,，\s]+/u));
          const bareRefs = /[（(]([\w.-]+(?:[、，,][ \t]*[\w.-]+)*)[）)]$/u.exec(fact.text)?.[1]?.split(/[、，,][ \t]*/u) ?? [];
          const inline = /\[\[raw:([0-9a-f-]{36})\]\]\s*[“"]([^”"]{2,})[”"]/i.exec(fact.text);
          const coordinateRefs = [...fact.text.matchAll(/来源\s*Raw\s+([0-9a-f-]{36})[^\n]*?原文\s*\[(\d+)\s*,\s*(\d+)\)[ \t]*(?:[：:][ \t]*(?:“([^”]*)”|"([^"]*)"|([^“”"]*)))?/gi)];
          const located = inline ? Boolean(inline[2]!.trim() && rawBodies.get(inline[1]!)?.includes(inline[2]!))
            : coordinateRefs.some(ref => {
              const excerpt = rawExcerpt(rawBodies.get(ref[1]!), Number(ref[2]), Number(ref[3]));
              const displayed = ref[4] ?? ref[5] ?? ref[6]?.trim();
              return excerpt !== undefined && (displayed === undefined || (Boolean(displayed.trim()) && evidenceQuotes(excerpt).includes(displayed)));
            }) || refs.some(ref => Boolean(evidenceById?.get(ref))) || bareRefs.some(ref => evidenceById?.get(ref)?.allowsBareRef);
          if (!located) add('UNSOURCED_FACT', page, page.file, '“来源事实”中的该条陈述没有可在有效 Raw 中定位的证据引用。', page.bodyOffset + fact.offset, 'line');
        }
      }
    }
    const indexText = await readFile(indexFile, 'utf8').catch(() => '');
    if (!indexText) {
      for (const page of pages) add('INDEX_MISSING', page, page.file, '知识 Index 文件缺失或为空，页面未被收录。');
    } else for (const page of pages) {
      const listed = indexText.includes(page.id) || [...page.aliases, page.title].some(name => [...indexText.matchAll(linkRe)].some(m => norm(m[1]!.split(/[|#]/, 1)[0]!.trim()) === norm(name)));
      if (!listed) add('INDEX_MISSING', page, page.file, '页面没有出现在 knowledge/wiki/index.md。');
    }
    for (const page of pages) if (page.type !== 'source' && !incoming.has(page.id) && !(outgoing.get(page.id) ?? 0)) add('ORPHAN_WIKI', page, page.file, '非 Source 页面没有有效入链或出链。');
    const grouped = new Map<string, Page[]>(); for (const page of pages) grouped.set(norm(page.title), [...(grouped.get(norm(page.title)) ?? []), page]);
    for (const group of grouped.values()) if (group.length > 1) for (const page of group) add('DUPLICATE_TITLE', page, page.file, `标题“${page.title}”规范化后与 ${group.length - 1} 个页面重复。`);
    for (const audit of await this.audits.list({ status: 'open' })) { const page = pages.find(p => p.id === audit.wikiId); add('OPEN_AUDIT', page, page?.file ?? path.join(this.root, 'knowledge', 'audit', `${audit.id}.json`), `Audit ${audit.id} 尚未处理：${audit.comment}`); }
    return { generatedAt: new Date().toISOString(), wikiFilesSha256: hash((await Promise.all(files.map(f => readFile(f)))).map(b => b.toString('base64')).join('|')), findings, summary: Object.fromEntries((['BROKEN_WIKI_LINK','ORPHAN_WIKI','INDEX_MISSING','FRONTMATTER_MISSING','SOURCE_MISSING','KNOWLEDGE_STATUS_MISSING','CONFIDENCE_MISSING','SOURCE_LEVEL_MISSING','UNSOURCED_FACT','OPEN_AUDIT','DUPLICATE_TITLE'] as LintCode[]).map(code => [code, findings.filter(f => f.code === code).length])) };
  }
}
