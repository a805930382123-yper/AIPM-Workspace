import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

type LegacyEntry = { id: number; target: string; action: string; sha256: string };
type LegacyDoc = { source: string; sha256: string; blocks: number; report: LegacyEntry[] };

export type Eng03ArchiveBlock = {
  id: number;
  heading: string;
  action: 'keep' | 'move';
  target: string;
  length?: number;
  bytes: number;
  sha256: string;
};

export type Eng03ArchiveDoc = {
  schema: 'eng03';
  source: string;
  bytes: number;
  sha256: string;
  blocks: number;
  report: Eng03ArchiveBlock[];
};

const START_ANCHOR = '<!-- ENG03 inserted:start -->';
const END_ANCHOR = '<!-- ENG03 inserted:end -->';

function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function stripEng03Insertions(lfText: string, docName: string): string {
  let cursor = 0;
  let result = '';

  while (cursor < lfText.length) {
    const startIdx = lfText.indexOf(START_ANCHOR, cursor);
    const strayEndIdx = lfText.indexOf(END_ANCHOR, cursor);

    if (strayEndIdx >= 0 && (startIdx < 0 || strayEndIdx < startIdx)) {
      throw new Error(`Unmatched ${END_ANCHOR} in ${docName} at offset ${strayEndIdx}`);
    }
    if (startIdx < 0) {
      result += lfText.slice(cursor);
      break;
    }

    const afterStart = startIdx + START_ANCHOR.length;
    const endIdx = lfText.indexOf(END_ANCHOR, afterStart);
    if (endIdx < 0) {
      throw new Error(`Unclosed ${START_ANCHOR} in ${docName} at offset ${startIdx}`);
    }
    const nestedStart = lfText.indexOf(START_ANCHOR, afterStart);
    if (nestedStart >= 0 && nestedStart < endIdx) {
      throw new Error(`Nested ${START_ANCHOR} in ${docName} at offset ${nestedStart}`);
    }

    const isBlockStart = (startIdx === 0 || lfText[startIdx - 1] === '\n') && lfText[afterStart] === '\n';
    const afterEnd = endIdx + END_ANCHOR.length;
    const isBlockEnd = lfText[endIdx - 1] === '\n' && (afterEnd === lfText.length || lfText[afterEnd] === '\n');

    result += lfText.slice(cursor, startIdx);
    if (isBlockStart && isBlockEnd) {
      cursor = afterEnd < lfText.length && lfText[afterEnd] === '\n' ? afterEnd + 1 : afterEnd;
    } else if (!lfText.slice(startIdx, afterEnd).includes('\n')) {
      cursor = afterEnd;
    } else {
      throw new Error(
        `Invalid ENG03 anchor placement in ${docName} at ${startIdx}..${endIdx}: multiline insertions must place anchors on their own lines.`,
      );
    }
  }

  return result;
}

export function undoArchivedLinks(text: string): string {
  const lines = text.split('\n');
  let fenced = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line.replace(
        /(\]\(\s*)(?:<([^>]+)>|([^\s)]+))/g,
        (match, prefix: string, angled: string | undefined, plain: string | undefined) => {
          const url = angled ?? plain ?? '';
          if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(url)) return match;
          if (!url.startsWith('../')) {
            throw new Error(`Unexpected archived relative link without ../ prefix: ${url}`);
          }
          const restored = url.slice(3);
          return angled !== undefined ? `${prefix}<${restored}>` : `${prefix}${restored}`;
        },
      );
    })
    .join('\n');
}

function verifyLegacy(base: string, manifest: LegacyDoc[]): void {
  for (const doc of manifest) {
    const name = path.basename(doc.source, '.md');
    const source = readFileSync(path.join(base, name + '.md'), 'utf8');
    const marker = `<!-- ENG01 ${name}:`;
    const first = source.indexOf(marker);
    if (first < 0) throw new Error(`no marker ${name}`);
    let prefix = source.slice(0, first);
    const summary = prefix.indexOf('<!-- ENG01 summary -->');
    if (summary >= 0) prefix = prefix.slice(0, summary);
    let original = prefix;
    for (const entry of doc.report) {
      const contents = readFileSync(path.join(base, entry.target), 'utf8');
      const tag = `<!-- ENG01 ${name}:${entry.id} -->\n`;
      const start = contents.indexOf(tag);
      if (start < 0 || contents.indexOf(tag, start + tag.length) >= 0) {
        throw new Error(`missing/duplicate ${name}:${entry.id}`);
      }
      const from = start + tag.length;
      const next = contents.indexOf('<!-- ENG01 ', from);
      const part = contents.slice(from, next < 0 ? undefined : next);
      const restored = entry.action === 'move' ? undoArchivedLinks(part) : part;
      if (sha(restored) !== entry.sha256) throw new Error(`block mismatch ${name}:${entry.id}`);
      original += restored;
    }
    if (doc.report.length !== doc.blocks || sha(original) !== doc.sha256) {
      throw new Error(`document mismatch ${name}`);
    }
    console.log(`${name}: ${doc.blocks} blocks, reconstructed SHA-256 ${doc.sha256} OK`);
  }
}

