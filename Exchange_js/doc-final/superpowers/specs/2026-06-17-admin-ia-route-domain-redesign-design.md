# Admin IA & Route-Domain Redesign — Design Spec

> Status: design / approved-for-spec-review (brainstorm done 2026-06-17)
> Scope: **admin-web 前端路由 + 侧边栏菜单 only**。无后端、无 RBAC 权限码改动。
> Goal (用户选定 C): 开发期、领域整洁 + 路由一致、为继续建服务。

---

## 1. 目标与判定线

把 admin 的**信息架构(菜单分组)**和 **URL 命名空间**收敛成同一套干净的领域模型，让 dev "看菜单知代码、看 URL 知领域"。

**范围判定线(硬规则)：侧边栏菜单可见 = 本轮重构；非侧边栏路由页 = 老旧待清，本轮不碰**(清单见 agent memory `admin-legacy-pages-to-clean`)。

## 2. 核心不变量

1. **单一根 `/admin/`**。auth 页 `/admin/login|activate|mfa-binding|reset-password` **冻结不动**——`activate`/`reset-password` 是后端发邮件拼的链接(`users.service.ts:60,69`、`admin-invitations.service.ts:86`，`${ADMIN_URL}/admin/<path>?token=`)，改它们会漏到后端，违反"仅前端"。
2. **1:1**：侧边栏一级组 = 一个领域 slug = 一个路由命名空间 `/admin/<domain>/<resource>`。
3. **config vs records**：assets(资产+限额)、pricing(费率) = 前置配置；trading、funds = 交易/结算记录。
4. **干掉 4 个旧根**：`/dashboard`、`/exchange`、`/funds-layer`、`/ledger`(仅就**菜单页**而言；非菜单 legacy 页暂留旧根，待清理轮删除后旧根自然消失)。

## 3. 领域 taxonomy(14 组)

| # | slug | 菜单组 | 备注 |
|---|---|---|---|
| 1 | `iam` | Identity & Access | |
| 2 | `customers` | Customers | material/refresh 归此 |
| 3 | `compliance` | Compliance | |
| 4 | `trading` | Trading | +payins/payouts/quotes |
| 5 | `funds` | Funds & Settlement | +outstandings/fee-accruals |
| 6 | `custody` | Custody | 原 Treasury 改名 |
| 7 | `assets` | Assets & Limits | |
| 8 | `pricing` | Pricing | 仅费率 |
| 9 | `reconciliation` | Reconciliation | 纯 safeguarding |
| 10 | `ledger` | Ledger | |
| 11 | `governance` | Governance | |
| 12 | `audit` | Audit | |
| 13 | `registries` | Governance Registries | 内容不动，仅对齐路由 |
| 14 | `counterparty` | Counterparty | 内容不动，仅对齐路由 |

## 4. 完整旧→新路由映射(仅菜单页 + 其 detail/create/edit 子路由)

> 规则：每个 list 的 `:id`/`:code`/`:no` 等子路由随 list 同步迁移(下表省略逐条 `:id`，按前缀整体平移)。

### iam
| 旧 | 新 |
|---|---|
| `/dashboard/members`(+`/:id`) | `/admin/iam/members` |
| `/dashboard/members/roles`(+`/:code`) | `/admin/iam/roles` |

### customers
| 旧 | 新 |
|---|---|
| `/dashboard/customer/management` | `/admin/customers` |
| `/dashboard/customer/:id` | `/admin/customers/:id` |
| `/dashboard/compliance/material-management`(+`/:holdingId`) | `/admin/customers/material-holdings` |
| `/dashboard/compliance/refresh-cycles`(+`/:cycleId`) | `/admin/customers/refresh-cycles` |

### compliance
| 旧 | 新 |
|---|---|
| `/dashboard/compliance/sumsub-events` | `/admin/compliance/sumsub-events` |
| `/dashboard/compliance/risk-assessments`(+`/:assessmentId`) | `/admin/compliance/risk-assessments` |

### trading
| 旧 | 新 |
|---|---|
| `/exchange/deposit-transactions`(+`/:id`) | `/admin/trading/deposits` |
| `/exchange/withdraw-transactions`(+`/:id`) | `/admin/trading/withdrawals` |
| `/exchange/swap-transactions`(+`/:id`) | `/admin/trading/swaps` |
| `/dashboard/treasury/payins`(+`/:id`) | `/admin/trading/payins` |
| `/dashboard/treasury/payouts`(+`/:id`) | `/admin/trading/payouts` |
| `/dashboard/pricing/withdraw-quotes`(+`/:id`) | `/admin/trading/withdraw-quotes` |
| `/dashboard/pricing/quotes`(+`/:id`,`/:business/:id`) | `/admin/trading/swap-quotes` |

