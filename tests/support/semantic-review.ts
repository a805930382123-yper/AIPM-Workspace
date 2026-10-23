import type { LlmCompletionRequest } from '../../services/llm/provider.ts';

// Mechanism-only fake: a pass here never proves that the candidate is semantically sound.
export function semanticReviewReply(request: Pick<LlmCompletionRequest, 'user'>) {
  if (!request.user.startsWith('请审核下列完整候选知识规划')) return undefined;
  const { plan } = JSON.parse(request.user.split('\n').at(-1)!);
  return { text: JSON.stringify({ version: 1, pages: plan.pages.map((page: { factUnitIds: string[] }, pageIndex: number) => ({ pageIndex, decision: 'pass', code: 'OK', unitIds: [page.factUnitIds[0]], reason: '隔离fake仅验证审核调用与发布门禁。' })) }), bytes: 1, finishReason: 'stop' };
}
