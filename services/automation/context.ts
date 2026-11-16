import { AsyncLocalStorage } from 'node:async_hooks';
import { LlmError, type LlmCompletion, type LlmProvider } from '../llm/provider.ts';
import type { AutomationUsage } from './types.ts';

type AutomationContext = { runId: string; usage: AutomationUsage; save?: () => Promise<unknown>; countSource?: () => Promise<unknown> };
const context = new AsyncLocalStorage<AutomationContext>();

export function runInAutomationContext<T>(value: AutomationContext, execute: () => T): T {
  return context.run(value, execute);
}

export function getAutomationContext(): AutomationContext | undefined {
  return context.getStore();
}

export function assertFormalWriteAllowed(): void {
  if (getAutomationContext()) {
    throw Object.assign(new Error('自动化任务不能写入正式 Wiki 或 Prompt。'), { code: 'AUTOMATION_FORMAL_WRITE_FORBIDDEN', status: 403 });
  }
}

export async function fetchNewsSource(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  await getAutomationContext()?.countSource?.();
  return fetch(...args);
}

export function meterAutomationProvider(provider: LlmProvider): LlmProvider {
  const { name, model, cacheIdentity, secrets } = provider;
  return {
    name, model, cacheIdentity, secrets,
    async complete(request) {
      const run = getAutomationContext();
      const usage = run?.usage;
      if (!usage) return provider.complete(request);
      usage.requests++;
      usage.unknownUsageCount++;
      await run.save?.();
      let tokens: LlmCompletion['usage'];
      let completed = false;
      try {
        const result = await provider.complete(request);
        tokens = result.usage;
        completed = true;
        return result;
      } catch (error) {
        if (error instanceof LlmError) tokens = (error.details as { usage?: LlmCompletion['usage'] } | undefined)?.usage;
        throw error;
      } finally {
        const input = tokens?.promptTokens;
        const output = tokens?.completionTokens;
        const hasInput = typeof input === 'number' && Number.isFinite(input) && input >= 0;
        const hasOutput = typeof output === 'number' && Number.isFinite(output) && output >= 0;
        if (hasInput) usage.inputTokens += input;
        if (hasOutput) usage.outputTokens += output;
        if (completed && hasInput && hasOutput) usage.unknownUsageCount--;
        await run.save?.();
      }
    },
  };
}
