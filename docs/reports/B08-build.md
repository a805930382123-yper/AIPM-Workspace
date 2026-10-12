# B08 施工交接

**交付状态：施工完成，等待主 Agent 独立验收。** 本报告不签独立 PASS；B08 的真实 Provider 成功与输出质量仍为 BLOCKED。

## 实现

- 新增 Generator 与 Optimizer 两个工作台入口。Generator 支持六个场景与自定义，先生成可编辑 Brief（任务名、类型及 role/goal/context/input/tasks/constraints/output），再选择 Wiki 背景并生成 Prompt 预览。预览可编辑、复制、返回修改 Brief、重新生成、显式保存。
- Wiki 候选按自然语言中的关键词对现存页面标题、标签和正文排序；默认不选择，最多选择 6 页。下一次 Provider 请求只携带实际勾选的 Wiki 片段，每页最多 3,000 字符、总计 12,000 字符；回包展示实际用量、源正文长度、截取状态、标题和知识状态。
- Optimizer 保留原文，调用 Provider 返回九维检查、只对应缺项的具体改进点和完整优化 Prompt；没有总评分。可粘贴或选择 Library 当前版，编辑预览后显式保存为新项或追加到原项。保存原项校验 baseVersion 并追加 `ai_optimized`；Generator 新项来源/首版来源为 `ai_generated`，Optimizer 新项对象来源为 `optimized`、首版来源为 `ai_optimized`。普通 B07 创建/更新 API 仍不接受客户端来源字段。
- 三项 AI 能力复用现有服务端 `LlmProvider`。结构化草稿位于隔离的 `drafts/prompts/<uuid>.json`，由临时文件 rename 原子写入；不执行生成内容，不写 Raw、Wiki、知识 Index/Log 或正式 Prompt，直到显式确认。
- Prompt 确认使用 PromptStore 的串行队列和原子记录写入。记录内收据包含 requestId、模式、payload、目标版本与结果版本，成功重试返回当时写入的版本快照；请求编辑内容变化冲突。草稿标记落盘失败时响应 `PROMPT_COMMITTED_DRAFT_RECOVERY`，包含 `committed:true`、Prompt ID、版本和同 payload 重试提示，重启后可通过 Prompt 收据对账。
- Brief 上限 10,000 字符；Brief 单字段 10,000、总计 30,000；原 Prompt/预览正文 100,000；Provider 超时 60 秒、输出 512 KiB。无配置、网络/鉴权/429/超时、截断、空内容、非法 JSON、结构错误均拒绝草稿或正式保存。
- 每个 workbench 模式使用独立组件实例。请求有代次保护，编辑或切换模式后迟到结果与旧 `finally` 不可回写新状态。Optimizer 保存后刷新本地 Prompt 当前版本与正文，后续优化使用最新 baseVersion。

## 冻结 HTTP 与 Provider JSON 合同

具体请求/响应假样例见 [B08-builder-contract.json](B08-builder-contract.json)。

| 路由 | 用途 |
|---|---|
| `GET /api/prompt-ai/schema` | 六模板、自定义、九维 ID 与预算 |
| `POST /api/prompt-ai/brief` | `{task,template}`；Provider 原始 JSON 根为 Brief 九字段 |
| `POST /api/prompt-ai/generate` | `{brief,relatedWikiIds}`；Provider 原始 JSON 根为 `{preview:{...B07十字段}}` |
| `POST /api/prompt-ai/optimize` | `{body,supplement?,targetPromptId?,baseVersion?}`；Provider 根为 `{checks,improvements,preview}` |
| `GET /api/prompt-ai/drafts/:id` | 回读结构化草稿与确认收据 |
| `POST /api/prompt-ai/drafts/:id/confirm` | `{requestId,mode:'new'|'version',input:<用户编辑后的B07字段>}` |

检查维度 ID：`goal`, `role`, `context`, `input`, `tasks`, `constraints`, `output`, `fact_inference`, `anti_fabrication`。Optimizer 每项为 `{id,label,status,evidence}`；Provider 原始项省略 `label`，由服务端依据固定 ID 补齐。自定义模板 ID 为 `custom`。

## 自测与边界

- 最终 `npm run build`：退出码 0；TypeScript 检查与 Vite 构建成功（Vite 0.921 秒；命令总耗时约 9.9 秒）。沙箱内 Vite `realpath` 曾返回 EPERM，经任务授权的执行权限后成功构建。
- 最终 `npm test`：退出码 0，150/150 通过，测试框架报告 16.595 秒。首次全量运行有 148 通过、1 失败，唯一失败是既有 B07 UI 测试仍断言 B08 入口必须禁用；本批开放入口后将断言更新为四个 Generator/Optimizer 入口可用，并保留 Library 新建 payload 原断言。之后全量测试 149/149、最终加入 Wiki 背景场景后 150/150。
- B08 服务单测：4/4 通过，覆盖 Brief→生成→显式确认/幂等、确认快照在后续编辑后仍准确、Wiki 选中内容/不发送未选正文与预算、Optimizer 九维与版本来源、非法 JSON/不完整结构不落盘。
- 公开 HTTP smoke：`node tests/prompt-ai-http.mjs` 通过；由脚本以 `windowsHide:true` 启动隔离 API 子进程和 OpenAI-compatible fake，核对 schema、Brief、生成、优化、显式确认、重复确认、正式库计数及草稿模式边界。只终止本次 API 子进程（PID 27528），已确认退出；隔离数据目录清除。fake 只验证确定性接口契约，不作为真实模型质量证据。
- 实际 UI 浏览器操作：**NOT_RUN**，留给主 Agent 独立验收。延迟回包/跨模式、原子 rename 故障注入及正式知识资产零变化也由主 Agent继续独立验证。
- 已检查产品 Provider 配置，只记录布尔值：`configured:false`，base URL/model/key 三项均未配置，来源 `none`；没有读取或输出凭证值。因此真实 AI 成功、Brief/Prompt 质量及真实模型错误分类验收均 **BLOCKED**。平台未提供子 Agent token 计量，记不可得。

## 历史文件与指纹

运行 `npm test` 前将会被测试覆盖的两份 B04 输出备份到 `B08-builder-originals/`；测试生成输出另存为 `B08-builder-generated-*`，随后已恢复历史原件并逐项比对 SHA-256：

- `B04-http-evidence.json`: `2B28D35E2B73A5A7AED00CD048DE5032D2FC1C74758A372FEA617EB380B89BCD`
- `B04-repair3-merge-payload.json`: `F3A425DD5E9CB8A72CE28F4A257A938199E495950D1E4C1FD607A023CCFE36AF`

产品源码、施工自测与报告的最终 SHA-256 清单见 [B08-builder-sha256.json](B08-builder-sha256.json)。构建产物 `dist/` 也在清单中。测试数据、Prompt 与 API 均使用隔离临时目录；施工没有改正式 `workspace/`、密钥、验收目录或 B07 七项产品修复。
