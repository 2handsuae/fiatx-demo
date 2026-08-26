# 演示数据字典（data）

> 现状版（2026-08-26 实测盘点后手写）。待造数脚本输出答案键清单后，本文件改为脚本自动生成（防漂移）。
> 重铺入口：`bash scripts/stack.sh reset-main`；全量造数：`bash scripts/on-stack.sh main demo:all`。

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
| demo:all | 一键全量（8 场景断言终态）——开演前跑这个 |
| recon:demo:pass / break | 对账 pass ／ 9 种破口+答案键（break 现漏检 2 种，BACKLOG 在案） |

⚠️ 造数铁律：一律走真实流程/模拟端点重放，**禁止直插表**（直插中间态 → 账本负余额 → 假破口，实证教训）。
