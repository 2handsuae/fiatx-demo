# 甲波六 · 服务商与 LP 的背调与审批 — 设计稿

日期 2026-10-28 ｜ 状态：**业主 2026-10-29 批准**（施工检查 7 问全部由作者裁定，见各节「我的判断」）｜ plan：`doc-final/superpowers/plans/2026-10-28-partner-due-diligence.md` ｜ 战役甲新增一波
归属：战役甲（业主 2026-10-28 定义：**甲 = 把所有外部关联方准备好；乙 = 交易与订单**）。甲的总纲 `2026-09-25-campaign-a-incident-regulatory-charter.md` 仍在本目录（五波收官但未归档），本波收尾时往总纲补一节「波六」；本稿自带波级边界，不翻总纲前五波的裁定。

---

## 0. 一句话

今天签一家 LP 是「金库填个名字 + 机器自动筛一下 + CFO 点一下」，登记一家外包服务商是「合规官自己在册子上写一行」。两条都没有**尽调**——没人收材料、没人逐名筛查、没人定风险档、没人为这个结论签字担责。本波把两条线改成同一个骨架：**业务申请 → 合规评估 → 高管 / CFO 审批**，材料上传并留存在系统里，重大外包还要过 VARA 事前报备门。

演示从「金库想签一家新 LP」开始。

---

## 1. 本波做 / 不做

### 做

| # | 内容 | 对应 |
|---|---|---|
| 1 | LP 申请表扩成完整尽调申请：字段 + 六份文件上传 | §4.1 |
| 2 | 服务商改为**运营申请**（不再是合规官直接登记），字段含 VARA IV.C.2.b 要求的四项（交付地 / 数据存放地、涉个人数据、涉机密信息、联系人）+ 重大性自判 | §5.1–5.2 |
| 3 | 合规评估：逐名筛查记录（公司 + 每位实际控制人）、风险档、意见、附加条件；退回补料 / 不通过 / 通过并送审 | §4.2 / §5.3 |
| 4 | 重大服务商加 CISO 信息安全评估 | §5.3 |
| 5 | 审批按档分流：低 / 中风险 LP 与一般服务商 CFO 单步；高风险 LP 与重大服务商 CFO → 高管两步 | §8 |
| 6 | 重大服务商批准后落「待报备」，自动开「重大变更告知」草稿单，合规官签发后才 ACTIVE；终止重大服务商也自动开告知单但不卡终止 | §5.5 |
| 7 | 系统**第一次**存文件：申请材料、筛查证据截图 | §6 |
| 8 | 退役 LP 建档时的 mock 自动筛查与 RED 自动拒 | §2 |
| 9 | 存量种子（两家 LP、三家服务商）按「已走完全流程」重铺 | §10 |
| 10 | 四幕演示剧目 | §10 |

### 不做（对照 CLAUDE.md §2 与本次脑暴拍板）

| 不做 | 原因 / 去向 |
|---|---|
| 定期复审（下次复审日字段、到期提醒、重评、过期拦截、⚡拨钟） | 业主 2026-10-28 拍板：**整体不进本波**，之后专门找一个战役做所有复审 → `BACKLOG.md` 「合作方复审专项战役」行 |
| LP 交易额度上限（批准时填、开单时拦） | 业主 2026-10-28 拍板：**不要上限，走审批就完了**。否决，收尾写进 `decisions.md` |
| 自动筛查（对接 Sumsub KYB / OpenSanctions） | 业主 2026-10-28 选乙案：合规官人工筛查、系统只登记结果——非 applicant 如何提交 Sumsub 未定；2026-10-24 裁定 ③「LP 不建 Sumsub applicant」不变 |
| VARA 对报备提出反对的分支 | 演不出来，无剧目 |
| 告知单被撤销 / 驳回时服务商状态回退 | 单人顺序操作不触发；技术兜底 |
| 文件病毒扫描、版本、去重、断点续传 | 技术兜底 |
| 任何「人身」四眼规则（评估人 ≠ 申请人、CISO ≠ 申请人之类）的代码硬拦 | 角色分工（运营 / 金库申请、合规评估、CFO / 高管批）已由 RBAC 天然隔开；审批引擎自带的「提单人 ≠ 批准人」照旧。种子里的超管号一人演完全程是允许的 |
| 服务商的分包商自身尽调、合同条款检查清单（VARA IV.D / IV.E） | 分包只记名单；合同只上传不逐条核 |
| 第三方银行（Zand）任何动作 | 不是外包商，是客户资金第三方银行；银行门 2026-10-03 分诊已出局 |
| 站内通知 / 邮件 | 归 `BACKLOG.md` 管理台站内通知一揽子 |
| 闹钟墙新增条目 | 复审不做，无到期物可挂 |

---

## 2. 承接记录（本波改掉的旧裁定与旧物）

| 旧物 | 处置 |
|---|---|
| 2026-10-24 裁定 ②「LP 实体背调 = mock 三档（制裁→红、离岸→黄）」 | **退役**。`screenLpEntityName` 及其唯一调用点删除；`liquidity_providers.screeningAnswer / screenedAt` 两列删除；筛查改为合规官逐名人工登记（§4.2） |
| 2026-10-24 裁定 ①「CFO 单步」 | **部分保留**：低 / 中风险仍 CFO 单步；高风险加高管第二步（§8） |
| LP `dueDiligenceRef`（自由文本的尽调档案引用号） | **退役**。尽调档案成了系统内主体（§3 的「尽调评估」），LP 详情页直接链过去 |
| `reference/sumsub-mock-touchpoints.md` 第 ⑨ 行「实体背调」 | 改为「人工登记，无外部服务」（该行 2026-10-24 已预告此可能） |
| `BACKLOG.md:514`「外包商册登记 / 终止是否联动告知单」岔口 | **本波解决**：登记联动 + 终止联动，见 §5.5 |
| `BACKLOG.md:519`「外包供应商尽调流程（入册门 + 年审）」 | 入册门半边本波做；年审半边已并入「合作方复审专项战役」行 |
| 合规官的 `VENDOR_REGISTER_WRITE` 直接增改 | **退役增改**，只留终止（§8） |
| 种子 Falcon `GREEN / screenedAt` | 重铺成合规官登记的筛查记录（§10） |
| `demo/script.md` 场景 22（外包商册）、场景 36（LP 建档） | 按新流程重写（§10） |

