# e2e 对照基线（CONTROL）— 戊波二 T0，代码头 `0c6eb7b0`

- 代码：`0c6eb7b0`（`git diff --stat 5ff65ef5..HEAD` = 仅 2 个 spec/plan 文档，故代码 ≡ main `5ff65ef5`）。对波一终态 `84970d02` 的差异只有 3 个文件 4 行注释 / 文档字符串（`git diff 84970d02..HEAD -- src scripts prisma` 逐行看过：`prisma/schema.prisma` 一行注释、`scripts/demo-lib.ts` 一行注释、`tb-evidence.service.ts` 两行注释），行为与波一终态相同。
- 采集：2026-11-07，Node v20.20.2，jest 30.1.3，TigerBeetle 0.17.4，macOS（darwin 25.4）；worktree `campaign-e-wave2-e761d7`，self 栈端口 3110–3113，库目录 `/tmp/exchange_js_wt_campaign_e_wave2_e761d7/`。
- 只量不改：没改任何产品代码；e2e 两轮都没把 `doc-final/demo/data.md` 写脏（收尾 `git status` 只剩证据目录）。未碰 main 栈（3000–3003）与波一栈（3100–3103）。

## 一句话结论

1. **真实时钟下的冷缓存串行基线（本机迪拜 01:xx = UTC 21:xx）= `Test Suites: 11 failed, 16 passed, 27 total` / `Tests: 33 failed, 142 passed, 175 total`**——比波一终态（9 / 22）多出 **11 名**。
2. 这 11 名里 **10 名是「迪拜业务日 vs UTC 日期」错位窗口的产物**（每天 UTC 20:00–24:00 = 迪拜 00:00–04:00 窗口内跑 e2e 才红，窗口外绿），**1 名是已知偶发**（`vendor-onboarding` ①，波一基线文档同款）。机理与证据见 §3。
3. 用「Date 拨回 5 小时」的诊断配置（§4 配方）重跑同一套冷缓存串行：**`9 failed, 18 passed, 27 total` / `22 failed, 153 passed, 175 total`**，失败名集合与波一终态**逐名一致**（= 基线 20 名一名不少 + 2 个 demo-roster 连带名）。
4. **推荐的 T12 对照口径 = §2 的这 22 名（B 集）**；T12 的 e2e 要么在窗口外跑（迪拜 04:00–24:00），要么用同一拨钟配置，否则会把 §2.2 的 11 名当成回归。

## 1. 命令与退出码（均在 worktree 根；每条前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`）

每轮「干净态」序列（两轮完全相同，只有最后一步的 jest 配置不同）：

| 步骤 | 命令 | 退出码 |
|---|---|---|
| 重铺 | `bash scripts/stack.sh reset self` | 0 |
| 起栈 | `bash scripts/stack.sh up`（API 3110 / Admin 3111 / Client 3112 / TB 3113） | 0 |
| 重铺 7 个私库（先 `rm -f`；库名 `e2e-{kyt-verdict-landing,sanction-subject-split,deposit-verdicts,material-requests,customer-restrictions,sla,aml-reporting-family}.db`，目录同栈库） | `DATABASE_URL=file:<库> npx prisma migrate deploy` / `… npm run db:base:sync` | 0 / 0（×7） |
| 同上 | `DATABASE_URL=file:<库> TB_ADDRESS=127.0.0.1:3113 FILE_STORAGE_DIR=<栈 files 目录> npm run db:biz:init` | **1（×7）**——已知债（`doc-final/TOOLING-DEBT.md` 私库条），与波一终态一致，套件在半成品库上照常跑 |
| 建 demo 基础 | `bash scripts/on-stack.sh self demo:setup` | 0 |
| **A 轮（真实时钟）** | `bash scripts/on-stack.sh self test:e2e --runInBand --cacheDirectory=<新空目录>`（输出进日志文件，`$?` 直接取，无管道） | **1**；jest `Time: 111.129 s` |
| **B 轮（拨钟）** | 同上整套前置序列后，`env DATABASE_URL=… TB_ADDRESS=127.0.0.1:3113 TB_DATA_FILE=… FILE_STORAGE_DIR=… npx jest --config <拨钟配置> --runInBand --cacheDirectory=<新空目录>`（env 取值与 `on-stack.sh` 注入的相同） | **1**；jest `Time: 116.574 s` |

