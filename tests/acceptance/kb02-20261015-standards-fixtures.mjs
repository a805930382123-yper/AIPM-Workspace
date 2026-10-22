// Fictional fixtures and expected business facts, independent of product parsing code.
export const regions=['东一区','东二区','南一区','南二区','西一区','西二区','北一区','北二区','中一区','中二区','沿海区','西南区','东北区','西北区'];
export const metricFacts=regions.map((region,index)=>`2026年10月${String(index+1).padStart(2,'0')}日，${region}便利店样本${120+index}家，有效铺货门店${80+index}家，铺货率按有效铺货门店/样本门店计算为${(100*(80+index)/(120+index)).toFixed(2)}%。`);
export const extraFact='2026年10月15日，虚构甲公司规定：便利店铺货率分母仅包含当日有效营业门店，不含闭店样本。';
export const question='待确认：2026年10月16日促销期间新增门店是否纳入同口径铺货率分母？';
export const shortBody=metricFacts[0]+'\n'+extraFact+'\n'+question;
// 14 sections, exactly the historical required 106400 UTF-16 character length.
export const longBody=metricFacts.map((fact,index)=>{
 const head=`虚构区域报告第${index+1}节\n${fact}\n`;
 const end=index===13?`\n${extraFact}\n${question}\n`:'\n重复说明：本资料均为虚构，版式说明不构成独立知识主题。\n';
 const filler='版式占位，仅为验收长文边界；没有新增业务事实。';
 return head+filler.repeat(Math.ceil(7600/filler.length)).slice(0,7600-head.length-end.length)+end;
}).join('');
export function expectedFacts(body){return [...metricFacts,extraFact].filter(f=>body.includes(f));}
export function expectedQuestions(body){return body.includes(question)?[question]:[];}
if(longBody.length!==106400)throw Error('Independent long fixture must be exactly 106400 characters');
