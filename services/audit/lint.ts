import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { RawStore } from '../raw/store.ts';
import type { AuditService } from './service.ts';

export type LintCode = 'BROKEN_WIKI_LINK' | 'ORPHAN_WIKI' | 'INDEX_MISSING' | 'FRONTMATTER_MISSING' | 'SOURCE_MISSING' | 'KNOWLEDGE_STATUS_MISSING' | 'CONFIDENCE_MISSING' | 'SOURCE_LEVEL_MISSING' | 'UNSOURCED_FACT' | 'OPEN_AUDIT' | 'DUPLICATE_TITLE';
export type LintFinding = { code: LintCode; objectId: string | null; file: string; message: string; location: { line: number; column?: number; text?: string } };
type Page = { id: string; title: string; aliases: string[]; type: string; sources: string[]; body: string; bodyOffset: number; text: string; file: string; front: Record<string, unknown> | null };
const linkRe = /\[\[([^\]]+)\]\]/gu;
const norm = (s: string) => s.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s_\-·、，,。.；;：:（）()【】\[\]]+/gu, '');
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function evidenceMatches(rawBody: string, start: number, end: number, displayedQuote?: string) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > rawBody.length) return false;
  const excerpt = rawBody.slice(start, end);
  if (!displayedQuote) return Boolean(excerpt);
  if (excerpt === displayedQuote) return true;
  // B04 displays a 90-character prefix plus an ellipsis while offsets retain the full Raw span.
  return displayedQuote.length === 91 && displayedQuote.endsWith('…') && excerpt.length > 90 && excerpt.slice(0, 90) === displayedQuote.slice(0, 90);
}
function substantiveFacts(section: string, baseOffset: number) {
  const facts: Array<{ text: string; offset: number }> = [];
  let paragraph: string[] = []; let paragraphOffset = 0; let offset = 0;
  const flush = () => { const text = paragraph.join(' ').trim(); if (text) facts.push({ text, offset: paragraphOffset }); paragraph = []; };
  for (const line of section.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const breakLength = section.startsWith('\r\n', offset + line.length) ? 2 : 1;
    if (!trimmed) { flush(); offset += line.length + breakLength; continue; }
    const listItem = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    const lineOffset = baseOffset + offset;
    if (listItem) {
      flush(); const text = listItem[1]!.trim();
      if (text) facts.push({ text, offset: lineOffset + line.indexOf(listItem[1]!) });
    } else if (/^(?:待确认(?:[:：]|\b)|暂无(?:$|[。！!])|无(?:$|[。！!])|N\/?A$)/i.test(trimmed)) {
      flush();
    } else {
      if (!paragraph.length) paragraphOffset = lineOffset + line.indexOf(trimmed);
      paragraph.push(trimmed);
    }
    offset += line.length + breakLength;
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
    const add = (code: LintCode, page: Page | undefined, file: string, message: string, text: string, offset = 0) => {
      const absoluteOffset = page && text === page.body ? page.bodyOffset + offset : offset;
      const fileText = page?.text ?? text;
      findings.push({ code, objectId: page?.id ?? null, file: path.relative(this.root, file).replace(/\\/g, '/'), message, location: { line: lineAt(fileText, absoluteOffset), ...(fileText ? { text: fileText.slice(absoluteOffset, absoluteOffset + 100).split('\n')[0] } : {}) } });
    };
    const names = new Map<string, Page[]>();
    for (const page of pages) for (const name of [page.title, ...page.aliases, page.id]) { const key = norm(name); names.set(key, [...(names.get(key) ?? []), page]); }
    const outgoing = new Map<string, number>(); const incoming = new Set<string>();
    for (const page of pages) {
      const textForLinks = page.body; let match: RegExpExecArray | null;
      while ((match = linkRe.exec(textForLinks))) {
        const rawTarget = match[1]!.split(/[|#]/, 1)[0]!.trim(); const candidates = [...new Set([...(names.get(norm(rawTarget)) ?? []), ...(names.get(norm(path.basename(rawTarget))) ?? [])])];
        if (/^raw:/i.test(rawTarget)) continue;
        if (candidates.length !== 1) add('BROKEN_WIKI_LINK', page, page.file, candidates.length ? `Wiki 链接“${rawTarget}”匹配到多个页面。` : `Wiki 链接“${rawTarget}”没有目标页面。`, textForLinks, match.index);
        else { outgoing.set(page.id, (outgoing.get(page.id) ?? 0) + 1); incoming.add(candidates[0]!.id); }
      }
    }
    for (const page of pages) {
      const fileText = page.text;
      if (!page.front) add('FRONTMATTER_MISSING', page, page.file, '页面缺少或无法解析 YAML Frontmatter。', fileText, 0);
      for (const key of ['knowledge_status', 'confidence', 'source_level'] as const) if (typeof page.front?.[key] !== 'string' || !String(page.front[key]).trim()) {
        const code: LintCode = key === 'knowledge_status' ? 'KNOWLEDGE_STATUS_MISSING' : key === 'confidence' ? 'CONFIDENCE_MISSING' : 'SOURCE_LEVEL_MISSING'; add(code, page, page.file, `Frontmatter 缺少 ${key}。`, fileText, 0);
      }
      const validRawIds: string[] = [];
      for (const rawId of page.sources) if (await this.raws.get(rawId)) validRawIds.push(rawId);
      if (!page.sources.length || validRawIds.length !== page.sources.length) add('SOURCE_MISSING', page, page.file, !page.sources.length ? 'sources 为空或缺失。' : '一个或多个 sources 未映射到现存 Raw。', fileText, Math.max(0, fileText.indexOf('sources:')));
      if (['verified', 'source_supported'].includes(String(page.front?.knowledge_status)) && !validRawIds.length) add('UNSOURCED_FACT', page, page.file, '页面声明来源支持/已验证，但没有有效 Raw 来源。', fileText, 0);
      const sectionHeader = /^(#{1,6})\s*(来源事实|Source Facts)\s*$/m.exec(page.body);
      if (sectionHeader) {
        const sectionStart = sectionHeader.index + sectionHeader[0].length + (page.body[sectionHeader.index + sectionHeader[0].length] === '\r' ? 2 : 1);
        const sectionTail = page.body.slice(sectionStart); const sectionEnd = sectionTail.search(/^#{1,6}\s/m); const sectionText = sectionEnd < 0 ? sectionTail : sectionTail.slice(0, sectionEnd);
        const evidenceHeader = /^(#{1,6})\s*(来源证据|Source Evidence)\s*$/m.exec(page.body);
        let evidenceSection = '';
        if (evidenceHeader) { const start = evidenceHeader.index + evidenceHeader[0].length + (page.body[evidenceHeader.index + evidenceHeader[0].length] === '\r' ? 2 : 1); const tail = page.body.slice(start); const end = tail.search(/^#{1,6}\s/m); evidenceSection = end < 0 ? tail : tail.slice(0, end); }
        const evidenceById = new Map<string, {quote:string;start:number;end:number}>();
        for (const line of evidenceSection.split(/\r?\n/)) {
          const evidence = /^\s*[-*]\s*([^｜|\s]+)\s*[｜|]\s*原文\s*\[(\d+)\s*,\s*(\d+)\)\s*[：:]\s*(.*?)\s*$/.exec(line);
          if (evidence) evidenceById.set(evidence[1]!, { quote: evidence[4]!, start: Number(evidence[2]), end: Number(evidence[3]) });
        }
        const rawBodies = new Map<string, string>();
        for (const rawId of validRawIds) { const raw = await this.raws.get(rawId); if (raw) rawBodies.set(rawId, raw.body); }
        for (const fact of substantiveFacts(sectionText, sectionStart)) {
          const refs = [...fact.text.matchAll(/[（(]证据\s+([^）)]+)[）)]/gu)].flatMap(m => m[1]!.split(/[、,，\s]+/u)).filter(Boolean);
          const inline = /\[\[raw:([0-9a-f-]{36})\]\]\s*[“"]([^”"]{2,})[”"]/i.exec(fact.text);
          const coordinateRefs = [...fact.text.matchAll(/来源\s*Raw\s+([0-9a-f-]{36})[^\n]*?原文\s*\[(\d+)\s*,\s*(\d+)\)(?:[：:]\s*[“"]?([^”"]+)[”"]?)?/gi)];
          const located = inline ? Boolean(rawBodies.get(inline[1]!)?.includes(inline[2]!))
            : coordinateRefs.some(ref => { const rawBody = rawBodies.get(ref[1]!); return Boolean(rawBody && evidenceMatches(rawBody, Number(ref[2]), Number(ref[3]), ref[4]?.trim())); })
              || refs.some(ref => { const evidence = evidenceById.get(ref); if (!evidence) return false; return [...rawBodies.values()].some(rawBody => evidenceMatches(rawBody, evidence.start, evidence.end, evidence.quote)); });
          if (!located) add('UNSOURCED_FACT', page, page.file, '“来源事实”中的该条陈述没有可在有效 Raw 中定位的证据引用。', page.body, fact.offset);
        }
      }
    }
    const indexText = await readFile(indexFile, 'utf8').catch(() => '');
    if (!indexText) {
      for (const page of pages) add('INDEX_MISSING', page, page.file, '知识 Index 文件缺失或为空，页面未被收录。', page.text, 0);
    } else for (const page of pages) {
      const listed = indexText.includes(page.id) || [...page.aliases, page.title].some(name => [...indexText.matchAll(linkRe)].some(m => norm(m[1]!.split(/[|#]/, 1)[0]!.trim()) === norm(name)));
      if (!listed) add('INDEX_MISSING', page, page.file, '页面没有出现在 knowledge/wiki/index.md。', page.text, 0);
    }
    for (const page of pages) if (page.type !== 'source' && !incoming.has(page.id) && !(outgoing.get(page.id) ?? 0)) add('ORPHAN_WIKI', page, page.file, '非 Source 页面没有有效入链或出链。', page.text, 0);
    const grouped = new Map<string, Page[]>(); for (const page of pages) grouped.set(norm(page.title), [...(grouped.get(norm(page.title)) ?? []), page]);
    for (const group of grouped.values()) if (group.length > 1) for (const page of group) add('DUPLICATE_TITLE', page, page.file, `标题“${page.title}”规范化后与 ${group.length - 1} 个页面重复。`, page.text, 0);
    for (const audit of await this.audits.list({ status: 'open' })) { const page = pages.find(p => p.id === audit.wikiId); add('OPEN_AUDIT', page, page?.file ?? path.join(this.root, 'knowledge', 'audit', `${audit.id}.json`), `Audit ${audit.id} 尚未处理：${audit.comment}`, page?.text ?? '', 0); }
    return { generatedAt: new Date().toISOString(), wikiFilesSha256: hash((await Promise.all(files.map(f => readFile(f)))).map(b => b.toString('base64')).join('|')), findings, summary: Object.fromEntries((['BROKEN_WIKI_LINK','ORPHAN_WIKI','INDEX_MISSING','FRONTMATTER_MISSING','SOURCE_MISSING','KNOWLEDGE_STATUS_MISSING','CONFIDENCE_MISSING','SOURCE_LEVEL_MISSING','UNSOURCED_FACT','OPEN_AUDIT','DUPLICATE_TITLE'] as LintCode[]).map(code => [code, findings.filter(f => f.code === code).length])) };
  }
}
