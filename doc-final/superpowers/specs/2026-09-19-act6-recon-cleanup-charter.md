# 第六幕「账对」清残留战役 · 总纲

> 立于 2026-09-19 ｜ 基线 main `e7a8a1b1` ｜ 依据：`superpowers/checkups/2026-09-19-act6-recon-checkup.md`（红级与否定性结论均经主会话复现，可信度分层见该报告附录）
> 体检做在 `c14cc1b7`，其后 6 个 commit 全是仓库迁址与 CLAUDE.md 改稿（`git diff --name-only c14cc1b7..e7a8a1b1` 对 `clearing-settle` / `incidents` / `internal-transfers` / `admin-web` / `prisma` / `scripts/recon` **零命中**），故体检的每条结论在本基线上原样成立。
> **本文件活到最后一波**；各波 spec 逐波归档，回看以此为锚。每波收尾按 `rules/delivery-checklist.md` 往下一波 spec 骨架写承接记录，并回写本文件状态行。

**状态**：波一 **已完成**（2026-09-19，worktree-act6-wave1 分支自 `0a7c9b82` 起 Task 0–9 共 11 commits，9 任务 + 1 处主会话注释还原；闸①②③ + 对账三域 jest 28 suites/553 tests 全绿；变异实证闸① 能红（gate-before 绿 vs gate-after 红）、栈级输出归一 diff 两份均空——物证在 `checkups/2026-09-19-act6-wave1-evidence/`）｜ 波二 待开（骨架与承接已立：`2026-09-19-act6-wave2-skeleton.md`）｜ 波三 待开 ｜ 波四 待开 ｜ 波五 待开

## 0. 目标

第六幕的业务逻辑已经立住了（体检逐项核过：五桶 / 账龄 / 小额线 / 三轮匹配 / 内部恒等预门 / 审批链 / 记账边界全部与文档一致，31 条端点零死路由，铁律 ①②⑤⑥ 无违例，555 个单测全绿）。**本战役不碰业务，只清债。**

要清的债是**一条因果链**，不是一堆孤立缺陷：

> 对账域没有主体服务层 → Case 的状态写点散在 3 个文件、无显式迁移表 → `getCase()` 涨到 414 行 / `run()` 329 行 / 案件页 1893 行 → **137 处 `as any` 让闸① 对整个数据层失明** → 域内唯一该兜底的那条断言在 TypeScript 下**恒真、不可能红** → 于是一根**全仓零写入**的列一路走到屏幕上，让每条在途差异行的时间列恒显 `01-01 04:00`（剧本场景 1 第一眼），18 场景演了 10 波无人发现。

**战役级成功判据**（末波收尾逐条验）：

1. **闸门能咬人**：对账域 `(this.prisma as any)` 归零；变异测试实证——故意改一个 Prisma 列名，闸① 必红（现在不会）
2. **测试的绿来自行为**：体检点名的 3 条恒真断言全部换成能红的断言，各带一次变异实证
3. **屏上无假数据**：第六幕五页逐页截图，无 epoch 时间、无恒空字段、无点了必空的筛选项
4. **主体边界立起来**：Case 有自己的服务与显式迁移表，`status` 写点收敛；对账域 workflow 零直写表
5. **记账日期按迪拜 COB 切**：7 处改完，重铺闸 + `verify:coa` 全绿
6. **文档与代码对得上**：体检点名的 5 处数字腐烂清零，`modules/v8-recon.md` 与代码逐数复核

## 1. 明确不做（业主 2026-09-19 定：清残留，新功能下周另起）

- **不加任何新业务出路**：无主入金超期退回付款方 ｜ 兑换来源行的冲正 / 冲销码 ｜ 数据完整性闸与 `HELD` 态 ｜ 流水 match tag 结转 —— 全部留给下周的新功能轮
- **不做对账复核签核**（业主 2026-09-19 拍板，`decisions.md` 同日条目，**已否决、不翻案**）：动钱的八类处置本就是金库开单 → CFO 批两个人，事故结案是 MLRO → CFO 两步；本条要加的是在这之上再挂一层。推单与挂起两种维持一人完成、不送审。捆绑的「干净 run 自动认证」一并不做
- **不改剧本主线**：18 场景不拆主线 / 深潜档，第六幕结尾不加「重大未纠正差异升事故报监管」那段讲法 —— 这两件都是下周新功能轮的事
- **不碰 §G 分诊里判「缓」的 9 条**（体检报告 §G 分诊表，业主 2026-09-19 认可这一刀）：理由是模拟数据触发不到，要做需业主给新事实
- **照 CLAUDE.md §2 一律不做**：幂等 / 去重 / 重试回放 / 补偿 repair / 并发锁 / 向后兼容 / 权限加固 / 输入防御性校验 / 性能优化 / 边界防御

