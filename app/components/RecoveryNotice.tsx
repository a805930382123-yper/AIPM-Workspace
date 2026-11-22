import { useCallback, useEffect, useState } from 'react';
import { api, type RecoveryScan } from '../api';
const labels: Record<string, string> = {
  read: '读取失败',
  parse: 'JSON 损坏',
  shape: '记录结构无效',
  directory: '目录不可读',
};
export function RecoveryNotice() {
  const [scan, setScan] = useState<RecoveryScan | null>(null),
    [error, setError] = useState('');
  const refresh = useCallback(() => {
    setError('');
    void api<RecoveryScan>('/api/recovery-issues')
      .then(setScan)
      .catch(() => setError('恢复状态读取失败，请稍后重试。'));
  }, []);
  useEffect(() => {
    refresh();
    const discovered = () => refresh();
    window.addEventListener('storage-recovery-discovered', discovered);
    return () => window.removeEventListener('storage-recovery-discovered', discovered);
  }, [refresh]);
  if (!scan?.items.length && !scan?.overflow && !scan?.partial && !error) return null;
  const count = scan?.totalIssues ?? scan?.items.length ?? 0,
    partial = scan?.partial === true || scan?.scanned === false;
  // Older servers only expose overflow; do not turn their bounded count into an exact total.
  const lowerBound = partial || (scan?.totalIssues === undefined && scan?.overflow);
  return (
    <aside className="recovery-notice" role="status">
      <div>
        <b>{error || `发现${lowerBound ? '至少 ' : ' '}${count} 个需要处理的本机记录`}</b>
        {partial && <p>扫描尚未完成，数量仅为当前已知下限；请检查后重新扫描。</p>}
        {scan?.truncated && (
          <p>
            问题摘要已截断，仅返回前 {scan.items.length} 项；另有{' '}
            {scan.hiddenIssues ?? Math.max(0, count - scan.items.length)} 项仍需处理。
          </p>
        )}
        {scan?.items.slice(0, 5).map((item, i) => (
          <p key={`${item.kind}-${item.id}-${i}`}>
            {labels[item.reason] ?? '需要检查'} · {item.kind} · {item.id}
          </p>
        ))}
        {!!scan && scan.items.length > 5 && <p>当前仅展示摘要中的前 5 项。</p>}
        <small>原文件已保留，需要检查或从备份恢复。</small>
      </div>
      <button onClick={refresh}>重新检查</button>
    </aside>
  );
}
