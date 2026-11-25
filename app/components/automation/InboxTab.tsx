import type { CandidateList, PipelineSettings, ReminderView } from '../../api';
import { NewsInboxPanel } from './NewsInboxPanel';
import { WorkRemindersPanel } from './WorkRemindersPanel';
import type { InboxCandidateFilter, InboxSection } from './automationMeta';

export type InboxTabProps = {
  showReminders: boolean;
  hasPipeline: boolean;
  section: InboxSection;
  onSectionChange: (next: InboxSection) => void;
  focusTarget: InboxSection | null;
  focusTick: number;
  token?: string;
  paused?: boolean;
  candidates?: CandidateList;
  candidatesReadError: string;
  candidateDate?: string;
  onCandidateDateChange: (nextDate?: string) => void;
  candidateFilter: InboxCandidateFilter;
  onCandidateFilterChange: (nextFilter: InboxCandidateFilter) => void;
  pipelineSettings?: PipelineSettings;
  pipelineSettingsError: string;
  onOpenPipelineSettings: () => void;
  onPipelineChanged: () => void;
  remindersView: ReminderView | null;
  remindersReadError: string;
  onRemindersViewChange: (next: ReminderView) => void;
  onRemindersChanged: () => void;
  onOpenReminderSettings: () => void;
  onOpenWorkItem?: (id: string, focusMaterials?: boolean) => void;
  onOpenRaw: (id: string) => void;
  onOpenDraft: (id: string) => void;
  onOpenWiki?: (id: string) => void;
  onOpenRun: (id: string, trigger?: HTMLElement | null) => void;
};

/** Combined inbox tab holding the 5-stage news candidate funnel and categorized work reminders. */
export function InboxTab({
  showReminders,
  hasPipeline,
  section,
  onSectionChange,
  focusTarget,
  focusTick,
  token,
  paused,
  candidates,
  candidatesReadError,
  candidateDate,
  onCandidateDateChange,
  candidateFilter,
  onCandidateFilterChange,
  pipelineSettings,
  pipelineSettingsError,
  onOpenPipelineSettings,
  onPipelineChanged,
  remindersView,
  remindersReadError,
  onRemindersViewChange,
  onRemindersChanged,
  onOpenReminderSettings,
  onOpenWorkItem,
  onOpenRaw,
  onOpenDraft,
  onOpenWiki,
  onOpenRun,
}: InboxTabProps) {
  if (!showReminders && !hasPipeline) {
    return (
      <section className="panel automation-panel">
        <p>当前未启用收件箱或事项提醒来源。</p>
      </section>
    );
  }

  const showSubtabs = showReminders && hasPipeline;
  const activeSection: InboxSection = showSubtabs ? section : hasPipeline ? 'candidates' : 'reminders';
  const pendingCandidates = candidates?.counts.pending ?? 0;
  const unreadReminders = remindersView?.unreadCount ?? 0;

  const renderCandidates = () => (
    <NewsInboxPanel
      candidates={candidates}
      readError={candidatesReadError}
      date={candidateDate}
      onDateChange={onCandidateDateChange}
      filter={candidateFilter}
      onFilterChange={onCandidateFilterChange}
      focusTick={focusTarget === 'candidates' ? focusTick : 0}
      token={token}
      paused={paused}
      pipelineSettings={pipelineSettings}
      pipelineSettingsError={pipelineSettingsError}
      onOpenPipelineSettings={onOpenPipelineSettings}
      onChanged={onPipelineChanged}
      onOpenRaw={onOpenRaw}
      onOpenDraft={onOpenDraft}
      onOpenWiki={onOpenWiki}
      onOpenRun={onOpenRun}
    />
  );

  const renderReminders = () =>
    onOpenWorkItem ? (
      <WorkRemindersPanel
        token={token}
        view={remindersView}
        readError={remindersReadError}
        focusTick={focusTarget === 'reminders' ? focusTick : 0}
        onViewChange={onRemindersViewChange}
        onChanged={onRemindersChanged}
        onOpenSettings={onOpenReminderSettings}
        onOpenWorkItem={onOpenWorkItem}
      />
    ) : null;

  if (!showSubtabs) {
    return activeSection === 'candidates' ? renderCandidates() : renderReminders();
  }

  return (
    <>
      <div
        className="automation-subtabs"
        role="tablist"
        aria-label="收件箱分类"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next: InboxSection =
            event.key === 'Home'
              ? 'candidates'
              : event.key === 'End'
                ? 'reminders'
                : activeSection === 'candidates'
                  ? 'reminders'
                  : 'candidates';
          onSectionChange(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#automation-subtab-${next}`)?.focus();
        }}
      >
        <button
          type="button"
          role="tab"
          id="automation-subtab-candidates"
          aria-controls="automation-subpanel-candidates"
          aria-selected={activeSection === 'candidates'}
          tabIndex={activeSection === 'candidates' ? 0 : -1}
          onClick={() => onSectionChange('candidates')}
        >
          资讯候选
          <span className="automation-subtab-badge">待确认 {pendingCandidates}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="automation-subtab-reminders"
          aria-controls="automation-subpanel-reminders"
          aria-selected={activeSection === 'reminders'}
          tabIndex={activeSection === 'reminders' ? 0 : -1}
          onClick={() => onSectionChange('reminders')}
        >
          事项提醒
          <span className="automation-subtab-badge">未读 {unreadReminders}</span>
        </button>
      </div>
      <div
        role="tabpanel"
        id="automation-subpanel-candidates"
        aria-labelledby="automation-subtab-candidates"
        hidden={activeSection !== 'candidates'}
      >
        {activeSection === 'candidates' && renderCandidates()}
      </div>
      <div
        role="tabpanel"
        id="automation-subpanel-reminders"
        aria-labelledby="automation-subtab-reminders"
        hidden={activeSection !== 'reminders'}
      >
        {activeSection === 'reminders' && renderReminders()}
      </div>
    </>
  );
}
