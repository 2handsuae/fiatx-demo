# 波三 · 报文族台账与联动 · 骨架

> 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波三「报文族台账与联动」；波二 spec：`2026-09-26-campaign-a-wave2-regulatory-filing-spec.md`；波二骨架：`2026-09-25-campaign-a-wave2-skeleton.md`
> 本文件只是**骨架**——链总纲 + 承接上一波 + 已定事实 + 待定岔口，**不展开波三 spec**（按 CLAUDE.md §6：spec 只写细当前波，下一波的展开是下一波新会话读总纲 + 本骨架后跟业主脑暴的活，收尾会话不代做）。

## 承接上一波（波二收尾时填写，2026-09-26）

- **波二合并基线**：待波二合 main 后补记（本骨架落笔时波二仍在 worktree `worktree-act-a-wave2-filing`，HEAD 尚未快进进 main；下一波开工会话请先核实 main 的实际 HEAD 与提交范围，不要假设本节的提交哈希）。
- **波二实际交付**：新主体 `RegulatoryFiling`（表 `regulatory_filings`/`regulatory_filing_entries`，业务键 `FIL`）六态六边状态机（`DRAFT→PENDING_SIGNOFF→SIGNED_OFF→SUBMITTED→CLOSED`，`SIGNED_OFF`/驳回回 `DRAFT`，`DRAFT→CANCELLED`）；类型目录首发五行（`filing-type-registry.ts`，`INCIDENT_REPORT`/`REG_INFO_REQUEST_RESPONSE`/`MATERIAL_CHANGE_NOTIFICATION`/`AUDITOR_APPOINTMENT_NOTICE`/`MARKET_OFFENCE_DUAL_REPORT`）；受文机构目录五家（`VARA`/`UAE_FIU`/`EOCN`/`UAE_DATA_OFFICE`/`CBUAE`）；事故通报单槽退役、统一收编为报送台工单（岔口②甲案落地，一码一单自动开单）；钟链机制落地（`chainStart='NOTICE'` 依据码，同事故另一张单提交时落定链单 deadline）；超时持久软标 + 审计（销 `BACKLOG.md` 2026-09-06 那笔债）；经办签发分权（合规官统一经办、高管 `REG_FILING_SUBMIT` 单步签发）；RBAC 新域 `filings` 两桶两组（14 域 68 桶 76 组）；事故域审计 11→9 码；文档六件套（新篇 `modules/v9-regulatory-filing.md` + overview/v1-governance/v8-recon 三篇订正 + BACKLOG 销账 + delivery 语义合同追加 S24）。详见 `modules/v9-regulatory-filing.md`。
- **实际偏差**：无重大架构级偏差——业主三刀裁决（岔口②甲案 / 经办签发甲案 / 设计八节）在 spec 定稿阶段已吸收，T1-T10 执行期只有前端细节修复（评审 Needs-fixes 三条：列表页事故链接改真 Link、详情页去掉「文本一致」这类输入防御性校验、Close 去 `window.prompt`），不涉及数据模型或状态机改动。

### 关于「标记码模式」——波三首个真正的分权决策点

波二 spec §6 明写：「不设 `cap.*` 标记码：本域经办组唯一（合规官），POST 路由码只挂 `REG_FILING_WRITE` 一组，路由门即精确门」——这是因为波二只有一个类型族、一个经办角色，没有"多组共享同一批路由码、服务层要按族精确区分"的场景。**波三第一次真正需要这个判断**：若 MLRO 的「报文类工单独占提交权」与合规官的通用报送台经办权在**同一批路由**上重叠（比如 STR/CNMR/PNMR 三类的 `POST /admin/regulatory-filings/:filingNo/draft` 等端点，如果继续复用波二的通用 controller），就会重演事故域"权限码反查所属组"那个坑——参照 `modules/v1-governance.md` §7 引用的 Ruling-6 先例（`cap.incident.*` 单组独占标记码机制），不要在路由层用粗粒度 OR 权限组去区分"这张单是不是报文类"。若 MLRO 与合规官各自的路由**physically 分离**（不同 controller path），则不需要标记码，这是波三 spec 开工时要先定的架构分岔，见下方「待定岔口」①。

### 类型目录只加行，不动骨架——已验证成立

波二 spec §2 承诺「波三 STR/CNMR/PNMR：filing-type-registry 加行即可挂上状态机与审批链」，这是波二刻意把类型目录设计成与状态机正交（`FilingTypeConfig` 只决定 `defaultAuthority`/`defaultHours`/`requiresIncident` 等参数，不决定状态机形状）换来的。波三设计报文族类型行时，**先确认 STR/CNMR/PNMR 是否真的能塞进现有六态六边**（草拟→送签→已提交→关闭这条线），还是需要额外的状态（比如 CNMR 的"24h 冻结 + 5 工作日窗口"是两只钟叠一张单，还是要开两张单像数据泄露双钟那样处理？"部分命中→10 工作日排除窗→PNMR"是否意味着 PNMR 要等 CNMR 走到某个中间态才能开单，需要类似波二"钟链"机制的姊妹机制）。**不要假设"加行即可"对报文族一定成立**，这是波三 spec 开工必须验证、不能带着假设直接写 plan 的地方。

