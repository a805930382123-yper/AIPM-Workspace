import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

const project = process.cwd();
const shellArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
// This Task Scheduler/CIM fixture exceeded its original 15-second budget
// in the full suite. The launcher fixture also now starts four attempts.
const fixtureTimeout = 30000;

function copyServiceScripts(fixture: string, editedName: string, edit: (source: string) => string) {
  const source = join(project, 'scripts', 'service');
  const destination = join(fixture, 'scripts', 'service');
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source)) {
    const original = join(source, name);
    const target = join(destination, name);
    if (name === editedName) writeFileSync(target, edit(readFileSync(original, 'utf8')));
    else copyFileSync(original, target);
  }
}

function stopFixtureProcesses(id: string) {
  const cleanup = spawnSync(
    'powershell.exe',
    [
      ...shellArgs,
      '-Command',
      `
$ErrorActionPreference = 'Stop'
$fixtureProcesses = @(Get-CimInstance Win32_Process -Filter "(Name = 'powershell.exe' OR Name = 'node.exe') AND CommandLine LIKE '%--autostart-id ${id}%'" |
    Where-Object { $_.CommandLine -match '(?:^|\\s)--autostart-id ${id}\\s*$' })
foreach ($fixtureProcess in $fixtureProcesses) {
    $process = Get-Process -Id $fixtureProcess.ProcessId -ErrorAction SilentlyContinue
    if ($process) { Stop-Process -InputObject $process; $process.WaitForExit(5000) | Out-Null }
}
Write-Output "Matching fixture processes stopped: $($fixtureProcesses.Count)"
`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 },
  );
  return `Cleanup exit ${cleanup.status}: ${cleanup.error ?? cleanup.stderr}${cleanup.stdout ?? ''}`;
}

