// Test support: an independent fake HTTP provider (OpenAI-compatible Chat Completions shape).
// Tests point the real `OpenAiCompatibleProvider` at this server, so the product code path that
// calls a provider is exercised for real; nothing in `services/` knows about this file.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeRequest = { model: string; system: string; user: string; index: number; authorization: string | null };
export type FakeReply =
  | { kind: 'content'; content: string; finishReason?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  | { kind: 'status'; status: number; body?: unknown }
  | { kind: 'raw'; body: string; status?: number }
  | { kind: 'delay'; ms: number; content?: string };

type FakeRun = { rawId: string; pageForFact: Map<string, Array<{ title: string; type: string; category: string; documentTitle: string }>>; pageForQuestion: Map<string, string[]>; factTexts: string[]; questionTexts: string[]; planned: boolean; chunksSeen: Set<number> };

export type FakeProvider = {
  url: string;
  requests: FakeRequest[];
  /** Highest number of simultaneously in-flight requests this server observed (budget evidence). */
  maxConcurrent: number;
  close: () => Promise<void>;
  setHandler: (handler: (request: FakeRequest) => FakeReply) => void;
  /** Controls the F04-11 document-merge answer; defaults to a summary covering every chunk. */
  setMergeHandler: (handler: (request: FakeRequest) => FakeReply) => void;
};

export async function startFakeProvider(handler: (request: FakeRequest) => FakeReply): Promise<FakeProvider> {
  let current = handler;
  let mergeHandler: (request: FakeRequest) => FakeReply = request => ({ kind: 'content', content: contentOf(buildMergePayload(request.user)) });
  const requests: FakeRequest[] = [];
  const runs: FakeRun[] = [];
  let inFlight = 0;
  let maxConcurrent = 0;
  const server = http.createServer((req, res) => {
    inFlight += 1;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    res.on('close', () => { inFlight -= 1; });
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let payload: { model?: unknown; messages?: Array<{ role?: string; content?: string }> } = {};
      try { payload = JSON.parse(raw) as typeof payload; } catch { /* keep empty */ }
      const messages = payload.messages ?? [];
      const request: FakeRequest = {
        model: typeof payload.model === 'string' ? payload.model : '',
        system: messages.find(message => message.role === 'system')?.content ?? '',
        user: messages.find(message => message.role === 'user')?.content ?? '',
        index: requests.length,
        authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
      };
      requests.push(request);
      let reply: FakeReply;
      try {
        if (isKb02Extraction(request.user)) {
          const adapted = adaptKb02ExtractionRequest(request);
          const rawId = rawIdFromPrompt(adapted.user);
          const chunk = chunkFromPrompt(adapted.user);
          let run = [...runs].reverse().find(item => item.rawId === rawId && !item.planned && !item.chunksSeen.has(chunk.index));
          if (!run) {
            const superseded = [...runs].reverse().find(item => item.rawId === rawId && !item.planned && item.chunksSeen.has(chunk.index));
            if (superseded) superseded.planned = true;
            run = { rawId, pageForFact: new Map(), pageForQuestion: new Map(), factTexts: [], questionTexts: [], planned: false, chunksSeen: new Set() }; runs.push(run);
          }
          run.chunksSeen.add(chunk.index);
          let extracted = current(adapted);
          if (extracted.kind === 'delay') { const { ms, content } = extracted; await new Promise(resolve => setTimeout(resolve, ms)); extracted = { kind: 'content', content: content ?? '{}' }; }
          reply = toKb02FactsReply(extracted, request, run);
        } else if (isKb02Planning(request.user)) {
          const payload = parseKb02Planning(request);
          const sameTextSet = (left:string[],right:string[]) => left.length===right.length && [...left].sort().every((value,index)=>value===[...right].sort()[index]);
          const run = runs.find(item => !item.planned && sameTextSet(item.factTexts,payload.facts.map(fact=>fact.text)) && sameTextSet(item.questionTexts,payload.questions.map(question=>question.text)));
          if (!run) throw new Error('fake provider could not match planning input to an extraction run');
          run.planned = true;
          const adapted = adaptKb02PlanningRequest(request, run);
          try { let planned = mergeHandler(adapted); if (planned.kind === 'delay') { const { ms, content } = planned; await new Promise(resolve => setTimeout(resolve, ms)); planned = { kind: 'content', content: content ?? '{}' }; } reply = toKb02PlanReply(planned, request, run); }
          catch (error) { throw error; }
        } else reply = current(request);
      } catch (error) { reply = { kind: 'status', status: 500, body: { error: { message: String(error) } } }; }
      if (reply.kind === 'delay') {
        const { ms, content } = reply;
        await new Promise(resolve => setTimeout(resolve, ms));
        reply = { kind: 'content', content: content ?? '{}' };
      }
      if (reply.kind === 'status') {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body ?? { error: { message: `fake status ${reply.status}` } }));
        return;
      }
      if (reply.kind === 'raw') {
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
        res.end(reply.body);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: `fake-${request.index}`, object: 'chat.completion', model: request.model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply.content }, finish_reason: reply.finishReason ?? 'stop' }],
        usage: reply.usage ?? { prompt_tokens: 100, completion_tokens: 200 },
      }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    get maxConcurrent() { return maxConcurrent; },
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); }),
    setHandler: next => { current = next; },
    setMergeHandler: next => { mergeHandler = next; },
  };
}

