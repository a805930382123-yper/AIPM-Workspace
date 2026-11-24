# LLM-Wiki 1A-1 独立验收

阶段 1A-1 **PASS**。最低版本原生驱动缺少 FTS5 的阻塞已由锁定的备选驱动解决。Batch 1A 整体**待验收**。索引与分块、检索接入、端到端千页基准、25 问 A–E 分项及 B 类漏题、回滚仍待后续阶段实施和实测。

## 双版本独立复跑

Windows x64。两个版本各执行一次 `node --import tsx scripts/smoke-sqlite.ts`。Node 22 使用临时目录内的同版源码和驱动副本，解开上游 ABI 127 预编译包，共享 tsx 等纯工具依赖。Node 24 使用工作区 ABI 137 安装。两次均通过脚本末尾耗时断言。两者 SQLite 均为 3.53.2。

| Node | 单事务写入 ms | 20 次查询平均 ms | P95 ms |
| --- | ---: | ---: | ---: |
| 22.13.0 | 1403.62 | 6.33 | 7.55 |
| 24.18.0 | 1061.51 | 3.02 | 4.46 |

逐项核对脚本及输出。BEGIN 前开始、COMMIT 后停止计时，实写 1,000 页、6,000 块、6,000 条 FTS。WAL、NORMAL（1）、外键（1）均读回，孤立外键插入触发拒绝。20 个随机不同主题分别联表取回 30 条，独立加权样例断言标题得分优于正文且两者均为负数。写入门槛 <1,500 ms、平均检索 <50 ms。最低版本写入余量约 96 ms，此项为本机单次合成库实测。

Node 22.13.0 通过 `node -e "new (require('node:sqlite').DatabaseSync)(':memory:').exec('create virtual table f using fts5(t)')"` 复现原生错误 `no such module: fts5`，同一连接查询原生 SQLite 为 3.47.2，ENABLE_FTS5 为 0。检查 package.json 与锁文件根声明及安装条目，两处均精确固定 better-sqlite3 12.11.1 和 @types/better-sqlite3 9.6.0。冒烟脚本经 sqlite-store 打开连接。最低版本执行 `node node_modules/typescript/bin/tsc --noEmit` 退出 0，配置启用 strict 并包含新脚本。

## 真实资料及调用边界

只读枚举正式 Wiki，排除 index.md 得到 95 页。用 Node fs 读取、剥除 YAML 和生成的标题，按施工记录的 UTF-16 长度复查五个样本。15,297、3,628、545、4,111、1,903 字符样本分别检出 20、4、5、40、10 个一至三级标题，其中三个样本含推断。覆盖长页与三级标题，样本文字未进入仓库。

执行 `rg -l 'retrieveKnowledgeContext\(' services` 和 `rg -l 'writePageLocked|commitChange\(' services/wiki`，核对问答、提取、巡检、维护与 PDF 草稿路径及 Wiki 普通写入和草稿确认路径。逐字校验位于 knowledge-answers.ts 的 body.slice；Prompt 独立服务定义 12,000 字符总预算。本阶段未接入运行时检索。针对性回归 47/47 的两版本结果来自施工报告，此处独立复跑覆盖驱动与类型检查。

## 版本与文件身份

验收时 HEAD 为 `9afd0030362aa9c3e5d7153f31333935bb91603c`。交付代码当时在工作树中，以下为 `Get-FileHash` 实测 SHA-256。

| 文件 | SHA-256 |
| --- | --- |
| package.json | 5454F742A1847120287B745E4ADF735BB9BE36B74C46AEB9E92F6CAFC52E71AB |
| package-lock.json | 988470D4D78191EFAEF939608ECA66F33F3AFD904B578D690025F2B733EA227F |
| tsconfig.json | 8CC8472A7521E35158026DF2E0C1B06F03BD8CC74C5436E2978A80C3F0110DAB |
| scripts/smoke-sqlite.ts | 096445D3E0D618C330996C7846760097695499445C74E6F62252DC137206BA71 |
| services/search/sqlite-store.ts | 1D9C250E247E61A340F3C29F78EF2F246F224D6761374CCF23278490A3600832 |
