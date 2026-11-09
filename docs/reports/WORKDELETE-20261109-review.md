# WORKDELETE 独立验收（2026-11-09）

本轮实现范围 PASS，工作事项删除验收范围 PASS。未发现待返修缺陷。施工 work_delete 与验收 delete_review 为不同实例；验收不改产品。受验基线 bc2f3cff8274522800ace744625a6caa37b6191a 加下列产品工作区指纹。

## 实际验证

- `node --import tsx --import ./tests/support/css-stub.mjs node_modules/.cache/workdelete-review/ui.mjs`：独立JSDOM脚本退出0，真实渲染WorkItemsPage，核对确认文字、取消零请求、409失败留在详情、baseRevision传递、成功通知onChanged且返回空列表。HTTP响应为本机stub；没有真实浏览器验证。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/work-delete.test.ts tests/work01-http.test.ts`：独立运行3/3 PASS，退出0。真实Express HTTP覆盖客户/产品/旧无kind事项、版本冲突、主记录删除、get/update拒绝、列表和到期排除、截图独立文件保留，以及旧WORK01回归。忙保护测试直接调用store回调true，未运行真实长时模型并发。
- 独立静态核对：删除队列先读revision再检查analysis/basis active；两处active设置在await读取前；删除只rm事项主JSON。Raw/Wiki/Prompt无删除调用，独立分析/复核和截图文件不清理，界面明确不可撤销及独立文件保留。后续分析/list及复核入口会先get已删除事项而拒绝。

## 边界

运行中阻断及Raw保留同时具有代码证据；本轮未用真实模型或正式资料。没有删除用户已有事项，未启动/停止用户服务。历史测试中的fake不证明真实模型质量。UI宽窄视口与真实浏览器NOT_RUN。本次不提供撤销或回收站，符合已冻结最小方案。

## 产品SHA256
services/work-items/store.ts: DE5DC0D543E701FE02ABA73DE96E0DA66DD018F5C4F1C6A09D015D552F320907
services/work-items/analysis-runs.ts: 4D050C63EC5095EDED7801DB6AABE74D8198B725869C770778C9684A44AE1B08
services/work-items/basis-review.ts: BCD5243392BEA4C5651846B4D1800D0648E3661959E71DEFAF9B9C07817335D6
server/work-items-api.ts: F7F2BA540DCFB02CFFB305E213BC3BEEA21A3387F5F579AA99D529F5DE424F6F
app/pages/WorkItemsPage.tsx: CFEA80A1DCD002753C586AC35AA6EA445387E82E2B6556D013995DABF720AFA0

补充独立实测：PowerShell here-string 管道 node --import tsx --input-type=module，实际RawStore创建含首尾空白合成Raw，关联到产品事项后删除事项，Raw完整对象深比较一致、事项get拒绝。退出0。
