# 波五 · 投诉 + 战役收官 · 骨架

> 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波五「投诉 + 战役收官」；波四 spec：`2026-09-27-campaign-a-wave4-clockwall-calendar-registers-spec.md`；波四骨架：`2026-09-26-campaign-a-wave4-skeleton.md`（含脑暴裁定台账先例）
> 本文件只是**骨架**——链总纲 + 承接上一波 + 已定事实 + 待定岔口，**不展开波五 spec**（按 CLAUDE.md §6：spec 只写细当前波，下一波的展开是下一波新会话读总纲 + 本骨架后跟业主脑暴的活，收尾会话不代做）。spec/plan 归档**不做**（合并 main 时按惯例做，本骨架先注明）。

## 承接上一波（波四收尾时填写，2026-09-27）

- **波四合并基线**：本波（分支 `worktree-act-a-wave4`）自 T1-T10 全部主线提交线性生长（`git log --oneline <波三收官>..<波四收官>` 含骨架/spec/plan 三件套、T1-T10 主线、T6/T8 两轮评审修复、T9 截图重截修复、T10 文档收口一笔）；收官提交即快进目标，合并后 main HEAD 应等于分支 HEAD（下一波开工先 `git log main -1` 核实，若业主尚未合并则显式指向本分支读波四版文档）。
- **波四实际交付**：闹钟墙（`GET /admin/compliance-office/clock-wall` 只读聚合，零新表，FILING+OBLIGATION 两 kind 归一）；合规日历（新主体 `ComplianceObligation`，`compliance_obligations` 表，`ComplianceObligationSweepService` 30 秒 @Cron 到期生成，一期一单、翻期在生成时，触发判据 `addBusinessDays(now,leadBusinessDays)>=nextDueAt`）；类型目录 11→**12 行**（新增 `PERIODIC_RETURN`，`family=GENERAL`/`anchorKind=EXTERNAL`/`deadlineBusinessDays=0`，走既有六态六边全弧不新增边不新增审批类型）；两本登记册（`OutsourcingVendor`/`ResponsibleIndividual`，`outsourcing_vendors`/`responsible_individuals` 两表）；RI 换人事前审批（新审批类型 `RI_REPLACEMENT`，合规官提、高管单步批 48h 可撤，照 `SANCTION_DISPOSITION` 先例）；RBAC 新域 `Compliance Office` 四桶，**14→15 域、69→73 桶、77→81 组**；⚡ 两条新演示装置（`simulate-deadline-timeout`/`simulate-due`，挂既有 `DEMO_CLOCK_WRITE`）；审计现役码全量目录 273→**286**（GOVERNANCE 20→33，新增十三码）；种子三义务/三 vendor/四 RI 席位；`verify:rbac` 净增 S11a/b/c 静态判据 + 9 项行为探针，既有红集与波前基线恒等（`S7`/`BACKLOG:234`）零新增；场景 21/22（暂编）全程实走，十张截图入 `superpowers/checkups/2026-09-27-act-a-wave4-evidence/`。详见 `modules/compliance-office.md`（新篇）、`modules/v9-regulatory-filing.md` §2.1、`modules/overview.md` §4。
- **实际偏差**：
  ① **裁定 10（对内周期义务全砍）**——骨架原设想的 MLRO 季报/EWRA/年费三条对内周期义务，波四脑暴当场调研坐实收件方均非监管（MLRO 季报对董事会、EWRA 对内自评、年费是缴费非申报），按总纲 §2 覆盖判据改判「纯组织制度不建」，与内幕名单同判；`outlet` 字段拆分设计随之取消，义务台账只装对外申报三行。**净效果**：骨架当初预留的"日历周期义务台账"范围比设想窄——只剩 VARA 月/季/年三层申报一件事，不是"对内对外都管"。
  ② **R1/R3（RI 换人接口形状）**——落地时把「合规官提单」与「高管批准落地」拆成两个方法（`initiateReplacement`/`applyReplacement`），`applyReplacement` 携带完整 dto（值来自审批载荷 `objectSnapshot`），不是骨架设想的单一大方法；`ri-replacement-workflow.service.ts` 只编排、零自己的审计写入，三个落地动作（PROPOSED/APPLIED/REJECTED）审计全部收在 `ResponsibleIndividualsService` 内部——这个形状照 `sanction-disposition-workflow.service.ts` 先例，但落地时才最终确认。
  ③ **R5（审计展示级字段镜像进 metadata）**——T8 评审发现波四新写点的 `fromIncumbent`/`toIncumbent`/`frequency`/`dueAt` 等字段只在写入时供 `assertActionSpec` 校验必填、不落任何持久化列，审计详情页查不到；已全部镜像进 `metadata`（`extra` 校验形态保留不动）。**波二遗留的 `FILING_OVERDUE_MARKED` 未同步修**，与本波新写点处理方式不对称，已登 `BACKLOG.md`，非本波范围。
  ④ **模块挂载点**——新模块 `governance/compliance-office/` 挂 `governance.module.ts`（仓库既有惯例：治理域子模块统一挂同一个顶层 module，不新起顶层模块），骨架未预判挂载点这层细节，落地时照既有形状办。
  ⑤ **goAML/EOCN 注册续期负面结论已出清**（骨架待定岔口未点名此项，是 spec §9 调研的副产品）——查无周期续期义务，总纲 §3 波四行「goAML/EOCN 注册位」按证据落空处理，不入种子。
  ⑥ **EWRA「年度」假设被推翻**——行业惯例假设 EWRA 是年度自评，调研坐实 VARA CRM Rule III.D 明文「不超过每 3 个月」，与裁定 10 一并改判不建（该数字假设错误本身留档备查，不影响裁定 10 的判断依据——判断依据是「收件方非监管」，与频率数字无关）。
