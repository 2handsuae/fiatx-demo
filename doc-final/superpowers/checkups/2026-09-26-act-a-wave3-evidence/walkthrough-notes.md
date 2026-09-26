# 甲波三收尾 · 场景 19/20 走查记录

- 走查时间：2026-09-26
- 栈：self（后端 `127.0.0.1:3100`、管理台 `127.0.0.1:3101`、客户端 `127.0.0.1:3102`），库已 `demo:all` 重铺全绿
- 走查方式：Playwright（chromium，`/opt/pw-browsers/chromium`）驱动真实 UI 点击；全程经 UI（EOCN 命中/定性/审批/报送台）或只读 API（核对最终状态用 `curl` + Bearer token，未写库）
- 账号：`compliance_lead@fiatx.com` / `mlro@fiatx.com`（密码 `123456`，`scripts/demo-mlro.ts` 惯例）；客户端 `demo_bob@example.com` / `demo_leo@example.com` / `demo_carol@example.com` / `demo_frank@example.com`（密码同 `123456`）
- 本文件只记录走查过程与出入；**不修代码、不改 seed、不重启栈**

---

## 场景 19（暂编）· B 线 · 制裁定性两分支

### ⚡ EOCN 现场触发（分支一起点）

| 步骤 | 结果 | 备注 |
|---|---|---|
| `compliance_lead@` 登录，开 Simulation 开关 | ✓ | 顶栏 Simulation toggle 一点即生效 |
| 目标客户改用 Bob（`CU2601017625`，ACTIVE，无便签） | ✓ | 剧本明确警告避开 Carol/Mona/Leo/Frank（已带便签会撞 409），走查照办 |
| 客户详情页「⚡ EOCN Sanctions List Simulation」区，填 `EOCN-2026-04213` → Simulate EOCN Hit | ✓ | 成功提示「EOCN sanctions hit simulated — restriction RST260926469560 opened (SILENT).」 |
| 判据：SILENT SANCTION 便签落地，Restrictions 区多一行 | ✓ | `restrictionNo=RST260926469560`，`visibility=SILENT`，`openedBy=ADM2501010006`（compliance_lead 的 userNo）——⚡ actor 留痕成立 |

截图：`03-eocn-form-filled-alice.png`（改用 Alice `CU2601019430` 重截，未提交，纯展示表单，避免 Bob 后续状态变化后无法回放原样）；`extra-eocn-form-bob-live-before-submit.png`（Bob 本人当场提交前的原始截图，历史留档）；`extra-bob-restrictions-after-eocn-hit.png`（命中后 Restrictions 区多一行 SILENT）

### 分支一 · 确认命中 → 横幅 + CNMR

| 步骤 | 结果 | 备注 |
|---|---|---|
| ① Bob 详情页「Sanction disposition →」弹窗，三选一，后果说明可读 | ✓ | 三行文案与代码 `SanctionDispositionModal.tsx` 逐字一致；选中 Confirmed match 后橙色高亮条复述同一句 |
| 选 Confirmed match，填 Summary + External Case Reference，Submit for MLRO Approval | ✓ | 提交提示「Sanction disposition (CONFIRMED) submitted — approval APR260926095694 opened, awaiting MLRO.」 |
| ② `mlro@` 审批中心（Entity Ref=CU2601017625 + Action Type=SANCTION_DISPOSITION + Status=PENDING 过滤）批准 | ✓ | 批准弹窗 Impact 文案：「Approving this formally confirms the sanctions match (customer-visible), keeps the account frozen under the new disclosed restriction, and opens a Confirmed Name Match Report (CNMR) to EOCN (5 business days from freeze).」——与剧本描述的三出口后果说明一致 |
| ③ 回 Bob 详情：SILENT 便签解列（`status=RELEASED`），新开 `SANCTION_CONFIRMED`（DISCLOSED，`status=OPEN`） | ✓ | API 核对：`RST260926469560` → RELEASED；新便签 `RST260926810926` cause=SANCTION_CONFIRMED visibility=DISCLOSED |
| ④ 客户端登录 Bob：Profile 页出现横幅「Account restricted — confirmed sanctions match」 | ✓ | 与 Leo 种子横幅逐字一致（同一套 `RestrictionBanner`，零新代码） |
| ⑤ 报送台一张 CNMR 已自动开（同 Leo 那张形状） | ✓ | `FIL260926127340`，锚=便签 `openedAt`，`deadlineAt=openedAt+5工作日`，`externalCaseRef` 自动带上 `EOCN-2026-04213` |
| Mark Submitted（填 externalRef）→ SUBMITTED | ✓ | `externalRef=EOCN-ACK-2026-88123` |
| 加一条 RECEIPT_ACK 收尾 | ✓ | entries 里出现 RECEIPT_ACK |