/** Extracts the chunk the service sent, using the prompt contract of services/llm/service.ts. */
export function chunkFromPrompt(user: string): { index: number; start: number; end: number; text: string } {
  const at = /本次只提供第 (\d+) 段，覆盖原文全局区间 \[(\d+), (\d+)\)/.exec(user);
  const body = /<<<\n([\s\S]*?)\n>>>\s*$/.exec(user);
  if (!at || !body) throw new Error('fake provider could not read the chunk prompt');
  return { index: Number(at[1]) - 1, start: Number(at[2]), end: Number(at[3]), text: body[1] };
}

export function rawIdFromPrompt(user: string): string {
  const match = /当前 Raw ID：([^\s（]+)/.exec(user);
  if (!match) throw new Error('fake provider could not read the rawId');
  return match[1];
}

/** The F04-11 structured merge request: one entry per chunk with its complete page results. */
export type FakeMergeEntry = {
  chunk: number;
  chunkRange: { start: number; end: number };
  document: { title: string; main_topic: string; summary: string };
  pages: Array<{
    title: string; type: string; category: string; one_line_definition: string;
    source_facts: Array<{ text: string; evidence: Array<{ id: string; rawId?: string; quote?: string; start?: number; end?: number; chunkIndex?: number }> }>;
    ai_organized: string[]; ai_inferences: string[]; open_questions: string[]; related_pages: string[];
  }>;
};
export function isMergePrompt(user: string): boolean { return user.includes('完整结构化结果') && user.includes('"chunkRange"'); }
export function isPlanningPrompt(user: string): boolean { return isKb02Planning(user); }
export function planningPayloadFromPrompt(user: string): { facts: Array<{id:string;text:string}>; questions: Array<{id:string;text:string}> } {
  return parseKb02Planning({ user } as FakeRequest);
}
export function mergeEntriesFromPrompt(user: string): FakeMergeEntry[] {
  const start = user.indexOf('[{');
  if (start < 0) throw new Error('fake provider could not read the merge payload');
  return JSON.parse(user.slice(start)) as FakeMergeEntry[];
}
/** A summary that provably covers every chunk (each chunk's own summary + one fact). */
export function mergeSummaryFromPrompt(user: string): string {
  const entries = mergeEntriesFromPrompt(user);
  return entries.map(entry => {
    const facts = entry.pages.flatMap(page => page.source_facts.map(fact => fact.text));
    return `第 ${entry.chunk} 段：${entry.document.summary}（${facts.join('；') || '无事实'}）`;
  }).join('\n');
}
export function buildMergePayload(user: string): unknown {
  const entries = mergeEntriesFromPrompt(user);
  return {
    document: {
      title: `合并资料-${entries.length} 段`,
      main_topic: entries.map(entry => entry.document.main_topic).join(' / ').slice(0, 300),
      summary: mergeSummaryFromPrompt(user),
    },
  };
}