---

## 3. 两条线的同一副骨架

```
                 业务申请              合规评估                    审批                  （重大服务商）报备
 LP：      金库填表+传六份文件  →  合规官逐名筛查/定档/意见  →  CFO（高风险：CFO→高管）  →  ACTIVE
 服务商：  运营填表+传材料      →  合规官同上 (+CISO 信息安全)  →  CFO（重大：CFO→高管）    →  待报备 → 合规官签发告知单 → ACTIVE
                                     ↘ 退回补料 / 不通过
```

**主体划分（铁律 ③「各管各的」）**

| 主体 | 归谁写 | 存什么 |
|---|---|---|
| LP 档案（既有 `liquidity_providers`） | LP 服务（金库线） | 申请字段、状态 |
| 服务商（既有 `outsourcing_vendors`） | 服务商服务 | 申请字段、重大性、状态 |
| **尽调评估**（新，合规办公室域，业务号前缀我的建议 `DDA`） | 合规办公室的尽调服务 | 评估对象（LP 或服务商 + 其业务号）、风险档、意见、附加条件、结论、CISO 信息安全评估；下挂**筛查记录**（逐名） |
| **文件**（新，横切） | 文件服务 | 文件元数据 + 磁盘上的内容（§6） |
| 审批单（既有引擎） | 审批引擎 | 四条策略（§8） |
| 报送单（既有报送台） | 报送台 | 自动开出的「重大变更告知」 |

**编排**：合规官在 LP / 服务商详情页点「退回 / 不通过 / 通过并送审」，打到**该线的 workflow**；workflow 先让尽调服务记结论，再让 LP / 服务商服务沿迁移表走一步、需要时开审批单。workflow 不直写任何表。

**筛查记录的硬规则（两线共用）**
- 任何一条筛查记录为**红**，评估结论只允许「不通过」；「通过并送审」按钮不出现，后端同样拒绝。
- **送审前提：公司名 + 每一位实际控制人各至少一条筛查记录**（我的判断——「逐名」是 §0 的论点，缺名就送审等于没逐名）。缺则按钮置灰并提示缺谁，后端同样拒绝。金库补料时增了人，新人要补筛；删了人，其记录留着、不再计入。
- **黄不自动绑任何东西**（我的判断）：黄是合规官定风险档、写附加条件的依据，不强制档位、不改审批路线。

**尽调评估的可写窗口**（我的判断，评估本身**不设状态列**、不另立迁移表——它的「能不能改」完全跟着所属 LP / 服务商的状态走）：对象在 `PENDING_ASSESSMENT` 或 `RETURNED` 时筛查记录、评估表单、CISO 评估可写；送审后锁定；审批撤单回 `PENDING_ASSESSMENT` 即解锁。结论与退回原因**覆盖**存最新一轮，往轮历史看审计时间线（每次结论落下都有审计，metadata 带结论、风险档、原因）。

---

## 4. LP 线

### 4.1 金库申请（Treasury → LP Register → Register LP）

| 组 | 字段 | 必填 |
|---|---|---|
| 这家是谁 | 法定名称 | 必 |
| | 注册地（国家 / 辖区） | 必 |
| | 注册号 | 必 |
| | 发牌机构 + 牌照号 | 必 |
| | 实际控制人（可多位；每位：序号 seq + 姓名 必 + 国籍 选）——**结构化条目**（plan 定为父行上的 JSON 列），筛查记录按 seq 指向具体某一位；对外以「LP 号 + 序号」指认，不露 UUID | 选 |
| 跟我们做什么 | 交易类型（现货兑换 / OTC 大宗 …，多选） | 必 |
| | 预计月交易量 + 币种 | 必 |
| | 申请理由 | 必 |
| 协议 | 协议编号 | 必 |
| | 协议起始日 | 选 |
| | 联系人 + 邮箱 | 必 |

**六份文件**（都可缺，缺了合规官可「退回补料」）：注册证书 ｜ 股东 / 实际控制人名册 ｜ 牌照副本 ｜ 反洗钱制度或问卷 ｜ 最近财报 ｜ 授权签字人名单。

提交后 LP 进 `PENDING_ASSESSMENT`（待评估），同时自动开一份尽调评估（空壳，挂在该 LP 上）。

### 4.2 合规评估（LP 详情页「合规评估」区块，`DUE_DILIGENCE_WRITE`）

**逐名筛查记录**：公司名 + 每一位实际控制人各一条，每条——
- 查了哪些名单（多选）：联合国 ｜ OFAC ｜ 欧盟 ｜ 阿联酋本地 ｜ PEP ｜ 负面新闻
- 结果：绿 / 黄 / 红
- 证据截图（文件上传，可缺）
- 筛查时间（默认当下，可改）

**评估**：风险档（低 / 中 / 高）｜ 评估意见（文本，必填）｜ 附加条件（文本，选填，例如「仅限 USDT/AED 现货」）

**动作**（互斥，三选一，写入结论）
- **退回补料**：必填退回原因 → LP 进 `RETURNED`；金库可改申请、补文件后「重新提交」→ 回 `PENDING_ASSESSMENT`，评估壳保留、筛查记录保留
- **不通过**：必填原因 → LP 进 `REJECTED`（终态）
- **通过并送审**：按风险档开审批单 → LP 进 `PENDING_APPROVAL`

### 4.3 审批

| 风险档 | 策略 | 步骤 |
|---|---|---|
| 低 / 中 | `LP_PROFILE_APPROVAL`（既有） | CFO 单步 |
| 高 | `LP_PROFILE_HIGH_RISK_APPROVAL`（新） | 第一步 CFO → 第二步高管（`SENIOR_MANAGEMENT_OFFICER`） |

