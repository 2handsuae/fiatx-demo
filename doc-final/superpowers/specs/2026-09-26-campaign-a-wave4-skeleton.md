# 波四 · 闹钟墙·日历·登记册 · 骨架

> 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波四「闹钟墙·日历·登记册」；波三 spec：`2026-09-26-campaign-a-wave3-aml-reporting-family-spec.md`；波三骨架：`2026-09-26-campaign-a-wave3-skeleton.md`（含脑暴裁定台账）
> 本文件只是**骨架**——链总纲 + 承接上一波 + 已定事实 + 待定岔口，**不展开波四 spec**（按 CLAUDE.md §6：spec 只写细当前波，下一波的展开是下一波新会话读总纲 + 本骨架后跟业主脑暴的活，收尾会话不代做）。spec/plan 归档**不做**（合并 main 时按惯例做，本骨架先注明）。

## 承接上一波（波三收尾时填写，2026-09-26）

- **波三合并基线**：本波尚未合并 main（收尾闸未跑通，见下方悬挂项）；分支 `claude/vibrant-dirac-73kwrs`，`git log --oneline 8f2b51f..HEAD`（8f2b51f=波三 plan checklist 复核提交，作执行段 diff 基线；波二收官在 main 为 `44b1639`）共 **20 笔提交**（T1-T10 主线 + T3/T4 评审修复 + 随记 + T11 收口两笔 + 终审修一笔——终审白2 订正计数）。main HEAD 仍是波二收官的 `44b1639`，本波尚未线性快进合入。
- **波三实际交付**：类型目录从五行扩到**十一行**（GENERAL 五行不动 + AML 六行新增：STR/SAR/CNMR/PNMR/HRC/HRCA）；`FilingTypeConfig` 新增四维度——`family:'GENERAL'|'AML'`（服务层按族独占判据）、`anchorKind:'BASIS'|'RECEIVED_AT'|'EXTERNAL'|'NONE'`（钟起算点四值穷举，`EXTERNAL` 为波三新增——workflow 显式外传 `anchorAt`）、`deadlineBusinessDays`（工作日制钟，与小时制 `defaultHours` 互斥）、`allowNoFilingClose`/`requiresExternalCaseRef`；族边集从单表改**两张显式表**（`FILING_TRANSITIONS_BY_FAMILY`，波二遗留的单表别名 `FILING_TRANSITIONS` 已物理删除）——GENERAL 六态六边不动，AML 四边（`DRAFT→SUBMITTED/CLOSED/CANCELLED`、`SUBMITTED→CLOSED`，不经过 `PENDING_SIGNOFF`/`SIGNED_OFF` 两态）；新增工作日钟纯函数 `addBusinessDays`（迪拜日历判周末，`business-days.ts`）；服务层按族独占能力码 `cap.filing.general`/`cap.filing.aml`（照 `cap.incident.*`/Ruling-6 先例）；`RegulatoryFilingService` 新增 `closeNoFiling()`/`openForSanction()` 两方法 + 新端点 `close-no-filing`；审计名册十码→**十一码**（新增 `FILING_CLOSED_NO_FILING`）。制裁定性裁决 `SANCTION_DISPOSITION` 审批类型（合规官提、MLRO 单步批）+ 三出口 workflow（CLEARED 直调解除 / PARTIAL 开 PNMR+自动补料 / CONFIRMED 便签翻牌+开 CNMR）；限制因由扩到 **8 条**（新增 `SANCTION_CONFIRMED`，DISCLOSED/customerLevel=true）。往来记录新增两种 kind（`CUSTOMER_COMM`/`AUTHORITY_INSTRUCTION`，仅 AML 族、非终态可记，态限查 `FILING_ENTRY_KIND_RULES` 显式表）。RBAC `Regulatory Filings` 域加第三桶 `filings.aml-desk`（`REG_FILING_AML_WRITE`，MLRO 独占，14 域 **69 桶 77 组**）；⚡ 新路由 `POST /admin/sumsub/simulate/eocn-sanctions-hit`。审计词表全量 269→**273** 现役码（GOVERNANCE 20 / CUSTOMER 29）。e2e：新 `aml-reporting-family.e2e-spec.ts` 21 条六段全绿 + 波二 `regulatory-filing.e2e-spec.ts` 回归复绿；前端报送台按族渲染 / 定性弹窗 / ⚡ 入口 / 客户端横幅；种子四组（STR/PNMR/CNMR 已提交样例 + 一名 PARTIAL 在途客户）+ 场景 19/20（暂编）。详见 `modules/v9-regulatory-filing.md`、`modules/v2-customer-compliance.md`。
- **实际偏差**：
  ① MLRO 角色定位业主改判——骨架立档时的首版提案是「合规官经办、MLRO 签发」，脑暴阶段被推翻为「MLRO 亲办全程、无签发链」；已在 spec/plan 定稿阶段吸收，未构成执行期返工。
  ② **T4 提交信息与代码实际形状不符**：T4 提交信息称「CONFIRMED 出口两便签翻牌与开 CNMR 单同一事务原子落地」，T11 复核代码坐实——两便签翻牌确实在同一 `prisma.$transaction` 内，但紧随其后的 CNMR 开单调用在事务之外，存在「便签已翻、单未开」的半落地窗口。T11 已按代码真实形状订正 `modules/v9-regulatory-filing.md` 文档表述，并记入 `PRODUCTION-NOTES.md`（技术兜底一律记账不修，CLAUDE.md §2）。
  ③ T9 前端截图走查因容器无 TigerBeetle 二进制未能执行——环境限制，非代码缺陷。
  ④ 收尾闸⑥⑧、`demo:all`、`verify:rbac` 行为探针、场景 19/20 现场走查均未能在本容器验证，全部转本地待跑。