| 轮次 | Test Suites | Tests |
|---|---|---|
| A 轮（真实时钟，窗口内） | `11 failed, 16 passed, 27 total` | `33 failed, 142 passed, 175 total` |
| **B 轮（拨钟，等价于窗口外）** | **`9 failed, 18 passed, 27 total`** | **`22 failed, 153 passed, 175 total`** |
| 波一终态（`a35a04f1` + 夹具对齐，窗口外） | `9 failed, 18 passed, 27 total` | `22 failed, 153 passed, 175 total` |

冷缓存协议同波一：`--cacheDirectory=<新空目录>`（jest 缓存顺序 = 文件大小降序，demo-roster 排第 22 / 27；暖缓存会让 demo-roster 先跑、冻住 `demo_frank`，制造假红）；`reset` 不清私库，所以每轮重铺 7 个私库。两轮 27 个套件的执行顺序逐位相同（对 jest 的 PASS/FAIL 行去掉状态后 `diff` 为空）。

## 2. 失败名集合

### 2.1 B 集（22 名）= T12 应对照的基线（B 轮 jest 末尾「Summary of all failing tests」逐字，jest 输出序）

失败套件（9）：`test/recon-adjustment-money-arcs` / `recon-supplement` / `recon-internal-transfer` / `incident-register` / `recon-aging-write-off` / `swap-sumsub-scenarios` / `swap-money-arc` / `customer-restrictions` / `demo-roster`（均 `.e2e-spec.ts`）。
通过的 18：aml-reporting-family、approval-expiry、audit-discipline、complaints、compliance-office、customer-business-key、deposit-money-arcs、deposit-sumsub-verdicts、kyt-verdict-landing、ledger-flags、material-requests、recon-reattribution、regulatory-filing、sanction-subject-split、sla、vendor-onboarding、withdraw-money-arcs、withdraw-sumsub-scenarios。

```
Recon adjustment money arcs (e2e, Task 8) › 9. 平账闭环（真实形状）：昨天的破口 + 真实"我有外无"差异行 → 今天开单回填 → 重跑 → 差额归零、差异行标已解释、桶回 MATCHED、case 自愈
Recon supplement e2e (平账 B 批, Task 8) › ② 退汇：SUCCESS 充值 1200 AED → 银行扣回 → 定性 → 发起（候选含原单）→ CFO 批 → CLAWED_BACK，借应付贷客户现金，余额减 → 重跑愈
Recon supplement e2e (平账 B 批, Task 8) › ③ 退回：SUCCESS 提现 → 银行退回 → 定性 → 发起 → CFO 批 → RETURNED，借客户现金贷应付，余额加、手续费不退 → 重跑愈
Recon supplement e2e (平账 B 批, Task 8) › 拒绝路径：方向不符 400；余额不足 400；同一行仍待决时二次发起 400，CFO 拒绝后可再发起（复用同一信号）；② 拒绝后原状态不动、supplementNo 清空、可再发起
Recon internal transfer e2e (平账二期, Task 9) › B · 退汇余额不足：读面给 ADVANCE → 认领 400 指路 → 垫款两腿（81 / 82+83）→ 可用够扣 → 认领退汇 CLAWED_BACK → 愈
Incident register e2e (平账三期 · 事故登记, Task 13) › 9 · CLIENT_SHORTFALL：带垫款单号登记 → 锚定校验（purpose==='CLIENT_ADVANCE'）
Recon case aging → write-off e2e (平账 A 批, Task 12) › 主链路：查无果 → 拨钟 → 扫描超期（留痕）→ 金库开核销单 → CFO 批 → 落账（借对账核销损失/贷公司现金·案子钱包 7）→ 重对账 RESOLVED
Swap Sumsub verdict buttons (e2e, Task 12) › ① approved: COMPLIANCE_PENDING → PROCESSING, leg1 booked
Swap Sumsub verdict buttons (e2e, Task 12) › ② awaiting user（下发认证）: REJECTED, zero legs, no restriction opened, material request issued (2026-09-14: soft line no longer stamps a 便签)
Swap Sumsub verdict buttons (e2e, Task 12) › ② awaiting user（我方等同拒绝）: REJECTED, no restriction opened, material request issued (ext-3, 2026-09-14: soft line no longer stamps a 便签)
Swap Sumsub verdict buttons (e2e, Task 12) › ⑪ rejected · no disposition tag: REJECTED, no material request issued, no sticky hard-line
Swap Sumsub verdict buttons (e2e, Task 12) › ⑥ on hold（我方等同拒绝）: REJECTED, no material request issued
Swap Sumsub verdict buttons (e2e, Task 12) › ⑦ rejected · Sanctions: FROZEN, sticky hard-line set, no material request issued (tipping-off)
Swap Sumsub verdict buttons (e2e, Task 12) › sticky hard-line silences a later, otherwise-soft-line verdict（V7 制裁后送达的 V2：单已被客户级冻结广播冻住,裁决被幂等闸吞,沉默依旧零材料请求）
Swap money arcs (e2e, Task 12) › 2. THE HEADLINE PROPERTY（站3·出生锁版）— KYT rejected swap: 圈全擦、余额复原、零落笔零单据, quote consumed, restrictions block SWAP/WITHDRAW but not DEPOSIT
Customer lifecycle restrictions (e2e, Task 14) › ② 零痕迹：SANCTION 客户与正常客户的 /onboarding/me、/client/me/restrictions、/deposit-transactions/my 归一化后逐字节相等
Customer lifecycle restrictions (e2e, Task 14) › ⑥ 贴 MATERIAL_EXPIRED（WITHDRAW+SWAP）→ 三笔在途单状态一律不变
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 充值 11 笔全部落到花名册预期状态
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 兑换 3 笔 + 提现 7 笔全部落到花名册预期状态
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 在途单由 runWithdraws 产出，不再需要单独跑 demo:in-transit
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › verifyEndState — 花名册比对（Task C4） › 🎯 跑过 demo:in-transit 之后再跑 verifyEndState，仍然全绿
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › verifyEndState — 花名册比对（Task C4） › 某笔单没到预期状态 → 断言失败并指名道姓
```