## 2. 跨波口径（各波 spec 直接引用，不重议）

- **数据随时可重铺**（§3）：schema / 口径改动直接按目标终态做，迁移文件照常新增以保证空库能建起，**禁止 backfill / 兼容层 / 双写过渡**；改完 = reset 重铺
- **删码判据**：判「某列 / 某导出是死的」必须同时搜 `src`（非 spec）与 `admin-web` **两侧**，并给 ≥2 种搜法——`as any` 让 tsc 不会替你发现读写断链，这是本域死码的成因
- **测试判据**（§7）：绿必须来自行为。禁止「扫源码文本」型断言，也禁止本域已出现的两种恒真形态——① **返回类型即断言集合**（`expect(validSet.has(fn()))` 而 `fn` 的返回类型就是那个联合）② **mock 原样回显**（自建假 prisma，create 返 `{...data}`，再断言回显值等于刚塞进去的值）
- **行为零差异的验收方式**：结构重构波以 `demo:all` + `recon:demo:break` 的**栈级输出 diff** 作闸——这是 `as any` 与 mock 逃逸之下唯一咬得住的闸（判例：2026-09-13 波四）
- **改了前端必须起 preview 渲染 + 截图**，tsc 过不算数（`delivery-checklist` 两条永不豁免之一）
- **动了钱必须 `verify:coa`**（同上第二条）；注意负余额断言是「起点缺一笔」类事故的唯一探针，不能因四条恒等式绿就放行

## 3. 波次

| 波 | 边界（做） | 明确不做 | 验收口径 |
|---|---|---|---|
| **一 · 闸门复位** | 对账域 137 处 `(this.prisma as any)` 摘净（`src/modules/clearing-settle/**` + `governance/incidents/**` + `asset-treasury/internal-transfers/**`）｜ 3 条恒真断言换真断言（`bucket-classifier.spec.ts` 的 180 组网格 + `reconciliation-case-idempotent-fields.spec.ts` 两个用例，后者 67 行零 import、整份考虑删） | **零行为变更**——不删列、不改 UI、不动业务分支；trading 等其它域的 `as any`（223 处）不在本波 | 闸①②③ 全绿 ＋ **变异实证**：随便改一个对账域 Prisma 列名，闸① 必红；3 条断言各做一次变异（破坏被测行为 → 断言必红）｜ jest 对账域全绿 ｜ `demo:all` + `recon:demo:break` 栈级输出与波前逐字节 diff = 空 |
| **二 · 清死物** | 红 3 `externalTimestamp`（写或退役，二选一，不做兼容）｜ 12 根死列 ｜ 3 个彻底死导出 + 35 个多余 `export` ｜ 两个幽灵筛选项（`WAIVED` / `PENDING_RECHECK`）｜ **运营收回 `INTERNAL_TRANSFER_READ`**（业主 2026-09-19 定）＋ 同改 `FundsOrderDetail.tsx:163-168` 那条无条件渲染的关联链接（否则造幽灵链接，见 §5）｜ External Balances 被划转回单劫持到「今天」 | 不重构结构、不动 Case 主体、不碰业务日 | 第六幕五页逐页截图：无 epoch 时间 / 无恒空字段 / 无点了必空的筛选项 / External Balances 打开即是铺场那天的全量 ｜ 重铺闸（动了 schema）｜ `verify:coa` ｜ 权限改动三件套：`db:base:sync` ＋ **重启后端** ＋ `verify:rbac` 全绿；并以 `ops_officer@` 实登一次核验——侧栏无 Internal Transfers、资金单详情页无那条关联链接 |
| **三 · 主体分层** | Case 立主体服务 + 显式迁移表（照 `adjustment-transitions.constant.ts` 先例），`status` 写点从 3 文件收敛 ｜ 拆 `getCase()` 414 行、`run()` 329 行、`buildFlowComparison()` 198 行 ｜ 铁律③ 直写一处（`internal-transfer-workflow.service.ts:130`）｜ `dispositionsFor()` 六格补齐硬边界（`AMOUNT_MISMATCH×FIRM` 漏查 `sourceAdjustable`）｜ 抽 `walletRef→walletNo`、`decimals` Map 两个重复 helper | 不动前端、不动业务日、不新增任何状态或边 | `demo:all` + `recon:demo:break` 栈级输出 diff = 空（**行为零差异是本波唯一硬判据**）｜ `verify:coa` ｜ 新迁移表被真实调用（不是摆设）——变异实证：构造一次非法跃迁必须被显式拒 |
| **四 · 前端拆分** | `ReconciliationCasesDetailPage.tsx` 1893 行拆分 ｜ `ReconciliationAdjustmentCreateModal.tsx` 821 行 ｜ 前端自算业务判断收回后端（含 `rowAdjustmentPrefill().direction` 提现类缺翻符号，行号已漂到 `:330-337`）｜ 3 组重复块收敛 | 不改任何交互与文案、不改按钮矩阵的业务含义 | 第六幕五页 + 三个弹窗**逐页截图与波前比对，像素级同构**（文案 / 列 / 按钮组一个不差）｜ 闸②全绿 |
| **五 · 业务日迪拜 COB + 文档收口** | 业务日按迪拜 COB 切，**7 处**：两份 `toBusinessDate`（共享 util `business-date.util.ts:2` ＋ 对账编排私有重复件 `wallet-recon-run.service.ts:1055`——只改前者会留暗坑）＋ 四处硬写 UTC 日终（`recon-thresholds.constant.ts:26` / `effective-cutoff.ts:23` / `reconciliation-query.service.ts:923` / `push-order.service.ts:204,206`）｜ §G 剩余演示可见项：`INTERNAL_BREAK` run 详情空表、严重度跨资产不可比、推单页划转腿方向标签、`RECON_CASE_OPENED` metadata 的 UUID、`treasury/` vs `custody/` 前缀 ｜ 文档 5 处数字腐烂 + 手册附录重排（15 场景 10 案 → 18 场景 12 案）+ `CHANGELOG` 第 41/43 行去重 | 不引入倒计时 / 时限数字（条文未载，`decisions.md` 2026-09-06「不杜撰」）｜ 不做历史存量口径评估（§3 重铺） | **重铺闸**：`stack.sh reset main` 从零建库 → `demo:all` → `recon:demo:break`，判据对照 `demo/baseline.md` 全绿 ｜ `verify:coa`（恒等式 + 负余额）｜ 跨日切场景 9 按剧本实走，确认「下期自然平」的触发时点随 COB 移动 ｜ `modules/v8-recon.md` 与代码逐数复核 |

