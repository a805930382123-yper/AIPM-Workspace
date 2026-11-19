import { useEffect, useRef, useState } from 'react';
import type { LlmConfigSummary } from '../api';
import { api, clearLlmConfig, llmConfig, saveLlmConfig, testLlmConfig } from '../api';

export function SettingsPage({ onOpenExampleTask = () => undefined, onImported = () => undefined }: { onOpenExampleTask?: (task: string) => void; onImported?: () => void }) {
  const [config, setConfig] = useState<LlmConfigSummary | null>(null);
  const [error, setError] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [configBusy, setConfigBusy] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configMessage, setConfigMessage] = useState('');
  const [configError, setConfigError] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const sequence = useRef(0);
  const [demo, setDemo] = useState<{version:number; imported:boolean; items:Array<{key:string;type:string;id:string;title:string;status:string}>; exampleTask:{title:string;task:string}} | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState('');
  const [demoError, setDemoError] = useState('');
  useEffect(() => {
    let active = true;
    const configRequest = ++sequence.current;
    api<LlmConfigSummary>('/api/llm/config').then(value => { if (active && configRequest === sequence.current) { setConfig(value); setBaseUrl(value.baseUrl); setModel(value.model ?? ''); } })
      .catch(problem => { if (active && configRequest === sequence.current) setError(problem instanceof Error ? problem.message : '无法读取 LLM 配置。'); })
      .finally(() => { if (active && configRequest === sequence.current) setConfigLoading(false); });
    api<NonNullable<typeof demo>>('/api/demo').then(value => { if (active) setDemo(value); }).catch(problem => { if (active) setDemoError(problem instanceof Error ? problem.message : '无法读取演示数据状态。'); });
    return () => { active = false; sequence.current++; };
  }, []);
  const reload = async () => {
    setError(''); setConfigError(''); setConfigLoading(true);
    const id = ++sequence.current; setConfigMessage(''); setTestMessage('');
    try { const value = await llmConfig(); if (id === sequence.current) { setConfig(value); setBaseUrl(value.baseUrl); setModel(value.model ?? ''); } } catch (problem) { if (id === sequence.current) setError(problem instanceof Error ? problem.message : '无法读取 LLM 配置。'); }
    finally { if (id === sequence.current) setConfigLoading(false); }
  };
  const changed = Boolean(config && (baseUrl !== config.baseUrl || model !== (config.model ?? '') || apiKey.length > 0));
  const saveConfig = async () => {
    if (!config) return; const id = ++sequence.current; setConfigBusy(true); setConfigError(''); setConfigMessage(''); setTestMessage('');
    try { const value = await saveLlmConfig(config, { baseUrl, model, ...(apiKey ? { apiKey } : {}) }); if (id === sequence.current) { setConfig(value); setBaseUrl(value.baseUrl); setModel(value.model ?? ''); setApiKey(''); setConfigMessage('本机配置已保存；尚未测试连接。'); } }
    catch (problem) { if (id === sequence.current) setConfigError(problem instanceof Error ? problem.message : '保存配置失败。'); }
    finally { if (id === sequence.current) setConfigBusy(false); }
  };
  const testConfig = async () => {
    if (!config || changed) { setConfigError('有未保存的修改，请先保存再测试连接。'); return; }
    const id = ++sequence.current; setConfigBusy(true); setConfigError(''); setConfigMessage(''); setTestMessage('');
    try { const result = await testLlmConfig(config); if (id === sequence.current) setTestMessage(`${result.message}（${result.elapsedMs} ms）`); }
    catch (problem) { if (id === sequence.current) setConfigError(problem instanceof Error ? problem.message : '连接测试失败。'); }
    finally { if (id === sequence.current) setConfigBusy(false); }
  };
  const clearConfig = async () => {
    if (!config || !window.confirm('清除本机 .env.local 中的 Provider 地址、模型和 API Key？环境变量不会被清除。')) return;
    const id = ++sequence.current; setConfigBusy(true); setConfigError(''); setConfigMessage(''); setTestMessage('');
    try { const value = await clearLlmConfig(config); if (id === sequence.current) { setConfig(value); setBaseUrl(''); setModel(''); setApiKey(''); setConfigMessage('本机配置已清除。'); } }
    catch (problem) { if (id === sequence.current) setConfigError(problem instanceof Error ? problem.message : '清除配置失败。'); }
    finally { if (id === sequence.current) setConfigBusy(false); }
  };
  const importDemo = async () => {
    setDemoBusy(true); setDemoError(''); setDemoMessage('');
    try {
      const result = await api<{created:Array<{id:string}>;reused:Array<{id:string}>;deleted:Array<{id:string}>;missing:Array<{id:string}>;conflicts:Array<{id:string;reason:string}>;complete:boolean}>('/api/demo/import', { method:'POST', body:JSON.stringify({confirm:true}) });
      setDemoMessage(`创建 ${result.created.length}，复用 ${result.reused.length}，已删除 ${result.deleted.length}，待重试/冲突 ${result.missing.length + result.conflicts.length}。${result.complete ? '演示数据已就绪。' : '部分项目未完成，请查看错误并重试。'}`);
      const next = await api<NonNullable<typeof demo>>('/api/demo'); setDemo(next);
      onImported();
    } catch (problem) { setDemoError(problem instanceof Error ? problem.message : '导入演示数据失败。'); }
    finally { setDemoBusy(false); }
  };
  return <div className="page settings-page">
    <div className="page-heading"><div><h1>设置</h1><p className="subheading">产品只调用你自己配置的服务端 Provider；API Key 不出现在页面、草稿、Wiki 或日志中。</p></div><button className="secondary-button" onClick={() => void reload()} disabled={configBusy || configLoading}>重新读取</button></div>
    {error && <div className="form-error" role="alert"><p>{error}</p></div>}
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>LLM Provider</h2><p>单一 OpenAI-compatible Chat Completions 适配器（非流式）</p></div><span className={`config-badge ${config?.configured ? 'ok' : 'off'}`}>{config ? (config.configured ? '已配置' : '未配置') : configLoading ? '读取中…' : '读取失败'}</span></div>
      <div className="settings-body">
        <div className="metadata-grid settings-grid">
          <div className="meta"><span>Provider</span><b>{config?.provider ?? '—'}</b></div>
          <div className="meta"><span>模型</span><b>{config?.model ?? '未配置'}</b></div>
          <div className="meta"><span>Base URL 主机</span><b>{config?.baseUrlHost ?? '未配置'}</b></div>
          <div className="meta"><span>API Key</span><b className={config?.keyConfigured ? 'mono' : ''}>{config?.keyConfigured ? config.keyMask : '未配置'}</b></div>
          <div className="meta"><span>配置来源</span><b>{config?.source === 'env' ? '环境变量' : config?.source === 'local-file' ? '本地 .env.local' : '无'}</b></div>
          <div className="meta"><span>Key 是否已配置</span><b>{config?.keyConfigured ? '是（仅显示掩码）' : '否'}</b></div>
        </div>
        <div className="settings-config-form">
          {config?.environmentLocked && <p className="notice-warn">当前由启动环境变量覆盖，配置为只读。请先在启动终端移除 FMCG_LLM_* 覆盖并重启服务端，再从这里编辑。</p>}
          <label>API Base URL<input aria-label="API Base URL" value={baseUrl} onChange={event => { sequence.current++; setBaseUrl(event.target.value); setTestMessage(''); setConfigMessage(''); }} placeholder="https://api.example.com/v1" disabled={configLoading || configBusy || config?.environmentLocked} /></label>
          <label>模型 ID<input aria-label="模型 ID" value={model} onChange={event => { sequence.current++; setModel(event.target.value); setTestMessage(''); setConfigMessage(''); }} disabled={configLoading || configBusy || config?.environmentLocked} /></label>
          <label>API Key<input aria-label="API Key" type="password" autoComplete="new-password" value={apiKey} onChange={event => { sequence.current++; setApiKey(event.target.value); setTestMessage(''); setConfigMessage(''); }} placeholder={config?.keyConfigured ? '留空以保留已保存的 Key' : '首次保存时必填'} disabled={configLoading || configBusy || config?.environmentLocked} /></label>
          <p className="field-help">已配置时，API Key 留空会保留旧值；新 Key 仅在点击保存后发送到本机服务端，保存后输入框会清空。</p>
          <p className="field-help">连接测试会向此 Provider 发送固定的非业务消息，可能产生少量 API 费用。不会发送 Raw、Wiki、Prompt、会议内容或草稿，也不会写入业务资产。</p>
          <div className="settings-config-actions"><button className="primary-button" onClick={() => void saveConfig()} disabled={!config || configLoading || configBusy || config?.environmentLocked}>{configBusy ? '处理中…' : '保存配置'}</button><button className="secondary-button" onClick={() => void testConfig()} disabled={!config?.configured || configLoading || configBusy || changed}>测试连接</button><button className="secondary-button settings-danger" onClick={() => void clearConfig()} disabled={!config || configLoading || configBusy || config?.environmentLocked || (!config.keyConfigured && config.source !== 'local-file')}>清除本机配置</button></div>
          {changed && !configLoading && !configBusy && <p role="status" className="field-help settings-unsaved-hint">有未保存的修改，请先点击「保存配置」后再测试连接。</p>}
          {configMessage && <p role="status" className="notice-ok">{configMessage}</p>}{testMessage && <p role="status" className="notice-ok">连接测试成功：{testMessage}</p>}{configError && <p role="alert" className="form-error">{configError}</p>}
        </div>
        {config && !config.configured && <p className="notice-warn">尚未配置：{config.missing.join('、')}。未配置时导入、手动 Wiki、搜索与导出仍可用；点击「AI 整理知识」会返回明确的缺配置错误。</p>}
        <details className="settings-help">
          <summary>如何配置</summary>
          <p>在启动服务端的终端设置环境变量（或在受忽略的 <code>{config?.configFile ?? '.env.local'}</code> 中写入同名键），然后重启服务端：</p>
          <pre>{`$env:${config?.envNames.baseUrl ?? 'FMCG_LLM_BASE_URL'} = 'https://<你的 Provider>/v1'
$env:${config?.envNames.model ?? 'FMCG_LLM_MODEL'} = '<模型名>'
$env:${config?.envNames.apiKey ?? 'FMCG_LLM_API_KEY'} = '<你的 API Key>'
npm run dev`}</pre>
          <p>环境变量优先级高于 .env.local，并会锁定本页编辑。仅在设置页明确保存后，新 AI 请求使用新配置；已经开始的任务继续使用开始时的配置快照。</p>
        </details>
      </div>
    </section>
    <section className="panel settings-panel"><div className="panel-heading"><div><h2>演示数据</h2><p>虚构教学内容。只在点击导入后写入本机，可重复执行并保留已编辑记录。</p></div><button className="primary-button" onClick={() => void importDemo()} disabled={demoBusy}>{demoBusy ? '正在导入…' : '导入演示数据'}</button></div>
      {demoMessage && <p role="status" className="notice-ok">{demoMessage}</p>}{demoError && <p role="alert" className="form-error">{demoError}</p>}
      <div className="settings-body"><p>{demo?.imported ? '已存在演示清单；重复导入会复用现有记录，删除的条目不会自动复活。' : '尚无演示清单。导入会新建 1 条 Raw、5 条 Wiki、4 条 Prompt。'}</p>
      {demo?.items.length ? <ul className="demo-item-list">{demo.items.map(item => <li key={item.key}><span>{item.title}</span><small>{item.type} · {item.status} · {item.id}</small></li>)}</ul> : null}
      {demo?.exampleTask && <div className="demo-task"><b>演示数据 · 示例任务入口：{demo.exampleTask.title}</b><p>打开 Generator 并填入可编辑任务，不会自动调用 Provider 或保存。</p><button className="secondary-button" onClick={() => onOpenExampleTask(demo.exampleTask.task)}>打开示例任务</button></div>}
      <details className="settings-backup"><summary>本地备份与恢复</summary><p>停止本地服务写入后导出。恢复只写入一个不存在或空的新数据根目录；CLI 会验证文件长度与 SHA-256。</p><pre>{`node --import tsx scripts/backup_workspace.ts export --data-root <root> --output <file>\nnode --import tsx scripts/backup_workspace.ts restore --input <file> --data-root <new-root>`}</pre></details>
      </div>
    </section>
  </div>;
}
