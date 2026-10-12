// Independent HTTP fake fixtures. This is never a real-model quality test.
export const formulaA = '铺货率=上架门店数/目标门店数';
export const formulaB = '铺货率=有销售门店数/目标门店数';
export const bodyA = `来源A：${formulaA}。统计周期为自然月。人工旧备注需永久保留。`;
export const bodyB = `来源B：${formulaB}。统计周期为自然月。两种口径需要业务确认。`;
export function fakeReply(input) {
  const system = input.messages.find(message => message.role === 'system')?.content ?? '';
  const user = input.messages.find(message => message.role === 'user')?.content ?? '';
  if (user.includes('<<<\n')) {
    const rawId = user.match(/rawId 填 "([0-9a-f-]{36})"/)?.[1];
    const quote = user.split('<<<\n')[1].split('\n>>>')[0];
    const title = quote.includes('全维度样本') ? 'Distribution Rate' : '铺货率';
    return { document: { title: '隔离验收来源摘要', main_topic: '铺货口径', summary: quote }, suggested_pages: [{ title, type: 'metric', category: 'metric', one_line_definition: quote, source_facts: [{ text: quote, evidenceIds: ['b05-ev-1'] }], ai_organized: ['整理：口径需明确'], ai_inferences: ['推断：口径差异可能影响统计'], related_pages: [], open_questions: ['采用哪一门店口径？'], source_evidence: [{ id: 'b05-ev-1', rawId, quote }] }] };
  }
  let parsed;
  try { parsed = JSON.parse(user); } catch { throw new Error('Fake fixture expects structured complete input'); }
  const synthesis = system.includes('多来源') || Array.isArray(parsed);
  const raws = Array.isArray(parsed) ? parsed : [{ id: parsed.newSource.rawId ?? parsed.newSource.id ?? parsed.newSource.evidence?.[0]?.rawId, body: parsed.newSource.body }];
  const b = raws.find(raw => raw.body.includes(formulaB)) ?? raws[0];
  const evidence = (text, raw = b) => ({ text, rawId: raw.id, quote: raw.body, start: 0, end: raw.body.length });
  const result = { suggestedAdditions: [evidence(`来源B补充公式：${formulaB}`)], conflicts: [evidence(`来源A ${formulaA}；来源B ${formulaB}。存在冲突，待验证。`)], inferences: ['AI推断：差异可能源于销售活跃程度，待验证'], openQuestions: ['请业务确认两种分子定义以及适用范围'], agreement: [evidence('两个来源一致采用目标门店作为分母、自然月作为周期')] };
  return synthesis ? { title: '验收资料 多来源铺货率综合', category: 'metric', ...result } : result;
}
