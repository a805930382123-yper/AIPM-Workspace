import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { RawIntegrityError, type RawInput, type RawStore } from '../raw/store.ts';
import { NewsError, normalizedUrl } from './service.ts';
import type { NewsEdition, NewsItem, NewsSectionName } from './types.ts';

type Receipt={schemaVersion:1; date:string; section:NewsSectionName; itemId:string; sourceId:string; fetchedAt:string; evidenceKind:NewsItem['evidenceKind']; normalizedUrl:string; rawId:string; input:RawInput; status:'pending'|'linked'; createdAt:string; updatedAt:string; registrationId?:string};
export class NewsRawSave {
  private queue=new SerialQueue();
  constructor(private root:string,private raws:RawStore,private clock:()=>Date){}
  private file(url:string){return path.join(this.root,'state','news-saves',createHash('sha256').update(url).digest('hex')+'.json');}
  private async read(url:string):Promise<Receipt|null>{
    let data:string;try{data=await readFile(this.file(url),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
    let x:Receipt;try{x=JSON.parse(data);}catch{throw new NewsError('保存收据损坏，原文件已保留。',409);}
    if(!x||x.schemaVersion!==1||x.normalizedUrl!==url||!/^[-a-f0-9]{36}$/i.test(x.rawId)||!['pending','linked'].includes(x.status)||!x.input||typeof x.input.body!=='string'||typeof x.input.title!=='string'||!Array.isArray(x.input.tags)||!['fmcg','ai'].includes(x.section)||!['article_excerpt','source_summary'].includes(x.evidenceKind)||typeof x.date!=='string'||typeof x.itemId!=='string'||typeof x.sourceId!=='string'||typeof x.fetchedAt!=='string')throw new NewsError('保存收据无效，原文件已保留。',409);
    return x;
  }
  private async check(x:Receipt){const raw=await this.raws.get(x.rawId);if(!raw)return false;const i=x.input;if(raw.body!==i.body||raw.title!==i.title||raw.sourceType!==i.sourceType||raw.sourceName!==i.sourceName||raw.url!==i.url||raw.publishedAt!==i.publishedAt||raw.extractionNote!==i.extractionNote||JSON.stringify(raw.tags)!==JSON.stringify(i.tags))throw new RawIntegrityError();return true;}
  async save(date:string,section:NewsSectionName,item:NewsItem,registrationId?:string){return this.queue.run(async()=>{
    const url=normalizedUrl(item.url);let receipt=await this.read(url);let created=false;
    if(!receipt){const label=item.research?.kind||(item.evidenceKind==='source_summary'?'来源摘要，未核验原文':'来源正文摘录，非全文');const note=item.research?[label,`数据时期：${item.research.dataPeriod||'请以原文为准'}`,item.research.pdfUrl?`PDF：${item.research.pdfUrl}（${item.research.pageRange||'页码未提供'}）`:''].filter(Boolean).join('；'):item.evidenceKind==='source_summary'?'来源摘要，未核验原文':'来源正文摘录，非全文';const now=this.clock().toISOString();const input:RawInput={title:item.title,sourceType:'article',sourceName:item.sourceName+'（'+label+'）',url:item.url,...(item.publishedAt?{publishedAt:item.publishedAt}:{}),tags:['每日资讯',section==='fmcg'?'快消行业':'AI 前沿',label],extractionNote:note,body:item.excerpt};receipt={schemaVersion:1,date,section,itemId:item.id,sourceId:item.sourceId,fetchedAt:item.fetchedAt,evidenceKind:item.evidenceKind,normalizedUrl:url,rawId:randomUUID(),input,status:'pending',createdAt:now,updatedAt:now,...(registrationId?{registrationId}:{})};await writeJsonAtomic(this.file(url),receipt);try{await this.raws.createNewsRegistration(receipt.rawId,input);}catch{throw new NewsError('保存状态待核对，请重试。',409);}created=true;
    }else if(!await this.check(receipt)){
      if(receipt.status!=='pending'||!registrationId||receipt.registrationId!==registrationId)throw new NewsError(receipt.status==='linked'?'原 Raw 已删除。':'保存未完成且未找到 Raw，请核对保存收据。',409);
      await this.raws.createNewsRegistration(receipt.rawId,receipt.input);created=true;
    }
    if(receipt.status==='pending'){receipt.status='linked';receipt.updatedAt=this.clock().toISOString();try{await writeJsonAtomic(this.file(url),receipt);}catch{throw new NewsError('保存状态待核对，请重试。',409);}}
    return {rawId:receipt.rawId,status:'saved' as const,created,...(registrationId?{owned:receipt.registrationId===registrationId}:{})};
  });}
  async savedRawId(item: NewsItem) {
    const receipt = await this.read(normalizedUrl(item.url));
    // A receipt represents an existing source registration even after a user edits the Raw.
    return receipt && await this.raws.get(receipt.rawId) ? receipt.rawId : undefined;
  }
  async projection(edition:NewsEdition){const items:Array<{section:NewsSectionName;itemId:string;rawId:string;status:'saved'|'missing'|'pending'}>=[];for(const section of ['fmcg','ai'] as const)for(const item of [...(edition.sections[section]?.items||[]),...(section==='fmcg'?edition.legacyFmcg?.items||[]:[])]){const receipt=await this.read(normalizedUrl(item.url));if(receipt){const exists=await this.check(receipt);items.push({section,itemId:item.id,rawId:receipt.rawId,status:receipt.status==='pending'?'pending':exists?'saved':'missing'});}}return {items};}
}
