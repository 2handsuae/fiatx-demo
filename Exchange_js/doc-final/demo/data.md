# 演示数据字典（data）

> 上半篇（管理员/客户矩阵/资产钱包/各脚本）手写，2026-08-26 实测盘点后维护。下半篇「本批数据」由 `demo:all` 收尾自动写入生成区（防漂移），别手改那一段。
> 重铺入口：`bash scripts/stack.sh reset [main|self]`（含 TigerBeetle 清理重建）；全量造数：`bash scripts/on-stack.sh main demo:all`（worktree 内用 self）。基线见 [baseline.md](baseline.md)。

## 管理员（base seed，8 职务各一人，密码 123456）

admin@fiatx.com 超管 ｜ sm@ 高管(SMO) ｜ ciso@ ｜ mlro@ ｜ dpo@ ｜ compliance_lead@ ｜ tech_admin@ ｜ ops_officer@ —— 一人一角色，SoD 演示直接换人登录。

## 客户矩阵（business seed，9 位，覆盖 8 种状态位）

| 客户 | 状态位 | 用来演什么 |
|---|---|---|
| Alice Happy | 快乐路径（真 Sumsub 沙盒 applicant） | 三条交易流程的主角 |
| Bob Happy | 快乐路径（mock applicant） | 备用主角/并行单 |
| Carol Silent | **制裁便签 · 静默**（lifecycle 仍 ACTIVE） | 零痕迹：管理台可见、客户端无感 |
| Dave Pending | 认证中 | 开户流程中段 |
| Eve New | 刚注册未认证 | 开户起点 |
| Frank HighRisk | 高风险 | 风险分层 |
| Grace Premium | VIP 费率等级 | 费率受众谓词 |
| Henry Acme | 企业客户 | 企业形态占位 |
| Ivy Restricted | **材料过期 · 明示受限** | 与 Carol 对照：明示 vs 静默 |

## 资产与钱包

USDT（链上，托管 HEXTRUST）＋ AED（法币，ZAND）；客户钱包按客户铺，平台侧 F_OPS/F_SET/F_FEE 等系统钱包；账本 TigerBeetle 9 码科目。

## 各脚本造什么

| 命令 | 产出 |
|---|---|
| demo:setup | 基础演示位（客户便签/材料请求账等） |
| demo:deposit / swap / withdraw | 各域多结局单（走真实流程推进） |
| demo:in-transit | 在途单（演示"正在发生"） |
| demo:all | 一键全量（花名册 21 笔逐条比对预期终态 + COA 四恒等式）——开演前跑这个 |
| recon:demo:pass / break | 对账 pass ／ 9 种破口+答案键（break 现漏检 2 种，BACKLOG 在案） |

⚠️ 造数铁律：一律走真实流程/模拟端点重放，**禁止直插表**（直插中间态 → 账本负余额 → 假破口，实证教训）。

## 本批数据（`demo:all` 最近一次实到结果）

<!-- GENERATED:BEGIN -->
> 本段由 `demo:all` 收尾自动写入（`scripts/demo-lib.ts → writeDataMdSnapshot`），别手改——下次跑 `demo:all` 会整段覆盖。生成时间：2026-08-30T12:59:50.877Z

### 充值（18 笔）

