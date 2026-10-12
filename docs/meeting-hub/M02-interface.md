# M02 界面交接

2026-10-11。M02阶段PASS，结论与限制见 [独立验收](../reports/M02-acceptance.md)。只交付会议管理与云端来源；M03–M05未授权。M01交接是当时记录，其“页面尚未施工”已由本批补齐，服务契约未变。

## 组件与数据边界

- `app/pages/MeetingPage.tsx`：列表/详情、元数据表单、独立策略表单、类型/标签管理、确认删除。
- `app/meeting.css`：桌面列表/详情双列，窄屏堆叠；删除/确认按钮限定会议区域。
- `app/App.tsx`：增加`meeting`导航与页面装配，原五导航保留。
- `app/api.ts`：增加Meeting、MeetingSummary、MeetingCatalog等类型；HTTP仍使用原`api`和`ApiError`。

事实源为 [M01 HTTP服务](M01-interface.md)。列表是元数据摘要；详情才有capabilities。所有变更经API，没有浏览器持久化正文、直接文件写入或Provider调用。来源是原样HTTPS链接，用户点击新标签打开，`noopener noreferrer`；没有抓取、播放器或飞书授权代理。

## 界面状态与更新

| URL键 | 状态 |
|---|---|
| mq | 标题/标签名称/客户/项目搜索 |
| mt、mg | 类型/标签UUID |
| mc、mp | 客户/项目 |
| ml | 保密等级 |
| mo | asc/desc日期顺序；同日按UUID稳定排序 |
| meeting | 当前选择的会议UUID |

刷新初始页仍为首页；进入会议档案恢复URL筛选与选择。切换会议使用pushState，筛选使用replaceState，popstate重新读取服务。URL会包含所选搜索、客户/项目文字；仅适用于当前本机工作台，分享地址前需自行检查。

新建默认本地当天、Sensitive和首个活动类型；后端默认cloud与三个授权false。表单用稳定requestId，相同输入失败重试复用；输入变更生成新ID。普通编辑不提交策略字段；未改的类型/标签不重复提交，因此历史停用关联能保留。目录改名/停用/恢复沿用UUID和目录revision。

策略单独提交：等级只能保持/提高；Internal/Sensitive本地需独立授权和确认，Raw授权另有确认。切cloud撤销Raw授权，但本地授权标记可由服务保留，界面如实显示；需要撤权时应显式取消本地授权。Restricted转换列字段清理预览并需确认，创建仅代称、日期时间、类型。外部AI始终关闭。

读取世代、窗口操作世代、mounted标记阻止过期回调改变当前选择；表单/删除有即时提交锁，忙时关闭受限。400/403/409/5xx或连接失败保留可恢复输入。409可以载入服务最新revision，原编辑内容继续保留，用户检查后才再次提交；不会自动合并或自动覆盖外部变更。

## 给M03的接缝

详情、策略状态、`capabilities`已经可读。M03可在详情接入独立纪要区，但必须同时扩展M01服务、持久化严格读盘校验与备份验证；现有imports/raw_links等仍只能为空。`canImportMinutes/canRegisterRaw/canUseAi`均false，界面没有上传/登记/AI按钮，不能用旧Raw API充当占位。

后续加入正文时，应保持元数据搜索与筛选边界、原件/工作副本区分、服务端授权门禁、revision/幂等保护和迟到响应隔离。普通编辑的所有权不包含策略或正文。M02未验证未来本地副本删除、转换或Raw关联行为。
