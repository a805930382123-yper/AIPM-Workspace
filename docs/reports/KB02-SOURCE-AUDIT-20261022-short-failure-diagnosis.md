# 短文真实失败最小诊断入口

发现：F-KB02-SOURCE-01/P1，真实短文无法完成提取。seq144在正常HTTP200响应中将纯换行 `c1-a0005`（text仅`\n`、fragment=false）加入sourceNotes。服务返回LLM_SCHEMA_INVALID“不能将空白分隔符选择为陈述”，job失败，checkpoint completedChunks=0、无plan、无draft；未创建Wiki。原Raw保持不变。此为真实生成质量失败，严格拒绝本身正常；不是本轮同源区域错归再次复现。

最小证据：`short-failure.json`包含完整134字符Raw、job、checkpoint、空白atom及原响应；`provider-trace.jsonl` seq144包含完整目录、Prompt和响应。Raw ID `35f6823e-07c4-43d5-b2ad-f0ff98d71a08`；输入SHA256 `d3c1512e32c2dc0654addce9e0381b5bb6fad16f693cb780d229877022734515`。`real-http-SHORT.json`保留首次FAIL，不以重跑覆盖。

响应业务选择本身包含在售/铺货率/门店数非销量/未知负责人/AI未来建议，唯一被观察到的拒绝触发是空白atom被选作sourceNotes。提取输入目录仍把纯换行展示为可见atom，提示词解释sourceNotes范围，但未显式示例“纯空白不可选”；这只是可离线验证的候选原因，尚未唯一归因，未改产品或Prompt。

建议下一轮先离线复现seq144并检查空白atom目录与选择校验职责：确认所有栏位纯空白均应拒绝、非空标题与含业务内容边界继续保留；评估最窄的请求目录/指导改动，不能靠事后静默删除已选内容或放宽schema伪造成功。由主Agent另行裁定范围后施工，再进行受控与原短文真实复验。不得因剩余4次就自动重试相同短文碰运气。

原seq121诊断与全文14区域已经真实通过，本失败不能抹去这些证据，也不能由它们掩盖短文回归。补充仅独立生成草稿通过；目标短文Wiki不存在，候选/更新预览/双侧语义/明确确认/刷新回读全链NOT_RUN。新失败令KB02整体未通过，不启动新返修或下一批。
