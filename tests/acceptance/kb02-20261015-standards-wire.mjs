// Wire-aware deterministic fixture; never claims to assess a real model's extraction quality.
import {metricFacts,extraFact,question,expectedFacts,expectedQuestions} from './kb02-20261015-standards-fixtures.mjs';
export function payload(wire){
 const user=wire.messages.find(m=>m.role==='user')?.content;
 if(typeof user!=='string')throw Error('No user wire text');
 const line=user.trim().split('\n').at(-1);const value=JSON.parse(line);
 if(Array.isArray(value)&&value.every(x=>typeof x.id==='string'&&typeof x.text==='string'))return {kind:'extracting',catalog:value,user};
 if(value&&Array.isArray(value.facts)&&Array.isArray(value.questions))return {kind:'planning',...value,user};
 throw Error('Unknown versioned KB02 wire payload');
}
function cited(text,catalog){
 const joined=catalog.map(l=>l.text).join(''),start=joined.indexOf(text);if(start<0)return null;
 let offset=0;const locatorIds=[];for(const item of catalog){const end=offset+item.text.length;if(end>start&&offset<start+text.length)locatorIds.push(item.id);offset=end;}
 return {text,locatorIds};
}
export function goodReply(wire){
 const p=payload(wire);
 if(p.kind==='extracting'){
  const text=p.catalog.map(x=>x.text).join('');
  return {version:1,facts:expectedFacts(text).map(t=>cited(t,p.catalog)),questions:expectedQuestions(text).map(t=>cited(t,p.catalog))};
 }
 return {version:1,document:{title:'虚构区域铺货率报告',main_topic:'便利店铺货率',summary:'各区域铺货率、样本与时间保持独立口径。'},pages:[{title:'便利店铺货率',type:'metric',category:'metric',factIds:p.facts.map(x=>x.id),questionIds:p.questions.map(x=>x.id)}]};
}
export function oneFactReply(wire){
 const p=payload(wire);if(p.kind==='planning')return goodReply(wire);
 return {version:1,facts:[{text:'2026年10月，虚构样本保留独立来源。',locatorIds:[p.catalog[0].id]}],questions:[]};
}
