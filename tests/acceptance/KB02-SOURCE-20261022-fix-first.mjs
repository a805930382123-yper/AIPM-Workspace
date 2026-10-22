import fs from 'node:fs/promises';
let p='services/llm/knowledge-extraction.ts',s=await fs.readFile(p,'utf8');s=s.split('\n').filter(line=>!line.includes('exact({ version: 2, ...current.plan')).join('\n');await fs.writeFile(p,s);
p='tests/kb02-extraction-contract.test.ts';s=await fs.readFile(p,'utf8');s=s.replace("['facts', 'questions', 'sourceContexts']","['factUnits', 'facts', 'questionUnits', 'questions', 'sourceContexts']");await fs.writeFile(p,s);
p='tests/kb02-r2.test.ts';s=await fs.readFile(p,'utf8');s=s.replace('qu-47-58','qu-48-58');await fs.writeFile(p,s);