（emoji 说明：jest 控制台把 🎯 打成 `��`，上面还原；与波一基线文档同一处理。）

**与波一的集合差**（口径同波一：失败名去重、按前 70 字符前缀对波一基线 20 名；比对脚本 `node cmp-names.js <基线20名> <本轮失败名> 70`）：

- `baseline names no longer red: []`——波一基线 20 名一名不少；
- `current names not in baseline20:` 恰好 2 名，都是 demo-roster 连带名：`… roster (e2e, Task C2 + C3) › 兑换 3 笔 + 提现 7 笔全部落到花名册预期状态`、`… › 在途单由 runWithdraws 产出，不再需要单独跑 demo:in-transit`（前提成立：同轮基线的「充值 11 笔 … deposit reaches CONFISCATED」超时照常出现）。
- 即 **B 集 = 基线 20 名 ∪ 2 个连带名 = 波一终态 22 名，差集两个方向都为空**。（基线 20 名里 recon-supplement ②③ 与 recon-aging 主链路在波一 T11/T12 改过标题，按 ②/③/「主链路」前缀对上，同波一。）
- 原因类别同波一：13 例 `AGREEMENT_NOT_ACCEPTED`（recon-supplement 3、recon-internal-transfer 1、incident-register 1、swap-sumsub-scenarios 7、customer-restrictions ⑥ 1）、swap-money-arc 用例 2、recon-aging 主链路（slaDeadline 时区 19:59 vs 23:59）、recon-adjustment 用例 9、customer-restrictions ②、demo-roster 3 例顺序超时 + 2 连带。本轮没有逐例重读栈，只确认了集合与波一一致。

### 2.2 窗口集（A \ B，11 名）= 只在真实时钟（UTC 20:00–24:00 窗口内）A 轮多红的名字（A 轮逐字）

A 轮 33 名 = B 集 22 名（全部也在 A 里，`comm` 差集为空）+ 下面 11 名；多出的两个套件是 `recon-reattribution`（A、B 两例）与 `vendor-onboarding`（①）。