- **悬挂项**（波五开工前应先处理或确认，不能带着假设直接展开波五 spec）：
  ① **业主侧**：本地拉取合并后 main 必做三件套（重启后端 + `db:base:sync` + `stack.sh reset main`，权限字典/内存定义/schema+seed 均改动过）；给同事看新版走 `npm run cloud:deploy`。
  ② **HRCA 官方名业主一手核**（波三 T1 评审白项遗留，本波沿用二手多源交叉结论，未见 goAML/EOCN 一手材料）——仍未销账，继续悬挂。
  ③ **EOCN TFS Guidelines 2025 原文建议存 `reference/`**（CNMR 更名出处钉一手；此前云容器网络策略拦截 `uaeiec.gov.ae` 未能下载存档）——仍未销账，继续悬挂。
  ④ 云环境 setup script 加一行安装 TigerBeetle（本波在自有 worktree 本地跑，未触及该悬挂项，状态不变）。

## 已定事实（波五可以直接假设成立、不必重新论证）

- **闹钟墙的聚合读模型形态已验证成立**：只读聚合端点（不新起持久化读模型、不建物化视图）横向读两张既有表的 `deadlineAt`/`nextDueAt` 列即可支撑三色倒计时看板。波五若要把投诉时钟（确认 1 周 / 裁决 4 周，例外 8 周）也挂上闹钟墙，大概率可以直接复用同一个聚合端点、加一个 `kind='COMPLAINT'` 分支，不需要另起机制——但复用前先验证投诉主体是否也有一个天然的「唯一截止时间戳」字段可读（闹钟墙目前只认 `deadlineAt`/`nextDueAt` 两种命名，投诉的字段名与语义需要先核对，不要假设「加一行就行」直接写 plan）。
- **「类型/义务台账加行不动骨架」的边界已摸清**：波三验证了 AML 报文族六类型塞进既有四边迁移表可行，波四验证了「周期到期」这种新语义（重复开单）可以住在**上游主体**（义务台账）而不需要改动**下游报送单**主体本身（`PERIODIC_RETURN` 只是加一行类型 + 一个新的 `anchorKind=EXTERNAL` 调用方）。这个模式（新语义养在触发侧、被触发侧只加行）如果波五「投诉升级=转事件」也是类似形状（投诉侧触发、事件侧只需接收），可以参考，但**不要预先假设一定同构**——投诉升级涉及新建一个事件（不是像 `PERIODIC_RETURN` 那样开一张新单，两者对下游主体的接口形状可能不同，需要先看事件登记的 API 契约。
- **事前审批「提单方≠裁决方」分权模式已有第三个先例**：`SANCTION_DISPOSITION`（合规官提/MLRO批）、`RI_REPLACEMENT`（合规官提/高管批）两个先例都是「路由共享 + 单一裁决角色」，不需要 `cap.*` 服务层族独占（因为提单方只有一个角色）。投诉工作流如果也有「受理人提、审核人批」的结构，可直接照此形状注册审批类型，不必重新设计。
- **⚡ 拨钟机制的门控交叉现象已有实证先例**：波四发现「合规官持 `COMPLIANCE_OFFICE_VIEW` 但不持 `DEMO_CLOCK_WRITE`、金库持 `DEMO_CLOCK_WRITE` 但不持 `COMPLIANCE_OFFICE_VIEW`」，导致现场演示 ⚡ 必须切超管账号——这不是缺陷，是真实 RBAC 交叉产物。波五若投诉钟也要挂 ⚡，先检查是否会重演同款交叉（投诉受理人是否持有 `DEMO_CLOCK_WRITE`），提前想好演示话术，不要临场发现才现编。
- **`COMPLAINT_ESCALATION` 事故类型已在波一占位、未启用**（`overview.md` §4 Incident Register 域行有记录）——波五「升级出口=转事件」这条边落地时，目标事件类型已经在代码里存在一个键位，不需要再新增事故类型枚举，只需要：① 启用它（`enabled:true` 或等价开关）；② 决定谁能登记这一类型、结案走哪条审批链（四条既有链——安全/财务/技安/审慎——里挑一条，还是要开第五条，需业主脑暴定）。

