# OPENAI-CONNECT 施工交接（2026-10-29）

施工完成，停写交 Astra 独立复审。基线 HEAD：`5f135a62689cc70e5529409c7c83fc1c3db51814`，交付为下列工作区文件差异，未提交、未推送。沿已批准任务卡及 agent-router B 模式；施工不作最终验收裁决。

## 实际变更

- `services/llm/provider.ts`：仅精确官方 hostname `api.openai.com` 且精确模型 ID `gpt-6.1-terra` 不传 temperature；knowledge、prompt、未传 purpose 均覆盖，保留默认推理。不新增 reasoning 参数或能力框架。其他端点/模型及既有 GLM 逻辑保留。
- `scripts/start_with_proxy.ps1`、`package.json`：新增 `npm run dev:proxy`；先通过 `node --help` 检查实际原生代理能力，再读取代理。优先现有 HTTP_PROXY/HTTPS_PROXY，两者都无值才读取已启用 Windows 手动代理，支持单地址和 http/https 分项。通过 NODE_OPTIONS 的 `--use-env-proxy` 传给子进程。无参启动原 dev，有参全部转给 Node；缺代理或旧能力明确报错。无本机地址/端口硬编码，无系统配置写入，不改变普通入口/engines/依赖。
- 两份定向测试及 README 使用说明；未修改 schema、提示、业务数据、配置文件或历史质量判定。

## 本轮实际验证

环境 Windows / Node v24.18.0。全为虚构配置、fetch 拦截、离线子进程；注册表通过 PowerShell 函数模拟，未读真实系统代理、真实配置或密钥，未真实调用 Provider。

| 命令 | 实际结果 |
|---|---|
| `node --import tsx --test tests/provider-knowledge-reasoning.test.ts tests/proxy-startup.test.ts` | exit 0；7/7，通过；Node 测试耗时 4811.0912 ms，工具墙钟 5.495 秒 |
| `npm run build` | exit 0；tsc -b 和 Vite 构建完成，214 modules。Vite 4.03 秒；总耗时未采集，首次等待 10.004 秒时仍运行，随后轮询取得完成结果 |
| `git -c safe.directory='E:/AI/Work/AIPM Workspace' diff --check` | exit 0；仅 Git 换行提示 |

Provider 拦截覆盖：Terra 官方域名三 purpose 无 temperature/reasoning；大小写域名规范化；其他 host/model、伪后缀/子域、模型大小写及 preview 保留 temperature=0；GLM 原参数、超时及取消测试保留。

代理测试实际用本机 Node 启动 `--import tsx` 和带空格路径的临时 TypeScript 探针，校验参数、NODE_OPTIONS、NO_PROXY、环境优先、单一系统代理及分项代理。无代理及模拟旧 Node 能力均拒绝启动。测试不发送网络请求；旧 Node 为 help 输出模拟，非安装旧 Node 实测。临时测试目录由测试清理。

构建有 >500 kB 的既有 bundle 提示，未扩范围调整打包。

## 主线程一次真实验证入口

主线程准备只读本机已存配置、实例化修改后 `OpenAiCompatibleProvider`、仅调用一次 `complete` 的固定非业务探针，日志仅保留 Node 版本、退出码、finishReason/bytes/usage 等安全摘要。临时探针代码不需进入产品；不使用裸 fetch、不输出配置或凭证，不自动重试。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_with_proxy.ps1 --import tsx <临时探针绝对路径>
```

无须手工指定代理地址。主线程通过当前已启用系统代理或已有环境变量执行；施工尚未执行此步骤。C03 真连接结果待主线程记录，C01/C02/C04 自查证据待 Astra 独立裁决。无参的 `npm run dev:proxy` 未启动实际工作台服务；本轮实际启动证据来自同一脚本的离线 Node 参数分支。

## 受测文件 SHA-256

| 文件 | SHA-256 |
|---|---|
| services/llm/provider.ts | F790FC3CF05611C021CF4EA8AAB89BC1E8BD021406D9CF8B847DFA99B8D61FEA |
| tests/provider-knowledge-reasoning.test.ts | 5933D206C9D4A705EDBF0D6193DD09518C5725A2F96DC05062151A9063E8D6B6 |
| tests/proxy-startup.test.ts | B048FA7D02492398E31DEFD7C56DFAB728A158CA9742951806292D13CB454DB1 |
| package.json | AFCE004A53A2EFF98B1C5C8D8DAA93326877D41F0D98FE2DE7E6B30A5B35D79B |
| scripts/start_with_proxy.ps1 | 78EE86D777A0EA70210BF8FA701565D3580AD08FF8F6B2774862C85BD192F3DF |
| README.md | DA9BC4E88E265B835821EE61AA3FB2F33753A5EAE82093660A42CD97B43F22ED |

排除已有 `AGENTS.md`、AGENT-ROUTER 外部报告。状态、总控、真实连接记录、统一提交归主线程。

本轮真实/config 读取为 0，知识 254/500、Prompt 15/24 不变。真实接入尚待验证；R16/R18、B09 整体未通过、O 失败/Q 未执行保持。未推进下一批。