```
Recon adjustment money arcs (e2e, Task 8) › 1. 客户账簿·减（重复入账撤销）：BREAK case → 开单 → 提交 → 真的批准 → account_flows 落账 + 审计留痕 → 重跑对账 → case AUTO_HEALED
Recon adjustment money arcs (e2e, Task 8) › 2. 客户账簿·加（提现撤销退回，带关联原单）：闭环 + 分录方向为 借客户现金（案子钱包）/贷客户应付
Recon adjustment money arcs (e2e, Task 8) › 3. 公司账簿·加（银行利息）：闭环 + 分录方向为 借公司现金（案子钱包）/贷其他收入
Recon adjustment money arcs (e2e, Task 8) › 8. 加密币（USDT-TRON）客户账簿·减：assetCode ≠ currency 时 ledger 仍要解析得出 —— 走查实踩的静默死局回归锁
Recon adjustment money arcs (e2e, Task 8) › 7. 公司账簿·减（银行杂费）：闭环 + 分录方向为 借银行与托管费用/贷公司现金（案子钱包）（V2 补口——此前从未真落过账的一种组合）
Recon adjustment money arcs (e2e, Task 8) › 10. 查了 0 个钱包的对账（当天没有外部对账单）→ 不许关掉任何 OPEN 案件
Recon supplement e2e (平账 B 批, Task 8) › ①a 链上补录：案子 → 定性漏记入金 → 发起（来源地址）→ CFO 批 → 信号进通道 → 充值单 SUCCESS（STEP_1 流水 effectiveDate=业务日、externalRef=行参考号）→ 重跑愈
Recon supplement e2e (平账 B 批, Task 8) › ①b 法币补录：案子 → 定性漏记入金 → 发起（来源 IBAN）→ CFO 批 → 信号进通道 → 充值单 SUCCESS → 重跑愈
Recon reattribution + disposition behaviour (e2e, Task 12) › A. 改记一单双案同愈：两案 OPEN → 定性 MISATTRIBUTED_FROM → 对端候选命中 → 一张改记单（应付对转 + 现金对转，四条腿）→ 真批真落账 → 一次重对账两案齐愈
Recon reattribution + disposition behaviour (e2e, Task 12) › B. 挂起不许绿：定性「查不出」→ 出口 HOLD_INVESTIGATING → 零分录 → 重跑对账案子仍是 OPEN，行上带得到成因注解
Vendor onboarding VARA notification gate e2e (甲波六 · T7) › ① 重大服务商：批准 → 待报备 + 自动开告知单盖章 → 告知单走到「已报送」→ ACTIVE → 终止再开一张告知单且不认领
```

- 前 10 名（recon-adjustment 6、recon-supplement 2、recon-reattribution 2）：其中 9 名的失败签名是 `expect(run.status).toBe('BREAK')` 收到 `"PASS"`（逐名读过 A 轮报错）；recon-adjustment 用例 10 是 `expect(kase).toBeTruthy()` 收到 `null`（`:1185`，该用例要等一个本该 BREAK 的前置对账开出案子，同源但签名不同）。**窗口外绿**（B 轮实测全绿，§4）。
- `vendor-onboarding` ①：`VENDOR_ACTIVATED` 审计行晚于状态落库（期望五条、收到四条，`test/vendor-onboarding.e2e-spec.ts:196`）——波一基线文档记过的偶发（该文件单跑绿；本次 A 轮红、B 轮绿，与时钟窗口无关的竞态）。

## 3. 窗口效应的机理（源码级证据，读自 `0c6eb7b0`）

- 业务日口径：`src/modules/accounting/tigerbeetle/utils/business-date.util.ts` 的 `toBusinessDate(at)` = `(at + 4h)` 的 UTC 日期（迪拜日历日）。对账 run 按它取外部余额：`wallet-recon-run.service.ts:116/153` `const businessDate = toBusinessDate(cutoff)`、`where: { cutoffDate }`。
- 测试夹具口径：`test/recon-adjustment-money-arcs.e2e-spec.ts:400`、`test/recon-supplement.e2e-spec.ts:276`、`test/recon-reattribution.e2e-spec.ts:341` 都是 `CUTOFF.toISOString().slice(0, 10)`（**UTC 日期**）写外部余额行，`TODAY = new Date().toISOString().slice(0, 10)`（同 `:144` / `:126`）。
- 两种「日期」只在 UTC 20:00–24:00 不同日（迪拜已跨午夜、UTC 还没）：夹具写在 UTC 日 D 上，run 去找迪拜业务日 D+1，**推断**外部余额一行都没取到 → 没有可比的钱包 → `PASS`，而不是预期的 `BREAK`（这一步是源码阅读 + §4 拨钟实验共同支持的推断，没有单独跟踪 `externalBalance` 查询的返回行数）。窗口外两者同日，行为正确。
- 这是**测试夹具的口径缺陷**，不是产品回归（产品口径是业主 2026-09-21 拍板的迪拜日）。本任务只量不改，**未登记**（`TOOLING-DEBT.md` 里搜 `UTC 20` / `错位窗口` 无命中）——交控制者决定是否登记。

## 4. 窗口假设的验证（要让「这是窗口造成的」站得住，得有「窗口外会绿」的证据）

