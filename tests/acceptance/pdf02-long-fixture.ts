import assert from 'node:assert/strict';
import {pdfFixture} from '../support/pdf01-fixture.ts';

const fixture = {
  title:'试点覆盖与样本',
  native:'Study reviewed 240 households in 2027.',
  forecast:'South forecast 181 stores in 2028.',
  actual:'South pilot reached 175 stores in 2027.',
  method:'The study used qualitative interviews.',
  tail:'The closing sample contained 875 users.',
  pageCount:4,
  linesPerPage:260,
  labels:['地区覆盖','样本与方法'],
};
const sample = (index:number) => String.fromCharCode(65+Math.floor(index/676),65+Math.floor(index/26)%26,65+index%26);
const outputs = Array.from({length:fixture.pageCount},(_,page) => {
  const lines = Array.from({length:fixture.linesPerPage},(_,index) => `Sample ${sample(page*fixture.linesPerPage+index)} used recorded interviews.`);
  if(page===1)lines.splice(0,2,fixture.forecast,fixture.actual);
  if(page===2)lines[0]=fixture.method;
  if(page===3)lines[lines.length-1]=fixture.tail;
  return lines.join('\n');
});
const highlighted = new Set([fixture.native,fixture.forecast,fixture.actual,fixture.method,fixture.tail]);

function writeTopics(topics:Array<{id:string;title:string;items:Array<{id:string;text:string}>}>) {
  return Object.fromEntries(topics.map(topic => {
    assert.equal(topic.title,fixture.title);
    const blocks:Array<{kind:'fact';text:string}> = [];
    const coverage = Object.fromEntries(topic.items.map(item => {
      const blockIndexes:number[] = [];
      let batch:string[] = [];
      const append = (text:string) => {
        blockIndexes.push(blocks.length);
        blocks.push({kind:'fact',text});
      };
      const flush = () => {
        if(batch.length)append(batch.join(' '));
        batch=[];
      };
      for(const line of item.text.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean)) {
        if(highlighted.has(line)) {
          flush();
          append(line);
        } else {
          batch.push(line);
          if(batch.length===24)flush();
        }
      }
      flush();
      assert(blockIndexes.length);
      return [item.id,{action:'included',blockIndexes,reason:null}];
    }));
    return [topic.id,{blocks,coverage}];
  }));
}

export const longFixture = {
  fixture,outputs,writeTopics,
  classify:(page:number)=>fixture.labels[page<3?0:1],
  pdf:()=>Buffer.from(pdfFixture(['text','scan','vector','text'],page=>page===1?fixture.native:'The final page documents pilot samples.').toString('latin1').replaceAll('[0 0 200 200]','[0 0 600 200]'),'latin1'),
};
