import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const prefix = 'docs/reports/KB02-R2-Q01-AUDIT-20261018-main-';
const source = 'docs/reports/KB02-R2-S01-REVIEW-20261018-main-provider-trace.jsonl';
const fixture = 'tests/acceptance/kb02-r2-q01-20261018-builder-responses.json';
const hash = s => createHash('sha256').update(s).digest('hex');
const bytes = await fs.readFile(source), rows = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
const copied = JSON.parse(await fs.readFile(fixture, 'utf8'));
assert.deepEqual(copied.map(x => x.sequence), [41, 44, 45, 49]);
const checks = copied.map(x => {
  const original = rows.find(r => r.sequence === x.sequence);
  assert.deepEqual(x.response, JSON.parse(original.response.content));
  return { sequence: x.sequence, originalContentSha256: hash(original.response.content), parsedResponseSha256: hash(JSON.stringify(x.response)), parsedResponseEqual: true };
});
const evidence = { at: new Date().toISOString(), source, sourceSha256: hash(bytes), fixture, fixtureSha256: hash(await fs.readFile(fixture)), checks, originalBytesRewritten: false, externalCalls: 0 };
await fs.writeFile(prefix + 'fixture-provenance.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