**提单人 = 合规官**（我的判断）：点「通过并送审」的人就是审批单的 requester，审批理由取评估意见；撤单因此也是合规官（引擎只许提单人或超管撤）。`verify-rbac.ts:278` 的 `LP_PROFILE_APPROVAL: 'LP_WRITE'` 要改成 `DUE_DILIGENCE_WRITE`。

批准 → `ACTIVE`；驳回 → `REJECTED`；超时沿用引擎既有行为（→ `REJECTED`）；撤单回 `PENDING_ASSESSMENT`，评估壳保留并解锁。

### 4.4 状态机（目标终态，直接按此铺）

```
PENDING_ASSESSMENT --return--> RETURNED --resubmit--> PENDING_ASSESSMENT
PENDING_ASSESSMENT --reject(compliance)--> REJECTED
PENDING_ASSESSMENT --send_for_approval--> PENDING_APPROVAL
PENDING_APPROVAL --approve--> ACTIVE
PENDING_APPROVAL --reject(approval)--> REJECTED
PENDING_APPROVAL --cancel--> PENDING_ASSESSMENT
ACTIVE <--> SUSPENDED（既有，不动）
```

既有 LP 打款地址簿、LP 兑换单对「LP 必须 ACTIVE」的门不动。

---

## 5. 服务商线

### 5.1 运营申请（新页 Service Providers → Apply，`VENDOR_APPLY`）

| 组 | 字段 | 必填 |
|---|---|---|
| 这家是谁 | 法定名称 ｜ 注册地 ｜ 注册号 | 必 |
| | 服务交付地 / 数据存放地（国家，可多个） | 必 |
| | 联系人 + 邮箱 | 必 |
| | 实际控制人（可多位，子表条目，同 §4.1） | 选 |
| | 发牌机构 + 牌照号 | 选；「是否受监管职能」答是时**必填** |
| 外包什么 | 服务描述 | 必 |
| | 是否受监管职能（MLRO / CISO / DPO 等 VARA IV.A.3 允许外包的职能） | 必 |
| | 合同起始日 | 必 |
| | 合同终止日 | 选 |
| | 是否涉及个人数据 ｜ 是否涉及机密信息 | 必 |
| | 年费用 + 币种 | 选 |
| | 是否分包 + 分包商名单 | 选 |
| | 申请理由 | 必 |
| 重大性自判 | 断了会不会影响牌照合规？｜ 断了会不会影响其他法律义务？｜ 断了会不会影响财务表现？｜ 断了会不会影响核心业务连续性？（各答 会 / 不会） | 必 |
| | 换掉难不难（容易 / 困难） | 必 |

四问对应 VARA Schedule 1「关键或重要职能」定义 (a)–(d)；「换掉难不难」只供合规参考，不参与判定。

**材料**（可缺）：一般档 = 注册证书 ｜ 合同；受监管职能加牌照副本。重大档再加：实际控制人名册 ｜ 财报 ｜ SOC 2 / ISO 27001 证书 ｜ 灾备计划 ｜ 分包商名单 ｜ 保险单。

### 5.2 重大性判定（系统规则）

- 四问任一答「会」→ 系统判 **MATERIAL**，运营改不了。
- 四问全「不会」→ **NON_MATERIAL**；合规官评估时可**升**为 MATERIAL（必填理由），不可降。
- 判定结果在申请提交时落库，列表与详情可见。

### 5.3 合规评估 + CISO

合规评估与 §4.2 完全同款（同一个尽调评估主体、同一套筛查记录、同一个前端区块），**风险档照填**——但服务商的审批**只按重大性分流**（§5.4），风险档是合规判断的留痕；合规官认为风险高到该走两步的，用「升档为 MATERIAL（必填理由）」这条既有规则（§5.2），不另开 2×2 策略（我的判断）。

**重大服务商**多一段 **CISO 信息安全评估**（`INFOSEC_ASSESSMENT_WRITE`）：
- 证书核验（SOC 2 / ISO 27001 有 / 无 / 过期，各一项）
- 数据存放地可接受（是 / 否）
- 灾备计划可接受（是 / 否）
- 意见（文本，必填）
- **结论：可接受 / 不可接受**

**门**（我的判断，与红灯同款）：MATERIAL 且 CISO 评估未填 → 不能送审（按钮置灰提示「等 CISO」，后端拒）；CISO 结论「不可接受」→ 只能「不通过」，送审按钮不出现，后端拒。一般服务商无此段。

### 5.4 审批

| 档 | 策略 | 步骤 |
|---|---|---|
| NON_MATERIAL | `VENDOR_APPROVAL`（新） | CFO 单步 |
| MATERIAL | `VENDOR_MATERIAL_APPROVAL`（新） | CFO → 高管两步 |

### 5.5 VARA 事前报备门（只对 MATERIAL）

- 审批通过 → 服务商进 `PENDING_NOTIFICATION`（待报备），workflow 调报送台开一张 **`MATERIAL_CHANGE_NOTIFICATION`** 草稿单（照抄 RI 换人自动开单的路径，§12.C），正文预填：服务商名、服务范围、交付地 / 数据地、重大性判定、合同起始日。**关联方向**：报送单表没有 entityRef 列（RI 路径只靠标题 + 审计 metadata），本波不动报送单表，改由**服务商自己记 `notificationFilingNo`**（各管各的）。
- 合规官把这张单沿既有报送链走到 **`SUBMITTED`**（送签 → 签发审批 → mark-submitted 填 VARA 回执号）→ 服务商进 `ACTIVE`。触发机制：报送台今天在 mark-submitted 时**不发任何事件**（§12.C.3），本波给报送台加一条「报送单已报送」领域事件（登记进 `DOMAIN_EVENTS`，携 filingNo 与 filingType），服务商 workflow 监听、按 `notificationFilingNo` 认领。终止联动的那张单不认领（终止不等它）。
- NON_MATERIAL 审批通过 → 直接 `ACTIVE`。
- **终止**（合规官，`ACTIVE → TERMINATED`）：MATERIAL 的同时自动开一张告知单，**不卡终止**；一般的不开。
- 金库付款单对「服务商必须 ACTIVE」的既有门不动——`PENDING_NOTIFICATION` 的服务商付不了款，这正是报备门的演示点。