### funds
| 旧 | 新 |
|---|---|
| `/funds-layer/transfers`(+`/:internalTxNo`) | `/admin/funds/transfers` |
| `/funds-layer/funds`(+`/:internalFundNo`) | `/admin/funds/internal-funds` |
| `/funds-layer/settlements`(+`/:batchNo`) | `/admin/funds/settlements` |
| `/dashboard/reconciliation/outstandings`(+`/:id`) | `/admin/funds/outstandings` |
| `/dashboard/reconciliation/fee-accruals`(+`/:id`) | `/admin/funds/fee-accruals` |

### custody
| 旧 | 新 |
|---|---|
| `/dashboard/treasury/custodian-wallets`(+`/:id`) | `/admin/custody/wallets` |
| `/dashboard/treasury/withdrawal-addresses`(+`/:addressNo`) | `/admin/custody/withdrawal-addresses` |

### assets
| 旧 | 新 |
|---|---|
| `/dashboard/system/assets`(+`/create`,`/:assetNo`,`/:assetNo/edit`) | `/admin/assets` |
| `/dashboard/system/transaction-limits`(+`/:policyNo`) | `/admin/assets/transaction-limits` |

### pricing
| 旧 | 新 |
|---|---|
| `/dashboard/pricing/withdrawal-fee-levels`(+`/:levelCode`) | `/admin/pricing/withdrawal-fee-levels` |
| `/dashboard/pricing/swap-fee-levels`(+`/:levelCode`) | `/admin/pricing/swap-fee-levels` |

### reconciliation
| 旧 | 新 |
|---|---|
| `/dashboard/reconciliation/safeguarding-breaks`(+`/:id`) | `/admin/reconciliation/safeguarding-breaks` |
| `…/safeguarding-warnings`(+`/:id`) | `/admin/reconciliation/safeguarding-warnings` |
| `…/safeguarding-runs`(+`/:id`) | `/admin/reconciliation/safeguarding-runs` |
| `…/safeguarding-fiat-statements`(+`/:id`) | `/admin/reconciliation/safeguarding-fiat-statements` |

### ledger
| 旧 | 新 |
|---|---|
| `/ledger/accounts`(+`/:id`) | `/admin/ledger/accounts` |
| `/ledger/transfers`(+`/:tbTransferId`) | `/admin/ledger/transfer-evidence` *(改名避免与 funds/transfers 撞词)* |
| `/ledger/account-statement` | `/admin/ledger/account-statement` |

### governance
| 旧 | 新 |
|---|---|
| `/dashboard/control-gates/approvals`(+`/:id`) | `/admin/governance/approvals` |
| `/dashboard/governance/approval-policies` | `/admin/governance/approval-policies` |

### audit
| 旧 | 新 |
|---|---|
| `/dashboard/audit/audit-logs`(+`/:id`) | `/admin/audit/logs` |
| `/dashboard/audit/evidence-exports`(+`/:id`) | `/admin/audit/evidence-packages` |

### registries(仅平移，内容不动)
`/dashboard/governance/registries/*` + `/dashboard/governance/regulatory-gates/*` → `/admin/registries/*`

### counterparty(仅平移)
`/dashboard/system/liquidity-providers/*` + `/dashboard/system/liquidity-config/*` → `/admin/counterparty/*`

### Overview / 顶级
| 旧 | 新 |
|---|---|
| `/dashboard`(index) | `/admin`(index) |
| `/` → `/admin/login` | 不变 |
| `*` → `/` | 不变 |
| `/forbidden` | 不变 |
| 登录后跳转 `/dashboard` | 改为 `/admin` |

## 5. 资源重命名(整洁化，随迁移一并做)

去冗余/对齐 label：`deposit-transactions→deposits`、`withdraw-transactions→withdrawals`、`swap-transactions→swaps`、`custodian-wallets→wallets`、`audit-logs→logs`、`evidence-exports→evidence-packages`、`customer/management→customers`、`material-management→material-holdings`、`funds(funds-layer)→internal-funds`、`ledger/transfers→transfer-evidence`、`pricing/quotes→swap-quotes`。
> 备选：若想最小化 nav 改动，可"仅改前缀不改 resource 名"。本 spec 默认做重命名(更整洁，符合 goal C)。

