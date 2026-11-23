# RAWOCR02 独立验收

2026-11-23。按[冻结任务卡](../handoffs/RAWOCR02-task.md)核验暂存施工版本，基线提交 `f2962bb41e5c16b3aecde8c751f3f2c155662e3f`。独立按路径排序并计算 28 个产品与测试文件的聚合 SHA-256，得到 `3b467003666a362fb50240da291d45fefe8aa0f89ce41d22c159ca779f2dcc39`，与交接版本一致。

- **本轮施工缺陷结论：FAIL。** 实际 Raw 人工正文编辑之后，图片标记变化可以造成旧 OCR 发送至 Provider，以及已失去正文位置的旧图片进入新草稿。
- **RAWOCR02 批次整体：FAIL。** 正常关联时的解析、续跑、检索、确认及来源链接通过。冻结卡第 2、4、5 项在下述现有编辑入口上未全部满足。第 3 轮尚未开始。

## 两个可重现的阻塞

1. **旧 OCR 进入另一图片的请求。** 用 HTTP 验收夹具的 `seed` 建立含两图的历史文章，状态依次为 failed、needs_vlm，第一图后方带完整的旧转录段和哨兵 `DIRTY_LEGACY`。通过 `PATCH /api/raw/:id/body` 将第一图标记从“【来源图片 1】”改为“【来源图片 1（原图已撤下）】”，正文其余字符不变，PATCH 返回 200。随后通过单图接口精读第二图，模拟上游实际收到的两次请求均在 `context_before` 中出现哨兵（首次被模拟端拒绝后重试）。`media-context.ts` 第 48、57 行先精确匹配旧标记，再决定哪些转录段属于图片；改标记后，完整转录段失去隔离。
2. **删除正文图标记后，草稿继续引用旧图。** 以一张 ocr_ready 图建立文档，使用同一 PATCH 入口将正文替换为“本日门店图前记录，仅保留新的文字。”。GET 确认新正文不含图片标记。正常 `POST /api/raw/:id/extract` 至 completed，捕获到 3 个 Provider 请求包含仅存在于原图片解析的词，草稿 `source_evidence` 仍指向已移除标记的图片 ID。`media-context.ts` 第 86 行在未识别到正文锚点时以正文末尾作为插入位置。

复验应保持用户当前 Raw 字节不变，核对实际发出的上游请求与落盘草稿。第一例的旧转录不得流入上下文。第二例中无法关联到当前正文的图片不应作为当前位置明确的来源注入草稿或检索。同时保留仅调整前言、图标记仍可唯一定位的正常案例及正文中作为示例的代码块。

## 独立实测

| 实际命令或操作 | 结果 |
| --- | --- |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr02.test.ts tests/lw01-deep.test.ts tests/rawux01-http.test.ts tests/lw02-main.test.ts` | 14/14 通过。覆盖普通和深度路径、已有确认流程及投影坐标。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/kb02-storage-recovery.test.ts tests/kb02-human-review.test.ts tests/provider-knowledge-reasoning.test.ts` | 43/43 通过。覆盖现有检查点恢复、旧草稿人工审核与既有 Provider 协议。 |
| `node --import tsx --input-type=module -`，以内存形式执行 `tests/acceptance/rawocr02-http.mjs`，为同图同时发单图与五图批量请求 | 实际服务到回环 Provider 共 28 次调用，图片请求最高同时 3 个。同图重合未增加计费请求。服务验证 JPEG 缩放、结构约束与降级、逐图失败、续跑/确认的变更拒绝、图前后原文和图片引用、图片独有词问答及冒用正文 ID 的拒绝。 |
| 在同一真实 HTTP 流程用 React 渲染正式 Wiki 的 `FormalNoteReader`，由 JSDOM 找到实际生成的链接，再 GET 其 href | 返回 200，图片 ID 正确。更改该图片解析后，访问相同 href 和问答引用核验接口均返回 409。此项为组件与真实 HTTP 验证。 |
| 同一 stdin 命令分别注入以上两个 PATCH 及后续产品调用 | 第一项捕获两次含哨兵的实际 VLM 请求，第二项捕获三次含旧图信息的请求并核对最终草稿。测试在系统临时目录和临时端口上运行。真实 Provider 调用为零。 |

## 主 Agent 核验

