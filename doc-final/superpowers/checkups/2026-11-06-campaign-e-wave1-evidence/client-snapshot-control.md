# 客户侧快照 · 重铺对照（改码前）

结论：**diff empty across reseed on unchanged code at fd2ebd7d**（分支基点；`git diff --stat fd2ebd7d -- src prisma admin-web client-web` 为空，仅新增 `scripts/client-side-snapshot.ts` 与本目录文件）。
`client-snapshot-before.json`（sha256 `c0195e64…`）与第二次重铺后新拍的 control 快照逐字相同。T13 拿「改后重铺的快照」对它做 `diff`，非空 = 客户侧有变化。

## 两次重铺（同一份脚本、同一份代码）

| | 重铺 A（出 before） | 重铺 B（出 control） |
|---|---|---|
| `bash scripts/stack.sh reset self` | exit 0 | exit 0 |
| `bash scripts/stack.sh up` | exit 0，后端 12:33:44 起 | exit 0，后端 12:38:17 起 |
| 月结单 sweep | 12:34:15 `customer_monthly_statements`=55 | 12:38:38 =55 |
| `bash scripts/on-stack.sh self demo:all` | exit 0，5/5 PASS | exit 0，5/5 PASS |
| `bash scripts/on-stack.sh self client:snapshot -- --out …` | exit 0，13 客户 → `client-snapshot-before.json`；同库再拍一次 `diff` exit 0 | exit 0，13 客户 → scratch `client-snapshot-control.json` |
| `diff before control` | — | **exit 0，0 行** |

（重铺 A 的 demo:all 在 sweep 之后跑；两次快照都在后端起 >30 s、月结单已出具之后拍。）

## 发现：demo:all 现造单号带随机后缀

首次对照（脚本尚未遮罩）`diff` exit 1、274 行。只有 6 个客户的 `statementRows.<AED|USDT>.rows[]` 不同——`subtitle` / `refs[].sourceNo`。
原因：`generateReferenceNo()`（`src/common/utils/no-generator.util.ts`）= 3 位前缀 + yymmdd + **6 位 CSPRNG 随机数**，如 `DEP261106520125` ↔ `DEP261106048494`；原脚本又把 `subtitle` 放进行排序键，随机尾号连带打乱行序，使 `amount` / `balanceAfter` 也「按位置」不同。`balances` / `portfolio` / `monthlyStatements`（含 Henry 种子历史与全部 STM 号）逐字相同；把随机单号遮掉再重排后 0 处差异。

处理（控制者裁定，选项 A 收紧版）：
- `maskRandomOrderNo`：只遮 `generateReferenceNo` 格式（`\b[A-Z]{3}\d{12}\b`）的**末 6 位**→ `DEP261106######`，保留单型 + 日期；种子单号（`DEP2601014127`，前缀 + 260101 + 4 位）与 `STM-…` 原样。理由：随机后缀每次重铺不同，而账本重构不碰 sourceNo。
- 行排序键改为 `kind, title, amount, feeAmount, balanceAfter`，（已遮罩的）单号垫后。
- 注意：日期段 `261106` 是重铺当天；另一天重铺，这一段会变（遮罩不遮日期）。

## 红灯验证（会红才算绿）

1. **剥离器**：脚本副本把 `STRIP_KEY` 改成 `/^$/`（不剥任何键）→ exit 1，`FATAL Error: snapshot residue (uuid/timestamp-like value) at $.CU2601010403.statementRows.AED.rows[0].postedAt: 2026-11-06T08:39:09.281Z`，不写文件。
2. **遮罩**：脚本副本把 `maskRandomOrderNo` 改成恒等 → 对同一份库拍出的快照与 before `diff` exit 1、232 行（`"DEP261106######"` ↔ `"DEP261106013553"`…）。没有遮罩这条对照就是红的。
3. **diff 闸本身**：复制 before，把首个 `amount` 150000 改成 150001 → `diff` exit 1，输出恰好那一行。
4. tsc：`npx tsc --noEmit -p tsconfig.json` exit 0（脚本改动后）；此前用 `scripts/zz-tsc-probe.ts` 的类型错误验证过该闸会红（exit 2）。
5. 两份变异脚本副本已删除，`git status` 里只剩本次要提交的文件。

## 边界（这份对照证明了什么、没证明什么）

- 证明：代码不变时，两次独立重铺 + demo:all，客户侧可见的余额（ledger / held / available）、资产组合、逐币种对账单行（遮罩随机尾号后）、全部月结单快照逐字一致。
- 没覆盖：行的先后顺序（排序键与时间无关，靠 `balanceAfter` 链还原）；随机单号的尾 6 位；重铺发生在其他业务月 / 其他日期时的 `periodMonth` / 单号日期段（Henry 历史腿与月结单列表按 `businessMonthOf(now)` 推）。
- 取快照的前提：后端起来 >30 s 且 `customer_monthly_statements`=55（11 客户 × 5 月）。

## 复现命令

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
bash scripts/stack.sh reset self && bash scripts/stack.sh up          # 等后端起 >30 s
bash scripts/on-stack.sh self demo:all > /tmp/demo-all.log 2>&1; echo $?   # 不接管道
bash scripts/on-stack.sh self client:snapshot -- --out /tmp/after.json
diff doc-final/superpowers/checkups/2026-11-06-campaign-e-wave1-evidence/client-snapshot-before.json /tmp/after.json; echo $?
```
