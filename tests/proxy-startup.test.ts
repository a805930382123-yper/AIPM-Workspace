import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test(
  'Windows proxy entry starts real Node with environment or mocked system proxy; rejects missing proxy and old capability',
  { skip: process.platform !== 'win32' },
  () => {
    const root = mkdtempSync(path.join(tmpdir(), 'openai-proxy-start-'));
    const probe = path.join(root, 'offline probe.ts');
    const script = path.resolve('scripts/start_with_proxy.ps1');
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    writeFileSync(
      probe,
      'const version: string = process.version; console.log(JSON.stringify({args:process.argv.slice(2),http:process.env.HTTP_PROXY,https:process.env.HTTPS_PROXY,noProxy:process.env.NO_PROXY,options:process.env.NODE_OPTIONS,version}));',
    );
    const run = (setup: string, http = '', https = '') =>
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          `${setup}; & ${quote(script)} --import tsx ${quote(probe)} 'argument with spaces'`,
        ],
        {
          env: {
            ...process.env,
            HTTP_PROXY: http,
            HTTPS_PROXY: https,
            ALL_PROXY: '',
            NO_PROXY: 'localhost,127.0.0.1',
            NODE_OPTIONS: '',
          },
          encoding: 'utf8',
          timeout: 20000,
        },
      );
    try {
      const environment = run(
        "function Get-ItemProperty { throw 'environment proxy must win' }",
        'http://127.0.0.1:18080',
        'http://127.0.0.1:18443',
      );
      assert.equal(environment.status, 0, environment.stderr);
      const first = JSON.parse(environment.stdout.trim());
      assert.equal(first.http, 'http://127.0.0.1:18080');
      assert.equal(first.https, 'http://127.0.0.1:18443');
      assert.equal(first.options, '--use-env-proxy');
      assert.equal(first.noProxy, 'localhost,127.0.0.1');
      assert.deepEqual(first.args, ['argument with spaces']);
      assert.equal(first.version, process.version);

      const single = run(
        "function Get-ItemProperty { [pscustomobject]@{ ProxyEnable = 1; ProxyServer = '127.0.0.1:18081' } }",
      );
      assert.equal(single.status, 0, single.stderr);
      const second = JSON.parse(single.stdout.trim());
      assert.equal(second.http, 'http://127.0.0.1:18081');
      assert.equal(second.https, second.http);

      const protocols = run(
        "function Get-ItemProperty { [pscustomobject]@{ ProxyEnable = 1; ProxyServer = 'http=127.0.0.1:18082;https=127.0.0.1:18444;socks=127.0.0.1:19000' } }",
      );
      assert.equal(protocols.status, 0, protocols.stderr);
      const third = JSON.parse(protocols.stdout.trim());
      assert.equal(third.http, 'http://127.0.0.1:18082');
      assert.equal(third.https, 'http://127.0.0.1:18444');

      const missing = run('function Get-ItemProperty { [pscustomobject]@{ ProxyEnable = 0 } }');
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /No HTTP\/HTTPS proxy found/);

      const old = run(
        "function node { if ($args[0] -ne '--help') { throw 'must not start old node' }; $global:LASTEXITCODE = 0; 'old help without proxy capability' }",
      );
      assert.notEqual(old.status, 0);
      assert.match(old.stderr, /Upgrade to Node 24.5\+/);
      assert.doesNotMatch(old.stderr, /must not start old node/);

      console.log(
        `Offline proxy entry: real ${first.version}, environment/system single/system protocols started; no proxy/old capability rejected. No network requests.`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
