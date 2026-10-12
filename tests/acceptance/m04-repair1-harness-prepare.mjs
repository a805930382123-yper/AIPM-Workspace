import fs from 'node:fs/promises';
const source=await fs.readFile('tests/acceptance/b08-harness.mjs','utf8');
await fs.writeFile('tests/acceptance/m04-repair1-harness.mjs',source.replace("['--import','./tests/acceptance/b08-fault-hook.mjs','--import','tsx','server/index.ts']","['--import','./tests/acceptance/b08-fault-hook.mjs','--import','./tests/acceptance/m04-repair1-phase-hook.mjs','--import','tsx','server/index.ts']"));
console.log('Independent phase-failure harness prepared');