## 已定事实（波三可以直接假设成立、不必重新论证）

- 「一律留痕不真发」覆盖整个报送族（总纲 §1 已拍板）——报文族同样是「决策留痕 + 已上传标记 + 回执号」，不建报文内容生成、不建监管门户模拟。这与波二 `markSubmitted` 的 `externalRef` 前置闸是同一条原则的两个实例，波三应直接复用 `RegulatoryFiling` 主体（加类型行），不要为报文族另起一个平行主体。
- **MLRO 研判桌与 STR 报告生成让给 Sumsub**（总纲 §1/§3 已核实并拍板，2026-09-25）：Sumsub Case Management 是完整调查工作台，付费 add-on 可一键生成 STR/CTR 报告 XML（UAE 在支持辖区内），但**生成不提交**——正式流程末步是人工下载后自行上传监管门户。我方不建研判 UI、不建报文内容生成；演示用 ⚡ 面板模拟"案件已裁决/报告已生成"信号。**CNMR/PNMR 制裁族报文 Sumsub 未覆盖**，需要我方自己的钟与工单。
- **制裁报文双钟时限已定**（总纲 §3）：确认命中 → 24h 冻结钟 + 5 工作日 CNMR；部分命中 → 24h 暂停 + 10 工作日排除窗 → PNMR；**钟联动我方冻结**（即制裁命中触发的冻结动作与报文钟是同一因果链的两端，冻结先发生、钟随之起跑）。
- 波二类型目录/机构目录的正交设计（见上「承接上一波」）、`INCIDENT_REPORT_BASES` 依据码目录（含 `authority` 字段，波二已回填）、事故域五族独占经办组与四条结案链——波三不改这些，只在报送台主体上加新类型、加 MLRO 相关的权限与状态。
- V5「KYT→STR」尾巴与 V2「CDD 完不成→STR 评估」两条跨版本线，届时接波三的 STR 工单成品（总纲 §4 跨版本 5 处第 1、5 条），波三设计 STR 工单时应确认这两个上游触发点接得上。
- HRC/HRCA 报文工单是**台账面 only**——交易 HOLD 边的判定逻辑移交三域细化（不在波三报送台范围内，报送台只记"报了没有"）。

## 待定岔口（波三 spec 开工时要么脑暴定案、要么向业主要一句话）

1. **报文族与通用族的分权方式**（本骨架核心岔口，见上「标记码模式」一节）：MLRO 的报文类工单独占提交权与合规官的通用经办权，是走物理分离的 controller/路由，还是共享路由改用 `cap.*` 标记码分权？决定了波三新增 RBAC 域的形状。
2. **CNMR/PNMR 双钟的落地形态**：一张单挂两只钟（类似波二"钟链"机制的直接复用），还是 CNMR 与 PNMR 分别开单（类似数据泄露 `PDPL_ART_9`+`TIR_II_C_24H` 双单模式）？"部分命中→排除窗→PNMR"这个转换点是否需要新的状态或新的自动开单触发条件。
3. **tipping-off 门的形态**：总纲点名「STR 案对外沟通预审留痕」——这是报送台工单本身的一个字段/动作（比如往来记录新增一种 `kind`），还是独立于报送台的一道审批门（类似充值/提现/兑换域已有的 tipping-off 白名单机制）？两种形态对应的实现半径差很大，需要先定。
4. **⚡ EOCN 场景的落点**：「名单更新事件 → 存量客户变红 → 冻结 + CNMR 链」——这个场景的起点（EOCN 名单更新）落在哪个域？是客户域的制裁筛查联动报送台开单，还是报送台自己模拟一个"收到名单更新通知"的入口？决定了这条演示主线跨几个域、需要几个 workflow 编排点。
5. **误冻结申诉工单**：总纲点名「grievance 工单 → 联动既有解冻审批」——申诉本身是否走报送台主体（作为一种新类型），还是完全独立于报送台、只是最终联动到既有的 `*_UNFREEZE_WRITE` 解冻审批链？若走报送台，需要确认"申诉"这个方向（谁发起、谁受理）与波二的 OUTBOUND/INBOUND 二分是否还够用。
6. **MLRO 权限包"瘦身版"的具体形状**：总纲原设想是"MLRO 独有权限包（报文类工单独占提交权）"，波二已把"经办 vs 签发"这条分权原则立住（合规官经办、高管签发）——MLRO 在报文族里扮演哪个角色（是新增第三个角色位"研判裁决人"，还是复用现有的经办/签发二分）需要先定，不要想当然套用波二的两角色模型。
