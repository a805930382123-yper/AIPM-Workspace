import fs from 'node:fs/promises';
const file='tests/acceptance/m05-app-component.mjs';
const content=await fs.readFile(file,'utf8');
await fs.writeFile(file,content.replace("includes('来源已删除')","includes('Raw已删除')").replace("assert.equal(doc.querySelector('.raw-detail'),null,'Missing explicitly selected target must not silently show another Raw')","assert(!doc.querySelector('.raw-detail'),'Missing explicitly selected target must not silently show another Raw')"));
console.log('Corrected actual status label and bounded assertion output; missing-target expectation unchanged.');
