# 战役丙波四「月结单与资料请求」骨架

> 总纲：`2026-09-30-campaign-c-outreach-disclosure-charter.md`（§1 岔口 1 / §2 波四行 / §3 波四 / §6 演示承接点）｜ 骨架立于 2026-10-03（波三收尾时按 `CLAUDE.md §6` 立）；展开 = 新会话读总纲 + 本骨架后跟业主脑暴，本骨架只登已定事实与待定岔口，不代做。
> 文件名日期沿波三骨架同批（2026-10-02 起的丙战役），不代表立骨架日。

## 承接上一波

> 波三（客户协议）T12 收尾写入，按 `rules/delivery-checklist.md` 承接行：实际偏差 / 新事实 / 前提变化。只记承接，**不展开本波 spec**。原始证据：波三 spec 头部「执行订正」9 条（随波归档 `archive/superpowers/specs/`）、波三走查证据 `superpowers/checkups/2026-10-02-campaign-c-wave3-evidence/`。

**实际偏差**
1. **种子 consents 是 13 行，不是 11 行**：spec / plan 三处"11"沿用客户端 Quick login 子集数；库内 demo 客户实为 13 位（T1 逮到，`801ac9c7` 订正）。**对波四的启示**：任何"给种子客户铺一行 X"的计数，先查 `prisma/seed.business.ts` DEMO_CUSTOMERS 实数，不沿用客户端登录页面板人数。月结单若要给种子客户预铺历史月份，这个数字直接相关。
2. **通知时间三时刻砍成两时刻**：业主原提案"审批通过 → 到通知时间发信 → 到生效时间生效"，agent 建议合并前两个、业主采纳——批准即发布即通知，30 天钟锚批准时刻，**没有独立"通知时间"字段、没有第二条（生效时）通知**（`decisions.md` 2026-10-02 已入）。**对波四的启示**：时间类状态别预先拆细，先问"监管的钟从哪一刻起算"，能合并的时刻就合并；少一个时刻 = 少一台定时机器 + 少一个 ⚡按钮。
3. **`demo:all` 零协议动作**（plan 期订正）：原"跑到发布为止"与现场剧本冲突（发布了前八幕客户全弹新版弹窗、第十幕也无单可发），改为 v2 全程 DRAFT、整条链是现场戏。**对波四的启示**：凡"现场才演"的动作类场景，不要让 `demo:all` 抢先做掉；`demo:all` 只铺"可对照的前置态"。
4. **`GET /client/agreements/me` 响应由三键扩为四键**（含 `previous`，T11 修复波）：⚡快进生效后旧版变 SUPERSEDED，客户再也读不到旧版，"两版对照"演不出且违"可查可追"——补 `previous`（最近一版被取代版全文）。**对波四的启示**：任何"版本化 + 状态流转"的读接口，要预想"上一版还要不要读得到"；月结单若按月定版，历史月份可读是同一问题。
5. **幕号偏差**：波三 spec / plan / 骨架一路写"第九幕"，但 `demo/script.md` 的第九幕早被战役乙「公司的钱」占用（2026-09-30），客户协议实落**第十幕 · 场景 33**（T12 逮到，spec 执行订正第 9 条）。**对波四的启示**：见下「前提变化」第 12 条。

