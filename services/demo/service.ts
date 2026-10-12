import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RawInput } from '../raw/store.ts';
import type { WikiInput, WikiStore } from '../wiki/store.ts';
import type { PromptStore } from '../prompt/store.ts';
import type { RawStore } from '../raw/store.ts';

type DemoType = 'raw' | 'wiki' | 'prompt';
type ManifestItem = { key: string; type: DemoType; id: string; title: string; status: 'pending' | 'created' | 'deleted' };
type Manifest = { format: 'fmcg-demo-manifest'; version: 1; createdAt: string; items: ManifestItem[] };
const manifestPath = (root: string) => path.join(root, 'state', 'demo-manifest.json');
const labels = ['快消行业基础知识示例', '快速消费品 FMCG', '动销', '快消行业渠道体系', '门店补货流程', '库存周转率', '快消术语学习', '业务流程拆解', '客户会议总结', 'AI机会识别'];
const exampleTask = { title: '第一次访谈经销商负责人，了解订货流程和AI机会', task: '第一次访谈经销商负责人，了解订货流程和AI机会' };

export class DemoService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: string, private raws: RawStore, private wiki: WikiStore, private prompts: PromptStore) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> { const result = this.queue.then(fn, fn); this.queue = result.then(() => undefined, () => undefined); return result; }
  private async manifest(): Promise<Manifest | undefined> {
    try {
      const value = JSON.parse(await readFile(manifestPath(this.root), 'utf8')) as Manifest;
      if (value.format !== 'fmcg-demo-manifest' || value.version !== 1 || !Array.isArray(value.items)) throw new Error('演示清单格式无效。');
      if (value.items.length !== 10 || value.items.some(item => !item || typeof item.key !== 'string' || !['raw','wiki','prompt'].includes(item.type)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)
        || typeof item.title !== 'string' || !['pending','created','deleted'].includes(item.status))) throw new Error('演示清单条目无效；未执行导入。');
      if (new Set(value.items.map(item => item.key)).size !== 10 || new Set(value.items.map(item => item.id)).size !== 10) throw new Error('演示清单存在重复 key 或 ID；未执行导入。');
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  private async save(value: Manifest) {
    const file = manifestPath(this.root); await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); await rename(temp, file); }
    catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
  }
  async get() {
    const manifest = await this.manifest();
    const items = manifest ? await Promise.all(manifest.items.map(async item => {
      if (item.status === 'deleted') return { key: item.key, type: item.type, id: item.id, title: item.title, status: 'deleted' };
      try {
        const record = item.type === 'raw' ? await this.raws.get(item.id) : item.type === 'wiki' ? await this.wiki.get(item.id) : await this.prompts.get(item.id);
        return { key: item.key, type: item.type, id: item.id, title: item.title, status: record ? ('isDemo' in record && record.isDemo === true ? 'present' : 'conflict') : (item.status === 'created' ? 'deleted' : 'missing') };
      } catch { return { key: item.key, type: item.type, id: item.id, title: item.title, status: 'conflict' }; }
    })) : [];
    return { version: 1, imported: Boolean(manifest), items, exampleTask };
  }
  async import(confirm: unknown) {
    if (confirm !== true) throw Object.assign(new Error('请明确确认导入演示数据。'), { code: 'DEMO_CONFIRM_REQUIRED', status: 400 });
    return this.serial(async () => {
      let manifest = await this.manifest();
      if (!manifest) {
        manifest = { format: 'fmcg-demo-manifest', version: 1, createdAt: new Date().toISOString(), items: labels.map((title, index) => ({
          key: index === 0 ? 'sample-raw' : index < 6 ? `sample-wiki-${index}` : `sample-prompt-${index - 6}`,
          type: index === 0 ? 'raw' : index < 6 ? 'wiki' : 'prompt', id: randomUUID(), title, status: 'pending' as const,
        })) };
        await this.save(manifest);
      }
      const created: Array<{key:string;type:DemoType;id:string}> = [], reused: typeof created = [], deleted: typeof created = [], missing: typeof created = [], conflicts: Array<{key:string;id:string;reason:string}> = [];
      for (const item of manifest.items) {
        const ref = { key: item.key, type: item.type, id: item.id };
        if (item.status === 'deleted') { deleted.push(ref); continue; }
        try {
          const existing = item.type === 'raw' ? await this.raws.get(item.id) : item.type === 'wiki' ? await this.wiki.get(item.id) : await this.prompts.get(item.id);
          if (existing) {
            if (!('isDemo' in existing) || existing.isDemo !== true) { conflicts.push({ key: item.key, id: item.id, reason: '目标ID已被非演示记录占用。' }); continue; }
            item.status = 'created'; reused.push(ref); await this.save(manifest); continue;
          }
          if (item.status === 'created') { item.status = 'deleted'; deleted.push(ref); await this.save(manifest); continue; }
          let written: { isDemo?: boolean };
          if (item.type === 'raw') written = await this.raws.createDemo(item.id, demoRaw());
          else if (item.type === 'wiki') {
            const rawId = manifest.items[0].id;
            const data = wikiSamples()[manifest.items.indexOf(item) - 1];
            written = await this.wiki.createDemo({ ...data, sources: [rawId] }, item.id);
          } else {
            const data = promptSamples()[manifest.items.indexOf(item) - 6];
            written = (await this.prompts.createDemo(item.id, data)).prompt;
          }
          if (written.isDemo !== true) throw new Error('目标ID已被非演示记录占用；本次未覆盖该记录。');
          item.status = 'created'; created.push(ref); await this.save(manifest);
        } catch (error) {
          missing.push(ref);
          conflicts.push({ key: item.key, id: item.id, reason: error instanceof Error ? error.message : '写入失败。' });
        }
      }
      return { version: 1, created, reused, deleted, missing, conflicts, complete: conflicts.length === 0 && missing.length === 0 && manifest.items.every(item => item.status === 'created' || item.status === 'deleted') };
    });
  }
}