### 5.6 状态机（目标终态）

```
PENDING_ASSESSMENT --return--> RETURNED --resubmit--> PENDING_ASSESSMENT
PENDING_ASSESSMENT --reject(compliance)--> REJECTED
PENDING_ASSESSMENT --send_for_approval--> PENDING_APPROVAL
PENDING_APPROVAL --approve[NON_MATERIAL]--> ACTIVE
PENDING_APPROVAL --approve[MATERIAL]--> PENDING_NOTIFICATION
PENDING_APPROVAL --reject(approval)--> REJECTED
PENDING_APPROVAL --cancel--> PENDING_ASSESSMENT
PENDING_NOTIFICATION --notification_submitted--> ACTIVE
ACTIVE --terminate--> TERMINATED（既有）
```

---

## 6. 文件存储（系统首次，我的尺寸判断）

- **存哪**：栈的数据目录下 `files/`（主栈 `/tmp/exchange_js_main/files/`，worktree `/tmp/exchange_js_wt_<名>/files/`，与 `db-env.sh` 推 `DATABASE_URL` 的作用域同源；云端跟 SQLite 同在 systemd 的 `RuntimeDirectory` `/run/exchange-demo/files/`，服务重启即清，正合「每次启动从零铺数据」）。环境变量 `FILE_STORAGE_DIR`，由 `db-env.sh` 同路推导、`on-stack.sh` 一并注入、`deploy/demo.env.template` 渲染；`reset-stack.sh` 连目录一起清；种子脚本跑在 reset 里，也得拿到这个变量。
- **元数据表**（新主体「文件」，业务号前缀我的建议 `DOC`——`FIL` 已被报送单占用）：业务号、归属对象类型 + 业务号（LP / 服务商 / 筛查记录）、文件类别（按 §4.1 / §5.1 / §4.2 的清单枚举）、原文件名、MIME、大小、磁盘路径、上传人、上传时间。
- **限制**（我的判断）：PDF / PNG / JPG，单文件 ≤ 10 MB。超限直接报错，不做分片。
- **下载**：经后端接口按权限流式返回，前端不直链磁盘路径。
- **留痕**：上传写审计（`DOCUMENT_UPLOADED`，metadata 记归属对象与类别）；下载不留痕（非持久化动作）。
- **种子**：占位 PDF 由种子脚本当场生成（几百字节的合法 PDF），**不往仓库放二进制**。

---

## 7. 页面落点（业主 2026-10-28 同意）

| 页面 | 变化 |
|---|---|
| Treasury → LP Register | Register LP 表单扩成 §4.1 完整申请表 + 六份上传；列表加状态列与筛选（待评估 / 退回 / 待批 / ACTIVE / …） |
| Treasury → LP Register → 详情 | 新增三块：**尽调文件**（列表 + 下载）、**合规评估**（筛查记录表 + 评估表单 + 三个动作按钮）、**审批记录**（链到审批单）。既有打款地址、状态时间线不动 |
| Compliance Office → **Service Providers**（新页，从 Registers 的 Vendors tab 抬出来） | 列表（服务商号 / 名称 / 服务 / 重大性 / 状态 / 合同起止）+ 「Apply」按钮（运营）；详情页同 LP：申请资料、材料、合规评估、CISO 评估（仅 MATERIAL）、审批记录、报备单链接、终止按钮（合规官） |
| Compliance Office → Registers | 只剩 RI 一个 tab |
| Governance → Approvals / Regulatory Filings | 不改页面，只多四种审批单与一条自动来路 |
| **不建**统一「尽调队列」页 | 合规官用两张列表的状态筛选（我的判断，业主同意） |

侧栏对运营：Compliance Office 组下只露出 Service Providers 一项（组内按权限过滤是既有机制）。

---

## 8. 权限与审批策略

**新权限码**

| 码 | 持有 | 管什么 |
|---|---|---|
| `VENDOR_APPLY` | `OPS_OFFICER` | 申请服务商、补料重提 |
| `VENDOR_READ` | 合规官、CISO、CFO、高管、内审、金库、运营 | 服务商列表 / 详情读——**替换**既有两条 GET 的 `['COMPLIANCE_OFFICE_VIEW','FUNDING_WRITE']` OR 粗门（`rbac.catalog.ts:637-638`）。CFO 今天两者皆无（:1442-1472），而两步审批的每个批准人都必须读得到详情（S9），所以要一个明确的读组，不借 `COMPLIANCE_OFFICE_VIEW`（否则 S11c「恰为五角色」破） |
| `DUE_DILIGENCE_WRITE` | `COMPLIANCE_OFFICER` | 两线评估：筛查记录、评估表单、退回 / 不通过 / 送审、升档 |
| `INFOSEC_ASSESSMENT_WRITE` | `CISO` | 重大服务商信息安全评估 |

**既有码调整**

| 码 | 调整 |
|---|---|
| `VENDOR_REGISTER_WRITE`（合规官） | 路由上只留 terminate；register / update 路由退役 |
| `LP_READ` | 合规官已持有（:1437），不动；**高管补持**——高风险 LP 第二步是高管，S9 要求批准人读得到详情，今天高管不持（:1292-1313） |
| `LP_WRITE`（金库） | 新增 resubmit 路由归它 |

**`verify:rbac` 判据必动**（plan 逐条列）：S13d 的 `totalBuckets === 83 && declaredPermissionGroups.size === 92`（+4 组、+桶）；S13c「`LP_READ` 恰为 {金库, CFO, 内审, 合规官}」→ 加高管成五；S11a-c「合规办公室四组四处齐、写组唯合规官」——`VENDOR_APPLY`（运营持）与 `VENDOR_READ`（七角色持）都落在合规办公室域，判据口径要改；S5 / S5c / S8 的 `MAKER_GROUP_BY_POLICY` 加三条策略并把 `LP_PROFILE_APPROVAL` 的 maker 改成 `DUE_DILIGENCE_WRITE`；S9 的 `DETAIL_READ_GROUP_BY_POLICY` 加三条（LP 两条 → `LP_READ`，服务商两条 → `VENDOR_READ`）。

