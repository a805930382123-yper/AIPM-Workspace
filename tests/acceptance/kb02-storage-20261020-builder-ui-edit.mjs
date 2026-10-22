import fs from 'node:fs/promises';const f='app/pages/RawPage.tsx';let s=(await fs.readFile(f,'utf8')).replaceAll('\r\n','\n');s=s.replace('startExtract, startSynthesisWorkflow','startExtract, reconcileExtractionStorage, startSynthesisWorkflow');s=s.replace('job={job} busy={aiBusy}', 'job={job} onStorageReconciled={value => { onJobStarted(value, navigationGeneration, selectionGeneration); void onRefresh(); }} busy={aiBusy}');s=s.replace('onStartAi, onReimport, onDelete, onOpenDraft }: {','onStartAi, onReimport, onDelete, onOpenDraft, onStorageReconciled }: {');s=s.replace('item: Raw; state?: RawProcessingState; job: ExtractionJob | null; busy: boolean; error: string;', 'item: Raw; state?: RawProcessingState; job: ExtractionJob | null; busy: boolean; error: string; onStorageReconciled: (job: ExtractionJob) => void;');s=s.replace("  const status = state?.status ?? 'unprocessed';",`  const status = state?.status ?? 'unprocessed';
  const [savingState, setSavingState] = useState(false);
  const [savingError, setSavingError] = useState('');
  const recoveryGeneration = useRef(0);
  useEffect(() => { recoveryGeneration.current++; setSavingState(false); setSavingError(''); return () => { recoveryGeneration.current++; }; }, [item.id]);`);
s=s.replace('  const progressText =',`  const storageBlocked = !!activeJob?.recovery;
  const retryStorage = async () => {
    if (!activeJob) return;
    const generation = recoveryGeneration.current;
    setSavingState(true); setSavingError('');
    try {
      const saved = await reconcileExtractionStorage(activeJob.jobId);
      if (generation !== recoveryGeneration.current) return;
      setStoredJob(saved); onStorageReconciled(saved);
    } catch (error) { if (generation === recoveryGeneration.current) setSavingError(error instanceof Error ? error.message : '保存状态失败。'); }
    finally { if (generation === recoveryGeneration.current) setSavingState(false); }
  };
  const progressText =`);
s=s.replace('disabled={busy} onClick={() => onStartAi()', 'disabled={busy || storageBlocked} onClick={() => onStartAi()');s=s.replace("status === 'processing' && activeJob && <button", "status === 'processing' && activeJob && activeJob.execution !== 'settled' && !storageBlocked && <button");s=s.replace("status === 'pending_confirmation' && state?.draftId && <button", "status === 'pending_confirmation' && state?.draftId && !storageBlocked && <button");s=s.replace('    {progressText &&', `    {storageBlocked && <section className="notice-warn" role="alert"><b>{activeJob?.execution === 'running' ? '任务正在停止，状态保存失败' : '任务已停止，状态保存失败'}</b><p>{activeJob?.recovery?.message}（{activeJob?.recovery?.phase}）</p><p>重试保存只对账本机状态，不会重新调用模型。</p><button className="secondary-button" disabled={savingState || activeJob?.execution !== 'settled'} onClick={() => void retryStorage()}>{savingState ? '正在保存状态…' : '重试保存状态'}</button>{savingError && <p className="form-error">{savingError}</p>}</section>}
    {progressText &&`);
// planning/restart actions all use busy guard, including inline existing buttons.
s=s.replaceAll('disabled={busy}', 'disabled={busy || storageBlocked}');
await fs.writeFile(f,s);