## 6. 路由树重构机制(App.tsx)

现状：`<Route element={RequireAuthenticated+DashboardLayout}>` 下挂 4 个并列前缀组 `/dashboard`(L249)、`/exchange`(L871)、`/funds-layer`(L906)、`/ledger`(L933)。

改法：在同一 wrapper 下**新增 `<Route path="/admin">` 组**，把上表所有**菜单页**路由按新 resource 迁入。旧 4 组的处置(精确)：
- `/funds-layer`、`/ledger`：其下**全是菜单页**，迁完即**空 → 整组删除**。
- `/exchange`：保留 `internal-transactions`(legacy)；deposit/withdraw/swap 迁走。
- `/dashboard`：保留所有非菜单 legacy 页(cdd-edd/tx-compliance/risk-policy-executions/Wave8 运营页/config-release 簇/死页)；菜单页迁走。
- 两个残留旧根(`/exchange`、`/dashboard`)待清理轮删除其 legacy 页后自然消失。

auth 4 页保持为 wrapper 外的独立 `<Route path="/admin/...">`(与 `/admin` 父组无冲突，slug 不撞 login/activate/...)。

## 7. 内部导航迁移(blast radius)

`navigate()`/`<Link to>`/`<Navigate to>` 指向被迁移菜单页的旧路径，全部按上表更新。实测引用量(nav 上下文)：`/dashboard/` 182、`/exchange/` 19、`/funds-layer/` 17、`/ledger/` 9(含非菜单页，迁移只动菜单页那部分)。

机制：按 §4 确定性映射**逐域 search-replace**，每域改完即验。**不加永久 redirect**(goal C 不留 cruft)；若验证阶段发现漏改风险高，临时加 old→new `<Navigate>` 兜底、迁完移除。

## 8. Overview / 首页(待定项)

菜单 "Overview" 现指向 `/dashboard` index = `Wave8OpsDashboardPage`，而该页在 `admin-legacy-pages-to-clean` 清单上。本 spec **暂保留**它渲染于 `/admin` index(不破坏首页)，新 landing 留清理轮设计。

## 9. 不在本轮范围(Out of scope)

- 非侧边栏 legacy 页(死页/legacy/config-release 簇/Wave8 运营页/部分 live 的 cdd-edd/tx-compliance/risk-policy-executions)→ 见 `admin-legacy-pages-to-clean`，清理轮处理。
- 后端 controller 路径、RBAC catalog、permission code：**全部不动**。
- funds-layer dual-writer、internal-* 收口、schema 死列等(见 `tier0-cleanse-2026-06-17`)。

## 10. RBAC 边界(已知债)

permission code(`api.get.admin_<olddomain>_*`)**不改**。后果：改路由后"URL ≈ 权限码"的镜像约定断裂(如 URL `/admin/funds/outstandings`，权限码仍 `admin_reconciliation_outstandings`)。功能无碍(权限码是 opaque 串，`withPermission`/`hasAnyPermission` 按串匹配)，记为技术债。

## 11. 验证计划(闭环)

1. `cd admin-web && npx tsc -b` = exit 0
2. `npm run build` = exit 0
3. grep：被迁移菜单页的旧路径(`/dashboard/<moved>`、`/exchange/<moved>`、`/funds-layer/*`、`/ledger/*`)在 nav 上下文残留 = 0
4. **渲染验证**(用户标准：截图非 tsc)：登录 `/admin`，逐组点开侧边栏，截图侧边栏 + 抽查 3-4 个域 list→detail 跳转正常(branch 栈 3501)
5. 旧根 `/dashboard|/exchange|/funds-layer|/ledger` 仅余 legacy 页可访问(不报错)

## 12. 风险

- blast radius 大(~180+ nav 点)，逐域改 + 逐域验证降险。
- 菜单(DashboardLayout)与路由(App.tsx)必须**同改**，否则菜单链接断。
- 旧路径 bookmark 失效(dev 工具、goal C 下可接受)。
- 迁移后与 legacy 页的交叉链接(如 SafeguardingBreakDetail→compliance/alerts)指向旧路径——目标本就是待删 legacy，交叉链接留待清理轮一并处理。
