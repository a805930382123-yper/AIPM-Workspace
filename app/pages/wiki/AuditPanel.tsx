import { useEffect, useRef, useState } from 'react';
import type { Audit, AuditConflict, AuditDraft, Wiki } from '../../api';
import { api, dateText } from '../../api';
import { useLlmDisabled } from '../../hooks/llmAvailability';

export function AuditPanel({
  item,
  onChanged,
  selectedAnchor,
  onClearAnchor,
  initialAudit,
}: {
  initialAudit?: { wikiId: string; auditId: string; revision: number; wikiRevision: number } | null;
  item: Wiki;
  onChanged: () => void;
  selectedAnchor: { before: string; text: string; after: string } | null;
  onClearAnchor?: () => void;
}) {
  const modelDisabled = useLlmDisabled();
  const [expanded, setExpanded] = useState(!!initialAudit);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [selected, setSelected] = useState<Audit | null>(null);
  const [draft, setDraft] = useState<AuditDraft | null>(null);
  const [conflicts, setConflicts] = useState<AuditConflict[]>([]);
  const [severity, setSeverity] = useState<Audit['severity']>('suggestion');
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<{ before: string; text: string; after: string } | null>(null);
  const [focusCommentRequest, setFocusCommentRequest] = useState(0);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const selectionEpoch = useRef(0);
  const activeAuditId = useRef<string | null>(null);
  const isCurrent = (auditId: string, epoch: number) =>
    selectionEpoch.current === epoch && activeAuditId.current === auditId && item.id.length > 0;
  const load = async () => {
    const pageId = item.id;
    try {
      const result = await api<{ items: Audit[] }>(`/api/audits?wikiId=${encodeURIComponent(pageId)}`);
      if (pageId === item.id) setAudits(result.items);
    } catch (e) {
      if (pageId === item.id) setError(e instanceof Error ? e.message : '无法读取 Audit。');
    }
  };
  useEffect(() => {
    void load();
    return () => {
      selectionEpoch.current++;
      activeAuditId.current = null;
    };
  }, [item.id]);
  useEffect(() => {
    setPendingAnchor(null);
  }, [item.id]);
  useEffect(() => {
    if (selectedAnchor === null) setPendingAnchor(null);
  }, [selectedAnchor]);
  useEffect(() => {
    if (!expanded || focusCommentRequest === 0) return;
    commentRef.current?.scrollIntoView?.({ block: 'nearest' });
    commentRef.current?.focus();
  }, [expanded, focusCommentRequest]);
  const refreshDetail = async (audit: Audit, epoch = selectionEpoch.current) => {
    if (activeAuditId.current !== audit.id || audit.wikiId !== item.id) return;
    try {
      const result = await api<{ audit: Audit; draft: AuditDraft | null; conflicts: AuditConflict[] }>(
        `/api/audits/${audit.id}`,
      );
      if (selectionEpoch.current !== epoch || activeAuditId.current !== audit.id || audit.wikiId !== item.id) return;
      setSelected(result.audit);
      setDraft(result.draft);
      setConflicts(result.conflicts);
      setReplacement(result.draft?.replacement ?? '');
      setDraftNotice('');
    } catch (e) {
      if (selectionEpoch.current === epoch && activeAuditId.current === audit.id)
        setError(e instanceof Error ? e.message : '无法读取 Audit 详情。');
    }
  };
  const selectAudit = (audit: Audit) => {
    const epoch = ++selectionEpoch.current;
    activeAuditId.current = audit.id;
    setSelected(null);
    setDraft(null);
    setConflicts([]);
    setReplacement('');
    setReason('');
    setError('');
    setDraftNotice('');
    setBusy(false);
    void refreshDetail(audit, epoch);
  };
  useEffect(() => {
    if (!initialAudit || initialAudit.wikiId !== item.id) return;
    setExpanded(true);
    let active = true;
    const epoch = ++selectionEpoch.current;
    activeAuditId.current = initialAudit.auditId;
    if (item.revision !== initialAudit.wikiRevision) {
      setError('Wiki 已变化，请返回首页刷新。');
      return;
    }
    void api<{ audit: Audit; draft: AuditDraft | null; conflicts: AuditConflict[] }>(
      `/api/audits/${initialAudit.auditId}`,
    )
      .then((result) => {
        if (!active || selectionEpoch.current !== epoch) return;
        if (
          result.audit.wikiId !== item.id ||
          result.audit.revision !== initialAudit.revision ||
          result.audit.status !== 'open'
        ) {
          setError('Audit 已变化，请返回首页刷新。');
          return;
        }
        setSelected(result.audit);
        setDraft(result.draft);
        setConflicts(result.conflicts);
        setReplacement(result.draft?.replacement ?? '');
      })
      .catch(() => {
        if (active && selectionEpoch.current === epoch) setError('Audit 不可用，请返回首页刷新。');
      });
    return () => {
      active = false;
    };
  }, [initialAudit, item.id, item.revision]);
  const create = async (scope: 'page' | 'paragraph', target?: { before: string; text: string; after: string }) => {
    if (!comment.trim()) {
      setError('请先填写纠错反馈。');
      return;
    }
    const pageId = item.id;
    const epoch = selectionEpoch.current;
    setBusy(true);
    setError('');
    try {
      const audit = await api<Audit>('/api/audits', {
        method: 'POST',
        body: JSON.stringify({ wikiId: pageId, scope, severity, comment, anchor: target }),
      });
      onChanged();
      if (selectionEpoch.current !== epoch || pageId !== item.id) return;
      setComment('');
      if (scope === 'paragraph') {
        setPendingAnchor(null);
        onClearAnchor?.();
      }
      await load();
      if (selectionEpoch.current !== epoch || pageId !== item.id) return;
      selectAudit(audit);
    } catch (e) {
      if (selectionEpoch.current === epoch && pageId === item.id)
        setError(e instanceof Error ? e.message : '提交 Audit 失败。');
    } finally {
      if (selectionEpoch.current === epoch && pageId === item.id) setBusy(false);
    }
  };
  useEffect(() => {
    const createParagraph = (event: Event) => {
      const anchor = (event as CustomEvent<{ before: string; text: string; after: string }>).detail;
      if (!anchor || typeof anchor.text !== 'string' || !anchor.text) return;
      setExpanded(true);
      setPendingAnchor(anchor);
      if (comment.trim()) {
        void create('paragraph', anchor);
      } else {
        setError('');
        setFocusCommentRequest((count) => count + 1);
      }
    };
    window.addEventListener('audit:create-paragraph', createParagraph);
    return () => window.removeEventListener('audit:create-paragraph', createParagraph);
  }, [item.id, severity, comment]);
  const activeAnchor = pendingAnchor ?? selectedAnchor;
  const saveDraft = async () => {
    if (!draft || !selected) return;
    const auditId = selected.id;
    const epoch = selectionEpoch.current;
    const draftId = draft.id;
    const edited = replacement;
    setBusy(true);
    setError('');
    setDraftNotice('');
    try {
      const saved = await api<{ draft: AuditDraft }>(`/api/audit-drafts/${draftId}`, {
        method: 'PATCH',
        body: JSON.stringify({ baseRevision: draft.revision, replacement: edited }),
      });
      const readBack = await api<{ draft: AuditDraft }>(`/api/audit-drafts/${draftId}`);
      if (
        readBack.draft.id !== saved.draft.id ||
        readBack.draft.revision !== saved.draft.revision ||
        readBack.draft.replacement !== edited
      )
        throw new Error('草稿保存后读回校验不一致，请刷新查看当前版本。');
      if (!isCurrent(auditId, epoch)) return;
      setDraft(readBack.draft);
      setReplacement(readBack.draft.replacement);
      setDraftNotice(`草稿已保存并读回 · ${readBack.draft.id} · rev ${readBack.draft.revision}`);
    } catch (e) {
      if (isCurrent(auditId, epoch)) setError(e instanceof Error ? e.message : '保存草稿失败。');
    } finally {
      if (isCurrent(auditId, epoch)) setBusy(false);
    }
  };
  const propose = async () => {
    if (!selected) return;
    const audit = selected;
    const epoch = selectionEpoch.current;
    setBusy(true);
    setError('');
    try {
      await api(`/api/audits/${audit.id}/propose`, { method: 'POST', body: '{}' });
      if (isCurrent(audit.id, epoch)) await refreshDetail(audit, epoch);
    } catch (e) {
      if (isCurrent(audit.id, epoch)) setError(e instanceof Error ? e.message : '生成建议失败。');
    } finally {
      if (isCurrent(audit.id, epoch)) setBusy(false);
    }
  };
  const decide = async (decision: 'accepted' | 'partial' | 'rejected' | 'deferred') => {
    if (!selected) return;
    const audit = selected;
    const currentDraft = draft;
    const currentReplacement = replacement;
    const currentReason = reason;
    const epoch = selectionEpoch.current;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ audit: Audit }>('/api/audits/' + audit.id + '/resolve', {
        method: 'POST',
        body: JSON.stringify({
          baseAuditRevision: audit.revision,
          decision,
          confirm: decision === 'accepted' || decision === 'partial',
          draftId: currentDraft?.id,
          baseDraftRevision: currentDraft?.revision,
          replacement: decision === 'accepted' || decision === 'partial' ? currentReplacement : undefined,
          reason: decision === 'rejected' || decision === 'deferred' ? currentReason : undefined,
        }),
      });
      onChanged();
      if (!isCurrent(audit.id, epoch)) return;
      setSelected(result.audit);
      setDraft(null);
      setReason('');
      await load();
      await refreshDetail(result.audit, epoch);
      window.dispatchEvent(new CustomEvent('wiki:refresh'));
    } catch (e) {
      if (isCurrent(audit.id, epoch)) setError(e instanceof Error ? e.message : '处理 Audit 失败。');
    } finally {
      if (isCurrent(audit.id, epoch)) setBusy(false);
    }
  };
  const relocate = async () => {
    if (!selected || !selectedAnchor) return;
    const audit = selected;
    const target = selectedAnchor;
    const epoch = selectionEpoch.current;
    setBusy(true);
    setError('');
    try {
      await api(`/api/audits/${audit.id}/relocate`, {
        method: 'POST',
        body: JSON.stringify({ baseAuditRevision: audit.revision, anchor: target }),
      });
      if (isCurrent(audit.id, epoch)) await refreshDetail(audit, epoch);
    } catch (e) {
      if (isCurrent(audit.id, epoch)) setError(e instanceof Error ? e.message : '重新定位失败。');
    } finally {
      if (isCurrent(audit.id, epoch)) setBusy(false);
    }
  };
  const discardDraft = async () => {
    if (!selected || !draft) return;
    const audit = selected;
    const draftId = draft.id;
    const epoch = selectionEpoch.current;
    setBusy(true);
    setError('');
    try {
      await api(`/api/audit-drafts/${draftId}`, { method: 'DELETE' });
      if (isCurrent(audit.id, epoch)) await refreshDetail(audit, epoch);
    } catch (e) {
      if (isCurrent(audit.id, epoch)) setError(e instanceof Error ? e.message : '放弃草稿失败。');
    } finally {
      if (isCurrent(audit.id, epoch)) setBusy(false);
    }
  };
  return (
    <section className="wiki-section audit-panel">
      <button
        className="audit-toggle"
        aria-expanded={expanded}
        onClick={() => {
          if (expanded) setFocusCommentRequest(0);
          setExpanded(!expanded);
        }}
      >
        Audit 纠错 · {audits.filter((a) => a.status === 'open').length} 条待处理{' '}
        <span>{expanded ? '收起' : '展开'}</span>
      </button>
      {error && (
        <p className="audit-error" role="alert">
          {error}
        </p>
      )}
      {conflicts.length > 0 && (
        <p className="audit-error" role="status">
          {conflicts.length} 条恢复冲突待处理，请展开查看。
        </p>
      )}
      {expanded && (
        <div>
          <div className="audit-create">
            {activeAnchor && (
              <div className="audit-bound-anchor" role="status">
                <span>
                  已绑定选中段落：「{activeAnchor.text.slice(0, 80)}
                  {activeAnchor.text.length > 80 ? '…' : ''}」
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setPendingAnchor(null);
                    onClearAnchor?.();
                  }}
                >
                  改为整页 Audit
                </button>
              </div>
            )}
            <label className="field">
              严重度
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Audit['severity'])}>
                <option value="error">错误</option>
                <option value="warning">警告</option>
                <option value="suggestion">建议</option>
                <option value="supplement">补充</option>
              </select>
            </label>
            <label className="field">
              反馈
              <textarea
                ref={commentRef}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="说明哪处需要修正以及原因"
              />
            </label>
            <div className="audit-create-actions">
              {activeAnchor ? (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void create('paragraph', activeAnchor)}
                    disabled={busy || !comment.trim()}
                  >
                    提交选中段落 Audit
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void create('page')}
                    disabled={busy || !comment.trim()}
                  >
                    提交整页 Audit
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void create('page')}
                  disabled={busy || !comment.trim()}
                >
                  提交整页 Audit
                </button>
              )}
            </div>
          </div>
          <div className="audit-list">
            {audits.map((audit) => (
              <button
                key={audit.id}
                className={`audit-row ${selected?.id === audit.id ? 'active' : ''}`}
                onClick={() => selectAudit(audit)}
              >
                <b>{audit.severity}</b>
                <span>{audit.comment}</span>
                <small>
                  {audit.status} · rev {audit.revision}
                </small>
              </button>
            ))}
          </div>
          {selected && (
            <div className="audit-detail">
              <div>
                <b>{selected.comment}</b>
                <small>
                  状态：{selected.status} · 定位：{selected.location?.status ?? 'unknown'}（
                  {selected.location?.method ?? ''}）
                  {selected.location?.status === 'uncertain' ? ' · 请重新定位后再生成建议' : ''}
                </small>
              </div>
              {conflicts.map((conflict) => (
                <p className="audit-error" role="status" key={conflict.operationId}>
                  恢复操作 {conflict.operationId} 冲突，仍待人工处理：{conflict.conflictReason}（Wiki revision{' '}
                  {conflict.observedWikiRevision ?? '缺失'}，目标 {conflict.expectedWikiRevision}；Raw 变化：
                  {conflict.changedRawIds.join('、') || '无'}）
                </p>
              ))}
              {selected.status === 'open' && (
                <>
                  <div className="audit-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void propose()}
                      title={modelDisabled}
                      disabled={
                        busy ||
                        !!modelDisabled ||
                        (selected.location?.status !== 'found' && selected.location?.status !== 'located')
                      }
                    >
                      生成 AI 修订建议
                    </button>
                    <button className="text-button" disabled={!selectedAnchor || busy} onClick={() => void relocate()}>
                      用选中段落重新定位
                    </button>
                  </div>
                  {modelDisabled && <p className="field-help">{modelDisabled}</p>}
                  {draft?.status === 'pending' && (
                    <div className="audit-draft">
                      <b>
                        AI 建议 · {draft.provider.name} / {draft.provider.model}
                      </b>
                      <p>{draft.rationale}</p>
                      <label className="field">
                        确认前的替换预览
                        <textarea
                          value={replacement}
                          onChange={(e) => {
                            setReplacement(e.target.value);
                            setDraftNotice('');
                          }}
                        />
                      </label>
                      {draft.evidence.map((e, i) => (
                        <small key={i}>
                          Raw {e.rawId} · 引文：{e.quote}
                        </small>
                      ))}
                      {draftNotice && <small role="status">{draftNotice}</small>}
                      <div className="audit-actions">
                        <button
                          className="secondary-button"
                          onClick={() => void saveDraft()}
                          disabled={busy || replacement === draft.replacement}
                        >
                          保存草稿
                        </button>
                        <button className="primary-button" onClick={() => void decide('accepted')} disabled={busy}>
                          接受并写入
                        </button>
                        <button className="secondary-button" onClick={() => void decide('partial')} disabled={busy}>
                          按当前预览部分接受
                        </button>
                        <button className="text-button" onClick={() => void discardDraft()} disabled={busy}>
                          放弃草稿
                        </button>
                      </div>
                    </div>
                  )}
                  <label className="field">
                    拒绝/延期理由
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="处理理由" />
                  </label>
                  <div className="audit-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void decide('rejected')}
                      disabled={busy || !reason.trim()}
                    >
                      拒绝并解决
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void decide('deferred')}
                      disabled={busy || !reason.trim()}
                    >
                      延期并保持待处理
                    </button>
                  </div>
                </>
              )}
              {selected.decisionHistory?.map((decision, index) => (
                <small key={index}>
                  决议：{decision.decision}
                  {decision.reason ? ` · ${decision.reason}` : ''} · {dateText(decision.at)}
                </small>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
