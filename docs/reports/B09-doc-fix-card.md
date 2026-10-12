# B09 文档最小返修卡

2026-10-08。主Agent对冻结交付材料独立核对。产品build/152 tests/demo/backup/B07/B08回归已通过，浏览器验收继续中；本卡只授权同一Luna改文档，产品保持冻结。首版docs-final SHA已保留，禁止改写原B09-build报告与本卡。

F09-01：`docs/open-source-reuse.md`“对应与改造”表仍写“B04 AI待实现”，与已实现并确定性独立通过、真实Provider BLOCKED的实际状态矛盾。请改清现状并保留历史核验版本边界；开头若仅说明B01–06历史则明确时间，不以当前表暗示B07–09不存在。

F09-02：`docs/delivery.md`本轮实测CLI行写3文件/51字节，而冻结B09-build最终CLI记录为2文件/22字节。若确有不同次独立运行，请逐次引用有保存的证据和时间/结果；否则按实际最终施工记录纠正，不编造证明。构建字段同样不要把已经冻结后运行的独立构建称为先前探针，B09-build原历史文字可保留，另新返修报告澄清即可。

仅修改README（如有同类过期文字）、open-source-reuse、delivery、delivery-matrix（必要时），施工报告另写`B09-builder-doc-repair1.md`，包含修改路径与SHA、无需重跑产品tests。完成重新冻结文档；主Agent核对产品SHA不变，并继续独立UI/最终完整性验收。不要把当前仍进行中的浏览器签成PASS。