function verifyEng03(base: string, manifest: Eng03ArchiveDoc[]): void {
  const archiveCache = new Map<string, string>();
  const archiveSeenBlocks = new Map<string, Set<number>>();

  for (const doc of manifest) {
    const name = path.basename(doc.source, '.md');
    const sourceLf = toLf(readFileSync(path.join(base, `${name}.md`), 'utf8'));
    const keptText = stripEng03Insertions(sourceLf, doc.source);

    let keptOffset = 0;
    let reconstructed = '';

    for (let i = 0; i < doc.report.length; i++) {
      const entry = doc.report[i]!;
      if (entry.id !== i) {
        throw new Error(`Non-sequential block id in ${doc.source}: expected ${i}, got ${entry.id}`);
      }

      if (entry.action === 'keep') {
        if (typeof entry.length !== 'number' || entry.length < 0) {
          throw new Error(`Missing length for keep block ${name}:${entry.id}`);
        }
        const slice = keptText.slice(keptOffset, keptOffset + entry.length);
        if (slice.length !== entry.length) {
          throw new Error(`Truncated keep block ${name}:${entry.id}`);
        }
        keptOffset += entry.length;
        const sliceBytes = Buffer.byteLength(slice, 'utf8');
        if (sliceBytes !== entry.bytes || sha(slice) !== entry.sha256) {
          throw new Error(
            `keep block mismatch ${name}:${entry.id} (expected sha=${entry.sha256} bytes=${entry.bytes}, actual sha=${sha(slice)} bytes=${sliceBytes})`,
          );
        }
        reconstructed += slice;
      } else if (entry.action === 'move') {
        const archiveKey = `${entry.target}\0${name}`;
        let archiveLf = archiveCache.get(entry.target);
        if (archiveLf === undefined) {
          archiveLf = toLf(readFileSync(path.join(base, entry.target), 'utf8'));
          archiveCache.set(entry.target, archiveLf);
        }
        if (!archiveSeenBlocks.has(archiveKey)) {
          archiveSeenBlocks.set(archiveKey, new Set());
        }

        const prefix = `<!-- ENG03 ${name}:`;
        const tag = `${prefix}${entry.id} -->\n`;
        const start = archiveLf.indexOf(tag);
        if (start < 0 || archiveLf.indexOf(tag, start + tag.length) >= 0) {
          throw new Error(`missing/duplicate archive tag ${name}:${entry.id} in ${entry.target}`);
        }
        archiveSeenBlocks.get(archiveKey)!.add(entry.id);

        const from = start + tag.length;
        const next = archiveLf.indexOf(prefix, from);
        const part = archiveLf.slice(from, next < 0 ? undefined : next);
        const restored = undoArchivedLinks(part);
        const restoredBytes = Buffer.byteLength(restored, 'utf8');
        if (restoredBytes !== entry.bytes || sha(restored) !== entry.sha256) {
          throw new Error(
            `move block mismatch ${name}:${entry.id} in ${entry.target} (expected sha=${entry.sha256} bytes=${entry.bytes}, actual sha=${sha(restored)} bytes=${restoredBytes})`,
          );
        }
        reconstructed += restored;
      } else {
        throw new Error(`Unknown action ${String(entry.action)} in ${doc.source}`);
      }
    }

    if (keptOffset !== keptText.length) {
      throw new Error(`Unaccounted kept text in ${doc.source}: consumed ${keptOffset} of ${keptText.length} chars`);
    }
    if (doc.report.length !== doc.blocks) {
      throw new Error(`Block count mismatch for ${doc.source}: ${doc.report.length} !== ${doc.blocks}`);
    }

    // Verify no extra unlisted ENG03 tags exist in any archive target used by this doc
    for (const [archiveKey, seenIds] of archiveSeenBlocks.entries()) {
      const [target, ownerName] = archiveKey.split('\0');
      if (ownerName !== name) continue;
      const archiveLf = archiveCache.get(target!)!;
      const re = new RegExp(`<!-- ENG03 ${name}:(\\d+) -->`, 'g');
      for (const match of archiveLf.matchAll(re)) {
        const foundId = Number(match[1]);
        if (!seenIds.has(foundId)) {
          throw new Error(`Extra unlisted block ${name}:${foundId} in ${target}`);
        }
      }
    }

    const totalBytes = Buffer.byteLength(reconstructed, 'utf8');
    if (totalBytes !== doc.bytes || sha(reconstructed) !== doc.sha256) {
      throw new Error(
        `Document mismatch ${name}: expected sha=${doc.sha256} bytes=${doc.bytes}, actual sha=${sha(reconstructed)} bytes=${totalBytes}`,
      );
    }

    console.log(`${name}: ${doc.blocks} blocks, ${totalBytes} bytes (LF), reconstructed SHA-256 ${doc.sha256} OK`);
  }
}

function resolveManifestArgs(argv: string[]): { base: string; manifestPath: string } {
  const arg = argv[2];
  if (!arg) {
    return { base: 'docs', manifestPath: path.join('docs', 'archive-manifest-eng03.json') };
  }
  const stat = statSync(arg, { throwIfNoEntry: false });
  if (stat?.isDirectory()) {
    return { base: arg, manifestPath: path.join(arg, 'archive-manifest-eng03.json') };
  }
  return { base: argv[3] ?? path.dirname(arg), manifestPath: arg };
}

function main(): void {
  const { base, manifestPath } = resolveManifestArgs(process.argv);
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<LegacyDoc | Eng03ArchiveDoc>;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Empty or invalid manifest: ${manifestPath}`);
  }
  if ('schema' in parsed[0]! && parsed[0]!.schema === 'eng03') {
    verifyEng03(base, parsed as Eng03ArchiveDoc[]);
  } else {
    verifyLegacy(base, parsed as LegacyDoc[]);
  }
}

main();
