import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { screenNews } from '../../services/automation/pipeline/screen.ts';
import { writeJsonAtomic } from '../../services/storage/files.ts';

const requestHash = ({ system, user }) =>
  createHash('sha256')
    .update(JSON.stringify([system, user]))
    .digest('hex');

export async function runNewsRelevance(args) {
  const options = Object.fromEntries(
    args.filter((_, index) => index % 2 === 0).map((key, index) => [key, args[index * 2 + 1]]),
  );
  const recording = options['--recording'] ?? 'synthetic-v1';
  if (
    args.length !== 2 * Object.keys(options).length ||
    Object.keys(options).some((key) => !['--chain', '--mode', '--recording', '--case'].includes(key)) ||
    (options['--mode'] ?? 'replay') !== 'replay' ||
    recording !== 'synthetic-v1'
  ) {
    throw Error('news-relevance supports replay with the synthetic-v1 recording.');
  }
  const base = path.resolve('evals/cases/news-relevance');
  const fixture = JSON.parse(await readFile(path.join(base, recording + '.json'), 'utf8'));
  const threshold = JSON.parse(await readFile(path.join(base, 'thresholds.json'), 'utf8'));
  const cases = options['--case'] ? fixture.cases.filter((row) => row.id === options['--case']) : fixture.cases;
  if (
    fixture.schemaVersion !== 1 ||
    fixture.origin !== 'synthetic' ||
    new Set(fixture.cases.map((row) => row.id)).size !== fixture.cases.length ||
    !cases.length ||
    (!options['--case'] && cases.length < threshold.minimumCases)
  )
    throw Error('Invalid news-relevance fixtures.');
  const rows = [];
  for (const row of cases) {
    let requests = 0,
      measures;
    try {
      const [score] = await screenNews(
        {
          name: 'replay',
          model: recording,
          async complete(request) {
            requests++;
            if (requestHash(request) !== row.requestHash) throw Error('Request fingerprint differs from recording.');
            const text = JSON.stringify(row.recording);
            return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' };
          },
        },
        fixture.topics,
        [row.input],
      );
      const { gold } = row;
      measures = {
        structure: requests === 1,
        relevance: score.relevance === gold.relevance,
        category:
          score.categories.length === gold.categories.length &&
          gold.categories.every((value) => score.categories.includes(value)),
        mode: score.suggestedMode === gold.mode,
        grounding:
          gold.required.every((value) => score.reason.includes(value)) &&
          gold.forbidden.every((value) => !score.reason.includes(value)),
      };
    } catch (error) {
      rows.push({ id: row.id, status: 'FAIL', requests, error: error.message });
      continue;
    }
    rows.push({ id: row.id, requests, measures, status: Object.values(measures).every(Boolean) ? 'PASS' : 'FAIL' });
  }
  const rates = Object.fromEntries(
    ['structure', 'relevance', 'category', 'mode', 'grounding'].map((key) => [
      key,
      rows.filter((row) => row.measures?.[key]).length / rows.length,
    ]),
  );
  const passed = rows.filter((row) => row.status === 'PASS').length;
  const summary = {
    passed,
    total: rows.length,
    rates,
    pass: Object.entries(rates).every(([key, value]) => value >= threshold[key]),
  };
  const runId = new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8);
  const result = { schemaVersion: 1, runId, chain: 'news-relevance', mode: 'replay', recording, cases: rows, summary };
  const file = path.resolve('evals/results', runId + '-news-relevance');
  const markdown =
    `# news-relevance\n\n${passed}/${rows.length} synthetic replay cases; ${summary.pass ? 'PASS' : 'FAIL'}\n\n` +
    rows.map((row) => `- ${row.id}: ${row.status}${row.error ? ' · ' + row.error : ''}`).join('\n') +
    '\n';
  await writeJsonAtomic(file + '.json', result);
  await writeFile(file + '.md', markdown);
  console.log(markdown, 'Result: ' + file + '.json');
  return result;
}
