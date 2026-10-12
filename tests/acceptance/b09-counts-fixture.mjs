import fs from 'node:fs/promises';import {expect,rawInput,wikiInput} from './b09-harness.mjs';
const r=JSON.parse(await fs.readFile('docs/reports/B09-acceptance-browser-manual-counts-runtime.json','utf8')),s={base:r.api};
const raw=await expect(s,'/api/raw','POST',rawInput('B09计数夹具来源','独立虚构计数夹具'),201);const wiki=await expect(s,'/api/wiki','POST',wikiInput('B09计数夹具页面',[raw.id],'## 测试\n人工计数测试内容'),201);
await fs.writeFile('docs/reports/B09-acceptance-browser-counts-fixture.json',JSON.stringify({rawId:raw.id,wikiId:wiki.id,dataRoot:r.dataRoot},null,2));console.log({rawId:raw.id,wikiId:wiki.id});
