import type { RawDraftView } from '../../api';

export function DraftModelNotice({ provenance }: { provenance: RawDraftView['modelProvenance'] }) {
  if (!provenance) return null;
  return (
    <>
      <p className="subheading">
        {provenance.crossModel && (
          <>
            <strong>跨模型续跑</strong> ·{' '}
            {provenance.models.map(({ label, provider, model }) => `${label ?? provider} / ${model}`).join('、')}
            。请核对各部分衔接及原文来源。
          </>
        )}
        {provenance.untrackedBlocks > 0 && <>沿用的 {provenance.untrackedBlocks} 个旧块没有模型记录。</>}
      </p>
      {provenance.model_switches.length > 0 && (
        <details className="review-technical">
          <summary>模型切换记录</summary>
          <ol>
            {provenance.model_switches.map(({ block, from, to }, index) => (
              <li key={`${block}-${index}`}>
                {from.model} → {to.model}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}
