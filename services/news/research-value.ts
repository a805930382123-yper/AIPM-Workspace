import type { NewsItem } from './types.ts';

const topics = [
  { label:'即时零售与 O2O', match:/即时零售|即时配送|闪购|前置仓|外卖零售|到家业务|小时达|半小时达|线上线下一体化|\b(?:o2o|quick commerce|instant (?:retail|delivery)|on-demand retail)\b/iu,
    application:'同一品类在不同即时零售平台的订单量和履约时长有何差异？' },
  { label:'经销与零售渠道', match:/经销商|经销渠道|经销网络|分销|(?<!即时)零售渠道|渠道结构|渠道份额|铺货|动销|传统渠道|现代渠道|下沉市场|折扣渠道|渠道渗透|\b(?:distribut(?:or|ion)|route.to.market|channel mix|channel share|retail channels?)\b/iu,
    application:'同一品类在不同渠道的铺货率和单店销量相差多少？' },
  { label:'货盘与 SKU', match:/货盘|商品组合|品类组合|商品结构|选品|规格带|价格带|单品组合|商品盘点|\b(?:skus?|assortment|pack sizes?|price tiers?|product mix)\b/iu,
    application:'同一品类在不同渠道的畅销规格和价格带有何差异？' },
  { label:'促销与定价', match:/促销|囤货|满减|促销折扣|价格促销|促销定价|价格弹性|\b(?:promotions?|promotional|price elasticity|trade spend)\b/iu,
    application:'同品类、同渠道的促销期与非促销期相比，日均销量相差多少？' },
  { label:'门店与零售业态', match:/门店|商超|超市|便利店|零售业态|社区店|折扣店|仓储会员店|商店|店型|门店客流|\b(?:stores?|supermarkets?|convenience stores?|store formats?|footfall)\b/iu,
    application:'不同店型在同一品类上的客单价和单店销量有何差异？' },
];

const category = /快[速]?消[费]?[品]?|消费品|食品|粮油|饮料|乳品|乳制品|零食|生鲜|啤酒|茶饮|咖啡|烟酒|酒类|冲调|日化|日用品|纸品|个护|美妆|护肤|母婴|宠物食品|\b(?:fmcg|cpg|consumer packaged goods|food|beverages?|dairy|snacks?|grocery|beauty|personal care)\b/iu;
const measuredFinding = /同比|环比|销售额|销量|增量|占比|销售份额|市场份额|客单价|转化率|渗透率|覆盖率|复购率|客流|购买频次|订单[量数]|履约时长|门店数|缺货率|受访者中|购物者中|消费者中|\b(?:penetration|market share|sales|volume|CAGR|conversion|year over year)\b/iu;
const qualitativeFinding = /(?:调研|调查|研究|监测|数据|统计)[^。！？]{0,20}(?:显示|发现|表明|观察到)|(?:消费者|购物者|受访者)[^。！？]{0,40}(?:偏好|选择|倾向|认为|更重视|转向)|(?:销量|份额|客流|渗透率|客单价)[^。！？]{0,20}(?:增长|提升|下降|降低|高于|低于)|\b(?:survey|research|respondents?|data)\b.{0,50}\b(?:found|showed|reported|prefer|indicate)/iu;
const metric = /\d+(?:[.,]\d+)?\s*(?:[%％]|个百分点|亿|万|家户|家门店|个门店|款SKU|个SKU|元\/单|元\/件|单\/日|\b(?:bps|million|billion)\b)/iu;
const scope = /样本(?:量|数)?|受访者|受访人群|统计口径|统计期|数据覆盖|调查范围|调研覆盖|监测范围|限额以上|(?:20\d{2}\s*年)?(?:第?[一二三四1-4]季度|[上下]半年|\d{1,2}月(?:份|至\d{1,2}月))|\b(?:respondent[s]?|sample size|survey period|reporting period)\b/iu;
const china = /中国|我国|内地市场|\bChina\b|\bChinese (?:market|retail|consumer|household|shoppers?)\b/iu;
const repost = /^(?:【[^】]+】\s*)?(?:转载|转发|转自|来源[:：]\s*转载|repost(?:ed)?\b)|本文(?:系|经授权)?转载自|转载自[：:]|原文转载/iu;
const event = /报名|参展|活动回顾|峰会回顾|获奖|颁奖|圆满落幕|邀您|诚邀|招募|直播预告|webinar|register (?:now|for)|event recap|wins? (?:an?|the) award/iu;
const promotion = /品牌上新|新品上市|新品发布|开业大吉|开业庆典|战略签约|品牌官宣|招商加盟|扫码领取|立即下单|限时优惠|限时抢购|\b(?:launch event|press invitation|buy now|limited.time offer)\b/iu;
const newsBrief = /(?:^|[【｜|])\s*(?:每日快讯|行业快讯|资讯速递|新闻速递|每日新闻|行业日报|早报|晚报|一周要闻)\s*(?:$|[：:｜|】])/u;
const macro = /社会消费品零售总额|国内生产总值|国民经济运行|经济运行总体|宏观经济|居民消费价格|\b(?:gross domestic product|macroeconomic|consumer price index)\b/iu;
const genericRetail = /零售|消费趋势|\b(?:retail|consumer trends?)\b/iu;