截图：`02-disposition-modal-confirmed.png`（弹窗三出口 + Confirmed 高亮 + 后果文案）、`extra-mlro-approval-detail-impact.png`（MLRO 审批页 Impact 文案）、`extra-bob-restrictions-confirmed.png`、`extra-bob-client-banner-live.png`（Bob 横幅首次出现）、`extra-cnmr-new-filing-detail-bob.png`（CNMR 刚开单 DRAFT 态）、`extra-cnmr-new-filing-after-submit-receipt.png`（Mark Submitted + RECEIPT_ACK 后）

**判据核对**：确认命中才翻明示（DISCLOSED）——横幅从无到有那一刻就是分界线 ✓；CNMR 单开单/锚定/钟全部自动、无需另外手工建单 ✓

### 分支二 · 部分命中 → 补料 + 指令 → 二次定性排除（接 Mona 现成状态）

| 步骤 | 结果 | 备注 |
|---|---|---|
| ① Mona 详情：Restrictions 区 1 OPEN（SILENT SANCTION）；Verification Requests 区 EMIRATES_ID（PENDING_SUBMISSION） | ✓（API 核对，见下） | 页面截图因视口高度被截断未能同屏拍到两个区块，改用 API 核对：`restrictions` 返回 1 条 `status=OPEN cause=SANCTION visibility=SILENT`；`material-requests` 返回 1 条 `materialType=EMIRATES_ID status=PENDING_SUBMISSION restrictionNo=null`（`blocking:false`，与剧本讲法一致——这条补料不新增限制） |
| 报送台 PNMR（`FIL2601012321`）AUTHORITY_INSTRUCTION 往来记录可见 | ✓ | 往来区一条「Authority instruction (EOCN/FIU)」，正文「EOCN acknowledged the PNMR submission and requested confirmation of the customer's full legal name and date of birth against the list entry before advising a final match outcome. Awaiting response before re-disposition (CLEARED or CONFIRMED).」，Ref `EOCN-ACK-2026-91139` |
| ② Mona 详情「Sanction disposition →」二次定性，选 **Cleared — false positive**（默认选中），填 Summary（引 AUTHORITY_INSTRUCTION 核实结论）+ External Case Reference（`EOCN-2026-59206`）→ Submit | ✓ | 提交提示「Sanction disposition (CLEARED) submitted…」 |
| ③ `mlro@` 批准 | ✓ | 批准页 approvalNo=`APR260926898530` |
| ④ SILENT 便签当场解除，客户全程无感 | ✓ | API 核对：`RST260926695124` → `status=RELEASED`，`releaseMode=MANUAL`，`releaseApprovalNo=APR260926898530` |
| PNMR 单本身不因二次定性而改动 | ✓ | 重新 GET `FIL2601012321`：仍 `status=DRAFT`，`deadlineAt` 未变——报送台记录不因限制解除而消失 |

截图：`extra-mona-restrictions-and-material-request.png`（视口截断，未拍到 Restrictions/Material Request 两个区块本体，仅拍到客户头部信息；已用 API 核对补齐结论，见上表）、`extra-pnmr-mona-detail-authority-instruction.png`、`extra-mlro-approval-detail-impact-mona.png`、`extra-mona-after-clearance.png`

**判据核对**：部分命中全程 SILENT，翻不了明示 ✓；PNMR 单本身不因二次定性而改动，钟仍按原锚走完，报送与限制账各管各的状态 ✓

### 客户端两张（第 4 组，必交）

