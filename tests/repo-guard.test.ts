import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRepoGuard, REPO_GUARD_LIMITS } from '../scripts/repo-guard.ts';

function withTempRepo(fn: (rootDir: string, writeTracked: (relPath: string, bytes: number) => void) => void): void {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'aipm-repo-guard-'));
  try {
    const tracked: string[] = [];
    const writeTracked = (relPath: string, bytes: number) => {
      const absPath = path.join(rootDir, ...relPath.split('/'));
      mkdirSync(path.dirname(absPath), { recursive: true });
      writeFileSync(absPath, Buffer.alloc(bytes, 0x61));
      if (!tracked.includes(relPath)) tracked.push(relPath);
    };
    fn(rootDir, writeTracked);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

function collectFilesFromList(list: string[]): () => string[] {
  return () => list;
}

test('repo-guard passes when all files are within limits (including exact boundaries)', () => {
  withTempRepo((rootDir, write) => {
    const files = [
      'docs/status.md',
      'docs/agent-control.md',
      'docs/acceptance.md',
      'docs/reports/summary.json',
      'docs/reports/long-report.md',
      'src/large-ok.ts',
    ];
    write('docs/status.md', REPO_GUARD_LIMITS.ledgerLimits['docs/status.md']); // 24,576 B
    write('docs/agent-control.md', REPO_GUARD_LIMITS.ledgerLimits['docs/agent-control.md']); // 49,152 B
    write('docs/acceptance.md', REPO_GUARD_LIMITS.ledgerLimits['docs/acceptance.md']); // 49,152 B
    write('docs/reports/summary.json', REPO_GUARD_LIMITS.reportsNonMdMaxBytes); // 307,200 B
    write('docs/reports/long-report.md', REPO_GUARD_LIMITS.trackedMaxBytes); // 1,048,576 B (.md allowed >300 KiB)
    write('src/large-ok.ts', REPO_GUARD_LIMITS.trackedMaxBytes); // 1,048,576 B

    const result = checkRepoGuard({ rootDir, listFiles: collectFilesFromList(files) });
    assert.equal(result.ok, true);
    assert.equal(result.violations.length, 0);
    assert.equal(result.checkedFiles, files.length);
  });
});

test('repo-guard fails when any tracked file exceeds 1 MiB or non-md report exceeds 300 KiB without allowlist', () => {
  withTempRepo((rootDir, write) => {
    const files = ['assets/huge.bin', 'docs/reports/oversize.png'];
    write('assets/huge.bin', REPO_GUARD_LIMITS.trackedMaxBytes + 1);
    write('docs/reports/oversize.png', REPO_GUARD_LIMITS.reportsNonMdMaxBytes + 1);

    const result = checkRepoGuard({ rootDir, listFiles: collectFilesFromList(files) });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((v) => v.rule),
      ['tracked-1mib', 'reports-non-md-300kib'],
    );
  });
});

test('repo-guard passes for allowlisted legacy docs/reports non-md file with valid reason, and fails if a new over-limit file is added outside allowlist', () => {
  withTempRepo((rootDir, write) => {
    const allowlistDir = path.join(rootDir, 'scripts');
    mkdirSync(allowlistDir, { recursive: true });
    writeFileSync(
      path.join(allowlistDir, 'repo-guard-allowlist.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          entries: [
            {
              path: 'docs/reports/legacy-trace.jsonl',
              rule: 'reports-non-md-300kib',
              maxBytes: 1_048_576,
              reason: 'Legacy historical trace retained prior to ENG03.',
            },
          ],
        },
        null,
        2,
      ) + '\n',
    );

    write('docs/reports/legacy-trace.jsonl', 600_000);
    const passResult = checkRepoGuard({
      rootDir,
      listFiles: collectFilesFromList(['docs/reports/legacy-trace.jsonl']),
    });
    assert.equal(passResult.ok, true);
    assert.equal(passResult.exemptedCount, 1);

    // Adding a new over-limit file outside allowlist must fail
    write('docs/reports/new-screenshot.png', 400_000);
    const failResult = checkRepoGuard({
      rootDir,
      listFiles: collectFilesFromList(['docs/reports/legacy-trace.jsonl', 'docs/reports/new-screenshot.png']),
    });
    assert.equal(failResult.ok, false);
    assert.equal(failResult.exemptedCount, 1);
    assert.equal(failResult.violations.length, 1);
    assert.equal(failResult.violations[0]?.rule, 'reports-non-md-300kib');
    assert.equal(failResult.violations[0]?.path, 'docs/reports/new-screenshot.png');
  });
});

test('repo-guard fails when ledger documents exceed thresholds (even if listed in allowlist)', () => {
  withTempRepo((rootDir, write) => {
    const allowlistDir = path.join(rootDir, 'scripts');
    mkdirSync(allowlistDir, { recursive: true });
    writeFileSync(
      path.join(allowlistDir, 'repo-guard-allowlist.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            path: 'docs/status.md',
            rule: 'reports-non-md-300kib',
            reason: 'Illegal attempt to exempt status.md',
          },
        ],
      }),
    );

    const files = ['docs/status.md', 'docs/agent-control.md', 'docs/acceptance.md'];
    write('docs/status.md', REPO_GUARD_LIMITS.ledgerLimits['docs/status.md'] + 1);
    write('docs/agent-control.md', REPO_GUARD_LIMITS.ledgerLimits['docs/agent-control.md'] + 1);
    write('docs/acceptance.md', REPO_GUARD_LIMITS.ledgerLimits['docs/acceptance.md'] + 1);

    const result = checkRepoGuard({ rootDir, listFiles: collectFilesFromList(files) });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((v) => v.rule),
      ['invalid-allowlist', 'ledger-status-24kib', 'ledger-agent-control-48kib', 'ledger-acceptance-48kib'],
    );
  });
});

test('repo-guard fails when an allowlist entry is missing a non-empty reason or rule', () => {
  withTempRepo((rootDir, write) => {
    const allowlistDir = path.join(rootDir, 'scripts');
    mkdirSync(allowlistDir, { recursive: true });
    writeFileSync(
      path.join(allowlistDir, 'repo-guard-allowlist.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            path: 'docs/reports/legacy-no-reason.json',
            rule: 'reports-non-md-300kib',
            reason: '   ',
          },
        ],
      }),
    );

    write('docs/reports/legacy-no-reason.json', 400_000);
    const result = checkRepoGuard({
      rootDir,
      listFiles: collectFilesFromList(['docs/reports/legacy-no-reason.json']),
    });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((v) => v.rule),
      ['invalid-allowlist', 'reports-non-md-300kib'],
    );
  });
});

test('repo-guard never exempts > 1 MiB files even if present in allowlist', () => {
  withTempRepo((rootDir, write) => {
    const allowlistDir = path.join(rootDir, 'scripts');
    mkdirSync(allowlistDir, { recursive: true });
    writeFileSync(
      path.join(allowlistDir, 'repo-guard-allowlist.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            path: 'docs/reports/too-big.json',
            rule: 'reports-non-md-300kib',
            reason: 'Trying to exempt over-1MiB file',
          },
        ],
      }),
    );

    write('docs/reports/too-big.json', REPO_GUARD_LIMITS.trackedMaxBytes + 1);
    const result = checkRepoGuard({
      rootDir,
      listFiles: collectFilesFromList(['docs/reports/too-big.json']),
    });
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0]?.rule, 'tracked-1mib');
  });
});
