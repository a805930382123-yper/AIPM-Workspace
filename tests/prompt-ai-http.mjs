import { withoutInheritedEmbeddings } from './support/isolated-embedding-env.mjs';
// B08 builder-only public HTTP smoke. Starts an isolated API and OpenAI-compatible fake provider.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';

const brief = {
  taskName: '经销商访谈',
  taskType: '客户访谈',
  role: '快消产品经理',
  goal: '还原订货流程',
  context: '首次访谈',
  input: '访谈材料',
  tasks: '询问流程',
  constraints: '不虚构',
  output: '流程与问题',
};
const preview = {
  name: '经销商访谈提纲',
  category: 'customer',
  scenario: '首次访谈',
  body: '请分析订货流程 {{访谈材料}}',
  inputRequirements: '访谈材料',
  outputRequirements: '流程与问题',
  relatedWikiIds: [],
  examples: '',
  tags: ['访谈'],
  favorite: false,
};
const checks = [
  ['goal', 'present'],
  ['role', 'present'],
  ['context', 'missing'],
  ['input', 'present'],
  ['tasks', 'present'],
  ['constraints', 'missing'],
  ['output', 'missing'],
  ['fact_inference', 'missing'],
  ['anti_fabrication', 'missing'],
].map(([id, status]) => ({ id, status, evidence: '测试证据' }));
const fake = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const system = payload.messages.find((x) => x.role === 'system')?.content ?? '';
  let content;
  if (system.includes('整理为结构化 Prompt Brief')) content = brief;
  else if (system.includes('逐维度检查 Prompt'))
    content = {
      checks,
      improvements: checks
        .filter((x) => x.status === 'missing')
        .map((x) => ({ dimensionId: x.id, issue: '缺项', action: '补充' })),
      preview,
    };
  else if (system.includes('确认的 Brief')) content = { preview };
  else throw new Error(`unexpected provider prompt: ${system.slice(0, 80)}`);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }));
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const fakePort = fake.address().port;
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const apiPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const root = await mkdtemp(path.join(process.cwd(), '.test-data-prompt-ai-http-'));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: withoutInheritedEmbeddings({
    ...process.env,
    FMCG_DATA_DIR: root,
    FMCG_PORT: String(apiPort),
    FMCG_LLM_BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
    FMCG_LLM_MODEL: 'b08-fake',
    FMCG_LLM_API_KEY: 'b08-test-key',
  }),
});
let logs = '';
child.stdout.on('data', (x) => (logs += x));
child.stderr.on('data', (x) => (logs += x));
const base = `http://127.0.0.1:${apiPort}`;
async function call(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
let stopError;
try {
  let healthy = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`API exited early: ${logs}`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(healthy, `isolated API failed to start: ${logs}`);
  const schema = await call('/api/prompt-ai/schema');
  assert.equal(schema.checks.length, 9);
  assert.equal(schema.templates.length, 7);
  const briefResult = await call('/api/prompt-ai/brief', {
    task: '第一次访谈经销商订货流程',
    template: 'customer_interview',
  });
  assert.equal(briefResult.brief.goal, brief.goal);
  const generated = await call('/api/prompt-ai/generate', {
    brief: { ...brief, goal: '实际修改后的目标' },
    relatedWikiIds: [],
  });
  assert.equal(generated.preview.body, preview.body);
  assert.equal((await call('/api/prompts')).items.length, 0);
  const optimized = await call('/api/prompt-ai/optimize', { body: '分析业务流程' });
  assert.equal(optimized.checks.length, 9);
  assert.equal(optimized.originalBody, '分析业务流程');
  const saved = await call(`/api/prompt-ai/drafts/${generated.draftId}/confirm`, {
    requestId: generated.draftId,
    mode: 'new',
    input: { ...preview, body: '用户确认的正文' },
  });
  assert.equal(saved.prompt.source, 'ai_generated');
  const retried = await call(`/api/prompt-ai/drafts/${generated.draftId}/confirm`, {
    requestId: generated.draftId,
    mode: 'new',
    input: { ...preview, body: '用户确认的正文' },
  });
  assert.equal(retried.reused, true);
  assert.equal((await call('/api/prompts')).items.length, 1);
  const stale = await fetch(`${base}/api/prompt-ai/drafts/${optimized.draftId}/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: generated.draftId, mode: 'version', input: preview }),
  });
  assert.equal(stale.status, 400);
  console.log(
    JSON.stringify({
      status: 'PASS',
      api: 'isolated public HTTP',
      schemaChecks: 9,
      brief: true,
      generate: true,
      optimize: true,
      explicitConfirm: true,
      idempotentRetry: true,
      libraryCount: 1,
      staleBindingStatus: stale.status,
      childPid: child.pid,
    }),
  );
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  await new Promise((resolve) => fake.close(resolve));
  await rm(root, { recursive: true, force: true });
  if (child.exitCode === null) {
    let alive = true;
    try {
      process.kill(child.pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') alive = false;
    }
    if (alive) stopError = new Error(`could not stop own API process ${child.pid}`);
  }
}
if (stopError) throw stopError;
