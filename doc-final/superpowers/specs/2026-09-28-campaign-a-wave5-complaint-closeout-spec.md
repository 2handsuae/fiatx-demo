# 战役甲 · 波五 spec —— 投诉工作流 + 战役收官

> 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波五行、§7 终闸 ｜ 骨架：`2026-09-27-campaign-a-wave5-skeleton.md`
> 监管依据调研（一手核实留档）：`checkups/2026-09-27-complaint-handling-regulatory-research.md`（下称「调研」）
> 收尾对照 `rules/delivery-checklist.md`；评审按 `rules/review-rubric.md`。本波动状态机与审批矩阵，**评审升档**（照总纲 §8 高危波惯例）。

## §0 脑暴裁定台账（2026-09-27/28，业主已拍板）

| # | 岔口 | 裁定 | 依据一句话 |
|---|---|---|---|
| 1 | 骨架岔口 1（升级模型对撞点） | **升级 = 生成真实事件**（`COMPLAINT_ESCALATION` 通电，双向挂钩）；Raymond 包「escalate 走文案」否决 | 调研 §5.4：两案均非监管义务，拍板依据是演示价值——终闸第四条主线「投诉→超时→升级事件」的成立前提 |
| 2 | 裁定 1 子岔口（扳机） | **人工点「升级」**；超时只软标变红（照波二/波四超时软标先例），不自动开事件 | 事件登记按铁律①须有操作人留痕；「合规官见红钟→点升级」演示更有讲头 |
| 3 | 骨架岔口 4（受理权限） | **运营受理调查 + 合规官裁决**，新立投诉权限桶；裁决走 maker-checker（运营提/合规官批） | 条文双红线（CRM I.B.2 合规官总责 + I.B.3.b 调查人≠当事人）用角色分层表达；升级后事件经办也是运营（波一占位已点名），动线不断 |
| 4 | 骨架岔口 2（延期形状） | **显式延期状态** `INVESTIGATING_EXTENDED`，延期动作强制填客户解释、死线 4→8 周、只许一次；「标志位改死线」否决 | VARA III.A.1.b.i 的第 4 周更新是强制义务；改死线字段=绕迁移表，悖铁律④ |
| 5 | 事件结案链 | **新开 `INCIDENT_CLOSE_CUSTOMER` 合规官单步链**（48h 可撤）；波一占位的 FINANCIAL（CFO）改掉 | 客户之事一路由合规官守门，提单人始终是运营无自批；CFO 收口缺业务依据 |
| 6 | 客户端可见面范围 | **能提交、能看进展，不能来回聊**：提交表单 + 只读时间线 + 三类对客户书面往来（确认函/延期解释/最终答复）；对话/附件/撤回不做 | 三类书面正是条文强制「给客户」之物，只读时间线即闭环；对话等丙的通知地基 |
| — | 骨架岔口 3（新幕编号） | 维持骨架约定：**收官时一次性定稿**；本波场景暂编 23/24 | 不提前散乱编号 |

## §1 已核事实（骨架「spec 开工核对项」完成情况）

- **1/4/8 周数字销账**：VARA Market Conduct Rulebook Rule III.A.1.a/b 原文逐字（三版 PDF 比对未改过），非 FCA 误记；三段留档 = Rule III.A.5 逐字对应。铸码依据条款：时钟 `MC III.A.1`、留档 `MC III.A.5`、利益隔离 `CRM I.B.3.b`。周 = 自然日（条文用 week，自 complaint being made 起算：7/28/56 天）。
- **零联动确认**（调研 §2.4）：普通 VASP 无定期投诉报送义务 → 波二报送台、波四义务台账**不加行**；保存年限走 CRM I.F 通用条款（≥8 年），无需投诉专属实现。
- **占位现状**：`incident-type-registry.ts:113` `COMPLAINT_ESCALATION` enabled:false，operatorGroup=`INCIDENT_OPS_WRITE`（波一裁决点名，保留），closeActionType 占位 `INCIDENT_CLOSE_FINANCIAL`（本波改 `INCIDENT_CLOSE_CUSTOMER`）。
- **四条既有结案链批准人**（approval.constants.ts:383-395）：SECURITY=MLRO+CFO ｜ FINANCIAL=CFO ｜ TECHSEC=CISO ｜ PRUDENTIAL=SENIOR_MANAGEMENT_OFFICER——客户族第五条为新增。
- **单号**：`generateReferenceNo('CMP')`，照 RI/VEN/OBL/FIL 既有惯例（铁律⑥）。
- **client-web 首触**：plan 开工必读 `rules/frontend-client.md` + `ui-contract/`；本波是五波来第一次动客户端。

