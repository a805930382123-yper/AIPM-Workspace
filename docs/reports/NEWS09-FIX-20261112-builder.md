# NEWS09-FIX 施工交接

施工 news07_build / Terra High，基线 HEAD `d677b6d5740be198997f363ffb3dbd59306e4c5c`。PwC完整真实动态链成功后改默认启用；PwC官方月精度在详情预算前按上海月初365日窗口过滤，保留原月值。12秒、10MiB、重定向规则不变，无重试。CCFA维持不接入；复用Sol诊断站方证书过期结论，本轮未请求CCFA。零模型、未写正式workspace或今日缓存。

`node --import tsx tests/acceptance/news09-fix-live.mts`：本次唯一真实动态链（NBS以隔离503 stub，不作实采），目录、详情、PDF各1次，均HTTP 200；PDF头238ms、完整8228ms、2,400,087字节，SHA256 `60d413237288aab359f00a93453fdb1750b3e1a2847df09a9c2dd03b3c8f91a0`。实际提取395字符，物理第6页，公开月份2025-12；完整原文和即时账本在 ignored `node_modules/.cache/news09-fix-live-OxChUt/`，不提交正文。账本逐请求start/headers/complete，clone异常单独捕获；无额外真实请求。

切默认后 `node --import tsx tests/acceptance/news09-fix-replay.mts`：以同次真实响应离线经生产readNewsSources和NewsService重放，取得同正文、原月及第6页；同日ensure新增来源请求0；临时隔离Raw逐字及月份一致，模型0。隔离数据 `C:/Users/DAVID~1.CHE/AppData/Local/Temp/news09-fix-hYBcFd`。不将回放视为第二次真实抓取。

- `node --import tsx --test tests/acceptance/news09-fix-bounds.test.ts`：执行时2/2 PASS，验证PDF超过10MiB、错误类型、跨域跳转拒绝、失败不重试及真实读取链超12秒失败（12023ms）；成功链由上述真实完整PDF证明。
- `node --import tsx --test --test-name-pattern='月精度' tests/acceptance/news09-fix-bounds.test.ts`：1/1 PASS，旧月候选不占详情预算。
- `node --import tsx --test --test-name-pattern='HTML读取' tests/acceptance/news09-fix-bounds.test.ts`：1/1 PASS，HTML 12秒取消（12030ms）。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/news01.test.ts tests/news02.test.ts tests/news03-repair.test.ts tests/news01-ui.test.tsx tests/news02-ui.test.tsx tests/news07-builder.test.ts tests/news08-builder.test.ts tests/news08-ui.test.tsx tests/news09-builder.test.ts`：43/43 PASS。
- `npx tsc -p .news09fix-tsconfig.json --pretty false`：产品范围退出0（include app/server/vite.config.ts，exclude tests；临时配置已删除）。隔离空envDir Vite build退出0、233模块，既有大chunk提示。

独立验收和真实浏览器未在施工中执行；CCFA站方修复前仍不可用，NEWS09整体待独立裁决。交接后停写，不提交。

SHA256：
- additional-research.ts `1A1EF81A03E8A43D518CF374646ABFDD0F833D6C663789A02A75206A026AC61A`
- news09-fix-live.mts `4530E899E2C2B128497F4DF481C18FB2DA48EFE69AD8DAF25E634DBD2B4377F0`
- news09-fix-replay.mts `D9739279F5A3FB06E76222EBD5D2C7AAC3252806D53DB58900F48E2636AAF47F`
- news09-fix-bounds.test.ts `D810F42A19E08587EF21295A2B8265D37C924C00342C58A2F5A48B7508857FB0`
