import { useEffect, useState } from 'react';
import type { KnowledgeWorkflow } from '../api';
import { confirmKnowledgeWorkflow, discardKnowledgeWorkflow, knowledgeWorkflow, patchKnowledgeWorkflow, startWorkflowReview, moveWorkflowUnits, reviewWorkflowPage } from '../api';

const fingerprint=(w:KnowledgeWorkflow)=>JSON.stringify({title:w.title,sections:w.sections,source_level:w.source_level});

export function KnowledgeWorkflowPage({ workflowId, onBack, onDone }: { workflowId: string; onBack: () => void; onDone: () => Promise<void> }) {
  const [workflow, setWorkflow] = useState<KnowledgeWorkflow | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved,setSaved]=useState('');
  const [key] = useState(() => globalThis.crypto?.randomUUID?.() ?? `knowledge-${Date.now()}`);
  const apply=(value:KnowledgeWorkflow)=>{setWorkflow(value);setSaved(fingerprint(value));};
  const load = async () => { try { apply(await knowledgeWorkflow(workflowId)); } catch (e) { setError(e instanceof Error ? e.message : '无法读取知识草稿。'); } };
  useEffect(() => { void load(); }, [workflowId]);
  if (!workflow) return <div className="page"><h1>正在读取知识草稿…</h1>{error && <p role="alert">{error}</p>}</div>;
  const editable = workflow.status === 'pending_confirmation';
  const dirty=fingerprint(workflow)!==saved;
  const reviewed=!!workflow.humanReview&&Object.values(workflow.humanReview.assignments).every(id=>id!==null)&&workflow.humanReview.approvals.some(a=>a.pageId===workflow.id&&a.digest===workflow.reviewContentDigest);
  const update = (field: keyof KnowledgeWorkflow['sections'], value: unknown) => setWorkflow({ ...workflow, sections: { ...workflow.sections, [field]: value } });
  const list = (label: string, keyName: 'suggestedAdditions' | 'conflicts' | 'inferences' | 'openQuestions' | 'agreement') => <label className="field">{label}<textarea rows={4} disabled={!editable} value={workflow.sections[keyName].join('\n')} onChange={event => update(keyName, event.target.value.split('\n'))} /></label>;
  const save = async () => { setBusy(true); setError(''); try { apply(await patchKnowledgeWorkflow(workflow.id, { baseRevision: workflow.revision, title: workflow.title, sections: workflow.sections, ...(workflow.kind === 'synthesis' && workflow.source_level ? { source_level: workflow.source_level } : {}) })); } catch (e) { setError(e instanceof Error ? e.message : '保存失败。'); } finally { setBusy(false); } };
  const confirm = async () => { setBusy(true); setError(''); try { if(dirty||!reviewed)throw new Error('请先保存并审查当前完整预览，解决所有未解决项。');await confirmKnowledgeWorkflow(workflow.id, { baseRevision: workflow.revision, idempotencyKey: key }); await onDone(); } catch (e) { setError(e instanceof Error ? e.message : '确认失败。'); } finally { setBusy(false); } };
  const reviewAction=async(action:'start'|'confirm'|'revoke'|'move',unitId?:string,target?:string|null)=>{setBusy(true);setError('');try{if(dirty)throw new Error('请先保存当前编辑；保存后需要重新审查。');apply(action==='start'?await startWorkflowReview(workflow.id,workflow.revision):action==='move'?await moveWorkflowUnits(workflow.id,workflow.revision,[unitId!],target??null):await reviewWorkflowPage(workflow.id,workflow.revision,workflow.reviewContentDigest!,action==='confirm'));}catch(e){setError(e instanceof Error?e.message:'审查操作失败。');}finally{setBusy(false);}};
  const discard = async () => { setBusy(true); try { await discardKnowledgeWorkflow(workflow.id, workflow.revision); onBack(); } catch (e) { setError(e instanceof Error ? e.message : '放弃失败。'); } finally { setBusy(false); } };
  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">{workflow.kind === 'update' ? '旧 Wiki 更新预览' : '多来源 Synthesis'}</p><h1>{workflow.kind === 'update' ? '审阅更新建议' : '审阅综合草稿'}</h1><p className="subheading">草稿 {workflow.id} · v{workflow.revision} · {workflow.provider.name}/{workflow.provider.model} · {workflow.status}</p></div><div className="action-group"><button className="secondary-button" onClick={onBack}>返回</button>{editable && <><button className="secondary-button" disabled={busy} onClick={() => void save()}>保存草稿</button><button className="secondary-button" disabled={busy} onClick={() => void discard()}>放弃</button><button className="primary-button" disabled={busy} onClick={() => void confirm()}>确认写入</button></>}</div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {'legacyStandaloneInput' in workflow&&<p className="notice-warn">旧更新记录没有输入草稿身份；本次审查以已保存的完整更新、实际 Raw 来源和目标版本为准，不补造原 fact ID。</p>}
    {editable&&<section className="panel draft-card-body" aria-label="完整知识预览审查"><h2>本页主题与完整归属审查</h2><p>这是新的单页候选，输入草稿的确认不能替代本页审查。</p>{dirty&&<p className="notice-warn">有未保存编辑；保存后需重新审查。</p>}
      {!workflow.humanReview?<button className="secondary-button" disabled={busy||dirty} onClick={()=>void reviewAction('start')}>开始本页审查</button>:<>
        <p>{reviewed&&!dirty?'本页已审查':'本页尚未完成审查'} · 未解决 {Object.values(workflow.humanReview.assignments).filter(id=>id===null).length} 项</p>
        {workflow.humanReview.units.map(unit=><div className="draft-evidence-row" key={unit.id}><div><strong>{unit.sourceLabel??(unit.kind==='fact'?'不可变来源事实':unit.kind==='question'?'原始问题':'原始提议')}</strong><p>{unit.text}</p><small>审查身份：{unit.id} {unit.memberIds.length?`· 原记录 ${unit.memberIds.join('、')}`:''}</small>{unit.evidence.map((e,i)=><p key={i}>Raw {e.rawId} [{e.start}, {e.end})：“{e.quote}”</p>)}{!unit.evidence.length&&<p>此条无原文定位，按整理或问题审查</p>}</div><label className="field">归属<select aria-label={`归属 ${unit.id}`} disabled={busy||dirty} value={workflow.humanReview!.assignments[unit.id]??''} onChange={e=>void reviewAction('move',unit.id,e.target.value||null)}><option value="">未解决</option><option value={workflow.id}>本页</option></select></label></div>)}
        <button className="secondary-button" disabled={busy||dirty} onClick={()=>void reviewAction('confirm')}>确认本页主题与完整归属</button><button className="text-button" disabled={busy||dirty} onClick={()=>void reviewAction('revoke')}>撤销本页确认</button>
      </>}
    </section>}
    {workflow.status === 'conflict' && <div className="notice-warn">提交因冲突停止，未覆盖后续人工编辑。operationId：<code>{workflow.commitOperationId}</code><p>{workflow.lastCommitError}</p></div>}
    <section className="panel draft-card-body"><label className="field">标题<input value={workflow.title} disabled={!editable} onChange={event => setWorkflow({ ...workflow, title: event.target.value })} /></label><p>来源：{workflow.sections.sourceList.map(item => `${item.title}（${item.id}）`).join('；')}</p>
      {workflow.kind === 'synthesis' && <label className="field">综合页来源等级<select aria-label="综合页来源等级" disabled={!editable || busy} value={workflow.source_level ?? 'D'} onChange={event => setWorkflow({ ...workflow, source_level: event.target.value })}>{['A','B','C','D'].map(level => <option key={level} value={level}>{level} 级</option>)}</select></label>}
      {workflow.sections.sourceList.map((source, index) => <label className="field" key={source.id}>{source.existingSourceId ? '已有 Source 来源等级' : '新建 Source 来源等级'} · {source.title}<select aria-label={`Source 来源等级 ${source.id}`} disabled={!editable || busy || !!source.existingSourceId} value={source.source_level ?? 'D'} onChange={event => update('sourceList', workflow.sections.sourceList.map((item, at) => at === index ? { ...item, source_level: event.target.value } : item))}>{['A','B','C','D'].map(level => <option key={level} value={level}>{level} 级</option>)}</select>{source.existingSourceId && <small>已有 Source 保持原等级，纠偏请前往 Wiki 编辑。</small>}</label>)}
      {workflow.sections.existing && <label className="field">现有内容<textarea rows={8} value={workflow.sections.existing} readOnly /></label>}
      {workflow.sections.newSource && <label className="field">新来源正文<textarea rows={8} value={workflow.sections.newSource} readOnly /></label>}
      {list('一致观点', 'agreement')}{list('建议增加', 'suggestedAdditions')}{list('冲突（保留双方）', 'conflicts')}{list('AI 推断', 'inferences')}{list('待确认问题', 'openQuestions')}
      {workflow.evidence?.length ? <div><h3>原文证据定位</h3>{workflow.evidence.map((item, index) => <p key={`${item.rawId}-${index}`}>{item.section} · Raw {item.rawId} [{item.start}, {item.end})：“{item.quote}”</p>)}</div> : null}
    </section>
  </div>;
}
