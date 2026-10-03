# 战役丙波三「客户协议」骨架

> 总纲：`2026-09-30-campaign-c-outreach-disclosure-charter.md`（§1.1 改纲缘由 / §2 波三行）｜ 骨架立于 2026-10-02（波二展开脑暴时拆出）；展开 = 新会话读总纲+本骨架后跟业主脑暴，本骨架只登已定事实与待定岔口，不代做。

## 承接上一波

> 波二（确认单 + 披露）T8 收尾写入，按 `rules/delivery-checklist.md` 承接行：实际偏差 / 新事实 / 前提变化。只记承接，不展开本波 spec。

**实际偏差**
1. **波二 spec 字段清单漏列 `toAssetCode`**（判例）：「确认单是自包含原件」原则逼出——页面要显示「You received … 币」就得有买入侧币种列，spec §2.1 只列了 `fromAssetCode`。T3 评审逮到、裁决补列（`64b1e627`），spec 头部「执行订正」已追记。**对波三的启示**：协议版本表若也要「自包含原件」（版本号 / 生效日 / 正文哈希 / 同意时刻等），字段清单须从「页面要显示什么」反推，不从「订单表有什么」正推。
2. **单号形态 `CNF` + 12 位数字、无连字符**（如 `CNF261002576568`）：沿用系统全部单号惯例，spec 里写的 `CNF-…` 是笔误。岔口 4（版本业务键形态）若取 `TC-V2` 这类，须先核它与 `generateReferenceNo` 惯例是否同形——要么走惯例，要么明说为何破例。

**新事实**
3. **打印样式判例**：纯 CSS 的打印样式也必须**真实打印渲染验证**（浏览器打印预览，含「背景图形」开/关两态），不能只看屏幕。T7 逮到：`absolute` 定位在 `relative` + `overflow` 的客户端壳层（`CustomerDashboardLayout`）里会被侧栏/顶栏推偏、被窄宽度挤得换行；修法 = `position: fixed` + `html { color-scheme: light }` + `html, body` 页底翻白（`4640357c`，`client-web/src/index.css` `@media print`）。若波三的协议阅读页要支持打印/另存，直接沿用这套，别重踩；证据 `checkups/2026-10-02-campaign-c-wave2-evidence/03`/`03a`/`03b`。
4. **可复用地基**（波三协议阅读页 / 同意弹窗 / 版本横幅的文案与展示同模式）：① 披露文案登记处 `client-web/src/utils/disclosureCopy.ts`（`DISCLOSURE_COPY` 九键 + `fillRateDisclosure()` 占位填充；页面禁散写句子，红线文案只许从登记处引用）——协议相关的客户端固定文案进登记处（可同文件追加键，或同目录并列文件，展开时定）；② Trade Confirmation 区块 + `confirmationDisplay.ts` 纯函数（「显示条件抽纯函数供 vitest，渲染靠截图闸」的套路，客户端测不了渲染）；③ 审计册：`CONFIRMATION_ISSUED` 与 `NOTIFICATION_SENT` 同入 `CAMPAIGN_C_NOTIFICATION_AUDIT_ACTIONS`（本册实质已是「战役丙·客户触达」册），协议发布链/客户同意的新码可入同册，词表导出器 / closure 守则 / audit-logs 查表三处登记点不必新增；④ 事务后置漏斗模式：先落持久物 → 再记审计 → 再发通知，`$transaction` 内禁调横切写服务（SQLite 单写者自锁），出具/发信整体吞错。
5. **走查法**：T7 为对数字，曾在 self 栈**手驱一单兑换到 SUCCESS**，取得真实确认单后再截图——波三走查「客户同意 / 暂不同意 / 快进生效」同法可用，不必为截图另造假数据；注意手驱会在 `audit_log_events` 留孤行（`stack.sh reset self` 不清审计表，已登记 `TOOLING-DEBT.md` 第 89 行；本波 T8 实测：reset 后表里仍留 4 条旧 `CONFIRMATION_ISSUED`，`rm dev.db` 再 reset 才干净），要审计表判据干净的收尾闸前先 `rm dev.db` 重铺。

**前提变化**
6. **无实质变化，已逐条核**：① 通知表 `customer_notifications.relatedOrderType` 仍只认 `DEPOSIT|WITHDRAW|SWAP|COMPLAINT`（`prisma/schema.prisma:1972`，波二未触动，`src/core/notifications/` 零改动）——已定事实 9 的「需扩一种协议类通知」前提原样成立；② 客户闸 `customer-access.service.ts` / `src/modules/identity` 波二零改动，已定事实 4 的接入点不变；③ 审计现役码基线由 327 → **328**（波三再加码在 328 上递增）；④ 波二确认单只给兑换成交单（拍板 2），与协议同意**互不依赖**——协议场景不需要等确认单。
7. **岔口 9（⚡快进生效 × 演示剧本）的补充参照**：波二新增的剧本站 4.7（成交确认单）依赖 alice 在站 4.6 刚成交的那笔；若波三协议场景把 v2 快进到生效，全库客户同时被拦兑换 → 站 4.1/4.6/4.7 当场演不动，**协议场景仍须排整场最后或演后重铺**，该裁决不因波二改变，只是多了一条要避开的站。

## 已定事实（2026-10-02 业主在波二脑暴中已拍，展开时直接引用，不再论证）