/** One handler for both request kinds the extraction flow sends: per-chunk and document merge. */
export function answerExtraction(
  request: FakeRequest,
  specs: FakePageSpec[] | ((chunk: { index: number; start: number; end: number; text: string }) => FakePageSpec[]),
): FakeReply {
  if (isMergePrompt(request.user)) return { kind: 'content', content: contentOf(buildMergePayload(request.user)) };
  const chunk = chunkFromPrompt(request.user);
  const list = typeof specs === 'function' ? specs(chunk) : specs;
  return { kind: 'content', content: contentOf(buildPayloadForChunk(chunk, rawIdFromPrompt(request.user), list)) };
}

export type FakePageSpec = {
  title: string; type?: string; category?: string; one_line_definition?: string;
  quoteMode?: 'head' | 'tail' | 'whole'; addInference?: boolean;
  /** Legal provider behaviour: omit the optional start/end hint and send only id/rawId/quote. */
  omitOffsets?: boolean;
  /** Exact quote to echo (must occur once in the complete Raw for a hint-less request). */
  quoteText?: string;
  /** Exact fact text; defaults to the title-derived text (identical titles then dedupe). */
  factText?: string;
};
/**
 * Builds a schema-valid payload whose evidence quotes really exist inside the given chunk.
 * A start/end hint is included (relative to the complete Raw), which is exactly the optional
 * disambiguation the provider contract allows — necessary because test material repeats itself.
 */
