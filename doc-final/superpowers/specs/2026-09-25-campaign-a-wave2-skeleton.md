# 波二 · 报送台骨架 · 骨架

> 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波二「报送台骨架」；波一 spec：`2026-09-25-campaign-a-wave1-incident-taxonomy-spec.md`；波一 plan：`../plans/2026-09-25-campaign-a-wave1-incident-taxonomy.md`
> 本文件只是**骨架**——链总纲 + 承接上一波 + 已定事实 + 待定岔口，**不展开波二 spec**（按 CLAUDE.md §6：spec 只写细当前波，下一波的展开是下一波新会话读总纲 + 本骨架后跟业主脑暴的活，收尾会话不代做）。

## 承接上一波（波一收尾时填写，2026-09-25）

- 波一合并基线：main `cd288051`（2026-09-26 波二开工会话核实补记——甲波一以**线性快进**落 main，无 merge commit，T1–T11+终审+收官归档共 28 个提交，起点 `842a09ab` spec、收口 `cd288051` 归档；合并时顺手修存量 flake `e3dd8bd0`，tb-evidence effectiveDate 断言改迪拜业务日；worktree 与分支已清，main 工作树 clean）
- 波一实际交付：事故分类十类终盘（`MANUAL` 退役、新增 7 类 + 1 占位 `COMPLAINT_ESCALATION`）；结案审批两链扩四链（新增 `INCIDENT_CLOSE_TECHSEC`/CISO 单步、`INCIDENT_CLOSE_PRUDENTIAL`/高管单步）；权限两桶扩六桶、五族独立经办组（金库/技术官/DPO/运营/CFO）；通报依据码目录三条扩七条（新增 `PDPL_ART_9`/`TIR_II_C_24H`/`COMPANY_IV_H_1`/`COMPANY_VI_C_F`，`TIR_II_C_24H` 引入 `chainStart` 钟链机制）；`incident-type-registry.ts` 单一注册表落地，十类各自的族/经办组/结案链/通报候选码集/必填锚键/定损口径/善后白名单一行一格。

### 实际偏差四条（波一执行期相对总纲/骨架原始设想的设计演进，波二排期时按现状读）

1. **Ruling-6（T5 修1）：`cap.incident.*` 族独占能力码机制**——`assertOperator` 不走"权限码反查所属组"（该反查在码被多组共享时会把持有人一并抬进所有共享组，GET 路由码同属多组时门形同虚设），改为 `RBAC_PERMISSION_DEFINITIONS` 新增五个 `cap.incident.{funds,tech,data,ops,fin}` 标记码、每码只挂一个组，`assertOperator` 用 `accessControl.hasPermission(userId, marker)` 精确判定。**波二新增主体（报送台工单）若也要按类型/受文机构分权，应复用同一套"标记码单组独占"模式**，不要重蹈"反查所属组"的坑。
2. **Ruling-10（T8 修复轮1，乙案）：`ASSESSED→CLOSED` 可达性改判**——不是"`assessmentBasis` 字面等于 `NO_LOSS` 才放行"，而是"`NO_LOSS` 或该类型 `allowedRemediationKinds` 为空集"才放行；四类空白名单类型（`CYBER_BCDR`/`OUTSOURCING_FAILURE`/`STUCK_TRANSACTION_MAJOR`/`PRUDENTIAL_BREACH`）借此从"结案不可达死结"解出。**波二工单状态机若也有"无善后动作直接终结"这类边，参考这条乙案的判断逻辑（语义是"无善后"而非"某个字段等于某个值"），不要重犯同一类误判**。
3. **Ruling-12（T9 修1）：前端 `heldGroups` 子集完备推导**——"组 G 被持有 ⟺ G 的全部码 ⊆ 角色持码集"（不是"码反查组"）；已抽纯函数 `admin-web/src/rbac/heldGroups.ts`（`deriveHeldGroups`）。**波二若新增角色详情页展示逻辑（如工单类型分权矩阵），复用这个纯函数，不要在新页面里另写一份"码反查组"**。
4. **Ruling-13（T9 修2）：view 桶只挂单组**——`incidents.view` 桶从"多组捆绑"改判成只挂 `INCIDENT_READ` 一个组（写组持有人的码集天然包含 `INCIDENT_READ` 名下的 GET 码，子集完备推导仍判定"持有"，故对写组持有人是无害冗余；对纯读角色则消掉了越权面）。⚠️ **同一形状的缺口在客户域 `customer.view` 桶仍未修**（`CUSTOMER_READ`/`CUSTOMER_RESTRICTION_READ`/`CUSTOMER_TAG_VIEW` 三组捆绑，CFO 原样重提 Modify 会多拿两组，见 `BACKLOG.md` 2026-09-25 甲波一 T11 登记行）——**波二新建"view 类"桶时直接按 Ruling-13 单组模式设计，不要新增第三个需要事后修的同形缺口**。

### 通报单槽现状（波二要接手的部分）

事故域今天的"通报"是挂在 `Incident` 行上的**单槽字段**——`reportRequired`（布尔）、`reportBasisCodes`（逗号分隔依据码串）、`reportDeadlineAt`（单一倒计时）、`reportDraft`/`reportDraftedAt`（单份草案）、`reportedAt`/`reportedByUserId`/`reportReference`（单次标记已通报）。一个事故只能有**一次**通报动作留痕，没有"多次往返""受文机构目录""回执/追问"这些概念——这是波一刻意的范围收缩（spec 明写"通报留痕"只是"留痕两步"，不是完整报送流程）。波二的报送台工单主体要接住这个单槽模型升级为完整往返状态机（草拟→内批→已提交→回执/追问→关闭），**接口设计时对照 `Incident` 现有六个通报字段逐一决定去留**：是工单主体完全接管（事故侧字段退役/改为只读镜像工单摘要），还是事故侧字段保留作为"最小合规底线"、工单主体是可选的更完整记录（该判断就是下面的岔口②）。