- **悬挂项**（波四开工前应先处理或确认，不能带着假设直接展开波四 spec）：
  ① T9 四组截图待补（容器无 TigerBeetle，出站策略同时拒 `tigerbeetle.com`/`github`，无法离线补装二进制）。
  ② 收尾闸⑥⑧ + `demo:all` + 场景 19/20 现场走查 + `verify:rbac` 行为探针 = 本地必跑（T10 报告的四条清单，T11 收尾时仍未验证）。
  ③ 合并进 main 后必做 `db:base:sync` + 重启后端（权限字典与内存 `RBAC_PERMISSION_DEFINITIONS` 都是旧的会 403，CLAUDE.md §10 惯例）。
  ④ HRCA 官方名业主一手核（T1 评审白项 6——本波沿用二手多源交叉结论，未见 goAML/EOCN 一手材料）。
  ⑤ EOCN TFS Guidelines 2025 原文建议存 `reference/`（CNMR 更名出处钉一手；本会话网络策略拦截 `uaeiec.gov.ae`，未能下载存档）。
  ⑥ `incident-register.e2e-spec.ts` 的 `treasury()` 直调报送台预计撞族门 403（未验证预测——静态读码发现该测试用非真实角色绑定的 `treasury()` 直调 `filings.saveDraft/submitForSignoff/markSubmitted`，大概率撞上 T3 新增的 `cap.filing.general` 服务层族门；因容器无 TigerBeetle 该 suite 根本跑不到 `beforeAll` 之后，**本波未能验证也未代修**，见 `TOOLING-DEBT.md` 对应条目，需回本地栈确认+补丁）。
  ⑦ 本 T11 文档收口尚未合并 main——波四新会话若从 main 起，读到的 `modules/` 仍是波二版本；需先确认本分支（或其收口的等价提交）已合并，或显式指向本分支读取波三版文档。

## 已定事实（波四可以直接假设成立、不必重新论证）

