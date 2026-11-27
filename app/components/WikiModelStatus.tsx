import { useEffect, useState } from 'react';
import type { LlmRoutingStatus } from '../api/llm';
import { api, dateText } from '../api/client';
import { useLlmAvailability } from '../hooks/llmAvailability';

const labels = { primary: '主 Provider', backup: '备用 Provider', embedding: 'Embedding' };
const messages: Record<string, string> = {
  LLM_NETWORK_ERROR: '网络连接失败',
  LLM_TIMEOUT: '请求超时',
  LLM_RATE_LIMITED: '请求受限',
  LLM_AUTH_FAILED: '鉴权失败',
};

function failureReason(errorCode?: string, status?: number) {
  const reason = errorCode && messages[errorCode];
  return [reason || (status ? '上游返回错误' : '原因未记录'), status && `HTTP ${status}`].filter(Boolean).join(' · ');
}

export function WikiModelStatus() {
  const [result, setResult] = useState<LlmRoutingStatus>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const { status, refresh } = useLlmAvailability();
  useEffect(() => {
    const controller = new AbortController();
    void api<LlmRoutingStatus>('/api/llm/routing', { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('无法读取模型调用记录。');
      });
    return () => controller.abort();
  }, [revision]);
  const availability = status ?? result?.availability;
  return (
    <section className="wiki-model-status" aria-label="模型状态">
      <div className="panel-heading">
        <h3>模型状态与调用记录</h3>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setError('');
            refresh?.();
            setRevision((value) => value + 1);
          }}
        >
          刷新状态
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!result && !error && <p role="status">正在读取模型调用记录…</p>}
      {(['primary', 'backup', 'embedding'] as const).map((id) => {
        const endpoint = id === 'embedding' ? undefined : availability?.[id];
        const stats = result?.endpoints[id];
        return (
          <section key={id} aria-label={labels[id]}>
            <h4>
              {labels[id]}
              {endpoint?.configuration === 'configured' && endpoint.label !== labels[id] ? ` · ${endpoint.label}` : ''}
            </h4>
            {endpoint?.configuration === 'disabled' && <p>已关闭</p>}
            {endpoint?.configuration === 'unconfigured' && <p>未配置完整</p>}
            {endpoint?.configuration === 'configured' && (
              <ul>
                {(['heavy', 'light'] as const).map((tier) => {
                  const model = tier === 'heavy' ? endpoint.heavyModel : endpoint.lightModel;
                  const health = endpoint[tier];
                  return (
                    <li key={tier}>
                      {tier === 'heavy' ? '重档' : '轻档'} · {model} ·{' '}
                      {health.status === 'unverified'
                        ? '尚未验证'
                        : health.status === 'ready'
                          ? '上次调用成功'
                          : failureReason(health.errorCode, health.upstreamStatus)}
                      {health.status !== 'unverified' && <small> · {dateText(health.at)}</small>}
                    </li>
                  );
                })}
              </ul>
            )}
            {stats && (
              <dl className="wiki-review-index">
                <div>
                  <dt>调用次数</dt>
                  <dd>{stats.attempts}</dd>
                </div>
                <div>
                  <dt>已知 Token（输入 / 输出 / 总计）</dt>
                  <dd>
                    {(['promptTokens', 'completionTokens', 'totalTokens'] as const)
                      .map((field) => stats.usage[field] ?? '—')
                      .join(' / ')}
                  </dd>
                </div>
                <div>
                  <dt>平均延迟</dt>
                  <dd>{stats.averageLatencyMs === null ? '—' : `${Math.round(stats.averageLatencyMs)} ms`}</dd>
                </div>
                <div>
                  <dt>错误率（不含取消）</dt>
                  <dd>{stats.failureRate === null ? '—' : `${(stats.failureRate * 100).toFixed(1)}%`}</dd>
                </div>
              </dl>
            )}
          </section>
        );
      })}
      {result && (
        <section aria-label="近期主备切换">
          <h4>近期主备切换</h4>
          {result.switches.length ? (
            <ol>
              {result.switches.map((item, index) => (
                <li key={`${item.at}-${index}`}>
                  {dateText(item.at)} · {item.tier === 'light' ? '轻档' : '重档'} ·{' '}
                  {failureReason(item.errorCode, item.upstreamStatus)} · 已尝试备用（
                  {item.outcome === 'success' ? '成功' : '失败'}）
                </li>
              ))}
            </ol>
          ) : (
            <p>暂无主备切换记录。</p>
          )}
        </section>
      )}
    </section>
  );
}
