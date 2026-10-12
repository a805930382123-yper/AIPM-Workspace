import { useEffect, useState } from 'react';
import type { LlmConfigSummary } from '../api';
import { api, llmConfig } from '../api';

export function SettingsPage({ onOpenExampleTask = () => undefined, onImported = () => undefined }: { onOpenExampleTask?: (task: string) => void; onImported?: () => void }) {
  const [config, setConfig] = useState<LlmConfigSummary | null>(null);
  const [error, setError] = useState('');
  const [demo, setDemo] = useState<{version:number; imported:boolean; items:Array<{key:string;type:string;id:string;title:string;status:string}>; exampleTask:{title:string;task:string}} | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState('');
  const [demoError, setDemoError] = useState('');
  useEffect(() => {
    let active = true;
    api<LlmConfigSummary>('/api/llm/config').then(value => { if (active) setConfig(value); })
      .catch(problem => { if (active) setError(problem instanceof Error ? problem.message : '无法读取 LLM 配置。'); });
    api<NonNullable<typeof demo>>('/api/demo').then(value => { if (active) setDemo(value); }).catch(problem => { if (active) setDemoError(problem instanceof Error ? problem.message : '无法读取演示数据状态。'); });
    return () => { active = false; };
  }, []);
  const reload = async () => {
    setError('');
    try { setConfig(await llmConfig()); } catch (problem) { setError(problem instanceof Error ? problem.message : '无法读取 LLM 配置。'); }
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
    <div className="page-heading"><div><p className="eyebrow">设置 · 本机服务端配置</p><h1>设置</h1><p className="subheading">产品只调用你自己配置的服务端 Provider；API Key 不出现在页面、草稿、Wiki 或日志中。</p></div><button className="secondary-button" onClick={() => void reload()}>重新读取</button></div>
    {error && <div className="form-error" role="alert"><p>{error}</p></div>}
    <section className="panel settings-panel">
      <div className="panel-heading"><div><h2>LLM Provider</h2><p>单一 OpenAI-compatible Chat Completions 适配器（非流式）</p></div><span className={`config-badge ${config?.configured ? 'ok' : 'off'}`}>{config ? (config.configured ? '已配置' : '未配置') : '读取中…'}</span></div>
      <div className="settings-body">
        <div className="metadata-grid settings-grid">
          <div className="meta"><span>Provider</span><b>{config?.provider ?? '—'}</b></div>
          <div className="meta"><span>模型</span><b>{config?.model ?? '未配置'}</b></div>
          <div className="meta"><span>Base URL 主机</span><b>{config?.baseUrlHost ?? '未配置'}</b></div>
          <div className="meta"><span>API Key</span><b className={config?.keyConfigured ? 'mono' : ''}>{config?.keyConfigured ? config.keyMask : '未配置'}</b></div>
          <div className="meta"><span>配置来源</span><b>{config?.source === 'env' ? '环境变量' : config?.source === 'local-file' ? '本地 .env.local' : '无'}</b></div>
          <div className="meta"><span>Key 是否已配置</span><b>{config?.keyConfigured ? '是（仅显示掩码）' : '否'}</b></div>
        </div>
        {config && !config.configured && <p className="notice-warn">尚未配置：{config.missing.join('、')}。未配置时导入、手动 Wiki、搜索与导出仍可用；点击「AI 整理知识」会返回明确的缺配置错误。</p>}
        <div className="settings-help">
          <h3>如何配置</h3>
          <p>在启动服务端的终端设置环境变量（或在受忽略的 <code>{config?.configFile ?? '.env.local'}</code> 中写入同名键），然后重启服务端：</p>
          <pre>{`$env:${config?.envNames.baseUrl ?? 'FMCG_LLM_BASE_URL'} = 'https://<你的 Provider>/v1'
$env:${config?.envNames.model ?? 'FMCG_LLM_MODEL'} = '<模型名>'
$env:${config?.envNames.apiKey ?? 'FMCG_LLM_API_KEY'} = '<你的 API Key>'
npm run dev`}</pre>
          <p>只有服务端读取这些配置：浏览器端不保存 Key，接口只返回是否已配置与统一掩码。修改后无需重启页面，重新读取即可生效。</p>
        </div>
      </div>
    </section>
    <section className="panel settings-panel"><div className="panel-heading"><div><h2>演示数据</h2><p>虚构教学内容。只在点击导入后写入本机，可重复执行并保留已编辑记录。</p></div><button className="primary-button" onClick={() => void importDemo()} disabled={demoBusy}>{demoBusy ? '正在导入…' : '导入演示数据'}</button></div>
      {demoMessage && <p role="status" className="notice-ok">{demoMessage}</p>}{demoError && <p role="alert" className="form-error">{demoError}</p>}
      <div className="settings-body"><p>{demo?.imported ? '已存在演示清单；重复导入会复用现有记录，删除的条目不会自动复活。' : '尚无演示清单。导入会新建 1 条 Raw、5 条 Wiki、4 条 Prompt。'}</p>
      {demo?.items.length ? <ul className="demo-item-list">{demo.items.map(item => <li key={item.key}><span>{item.title}</span><small>{item.type} · {item.status} · {item.id}</small></li>)}</ul> : null}
      {demo?.exampleTask && <div className="demo-task"><b>演示数据 · 示例任务入口：{demo.exampleTask.title}</b><p>打开 Generator 并填入可编辑任务，不会自动调用 Provider 或保存。</p><button className="secondary-button" onClick={() => onOpenExampleTask(demo.exampleTask.task)}>打开示例任务</button></div>}
      <h3>本地备份与恢复</h3><p>停止本地服务写入后导出。恢复只写入一个不存在或空的新数据根目录；CLI 会验证文件长度与 SHA-256。</p><pre>{`node --import tsx scripts/backup_workspace.ts export --data-root <root> --output <file>\nnode --import tsx scripts/backup_workspace.ts restore --input <file> --data-root <new-root>`}</pre>
      </div>
    </section>
  </div>;
}