**新事实**（判例级，波四动手前先过一遍）
6. **`verify-rbac` 行为段不设 `API_BASE` 会击中 main 栈**（本波真事故，T9）：`scripts/verify-rbac.ts` 的 `resolveApiBase()` 在没有 `.stackports` 的 worktree 里静默回落 `http://localhost:3000`，子代理在没起 self 栈的 worktree 里跑完整脚本，探针行（注资单、STR、周期义务、RI、投诉、角色往返）写进了 main 栈库——**端口隔离铁律第一次在子代理身上被破，且零报错**。规矩：子代理跑 `verify:rbac` 一律显式 `API_BASE=http://localhost:<.stackports 端口>`；只想跑静态段用 `API_BASE=http://127.0.0.1:1`。已登 `TOOLING-DEBT.md`（回落分支改 fail-fast 为修法方向）；main 栈探针行随合并后既定的 `stack.sh reset main` 一并清。**波四若新增 admin 写端点（DSR 处置），收尾闸 `verify:rbac` 必须按此跑。**
7. **打印"背景图形关"态必须单独真实渲染验证**（波二判例第二次挣钱 + 新形态，T11）：协议页在 Chrome 打印默认的「背景图形」关态下整份空白——深色主题 `body::before` 颗粒叠层（`position: fixed; z-index: 0`）在 `#root` 被压成 `static` 后盖到正文之上，画成整页白；开态正常，T7 的静态壳层复现没覆盖这一态。修法 = 打印协议页时摘掉该叠层（`index.css`，`0501d3db`）。T12 对波二确认单补测关态：暗像素 8611 = 开态 8611，**确认单无此缺陷**（据 CSS 读码：确认单打印规则没有把 `#root` 压成 static，`#root{position:relative;z-index:1}` 仍把叠层压在下面），证据 `checkups/2026-10-02-campaign-c-wave3-evidence/13-*`，且补测带变异对照（叠层 z-index 抬到最上 → 暗像素 0，检查会红）。**波四月结单若要打印/另存，复用这套并必测关态**；判据口径 = 关态暗像素非零且与开态同量级。
8. **客户面日期：`Intl` 本地日 vs 云端 TZ**（T11）：通知模板的 `effectiveDate` 原用 `toISOString().slice(0,10)`（UTC 日），迪拜 00:00 的生效日被写成前一天，与弹窗 / 管理台差一天；改 `Intl.DateTimeFormat('en-CA')` 本地日，**云端必须钉 `TZ=Asia/Dubai`**（`deploy/demo.env.template` 已加，T12）。系统另有一套迪拜业务日函数（`toBusinessDate`，语义合同 S20），客户面日期两套口径并存的取舍记 `PRODUCTION-NOTES.md`。**波四月结单的"结单日 / 出具日 / 月份边界"一律走业务日函数**，不要再新增第三种取日方式（迪拜业务日 UTC 20–24 窗口判例：甲波一）。
9. **`invite-expiry.service.spec.ts` 的红不是 ".env 缺失型假红"，真因是审批事件监听器超限**（T12 订正 T6 的归因）：T6 判其为"integration spec 需 on-stack、worktree 无 .env"，T12 在带全 on-stack 环境下复跑**同样红**，同命令在基线 `8e9e2ed2` 也红——真因是 `governance.approval.{approved,rejected,cancelled,expired}` 各挂 52 个监听器（基线 51），超过各文件 `setMaxListeners(50)`，jest 沙箱里整个 `app.init()` 抛 `TypeError`；`test/` 下 25 个 e2e 文件同机理（实测 2 份同红，其余按机理）。**每新增一条 maker-checker 审批策略 +1**——波四 DSR 若走审批链，会是第 53 个。已登 `TOOLING-DEBT.md`。**波四收尾闸的 jest 判据**：目录范围内 `invite-expiry` 红属既有债（带证据交代），不得称"全绿"；e2e 在修好前不得援引为绿。
10. **直插 prisma 造客户的 e2e 夹具缺协议同意行**（T5 预警、T12 实测）：`incident-register` 用例 9、`recon-internal-transfer` 用例 B、`recon-supplement` 5 例经真实闸走 DEPOSIT/SWAP 报 `AGREEMENT_NOT_ACCEPTED`；夹具分散在各文件本地 helper、无共享单点，已登 `TOOLING-DEBT.md`（改哪、怎么复现俱全）。**波四若新增"客户须满足某前置条件才能走某入口"的闸，同类夹具问题会再来一次**——造客户的 e2e 夹具应当有共享单点，这是登记的修法方向之一。
11. **快进生效 × 剧本：演员若是其他幕当事人，走查改了余额须重铺后再跑他幕**（T11）：Kate Trader 是第六幕对账场景 8 / 14 的当事人（AED 5200 / USDT 350 是前提），第十幕走完她的余额被改（提现 100 AED、兑换 50 AED）。**波四点演员的三条件**：干净 / 有余额 / 非主角，**先对 `script.md` 查她是不是别幕当事人**；月结单若展示"上月流水"，演员的流水被前幕改过也会影响数字，剧本须写"演员是谁、之前被谁动过"。

