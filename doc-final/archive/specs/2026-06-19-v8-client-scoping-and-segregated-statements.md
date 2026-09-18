# V8 对账 — 客户/公司边界修正 + 对账单按物理账户隔离

日期：2026-06-19
状态：脑暴对齐完成，待实施
触发：用户质疑「以现在的钱包/账号应该有几张对账单 + run 是不是把客户和公司混在一起」→ dive deep 查代码确认两个真实问题。

---

## 0. 两个已用证据确认的问题

### P1（bug，correctness）：外部余额混了客户+公司
`MockExternalAdapter.balanceAt`（默认 DI / cron 路径）：
```ts
const wallets = await prisma.wallet.findMany({ where: { assetId, status:'ACTIVE' } }); // ← 无 walletRole 过滤
return Σ wallets.mockBalance;  // C_* 客户 + F_* 公司 一锅烩
```
而 TB 内部侧 `workflow line 79` 取 `LAYER_ASSET_CODE[layer]` = `A.CLIENT_CUSTODY`/`A.CLIENT_BANK`（**仅客户**）。
→ I5 delta 凭空多出 `−firm余额` 的假 break。

**证据**：COA 科目里 firm 自有资金是独立科目 `A.FIRM_TREASURY`（与 `A.CLIENT_*` 分开），客户/公司在账本层天然分离。demo 路径（file adapter 读 statement closingBalance，closing 由 `A.CLIENT_*` 反推）侥幸是干净的，但默认 adapter 是错的。

### P2（faithfulness）：对账单颗粒度拍扁
对账单应跟着**物理外部账户**走，子账户是单内行标签。现状 demo 把所有 vault 拍成 1 张 HEXTRUST 单。真实拓扑（客户资产在管范围 C_*）：
| 来源 | 物理账户 | 数量 |
|---|---|---|
| Zand AED | C_CMA 备付金账户（5 个 C_VIBAN = 单内 VirtualAccount 行标签） | 1 |
| HexTrust USDT | C_DEP 客户充值 vault（各有独立 vaultId） | 5 |
| HexTrust USDT | C_MAIN 归集 + C_OUT 出金 | (+2，需补 vaultId) |

→ 客户对账单 ≈ 6 张，非 2 张。

## 1. 边界原则（本次确立）

**内部 COA 科目 ⟺ 外部 walletRole 必须同边界：**
- 客户资产对账（V8 / VARA safeguarding）：内部 `A.CLIENT_CUSTODY`/`A.CLIENT_BANK` ⟺ 外部 `walletRole LIKE 'C_%'`。
- 公司自有资金：内部 `A.FIRM_TREASURY` ⟺ 外部 `walletRole LIKE 'F_%'`，**另起 firm recon（Phase 2+，本次不做）**。
- firm **不纳入**本次客户对账——「混在一起」是 P1 bug，不是范围扩张。

## 2. 实施

### 2.1 修 P1 scoping（MockExternalAdapter）
- `balanceAt`：`where` 加客户钱包过滤（`walletRole` 以 `C_` 开头）。Σ 仅客户钱包 mockBalance。
- `txsForDate`：同样限客户（当前还硬编码只读 internalFund/HEXTRUST，是半成品——本次至少加 client 范围，方向感知留 follow-up）。
- 单测：构造 C_* + F_* 钱包，断言 balanceAt 只 sum 客户、排除 firm。

### 2.2 对账单隔离（schema + adapter）
- **schema**：`reconciliation_external_statements` 唯一键 `(source,businessDate,currency)` → `(source,businessDate,accountRef)`。`currency` 保留为列。迁移。
- **statementNo**：`STMT-{date}-{source}-{accountRefSlug}`（accountRef 去特殊字符）。
- **file adapter**：`load()` `findUnique`→`findMany`（按 source+date+currency 取多行）；`balanceAt` = Σ closingBalance；`txsForDate` = concat 各 statement rawJson 记录。
- **admin 前端无需改**：getStatement 按 statementNo（独立 @unique）仍工作；列表自然显示多行；source-aware 详情按单渲染。

### 2.3 重造 segregated demo（保闭合）
- **ZAND**：仍 1 张 CMA 单（accountRef=CMA）。记录的 `VirtualAccount` 改为各客户真实 vIBAN（payin.ownerId→C_VIBAN.iban），体现「虚拟子账户=行标签」。
- **HEXTRUST**：拆成每客户 vault 一张单：
  - 客户 C_DEP vault 单（accountRef=vaultId）：records = 该客户 payins(DEPOSIT)。
  - C_OUT vault 单：payouts(WITHDRAWAL)。
  - C_MAIN vault 单：internal_fund 链上腿 + **作 pooled plug**：`closing_main = 聚合closingUSDT − Σ(客户vault closing) − C_OUT closing`，保证 Σ 全部客户单 = 聚合 `closingUSDT = tbUSDT − inTransit − Σbreak`，闭合恒等式不变。
  - breaks 分布到具体 vault：orphan-internal（漏某客户 deposit）、orphan-external（加到 C_MAIN）、mismatch（改某客户金额）。
- **闭合不变量**：Σ unmatched signedDelta == I5 delta，仍由构造保证（聚合数与现状一致，只是分区存储）。
- payin→vault 映射：`payin.ownerId` → `wallets(walletRole=C_DEP, assetId=USDT, ownerId=同)` → `vaultId`。

### 2.4 spec/文档回写
本 spec 即设计记录；`2026-06-18` 自动化 spec §3.1 外部存储段落 back-annotate「已实现 + 按物理账户隔离 + 客户边界」。

## 3. 验收
- 引擎/adapter 单测绿（含 firm-excluded 断言）；`npm test` 全绿；`tsc` 0。
- `npm run recon:demo`：两层 closure PASS（与现状同闭合，分区后仍成立）。
- 渲染：External Statements 列表显示 **6 张客户单**（1 ZAND CMA + 5 HEXTRUST vault），firm 单不出现；抽查 1 张 vault 详情。

## 4. 范围外
- firm/treasury recon（A.FIRM_TREASURY ⟺ F_*）——Phase 2+。
- internal_fund 方向感知匹配（仍全 IN）。
- file adapter 设为默认 DI（仍 Mock 默认）。
- C_MAIN/C_OUT 真实 vaultId 落库（demo 内合成）。
