# R16/R18 字段契约提示：独立工程验收

2026-10-27，Astra medium。基线 `4c27037753c70633b75edf6ef42d979e7d37970b` 加施工冻结三文件差异；Sol交接停写后独立审实际diff、[已审方案](R1618-DIAG-AUDIT-20261027-plan.md)及[施工报告](R1618-FIX-20261027-builder.md)，并执行唯一新增定向检查。最终提交由主Agent关联Git历史。

## 分层结论

**本轮提示工程：通过。** 新字段层级/分型/逐断言支持及question-only处理说明已进入实际planning请求；既有revision递增区分新旧提示。严格schema未放宽，原246仍被拒绝；人工合规计划证明未知问题独立正文及无依据字段省略通道保持。未发现本轮必须返修项。

**真实自动质量及整项：未通过保持。** 本轮没有真实调用，不能证明模型遵从改善，不能关闭seq246 Q02 FAIL；真实Q03仍NOT_RUN，Concept覆盖缺证、R18历史失败、R16/R18整项及B09/全产品均未通过。工程通过不等于已修复真实语义质量。

## 实际差异与验收依据

仅两产品文件修改：knowledge-planning.ts在既有提示常量中增加合法page键、模板栏目唯一嵌套位置、字段按当前type取目录、事实性断言支持及question-only省略说明，并给短抽象正反例。使用“所有模板栏目”措辞，保留现有目录及AI分析建议边界；未要求固定页数、未将本次六句原文答案写入提示。

rules.ts只将 `KB02_PROMPT_REVISION` 从13改14，沿现有rulesVersion机制。schema、validator、expand/project、checkpoint、Draft/渲染、Provider等未改；没有搬字段、补引用、自动重试或增加模型调用。旧检查点版本冲突分支复用既有证据，不重复恢复矩阵。

测试文件仅一个新R1618 FIX场景及validateSchema导入。独立核对其实际捕获pipeline请求，检查新说明、现有schema与246归档schema一致、revision14与旧checkpoint13不同。人工合规单Process不强制两型，只验证原5事实及1问题、待确认问题单列、无依据exceptions/metrics/systems省略及对应占位、AI分析建议标签。

施工首跑失败后的断言调整合理：既有 `DraftEvidence` 类型及drafts.ts创建映射只保存id/rawId/quote/start/end/chunkIndex，不保存抽取阶段派生occurrences。新断言精确比较这六个既有存储字段，并保留全部source_facts深相等、每条引文等于Raw slice、Raw文件字节一致、checkpoint深相等和原246响应文件不变。没有为迁就测试修改产品，不能将未存储occurrences误称本轮数据丢失或宣称所有派生元数据均进入Draft。

## 实际命令与结果

| 实际命令/检查 | 结果 |
| --- | --- |
| `node --import tsx --test --test-name-pattern="R1618 FIX" tests/r1618-auto-fields.test.ts` | 独立执行一次，exit0；1项通过/0失败，测试59.8411ms、Node总233.4271ms、命令墙钟0.591秒 |
| `git diff --` 三个指定路径，读取施工报告 | 实际审查，符合已审范围，无额外产品落点 |
| `Get-FileHash` 三文件，测试前后核对 | 3/3与施工冻结一致，见下 |
| `rg` 核DraftEvidence及创建映射；`git diff --check --` 三路径 | 字段契约吻合；diff检查exit0，换行提示不是失败 |
| `git rev-parse HEAD` | 返回上述完整基线 |

| 冻结文件 | SHA256 |
| --- | --- |
| services/llm/knowledge-planning.ts | `ED7E3E9B3CBDD0AA6E8F8AD56E4364B39D6787017853E73458F3C3150A072A0D` |
| services/llm/rules.ts | `59B4B29EF044C50269E03A7E66B2B5D6344AABFE620E1B96499D78D7705B6DD6` |
| tests/r1618-auto-fields.test.ts | `1741BD557894CD2BF6330364941436433724E0209C892C6D989D7B19AE343CB9` |

未执行旧四项、全矩阵、tsc、浏览器或正式保存。fake fixture显式注入内存Provider，complete只返回人工JSON，实际路径不构造真实Provider、不调用loadLlmConfig；归档读取仅公开request/response/checkpoint。故本轮真实调用0、实际配置读取0，知识246/500、Prompt15/24不变，247未用。临时fixture由测试finally清理；未启动服务。独立未改产品/tests或外部AGENTS/AGENT-ROUTER工作，平台token计量不可得。

## 后续

本工程小批可交付。下一步若进行真实复验，应另行固定新版本、代表性资料、实际请求上限及独立质量标准；旧246失败保留，不消费旧余量、不通过人工补稿或强拆页面签自动通过。本轮验收结束，不自动启动后续批次。
