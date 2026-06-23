# 公司账户流水 + internalfund 双腿对账（设计）

> 状态：设计已与用户对齐（2026-06-23），待实施。
> 范围：V8 对账 — 让公司账户(F_*)有逐笔流水，使余额差异可逐笔定位（含银行按笔扣费）。
> 不碰：payin/payout（已是单腿、落账正确）；客户 C_VIBAN→C_CMA 滚动；虚拟币逐 vault。只改公司侧，客户侧账户口径不动。

## 1. 问题

当前假账单生成器(`recon:demo`)对公司账户**只写余额快照、不写流水**（`scripts/recon-demo.ts` §7b，`lineCount: 0`）。一旦公司账户余额对不上（如银行按笔扣手续费），只能看到差额数字，**无法定位到具体哪一笔**。

根因有二：
1. 生成器把每笔 `internalfund` 只写成**一条**"到账"行，还塞进客户 CMA（`recon-demo.ts` 现 aedFunds 写 1 行 CMA/IN/CLIENT）。
2. 内部腿投影把公司法币腿**滚进 CMA**（`leg-projection.service.ts` `resolveAccount`：法币一律 CMA），与公司账户对不上。

## 2. 资金单模型（用户确认 2026-06-23）

| 资金单 | 腿 | 落账 |
|---|---|---|
| **payin** | 1（进） | 虚拟币→C_DEP（各自一个）；法币→C_VIBAN ⇒ 滚 **C_CMA** |
| **payout** | 1（出） | 虚拟币→C_OUT（各自一个）；法币→C_VIBAN ⇒ 滚 **C_CMA** |
| **internalfund** | **2（出+进）** | F_* **各自独立账户**；C_VIBAN ⇒ 滚 C_CMA；虚拟币→各 vault |

唯一特殊的是 **C_VIBAN**：银行 CMA 账单已含所有 VIBAN 流水，故滚 C_CMA（VIBAN 作 sub_account 下钻）。F_*、C_DEP、C_OUT 都各拉各的。公司账户**只出现在 internalfund**（payin/payout 是外部↔客户，不碰公司）。

## 3. 改动（两处）

### 3.1 `leg-projection.service.ts` — 公司法币腿落自有账户
`resolveAccount`：**公司钱包(role 前缀 F_) → `account = ${walletRole}-${ccy}-0001`（exported helper `roleAccountRef(role, ccy)`，与生成器 §7b 账户号同源），不分法币/虚拟币、`sub_account=null`**。
法币客户(C_VIBAN) 仍滚 C_CMA、sub_account=iban。客户虚拟币：有 vaultId 用 vaultId；**无 vaultId（如池化 C_MAIN）回退 `roleAccountRef`，避免暴露钱包 UUID**。
> 注：原设计只做法币公司账户；后扩展为虚拟币公司账户同样走 `${role}-${ccy}-0001`（否则公司腿落到钱包 UUID、与 §7b 余额账号对不上，公司账户余额有却 0 行——此 bug 已修）。

### 3.2 `recon-demo.ts` — internalfund 两腿生成
每笔 `CLEAR` internalfund 取 from/to 钱包（role/iban/vaultId），生成**两条** `external_statement_line`：
- **from 腿**：direction=OUT，落 from 账户（规则同 3.1：**F_*→`${role}-${ccy}-0001`(法币虚拟币一致)** / C_VIBAN→CMA(sub=VIBAN) / 客户虚拟币→vaultId 或 roleAccountRef 回退）。
- **to 腿**：direction=IN，落 to 账户（同上）。
- 生成器 §5/§7 把公司账户(F_*)从"客户池配平"中排除（归 §7b 锚 firmTB）。

`external_ref`：虚拟币=txHash；法币出=referenceNo；法币入=null（走账户级等额回退）。
payin/payout 生成逻辑**不动**。

### 3.3 余额闭合（不变量保持）
- **F_* 每账户**：closing = mockBalance（F_OPS 仍作 plug 吸差），opening = closing − Σ该账户行净额，lineCount = 行数。Σ(F_* of ccy) = firmTB ⇒ **式5 仍平**。
- **C_CMA**：closing 仍锚 `TB − in-transit − Σbreak`；行组成会变（部分 internalfund 不再经 CMA、或方向修正），但 closing 不变 ⇒ **式4 仍平**；opening 由 closing − net 倒推，roll-forward 自洽。

## 4. 匹配（不改引擎）

公司腿落 `F_*-ccy` 后，与外部公司行账户对齐：
- **OUT 腿**(ref=referenceNo) → 主匹配 `(direction,currency,external_ref)`。
- **IN 腿**(ref=null) → 账户级等额回退（`match-engine-v2` §③：`e.accountRef==il.account` + 等额）。

无差异(pass)：公司行全配上 → **不冒假孤儿**。注入 break（公司账户一条 OUT、内部无对应=银行扣费）→ `ORPHAN_EXTERNAL` + `BANK_FEE` 定性 → 落公司 case 下钻 → 定位到该笔。

## 5. 验证（先写测试→改→验证，贴证据）

1. **jest**：更新 `leg-projection.spec`（公司法币腿断言落 `F_*-ccy`，客户法币仍 CMA）；全套绿。
2. **`recon:demo --mode=pass`**：式4/式5 全 PASS、0 case；公司账户有流水且 roll-forward 连续。
3. **`recon:demo --mode=break`**（含一笔公司侧银行扣费 break）：式5 该 book FAIL + 公司 case 下钻出现 `BANK_FEE` 行。
4. **渲染**：External Balances 公司账户详情页有流水（不再 "No lines"）；公司 case 详情下钻定位到扣费行。截图留证。

## 6. 假设

每个公司角色 × 币种 = 单账户（`F_FEE-AED-0001`，用户已确认）。若同角色同币种存在多账户，需在账户号带账户标识扩展（本期不做）。
