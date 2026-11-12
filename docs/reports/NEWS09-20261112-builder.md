# NEWS09 施工交接（未完成／PwC门禁阻塞）

基线 `febf47eaf2fbff274aa5530e642a903b79a4ffb0`，news07_build / Terra High。新增统计局适配器，目录最多4页、详情4、合格2；快消最终选择和近期补位每源最多2，新增PDF URL去重，旧今日记录不改；页面材料类型和月精度提示。PwC适配器保留但**默认关闭**，未上线；月精度方案经Sol预审。CCFA未接入。未使用真实模型或正式workspace；不提交。默认关闭PwC是本轮真实门禁受阻后的缩减，需规划及独验裁决，NEWS09首批不可标PASS。

实际命令与结果：
- `node --import tsx --test tests/news09-builder.test.ts`：2/2 PASS，统计量化正文/另一源失败及合并多源单源上限和共享PDF去重。未覆盖完整N9-02矩阵、PDF 21页后、图片PDF、所有预算与Raw月精度；不能以该测试证明PwC可用。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02.test.ts tests/news03-repair.test.ts tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news07-builder.test.ts tests/news08-builder.test.ts tests/news08-ui.test.tsx tests/news09-builder.test.ts`：42/42 PASS（最后一次新增第2个NEWS09测试之前）；旧三个单源fixture按新约束改多源，保留原断言目的。
- `npx tsc -p .news09-full-tsconfig.json --pretty false`：产品范围退出0（extends项目配置、include app/server/vite.config.ts，exclude tests，临时文件已删除）；新闻定向tsc亦退出0。
- Vite `build({configFile:false,envDir:<空临时目录>,plugins:[react()],build:{outDir:<临时目录>,emptyOutDir:false}})` 退出0、233模块，既有大chunk警告。

真实请求：首轮 `node --import tsx tests/news09-live.mts`：NBS目录及3分页、2详情均200，取得2026-10-19及2026-09-15两篇量化材料；PwC目录200，普通anchor未发现候选，公开内容位于collection-v3 JSON。首轮请求URL/状态/耗时/大小/hash及完整实采结果在 ignored `node_modules/.cache/news09-live/result.json` 与响应快照。第二轮发现PwC详情并保留 `node_modules/.cache/news09-live-2/1.bin`–`8.bin`；记录脚本未即时捕获clone读取失败，Node因 `DOMException [TimeoutError]: The operation was aborted due to timeout` 提前退出，未保存请求账本，无法断言该轮各请求最终状态，不能将此轮算完整采集。主线程额外授权单次PwC PDF GET，目录和详情使用第二轮本地快照回放：HTTP 200头后12015ms正文超时，无PDF；日志 `node_modules/.cache/news09-live-2/pdf-extra-log.json`，不构成同轮真实链路成功。不再重试。PwC PDF实测门禁BLOCKED。

CCFA仅两次真实请求：`https://www.ccfa.org.cn/portal/cn/index.jsp` 与 `https://www.ccfa.org.cn/portal/cn/xiehui_list.jsp?pn=2&type=2` 均Node fetch失败，cause `certificate has expired`，耗时237ms和151ms；未绕过TLS。独立真实浏览器、正式Raw、重启兼容及完整边界未测。独验需自行裁决现有统计结果及缩减；不得视为整体通过。

文件SHA256：
- additional-research.ts `21BBCFB571AD16BE6EF61C5344B7F22F5F219CA4477FBC86DE42BC1D907C6F09`
- research-sources.ts `36F85C7F43C5D644B486BAEBE3C6C0FA531B677FFCE77711DB7DC097F40B9B26`
- service.ts `CC3F0FAB789DF57ACA27685BF348E65E51BCB3A64E4DAE83BD41B817EA4051E0`
- NewsPage.tsx `9E67FF390AEC0F0F3803B56994AD25B174C13E57482A2D1F80D52752EF8DCFBD`
- news01.test.ts `8AC17B5D5F0BBBA1BBF708CBE3EC1E0555C71D89E851E56B6039D1698FBA1F42`
- news07-builder.test.ts `501FAA6C9229489851228A07C6F3D850C154A21E4C96CF9B05BB738652FD152A`
- news08-builder.test.ts `C01FF7BC03D97ED5D83A28D1294F6FE1C0B52396A20F2AD3742772F14D43CD9D`
- news09-builder.test.ts `53FA876740FC69ABA7FA57EA877F3E277A5BD32CDECD159B7085C58D6F384D11`
- news09-live.mts `D402C323A44BF0A399FFAFBBA456F1B1CE9655441CCA532E494AE5BF0F520FA6`
- news09-pdf-replay.mts `DDCF599FDDB637E57F1DA4210619201D437EBA36E18C3019CA6F4547CA6A6B67`

## N9-02 统计候选返修

排除解读/专家等非正式标题；提取 `.trs_editor_view` 正文段时排除table后代，仅含无口径表格不能入选；至少有量化品类或渠道段才入选，并保留可核社零总体段。无外部请求、模型或正式数据操作。

- `node --import tsx --test tests/acceptance/news09-review-adapters.mjs`：4/4 PASS，含混排固定反例、PwC第22页及NIQ第20页上限；运行独验fixture的施工自查，待独验复验。
- `node --import tsx tests/acceptance/news09-review-live-replay.mjs`：退出0，本地快照回放8请求、外部0，NBS两条正文保留；PwC正文仍未验证。
- `node --import tsx --test tests/news09-builder.test.ts`：2/2 PASS。

返修基线HEAD `febf47eaf2fbff274aa5530e642a903b79a4ffb0`；additional-research.ts SHA256 `AE4775F9DB9E4C5D44B4531DA13A313A81E1CB2AAE25408316F683A1C29C345F`，覆盖上节同名值。CCFA TLS结果仅当时终端输出及本报告记录，没有独立日志文件；未重发。返修交接后停写，局部与整批结论待独验；PwC真实门禁依然BLOCKED。