| 客户 | 结果 | 备注 |
|---|---|---|
| Leo（`FIL2601015358` 锚，种子终态） | ✓ | Profile 页横幅「ACCOUNT RESTRICTED — CONFIRMED SANCTIONS MATCH」+ 正文「Confirmed match against EOCN sanctions list — MLRO sanction disposition CONFIRMED; SILENT SANCTION restriction delisted and replaced by this DISCLOSED one.」 |
| **出入**：Mona / Carol 客户端交易列表 | ✗→已替换 | 剧本原文让用「Mona 或 Carol 的客户端视图」演「冻结客户交易列表 PROCESSING 不可区分」；**实测 Carol 与 Mona 两人交易记录数均为 0**（`GET /deposit-transactions?ownerNo=…&ownerType=CUSTOMER` 两人均返回空数组，客户端 History 页也显示「No transactions in this range」），两人身上根本演不出这张截图。改用 **Frank**（`demo_frank@example.com`）：他持一张 OPEN 的 SILENT SANCTION 便签（系统侧自动开，`reason=Deposit DEP260926395049 KYT rejected: applicant sanctioned`），名下 3 笔充值中 2 笔（`SEIZED` 9,100 AED、`FROZEN` 7,300 AED）在客户端 Deposit→History 列表里都显示为统一的 **PROCESSING**（真实第 3 笔 `SUCCESS` 2,000 AED 则显示 SUCCESS）——两种截然不同的处置结局在客户端外观上确实不可区分，判据本身成立，只是剧本点名的两个客户没有可演示的数据 |

截图：`04a-leo-client-sanction-confirmed-banner.png`（必交，Leo）、`04b-frank-client-transactions-processing.png`（必交，改用 Frank，见上）、`extra-carol-client-transactions-empty-discrepancy.png`（留档证明 Carol 确无交易，佐证上面的出入记录）、`extra-bob-client-transactions-after-confirm.png`（bonus：Bob 确认后 DISCLOSED 态下同样看到 PROCESSING + 顶部横幅并存，与 Frank 的 SILENT 态对照）

---

## 场景 20（暂编）· A 线 · STR/SAR 与 tipping-off 登记本

### 站 A · STR 全链（对照通用族的高管签发）

| 步骤 | 结果 | 备注 |
|---|---|---|
| 种子 STR（`FIL2601017376`，锚 Frank HighRisk）详情页：无 Request sign-off 按钮、externalCaseRef 可见、CUSTOMER_COMM 两签一行、RECEIPT_ACK | ✓ | 见截图 `01-str-filing-detail-seed-frank.png`：Sign-off 区直接显示「Submitted」，全程无送签按钮；CUSTOMER_COMM 行「Drafted MLRO desk note (pre-cleared script, tipping-off-safe wording) · Cleared ADM2501010004」；RECEIPT_ACK「ADM2501010004 · Ref GOAML-ACK-2026-45740」 |
| ① MLRO 报送台 Open Filing → STR → 填 Title + External Case Reference（`SUMSUB-CASE-wave3walk01`）→ 提交 | ✓ | 新单 `FIL260926233135` |
| 详情页没有 Request sign-off 按钮，直接看到 Mark Submitted | ✓ | 与剧本判据一致（AML 族无签发链） |
| ② 填 externalRef（`GOAML-ACK-2026-wave3walk01`）→ Mark Submitted → SUBMITTED | ✓ | API 核对 `status=SUBMITTED` |
| ③ 往来记录选 RECEIPT_ACK，记一条回执 | ✓ | entries 里出现该条 |
| 判据：全程零 PENDING_SIGNOFF/SIGNED_OFF 两态、零审批单 | ✓ | API 返回 `approvalNo: null`，状态机全程 DRAFT→SUBMITTED，未经过 PENDING_SIGNOFF/SIGNED_OFF |

截图：`extra-open-filing-modal.png`、`extra-new-str-draft-before-submit.png`、`extra-new-str-after-submit-receipt-ack.png`

### 站 B · 决定不报（no-file decision 留痕）

