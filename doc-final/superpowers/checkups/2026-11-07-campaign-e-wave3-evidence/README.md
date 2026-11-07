# 戊波三证据目录

## 目的

戊波三（公司侧读面闸门 + 收官）**改前**对照物：NLA 状态 JSON、计数、四张截图，供 T11 收尾对照「改前 → 改后」。本目录只放证据；后续任务往下追加。T11b 起在文末补收尾六节（闸表、计数、清册、截图索引、NLA 四数、报告行）。

## 基线复用依据

e2e 基线不重跑，复用波二 `doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/e2e-after-8b40965d.md` 的 B 集 22 名。理由：

1. `git diff 8b40965d HEAD --stat -- src test scripts admin-web prisma` 输出（退出 0）：
   ```
    scripts/recon-demo.ts | 6 ++++--
    1 file changed, 4 insertions(+), 2 deletions(-)
   ```
   不为空，但仅 `scripts/recon-demo.ts`（提交 `dbfbd59d`：2 行注释 + 1 条拒绝文案字符串）。
2. e2e 从不执行该脚本：`grep -rn "recon-demo\|recon:demo" test/` 只有 2 处注释提及（`test/recon-adjustment-money-arcs.e2e-spec.ts:52` 与 `:84`）。
3. `src` / `test` / `admin-web` / `prisma` 与 `8b40965d` 逐字相同 ⇒ B 集 22 名对当前代码头仍成立。

搜索边界：只搜了 `test/` 目录里的字面串 `recon-demo` / `recon:demo`；经 npm 脚本包装器或动态拼接路径调用该脚本的可能性不在此次 grep 覆盖内（该 diff 仅改一条拒绝文案，即使被调用也不影响 e2e 断言面）。

## 改前对照物清单

| 文件 | 内容 |
|---|---|
| `counts-before.md` | audit:vocab（exit 1，29 缺码）、RBAC 15 域 / 89 桶 / 96 组、verify:rbac 现状（S7 红 1 条）、调用点 / 端点 / 种子行 / decisions 行数、花名册 35/35 |
| `nla-status-before.json` | `GET /admin/prudential/status`（treasury 登录，demo:all 之后）：perAsset 两行（AED、USDT-TRON），`nlaAedMinor` = 136475225 |
| `t0-dashboard-before.png` | 公司资金看板首屏（treasury；NLA 条 + 运营余额两格 + LP 在途等，尚无「开支格」/ 四钱包一格） |
| `t0-ledger-usdt-tron-before.png` | 账本科目页按 USDT-TRON 筛（cfo；余额列只有 2 位小数，如 `3,500,000.00`，小数位缺陷现状） |
| `t0-flows-usdt-tron-before.png` | 账户流水页按 USDT 筛（cfo；该页的资产下拉按币种而非网络，选项为 `USDT`；金额 6 位小数） |
| `t0-demo-ops-panel-before.png` | Demo Data 面板（admin 超管、Simulation 开、后端 `DEMO_OPS=1` 起；含 Full reset 与「Restore recon scenarios」两块）。截图后未点任何按钮，后端已按常规（无 DEMO_OPS）重启 |

采样备忘：`scripts/demo-shot.js` 默认 `networkidle2` 在账本两页（长轮询）会卡死 / ERR_ABORTED，本次用同一脚本的副本（仅把 `networkidle2` 换成 `domcontentloaded`，放在会话草稿目录、未入库）；账本类页面 treasury 无 `TB_ACCOUNTS_READ`，改用 cfo；筛选须再点一次 Search 才生效。

## 看板格 ↔ 科目页户 对照（T2）

同一时刻（`reset self` + `demo:all` 后），看板 `/admin/company-funds` 与科目页 `/admin/ledger/accounts`（code=50）对照；截图 `t2-dashboard-light.png` / `t2-dashboard-dark.png` / `t2-ledger-code50.png`。

| 钱包 | 币种 | 看板 | 科目页 | 相等 |
|---|---|---|---|---|
| Operations | AED | 946,089.35 | 946,089.35 | ✓ |
| Operations | USDT | 113,999.428189 | 113,999.428189 | ✓ |
| Fees | AED | 114.00 | 114.00 | ✓ |
| Fees | USDT | 36.000000 | 36.000000 | ✓ |
| Liquidity | AED | 0.00 | 0.00 | ✓ |
| Liquidity | USDT | 0.000000 | 0.000000 | ✓ |
| Settlement | AED | 0.00 | 0.00 | ✓ |
| Settlement | USDT | —（F_SET 无 TRON 户） | 无此户（七户里没有） | ✓ |