| # | 场景 | 客户 | 金额 | 预期终态 | 实到单号 | 实到状态 | 结果 |
|---|---|---|---|---|---|---|---|
| 1 | 充值 · 正常入账 USDT | demo_alice@example.com | 3000 USDT | SUCCESS | DEP2608300124 | SUCCESS | ✓ |
| 2 | 充值 · 正常入账 AED | demo_bob@example.com | 8000 AED | SUCCESS | DEP2608301816 | SUCCESS | ✓ |
| 3 | 充值 · 正常入账 AED（二） | demo_grace@example.com | 6500 AED | SUCCESS | DEP2608305852 | SUCCESS | ✓ |
| 4 | 充值 · 等客户补料 | demo_alice@example.com | 4200 AED | ACTION_PENDING | DEP2608305056 | ACTION_PENDING | ✓ |
| 5 | 充值 · 转人工复核 | demo_bob@example.com | 5100 AED | MANUAL_CHECKING | DEP2608300209 | MANUAL_CHECKING | ✓ |
| 6 | 充值 · 小额挂起 | demo_grace@example.com | 35 AED | OPERATION_PENDING | DEP2608301287 | OPERATION_PENDING | ✓ |
| 7 | 充值 · 制裁冻结 | demo_frank@example.com | 7300 AED | FROZEN | DEP2608306516 | FROZEN | ✓ |
| 8 | 充值 · 没收（钱进公司） | demo_grace@example.com | 42 AED | CONFISCATED | DEP2608301957 | CONFISCATED | ✓ |
| 9 | 充值 · 退回原发款方 | demo_alice@example.com | 2600 AED | RETURNED | DEP2608307471 | RETURNED | ✓ |
| 10 | 充值 · 上缴（政府移交） | demo_frank@example.com | 9100 AED | SEIZED | DEP2608304355 | SEIZED | ✓ |
| 21 | 充值 · FRANK 本金（供 #13 建单垫资） | demo_frank@example.com | 2000 AED | SUCCESS | DEP2608307396 | SUCCESS | ✓ |
| 22 | 充值 · 素材（Grace USDT） | demo_grace@example.com | 1200 USDT | SUCCESS | DEP2608309120 | SUCCESS | ✓ |
| 24 | 充值 · 素材（Jack AED 大额） | demo_jack@example.com | 5000 AED | SUCCESS | DEP2608309551 | SUCCESS | ✓ |
| 25 | 充值 · 素材（Jack AED 小额） | demo_jack@example.com | 1500 AED | SUCCESS | DEP2608306101 | SUCCESS | ✓ |
| 26 | 充值 · 素材（Jack USDT） | demo_jack@example.com | 400 USDT | SUCCESS | DEP2608305408 | SUCCESS | ✓ |
| 27 | 充值 · 素材（Kate AED 大额） | demo_kate@example.com | 4000 AED | SUCCESS | DEP2608307656 | SUCCESS | ✓ |
| 28 | 充值 · 素材（Kate AED 小额） | demo_kate@example.com | 1200 AED | SUCCESS | DEP2608303205 | SUCCESS | ✓ |
| 29 | 充值 · 素材（Kate USDT） | demo_kate@example.com | 350 USDT | SUCCESS | DEP2608303858 | SUCCESS | ✓ |

### 兑换（4 笔）

| # | 场景 | 客户 | 金额 | 预期终态 | 实到单号 | 实到状态 | 结果 |
|---|---|---|---|---|---|---|---|
| 11 | 兑换 · USDT→AED 成功 | demo_alice@example.com | 1000 USDT | SUCCESS | SWP2608300598 | SUCCESS | ✓ |
| 12 | 兑换 · AED→USDT 成功 | demo_bob@example.com | 2900 AED | SUCCESS | SWP2608301450 | SUCCESS | ✓ |
| 13 | 兑换 · 制裁冻结（零出边） | demo_frank@example.com | 600 AED | FROZEN | SWP2608308431 | FROZEN | ✓ |
| 23 | 兑换 · 素材（Grace AED→USDT） | demo_grace@example.com | 800 AED | SUCCESS | SWP2608305315 | SUCCESS | ✓ |

### 提现（7 笔）

| # | 场景 | 客户 | 金额 | 预期终态 | 实到单号 | 实到状态 | 结果 |
|---|---|---|---|---|---|---|---|
| 14 | 提现 · 法币成功 | demo_alice@example.com | 1200 AED | SUCCESS | WD2608300246 | SUCCESS | ✓ |
| 15 | 提现 · 虚拟币成功 | demo_bob@example.com | 150 USDT | SUCCESS | WD2608303874 | SUCCESS | ✓ |
| 16 | 提现 · 法币成功（二） | demo_grace@example.com | 900 AED | SUCCESS | WD2608301369 | SUCCESS | ✓ |
| 17 | 提现 · 等客户补料 | demo_alice@example.com | 1800 AED | ACTION_PENDING | WD2608304802 | ACTION_PENDING | ✓ |
| 18 | 提现 · 大额待审批 | demo_bob@example.com | 250000 AED | PENDING_APPROVAL | WD2608308019 | PENDING_APPROVAL | ✓ |
| 19 | 提现 · MLRO 冻结 | demo_grace@example.com | 1500 AED | FROZEN | WD2608304531 | FROZEN | ✓ |
| 20 | 提现 · 卡在半路（对账用） | demo_alice@example.com | 500 AED | PAYOUT_PENDING | WD2608307664 | PAYOUT_PENDING | ✓ |

**花名册：29/29 符合预期**

### 账本恒等式（COA）

| 恒等式 | 结果 |
|---|---|
| COA CLIENT(AED): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) | ✓ 4266547 == 4266547 |
| COA FIRM(AED): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER) | ✓ 10016353 == 10016353 |
| COA CLIENT(USDT): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) | ✓ 4792571811 == 4792571811 |
| COA FIRM(USDT): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER) | ✓ 100013428189 == 100013428189 |
<!-- GENERATED:END -->