| 步骤 | 结果 | 备注 |
|---|---|---|
| 另开一张 STR → 详情页「Close — No Filing Decision」按钮（仅 STR/SAR、仅 DRAFT 可点） | ✓ | 新单 `FIL260926791118`，按钮可见可点 |
| 弹窗必填理由，提交 → CLOSED，No-Filing Reason 字段可查 | ✓ | 截图 `extra-str-closed-no-filing-reason.png`：`No-Filing Reason` 字段显示填入的中文理由，`Status=Closed` |
| 判据：DRAFT→CLOSED 新边，理由必填留痕 | ✓ | 未填理由时按钮 disabled（`disabled={busy \|\| !reason.trim()}`，代码级确认） |

截图：`extra-close-no-filing-modal.png`、`extra-str-closed-no-filing-reason.png`

### 站 C · SAR（锚客户不锚交易）

| 步骤 | 结果 | 备注 |
|---|---|---|
| Open Filing → SAR → 填 External Case Reference（`SUMSUB-CASE-wave3walk03-sar`）→ 提交 | ✓ | 新单 `FIL260926038047`，`status=DRAFT`，`authority=UAE_FIU`（与 STR 同一默认机构，`FILING_TYPE_MIRROR` 镜像一致） |
| 判据：SAR 与 STR 同构（同一套状态机/字段），叙事口径不同即可 | ✓ | UI 层 STR/SAR 用同一个 `OpenFilingModal`/详情页组件，字段集合完全一致；「锚客户不锚交易」是叙事口径（讲词），不是 UI 结构差异——剧本自己就是这么定义判据的，走查确认符合预期，不算出入 |

截图：`extra-sar-new-filing-detail.png`

### ⚠️ tipping-off 讲法

- Frank 种子 STR 的 CUSTOMER_COMM 正文示范中性话术：「Customer called asking why a recent withdrawal took longer than usual. Explained this was a routine compliance review with no fixed timeline — no reference made to any report, investigation, or law-enforcement interest (FDL 20/2018 tipping-off).」——全程不提"报告""调查""监管"，只说"常规合规审查、无固定时限"，符合剧本讲法
- 客户面 DTO 契约测试（零 `filingNo`/STR 引用泄露到客户可见接口）属另一层防线，e2e/单测已覆盖，本次 UI 走查未单独复测（剧本原文亦注明"两层防线不是一回事"，非本次走查范围）

---

## 管理台 UUID 排查（按任务要求逐条点名）

逐张截图核对后，**管理台正文中未见我方内部数据库 UUID**（客户、订单、审批、报送单全部展示业务键：`CU…`/`DEP…`/`APR…`/`FIL…`/`RST…`/`ADM…` 等），符合铁律⑥「管理台不暴露 UUID」。以下两处外观上"像 UUID"的字段单独点名，供复核判断是否需要收紧：

1. **审批详情页「Technical Detail」区的 Trace ID**（`extra-mlro-approval-detail-impact.png`）：显示 `CUSTOMER_RESTRICTION:1548fab2-3fd5-47ee-8150-371c3ca3e817`，是带前缀的内部 traceId，内嵌一个标准 UUID v4。该字段被明确归在「Technical Detail」分区标题下，语义上是给工程排障用的技术字段，不是业务识别主键（主键仍是 `RST260926469560`/`CU2601017625` 等业务号）。是否符合铁律⑥的立意（"管理台不暴露 UUID"）取决于这条判定线画在哪——本次只如实点名，不代为下结论。
2. **客户详情页「Verification」区的 Applicant ID**（`03-eocn-form-filled-alice.png`）：显示 `6a5dd88f07d9bbd981a22fc9`，是 `mockSumsubApplicantId()` 生成的 24 位十六进制串（MongoDB ObjectId 风格，非标准 UUID 格式、不带连字符），代表第三方供应商（Sumsub）的外部申请人编号，性质上类似 `externalCaseRef`/`externalRef` 这类"对外系统引用"，不是我方内部记录 id。

---

## 出入清单汇总（本任务最重要产出）

