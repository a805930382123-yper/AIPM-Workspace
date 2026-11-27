# LLM-Wiki 3-1 独立验收

初验基线 `5dd9969`。本次使用真实产品服务、系统临时目录及本机模拟 Provider；凭据合成，未访问正式工作区或真实服务。

## 首轮实测

独立探针从 HTTP 调用 `POST /api/prompt-ai/brief`，从返回头提取请求标识，查询同一请求的 `GET /api/llm/routing`，并与两个回环服务器实际收到的模型与请求次数对照。成功请求同时生成待审阅草稿。

| 主端条件 | 业务结果 | 物理尝试 |
|---|---|---|
| 超过任务指定的 60 秒、429、500、503 | 各返回 201 | 每次主失败，备成功，共两次 |
| 400、401、403 | 返回 502、401、403 | 各只有主端一次 |
| 主 502、备 503 | 返回 502 | 两端各一次，分别保留失败 |
| 主停用、备单独有效 | 返回 201 | 仅备用模型一次 |
| 备配置无效、备关闭 | 各返回 201 | 各仅主模型一次 |
| 双端关闭 | 返回 503 | 零请求 |
| 客户端在主端收包后中断 | 取消 | 主端一次，备端零次；取消计数 1、失败 0，故障率为空 |

12 例主探针中，主端合计 10 次、失败 8 次，备用端合计 6 次、失败 1 次。重启产品进程后两端累计统计逐字段一致。磁盘账本未发现测试凭据及输入标记。另用独立取消探针验证上表末行。

首轮发现已知总 Token 遗失。模拟端返回 `prompt_tokens=17`、`completion_tokens=2`、`total_tokens=19`，主端汇总得到 34、4、null，备端得到 85、10、null。按实际应为 38、95。已交施工返修。

## 实际命令

- `node "$env:TEMP/batch31-independent-review.mjs"` 和 `node "$env:TEMP/batch31-independent-cancel.mjs"`，独立临时探针从正常 Prompt 业务 API 复验上表。
- `node --import tsx --test --test-name-pattern="routes real HTTP|formal entry carries|absent and malformed|actual Prompt generation path|embedding configuration requires" tests/provider-router.test.ts tests/provider01-entry.test.ts tests/search-embeddings.test.ts`，5/5。覆盖问答重档主备切换、巡检轻档、未配置时普通操作、Prompt 选页、Embedding 凭据及回环传输、端点默认超时和任务覆盖。

首轮结论：核心路由通过；分账需返修，本轮尚未签发 3-1 整体验收。

## 返修独立复验

- `node "$env:TEMP/batch31-independent-repair.mjs"`，退出码 0。11 组正常 Prompt HTTP 重放加 1 组显式设置诊断。模拟端提供 17 个输入、2 个输出、19 个总 Token，主端 2 次成功汇总 34/4/38，备用端 4 次成功汇总 68/8/76；重启后全部一致。诊断请求主端返回 429，只有主端收到请求，并能按这次操作的标识查到一条 purpose=diagnostic、upstreamStatus=429 的失败记录。
- `node --import tsx --test tests/provider-router.test.ts tests/provider01-entry.test.ts`，4/4。覆盖只返回总数的成功响应（31）、内容无效响应（7）、HTTP 错误返回显式 0 的用量。发包前取消的自动化请求计数和真实请求数均为 0。同地址与模型使用两套凭据时，主端限流后备用凭据成功；地址、模型、凭据三者相同只发一次。合计值包含近期 100 条以外的尝试。
- `node --import tsx --test --test-name-pattern="server enables startup and incremental embedding" tests/search-embeddings.test.ts`，1/1。独立 Embedding 服务收到启动索引与后续增量请求。

**本轮返修通过。** 已知用量、显式诊断分账及发送前取消的计数均按真实尝试保留。整体验收待最终同版全仓与冻结评测汇总。

## 最终签发

产品提交 `59261d5`。独立验收者在该版冻结工作树上完成上述返修复验。下列三项采用主 Agent 和施工方回传的同版运行记录。

- 六核限制下 `npm run check` 退出 0，全仓 1,153/1,153，跳过 0。保留 761 条 ESLint 警告及既有构建分块警告。
- 冻结 25 问，一跳开、关各生成 50 行；与 2B 同开关基线逐行比较，除耗时外差异为 0。长页 9/9。FTS 在 A/B/C/D 的命中为 7/7、4/5、5/5、3/3；Legacy 为 3/7、0/5、0/5、2/3。两者 E 类误召回均为 4/5，FTS 延续 B4 漏检。开、关报告 SHA-256 分别为 `543a2c92ab4d009ac0f86034d512ca8d8cf765a00e2ff8a9585dabc43a869b96` 和 `c761012c2676eb51a47871ce56a176dc8df8d1c5e08c11c26def8348278b6f89`，评测退出 0。
- 千页基准退出 0。1,000 页共 6,000 块，重建 3,751.59 ms。FTS 均值 18.22 ms、P95 35.51 ms；Legacy 均值 800.00 ms、P95 1,146.53 ms。评测未调用外部模型。

**3-1 整体验收 PASS。** 正常业务的模型分档、主备切换、物理请求分账、取消、权限、Embedding 隔离和回归门禁满足 3-1 任务卡。本签发范围为 3-1。Batch 3 后续子批及整批终验另行办理。