本机 PATH 上没有 `faketime` / `libfaketime`（`which faketime libfaketime` 无命中），所以用一个**仅存在于 scratch 的 jest 预加载**把进程内 `Date` 整体拨回 5 小时（UTC 21:xx → 16:xx，迪拜 20:xx，两种日期同日）。**只改被测进程内的时钟**，不碰产品代码、不入库：

```js
// shift-clock.js（scratch）
const OFFSET = -5 * 3600 * 1000;
const RealDate = Date;
class ShiftedDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + OFFSET); else super(...args); }
  static now() { return RealDate.now() + OFFSET; }
}
global.Date = ShiftedDate;
```

```bash
# 拨钟配置 = test/jest-e2e.json 去掉注释行 + rootDir 改绝对路径 + setupFiles 追加上面的预加载
node -e '
const fs=require("fs");
const c=JSON.parse(fs.readFileSync("test/jest-e2e.json","utf8").split("\n").filter(l=>!/^\s*\/\//.test(l)).join("\n"));
c.rootDir=process.cwd(); c.setupFiles=["<rootDir>/scripts/require-node.js", process.argv[1]];
fs.writeFileSync(process.argv[2], JSON.stringify(c,null,2));' <shift-clock.js 绝对路径> <jest-e2e-shifted.json 绝对路径>
# 然后（栈已 reset→up→私库→demo:setup）：
env DATABASE_URL=file:/tmp/exchange_js_wt_<树名>/dev.db TB_ADDRESS=127.0.0.1:<TB 端口> TB_DATA_FILE=/tmp/exchange_js_wt_<树名>/0_0.tigerbeetle FILE_STORAGE_DIR=/tmp/exchange_js_wt_<树名>/files \
  npx jest --config <jest-e2e-shifted.json> --runInBand --cacheDirectory=<新空目录> > <日志> 2>&1; echo $?
```

结果：
1. **6 个对账相关套件**（recon-adjustment / recon-supplement / recon-internal-transfer / incident-register / recon-reattribution / recon-aging-write-off）先单独拨钟跑一遍（干净重铺 + demo:setup）：exit 1，`5 failed, 1 passed, 6 total` / `7 failed, 30 passed, 37 total`；红的 7 名**恰是**波一基线的对账组 7 名（recon-supplement ②③+拒绝路径、recon-adjustment 9、recon-aging 主链路、recon-internal-transfer B、incident-register 9），`recon-reattribution` 全绿，recon-adjustment 1/2/3/7/8/10 与 recon-supplement ①a/①b 全绿。
2. **全量**拨钟冷缓存串行（B 轮）：`9 / 22`，失败名与 A 轮的差集恰为 §2.2 的 11 名，反向差集为空。
3. 拨钟**确实改变了结果**（10 名由红转绿），不是「改了个寂寞」；`vendor-onboarding` ① 在 B 轮绿但那是偶发竞态，不作为窗口证据。

**边界**：拨钟是进程内 `Date` 垫片，**不是**真正在窗口外跑（TigerBeetle 时间戳、Prisma `@default(now())` 走各自的真实时钟）。它支持的结论是「这 10 名的红来自 UTC/迪拜日期错位」，而不是「拨钟配置等价于任何时刻的真跑」。要拿真窗口外的数字，在迪拜 04:00 之后重跑 A 轮命令即可（预期 `9 / 22`）。

## 5. 没覆盖

- 只跑了 A、B 两个全量轮（外加 6 套件诊断一轮）；没有三轮取多数——`vendor-onboarding` ① 的偶发频率（波一 1/3，本次 1/2）没有进一步量化。
- 失败原因的逐例栈只读了 A 轮的 recon-adjustment / recon-reattribution / vendor-onboarding 三处；B 集 22 名的原因类别沿用波一文档，没有逐例重读。
- 否定性结论的搜索边界：「`TOOLING-DEBT.md` 未登记窗口缺陷」只搜了 `UTC 20` / `UTC20` / `20:00–24:00` / `20-24` / `错位窗口` / `迪拜.*UTC.*窗口` 六种写法，范围限于 `TOOLING-DEBT.md` / `PRODUCTION-NOTES.md` / `BACKLOG.md`。
- 失效验证：本次是纯测量。「检查会不会红」由两点自证——A 轮 33 例红的签名是具体的期望 / 实得值（不是被跳过）；拨钟让 10 名由红转绿（§4-3），证明这些用例对该变量敏感。