## §2 投诉主体与状态机

### 2.1 表 `complaints`（新主体 Complaint）

| 字段 | 说明 |
|---|---|
| complaintNo | CMP 族业务键，unique，对外唯一识别 |
| ownerCustomerNo / category / relatedOrderNo? | 客户业务号；类别枚举 `SERVICE / FEES / ORDER_EXECUTION / FROZEN_FUNDS_APPEAL / OTHER`（冻结申诉类别即裁定⑤「入口壳」——正常走投诉流程，调查中人工关联既有补料+解冻链单号，不立专门单据）；可选关联订单号 |
| subject / description | 客户提交的投诉内容（三段留档第一段） |
| currentStatus | 六态枚举，见 2.2 |
| submittedAt / ackDeadlineAt / acknowledgedAt? | 提交时刻；确认死线 = submittedAt+7d；确认时刻（停确认钟） |
| resolveDeadlineAt / extendedAt? / resolvedAt? | 裁决死线 = submittedAt+28d，延期改 56d；延期时刻（兼一次性守卫）；裁决时刻 |
| resolutionOutcome? / resolutionText? | 裁决结论枚举 `UPHELD / PARTIALLY_UPHELD / REJECTED` + 最终答复正文（三段留档第三段） |
| escalatedIncidentNo? | 升级生成的事件号（兼一次性守卫），双向跳转 |

子表 `complaint_entries`（三段留档第二段「措施」+ 全部书面往来）：complaintNo、kind（`INTERNAL_NOTE` 内部备注 / `CLIENT_MESSAGE` 对客户可见）、messageType?（CLIENT_MESSAGE 专用：`ACK / EXTENSION_NOTICE / FINAL_RESPONSE`）、body、actorNo、createdAt。**客户提交与客户可见记录的 actor 用 customerNo，不写 UUID**（审计页留账判例，波五不重蹈）。

### 2.2 状态机（显式迁移表，铁律④；非法跃迁显式拒绝）

```
RECEIVED ──acknowledge──▶ ACKNOWLEDGED ──startInvestigation──▶ INVESTIGATING
  INVESTIGATING ──extend──▶ INVESTIGATING_EXTENDED          （强制解释文字；28d→56d；extendedAt 已有则拒）
  INVESTIGATING / INVESTIGATING_EXTENDED ──proposeResolution──▶ RESOLUTION_PENDING（起草结论+答复，开审批）
  RESOLUTION_PENDING ──applyResolution──▶ RESOLVED（审批通过；终态）
  RESOLUTION_PENDING ──rejectResolution──▶ INVESTIGATING 或 INVESTIGATING_EXTENDED（按 extendedAt 有无选边，两条显式边）
```

- `acknowledge` 必填确认函文本 → entries CLIENT/ACK；`extend` 必填解释 → entries CLIENT/EXTENSION_NOTICE；`applyResolution` 落 resolutionText → entries CLIENT/FINAL_RESPONSE——三个动作各自把「状态迁移 + 强制往来记录 + 审计」绑死。
- **升级是动作不是状态**（照事故域 escalate 先例）：`INVESTIGATING` / `INVESTIGATING_EXTENDED` 两态可执行 escalate，守卫 = escalatedIncidentNo 为空；升级后投诉弧继续走（8 周条文义务不因内部升级消失），RESOLVED 后不可升级。
- 审批载荷时序照波四判例拆三步：propose 快照进审批单 objectSnapshot，apply 从载荷读值落地。

## §3 客户端（client-web，本波首触）

