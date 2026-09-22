# 第六幕清残留 · 波一「闸门复位」—— 设计稿

> 立于 2026-09-19 ｜ 基线 main `c58e9cac` ｜ 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md`（本文件只写细波一，波次边界以总纲为准）
> 依据：`superpowers/checkups/2026-09-19-act6-recon-checkup.md`（含 2026-09-19 当日订正段，范围数与因果判断以订正为准）

## 0. 本波做 / 不做

**做**：把「改错了会报红」这张网装回对账三域。两件事——摘掉类型逃逸、把 3 条恒真断言换成能红的断言。

**不做**（对照 CLAUDE.md §2 与总纲 §1）：
- **零行为变更**：不删任何 schema 列、不改任何 UI、不动任何业务分支、不新增 / 退役任何状态与边
- 不修红 3（`externalTimestamp`）、不删死列死码、不碰幽灵入口、不收权限 —— **全是波二的**
- 不重构结构（Case 主体服务 / 拆大方法 / 抽 helper）—— 波三
- 不碰 `trading` 等其它域的 180 处之外的逃逸（全仓共 360 处，本波只动对账三域）
- 不做幂等 / 去重 / 防御性校验 / 性能优化 / 向后兼容（§2）

## 1. 关键实测（2026-09-19 当日做完探针才写本稿，数字不是估的）

**范围 = 180 处 / 14 文件**（不是体检正文多处写的 137——那只是 `clearing-settle` 单域）：

| 域 | 处 | 文件 |
|---|---|---|
| `src/modules/clearing-settle` | 137 | 11 |
| `src/modules/governance/incidents` | 25 | 1 |
| `src/modules/asset-treasury/internal-transfers` | 18 | 2 |

**全摘之后闸① 冒 13 个错误，集中在 5 个文件**。探针（可原样复现，本稿写完已还原、闸①复绿）：

```bash
grep -rl "this\.prisma as any" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers --include='*.ts' \
  | xargs sed -i '' 's/(this\.prisma as any)/this.prisma/g'