代码提交 `f0f8339`。运行 `npm.cmd run check` 的类型、格式、ESLint（0 错误，825 个告警）及体积检查通过。首次默认并发全量测试 1,027/1,030，三个 HTTP 用例的本地服务未按时就绪；输出停止后协调者结束了剩余的 llm-http 测试进程。单独重跑 F04-05/06 通过。

在隔离目录执行 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx`，1,030/1,030 通过、零跳过。随后 `npm.cmd run build` 成功，暂存后 `npm.cmd run guard` 零违规。上述两个由独立 HTTP 操作复现的缺陷仍开放。

## 首次返修独立复验

返修基线 `1682a2be3fc7c3747562597686d42055be91e967`。独立复算 9 个产品与测试文件的聚合 SHA-256 为 `315448bdcbd3e6244628c93565bda99e7f30c0d30b80748fdbf0ddd5ac7e2d16`，匹配施工交接。

- **阻塞一（旧转录进入上游）：FAIL，仍开放。** 原样反例已通过；改写或单删第一图标记，保留原旧转录时，第二图精读没有收到哨兵。在同次 PATCH 中删标记并给旧转录加一个句号，第二图的两次上游请求均收到旧转录。
- **阻塞二（孤立图片进入草稿/问答）：PASS，已独立关闭。** 将正文改为纯文字后，正常生成的草稿无旧图引文，自动补全未发图请求。问答实际补读后返回依据不足。批量精读为空、显式单图被拒绝、旧图片解析引用返回 409，原图字节仍可读取。
- **第 2 轮 RAWOCR02 整体：FAIL。** 冻结卡第 2 项仍有上游实测反例。

### 新反例与复验标准

在原 HTTP 夹具中新建带两图的 Raw（failed、needs_vlm）。调用实际 PATCH 后精读第二张图，记录回环上游实际收到的请求体：

```js
const body = fixture.raw.body
  .replace('【来源图片 1】', '')
  .replace('DIRTY_LEGACY', 'DIRTY_LEGACY。');
const edited = await patch(fixture.raw, body);
await api(`/api/raw/${edited.id}/media/${fixture.images[1].mediaId}/parse-vlm`, {});
```

PATCH 成功。两次请求的 `context_before` 均含 `DIRTY_LEGACY`。模拟端发现哨兵后拒绝请求，最终状态 failed。当前识别依赖转录文本完全匹配，或紧邻的当前图片标记，两者都被这次编辑改变。可利用采集版中已确认的转录块及两侧未改的普通正文界定归属，再匹配该区间内唯一的、围栏外具有完整起止标识的转录块。当前 Raw 全文保留人工编辑；构建上下文时隔离已归属的整个块。复验使用改标点与改词两个变体，并用文本相同的围栏代码示例作对照，避免对具体标点或哨兵设例外。

| 实际命令 | 独立实测 |
| --- | --- |
| `node --import tsx --input-type=module -`，以内存形式执行 `tests/acceptance/rawocr02-http.mjs` 并插入上述 PATCH、精读和抓包 | 原 36 个模拟请求对应的流程通过，额外 2 个请求均出现哨兵。合计 38 个回环请求，图片最高并发 3。原流程覆盖移动和改名后的内联图片、重复标记拒绝、孤立图片的草稿与问答补读、检查点续跑和确认。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/rawocr02.test.ts tests/rawocr01.test.ts tests/raw-integrity.test.ts tests/newsraw01.test.ts tests/kb02-planning-context.test.ts tests/rawux01-http.test.ts tests/lw02-main.test.ts` | 43/43 通过，零跳过。含与旧 OCR 相同的围栏示例、行内代码、无图正文、旧检查点及历史草稿。 |

返修复验使用隔离临时目录、本地服务与模拟 Provider。真实 Provider 调用为零。

主 Agent 核验的返修代码提交为 `e845e7f`。隔离环境执行 `npm.cmd run typecheck`、`npm.cmd run format:check`、`npm.cmd run lint`、`npm.cmd run guard`，均退出 0。以 `node --import tsx --import ./tests/support/css-stub.mjs --test --test-concurrency=6 tests/*.test.ts tests/*.test.tsx` 运行全量测试，1,031/1,031 通过，零跳过，随后 `npm.cmd run build` 成功。上面的编辑反例来自独立 HTTP 复验，仍须修复。
