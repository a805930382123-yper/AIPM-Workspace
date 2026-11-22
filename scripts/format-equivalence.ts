import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

export type SupportedExtension = '.ts' | '.tsx' | '.mts' | '.cts' | '.js' | '.jsx' | '.mjs' | '.cjs' | '.css' | '.json';

export type DiffStatusKind = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'OTHER';

export type DiffEntry = {
  status: string;
  kind: DiffStatusKind;
  path: string;
  oldPath?: string;
};

export type MismatchDiagnostic = {
  kind:
    | 'jsx-adjacent-whitespace-split'
    | 'tsx-semantic-diff'
    | 'css-custom-property-whitespace'
    | 'css-semantic-diff'
    | 'json-semantic-diff'
    | 'js-ts-semantic-diff'
    | 'transform-error';
  summary: string;
  spaceExprCount?: { before: number; after: number };
  classicJsxNormalizedEqual?: boolean;
  cssCustomPropNormalizedEqual?: boolean;
  firstDiffOffset?: number;
  beforeContext?: string;
  afterContext?: string;
};

export type FileEquivalenceResult = {
  path: string;
  ext: SupportedExtension;
  matched: boolean;
  beforeSha256: string | null;
  afterSha256: string | null;
  beforeBytes: number;
  afterBytes: number;
  diagnostic?: MismatchDiagnostic;
};

export type EquivalenceSummary = {
  total: number;
  matched: number;
  mismatched: number;
  mismatches: FileEquivalenceResult[];
};

export type ExtensionBreakdown = Record<string, { total: number; matched: number; mismatched: number }>;

export type EquivalenceReport = {
  ok: boolean;
  mode: 'git-refs' | 'worktree';
  base: string;
  target: string;
  diffStats: {
    modified: number;
    added: number;
    deleted: number;
    renamed: number;
    copied: number;
    other: number;
  };
  structuralOk: boolean;
  structuralErrors: string[];
  unsupportedModified: string[];
  skipped: {
    notInBase: string[];
    ignoredOrNonTarget: string[];
  };
  tsTsxSummary: EquivalenceSummary;
  allFilesSummary: EquivalenceSummary & {
    byExtension: ExtensionBreakdown;
  };
  files: FileEquivalenceResult[];
};

const F1_IGNORED_PREFIXES = [
  'docs/',
  'workspace/',
  'dist/',
  'node_modules/',
  'evals/',
  'rules/',
  'tests/acceptance/',
  'tests/fixtures/',
  'public/',
  'THIRD_PARTY_LICENSES/',
  '.github/',
  '.githooks/',
  '.agents/',
  '.scratch/',
];

const F1_IGNORED_EXACT = new Set(['package-lock.json', 'AGENTS.md', 'README.md', 'DESIGN.md', 'index.html']);

const F1_IGNORED_EXTENSIONS = new Set(['.tsbuildinfo', '.ps1', '.py', '.pdf', '.docx', '.png', '.txt']);

const SUPPORTED_EXTENSIONS = new Set<SupportedExtension>([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.json',
]);

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function getSupportedExtension(filePath: string): SupportedExtension | null {
  const ext = path.posix.extname(toPosixPath(filePath)).toLowerCase() as SupportedExtension;
  return SUPPORTED_EXTENSIONS.has(ext) ? ext : null;
}