export function buildPayloadForChunk(chunk: { index: number; start: number; end: number; text: string }, rawId: string, specs: FakePageSpec[]): unknown {
  const evidenceFor = (spec: FakePageSpec, pageIndex: number) => {
    const text = chunk.text;
    let quote: string;
    let offset: number;
    if (spec.quoteText) { quote = spec.quoteText; offset = text.indexOf(quote); }
    else if (spec.quoteMode === 'whole') { quote = text.slice(0, Math.min(20, text.length)); offset = 0; }
    else if (spec.quoteMode === 'tail') {
      quote = text.slice(Math.max(0, text.length - 20)).trim() || text.slice(0, 10);
      offset = text.lastIndexOf(quote);
    } else {
      quote = text.trim().slice(0, Math.min(20, text.trim().length));
      offset = text.indexOf(quote);
    }
    if (!quote) { quote = '资料'; offset = Math.max(0, text.indexOf(quote)); }
    const base = { id: `e${pageIndex + 1}`, rawId, quote };
    if (spec.omitOffsets) return base;
    return { ...base, start: chunk.start + Math.max(0, offset), end: chunk.start + Math.max(0, offset) + quote.length };
  };
  const pages = specs.map((spec, index) => {
    const evidence = evidenceFor(spec, index);
    return {
      title: spec.title,
      type: spec.type ?? 'concept',
      category: spec.category ?? 'industry_basics',
      one_line_definition: spec.one_line_definition ?? `${spec.title}的一句话说明`,
      source_facts: [{ text: spec.factText ?? `${spec.title}的原文事实`, evidenceIds: [evidence.id] }],
      ai_organized: [`对「${spec.title}」的整理`],
      ai_inferences: spec.addInference ? [`对「${spec.title}」的推断`] : [],
      related_pages: [],
      open_questions: spec.addInference ? [`「${spec.title}」待确认的问题`] : [],
      source_evidence: [evidence],
    };
  });
  return {
    document: { title: `资料${rawId.slice(0, 8)}-第 ${chunk.index + 1} 段`, main_topic: `主题${chunk.index + 1}`, summary: `第 ${chunk.index + 1} 段的摘要` },
    suggested_pages: pages,
  };
}
export const contentOf = (payload: unknown) => JSON.stringify(payload);
function isKb02Extraction(user: string): boolean { return user.includes('定位目录覆盖此 chunk'); }
function isKb02Planning(user: string): boolean { return user.includes('请对下列全部已验证事实规划知识页'); }
function kb02Catalog(request: FakeRequest): Array<{id:string;text:string}> {
  const at=request.user.indexOf('输入 locator 目录'); const start=request.user.indexOf('[',at);
  if(start<0) throw new Error('fake provider could not read the locator catalog');
  return JSON.parse(request.user.slice(start).trim()) as Array<{id:string;text:string}>;
}function adaptKb02ExtractionRequest(request: FakeRequest): FakeRequest {
  const range=/原文全局区间 \[(\d+),(\d+)\)/u.exec(request.user); const catalog=kb02Catalog(request);
  const raw=/Raw ID：([^\s;]+)/u.exec(request.user); if(!range||!raw) throw new Error('fake provider could not read KB02 extraction metadata');
  const index=Number(catalog[0]?.id.match(/^c(\d+)-/u)?.[1]??1)-1;
  const start=Number(range[1]); const end=Number(range[2]); const text=catalog.map(item=>item.text).join('');
  return {...request,user:`当前 Raw ID：${raw[1]}\n本次只提供第 ${index+1} 段，覆盖原文全局区间 [${start}, ${end})\n<<<\n${text}\n>>>`};
}
function toKb02FactsReply(reply: FakeReply, original: FakeRequest, run: FakeRun): FakeReply {
  if(reply.kind!=='content') return reply;
  let value: any; try {value=JSON.parse(reply.content);} catch {return reply;}
  if(Array.isArray(value?.facts)&&Array.isArray(value?.questions)) return reply;
  const pages=Array.isArray(value?.suggested_pages)?value.suggested_pages:[]; const catalog=kb02Catalog(original).filter(atom=>atom.text.trim());
  const selectedFacts=new Set<string>(); const selectedQuestions=new Set<string>();
  const select=(text:string,evidence:any,used:Set<string>)=>{
    const quote=typeof evidence?.quote==='string'?evidence.quote:'';
    if(quote&&!catalog.some(atom=>atom.text.includes(quote)||quote.includes(atom.text))) return undefined;
    const exact=catalog.find(atom=>atom.text===text&&!used.has(atom.id))??catalog.find(atom=>atom.text.includes(text)&&!used.has(atom.id));
    const atom=exact??catalog.find(atom=>!used.has(atom.id)&&quote&&(atom.text.includes(quote)||quote.includes(atom.text)))??catalog.find(atom=>!used.has(atom.id));
    if(atom)used.add(atom.id);return atom;
  };
  const facts:any[]=[];const questions:any[]=[];
  const secret=original.authorization?.replace(/^Bearer\s+/u,'');
  for(const page of pages){
    const evidences=Array.isArray(page?.source_evidence)?page.source_evidence:[];
    for(const fact of Array.isArray(page?.source_facts)?page.source_facts:[]){
      const ev=evidences.find((item:any)=>item.id===fact.evidenceIds?.[0]); const atom=select(String(fact.text??''),ev,selectedFacts);
      // Preserve explicit secret-in-output injection through the new native ID field.
      const atomId=secret&&String(fact.text).includes(secret)?secret:atom?.id??'unknown-atom';
      facts.push({atomId,kind:'fact'});
      if(atom){const key=`${catalog[0]?.id.match(/^c(\d+)-/u)?.[1]??'1'}\0${atom.text}`;const metas=run.pageForFact.get(key)??[];metas.push({title:String(page.title??'业务主题'),type:String(page.type??'concept'),category:String(page.category??'other'),documentTitle:String(value.document?.title??'知识主题')});run.pageForFact.set(key,metas);run.factTexts.push(atom.text);}
    }
    for(const question of Array.isArray(page?.open_questions)?page.open_questions:[]){
      const atom=select(String(question),evidences[0],selectedQuestions);questions.push({atomId:atom?.id??'unknown-atom'});
      if(atom){const key=`${catalog[0]?.id.match(/^c(\d+)-/u)?.[1]??'1'}\0${atom.text}`;run.pageForQuestion.set(key,[...(run.pageForQuestion.get(key)??[]),String(page.title??'业务主题')]);run.questionTexts.push(atom.text);}
    }
  }
  const result:any={version:2,facts,questions,sourceNotes:[]};
  for(const key of Object.keys(value??{})) if(!['document','suggested_pages','evidence_format_version'].includes(key)) result[key]=value[key];
  return {...reply,content:contentOf(result)};
}
function parseKb02Planning(request: FakeRequest): {facts:Array<{id:string;text:string}>;questions:Array<{id:string;text:string}>} {
  const start=request.user.lastIndexOf('\n')+1; return JSON.parse(request.user.slice(start)) as {facts:Array<{id:string;text:string}>;questions:Array<{id:string;text:string}>};
}
function adaptKb02PlanningRequest(request: FakeRequest, run: FakeRun): FakeRequest {
  const payload=parseKb02Planning(request); const groups=new Map<string,{title:string;type:string;category:string;facts:Array<{text:string;evidence:any[]}>;questions:string[]}>();
  const factSeen=new Map<string,number>(); const questionSeen=new Map<string,number>();
  const factMeta=(fact:{id:string;text:string})=>{const chunk=Number(fact.id.match(/^f-c(\d+)-/u)?.[1]??1);const key=`${chunk}\0${fact.text}`;const list=run.pageForFact.get(key)??[];const i=factSeen.get(key)??0;factSeen.set(key,i+1);return list[i]??list[0]??{title:'业务事实',type:'concept',category:'other',documentTitle:'知识主题'};};
  for(const fact of payload.facts){const meta=factMeta(fact);const group=groups.get(meta.title)??{title:meta.title,type:meta.type,category:meta.category,facts:[],questions:[]};group.facts.push({text:fact.text,evidence:[]});groups.set(meta.title,group);}
  for(const question of payload.questions){const list=run.pageForQuestion.get(`${Number(question.id.match(/^q-c(\d+)-/u)?.[1] ?? 1)}\0${question.text}`)??[];const questionKey=`${Number(question.id.match(/^q-c(\d+)-/u)?.[1] ?? 1)}\0${question.text}`;const i=questionSeen.get(questionKey)??0;questionSeen.set(questionKey,i+1);const title=list[i]??list[0]??groups.keys().next().value??'业务事实';const group=groups.get(title);if(group)group.questions.push(question.text);}
  const entry:FakeMergeEntry={chunk:1,chunkRange:{start:0,end:0},document:{title:'KB02 fake',main_topic:'业务 facts',summary:''},pages:[...groups.values()].map(g=>({title:g.title,type:g.type,category:g.category,one_line_definition:g.title,source_facts:g.facts.map(f=>({text:f.text,evidence:[]})),ai_organized:[],ai_inferences:[],open_questions:g.questions,related_pages:[]}))};
  return {...request,user:'完整结构化结果，document merge fake input\n'+JSON.stringify([entry])};
}
function toKb02PlanReply(reply: FakeReply, original: FakeRequest, run: FakeRun): FakeReply {
  if(reply.kind!=='content') return reply;
  let returned:any; try{returned=JSON.parse(reply.content);}catch{return reply;}
  if((returned?.version===1||returned?.version===2)&&returned?.document&&Array.isArray(returned.pages)) return reply;
  const input=parseKb02Planning(original); const base=returned?.document??{};
  const grouped=new Map<string,{title:string;type:string;category:string;factIds:string[];questionIds:string[]}>();
  const factSeen=new Map<string,number>(); const questionSeen=new Map<string,number>();
  for(const fact of input.facts){const key=`${Number(fact.id.match(/^f-c(\d+)-/u)?.[1] ?? 1)}\0${fact.text}`;const list=run.pageForFact.get(key)??[];const i=factSeen.get(key)??0;factSeen.set(key,i+1);const meta=list[i]??list[0]??{title:'业务事实',type:'concept',category:'other',documentTitle:'知识主题'};const page=grouped.get(meta.title)??{title:meta.title,type:meta.type,category:meta.category,factIds:[],questionIds:[]};page.factIds.push(fact.id);grouped.set(meta.title,page);}
  for(const question of input.questions){const key=`${Number(question.id.match(/^q-c(\d+)-/u)?.[1] ?? 1)}\0${question.text}`;const list=run.pageForQuestion.get(key)??[];const i=questionSeen.get(key)??0;questionSeen.set(key,i+1);const title=list[i]??list[0]??grouped.keys().next().value;if(title){const page=grouped.get(title);if(page)page.questionIds.push(question.id);}}
  if(!grouped.size&&input.facts.length){const page={title:'业务事实',type:'concept',category:'other',factIds:input.facts.map(x=>x.id),questionIds:[]};grouped.set(page.title,page);}
  const inferredTitle=input.facts.map(fact=>run.pageForFact.get(`${Number(fact.id.match(/^f-c(\d+)-/u)?.[1] ?? 1)}\0${fact.text}`)?.[0]?.documentTitle).find(Boolean)??'知识主题';
  return {...reply,content:contentOf({version:2,document:{title:String(base.title&&!String(base.title).startsWith('合并资料-')?base.title:inferredTitle),main_topic:String(base.main_topic??'业务事实')},pages:[...grouped.values()]})};
}

