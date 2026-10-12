import fs from 'node:fs/promises';import {expect,rawInput,wikiInput} from './b09-harness.mjs';
const r=JSON.parse(await fs.readFile('docs/reports/B09-acceptance-browser-repair1-runtime.json','utf8')),s={base:r.api};
const raw=await expect(s,'/api/raw','POST',rawInput('B09返修计数来源','独立虚构返修计数夹具：先核对库存，再确认异常订单。'),201);const wiki=await expect(s,'/api/wiki','POST',wikiInput('B09返修计数页面',[raw.id],'## 返修测试\n核对库存，再确认异常订单。'),201);
await fs.writeFile('docs/reports/B09-repair1-acceptance-browser-fixture.json',JSON.stringify({rawId:raw.id,wikiId:wiki.id,dataRoot:r.dataRoot,rawBody:raw.body,rawSha:raw.bodySha256},null,2));console.log({rawId:raw.id,wikiId:wiki.id});
