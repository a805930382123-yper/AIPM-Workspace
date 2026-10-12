# B09 文档返修记录（F09-01 / F09-02）

日期：2026-10-08。依据 `docs/reports/B09-doc-fix-card.md` 仅做文档修正。产品代码保持冻结；未运行或修改产品测试；首版 `docs/reports/B09-build.md` 与返修卡均未修改。

| 缺陷 | 修正 |
|---|---|
| F09-01 | `docs/open-source-reuse.md` 明确说明其开头“截至 2026-10-07”是 B01–B06 的历史核验记录，不能表示 B07–B09 未实现；B02 schema/模板行更新为 B04 AI 草稿、审核和显式确认路径已实现并通过确定性独立验收，真实 Provider 成功与质量仍 BLOCKED。保留已有上游版本及许可证核验边界。 |
| F09-02 | `docs/delivery.md` 的最终 CLI 数字改为首版 `B09-build.md` 实测的 2 文件 / 22 字节、导出 267 ms、恢复 193 ms、退出码均为 0，二进制 SHA 一致；不另造第二次 CLI 证据。交付表明确最终冻结版本 build 是主 Agent独立 PASS（1.03 秒），施工沙盒 TypeScript 检查为 `npx tsc -b` PASS（退出码 0、4.637 秒）；主 Agent独立 `npm test` 为 152/152 PASS（17.369 秒）。 |

README 与交付矩阵没有发现同类过期句，无需修改。浏览器四链路仍由主 Agent验收，不在本返修中签 PASS。真实 Provider 成功和质量仍 BLOCKED。

## 修改后文件 SHA-256

| 路径 | SHA-256 | 字节 |
|---|---|---:|
| `docs/open-source-reuse.md` | `D3C5910EDB6080DEC1B99EB9E275FBBCBD811D367D6EB1E02EA22ADB162E8410` | 9,841 |
| `docs/delivery.md` | `01F0A91386748BB4EE209CFBF27C7F639F6450E2ABDF4BB7C9B990797D9D0BA4` | 7,674 |
| `docs/delivery-matrix.md` | `E45FA02C4BE3BFA7D67A55338C0783F7BBA24076F5B5BC98C3E947844513E854` | 29,004 |
| `README.md`（未改） | `8C4089279A41AE2412FC6A93A7FA6FE8BDCB8051E6B1D8BAA1A3C5281AE8493E` | 29,782 |

矩阵仍有 109 行验收条目。返修后文档已重新冻结，等待主 Agent文档复核与最终浏览器/完整性验收。