**审批策略（四条）**

| action type | 步骤 | 新 / 旧 |
|---|---|---|
| `LP_PROFILE_APPROVAL` | CFO | 旧，不动 |
| `LP_PROFILE_HIGH_RISK_APPROVAL` | CFO → `SENIOR_MANAGEMENT_OFFICER` | 新 |
| `VENDOR_APPROVAL` | CFO | 新 |
| `VENDOR_MATERIAL_APPROVAL` | CFO → `SENIOR_MANAGEMENT_OFFICER` | 新 |

两步策略引擎已支持（已有两条 `stepNo: 2` 的策略在用，§12.D），不新造机制。`verify:rbac` 判据数随之变，plan 里要列。

---

## 9. 审计（铁律 ①）

每条状态边一条审计，metadata 必写 `from / to`（判例）。事件清单（具体码名由施工方按既有命名定）：

- LP：申请提交、退回、重新提交、合规不通过、送审、批准、驳回、撤单
- 服务商：申请提交、退回、重新提交、合规不通过、送审、批准、驳回、撤单、**重大性升档**（记理由）、告知单自动开出、报备完成转 ACTIVE、终止（既有码）
- 尽调评估：评估开壳、筛查记录登记（记对象名、名单、结果）、CISO 评估登记、结论落下（记结论与风险档）
- 文件：上传

新码按名册登记（§12.E）。**不新建注册表对象**（新建要连改 `audit-logs.service` 的 `??` 链、闭合 spec 的「十八册」文案、`export-audit-vocab` 三处）：服务商与尽调评估的码进 `COMPLIANCE_OFFICE_AUDIT_ACTIONS`，LP 的码进 `CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS`，文件上传的码跟着尽调评估进合规办公室册（我的判断）。LP 侧退役 `LP_PROFILE_SCREENED`。

---

## 10. 种子重铺与演示剧目

### 存量（我的判断，不必业主拍）

| 实体 | 终态 | 配套 |
|---|---|---|
| Falcon Liquidity FZE（LP） | ACTIVE | 尽调评估（低风险、公司 + 1 位 UBO 两条绿记录）、六份占位 PDF、既有 CFO 审批单 |
| Dune OTC DMCC（LP） | SUSPENDED | 同上，中风险 |
| Sumsub（MATERIAL） | ACTIVE | 评估 + CISO 评估 + 两步审批单 + 一张已签发的历史告知单 |
| HexTrust（MATERIAL） | ACTIVE | 同上 |
| Gulf Office Systems（NON_MATERIAL） | ACTIVE | 评估 + 单步审批单 |

### 新增种子（供剧目用，公司名是我的占位，可改）

| 实体 | 铺到 | 用途 |
|---|---|---|
| Sable Crest Trading FZCO（LP） | `PENDING_ASSESSMENT`，文件已传，1 位 UBO | 第二幕「红灯」 |
| Pearl Clean Services LLC（服务商，NON_MATERIAL） | `PENDING_APPROVAL`，评估已做 | 第四幕「一般路」 |

### 四幕（写进 `demo/script.md`，编号 37–40，接在场景 36 之后；场景 22 / 36 原文按新流程重写）

37. **LP 顺路**：金库申请「Oryx Digital Markets Ltd」（占位名）传齐六份 → 合规官登记公司 + UBO 全绿、定低风险、通过并送审 → CFO 批 → ACTIVE → 回 LP Register 登记打款地址、开兑换单（接既有剧目）。
38. **LP 红灯**：合规官打开 Sable Crest，给 UBO 记一条 OFAC 红 → 「通过并送审」消失 → 只能「不通过」→ REJECTED。
39. **服务商重大路**：运营申请「Nimbus Cloud Hosting LLC」（占位名），四问答一个「会」→ 系统判重大 → 合规官评估 → CISO 填信息安全评估 → 合规官送审 → CFO 批 → 高管批 → 待报备 → 报送台里那张自动开出的告知单，合规官送签 → 签发审批 → mark-submitted 填回执号 → 服务商 ACTIVE → 金库建付款单可选它。**「被拦」怎么演**（我的判断）：付款单页的收款方下拉今天只列 ACTIVE（`VendorPaymentList.tsx:13` 前端过滤），待报备的根本不出现、碰不到后端门；本波改成下拉列出所有非 TERMINATED 服务商、非 ACTIVE 的**置灰并标状态**（如「待报备」），演示者先指一下置灰项再去报送台签发，回来它就能选了。
40. **服务商一般路**：CFO 直接批 Pearl Clean → ACTIVE，三十秒，对照「一般的不报备」。

`demo:all` 花名册只含客户订单（§12.G.3），LP / 服务商种子**不进花名册**；`demo/data.md` 手写上半篇的 LP 与付款单说明（:212、:264）按新种子改。

---

## 11. 留给施工方的

- 表名、列名、尽调评估与文件的业务号前缀（我的建议 `DDA` / `DOC`，撞号就换）
- 审计码的具体命名（按各域既有前缀）
- 前端：合规评估区块做成一个共用组件给两张详情页；筛查记录表与文件列表亦然
- 申请表的「实际控制人」多值字段怎么存（JSON 列或子表，施工方定）
- 筛查记录证据：一条记录最多一张截图（我的判断）
- 占位 PDF 的生成方式
- `module-parity` 一类既有一致性测试的适配
- 新种子的业务号与 `data.md` 口径
- 高风险 LP 两步审批是否需要在审批详情页做任何展示改动（引擎已支持两步，详情页 "Approval Steps" 区逐步渲染，预期零改）
- 审计页实体链接表 `admin-web/src/pages/auditEntityRoutes.ts` 今天没有 LP / 服务商条目（审计行里的业务号是纯文本）；加两条是顺手事，施工方定做不做
- 审批 CANCELLED 今天让 LP 停在 `PENDING_APPROVAL` 无边可走（§12.A.4）；本波按 §4.4 / §5.6 补 `cancel → PENDING_ASSESSMENT` 边，评估壳保留

---

## 12. 代码落点（2026-10-28 侦察事实，`文件:行` 以当日 `main` 为准）

