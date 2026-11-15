import { randomUUID } from 'node:crypto';
import { access, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AutomationCheckError, type TaskDefinition } from './scheduler.ts';

export function createSelfcheck(deps: {
  root: string;
  lockIsCurrent: () => boolean;
  scanRecovery: () => Promise<{ totalIssues: number; partial: boolean }>;
  isProviderConfigured: () => Promise<boolean>;
}): TaskDefinition {
  return {
    type: 'system.selfcheck', name: '工作台自检', defaultPlan: { kind: 'interval', minutes: 60 }, allowsCatchUp: true, mayCallModel: false,
    async execute({ step }) {
      await step('数据目录读写', async () => {
        const file = path.join(deps.root, 'state', 'runtime', `.selfcheck-${randomUUID()}`);
        await access(deps.root);
        await writeFile(file, 'selfcheck', { flag: 'wx' });
        try {
          if (await readFile(file, 'utf8') !== 'selfcheck') throw new AutomationCheckError('数据目录读写校验未通过。');
        } finally { await rm(file); }
        return '读写成功。';
      });
      await step('单实例锁', () => {
        if (!deps.lockIsCurrent()) throw new AutomationCheckError('当前进程与数据目录的实例锁不一致。');
        return '当前进程持有实例锁。';
      });
      await step('数据恢复检查', async () => {
        const { totalIssues, partial } = await deps.scanRecovery();
        return partial ? `已发现 ${totalIssues} 项恢复问题，扫描未完成。` : `发现 ${totalIssues} 项恢复问题。`;
      });
      await step('Provider 配置', async () => await deps.isProviderConfigured() ? '已配置。' : '尚未配置。');
      await step('剩余磁盘空间', async () => {
        const { bsize, bavail } = await statfs(deps.root, { bigint: true });
        const hundredths = bsize * bavail * 100n / (1024n ** 3n);
        return `可用 ${(Number(hundredths) / 100).toFixed(2)} GiB。`;
      });
    },
  };
}
