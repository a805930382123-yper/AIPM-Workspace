import { Fragment, useEffect, useRef, useState } from 'react';
import {
  answerCitation,
  askKnowledge,
  currentKnowledgeAnswer,
  knowledgeAnswer,
  saveKnowledgeAnswer,
  ApiError,
} from '../api';
import type { KnowledgeAnswer } from '../../services/llm/knowledge-answers';
import type { QuestionPreview } from '../../services/wiki/question-input';
import { mediaEvidenceHref } from '../../services/raw/media-artifact';
import { answerText, answerSelection } from '../../services/wiki/question-display';
import { parseWikiAnswer } from './wiki-answer-display';
export type RawCitationTarget = { rawId: string; start: number; end: number; quote: string; bodySha256: string };
const stages = {
  retrieving: '正在检索并读取知识页',
  answering: '正在依据已读资料生成回答',
  reading_raw: '正在补读必要原文',
  saving_draft: '正在生成维护草稿',
  completed: '回答完成',
  failed: '本次操作失败',
  insufficient: '没有足够依据',
};
const proseLabels: Partial<Record<KnowledgeAnswer['sections'][number]['kind'], string>> = {
  inference: '综合推断',
  insufficient: '依据不足',
  conflict: '分歧待核',
};
export function WikiQuestionPanel({
  onOpenWiki,
  onOpenRaw,
  onOpenDraft,
}: {
  onOpenWiki: (id: string) => void;
  onOpenRaw: (id: string, target?: RawCitationTarget) => void;
  onOpenDraft: (id: string) => void;
}) {
  const [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState<KnowledgeAnswer | null>(null),
    [attempt, setAttempt] = useState<KnowledgeAnswer | null>(null),
    [activity, setActivity] = useState<KnowledgeAnswer | null>(null),
    [busy, setBusy] = useState<'ask' | 'save' | ''>(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [preview, setPreview] = useState<QuestionPreview | null>(null),
    [saveKey, setSaveKey] = useState('');
  const [openTrace, setOpenTrace] = useState('');
  const prose = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    typed = useRef(false),
    askedId = useRef('');
  useEffect(() => {
    const turn = generation.current;
    currentKnowledgeAnswer()
      .then((r) => {
        if (turn !== generation.current || !r) return;
        setAnswer(r.sections.length ? r : null);
        setAttempt(r);
        if (!typed.current) setQuestion(r.question);
      })
      .catch((e) => {
        if (turn === generation.current) setError(e instanceof Error ? e.message : '无法读取上次问题。');
      });
    return () => {
      generation.current++;
    };
  }, []);
  const polling = (id: string, turn: number) =>
    window.setInterval(() => {
      knowledgeAnswer(id)
        .then((r) => {
          if (turn === generation.current) setActivity(r);
        })
        .catch((e) => {
          if (turn === generation.current && !(e instanceof ApiError && e.status === 404))
            setError(e instanceof Error ? e.message : '无法读取本次阶段。');
        });
    }, 300);
  const ask = async (retry = false) => {
    const text = question.trim();
    if (!text) return;
    const id = retry && attempt ? attempt.id : crypto.randomUUID(),
      turn = ++generation.current;
    askedId.current = id;
    setOpenTrace('');
    setBusy('ask');
    setActivity(null);
    setError('');
    setNotice('');
    setPreview(null);
    const timer = polling(id, turn);
    try {
      const result = await askKnowledge({ requestId: id, question: text, retry });
      if (turn !== generation.current) return;
      setAttempt(result);
      setActivity(result);
      if (result.sections.length) setAnswer(result);
      if (result.status === 'failed') setError(result.error?.message ?? '回答失败，问题与已有答案已保留。');
    } catch (e) {
      if (turn === generation.current) setError(e instanceof Error ? e.message : '回答失败，问题与已有答案已保留。');
    } finally {
      window.clearInterval(timer);
      if (turn === generation.current) setBusy('');
    }
  };
  const openPreview = (whole: boolean) => {
    if (!answer) return;
    setError('');
    let text = answerText(answer.sections);
    if (!whole) {
      const selected = window.getSelection();
      if (
        !selected?.rangeCount ||
        !prose.current?.contains(selected.anchorNode) ||
        !prose.current.contains(selected.focusNode) ||
        !selected.toString().trim()
      ) {
        setError('请先在本次回答正文中选择需要保存的文字。');
        return;
      }
      const fragment = document.createElement('div');
      fragment.append(selected.getRangeAt(0).cloneContents());
      fragment.querySelectorAll('[data-answer-citations]').forEach((node) => node.remove());
      text = fragment.textContent ?? '';
      if (!text.trim()) {
        setError('请选择回答正文，引用按钮不作为保存文字。');
        return;
      }
    }
    const selected = answerSelection(answer.sections, text);
    setPreview({
      title: '问答整理：' + answer.question.slice(0, 60),
      conclusion: selected.sections
        .filter((s) => s.kind === 'fact' || s.kind === 'conflict')
        .map((s) => s.text)
        .join('\n'),
      inferences: selected.sections
        .filter((s) => s.kind === 'inference' || s.kind === 'advice')
        .map((s) => s.text)
        .join('\n'),
      tags: [],
      selectedText: text,
      selectedSectionIds: selected.sectionIds,
      citationIds: selected.citationIds,
    });
    setSaveKey(crypto.randomUUID());
    setNotice('');
  };
  const edit = (patch: Partial<QuestionPreview>) => {
    setPreview((current) => (current ? { ...current, ...patch } : null));
    setSaveKey(crypto.randomUUID());
  };
  const save = async () => {
    if (!answer || !preview) return;
    const turn = ++generation.current;
    setBusy('save');
    setActivity(null);
    setError('');
    const timer = polling(answer.id, turn);
    try {
      const result = await saveKnowledgeAnswer(answer.id, { key: saveKey, resultRevision: answer.revision, preview });
      if (turn !== generation.current) return;
      setAnswer(result.answer);
      setAttempt(result.answer);
      setNotice(
        result.status === 'no_change'
          ? '没有实质新增：' + result.reason
          : result.status === 'existing_draft'
            ? '此回答已有维护草稿，请打开对应草稿继续处理。'
            : '维护草稿已生成，正式知识尚未改变。',
      );
      setPreview(null);
    } catch (e) {
      if (turn === generation.current)
        setError(e instanceof Error ? e.message : '草稿生成失败，编辑预览已保留，可明确重试。');
    } finally {
      window.clearInterval(timer);
      if (turn === generation.current) setBusy('');
    }
  };
  const openCitation = async (id: string) => {
    if (!answer) return;
    setError('');
    try {
      const ref = await answerCitation(answer.id, id);
      if (ref.kind === 'wiki') onOpenWiki(ref.recordId);
      else
        onOpenRaw(ref.recordId, {
          rawId: ref.recordId,
          start: ref.start,
          end: ref.end,
          quote: ref.quote,
          bodySha256: ref.bodySha256,
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : '引用当前不可访问，请重新核验。');
    }
  };
  const latest = answer?.saves[answer.saves.length - 1];
  const missingAttempt = !!askedId.current && askedId.current !== attempt?.id;
  const trace = missingAttempt ? null : attempt;
  const completed = !busy && trace?.status === 'completed';
  const traceOpen = !!trace && openTrace === trace.id;
  const saveStatus =
    latest?.status === 'committed'
      ? '正式知识已更新'
      : answer?.draftId
        ? '维护草稿已生成'
        : latest?.status === 'no_change'
          ? '没有实质新增'
          : '';
  const submitDisabled = busy !== '' || !question.trim();
  const status =
    busy === 'ask'
      ? activity?.status === 'running' && activity.stage
        ? stages[activity.stage]
        : '正在检索候选知识页并读取必要原文，正在生成回答…'
      : busy === 'save'
        ? '正在生成维护草稿'
        : missingAttempt
          ? '本次提问失败'
          : trace?.status === 'failed'
            ? '回答失败，可明确重试'
            : trace?.status === 'partial'
              ? '部分回答，仍有依据缺口'
              : trace?.status === 'insufficient'
                ? '依据不足'
                : completed
                  ? '回答完成'
                  : '';
  const groups = answer ? parseWikiAnswer(answer.sections) : [];
  const citationLinks = (ids: string[]) =>
    answer &&
    ids.length > 0 && (
      <span className="answer-inline-citations" data-answer-citations="true">
        {ids.map((id) => {
          const index = answer.citations.findIndex((c) => c.id === id);
          return index >= 0 ? (
            <a key={id} href={'#answer-citation-' + index} aria-label={'查看引用依据 ' + (index + 1)}>
              [{index + 1}]
            </a>
          ) : null;
        })}
      </span>
    );
  return (
    <section className="panel wiki-question" aria-label="向知识库提问" aria-busy={busy !== ''}>
      <div className="panel-heading">
        <div>
          <h2>向知识库提问</h2>
          <p>先读已有知识与必要原文。回答可选择整理成草稿，正式写入仍需审核。</p>
        </div>
      </div>
      <div className="wiki-question-body">
        <form
          className="wiki-question-prompt"
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitDisabled) void ask();
          }}
        >
          <textarea
            aria-label="知识库问题"
            rows={3}
            maxLength={8000}
            value={question}
            disabled={busy !== ''}
            onChange={(e) => {
              typed.current = true;
              setQuestion(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!e.repeat && !submitDisabled) e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="例如：有效门店和签约门店的统计口径有什么区别？"
          />
          <div className="wiki-question-prompt-action">
            <button
              type="submit"
              className="primary-button"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              disabled={submitDisabled}
            >
              {busy === 'ask' && <span className="answer-spinner" aria-hidden="true" />}
              {busy === 'ask' ? '提问中' : '提问'}
            </button>
          </div>
        </form>
        {status && (
          <div className="answer-status-bar">
            <div className="answer-status-summary" role="status">
              {busy === 'ask' && <span className="answer-spinner" aria-hidden="true" />}
              {completed && (
                <span className="answer-status-check" aria-hidden="true">
                  ✓
                </span>
              )}
              <strong>{status}</strong>
              {!busy && trace && <span className="answer-status-badge">模型调用 {trace.attempts} 次</span>}
              {completed && trace && (
                <span className="answer-status-badge">
                  底层 Raw {trace.independentRawIds.length} 份 · 人工知识页 {trace.manualWikiIds.length} 个
                  <span
                    className="answer-status-help"
                    tabIndex={0}
                    aria-label="同一Raw的多个页面不计为独立多源"
                    title="同一Raw的多个页面不计为独立多源"
                  >
                    ?
                  </span>
                </span>
              )}
              {completed && saveStatus && <span className="answer-status-badge">{saveStatus}</span>}
            </div>
            {!busy && trace && (
              <button
                type="button"
                className="text-button answer-trace-toggle"
                aria-expanded={traceOpen}
                aria-controls={traceOpen ? 'answer-reading-trace' : undefined}
                onClick={() => setOpenTrace(traceOpen ? '' : trace.id)}
              >
                本次实际读取与依据范围{' '}
                <span>
                  （候选 {trace.candidateWikiIds.length} 页 · 实读 {trace.readWiki.length} 页）
                </span>{' '}
                <span aria-hidden="true">{traceOpen ? '▴' : '▾'}</span>
              </button>
            )}
          </div>
        )}
        {!busy && trace && traceOpen && (
          <div id="answer-reading-trace" className="answer-reading-trace">
            <p>
              实引 Wiki {trace.usedWikiIds.length} 页 · 实引 Raw {trace.usedRawIds.length} 份
            </p>
            {trace.readWiki.length > 0 && (
              <div>
                <h4>已读 Wiki</h4>
                <ul>
                  {trace.readWiki.map((p) => (
                    <li key={p.id}>
                      {p.title} · v{p.revision}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {trace.readRaw.length > 0 && (
              <div>
                <h4>已读 Raw 原文</h4>
                <ul>
                  {trace.readRaw.map((r) => (
                    <li key={r.rawId}>
                      {r.title} · 原文片段[{r.start}, {r.end})，{r.quote.length}字符；必要性：{r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {attempt?.status === 'failed' && question.trim() === attempt.question && (
          <div>
            <button className="secondary-button" disabled={busy !== ''} onClick={() => void ask(true)}>
              明确重试本次问题
            </button>
          </div>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="notice-success" role="status">
            {notice}
          </p>
        )}
        {answer && (
          <>
            <section className="answer-result" aria-label="回答">
              <header className="answer-toolbar">
                <h3>
                  {busy === 'ask' || missingAttempt || trace?.status === 'failed' || answer.id !== attempt?.id
                    ? '保留的已有答案'
                    : '回答'}
                </h3>
                <div className="heading-actions">
                  <button
                    className="secondary-button answer-save-all"
                    disabled={busy !== '' || !answer.citations.length || answer.status === 'insufficient'}
                    onClick={() => openPreview(true)}
                  >
                    保存全部预览
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy !== '' || !answer.citations.length || answer.status === 'insufficient'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openPreview(false)}
                  >
                    保存选段预览
                  </button>
                  {answer.draftId && (
                    <button
                      className="primary-button"
                      disabled={busy !== ''}
                      onClick={() => onOpenDraft(answer.draftId!)}
                    >
                      查看对应草稿
                    </button>
                  )}
                </div>
              </header>
              <div ref={prose} className="knowledge-answer-prose answer-prose" tabIndex={0}>
                {groups.map((group, index) => (
                  <div key={index} className={'answer-group answer-group-' + group.layout}>
                    {group.layout === 'fact' && (
                      <h4 data-answer-citations="true">
                        <span aria-hidden="true">📄</span> 来源事实
                      </h4>
                    )}
                    {group.kind === 'advice' && groups[index - 1]?.kind !== 'advice' && (
                      <div className="answer-advice-heading" data-answer-citations="true">
                        <h4>
                          <span aria-hidden="true">💡</span> 延伸经营建议
                        </h4>
                        {!!group.publicCitationIds?.length && (
                          <span className="answer-public-citations">
                            公共依据{citationLinks(group.publicCitationIds)}
                          </span>
                        )}
                      </div>
                    )}
                    {group.layout === 'prose' && <h4 data-answer-citations="true">{proseLabels[group.kind]}</h4>}
                    <div className={group.layout === 'advice-card' ? 'answer-advice-grid' : undefined}>
                      {group.paragraphs.map(({ sectionId, before, text, advice, citationIds }, paragraphIndex) => (
                        <Fragment key={paragraphIndex}>
                          <span hidden>{before}</span>
                          {advice ? (
                            <article className="answer-advice-card" data-answer-section={sectionId}>
                              <header>
                                <span className="answer-advice-index" data-answer-citations="true">
                                  {advice.index.padStart(2, '0')}
                                </span>
                                <h5>
                                  <span hidden>{advice.lead}</span>
                                  {advice.title}
                                  <span hidden>{advice.colon}</span>
                                </h5>
                                {citationLinks(citationIds)}
                              </header>
                              <p>
                                <span className="answer-advice-label" data-answer-citations="true">
                                  场景含义
                                </span>
                                <span>{advice.meaning}</span>
                              </p>
                              {advice.action && (
                                <p>
                                  <span className="answer-advice-label" data-answer-citations="true">
                                    营销动作
                                  </span>
                                  <span>{advice.action}</span>
                                </p>
                              )}
                            </article>
                          ) : (
                            <p className="answer-paragraph" data-answer-section={sectionId}>
                              {text}
                              {citationLinks(citationIds)}
                            </p>
                          )}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {latest?.status === 'committed' && (
                <p>
                  已正式更新的知识页：
                  {latest.wikiIds?.map((id) => (
                    <button key={id} className="text-button" onClick={() => onOpenWiki(id)}>
                      打开知识页
                    </button>
                  ))}
                </p>
              )}
            </section>
            <section className="answer-evidence" aria-label="引用依据">
              <h3>引用依据</h3>
              {answer.citations.length ? (
                <ol className="answer-citations">
                  {answer.citations.map((c, index) => (
                    <li key={c.id} id={'answer-citation-' + index} tabIndex={-1}>
                      <div className="answer-citation-heading">
                        <span className="answer-citation-number">[{index + 1}]</span>
                        <span className={'answer-source-tag answer-source-' + c.kind}>
                          {c.media ? `来源图片 ${c.media.imageIndex}` : c.kind === 'raw' ? 'Raw 原文' : 'Wiki 知识页'}
                        </span>
                        {c.media ? (
                          <a
                            className="text-button"
                            href={mediaEvidenceHref(c.recordId, c.media)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {c.title} · 图片解析 [{c.start}, {c.end})
                          </a>
                        ) : (
                          <button className="text-button" onClick={() => void openCitation(c.id)}>
                            {c.title}
                            {c.revision ? ' · v' + c.revision : ` · 原文[${c.start}, ${c.end})`}
                          </button>
                        )}
                      </div>
                      {c.quote && <blockquote>{c.quote}</blockquote>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>本次没有可引用的资料。</p>
              )}
              <p className="answer-verification">
                <span aria-hidden="true">ℹ️</span>
                引用身份、版本和原句对应关系经程序核对；回答是否被原文语义支持，仍需你核验。
              </p>
            </section>
          </>
        )}
        {preview && answer && (
          <section className="answer-save-preview" aria-label="问答保存预览">
            <h3>保存预览</h3>
            <p>只有明确生成草稿才保存本次整理；不会创建Raw或问答Source。</p>
            <details>
              <summary>实际选择的回答原文</summary>
              <pre className="knowledge-answer-prose">{preview.selectedText}</pre>
            </details>
            <label className="field">
              建议主题
              <input
                value={preview.title}
                maxLength={300}
                disabled={busy !== ''}
                onChange={(e) => edit({ title: e.target.value })}
              />
            </label>
            <label className="field">
              结论 / 整理
              <textarea
                aria-label="保存结论"
                rows={5}
                maxLength={12000}
                value={preview.conclusion}
                disabled={busy !== ''}
                onChange={(e) => edit({ conclusion: e.target.value })}
              />
            </label>
            <label className="field">
              推断 / 建议（保持待核标签）
              <textarea
                aria-label="保存推断"
                rows={3}
                maxLength={12000}
                value={preview.inferences}
                disabled={busy !== ''}
                onChange={(e) => edit({ inferences: e.target.value })}
              />
            </label>
            <label className="field">
              标签（逗号分隔）
              <input
                value={preview.tags.join('，')}
                disabled={busy !== ''}
                onChange={(e) =>
                  edit({
                    tags: e.target.value
                      .split(/[，,、]/u)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <label className="field">
              建议目标
              <select
                aria-label="保存建议目标"
                disabled={busy !== ''}
                value={preview.targetWikiId ?? ''}
                onChange={(e) =>
                  edit({
                    targetWikiId: e.target.value || undefined,
                    ...(e.target.value ? { title: answer.readWiki.find((p) => p.id === e.target.value)!.title } : {}),
                  })
                }
              >
                <option value="">由维护提议判断新建或更新</option>
                {answer.readWiki.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} · 重新读取后判断
                  </option>
                ))}
              </select>
            </label>
            <p>
              保留依据：{preview.citationIds.map((id) => answer.citations.find((c) => c.id === id)?.title).join('、')}
            </p>
            <div className="heading-actions">
              <button className="secondary-button" disabled={busy !== ''} onClick={() => setPreview(null)}>
                取消预览
              </button>
              <button
                className="primary-button"
                disabled={busy !== '' || !preview.title.trim()}
                onClick={() => void save()}
              >
                生成维护草稿
              </button>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
