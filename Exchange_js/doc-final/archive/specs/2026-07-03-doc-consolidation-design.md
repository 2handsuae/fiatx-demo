# 文档单一真相源 + 分层收编 — 设计

Date: 2026-07-03 ｜ Status: approved（待执行）

> 本 spec 自身即 dogfood 新规范：落在 canonical 位置 `doc-final/superpowers/specs/`，不落壳层 / 旧 `docs/`。

## 0. 背景（散落现状 + 根因）

项目文档散在 4 处，同类东西无单一真相源：

| 位置 | 内容 | 判定 |
|---|---|---|
| `Exchange_js/doc-final/`（266 跟踪文件） | rules/ + reference/(+truth) + glossary/ + ui-contract/ + BACKLOG.md + superpowers/{specs 129,plans 118,backlog,product-docs 3} | ✅ 真·真相源 |
| `重做版/doc-final/`（壳层，4 文件） | 07-01/02 的 funds-orders-round2 + funds-order-sim-actions 的 spec/plan | 🔀 平行 session 从壳根跑、放错层 |
| `Exchange_js/docs/superpowers/`（19 文件） | 2026-05 最早期 spec/plan，全部独有未迁 | 🔀 历史遗留 |

**散因（治本靶点）**：superpowers 技能默认把 spec 写去 `docs/superpowers/specs/`，但项目规范是 `doc-final/superpowers/`——CLAUDE.md 没钉死这条路径，靠人工重定向，跑错目录/落旧路径就散。规范不落地，收编完还会再散。

## 1. 目标

1. **单一真相源**：所有文档只有一个根 `Exchange_js/doc-final/`；壳层 doc-final、旧 docs/ 消灭。
2. **分层清晰**：活真相层（平时看）vs 历史/设计存档层（追溯才翻），用 README 读法地图表达。
3. **规范落地**：canonical spec/plan 路径钉进 CLAUDE.md，断掉再散的根。
4. **零丢失**：历史一篇不删，只归位；`git mv` 全程可追溯。

## 2. 目标结构（approach 1：路径不动，README 分层）

```
Exchange_js/doc-final/
├─ README.md          ★新增：顶层读法地图
├─ 🟢 活真相层
│   ├─ rules/  reference/(+truth/)  glossary/  ui-contract/  BACKLOG.md
└─ 🗄️ 历史/设计存档层
    └─ superpowers/   ★加 README banner
        ├─ specs/  plans/  backlog/  product-docs/
```

**为何不做物理归档（superpowers → archive/）**：会使全仓 `doc-final/superpowers/...` 引用（scripts 注释、247 篇 plan 交叉链、truth 锚点）集体断链，blast radius 过大。分层的“神”靠 README 立规矩即可，不动“形”（路径）。

## 3. 文件处置（23 搬 + 2 删，零撞名零覆盖，已验）

| 来源 | 动作 | 去向 |
|---|---|---|
| 壳层 `重做版/doc-final/superpowers/{plans,specs}/` **4 篇** | `git mv` | `Exchange_js/doc-final/superpowers/{plans,specs}/` |
| `重做版/doc-final/`（搬空后的壳） | `git rm -r` / 删目录 | — |
| `Exchange_js/docs/superpowers/{plans,specs}/` **19 篇** | `git mv` | `Exchange_js/doc-final/superpowers/{plans,specs}/` |
| `Exchange_js/docs/`（剩 .DS_Store 噪音） | 删目录 | — |

待搬清单（已验零撞名）：
- 壳层 4：`plans/2026-07-01-funds-orders-round2.md`、`plans/2026-07-02-funds-order-sim-actions.md`、`specs/2026-07-01-funds-orders-round2-design.md`、`specs/2026-07-02-funds-order-sim-actions-design.md`
- 旧 docs 19：plans 10（2026-05-15 … 2026-05-26）+ specs 9（2026-05-15 … 2026-05-26），全部 2026-05 独有。

Baseline：specs 129 / plans 118。收编后 specs 140 / plans 130（+本 spec 141）。

## 4. 两个 README（分层靠它立）

### 4.1 `doc-final/README.md`（新增）
声明两层：🟢 活真相层（rules/怎么写、reference/现状、glossary、ui-contract、BACKLOG）｜🗄️ 历史存档层（superpowers/specs+plans+product-docs）。底部指向 `reference/truth/README.md` 看更细四类分工。存档层标注“只读历史，现状以 reference/truth/ 为准”。

### 4.2 `superpowers/README.md`（新增 banner）
一句话：本层是 spec/plan 历史存档，只读，记录“当初怎么设计”，不代表现状；现状看 `../reference/truth/`，写法看 `../rules/`。新 spec/plan 继续写这里，命名 `YYYY-MM-DD-<topic>[-design].md`。

## 5. 规范落地 — 写进 `CLAUDE.md`

新增「文档单一真相源」节，钉三条：
1. 文档只有一个根 `Exchange_js/doc-final/`，禁止别处另立（壳层 / docs/）。
2. spec/plan 铁律路径 = `Exchange_js/doc-final/superpowers/{specs,plans}/YYYY-MM-DD-<topic>[-design].md`。
3. ⚠️ superpowers 技能默认写 `docs/superpowers/specs/`——**本项目覆盖此默认**；新会话务必在 `Exchange_js/` 下跑，勿从仓库根 `重做版/` 跑 spec 生成（壳层 4 篇跑偏的根因）。

## 6. 残链修复

移动后，`Exchange_js`（排除 `.claude/worktrees/` 平行工作树）内 grep `docs/superpowers/` → 全部重写为 `doc-final/superpowers/`。已知 2 处（`2026-05-06`/`2026-05-07` 两篇 plan 第 11 行 Spec 指针）+ 被搬 19 篇自身内部交叉链一并归一。**闭环判据：修完主树 grep `docs/superpowers` 零命中。**

## 7. 验证闭环（交付即证）

- `find` 证 `重做版/doc-final/` 与 `Exchange_js/docs/` 两目录已消失；
- `git ls-files doc-final/superpowers/{specs,plans}` 计数 = baseline + 23（+本 spec）；一篇不丢；
- 主树 grep `docs/superpowers` 零命中；
- `git status` 显示 rename（非 delete+add），证历史链未断；
- 两个 README + CLAUDE.md 规范就位。

## 8. Scope 守卫（不动的东西）

- ⛔ `settle-opt` 平行工作树一根汗毛不碰；
- ❌ 不动任何 `src/` 代码；
- ❌ 不删任何一篇历史文档（只归位）；
- ⏭️ prisma .bak / .DS_Store / serve.py / .vite 属乙/丁批次，本轮不做。

## 9. 执行步骤（有序，mechanical）

1. `git mv` 旧 docs 19 篇 → canonical（plans 10 + specs 9）。
2. `git mv` 壳层 4 篇 → canonical（plans 2 + specs 2）。
3. 删空目录：`Exchange_js/docs/` + `重做版/doc-final/`（含残留 .DS_Store）。
4. 残链归一：`docs/superpowers/` → `doc-final/superpowers/`（主树，排除 worktrees）。
5. 新增 `doc-final/README.md` + `doc-final/superpowers/README.md`。
6. CLAUDE.md 加「文档单一真相源」节。
7. 跑第 7 节全部验证判据，贴证据。
