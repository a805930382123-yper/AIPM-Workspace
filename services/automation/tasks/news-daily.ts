import type { NewsService } from '../../news/service.ts';
import type { NewsEdition } from '../../news/types.ts';
import type { NewsPipeline } from '../pipeline/service.ts';
import { screenNews, type NewsScore } from '../pipeline/screen.ts';
import { AutomationCheckError, type TaskDefinition } from '../scheduler.ts';

export const dailyNewsType = 'news.daily';
const names = { fmcg: '快消研报', ai: 'AI 前沿' } as const;
const status = { running: '读取中', ready: '已准备', source_only: '来源材料', empty: '无合格条目', failed: '失败', interrupted: '已中断' } as const;

export function createDailyNews(news: NewsService, pipeline: NewsPipeline): TaskDefinition {
  return {
    type: dailyNewsType, name: '每日资讯准备与预筛', defaultPlan: { kind: 'daily', time: '07:30', timezone: 'Asia/Shanghai' },
    allowsCatchUp: true, mayCallModel: true, tracksSourceRequests: true,
    async execute({ signal, step, provider: activeProvider }) {
      // Reuse the current day's source preparation, including an in-flight manual page request.
      const preparation: { edition?: NewsEdition | null } = {};
      await step('准备来源资讯', async () => {
        preparation.edition = await news.ensure(true);
        return preparation.edition ? `${preparation.edition.date} 资讯来源已返回结果。` : '当日资讯记录不存在。';
      });
      const edition = preparation.edition ?? null;
      for (const section of ['fmcg', 'ai'] as const) {
        await step('来源 · ' + names[section], () => {
          const part = edition?.sections[section];
          if (!part) return '未找到当日栏目记录。';
          const health = part.sources.map(source => `${source.name} ${source.status === 'ok' ? '正常' : source.status === 'empty' ? '无条目' : '失败'}`).join('、');
          return [`${status[part.status]}，${part.items.length} 条`, health, ...(part.shortageReasons ?? []), part.error].filter(Boolean).join('；');
        });
      }
      const candidates = await pipeline.stageEdition(edition);
      if (!candidates.length || !edition) {
        if (!edition || Object.values(edition.sections).every(part => ['failed', 'interrupted'].includes(part.status))) {
          await step('准备收件箱', () => { throw new AutomationCheckError('当天来源准备失败或中断。请在每日资讯中重试来源。'); });
        } else await step('准备收件箱', () => '没有尚待预筛的新条目。');
        return;
      }
      const settings = await pipeline.settings();
      if (!settings.preScreenEnabled) {
        await step('AI 预筛', () => `预筛已关闭，${candidates.length} 条仍可确认。`);
        return;
      }
      const provider = activeProvider();
      let failed = false;
      for (let offset = 0; offset < candidates.length; offset += 10) {
        signal.throwIfAborted();
        const batch = candidates.slice(offset, offset + 10);
        await step(`AI 预筛 · 第 ${offset / 10 + 1} 批`, async () => {
          let outcome: NewsScore[] | string = '未配置产品 Provider，条目保留为未预筛。';
          if (provider) {
            try {
              outcome = await screenNews(provider, settings.topics, batch.map(({ id, item }) => ({
                candidateId: id, title: item.title, source: item.sourceName, publishedAt: item.publishedAt,
                evidenceKind: item.evidenceKind, excerpt: item.excerpt,
              })), signal);
            } catch {
              signal.throwIfAborted();
              outcome = 'AI 预筛失败或响应不合规，本批条目保留为未预筛。';
            }
          }
          await pipeline.recordScreening(edition.date, batch, outcome);
          if (typeof outcome === 'string') throw new AutomationCheckError(outcome);
          return `已预筛 ${batch.length} 条。`;
        }).catch(error => {
          if (!(error instanceof AutomationCheckError) || signal.aborted) throw error;
          failed = true;
        });
      }
      if (failed) throw new AutomationCheckError('有预筛批次未完成。');
    },
  };
}