**前提变化**（总纲 / 骨架里波四相关的原有前提，逐条核）
12. **幕号**：总纲 §6 写"DSR 自开新场景（挂第八/九幕后，波四 spec 定）"——第八、九幕之后又有了**第十幕（客户协议，场景 33）**，波四的新场景应排**第十一幕**（场景 34 起），月结单承接第六幕账对的客户端流水场景不变。`demo/script.md` 头部已改"十幕主线"。
13. **审计现役码基线 328 → 335**（+7，全入"触达册"）：波四再加码在 335 上递增（预期：DSR 请求 / 处置 / 月结单出具等，`audit:vocab` 以机器数为准）。
14. **权限 15 域 82 桶 90 组**（`Compliance Office` 域 4→5 桶；`AGREEMENT_WRITE` 合规官独占）：DSR 的经办人（DPO？合规官？）与桶挂靠（`Compliance Office` 域 or `Customer Management` 域）展开时定；`S13d` 判据的预期数需随波四同改（82/90 → 新值），否则 `verify:rbac` 红。
15. **通知表 `relatedOrderType` 现 5 值**：`DEPOSIT | WITHDRAW | SWAP | COMPLAINT | AGREEMENT`（`prisma/schema.prisma` 该列注释）。**波四月结单"已出"通知可直接复用 `AGREEMENT` 同款扩法**——加第六值 + 模板登记处加一条 + 客户端 type→路由映射加一行；批准/出具落地后置、`$transaction` resolve 后调、服务边界吞错的三原则不变（`decisions.md` 2026-10-01）。模板登记处现 17 条。
16. **协议版本可被引用**：DSR "删 → 因监管留存义务部分拒绝"要引条款原文时，用 **`versionKey` + 节号**即可（如 `v1` / `v2` 第 VI 节 "Privacy & Data Protection"，"erasure (subject to retention obligations)" 那句，原文现住 `src/modules/identity/agreements/agreement-versions.constant.ts`；总纲 §3 里写的 `CustomerRegister.tsx:93` 指针**已失效**——该文件的 `TERMS_SECTIONS` 随波三退役，客户端零正文硬编码）；历史版经 `GET /client/agreements/me` 的 `previous` 键可读。DSR 工单若要"记下引的是哪一版"，客户当时同意的版本在 `customer_agreement_consents`（`versionKey` + `actedAt`）。
17. **审批策略数与事件监听器**：maker-checker 策略现 51 条（`verify:rbac` S5 逐条验过），`ApprovalHandlerBase` 子类 47 个，审批四事件各 52 个监听器（见新事实 9）——再加一条策略的成本不只是"MAKER_GROUP_BY_POLICY 加一行"，还会把已超限的监听器数再推高一个。
18. **云端 `cloud:deploy` 账**：按既有账本口径丙波一、二未部署（本次**未核云端 `DEPLOYED_VERSION`**，边界）；波三带来 `demo.env.template` 的 `TZ=Asia/Dubai` 新行，**下次部署才生效**，部署后须核通知生效日与页面日期一致。合并 main 后另须：重启后端 + `npm run db:base:sync`（新增 admin 端点权限字典，否则 403）+ `stack.sh reset main`（动过 schema / seed；亦清 T9 事故留在 main 库里的探针行）。

## 已定事实（总纲 §1 岔口 1/2 + §2 波四行 + §3 波四，2026-09-30～10-02 业主已拍，展开时直接引用，不再论证）

