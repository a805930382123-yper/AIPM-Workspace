import { run } from './run.mjs';
await run({ chain: 'standard-extract', mode: 'replay', recording: 'synthetic-v1', record: false }, true).then((r) => {
  if (!r.summary.pass) process.exitCode = 1;
});
