import type { Express } from 'express';
import type { RawStore } from '../services/raw/store.ts';
import type { WikiStore } from '../services/wiki/store.ts';
import type { ExtractionRunner } from '../services/llm/jobs.ts';
import type { PromptStore } from '../services/prompt/store.ts';
import {periodReview,validReviewDate} from '../services/home/review.ts';
import { homeActions, type HomeKind } from '../services/home/actions.ts';
export function registerHomeRoutes(app:Express,deps:{root:string;raws:RawStore;wiki:WikiStore;runner:ExtractionRunner;prompts?:PromptStore}) {
 app.get('/api/home/review',async(req,res)=>{const {start,end}=req.query;if(!validReviewDate(start)||!validReviewDate(end)||start>=end)return res.status(400).json({error:{message:'请输入有效日期，开始日期须早于结束日期。'}});if(!deps.prompts)return res.status(503).json({error:{message:'回顾服务不可用。'}});return res.json(await periodReview({...deps,prompts:deps.prompts},start,end));});
 app.get('/api/home/actions',async(_req,res)=>res.json(await homeActions(deps)));
 app.get('/api/home/actions/:kind/:id',async(req,res)=>{const kind=req.params.kind as HomeKind;if(!['raw-task','draft','workflow','audit'].includes(kind))return res.status(404).json({error:{message:'事项不存在。'}});const result=await homeActions(deps);if(result.sources[kind].status==='error')return res.status(503).json({error:{message:'来源读取失败，请刷新后重试。'}});const item=result.items.find(x=>x.kind===kind&&x.id===req.params.id);if(!item||item.target.missing)return res.status(410).json({error:{message:'事项或关联目标已处理或删除，请刷新。'}});if(req.query.versionToken!==item.versionToken)return res.status(409).json({error:{message:'事项已变化，请刷新后重新查看。'}});return res.json(item);});
}
