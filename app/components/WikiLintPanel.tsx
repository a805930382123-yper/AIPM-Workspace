import { useId, useState } from 'react';
import type { LintCode } from '../../services/audit/lint';
import type { WikiLintResult } from '../api';

const rules: Record<string, { label: string; guide: string }> = {
  BROKEN_WIKI_LINK: {
    label: '断开的 Wiki 链接',
    guide: '核对链接里的页面名，改为能唯一匹配的标题，或移除已失效的链接。',
  },
  ORPHAN_WIKI: { label: '孤立页面', guide: '与相关主题建立有效 Wiki 链接，让页面有至少一条入链或出链。' },
  INDEX_MISSING: { label: '未收录到索引', guide: '核对知识索引是否包含本页。通过 Wiki 编辑器保存页面后重新检查。' },
  FRONTMATTER_MISSING: {
    label: '页面属性缺失',
    guide: '补齐 Markdown 开头的 YAML 页面属性，检查分隔线和缩进是否正确。',
  },
  SOURCE_MISSING: { label: '缺少有效来源', guide: '在编辑器的来源栏关联仍可打开的 Raw，移除已失效的来源。' },
  KNOWLEDGE_STATUS_MISSING: { label: '缺少知识状态', guide: '在编辑器中选择符合当前证据和审核情况的知识状态。' },
  CONFIDENCE_MISSING: { label: '缺少可信度', guide: '结合原文证据为页面选择合适的可信度。' },
  SOURCE_LEVEL_MISSING: { label: '缺少来源等级', guide: '核对 Raw 的来源身份和权威性，在编辑器中补选 A 至 D 级。' },
  UNSOURCED_FACT: {
    label: '事实缺少可定位证据',
    guide: '核对原始资料，为该条事实补上可定位的原文引用。仍待核实的内容可移到待确认部分。',
  },
  OPEN_AUDIT: {
    label: '待处理 Audit',
    guide: '在页面的 Audit 区查看原反馈，核对后记录处理决定。页面已移除时可按结果中的 Audit 记录路径核对。',
  },
  DUPLICATE_TITLE: { label: '疑似重复标题', guide: '核对同名页的内容。主题不同时改成明确区分的标题，并检查相关链接。' },
} satisfies Record<LintCode, { label: string; guide: string }>;
const rulesWithItemDetails = new Set(['BROKEN_WIKI_LINK', 'OPEN_AUDIT', 'DUPLICATE_TITLE']);

type Finding = WikiLintResult['findings'][number];
type PageGroup = { key: string; id: string | null; title: string; findings: Finding[] };
type Props = {
  result: WikiLintResult | null;
  busy: boolean;
  error: string;
  editingDisabled: boolean;
  onRun: () => void;
  onEdit: (id: string) => void;
};