三个 NLA 小格的 AED 等值合计：946,089.35 + 114.00 + 0.00 = AED 946,203.35；USDT 113,999.428189 + 36 + 0 = 114,035.428189，按 3.6725 折合 + AED 946,203.35 = NLA 大数字 AED 1,364,998.46（两者一致，看板 NLA 大字下的汇总行同值）。本次状态下 Operations 未低于阈值，红字分支未在截图中出现。

---

# 收尾（T11b，2026-11-08）

代码头 `00a89e2f`（闸与计数取数点）；本节只汇总，原始证据在各引用文件。每条命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`，仓库根，self 栈（API 3120）。

## 一、闸表

| 闸 | 命令 | 退出码 | 关键一行 | 出处 |
|---|---|---|---|---|
| ① 后端 tsc | `npx tsc --noEmit -p tsconfig.json` | 0 | 零输出 | `t11a-gates.md` |
| ② 管理台 tsc | `cd admin-web && npx tsc -b --noEmit` | 0 | 零输出（T11b 改了 `AccountFlowList.tsx` 一处注释后再跑一次，仍 0 / 零输出） | `t11a-gates.md`；T11b 复跑 |
| ③ 客户端 tsc | `cd client-web && npx tsc -b --noEmit` | 0 | 零输出 | `t11a-gates.md` |
| ④ 全量 jest | `npx jest`（仓库根，不接管道） | 0 | `Test Suites: 288 passed, 288 total`；`Tests: 2 skipped, 5 todo, 4859 passed, 4866 total` | `t11a-gates.md` |
| ⑧a–c 重铺 | `stack.sh reset self` → `stack.sh up` → `on-stack.sh self demo:all` | 0 / 0 / 0 | `花名册：35/35 符合预期`；`asserts: 5/5 PASS` | `t11a-gates.md` |
| ⑦ / ⑧d 账本恒等 | `bash scripts/on-stack.sh self verify:coa` | 0 | `负余额检查 通过 (105 个科目全部 ≥ 0)`；`ALL INVARIANTS PASS` | `t11a-gates.md` |
| ⑧e 对账通过态 | `on-stack.sh self recon:demo:pass` | 0 | `planned 21 wallet(s)`；`casesOpened==0`、`mismatch==0` | `t11a-gates.md` |
| ⑧f 对账破口 | `on-stack.sh self recon:demo:break` | 0 | `ALL 18 SCENARIOS DETECTED PER MANIFEST`；`casesOpened 12/12` | `t11a-gates.md` |
| ⑧g 账本恒等再过 | `on-stack.sh self verify:coa` | 0 | 105 户全 ≥ 0，`ALL INVARIANTS PASS` | `t11a-gates.md` |
| RBAC | `on-stack.sh self verify:rbac` | 1（既有基线） | S13d ✓ `域 15｜87 桶｜96 个组`；`共 1 条 FAIL`、GUARD_OPEN 0；唯一 ✗ = S7 四行 sumsub demo 死行，与 T5 的红集逐行一致 | `t11a-gates.md`、`t5-verify-rbac.txt` |
| 词表 | `npm run audit:vocab` | 0 | `合计 386 码`；`已写入 doc-final/lark/2026-09-16-audit-actions-catalog-full.md` | `t11a-gates.md`、`t4-audit-vocab.txt` |
| 全量 e2e | `on-stack.sh self test:e2e --runInBand --cacheDirectory=<新空目录>`（冷缓存；本机 01:16 +04 = UTC 21:16，在迪拜 00–04 窗口内） | 1 | **Run 1**：`Test Suites: 8 failed, 23 passed, 31 total`；`Tests: 21 failed, 178 passed, 199 total`。失败 21 名 = 预期 20 名（B 集 22 名减「recon-aging 主链路」「recon-adjustment 用例 9」）一名不少 + `vendor-onboarding ①`（已知偶发，波一 / 波二同签名；干净重铺单跑该文件 exit 0、2/2 绿）。**基线判定待主会话确认（见 `e2e-after-00a89e2f.md`，DRAFT）**；`demo/baseline.md` 的 B 集措辞本任务未动 | `e2e-after-00a89e2f.md` |
| R37 拒绝 | 带锚的认损补缺单落账后 `recon:demo:break` / `crisis` / `pass` | 1（预期被拒，三种皆然） | `Cannot re-stage the reconciliation scenarios: ITR261108064412, ITR261108240869 are posted and anchored … Use "Reset all demo data…"`（沿用 T10 在场景 16 之后取得的现场证据，T11a 未重走场景 16） | `t10-r37-break.txt`、`t10-r37-crisis.txt`、`t10-r37-pass.txt` |
| data.md 零 diff | `git diff --stat doc-final/demo/data.md`（全量 e2e 与收尾重铺之后） | 0 | 输出为空 | `t11a-gates.md`「收尾恢复」 |

另：T3 退役验证——`POST /demo-ops/recon-break` 返回 404（`t3-demo-ops-http.txt`）、`grep -rn "recon-break\|reconBreak" src admin-web/src scripts deploy` rc=1（`t3-grep-recon-break.txt`）、demo-ops 单测红绿各一次（`t3-red.txt` / `t3-green.txt`）。T6 recon 夹具改按迪拜业务日后，四个 recon e2e 文件在真实时钟与拨钟（Date −5h）下各跑一次（`t6-e2e-real.txt`、`t6-e2e-shifted.txt`）。

## 二、计数前后（spec §12 十二行）

取数命令与第二形态见 `counts-after.md` 同序行（其行 2 拆为 2a–2d、行 3 拆为 3a–3c，下表合并回 spec 的十二行）。

| # | 项 | 前 | 预期 | 实际 | ✓ |
|---|---|---|---|---|---|
| 1 | RBAC 动作桶（域 / 桶 / 组） | 15 / 89 / 96 | 15 / **87** / 96 | 15 / 87 / 96 | ✓ |
| 2 | 审计现役码 / 名册 / 词表种子行 | 386 / 19 / 364 | 386 / 19 / **393** | 386 / 19 / 393；旧种子路径引用 0 | ✓ |
| 3 | 科目码 / 转账码最大 / 演示库科目 | 13 / 91 / 105 | 不变 | 13 / 91 / 105 | ✓ |
| 4 | 算术门调用点 | 3 | **2** | 2（付款单、LP 兑换单；调拨单不再出现该名） | ✓ |
| 5 | `PrudentialStatus` 字段 | 8 | 9 | 9（+`perWallet`） | ✓ |
| 6 | `demo-ops` 端点 | 3 | 2 | 2（`status` / `reset`） | ✓ |
| 7 | `recon:demo:break` 脚本调用方 | 4 | 4 | 4（demo-run / 更新重铺 / cloud-verify / package） | ✓ |
| 8 | e2e B 集失败名 | 22 | **20**（多少都停） | 21 = 预期 20 ∪ {`vendor-onboarding ①`} | ⚠ 待主会话裁定（见上闸表与 `e2e-after-00a89e2f.md`） |
| 9 | TOOLING-DEBT | — | −2、订正 1 | 销 2（`:164`、`:213`）、订正 1（`:203`）；另加注 1（`:207`）、新增 1（`:218`） | ✓（加注与新增超出 spec 字面，见下） |
| 10 | BACKLOG | — | −2、改 1、+3 | 销 2（`:358`、`:360`）、新增 3（`:66`、`:68`、`:362`）、改 **2**（`:224` 与 `:64`） | ✓（改数多 1，见下） |
| 11 | `decisions.md` 行数 | 170 | 181 | 181（11 条）；`delivery/decision-log.md` D-31…D-37 共 +7 | ✓ |
| 12 | 文档含旧科目字面 | spec §1 清单 | 只剩合法命中 | 14 个文件命中数与 T9 记录逐文件一致，全为合法命中 | ✓ |

两处计数注：

- **BACKLOG 改 2 而非 1**：多出的 `:64`（账户流水页 1440px 横向滚动条条目）是 T10 修复轮应评审要求改记为「推迟」（随「账本三列表分组视图 + 钱包筛选」推迟，业主 2026-11-07），提交 `00a89e2f`；销 2 / 增 3 不受影响。T11b 另把该条新尾巴缺动词的语法修通（意思不变）。
- **TOOLING-DEBT 多出的两处**：`:207` 是在 `:205` 全量 e2e 红条下追加的订正段，写明「recon-aging 主链路」「recon-adjustment 用例 9」两例已转绿；`:218` 是新开一条——`vendor-payment-from-wallet` 与 `house-transfer` 两个 e2e 在同一次 `test:e2e` 调用里先后跑互相污染（F_FEE 余额）。T11b 另追加一条 `scripts/demo-shot.js` 的 `networkidle2` 与内层滚动容器条（来源戊波三 T0），位于文件末尾。

## 三、文档清册 11 项（spec §9）

「grep」列：命令为在 `doc-final/` 下运行的字面 grep；T9 的完整输出与合法命中标注见 `t9-doc-greps.md`。`G`、`P` 的定义同该文件（`G='FIRM_OPS|FIRM_LIQ|FIRM_SET|FIRM_ASSET|CLIENT_ASSET|结算中转|客户资产池|公司资产|9 码|10 码|九码|201|203'`；`P='只算运营|NLA 只|运营户时过门|from = 运营|from = F_OPS|from = F_FEE|仅运营户'`）。

| # | 文件 | 改了什么 | 提交 | grep 命令 → 结果 | ✓ |
|---|---|---|---|---|---|
| 1 | `delivery/semantic-contract.md`、`decision-log.md`、`dependency-contract-status.md`、`nonfunctional-baseline.md` | S9 按 COA v3 重写、S10 / S13 核认损补缺一张单；D-5 标被 D-31 取代、D-10 改一张单、新增 D-31…D-37；其余两篇核过零改动 | `f3cab756` | `grep -n -E "$G\|$P" delivery/*.md` → semantic-contract 0、decision-log 1（`:10` D-5 历史原文，后接「被 D-31 取代」）、dependency-contract-status 0、nonfunctional-baseline 0 | ✓ |
| 2 | `decisions.md` | 追加 11 条（2026-11-07）：COA v3 … 入账追回与垫款链挂起；其中 ⑧ 点名翻 `:152`；T11b 把调拨单条的签署语改为「业主拍板（裁定 2）＋作者裁定、业主已知（裁定 4）」 | `f3cab756`（T11b 复改一处） | `grep -c "^- \[2026-11-07\]" decisions.md` → 11；`wc -l decisions.md` → 181 | ✓ |
| 3 | `modules/accounting-coa.md` | 整篇重写（13 码五类、开户粒度、两条天平、NLA 一句、§5 技术节点、§6 缺口） | `f3cab756` | `grep -n -E "$G\|$P" modules/accounting-coa.md` → 1 处（`:41`「结算中转」，说明旧科目已退役的历史交代） | ✓ |
| 4 | `reference/coa-v3.md` | 状态行改现状；科目表按落地核对；新增 §2 七单与调账单记账总表 | `f3cab756` | `grep -n -E "$G\|$P" reference/coa-v3.md` → 9 处，全在「原 xx」对照列、退役码行与物理位置表（新旧对照，非现状描述） | ✓ |
| 5 | `modules/company-funds.md`、`lp-desk.md`、`overview.md`、`v8-recon.md`、`funds-orders.md`、`v6-swap.md`、`v7-treasury.md`；`prudential.controller.ts` summary、`rbac.catalog.ts` description、`scripts/recon-demo.ts` 注释 | 分录句与门语义句改新口径；`company-funds.md` 写 NLA 新口径与看板新格 | `f3cab756`（`company-funds.md` 另 `c85e8300`）；代码文字（controller summary、rbac description、recon-demo 注释）T1–T3 已改，T9 只复核 | 同上 G/P 对 7 篇 → company-funds 1（`from = F_OPS`，LP 兑换单余额闸，属实）、lp-desk 2（F_LIQ / 203 退役说明）、v8-recon 2（HTTP 201、审计 9 码）、其余 0 | ✓ |
| 6 | `reference/recon-cause-handbook.md` | 分录表按新户名核；「改记」一句改为四腿实际 | `f3cab756` | `grep -n -E "$G\|$P" reference/recon-cause-handbook.md` → 0；`grep -rn -E "客户资产这条腿\|客户资产腿\|资产腿一分没动\|资产腿完全不动" --include='*.md' .`（排除 archive / superpowers / lark）→ 仅 `decisions.md:41`（2026-09-01 历史条，只追加不改） | ✓ |
| 7 | `demo/baseline.md` | NLA 两口径与场景 31 / 32 数字、重摆口径、RBAC 桶数 87、`audit:vocab` 386、e2e B 集措辞（20 名，其判定待主会话确认，T11b 未动） | `1cfefd65`、`00a89e2f`（`c85e8300` 动桶数） | `grep -n "136,475,225\|1,364,752" demo/baseline.md` → `:287 / :289 / :358` 三处，均带「戊波三之前 / 旧口径作废 / 现行值见文末」订正（历史取数句）；新数字 `grep -n "136,469,600\|136,499,846\|111,499,846\|141,499,846" demo/baseline.md` → `:287`、`:590–593` | ✓ |
| 8 | `demo/script.md`（`data.md` 只核不改） | NLA 数字行、重摆说明（R37）、门语义（付款单两种 from 都过门、调拨单不过门）、看板格名 | `1cfefd65`、`00a89e2f` | `grep -n "Restore recon scenarios" demo/script.md` → 0；`grep -n -E "只算运营\|NLA 只\|运营户时过门\|from = 运营\|仅运营户" demo/script.md` → 仅 `:610`（T10 自述被替换的旧句）；`git diff --stat demo/data.md`（全量 e2e 与重铺后）→ 空 | ✓ |
| 9 | `CLAUDE.md`（根） | §10 云端面板一行改「只有重铺」；§8 路由表加词表行、lark 行括注（§7 未动） | `1cfefd65`、`1b099b77` | `grep -n "audit-actions-vocab" CLAUDE.md` → `:98`、`:99`；`grep -n "recon:demo:break 秒级" CLAUDE.md`（旧说法）→ 无（rc=1） | ✓ |
| 10 | 三桶债务 | `TOOLING-DEBT.md` 销 2 订正 1；`PRODUCTION-NOTES.md` 零改动；`BACKLOG.md` 销 2、改、增 3 | `1b099b77`、`3466c330`、`1cfefd65`、`a437c45a`、`00a89e2f` | `grep -n "NLA 仍只算运营\|小数位查找键" BACKLOG.md` → `:358`、`:360` 均已 `[x]` 划掉；`grep -n "^- \[x\]" TOOLING-DEBT.md` 核销账（见 `counts-after.md` 行 9 / 10） | ✓ |
| 11 | `CHANGELOG.md` 一行 + `CLAUDE.md §9` 报告 | CHANGELOG 顶部新增戊波三收官行；§9 报告行见本文第六节 | 本提交（T11b） | `sed -n 5p CHANGELOG.md` → `[2026-11-07] **战役戊波三收官…`；`grep -c "^- \[2026-11-07\]" CHANGELOG.md` → 2 | ✓ |

补充旧名宽搜（T11b 新跑，排除 `archive/`、`superpowers/`、`lark/`）：

```
grep -rn "Restore recon scenarios" doc-final CLAUDE.md --include='*.md'   → CHANGELOG.md:55（2026-09-13 历史行）、demo/script.md:246（R37 说明引用旧按钮名，指其已退役）
grep -rn "recon-break" doc-final CLAUDE.md --include='*.md'               → decisions.md:179（新条 ⑨）、demo/baseline.md:57 / :597（重摆口径说明）、demo/script.md:246
grep -rn "view_house_transfers\|act_house_transfers" doc-final CLAUDE.md src admin-web/src scripts test prisma   → 仅 demo/baseline.md:484（S13d 说明里点名两个被删桶）
```

搜索边界：只搜了这几组字面串；动态拼接、`archive/`、`lark/` 不在范围。

## 四、截图索引

| 组 | 文件 | 内容 |
|---|---|---|
| T0 | `t0-dashboard-before.png` | 公司资金看板首屏（treasury，改前：NLA 条 + 运营余额两格 + LP 在途） |
| T0 | `t0-ledger-usdt-tron-before.png` | 账本科目页按 USDT-TRON 筛（cfo，改前：余额 2 位小数） |
| T0 | `t0-flows-usdt-tron-before.png` | 账户流水页按 USDT 筛（cfo，改前） |
| T0 | `t0-demo-ops-panel-before.png` | Demo Data 面板（改前：含 Full reset 与「Restore recon scenarios」两块） |
| T2 | `t2-dashboard-light.png` / `t2-dashboard-dark.png` | 看板新版（四钱包一格、NLA 三小格、开支格）浅色 / 深色 |
| T2 | `t2-ledger-code50.png` | 科目页 code=50，与看板同户余额对照 |
| T3 | `t3-demo-ops-panel-after.png` | Demo Data 面板（改后：只剩 Full reset 一块） |
| T3 | `t3-demo-ops-panel-after.notfound.png` | 取面板时点击未命中的帧：管理台首页暗色，顶栏 Simulation 开、DEMO DATA 按钮可见，但面板未展开；有效图见上一行 |
| T5 | `t5-role-editor-treasury.png` | 角色编辑器 TREASURY_OFFICER 整页；Treasury 组里公司资金只剩「Operate company funding」「View company funds dashboard」等单项（重复桶删后的现状，全部 138 项权限一页列出） |
| T5 | `t5-house-transfer-list.png` | House Transfers 页（treasury，空列表）上点开的「Initiate House Transfer」弹层：Purpose = Fee sweep，Asset / From / To / Reason 字段；证明桶合并后 treasury 仍看得到并能操作该页 |
| T7 | `t7-ledger-code2-name.png` | 科目页按码 2 筛（cfo）：下拉显示「2 · CLIENT_SHORTFALL」，14 户，户名 `Custody Shortfall Receivable · CU… · vIBAN – AED` / `Deposit address – USDT` |
| T8 | `t8-case-books-delta-open.png` / `t8-case-books-delta-resolved.png` | 案件侧栏 Books Δ，未结案 / 已结案（已结案显示的是破口轮的值，spec §0.1 第 18 行所定） |
| T8 | `t8-ledger-usdt-tron-after.png` / `t8-flows-usdt-tron-after.png` | 科目页 / 流水页按 USDT-TRON / USDT 筛，改后小数位 |
| T10 幕 | `t10-act-1-swap-fee-levels.png`、`t10-act-2-customers.png`、`t10-act-3-deposits.png`、`t10-act-4-swaps.png`、`t10-act-5-withdrawals.png`、`t10-act-7-audit-logs.png` | 第一至五幕、第七幕各一张关键截图（demo:all 状态，非逐步重走） |
| T10 场景 16 | `t10-scene-16-1-overdue-eligible.png`、`t10-scene-16-2-healed.png` | 超期可认损 → 认损补缺后愈合 |
| T10 场景 18 | `t10-scene-18-1-incident-closed.png`、`t10-scene-18-2-case-healed.png` | 事故结案、案件愈合 |
| T10 场景 29 | `t10-scene-29-1-vendor-payments-list.png`、`t10-scene-29-2-initiate-pay-from.png` | 付款单列表、发起弹层的 Pay From 下拉 |
| T10 场景 31 | `t10-scene-31-6-explained-before-reheal.png`、`t10-scene-31-7-healed.png`、`t10-scene-31-8-dashboard-nla-breach.png` | 认损补缺后未重对账 / 重对账愈合 / 看板破线红横幅 |
| T10 场景 32 | `t10-scene-32-check-red.png`、`t10-scene-32-check-green.png`、`t10-scene-32-dashboard-recovered.png`、`t10-scene-32-fee-wallet-gate.txt` | 巡检红 / 绿、注资后看板回线、手续费户付款被门拦的 400 原文 |
| T10 场景 37 | `t10-scene-37-1-lp-active.png` | 新 LP 批准为 ACTIVE |
| T10 场景 41 | `t10-scene-41-1-dashboard-after-sweep.png`、`t10-scene-41-2-house-transfer-detail.png` | 扫费后看板、调拨单详情三笔结转 |

## 五、NLA 四个数（AED 分）

| 点 | NLA（分） | 折 AED | 文件 |
|---|---|---|---|
| 口径一：`reset self → up` 之后、`demo:all` 之前 | **136,469,600** | 1,364,696.00 | `t10-nla-k1.json` |
| 口径二：`demo:all` 之后 | **136,499,846** | 1,364,998.46 | `t10-nla-k2.json` |
| 场景 31：失窃 250,000.00 + 认损补缺落账 | **111,499,846**（`breached=true`，缺口 8,500,154 分） | 1,114,998.46 | `t10-nla-scene31-breach.json` |
| 场景 32：注资 300,000.00 兑现后 | **141,499,846**（`breached=false`） | 1,414,998.46 | `t10-nla-scene32-recovered.json` |

改前对照：`nla-status-before.json` = 136,475,225（只算运营户的旧口径）；T1 改后取数 `t1-nla-status-after.json`。

## 六、交付与报告行

- `cloud:deploy`：连欠波一至波三，命令 `npm run cloud:deploy`，业主触发（本波不跑）。
- `CLAUDE.md §9` 报告行：

`Documentation updated: modules§0-4 / modules§5 / demo / decisions / delivery — 战役戊波三收官：NLA 改三钱包口径并只在钱离开公司时过门、看板四钱包一格加开支格、云端面板只留重铺、COA v3 现状文档与记账总表定稿、审计词表归 agent 维护`