### PRUDENTIAL 联动位

`PRUDENTIAL_BREACH`（审慎/NLA 缺口）当前挂在事故域 FINANCIAL 族，通报依据码 `COMPANY_VI_C_F`（"立即通知 VARA；每日更新直到 VARA 满意"）——波一只落了"立即通知"这一次性动作，**"每日更新直到满意"这个日历义务波一明确不落**（`INCIDENT_REPORT_BASES` 注释：`daily updates until VARA is satisfied (calendar duty → wave 4)`）。总纲 §3 波四「合规日历」块正是承接这个日历义务的地方。波二报送台工单落地后，`PRUDENTIAL_BREACH` 的"立即通知"这一步会长成什么样（继续走事故侧单槽字段，还是改走波二工单），需要在波二 spec 里对 `PRUDENTIAL_BREACH` 这一类做一次显式决定，不要遗漏；波四设计"每日更新"日历条目时，其"到期生成待办工单"的挂靠对象也取决于波二这次决定。

### V8 通报收编岔口②（波二 spec 必须裁决，不许双轨长存）

`v8-recon.md`/`v1-governance.md` §7 描述的"事故通报留痕"（前述单槽机制）与波二要建的"通用监管往来工单"是同一件事的两套现存/待建实现。总纲 §5 岔口②原文：「V8 事故通报收编方式：统一为报送台工单（推荐）还是事故侧保留独立通报面，波二 spec 定；不许双轨长存」。总纲给出的推荐方向是**统一为报送台工单**（事故域"需要监管通报"时自动开一张工单，工单是权威记录），但这仍是待业主/波二 spec 拍板的岔口，本骨架不代为决定。

## 已定事实（波二可以直接假设成立、不必重新论证）

- 十类事故类型与其族划分（FUNDS/TECH_SECURITY/DATA/OPERATIONS/FINANCIAL）、五枚族独占能力码 `cap.incident.*`、四条结案审批链——见 `modules/v1-governance.md` §7，波二不改这些，只在其上挂通报工单。
- 岔口①（事件登记权限按类型分权）已解——五族独立经办组，见上。
- 岔口③（卡单 72h 事件类型做不做）已解——`STUCK_TRANSACTION_MAJOR` 已落地为启用类型，用 `TIR_K_H`（72 小时）依据码。
- 岔口⑥（同事外来投诉域代码收编）已裁——代码不收编，只收编设计（字段模型与流程决策）供波一/波五参考；波一未消费（`COMPLAINT_ESCALATION` 波一只留占位、未启用）。
- `INCIDENT_REPORT_BASES` 目录七条码的 `hours`/`immediate`/`chainStart` 三种时限形态（数字钟 / 即时义务无钟 / 钟链起点在另一码），波二新增受文机构目录时若也有类似时限差异，可复用同一套建模，不必另起炉灶。
- Ruling-14（终审已修）：`CYBER_BCDR` 的 `affectedSystem` 是受控枚举+OTHER（spec §1），成员固定为 `BACKEND_API`/`ADMIN_PORTAL`/`CLIENT_PORTAL`/`LEDGER`/`DATABASE`/`CLOUD_INFRA`/`OTHER`（`admin-web/src/utils/incidentStatusMap.ts` 的 `AFFECTED_SYSTEM_OPTIONS`）。教训：T10 落地时把它画成了自由文本输入框，把 spec 写明的受控枚举悄悄降级成自由文本——**格值不许静默降级**，波二新增任何"受控枚举+OTHER"字段时按 spec 原文的枚举成员实现，不要图省事先上文本框再"以后再补"。

## 待定岔口（波二 spec 开工时要么脑暴定案、要么向业主要一句话）

1. **岔口②（本波核心）**：V8 事故通报收编方式——统一为工单，还是事故侧保留独立面。
2. 若选"统一为工单"：`Incident` 表六个通报字段（`reportRequired`/`reportBasisCodes`/`reportDeadlineAt`/`reportDraft`/`reportDraftedAt`/`reportedAt`/`reportedByUserId`/`reportReference`）逐一去留——全退役改工单镜像，还是留一部分做"未开工单前的临时占位"？退役会牵动 `incident.service.ts`（`saveReportDraft`/`markReported` 两方法）、`incidents.controller.ts` 两端点、admin-web `IncidentDetailPage.tsx` 通报区块、`test/incident-register.e2e-spec.ts` 用例④（本轮 T11 刚改过的断言）。
3. `PRUDENTIAL_BREACH` 的"立即通知"这一步落哪：继续走事故侧单槽，还是波二一落地就切工单（见上文"PRUDENTIAL 联动位"）。
4. 受文机构目录（VARA / UAE FIU / EOCN / Data Office / CBUAE）与波一 `INCIDENT_REPORT_BASES` 目录的"受文机构"信息（目前只在 `label` 文本里带，非结构化字段）是否要打通——波二工单类型目录若要结构化存受文机构，波一这七条码要不要补一个 `authority` 字段一并回填。
5. 事件中心↔报送台联动的触发点：事故 `assess()` 时勾"需要监管通报"，是同步自动开工单，还是仍由人工在事故详情页手动发起（对应总纲"事件勾需通报→自动开工单"这句要落成什么交互）。

## 0. 本波做 / 不做

已展开——2026-09-26 波二开工会话与业主脑暴定案（三刀：岔口②＝甲统一工单 ｜ 合规官经办 + 高管签发 ｜ 设计稿八节通过），见 `2026-09-26-campaign-a-wave2-regulatory-filing-spec.md` §0；本骨架五条待定岔口的处置对照该 spec §14。
