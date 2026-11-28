import { useEffect, useState, type FormEvent } from 'react';
import type { WorkItem, WorkItemKind, WorkItemSummary } from '../../api';
import { createWorkItem, workItem, workItems } from '../../api';
import { errorText } from './workItemShared';

export function useWorkItemsState({
  initialId,
  initialFocusMaterials = false,
  onChanged,
}: {
  initialId: string | null;
  initialFocusMaterials?: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'list' | 'create' | 'detail'>(initialId ? 'detail' : 'list');
  const [id, setId] = useState(initialId);
  const [focusMaterials, setFocusMaterials] = useState(initialFocusMaterials);
  const [items, setItems] = useState<WorkItemSummary[] | null>(null);
  const [item, setItem] = useState<WorkItem | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [title, setTitle] = useState('');
  const [feedback, setFeedback] = useState('');
  const [createKind, setCreateKind] = useState<WorkItemKind>('customer_issue');
  const [goal, setGoal] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | WorkItemKind>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');

  useEffect(() => {
    if (mode === 'create' || (mode === 'detail' && item?.id === id)) return;
    let active = true;
    setLoadError('');
    if (mode === 'list') {
      setItems(null);
      void workItems()
        .then((result) => {
          if (active) setItems(result);
        })
        .catch((error) => {
          if (active) setLoadError(errorText(error));
        });
    } else if (id) {
      void workItem(id)
        .then((result) => {
          if (active) setItem(result);
        })
        .catch((error) => {
          if (active) setLoadError(errorText(error));
        });
    }
    return () => {
      active = false;
    };
  }, [mode, id, item?.id, reload]);

  const back = () => {
    setItem(null);
    setId(null);
    setFocusMaterials(false);
    setLoadError('');
    setMode('list');
  };
  const open = (nextId: string) => {
    setItem(null);
    setId(nextId);
    setMode('detail');
    window.scrollTo(0, 0);
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const saved = await createWorkItem(
        createKind === 'product_analysis' ? { kind: createKind, title, goal } : { title, feedback },
      );
      setItem(saved);
      setId(saved.id);
      setTitle('');
      setFeedback('');
      setGoal('');
      setMode('detail');
      onChanged();
    } catch (error) {
      setCreateError(errorText(error));
    } finally {
      setCreating(false);
    }
  };

  const beginCreate = (kind: WorkItemKind) => {
    setCreateKind(kind);
    setCreateError('');
    setMode('create');
  };
  const product = createKind === 'product_analysis';
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasFilters = Boolean(normalizedQuery) || kindFilter !== 'all' || statusFilter !== 'all';
  const filteredItems = items
    ? items.filter((entry) => {
        if (kindFilter !== 'all' && (entry.kind ?? 'customer_issue') !== kindFilter) return false;
        if (statusFilter === 'active' && entry.status === 'closed') return false;
        if (statusFilter === 'closed' && entry.status !== 'closed') return false;
        if (normalizedQuery && !entry.title.toLowerCase().includes(normalizedQuery)) return false;
        return true;
      })
    : null;

  return {
    mode,
    setMode,
    id,
    setId,
    focusMaterials,
    setFocusMaterials,
    items,
    setItems,
    item,
    setItem,
    loadError,
    setLoadError,
    reload,
    setReload,
    title,
    setTitle,
    feedback,
    setFeedback,
    createKind,
    setCreateKind,
    goal,
    setGoal,
    createError,
    setCreateError,
    creating,
    setCreating,
    searchQuery,
    setSearchQuery,
    kindFilter,
    setKindFilter,
    statusFilter,
    setStatusFilter,
    back,
    open,
    create,
    beginCreate,
    product,
    normalizedQuery,
    hasFilters,
    filteredItems,
  };
}
export type WorkItemsState = ReturnType<typeof useWorkItemsState>;