### A. LP 档案
1. 表：`prisma/schema.prisma:925-943` `model LiquidityProvider`——字段 lpNo / name / agreementRef / status（默认 `PENDING_APPROVAL`）/ approvalNo? / **screeningAnswer? / screenedAt? / dueDiligenceRef?**（:932-934，本波删）/ createdByUserId。
2. 状态枚举 `src/modules/asset-treasury/lp-desk/dto/lp-profile.dto.ts:7-12`（四态）；迁移表 `lp-desk/constants/lp-profile-transitions.constant.ts:5-10`，形状 `Record<状态, 目标状态[]>`；校验 `lp-profile.service.ts:126-129`；**边→审计码映射** `:35-40` `ACTION_BY_EDGE`，完整性闸 `:135-141`（边没登记审计码抛 500）。
3. `lp-profile-workflow.service.ts#initiateCreate` :28-51：`:31` 调 `screenLpEntityName`（import :11）并传给 `profiles.create`；`:36-48` `ApprovalsService.createAndSubmit`，`:38` `LP_PROFILE_APPROVAL`；RED 自动拒在 `lp-profile.service.ts:93 / :102`，workflow `:32-34` 见 REJECTED 不开审批单。审计码写点 `lp-profile.service.ts:106 / :111 / :116`。mock 规则 `lp-entity-screening.mock.ts:9-13`。
4. 裁决回流：handler `lp-profile-approval.service.ts:12-18`（继承 `ApprovalHandlerBase`，workflowType `LP_PROFILE`，re-emit `workflow.lp-profile.decided`）；监听 `lp-profile-workflow.service.ts:67`，APPROVED→ACTIVE :76-78，DECLINED / EXPIRED→REJECTED :80-81，**CANCELLED :69 直接 return、无边**。
5. 审计码：平表 `audit-actions.constant.ts:499-505`（6 个）；四属性表 `CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS` :1268-1275；主体类型 `LIQUIDITY_PROVIDER` :41；workflowType :158；信封构造 `lp-profile.service.ts:163-192`。
6. 前端：路由 `App.tsx:251-252`（`LP_PROFILES_READ` / `LP_PROFILE_DETAIL_READ`，码值 `rbac/permissions.ts:95-97`）；`LpProfileList.tsx` 列 :176，Register 弹层 :22-112（Name / Agreement Ref / Due Diligence Ref / Reason），按钮门 `LP_PROFILE_CREATE` :117；`LpProfileDetail.tsx` 区块：横幅 :380-390、`Liquidity Provider` 卡 :394、`Entity Screening` 卡 :405（本波换成合规评估）、Payout Addresses :417、侧栏 Lifecycle :469。

### B. 服务商
1. 表 `schema.prisma:1967-1984`；状态与迁移 `compliance-office.constants.ts:56 / :60-63`（唯一一条边 ACTIVE→TERMINATED）。
2. `outsourcing-vendors.service.ts`：`findByNo` :47、`list` :55、`getView` :60、`assertActiveByNo` :67-72、`register` :87、`update` :113、`terminate` :129、`recordAudit` :147；`assertActiveByNo` 全仓唯一调用方 `company-funding/vendor-payment.service.ts:37`（搜法：字面 + `assertActive` / `ActiveBy` 变形，范围 src / scripts / test / prisma / admin-web）。
3. 控制器 `compliance-office.controller.ts` :110 / :117（GET）、:124（POST）、:132（PATCH）、:140（terminate）；RBAC `rbac.catalog.ts:637-638`（GET，OR 粗门）、:639-641（写，`VENDOR_REGISTER_WRITE`）；模块导出 `compliance-office.module.ts:28,34`。
4. 审计码平表 :478-480，四属性 `COMPLIANCE_OFFICE_AUDIT_ACTIONS` :1206-1208（REGISTERED 必填 `criticality`；TERMINATED 必填 fromStatus / toStatus）；写点 service :103 / :123 / :138；主体类型 `OUTSOURCING_VENDOR` :36、workflowType :153；e2e 断言 `test/compliance-office.e2e-spec.ts:251-253`。
5. `ComplianceRegistersPage.tsx`：`TABS` :590-593（`vendors` 默认 / `?tab=ri`）；Vendors 表列 :253；`VendorModal` :36-146；`TerminateVendorModal` :148；路由 `App.tsx:321`（`COMPLIANCE_OFFICE_VIEW`）。
6. 付款单 ACTIVE 门 `vendor-payment.service.ts:37`（在 `create` 内，执行阶段不复查）。

### C. RI 换人自动开告知单（本波照抄的路径）
1. `ri-replacement-workflow.service.ts:84` `@OnEvent(DOMAIN_EVENTS.RI_REPLACEMENT_DECIDED)` → 仅 APPROVED 且 `applyReplacement` 后（:95-99）调 `this.filings.openForRiChange(...)` :100-106；方法 `regulatory-filing.service.ts:590-615`：类型字符串键 `'MATERIAL_CHANGE_NOTIFICATION'`（注册 `filing-type-registry.ts:40`，前端镜像 `regulatoryFilingMap.ts:111`），初始 `DRAFT`，`createdByUserId: 'SYSTEM'`，`deadlineAt` null；**报送单表无 entityRef / riNo 列**（`schema.prisma:1900-1931`），只靠标题 :600 与 `FILING_OPENED` 审计 metadata :609。
2. 报送状态 `regulatory-filing.constants.ts:12-15`；GENERAL 族迁移 :20-34：DRAFT→PENDING_SIGNOFF（signoff :326-332）→ SIGNED_OFF（审批 APPROVED :342-343；拒 / 撤 / 超时回 DRAFT :350）→ SUBMITTED（mark-submitted :368，必填 externalRef :362）→ CLOSED（:453）；cancel→CANCELLED :462。
3. **报送单状态变更不发事件**：`emit` 在 `regulatory-filings/*.ts`（非 spec）只命中 import；`eventEmitter.emit|emitAsync` 全 src 无报送台命中；唯一事件是审批派生的 `workflow.regulatory-filing.decided`（`regulatory-filing-approval.service.ts:13-15`，自己监听 :79，未登记 `DOMAIN_EVENTS`，`domain-events.constants.ts:94` 注释承认）。→ 本波新增「已报送」事件见 §5.5。
4. 报送详情页 `RegulatoryFilingDetailPage.tsx`，路由 `App.tsx:310`；「送签」按钮 :340 → POST `/admin/regulatory-filings/:filingNo/signoff`（控制器 `regulatory-filings.controller.ts:76-82`）。

