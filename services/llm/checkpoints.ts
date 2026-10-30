import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir, readdir, open } from 'node:fs/promises';
import { SerialQueue, writeJsonAtomic } from '../storage/files.ts';
import { LlmError } from './provider.ts';
import { FROZEN_BUDGETS } from './rules.ts';
import { validCoverageDiagnostic, type CoverageDiagnostic } from './knowledge-atoms.ts';
import { MAX_EVIDENCE_LOCATORS_PER_CHUNK } from './locators.ts';
import { templateSections, type TemplateFieldKey } from '../wiki/template-fields.ts';
import { validDeepState, deepCallLimit, type DeepState } from './knowledge-deep.ts';

export const KB02_PIPELINE_VERSION = 'kb02-2';
export const knowledgeCallLimit = (chunkCount: number) => Math.min(128, 2 * chunkCount + 4);
export type CheckpointFact = { id: string; text: string; locatorIds: string[]; chunkIndex: number; atomId?: string; kind?: 'fact' | 'ambiguous' };
export type CheckpointQuestion = { id: string; text: string; locatorIds: string[]; chunkIndex: number; atomId?: string };
export type CheckpointEvidence = { id: string; rawId: string; quote: string; start: number; end: number; chunkIndex: number };
export type CheckpointChunk = { index: number; start: number; end: number; facts: CheckpointFact[]; questions: CheckpointQuestion[]; evidence: CheckpointEvidence[]; sourceNotes?: Array<{ atomId: string; text: string; locatorIds: string[]; chunkIndex: number }> };
export type PlannedTemplateFields = Partial<Record<TemplateFieldKey, { text: string; factIds: string[] }>>;
export type KnowledgePlan = { document: { title: string; main_topic: string; summary: string; source_level?: 'A' | 'B' | 'C' | 'D' }; pages: Array<{ title: string; type: string; category: string; factIds: string[]; questionIds: string[]; templateFields?: PlannedTemplateFields }> };
export const checkpointCallLimit = (cp: Pick<ExtractionCheckpoint,'pipelineVersion'|'chunks'>) => cp.pipelineVersion==='kb03-1'?deepCallLimit(cp.chunks.length):knowledgeCallLimit(cp.chunks.length);
export type ExtractionCheckpoint = {
  mode?: 'standard'|'deep'; deep?: DeepState;
  version: 1; jobId: string; rawId: string; rawSha256: string; pipelineVersion: string; rulesVersion: string;
  providerIdentity: string; chunks: Array<{ index: number; start: number; end: number }>;
  completedChunks: CheckpointChunk[]; plan?: KnowledgePlan; draftId?: string;
  attempts: number; stage: 'extracting' | 'planning' | 'assembling' | 'done';
  lastError?: { code: string; message: string; at: string; diagnostic?: CoverageDiagnostic }; updatedAt: string; integrity: string;
};
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = Math.ceil(FROZEN_BUDGETS.maxRawChars / (FROZEN_BUDGETS.maxChunkChars - FROZEN_BUDGETS.chunkOverlap));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unsigned = (value: ExtractionCheckpoint) => { const { integrity: _integrity, ...rest } = value; return rest; };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasKeys = (value: unknown, required: string[], optional: string[] = []) => isObject(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const isText = (value: unknown, max: number, nonempty = true): value is string => typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0);
const validCheckpoint = (value: unknown, id: string): value is ExtractionCheckpoint => {
  if (!hasKeys(value, ['version','jobId','rawId','rawSha256','pipelineVersion','rulesVersion','providerIdentity','chunks','completedChunks','attempts','stage','updatedAt','integrity'], ['plan','draftId','lastError','mode','deep'])) return false;
  const cp = value as Record<string, any>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (cp.version !== 1 || cp.jobId !== id || !isText(cp.rawId, 64) || !uuid.test(cp.rawId) || !/^[0-9a-f]{64}$/iu.test(String(cp.rawSha256)) || !['kb02-1', KB02_PIPELINE_VERSION,'kb03-1'].includes(cp.pipelineVersion) || !isText(cp.rulesVersion, 256) || !isText(cp.providerIdentity, 512) || !Number.isSafeInteger(cp.attempts) || (cp.attempts as number) < 0 || !['extracting','planning','assembling','done'].includes(String(cp.stage)) || !isText(cp.updatedAt, 40) || !/^[0-9a-f]{64}$/iu.test(String(cp.integrity))) return false;
  if (!Array.isArray(cp.chunks) || cp.chunks.length < 1 || cp.chunks.length > MAX_CHUNKS || cp.chunks.some((chunk, i) => !hasKeys(chunk, ['index','start','end']) || chunk.index !== i || !Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end) || (chunk.start as number) < 0 || (chunk.end as number) <= (chunk.start as number))) return false;
  if (!Array.isArray(cp.completedChunks) || cp.completedChunks.length > cp.chunks.length) return false;
  let factCount = 0; let questionCount = 0; let evidenceCount = 0; const seen = new Set<number>();
  for (const chunk of cp.completedChunks) {
    if (!hasKeys(chunk, ['index','start','end','facts','questions','evidence'], ['sourceNotes']) || !Number.isSafeInteger(chunk.index) || !Number.isSafeInteger(chunk.start) || !Number.isSafeInteger(chunk.end) || !Array.isArray(chunk.facts) || chunk.facts.length > 32 || !Array.isArray(chunk.questions) || chunk.questions.length > 16 || !Array.isArray(chunk.evidence) || chunk.evidence.length > 256) return false;
    const descriptor = (cp.chunks as Array<Record<string, unknown>>)[chunk.index as number];
    if (!descriptor || seen.has(chunk.index as number) || descriptor.start !== chunk.start || descriptor.end !== chunk.end) return false;
    seen.add(chunk.index as number); factCount += chunk.facts.length; questionCount += chunk.questions.length; evidenceCount += chunk.evidence.length;
    for (const fact of chunk.facts) if (!hasKeys(fact, ['id','text','locatorIds','chunkIndex'], ['atomId','kind']) || !/^f-c\d+-\d+$/u.test(String(fact.id)) || !isText(fact.text, 2000) || !Array.isArray(fact.locatorIds) || fact.locatorIds.length < 1 || fact.locatorIds.length > 256 || fact.locatorIds.some((v: unknown) => !isText(v, 64)) || fact.chunkIndex !== chunk.index) return false;
    for (const question of chunk.questions) if (!hasKeys(question, ['id','text','locatorIds','chunkIndex'], ['atomId']) || !/^q-c\d+-\d+$/u.test(String(question.id)) || !isText(question.text, 1000) || !Array.isArray(question.locatorIds) || question.locatorIds.length < 1 || question.locatorIds.length > 256 || question.locatorIds.some((v: unknown) => !isText(v, 64)) || question.chunkIndex !== chunk.index) return false;
    if (['kb03-1',KB02_PIPELINE_VERSION].includes(cp.pipelineVersion) && (!Array.isArray(chunk.sourceNotes) || chunk.sourceNotes.length > 32 || chunk.sourceNotes.some((note: any) => !hasKeys(note, ['atomId','text','locatorIds','chunkIndex']) || !isText(note.atomId, 64) || !isText(note.text, 2000) || !Array.isArray(note.locatorIds) || note.locatorIds.length < 1 || note.locatorIds.some((id: unknown) => !isText(id, 64)) || note.chunkIndex !== chunk.index) || chunk.facts.some((fact: any) => !isText(fact.atomId, 64) || !['fact','ambiguous'].includes(fact.kind)) || chunk.questions.some((question: any) => !isText(question.atomId, 64)))) return false;
    for (const evidence of chunk.evidence) if (!hasKeys(evidence, ['id','rawId','quote','start','end','chunkIndex']) || !/^c\d+-l\d+$/u.test(String(evidence.id)) || evidence.rawId !== cp.rawId || !isText(evidence.quote, 512) || !Number.isSafeInteger(evidence.start) || !Number.isSafeInteger(evidence.end) || (evidence.start as number) < (chunk.start as number) || (evidence.end as number) > (chunk.end as number) || (evidence.end as number) <= (evidence.start as number) || evidence.chunkIndex !== chunk.index) return false;
  }
  if (factCount > 256 || questionCount > 128 || evidenceCount > MAX_CHUNKS * MAX_EVIDENCE_LOCATORS_PER_CHUNK) return false;
  if (cp.draftId !== undefined && !uuid.test(String(cp.draftId))) return false;
  if (cp.lastError !== undefined && (!hasKeys(cp.lastError, ['code','message','at'], ['diagnostic']) || !isText(cp.lastError.code, 128) || !isText(cp.lastError.message, 2000, false) || !isText(cp.lastError.at, 40) || (cp.lastError.diagnostic !== undefined && !validCoverageDiagnostic(cp.lastError.diagnostic)))) return false;
  if (cp.plan !== undefined) {
    const plan = cp.plan;
    if (!hasKeys(plan, ['document','pages']) || !hasKeys(plan.document, ['title','main_topic','summary'], ['source_level']) || !isText(plan.document.title, 300) || !isText(plan.document.main_topic, 300) || !isText(plan.document.summary, 4000) || (plan.document.source_level !== undefined && !['A','B','C','D'].includes(plan.document.source_level)) || !Array.isArray(plan.pages) || plan.pages.length < 1 || plan.pages.length > 50) return false;
    for (const page of plan.pages) {
      if (!hasKeys(page, ['title','type','category','factIds','questionIds'], ['templateFields']) || !isText(page.title, 200) || !isText(page.type, 64) || !isText(page.category, 64) || !Array.isArray(page.factIds) || page.factIds.length < 1 || page.factIds.length > 256 || page.factIds.some((v: unknown) => !isText(v, 64)) || !Array.isArray(page.questionIds) || page.questionIds.length > 128 || page.questionIds.some((v: unknown) => !isText(v, 64))) return false;
      if (page.templateFields !== undefined && (!isObject(page.templateFields) || Object.entries(page.templateFields).some(([key, field]) => !templateSections(page.type).some(section => section.key === key) || !isObject(field) || !hasKeys(field, ['text', 'factIds']) || !isText(field.text, 4000) || !Array.isArray(field.factIds) || !field.factIds.length || field.factIds.length > 256 || new Set(field.factIds).size !== field.factIds.length || field.factIds.some((id: unknown) => !isText(id, 64) || !page.factIds.includes(id))))) return false;
    }
  }
  if (cp.plan !== undefined && (cp.completedChunks.length !== cp.chunks.length || cp.completedChunks.some((chunk: Record<string, unknown>, index: number) => chunk.index !== index))) return false;
  if ((cp.stage === 'assembling' || cp.stage === 'done') && cp.plan === undefined) return false;
  if (cp.stage === 'done' && cp.draftId === undefined) return false;
  if(cp.pipelineVersion==='kb03-1'?(cp.mode!=='deep'||!validDeepState(cp.deep,cp as ExtractionCheckpoint)):(cp.deep!==undefined||(cp.mode!==undefined&&cp.mode!=='standard')))return false;
  if(cp.pipelineVersion==='kb03-1'&&cp.stage==='done'&&!cp.deep?.qualityReport)return false;
  return true;
};
export class ExtractionCheckpointStore {
  private queue = new SerialQueue();
  constructor(readonly root: string) {}
  private directory() { return path.join(this.root, 'state', 'extraction-checkpoints'); }
  private fileFor(id: string) { return path.join(this.directory(), `${id}.json`); }
  async initialize() { await mkdir(this.directory(), { recursive: true }); }
  async get(id: string): Promise<ExtractionCheckpoint | undefined> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) return undefined;
    const file = this.fileFor(id);
    let value: unknown;
    let handle;
    try {
      handle = await open(file, 'r');
      const buffer = Buffer.alloc(MAX_CHECKPOINT_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead > MAX_CHECKPOINT_BYTES) throw new LlmError('LLM_CHECKPOINT_CORRUPT', '提取检查点超过允许的检查点读取上限，已拒绝恢复；原记录仍保留。', 409);
      try { value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')); }
      catch { throw new LlmError('LLM_CHECKPOINT_CORRUPT', '提取检查点JSON损坏，已拒绝恢复；原记录仍保留。', 409); }
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new LlmError('LLM_CHECKPOINT_CORRUPT', '提取检查点无法读取，已拒绝恢复；原记录仍保留。', 409);
    } finally { await handle?.close().catch(() => undefined); }
    if (!validCheckpoint(value, id)) throw new LlmError('LLM_CHECKPOINT_CORRUPT', '提取检查点结构或字段超出版本化schema，已拒绝恢复；原记录仍保留。', 409);
    const record = value as ExtractionCheckpoint;
    if (record.integrity !== hash(unsigned(record))) throw new LlmError('LLM_CHECKPOINT_CORRUPT', '提取检查点完整性校验失败，已拒绝恢复；原记录仍保留。', 409);
    return record;
  }
  async list(): Promise<ExtractionCheckpoint[]> {
    const names = (await readdir(this.directory()).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; })).filter(name => name.endsWith('.json')).sort();
    const values: ExtractionCheckpoint[] = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      const value = await this.get(id);
      if (!value) throw new LlmError('LLM_CHECKPOINT_CORRUPT', '检查点目录包含无法读取的记录，已拒绝列表读取。', 409);
      values.push(value);
    }
    return values;
  }
  async save(value: Omit<ExtractionCheckpoint, 'integrity'>): Promise<ExtractionCheckpoint> {
    return this.queue.run(async () => {
      const record = this.prepare(value);
      await writeJsonAtomic(this.fileFor(value.jobId), record);
      return record;
    });
  }
  /** The same bounded validation applies before retaining a pending in-memory write. */
  prepare(value: Omit<ExtractionCheckpoint, 'integrity'>): ExtractionCheckpoint {
    const record = { ...value, updatedAt: new Date().toISOString(), integrity: '' } as ExtractionCheckpoint;
    record.integrity = hash(unsigned(record));
    if (!validCheckpoint(record, value.jobId) || Buffer.byteLength(JSON.stringify(record, null, 2) + String.fromCharCode(10), 'utf8') > MAX_CHECKPOINT_BYTES) throw new LlmError('LLM_CHECKPOINT_CORRUPT', '拒绝写入结构非法或超过持久化上限的检查点。', 409);
    return record;
  }
}


