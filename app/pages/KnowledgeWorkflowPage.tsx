import { useEffect, useState } from 'react';
import type { KnowledgeWorkflow } from '../api';
import { confirmKnowledgeWorkflow, discardKnowledgeWorkflow, knowledgeWorkflow, patchKnowledgeWorkflow } from '../api';

export function KnowledgeWorkflowPage({ workflowId, onBack, onDone }: { workflowId: string; onBack: () => void; onDone: () => Promise<void> }) {
  const [workflow, setWorkflow] = useState<KnowledgeWorkflow | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => globalThis.crypto?.randomUUID?.() ?? `knowledge-${Date.now()}`);
  const load = async () => { try { setWorkflow(await knowledgeWorkflow(workflowId)); } catch (e) { setError(e instanceof Error ? e.message : '无法读取知识草稿。'); } };
  useEffect(() => { void load(); }, [workflowId]);
  if (!workflow) return <div className="page"><h1>正在读取知识草稿…</h1>{error && <p role="alert">{error}</p>}</div>;
  const editable = workflow.status === 'pending_confirmation';
  const update = (field: keyof KnowledgeWorkflow['sections'], value: unknown) => setWorkflow({ ...workflow, sections: { ...workflow.sections, [field]: value } });
  const list = (label: string, keyName: 'suggestedAdditions' | 'conflicts' | 'inferences' | 'openQuestions' | 'agreement') => <label className="field">{label}<textarea rows={4} disabled={!editable} value={workflow.sections[keyName].join('\n')} onChange={event => update(keyName, event.target.value.split('\n'))} /></label>;
  const save = async () => { setBusy(true); setError(''); try { setWorkflow(await patchKnowledgeWorkflow(workflow.id, { baseRevision: workflow.revision, title: workflow.title, sections: workflow.sections })); } catch (e) { setError(e instanceof Error ? e.message : '保存失败。'); } finally { setBusy(false); } };
  const confirm = async () => { setBusy(true); setError(''); try { await patchKnowledgeWorkflow(workflow.id, { baseRevision: workflow.revision, title: workflow.title, sections: workflow.sections }); const latest = await knowledgeWorkflow(workflow.id); await confirmKnowledgeWorkflow(workflow.id, { baseRevision: latest.revision, idempotencyKey: key }); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : '确认失败。'); } finally { setBusy(false); } };
  const discard = async () => { setBusy(true); try { await discardKnowledgeWorkflow(workflow.id, workflow.revision); onBack(); } catch (e) { setError(e instanceof Error ? e.message : '放弃失败。'); } finally { setBusy(false); } };
  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">{workflow.kind === 'update' ? '旧 Wiki 更新预览' : '多来源 Synthesis'}</p><h1>{workflow.kind === 'update' ? '审阅更新建议' : '审阅综合草稿'}</h1><p className="subheading">草稿 {workflow.id} · v{workflow.revision} · {workflow.provider.name}/{workflow.provider.model} · {workflow.status}</p></div><div className="action-group"><button className="secondary-button" onClick={onBack}>返回</button>{editable && <><button className="secondary-button" disabled={busy} onClick={() => void save()}>保存草稿</button><button className="secondary-button" disabled={busy} onClick={() => void discard()}>放弃</button><button className="primary-button" disabled={busy} onClick={() => void confirm()}>确认写入</button></>}</div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {workflow.status === 'conflict' && <div className="notice-warn">提交因冲突停止，未覆盖后续人工编辑。operationId：<code>{workflow.commitOperationId}</code><p>{workflow.lastCommitError}</p></div>}
    <section className="panel draft-card-body"><label className="field">标题<input value={workflow.title} disabled={!editable} onChange={event => setWorkflow({ ...workflow, title: event.target.value })} /></label><p>来源：{workflow.sections.sourceList.map(item => `${item.title}（${item.id}）`).join('；')}</p>
      {workflow.sections.existing && <label className="field">现有内容<textarea rows={8} value={workflow.sections.existing} readOnly /></label>}
      {workflow.sections.newSource && <label className="field">新来源正文<textarea rows={8} value={workflow.sections.newSource} readOnly /></label>}
      {list('一致观点', 'agreement')}{list('建议增加', 'suggestedAdditions')}{list('冲突（保留双方）', 'conflicts')}{list('AI 推断', 'inferences')}{list('待确认问题', 'openQuestions')}
      {workflow.evidence?.length ? <div><h3>原文证据定位</h3>{workflow.evidence.map((item, index) => <p key={`${item.rawId}-${index}`}>{item.section} · Raw {item.rawId} [{item.start}, {item.end})：“{item.quote}”</p>)}</div> : null}
    </section>
  </div>;
}
