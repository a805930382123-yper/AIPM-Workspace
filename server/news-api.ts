import type express from 'express';
import { RawIntegrityError } from '../services/raw/store.ts';
import { NewsError, NewsService } from '../services/news/service.ts';
import type { NewsSectionName } from '../services/news/types.ts';
export function registerNewsRoutes(app:express.Express,service:NewsService){
 const guard:express.RequestHandler=(req,res,next)=>{const host=req.get('host')||'',origin=req.get('origin');let local=false;try{const u=new URL(`http://${host}`);local=['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.host===host.toLowerCase();}catch{}const allowed=new Set(['http://127.0.0.1:5173','http://localhost:5173',`http://${host}`]);if(process.env.FMCG_UI_ORIGIN)allowed.add(process.env.FMCG_UI_ORIGIN.replace(/\/$/u,''));if(!local||origin==='null'||(origin&&!allowed.has(origin.replace(/\/$/u,'')))||req.get('sec-fetch-site')==='cross-site'){res.status(403).json({error:{message:'仅允许本机可信页面操作资讯。'}});return;}if(!req.is('application/json')){res.status(415).json({error:{message:'请使用 JSON 请求。'}});return;}next();};
 const handle=(work:(req:express.Request)=>Promise<unknown>):express.RequestHandler=>async(req,res)=>{try{res.json(await work(req));}catch(e){res.status(e instanceof NewsError?e.status:e instanceof RawIntegrityError?409:500).json({error:{message:e instanceof NewsError||e instanceof RawIntegrityError?e.message:'资讯读取失败。'}});}};
 app.get('/api/news/today',handle(()=>service.today()));app.get('/api/news/history',handle(()=>service.history()));app.get('/api/news/editions/:date',handle(async req=>{const x=await service.edition(String(req.params.date));if(!x)throw new NewsError('没有找到这期资讯。',404);return x;}));
 app.get('/api/news/editions/:date/saved-raws',handle(req=>service.savedRaws(String(req.params.date))));
 app.post('/api/news/editions/:date/translations',guard,handle(req=>{
  const body=req.body;
  if(!body||!Array.isArray(body.itemIds)||Object.keys(body).length!==1||!body.itemIds.length||body.itemIds.length>40||
   !body.itemIds.every((id:unknown)=>typeof id==='string'&&id.trim().length>0&&id.length<=256)) {
   throw new NewsError('请求格式无效。',400);
  }
  return service.translate(String(req.params.date),body.itemIds);
 }));
 app.post('/api/news/editions/:date/items/save-raw',guard,handle(req=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||!['fmcg','ai'].includes(req.body.section)||typeof req.body.itemId!=='string'||!req.body.itemId||Object.keys(req.body).some(k=>!['section','itemId'].includes(k)))throw new NewsError('请求格式无效。',400);return service.saveRaw(String(req.params.date),req.body.section,req.body.itemId);}));
 app.post('/api/news/today/ensure',guard,handle(req=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).length)throw new NewsError('请求格式无效。',400);return service.ensure();}));
 app.post('/api/news/today/check',guard,handle(req=>{
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||!['fmcg','ai'].includes(body.section)||
   !['all','failed'].includes(body.mode)||(body.mode==='failed'&&body.section!=='fmcg')||
   !Number.isSafeInteger(body.attempt)||body.attempt<0||Object.keys(body).some(key=>!['section','mode','attempt'].includes(key))) {
   throw new NewsError('请求格式无效。',400);
  }
  return service.check(body.section,body.mode,body.attempt);
 }));
 app.post('/api/news/today/retry',guard,handle(req=>{if(!req.body||!['fmcg','ai'].includes(req.body.section)||!Number.isInteger(req.body.attempt)||Object.keys(req.body).some(k=>!['section','attempt'].includes(k)))throw new NewsError('请求格式无效。',400);return service.retry(req.body.section as NewsSectionName,req.body.attempt);}));
}
