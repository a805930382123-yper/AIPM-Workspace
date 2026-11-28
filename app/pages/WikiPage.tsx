import { WikiInspectionPanel } from '../components/WikiInspectionPanel';
import { WikiQuestionPanel, type RawCitationTarget } from '../components/WikiQuestionPanel';
import { WikiLintPanel } from '../components/WikiLintPanel';
import { WikiReviewDrawer } from '../components/WikiReview';
import type { ExtractionJob, RawProcessingState } from '../api';
import '../wiki.css';
import { useWikiWorkspace } from './wiki/useWikiWorkspace';
import { WikiOverview } from './wiki/WikiOverview';
import { WikiRawGenerator } from './wiki/WikiRawGenerator';
import { WikiDeleteDialog } from './wiki/WikiDeleteDialog';
import { wikiViews, type WikiCheckEntry } from './wiki/wikiShared';

export type { WikiCheckEntry } from './wiki/wikiShared';

export function WikiPage({
  onOpenRaw,
  onChanged,
  initialOpenId,
  initialAudit,
  initialCheck,
  onInitialAuditHandled,
  onInitialOpenHandled,
  processing = {},
  onJobStarted,
  navigationGeneration = 0,
  onOpenDraft,
  onOpenWorkflow,
  onImport,
}: {
  onOpenRaw: (id: string, target?: RawCitationTarget) => void;
  onChanged: () => void;
  initialOpenId?: string | null;
  initialAudit?: { wikiId: string; auditId: string; revision: number; wikiRevision: number } | null;
  initialCheck?: WikiCheckEntry | null;
  onInitialAuditHandled?: () => void;
  onInitialOpenHandled?: () => void;
  processing?: Record<string, RawProcessingState>;
  onJobStarted?: (job: ExtractionJob, pageGeneration?: number) => void;
  navigationGeneration?: number;
  onOpenDraft?: (id: string) => void;
  onOpenWorkflow?: (id: string) => void;
  onImport?: () => void;
}) {
  const workspace = useWikiWorkspace({
    onChanged,
    initialOpenId,
    initialCheck,
    onInitialAuditHandled,
    onInitialOpenHandled,
    processing,
    onJobStarted,
    navigationGeneration,
    onOpenDraft,
  });
  const {
    activeSubView,
    hasOpenedAsk,
    hasOpenedInspection,
    initialInspectionId,
    initialCheckTab,
    schema,
    reviewOpen,
    setReviewOpen,
    reviewChange,
    items,
    selectedId,
    lintResult,
    lintBusy,
    lintError,
    busy,
    runLint,
    openLintEditor,
    openWiki,
    applyReview,
    switchSubView,
    startCreate,
    deleteTarget,
    deleteReferences,
    setDeleteTarget,
    confirmDelete,
    chooseItem,
  } = workspace;
  return (
    <div className="page wiki-page">
      <div className="page-heading wiki-heading">
        <h1>知识库</h1>
        <div className="wiki-navigation">
          <div
            className="wiki-view-tabs"
            role="tablist"
            aria-label="知识库视图"
            onKeyDown={(event) => {
              const index = wikiViews.findIndex((view) => view.key === activeSubView);
              const last = wikiViews.length - 1;
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % wikiViews.length
                  : event.key === 'ArrowLeft'
                    ? (index + last) % wikiViews.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? last
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              switchSubView(wikiViews[next].key);
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}
          >
            {wikiViews.map(({ key, label }) => (
              <button
                type="button"
                role="tab"
                key={key}
                id={`wiki-tab-${key}`}
                ref={initialCheck?.view === key ? initialCheckTab : undefined}
                aria-selected={activeSubView === key}
                aria-controls={`wiki-view-${key}`}
                tabIndex={activeSubView === key ? 0 : -1}
                onClick={() => switchSubView(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="wiki-create-action">
            {schema?.freshnessEnabled && (
              <button
                type="button"
                className="secondary-button"
                aria-haspopup="dialog"
                onClick={() => setReviewOpen(true)}
              >
                复核工作台
              </button>
            )}
            <button className="secondary-button" onClick={startCreate} disabled={!schema}>
              <span aria-hidden="true">＋</span> 手动创建 Wiki
            </button>
          </div>
        </div>
      </div>
      <div role="tabpanel" id="wiki-view-ask" aria-labelledby="wiki-tab-ask" hidden={activeSubView !== 'ask'}>
        {hasOpenedAsk && (
          <WikiQuestionPanel
            onOpenWiki={openWiki}
            onOpenRaw={onOpenRaw}
            onOpenDraft={(id) => onOpenDraft?.(id)}
            reviewChange={reviewChange}
            onReviewed={applyReview}
          />
        )}
      </div>
      <div
        role="tabpanel"
        id="wiki-view-active-check"
        aria-labelledby="wiki-tab-active-check"
        hidden={activeSubView !== 'active-check'}
      >
        {hasOpenedInspection && (
          <WikiInspectionPanel
            items={items}
            currentWikiId={selectedId}
            initialInspectionId={initialInspectionId}
            onOpenWiki={openWiki}
            onOpenRaw={onOpenRaw}
            onOpenDraft={(id) => onOpenDraft?.(id)}
          />
        )}
      </div>
      <div role="tabpanel" id="wiki-view-lint" aria-labelledby="wiki-tab-lint" hidden={activeSubView !== 'lint'}>
        <WikiLintPanel
          result={lintResult}
          busy={lintBusy}
          error={lintError}
          editingDisabled={busy}
          onRun={() => void runLint()}
          onEdit={openLintEditor}
        />
      </div>
      <div
        role="tabpanel"
        id="wiki-view-overview"
        aria-labelledby="wiki-tab-overview"
        hidden={activeSubView !== 'overview'}
      >
        <WikiOverview
          workspace={workspace}
          onOpenWorkflow={onOpenWorkflow}
          onOpenDraft={onOpenDraft}
          onOpenRaw={onOpenRaw}
          onChanged={onChanged}
          initialAudit={initialAudit}
        />
      </div>
      <div
        role="tabpanel"
        id="wiki-view-raw-to-wiki"
        aria-labelledby="wiki-tab-raw-to-wiki"
        hidden={activeSubView !== 'raw-to-wiki'}
      >
        <WikiRawGenerator workspace={workspace} onImport={onImport} />
      </div>
      {schema?.freshnessEnabled && reviewOpen && (
        <WikiReviewDrawer onClose={() => setReviewOpen(false)} onOpenWiki={openWiki} onReviewed={applyReview} />
      )}
      {deleteTarget && (
        <WikiDeleteDialog
          item={deleteTarget}
          references={deleteReferences}
          busy={busy}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
          onOpenReference={(id) => {
            setDeleteTarget(null);
            chooseItem(id);
          }}
        />
      )}
    </div>
  );
}
