import { assertNoKnownSecret, type LlmCompletion, type LlmProvider } from './provider.ts';

type CompletedModel = { provider: string; model: string; endpoint?: 'primary' | 'backup'; label?: string };
export type CompletedBlockModels = Record<string, CompletedModel[]>;
type ModelSwitch = { block: string; from: CompletedModel; to: CompletedModel };

export const continuationInstruction =
  '\n结构衔接：已验证并保存的部分继续沿用。沿用请求中的结构、编号及来源坐标，只处理本次指定范围；不重做已保存块，不补造缺失内容。';

export function completedModel(provider: LlmProvider, completion: LlmCompletion): CompletedModel {
  const actual = completion.route?.attempts.find((attempt) => attempt.outcome === 'success');
  const model: CompletedModel =
    actual && actual.endpoint !== 'embedding'
      ? { provider: actual.provider, model: actual.model, endpoint: actual.endpoint, label: actual.label }
      : { provider: provider.name, model: provider.model };
  assertNoKnownSecret(model, provider.secrets);
  return model;
}

const modelKey = ({ provider, model, endpoint, label }: CompletedModel) =>
  JSON.stringify([provider, model, endpoint, label]);
const modelIdentity = ({ provider, model }: CompletedModel) => JSON.stringify([provider, model]);

function validModel(value: unknown): value is CompletedModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = value as CompletedModel;
  return (
    Object.keys(model).every((key) => ['provider', 'model', 'endpoint', 'label'].includes(key)) &&
    typeof model.provider === 'string' &&
    model.provider.length > 0 &&
    typeof model.model === 'string' &&
    model.model.length > 0 &&
    (model.endpoint === undefined || ['primary', 'backup'].includes(model.endpoint)) &&
    (model.label === undefined || typeof model.label === 'string')
  );
}

export function recordCompletedModels(
  previous: CompletedBlockModels | undefined,
  block: string,
  models: CompletedModel[],
): CompletedBlockModels {
  return {
    ...previous,
    [block]: models.filter((model, index) => index === 0 || modelKey(model) !== modelKey(models[index - 1])),
  };
}

export function validCompletedModels(value: unknown, completedBlocks: string[]): value is CompletedBlockModels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const blocks = new Set(completedBlocks);
  return Object.entries(value).every(
    ([block, models]) => blocks.has(block) && Array.isArray(models) && models.length > 0 && models.every(validModel),
  );
}

export function summarizeCompletedModels(sources: { models?: CompletedBlockModels; blocks: string[] }[]) {
  const used = new Map<string, CompletedModel>();
  const model_switches: ModelSwitch[] = [];
  let untrackedBlocks = 0;
  let previous: CompletedModel | undefined;
  for (const { models, blocks } of sources) {
    for (const block of blocks) {
      const entries = models?.[block];
      if (!entries) {
        untrackedBlocks++;
        previous = undefined;
        continue;
      }
      for (const model of entries) {
        const identity = modelIdentity(model);
        if (previous && modelIdentity(previous) !== identity) {
          model_switches.push({ block, from: previous, to: model });
        }
        if (!used.has(identity)) used.set(identity, model);
        previous = model;
      }
    }
  }
  const models = [...used.values()];
  const crossModel = new Set(models.map(modelIdentity)).size > 1;
  if (crossModel || untrackedBlocks) return { models, untrackedBlocks, crossModel, model_switches };
}

export type DraftModelProvenance = NonNullable<ReturnType<typeof summarizeCompletedModels>>;

export function validDraftModelProvenance(value: unknown): value is DraftModelProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { models, untrackedBlocks, crossModel, model_switches } = value as DraftModelProvenance;
  return (
    Array.isArray(models) &&
    models.every(validModel) &&
    Number.isSafeInteger(untrackedBlocks) &&
    untrackedBlocks >= 0 &&
    crossModel === new Set(models.map(modelIdentity)).size > 1 &&
    (crossModel || untrackedBlocks > 0) &&
    Array.isArray(model_switches) &&
    model_switches.every(
      (entry) =>
        entry &&
        typeof entry.block === 'string' &&
        validModel(entry.from) &&
        validModel(entry.to) &&
        modelIdentity(entry.from) !== modelIdentity(entry.to),
    )
  );
}