export function researchTopicPriority(title:string) {
  return topics.some(topic=>topic.match.test(title))?2:category.test(title)?1:0;
}

export function evaluateResearchValue(item:Pick<NewsItem,'title'|'excerpt'|'url'|'research'|'evidenceKind'>) {
  const {title,excerpt,research}=item;
  const text=`${title} ${excerpt}`;
  const sentences=excerpt.split(/[。！？；\n]/u);
  const evidence=sentences.filter(sentence=>qualitativeFinding.test(sentence)||(measuredFinding.test(sentence)&&metric.test(sentence)));
  const topicMatches=topics.filter(topic=>topic.match.test(title)||evidence.some(sentence=>topic.match.test(sentence))).sort((a,b)=>
    Number(b.match.test(title))-Number(a.match.test(title)));
  const hasMetric=evidence.some(sentence=>metric.test(sentence));
  const hasFinding=evidence.some(sentence=>qualitativeFinding.test(sentence));
  const hasScope=Boolean(research?.dataPeriod)||sentences.some(sentence=>scope.test(sentence));
  const hasCategory=category.test(text);
  const domestic=china.test(text)||/\bchina\b/iu.test(new URL(item.url).pathname);
  const unverifiedSummary=item.evidenceKind==='source_summary'&&!/^(官方|公开)(研究|报告)摘要/u.test(research?.kind??'');
  if(unverifiedSummary||repost.test(title)||repost.test(excerpt)||event.test(title)||promotion.test(title)||newsBrief.test(title)||macro.test(title)||
    (!topicMatches.length&&!hasCategory&&!genericRetail.test(title))||(!hasMetric&&!hasFinding)) {
    return {eligible:false,priority:0,reason:undefined,application:undefined};
  }

  const subject=[...(domestic?['中国市场']:[]),...topicMatches.slice(0,2).map(topic=>topic.label)].join('、');
  const basis=[...(hasCategory?['品类信息']:[]),hasMetric?'量化数据':'研究观察',...(hasScope?['数据范围或口径']:[])].join('、');
  const material=research?.pdfUrl?'报告 PDF 摘页':/摘要|介绍/u.test(research?.kind??'')?'公开报告摘要':'研究正文摘录';
  const reason=`${material}${subject?`涉及${subject}，`:''}提供${basis}。`;
  const priority=topicMatches.length?(hasMetric?8:4)+Number(hasScope)+Number(hasCategory)+Number(domestic)*2:2+Number(domestic);
  const application=topicMatches[0]===topics[0]&&topicMatches.includes(topics[2])
    ?'同一品牌在即时零售与线下门店的畅销 SKU 重合度有多高？':topicMatches[0]?.application;
  return {eligible:true,priority,reason,application};
}
