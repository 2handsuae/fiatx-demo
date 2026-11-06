# 戊波二 · 证据目录

> 起笔：2026-11-07，T0 对照组采样（改前基线）。代码头 `0c6eb7b0`（≡ main `5ff65ef5` + spec/plan 两份文档）。后续任务把各自的证据**追加**在本文件末尾「后续任务」一节，并在上面的清单里补行。

## 1. 文件清单（每个文件证明什么）

| 文件 | 证明什么 | T0 命令 | 退出码 |
|---|---|---|---|
| `client-snapshot-before.json` | **改前**客户侧快照：13 位客户的余额 / 资产组合 / 逐币种流水 / 月结单。`reset self` → `up` → 等月结单 sweep（`customer_monthly_statements` = 55）→ `demo:all` → **在任何 `recon:demo` 之前**拍 | `bash scripts/on-stack.sh self client:snapshot -- --out doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/client-snapshot-before.json` | 0 |
| `e2e-baseline-0c6eb7b0.md` | 全量 e2e 冷缓存串行基线：失败名逐字、与波一终态的集合差、**迪拜日 / UTC 日错位窗口**对基线的影响及拨钟验证 | 见该文 §1 | 1（有已知红，预期） |
| `counts-before.md` | 计数基线：审批 55 / MAKER 54+1 / S9 45 + 路由 45 / 审计 378（18 册）/ TB 科目码 11 / 转账码最大 87 / 账本科目 87；五条可复现命令原文 | 见该文 C1–C6 | 0 |

## 2. 客户侧快照的验证（T0 采集时做的）

- **同库再拍一次**：`diff` 退出码 0、0 行。
- **独立重铺再拍一次**（收尾那次 `reset self` → `up` → `demo:all`，同代码）：`diff` 退出码 0、0 行；两份 sha256 同为 `bfe3110b610528b3…`。T12 拿改后快照对 `client-snapshot-before.json` 做 `diff`，非空 = 客户侧有变化。
- **对波一的 `client-snapshot-before.json`**（`2026-11-06-campaign-e-wave1-evidence/`，sha256 `c0195e64…`）：把本快照里的 `261107######` 替换成 `261106######` 后 `diff` 为空（232 行差异**全部**是单号日期段）。即：代码未动时，两天的快照除订单号里的重铺日外逐字相同。
- 取快照前提满足：后端起来 > 30 s、`customer_monthly_statements` = 55；快照内 `"error"` 键 0 个，STM 号 55 个，订单号遮罩 58 处。
- ⚠️ **日期段**：订单号形如 `DEP261107######`，日期段 `261107` 是**机器本地日期**（`generateReferenceNo` 用 `new Date().getFullYear()/getMonth()/getDate()`，本机时区 +04）= 重铺当天。T12 若不在 2026-11-07（本机本地日）重铺，`diff` 里会冒出单号日期段差异，要么先对其中一份做 `sed` 归一化（波一裁定 R9 的口径），要么就地说明；这与代码无关。
- 失效验证沿用波一 `2026-11-06-campaign-e-wave1-evidence/client-snapshot-control.md`（剥离器 / 遮罩 / diff 闸三项）；本任务没改 `scripts/client-side-snapshot.ts`，未重做。

## 3. T0 的三个值得下游知道的事

1. **e2e 基线随时钟窗口变**：每天 UTC 20:00–24:00（= 迪拜 00:00–04:00）窗口内跑，会多出 11 个失败名（10 个窗口效应 + 1 个已知偶发）；窗口外 / 拨钟后是 9 套件 22 例，与波一终态逐名一致。T12 须在窗口外跑（迪拜 04:00–24:00）或用 `e2e-baseline-0c6eb7b0.md` §4 的拨钟配置。**T0 就是在窗口内（迪拜 00:57–01:20）采的**，所以该文同时给了两组数。
2. 窗口缺陷在测试夹具（`CUTOFF.toISOString().slice(0, 10)` 用 UTC 日、产品用迪拜业务日），T0 只量不改，**未登记** `TOOLING-DEBT.md`，交控制者定。
3. 私库 `db:biz:init` 恒 exit 1 仍在（已知债，非本任务）；7 个私库每轮重铺。

## 4. 后续任务

（T1 起在此追加：任务号 / 文件 / 命令 + 退出码 + 关键行。）

- **T1 科目码 2 / 51、开户、投影、天平**：`t1-account-codes-2-51-evidence.md`——TDD 红 / 绿与两组失效验证、闸门退出码、重铺后 81 户 → demo:all 后 **105** 户、`verify:coa` 前后、造不平一笔看天平变红再还原、天平硬编码清单（三处，全改）、一次 FDO 撞号偶发红的如实记录。
- **T2 转账码 88–91 + 应收 LP 接线**：`t2-transfer-codes-88-91-lp-receivable-evidence.md`——单测与 e2e 的红 / 绿（e2e 红 = 把 workflow 临时还原成改前版）、闸门退出码、种子四腿（84→88→85→86）期末 51 = 0 的 TB 只读查询、e2e 里 51 / 200 / F_OPS / F_LIQ 的 TB 余额前后表、`GET /admin/tb/accounts?ownerType=LP&code=51` 返回 `ownerName`。