1. **都收，做薄**（总纲 §1 岔口 1）：statements 与 DSR 都做，各自薄——月结单借既有 statement 读模型（`customer-statement.service.ts` + `GET /client/portfolio/statement`）加"按月定版"；DSR = 请求工单 + DPO 处置留痕。BD 盘点"三役后无主缺口"警告就此解除。
2. **波四范围（总纲 §2 波四行）**：做 = 月度对账单（借 statement 读模型按月定版，客户端可翻历史月份）+ DSR 请求工单（客户端发起、DPO 经办、状态机 + 全程留痕）；不做 = 对账单 PDF 真渲染以外的花活按波 spec 裁、DSR 真删数据（出口形态波内裁）；验收口径（粗）= 客户端翻出上月对账单截图 + 一张 DSR 工单走完全程留痕；量级 = 中，DSR 若涉真改 / 删客户数据，波 spec 时定升档。
3. **监管依据（2026-10-02 一手核实）**：VARA CRM **IV.D.2**——客户资金月结单须于结单日后 **25 天**内出具；Custody III.D.4 有月度虚拟资产对账单（本司仅 BD 牌照，是否适用波内裁）。
4. **月结单定版形态**：快照 or 按月重查——⚠️判例在案：**实时快照不可批量补拍**（乙波三 t11-05）；种子若要预铺历史月份结单，须想清"补拍"在时间轴上的合法性（月结单是"某月末那一刻的账"，事后拍不出当时的余额）。
5. **DSR 三种请求（查 / 改 / 删）各自结局**：「删」演"因监管留存义务部分拒绝"——条款原文已写着 erasure subject to retention obligations（现位置见前提变化 16），是现成的戏；DSR 请求**经不经审批链**（DPO 独办 or maker-checker）待定（见岔口）。
6. **设计红线（总纲 §4，全战役）**：① 客户可见状态跟着钱走，tipping-off 不可区分（`decisions.md:122`）——月结单内容口径同受约束；② 客户端接口层 tipping-off 收口缓做在案（`decisions.md:11`）；③ **客户真经历过的余额变动必须可见、内部调查信息不外露**（`decisions.md:65`）——月结单内容口径的既定立场；④ 铁律①操作必留痕：DSR 处置入审计。
7. **通知**：月结单"已出"通知非硬依赖，可吃波一产出（见前提变化 15）；**DSR 引条款原文宜在协议之后**——此前提已满足（波三已合）。
8. **演示承接点（总纲 §6）**：月结单承接第六幕（账对）的客户端流水场景；DSR 自开新场景（排第十一幕，见前提变化 12）；tipping-off 反面走查（Carol / Jack / Grace / Frank "客户面看不出来"）在月结单上线后补一步"月结单不泄露内部调查信息"。
9. **不做（继承全战役）**：真发邮件、模板编辑器、话术逐条预审（`decisions.md` 2026-09-30 三否决）；CRS / CARF 税务报送归丁（总纲 §1 岔口 8）；营销发布门判不做。

## 待定岔口（展开脑暴用）

1. **月结单定版形态**：月末快照落库 vs 按月重查读模型——快照回答"某月末那一刻的账"，重查回答"现在看某月的账"；种子历史月份预铺的合法性（已定事实 4 的判例）。
2. **月结单的月份边界与出具时刻**：迪拜业务日（`toBusinessDate`）切月？结单日后 25 天内出具如何在系统里体现（出具时刻字段？还是"月结后即出"）？客户端怎么翻历史月份？
3. **月结单内容口径**：流水 + 余额 + 费用逐笔？冻结 / 受限客户的月结单与普通客户一字不差（tipping-off，已定事实 6）？余额恒等（"行能加出余额"，语义合同 S23）怎么保？
4. **月结单有没有"出具单据"属性**：像波二确认单那样是出具并留存的文件（三性：一单一张 / 只写一次 / 事务后置出具），还是仍是读模型的视图？这决定要不要新主体 / 新表。
5. **DSR 经不经审批链**：DPO 独办（最薄）vs maker-checker（"删 / 部分拒绝"是有后果的处置，可能该有第二双眼睛）；经办人与桶挂靠（见前提变化 14）。
6. **DSR 三请求的出口形态**：查——导出什么（文件？页面？）；改——真改客户主数据 or 仅登记；删——**"因监管留存义务部分拒绝"**的结局要不要有"部分删"的真动作；总纲 §2 已写"DSR 真删数据（出口形态波内裁）不做"。
7. **DSR 的 SLA**：条款原文写 DPO "within 30 days"（v1/v2 第 VI 节）——系统要不要给 DSR 工单挂钟（对照投诉双钟、报送单 deadline）？接闹钟墙？
8. **DSR 引条款**：工单要不要结构化记"引的是第几版第几节"（前提变化 16）还是自由文本？
9. **演示场景编号与演员**：第十一幕下的场景 34 起各挂哪（月结单一幕？DSR 一幕？）；演员点名先对 `script.md` 查别幕当事人（新事实 11）。
10. **升档**：DSR 若涉真改 / 删客户数据，plan 点名评审升档（总纲 §2 已写）；月结单若新增主体且动出具链，是否同样升档。