- 提交页：类别 / 主题 / 描述 / 可选关联单号，`POST /client/complaints`（client JWT，客户本人）。
- 「我的投诉」列表 + 详情：状态时间线（人话标签，判例在档）+ 仅 `CLIENT_MESSAGE` 三类书面往来；`GET /client/complaints`（仅本人）、`GET /client/complaints/:complaintNo`。
- 升级、内部备注、审批过程**不下发**客户端（内部治理，客户只见「处理中」）。
- UI 照 `rules/frontend-client.md` 契约与既有黑白双主题 token；改完必过闸⑤截图 + `npm run test:client`。

## §4 管理台（admin-web）

- 事件中心区新挂投诉列表页 + 详情页，**不另立顶层模块**（三刀「投诉并入事件中心」；代码挂 `governance/`，照波四挂载惯例）。
- 详情页：基本信息 / 双钟卡（确认钟、裁决钟，超时红）/ 往来记录（全量含内部）/ 升级事件号跳转 / 审计区惯例。
- 动作按钮可见性 = **状态 × 持码**双维（波二判例，禁加第三维）。
- 路由（进 RBAC catalog + db:base:sync 惯例）：`GET /admin/complaints`、`GET /admin/complaints/:complaintNo`、`POST .../acknowledge | investigation | extend | propose-resolution | escalate | notes`。

## §5 升级联动（对撞点落地）

- `complaint-escalation-workflow.service.ts` 照 `ri-replacement-workflow` 先例：**只编排、零自己的审计写入**——投诉侧 `markEscalated`（记 escalatedIncidentNo + 审计）、事件侧 `registerFromComplaint`（审计落事件服务）。
- registry 行改动（改行不加行，类型行 12 不变）：enabled:true；closeActionType→`INCIDENT_CLOSE_CUSTOMER`；requiredAnchors→`[complaintNo, ownerCustomerNo]`；reportBasisCandidates 保持空（调研 §2.4 无通报义务）；assessmentScheme=IMPACT 不变。
- **门语义保留**：`/admin/incidents` 手工登记 `COMPLAINT_ESCALATION` 继续 400，只放行投诉侧内部入口——波一测试「MANUAL and COMPLAINT_ESCALATION are rejected」改写为断言此新语义（register 端点拒 + workflow 入口通）。

## §6 时钟与闹钟墙

- clock-wall 聚合端点加 `kind='COMPLAINT'` 分支：每张非终态投诉一行，deadline = 未确认取 ackDeadlineAt、已确认取 resolveDeadlineAt，label 区分两钟（骨架提醒的字段命名核对在此落地：投诉不复用 deadlineAt/nextDueAt 列名，分支内自取自家字段）。
- ⚡ 新装置 `simulate-complaint-timeout`（拨两钟至过期），挂既有 `DEMO_CLOCK_WRITE` 门控；**剧本预写换号话术**（波四交叉现象：运营不持拨钟权限，演示切超管，不临场现编）。
- 超时 = 软标变红，无自动动作（裁定 2）。

## §7 权限、审计、审批（预期终态数量——改完必须对上，纪律五）

| 计数 | 波前 | 预期终态 | 增量内容 |
|---|---|---|---|
| RBAC 域 | 15 | **15** | 不新增域，桶挂事件登记域 |
| RBAC 桶 | 73 | **75** | `COMPLAINT_READ` / `COMPLAINT_WRITE`（运营持 WRITE；合规官裁决走审批角色路由不占桶） |
| RBAC 组 | 81 | **预期 83** | 以 verify:rbac 实测钉数，偏差回填本表 |
| 审批类型 | — | **+2** | `COMPLAINT_RESOLUTION`（运营提/合规官批/48h 可撤，照 RI_REPLACEMENT 先例）、`INCIDENT_CLOSE_CUSTOMER`（合规官单步/48h 可撤） |
| 审计现役码 | 286 | **296** | 新 10 码（plan 核定回填，2026-09-28）：COMPLAINT_ `SUBMITTED / ACKNOWLEDGED / INVESTIGATION_STARTED / NOTE_ADDED / EXTENDED / RESOLUTION_PROPOSED / RESOLUTION_APPLIED / RESOLUTION_REJECTED / ESCALATED / DEADLINE_FASTFORWARDED`（内部备注与 ⚡ 拨钟也是持久动作，铁律①补齐）；事件侧登记复用既有码 |
| 事件类型行 | 12 | **12** | 改行不加行（§5） |
| prisma 表 | — | **+2** | complaints / complaint_entries；**加表必配 reset 登记表**（波二判例） |

