# RUN01 核心施工自查

基线 `b1695fb366e0957cb3fb38a9d6c6f0fb3c774bf7`，施工实例 `/root/run01_core`，GPT-6.1 Sol High，B 模式。后端与核心测试已停写，RUN01 整体验收交 Astra；提交、推送和真实 CI 归主线程。

## 交付和实测

| 范围 | 实测 |
|---|---|
| R1 / R6 HTTP | 真实开发模式 API 在临时数据根和系统分配的端口验证健康、状态、计划 revision 并发冲突、暂停、恢复、运行和详情。伪造 Host、外部 Origin、`Origin: null`、跨站标志、错误 Content-Type 和令牌均拒绝，既有 LLM 配置仍有独立令牌。同源、开发来源和显式配置来源按既有规则通过。隐藏父路径下的真实生产服务返回相同的根页和 SPA 深链接 HTML，未知 API 返回 JSON 404；使用正式构建产物和 Vite watch 的整链由独验实测。 |
| R3 单实例 | 实际独立子进程覆盖活锁拒绝并提示占用端口和模式、异根并存、强制结束后保留元数据、两个竞争进程同时接管时只有一个进程持锁、正常关闭清理及损坏锁保留。Windows 命名管道防止两个进程同时读取同一把旧锁后误删新锁。先获得规范数据根的排他管道，再以 `wx` 写记录。关闭 HTTP 和调度后在进程退出时释放，给已接受的后台写入保留锁。 |
| R4 调度与账本 | 假时钟覆盖上海午夜、间隔锚点与计划 revision、停机只补最近一次、禁止补跑、进行中重叠、暂停跳过、恢复前消费暂停时刻、协作取消、重复取消和中断。使用先记运行再推进游标的次序，另测推进前的中断不重复创建。损坏记录仍能从列表看到，单条详情报错并保留原字节。保留测试有 2002 条记录，校验最近 90 天与最新 2000 条的并集及活动记录例外。 |
| R4 备份 | 现行 v1 backup/restore 实际导出并恢复计划和运行账本，结果逐字节相同。恢复到新根后识别复制的锁，源数据根的活锁仍归原持有者。 |
| R5 计量与写边界 | fake Provider 6 次并发/隔离尝试，其中首任务完整、部分、无 usage 和抛错共 4 次，账本记录输入 12、输出 9、未知计量 3，第二任务单独记录 1 次，余 1 次普通调用不计入。隔离 Wiki/Prompt 持久化入口对自动化上下文返回 403，外部人工写入依然可用。 |
| R8 自检 | 真实开发服务执行 `system.selfcheck` 五个步骤全成功，Provider 未配置如实报告，账本请求及所有 usage 字段为 0，产物引用为空。 |

间隔计划输入接受 1 至 525600 分钟的整数。运行列表默认 50 条、请求上限 200 条。任务终止响应在协作取消和账本终态保存后返回。

## 返修

Astra 在隐藏父路径的仓库镜像中实测生产深链接返回 500。Express 的绝对路径 `sendFile` 会检查父目录名。固定入口文件相对静态根发送后，隐藏父目录下的生产根页、深链接与 API 404 均有回归测试。

主线程首次运行全仓 Node 22 检查时，核心文件的 8 个断言全部通过，文件级测试进程通信随后报反序列化错误。将相同锁诊断和测试运行器序列化消息合并至一个 stdout 写块，独立夹具复现同一 `FileTest.#processRawBuffer` 错误。陈旧或复制锁的诊断现走 stderr 通道。API 子进程的环境清除继承的 `NODE_TEST_CONTEXT`。复现日志保存在 `.scratch-run01-evidence/core-builder-node22-stream-repro.log`。

## 命令和结果

| 命令 | 结果 |
|---|---|
| `node --import tsx --import ./tests/support/css-stub.mjs --test tests/run01-core.test.ts tests/run01-api.test.ts` | Windows Node 22.23.5、24.22.1 各 11/11，0 失败、0 跳过。 |
| `node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false` | Windows Node 22.23.5，退出码 0，0 诊断。 |
| `git diff --check -- server/index.ts services/wiki/store.ts services/prompt/store.ts package.json docs/architecture.md` | 退出码 0。 |

原始 stdout、类型检查和 SHA-256 位于本机忽略目录 `.scratch-run01-evidence/core-builder-node22.log`、`core-builder-node24.log`、`core-builder-tsc.log`、`core-builder-sha256.txt`。测试使用隔离的临时目录、空 Provider 配置和自有进程。本轮真实 Provider 调用 0、正式工作区读写 0。生产真机自启、UI 操作、全仓检查及真实 CI 属于后续独验和主线程验证。

入口 `server/index.ts` 的施工 SHA-256 为 `596ed67e58e8e22f66cb51ac6564ff24779cedcb04c3d45e562da58552b20e9c`，调度器 `services/automation/scheduler.ts` 为 `44e0f0ab144e15ed740b2107a4446ec12954560d4e277f514f8fedee5881fd1b`。

补跑等待专项返修：仅测试改为先等待既有运行完成Promise，再真实读盘验证成功、精确时刻与唯一补跑；不新增产品API。Node22/24核心各8/8，tsc0；测试SHA为a67d9ff44443d1578dd4c6bffb510af20692b335cf8acf158cc33f351c354f0a，原始失败末态已随隔离目录清理，不能追溯具体延迟/写盘原因。最终主线程默认check已897/897、0跳过、类型和235模块构建通过，真实CI待验证。