export function WikiLintPanel({ result, busy, error, editingDisabled, onRun, onEdit }: Props) {
  const [filter, setFilter] = useState('');
  const groups = new Map<string, PageGroup>();
  for (const finding of result?.findings ?? []) {
    const key = finding.objectId ?? finding.file;
    const group = groups.get(key);
    if (group) group.findings.push(finding);
    else
      groups.set(key, {
        key,
        id: finding.objectId,
        title: finding.pageTitle ?? '目标 Wiki 不可用',
        findings: [finding],
      });
  }
  const countsByTitle = new Map<string, number>();
  let pageCount = 0;
  const matches: PageGroup[] = [];
  for (const group of groups.values()) {
    if (group.id) {
      pageCount += 1;
      countsByTitle.set(group.title, (countsByTitle.get(group.title) ?? 0) + 1);
    }
    const findings = filter ? group.findings.filter((finding) => finding.code === filter) : group.findings;
    if (findings.length) matches.push({ ...group, findings });
  }
  matches.sort(
    (left, right) => right.findings.length - left.findings.length || left.title.localeCompare(right.title, 'zh-CN'),
  );
  const total = result?.findings.length ?? 0;
  const count = matches.reduce((sum, group) => sum + group.findings.length, 0);
  const selectedRule = rules[filter];

  return (
    <section className="panel wiki-lint" aria-label="结构检查结果">
      <div className="panel-heading">
        <div>
          <h2>结构检查（Lint）</h2>
          <p>检查全库 Markdown 文件和知识页关联。</p>
        </div>
        <button type="button" className="secondary-button" disabled={busy} onClick={onRun}>
          重新检查
        </button>
      </div>
      <div className="wiki-lint-body">
        {error && (
          <div className="lint-notice lint-notice-error" role="alert">
            <strong>结构检查失败</strong>
            <p>{error} 如需再试，请选择「重新检查」。</p>
          </div>
        )}
        {busy && (
          <p className="lint-notice" role="status">
            正在检查知识库…
          </p>
        )}
        {!busy && result && (
          <>
            <p className={`lint-notice ${!error && total === 0 ? 'lint-notice-clean' : ''}`} role="status">
              <strong>{error ? '上次检查结果' : 'Lint 检查完成'}</strong>
              {total > 0 ? (
                <span>
                  共 {total} 个问题 · 涉及 {pageCount} 个 Wiki 页面
                </span>
              ) : (
                <span>没有发现结构问题。</span>
              )}
            </p>
            {total > 0 && (
              <>
                <div className="lint-filters" role="group" aria-label="按问题类型筛选">
                  <button type="button" aria-pressed={filter === ''} onClick={() => setFilter('')}>
                    全部<span>{total}</span>
                  </button>
                  {Object.entries(rules)
                    .sort(([left], [right]) => (result.summary[right] ?? 0) - (result.summary[left] ?? 0))
                    .map(([code, rule]) => (
                      <button type="button" key={code} aria-pressed={filter === code} onClick={() => setFilter(code)}>
                        {rule.label}
                        <span>{result.summary[code] ?? 0}</span>
                      </button>
                    ))}
                </div>
                {selectedRule && (
                  <p className="lint-rule-guide">
                    <strong>修复建议</strong> {selectedRule.guide}
                  </p>
                )}
                <p className="lint-match-count" role="status">
                  显示 {count} / {total} 条问题
                </p>
                {matches.length ? (
                  <ul className="lint-page-groups" aria-label="按页面分组的问题">
                    {matches.map((group) => (
                      <LintPageGroup
                        key={group.key}
                        group={group}
                        hasDuplicateTitle={(countsByTitle.get(group.title) ?? 0) > 1}
                        editingDisabled={editingDisabled}
                        onEdit={onEdit}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="lint-filter-empty">当前类型没有命中的问题。</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function LintPageGroup({
  group,
  hasDuplicateTitle,
  editingDisabled,
  onEdit,
}: {
  group: PageGroup;
  hasDuplicateTitle: boolean;
  editingDisabled: boolean;
  onEdit: Props['onEdit'];
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const groupRules = new Map<string, { count: number; commonMessage?: string }>();
  for (const finding of group.findings) {
    const item = groupRules.get(finding.code);
    if (item) {
      item.count += 1;
      if (item.commonMessage !== finding.message) item.commonMessage = undefined;
    } else {
      groupRules.set(finding.code, {
        count: 1,
        commonMessage: rulesWithItemDetails.has(finding.code) ? undefined : finding.message,
      });
    }
  }
  const commonNotes = [...groupRules].filter(([, rule]) => rule.count > 1 && rule.commonMessage);
  return (
    <li className="lint-page-group" data-wiki-id={group.id ?? undefined}>
      <div className="lint-page-header">
        <button
          type="button"
          className="lint-page-toggle"
          aria-controls={detailsId}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="m6 3 5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="lint-page-name">
            <strong>{group.title}</strong>
            {hasDuplicateTitle && <small title={group.id ?? undefined}>页面 ID {group.id?.slice(0, 8)}</small>}
            <span className="lint-page-types">
              {[...groupRules].map(([code, rule]) => (
                <span className="lint-type-count" key={code}>
                  {rules[code]?.label ?? '其他结构问题'} {rule.count}
                </span>
              ))}
            </span>
          </span>
          <span className="lint-page-count">{group.findings.length} 条</span>
        </button>
        {group.id ? (
          <button
            type="button"
            className="secondary-button lint-edit-button"
            disabled={editingDisabled}
            onClick={() => onEdit(group.id!)}
          >
            前往编辑
          </button>
        ) : (
          <span className="lint-edit-unavailable">无法编辑</span>
        )}
      </div>
      <div id={detailsId} hidden={!open}>
        {open && (
          <>
            {commonNotes.length > 0 && (
              <div className="lint-group-notes">
                {commonNotes.map(([code, rule]) => (
                  <p key={code}>
                    <strong>{rules[code]?.label ?? '其他结构问题'}</strong> {rule.commonMessage}
                  </p>
                ))}
              </div>
            )}
            <ul className="lint-findings">
              {group.findings.map((finding, index) => (
                <li key={`${finding.code}-${finding.location.line}-${index}`}>
                  <div className="lint-finding-heading">
                    <span>{finding.location.scope === 'line' ? `L${finding.location.line}` : '页面属性'}</span>
                    <strong>{rules[finding.code]?.label ?? '其他结构问题'}</strong>
                  </div>
                  {finding.location.scope === 'line' && finding.location.text && (
                    <pre className="lint-source-line">{finding.location.text}</pre>
                  )}
                  {!commonNotes.some(([code]) => code === finding.code) && <p>{finding.message}</p>}
                  <small className="lint-finding-meta">
                    <code>{finding.file}</code>
                    <code>{finding.code}</code>
                  </small>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </li>
  );
}
