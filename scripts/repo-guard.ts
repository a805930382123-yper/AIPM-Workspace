import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_GUARD_LIMITS = {
  trackedMaxBytes: 1_048_576, // 1 MiB
  reportsNonMdMaxBytes: 307_200, // 300 KiB
  ledgerLimits: {
    'docs/status.md': 24_576, // 24 KiB
    'docs/agent-control.md': 49_152, // 48 KiB
    'docs/acceptance.md': 49_152, // 48 KiB
  },
} as const;

export type AllowlistRule = 'reports-non-md-300kib';

export type AllowlistEntry = {
  path: string;
  rule: AllowlistRule;
  maxBytes?: number;
  reason: string;
};

export type AllowlistDocument = {
  schemaVersion?: number;
  policy?: string;
  entries: AllowlistEntry[];
};

export type GuardRuleId =
  | 'tracked-1mib'
  | 'reports-non-md-300kib'
  | 'ledger-status-24kib'
  | 'ledger-agent-control-48kib'
  | 'ledger-acceptance-48kib'
  | 'invalid-allowlist';

export type GuardViolation = {
  rule: GuardRuleId;
  path: string;
  bytes: number;
  limit: number;
  message: string;
};

export type GuardExempted = {
  path: string;
  bytes: number;
  reason: string;
};

export type RepoGuardOptions = {
  rootDir?: string;
  allowlistPath?: string;
  allowlist?: AllowlistDocument;
  listFiles?: (rootDir: string) => string[];
  statFile?: (absPath: string) => number | null;
  readFile?: (absPath: string) => string;
};

export type RepoGuardResult = {
  ok: boolean;
  checkedFiles: number;
  exemptedCount: number;
  exempted: GuardExempted[];
  violations: GuardViolation[];
  staleAllowlistEntries: string[];
};

const LEDGER_RULES: Record<keyof typeof REPO_GUARD_LIMITS.ledgerLimits, GuardRuleId> = {
  'docs/status.md': 'ledger-status-24kib',
  'docs/agent-control.md': 'ledger-agent-control-48kib',
  'docs/acceptance.md': 'ledger-acceptance-48kib',
};

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function defaultListGitFiles(rootDir: string): string[] {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const seen = new Set<string>();
  const files: string[] = [];
  for (const raw of stdout.split('\0')) {
    if (!raw) continue;
    const normalized = toPosixPath(raw);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      files.push(normalized);
    }
  }
  return files;
}

function defaultStatFile(absPath: string): number | null {
  try {
    return statSync(absPath).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function loadAllowlist(
  allowlistPath: string,
  readFile: (absPath: string) => string = (p) => readFileSync(p, 'utf8'),
): AllowlistDocument {
  let raw: string;
  try {
    raw = readFile(allowlistPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, entries: [] };
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as AllowlistDocument).entries)) {
    throw new Error(`Invalid allowlist structure in ${toPosixPath(allowlistPath)}: expected { entries: [...] }`);
  }
  return parsed as AllowlistDocument;
}

function validateAllowlist(
  doc: AllowlistDocument,
  violations: GuardViolation[],
): Map<string, AllowlistEntry> {
  const validEntries = new Map<string, AllowlistEntry>();
  const seenPaths = new Set<string>();

  for (const [index, entry] of doc.entries.entries()) {
    if (!entry || typeof entry !== 'object') {
      violations.push({
        rule: 'invalid-allowlist',
        path: `allowlist[${index}]`,
        bytes: 0,
        limit: 0,
        message: `Allowlist entry #${index} is not an object.`,
      });
      continue;
    }
    const normalizedPath = typeof entry.path === 'string' ? toPosixPath(entry.path.trim()) : '';
    if (!normalizedPath) {
      violations.push({
        rule: 'invalid-allowlist',
        path: `allowlist[${index}]`,
        bytes: 0,
        limit: 0,
        message: `Allowlist entry #${index} is missing a valid path.`,
      });
      continue;
    }
    if (seenPaths.has(normalizedPath)) {
      violations.push({
        rule: 'invalid-allowlist',
        path: normalizedPath,
        bytes: 0,
        limit: 0,
        message: `Duplicate allowlist entry for ${normalizedPath}.`,
      });
      continue;
    }
    seenPaths.add(normalizedPath);

    if (Object.hasOwn(REPO_GUARD_LIMITS.ledgerLimits, normalizedPath)) {
      violations.push({
        rule: 'invalid-allowlist',
        path: normalizedPath,
        bytes: 0,
        limit: REPO_GUARD_LIMITS.ledgerLimits[normalizedPath as keyof typeof REPO_GUARD_LIMITS.ledgerLimits],
        message: `Ledger document ${normalizedPath} cannot be added to allowlist.`,
      });
      continue;
    }

    if (entry.rule !== 'reports-non-md-300kib') {
      violations.push({
        rule: 'invalid-allowlist',
        path: normalizedPath,
        bytes: 0,
        limit: REPO_GUARD_LIMITS.reportsNonMdMaxBytes,
        message: `Allowlist entry ${normalizedPath} has unsupported or missing rule (${String(entry.rule)}).`,
      });
      continue;
    }

    if (!normalizedPath.startsWith('docs/reports/') || normalizedPath.endsWith('.md')) {
      violations.push({
        rule: 'invalid-allowlist',
        path: normalizedPath,
        bytes: 0,
        limit: REPO_GUARD_LIMITS.reportsNonMdMaxBytes,
        message: `Allowlist entry ${normalizedPath} does not match docs/reports/ non-Markdown rule.`,
      });
      continue;
    }

    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
      violations.push({
        rule: 'invalid-allowlist',
        path: normalizedPath,
        bytes: 0,
        limit: REPO_GUARD_LIMITS.reportsNonMdMaxBytes,
        message: `Allowlist entry ${normalizedPath} is missing a non-empty reason.`,
      });
      continue;
    }

    if (
      entry.maxBytes !== undefined &&
      (!Number.isInteger(entry.maxBytes) || entry.maxBytes <= 0 || entry.maxBytes > REPO_GUARD_LIMITS.trackedMaxBytes)
    ) {
      violations.push({
        rule: 'invalid-allowlist',
        path: normalizedPath,
        bytes: 0,
        limit: REPO_GUARD_LIMITS.trackedMaxBytes,
        message: `Allowlist entry ${normalizedPath} has invalid maxBytes (${String(entry.maxBytes)}).`,
      });
      continue;
    }

    validEntries.set(normalizedPath, {
      ...entry,
      path: normalizedPath,
      reason: entry.reason.trim(),
    });
  }

  return validEntries;
}

