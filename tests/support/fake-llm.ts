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
      try { reply = current(request); }
      catch (error) {
        // A handler written for per-chunk prompts also has to answer the structured merge call;
        // failure-injection handlers still win because they do not throw here.
        if (isMergePrompt(request.user) && /chunk prompt/u.test(String(error))) reply = mergeHandler(request);
        else reply = { kind: 'status', status: 500, body: { error: { message: String(error) } } };
      }
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
  const match = /rawId 填 "([^"]+)"/.exec(user);
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
export function isMergePrompt(user: string): boolean {
  return user.includes('完整结构化结果') && user.includes('"chunkRange"');
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

