import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftReviewPage } from '../../app/pages/DraftReviewPage';
import { WikiPage } from '../../app/pages/WikiPage';
import '../../app/styles.css';
import '../../app/wiki.css';
import '../../app/b04.css';

const draftId = new URLSearchParams(location.search).get('draftId')!;
function FieldLab() {
  const [mode, setMode] = useState<'draft' | 'wiki'>('draft');
  const [generation, setGeneration] = useState(0);
  return <main className="page">
    <p className="notice-warn">R16/R18 隔离人工虚构夹具；真实 Provider 禁用，不读实际配置。此入口只验证人工编辑工程行为。</p>
    <div className="action-group"><button className="secondary-button" onClick={() => setMode('draft')}>查看字段草稿</button><button className="secondary-button" onClick={() => { setGeneration(n => n + 1); setMode('wiki'); }}>查看正式 Wiki</button><a href="/lab/export" target="_blank" rel="noreferrer">读取本轮导出</a></div>
    {mode === 'draft' ? <DraftReviewPage key={draftId} draftId={draftId} onBack={() => setMode('wiki')} onOpenRaw={() => window.open('/lab/raw', '_blank')} onCommitted={async () => { setGeneration(n => n + 1); }} />
      : <WikiPage key={generation} onOpenRaw={() => window.open('/lab/raw', '_blank')} onChanged={() => setGeneration(n => n + 1)} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<FieldLab />);