1. **缘起与依据**：现行条款末节已对客户承诺"重大变更至少提前 14 天通知"（`client-web/src/pages/CustomerRegister.tsx:101`），系统无版本概念、无从兑现；条款同意现为纯前端闸（同文件 `:15-16` 自认；`prisma/schema.prisma` + `src/` 不分大小写搜 `acceptTerms|termsVersion|termsAccepted|consent` 零命中，2026-10-02）。
2. **流程**：法务定稿 → 合规发布（定生效日）→ 提前通知客户 → 到期生效 → 客户表态 → 全程留痕。
3. **正文来源（拍甲）**：正文**写死代码、随版本装载**（同"上币走开发"思路；同丙波一模板登记处"不做编辑框"的理由）。管理台只读 + 发布，不能改字。需预备两版：v1 = 现行七节（`CustomerRegister.tsx:46` 起 `TERMS_SECTIONS`），v2 = 待发布草稿（如改一条费率条款）。
4. **未同意客户（拍丙）**：生效后登录弹窗"同意 / 暂不同意"；暂不同意 → **拦充值、拦兑换、放行提现**，横幅常驻直至同意。理由：硬拦等于锁住客户的钱（条款给 14 天正是留出走的时间）；软处理（继续使用视为同意）则无同意记录。接入既有按能力分拦的客户闸 `src/modules/identity/customers/customer-access.service.ts:178`（`assertCapability`），不新造拦截机制。
5. **提前期（拍甲）**：发布时生效日须 ≥ 发布 +30 天，否则系统拒（原拍 14；2026-10-02 核 VARA MC II.A.7 原文后业主同意改 30，见下"待定岔口"第 7 项已转定）；演示用 Simulation 开关下"⚡快进到生效"，快进单独审计。先例三处：`complaints.service.ts:447` `simulateTimeout`、`regulatory-filing.service.ts:586` `simulateDeadlineTimeout`、`compliance-obligations.service.ts:149` `simulateDue`（审计码均为 `*_FASTFORWARDED`）。不分重大/一般变更——每版都要客户表态，等于全按重大处理。
6. **发布双人把关（拍甲）**：合规官（`COMPLIANCE_OFFICER`）提交 → 高管（`SENIOR_MANAGEMENT_OFFICER`）批准后才发布并通知客户；照报送台"高管签发"路数，走 `ApprovalsService` 正门。按交付清单：新审批策略在 `scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加一行；发起/批准两组权限各登记四处。
7. **独立审计（波二岔口 4 改投甲）**：同意不再只发生在注册一刻（新版生效后要再表态），挂在注册审计 `CUSTOMER_CREATED`（`src/modules/identity/auth/customer-auth.service.ts:64`）里装不下；发布是 operator 动作，铁律①本就要单独留痕。至少两类：发布链（提交/批准/快进）、客户同意。
8. **注册时同意落库随本波**：有版本才能记"同意的是哪一版"。
9. **通知接线**：发布即给客户发"协议将于某日更新"。波一 `customer_notifications.relatedOrderType` 现只认 `DEPOSIT|WITHDRAW|SWAP|COMPLAINT` 且 `relatedOrderNo` 非空（schema 实读）→ 需扩一种协议类通知；接线守 `decisions.md` 2026-10-01 三原则（持久物先于信号 / `$transaction` resolve 后调 / 服务边界吞错）。
10. **不做**：管理台正文编辑器；重大/一般变更分类。
11. **档位**：动交易能力闸（三域入口），plan 点名评审升档。

## 待定岔口（展开脑暴用）

1. 管理台怎么看同意情况：版本页挂"已同意 / 未同意"计数 + 名单？客户详情加一行"当前协议版本"？还是只靠审计中心检索？
2. 通知时点：发布时一条之外，生效时要不要再发一条？
3. "暂不同意"要不要落库 / 留痕？
4. 版本业务键形态（铁律⑥，例如 `TC-V2`）。
5. 种子数据：种子客户"已同意 v1"的时间取什么；v2 草稿改哪条。
6. 演示场景挂哪幕、用哪个客户演"暂不同意"。
7. ~~提前期~~ **已定 30 天（2026-10-02 业主同意）**：VARA Market Conduct Rulebook **II.A.7** 原文要求客户协议任何变更"at least thirty (30) calendar days prior"通知客户（rulebooks.vara.ae/entiresection/190，现行版 2025-06-19，一手核实 2026-10-02）——现行条款写的 14 天本身不合规。定：系统强制提前期 30 天，v1 文案同步改 30 天；已拍的甲方案（强制 + ⚡快进）不变。同节相关：II.A.8 保留单方变更权须在协议写明；II.A.9 须保留历次版本（印证版本登记处）；II.A.5/6 提供服务前取得客户接受、签约后给客户副本（为第 8 项阅读页提供依据）；II.B.1.e 协议须列明全部费用。内部调研 `reference/research/2026-07-04-v6-swap-compliance-research.md:118` 的"markup/费率变更 ≥T+30"系由 II.B.1.e + II.A.7 推出，原文无 markup 字样。
8. 客户端协议阅读页（通知深链落点；看当前已同意版本与待生效版本）。
9. **⚠️快进生效 × 演示剧本互作用（2026-10-02 波二复查逮）**：种子客户全部只同意 v1，⚡快进 v2 生效 = 全库客户同时被拦充值/兑换，三/四幕当场演不动——协议场景排整场最后、或场景内关键客户当场同意、或演后重铺，spec 必裁；demo:all 跑在未快进态（v2 未生效）不受影响，判据要写明这一前提。同类判例：种子日期相对运行时=定时炸弹。
10. **"拦充值"的链上语义（同日逮）**：链上来账拦不住到账，只能定到账后结局；既有受限客户入账闸是现成先例（`inbound-transfer-signals.service.ts:138`，DISCLOSED 客户专门分支）——未同意客户沿用哪个结局、客户面看到什么，spec 必裁。
11. **v1 基线收录声明（同日逮）**：v1 文案 14→30 天订正与"版本不可变"表面冲突——spec 须明写"v1 以订正后文案收录为基线，不可变约束自入库起算"，否则自相矛盾。
