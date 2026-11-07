# T11a · 收尾闸摘要（代码头 `00a89e2f`，2026-11-08 01:10–01:21 +04 = 2026-11-07 21:10–21:21 UTC）

每条前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`（Node v20.20.2）；仓库根；自己的栈 `self`（API 3120 / Admin 3121 / Client 3122 / TB 3123）。起点 `git status` 干净。原始日志在会话 scratchpad，未入库；下面是摘录。

| 闸 | 命令 | 退出码 | 关键摘录 |
|---|---|---|---|
| ① 后端 tsc | `npx tsc --noEmit -p tsconfig.json` | 0 | 零输出 |
| ② 管理台 tsc | `cd admin-web && npx tsc -b --noEmit` | 0 | 零输出 |
| ③ 客户端 tsc | `cd client-web && npx tsc -b --noEmit` | 0 | 零输出 |
| ④ 全量 jest | `npx jest`（仓库根，不接管道，无 DATABASE_URL） | 0 | `Test Suites: 288 passed, 288 total`；`Tests: 2 skipped, 5 todo, 4859 passed, 4866 total`；`Time: 65.451 s`（对照波二 288 套 / 4862 过：套数不变，过的例数净 −3，有增有删，未逐例对账） |
| ⑧a 重铺 | `bash scripts/stack.sh reset self` | 0 | |
| ⑧b 起栈 | `bash scripts/stack.sh up` | 0 | |
| ⑧c 演示数据 | `bash scripts/on-stack.sh self demo:all` | 0 | `花名册：35/35 符合预期`；`asserts: 5/5 PASS`；`demo:all DONE ✅` |
| ⑦/⑧d 账本恒等 | `bash scripts/on-stack.sh self verify:coa` | 0 | 两本四条恒等 ✓；`负余额检查 通过 (105 个科目全部 ≥ 0)`；`ALL INVARIANTS PASS` |
| ⑧e 对账通过态 | `bash scripts/on-stack.sh self recon:demo:pass` | 0 | `planned 21 wallet(s)`；`casesOpened==0`、`mismatch==0`；`recon:demo pass DONE — OK` |
| ⑧f 对账破口 | `bash scripts/on-stack.sh self recon:demo:break` | 0 | `casesOpened 12/12`、`identities OK`；`ALL 18 SCENARIOS DETECTED PER MANIFEST`；`recon:demo break DONE — OK` |
| ⑧g 账本恒等再过 | `bash scripts/on-stack.sh self verify:coa` | 0 | 105 户全 ≥ 0，`ALL INVARIANTS PASS`（CLIENT 恒等数随 break 摆场变化：34107565 → 34307565，属预期） |
| RBAC | `bash scripts/on-stack.sh self verify:rbac` | 1（预期，既有基线） | S13d ✓「域 15（预期 15）｜ACTION_BUCKET_CATALOG 共 87 桶（预期 87）｜…共 96 个组（预期 96）」；186 条 ✓；`共 1 条 FAIL`、GUARD_OPEN 0 条；唯一 ✗ = S7（四行 sumsub demo 死行）。`diff <(grep "✗" 本次日志) <(grep "✗" t5-verify-rbac.txt)` 为空 → 与 T5 的红集逐行一致 |
| 词表 | `npm run audit:vocab` | 0 | `合计 386 码`；`已写入 doc-final/lark/2026-09-16-audit-actions-catalog-full.md` |

**`audit:vocab` 重新生成的全量词表**（留在工作树不提交，交 T11b）：`git diff --stat` = `doc-final/lark/2026-09-16-audit-actions-catalog-full.md | 2 +-`（1 行增 / 1 行删）；`git diff` 全文只动版头哈希行（基线 main `e946e7de` → `00a89e2f`），别无其他变化。

**R37（认损补缺落账后 `recon:demo:break` 被拒）**：按控制者裁定复用 Task 10 的现场证据（`t10-r37-break.txt` / `t10-r37-crisis.txt` / `t10-r37-pass.txt`，在场景 16 之后、与 HEAD 代码只差注释的树上取得），本任务未重走场景 16。

**收尾恢复**：全量 e2e 之后 `reset self → up → demo:all`（0 / 0 / 0，asserts 5/5 PASS）；`git status --short` 只剩上面那份词表；`git diff --stat doc-final/demo/data.md` 为空（demo-roster 没写脏，无需 `git checkout`）。