export function isIgnoredForF1(filePath: string): boolean {
  const normalized = toPosixPath(filePath).replace(/^\.\//, '');
  if (F1_IGNORED_EXACT.has(normalized)) return true;
  if (F1_IGNORED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  const firstSegment = normalized.split('/')[0] ?? '';
  if (
    firstSegment.startsWith('.scratch-') ||
    firstSegment.startsWith('.test-') ||
    firstSegment.startsWith('.rn-') ||
    firstSegment.startsWith('.env') ||
    firstSegment.startsWith('.git')
  ) {
    return true;
  }
  const base = path.posix.basename(normalized);
  if (base.startsWith('.env') || base.startsWith('.git')) return true;
  const ext = path.posix.extname(base).toLowerCase();
  return F1_IGNORED_EXTENSIONS.has(ext);
}

function transformPrimary(source: string, ext: SupportedExtension, filePath: string): string {
  if (ext === '.json') {
    return JSON.stringify(JSON.parse(source));
  }
  if (ext === '.css') {
    return transformSync(source, {
      loader: 'css',
      minify: true,
      sourcefile: filePath,
    }).code;
  }
  const loader =
    ext === '.tsx' ? 'tsx' : ext === '.ts' || ext === '.mts' || ext === '.cts' ? 'ts' : ext === '.jsx' ? 'jsx' : 'js';
  const result = transformSync(source, {
    loader,
    jsx: loader === 'tsx' || loader === 'jsx' ? 'automatic' : undefined,
    minify: true,
    target: 'esnext',
    format: 'esm',
    sourcefile: filePath,
  });
  return result.code;
}

function findFirstDiff(
  beforeOut: string,
  afterOut: string,
): { offset: number; beforeContext: string; afterContext: string } {
  let offset = 0;
  while (offset < beforeOut.length && offset < afterOut.length && beforeOut[offset] === afterOut[offset]) {
    offset++;
  }
  const start = Math.max(0, offset - 40);
  const end = offset + 80;
  return {
    offset,
    beforeContext: beforeOut.slice(start, end),
    afterContext: afterOut.slice(start, end),
  };
}

function countJsxSpaceExpressions(source: string): number {
  const matches = source.match(/\{['"] ['"]\}/g);
  return matches ? matches.length : 0;
}

function normalizeClassicJsxOutput(code: string): string {
  // Collapse multi-space-only JSX child tokens (e.g. from single-line inter-tag indentation) and merge adjacent strings.
  let current = code.replace(/," {2,}",/g, '," ",').replace(/," {2,}"\)/g, '," ")');
  let previous = '';
  while (current !== previous) {
    previous = current;
    current = current.replace(/"((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"/g, '"$1$2"');
  }
  return current;
}

function transformClassicJsx(source: string, loader: 'tsx' | 'jsx', filePath: string): string {
  return normalizeClassicJsxOutput(
    transformSync(source, {
      loader,
      jsx: 'transform',
      minify: true,
      target: 'esnext',
      format: 'esm',
      sourcefile: filePath,
    }).code,
  );
}

function diagnoseMismatch(
  filePath: string,
  ext: SupportedExtension,
  beforeSource: string,
  afterSource: string,
  beforeOut: string,
  afterOut: string,
): MismatchDiagnostic {
  const diff = findFirstDiff(beforeOut, afterOut);

  if (ext === '.tsx' || ext === '.jsx') {
    const loader = ext === '.tsx' ? 'tsx' : 'jsx';
    const classicEqual =
      transformClassicJsx(beforeSource, loader, filePath) === transformClassicJsx(afterSource, loader, filePath);
    const spaceExprCount = {
      before: countJsxSpaceExpressions(beforeSource),
      after: countJsxSpaceExpressions(afterSource),
    };
    return {
      kind: classicEqual ? 'jsx-adjacent-whitespace-split' : 'tsx-semantic-diff',
      summary: classicEqual
        ? `Strict jsx:automatic output differs only in JSX adjacent-text/whitespace splitting (classic JSX normalized match; {' '} count ${spaceExprCount.before} -> ${spaceExprCount.after}).`
        : 'Primary esbuild output differs and is NOT explained solely by JSX adjacent-text/whitespace splitting.',
      spaceExprCount,
      classicJsxNormalizedEqual: classicEqual,
      firstDiffOffset: diff.offset,
      beforeContext: diff.beforeContext,
      afterContext: diff.afterContext,
    };
  }

  if (ext === '.css') {
    const normalizeCssCustomProps = (css: string) =>
      css.replace(/(--[a-zA-Z0-9_-]+):\s+/g, '$1:').replace(/var\((--[a-zA-Z0-9_-]+),\s+/g, 'var($1,');
    const cssNormalizedEqual = normalizeCssCustomProps(beforeOut) === normalizeCssCustomProps(afterOut);
    return {
      kind: cssNormalizedEqual ? 'css-custom-property-whitespace' : 'css-semantic-diff',
      summary: cssNormalizedEqual
        ? 'Minified CSS differs only in token whitespace after custom-property colons or var() fallback commas.'
        : 'Minified CSS differs beyond custom-property/var() token whitespace.',
      cssCustomPropNormalizedEqual: cssNormalizedEqual,
      firstDiffOffset: diff.offset,
      beforeContext: diff.beforeContext,
      afterContext: diff.afterContext,
    };
  }

  if (ext === '.json') {
    return {
      kind: 'json-semantic-diff',
      summary: 'Canonical JSON serialization (JSON.stringify(JSON.parse(...))) differs.',
      firstDiffOffset: diff.offset,
      beforeContext: diff.beforeContext,
      afterContext: diff.afterContext,
    };
  }

  return {
    kind: 'js-ts-semantic-diff',
    summary: 'Minified esbuild JS/TS output differs.',
    firstDiffOffset: diff.offset,
    beforeContext: diff.beforeContext,
    afterContext: diff.afterContext,
  };
}

export function compareFileContents(
  filePath: string,
  beforeSource: string,
  afterSource: string,
): FileEquivalenceResult {
  const ext = getSupportedExtension(filePath);
  if (!ext) {
    throw new Error(`Unsupported file extension for equivalence check: ${filePath}`);
  }
  const beforeBytes = Buffer.byteLength(beforeSource, 'utf8');
  const afterBytes = Buffer.byteLength(afterSource, 'utf8');

  let beforeOut: string;
  let afterOut: string;
  try {
    beforeOut = transformPrimary(beforeSource, ext, filePath);
    afterOut = transformPrimary(afterSource, ext, filePath);
  } catch (error) {
    return {
      path: toPosixPath(filePath),
      ext,
      matched: false,
      beforeSha256: null,
      afterSha256: null,
      beforeBytes,
      afterBytes,
      diagnostic: {
        kind: 'transform-error',
        summary: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const beforeSha256 = sha256Hex(beforeOut);
  const afterSha256 = sha256Hex(afterOut);
  const matched = beforeSha256 === afterSha256;

  return {
    path: toPosixPath(filePath),
    ext,
    matched,
    beforeSha256,
    afterSha256,
    beforeBytes,
    afterBytes,
    ...(matched
      ? {}
      : {
          diagnostic: diagnoseMismatch(filePath, ext, beforeSource, afterSource, beforeOut, afterOut),
        }),
  };
}

function runGit(rootDir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function classifyStatusKind(status: string): DiffStatusKind {
  if (status === 'M') return 'M';
  if (status === 'A') return 'A';
  if (status === 'D') return 'D';
  if (status.startsWith('R')) return 'R';
  if (status.startsWith('C')) return 'C';
  if (status === 'T') return 'T';
  return 'OTHER';
}

function parseDiffNameStatusZ(raw: string): DiffEntry[] {
  const tokens = raw.split('\0');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') {
    tokens.pop();
  }
  const entries: DiffEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const status = tokens[index++];
    if (!status) continue;
    const kind = classifyStatusKind(status);
    if (kind === 'R' || kind === 'C') {
      const oldPath = toPosixPath(tokens[index++] ?? '');
      const newPath = toPosixPath(tokens[index++] ?? '');
      entries.push({ status, kind, oldPath, path: newPath });
    } else {
      const filePath = toPosixPath(tokens[index++] ?? '');
      entries.push({ status, kind, path: filePath });
    }
  }
  return entries;
}

function listUntrackedFiles(rootDir: string): string[] {
  const raw = runGit(rootDir, ['ls-files', '--others', '--exclude-standard', '-z']);
  return raw.split('\0').filter(Boolean).map(toPosixPath);
}

function readGitBlob(rootDir: string, ref: string, filePath: string): string {
  return runGit(rootDir, ['show', `${ref}:${toPosixPath(filePath)}`]);
}

function doesGitPathExist(rootDir: string, ref: string, filePath: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}:${toPosixPath(filePath)}`], {
      cwd: rootDir,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export type CheckEquivalenceOptions = {
  rootDir?: string;
  base?: string;
  target?: string;
  files?: string[];
};

export function checkEquivalence(options: CheckEquivalenceOptions = {}): EquivalenceReport {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const base = options.base ?? 'HEAD';
  const target = options.target;
  const mode: 'git-refs' | 'worktree' = target ? 'git-refs' : 'worktree';

  // Verify base (and target if provided) resolve cleanly before inspecting diff.
  runGit(rootDir, ['rev-parse', '--verify', `${base}^{commit}`]);
  if (target) {
    runGit(rootDir, ['rev-parse', '--verify', `${target}^{commit}`]);
  }

  const diffArgs = target
    ? ['diff', '--name-status', '--find-renames', '-z', base, target]
    : ['diff', '--name-status', '--find-renames', '-z', base];
  const entries = parseDiffNameStatusZ(runGit(rootDir, diffArgs));

  const diffStats = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    other: 0,
  };
  for (const entry of entries) {
    if (entry.kind === 'M') diffStats.modified++;
    else if (entry.kind === 'A') diffStats.added++;
    else if (entry.kind === 'D') diffStats.deleted++;
    else if (entry.kind === 'R') diffStats.renamed++;
    else if (entry.kind === 'C') diffStats.copied++;
    else diffStats.other++;
  }

  const structuralErrors: string[] = [];
  if (diffStats.added > 0) structuralErrors.push(`Added files count must be 0, found ${diffStats.added}.`);
  if (diffStats.deleted > 0) structuralErrors.push(`Deleted files count must be 0, found ${diffStats.deleted}.`);
  if (diffStats.renamed > 0) structuralErrors.push(`Renamed files count must be 0, found ${diffStats.renamed}.`);
  if (diffStats.copied > 0) structuralErrors.push(`Copied files count must be 0, found ${diffStats.copied}.`);
  if (diffStats.other > 0) structuralErrors.push(`Unexpected diff entry types found: ${diffStats.other}.`);

  const skippedNotInBase: string[] = [];
  const skippedIgnoredOrNonTarget: string[] = [];
  const unsupportedModified: string[] = [];
  const targets: string[] = [];

  if (options.files && options.files.length > 0) {
    for (const rawFile of options.files) {
      const normalized = toPosixPath(rawFile).replace(/^\.\//, '');
      if (isIgnoredForF1(normalized) || !getSupportedExtension(normalized)) {
        skippedIgnoredOrNonTarget.push(normalized);
        continue;
      }
      if (!doesGitPathExist(rootDir, base, normalized)) {
        skippedNotInBase.push(normalized);
        continue;
      }
      targets.push(normalized);
    }
  } else {
    for (const entry of entries) {
      if (entry.kind !== 'M') continue;
      const ext = getSupportedExtension(entry.path);
      const ignored = isIgnoredForF1(entry.path);
      if (ignored || !ext) {
        if (mode === 'git-refs') {
          unsupportedModified.push(entry.path);
        } else {
          skippedIgnoredOrNonTarget.push(entry.path);
        }
        continue;
      }
      targets.push(entry.path);
    }

    if (mode === 'worktree') {
      for (const untracked of listUntrackedFiles(rootDir)) {
        if (!doesGitPathExist(rootDir, base, untracked)) {
          skippedNotInBase.push(untracked);
        }
      }
    }
  }

  targets.sort((a, b) => a.localeCompare(b, 'en'));

  const results: FileEquivalenceResult[] = [];
  for (const filePath of targets) {
    const beforeSource = readGitBlob(rootDir, base, filePath);
    const afterSource = target
      ? readGitBlob(rootDir, target, filePath)
      : readFileSync(path.join(rootDir, ...filePath.split('/')), 'utf8');
    results.push(compareFileContents(filePath, beforeSource, afterSource));
  }

  const tsTsxResults = results.filter((r) => r.ext === '.ts' || r.ext === '.tsx');
  const tsTsxMismatches = tsTsxResults.filter((r) => !r.matched);
  const allMismatches = results.filter((r) => !r.matched);

  const byExtension: ExtensionBreakdown = {};
  for (const r of results) {
    if (!byExtension[r.ext]) {
      byExtension[r.ext] = { total: 0, matched: 0, mismatched: 0 };
    }
    byExtension[r.ext]!.total++;
    if (r.matched) byExtension[r.ext]!.matched++;
    else byExtension[r.ext]!.mismatched++;
  }

  const structuralOk = structuralErrors.length === 0;
  const ok = structuralOk && unsupportedModified.length === 0 && allMismatches.length === 0;

  return {
    ok,
    mode,
    base,
    target: target ?? 'WORKTREE',
    diffStats,
    structuralOk,
    structuralErrors,
    unsupportedModified,
    skipped: {
      notInBase: skippedNotInBase.sort((a, b) => a.localeCompare(b, 'en')),
      ignoredOrNonTarget: skippedIgnoredOrNonTarget.sort((a, b) => a.localeCompare(b, 'en')),
    },
    tsTsxSummary: {
      total: tsTsxResults.length,
      matched: tsTsxResults.length - tsTsxMismatches.length,
      mismatched: tsTsxMismatches.length,
      mismatches: tsTsxMismatches,
    },
    allFilesSummary: {
      total: results.length,
      matched: results.length - allMismatches.length,
      mismatched: allMismatches.length,
      byExtension,
      mismatches: allMismatches,
    },
    files: results,
  };
}

export type ParsedCliArgs = {
  help: boolean;
  json: boolean;
  base?: string;
  target?: string;
  commit?: string;
  files: string[];
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = { help: false, json: false, files: [] };

  const readOptionValue = (flag: string, index: number): string => {
    const next = argv[index + 1];
    if (!next || next.startsWith('-')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--base') {
      parsed.base = readOptionValue(arg, i++);
    } else if (arg === '--target') {
      parsed.target = readOptionValue(arg, i++);
    } else if (arg === '--commit') {
      parsed.commit = readOptionValue(arg, i++);
    } else if (arg === '--file') {
      parsed.files.push(readOptionValue(arg, i++));
    } else if (arg === '--files') {
      const value = readOptionValue(arg, i++);
      for (const item of value.split(',')) {
        const trimmed = item.trim();
        if (trimmed) parsed.files.push(trimmed);
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.commit && (parsed.base || parsed.target)) {
    throw new Error('--commit cannot be combined with --base or --target.');
  }

  return parsed;
}

function formatTextReport(report: EquivalenceReport): string {
  const lines: string[] = [];
  lines.push(`Format Equivalence Check (${report.mode}): base=${report.base}, target=${report.target}`);
  lines.push(
    `Diff stats: M=${report.diffStats.modified}, A=${report.diffStats.added}, D=${report.diffStats.deleted}, R=${report.diffStats.renamed}, C=${report.diffStats.copied}, other=${report.diffStats.other}`,
  );
  if (report.structuralErrors.length > 0) {
    lines.push('Structural errors:');
    for (const err of report.structuralErrors) lines.push(`  - ${err}`);
  }
  if (report.unsupportedModified.length > 0) {
    lines.push(`Unsupported modified files in ref diff (${report.unsupportedModified.length}):`);
    for (const file of report.unsupportedModified) lines.push(`  - ${file}`);
  }
  if (report.skipped.notInBase.length > 0) {
    lines.push(
      `Skipped untracked / not in base (${report.skipped.notInBase.length}): ${report.skipped.notInBase.join(', ')}`,
    );
  }
  if (report.skipped.ignoredOrNonTarget.length > 0) {
    lines.push(
      `Skipped ignored or non-F1 files (${report.skipped.ignoredOrNonTarget.length}): ${report.skipped.ignoredOrNonTarget.join(', ')}`,
    );
  }
  lines.push(
    `.ts/.tsx summary: total=${report.tsTsxSummary.total}, matched=${report.tsTsxSummary.matched}, mismatched=${report.tsTsxSummary.mismatched}`,
  );
  lines.push(
    `All F1 files summary: total=${report.allFilesSummary.total}, matched=${report.allFilesSummary.matched}, mismatched=${report.allFilesSummary.mismatched}`,
  );
  const extSummary = Object.entries(report.allFilesSummary.byExtension)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([ext, stats]) => `${ext}: ${stats.matched}/${stats.total}`)
    .join(', ');
  if (extSummary) {
    lines.push(`By extension: ${extSummary}`);
  }
  if (report.allFilesSummary.mismatches.length > 0) {
    lines.push('Mismatch details:');
    for (const item of report.allFilesSummary.mismatches) {
      lines.push(
        `  - ${item.path} (${item.ext}) before=${item.beforeSha256 ?? 'null'} after=${item.afterSha256 ?? 'null'}`,
      );
      if (item.diagnostic) {
        lines.push(`    diagnostic [${item.diagnostic.kind}]: ${item.diagnostic.summary}`);
      }
    }
  }
  lines.push(`Verdict: ${report.ok ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main(): void {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(
      'Usage: node --import tsx scripts/format-equivalence.ts [--base <ref>] [--target <ref>] [--commit <sha>] [--files <p1,p2>] [--json]',
    );
    return;
  }

  const base = cli.commit ? `${cli.commit}^` : (cli.base ?? 'HEAD');
  const target = cli.commit ? cli.commit : cli.target;
  const report = checkEquivalence({
    base,
    target,
    files: cli.files.length > 0 ? cli.files : undefined,
  });

  if (cli.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report));
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (isExecutedDirectly()) {
  try {
    main();
  } catch (error) {
    console.error(`format-equivalence ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
