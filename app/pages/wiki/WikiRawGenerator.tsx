import { sourceLabels } from '../../api';
import type { WikiWorkspace } from './useWikiWorkspace';

export function WikiRawGenerator({ workspace, onImport }: { workspace: WikiWorkspace; onImport?: () => void }) {
  const { modelDisabled, extractError, raws, processing, extractingRawId, generateFromRaw } = workspace;
  return (
    <section className="panel wiki-raw-generator">
      <div className="panel-heading">
        <div>
          <h2>选择一条 Raw</h2>
          <p>所选正文会发送给已配置的 Provider，生成可审核的 Wiki 草稿。Meeting 来源保持本机专用。</p>
        </div>
      </div>
      <div className="wiki-raw-generator-body">
        {modelDisabled && (
          <p className="field-help" role="status">
            {modelDisabled}
          </p>
        )}
        {extractError && (
          <div className="form-error" role="alert">
            {extractError}
          </div>
        )}
        <div className="raw-list">
          {raws.map((raw) => {
            const state = processing[raw.id];
            const needsModel =
              state?.status !== 'processing' && !(state?.status === 'pending_confirmation' && state.draftId);
            const disabled = !!raw.origin || extractingRawId !== null || (needsModel && !!modelDisabled);
            return (
              <button
                className="raw-list-item"
                key={raw.id}
                disabled={disabled}
                title={needsModel ? modelDisabled : undefined}
                onClick={() => void generateFromRaw(raw)}
              >
                <span className="file-icon">{raw.origin ? '锁' : state?.status === 'processing' ? '…' : '文'}</span>
                <span className="recent-copy">
                  <b>
                    {raw.title}
                    {raw.origin ? ' · 本机专用' : ''}
                  </b>
                  <small>
                    {sourceLabels[raw.sourceType]} ·{' '}
                    {extractingRawId === raw.id
                      ? '正在启动知识提取…'
                      : state?.status === 'pending_confirmation'
                        ? '打开已有待审核草稿'
                        : state?.status === 'processing'
                          ? '复用正在运行的提取任务'
                          : state?.status === 'failed'
                            ? '重试同一 Raw'
                            : '生成 Wiki 草稿'}{' '}
                    · {raw.id}
                  </small>
                </span>
              </button>
            );
          })}
          {raws.length === 0 && (
            <div className="list-empty">
              <b>还没有可处理的 Raw</b>
              <span>先导入并保存一条原始资料。</span>
              <button className="secondary-button" onClick={onImport}>
                导入 Raw
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
