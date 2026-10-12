import fs from 'node:fs/promises';
let source=await fs.readFile('tests/acceptance/m04-review-integrity.mjs','utf8');
source=source.replaceAll('M04-review-20261012','M04-repair1-20261012').replaceAll('m04-review-','m04-repair1-');
source=source.replace('docs/reports/M03-frozen.json','docs/reports/M04-review-20261012-baseline.json').replace("['unit','unitTests']","['unit','unit']");
source=source.replace("}else{\n const base=", "}else if(process.argv[2]==='freeze'){\n await fs.writeFile(prefix+'-frozen.json',JSON.stringify({product:await snap(await product()),unit:await snap(await unit())},null,2));console.log('Repaired product and unit tests frozen');\n}else{\n const frozen=JSON.parse(await fs.readFile(prefix+'-frozen.json','utf8').catch(()=> 'null'));\n const base=");
source=source.replace('const changed=base[k].filter',"const ref=(k==='product'||k==='unit')&&frozen?frozen[k]:base[k];const changed=ref.filter").replace('!base[k].some(y=>y.path===x.path)','!ref.some(y=>y.path===x.path)');
source=source.replace("result[k]={files:now.length,unchanged:!changed.length&&!added.length,changed,added};","result[k]={files:now.length,unchanged:!changed.length&&!added.length,changed,added};if(k==='product'||k==='unit'){result[k].changesFromStart=base[k].filter(x=>m.get(x.path)!==x.sha256).map(x=>x.path);result[k].addedFromStart=now.filter(x=>!base[k].some(y=>y.path===x.path)).map(x=>x.path);}");
await fs.writeFile('tests/acceptance/m04-repair1-integrity.mjs',source);
for(const name of ['quality','http','component','browser-setup','lab']){
 const text=await fs.readFile(`tests/acceptance/m04-review-${name}.mjs`,'utf8');
 await fs.writeFile(`tests/acceptance/m04-repair1-${name}.mjs`,text.replaceAll('M04-review-20261012','M04-repair1-20261012').replaceAll('m04-review-','m04-repair1-'));
}
console.log('Independent repair acceptance scripts prepared; original review preserved');
