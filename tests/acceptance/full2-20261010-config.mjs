import fs from 'node:fs/promises';
import path from 'node:path';
import {loadLlmConfig,llmConfigSummary} from '../../services/llm/config.ts';
const filePath=path.resolve('.env.local');
const summary=llmConfigSummary(await loadLlmConfig({filePath}),filePath);
await fs.writeFile('docs/reports/FULL2-20261010-config.json',JSON.stringify({checkedAt:new Date().toISOString(),...summary},null,2));
console.log(JSON.stringify({configured:summary.configured,source:summary.source,model:summary.model,missing:summary.missing}));