test(
  'RUN01 configures interactive login without a second retry policy and identifies the final process marker',
  { skip: process.platform !== 'win32' },
  () => {
    const fixture = mkdtempSync(join(tmpdir(), 'aipm-run01 registration '));
    try {
      mkdirSync(join(fixture, 'dist'));
      writeFileSync(join(fixture, 'dist', 'index.html'), '<!doctype html>');
      copyServiceScripts(fixture, 'install-autostart.ps1', (installer) => {
        assert.equal(installer.match(/\bRegister-ScheduledTask\b/g)?.length, 1);
        return installer.replace('Register-ScheduledTask', 'Read-RegistrationFixture');
      });
      const capture = join(fixture, 'register-fixture.ps1');
      const fixtureId = randomUUID().replaceAll('-', '');
      writeFileSync(
        capture,
        `
$ErrorActionPreference = 'Stop'
function global:Read-RegistrationFixture {
    param($TaskName, $TaskPath, $Action, $Trigger, $Principal, $Settings, $Description)
    $encoded = ($Action.Arguments -split " -Settings '", 2)[1].Split("'")[0]
    $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
    'RUN01_REGISTRATION=' + (@{
        taskName = $TaskName; description = $Description; payload = $payload
        taskPath = $TaskPath; arguments = $Action.Arguments; workingDirectory = $Action.WorkingDirectory
        trigger = $Trigger.CimClass.CimClassName; triggerUser = $Trigger.UserId; principalUser = $Principal.UserId
        logon = $Principal.LogonType; runLevel = $Principal.RunLevel
        restartCount = $Settings.RestartCount; restartInterval = $Settings.RestartInterval
    } | ConvertTo-Json -Compress -Depth 5) | Write-Host
}
Write-Host 'RUN01 phase: constructing the task'
& "$PSScriptRoot/scripts/service/install-autostart.ps1" -TaskName 'AIPM-RUN01 Fixture' -Port 16431 -DataDir "$PSScriptRoot/test data" -ConfigFile "$PSScriptRoot/absent-config" -NodePath $env:RUN01_NODE_PATH -UseProxy -Yes
. "$PSScriptRoot/scripts/service/task-settings.ps1"
$id = $env:RUN01_FIXTURE_ID
$decoy = [guid]::NewGuid().ToString('N')
$arguments = '--eval "setTimeout(() => {}, 30000)" -- --autostart-id ' + $decoy + ' --autostart-id ' + $id + ' '
Write-Host 'RUN01 phase: starting the process marker fixture'
$node = Start-Process -FilePath $env:RUN01_NODE_PATH -ArgumentList $arguments -WindowStyle Hidden -PassThru
try {
    Write-Host 'RUN01 phase: inspecting CIM process metadata'
    $metadata = Get-CimInstance Win32_Process -Filter "ProcessId = $($node.Id)"
    if ($metadata.CommandLine -notmatch " $id +$") { throw 'Fixture command line must end with the intended id and a space.' }
    $owner = Get-AipmAutostartProcess @{ Id = $id; NodePath = $env:RUN01_NODE_PATH }
    $nonOwner = Get-AipmAutostartProcess @{ Id = $decoy; NodePath = $env:RUN01_NODE_PATH }
    if ($owner.ProcessId -ne $node.Id -or $nonOwner) { throw 'Ownership lookup should accept only the final marker with optional trailing space.' }
} finally {
    if (-not $node.HasExited) { Stop-Process -InputObject $node; $node.WaitForExit(5000) | Out-Null }
}
`,
      );
      // Hidden Windows PowerShell can stall before entering a script launched with -File.
      const registration = spawnSync(
        'powershell.exe',
        [...shellArgs, '-Command', '& $env:RUN01_CAPTURE_SCRIPT; exit $LASTEXITCODE'],
        {
          encoding: 'utf8',
          cwd: fixture,
          windowsHide: true,
          timeout: fixtureTimeout,
          env: {
            ...process.env,
            RUN01_CAPTURE_SCRIPT: capture,
            RUN01_NODE_PATH: process.execPath,
            RUN01_FIXTURE_ID: fixtureId,
          },
        },
      );
      if (registration.error || registration.signal) {
        const cleanup = stopFixtureProcesses(fixtureId);
        assert.fail(
          `Registration (fixture ${fixtureId}) exited ${registration.status}, signal ${registration.signal ?? 'none'}, error ${registration.error ?? 'none'}.\n${registration.stdout}\n${registration.stderr}\n${cleanup}`,
        );
      }
      assert.equal(registration.status, 0, `${registration.stdout}\n${registration.stderr}`);
      const captured = registration.stdout.split(/\r?\n/).find((line) => line.startsWith('RUN01_REGISTRATION='));
      assert.ok(captured, registration.stdout);
      const record = JSON.parse(captured.slice('RUN01_REGISTRATION='.length));
      assert.equal(record.taskName, 'AIPM-RUN01 Fixture');
      assert.equal(record.taskPath, '\\');
      assert.equal(record.trigger, 'MSFT_TaskLogonTrigger');
      assert.equal(record.triggerUser, record.principalUser);
      assert.equal(record.logon, 3); // InteractiveToken
      assert.equal(record.runLevel, 0); // Limited
      assert.equal(record.restartCount, 0);
      const canonicalFixture = realpathSync.native(fixture);
      assert.equal(realpathSync.native(record.workingDirectory), canonicalFixture);
      assert.match(record.arguments, /-WindowStyle Hidden -ExecutionPolicy Bypass -Command "& '/);
      assert.match(record.arguments, / -Settings '[A-Za-z0-9+/]+=*'; exit \$LASTEXITCODE"$/);
      assert.equal(record.payload.Port, 16431);
      // These targets need not exist at registration time. Resolve their parent
      // to account for Windows short-path aliases and check each target name.
      assert.equal(realpathSync.native(dirname(record.payload.DataDir)), canonicalFixture);
      assert.equal(basename(record.payload.DataDir), 'test data');
      assert.equal(realpathSync.native(dirname(record.payload.ConfigFile)), canonicalFixture);
      assert.equal(basename(record.payload.ConfigFile), 'absent-config');
      assert.equal(realpathSync.native(record.payload.NodePath), realpathSync.native(process.execPath));
      assert.equal(record.payload.UseProxy, true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

test(
  'RUN01 launcher retries at most three failures, stops on zero, and keeps only controlled lifecycle logs',
  { skip: process.platform !== 'win32' },
  () => {
    const fixture = mkdtempSync(join(tmpdir(), "aipm-run01 空格 ' "));
    try {
      mkdirSync(join(fixture, 'server'));
      const retryDelay = '$restartDelaySeconds = 60';
      copyServiceScripts(fixture, 'run-autostart.ps1', (launcher) => {
        assert.equal(launcher.split(retryDelay).length, 2);
        return launcher.replace(retryDelay, '$restartDelaySeconds = 0');
      });
      const launcher = join(fixture, 'scripts', 'service', 'run-autostart.ps1');
      copyFileSync(join(project, 'scripts', 'start_with_proxy.ps1'), join(fixture, 'scripts', 'start_with_proxy.ps1'));
      symlinkSync(join(project, 'node_modules'), join(fixture, 'node_modules'), 'junction');
      writeFileSync(join(fixture, 'package.json'), '{"type":"module"}');
      writeFileSync(
        join(fixture, 'server', 'index.ts'),
        `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
console.log('SYNTHETIC_BUSINESS_BODY');
console.error('SYNTHETIC_PROVIDER_SECRET');
setTimeout(() => {
  const probe = join(process.env.FMCG_DATA_DIR, 'node-probe.json');
  const attempts = existsSync(probe) ? JSON.parse(readFileSync(probe, 'utf8')).attempts + 1 : 1;
  writeFileSync(probe, JSON.stringify({
    attempts,
    port: process.env.FMCG_PORT,
    config: process.env.FMCG_LLM_CONFIG_FILE,
    proxy: process.env.HTTP_PROXY ?? null,
    flags: process.env.NODE_OPTIONS ?? '',
    args: process.argv.slice(2),
  }));
  process.exit(process.env.RUN01_FIXTURE_RECOVER === '1' && attempts === 2 ? 0 : 7);
}, 50);
`,
      );
      const scenarios = [
        { name: 'repeated failures', useProxy: false, recovery: '', attempts: 4, exitCode: 7 },
        {
          name: 'recovered',
          useProxy: process.allowedNodeEnvironmentFlags.has('--use-env-proxy'),
          recovery: '1',
          attempts: 2,
          exitCode: 0,
        },
      ];
      for (const { name, useProxy, recovery, attempts, exitCode } of scenarios) {
        const dataDir = join(fixture, name);
        const logs = join(dataDir, 'state', 'runtime-logs');
        mkdirSync(logs, { recursive: true });
        writeFileSync(join(logs, 'autostart-2000-01-01.log'), 'obsolete');
        writeFileSync(join(logs, 'other.log'), 'unrelated');
        const config = {
          Id: randomUUID().replaceAll('-', ''),
          Port: 16431,
          DataDir: dataDir,
          UseProxy: useProxy,
          NodePath: process.execPath,
          ConfigFile: join(fixture, 'absent config'),
        };
        const payload = Buffer.from(JSON.stringify(config)).toString('base64');
        const invocation = `& '${launcher.replaceAll("'", "''")}' -Settings '${payload}'; exit $LASTEXITCODE`;
        const action = `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "${invocation}"`;
        const launch = spawnSync('powershell.exe', [action], {
          encoding: 'utf8',
          cwd: fixture,
          windowsHide: true,
          timeout: fixtureTimeout,
          windowsVerbatimArguments: true,
          env: {
            ...process.env,
            NODE_OPTIONS: '',
            RUN01_FIXTURE_RECOVER: recovery,
            HTTP_PROXY: 'http://proxy-fixture.invalid:9',
            HTTPS_PROXY: 'http://proxy-fixture.invalid:9',
          },
        });
        const files = readdirSync(logs);
        const daily = files.find(
          (name) => /^autostart-\d{4}-\d{2}-\d{2}\.log$/.test(name) && name !== 'autostart-2000-01-01.log',
        );
        if (launch.error || launch.signal) {
          const lifecycle = daily ? readFileSync(join(logs, daily), 'utf8') : '(no lifecycle log)';
          const cleanup = stopFixtureProcesses(config.Id);
          assert.fail(
            `Launcher (${name}, fixture ${config.Id}) exited ${launch.status}, signal ${launch.signal ?? 'none'}, error ${launch.error ?? 'none'}.\n${launch.stdout ?? ''}\n${launch.stderr ?? ''}\n${lifecycle}\n${cleanup}`,
          );
        }
        assert.ok(daily, launch.stderr);
        const lines = readFileSync(join(logs, daily), 'utf8');
        assert.equal(launch.status, exitCode, lines);
        assert.ok(lines.includes(`exited (code ${exitCode})`));
        assert.equal(lines.match(/Starting production process\./g)?.length, attempts);
        assert.equal(lines.match(/Retrying production process/g)?.length, attempts - 1);
        assert.doesNotMatch(lines, /SYNTHETIC_BUSINESS_BODY|SYNTHETIC_PROVIDER_SECRET|proxy-fixture/i);
        assert.ok(!files.includes('autostart-2000-01-01.log'));
        assert.ok(files.includes('other.log'));
        const node = JSON.parse(readFileSync(join(dataDir, 'node-probe.json'), 'utf8'));
        assert.equal(node.attempts, attempts);
        assert.equal(node.port, '16431');
        assert.equal(node.config, config.ConfigFile);
        assert.equal(node.proxy, useProxy ? 'http://proxy-fixture.invalid:9' : null);
        assert.equal(node.flags.includes('--use-env-proxy'), useProxy);
        assert.deepEqual(node.args, ['--production', '--autostart-id', config.Id]);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);
