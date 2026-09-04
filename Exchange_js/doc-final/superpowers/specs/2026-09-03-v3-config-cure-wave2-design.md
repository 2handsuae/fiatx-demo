# V3 财务配置治愈 · 波二「行为与判据」—— 骨架

- 日期：2026-09-03
- 性质：**骨架，不是 spec**。按 `CLAUDE.md §6`，只留已定事实与岔口；波一收尾时由那一波**只**把「承接波一」写进本文开头；展开写细由波二开工的新会话读总纲 + 承接 + 本骨架后跟业主脑暴完成，再进 writing-plans
- 总纲：`2026-09-03-v3-config-cure-waves-outline.md`（本波边界与验收口径以总纲为准，不在此重抄）
- 素材：`checkups/2026-09-03-v3-five-modules.md` 里划给波二的项（法一补全 / 治疗单）；`decisions.md` 2026-09-03 四条

## 承接上一波（波一）

波一 16 个任务全部完成，2026-09-04 快进合并进 main（46 commit，184 文件，+5716/−6830）。合并后 main 上闸门全绿：`verify:rbac` / `verify:act1` 14+1 / `demo:all` asserts 5/5 / `verify:coa` 57 科目无负余额 / `verify:audit` / `verify:demo-data`。

**实际偏差（计划与现实不符，共 6 处，全部当场订正）**
1. plan 的闸门顺序把 e2e 排在 `demo:all` 之后同库跑——`demo:all` 花名册会永久制裁 `withdraw-money-arcs` 的夹具客户，该套件必红。`demo/baseline.md` 本就要求 e2e 干净态起跑，是 plan 写错。已改为 e2e 前单独 reset。
2. plan 的 Task 8 指错文件（写 `withdraw-transactions.service.ts`，实际在 `withdraw-workflow.service.ts`）；同一个错在 `PRODUCTION-NOTES:49` 也有一份，一并订正。
3. plan 的「最后一个默认档」退役守卫只在请求时查，两步操作可绕（非并发问题）。已改为落地时复检。
4. plan 说桶数 50→49，实际 **52→51**（对账域在波一开工前就从 2 桶涨到 4 桶、无人记录；波一自己只退役 1 桶）。
5. plan 说本波新增退役审计码 20 个，实际 **16 个**（6 资产 + 6 钱包 + 4 限额）。
6. plan 要求把体检标签下本波已做的六项在 BACKLOG 标结案，实际全文件只有 1 条带该标签、且是业主定的"本轮不做"项，正确保持开着。

**执行中发现的新事实**
- **资产暂停的后端硬门根本不存在**（业主已拍板划给波二，见 0.2）：spec 与模块篇都写「暂停 = 三条路的资产门当场关」，但 16 个任务没有任何一个任务点去建它。三处实证：`swap-transactions.service.ts:159-168` / `withdraw-workflow.service.ts:257-258` / `inbound-transfer-signals.service.ts:582` 均只判资产存在不判 `status`。唯一生效机制是三个客户端页面共读 `GET /assets?status=ACTIVE`，故 UI 走查演得通、绕过前端打 API 畅通。模块篇已按实况订正。
- **这类缺陷逐任务评审天然抓不到**：14 轮任务评审逮出十几个真缺陷，全是"写了但写错"，没有一个是"该写没写"——承诺没有代码就不产生 diff。终审专门按这条去找，又逮到 3 个同类（站 4 审计搜索、审批策略标签表、费率两族差异未入册）。**波二收尾的终审应保留这一问。**
- **`verify:rbac` 从 1 条自批判据长成 4 条**：S5（无永久死锁，28 条策略）/ S5b（登记项仍是真死锁）/ S5c（maker≠checker，22 查 + 6 豁免）/ S5d（豁免项仍真实重叠），另有 S8（表↔策略一一对应）、S9（裁决人持详情页读权限）。**判例：每张手工维护的豁免表都必须配伴生断言**——本文件三张表全是漏了才被评审补上的。
- **七个 `*_SEEDED` 审计码上岗**，业务种子 actor `RELEASE` / 演示造数 `DEMO_SEED`；`verify:demo-data` 新增 R5 按业务键 join（非计数），对重铺漂移免疫、空块也报违规。
- **业主中途拍板修掉一条既有治理死锁**：`ADMIN_ROLE_BINDING_CHANGE_APPROVAL` 曾因 `IAM_ROLE_ASSIGN` 与裁决人同为 CISO 而永远走不完；选甲案给 TECH_OFFICER 加该权限组，实证技术官提单 201、无权限角色仍 403。该策略随之登记进 P2 豁免表（同 `ADMIN_INVITE_APPROVAL` 理由）。
- **合并进 main 的两条运维硬前提**（已写进 `demo/baseline.md`）：① 首次重铺前必须 `rm -f /tmp/exchange_js_main/dev.db`，否则迁移 `20260903125954` 在非空 wallets 上撞 NOT NULL 而中止（终审带对照组证过）；同一条 rm 顺带让 main 上恒红的 `verify:audit` 不变量③ 转绿。② 主工作树的 Prisma client 是旧 schema 生成的，重铺前须先 `npm run prisma:generate`，否则种子类型检查崩（本次实际撞上）。