export function checkRepoGuard(options: RepoGuardOptions = {}): RepoGuardResult {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const allowlistPath = options.allowlistPath ?? path.join(rootDir, 'scripts', 'repo-guard-allowlist.json');
  const listFiles = options.listFiles ?? defaultListGitFiles;
  const statFile = options.statFile ?? defaultStatFile;
  const readFile = options.readFile ?? ((absPath: string) => readFileSync(absPath, 'utf8'));

  const violations: GuardViolation[] = [];
  const exempted: GuardExempted[] = [];

  let allowlistDoc: AllowlistDocument;
  try {
    allowlistDoc = options.allowlist ?? loadAllowlist(allowlistPath, readFile);
  } catch (error) {
    violations.push({
      rule: 'invalid-allowlist',
      path: toPosixPath(path.relative(rootDir, allowlistPath) || 'scripts/repo-guard-allowlist.json'),
      bytes: 0,
      limit: 0,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      checkedFiles: 0,
      exemptedCount: 0,
      exempted,
      violations,
      staleAllowlistEntries: [],
    };
  }

  const allowlistMap = validateAllowlist(allowlistDoc, violations);
  const usedAllowlistPaths = new Set<string>();
  const files = listFiles(rootDir).map(toPosixPath);
  let checkedFiles = 0;

  for (const file of files) {
    const absPath = path.join(rootDir, ...file.split('/'));
    const bytes = statFile(absPath);
    if (bytes === null) continue;
    checkedFiles++;

    if (Object.hasOwn(REPO_GUARD_LIMITS.ledgerLimits, file)) {
      const key = file as keyof typeof REPO_GUARD_LIMITS.ledgerLimits;
      const limit = REPO_GUARD_LIMITS.ledgerLimits[key];
      if (bytes > limit) {
        violations.push({
          rule: LEDGER_RULES[key],
          path: file,
          bytes,
          limit,
          message: `Ledger file ${file} is ${bytes} B, exceeding limit ${limit} B.`,
        });
      }
    }

    if (bytes > REPO_GUARD_LIMITS.trackedMaxBytes) {
      violations.push({
        rule: 'tracked-1mib',
        path: file,
        bytes,
        limit: REPO_GUARD_LIMITS.trackedMaxBytes,
        message: `Tracked file ${file} is ${bytes} B, exceeding 1 MiB (${REPO_GUARD_LIMITS.trackedMaxBytes} B) limit.`,
      });
      continue;
    }

    if (file.startsWith('docs/reports/') && !file.endsWith('.md') && bytes > REPO_GUARD_LIMITS.reportsNonMdMaxBytes) {
      const allowEntry = allowlistMap.get(file);
      const entryLimit = allowEntry?.maxBytes ?? REPO_GUARD_LIMITS.trackedMaxBytes;
      if (allowEntry && bytes <= entryLimit) {
        usedAllowlistPaths.add(file);
        exempted.push({ path: file, bytes, reason: allowEntry.reason });
      } else {
        violations.push({
          rule: 'reports-non-md-300kib',
          path: file,
          bytes,
          limit: REPO_GUARD_LIMITS.reportsNonMdMaxBytes,
          message: `Non-Markdown report file ${file} is ${bytes} B, exceeding 300 KiB (${REPO_GUARD_LIMITS.reportsNonMdMaxBytes} B) without valid allowlist exemption.`,
        });
      }
    }
  }

  const staleAllowlistEntries = [...allowlistMap.keys()].filter((p) => !usedAllowlistPaths.has(p));

  return {
    ok: violations.length === 0,
    checkedFiles,
    exemptedCount: exempted.length,
    exempted,
    violations,
    staleAllowlistEntries,
  };
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
  const result = checkRepoGuard();
  if (!result.ok) {
    console.error(`repo-guard FAILED (${result.violations.length} violation(s), checked ${result.checkedFiles} files):`);
    for (const v of result.violations) {
      console.error(`  - [${v.rule}] ${v.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `repo-guard OK: checked ${result.checkedFiles} tracked files, ${result.exemptedCount} allowlisted legacy docs/reports non-Markdown files (>300 KiB, <=1 MiB), 0 violations.`,
  );
  if (result.staleAllowlistEntries.length > 0) {
    console.log(
      `Note: ${result.staleAllowlistEntries.length} stale allowlist entry(ies) can be pruned (shrink-only policy).`,
    );
  }
}

if (isExecutedDirectly()) {
  main();
}
