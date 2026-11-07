# 戊波三证据目录

## 目的

戊波三（公司侧读面闸门 + 收官）**改前**对照物：NLA 状态 JSON、计数、四张截图，供 T11 收尾对照「改前 → 改后」。本目录只放证据；后续任务往下追加。

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
| `t0-dashboard-before.png` | 公司资金看板全页（treasury；NLA 条 + 运营余额两格 + LP 在途等，尚无「开支格」/ 四钱包一格） |
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
