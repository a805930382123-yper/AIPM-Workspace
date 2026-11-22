import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesNewsFocus} from '../services/news/sources.ts';
test('快消及 AI 候选聚焦产品、品牌和渠道，不以公司名或农业宏观凑数',()=>{
 for(const [title,summary] of [['太古可口可乐中国发布致胜战略','创新驱动饮料品牌发展'],['用一杯咖啡打开更广阔的市场',''],['商务部谈批发和零售业发展',''],['连锁便利店推出新品','']]) assert.equal(matchesNewsFocus('fmcg',title,summary),true,title);
 for(const title of ['全国已累计收购秋粮1亿吨','秋粮收储有新招 今年秋粮收购已超1亿吨','今年粮食有望再获丰收','某公司发布年度财报']) assert.equal(matchesNewsFocus('fmcg',title,''),false,title);
 for(const [title,summary] of [['Artificial Analysis 实测 GPT Image 图像生成与编辑表现',''],['Cursor 推出与智能体的实时语音聊天',''],['新模型发布',''],['新版ChatGPT推出表格分析工具','发布数据分析功能，改善用户工作流。']]) assert.equal(matchesNewsFocus('ai',title,summary),true,title);
 for(const [title,summary] of [['OpenAI 完成融资，估值上涨','人工智能公司融资'],['约60万块芯片滞留仓库，受到出口限制','芯片贸易'],['某公司完成融资',''],['某公司发布融资消息','大模型公司估值上涨']]) assert.equal(matchesNewsFocus('ai',title,summary),false,title);
});