function demoRaw(): RawInput {
  return { title: labels[0], sourceType: 'note', sourceName: '虚构教学样本', tags: ['演示数据', '快消基础'], body: `> 【演示数据】以下内容为虚构教学示例，不代表真实公司、市场规模或经营数据。\n\n快速消费品（FMCG）通常指购买频率较高、消费周期较短的商品。零售、经销、仓配和门店执行共同影响商品能否及时到达消费者。\n\n学习时可以先识别商品、渠道、订单、库存、补货等对象，再追问每个流程由谁触发、需要什么信息、如何确认结果。本文仅用于演示资料导入和知识整理流程。` };
}
function wikiSamples(): WikiInput[] {
  const make = (title: string, type: WikiInput['type'], category: string, body: string): WikiInput => ({ title, type, category, sources: [], tags: ['演示数据'], aliases: [], knowledge_status: 'needs_verification', confidence: 'low', source_level: 'D', review_status: 'unreviewed', body: `> 【演示数据】虚构教学内容，尚未核验。\n\n${body}` });
  return [
    make('快速消费品 FMCG', 'concept', 'industry_basics', 'FMCG 是快速消费品的常用英文缩写。具体范围会因业务语境而异，应结合来源确认。'),
    make('动销', 'metric', 'metric', '动销描述商品在渠道或终端发生销售的情况。计算口径、时间范围和数据来源需要按具体业务定义。'),
    make('快消行业渠道体系', 'concept', 'channel', '渠道体系可以描述商品从生产或品牌方经由经销与零售触达消费者的路径。实际层级和职责需要逐项核实。'),
    make('门店补货流程', 'business_process', 'store', '示例步骤：识别补货需求、核对可用库存、提交订单、确认配送、收货并复核。此流程仅为教学框架，需按实际组织确认。'),
    make('库存周转率', 'metric', 'metric', '库存周转率用于描述一定期间内库存周转情况。公式、期间和成本口径必须由业务与财务定义。'),
  ];
}
function promptSamples() {
  const base = (name:string, category:string, scenario:string, body:string, tags:string[]) => ({ name, category, scenario: `【演示数据】${scenario}`, body: `> 【演示数据】虚构教学模板，请按实际情况修改。\n\n${body}`, inputRequirements: '', outputRequirements: '明确区分已知信息、整理结果和待确认问题。', relatedWikiIds: [], examples: '', tags: ['演示数据', ...tags], favorite: false });
  return [
    base('快消术语学习', 'industry_learning', '解释快消行业术语', '请面向刚入职的同事解释 {{行业术语}}。说明定义、常见业务场景和仍需确认的口径。', ['术语']),
    base('业务流程拆解', 'business_analysis', '梳理业务流程', '请把 {{业务流程}} 拆成触发条件、参与角色、步骤、输入输出、异常和待确认问题。不要补造事实。', ['流程']),
    base('客户会议总结', 'customer', '整理客户会议', '根据以下会议原文整理讨论主题、明确事实、行动项与待确认问题：\n{{会议原文}}', ['会议']),
    base('AI机会识别', 'ai', '探索AI辅助机会', '针对 {{业务场景}}，列出可验证的AI辅助机会、所需数据、人工复核点、风险和试点问题。标注为分析建议。', ['AI机会']),
  ];
}