1. **剧本点名客户与实际数据不符**：`demo/script.md` 场景 19 B 线收尾要求用「Mona 或 Carol 的客户端视图」演示冻结客户交易列表 PROCESSING 不可区分，但两人名下交易记录数均为 0（无任何充值/提现/兑换记录），无法用来演示该判据。走查改用 Frank（`demo_frank@example.com`，持 OPEN SILENT SANCTION 便签、名下有 FROZEN/SEIZED 充值单），判据本身在他身上成立且效果更好（两种不同处置结局同样显示 PROCESSING）。**建议**：`demo/script.md` 场景 19 收尾一行的客户名单改成 Frank，或在报文族种子里给 Mona/Carol 各铺一笔小额充值供该步骤直接使用。
2. 其余所有步骤均与剧本描述一致，未发现按钮点不动、状态机跳转错误、文案不符等问题。

---

## 截图清单（23 张，`t9-screenshots/`）

**必交四组**：
- `01-str-filing-detail-seed-frank.png` — 报送台 AML 单详情（STR 种子，Frank 锚）
- `02-disposition-modal-confirmed.png` — 定性弹窗（Confirmed match 选中，三出口后果说明可见）
- `03-eocn-form-filled-alice.png` — ⚡ EOCN 表单（改用 Alice，完整未截断）
- `04a-leo-client-sanction-confirmed-banner.png` — Leo 客户端 SANCTION_CONFIRMED 横幅
- `04b-frank-client-transactions-processing.png` — 冻结客户交易列表 PROCESSING 不可区分（改用 Frank，见出入清单）

**过程与 bonus**：
- `extra-eocn-form-bob-live-before-submit.png` — Bob 本人现场提交前原始截图
- `extra-bob-restrictions-after-eocn-hit.png` — Bob EOCN 命中后 Restrictions 区
- `extra-bob-restrictions-confirmed.png` — Bob 确认后 Restrictions 区（SANCTION_CONFIRMED）
- `extra-bob-client-banner-live.png` — Bob 客户端横幅首次出现
- `extra-bob-client-transactions-after-confirm.png` — Bob 确认后客户端交易列表（DISCLOSED 态对照）
- `extra-mlro-approval-detail-impact.png` — MLRO 审批页 Impact 文案（Bob CONFIRMED 案）
- `extra-mlro-approval-detail-impact-mona.png` — MLRO 审批页（Mona CLEARED 案）
- `extra-cnmr-new-filing-detail-bob.png` — CNMR 新单详情（DRAFT 刚开单）
- `extra-cnmr-new-filing-after-submit-receipt.png` — CNMR 新单（SUBMITTED + RECEIPT_ACK）
- `extra-mona-restrictions-and-material-request.png` — Mona 客户详情（视口截断，结论见 API 核对）
- `extra-pnmr-mona-detail-authority-instruction.png` — PNMR 详情（AUTHORITY_INSTRUCTION 往来）
- `extra-mona-after-clearance.png` — Mona 二次定性排除后客户详情
- `extra-carol-client-transactions-empty-discrepancy.png` — Carol 客户端交易列表为空（出入佐证）
- `extra-open-filing-modal.png` — Open Filing 弹窗
- `extra-new-str-draft-before-submit.png` — 新开 STR（DRAFT，未 Mark Submitted 前）
- `extra-new-str-after-submit-receipt-ack.png` — 新开 STR（SUBMITTED + RECEIPT_ACK）
- `extra-close-no-filing-modal.png` — Close — No Filing Decision 弹窗
- `extra-str-closed-no-filing-reason.png` — 决定不报后 CLOSED 详情
- `extra-sar-new-filing-detail.png` — 新开 SAR 详情

---

## 走查过程技术说明（非产品问题，供本任务复核用）

首轮截图统一用 `page.screenshot({ fullPage: true })`，视口 1440×1000，但该应用内容区是 `overflow-y-auto` 的内层 flex 容器滚动（不是 `<body>` 整页滚动），Playwright 的 `fullPage: true` 只按 `document.body.scrollHeight` 截，长页面因此被截在恰好 1000px 处（`01`、`03` 两张必交截图最先踩到，已发现后改用加高视口 2000px 重截，内容完整）。`extra-mona-restrictions-and-material-request.png` 因 Mona 状态已在走查后续步骤中推进（限制已解除），无法用同样手法回放原状态重截，改用只读 API 核对结论补齐（见上表）。此现象只影响本次取证脚本本身，不是产品缺陷，不登记 BACKLOG/PRODUCTION-NOTES。
