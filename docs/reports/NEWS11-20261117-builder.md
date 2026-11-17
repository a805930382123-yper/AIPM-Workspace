# NEWS11 施工交接

施工完成，产品文件已冻结，待独立验收。基线 `ddabd10a5c6c3218843a33d1a170fdf2f07277fe` 加本报告指纹所列工作树。Sol High 接续施工。按共享目录实物检查，接续时 `services/news` 与 HEAD 无差异，故从该实物版本实现完整任务卡。

今日两栏使用 `POST /api/news/today/check`，通过栏目和 attempt 校验。快消补抓把已知失败及部分失败来源送到适配器入口，未知旧来源完整保留并给出提示。每次写入只合并目标栏。原已收录内容、顺序及 Raw 收据引用保持，空位才新增，满额仍更新诊断。运行和失败时保留展示与保存，旧期保留项继续参与近期精选与历史去重。

真实来源请求继续经 `fetchNewsSource`，由发起任务记录用量。`ensure(true)` 等待当日已有任务。新页面按钮只调用 `check`，该路径零 provider 调用。旧 AI `retry` API 保留原分析能力，仅处理新候选，原分析不提交 provider。来源诊断保留旧 `status`，细分阶段、结果和计数，展示最近读取成功。部分失败和全失败不更新该成功时间。

## 施工实测

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | `tsc -b` 退出 0。 |
| `node --import tsx --import ./tests/support/css-stub.mjs --test @files tests/news11-builder.test.ts tests/acceptance/news09-fix-bounds.test.ts` | 61/61，失败、跳过均 0。`@files` 为 `git ls-files 'tests/news*.test.ts' 'tests/news*.test.tsx' 'tests/pipe01*.test.ts' 'tests/pipe01*.test.tsx'` 返回的已跟踪文件。覆盖新闻、PIPE01、新增同标题质量拒绝后补位、PDF/HTML 超时与请求大小/跳转约束。 |
| Node `import { build } from 'vite'` 后调用 `build({envDir:false,build:{outDir:path.join(root,'dist')}})`，`root` 为系统 TEMP 下 `mkdtemp` | 237 模块，退出 0。既有 bundle 体积提示及 TEMP 输出目录提示。 |
| `git diff --check -- services/news server/news-api.ts app/pages/NewsPage.tsx app/news.css` | 退出 0；Git 提示 Windows 换行转换。 |

施工预跑验收者准备中的 `node --import tsx --test tests/acceptance/news11-review-core.mjs` 得 4/5。未通过的旧来源映射用例预期跳过往期合成标题，当时脚本只写入今日记录，实际来源会取得缺少历史记录的该候选；已把命令和出入交给独验者核对。这次预跑不作为独立验收结论。桌面/手机真实浏览器交独验者，施工未启动用户服务。真实官网请求和真实模型调用均为 0，测试使用隔离数据。现有 `tests/news01-sources.test.ts` 不列入本批。

## 最终文件 SHA256

```text
3083a2f7df93a2dc799341c6efe45d488325780d8e0d1248520c50f1117f80f2  app/news.css
643593b58c543692ea71a4ed5d727f7fb6ce24a7020dc0ca895a4c89fdb82d6c  app/pages/NewsPage.tsx
934dad8ab700a80cbb6532f018d3163251f0d93164ec9f5380c6401652368943  server/news-api.ts
43d2e508914b474f6fd1bf42f74894e95d452c1fc17acda95d1a900ebc8db31f  services/news/additional-research.ts
c0795482fb71f4541b86dfa2ddc8cafc7cffdb013cff69c333de1e14db4076cd  services/news/new-research.ts
355b8ae908de93ff20d239f35b1ccbb13cc898a6a59ee968ffe33f02240544b9  services/news/research-sources.ts
591be94b67c803864d71f07572629c45418c59f376c73f078fe72dfd2afcab51  services/news/service.ts
0ed919e98622695b0340aaec61a7e0809fbc0854d28c247270ddb6cc36d4f405  services/news/source-health.ts
8b22b92cc597b0e2a9e434d3366a46c8ce36f0ccacf8c55d4144365d5fad9af0  services/news/sources.ts
5559df9ab2437ff817286aa3a0cf272bd58c069f4893cfdaecdd61c5f3a2744a  services/news/types.ts
b2d4ec8ed521a72cc8736b52ad90e976c25769f638080ac8a47422572697a28b  tests/news11-builder.test.ts
```
