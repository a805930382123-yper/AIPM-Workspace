# COMPAT01 UI 返修交接

Sol High `/root/compat_ui`，main / HEAD `275067c7d120b15051dedc3981b49c64a05c3f9b` 加当前工作树。

Astra 首轮独验 `npm test` 738 项，737 通过、1 失败。失败项为 `tests/kb02-human-ui.test.tsx:60`。当时原文预览为 `''`，预期为完整合成 Raw 正文。审核页先从草稿接口渲染变更卡片，再独立读取 Raw。原测试只等待两张卡片出现，存在正文尚未渲染便断言的竞态。 [首轮独验日志](COMPAT01-20261105-review-evidence/npm-test.txt)

本轮只增加一行条件等待，待 DOM 原文预览非空后，仍分别断言正文与 Raw 完全一致、预览只读。逐项接受、归属、审批、编辑后重新核对以及正式提交断言保持。等待复用原条件轮询，超时仍失败。产品代码和旧报告证据均保持。

- 修改文件 `tests/kb02-human-ui.test.tsx`。返修前 SHA256 `d05c6079dca63af0b8a801de8168f679709f8f48dc8b5fd4dc9417cdaee4908b`，返修后 `8a5280e810eb6dca6cf2fb473b5e611bf854a3a83cc49b84c8c25292af404bbc`。
- `node --import tsx --import ./tests/support/css-stub.mjs --test tests/ui.test.tsx tests/app-navigation.test.tsx tests/kb02-human-ui.test.tsx tests/kb02-storage-ui.test.tsx tests/kb03-review-ui.test.tsx tests/ui-b04.test.tsx`，退出 0，28/28，0 取消、跳过或 todo。清继承 Provider 变量，仍用既有 TEMP fake fixtures。 [返修测试日志](COMPAT01-20261105-ui-evidence/component-tests-repair.txt)
- `git diff --check -- tests/kb02-human-ui.test.tsx`，退出 0。

完整 `npm test` 交 Astra 使用新指纹独立复跑。返修范围仅测试等待，之前的产品浏览器记录仍对应相同产品版本。施工停写。
