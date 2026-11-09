# WORKREPLY 独立验收（2026-11-09）

本轮施工范围与WORKREPLY整体PASS，无待返修缺陷。施工customer_reply与独验delete_review独立，验收未改产品。受验基线0de6935b9c0c77d6aef943992b3a1e30b1c6eaba加下列工作区指纹。

## 实测

1. `node --import tsx --import ./tests/support/css-stub.mjs node_modules/.cache/workreply-review/ui.mjs`：独立JSDOM真实组件退出0；选择回复客户、保存customer_reply、请求仅本机API；当前情况未保存下一步保持。标记已解决只改选择并聚焦解决说明，不发送请求；填说明后明确保存带closed和未保存字段；重开提交reopen；客户/旧客户closed显示已解决，产品closed仍已完成。
2. `node --import tsx --import ./tests/support/css-stub.mjs --test tests/customer-reply.test.ts tests/work01-http.test.ts`：独立运行3/3 PASS；新历史持久化、缺解决说明拒绝、实际导出恢复一致、产品拒收customer_reply、旧HTTP流程回归。
3. PowerShell here-string管道`node --import tsx --input-type=module`：独立实际WorkItemStore验证有到期日期事项起初在due列表，追加customer_reply并解决后退出due，重开再次出现；旧technical_reply历史完整保留，退出0。

## 静态核对与边界

history类型、输入和存储验证同步接受customer_reply；产品仍仅允许stage_result。closed状态和旧历史格式不变；旧closed条目保留“关闭事项”历史标签。快捷已解决用函数式局部更新，仅更改status，不清空其他编辑字段；解决需原表单required说明及服务端校验。仅本机记录，不存在外发接口。customer_reply作为最近进展会抑制旧技术回复建议。

仅隔离合成数据，本轮真实模型调用0，未用正式资料。UI为JSDOM，不代表真实浏览器或宽窄视口实测，真实浏览器NOT_RUN。未改变用户服务。

## SHA256
app/pages/WorkItemsPage.tsx: C0EF5D91F395563443734FBF2571BBC4D868F6692B617ABA2AC3560B919710AF
services/work-items/store.ts: 97713A60C134211CAD8C6444E10CFCB6847F58DED3C78ED3F77ACEC969F2B1D9
services/work-items/types.ts: DA1DE82F1988625E330AEB81F458A08E4B53D177D8C9FAAF4761F232D89605C3