**本波前提有无变化**
- 骨架 0.1 第 2 条「波二在波一的新结构上做，不回头改结构」**成立**：五块结构已落终态，三条退役路径在代码层真的没了（`WALLET_WRITE` / `ASSETS_CREATE` 全仓零命中，退役端点在任何控制器上都不存在）。
- 骨架 0.1 第 1 条的波二范围**新增一项**：资产暂停硬门（业主 2026-09-04 拍板划入）。

## 0.1 已经定了的（有出处，不翻案）

| # | 事实 | 出处 |
|---|---|---|
| 1 | 波二范围 = 法一补全（被拦下留痕、客户动作 actor、requestId 17 处、落地行 from/to）+ 治疗单（按钮权限门控、倒计时走秒、客户端提现页假规则文案、`/dashboard` 旧树、死 import）+ `verify:act1` 扩 V3 行为判据 + 站 2 / 4 / 5 定稿 + 「合并进 main 必重启 + sync」入章程 | 总纲波次表 |
| 2 | 波二在波一的新结构上做，不回头改结构 | 总纲：两波边界 = 改「数据是什么」还是「行为对不对」 |

## 0.2 还没定的岔口（展开时跟业主拍板）

| # | 岔口 | 背景 |
|---|---|---|
| 1 | **资产暂停硬门做成什么形状**：三处各写一道 `status !== 'ACTIVE'` 拒绝，还是抽一个共享守卫？拒绝时留不留痕、留什么码？客户端要不要给出理由文案（现在是"静默消失"）？ | 业主 2026-09-04 拍板划入波二；BACKLOG 有条目 |
| 2 | **e2e 闸门口径**：是冻结的 11 套，还是 `test/` 下全部？现有 18 套，7 套在闸门外（含 `recon-adjustment-money-arcs`，而 baseline 自己另一段又引用它）。若改全量，需先确认新增 7 套各自的跑法前置 | TOOLING-DEBT 有条目 |
| 3 | **徽章色板修不修**：`tailwind.config.js` 的 `adm-*` 不走透明度修饰符格式，全站 583 处 `bg-adm-*/N`、`border-adm-*/N` 不产生任何 CSS，徽章只靠文字与圆点区分。修法要两步（CSS 变量改存 "R G B" 三元组 + config 改 `rgb(var(--x) / <alpha-value>)`），是全站视觉改动 | BACKLOG 有条目；波一 T12 评审实证 |
| 4 | **兑换实时报价拿不到客户身份**（非波一引入，2026-03-13 起就是）：VIP 客户打字时看到默认档价、确认才跳对价，正砸在站 2 的对照节拍上。修控制器补 `@Request()` 即可，但要先确认客户令牌的 `userId` 与 `resolveBestLevel` 期望的 `customerId` 是否同值 | BACKLOG 有条目；波一 T16b 走查实测 |

## 展开时要核的事实（写 plan 前抽查复现）

波一动过下列位置，波二写 plan 前请**在当时的 HEAD 上重新 grep 确认**，不要照抄本文行号（波一自己就三次栽在快照过期的行号上）：

| 要核什么 | 波一收尾时的位置 |
|---|---|
| 三条交易路的资产查找（波二要加状态门） | `swap-transactions.service.ts:159-168`、`withdraw-workflow.service.ts:257-258`、`inbound-transfer-signals.service.ts:582` |
| 兑换实时报价端点（岔口 4） | `swap-transactions-customer.controller.ts:129-146`，全仓唯一调用 `getExecutableRate` 处 |
| `verify:audit` 手抄的退役码清单 | `scripts/verify-audit.ts:82-99`——**没有 import `DEPRECATED_AUDIT_ACTIONS`**，与源手工重复，今天恰好一致但无断言约束；同族的 `verify-rbac.ts`/`verify-act1.ts` 都是直接 import 源常量 |
| S9 手抄的前端路由表 | `verify-rbac.ts` 的 `DETAIL_READ_GROUP_BY_POLICY` 手抄 `ApprovalDetailPage.tsx` 的 `ENTITY_ROUTE_BY_ACTION`，两边键集当前相等（23=23）但无断言 |
| 死代码 | `AssetProvisioningService.provision()` 零调用方但仍注册为 provider（`assets.module.ts`），spec 原意是"留着只给种子调"，实际种子只 import 纯函数 `systemAccountCodesFor()` |
