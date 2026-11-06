import {build} from 'vite';import react from '@vitejs/plugin-react';import {mkdtemp,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
for(const key of Object.keys(process.env))if(/(?:OPENAI|ANTHROPIC|GEMINI|PROVIDER|LLM_|AI_API|API_KEY)/i.test(key))delete process.env[key];
const envDir=await mkdtemp(path.join(os.tmpdir(),'lw03-build-env-')),outDir=await mkdtemp(path.join(os.tmpdir(),'lw03-build-out-'));
await build({configFile:false,root:process.cwd(),envDir,plugins:[react()],build:{outDir,emptyOutDir:true}});
const result={success:true,command:'node scripts/lw03-builder-build.mjs',envDir,outDir,configuration:'empty envDir; configFile:false; no formal workspace',realProviderCalls:0};await writeFile('docs/reports/LW03-20261105-evidence/builder-build.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
