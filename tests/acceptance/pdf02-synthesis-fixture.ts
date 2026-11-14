import assert from 'node:assert/strict';
import {pdfFixture} from '../support/pdf01-fixture.ts';

const fixture = {
  original:'North in 2027 recorded 173 stores.',
  second:'The North 2027 count recorded 173 stores.',
  third:'173 stores were recorded in North in 2027.',
  forecast:'South in 2028 forecast 181 stores.',
  users:'New users totalled 875 in 2027.',
  logo:'左上角显示品牌 Logo。',
  pageNumber:'页面页码为59。',
  promotion:'本品牌祝读者生活美满。',
  coverageTitle:'门店覆盖',
  usersTitle:'新增用户',
  noiseTitle:'页面装饰',
  coverageDraft:'In 2027, North recorded a total of 173 stores.',
  forecastDraft:'The 2028 forecast for South was 181 stores.',
  usersDraft:'In 2027, the total number of new users was 875.',
};
const outputs = [fixture.logo,[fixture.second,fixture.forecast,fixture.pageNumber].join('\n'),[fixture.third,fixture.users,fixture.promotion].join('\n')];
type Item = {id:string;text:string};

function classify(text:string) {
  if([fixture.logo,fixture.pageNumber,fixture.promotion].includes(text))return fixture.noiseTitle;
  return text===fixture.users ? fixture.usersTitle : fixture.coverageTitle;
}

function writeTopics(topics:Array<{id:string;title:string;items:Item[]}>) {
  return Object.fromEntries(topics.map(topic => {
    const blocks = topic.title===fixture.coverageTitle ? [fixture.coverageDraft,fixture.forecastDraft] : topic.title===fixture.usersTitle ? [fixture.usersDraft] : [];
    const coverage = Object.fromEntries(topic.items.map(item => {
      const text = item.text.trim();
      if(text===fixture.logo||text===fixture.pageNumber)return [item.id,{action:'metadata',blockIndex:null,reason:'页面标识或页码'}];
      if(text===fixture.promotion)return [item.id,{action:'promotion',blockIndex:null,reason:'纯品牌致意'}];
      if(text===fixture.forecast)return [item.id,{action:'included',blockIndex:1,reason:null}];
      if(text===fixture.original||text===fixture.users)return [item.id,{action:'included',blockIndex:0,reason:null}];
      assert([fixture.second,fixture.third].includes(text),`Unknown synthetic input ${text}`);
      return [item.id,{action:'duplicate',blockIndex:0,reason:'相同地区、年度与实际门店数'}];
    }));
    return [topic.id,{blocks:blocks.map(text=>({kind:'fact',text})),coverage}];
  }));
}

export const synthesisFixture = {
  fixture,outputs,classify,writeTopics,
  pdf:()=>Buffer.from(pdfFixture(['text','scan','vector'],()=>fixture.original).toString('latin1').replaceAll('[0 0 200 200]','[0 0 600 200]'),'latin1'),
};
