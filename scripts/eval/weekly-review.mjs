import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateWeeklyReviewDraft } from '../../services/automation/tasks/weekly-review.ts';
import { weeklyReviewRefs } from '../../services/automation/weekly-review-store.ts';
import { weeklyReviewPeriod } from '../../services/automation/weekly-review-snapshot.ts';
import { writeJsonAtomic } from '../../services/storage/files.ts';

export async function runWeeklyReview(args) {
  const options = Object.fromEntries(args.filter((_arg, index) => index % 2 === 0).map((key, index) => [key, args[index * 2 + 1]]));
  const recording = options['--recording'] ?? 'synthetic-v1';
  if (args.length !== 2 * Object.keys(options).length
    || Object.keys(options).some(key => !['--chain', '--mode', '--recording', '--case'].includes(key))
    || (options['--mode'] ?? 'replay') !== 'replay' || recording !== 'synthetic-v1') {
    throw Error('weekly-review supports offline replay with the synthetic-v1 recording.');
  }
  const fixture = JSON.parse(await readFile(path.resolve('evals/cases/weekly-review', recording + '.json'), 'utf8'));
  const { weeklyReview: threshold } = JSON.parse(await readFile(path.resolve('evals/thresholds.json'), 'utf8'));
  const cases = options['--case'] ? fixture.cases.filter(row => row.id === options['--case']) : fixture.cases;
  if (fixture.schemaVersion !== 1 || fixture.origin !== 'synthetic' || new Set(fixture.cases.map(row => row.id)).size !== fixture.cases.length
    || !cases.length || (!options['--case'] && cases.length < threshold.minimumCases)) throw Error('Invalid weekly-review fixtures.');
  const period = weeklyReviewPeriod(Date.parse('2026-11-23T01:00:00.000Z'));
  const rows = [];
  for (const row of cases) {
    let requests = 0, payload = '', draft = null, valid = true;
    try {
      if (row.snapshot.hasActivity) {
        draft = await generateWeeklyReviewDraft({
          name: 'replay', model: recording,
          async complete(request) {
            requests++;
            payload = request.user;
            const text = JSON.stringify(row.recording);
            return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
          },
        }, period, row.snapshot);
      }
    } catch {
      valid = false;
    }
    const { gold } = row;
    const factText = [draft?.executiveSummary, ...(draft?.highlights ?? []).map(item => item.text),
      ...(draft?.risksAndBlockers ?? []).map(item => item.text)].filter(Boolean).join('\n');
    const suggestions = (draft?.nextWeekFocus ?? []).map(item => item.text + ' ' + item.reason).join('\n');
    const output = JSON.stringify(draft);
    const allowed = weeklyReviewRefs(row.snapshot);
    const refs = [...(draft?.highlights ?? []), ...(draft?.risksAndBlockers ?? [])].flatMap(item => item.refs);
    const measures = {
      structure: valid && requests === gold.requests && Boolean(draft) === (gold.requests === 1) ? 1 : 0,
      referenceRate: refs.length ? refs.filter(ref => allowed.has(ref)).length / refs.length : gold.refs.length ? 0 : 1,
      factRecall: gold.facts.length ? gold.facts.filter(text => factText.includes(text)).length / gold.facts.length : 1,
      forbiddenAssertions: gold.forbidden.filter(text => output.includes(text) || payload.includes(text)).length,
      partitionViolations: gold.suggestions.filter(text => !suggestions.includes(text) || factText.includes(text)).length,
    };
    const pass = measures.structure >= threshold.structure && measures.referenceRate >= threshold.referenceRate
      && measures.factRecall >= threshold.factRecall && measures.forbiddenAssertions <= threshold.forbiddenAssertions
      && measures.partitionViolations <= threshold.partitionViolations && gold.refs.every(ref => refs.includes(ref));
    rows.push({ id: row.id, status: pass ? 'PASS' : 'FAIL', requests, measures, refs });
  }
  const passed = rows.filter(row => row.status === 'PASS').length;
  const summary = { passed, total: rows.length, pass: passed === rows.length };
  const runId = new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8);
  const result = { schemaVersion: 1, runId, chain: 'weekly-review', mode: 'replay', recording, cases: rows, summary };
  const file = path.resolve('evals/results', runId + '-weekly-review');
  const markdown = '# weekly-review\n\n' + passed + '/' + rows.length + ' synthetic replay cases; ' + (summary.pass ? 'PASS' : 'FAIL') + '\n\n'
    + rows.map(row => '- ' + row.id + ': ' + row.status).join('\n') + '\n';
  await writeJsonAtomic(file + '.json', result);
  await writeFile(file + '.md', markdown);
  console.log(markdown, 'Result: ' + file + '.json');
  return result;
}
