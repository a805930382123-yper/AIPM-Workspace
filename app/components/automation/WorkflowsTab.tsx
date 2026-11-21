import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { automationTime } from '../../api';
import type {
  AutomationList,
  AutomationSchedule,
  CandidateFilter,
  CandidateList,
  KnowledgeHealth,
  ReminderView,
  WeeklyReviewList,
} from '../../api';
import {
  describePlan,
  isActive,
  issueLabels,
  lastCompletedIsoWeek,
  statusLabels,
  workflowMeta,
} from './automationMeta';

export type WorkflowsTabProps = {
  schedules: AutomationList<AutomationSchedule> | null;
  schedulesError: string;
  runErrorText: string;
  pending: boolean;
  hasStatus: boolean;
  writeToken?: string;
  health: KnowledgeHealth | null;
  healthError: string;
  showHealth: boolean;
  candidates?: CandidateList;
  remindersView: ReminderView | null;
  showReminders: boolean;
  weeklyList: WeeklyReviewList | null;
  weeklyError: string;
  weeklyReadError: string;
  weeklyPending: boolean;
  weeklyConflict: boolean;
  onEditSchedule: (schedule: AutomationSchedule) => void;
  onRunTask: (type: string, trigger: HTMLElement | null) => void;
  onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
  onOpenInbox: (target: 'candidates' | 'reminders', filter?: CandidateFilter) => void;
  onOpenLint?: () => void;
  onOpenInspection?: (id?: string) => void;
  onOpenWeeklyReview?: (weekKey: string) => void;
  onToggleWeeklyAi: (enabled: boolean, revision: number) => void;
  onReloadWeekly: () => void;
};

type FlowStep = {
  title: string;
  detail: string;
  onClick?: () => void;
};

type Pill = {
  label: string;
  tone: 'ok' | 'muted' | 'accent' | 'warning' | 'safe' | 'neutral';
};

const knownTypes = new Set([
  'news.daily',
  'wiki.lint',
  'wiki.inspect',
  'work.reminders',
  'review.weekly',
  'system.selfcheck',
]);

function Badges({ items }: { items: Pill[] }) {
  return (
    <div className="automation-badges">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="automation-pill" data-tone={item.tone}>
          {item.label}
        </span>
      ))}
    </div>
  );
}

function TaskBadges({ task, boundary }: { task: AutomationSchedule; boundary?: string }) {
  const items: Pill[] = [
    { label: task.enabled ? '已启用' : '已停用', tone: task.enabled ? 'ok' : 'muted' },
    { label: describePlan(task.plan), tone: 'neutral' },
    { label: task.mayCallModel ? '可能调用模型' : '无需模型调用', tone: task.mayCallModel ? 'accent' : 'neutral' },
  ];
  if (boundary) items.push({ label: boundary, tone: 'safe' });
  return <Badges items={items} />;
}