### D. 审批引擎（新增一个 action type 要动的 10 处，以 `LP_PROFILE_APPROVAL` 为样）
`approval.constants.ts:97`（常量）｜ `:460-462`（默认策略）｜ `:537`（`V1_APPROVAL_ACTION_TYPES` 白名单，不进则策略页不渲染，:528-536 有教训）｜ handler 类（`lp-profile-approval.service.ts:12-18`）+ 模块 provider（`lp-desk.module.ts:12,38`）｜ `@OnEvent` 监听（workflow :67）｜ `AuditBusinessWorkflowTypes`（`audit-actions.constant.ts:158`，事件名按 kebab 派生 `approval-handler.base.ts:30-33`）｜ `ApprovalPoliciesPage.tsx:80` 显示名 ｜ `approvalEntityRoutes.ts:72` 实体路由 ｜ `scripts/verify-rbac.ts:278` `MAKER_GROUP_BY_POLICY` ｜ `scripts/verify-rbac.tables.ts:66` `DETAIL_READ_GROUP_BY_POLICY`（`approvalEntityRoutes.spec.ts:6-11` 断言两表键集相等）。
- 两步先例：`DEPOSIT_SEIZE` :354-355（高管→MLRO）、`INCIDENT_CLOSE_SECURITY` :410-411（MLRO→CFO）；`verify-act1.ts:367` 有引用。
- 裁决事件：横切常量 :138-144，发射 `approvals.service.ts:662 / :786 / :894 / :968 / :1117`；两步单只在末票发 APPROVED（:758, :785-787）；`ApprovalHandlerBase` :63-85 re-emit `workflow.<kebab>.decided`，decision ∈ APPROVED | DECLINED | CANCELLED | EXPIRED。
- 策略种子**不用另种**：`seed.base.ts:240-257` 遍历 `DEFAULT_APPROVAL_POLICIES` upsert，只写 `checkerRoles` CSV；`getPolicy`（`approval-policy.service.ts:44-48`）无 stepsConfig 时按 CSV 顺序「一角色一步」拆——两步链靠 CSV 顺序成立；`seed.base.ts:425` 校验库内策略数 = 常量数。
- 详情页 `ApprovalDetailPage.tsx:382-383` 取 `detail.steps`，:505-545 "Approval Steps" 逐步渲染，无两步特判。

### E. 审计登记处
- 平表 `AuditActions` + 四属性表（B.4 / A.5 位置）；新主体类型 / workflowType 在 `AuditEntityTypes` :36 / :41 与 `AuditBusinessWorkflowTypes` :153 / :158。
- 新建注册表对象要连改：`audit-logs.service.ts:834-852` `??` 链、`audit-vocabulary-closure.spec.ts` import :14 / `REGISTRIES` :62 / 「十八册」文案 :79, :87、`scripts/export-audit-vocab.ts:14, :36`。→ §9 决定不新建。
- 闭合守则 `audit-vocabulary-closure.spec.ts:102`：先登记再接写点。`SUBJECTS_COVERED_ACTIONS` :1543-1566 只含 IAM / 审批 / 证据导出类，VENDOR_* / LP_PROFILE_* 不在其中。
- metadata / extra 先例：`outsourcing-vendors.service.ts:103-107`（`extra` 给 `assertActionSpec` 查顶层必填，`metadata` 落库镜像；展开 :164-166）；`lp-profile.service.ts:106-114`。
- `audit-actions.constant.spec.ts:40` 有 `toHaveLength(107)` 计数断言，属哪张表未核——plan 里核。
- 前端 `auditEntityRoutes.ts:4-29` 无 LP / 服务商条目（见 §11）。

### F. RBAC
- 登记点：`PermissionGroup` 联合 :9（`VENDOR_REGISTER_WRITE` :104、`LP_WRITE` :62、`LP_READ` :61）｜ `RBAC_PERMISSION_DEFINITIONS` :261 ｜ `ACTION_BUCKET_CATALOG` :876（vendor 桶 :1246 `compliance-office.vendors`；LP 桶 :1069-1074 `treasury.act_lp`）｜ `RBAC_ROLE_GROUP_BINDINGS` :1289：高管 :1292、CISO :1315、MLRO :1331、DPO :1356、内审 :1372、合规官 :1404（`VENDOR_REGISTER_WRITE` :1424、`LP_READ` :1437）、CFO :1442、金库 :1476（`LP_WRITE` :1507）、技术 :1525、运营 :1545。
- 新 `route()` 必须对应真实 controller 端点，否则 S7（`verify-rbac.ts:1239`）报死行。
- 前端镜像 `admin-web/src/rbac/permissions.ts`：键 → 代表路由码 `api.<method>.<路径>`（`VENDOR_REGISTER_WRITE` :186 = `api.post.admin_outsourcing_vendors`；LP 按路由 :95-120）；S6（:1111）校验前端码都在后端 catalog。
- `verify:rbac` = `package.json:64` → `scripts/verify-rbac.ts`（+ `verify-rbac.tables.ts`）；判据见 §8。

