# AUTO02 主线程 Git 恢复记录

2026-11-06，施工最终只读差异检查遇到 `unknown index entry format 0x38610000`，主线程在默认及提升权限的只读环境均复现。开工预检无暂存改动，HEAD/main 与实时远端均为 `4a92d63abfc2a4c263f2b2e89ea259203606c09a`；主线程和施工者此前未改索引。

临时索引从 HEAD 重建时继续发现 `pack-e5c184c96a31aff681f677586ed753a300ee030a.pack` 的 inflate 错误。`git verify-pack` 实测该包损坏，其他两个原包检查通过。本次没有判断损坏根因，也没有修改产品或历史工作文件来掩盖问题。

## 恢复操作及边界

- 在忽略目录 `node_modules/.cache/auto02-git-recovery` 从已授权 origin 克隆同 HEAD，`git fsck --no-reflogs` 通过。只对该命令临时取消失效代理，没有更改用户全局网络配置。
- 原索引、损坏包及其索引、多包索引保存于 `node_modules/.cache/auto02-git-backup`。复制干净远端包，将损坏包移出活动对象库，再从 HEAD 重建索引；重建后暂存区仍为空，工作文件未被覆盖。
- 对原包的 2112 个对象按原对象 ID 读取，远端未覆盖的 655 个对象中恢复 643 个，逐个计算 Git SHA 校验后写入对象库。又从现存历史截图恢复 4 个完全相同 SHA 的对象。原包及恢复脚本/JSON保留，未删除本地 Codex 引用。
- `git rev-list --objects --missing=print HEAD` 无缺失，当前主分支对象图完整；本批产品范围 `git diff --check` 通过。
- **不是全仓 fsck 通过。** 原包仍有 8 个对象未恢复，其中当前可见 Codex 检查点引用的缺失为三份历史 blob（MeetingPage、DraftReviewPage、ui-b04 测试的历史内容）。该历史缺口不在 main 对象图内，不以当前内容重造历史，不进一步扩大本批修复范围。

重建索引另揭示三份 RAWZH01 历史报告和 `tests/acceptance/rawzh01-builder-browser.mjs` 与 HEAD 有差异；保留原样且排除本批提交，来源未判定。原已见两份历史 JSON 的状态标记在重建后消失；未改其内容。AGENTS.md、docs/product-spec.md 及未跟踪历史证据亦不纳入本批。

本次恢复仅解除当前项目差异检查、提交和同步所需障碍；本地历史检查点残留损坏作为环境遗留交付，不改变 AUTO02 产品验收结论。