## 待定岔口（骨架级列出，不展开 spec）

1. **投诉字段模型对撞点**（总纲 §5 岔口⑥，2026-09-25 已评估但未拍板）：外来包（`checkups/2026-09-25-raymond-stage4-intake-assessment.md` 评估结论=乙案，代码不融合只收编设计）的投诉流程用「escalate 走系统外文案」（升级时只是改一段状态说明文字，不产生新的系统对象）；本仓总纲 §0 的既定设计是「升级出口=转事件」（升级产生一个真实的新事件、走事件的完整生命周期）。两案对下游数据模型、审计留痕形状、闹钟墙挂钟方式都不一样——这是波五 spec 开工必须先决的真岔口，不能带着任一假设直接写 plan。
2. **投诉工作流的四段生命周期与三段留档**：总纲原文「受理 → 确认（≤1 周）→ 调查 → 裁决（≤4 周，例外 ≤8 周且第 4 周状态更新）→ 投诉/措施/结果三段留档」——这条时钟需要挂闹钟墙（本波新装置可直接复用，见「已定事实」）；但「例外 ≤8 周且第 4 周状态更新」这个分支的状态机边如何显式化（是否需要一个「已延期」中间态、第 4 周更新是否算一条强制的往来记录），骨架级未定。
3. **新幕编号与剧本位置**（总纲 §5 假设⑤，业主待明确）：七幕主线之后新增第八幕，还是把「异常与监管」整条线（事件扩景 + 报送台 + 合规办公室 + 投诉）并入既有幕次？场景 21/22（本波暂编）与场景 19/20（波三暂编）的最终编号都悬在这个决定上——波五收官时一次性定稿，不要提前散乱编号。
4. **投诉登记权限**：客户端提交入口对应管理台侧谁来受理/调查/裁决——是复用事故域五族经办组里的某一族（如运营或合规官），还是投诉本身需要一个新的独立经办角色？总纲未点名，需业主脑暴。
5. **战役终闸四条主线剧本的最终验收范围**（总纲 §7）：「网安事件→72h 双钟→上报工单→回执→结案」「制裁命中→24h 冻结→CNMR→回执」「可疑→MLRO 研判→STR→tipping-off 门」「投诉→超时→升级事件」——第四条依赖岔口 1/2/3 先决，波五 spec 排期需把这条放在最后展开。

## spec 开工核对项（依据码「不杜撰」铁律，先核后铸码）

- 投诉受理/确认/裁决三个时限（1 周/4 周/8 周）总纲已给出具体数字，来源未经二次核实（不同于波四 §9 那种二手多源交叉调研）——spec 开工先确认这三个数字的依据条款（VARA CRM Rulebook 投诉处理相关条款号），照波三/波四先例走二手多源交叉 + 业主过目，不杜撰未核实的依据条款号。
- 投诉工作流若涉及客户端新增提交入口，需要与 `rules/frontend-client.md` 的 UI 契约核对，波五范围首次触及 client-web（本波与波四均只动 admin-web）。
