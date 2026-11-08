import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const root=process.cwd();
const evidence=JSON.parse(await fs.readFile('docs/reports/NEWS03-20261108-review-evidence/second-repair-live.json','utf8'));
const file='services/news/research-sources.ts', source=await fs.readFile(file,'utf8');
const block=source.slice(source.indexOf('function period('),source.indexOf('\nasync function get('));
assert.ok(block.startsWith('function period('));
const period=vm.runInNewContext(stripTypeScriptTypes(block)+';period');
const cases=[
 ['direct statistic','统计周期：2025年1月至12月。','统计周期：2025年1月至12月'],
 ['direct survey','调查时间：2025-01-01至2025-12-31。','调查时间：2025-01-01至2025-12-31'],
 ['direct cutoff','数据截至：2026年8月。','数据截至：2026年8月'],
 ['forecast label','统计期：2026年（预计）。',null],
 ['mixed label','统计期：2025年、预计2026年。',null],
 ['multiple periods','调查时间：2025年。数据截至：2026年。',null],
 ['publication','本报告于2026年9月发布。',null],
 ['ordinary observed data','本报告于2026年9月发布，数据显示2025年快消销售额同比增长0.9%。',null],
 ['narrative future','预计2026年市场走势仍将增长。',null],
 ['inline unsupported','报告列明统计期：2025年。',null]
];
const checks=[];
for(const [name,text,expected] of cases){const actual=period(text);assert.equal(actual,expected,name);checks.push({name,expected,actual,status:'PASS'});}
const real=[];
for(const item of evidence.items){const before=JSON.stringify(item);const actual=period(item.excerpt);assert.equal(actual,null,item.title);assert.equal(JSON.stringify(item),before);real.push({title:item.title,url:item.url,publishedAt:item.publishedAt,pageRange:item.research?.pageRange,previousDataPeriod:item.research?.dataPeriod,actual,excerptSha256:createHash('sha256').update(item.excerpt).digest('hex'),excerpt:item.excerpt,status:'PASS'});}
assert.ok(real.some(x=>x.url.includes('china-shopper-report')));assert.ok(real.some(x=>x.url.includes('moment-based')));
const files={};
for(const [f,old] of Object.entries(evidence.after)){const actual=createHash('sha256').update(await fs.readFile(f)).digest('hex');const changed=['services/news/research-sources.ts','tests/news03-repair.test.ts'].includes(f);if(!changed)assert.equal(actual,old,f);files[f]={previous:old,current:actual,unchanged:actual===old};}
assert.equal(files[file].current,'6bb13240544effadf5ba79ef6e9a4d9af90e049c5621999e1a85386271ed2f34');
assert.equal(files['tests/news03-repair.test.ts'].current,'db79e923749e65ef0085bb20ad3b78b83d24cf226ba31573a461c650e6aab4fe');
const report={at:new Date().toISOString(),mode:'offline exact original excerpt replay; isolated actual period function from current product source',sourceEvidence:'second-repair-live.json',checks,real,files,realModelCalls:0,networkCalls:0,status:'PASS'};
await fs.writeFile('docs/reports/NEWS03-20261108-review-evidence/period-final-astra.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',cases:checks.length,originalSourceExcerpts:real.length,unchangedFiles:Object.values(files).filter(x=>x.unchanged).length}));