function FlowStrip({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="automation-flow-strip" role="group" aria-label="流程阶段">
      {steps.map((step, index) => (
        <Fragment key={step.title}>
          {index > 0 && (
            <span className="automation-flow-arrow" aria-hidden="true">
              ›
            </span>
          )}
          {step.onClick ? (
            <button type="button" className="automation-flow-step" onClick={step.onClick}>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </button>
          ) : (
            <div className="automation-flow-step">
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function TaskFacts({
  task,
  onOpenRun,
}: {
  task: AutomationSchedule;
  onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
}) {
  return (
    <dl className="automation-facts">
      <div>
        <dt>下次运行</dt>
        <dd>{automationTime(task.nextRunAt)}</dd>
      </div>
      <div>
        <dt>补跑</dt>
        <dd>{task.catchUp ? '已开启' : '已关闭'}</dd>
      </div>
      <div>
        <dt>最近结果</dt>
        <dd>
          {task.lastRun ? (
            <button
              type="button"
              className="text-button"
              onClick={event => onOpenRun(task.lastRun!.id, event.currentTarget)}
            >
              {statusLabels[task.lastRun.status]} · {automationTime(task.lastRun.scheduledAt)}
            </button>
          ) : (
            '暂无运行'
          )}
        </dd>
      </div>
    </dl>
  );
}

function TaskActions({
  task,
  pending,
  hasStatus,
  onEditSchedule,
  onRunTask,
  extra,
}: {
  task: AutomationSchedule;
  pending: boolean;
  hasStatus: boolean;
  onEditSchedule: (schedule: AutomationSchedule) => void;
  onRunTask: (type: string, trigger: HTMLElement | null) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="automation-actions">
      <button type="button" className="secondary-button" disabled={pending} onClick={() => onEditSchedule(task)}>
        编辑计划
      </button>
      <button
        type="button"
        className="primary-button"
        disabled={pending || !hasStatus || Boolean(task.lastRun && isActive(task.lastRun.status))}
        onClick={event => onRunTask(task.type, event.currentTarget)}
      >
        立即运行
      </button>
      {extra}
    </div>
  );
}

export function WorkflowsTab(props: WorkflowsTabProps) {
  const {
    schedules,
    schedulesError,
    runErrorText,
    pending,
    hasStatus,
    writeToken,
    health,
    healthError,
    showHealth,
    candidates,
    remindersView,
    showReminders,
    weeklyList,
    weeklyError,
    weeklyReadError,
    weeklyPending,
    weeklyConflict,
    onEditSchedule,
    onRunTask,
    onOpenRun,
    onOpenInbox,
    onOpenLint,
    onOpenInspection,
    onOpenWeeklyReview,
    onToggleWeeklyAi,
    onReloadWeekly,
  } = props;

  const tasks = schedules?.items ?? [];
  const byType = new Map(tasks.map(task => [task.type, task]));
  const newsTask = byType.get('news.daily');
  const lintTask = byType.get('wiki.lint');
  const inspectTask = byType.get('wiki.inspect');
  const remindersTask = byType.get('work.reminders');
  const weeklyTask = byType.get('review.weekly');
  const selfcheckTask = byType.get('system.selfcheck');
  const extraTasks = tasks.filter(task => !knownTypes.has(task.type));

  const lint = health?.lint;
  const inspection = health?.inspection;
  const latestWeekly = weeklyList?.items[0];
  const weeklyTargetKey = latestWeekly?.weekKey ?? lastCompletedIsoWeek();

  const renderNewsCard = (task: AutomationSchedule) => {
    const meta = workflowMeta['news.daily'];
    const counts = candidates?.counts;
    const organizeFilter: CandidateFilter = counts
      ? counts.organizing > 0
        ? 'organizing'
        : counts.failed > 0
          ? 'failed'
          : 'all'
      : 'organizing';
    return (
      <article className="automation-workflow-card" key={task.type} aria-label={task.name}>
        <div className="automation-heading">
          <div>
            <h3>{meta.title}</h3>
            <p className="automation-workflow-desc">
              {meta.description}
              {task.name !== meta.title ? `（${task.name}）` : ''}
            </p>
            <TaskBadges task={task} boundary={meta.boundary} />
          </div>
        </div>
        <FlowStrip
          steps={[
            { title: '① 定时抓取与 AI 预筛', detail: '自动获取来源摘要与主题预筛（仅供参考）' },
            {
              title: '② 人工确认入库',
              detail: `待确认 ${counts ? counts.pending : '—'} 条`,
              onClick: () => onOpenInbox('candidates', 'pending'),
            },
            {
              title: '③ 自动整理待审草稿',
              detail: `整理中 ${counts ? counts.organizing : '—'} · 待审 ${counts ? counts.drafts : '—'} · 失败 ${counts ? counts.failed : '—'}`,
              onClick: () => onOpenInbox('candidates', organizeFilter),
            },
          ]}
        />
        <TaskFacts task={task} onOpenRun={onOpenRun} />
        <TaskActions
          task={task}
          pending={pending}
          hasStatus={hasStatus}
          onEditSchedule={onEditSchedule}
          onRunTask={onRunTask}
          extra={
            <button
              type="button"
              className="secondary-button"
              onClick={() => onOpenInbox('candidates', 'all')}
            >
              前往收件箱
            </button>
          }
        />
      </article>
    );
  };

  const renderKnowledgeHealthCard = () => {
    const subTasks = [lintTask, inspectTask].filter((item): item is AutomationSchedule => Boolean(item));
    if (!subTasks.length) return null;
    const meta = workflowMeta['wiki.health'];
    const enabledCount = subTasks.filter(item => item.enabled).length;
    const openKnowledgeAction =
      onOpenInspection && inspection && inspection.pendingCount > 0
        ? () => onOpenInspection(inspection.inspectionId)
        : onOpenLint
          ? onOpenLint
          : onOpenInspection
            ? () => onOpenInspection(inspection?.inspectionId)
            : undefined;

    return (
      <article className="automation-workflow-card" key="wiki.health" aria-label={meta.title}>
        <div className="automation-heading">
          <div>
            <h3>{meta.title}</h3>
            <p className="automation-workflow-desc">{meta.description}</p>
            <Badges
              items={[
                {
                  label:
                    enabledCount === subTasks.length
                      ? '全部已启用'
                      : enabledCount > 0
                        ? '部分已启用'
                        : '已停用',
                  tone: enabledCount > 0 ? 'ok' : 'muted',
                },
                { label: subTasks.length > 1 ? '双轨巡检' : '单轨巡检', tone: 'neutral' },
                {
                  label: subTasks.some(item => item.mayCallModel) ? '主动巡检可能调用模型' : '无需模型调用',
                  tone: subTasks.some(item => item.mayCallModel) ? 'accent' : 'neutral',
                },
                { label: meta.boundary, tone: 'safe' },
              ]}
            />
          </div>
        </div>
        <FlowStrip
          steps={[
            { title: '① 每日结构 / 每周一主动巡检', detail: '按计划扫描 Wiki 结构链接与主题一致性' },
            { title: '② 只读产出快照与发现', detail: '不改正式 Wiki，保留比对快照与待核清单' },
            {
              title: '③ 前往知识库处理',
              detail: `结构新增 ${lint ? lint.addedCount : '—'} · 主动待核 ${inspection ? inspection.pendingCount : '—'}`,
              onClick: openKnowledgeAction,
            },
          ]}
        />
        {healthError && (
          <p className="form-error" role="alert">
            巡检摘要读取失败。{healthError}
          </p>
        )}
        {showHealth && !health && !healthError && <p role="status">正在读取巡检摘要…</p>}
        {health?.issues.map(issue => (
          <p key={issue.file} className="form-error" role="alert">
            {issueLabels[issue.reason]} · {issue.file}
          </p>
        ))}
        <div className="automation-subtasks">
          {subTasks.map(subtask => {
            const isLint = subtask.type === 'wiki.lint';
            const summaryText = isLint
              ? lint
                ? `总问题 ${lint.total} 项 · ${lint.isBaseline ? '首次检查基线' : `较上次新增 ${lint.addedCount} 项 · 消除 ${lint.resolvedCount} 项`} · ${automationTime(lint.checkedAt)}（上海）`
                : '暂无成功巡检记录'
              : inspection
                ? `待核发现 ${inspection.pendingCount} 项 · 实读 ${inspection.readCount} 页 · ${automationTime(inspection.checkedAt)}（上海）`
                : '暂无已归档的巡检记录';
            return (
              <div className="automation-subtask" key={subtask.type} aria-label={subtask.name}>
                <div className="automation-heading">
                  <div>
                    <h4>{isLint ? '结构检查' : '主动检查'}</h4>
                    <TaskBadges task={subtask} />
                  </div>
                </div>
                <p className="automation-subtask-summary">{summaryText}</p>
                <TaskFacts task={subtask} onOpenRun={onOpenRun} />
                <TaskActions
                  task={subtask}
                  pending={pending}
                  hasStatus={hasStatus}
                  onEditSchedule={onEditSchedule}
                  onRunTask={onRunTask}
                  extra={
                    isLint
                      ? onOpenLint && (
                          <button type="button" className="text-button" onClick={onOpenLint}>
                            查看结构检查
                          </button>
                        )
                      : onOpenInspection && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => onOpenInspection(inspection?.inspectionId)}
                          >
                            查看主动检查
                          </button>
                        )
                  }
                />
              </div>
            );
          })}
        </div>
      </article>
    );
  };

  const renderRemindersCard = (task: AutomationSchedule) => {
    const meta = workflowMeta['work.reminders'];
    return (
      <article className="automation-workflow-card" key={task.type} aria-label={task.name}>
        <div className="automation-heading">
          <div>
            <h3>{meta.title}</h3>
            <p className="automation-workflow-desc">
              {meta.description}
              {task.name !== meta.title ? `（${task.name}）` : ''}
            </p>
            <TaskBadges task={task} boundary={meta.boundary} />
          </div>
        </div>
        <FlowStrip
          steps={[
            { title: '① 扫描到期 / 久未推进 / 新资料', detail: '定时只读检查工作事项与分析依据' },
            { title: '② 去重消解 + 桌面通知', detail: '受免打扰控制' },
            {
              title: '③ 事项提醒列表',
              detail: `未读 ${remindersView ? remindersView.unreadCount : '—'} · 活动 ${remindersView ? remindersView.items.length : '—'}`,
              onClick: showReminders ? () => onOpenInbox('reminders') : undefined,
            },
          ]}
        />
        <TaskFacts task={task} onOpenRun={onOpenRun} />
        <TaskActions
          task={task}
          pending={pending}
          hasStatus={hasStatus}
          onEditSchedule={onEditSchedule}
          onRunTask={onRunTask}
          extra={
            showReminders && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenInbox('reminders')}
              >
                前往提醒
              </button>
            )
          }
        />
      </article>
    );
  };

  const renderWeeklyCard = (task: AutomationSchedule) => {
    const meta = workflowMeta['review.weekly'];
    const archiveLabel = latestWeekly
      ? `最近 ${latestWeekly.weekKey} · ${latestWeekly.status === 'reviewed' ? '已审阅归档' : '草稿'}`
      : '暂无归档';
    return (
      <article className="automation-workflow-card" key={task.type} aria-label={task.name}>
        <div className="automation-heading">
          <div>
            <h3>{meta.title}</h3>
            <p className="automation-workflow-desc">{meta.description}</p>
            <TaskBadges task={task} boundary={meta.boundary} />
          </div>
        </div>
        <FlowStrip
          steps={[
            { title: '① 汇总上一自然周事实快照', detail: '聚合知识库、工作事项、资讯与运行事实' },
            { title: '② 按开关起草 AI 周报', detail: '不覆盖人工编辑/已审阅归档' },
            {
              title: '③ 周期回顾归档',
              detail: archiveLabel,
              onClick: onOpenWeeklyReview ? () => onOpenWeeklyReview(weeklyTargetKey) : undefined,
            },
          ]}
        />
        <TaskFacts task={task} onOpenRun={onOpenRun} />
        <div className="automation-weekly-setting">
          {weeklyReadError && (
            <p className="form-error" role="alert">
              周报设置读取失败：{weeklyReadError}
            </p>
          )}
          {!weeklyList && !weeklyReadError && <p role="status">正在读取周报设置…</p>}
          {weeklyList?.issues?.map(issue => (
            <p key={issue.file} className="form-error" role="alert">
              {issueLabels[issue.reason]} · {issue.file}
            </p>
          ))}
          {weeklyList && (
            <>
              <label className="automation-check">
                <input
                  type="checkbox"
                  checked={weeklyList.settings.aiSummaryEnabled}
                  disabled={weeklyPending || !writeToken}
                  onChange={event =>
                    onToggleWeeklyAi(event.target.checked, weeklyList.settings.revision)
                  }
                />
                启用自动 AI 周报总结
              </label>
              <span className="automation-weekly-meta">
                {weeklyList.settings.aiSummaryEnabled
                  ? '已开启：周报任务会在事实快照基础上生成 AI 总结草稿'
                  : '已关闭：周报任务仅保存确定性事实快照'}
              </span>
            </>
          )}
          {weeklyError && (
            <p className="form-error" role="alert">
              {weeklyError}
            </p>
          )}
          {(weeklyConflict || weeklyReadError) && (
            <div className="automation-actions">
              <button
                type="button"
                className="text-button"
                disabled={weeklyPending}
                onClick={onReloadWeekly}
              >
                重新读取设置
              </button>
            </div>
          )}
        </div>
        <TaskActions
          task={task}
          pending={pending}
          hasStatus={hasStatus}
          onEditSchedule={onEditSchedule}
          onRunTask={onRunTask}
          extra={
            onOpenWeeklyReview && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenWeeklyReview(weeklyTargetKey)}
              >
                {latestWeekly ? `查看最近周报（${latestWeekly.weekKey}）` : '前往自动周报'}
              </button>
            )
          }
        />
      </article>
    );
  };

  const renderSelfcheckCard = (task: AutomationSchedule) => {
    const meta = workflowMeta['system.selfcheck'];
    return (
      <article className="automation-workflow-card" key={task.type} aria-label={task.name}>
        <div className="automation-heading">
          <div>
            <h3>{meta.title}</h3>
            <p className="automation-workflow-desc">
              {meta.description}
              {task.name !== meta.title ? `（${task.name}）` : ''}
            </p>
            <TaskBadges task={task} boundary={meta.boundary} />
          </div>
        </div>
        <FlowStrip
          steps={[
            { title: '① 5 项本地健康检查', detail: '验证工作区目录、存储与调度运行状态' },
            { title: '② 仅记录诊断，无业务写入', detail: '不修改 Raw、Wiki、Prompt 或工作事项' },
            {
              title: '③ 最近自检状态',
              detail: task.lastRun
                ? `${statusLabels[task.lastRun.status]} · ${automationTime(task.lastRun.scheduledAt)}`
                : '暂无运行',
            },
          ]}
        />
        <TaskFacts task={task} onOpenRun={onOpenRun} />
        <TaskActions
          task={task}
          pending={pending}
          hasStatus={hasStatus}
          onEditSchedule={onEditSchedule}
          onRunTask={onRunTask}
        />
      </article>
    );
  };

  const renderGenericCard = (task: AutomationSchedule) => (
    <article className="automation-workflow-card" key={task.type} aria-label={task.name}>
      <div className="automation-heading">
        <div>
          <h3>{task.name}</h3>
          <TaskBadges task={task} />
        </div>
      </div>
      <TaskFacts task={task} onOpenRun={onOpenRun} />
      <TaskActions
        task={task}
        pending={pending}
        hasStatus={hasStatus}
        onEditSchedule={onEditSchedule}
        onRunTask={onRunTask}
      />
    </article>
  );

  return (
    <section className="panel automation-panel" aria-labelledby="automation-tasks">
      <div className="automation-heading">
        <div>
          <h2 id="automation-tasks">流程与计划</h2>
          <p>计划时间采用 Asia/Shanghai。</p>
        </div>
      </div>
      {schedulesError && (
        <p className="form-error" role="alert">
          任务计划读取失败：{schedulesError}
        </p>
      )}
      {!schedules && !schedulesError && <p role="status">正在读取任务计划…</p>}
      {schedules?.issues?.map(issue => (
        <p key={issue.file} className="form-error" role="alert">
          {issueLabels[issue.reason]}：{issue.file}
        </p>
      ))}
      {schedules && !tasks.length && <p>暂无可调度任务。</p>}
      {runErrorText && (
        <p className="form-error" role="alert">
          {runErrorText}
        </p>
      )}
      {newsTask && renderNewsCard(newsTask)}
      {renderKnowledgeHealthCard()}
      {remindersTask && renderRemindersCard(remindersTask)}
      {weeklyTask && renderWeeklyCard(weeklyTask)}
      {selfcheckTask && renderSelfcheckCard(selfcheckTask)}
      {extraTasks.map(renderGenericCard)}
    </section>
  );
}