- **类型目录三新维度与 deadline/超时软标机制可直接复用**：波四「闹钟墙」要做的倒计时看板，读的就是 `regulatory_filings.deadlineAt` 这一列——钟锚算法（`BASIS`/`RECEIVED_AT`/`EXTERNAL`/`NONE` 四值穷举）已经把「这张单有没有钟、钟从哪起算」在波二、波三两波做穷尽了，波四不需要再发明新的锚类型，只需读取 `deadlineAt` 渲染倒计时+超时变色；超时软标机制（`regulatory-filing-sweep.service.ts`，@Cron 30 秒，写 `overdueMarkedAt`）现成，闹钟墙的「超时标红」直接读这个既有字段，不需要另起一套超时判定。
- **工作日钟函数现成**：`business-days.ts → addBusinessDays`（迪拜日历判周末，已用四时区矩阵单测坐实）是纯函数、零 Nest/Prisma 依赖，波四若要做「合规日历」的周期义务台账（月/季/年申报），可直接复用它算下一个到期工作日，不需要重新写一套时区处理。
- **⚡ 拨钟机制已在**（对账域 `DEMO_CLOCK_WRITE`），波四「⚡ 拨钟联动演超时升级」可复用这条既有装置，不需要新造。
- **「类型加行不动骨架」对 AML 族已验证成立，但不能预先假设对周期义务类型同样成立**：波三坐实了六个新类型全部塞进四边迁移表+四种锚，波四如果要新增「月度/季度/年度申报」这类周期义务，大概率也能直接加行；但周期义务的「重复开单」语义（每期一次）与现有「一次性开单」语义不同，是否需要新机制，波四 spec 开工必须先验证，不能带着「加行即可」的假设直接写 plan（与波三骨架当初对 STR/CNMR/PNMR 的警告同款教训）。
- **MLRO 无签发链、`cap.filing.*` 族独占能力码机制可作先例参考**：若波四「三本登记册」（外包商/内幕名单/关键人员 RI，含 RI 更换事前审批）里有类似「某角色独占经办、另一角色独占裁决」的分权需求，可参考 `cap.filing.*`/`cap.incident.*` 这两个既有先例的形状（共享路由+服务层按族/类型独占），不必重新设计分权模式。
- **tipping-off 登记本的「非终态可追加、按 kind 查显式规则表」模式已验证可行**：`FILING_ENTRY_KIND_RULES` 这张显式表（哪族能用/态限是什么/要不要额外字段）的写法，波四若需要给登记册类主体设计「往来记录」，可直接参考同款结构，不写散 if。

## 待定岔口（骨架级列出，不展开 spec）

1. **闹钟墙的数据源形态**：新起一张「跨主体统一倒计时读模型」（横向只读事故域 `Incident`/报送台 `RegulatoryFiling` 两个主体各自的 `deadlineAt`），还是各自详情页自带倒计时组件、闹钟墙只是一个跨页面的聚合列表？决定了闹钟墙是不是要新造一个读模型服务，还是纯前端聚合两个既有列表接口。
2. **合规日历周期义务台账的生成机制**：月/季/年申报到期生成待办工单——「到期」这件事由谁触发（cron 定时生成，还是像事故通报一样「手工登记周期义务清单 + cron 按当前时钟比对」）？生成的「待办工单」是复用 `RegulatoryFiling` 主体（新增方向或字段），还是另起一个轻量主体？
3. **三本登记册的主体形态**：外包商（Material Outsourcing）、内幕名单、关键人员（RI）是同一个主体的三种类型，还是三个独立主体？RI 更换事前审批的审批策略 maker/checker 各挂哪个角色？
4. **RI 更换审批与既有 IAM 角色绑定变更审批的边界**：关键人员（Responsible Individual）是 VARA 监管概念，与内部 RBAC 角色定义/绑定是两回事——需要先厘清这条边界，不要想当然复用 IAM 审批链的形状。
5. **闹钟墙 v1「只看板不推送」是否维持**（总纲 §5 假设④，业主可推翻）：若推翻，通知地基（丙战役范围）需要提前，波四范围会因此扩大——这是波四开工前需要业主明确的一句话。
6. **HRC/HRCA 的 3 工作日 FIU 不反对窗是否收进闹钟墙**：波三台账只记「报了没有」、不建钟（交易 HOLD 边移交三域细化），波四是否要把这个窗口也做成闹钟墙上的一格，还是继续维持台账面 only？

## spec 开工核对项（依据码「不杜撰」铁律，先核后铸码）

沿用波三口径：闹钟墙/合规日历涉及的周期申报法定时限（月/季/年）、三本登记册的法定字段与保存期限，均需业主一手核对或二手多源交叉，本骨架不预先杜撰任何具体数字。
