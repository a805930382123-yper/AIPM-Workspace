# R16/R18 HUMAN：隔离P副本准备交接

2026-10-28，Sol High `r1618_retest_build`；基线 `c55b30a9ab5652d2356c1fb5fbfc861ee384b534`。按主Agent转交的已确认HUMAN准备方案，仅复制本机隔离数据和写本报告。未改产品、测试或lab代码；准备完成停写，实际服务启动和Chrome操作交主Agent，独立验收交Astra。

## 隔离副本与启动入口

原P：`E:\AI\Work\AIPM Workspace\.scratch-R1618-COVER-20261028-Gjkejk`。

新root：`C:\Users\DAVID~1.CHE\AppData\Local\Temp\r1618-fields-lab-y5oDIZ`。这是`os.tmpdir()`下`mkdtemp('r1618-fields-lab-')`新目录，符合既有lab的TEMP父目录/前缀限制。复制knowledge、drafts、prompts、state四个数据目录；未复制真实会话release或模型请求/响应归档，不读取private或实际配置。

保持原ID：raw `0fb6e144-3db7-43f0-a06a-16cb57b1c288`；draft `b27f1cfd-be27-4365-8962-5164f8241bd4`；唯一Process page `32d1e8ad-8286-43dd-93e8-04c8ee0ee87e`。未预先清除痛点、补outputs或执行任何人工编辑。

已写`root/r1618-lab.json`：kind=`r1618-fields-lab-v1`、精确root、baseline、draftId/rawId、originalRawSha256，以及从原draft派生的originalPages（pageId/source_facts/source_evidence）。附本轮realCalls/configReads0仅表示本轮准备，不改写原P真实请求的历史账本。

主Agent从项目根执行以下精确命令（本实例未执行）：

```powershell
node --import tsx tests/acceptance/R1618-FIELDS-20261026-lab.mjs --root "C:\Users\DAVID~1.CHE\AppData\Local\Temp\r1618-fields-lab-y5oDIZ"
```

按既有lab配置，预期入口为`http://127.0.0.1:5176/r1618-fields?draftId=b27f1cfd-be27-4365-8962-5164f8241bd4`，导出为`http://127.0.0.1:5176/lab/export`；启动成功及实际监听地址以启动stdout/active-lab.json为准。本轮未测端口或启动，不声明服务可用。

已只读核源码：既有lab支持`--root`加载上述kind/root元信息；provider固定`() => undefined`，Vite `envDir: root`、缓存也在隔离root，不导入server/index或加载真实配置。无需修改入口；应使用该lab而不是产品启动命令。元信息不会自动改变真实原稿的栏目判断。

## 实际命令与证据

实际执行一次`require_escalated`的`node --input-type=module`内联准备脚本，使用Node内置fs/os/path/crypto：读原session/result定位ID，mkdtemp，fs.cp四个数据目录，读源/副本Raw与Draft比较Buffer，wx写r1618-lab.json，再读源文件确认未变。exit0，0.920秒；没有启动任何服务或Provider，没有运行smoke/测试矩阵。

Raw路径为`knowledge/raw/notes/<rawId>.md`，Draft路径为`drafts/<draftId>.json`。源与副本的Raw/Draft字节比较均true；写元信息后再次读取原目录，两项仍与复制前相同。

| 对象 | SHA256 |
|---|---|
| 原/副本Raw文件 | `6be6c24bc5c61d1f45c45a0462a0726f4ce1f4938544eb9bfd01b0f5ad97944f` |
| 原/副本Draft文件 | `ece20626438f53e47d49d3a22f2991c4209211b761f1a3a1e618dccc327d93f4` |
| r1618-lab.json元信息 | `30eeeb61362c6f571a7dfa0cff6dcfd1eb0555c3dc80915ce5cb5dd635c53cf7` |

另只读Get-Content status、原session及既有lab；rg定位元信息要求；git rev-parse HEAD及git status --short。首次Windows通配搜索路径无效及一个猜测测试文件不存在，随后直接读取既有lab与auto-fields用例定义，不是测试失败。

## 交接边界

本轮仅准备完成；实际UI栏目校正、逐页确认、编辑失审、重审、正式保存与刷新回读均未执行。原P scratch与公开真实归档未改；后续仅操作TEMP副本并单独保留证据，不能追认自动原稿质量通过。

本轮真实调用/实际配置读取0，累计知识252/500、Prompt15/24保持。旧真实FAIL及outputs/question-only覆盖缺证、R16/R18/B09整体未通过保持；未因生成副本签人审闭环通过。共享工作区外部AGENTS及AGENT-ROUTER报告排除，本实例未提交Git；报告完成后停写，主Agent统一后续操作与提交。
