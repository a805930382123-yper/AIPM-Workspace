import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { RawStore } from '../services/raw/store.ts';
import { WikiStore } from '../services/wiki/store.ts';
import { PromptStore } from '../services/prompt/store.ts';
import { PromptAiService, TEMPLATES } from '../services/prompt-ai/service.ts';
test('真实服务 fake 链仅发送用户 Brief 与显选 Wiki，显式确认才保存', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeos-l4-test-'));
  try {
    const raws = new RawStore(root);
    await raws.initialize();
    const wiki = new WikiStore(root, raws);
    await wiki.initialize();
    const prompts = new PromptStore(root, wiki);
    await prompts.initialize();
    const sent: any[] = [];
    const brief = {
      taskName: '虚构任务',
      taskType: '客户访谈',
      role: '待用户补充',
      goal: '目标',
      context: '待用户补充',
      input: '待用户提供',
      tasks: '追问',
      constraints: '不得编造',
      output: '问题',
    };
    const content = {
      version: 1,
      name: '虚构提示',
      category: 'customer',
      scenario: '虚构场景',
      sections: [{ heading: '目标', content: '按用户要求处理' }],
      inputRequirements: '输入',
      outputRequirements: '输出',
      examples: '',
      tags: [],
    };
    const provider = {
      name: 'fake',
      model: 'fake',
      secrets: [],
      complete: async (r: any) => {
        sent.push({ system: r.system, user: JSON.parse(r.user) });
        const text = JSON.stringify(r.system.includes('结构化 Prompt Brief') ? brief : content);
        return { text, bytes: Buffer.byteLength(text), finishReason: 'stop' as const };
      },
    };
    const ai = new PromptAiService(root, wiki, prompts, () => provider);
    await ai.initialize();
    const template = await ai.brief('原任务', 'customer_interview');
    assert.deepEqual(template.brief, brief);
    assert.deepEqual(sent[0].user, { task: '原任务', template: 'customer_interview', templates: TEMPLATES });
    const common = {
      type: 'concept' as const,
      category: 'industry_basics',
      tags: [],
      aliases: [],
      knowledge_status: 'needs_verification' as const,
      confidence: 'low' as const,
      source_level: 'D' as const,
      review_status: 'unreviewed' as const,
    };
    const selected = await wiki.create({ ...common, title: '已选', sources: [], body: '选中材料' });
    await wiki.create({ ...common, title: '未选', sources: [], body: '未选内容不得发送' });
    const raw = await raws.create({
      title: '会议原料',
      sourceType: 'other',
      sourceName: '测试',
      body: '受限正文',
      tags: [],
    });
    const restricted = await wiki.create({ ...common, title: '受限 Wiki', sources: [raw.id], body: '受限背景' });
    await raws.delete(raw.id);
    await raws.createMeetingRegistration({
      id: raw.id,
      title: raw.title,
      sourceName: raw.sourceName,
      tags: raw.tags,
      body: raw.body,
      importedAt: raw.importedAt,
      origin: {
        kind: 'meeting',
        meeting_id: randomUUID(),
        import_id: randomUUID(),
        original_sha256: createHash('sha256').update(raw.body).digest('hex'),
        registered_confidentiality: 'Internal',
        processing_policy: 'meeting_local_only',
      },
    });
    const edited = { ...brief, goal: '用户明确目标' };
    const generated = await ai.generate(edited, [selected.id]);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].user.brief, edited);
    assert.deepEqual(
      sent[1].user.relatedWiki.map((x: any) => x.id),
      [selected.id],
    );
    assert.doesNotMatch(JSON.stringify(sent[1]), /未选内容不得发送|填写建议|经销商访谈准备/);
    assert.equal(await prompts.count(), 0);
    await assert.rejects(() => ai.generate(edited, [restricted.id]));
    assert.equal(sent.length, 2);
    const saved = await ai.confirm(generated.draftId, generated.draftId, 'new', {
      ...generated.preview,
      body: '用户编辑后的正文',
    });
    assert.equal(saved.prompt.version, 1);
    assert.equal(saved.prompt.favorite, false);
    assert.equal((await prompts.get(saved.prompt.id))?.body, '用户编辑后的正文');
    assert.equal((await prompts.getVersions(saved.prompt.id))[0].version, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