npx tsc --noEmit -p tsconfig.json          # → 13 error TS
git checkout -- src/                        # 还原
```

**13 个错误逐条**（这是本波真正的工作量，不是那 180 处替换）：

| # | 位置 | 错误 | 性质 |
|---|---|---|---|
| 1 | `disposition/supplement-evidence.service.ts:167` | `string` 不能赋给 `"IN" \| "OUT"` | 方向字段松类型 |
| 2 | `supplement-evidence.service.ts:80` | `string \| null` 不能赋给 `SupplementKind \| null` | 同上 |
| 3 | `supplement-evidence.service.ts:138` | `string \| null` 塞进 wallet 复合唯一键的 `where` | **真隐患**：为 null 时 Prisma 运行期抛 |
| 4 | `supplement-evidence.service.ts:165` | `string \| null` → `string` | 可空塞不可空 |
| 5 | `supplement-evidence.service.ts:99` | `kase` 可能为 null | 未判空 |
| 6 | `disposition/adjustment.service.ts:256` | `incident.assessedAmount` 可能为 null | 未判空（在 `assertIncidentWriteOffAllowed` 里） |
| 7 | `adjustment.service.ts:401` | `string \| null` → `string` | 可空塞不可空 |
| 8 | `adjustment.service.ts:176` | 锚对象联合（`explainedFlowId` / `explainedExternalLineId` 二选一）不匹配 Prisma 入参 | 联合类型窄化 |
| 9-11 | `disposition/disposition.service.ts:74 / :95 / :97` | 同上锚联合 + 定性行整体入参 | 同上 |
| 12 | `workflow/case-aging.service.ts:28` | 返回对象与声明类型不符（多个可空列） | 可空传播 |
| 13 | `workflow/wallet-recon-run.service.ts:389` | `Record<string, unknown>[]` 不能赋给 `ReconciliationRunWalletCreateManyInput[]` | **快照写入完全没类型** |

**订正一条判断（写进总纲与体检的因果链都据此修过）**：摘逃逸**不能**防住下一个 `externalTimestamp`。类型只咬「写错字段名」与「可空塞不可空」，**不咬「省略可选字段」**——13 个错误里没有它就是证据。那道防线（断言写进去的行长什么样）归波二自建，本波不承诺。

## 2. 摘逃逸的做法

**统一替换 `(this.prisma as any)` → `this.prisma`**，然后逐个修那 13 个错误。修法分三类，**一律不许用新的 `as any` 或 `!` 非空断言把错误压回去**：

- **可空塞不可空（#4 #7 #12）**：在读出处就地判空，缺值走既有的 400 / NotFound 出口（这些方法都已有出口，不新造）
- **未判空（#5 #6）**：同上。注意 #6 `incident.assessedAmount` 在核销守卫里——**先查清业务上它能不能为 null**（事故未定损时就该为 null），若能，守卫本就该显式拒，这是补一条既有语义的显式拒绝，不算新增业务规则
- **联合 / 松类型（#1 #2 #3 #8-#11 #13）**：给局部变量与返回值补上准确类型；锚联合用 Prisma 生成的入参类型收窄；`:389` 的 createMany 载荷补 `ReconciliationRunWalletCreateManyInput[]`

**#3 单独盯**：`string | null` 进复合唯一键的 `where`，是这 13 个里唯一一个**会在运行期抛**的。修之前先确认该值在现有调用路径上能不能真为 null；能，就补显式出口；不能，就把类型收窄到不可空并说明依据。

**spec 文件里的 `as any` 本波不动**（`*.spec.ts` 里的 mock 造型是另一回事），只动非 spec 的 180 处。

## 3. 3 条恒真断言

| # | 位置 | 现状 | 本波改法 |
|---|---|---|---|
| 1 | `engine/v2/bucket-classifier.spec.ts:17-30` | 180 组网格只断言 `buckets.has(b)`，而 `computeBucket` 返回类型就是那 4 个字面量的联合 → TS 下不可能红 | **改成断言每组输入的期望桶**：网格逐组按四条规则（残差≠0 → BREAK；残差=0 且在途>0 → IN_TRANSIT；残差=0 且无在途且异常>0 → COMPENSATING；否则 MATCHED）算出期望值再比对。同文件上方 7 条 `it.each` 是真断言，保留不动 |
| 2-3 | `domain/reconciliation-case-idempotent-fields.spec.ts`（67 行，`grep -c "^import"` = **0**） | 用例 1：自建假 prisma，`create` mock 返 `{ id:'c-new', ...data }` 原样回显，再断言回显值等于刚塞进去的值。用例 2：自建 `stored` 数组 + 自建 `findMany` mock 做 filter，再断言 filter 生效。两条都零生产代码执行 | **整份删除**。理由：它测的是「JS 对象展开能回显字段」，与本仓任何业务无关；文件头自称「T1」，其承诺的真实行为（`(walletRef, businessDate)` 幂等 upsert）早已由 T2 落地。**冗余已核实（2026-09-19，无需实施者再查）**：`wallet-recon-run.service.spec.ts` 的 `describe('T2 idempotent upsert + auto-heal')`（:368 起）对同一条不变量有**三重真断言**——`:499`「same wallet breaks in 3 sequential runs → 1 OPEN case；firstSeenRunId 钉在 run 1；lastUpdatedRunId 跟随」、`:592`「case 唯一性跨日：昨日 OPEN case 今日复观察——不新建、firstSeenRunId 不变」、`:765`「既有 OPEN 案件被复观察——update 的 data 不带 slaDeadline、也不新建 case」。故**直接删，本波不补任何新测试** |

## 4. 交付清单（对照 `rules/delivery-checklist.md`，本波命中项）

命中 **2 行**，其余未触发：

- **改了前端** → 未触发（本波零前端改动）
- **改 schema** → 未触发
- **动了钱 / 新状态 / maker-checker / 权限组 / 新端点 / 新事件** → 全未触发
- ✅ **每轮收尾**：文档分层收口（`CLAUDE.md §9` 报一行）+ `CHANGELOG` 一行 + 回写总纲状态行 + 往波二 spec 骨架写承接记录
- ✅ **本任务是多波中的一波**：承接记录只写「实际偏差 / 执行中发现的新事实 / 波二前提有无变化」，**不展开波二 spec**

## 5. 闸与验收

**随手闸**：① `npx tsc --noEmit -p tsconfig.json` ② `cd admin-web && npx tsc -b --noEmit` ③ `cd client-web && npx tsc -b --noEmit`（②③ 本波不该有变化，跑一遍确认没误伤）；④ jest 跑对账三域全绿。

**本波特有的四条硬判据**（缺一不算过）：

1. **逃逸归零**：`grep -rn "this\.prisma as any" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers --include='*.ts' | grep -v '\.spec\.ts' | wc -l` → **0**
2. **闸门能咬人（变异实证）**：随便挑一个对账域 Prisma 列名故意改错 → 闸① **必红**；还原后复绿。**物证：红的那次 tsc 输出贴进收尾记录。**（这条是整波存在的理由——现在做同样的事闸①是绿的）
3. **网格断言变异实证**：破坏 `computeBucket` 任一分支（如把 `COMPENSATING` 分支改成返回 `MATCHED`）→ 网格断言**必红**；还原后复绿。另两条走删除，删后跑一次对账三域 jest 确认 `wallet-recon-run.service.spec.ts:499/:592/:765` 三条仍全绿（不变量覆盖不因删除而丢）
4. **零行为变更**：`bash scripts/on-stack.sh self demo:all` + `recon:demo:break` 的**栈级输出与波前逐字节 diff = 空**（判例 2026-09-13 波四：这是 `as any` 与 mock 逃逸之下唯一咬得住的闸）

**不需要**：重铺闸（未动 schema）、`verify:coa`（未动钱）、截图（未动前端）。

## 6. 风险与开口

- **最大风险是「用新逃逸把错误压回去」**：修那 13 个错误时，`as any` / `!` / `@ts-ignore` 三种压法都禁用。评审须逐条问「这处为什么类型是对的」，答不上来的退回
- **#6 `incident.assessedAmount` 可能牵出业务问题**：若查出「事故未定损也能走到核销守卫」，那是一条**业务缺口**，按 §4 记 `BACKLOG`，**本波不顺手改业务**，只把类型与显式拒补上
- **jest 里若有依赖松类型的 mock 因此编译失败**：属本波范围，就地修 mock 的造型；但**不许为了让测试通过而改测试的断言**（§2 末条）
- **波二前提不变**：本波不碰红 3、死列、幽灵入口、权限，波二边界按总纲原样

## 承接上一波

无——本波是本战役第一波。上游输入是体检报告（含当日订正）与总纲。