### G. 种子与演示数据
1. `prisma/seed.business.ts`：`seedOutsourcingVendors` :77（数据 :1714-1742，函数 :1744-1773）→ `seedLpDesk` :88（整体 :2149-2627；Falcon / Dune upsert :2188-2216，审计 :2218-2231，LP 审批单 :2235-2260）→ `seedCompanyFunding` :93（:2646-2908，HexTrust 付款 Step 2 自 :2755，审批 :2801，资金单约 :2827-2848，分录 :2850 起）。
2. 单号：运行时 `generateReferenceNo('LPP' | 'VEN')`（`lp-profile.service.ts:96`、`outsourcing-vendors.service.ts:91`；格式 `no-generator.util.ts:3-19`）；种子 `buildDeterministicNo`（`:21-30`，`前缀+260101+4位哈希`）。
3. `data.md` 生成区由 `demo:all`（`package.json:60` → `scripts/demo-all.ts` → `demo-lib.ts:1475-1513` `renderDataMdSnapshot`）写入 `scripts/demo-data-md.ts:14-31`，标记 `<!-- GENERATED:BEGIN/END -->`（`data.md:306 / :370`）。**花名册** `scripts/demo-roster.ts:59`，只有 DEPOSIT / SWAP / WITHDRAW；LP / vendor 不进（搜法：`liquidityProvider|outsourcingVendor|vendorPayment|LPP|VEN\b` 在 demo-lib / demo-all / verify-demo-data / verify-audit / verify-act1 无命中）。
4. 数据目录：`scripts/db-env.sh:4-17` 由作用域拼 `file:/tmp/exchange_js_<scope>/dev.db`（取值顺序 :19-44）；`stack-common.sh:110 / :122-123 / :132 / :144`；`on-stack.sh:34,53` 注入 `DATABASE_URL / TB_ADDRESS / TB_DATA_FILE`（**本波加 `FILE_STORAGE_DIR`**）。`reset-stack.sh`：停服务 :41 → 删账本 :47-50 → 重格式化 :54-71 → 迁移 :75-79 → base :81-85 → `db:biz:reset`（`scripts/reset-business-data.ts`，表清单含 `vendorPayment` :69 / `outsourcingVendor` :74 / `liquidityProvider` :163——**新表要加进去**）:87-91 → 重播种 :93-101。
5. 云端：`deploy/demo.env.template` 15 个变量（本波加 `FILE_STORAGE_DIR`）；`/run/exchange-demo` 是 `deploy/exchange-demo.service:15` 的 `RuntimeDirectory`；账本数据在 `/opt/exchange-demo/data`（`demo-run.sh:9`）。

### H. 文件上传 / 存储：**现状为零**
搜法 `multer | FileInterceptor | UploadedFile | multipart | new FormData | Content-Disposition | createReadStream | createWriteStream | StreamableFile | ServeStatic | useStaticAssets | express.static | type="file" | res.download`，范围 `src/`、`admin-web/src`、`client-web/src`、三份 `package.json`——无命中。`package.json` 未声明 `multer`，`node_modules/multer` 存在（`@nestjs/platform-express` 带入）。`main.ts:24` `rawBody: true`（Sumsub 验签用），无 body 大小限制、无静态托管；`Caddyfile.template` 无 `request_body`。`.gitignore` 无 uploads / storage 行（数据本就在 `/tmp` 仓库外）。

### I. 剧本与文档
- `demo/script.md` 是**十一幕**：第一 :11 ｜ 二 :49 ｜ 三 :56 ｜ 四 :112 ｜ 五 :156 ｜ 六 :198 ｜ 七 :255 ｜ 八 :264 ｜ 九 :451 ｜ 十 :707 ｜ 十一 :770；最大场景号 36（:660-706，第九幕内）；场景 22 在 :346-371。
- `modules/lp-desk.md` §0 :6 / §1 :10 / §2 :32 / §3 :71 / §4 :88 / §5 :92 / §6 :105；`modules/compliance-office.md` §0 :6 / §1 :16 / §2 :42 / §3 :62 / §4 :76 / §5 :95 / §6 :103 / §7 :110；审批 / 审计 / RBAC 同在 `modules/v1-governance.md`（:59 记路由与权限码数量）；报送台 `modules/v9-regulatory-filing.md`。
- `rules/delivery-checklist.md` 触发表 :20 起（新审计码 / 新状态 / maker-checker / 新审批策略 / 新权限组 / 新端点 / 新事件 / 改 schema / 改页面或种子 / 改前端 / 多波之一波 / 每轮收尾），「两条永不豁免」:47。
- `reference/sumsub-mock-touchpoints.md:19` ⑨ 行；`decisions.md:166` 是 2026-10-24 八拍板（文件末行）。
- 战役甲总纲：`superpowers/specs/2026-09-25-campaign-a-incident-regulatory-charter.md`（在现役目录）。

### J. 侧栏
`DashboardLayout.tsx` Treasury 组 :295（LP Register :327-332 `LP_PROFILES_READ`；Vendor Payments :311-316）；Compliance Office 组 :434（Registers :449-454 `COMPLIANCE_OFFICE_VIEW`）；子项按权限过滤 :529-542（:535-537，空组隐藏 :538）。`module-parity.spec.ts` 只扫三域详情页，不涉本波。

### K. 闹钟墙
`compliance-clock-wall.service.ts:37-61` 四来源（FILING / OBLIGATION / COMPLAINT / DSR），无登记册到期类——复审不做，本波不碰。

---

## 13. 收尾要触碰的文档（按 `rules/delivery-checklist.md` 触发）

- 战役甲总纲 `2026-09-25-campaign-a-incident-regulatory-charter.md`：补一节「波六」（目标 / 边界 / 验收口径，指向本稿）
- `modules/lp-desk.md`：§ 建档流程、状态机、审计码、演示脚本
- `modules/compliance-office.md`：§3.1 外包商册改成服务商准入；新增尽调评估主体；新增文件主体（或单独一篇 `modules/files.md`，施工方定）
- 审批引擎模块文档：四条策略
- 报送台模块文档：第五条自动来路（服务商准入 / 终止）
- RBAC 模块文档 + `verify:rbac` 判据
- `demo/script.md` 四幕 + 场景 22 / 36 重写；`demo/data.md` 种子表
- `reference/sumsub-mock-touchpoints.md` ⑨ 行
- `decisions.md`：额度上限否决、复审另立战役、人工筛查（乙案）、重大性自判强制升档、报备门、服务商抬独立页
- `BACKLOG.md`：销 514、519（入册门半边）
- `CHANGELOG.md` 一行
- 根 `README.md` / `delivery/`：动了状态机、审计集、业务键（新前缀）→ 触碰检查