审计通则：每条状态边必写 fromStatus/toStatus（判例）；展示级字段（deadline、outcome、解释文本摘要等）镜像进 metadata（R5 判例，extra 校验形态保留）。

## §8 种子与演示同步

- 种子投诉三张：RECEIVED 新到 ｜ INVESTIGATING 临近 4 周（供 ⚡ 演延期）｜ RESOLVED 全档（三段留档完整可查）。
- 同步 `demo/data.md` 生成区、`demo/baseline.md` 判据、`demo/script.md` 场景 23/24（暂编）；数据 reset 重铺，不写兼容（总纲 §3）。

## §9 验收判据（可执行口径）

1. **场景 23 全弧实走**：client 提交 → admin 确认（1 周钟停）→ 调查 → ⚡ 拨至第 4 周 → 延期（强制解释）→ 提裁决 → 合规官批 → client 详情三类书面齐全。截图物证入 checkups 惯例目录。
2. **场景 24 升级线**（终闸主线四）：⚡ 拨过 8 周 → 闹钟墙红 → 点升级 → 事件生成（anchors 齐）→ 事件调查 → `INCIDENT_CLOSE_CUSTOMER` 合规官批结案 → 投诉/事件双向跳转可点。
3. **状态机变异测试**：非法跃迁拒（如 RECEIVED 直接 proposeResolution）；二次延期拒；二次升级拒；RESOLVED 后升级拒；手工登记 COMPLAINT_ESCALATION 拒。绿必须来自行为，禁扫源码文本断言。
4. verify:rbac 扩判据全绿，既有红集与波前基线恒等口径（波四判例）。
5. 审计行为探针：每边 from/to 齐；客户提交 actor=customerNo 非 UUID；审批三步（PROPOSED/APPLIED 或 REJECTED）齐。
6. 闸门：随手闸①—⑤（动 client-web → test:client + 截图）；收尾闸⑥⑧（动 schema/seed）。jest 本任务目录全绿。

## §10 战役收官（总纲 §7 终闸，本波 plan 尾部独立任务段）

1. 四条主线剧本全程走查（网安 72h 双钟 ｜ 制裁→CNMR ｜ 可疑→STR→tipping-off ｜ 投诉→超时→升级事件）。
2. 总纲 §4 销账：36+5 逐条四态对照（波内/挂起/不建/移交），快照表交业主确认，roadmap 翻勾清单一并交。
3. 三刀 + §2 覆盖判据写入 `decisions.md`。
4. 岔口 3 定稿：新幕 vs 并入既有幕，场景 19–24 终编，`demo/script.md` 增「异常与监管」幕。
5. 文档收口：`modules/` 投诉篇（或并入事件篇，收口时按体量定）+ overview §4 计数；CHANGELOG 一行；spec/plan 归档随合并惯例；总纲随末波入 archive（活文档条款）。
6. 悬挂项移交确认：HRCA 官方名一手核 ｜ EOCN TFS 原文存档 ｜ 云 setup 装 TigerBeetle 行——三项不属本波，收官时点名移交状态。

## §11 本波不做（对照总纲 §2/§6 与调研负面结论）

自动升级 ｜ 二次延期 ｜ 客户端对话/附件/撤回 ｜ 通知推送（丙）｜ 投诉报监管联动与报送台/日历加行（调研证无义务）｜ 简单/复杂投诉分级（CBUAE 的，VARA 无）｜ 3 工作日简化通道（FCA 的，VARA 无）｜ 按单排除具体个人的利益隔离校验（角色分层已表达红线）｜ 告知客户外部申诉渠道（VARA 无此义务且无申诉专员机制）｜ Raymond 包任何代码收编（乙案已裁，只取设计）

## §12 展开边界备忘

- 波五是战役甲末波：收官即战役收官，无波六骨架。
- DFSA 参照调研缺列（子代理失联），旁证性质不影响任何裁定，不补。
- 投诉钟若与丙战役通知地基复活后回接推送，届时另立任务（总纲 §5 假设④ 语义顺延）。