## 4. 顺序与依赖

**一 → 二 → 三 → 四 → 五，不可乱序。**

- **一必须最先**：它给后面每一波装上「改错了会红」的安全网。现在这张网不存在（tsc 对数据层失明 + 唯一的兜底断言恒真），**不先修它，后面四波全是蒙眼动刀**。这也是本战役唯一一条反直觉的排序——它对观众零感知，却是其余四波的前提
- **二在三之前**：先把死列死码删掉，三才不会去重构一堆本该消失的东西
- **三在四之前**：前端拆分要依赖后端读面契约稳定下来
- **五压最后**：它是全战役唯一**改变行为**的一波（记账日期口径），必须等前四波把地基弄干净、闸门能咬人之后再动；且它是唯一必须走重铺闸的一波

## 5. 业主已决（2026-09-19，无遗留待答）

- **运营侧栏那一页 → 收回权限**（业主原话「他不需要知道」）：`INTERNAL_TRANSFER_READ` 从 `OPS_OFFICER` 摘除，让剧本注③ 成立。补齐 2026-09-10 两角色定案的漏网一组。**已并入波二边界**
- **连带（同波必改，落笔前实扫得到）**：`FundsOrderDetail.tsx:163-168` 的「Internal transfer」关联链接**无条件渲染、无权限判断**，而运营持 `FUNDS_ORDER_VIEW`、场景 16/17/18 的划转腿他打得开——只收权限不改这里就是造一个新幽灵链接（点得到、点了被 `RequirePermission` 拒），正是 `delivery-checklist`「退役业务动作 → 前端入口同步删」那条。改法：该链接按权限条件渲染

## 6. 每波收尾必做（`rules/delivery-checklist.md` 多波行）

本波合并前，把「承接上一波」写进**下一波 spec 开头**：实际偏差、执行中发现的新事实、下一波前提有无变化。**只写承接，不展开下一波 spec**——展开是下一波新会话读本总纲 + 承接 + 骨架后跟业主脑暴的活。本波 spec 随即归档，不再被读。并回写本文件的状态行。
