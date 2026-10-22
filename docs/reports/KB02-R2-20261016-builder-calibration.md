# KB02 R2 施工校准记录

2026-10-16 本轮施工保留以下失败/误启动记录；它们不作为产品质量失败被隐藏，最终均已在最终冻结版本复验通过。

1. 定向迁移首跑 `KB02-R2-20261016-builder-targeted-initial`：50 项中 36 项失败，主要为旧 fake/测试仍输出自由事实文本、旧 quote 证据和旧规划 wire。逐轮迁移后 `targeted-native-and-migration4` 为 56/57；唯一残留是新增更新链测试夹具触发 `STATUS_REQUIRES_SOURCE`（`source_supported 必须关联有效 Raw 来源`），原日志已保留。
2. HTTP 首跑 `KB02-R2-20261016-builder-http-initial`：3/4。R04 创建补充 Raw 得到 400 `INVALID_FIELD`，为验收夹具正文入参错误；修正夹具后 `http-fixture-fixed` 与最终 `http-final` 均 4/4。
3. 首次完整默认测试：249 项中 248 项通过、0 skip。`tests/llm.test.ts` 仍断言旧规则版本 `kb02-facts-planning-2`，实际为 `kb02-atoms-planning-3`；只迁移该断言，不改产品。
4. 第一次 `tsc -b` 失败：`tests/kb02-r2.test.ts` 直接写只读 `provider.secrets`（TS2540）。第二次仍失败：向可变 `{secrets:string[]}` 的直接转换不满足类型重叠（TS2352）。最终将 fixture 内 provider 保留为推断的可变类型后通过。
5. 组件最终脚本第一次以普通 `node` 启动，因 `.tsx` 扩展无法加载而失败；这是命令校准，不是产品失败。按 `node --import tsx` 重跑后 5/5。

成功日志复用同一报告文件名时会被后续通过结果覆盖的只有 `tsc.log`（成功时 TypeScript 无输出）；以上命令输出已在本文件记录，产品/测试失败证据仍以未覆盖的 initial/migration 日志为准。
